import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type ContextMovementIntent, type ContextMovementCandidate, type ContextItem } from '@prisma/client';
import { z } from 'zod';
import {
  MovimentoExplicitoPreviaSchema, MovimentoExplicitoPreviaResultadoSchema, MovimentoExplicitoIntencaoSchema,
  MovimentoExplicitoCapturarSchema, MovimentoExplicitoConfirmarSchema, MovimentoExplicitoCancelarPreviaSchema,
  MovimentoExplicitoCancelarSchema, MovimentoExplicitoCancelamentoPreviaResultadoSchema, MovimentoExplicitoResultadoSchema,
  MovimentoExplicitoReciboSchema, AliasDoContextoConsultaSchema, AliasDoContextoSchema,
  type MovimentoExplicitoPreviaResultado, type MovimentoExplicitoConfirmar,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MemoriaService } from '../memory/memoria.service';
import { filtroDeLeitura, exigirAcessoAtual } from '../memory/acesso-memoria';
import { chaveDaVault, hashDoCorpo } from '../memory/procedencia';
import { consultaMovimentoPendente, exigirColecaoSemMovimentoPendente, travarAutoridadeDoMovimento } from '../memory/contexto-movimento-namespace';
import { EventLogService, canonizar } from '../gateway/event-log.service';
import { AuditService } from '../audit/audit.service';
import { ObsidianService } from './obsidian.service';
import { CatalogoDeColecaoService, hashMetadata, type CapturaDoCatalogo } from './catalogo-de-colecao.service';
import { PASTAS_FORA_DA_COLECAO } from './pertenca-da-vault';
import { COLECAO } from './recibo-da-vault';

type Prova = MovimentoExplicitoConfirmar['newSelection'];
const sha = (v: unknown): string => createHash('sha256').update(canonizar(v)).digest('hex');
const MarcaSchema = z.object({ repositorioId: z.string().regex(/^[a-f0-9]{64}$/), head: z.string().regex(/^[a-f0-9]{40}$/),
  indiceHash: z.string().regex(/^[a-f0-9]{64}$/), indiceModificadoEm: z.number().finite().nonnegative() }).strict();
const MetadataSchema = z.object({ title: z.string(), kind: z.string(), tags: z.array(z.string()),
  validFrom: z.string().nullable(), validUntil: z.string().nullable(), sourceRef: z.string() }).strict();
function conflito(): never { throw new ConflictException('A intenção, a fonte ou a captura mudou. Confira o pedido antes de continuar.'); }
function limite(): never { throw new BadRequestException({ code: 'contexto_movimento_envelope_excede_limite',
  message: 'A prévia e os comprovantes deste movimento excedem 64 KiB. Reduza o pedido antes de reservar o destino.' }); }
function json(v: unknown): Prisma.InputJsonValue {
  if (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return v;
  if (Array.isArray(v)) return v.map((x) => x === null ? null : json(x));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === null ? null : json(x)]));
  throw new BadRequestException('Documento JSON inválido.');
}

@Injectable()
export class ContextoMovimentoExplicitoService {
  constructor(private readonly prisma: PrismaService, private readonly memoria: MemoriaService,
    private readonly obsidian: ObsidianService, private readonly catalogo: CatalogoDeColecaoService,
    private readonly eventos: EventLogService, private readonly audit: AuditService) {}

  private async transacao<T>(orgId: string, actorId: string, escrita: boolean, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `obsidian-index:${orgId}`);
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `memoria:${orgId}`);
      await travarAutoridadeDoMovimento(tx, orgId, actorId, escrita);
      const result = await fn(tx);
      await exigirAcessoAtual(tx, orgId, actorId, escrita ? ['obsidian.ver', 'obsidian.editar'] : ['obsidian.ver']);
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30_000 });
  }

  private async envelope<T extends z.ZodTypeAny>(tx: Prisma.TransactionClient, schema: T, valor: unknown): Promise<z.output<T>> {
    const parsed = schema.parse(valor);
    const texto = JSON.stringify(parsed);
    if (new TextEncoder().encode(texto).byteLength > 65536) limite();
    const medidas = await tx.$queryRawUnsafe<Array<{ bytes: number }>>('SELECT octet_length($1::jsonb::text) AS bytes', texto);
    if (medidas.length !== 1 || medidas[0].bytes > 65536) limite();
    return parsed;
  }

  private async item(tx: Prisma.TransactionClient, orgId: string, actorId: string, itemId: string): Promise<ContextItem> {
    await tx.$queryRaw`SELECT id FROM "ContextItem" WHERE id=${itemId} AND "orgId"=${orgId} FOR UPDATE`;
    const item = await tx.contextItem.findFirst({ where: { id: itemId, orgId, ...filtroDeLeitura(actorId) } });
    if (!item) throw new NotFoundException('Fonte não encontrada.');
    return item;
  }
  private async vigente(tx: Prisma.TransactionClient, item: ContextItem) {
    await tx.$queryRaw`SELECT id FROM "ContextItemVersion" WHERE "orgId"=${item.orgId} AND "itemId"=${item.id} ORDER BY versao FOR SHARE`;
    const v = await tx.contextItemVersion.findFirst({ where: { orgId: item.orgId, itemId: item.id, versao: item.versao } });
    const max = await tx.contextItemVersion.findFirst({ where: { orgId: item.orgId, itemId: item.id }, orderBy: { versao: 'desc' } });
    if (!v || max?.id !== v.id || v.body !== item.body || v.title !== item.title || v.kind !== item.kind || v.contentHash !== item.contentHash
      || hashDoCorpo(v.body) !== v.contentHash || v.sourceType !== item.sourceType || v.sourceRef !== item.sourceRef) conflito();
    return v;
  }
  private async intencao(tx: Prisma.TransactionClient, orgId: string, actorId: string, requestId: string) {
    await tx.$queryRaw`SELECT id FROM "ContextMovementIntent" WHERE "orgId"=${orgId} AND "requestId"=${requestId} FOR UPDATE`;
    const i = await tx.contextMovementIntent.findFirst({ where: { orgId, requestId } });
    if (i && i.actorId !== actorId) throw new ForbiddenException('Pedido indisponível para esta pessoa.');
    if (i) await this.item(tx, orgId, actorId, i.itemId);
    return i;
  }
  private async prova(tx: Prisma.TransactionClient, orgId: string, selectionId: string, chave: string, candidate?: ContextMovementCandidate) {
    await tx.$queryRaw`SELECT id FROM "ContextCollectionSelection" WHERE id=${selectionId} AND "orgId"=${orgId} AND "collectionId"=${COLECAO} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "ContextCollectionMember" WHERE "selectionId"=${selectionId} AND "orgId"=${orgId} AND chave=${chave} ORDER BY id FOR SHARE`;
    const s = await tx.contextCollectionSelection.findFirst({ where: { id: selectionId, orgId, collectionId: COLECAO } });
    const ms = await tx.contextCollectionMember.findMany({ where: { orgId, selectionId, chave } });
    if (!s || ms.length !== 1 || !s.membershipDigest) conflito();
    const m = ms[0], bytes = Buffer.from(m.caminhoBytes), caminhoUtf8 = bytes.toString('utf8');
    if (!Buffer.from(caminhoUtf8).equals(bytes)) conflito();
    const base = { id: s.id, colecaoId: s.collectionId, geracao: s.generation.toString(), membershipDigest: s.membershipDigest,
      marca: MarcaSchema.parse(s.marcaDepois ?? s.marcaAntes), membro: { id: m.id, chave: m.chave,
        caminho: { caminhoUtf8, caminhoBytesHex: bytes.toString('hex') }, blobGit: m.blobGit, hashArquivo: m.hashArquivo,
        contentHash: m.contentHash, metadataHash: m.metadataHash } };
    return { base, completa: candidate ? { ...base, candidateId: candidate.id, captureMarkHash: candidate.captureMarkHash } : null, membro: m, selecao: s };
  }
  private async previaPersistida(tx: Prisma.TransactionClient, i: ContextMovementIntent): Promise<MovimentoExplicitoPreviaResultado> {
    const old = await this.prova(tx, i.orgId, i.oldSelectionId, i.originKey);
    if (old.membro.id !== i.oldMemberId || old.membro.itemId !== i.itemId || old.membro.versionId !== i.currentVersionId
      || old.membro.versao !== i.currentVersionNo || old.membro.contentHash !== i.currentContentHash
      || old.selecao.generation !== i.oldGeneration || old.base.membershipDigest !== i.oldMembershipDigest
      || !Buffer.from(old.membro.caminhoBytes).equals(Buffer.from(i.originPathBytes))) conflito();
    const atual = await tx.contextItemVersion.findFirst({ where: { id: i.currentVersionId, orgId: i.orgId, itemId: i.itemId, versao: i.currentVersionNo } });
    const escolhida = await tx.contextItemVersion.findFirst({ where: { id: i.selectedVersionId, orgId: i.orgId, itemId: i.itemId, versao: i.selectedVersionNo } });
    if (!atual || !escolhida || atual.contentHash !== i.currentContentHash || hashDoCorpo(atual.body) !== atual.contentHash
      || atual.sourceType !== 'vault' || atual.sourceRef !== i.originSourceRef || escolhida.contentHash !== i.selectedContentHash
      || hashDoCorpo(escolhida.body) !== escolhida.contentHash) conflito();
    const origem = { chave: i.originKey, sourceRef: i.originSourceRef,
      caminho: { caminhoUtf8: Buffer.from(i.originPathBytes).toString('utf8'), caminhoBytesHex: Buffer.from(i.originPathBytes).toString('hex') } };
    const destino = { chave: i.destinationKey, sourceRef: i.destinationSourceRef,
      caminho: { caminhoUtf8: Buffer.from(i.destinationPathBytes).toString('utf8'), caminhoBytesHex: Buffer.from(i.destinationPathBytes).toString('hex') } };
    return MovimentoExplicitoPreviaResultadoSchema.parse({ escopo: { orgId: i.orgId, actorId: i.actorId }, itemId: i.itemId, colecaoId: i.collectionId,
      atual: { versionId: i.currentVersionId, versao: i.currentVersionNo, contentHash: i.currentContentHash, chave: i.originKey, sourceType: 'vault', sourceRef: i.originSourceRef },
      escolhida: { versionId: i.selectedVersionId, versao: i.selectedVersionNo, contentHash: i.selectedContentHash },
      oldSelection: { ...old.base, marca: MarcaSchema.parse(i.oldMarca) }, origem, destino,
      payload: { itemId: i.itemId, expectedItemVersion: i.expectedItemVersion, selectedVersionId: i.selectedVersionId,
        selectedContentHash: i.selectedContentHash, oldSelectionId: i.oldSelectionId, oldMemberId: i.oldMemberId, destino: destino.caminho, motivo: i.motivo }, marcaServer: i.serverMarkHash });
  }
  private orcamento(p: MovimentoExplicitoPreviaResultado, requestId: string): void {
    if (!orcarEnvelopesDoMovimento(p, requestId).cabe) limite();
  }

  private async prepararPrevia(tx: Prisma.TransactionClient, orgId: string, actorId: string, bruto: unknown) {
    const payload = MovimentoExplicitoPreviaSchema.parse(bruto);
    await exigirColecaoSemMovimentoPendente(tx, orgId);
    const item = await this.item(tx, orgId, actorId, payload.itemId), v = await this.vigente(tx, item);
    if (item.arquivadoEm || item.sourceType !== 'vault' || item.versao !== payload.expectedItemVersion || !item.sourceRef) conflito();
    const escolhida = await tx.contextItemVersion.findFirst({ where: { id: payload.selectedVersionId, orgId, itemId: item.id } });
    if (!escolhida || escolhida.contentHash !== payload.selectedContentHash || hashDoCorpo(escolhida.body) !== escolhida.contentHash || escolhida.versao > item.versao) conflito();
    const ultima = await tx.contextCollectionSelection.findFirst({ where: { orgId, collectionId: COLECAO }, orderBy: { generation: 'desc' } });
    if (!ultima || ultima.id !== payload.oldSelectionId || ultima.estado !== 'projetado') conflito();
    const old = await this.prova(tx, orgId, ultima.id, item.chave);
    if (old.membro.id !== payload.oldMemberId || old.membro.itemId !== item.id || old.membro.versionId !== v.id
      || old.membro.versao !== item.versao || old.membro.contentHash !== item.contentHash) conflito();
    const metadata = MetadataSchema.parse(old.membro.metadata);
    if (metadata.sourceRef !== item.sourceRef || metadata.title !== item.title || metadata.kind !== item.kind
      || sha(metadata.tags.slice().sort()) !== sha(item.tags.slice().sort()) || metadata.validFrom !== (item.validFrom?.toISOString() ?? null)
      || metadata.validUntil !== (item.validUntil?.toISOString() ?? null) || hashMetadata(metadata) !== old.membro.metadataHash) conflito();
    const indice = await tx.knowledgeNote.findMany({ where: { orgId, path: item.sourceRef } });
    if (indice.length !== 1 || indice[0].content !== item.body || indice[0].title !== item.title
      || sha(indice[0].tags.slice().sort()) !== sha(item.tags.slice().sort())) conflito();
    const caminho = payload.destino.caminhoUtf8;
    if (!caminho.toLowerCase().endsWith('.md') || caminho.split('/').some((t) => t.startsWith('.'))
      || (caminho.includes('/') && PASTAS_FORA_DA_COLECAO.some((p) => p === caminho.split('/')[0])))
      throw new BadRequestException('O destino não pertence à coleção de fontes.');
    const origem = { chave: item.chave, sourceRef: item.sourceRef, caminho: old.base.membro.caminho };
    const destino = { chave: chaveDaVault(caminho), sourceRef: caminho.normalize('NFC'), caminho: payload.destino };
    if (destino.chave === origem.chave || destino.chave.length > 1400) conflito();
    if (await tx.contextKeyClaim.findFirst({ where: { orgId, key: destino.chave } })
      || await tx.contextItem.findFirst({ where: { orgId, chave: destino.chave } })) throw new ConflictException('O destino já está ocupado ou reservado.');
    const fisica = await this.obsidian.capturarDaPastaParaMovimento(tx, orgId);
    const ms = await tx.contextCollectionMember.findMany({ where: { orgId, selectionId: ultima.id } });
    if (fisica.captura.membershipDigest !== ultima.membershipDigest || sha(fisica.captura.marca) !== sha(old.base.marca)
      || ms.length !== fisica.captura.membros.length) conflito();
    if (fisica.captura.membros.some((m) => m.chave === destino.chave)) conflito();
    const base = { escopo: { orgId, actorId }, itemId: item.id, colecaoId: COLECAO,
      atual: { versionId: v.id, versao: v.versao, contentHash: v.contentHash, chave: item.chave, sourceType: 'vault' as const, sourceRef: item.sourceRef },
      escolhida: { versionId: escolhida.id, versao: escolhida.versao, contentHash: escolhida.contentHash }, oldSelection: old.base, origem, destino, payload };
    return MovimentoExplicitoPreviaResultadoSchema.parse({ ...base, marcaServer: sha(base) });
  }
  async previa(orgId: string, actorId: string, body: unknown) {
    return this.transacao(orgId, actorId, true, async (tx) => this.envelope(tx, MovimentoExplicitoPreviaResultadoSchema, await this.prepararPrevia(tx, orgId, actorId, body)));
  }
  private fingerprint(p: MovimentoExplicitoPreviaResultado, requestId: string): string {
    return sha({ schemaVersion: 1, orgId: p.escopo.orgId, actorId: p.escopo.actorId, requestId, current: p.atual,
      selected: p.escolhida, oldSelection: p.oldSelection, oldMember: p.oldSelection.membro, origem: p.origem, destino: p.destino, motivo: p.payload.motivo, marcaServer: p.marcaServer });
  }
  async registrarIntencao(orgId: string, actorId: string, body: unknown) {
    const input = MovimentoExplicitoIntencaoSchema.parse(body);
    return this.transacao(orgId, actorId, true, async (tx) => {
      const existe = await this.intencao(tx, orgId, actorId, input.requestId);
      if (existe) {
        const previa = await this.previaPersistida(tx, existe);
        if (sha(input.payload) !== sha(previa.payload) || input.marcaServer !== existe.serverMarkHash
          || this.fingerprint(previa, input.requestId) !== existe.inputFingerprint) conflito();
        return this.resultado(tx, existe, true);
      }
      const p = await this.prepararPrevia(tx, orgId, actorId, input.payload);
      if (p.marcaServer !== input.marcaServer) conflito();
      this.orcamento(p, input.requestId);
      const id = randomUUID(), inputFingerprint = this.fingerprint(p, input.requestId);
      const audit = await this.audit.logComRecibo({ orgId, actorId, action: 'context.movement.intent', entityType: 'context_item', entityId: p.itemId,
        metadata: { requestId: input.requestId, intentId: id } }, tx);
      const i = await tx.contextMovementIntent.create({ data: { id, orgId, actorId, itemId: p.itemId, collectionId: COLECAO,
        requestId: input.requestId, inputFingerprint, serverMarkHash: p.marcaServer, intentMarkHash: sha({ schemaVersion: 1, id, orgId, actorId, inputFingerprint, revision: 1 }),
        currentVersionId: p.atual.versionId, currentVersionNo: p.atual.versao, expectedItemVersion: p.atual.versao, currentContentHash: p.atual.contentHash,
        selectedVersionId: p.escolhida.versionId, selectedVersionNo: p.escolhida.versao, selectedContentHash: p.escolhida.contentHash,
        oldSelectionId: p.oldSelection.id, oldMemberId: p.oldSelection.membro.id, oldGeneration: BigInt(p.oldSelection.geracao),
        oldMembershipDigest: p.oldSelection.membershipDigest, oldMarca: json(p.oldSelection.marca), originKey: p.origem.chave,
        originPathBytes: Buffer.from(p.origem.caminho.caminhoBytesHex, 'hex'), originSourceRef: p.origem.sourceRef,
        destinationKey: p.destino.chave, destinationPathBytes: Buffer.from(p.destino.caminho.caminhoBytesHex, 'hex'), destinationSourceRef: p.destino.sourceRef,
        motivo: p.payload.motivo, creationAuditIds: [audit.id], estado: 'pendente', revision: 1 } });
      await tx.contextKeyClaim.create({ data: { orgId, key: i.destinationKey, itemId: i.itemId, tipo: 'reserved_target', intentId: i.id } });
      return this.resultado(tx, i, false);
    });
  }

  private async disponibilidade(tx: Prisma.TransactionClient, i: ContextMovementIntent) {
    const item = await this.item(tx, i.orgId, i.actorId, i.itemId);
    await this.vigente(tx, item);
    if (item.chave.length > 1400) conflito();
    const movimentoPendente = await consultaMovimentoPendente(tx, i.orgId, item.id);
    return { itemId: item.id, versao: item.versao, chaveAtual: item.chave, arquivada: !!item.arquivadoEm,
      movimentoPendente, novoUsoPermitido: !item.arquivadoEm && !movimentoPendente };
  }
  private async resultado(tx: Prisma.TransactionClient, i: ContextMovementIntent, replayed: boolean) {
    const escopo = { orgId: i.orgId, actorId: i.actorId }, disponibilidadeAtual = await this.disponibilidade(tx, i);
    if (i.estado !== 'pendente') {
      const r = await tx.contextMovementReceipt.findFirst({ where: { id: i.terminalReceiptId ?? '', orgId: i.orgId, intentId: i.id, actorId: i.actorId, requestId: i.requestId } });
      if (!r || r.tipo !== i.estado) conflito();
      const recibo = MovimentoExplicitoReciboSchema.parse(r.receipt);
      const { receiptHash, ...fatos } = recibo;
      if (receiptHash !== r.receiptHash || sha(fatos) !== receiptHash || recibo.id !== r.id || recibo.intentId !== i.id
        || recibo.orgId !== i.orgId || recibo.actorId !== i.actorId || recibo.itemId !== i.itemId || recibo.requestId !== i.requestId) conflito();
      await this.envelope(tx, MovimentoExplicitoReciboSchema, recibo);
      return this.envelope(tx, MovimentoExplicitoResultadoSchema, { estado: i.estado, escopo, recibo, disponibilidadeAtual, replayed });
    }
    const previa = await this.previaPersistida(tx, i);
    this.orcamento(previa, i.requestId);
    const latest = await tx.$queryRawUnsafe<Array<{ id: string }>>(`SELECT DISTINCT ON (c.purpose) c.id FROM "ContextMovementCandidate" c
      JOIN "ContextCollectionSelection" s ON s.id=c."selectionId" AND s."orgId"=c."orgId"
      WHERE c."orgId"=$1 AND c."intentId"=$2 AND c."actorId"=$3 ORDER BY c.purpose,s.generation DESC`, i.orgId, i.id, i.actorId);
    const count = await tx.$queryRawUnsafe<Array<{ total: string }>>(`SELECT COUNT(*)::text AS total FROM "ContextMovementCandidate"
      WHERE "orgId"=$1 AND "intentId"=$2 AND "actorId"=$3`, i.orgId, i.id, i.actorId);
    if (count.length !== 1 || !/^(?:0|[1-9][0-9]{0,18})$/.test(count[0].total)) conflito();
    const candidatas = await tx.contextMovementCandidate.findMany({ where: { orgId: i.orgId, intentId: i.id, actorId: i.actorId, id: { in: latest.map((v) => v.id) } } });
    if (candidatas.length !== latest.length || candidatas.length > 2) conflito();
    const ultima = await tx.contextCollectionSelection.findFirst({ where: { orgId: i.orgId, collectionId: COLECAO }, orderBy: { generation: 'desc' } });
    const candidatos: Array<{ id: string; purpose: 'movimento' | 'retorno'; prova: Prova; atual: boolean; capturadaEm: string }> = [];
    for (const purpose of ['movimento', 'retorno'] as const) {
      const c = candidatas.find((v) => v.purpose === purpose);
      if (!c) continue;
      const prova = await this.prova(tx, i.orgId, c.selectionId, purpose === 'movimento' ? i.destinationKey : i.originKey, c);
      if (!prova.completa || prova.selecao.movementIntentId !== i.id || c.itemId !== i.itemId || c.collectionId !== i.collectionId
        || c.membershipDigest !== prova.base.membershipDigest || sha(c.marca) !== sha(prova.base.marca)) conflito();
      candidatos.push({ id: c.id, purpose, prova: prova.completa, atual: ultima?.id === c.selectionId && prova.selecao.estado === 'classificado', capturadaEm: c.criadoEm.toISOString() });
    }
    return this.envelope(tx, MovimentoExplicitoResultadoSchema, { estado: 'pendente_de_captura_verificada', escopo,
      intencao: { id: i.id, requestId: i.requestId, itemId: i.itemId, revision: 1, intentMark: i.intentMarkHash, previa, criadaEm: i.criadoEm.toISOString() }, candidatos,
      historicoDeCandidatos: { modo: 'ultimo_por_proposito', total: count[0].total, parcial: BigInt(count[0].total) > BigInt(candidatos.length) }, disponibilidadeAtual, replayed });
  }
  async porPedido(orgId: string, actorId: string, requestId: string) {
    const id = z.string().uuid().parse(requestId).toLowerCase();
    return this.transacao(orgId, actorId, false, async (tx) => {
      const i = await this.intencao(tx, orgId, actorId, id);
      if (!i) return this.envelope(tx, MovimentoExplicitoResultadoSchema, { estado: 'ausencia_conferida', escopo: { orgId, actorId }, requestId: id });
      return this.resultado(tx, i, true);
    });
  }
  private conferirPedido(i: ContextMovementIntent, p: { requestId: string; expectedIntentRevision: 1; intentMark: string }): void {
    if (i.requestId !== p.requestId || p.expectedIntentRevision !== 1 || i.intentMarkHash !== p.intentMark) conflito();
  }
  private async validarCaptura(tx: Prisma.TransactionClient, i: ContextMovementIntent, captura: CapturaDoCatalogo, purpose: 'movimento' | 'retorno'): Promise<void> {
    const antiga = await tx.contextCollectionMember.findMany({ where: { orgId: i.orgId, selectionId: i.oldSelectionId }, orderBy: { chave: 'asc' } });
    if (antiga.length !== captura.membros.length) conflito();
    const esperada = purpose === 'movimento' ? i.destinationKey : i.originKey;
    const ausente = purpose === 'movimento' ? i.originKey : i.destinationKey;
    if (captura.membros.some((m) => m.chave === ausente)) conflito();
    for (const a of antiga) {
      const alvo = a.id === i.oldMemberId;
      const nova = captura.membros.filter((m) => m.chave === (alvo ? esperada : a.chave));
      if (nova.length !== 1) conflito();
      const n = nova[0], metadata = MetadataSchema.parse(a.metadata);
      const esperadoMetadata = alvo ? { ...metadata, sourceRef: purpose === 'movimento' ? i.destinationSourceRef : i.originSourceRef } : metadata;
      const bytes = alvo ? (purpose === 'movimento' ? i.destinationPathBytes : i.originPathBytes) : a.caminhoBytes;
      if (!n.caminhoBytes.equals(Buffer.from(bytes)) || n.blobGit !== a.blobGit || n.hashArquivo !== a.hashArquivo || n.contentHash !== a.contentHash
        || n.metadataHash !== hashMetadata(esperadoMetadata) || sha(n.metadata) !== sha(esperadoMetadata)) conflito();
    }
  }
  private async capturar(tx: Prisma.TransactionClient, i: ContextMovementIntent, purpose: 'movimento' | 'retorno') {
    this.orcamento(await this.previaPersistida(tx, i), i.requestId);
    const fisica = await this.obsidian.capturarDaPastaParaMovimento(tx, i.orgId);
    await this.validarCaptura(tx, i, fisica.captura, purpose);
    const ultima = await tx.contextCollectionSelection.findFirst({ where: { orgId: i.orgId, collectionId: COLECAO }, orderBy: { generation: 'desc' } });
    if (!ultima) conflito();
    const repetida = await tx.contextMovementCandidate.findFirst({ where: { orgId: i.orgId, intentId: i.id, actorId: i.actorId, purpose, selectionId: ultima.id } });
    if (repetida && repetida.membershipDigest === fisica.captura.membershipDigest && sha(repetida.marca) === sha(fisica.captura.marca)) {
      const prova = await this.prova(tx, i.orgId, ultima.id, purpose === 'movimento' ? i.destinationKey : i.originKey, repetida);
      if (!prova.completa || prova.selecao.estado !== 'classificado') conflito();
      return { candidate: repetida, prova: prova.completa, fisica, replayed: true };
    }
    const captureFingerprint = sha({ orgId: i.orgId, actorId: i.actorId, intentId: i.id, purpose, selectionAnteriorId: ultima.id,
      marca: fisica.captura.marca, membershipDigest: fisica.captura.membershipDigest });
    const selectionId = await this.catalogo.persistirCapturaHumanaNoTx(tx, i.orgId, i.actorId, i.id, fisica.captura);
    const id = randomUUID(), captureMarkHash = sha({ captureFingerprint, candidateId: id, selectionId });
    const audit = await this.audit.logComRecibo({ orgId: i.orgId, actorId: i.actorId, action: 'context.movement.capture',
      entityType: 'context_item', entityId: i.itemId, metadata: { intentId: i.id, requestId: i.requestId, selectionId, purpose } }, tx);
    const candidate = await tx.contextMovementCandidate.create({ data: { id, orgId: i.orgId, intentId: i.id, actorId: i.actorId, itemId: i.itemId,
      collectionId: i.collectionId, selectionId, purpose, captureFingerprint, captureMarkHash, membershipDigest: fisica.captura.membershipDigest,
      marca: json(fisica.captura.marca), auditIds: [audit.id] } });
    const prova = await this.prova(tx, i.orgId, selectionId, purpose === 'movimento' ? i.destinationKey : i.originKey, candidate);
    if (!prova.completa) conflito();
    return { candidate, prova: prova.completa, fisica, replayed: false };
  }
  async captura(orgId: string, actorId: string, requestId: string, body: unknown) {
    const p = MovimentoExplicitoCapturarSchema.parse(body);
    if (p.requestId !== requestId.toLowerCase()) conflito();
    return this.transacao(orgId, actorId, true, async (tx) => {
      const i = await this.intencao(tx, orgId, actorId, p.requestId);
      if (!i) throw new NotFoundException('Pedido não encontrado.');
      this.conferirPedido(i, p);
      if (i.estado !== 'pendente') return this.resultado(tx, i, true);
      const item = await this.item(tx, orgId, actorId, i.itemId);
      if (item.versao !== i.expectedItemVersion || item.chave !== i.originKey) conflito();
      await this.vigente(tx, item);
      const c = await this.capturar(tx, i, 'movimento');
      return this.resultado(tx, i, c.replayed);
    });
  }
  private async candidataAtual(tx: Prisma.TransactionClient, i: ContextMovementIntent, purpose: 'movimento' | 'retorno', enviada: Prova) {
    const ids = await tx.$queryRawUnsafe<Array<{ id: string }>>(`SELECT c.id FROM "ContextMovementCandidate" c
      JOIN "ContextCollectionSelection" s ON s.id=c."selectionId" AND s."orgId"=c."orgId"
      WHERE c."orgId"=$1 AND c."intentId"=$2 AND c."actorId"=$3 AND c.purpose=$4 ORDER BY s.generation DESC LIMIT 1`,
      i.orgId, i.id, i.actorId, purpose);
    const c = ids.length === 1 ? await tx.contextMovementCandidate.findFirst({ where: { id: ids[0].id, orgId: i.orgId, intentId: i.id, actorId: i.actorId, purpose } }) : null;
    const ultima = await tx.contextCollectionSelection.findFirst({ where: { orgId: i.orgId, collectionId: i.collectionId }, orderBy: { generation: 'desc' } });
    if (!c || c.id !== enviada.candidateId || ultima?.id !== c.selectionId || ultima.estado !== 'classificado' || ultima.movementIntentId !== i.id) conflito();
    const prova = await this.prova(tx, i.orgId, c.selectionId, purpose === 'movimento' ? i.destinationKey : i.originKey, c);
    if (!prova.completa || sha(prova.completa) !== sha(enviada)) conflito();
    const fisica = await this.obsidian.capturarDaPastaParaMovimento(tx, i.orgId);
    await this.validarCaptura(tx, i, fisica.captura, purpose);
    if (fisica.captura.membershipDigest !== c.membershipDigest || sha(fisica.captura.marca) !== sha(c.marca)) conflito();
    return { c, prova: prova.completa, fisica };
  }
  private async repetirTerminal(tx: Prisma.TransactionClient, i: ContextMovementIntent, tipo: 'confirmado' | 'cancelado', fingerprint: string) {
    const r = await tx.contextMovementReceipt.findFirst({ where: { orgId: i.orgId, intentId: i.id, actorId: i.actorId, requestId: i.requestId } });
    if (!r || r.tipo !== tipo || r.commitFingerprint !== fingerprint || r.inputFingerprint !== i.inputFingerprint) conflito();
    return this.resultado(tx, i, true);
  }
  async confirmar(orgId: string, actorId: string, requestId: string, body: unknown) {
    const p = MovimentoExplicitoConfirmarSchema.parse(body);
    if (p.requestId !== requestId.toLowerCase()) conflito();
    const preparo = await this.eventos.prepararContextoParaTx({ orgId, tipo: 'memoria.item.alterado', nivel: null });
    return this.transacao(orgId, actorId, true, async (tx) => {
      const i = await this.intencao(tx, orgId, actorId, p.requestId);
      if (!i) throw new NotFoundException('Pedido não encontrado.');
      this.conferirPedido(i, p);
      const commitFingerprint = sha({ tipo: 'confirmar', intentFingerprint: i.inputFingerprint, newSelection: p.newSelection,
        membershipDigest: p.newSelection.membershipDigest, provaNova: p.newSelection.membro });
      if (i.estado !== 'pendente') return this.repetirTerminal(tx, i, 'confirmado', commitFingerprint);
      this.orcamento(await this.previaPersistida(tx, i), i.requestId);
      const item = await this.item(tx, orgId, actorId, i.itemId), anterior = await this.vigente(tx, item);
      if (item.versao !== i.expectedItemVersion || anterior.id !== i.currentVersionId || item.chave !== i.originKey || item.arquivadoEm) conflito();
      const nova = await this.candidataAtual(tx, i, 'movimento', p.newSelection);
      const oldClaim = await tx.contextKeyClaim.findFirst({ where: { orgId, key: i.originKey, itemId: i.itemId, tipo: 'canonical', intentId: null } });
      const destClaim = await tx.contextKeyClaim.findFirst({ where: { orgId, key: i.destinationKey, itemId: i.itemId, tipo: 'reserved_target', intentId: i.id } });
      if (!oldClaim || !destClaim) conflito();
      const a = await tx.contextKeyClaim.updateMany({ where: { id: oldClaim.id, orgId, tipo: 'canonical', intentId: null }, data: { tipo: 'alias', intentId: i.id } });
      const b = await tx.contextKeyClaim.updateMany({ where: { id: destClaim.id, orgId, tipo: 'reserved_target', intentId: i.id }, data: { tipo: 'canonical', intentId: null } });
      if (a.count !== 1 || b.count !== 1) conflito();
      const alias = await tx.contextAlias.create({ data: { orgId, collectionId: COLECAO, aliasKey: i.originKey,
        aliasPathBytes: i.originPathBytes, itemId: i.itemId, claimId: oldClaim.id, intentId: i.id } });
      const mudou = await this.memoria.alterarCaminhoPorMovimentoNoTx(tx, { orgId, actorId, intentId: i.id, expectedItemVersion: i.expectedItemVersion }, preparo);
      await this.catalogo.projetarCapturaHumanaNoTx(tx, orgId, i.id, nova.c.selectionId, nova.fisica.captura);
      const nota = nova.fisica.notas.find((n) => n.path === i.destinationSourceRef);
      if (!nota) conflito();
      const indice = await tx.knowledgeNote.updateMany({ where: { orgId, path: i.originSourceRef, content: item.body, title: item.title },
        data: { path: i.destinationSourceRef, folder: nota.folder, fileTime: nota.fileTime } });
      if (indice.count !== 1) conflito();
      const depois = await this.obsidian.capturarDaPastaParaMovimento(tx, orgId);
      if (sha(depois.captura) !== sha(nova.fisica.captura)) conflito();
      const audit = await this.audit.logComRecibo({ orgId, actorId, action: 'context.movement.confirm', entityType: 'context_item', entityId: i.itemId,
        metadata: { intentId: i.id, requestId: i.requestId, versionId: mudou.versao.id, selectionId: nova.c.selectionId, aliasId: alias.id } }, tx);
      const id = randomUUID(), criadoEm = new Date();
      const facts = { ...(await this.identidadeDoRecibo(tx, i, nova.prova, id, criadoEm, [...i.creationAuditIds, ...nova.c.auditIds, audit.id])),
        tipo: 'confirmado', nova: { versionId: mudou.versao.id, versao: mudou.versao.versao, contentHash: mudou.item.contentHash }, aliasId: alias.id,
        eventSnapshot: { id: mudou.evento.id, seq: mudou.evento.seq.toString(), hash: mudou.evento.hash, tipo: 'memoria.item.alterado' } };
      const recibo = await this.envelope(tx, MovimentoExplicitoReciboSchema, { ...facts, receiptHash: sha(facts) });
      await tx.contextMovementReceipt.create({ data: { id, orgId, actorId, itemId: i.itemId, intentId: i.id, requestId: i.requestId, tipo: 'confirmado',
        inputFingerprint: i.inputFingerprint, commitFingerprint, candidateId: nova.c.id, newSelectionId: nova.c.selectionId,
        newMemberId: nova.prova.membro.id, newVersionId: mudou.versao.id, newVersionNo: mudou.versao.versao, aliasId: alias.id,
        eventSnapshot: json(facts.eventSnapshot), auditIds: recibo.auditIds, receipt: json(recibo), receiptHash: recibo.receiptHash, criadoEm } });
      const fim = await tx.contextMovementIntent.updateMany({ where: { id: i.id, orgId, actorId, estado: 'pendente', revision: 1 },
        data: { estado: 'confirmado', revision: 2, terminalReceiptId: id, encerradoEm: criadoEm } });
      if (fim.count !== 1) conflito();
      return this.resultado(tx, { ...i, estado: 'confirmado', revision: 2, terminalReceiptId: id, encerradoEm: criadoEm }, false);
    });
  }

  private async identidadeDoRecibo(tx: Prisma.TransactionClient, i: ContextMovementIntent, candidate: Prova,
    id: string, criadoEm: Date, auditIds: string[]) {
    const p = await this.previaPersistida(tx, i);
    return { schemaVersion: 1 as const, id, orgId: i.orgId, actorId: i.actorId, itemId: i.itemId, intentId: i.id,
      requestId: i.requestId, criadoEm: criadoEm.toISOString(), origem: p.origem, destino: p.destino, escolhida: p.escolhida,
      anterior: { versionId: p.atual.versionId, versao: p.atual.versao, contentHash: p.atual.contentHash },
      oldSelection: p.oldSelection, candidate, auditIds };
  }

  private marcaCancelamento(i: ContextMovementIntent, atual: { id: string; versao: number; contentHash: string },
    prova: Prova, motivo: string): string {
    return sha({ intentFingerprint: i.inputFingerprint, currentItemVersion: atual.versao,
      currentVersionId: atual.id, currentContentHash: atual.contentHash, provaRetorno: prova, motivo });
  }

  async cancelamentoPrevia(orgId: string, actorId: string, requestId: string, body: unknown) {
    const p = MovimentoExplicitoCancelarPreviaSchema.parse(body);
    if (p.requestId !== requestId.toLowerCase()) conflito();
    return this.transacao(orgId, actorId, true, async (tx) => {
      const i = await this.intencao(tx, orgId, actorId, p.requestId);
      if (!i) throw new NotFoundException('Pedido não encontrado.');
      this.conferirPedido(i, p);
      if (i.estado !== 'pendente') conflito();
      const item = await this.item(tx, orgId, actorId, i.itemId), atual = await this.vigente(tx, item);
      if (item.versao !== p.currentItemVersion || item.chave !== i.originKey || item.sourceRef !== i.originSourceRef || item.arquivadoEm) conflito();
      const retorno = await this.capturar(tx, i, 'retorno');
      await this.resultado(tx, i, retorno.replayed);
      return this.envelope(tx, MovimentoExplicitoCancelamentoPreviaResultadoSchema, { escopo: { orgId, actorId },
        intentId: i.id, requestId: i.requestId, currentItemVersion: item.versao, intentMark: i.intentMarkHash,
        marcaCancelamento: this.marcaCancelamento(i, atual, retorno.prova, p.motivo), cancelSelection: retorno.prova,
        origemRestaurada: true, destinoAusente: true, motivo: p.motivo });
    });
  }

  async cancelar(orgId: string, actorId: string, requestId: string, body: unknown) {
    const p = MovimentoExplicitoCancelarSchema.parse(body);
    if (p.requestId !== requestId.toLowerCase()) conflito();
    return this.transacao(orgId, actorId, true, async (tx) => {
      const i = await this.intencao(tx, orgId, actorId, p.requestId);
      if (!i) throw new NotFoundException('Pedido não encontrado.');
      this.conferirPedido(i, p);
      const commitFingerprint = sha({ tipo: 'cancelar', intentFingerprint: i.inputFingerprint,
        currentItemVersion: p.currentItemVersion, marcaCancelamento: p.marcaCancelamento, provaRetorno: p.cancelSelection, motivo: p.motivo });
      if (i.estado !== 'pendente') return this.repetirTerminal(tx, i, 'cancelado', commitFingerprint);
      this.orcamento(await this.previaPersistida(tx, i), i.requestId);
      const item = await this.item(tx, orgId, actorId, i.itemId), atual = await this.vigente(tx, item);
      if (item.versao !== p.currentItemVersion || item.chave !== i.originKey || item.sourceRef !== i.originSourceRef || item.arquivadoEm) conflito();
      const retorno = await this.candidataAtual(tx, i, 'retorno', p.cancelSelection);
      if (this.marcaCancelamento(i, atual, retorno.prova, p.motivo) !== p.marcaCancelamento) conflito();
      await this.catalogo.projetarCapturaHumanaNoTx(tx, orgId, i.id, retorno.c.selectionId, retorno.fisica.captura);
      const nota = retorno.fisica.notas.find((n) => n.path === i.originSourceRef);
      if (!nota) conflito();
      const indice = await tx.knowledgeNote.updateMany({ where: { orgId, path: i.originSourceRef, content: item.body, title: item.title },
        data: { folder: nota.folder, fileTime: nota.fileTime } });
      if (indice.count !== 1) conflito();
      const depois = await this.obsidian.capturarDaPastaParaMovimento(tx, orgId);
      if (sha(depois.captura) !== sha(retorno.fisica.captura)) conflito();
      const audit = await this.audit.logComRecibo({ orgId, actorId, action: 'context.movement.cancel', entityType: 'context_item', entityId: i.itemId,
        metadata: { intentId: i.id, requestId: i.requestId, versionId: atual.id, selectionId: retorno.c.selectionId } }, tx);
      const id = randomUUID(), criadoEm = new Date();
      const facts = { ...(await this.identidadeDoRecibo(tx, i, retorno.prova, id, criadoEm, [...i.creationAuditIds, ...retorno.c.auditIds, audit.id])),
        tipo: 'cancelado', currentItemVersion: item.versao, retorno: { versionId: atual.id, versao: atual.versao, contentHash: atual.contentHash },
        motivo: p.motivo, marcaCancelamento: p.marcaCancelamento };
      const recibo = await this.envelope(tx, MovimentoExplicitoReciboSchema, { ...facts, receiptHash: sha(facts) });
      await tx.contextMovementReceipt.create({ data: { id, orgId, actorId, itemId: i.itemId, intentId: i.id, requestId: i.requestId, tipo: 'cancelado',
        inputFingerprint: i.inputFingerprint, commitFingerprint, candidateId: retorno.c.id, cancelSelectionId: retorno.c.selectionId,
        cancelMemberId: retorno.prova.membro.id, cancelVersionId: atual.id, cancelVersionNo: atual.versao, cancelContentHash: atual.contentHash,
        auditIds: recibo.auditIds, receipt: json(recibo), receiptHash: recibo.receiptHash, criadoEm } });
      const fim = await tx.contextMovementIntent.updateMany({ where: { id: i.id, orgId, actorId, estado: 'pendente', revision: 1 },
        data: { estado: 'cancelado', revision: 2, terminalReceiptId: id, encerradoEm: criadoEm } });
      if (fim.count !== 1) conflito();
      const reserva = await tx.contextKeyClaim.deleteMany({ where: { orgId, itemId: i.itemId, intentId: i.id,
        key: i.destinationKey, tipo: 'reserved_target' } });
      if (reserva.count !== 1) conflito();
      return this.resultado(tx, { ...i, estado: 'cancelado', revision: 2, terminalReceiptId: id, encerradoEm: criadoEm }, false);
    });
  }

  async alias(orgId: string, actorId: string, query: unknown) {
    const p = AliasDoContextoConsultaSchema.parse(query);
    return this.transacao(orgId, actorId, false, async (tx) => {
      const item = await this.item(tx, orgId, actorId, p.itemId);
      await this.vigente(tx, item);
      const alias = await tx.contextAlias.findFirst({ where: { orgId, itemId: item.id, collectionId: COLECAO, aliasKey: p.chave } });
      if (!alias) throw new NotFoundException('Alias não encontrado para esta fonte.');
      const claim = await tx.contextKeyClaim.findFirst({ where: { id: alias.claimId, orgId, itemId: item.id, key: p.chave, tipo: 'alias', intentId: alias.intentId } });
      if (!claim || item.chave.length > 1400) conflito();
      const movimentoPendente = await consultaMovimentoPendente(tx, orgId, item.id);
      return this.envelope(tx, AliasDoContextoSchema, { escopo: { orgId, actorId }, aliasId: alias.id, intentId: alias.intentId,
        itemId: item.id, collectionId: COLECAO, chaveConsultada: p.chave, chaveCanonicaAtual: item.chave,
        disponibilidadeAtual: { itemId: item.id, versao: item.versao, chaveAtual: item.chave, arquivada: !!item.arquivadoEm,
          movimentoPendente, novoUsoPermitido: !item.arquivadoEm && !movimentoPendente } });
    });
  }
}

// Orçamento privado de bytes; slots não são fatos, IDs ou documentos para persistência.
type Medida = { compacto: number; jsonbTexto: number };
const LIMITE = 65_536;
const UTF8 = new TextEncoder();
const escalar = (bytes: number): Medida => ({ compacto: bytes, jsonbTexto: bytes });
const stringMaxima = (unidadesUTF16: number): Medida => escalar(6 * unidadesUTF16 + 2);
const stringAscii = (caracteres: number): Medida => escalar(caracteres + 2);
const numeroInt32Positivo = (): Medida => escalar(10);
const slotUuid = (): Medida => stringAscii(36);
const slotSha = (): Medida => stringAscii(64);
const slotGit = (): Medida => stringAscii(40);
const bigintDecimal = (): Medida => stringAscii(19);
const dataISO = (): Medida => stringAscii(27); // limite ISO de Date; produtores usam Date.toISOString()
const booleano = (): Medida => escalar(5); // false é o maior literal

function objeto(campos: Record<string, Medida>): Medida {
  const entradas = Object.entries(campos);
  const separadores = Math.max(0, entradas.length - 1);
  const chaves = entradas.reduce((n, [chave]) => n + UTF8.encode(JSON.stringify(chave)).byteLength + 1, 0);
  return {
    compacto: 2 + separadores + chaves + entradas.reduce((n, [, v]) => n + v.compacto, 0),
    // jsonb::text adiciona um espaço após ':' e ','. Ordem das chaves não muda o tamanho.
    jsonbTexto: 2 + 2 * separadores + chaves + entradas.length + entradas.reduce((n, [, v]) => n + v.jsonbTexto, 0),
  };
}
function lista(valores: Medida[]): Medida {
  const separadores = Math.max(0, valores.length - 1);
  return {
    compacto: 2 + separadores + valores.reduce((n, v) => n + v.compacto, 0),
    jsonbTexto: 2 + 2 * separadores + valores.reduce((n, v) => n + v.jsonbTexto, 0),
  };
}
function real(valor: unknown): Medida {
  if (valor === null || typeof valor === 'boolean' || typeof valor === 'string')
    return escalar(UTF8.encode(JSON.stringify(valor)).byteLength);
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    // Não supõe a notação científica do PostgreSQL: 327 bytes cobrem double finito
    // expandido, inclusive expoentes negativos extremos. É sobreorçamento, não dado.
    return escalar(Math.max(UTF8.encode(JSON.stringify(valor)).byteLength, 327));
  }
  if (Array.isArray(valor)) return lista(valor.map(real));
  if (typeof valor === 'object' && valor !== null)
    return objeto(Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, real(v)])));
  throw new TypeError('Valor sem representação JSON no orçamento do movimento.');
}

function orcarEnvelopesDoMovimento(
  previa: MovimentoExplicitoPreviaResultado, requestId: string,
): { limite: 65536; envelopes: Record<string, Medida>; maior: number; cabe: boolean } {
  // A entrada é a prévia real integral, validada e reconferida na TX de admissão.
  const p = MovimentoExplicitoPreviaResultadoSchema.parse(previa);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId))
    throw new TypeError('Pedido inválido para o orçamento do movimento.');
  const escopo = real(p.escopo);
  const referenciaFutura = objeto({ versionId: slotUuid(), versao: numeroInt32Positivo(), contentHash: slotSha() });
  const disponibilidade = objeto({
    itemId: real(p.itemId), versao: numeroInt32Positivo(), chaveAtual: stringMaxima(1400),
    arquivada: booleano(), movimentoPendente: booleano(), novoUsoPermitido: booleano(),
  });
  const marcaFutura = objeto({ repositorioId: slotSha(), head: slotGit(), indiceHash: slotSha(), indiceModificadoEm: escalar(327) });
  const candidata = (origem: MovimentoExplicitoPreviaResultado['origem']): Medida => objeto({
    id: slotUuid(), colecaoId: real(p.colecaoId), geracao: bigintDecimal(), membershipDigest: slotSha(), marca: marcaFutura,
    membro: objeto({ id: slotUuid(), chave: real(origem.chave), caminho: real(origem.caminho),
      blobGit: slotGit(), hashArquivo: slotSha(), contentHash: slotSha(), metadataHash: slotSha() }),
    candidateId: slotUuid(), captureMarkHash: slotSha(),
  });
  const movimento = candidata(p.destino), retorno = candidata(p.origem);
  const identidade = (candidate: Medida): Record<string, Medida> => ({
    schemaVersion: real(1), id: slotUuid(), orgId: real(p.escopo.orgId), actorId: real(p.escopo.actorId),
    itemId: real(p.itemId), intentId: slotUuid(), requestId: real(requestId), criadoEm: dataISO(),
    origem: real(p.origem), destino: real(p.destino), escolhida: real(p.escolhida), anterior: real({
      versionId: p.atual.versionId, versao: p.atual.versao, contentHash: p.atual.contentHash,
    }), oldSelection: real(p.oldSelection), candidate,
    auditIds: lista(Array.from({ length: 32 }, slotUuid)), receiptHash: slotSha(),
  });
  const reciboConfirmado = objeto({ ...identidade(movimento), tipo: real('confirmado'), nova: referenciaFutura,
    aliasId: slotUuid(), eventSnapshot: objeto({ id: slotUuid(), seq: bigintDecimal(), hash: slotSha(), tipo: real('memoria.item.alterado') }) });
  const reciboCancelado = objeto({ ...identidade(retorno), tipo: real('cancelado'), currentItemVersion: numeroInt32Positivo(),
    retorno: referenciaFutura, motivo: stringMaxima(1000), marcaCancelamento: slotSha() });
  const envelopes: Record<string, Medida> = {
    pendenteERecuperacao: objeto({ estado: real('pendente_de_captura_verificada'), escopo,
      intencao: objeto({ id: slotUuid(), requestId: real(requestId), itemId: real(p.itemId), revision: real(1),
        intentMark: slotSha(), previa: real(p), criadaEm: dataISO() }),
      candidatos: lista([
        objeto({ id: slotUuid(), purpose: real('movimento'), prova: movimento, atual: booleano(), capturadaEm: dataISO() }),
        objeto({ id: slotUuid(), purpose: real('retorno'), prova: retorno, atual: booleano(), capturadaEm: dataISO() }),
      ]), historicoDeCandidatos: objeto({ modo: real('ultimo_por_proposito'), total: bigintDecimal(), parcial: booleano() }),
      disponibilidadeAtual: disponibilidade, replayed: booleano(),
    }),
    confirmadoERecuperacao: objeto({ estado: real('confirmado'), escopo, recibo: reciboConfirmado,
      disponibilidadeAtual: disponibilidade, replayed: booleano() }),
    canceladoERecuperacao: objeto({ estado: real('cancelado'), escopo, recibo: reciboCancelado,
      disponibilidadeAtual: disponibilidade, replayed: booleano() }),
    previaDeRetorno: objeto({ escopo, intentId: slotUuid(), requestId: real(requestId), currentItemVersion: numeroInt32Positivo(),
      intentMark: slotSha(), marcaCancelamento: slotSha(), cancelSelection: retorno,
      origemRestaurada: real(true), destinoAusente: real(true), motivo: stringMaxima(1000) }),
    reciboConfirmado, reciboCancelado,
    ausenciaConferida: objeto({ estado: real('ausencia_conferida'), escopo, requestId: real(requestId) }),
  };
  const maior = Math.max(...Object.values(envelopes).flatMap((v) => [v.compacto, v.jsonbTexto]));
  return { limite: LIMITE, envelopes, maior, cabe: maior <= LIMITE };
}
