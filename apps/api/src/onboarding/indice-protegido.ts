import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, type PrismaClient, type KnowledgeNote, type ContextItem, type ContextItemVersion } from '@prisma/client';
import { EspelhoOnboardingFonteSchema, EspelhoOnboardingObservacaoSchema, type EspelhoOnboardingFonte, type EspelhoOnboardingObservacao } from '@mktos/shared';
import { contextoAtual } from '../common/contexto-execucao';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import { hashDoCorpo } from '../memory/procedencia';

export type IdentidadeIndiceHttp = { tipo: 'http_humano'; orgId: string; userId: string; correlationId: string };
export type IdentidadeIndiceRuntime = { tipo: 'runtime_com_solicitante'; orgId: string; solicitanteId: string;
  contextoExecucao: { actorType: 'ai'; actorId: string; agentSlug: string; correlationId: string } };
export type IdentidadeIndice = IdentidadeIndiceHttp | IdentidadeIndiceRuntime;
export const pessoaDoIndice = (i: IdentidadeIndice) => i.tipo === 'http_humano' ? i.userId : i.solicitanteId;
export function conferirIdentidadeDoIndice(orgId: string, i: IdentidadeIndice): void {
  const c = contextoAtual();
  if (!c || c.orgId !== orgId || i.orgId !== orgId || !pessoaDoIndice(i) || !c.correlationId) throw new ForbiddenException('Acesso insuficiente.');
  if (i.tipo === 'http_humano') {
    if (c.actorType !== 'user' || c.actorId !== i.userId || c.correlationId !== i.correlationId) throw new ForbiddenException('Acesso insuficiente.');
  } else if (c.actorType !== 'ai' || i.contextoExecucao.actorType !== 'ai' || c.actorId !== i.solicitanteId
    || c.actorId !== i.contextoExecucao.actorId || c.agentSlug !== i.contextoExecucao.agentSlug
    || !i.contextoExecucao.agentSlug || c.correlationId !== i.contextoExecucao.correlationId) throw new ForbiddenException('Acesso insuficiente.');
}
export function identidadeHttpDoIndice(orgId: string, userId: string): IdentidadeIndiceHttp {
  const c = contextoAtual();
  if (!c || c.actorType !== 'user' || c.orgId !== orgId || c.actorId !== userId || !userId) throw new ForbiddenException('Acesso insuficiente.');
  return { tipo: 'http_humano', orgId, userId, correlationId: c.correlationId };
}
export async function travarIndiceEMemoriaNoTx(tx: Prisma.TransactionClient, orgId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`obsidian-index:${orgId}`}))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`memoria:${orgId}`}))`;
}
export async function travarLeitorDoIndiceNoTx(tx: Prisma.TransactionClient, orgId: string, i: IdentidadeIndice, editar = false): Promise<void> {
  conferirIdentidadeDoIndice(orgId, i);
  const actor = pessoaDoIndice(i), perms = editar ? ['obsidian.ver', 'obsidian.editar'] : ['obsidian.ver'];
  const org = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Org" WHERE id=${orgId} AND "isActive" FOR SHARE`;
  const user = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "User" WHERE id=${actor} AND "orgId"=${orgId} AND "isActive" ORDER BY id FOR SHARE`;
  if (org.length !== 1 || user.length !== 1) throw new ForbiddenException('Acesso insuficiente.');
  const joins = await tx.$queryRaw<Array<{ id: string }>>`SELECT ur."A" AS id FROM "_UserRoles" ur JOIN "Role" r ON r.id=ur."A"
    WHERE ur."B"=${actor} AND r."orgId"=${orgId} ORDER BY ur."A",ur."B" FOR SHARE OF ur`;
  const roles = [...new Set(joins.map((j) => j.id))].sort();
  if (!roles.length) throw new ForbiddenException('Acesso insuficiente.');
  const r = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Role" WHERE "orgId"=${orgId} AND id IN (${Prisma.join(roles)}) ORDER BY id FOR SHARE`;
  if (r.length !== roles.length) throw new ForbiddenException('Acesso insuficiente.');
  const grants = await tx.$queryRaw<Array<{ id: string }>>`SELECT rp."A" AS id FROM "_RolePermissions" rp
    WHERE rp."B" IN (${Prisma.join(roles)}) ORDER BY rp."B",rp."A" FOR SHARE OF rp`;
  const ids = [...new Set(grants.map((g) => g.id))].sort();
  if (!ids.length) throw new ForbiddenException('Acesso insuficiente.');
  const p = await tx.$queryRaw<Array<{ id: string; key: string }>>`SELECT id,key FROM "Permission" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`;
  if (p.length !== ids.length || !perms.every((key) => p.some((v) => v.key === key))) throw new ForbiddenException('Acesso insuficiente.');
  await exigirAcessoAtual(tx, orgId, actor, perms);
  conferirIdentidadeDoIndice(orgId, i);
}
export interface FonteFisicaEscolhidaDoOnboarding {
  orgId: string; itemId: string; versionId: string; versao: number; chave: string;
  kind: ContextItem['kind']; title: string; body: string; tags: readonly string[];
  sourceType: ContextItem['sourceType']; sourceRef: string | null; contentHash: string;
}
const iguais = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const conflito = () => new ConflictException('A fonte do índice mudou. Confira a versão atual antes de repetir.');
function metadados(f: FonteFisicaEscolhidaDoOnboarding): EspelhoOnboardingFonte {
  return EspelhoOnboardingFonteSchema.parse({ tipo: 'onboarding', orgId: f.orgId, itemId: f.itemId,
    versionId: f.versionId, versao: f.versao, chave: f.chave, sourceType: f.sourceType, sourceRef: f.sourceRef, contentHash: f.contentHash });
}
function integra(n: ContextItem, v: ContextItemVersion): boolean {
  return n.orgId === v.orgId && n.id === v.itemId && n.versao === v.versao && !n.arquivadoEm && !n.acessoRestrito
    && n.chave.startsWith('onboarding:') && ['operador', 'promocao'].includes(n.sourceType)
    && n.body === v.body && n.title === v.title && n.kind === v.kind && n.sourceType === v.sourceType
    && n.sourceRef === v.sourceRef && n.contentHash === v.contentHash && hashDoCorpo(n.body) === n.contentHash;
}
async function fontesAtuaisNoTx(tx: Prisma.TransactionClient, orgId: string, ids: string[]) {
  const ordenados = [...new Set(ids)].sort();
  if (!ordenados.length) return [];
  await tx.$queryRaw`SELECT id FROM "ContextItem" WHERE "orgId"=${orgId} AND id IN (${Prisma.join(ordenados)}) ORDER BY id FOR SHARE`;
  // Corpo só de fonte atualmente pública e ativa, depois da autoridade corrente.
  const items = await tx.contextItem.findMany({ where: { orgId, id: { in: ordenados }, arquivadoEm: null, acessoRestrito: false, chave: { startsWith: 'onboarding:' }, sourceType: { in: ['operador', 'promocao'] } }, orderBy: { id: 'asc' } });
  const out: Array<{ item: ContextItem; version: ContextItemVersion }> = [];
  for (const n of items) {
    await tx.$queryRaw`SELECT id FROM "ContextItemVersion" WHERE "orgId"=${orgId} AND "itemId"=${n.id} ORDER BY id FOR SHARE`;
    const v = await tx.contextItemVersion.findFirst({ where: { orgId, itemId: n.id }, orderBy: { versao: 'desc' } });
    const claim = await tx.contextKeyClaim.findFirst({ where: { orgId, key: n.chave }, select: { id: true } });
    if (v && !claim && integra(n, v)) out.push({ item: n, version: v });
  }
  return out;
}
export type LinhaDoIndice = KnowledgeNote & { comVetor: boolean; fonteCanonica: EspelhoOnboardingFonte | null };
const COLUNAS = `kn.id,kn."orgId",kn.path,kn.folder,kn.title,kn.tags,kn.content,kn.links,kn."wordCount",kn."fileTime",kn."indexedAt",
 kn."mirrorOrigin",kn."canonicalItemId",kn."canonicalVersionId",kn."canonicalVersion",kn."canonicalKey",kn."canonicalSourceType",kn."canonicalSourceRef",kn."canonicalContentHash",(kn.embedding IS NOT NULL) AS "comVetor"`;
const NATIVA = `kn."mirrorOrigin" IS NULL AND kn."canonicalItemId" IS NULL AND kn."canonicalVersionId" IS NULL AND kn."canonicalVersion" IS NULL
 AND kn."canonicalKey" IS NULL AND kn."canonicalSourceType" IS NULL AND kn."canonicalSourceRef" IS NULL AND kn."canonicalContentHash" IS NULL
 AND (kn.folder IS NULL OR kn.folder<>'onboarding') AND kn.path NOT LIKE 'onboarding/%'`;
async function caminhosNegadosNoTx(tx: Prisma.TransactionClient, orgId: string, pessoa: string | null) {
  const n = await tx.contextItem.findMany({ where: { orgId, OR: [{ arquivadoEm: { not: null } },
    { acessoRestrito: true, ...(pessoa ? { NOT: { leitores: { has: pessoa } } } : {}) }] }, select: { chave: true } });
  return n.map((v) => v.chave.startsWith('vault:') ? v.chave.slice(6) : v.chave);
}
export async function lerNativasNoTx(tx: Prisma.TransactionClient, orgId: string, pessoa: string | null,
  /** Produção 22B (I6): só as notas destas pastas (a Equipe lê duas), com as MESMAS regras de acesso. */
  filtro?: { pastas: readonly string[] }): Promise<LinhaDoIndice[]> {
  const negadas = await caminhosNegadosNoTx(tx, orgId, pessoa);
  const pastas = filtro ? filtro.pastas.flatMap((p) => [`${p}/%`, `%/${p}/%`]) : null;
  const naPasta = pastas ? Prisma.sql`AND kn.path LIKE ANY(${pastas}::text[])` : Prisma.empty;
  const rows = await tx.$queryRaw<Array<KnowledgeNote & { comVetor: boolean }>>`SELECT ${Prisma.raw(COLUNAS)} FROM "KnowledgeNote" kn
    WHERE kn."orgId"=${orgId} AND ${Prisma.raw(NATIVA)} AND NOT(kn.path=ANY(${negadas}::text[])) ${naPasta} ORDER BY kn.id FOR SHARE OF kn`;
  return rows.map((r) => ({ ...r, fonteCanonica: null }));
}
export async function lerPopulacaoDoIndiceNoTx(tx: Prisma.TransactionClient, orgId: string, i: IdentidadeIndice): Promise<LinhaDoIndice[]> {
  const refs = await tx.knowledgeNote.findMany({ where: { orgId, mirrorOrigin: 'onboarding' }, select: { id: true, canonicalItemId: true }, orderBy: { id: 'asc' } });
  const fontes = await fontesAtuaisNoTx(tx, orgId, refs.flatMap((r) => r.canonicalItemId ? [r.canonicalItemId] : []));
  const nativas = await lerNativasNoTx(tx, orgId, pessoaDoIndice(i));
  if (!refs.length || !fontes.length) return nativas;
  // A identidade/versão e os campos públicos correntes limitam o corpo antes do fetch.
  const vinculos = fontes.map(({ item: n, version: v }) => Prisma.sql`(
    kn."canonicalItemId"=${n.id} AND kn."canonicalVersionId"=${v.id} AND kn."canonicalVersion"=${v.versao}
    AND kn."canonicalKey"=${n.chave} AND kn."canonicalSourceType"::text=${n.sourceType}
    AND kn."canonicalSourceRef" IS NOT DISTINCT FROM ${n.sourceRef} AND kn."canonicalContentHash"=${n.contentHash}
    AND kn.folder='onboarding' AND kn.path=${`onboarding/itens/${n.id}.md`}
    AND kn.title=${n.title} AND kn.content=${n.body} AND kn.tags=${n.tags}::text[])`);
  const rows = await tx.$queryRaw<Array<KnowledgeNote & { comVetor: boolean }>>`SELECT ${Prisma.raw(COLUNAS)} FROM "KnowledgeNote" kn
    WHERE kn."orgId"=${orgId} AND kn."mirrorOrigin"='onboarding' AND (${Prisma.join(vinculos, ' OR ')})
      ORDER BY kn.id FOR SHARE OF kn`;
  const protegidas: LinhaDoIndice[] = [];
  for (const kn of rows) {
    const f = fontes.find((r) => r.item.id === kn.canonicalItemId);
    if (!f) continue;
    const { item: n, version: v } = f;
    if (kn.mirrorOrigin !== 'onboarding' || kn.folder !== 'onboarding' || kn.path !== `onboarding/itens/${n.id}.md`
      || kn.canonicalVersionId !== v.id || kn.canonicalVersion !== v.versao || kn.canonicalKey !== n.chave
      || kn.canonicalSourceType !== n.sourceType || kn.canonicalSourceRef !== n.sourceRef || kn.canonicalContentHash !== n.contentHash
      || kn.content !== n.body || kn.title !== n.title || !iguais(kn.tags, n.tags)) continue;
    const fonteCanonica = metadados({ orgId, itemId: n.id, versionId: v.id, versao: v.versao, chave: n.chave,
      kind: n.kind, title: n.title, body: n.body, tags: n.tags, sourceType: n.sourceType, sourceRef: n.sourceRef, contentHash: n.contentHash });
    protegidas.push({ ...kn, fonteCanonica });
  }
  return [...nativas, ...protegidas];
}
export async function espelharVersoesEscolhidasNoIndice(prisma: PrismaClient, orgId: string, actorId: string,
  escolhidas: readonly FonteFisicaEscolhidaDoOnboarding[]): Promise<EspelhoOnboardingObservacao[]> {
  const identidade = identidadeHttpDoIndice(orgId, actorId);
  const fontes = escolhidas.map((f) => ({ ...f, tags: [...f.tags] }));
  if (new Set(fontes.map((f) => f.itemId)).size !== fontes.length) throw conflito();
  return prisma.$transaction(async (tx) => {
    await travarIndiceEMemoriaNoTx(tx, orgId); await travarLeitorDoIndiceNoTx(tx, orgId, identidade, true);
    const atuais = await fontesAtuaisNoTx(tx, orgId, fontes.map((f) => f.itemId));
    for (const f of fontes) {
      metadados(f); const atual = atuais.find((a) => a.item.id === f.itemId);
      if (!atual || f.orgId !== orgId || atual.version.id !== f.versionId || atual.version.versao !== f.versao
        || atual.item.chave !== f.chave || atual.item.kind !== f.kind || atual.item.title !== f.title || atual.item.body !== f.body
        || !iguais(atual.item.tags, f.tags) || atual.item.sourceType !== f.sourceType || atual.item.sourceRef !== f.sourceRef
        || atual.item.contentHash !== f.contentHash || hashDoCorpo(f.body) !== f.contentHash) throw conflito();
    }
    const planos: Array<{ f: FonteFisicaEscolhidaDoOnboarding; path: string; kn: KnowledgeNote | null }> = [];
    for (const f of [...fontes].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
      const path = `onboarding/itens/${f.itemId}.md`;
      const encontrados = await tx.knowledgeNote.findMany({ where: { orgId, OR: [{ canonicalItemId: f.itemId }, { path }] }, orderBy: { id: 'asc' } });
      if (encontrados.length > 1) throw conflito();
      const kn = encontrados[0] ?? null;
      if (kn && (kn.mirrorOrigin !== 'onboarding' || kn.canonicalItemId !== f.itemId || kn.path !== path || kn.folder !== 'onboarding'
        || !kn.canonicalVersionId || !kn.canonicalVersion || !kn.canonicalKey || !kn.canonicalSourceType || !kn.canonicalContentHash)) throw conflito();
      planos.push({ f, path, kn });
    }
    const idsDoIndice = planos.flatMap((p) => p.kn ? [p.kn.id] : []).sort();
    if (idsDoIndice.length) await tx.$queryRaw`SELECT id FROM "KnowledgeNote" WHERE "orgId"=${orgId} AND id IN (${Prisma.join(idsDoIndice)}) ORDER BY id FOR UPDATE`;
    for (const p of planos) if (p.kn) {
      const atual = await tx.knowledgeNote.findFirst({ where: { id: p.kn.id, orgId } });
      if (!iguais(atual, p.kn)) throw conflito();
    }
    const result: EspelhoOnboardingObservacao[] = [];
    for (const { f, path, kn } of planos) {
      const data = { folder: 'onboarding', title: f.title, content: f.body, tags: [...f.tags], links: [],
        wordCount: f.body.split(/\s+/).filter(Boolean).length, fileTime: new Date(), indexedAt: new Date(),
        mirrorOrigin: 'onboarding', canonicalItemId: f.itemId, canonicalVersionId: f.versionId, canonicalVersion: f.versao,
        canonicalKey: f.chave, canonicalSourceType: f.sourceType, canonicalSourceRef: f.sourceRef, canonicalContentHash: f.contentHash };
      let id: string;
      if (kn) {
        const updated = await tx.knowledgeNote.updateMany({ where: { id: kn.id, orgId, canonicalItemId: kn.canonicalItemId,
          canonicalVersionId: kn.canonicalVersionId, canonicalVersion: kn.canonicalVersion, canonicalContentHash: kn.canonicalContentHash }, data });
        if (updated.count !== 1) throw conflito(); id = kn.id;
        if (kn.title !== f.title || kn.content !== f.body || kn.canonicalVersionId !== f.versionId
          || kn.canonicalVersion !== f.versao || kn.canonicalKey !== f.chave || kn.canonicalSourceType !== f.sourceType
          || kn.canonicalSourceRef !== f.sourceRef || kn.canonicalContentHash !== f.contentHash || !iguais(kn.tags, f.tags)) await tx.$executeRaw`UPDATE "KnowledgeNote" SET embedding=NULL WHERE id=${id} AND "orgId"=${orgId}`;
      } else id = (await tx.knowledgeNote.create({ data: { orgId, path, ...data }, select: { id: true } })).id;
      const r = await tx.knowledgeNote.findFirst({ where: { id, orgId, canonicalItemId: f.itemId, canonicalVersionId: f.versionId, canonicalVersion: f.versao, canonicalContentHash: f.contentHash } });
      if (!r || r.path !== path || r.title !== f.title || r.content !== f.body || !iguais(r.tags, f.tags)
        || r.canonicalKey !== f.chave || r.canonicalSourceType !== f.sourceType || r.canonicalSourceRef !== f.sourceRef) throw conflito();
      result.push(EspelhoOnboardingObservacaoSchema.parse({ estado: 'concluido', fonte: metadados(f),
        indice: { id, path, indexedAt: r.indexedAt.toISOString() }, observadoEm: new Date().toISOString() }));
    }
    const final = await lerPopulacaoDoIndiceNoTx(tx, orgId, identidade);
    for (const r of result) if (!final.some((n) => n.id === r.indice?.id && n.fonteCanonica?.versionId === r.fonte?.versionId)) throw conflito();
    await travarLeitorDoIndiceNoTx(tx, orgId, identidade, true); return result;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
