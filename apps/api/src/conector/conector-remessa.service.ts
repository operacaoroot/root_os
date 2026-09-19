import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ActorType,
  ConnectorDeliveryStatus,
  ConnectorDeletionRule,
  ConnectorMode,
  ContextChange,
  ContextKind,
  ContextSource,
  Prisma,
} from '@prisma/client';
import { hashDoCorpo } from '../memory/procedencia';
import { EventLogService } from '../gateway/event-log.service';
import { comTenantResolvido } from '../common/contexto-execucao';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectorDeviceIdentity } from './conector.service';

const MAX_ITEMS = 100;
const MAX_BATCH_BYTES = 10 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_MANIFEST = 10_000;
const ALLOWED_EXTENSIONS = new Set(['.md', '.txt', '.csv']);
const ALLOWED_MIMES = new Set(['text/markdown', 'text/plain', 'text/csv', 'application/octet-stream']);

export interface RemessaOpenInput { fonteId: string; modo: ConnectorMode; chaveRequisicao: string }
export interface RemessaItemInput {
  caminhoRelativo: string;
  texto: string;
  hashConteudo: string;
  tamanho: number;
  mime: string;
}
export interface RemessaFimInput {
  itensVistos: Array<{ caminhoRelativo: string }>;
  itensEnviados: number;
  erros: string[];
  manifestoCompleto: boolean;
}

type SourceRow = Prisma.ConnectorSourceGetPayload<{}>;
type Tx = Prisma.TransactionClient;

/** Remessas são estado do receptor, nunca acesso ao filesystem do servidor. */
@Injectable()
export class ConectorRemessaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: EventLogService,
  ) {}

  async abrir(device: ConnectorDeviceIdentity, input: RemessaOpenInput) {
    validarChave(input.chaveRequisicao);
    return comTenantResolvido(device.orgId, async () => this.prisma.$transaction(async (tx) => {
      await this.definirTenant(tx, device.orgId);
      const source = await this.autorizarFonte(tx, device, input.fonteId, input.modo);
      // A ordem é atribuída na abertura, e não na chegada do lote: uma remessa
      // aberta antes de outra continua velha mesmo que atravesse a rede depois.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`remessa:${device.orgId}:${source.id}`}))`;
      const existente = await tx.connectorDelivery.findUnique({
        where: { orgId_deviceId_chaveRequisicao: { orgId: device.orgId, deviceId: device.id, chaveRequisicao: input.chaveRequisicao } },
      });
      if (existente) {
        if (existente.sourceId !== source.id || existente.modo !== source.modo || existente.escopoVersao !== source.escopoVersao) {
          throw new ConflictException('Chave de requisição já usada por outro escopo.');
        }
        return this.publicDelivery(existente);
      }
      const anterior = await tx.connectorDelivery.findFirst({
        where: { orgId: device.orgId, sourceId: source.id }, orderBy: { ordem: 'desc' }, select: { ordem: true },
      });
      const now = new Date();
      const delivery = await tx.connectorDelivery.create({
        data: {
          orgId: device.orgId, deviceId: device.id, sourceId: source.id,
          chaveRequisicao: input.chaveRequisicao, ordem: (anterior?.ordem ?? 0) + 1,
          modo: source.modo, escopoVersao: source.escopoVersao,
        },
      });
      await tx.connectorSource.update({ where: { id: source.id }, data: {
        ultimaRemessaTentativaEm: now, ultimaRemessaStatus: 'aberta', ultimaRemessaItens: 0, ultimaRemessaErros: 0,
      }});
      await this.audit(tx, device.orgId, device.id, 'conector.remessa.tentativa', 'ConnectorDelivery', delivery.id, {
        sourceId: source.id, ordem: delivery.ordem, modo: delivery.modo,
      });
      return this.publicDelivery(delivery);
    }));
  }

  async lote(device: ConnectorDeviceIdentity, deliveryId: string, items: RemessaItemInput[]) {
    if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) throw new BadRequestException('Lote inválido.');
    const bytes = items.reduce((sum, item) => sum + Buffer.byteLength(item.texto, 'utf8'), 0);
    if (bytes > MAX_BATCH_BYTES) throw new BadRequestException('Lote excede o limite de bytes.');
    items.forEach(validarItemBasico);
    return comTenantResolvido(device.orgId, async () => this.prisma.$transaction(async (tx) => {
      await this.definirTenant(tx, device.orgId);
      const deliveryPeek = await tx.connectorDelivery.findFirst({ where: { id: deliveryId, orgId: device.orgId } });
      if (!deliveryPeek) throw new NotFoundException('Remessa não encontrada.');
      await this.lockSource(tx, device.orgId, deliveryPeek.sourceId);
      await this.lockMemoria(tx, device.orgId);
      const delivery = await this.lockDelivery(tx, device, deliveryId);
      const source = await this.autorizarFonte(tx, device, delivery.sourceId, delivery.modo);
      if (delivery.escopoVersao !== source.escopoVersao) throw new ConflictException('Escopo da remessa mudou.');
      if (delivery.status === ConnectorDeliveryStatus.concluida) return this.publicDelivery(delivery);
      const latest = await tx.connectorDelivery.findFirst({ where: { orgId: device.orgId, sourceId: source.id }, orderBy: { ordem: 'desc' }, select: { ordem: true } });
      if ((latest?.ordem ?? delivery.ordem) > delivery.ordem) throw new ConflictException('Lote antigo recusado.');
      for (const item of items) this.validarItemFonte(item, source);
      const caminhos = new Map<string, string>();
      for (const item of items) {
        const anterior = caminhos.get(item.caminhoRelativo);
        if (anterior !== undefined && anterior !== item.hashConteudo) {
          throw new ConflictException('O mesmo caminho apareceu duas vezes com conteúdos diferentes.');
        }
        caminhos.set(item.caminhoRelativo, item.hashConteudo);
      }
      // A checagem ocorre antes de qualquer escrita: um lote velho não deixa
      // metade de seus itens e tampouco altera a versão de outro caminho.
      for (const item of items) {
        const duplicate = await tx.connectorDeliveryItem.findFirst({
          where: { deliveryId, sourceId: source.id, caminhoRelativo: item.caminhoRelativo, hashConteudo: item.hashConteudo },
        });
        if (duplicate) continue;
        const state = await tx.connectorItemState.findUnique({
          where: { orgId_sourceId_caminhoRelativo: { orgId: device.orgId, sourceId: source.id, caminhoRelativo: item.caminhoRelativo } },
        });
        if (state && state.revisao >= delivery.ordem) throw new ConflictException('Lote antigo recusado.');
      }
      let aceitos = 0; let duplicados = 0;
      for (const item of items) {
        const duplicate = await tx.connectorDeliveryItem.findFirst({
          where: { deliveryId, sourceId: source.id, caminhoRelativo: item.caminhoRelativo, hashConteudo: item.hashConteudo },
        });
        if (duplicate) { duplicados++; continue; }
        await this.receberItem(tx, device, delivery, source, item);
        aceitos++;
      }
      const updated = await tx.connectorDelivery.update({ where: { id: delivery.id }, data: {
        itensEnviados: { increment: aceitos }, ultimaRevisao: delivery.ordem,
      }});
      await this.audit(tx, device.orgId, device.id, 'conector.remessa.lote', 'ConnectorDelivery', delivery.id, {
        sourceId: source.id, aceitos, duplicados, ordem: delivery.ordem,
      });
      return { remessaId: updated.id, aceitos, duplicados, ordem: delivery.ordem };
    }));
  }

  async fim(device: ConnectorDeviceIdentity, deliveryId: string, input: RemessaFimInput) {
    validarFim(input);
    return comTenantResolvido(device.orgId, async () => this.prisma.$transaction(async (tx) => {
      await this.definirTenant(tx, device.orgId);
      const deliveryPeek = await tx.connectorDelivery.findFirst({ where: { id: deliveryId, orgId: device.orgId } });
      if (!deliveryPeek) throw new NotFoundException('Remessa não encontrada.');
      await this.lockSource(tx, device.orgId, deliveryPeek.sourceId);
      await this.lockMemoria(tx, device.orgId);
      const delivery = await this.lockDelivery(tx, device, deliveryId);
      const source = await this.autorizarFonte(tx, device, delivery.sourceId, delivery.modo);
      if (delivery.escopoVersao !== source.escopoVersao) throw new ConflictException('Escopo da remessa mudou.');
      if (delivery.status === ConnectorDeliveryStatus.concluida) return this.publicDelivery(delivery);
      const latest = await tx.connectorDelivery.findFirst({ where: { orgId: device.orgId, sourceId: source.id }, orderBy: { ordem: 'desc' }, select: { ordem: true } });
      if ((latest?.ordem ?? delivery.ordem) > delivery.ordem) throw new ConflictException('Fechamento antigo recusado.');
      const manifest = new Set(input.itensVistos.map((item) => item.caminhoRelativo));
      if (manifest.size !== input.itensVistos.length) throw new BadRequestException('Manifesto contém chave repetida.');
      input.itensVistos.forEach((item) => validarCaminho(item.caminhoRelativo));
      const erro = input.erros.length > 0 || !input.manifestoCompleto;
      if (!erro) {
        if (input.itensEnviados !== delivery.itensEnviados) throw new BadRequestException('Contagem de itens não confere com o recibo do servidor.');
        const known = await tx.connectorItemState.findMany({ where: { orgId: device.orgId, sourceId: source.id }, select: { caminhoRelativo: true } });
        const knownPaths = new Set(known.map((row) => row.caminhoRelativo));
        if ([...manifest].some((path) => !knownPaths.has(path))) throw new BadRequestException('Manifesto contém chave não recebida.');
        const received = await tx.connectorDeliveryItem.findMany({ where: { deliveryId: delivery.id }, select: { caminhoRelativo: true } });
        if (received.some((row) => !manifest.has(row.caminhoRelativo))) throw new BadRequestException('Manifesto não contém item recebido.');
      }
      if (!erro) {
        const states = await tx.connectorItemState.findMany({ where: { orgId: device.orgId, sourceId: source.id } });
        if (source.modo === ConnectorMode.sincronizacao && source.regraExclusao === ConnectorDeletionRule.arquivar) {
          for (const state of states) {
            if (!manifest.has(state.caminhoRelativo)) await this.arquivarItem(tx, device, state.contextItemId, source.id, state.caminhoRelativo);
          }
        }
      }
      const status = erro ? ConnectorDeliveryStatus.falha : ConnectorDeliveryStatus.concluida;
      const now = new Date();
      const updated = await tx.connectorDelivery.update({ where: { id: delivery.id }, data: {
        status, snapshotCompleto: !erro, itensVistos: input.itensVistos.length,
        erros: input.erros.length, finishedAt: now,
      }});
      await tx.connectorSource.update({ where: { id: source.id }, data: {
        ultimaRemessaTentativaEm: now, ultimaRemessaStatus: status,
        ultimaRemessaItens: delivery.itensEnviados, ultimaRemessaErros: input.erros.length,
        ...(erro ? {} : { ultimaRemessaSucessoEm: now }),
      }});
      await this.audit(tx, device.orgId, device.id, erro ? 'conector.remessa.fim_falhou' : 'conector.remessa.fim_sucesso', 'ConnectorDelivery', delivery.id, {
        sourceId: source.id, itensVistos: input.itensVistos.length, itensEnviados: delivery.itensEnviados,
        erros: input.erros.length, manifestoCompleto: input.manifestoCompleto,
      });
      return this.publicDelivery(updated);
    }));
  }

  private async receberItem(tx: Tx, device: ConnectorDeviceIdentity, delivery: any, source: SourceRow, item: RemessaItemInput) {
    const chave = `conector:${source.id}:${item.caminhoRelativo}`;
    const expectedSourceRef = `${source.id}/${item.caminhoRelativo}`;
    const existing = await tx.contextItem.findUnique({ where: { orgId_chave: { orgId: device.orgId, chave } } });
    if (existing && (existing.sourceType !== ContextSource.conector || existing.sourceRef !== expectedSourceRef)) {
      throw new ConflictException('Chave de memória tem proveniência incompatível.');
    }
    let contextItemId: string; let versionId: string; let change: ContextChange;
    if (!existing) {
      const created = await tx.contextItem.create({ data: {
        orgId: device.orgId, chave, kind: ContextKind.nota, title: item.caminhoRelativo,
        body: item.texto, sourceType: ContextSource.conector, sourceRef: expectedSourceRef,
        contentHash: item.hashConteudo, versao: 1, criadoPor: device.id, atualizadoPor: device.id,
      }});
      contextItemId = created.id; change = ContextChange.criacao;
      const version = await tx.contextItemVersion.create({ data: this.versionData(created, change, device.id) });
      versionId = version.id;
      const event = await this.eventos.registrarNaTransacao(tx, this.eventInput(device, 'memoria.item.criado', versionId, created.id, created.versao, change, item.hashConteudo));
      await tx.contextItemVersion.update({ where: { id: versionId }, data: { eventoId: event.id, eventoSeq: event.seq } });
    } else if (existing.contentHash === item.hashConteudo && !existing.arquivadoEm) {
      contextItemId = existing.id; versionId = '';
    } else {
      const next = existing.versao + 1;
      const updated = await tx.contextItem.update({ where: { id: existing.id }, data: {
        body: item.texto, title: item.caminhoRelativo, contentHash: item.hashConteudo,
        versao: next, arquivadoEm: null, arquivadoPor: null, atualizadoPor: device.id,
      }});
      contextItemId = updated.id; change = existing.arquivadoEm ? ContextChange.restauracao : ContextChange.alteracao;
      const version = await tx.contextItemVersion.create({ data: this.versionData(updated, change, device.id) });
      versionId = version.id;
      const event = await this.eventos.registrarNaTransacao(tx, this.eventInput(device, existing.arquivadoEm ? 'memoria.item.restaurado' : 'memoria.item.alterado', versionId, updated.id, updated.versao, change, item.hashConteudo));
      await tx.contextItemVersion.update({ where: { id: versionId }, data: { eventoId: event.id, eventoSeq: event.seq } });
    }
    await tx.connectorDeliveryItem.create({ data: {
      orgId: device.orgId, deliveryId: delivery.id, sourceId: source.id, contextItemId,
      caminhoRelativo: item.caminhoRelativo, hashConteudo: item.hashConteudo, tamanho: item.tamanho, revisao: delivery.ordem,
    }});
    await tx.connectorItemState.upsert({
      where: { orgId_sourceId_caminhoRelativo: { orgId: device.orgId, sourceId: source.id, caminhoRelativo: item.caminhoRelativo } },
      create: { orgId: device.orgId, sourceId: source.id, caminhoRelativo: item.caminhoRelativo, hashConteudo: item.hashConteudo, contextItemId, revisao: delivery.ordem },
      update: { hashConteudo: item.hashConteudo, contextItemId, revisao: delivery.ordem },
    });
  }

  private async arquivarItem(tx: Tx, device: ConnectorDeviceIdentity, id: string, sourceId: string, caminhoRelativo: string) {
    const item = await tx.contextItem.findFirst({ where: { id, orgId: device.orgId, sourceType: ContextSource.conector, sourceRef: `${sourceId}/${caminhoRelativo}`, arquivadoEm: null } });
    if (!item) return;
    const now = new Date(); const version = await tx.contextItemVersion.create({ data: this.versionData({ ...item, arquivadoEm: now, versao: item.versao + 1 }, ContextChange.arquivamento, device.id) });
    const event = await this.eventos.registrarNaTransacao(tx, this.eventInput(device, 'memoria.item.arquivado', version.id, item.id, version.versao, ContextChange.arquivamento, item.contentHash));
    await tx.contextItemVersion.update({ where: { id: version.id }, data: { eventoId: event.id, eventoSeq: event.seq } });
    await tx.contextItem.update({ where: { id }, data: { arquivadoEm: now, arquivadoPor: device.id, versao: item.versao + 1, atualizadoPor: device.id } });
  }

  private versionData(item: any, mudanca: ContextChange, actorId: string) {
    return { orgId: item.orgId, itemId: item.id, versao: item.versao, mudanca, kind: item.kind, title: item.title, body: item.body, sourceType: item.sourceType, sourceRef: item.sourceRef, contentHash: item.contentHash, autorTipo: 'system', autorId: actorId };
  }

  private eventInput(device: ConnectorDeviceIdentity, tipo: string, versionId: string, itemId: string, versao: number, mudanca: ContextChange, contentHash: string) {
    return { orgId: device.orgId, tipo, actorType: ActorType.system, actorId: device.id, agentSlug: null, contentHash, payload: { itemId, versaoId: versionId, versao, mudanca }, conteudo: { referencia: `ContextItemVersion:${versionId}`, fontes: { itemId, sourceType: 'conector', sourceRef: 'conector' } } };
  }

  private async lockDelivery(tx: Tx, device: ConnectorDeviceIdentity, id: string) {
    const rows = await tx.$queryRaw<any[]>(Prisma.sql`SELECT * FROM public."ConnectorDelivery" WHERE "id" = ${id} AND "orgId" = ${device.orgId} FOR UPDATE`);
    const row = rows[0];
    if (!row) throw new NotFoundException('Remessa não encontrada.');
    if (row.deviceId !== device.id) throw new ForbiddenException('Remessa fora do dispositivo.');
    if (![ConnectorDeliveryStatus.aberta, ConnectorDeliveryStatus.concluida].includes(row.status)) throw new ConflictException('Remessa não está aberta.');
    return tx.connectorDelivery.findUniqueOrThrow({ where: { id } });
  }

  private async lockSource(tx: Tx, orgId: string, sourceId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`remessa:${orgId}:${sourceId}`}))`;
  }

  private async lockMemoria(tx: Tx, orgId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`memoria:${orgId}`}))`;
  }

  private async autorizarFonte(tx: Tx, device: ConnectorDeviceIdentity, sourceId: string, modo: ConnectorMode) {
    const source = await tx.connectorSource.findFirst({ where: { id: sourceId, orgId: device.orgId, revokedAt: null, modo, devices: { some: { deviceId: device.id, orgId: device.orgId } } } });
    if (!source) throw new UnauthorizedException('Fonte não autorizada para este dispositivo.');
    const dev = await tx.connectorDevice.findFirst({ where: { id: device.id, orgId: device.orgId, revokedAt: null, org: { isActive: true } }, select: { id: true } });
    if (!dev) throw new UnauthorizedException('Dispositivo inválido ou revogado.');
    return source;
  }

  private validarItemFonte(item: RemessaItemInput, source: SourceRow) {
    if (item.tamanho > Number(source.tamanhoMaximo)) throw new BadRequestException('Arquivo excede o limite da fonte.');
    const ext = item.caminhoRelativo.slice(item.caminhoRelativo.lastIndexOf('.')).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext) || (source.tiposPermitidos.length > 0 && !source.tiposPermitidos.includes(ext))) {
      throw new BadRequestException('Extensão não autorizada pela fonte.');
    }
    if (source.incluir.length > 0 && !source.incluir.some((pattern) => corresponde(pattern, item.caminhoRelativo))) {
      throw new ForbiddenException('Arquivo fora dos filtros autorizados.');
    }
    if (source.excluir.some((pattern) => corresponde(pattern, item.caminhoRelativo))) {
      throw new ForbiddenException('Arquivo recusado pelo filtro da fonte.');
    }
  }

  private async definirTenant(tx: Tx, orgId: string) { await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`; }
  private async audit(tx: Tx, orgId: string, actorId: string, action: string, entityType: string, entityId: string, metadata: Prisma.InputJsonValue) {
    await tx.auditLog.create({ data: { orgId, actorType: ActorType.system, actorId, action, entityType, entityId, metadata } });
  }
  private publicDelivery(row: any) { return { remessaId: row.id, fonteId: row.sourceId, ordem: row.ordem, status: row.status, snapshotCompleto: row.snapshotCompleto, itensVistos: row.itensVistos, itensEnviados: row.itensEnviados, erros: row.erros }; }
}

function validarChave(value: string) { if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value)) throw new BadRequestException('Chave de requisição inválida.'); }
function validarCaminho(value: string) {
  if (!value || value.length > 500 || value.startsWith('/') || value.startsWith('\\') || value.startsWith('~') || /^[A-Za-z]:/.test(value) || value.includes('\\') || value.split('/').some((p) => !p || p === '.' || p === '..')) throw new BadRequestException('Caminho relativo inválido.');
}
function validarItemBasico(item: RemessaItemInput) {
  validarCaminho(item.caminhoRelativo);
  if (!Number.isSafeInteger(item.tamanho) || item.tamanho < 0 || item.tamanho > MAX_FILE_BYTES) throw new BadRequestException('Tamanho inválido.');
  if (!/^[a-f0-9]{64}$/.test(item.hashConteudo) || hashDoCorpo(item.texto) !== item.hashConteudo) throw new BadRequestException('Hash de conteúdo inválido.');
  if (Buffer.byteLength(item.texto, 'utf8') !== item.tamanho) throw new BadRequestException('Tamanho não confere.');
  if (!ALLOWED_MIMES.has(item.mime)) throw new BadRequestException('Tipo de arquivo inválido.');
  if ('links' in (item as any)) throw new BadRequestException('Links declarados não são aceitos.');
}
function validarFim(input: RemessaFimInput) {
  if (!Array.isArray(input.itensVistos) || input.itensVistos.length > MAX_MANIFEST || !Number.isSafeInteger(input.itensEnviados) || input.itensEnviados < 0 || !Array.isArray(input.erros) || input.erros.length > 100 || typeof input.manifestoCompleto !== 'boolean') throw new BadRequestException('Fechamento inválido.');
}

export function corresponde(pattern: string, value: string): boolean {
  let regex = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        regex += '(?:.*/)?';
        i += 2;
      } else {
        regex += '.*';
        i += 1;
      }
    } else if (char === '*') {
      regex += '[^/]*';
    } else if (char === '?') {
      regex += '[^/]';
    } else {
      regex += /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
    }
  }
  return new RegExp(`^${regex}$`).test(value);
}
