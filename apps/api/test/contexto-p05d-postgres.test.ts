import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { ActorType, ContextKind, PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { comContexto } from '../src/common/contexto-execucao';
import { ConectoresConfiguradosRegistry } from '../src/gateway/conectores-configurados.registry';
import { EventLogService, semSigilosos } from '../src/gateway/event-log.service';
import { RegistroDeConectores } from '../src/integrations/conectores.registry';
import { MemoriaService, TIPO_DO_RECIBO } from '../src/memory/memoria.service';
import { hashDoCorpo } from '../src/memory/procedencia';
import { lerNotaDaVault } from '../src/obsidian/cabecalho-da-nota';
import { ObsidianService } from '../src/obsidian/obsidian.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { comTenantNaSessao } from '../src/prisma/sessao-de-banco';

// Opt-in separado das URLs dos previews. Nenhum .env é lido por esta suíte.
const ownerUrl = process.env.P05D_OWNER_DATABASE_URL;
const appUrl = process.env.P05D_APP_DATABASE_URL;
if (Boolean(ownerUrl) !== Boolean(appUrl)) throw new Error('P-05d exige as duas conexões sintéticas.');
for (const value of [ownerUrl, appUrl]) {
  if (!value) continue;
  const u = new URL(value);
  if (u.hostname !== '127.0.0.1' || !u.pathname.startsWith('/ctx_p05d_')) {
    throw new Error('P-05d só aceita banco descartável próprio em loopback.');
  }
}
if (ownerUrl && appUrl) {
  const a = new URL(ownerUrl), b = new URL(appUrl);
  if (a.host !== b.host || a.pathname !== b.pathname || b.username !== 'ctx_probe') {
    throw new Error('As duas conexões devem usar o mesmo banco próprio e o papel ctx_probe.');
  }
}

const marca = randomUUID();
const A = `ctxp05d-a-${marca}`, B = `ctxp05d-b-${marca}`;
const canonical = (value: unknown): string => {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
};
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const cabecalho = '---\nkind: regra\nvalido_de: 2026-09-15\nvalido_ate: 2026-12-31\n';
const files = [
  { caminho: 'privado/cache.md', texto: `${cabecalho}---\nCorpo sintético cache`, modificadoEm: new Date('2026-10-01T00:00:00Z') },
  { caminho: 'privado/releitura.md', texto: `${cabecalho}substitui: releitura\n---\nCorpo sintético releitura`, modificadoEm: new Date('2026-10-01T00:00:00Z') },
  { caminho: 'privado/valida.md', texto: `${cabecalho}substitui: alvo\n---\nReferência sintética válida`, modificadoEm: new Date('2026-10-01T00:00:00Z') },
  { caminho: 'privado/alvo.md', texto: 'Alvo sintético da mesma organização', modificadoEm: new Date('2026-10-01T00:00:00Z') },
];

describe.skipIf(!ownerUrl || !appUrl).sequential('P-05d: persistência real e papel restrito', () => {
  let owner: PrismaClient, base: PrismaClient, app: PrismaClient, pool: Pool;
  let memoria: MemoriaService, eventos: EventLogService, obsidian: ObsidianService;
  let listar: ReturnType<typeof vi.fn>, embed: ReturnType<typeof vi.fn>;
  const receipt: Record<string, unknown> = { tipo: 'ensaio-autoral-postgres', marca, organizacoes: [A, B], casos: {} };
  const cases = receipt.casos as Record<string, unknown>;
  const envKeys = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OBSIDIAN_FONTE', 'OBSIDIAN_DRIVE_FOLDER_ID', 'OBSIDIAN_VAULT_PATH'] as const;
  const savedEnv = new Map<string, string | undefined>();
  const na = <T>(orgId: string, fn: () => Promise<T>) => comContexto({ orgId, actorType: ActorType.user,
    actorId: 'operador-sintetico', correlationId: marca, origem: 'script' }, async () => await fn());
  const row = (id: string) => owner.contextItem.findUniqueOrThrow({ where: { id } });
  const history = (id: string) => owner.contextItemVersion.findMany({ where: { itemId: id }, orderBy: { versao: 'asc' } });
  const itemEvents = () => owner.eventLog.findMany({ where: { orgId: A, tipo: { startsWith: 'memoria.item.' } }, orderBy: { seq: 'asc' } });
  const lastReceipt = () => owner.eventLog.findFirstOrThrow({ where: { orgId: A, tipo: TIPO_DO_RECIBO }, orderBy: { seq: 'desc' } });
  const vector = async (id: string) => (await owner.$queryRawUnsafe<Array<{ v: string | null }>>(
    'SELECT embedding::text AS v FROM "ContextItem" WHERE id=$1', id))[0].v;

  beforeAll(async () => {
    for (const key of envKeys) { savedEnv.set(key, process.env[key]); delete process.env[key]; }
    Object.assign(process.env, { OPENAI_API_KEY: 'synthetic-provider-replaced', OPENAI_BASE_URL: 'http://127.0.0.1:1',
      OBSIDIAN_FONTE: 'drive', OBSIDIAN_DRIVE_FOLDER_ID: 'synthetic-no-google' });
    const blocked = () => { throw new Error('HTTP externo bloqueado no ensaio P-05d'); };
    vi.stubGlobal('fetch', vi.fn(blocked));
    vi.spyOn(http, 'request').mockImplementation(blocked);
    vi.spyOn(http, 'get').mockImplementation(blocked);
    vi.spyOn(https, 'request').mockImplementation(blocked);
    vi.spyOn(https, 'get').mockImplementation(blocked);
    owner = new PrismaClient({ datasources: { db: { url: ownerUrl } } });
    base = new PrismaClient({ datasources: { db: { url: appUrl } } });
    app = comTenantNaSessao(base, { modo: 'impor', avisar: () => {} });
    pool = new Pool({ connectionString: appUrl, max: 1 });
    await owner.$connect();
    const previous = await owner.org.findUnique({ where: { slug: 'root' } });
    if (previous) {
      if (!previous.id.startsWith('ctxp05d-')) throw new Error('Banco contém organização fora da fixture.');
      await owner.org.update({ where: { id: previous.id }, data: { slug: previous.id } });
    }
    await owner.org.create({ data: { id: A, name: 'Organização sintética A', slug: 'root' } });
    await owner.org.create({ data: { id: B, name: 'Organização sintética B', slug: B } });
    eventos = new EventLogService(app as unknown as PrismaService);
    memoria = new MemoriaService(app as unknown as PrismaService, eventos);
    obsidian = new ObsidianService(app as unknown as PrismaService, new ConectoresConfiguradosRegistry(),
      new RegistroDeConectores(), memoria);
    // Só a fronteira da fonte e o provedor são substituídos. Escritas, recibo e sessão são reais.
    listar = vi.fn(async () => files.map((f) => ({ ...f, ler: vi.fn(async () => f.texto) })));
    vi.spyOn(obsidian as never, 'listarNoDrive').mockImplementation(listar as never);
    embed = vi.fn(async (texts: string[]) => texts.map(() => Array.from({ length: 1536 }, (_, i) => (i % 7) / 1024)));
    vi.spyOn(obsidian as never, 'embed').mockImplementation(embed as never);
    const [role] = await na(A, () => app.$queryRawUnsafe<Array<{ usuario: string; super: boolean; bypass: boolean; dono: boolean }>>(
      `SELECT current_user::text AS usuario, r.rolsuper AS super, r.rolbypassrls AS bypass,
        EXISTS(SELECT 1 FROM pg_class WHERE relname IN ('ContextItem','ContextItemVersion','EventLog')
          AND relowner=r.oid) AS dono FROM pg_roles r WHERE rolname=current_user`));
    expect(role).toEqual({ usuario: 'ctx_probe', super: false, bypass: false, dono: false });
    const policies = await owner.$queryRawUnsafe<Array<{ tabela: string; rls: boolean; force: boolean; policies: bigint }>>(
      `SELECT * FROM app_rls_estado() WHERE tabela IN ('ContextItem','ContextItemVersion','EventLog','KnowledgeNote')`);
    expect(policies).toHaveLength(4);
    expect(policies.every((p) => p.rls && p.force && p.policies > 0n)).toBe(true);
    receipt.papel = role; receipt.policies = policies;
  }, 30_000);

  afterAll(async () => {
    try {
      if (owner) await owner.org.updateMany({ where: { id: A }, data: { slug: A } });
      if (process.env.P05D_RECEIPT_PATH) writeFileSync(process.env.P05D_RECEIPT_PATH, canonical(receipt) + '\n');
    } finally {
      await pool?.end(); await base?.$disconnect(); await owner?.$disconnect();
      vi.restoreAllMocks(); vi.unstubAllGlobals();
      for (const [key, value] of savedEnv) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });

  it('coletor corrige autoalvos com e sem releitura, grava versão/evento e preserva histórico', async () => {
    expect(await na(A, () => obsidian.reindex(A))).toBe(4);
    const initialReceipt = await lastReceipt();
    expect((initialReceipt.payload as any).recibo.leitura).toMatchObject({ lidos: 4, reaproveitados: 0 });
    const initialRows = await owner.contextItem.findMany({ where: { orgId: A }, orderBy: { chave: 'asc' } });
    const bad = initialRows.filter((r) => /cache|releitura/.test(r.chave));
    expect(bad).toHaveLength(2);
    for (const r of bad) {
      await na(A, () => memoria.alterar(A, r.id, { confidence: 0.75, motivo: 'histórico sintético anterior' }));
      // Corrupção sintética legada: aceita no banco, sem reescrever versões/eventos anteriores.
      await owner.contextItem.update({ where: { id: r.id }, data: { supersedesId: r.id } });
    }
    const before = await Promise.all(bad.map(async (r) => ({ row: await row(r.id), history: await history(r.id), vector: await vector(r.id) })));
    const previousEvents = await itemEvents();
    // Só uma nota muda o timestamp; cache.md passa pelo ramo sem baixar/reler cabeçalho.
    files[1].modificadoEm = new Date('2026-10-01T00:00:01Z');
    embed.mockClear(); listar.mockClear();
    const alterar = vi.spyOn(memoria, 'alterar');
    expect(await na(A, () => obsidian.reindex(A))).toBe(4);
    const gathered = await listar.mock.results[0].value;
    expect(gathered[0].ler).not.toHaveBeenCalled();
    expect(gathered[1].ler).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledTimes(1);
    const repairedReceipt = await lastReceipt();
    const payload = repairedReceipt.payload as any;
    expect(payload.recibo.leitura).toMatchObject({ lidos: 1, reaproveitados: 3 });
    expect(payload.recibo.projecao).toMatchObject({ alteradas: 2, falhas: 0, falhou: null });
    expect(payload.recibo.projecao.avisos).toHaveLength(2);
    // O EventLogService já converteu as marcas em hashes antes de persistir.
    expect(payload.recibo.projecao.avisos.every((a: any) => a.sigiloso === true
      && /^[a-f0-9]{64}$/.test(a.resumoCriptografico) && !('valor' in a))).toBe(true);
    const publicReceipt = JSON.stringify(semSigilosos(payload));
    const eventAfter = await itemEvents();
    expect(eventAfter).toHaveLength(previousEvents.length + 2);
    expect(eventAfter.slice(0, previousEvents.length)).toEqual(previousEvents);
    for (const old of before) {
      const now = await row(old.row.id), versions = await history(old.row.id);
      const { supersedesId: _self, versao, atualizadoEm: _time, ...kept } = old.row;
      expect(now).toMatchObject({ ...kept, supersedesId: null, versao: versao + 1 });
      expect(now.kind).toBe(ContextKind.regra);
      expect(await vector(now.id)).toBe(old.vector);
      expect(versions.slice(0, -1)).toEqual(old.history);
      expect(versions).toHaveLength(old.history.length + 1);
      const version = versions.at(-1)!;
      expect(version).toMatchObject({ mudanca: 'alteracao', contentHash: hashDoCorpo(now.body), semEventoPorque: null });
      const event = await owner.eventLog.findUniqueOrThrow({ where: { id: version.eventoId! } });
      expect(event.tipo).toBe('memoria.item.alterado'); expect(event.seq).toBe(version.eventoSeq);
      expect(event.contentHash).toBe(now.contentHash);
      expect(event.payload).toMatchObject({ itemId: now.id, versaoId: version.id, versao: version.versao,
        estadoAnterior: { supersedesId: now.id, versao }, estadoNovo: { supersedesId: null, versao: versao + 1 } });
      expect(publicReceipt).not.toContain(now.id); expect(publicReceipt).not.toContain(now.sourceRef!);
      expect(publicReceipt).not.toContain(now.body);
      const change = alterar.mock.calls.find((c) => c[1] === now.id)![2];
      if (now.chave.endsWith('cache.md')) {
        expect(change).not.toHaveProperty('kind'); expect(change).not.toHaveProperty('validFrom');
        expect(change).not.toHaveProperty('validUntil');
      }
      cases[now.chave.endsWith('cache.md') ? 'autoalvo_cache' : 'autoalvo_releitura'] = {
        itemId: now.id, antes: versao, depois: now.versao, contentHash: now.contentHash,
        historicoAnteriorHash: hash(old.history), historicoPreservadoHash: hash(versions.slice(0, -1)),
        versaoId: version.id, eventoId: event.id, seq: event.seq, hashEvento: event.hash,
      };
    }
    receipt.reciboCorrecao = { id: repairedReceipt.id, hash: repairedReceipt.hash, seq: repairedReceipt.seq,
      assinatura: payload.assinatura, publico: semSigilosos(payload) };
  }, 30_000);

  it('repetição pelo cache é idempotente; referência válida, versões, eventos e vetores permanecem', async () => {
    const before = await owner.contextItem.findMany({ where: { orgId: A }, orderBy: { id: 'asc' } });
    const versions = await owner.contextItemVersion.findMany({ where: { orgId: A }, orderBy: { id: 'asc' } });
    const events = await itemEvents();
    const vectors = await Promise.all(before.map((r) => vector(r.id)));
    const valid = before.find((r) => r.chave.endsWith('valida.md'))!, target = before.find((r) => r.chave.endsWith('alvo.md'))!;
    expect(valid.supersedesId).toBe(target.id);
    embed.mockClear(); const gravarVetor = vi.spyOn(memoria, 'gravarVetor');
    await na(A, () => obsidian.reindex(A));
    expect(await owner.contextItem.findMany({ where: { orgId: A }, orderBy: { id: 'asc' } })).toEqual(before);
    expect(await owner.contextItemVersion.findMany({ where: { orgId: A }, orderBy: { id: 'asc' } })).toEqual(versions);
    expect(await itemEvents()).toEqual(events);
    expect(await Promise.all(before.map((r) => vector(r.id)))).toEqual(vectors);
    expect(embed).not.toHaveBeenCalled(); expect(gravarVetor).not.toHaveBeenCalled();
    const last = await lastReceipt();
    expect((last.payload as any).recibo.projecao).toMatchObject({ alteradas: 0, inalteradas: 4, avisos: [], falhou: null });
    const count = await owner.eventLog.count({ where: { orgId: A } });
    await na(A, () => obsidian.reindex(A));
    expect(await owner.eventLog.count({ where: { orgId: A } })).toBe(count);
    cases.repeticao = { hashItens: hash(before), hashVersoes: hash(versions), hashEventos: hash(events),
      referenciaValida: { itemId: valid.id, alvoId: target.id }, eventosDepois: count };
  }, 30_000);

  it('duas organizações: leitura sem filtro é recortada pela RLS e alteração cruzada é negada', async () => {
    const foreignNote = lerNotaDaVault('somente-b.md', 'Conteúdo sintético exclusivo B');
    await na(B, () => memoria.projetarDaVault(B, [{ caminho: foreignNote.path, title: foreignNote.title,
      body: foreignNote.content, tags: [], cabecalho: foreignNote.cabecalho }]));
    const b = await owner.contextItem.findFirstOrThrow({ where: { orgId: B } });
    const rowsA = await na(A, () => app.$queryRawUnsafe<Array<{ orgId: string }>>('SELECT "orgId" FROM "ContextItem"'));
    expect(rowsA).toHaveLength(4); expect(rowsA.every((r) => r.orgId === A)).toBe(true);
    for (const table of ['ContextItem', 'ContextItemVersion', 'EventLog']) {
      const rows = await na(A, () => app.$queryRawUnsafe<Array<{ orgId: string }>>(`SELECT "orgId" FROM "${table}"`));
      expect(rows.length).toBeGreaterThan(0); expect(rows.every((r) => r.orgId === A)).toBe(true);
      const hidden = await na(A, () => app.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE "orgId"=$1`, B));
      expect(hidden).toEqual([]);
    }
    expect(await na(A, () => memoria.obter(A, b.id))).toBeNull();
    await expect(na(A, () => memoria.alterar(A, b.id, { body: 'tentativa cruzada' }))).rejects.toThrow('Nota não encontrada');
    expect(await na(A, () => app.$executeRawUnsafe('UPDATE "ContextItem" SET title=$1 WHERE id=$2', 'tentativa cruzada', b.id))).toBe(0);
    await expect(na(A, () => app.$executeRawUnsafe('UPDATE "ContextItem" SET "orgId"=$1 WHERE "orgId"=$2', B, A)))
      .rejects.toThrow(/row-level security/);
    const result = await na(A, () => memoria.projetarDaVault(A, [{ caminho: 'sem-alvo-a.md', title: 'Sem alvo A',
      body: 'Nota sintética A', tags: [], cabecalho: { kind: ContextKind.nota, validFrom: null, validUntil: null, substitui: 'somente-b.md' } }],
    { vistos: files.map((f) => f.caminho) }));
    const missing = await owner.contextItem.findFirstOrThrow({ where: { orgId: A, chave: 'vault:sem-alvo-a.md' } });
    expect(missing.supersedesId).toBeNull(); expect(result.substituicoes.semAlvo).toBe(1);
    expect(JSON.stringify(result)).not.toContain(b.id); expect(JSON.stringify(result)).not.toContain(b.body);
    expect(await row(b.id)).toEqual(b);
    await expect(na(B, () => obsidian.reindex(B))).rejects.toThrow('só ela reindexa');
    await expect(app.contextItem.findMany()).rejects.toThrow('tenant não resolvido');
    const c = await pool.connect();
    try {
      await c.query('BEGIN'); await c.query("SELECT set_config('app.org_id',$1,true)", [A]);
      expect((await c.query('SELECT id FROM "ContextItem"')).rowCount).toBe(5);
      await c.query('COMMIT');
      expect((await c.query('SELECT id FROM "ContextItem"')).rowCount).toBe(0);
    } finally { await c.query('ROLLBACK'); c.release(); }
    cases.isolamento = { itemB: b.id, hashItemB: hash(b), leituraSemFiltroA: rowsA.length,
      alvoOutraOrg: null, escritaCruzada: 'negada', semTenant: 'negado', sessaoAposCommit: 'zero linhas' };
  }, 30_000);

  it('revogação do papel no banco nega leitura e escrita na conexão já aberta', async () => {
    const count = await na(A, () => app.contextItem.count()); expect(count).toBe(5);
    const versions = await owner.contextItemVersion.count({ where: { orgId: A } });
    const events = await owner.eventLog.count({ where: { orgId: A } });
    await owner.$executeRawUnsafe('REVOKE mktos_app FROM ctx_probe');
    try {
      await expect(na(A, () => app.contextItem.findMany())).rejects.toThrow(/permission denied/);
      const c = await pool.connect();
      try {
        await expect(c.query('SELECT id FROM "ContextItem"')).rejects.toMatchObject({ code: '42501' });
        await expect(c.query('UPDATE "ContextItem" SET title=$1', ['revogado'])).rejects.toMatchObject({ code: '42501' });
      } finally { c.release(); }
    } finally { await owner.$executeRawUnsafe('GRANT mktos_app TO ctx_probe'); }
    expect(await na(A, () => app.contextItem.count())).toBe(count);
    expect(await owner.contextItemVersion.count({ where: { orgId: A } })).toBe(versions);
    expect(await owner.eventLog.count({ where: { orgId: A } })).toBe(events);
    cases.revogacao = { escopo: 'membership SQL do papel sintético; não ACL de usuário/Drive', sqlstate: '42501',
      versoesPreservadas: versions, eventosPreservados: events, acessoRestaurado: true };
  }, 30_000);

  it('inspeção direta confirma elos e hashes da cadeia persistida', async () => {
    const audits = [];
    for (const org of [A, B]) {
      const integrity = await na(org, () => memoria.conferirElos(org));
      const chain = await na(org, () => eventos.verificar(org));
      expect(integrity.ok).toBe(true); expect(integrity.semElo).toEqual([]); expect(integrity.divergentes).toEqual([]);
      expect(chain.ok).toBe(true);
      audits.push({ orgId: org, integrity, chain });
    }
    receipt.integridade = audits;
    receipt.itens = await owner.contextItem.findMany({ where: { orgId: { in: [A, B] } }, orderBy: { id: 'asc' },
      select: { id: true, orgId: true, kind: true, versao: true, contentHash: true, supersedesId: true, validFrom: true, validUntil: true, confidence: true } });
    receipt.versoes = await owner.contextItemVersion.findMany({ where: { orgId: { in: [A, B] } }, orderBy: { id: 'asc' },
      select: { id: true, itemId: true, orgId: true, versao: true, contentHash: true, eventoId: true, eventoSeq: true, semEventoPorque: true } });
    receipt.eventos = await owner.eventLog.findMany({ where: { orgId: { in: [A, B] } }, orderBy: [{ orgId: 'asc' }, { seq: 'asc' }],
      select: { id: true, orgId: true, tipo: true, seq: true, hash: true, prevHash: true, contentHash: true } });
    expect(fetch).not.toHaveBeenCalled();
    receipt.httpExterno = 'bloqueado; zero chamadas fetch';
    receipt.substituicoes = ['listarNoDrive: arquivos sintéticos em memória', 'embed: vetores determinísticos de 1536 dimensões'];
    receipt.limites = ['Revisão independente pendente', 'Sem Vault/Drive real, ACL de usuário, produção ou encerramento ROOT19–24'];
  }, 30_000);
});
