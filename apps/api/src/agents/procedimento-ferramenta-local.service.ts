import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type Agent, type AgentLocalToolReceipt, type ContextItem, type ContextItemVersion, type Sop } from '@prisma/client';
import { z } from 'zod';
import {
  ProcedimentoFerramentaLocalConfiguracaoSchema, ProcedimentoFerramentaLocalConfiguracaoResultadoSchema,
  ProcedimentoFerramentaLocalPainelSchema, ProcedimentoFerramentaLocalPedidoSchema, ProcedimentoFerramentaLocalPerfilSchema,
  ProcedimentoFerramentaLocalReciboSchema, ProcedimentoFerramentaLocalRecuperacaoSchema, ProcedimentoFerramentaLocalResultadoSchema,
  textoCanonicoDaFerramentaLocal, type ProcedimentoFerramentaLocalPedido, type ProcedimentoFerramentaLocalPerfil,
  type ProcedimentoFerramentaLocalPainel, type ProcedimentoFerramentaLocalRecibo,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { contextoAtual } from '../common/contexto-execucao';
import { exigirAcessoAtual, filtroDeLeitura } from '../memory/acesso-memoria';
import { chaveDaVault, hashDoCorpo } from '../memory/procedencia';
import { consultaMovimentoPendente, exigirNovoUsoSemMovimentoPendente } from '../memory/contexto-movimento-namespace';
import { hashMetadata } from '../obsidian/catalogo-de-colecao.service';
import { TEMAS_DA_CARGA, chaveDoTema, SLUG_DO_CARREGADOR } from './roster/carregador-de-contexto';
import { buscarLiteralNaVersao } from './ferramenta-memoria-local';

const GATES = { LER: ['mcp.ver', 'obsidian.ver'], EXEC: ['mcp.ver', 'mcp.executar', 'admin.usuarios', 'obsidian.ver'],
  CONFIG: ['automacoes.executar', 'admin.usuarios'] };
type Gate = keyof typeof GATES;
type Scope = { orgId: string; actorId: string; agentId: string; agentSlug: string };
type Agente = Agent & { sop: Sop | null };
type MetaItem = Pick<ContextItem, 'id' | 'orgId' | 'chave' | 'kind' | 'title' | 'tags' | 'sourceType' | 'sourceRef'
  | 'validFrom' | 'validUntil' | 'acessoRestrito' | 'leitores' | 'versao' | 'arquivadoEm' | 'contentHash'>;
type MetaVersao = Pick<ContextItemVersion, 'id' | 'orgId' | 'itemId' | 'versao' | 'kind' | 'title' | 'sourceType' | 'sourceRef' | 'contentHash' | 'autorTipo' | 'autorId'>;
const metaItem = { id: true, orgId: true, chave: true, kind: true, title: true, tags: true, sourceType: true, sourceRef: true,
  validFrom: true, validUntil: true, acessoRestrito: true, leitores: true,
  versao: true, arquivadoEm: true, contentHash: true } as const;
const metaVersao = { id: true, orgId: true, itemId: true, versao: true, kind: true, title: true,
  sourceType: true, sourceRef: true, contentHash: true, autorTipo: true, autorId: true } as const;
const SHA = /^[a-f0-9]{64}$/;
const hash = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const json = (v: unknown): Prisma.InputJsonValue => {
  const texto = JSON.stringify(v);
  if (texto === undefined) throw new ConflictException('O registro não pôde ser conferido.');
  return JSON.parse(texto);
};
const marcaSchema = z.object({ repositorioId: z.string().regex(SHA), head: z.string().regex(/^[a-f0-9]{40}$/),
  indiceHash: z.string().regex(SHA), indiceModificadoEm: z.number().finite() }).strict();
const metadataSchema = z.object({ title: z.string(), kind: z.string(), tags: z.array(z.string()),
  validFrom: z.string().datetime().nullable(), validUntil: z.string().datetime().nullable(), sourceRef: z.string() }).strict();
const fonteIndisponivel = () => new NotFoundException('Fonte indisponível para esta conta.');
const falha = () => new ConflictException('O pedido não pôde ser conferido.');

// Somente uma árvore privada de bytes. Reservas não são IDs, versões ou resultados reais.
type Arvore = { bytes: number } | { campos: Record<string, Arvore> } | { itens: Arvore[] };
function folha(v: unknown): Arvore {
  if (Array.isArray(v)) return { itens: v.map(folha) };
  if (v !== null && typeof v === 'object') return { campos: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, folha(x)])) };
  const texto = JSON.stringify(v);
  if (texto === undefined) throw falha();
  return { bytes: Buffer.byteLength(texto, 'utf8') };
}
function medir(a: Arvore): number {
  if ('bytes' in a) return a.bytes;
  if ('itens' in a) return 2 + a.itens.reduce<number>((n, x) => n + medir(x) + 2, 0);
  return 2 + Object.entries(a.campos).reduce((n, [k, x]) => n + Buffer.byteLength(JSON.stringify(k), 'utf8') + 2 + medir(x) + 2, 0);
}
function orcamento(a: Arvore) {
  if (medir(a) > 65536) throw new BadRequestException('O registro ultrapassa 64 KiB. Reduza os textos antes de enviar.');
}

@Injectable()
export class ProcedimentoFerramentaLocalService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private scope(orgId: string, actorId: string, a: Agent): Scope { return { orgId, actorId, agentId: a.id, agentSlug: a.slug }; }
  private perfil(sop: Sop | null): ProcedimentoFerramentaLocalPerfil | null {
    if (!sop || sop.ferramentaLocal === null) return null;
    const p = ProcedimentoFerramentaLocalPerfilSchema.safeParse(sop.ferramentaLocal);
    if (!p.success) throw falha();
    return p.data;
  }
  private configHash(p: ProcedimentoFerramentaLocalPerfil | null): string | null { return p ? hash(JSON.stringify(p)) : null; }

  private async autoridadeNoTx(tx: Prisma.TransactionClient, orgId: string, actorId: string, gate: Gate): Promise<Set<string>> {
    const ctx = contextoAtual();
    if (!ctx || ctx.actorType !== 'user' || ctx.orgId !== orgId || ctx.actorId !== actorId) throw new ForbiddenException('Acesso insuficiente.');
    const orgs = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Org" WHERE id=${orgId} AND "isActive" FOR SHARE`;
    const users = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "User" WHERE id=${actorId} AND "orgId"=${orgId} AND "isActive" FOR SHARE`;
    if (orgs.length !== 1 || users.length !== 1) throw new ForbiddenException('Acesso insuficiente.');
    const joins = await tx.$queryRaw<Array<{ roleId: string }>>`SELECT ur."A" AS "roleId" FROM "_UserRoles" ur JOIN "Role" r ON r.id=ur."A"
      WHERE ur."B"=${actorId} AND r."orgId"=${orgId} ORDER BY ur."A",ur."B" FOR SHARE OF ur`;
    const roles = [...new Set(joins.map((r) => r.roleId))].sort();
    if (!roles.length) throw new ForbiddenException('Acesso insuficiente.');
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Role" WHERE "orgId"=${orgId} AND id IN (${Prisma.join(roles)}) ORDER BY id FOR SHARE`;
    const grants = await tx.$queryRaw<Array<{ permissionId: string }>>`SELECT rp."A" AS "permissionId" FROM "_RolePermissions" rp
      WHERE rp."B" IN (${Prisma.join(roles)}) ORDER BY rp."B",rp."A" FOR SHARE OF rp`;
    const ids = [...new Set(grants.map((g) => g.permissionId))].sort();
    if (locked.length !== roles.length || !ids.length) throw new ForbiddenException('Acesso insuficiente.');
    const permissions = await tx.$queryRaw<Array<{ id: string; key: string }>>`SELECT id,key FROM "Permission" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`;
    const keys = new Set(permissions.map((p) => p.key));
    if (permissions.length !== ids.length || !GATES[gate].every((p) => keys.has(p))) throw new ForbiddenException('Acesso insuficiente.');
    await exigirAcessoAtual(tx, orgId, actorId, GATES[gate]);
    return keys;
  }
  private async agenteNoTx(tx: Prisma.TransactionClient, orgId: string, slug: string, escrita: boolean): Promise<Agente> {
    if (escrita) await tx.$queryRaw`SELECT id FROM "Agent" WHERE "orgId"=${orgId} AND slug=${slug} FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM "Agent" WHERE "orgId"=${orgId} AND slug=${slug} FOR SHARE`;
    const id = await tx.agent.findFirst({ where: { orgId, slug }, select: { id: true } });
    if (!id) throw new NotFoundException('Agente indisponível.');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agent-sop:${orgId}:${id.id}`}))`;
    await tx.$queryRaw`SELECT id FROM "Sop" WHERE "orgId"=${orgId} AND "agentId"=${id.id} FOR SHARE`;
    const a = await tx.agent.findFirst({ where: { id: id.id, orgId, slug }, include: { sop: true } });
    if (!a || a.sop && (a.sop.orgId !== orgId || a.sop.agentId !== a.id || a.sop.versao < 1)) throw falha();
    return a;
  }
  private async donoNoTx(tx: Prisma.TransactionClient, orgId: string, a: Agent) {
    if (!a.donoId) return false;
    await tx.$queryRaw`SELECT id FROM "User" WHERE "orgId"=${orgId} AND id=${a.donoId} FOR SHARE`;
    return !!await tx.user.findFirst({ where: { id: a.donoId, orgId, isActive: true }, select: { id: true } });
  }
  private async tamanhoNoTx(tx: Prisma.TransactionClient, valor: unknown) {
    const texto = JSON.stringify(valor);
    if (Buffer.byteLength(texto, 'utf8') > 65536) throw new BadRequestException('O registro ultrapassa 64 KiB.');
    const rows = await tx.$queryRaw<Array<{ bytes: number }>>`SELECT octet_length(${texto}::jsonb::text)::int AS bytes`;
    if (rows.length !== 1 || rows[0].bytes > 65536) throw new BadRequestException('O registro ultrapassa 64 KiB.');
  }
  async painel(orgId: string, actorId: string, slug: string): Promise<ProcedimentoFerramentaLocalPainel> {
    await exigirAcessoAtual(this.prisma, orgId, actorId, GATES.LER);
    return this.prisma.$transaction(async (tx) => {
      const a = await this.agenteNoTx(tx, orgId, slug, false);
      const keys = await this.autoridadeNoTx(tx, orgId, actorId, 'LER');
      const p = this.perfil(a.sop); const dono = await this.donoNoTx(tx, orgId, a);
      const impedimentos: string[] = [];
      if (!GATES.EXEC.every((k) => keys.has(k))) impedimentos.push('Acesso insuficiente para executar.');
      if (!a.ativo || a.estado !== 'ativo') impedimentos.push('O agente precisa estar ativo.');
      if (!dono) impedimentos.push('Responsável indisponível nesta empresa.');
      if (!p) impedimentos.push('Configure a busca no procedimento existente.');
      if (a.capacidades.length !== 1 || a.capacidades[0] !== 'contexto.memoria.buscar') impedimentos.push('O agente não declara somente esta ferramenta.');
      const result = ProcedimentoFerramentaLocalPainelSchema.parse({ escopo: this.scope(orgId, actorId, a),
        autoridade: { ler: true, executar: GATES.EXEC.every((k) => keys.has(k)), configurar: GATES.CONFIG.every((k) => keys.has(k)), verificadaEm: new Date().toISOString() },
        agente: { estado: a.estado, ativo: a.ativo, responsavelDisponivel: dono, capacidades: a.capacidades, modeloConfigurado: a.modelo },
        sop: a.sop ? { id: a.sop.id, versao: a.sop.versao, config: p, configHash: this.configHash(p) } : null,
        executor: { capacidade: 'contexto.memoria.buscar', modo: 'literal_versao_escolhida_v1', modeloChamado: false, agendamento: false,
          fonte: 'uma_versao_persistida_escolhida', maxFonteBytes: 262144 }, inicioLocal: { permitido: !impedimentos.length, impedimentosLocais: impedimentos } });
      await this.tamanhoNoTx(tx, result); await exigirAcessoAtual(tx, orgId, actorId, GATES.LER); return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async configurar(orgId: string, actorId: string, slug: string, entrada: unknown) {
    const input = ProcedimentoFerramentaLocalConfiguracaoSchema.parse(entrada);
    await exigirAcessoAtual(this.prisma, orgId, actorId, GATES.CONFIG);
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`memoria:${orgId}`}))`;
      const a = await this.agenteNoTx(tx, orgId, slug, true); await this.autoridadeNoTx(tx, orgId, actorId, 'CONFIG');
      if (!await this.donoNoTx(tx, orgId, a)) throw new ConflictException('Responsável indisponível nesta empresa.');
      const current = this.perfil(a.sop);
      if (!a.sop || a.sop.versao !== input.expectedSopVersion || this.configHash(current) !== input.expectedConfigHash) throw new ConflictException('O procedimento mudou. Confira a base antes de salvar.');
      orcamento({ campos: { escopo: folha(this.scope(orgId, actorId, a)), sopId: { bytes: 38 }, versao: { bytes: 16 },
        config: folha(input.config), configHash: { bytes: 66 }, auditId: { bytes: 38 }, comprometidaEm: { bytes: 26 }, reciboCausal: { bytes: 5 } } });
      const updated = await tx.sop.updateMany({ where: { id: a.sop.id, orgId, agentId: a.id, versao: input.expectedSopVersion },
        data: { ferramentaLocal: input.config === null ? Prisma.DbNull : json(input.config), versao: { increment: 1 }, atualizadoPor: actorId } });
      if (updated.count !== 1) throw new ConflictException('O procedimento mudou.');
      const after = await tx.sop.findFirst({ where: { id: a.sop.id, orgId, agentId: a.id } });
      if (!after || after.versao !== input.expectedSopVersion + 1 || after.atualizadoPor !== actorId || JSON.stringify(this.perfil(after)) !== JSON.stringify(input.config)) throw falha();
      const audit = await this.audit.logComRecibo({ orgId, actorId, action: 'agent.procedimento_ferramenta_local.configure', entityType: 'sop', entityId: after.id,
        metadata: { versaoAnterior: input.expectedSopVersion, versaoNova: after.versao, configurada: input.config !== null } }, tx);
      const dto = ProcedimentoFerramentaLocalConfiguracaoResultadoSchema.parse({ escopo: this.scope(orgId, actorId, a), sopId: after.id,
        versao: after.versao, config: input.config, configHash: this.configHash(input.config), auditId: audit.id, comprometidaEm: new Date().toISOString(), reciboCausal: false });
      await this.tamanhoNoTx(tx, dto); await exigirAcessoAtual(tx, orgId, actorId, GATES.CONFIG); return dto;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    await exigirAcessoAtual(this.prisma, orgId, actorId, GATES.CONFIG); return result;
  }

  private async lockRequest(tx: Prisma.TransactionClient, orgId: string, requestId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`procedimento:${orgId}:${requestId}`}))`;
  }
  private async lookup(tx: Prisma.TransactionClient, orgId: string, requestId: string) {
    const receipt = await tx.agentLocalToolReceipt.findFirst({ where: { orgId, requestId } });
    const operation = await tx.agentLocalOperation.findFirst({ where: { orgId, requestId }, select: { id: true } });
    const sessions = await tx.session.findMany({ where: { orgId, canal: 'web', canalRef: `procedimento-local:${requestId}` }, take: 2,
      select: { id: true, agentId: true, solicitanteId: true } });
    if (operation || sessions.length > 1 || receipt && (sessions.length !== 1 || sessions[0].id !== receipt.sessionId
      || sessions[0].agentId !== receipt.agentId || sessions[0].solicitanteId !== receipt.actorId) || !receipt && sessions.length) throw falha();
    return receipt;
  }
  private conferirAtor(row: AgentLocalToolReceipt, scope: Scope) {
    if (row.orgId !== scope.orgId || row.actorId !== scope.actorId || row.agentId !== scope.agentId || row.agentSlug !== scope.agentSlug) throw falha();
  }
  private async metadadosNoTx(tx: Prisma.TransactionClient, scope: Scope, input: ProcedimentoFerramentaLocalPedido, historico: boolean) {
    const item = await tx.contextItem.findFirst({ where: { orgId: scope.orgId, id: input.itemId, ...filtroDeLeitura(scope.actorId) }, select: metaItem });
    if (!item) throw fonteIndisponivel();
    const v = await tx.contextItemVersion.findFirst({ where: { id: input.versionId, orgId: scope.orgId, itemId: item.id }, select: metaVersao });
    const max = await tx.contextItemVersion.aggregate({ where: { orgId: scope.orgId, itemId: item.id }, _max: { versao: true }, _count: true });
    if (!v || v.contentHash !== input.contentHash || v.versao > item.versao || max._max.versao !== item.versao || max._count !== item.versao) throw falha();
    if (!historico && (item.arquivadoEm || item.versao !== input.expectedItemVersion || item.sourceType !== v.sourceType || item.sourceRef !== v.sourceRef))
      throw new ConflictException('A fonte mudou. Confira a versão antes de executar.');
    if (!historico) await exigirNovoUsoSemMovimentoPendente(tx, scope.orgId, item.id);
    return { item, v };
  }
  private async conferirVaultNoTx(tx: Prisma.TransactionClient, scope: Scope, item: MetaItem, v: MetaVersao, historico: boolean) {
    if (!v.sourceRef || !await tx.org.findFirst({ where: { id: scope.orgId, slug: 'root' }, select: { id: true } })) throw new ConflictException('Esta fonte não tem comprovação local.');
    const members = await tx.contextCollectionMember.findMany({ where: { orgId: scope.orgId, itemId: item.id, versionId: v.id, versao: v.versao,
      estado: 'projetado', selection: { orgId: scope.orgId, collectionId: 'vault:root-base', sourceKind: 'vault_pasta', estado: 'projetado' } }, include: { selection: true },
      orderBy: [{ selection: { generation: 'asc' } }, { id: 'asc' }] });
    if (!members.length) throw new ConflictException('Esta versão não tem comprovação local.');
    for (const m of members) {
      await tx.$queryRaw`SELECT id FROM "ContextCollectionSelection" WHERE id=${m.selectionId} AND "orgId"=${scope.orgId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "ContextCollectionMember" WHERE id=${m.id} AND "orgId"=${scope.orgId} FOR SHARE`;
      const md = metadataSchema.safeParse(m.metadata); const before = marcaSchema.safeParse(m.selection.marcaAntes); const after = marcaSchema.safeParse(m.selection.marcaDepois);
      const path = Buffer.from(m.caminhoBytes); const utf8 = path.toString('utf8');
      if (!md.success || !before.success || !after.success || JSON.stringify(before.data) !== JSON.stringify(after.data)
        || !m.selection.membershipDigest || !SHA.test(m.selection.membershipDigest) || !Buffer.from(utf8).equals(path) || utf8 !== utf8.normalize('NFC')
        || utf8 !== v.sourceRef || m.chave !== chaveDaVault(v.sourceRef) || !/^[a-f0-9]{40}$/.test(m.blobGit) || !SHA.test(m.hashArquivo)
        || m.contentHash !== v.contentHash || hashMetadata(md.data) !== m.metadataHash || md.data.sourceRef !== v.sourceRef || md.data.title !== v.title || md.data.kind !== v.kind) throw falha();
    }
    if (historico) return;
    const latest = await tx.contextCollectionSelection.findFirst({ where: { orgId: scope.orgId, collectionId: 'vault:root-base' }, orderBy: { generation: 'desc' } });
    if (!latest || latest.estado !== 'projetado' || latest.sourceKind !== 'vault_pasta') throw new ConflictException('A coleção local não está disponível para novo uso.');
    await tx.$queryRaw`SELECT id FROM "ContextCollectionSelection" WHERE id=${latest.id} AND "orgId"=${scope.orgId} FOR SHARE`;
    const all = await tx.contextCollectionMember.findMany({ where: { orgId: scope.orgId, selectionId: latest.id }, orderBy: { caminhoBytes: 'asc' } });
    const current = all.filter((m) => m.itemId === item.id && m.versao === item.versao && m.estado === 'projetado');
    if (current.length !== 1 || !current[0].versionId || item.sourceRef === null || item.chave !== chaveDaVault(item.sourceRef)) throw falha();
    await tx.$queryRaw`SELECT id FROM "ContextCollectionMember" WHERE "orgId"=${scope.orgId} AND "selectionId"=${latest.id} ORDER BY id FOR SHARE`;
    const digest = hash(JSON.stringify(all.map((m) => ({ chave: m.chave, caminhoBytes: Buffer.from(m.caminhoBytes).toString('hex'), blobGit: m.blobGit,
      hashArquivo: m.hashArquivo, contentHash: m.contentHash, metadataHash: m.metadataHash }))));
    const md = metadataSchema.safeParse(current[0].metadata); const b = marcaSchema.safeParse(latest.marcaAntes); const a = marcaSchema.safeParse(latest.marcaDepois);
    const actual = await tx.contextItemVersion.findFirst({ where: { id: current[0].versionId, orgId: scope.orgId, itemId: item.id, versao: item.versao }, select: metaVersao });
    if (!md.success || !b.success || !a.success || JSON.stringify(b.data) !== JSON.stringify(a.data) || digest !== latest.membershipDigest || !actual
      || actual.contentHash !== item.contentHash || current[0].contentHash !== item.contentHash || current[0].chave !== item.chave
      || md.data.title !== item.title || md.data.kind !== item.kind || JSON.stringify([...md.data.tags].sort()) !== JSON.stringify([...item.tags].sort())
      || md.data.sourceRef !== item.sourceRef || md.data.validFrom !== (item.validFrom?.toISOString() ?? null) || md.data.validUntil !== (item.validUntil?.toISOString() ?? null)
      || hashMetadata(md.data) !== current[0].metadataHash) throw falha();
  }
  private async localNoTx(tx: Prisma.TransactionClient, scope: Scope, item: MetaItem, v: MetaVersao, historico: boolean): Promise<'manual_local' | 'vault_canonica'> {
    if (v.sourceType === 'operador') {
      const tema = TEMAS_DA_CARGA.find((t) => item.chave === chaveDoTema(t.id) && v.sourceRef === `${SLUG_DO_CARREGADOR}:${t.id}`);
      const key = item.chave.normalize('NFC').trim().toLowerCase();
      if (v.autorTipo !== 'user' || !v.autorId || !await tx.user.findFirst({ where: { id: v.autorId, orgId: scope.orgId }, select: { id: true } })
        || v.sourceRef !== null && !tema || /^(vault:|drive:|clickup:|conector:)/.test(key)) throw new ConflictException('Esta origem não tem comprovação manual local.');
      if (!historico && item.sourceType !== 'operador') throw falha();
      return 'manual_local';
    }
    if (v.sourceType === 'vault') { await this.conferirVaultNoTx(tx, scope, item, v, historico); return 'vault_canonica'; }
    throw new ConflictException('Esta origem não é elegível para a busca local.');
  }
  private snapshot(item: MetaItem, v: MetaVersao, colecao: 'manual_local' | 'vault_canonica', chave = item.chave) {
    return { itemId: item.id, versionId: v.id, versao: v.versao, contentHash: v.contentHash, chave,
      sourceType: v.sourceType, sourceRef: v.sourceRef, title: v.title, colecao };
  }
  private preflight(scope: Scope, input: ProcedimentoFerramentaLocalPedido, sop: ProcedimentoFerramentaLocalRecibo['sop'], source: ProcedimentoFerramentaLocalRecibo['fonteEscolhida']) {
    if (Array.from(source.chave).length > 1400) throw new BadRequestException('A chave da fonte ultrapassa o limite do envelope.');
    const slots = (bytes: number): Arvore => ({ bytes });
    const result: Arvore = { campos: { modo: folha('literal_versao_escolhida_v1'), itemId: folha(input.itemId), versionId: folha(input.versionId), versao: slots(16),
      contentHash: folha(input.contentHash), q: folha(input.q), limit: folha(input.limit), totalLinhasComCorrespondencia: slots(16), parcial: slots(5), observadaEm: slots(26),
      correspondencias: { itens: Array.from({ length: input.limit }, () => ({ campos: { linha: slots(16), trecho: slots(1802), corteInicio: slots(5), corteFim: slots(5) } })) } } };
    const comum: Record<string, Arvore> = { schemaVersion: folha(1), tipo: folha('procedimento_ferramenta_local'), entradaContrato: folha(3), id: slots(38), escopo: folha(scope),
      requestId: folha(input.requestId), sessionId: slots(38), entrada: folha(input), inputFingerprint: slots(66), inputCanonico: folha(textoCanonicoDaFerramentaLocal(scope, input)),
      sop: folha(sop), fonteEscolhida: folha(source), passoPedidoId: slots(38), passoFinalId: slots(38), auditIds: { itens: [slots(38)] },
      consumoModelo: folha({ origem: 'nenhuma_chamada_de_modelo', provider: null, modeloUsado: null, tokensIn: null, tokensOut: null, custoExternoUsd: 0, custoMaquinaMedido: false }),
      criadaEm: slots(26), encerradaEm: slots(26) };
    const executed: Arvore = { campos: { ...comum, status: folha('executada'), ferramentaChamada: folha(true), motivoCode: folha(null), fonteConsumida: folha(source), resultado: result, resultHash: slots(66) } };
    const refused: Arvore = { campos: { ...comum, status: folha('recusada'), ferramentaChamada: folha(false), motivoCode: folha('responsavel_indisponivel'), fonteConsumida: folha(null), resultado: folha(null), resultHash: folha(null) } };
    const disponibilidade: Arvore = { campos: { sopVersaoAtual: slots(16), configHashAtual: slots(66), estadoAgenteAtual: folha('planejado'),
      fonte: { campos: { versaoAtual: slots(16), arquivada: slots(5), novoUsoPermitido: slots(5), chaveAtual: slots(1400 * 6 + 2) } }, verificadaEm: slots(26) } };
    for (const recibo of [executed, refused]) { orcamento(recibo); orcamento({ campos: { estado: folha('confirmado'), escopo: folha(scope), requestId: folha(input.requestId), recibo, disponibilidadeAtual: disponibilidade } }); }
    orcamento(result); orcamento({ campos: { estado: folha('ausencia_conferida'), escopo: folha(scope), requestId: folha(input.requestId), mantemId: folha(true), cancelaPostTardio: folha(false) } });
  }

  async executar(orgId: string, actorId: string, slug: string, entrada: unknown): Promise<ProcedimentoFerramentaLocalRecibo> {
    const input = ProcedimentoFerramentaLocalPedidoSchema.parse(entrada);
    await exigirAcessoAtual(this.prisma, orgId, actorId, GATES.EXEC);
    await this.prisma.$transaction(async (tx) => {
      await this.lockRequest(tx, orgId, input.requestId); const prior = await this.lookup(tx, orgId, input.requestId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`memoria:${orgId}`}))`;
      const agent = await this.agenteNoTx(tx, orgId, slug, true); const scope = this.scope(orgId, actorId, agent);
      await this.autoridadeNoTx(tx, orgId, actorId, 'EXEC');
      if (prior) { this.conferirAtor(prior, scope); if (prior.inputCanonico !== textoCanonicoDaFerramentaLocal(scope, input)) throw falha();
        await this.recuperarNoTx(tx, scope, agent, prior); return; }
      const { item, v } = await this.metadadosNoTx(tx, scope, input, false);
      const colecao = await this.localNoTx(tx, scope, item, v, false);
      const profile = this.perfil(agent.sop); const configHash = this.configHash(profile);
      if (!agent.sop || agent.sop.versao !== input.expectedSopVersion || !profile || configHash !== input.expectedToolConfigHash || profile.limit !== input.limit) throw new ConflictException('A configuração do procedimento mudou. Confira antes de enviar.');
      const sop = { id: agent.sop.id, versao: agent.sop.versao, proposito: agent.sop.proposito, gatilho: agent.sop.gatilho,
        passos: agent.sop.passos, definicaoDePronto: agent.sop.definicaoDePronto, observacoes: agent.sop.observacoes, ferramentaLocal: profile, configHash: input.expectedToolConfigHash };
      const source = this.snapshot(item, v, colecao); this.preflight(scope, input, sop, source);
      const dono = await this.donoNoTx(tx, orgId, agent);
      const motivoCode = !agent.ativo || agent.estado !== 'ativo' ? 'agente_nao_ativo' : !dono ? 'responsavel_indisponivel'
        : agent.capacidades.length !== 1 || agent.capacidades[0] !== 'contexto.memoria.buscar' ? 'capacidade_nao_declarada' : null;
      // Origem, ACL, MAX e orçamento já conferidos; só agora o corpo privado é lido.
      const tamanho = await tx.$queryRaw<Array<{ bytes: number }>>`SELECT octet_length(body)::int AS bytes FROM "ContextItemVersion"
        WHERE id=${v.id} AND "orgId"=${orgId} AND "itemId"=${item.id} AND versao=${v.versao}`;
      if (tamanho.length !== 1 || tamanho[0].bytes > 262144) throw new BadRequestException('A fonte ultrapassa 256 KiB.');
      const body = await tx.contextItemVersion.findFirst({ where: { id: v.id, orgId, itemId: item.id, versao: v.versao }, select: { body: true, contentHash: true } });
      if (!body || body.contentHash !== input.contentHash || hashDoCorpo(body.body) !== input.contentHash || Buffer.byteLength(body.body, 'utf8') > 262144) throw new ConflictException('O corpo da versão não pôde ser conferido dentro do limite.');
      const criadaEm = new Date(); const id = randomUUID(); const inputCanonico = textoCanonicoDaFerramentaLocal(scope, input); const inputFingerprint = hash(inputCanonico);
      const resultado = motivoCode === null ? ProcedimentoFerramentaLocalResultadoSchema.parse({ modo: 'literal_versao_escolhida_v1', itemId: item.id,
        versionId: v.id, versao: v.versao, contentHash: v.contentHash, q: input.q, limit: input.limit, observadaEm: new Date().toISOString(), ...buscarLiteralNaVersao(body.body, input.q, input.limit) }) : null;
      if (resultado) await this.tamanhoNoTx(tx, resultado);
      const session = await tx.session.create({ data: { orgId, agentId: agent.id, solicitanteId: actorId, solicitanteRotulo: 'Pessoa autorizada', canal: 'web',
        canalRef: `procedimento-local:${input.requestId}`, pedido: 'Busca local literal em versão escolhida', resposta: 'Resultado disponível no procedimento de ferramenta local.',
        status: motivoCode === null ? 'executada' : 'recusada', passos: 2, fontes: [], provider: null, modelo: null, tokensIn: 0, tokensOut: 0, custoUsd: 0,
        custoEstimado: false, criadaEm, encerradaEm: new Date() } });
      if (!session.encerradaEm) throw falha();
      const marker = { tipo: 'procedimento_ferramenta_local', entradaContrato: 3, receiptId: id, requestId: input.requestId, inputFingerprint };
      const pedido = await tx.sessionStep.create({ data: { orgId, sessionId: session.id, ordem: 1, tipo: 'pedido', payload: marker, fontes: [] } });
      const final = await tx.sessionStep.create({ data: { orgId, sessionId: session.id, ordem: 2, tipo: motivoCode === null ? 'ferramenta' : 'resultado',
        capacidade: motivoCode === null ? 'contexto.memoria.buscar' : null, argsResumo: 'Consulta literal local', resultadoResumo: 'Recibo disponível no procedimento de ferramenta local.',
        args: json(input), payload: { receiptId: id, resultado: resultado ? json(resultado) : null }, fontes: [], custoUsd: 0, custoEstimado: false } });
      const audit = await this.audit.logComRecibo({ orgId, actorId, action: 'agent.procedimento_ferramenta_local', entityType: 'session', entityId: session.id,
        metadata: { requestId: input.requestId, capacidade: 'contexto.memoria.buscar', modo: 'literal_versao_escolhida_v1', status: session.status } }, tx);
      const comum = { schemaVersion: 1, tipo: 'procedimento_ferramenta_local', entradaContrato: 3, id, escopo: scope, requestId: input.requestId,
        sessionId: session.id, entrada: input, inputCanonico, inputFingerprint, sop, fonteEscolhida: source, passoPedidoId: pedido.id, passoFinalId: final.id,
        auditIds: [audit.id], consumoModelo: { origem: 'nenhuma_chamada_de_modelo', provider: null, modeloUsado: null, tokensIn: null, tokensOut: null, custoExternoUsd: 0, custoMaquinaMedido: false },
        criadaEm: criadaEm.toISOString(), encerradaEm: session.encerradaEm.toISOString() };
      const dto = ProcedimentoFerramentaLocalReciboSchema.parse(motivoCode === null ? { ...comum, status: 'executada', ferramentaChamada: true, motivoCode: null,
        fonteConsumida: source, resultado, resultHash: hash(JSON.stringify(resultado)) } : { ...comum, status: 'recusada', ferramentaChamada: false, motivoCode, fonteConsumida: null, resultado: null, resultHash: null });
      await this.tamanhoNoTx(tx, dto);
      const receiptCanonico = JSON.stringify(dto); const resultadoCanonico = resultado === null ? null : JSON.stringify(resultado);
      const row = await tx.agentLocalToolReceipt.create({ data: { id, orgId, actorId, agentId: agent.id, agentSlug: agent.slug, requestId: input.requestId, sessionId: session.id,
        entradaContrato: 3, capacidade: 'contexto.memoria.buscar', modo: 'literal_versao_escolhida_v1', status: dto.status,
        inputCanonico, entrada: json(input), inputFingerprint, sopId: sop.id, sopVersion: sop.versao, sopSnapshot: json(sop), toolConfigHash: input.expectedToolConfigHash,
        itemId: item.id, versionId: v.id, versionNo: v.versao, contentHash: v.contentHash, sourceSnapshot: json(source), passoPedidoId: pedido.id, passoFinalId: final.id,
        auditIds: [audit.id], resultadoCanonico, resultado: resultado === null ? Prisma.DbNull : json(resultado), resultHash: dto.resultHash,
        receiptCanonico, receipt: json(dto), receiptHash: hash(receiptCanonico), criadaEm, encerradaEm: session.encerradaEm } });
      await this.metadadosNoTx(tx, scope, input, false); await exigirAcessoAtual(tx, orgId, actorId, GATES.EXEC);
      // A própria entrega completa é validada antes do commit, além do recibo persistido.
      await this.recuperarNoTx(tx, scope, agent, row);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    const delivery = await this.porPedido(orgId, actorId, slug, input.requestId);
    if (delivery.estado !== 'confirmado') throw falha();
    return delivery.recibo;
  }

  private async conferirReciboNoTx(tx: Prisma.TransactionClient, scope: Scope, row: AgentLocalToolReceipt) {
    this.conferirAtor(row, scope);
    // Nenhum texto de recibo é entregue antes de reconferir a ACL da fonte atual.
    if (!await tx.contextItem.findFirst({ where: { id: row.itemId, orgId: scope.orgId, ...filtroDeLeitura(scope.actorId) }, select: { id: true } })) throw fonteIndisponivel();
    const p = ProcedimentoFerramentaLocalReciboSchema.safeParse(row.receipt);
    if (!p.success) throw falha(); const r = p.data;
    // jsonb ordena chaves; o fingerprint usa o texto exato e a igualdade usa jsonb.
    const same = await tx.$queryRaw<Array<{ same: boolean }>>`SELECT ${row.receiptCanonico}::jsonb=${JSON.stringify(row.receipt)}::jsonb
      AND ${JSON.stringify(row.entrada)}::jsonb=${JSON.stringify(r.entrada)}::jsonb
      AND ${JSON.stringify(row.sopSnapshot)}::jsonb=${JSON.stringify(r.sop)}::jsonb
      AND ${JSON.stringify(row.sourceSnapshot)}::jsonb=${JSON.stringify(r.fonteEscolhida)}::jsonb AS same`;
    if (row.receiptHash !== hash(row.receiptCanonico) || same.length !== 1 || !same[0].same) throw falha();
    if (row.entradaContrato !== 3 || row.capacidade !== 'contexto.memoria.buscar' || row.modo !== 'literal_versao_escolhida_v1'
      || r.id !== row.id || r.escopo.orgId !== scope.orgId || r.escopo.actorId !== scope.actorId || r.escopo.agentId !== scope.agentId || r.escopo.agentSlug !== scope.agentSlug
      || r.requestId !== row.requestId || r.sessionId !== row.sessionId || r.status !== row.status || r.inputCanonico !== row.inputCanonico || r.inputFingerprint !== row.inputFingerprint
      || r.inputCanonico !== textoCanonicoDaFerramentaLocal(scope, r.entrada) || hash(r.inputCanonico) !== r.inputFingerprint
      || r.sop.id !== row.sopId || r.sop.versao !== row.sopVersion || r.sop.versao !== r.entrada.expectedSopVersion
      || this.configHash(r.sop.ferramentaLocal) !== row.toolConfigHash || r.sop.configHash !== row.toolConfigHash || row.toolConfigHash !== r.entrada.expectedToolConfigHash
      || r.sop.ferramentaLocal.limit !== r.entrada.limit || r.fonteEscolhida.itemId !== row.itemId || r.fonteEscolhida.versionId !== row.versionId
      || r.fonteEscolhida.contentHash !== row.contentHash || r.fonteEscolhida.versao !== row.versionNo || r.passoPedidoId !== row.passoPedidoId || r.passoFinalId !== row.passoFinalId
      || JSON.stringify(r.auditIds) !== JSON.stringify(row.auditIds) || r.criadaEm !== row.criadaEm.toISOString() || r.encerradaEm !== row.encerradaEm.toISOString()) throw falha();
    const { item, v } = await this.metadadosNoTx(tx, scope, r.entrada, true);
    const colecao = await this.localNoTx(tx, scope, item, v, true);
    const tamanho = await tx.$queryRaw<Array<{ bytes: number }>>`SELECT octet_length(body)::int AS bytes FROM "ContextItemVersion"
      WHERE id=${v.id} AND "orgId"=${scope.orgId} AND "itemId"=${item.id}`;
    if (tamanho.length !== 1 || tamanho[0].bytes > 262144) throw falha();
    const body = await tx.contextItemVersion.findFirst({ where: { id: v.id, orgId: scope.orgId, itemId: item.id }, select: { body: true } });
    if (!body || Buffer.byteLength(body.body, 'utf8') > 262144 || hashDoCorpo(body.body) !== v.contentHash) throw falha();
    const source = this.snapshot(item, v, colecao, r.fonteEscolhida.chave);
    if (JSON.stringify(source) !== JSON.stringify(r.fonteEscolhida)) throw falha();
    const s = await tx.session.findFirst({ where: { id: row.sessionId, orgId: scope.orgId, agentId: scope.agentId } });
    const steps = await tx.sessionStep.findMany({ where: { sessionId: row.sessionId, orgId: scope.orgId }, orderBy: { ordem: 'asc' } });
    const marker = { tipo: 'procedimento_ferramenta_local', entradaContrato: 3, receiptId: r.id, requestId: r.requestId, inputFingerprint: r.inputFingerprint };
    const equal = await tx.$queryRaw<Array<{ same: boolean }>>`SELECT ${JSON.stringify(steps[0]?.payload ?? null)}::jsonb=${JSON.stringify(marker)}::jsonb
      AND ${JSON.stringify(steps[1]?.args ?? null)}::jsonb=${JSON.stringify(r.entrada)}::jsonb
      AND ${JSON.stringify(steps[1]?.payload ?? null)}::jsonb=${JSON.stringify({ receiptId: r.id, resultado: r.resultado })}::jsonb AS same`;
    if (!s || s.canal !== 'web' || s.canalRef !== `procedimento-local:${r.requestId}` || s.solicitanteId !== scope.actorId || s.status !== r.status || s.passos !== 2
      || steps.length !== 2 || steps[0].id !== r.passoPedidoId || steps[0].ordem !== 1 || steps[0].tipo !== 'pedido'
      || steps[1].id !== r.passoFinalId || steps[1].ordem !== 2 || steps[1].tipo !== (r.status === 'executada' ? 'ferramenta' : 'resultado')
      || equal.length !== 1 || !equal[0].same || steps.some((x) => x.toolCallId !== null || x.provider !== null || x.modelo !== null || x.texto !== null)
      || s.provider !== null || s.modelo !== null || s.tokensIn !== 0 || s.tokensOut !== 0 || Number(s.custoUsd) !== 0) throw falha();
    if (r.status === 'executada') {
      const result = r.resultado;
      const semantic = await tx.$queryRaw<Array<{ same: boolean }>>`SELECT ${row.resultadoCanonico}::jsonb=${JSON.stringify(result)}::jsonb
        AND ${JSON.stringify(row.resultado)}::jsonb=${JSON.stringify(result)}::jsonb AS same`;
      if (row.resultadoCanonico === null || hash(row.resultadoCanonico) !== r.resultHash || r.resultHash !== row.resultHash || semantic.length !== 1 || !semantic[0].same
        || result.itemId !== r.entrada.itemId || result.versionId !== r.entrada.versionId || result.versao !== row.versionNo || result.contentHash !== r.entrada.contentHash
        || result.q !== r.entrada.q || result.limit !== r.entrada.limit || result.correspondencias.length > result.limit
        || result.totalLinhasComCorrespondencia < result.correspondencias.length || result.parcial !== (result.totalLinhasComCorrespondencia > result.correspondencias.length)
        || result.correspondencias.some((x, i, xs) => i > 0 && x.linha <= xs[i - 1].linha) || JSON.stringify(r.fonteConsumida) !== JSON.stringify(r.fonteEscolhida)) throw falha();
    } else if (row.resultadoCanonico !== null || row.resultado !== null || row.resultHash !== null) throw falha();
    await this.tamanhoNoTx(tx, r); return { r, item, v };
  }
  private async recuperarNoTx(tx: Prisma.TransactionClient, scope: Scope, a: Agente, row: AgentLocalToolReceipt) {
    const { r, item, v } = await this.conferirReciboNoTx(tx, scope, row);
    if (Array.from(item.chave).length > 1400) throw new ConflictException('A disponibilidade atual ultrapassa o limite do envelope.');
    const mesmaOrigem = item.sourceType === v.sourceType && item.sourceRef === v.sourceRef && item.chave === r.fonteEscolhida.chave;
    const pendente = await consultaMovimentoPendente(tx, scope.orgId, item.id);
    const dto = ProcedimentoFerramentaLocalRecuperacaoSchema.parse({ estado: 'confirmado', escopo: scope, requestId: r.requestId, recibo: r,
      disponibilidadeAtual: { sopVersaoAtual: a.sop?.versao ?? null, configHashAtual: this.configHash(this.perfil(a.sop)), estadoAgenteAtual: a.estado,
        fonte: { versaoAtual: item.versao, arquivada: !!item.arquivadoEm, novoUsoPermitido: mesmaOrigem && item.versao === r.entrada.expectedItemVersion && !item.arquivadoEm && !pendente, chaveAtual: item.chave }, verificadaEm: new Date().toISOString() } });
    await this.tamanhoNoTx(tx, dto); await exigirAcessoAtual(tx, scope.orgId, scope.actorId, GATES.LER);
    if (!await tx.contextItem.findFirst({ where: { id: item.id, orgId: scope.orgId, ...filtroDeLeitura(scope.actorId) }, select: { id: true } })) throw fonteIndisponivel();
    return dto;
  }
  async porPedido(orgId: string, actorId: string, slug: string, requestId: string) {
    const id = z.string().uuid().parse(requestId).toLowerCase(); await exigirAcessoAtual(this.prisma, orgId, actorId, GATES.LER);
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockRequest(tx, orgId, id); const row = await this.lookup(tx, orgId, id);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`memoria:${orgId}`}))`;
      const a = await this.agenteNoTx(tx, orgId, slug, false); const scope = this.scope(orgId, actorId, a);
      await this.autoridadeNoTx(tx, orgId, actorId, 'LER');
      if (!row) { const dto = ProcedimentoFerramentaLocalRecuperacaoSchema.parse({ estado: 'ausencia_conferida', escopo: scope, requestId: id, mantemId: true, cancelaPostTardio: false });
        await this.tamanhoNoTx(tx, dto); await exigirAcessoAtual(tx, orgId, actorId, GATES.LER); return dto; }
      return this.recuperarNoTx(tx, scope, a, row);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    await exigirAcessoAtual(this.prisma, orgId, actorId, GATES.LER);
    if (result.estado === 'confirmado' && !await this.prisma.contextItem.findFirst({ where: { id: result.recibo.fonteEscolhida.itemId,
      orgId, ...filtroDeLeitura(actorId) }, select: { id: true } })) throw fonteIndisponivel();
    await exigirAcessoAtual(this.prisma, orgId, actorId, GATES.LER); return result;
  }
  async detalhe(orgId: string, actorId: string, slug: string, sessionId: string) {
    const id = z.string().uuid().parse(sessionId).toLowerCase(); await exigirAcessoAtual(this.prisma, orgId, actorId, GATES.LER);
    const candidate = await this.prisma.agentLocalToolReceipt.findFirst({ where: { orgId, sessionId: id }, select: { requestId: true } });
    if (!candidate) { await exigirAcessoAtual(this.prisma, orgId, actorId, GATES.LER); throw new NotFoundException('Execução indisponível.'); }
    const result = await this.porPedido(orgId, actorId, slug, candidate.requestId);
    if (result.estado !== 'confirmado' || result.recibo.sessionId !== id) throw falha(); return result;
  }
}
