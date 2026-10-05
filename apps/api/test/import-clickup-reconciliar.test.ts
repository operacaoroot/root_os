import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { SnapshotSchema, validarSnapshot } from '../prisma/import-clickup-work.contract';
import { inventariar } from '../prisma/import-clickup-work.plan';
import {
  ACAO_RECONCILIACAO, aplicarReconciliacao, avaliarReconciliacao, classificarRollback, fingerprintImportado, reconciliarTarefa, reverterLote,
} from '../prisma/import-clickup-work';
import { exigirBancoDescartavel } from './banco-de-teste';
import { travarSuiteDoImportador } from './trava-do-importador';

/*
 * ROOT-11, P4: `--reconciliar 86ak8h6kq`. O cartão foi reaproveitado no ClickUp
 * depois do apply de 30/09 (título e descrição trocados; os outros 15 campos
 * iguais). Tudo abaixo roda num lote sintético importado pela própria CLI, num
 * banco descartável; nada aqui toca o ClickUp nem a produção.
 */
const URL_DO_TESTE = process.env.TEST_DATABASE_URL;
const ORG = '8a8a8a8a-8a8a-48a8-88a8-8a8a8a8a8a8a';
const ALVO = '86ak8h6kq';
const LISTAS = ['901328341442', '901328341443', '901328341445', '901328341450', '901328341456', '901328341455', '901328341451'];
const TITULO_V1 = '[ROOT-CONCEITO] [FIXADO · RESERVADO] Filme conceitual — da criação à IA';
const DESCRICAO_V1 = 'Card reservado do filme conceitual. NÃO DESENVOLVER AGORA.';
const TITULO_V2 = 'Post 1 - O humano é o único animal que aceitou virar máquina ';
const DESCRICAO_V2 = 'Texto do Post 1, sem relação com o anterior.';

function tarefa(id: string, listaIdx: number, extra: Record<string, unknown> = {}) {
  return {
    id, listId: LISTAS[listaIdx], statusId: `${LISTAS[listaIdx]}-todo`, title: `Tarefa ${id}`, description: `Texto ${id}`,
    priority: 'alta', assignees: [{ id: 'p1', name: 'Pedro' }], startDate: null, dueDate: '2026-10-05T12:00:00.000Z',
    createdAt: '2026-09-20T12:00:00.000Z', updatedAt: '2026-09-28T10:00:00.000Z', parentId: null, archived: false, order: 0,
    url: `https://app.clickup.com/t/${id}`, tags: [{ id: 'tag-roteiro', name: 'Roteiro', color: '#ffcc00' }],
    fieldValues: [{ fieldId: `${LISTAS[listaIdx]}-data`, value: '2026-10-01' }],
    comments: [{ id: `c-${id}`, authorId: 'p1', authorName: 'Pedro', text: `Comentário ${id}`, createdAt: '2026-09-28T10:00:00.000Z' }],
    attachments: [], checklists: [], dependencies: [], ...extra,
  };
}
function snapshot(alvo: Record<string, unknown> = {}, outras: Record<string, Record<string, unknown>> = {}) {
  return SnapshotSchema.parse({
    schemaVersion: 1, source: 'clickup', capturedAt: '2026-09-29T04:00:00.000Z', spaceId: '901313864063',
    scope: { folderPath: ['Demandas internas', 'Marketing'], listIds: LISTAS },
    completeness: { allLists: true, allTasks: true, includeClosed: true, paginationComplete: true }, extractionGaps: [], unknownSourceFields: [],
    folders: [{ id: 'demandas', name: 'Demandas internas', parentId: null }, { id: 'marketing', name: 'Marketing', parentId: 'demandas' }],
    lists: LISTAS.map((id, order) => ({
      id, name: `Lista ${order}`, folderId: 'marketing', order,
      statuses: [
        { id: `${id}-todo`, name: 'to do', type: 'open', color: '#87909e', order: 0 },
        { id: `${id}-done`, name: 'complete', type: 'closed', color: '#00aa00', order: 1 },
      ],
      fields: [{ id: `${id}-data`, name: 'Data de Publicação', type: 'data', order: 0, options: [] }],
    })),
    tasks: [
      tarefa('root-001', 0, outras['root-001'] ?? {}),
      tarefa('outra-1', 1, outras['outra-1'] ?? {}),
      tarefa(ALVO, 1, { title: TITULO_V1, description: DESCRICAO_V1, updatedAt: '2026-09-28T23:09:51.000Z', ...alvo }),
    ],
  });
}
const V1 = () => snapshot();
const V2 = () => snapshot({ title: TITULO_V2, description: DESCRICAO_V2, updatedAt: '2026-09-30T18:40:30.000Z' });
const especificacoes = (s: ReturnType<typeof snapshot>) => inventariar(s, ORG, validarSnapshot(s).caminhos).specs;
const idDe = (chave: string) => especificacoes(V1()).find((x) => x.chave === chave)!.id;
const NATIVO = 'Pessoa do OS';
const dormir = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

exigirBancoDescartavel(URL_DO_TESTE ?? '', 'ESCREVE nele (uma empresa com o lote sintético da reconciliação)');

describe.skipIf(!URL_DO_TESTE)('importador ClickUp → Work: --reconciliar (ROOT-11 P4)', () => {
  let db: PrismaClient;
  let dir: string;
  let gancho: string;
  const dirs: string[] = [];
  const idAlvo = idDe(`task:${ALVO}`);

  const argv = (args: string[], arquivo: string, alvo = ['--org-id', ORG, '--manifest-dir', dir]) =>
    ['--import', 'tsx', 'prisma/import-clickup-work.ts', '--snapshot', arquivo, ...alvo, ...args];
  const cli = (args: string[], arquivo: string, o: { alvo?: string[]; antes?: string[] } = {}) =>
    spawnSync(process.execPath, [...(o.antes ?? []), ...argv(args, arquivo, o.alvo)],
      { cwd: resolve('.'), env: { ...process.env, DATABASE_URL: URL_DO_TESTE }, encoding: 'utf8' });
  // Queda real depois do COMMIT: o processo morre ao trocar o manifesto (o primeiro rename depois da transação).
  const morrerAoTrocarOManifesto = () => ({ antes: ['--require', gancho] });
  const gravar = (nome: string, s: unknown) => { const f = join(dir, '..', `${nome}-${process.pid}.json`); writeFileSync(f, JSON.stringify(s)); dirs.push(f); return f; };
  const manifestPath = () => join(dir, readdirSync(dir).find((f) => f.endsWith('.manifest.json'))!);
  const manifesto = () => JSON.parse(readFileSync(manifestPath(), 'utf8'));
  const rodar = (apply: boolean, s = V2(), externalId = ALVO, extra: Record<string, unknown> = {}) => reconciliarTarefa(db, {
    externalId, orgId: ORG, snapshot: s, raw: JSON.stringify(s), novos: especificacoes(s), dir, manifestPath: manifestPath(),
    manifest: manifesto(), apply, ...extra,
  });
  const entrada = (s = V2(), externalId = ALVO) => ({
    externalId, orgId: ORG, spaceId: s.spaceId, novos: especificacoes(s), base: especificacoes(V1()), manifest: manifesto(),
  });
  const estado = async () => JSON.stringify({
    tarefas: await db.workTask.findMany({ where: { orgId: ORG }, orderBy: { id: 'asc' }, include: { tags: { select: { id: true } } } }),
    comentarios: await db.workComment.count({ where: { orgId: ORG } }), valores: await db.workFieldValue.count({ where: { orgId: ORG } }),
    auditoria: await db.auditLog.findMany({ where: { orgId: ORG }, orderBy: { id: 'asc' } }),
  });
  const rastros = () => db.auditLog.findMany({ where: { orgId: ORG, action: ACAO_RECONCILIACAO } });
  const linhaDoAlvo = () => db.workTask.findUniqueOrThrow({ where: { id: idAlvo } });

  async function limpar() {
    await db.auditLog.deleteMany({ where: { orgId: ORG } });
    await db.workTask.deleteMany({ where: { orgId: ORG } });
    await db.workField.deleteMany({ where: { orgId: ORG } });
    await db.workTag.deleteMany({ where: { orgId: ORG } });
    await db.workList.deleteMany({ where: { orgId: ORG } });
    await db.workFolder.deleteMany({ where: { orgId: ORG, parentId: { not: null } } });
    await db.workFolder.deleteMany({ where: { orgId: ORG } });
  }
  async function importarLote(s: ReturnType<typeof snapshot>) {
    await limpar();
    dir = mkdtempSync(join(tmpdir(), 'clickup-reconciliar-'));
    chmodSync(dir, 0o700);
    dirs.push(dir);
    const importacao = cli(['--apply'], gravar('lote', s));
    if (importacao.status !== 0) throw new Error(`lote sintético não entrou: ${importacao.stderr}`);
  }

  // Queda real antes do COMMIT: o gatilho segura a transação da CLI no INSERT do RASTRO (só desta empresa) e o processo morre ali.
  async function tirarGatilhoDeSono() {
    await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS teste_reconciliar_dorme ON "AuditLog"');
    await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS teste_reconciliar_dorme()');
  }
  const conexoes = async (nome: string, soDormindo = false) => Number((await db.$queryRawUnsafe<Array<{ n: bigint }>>(
    `select count(*)::bigint as n from pg_stat_activity where application_name = $1${soDormindo ? ` and wait_event = 'PgSleep'` : ''}`, nome))[0].n);
  async function esperar(condicao: () => Promise<boolean>, erro: string) {
    const ate = Date.now() + 60000;
    while (Date.now() < ate) {
      if (await condicao()) return;
      await dormir(100);
    }
    throw new Error(erro);
  }
  async function quedaAntesDoCommit(arquivo: string) {
    const nome = `teste-reconciliar-queda-${process.pid}-${Date.now()}`;
    const url = new URL(URL_DO_TESTE!);
    url.searchParams.set('application_name', nome);
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION teste_reconciliar_dorme() RETURNS trigger AS $$ BEGIN
      IF NEW."action" = '${ACAO_RECONCILIACAO}' AND NEW."orgId" = '${ORG}' THEN PERFORM pg_sleep(3); END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe('CREATE TRIGGER teste_reconciliar_dorme BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION teste_reconciliar_dorme()');
    try {
      const p = spawn(process.execPath, argv(['--reconciliar', ALVO, '--apply'], arquivo),
        { cwd: resolve('.'), env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'ignore' });
      const fim = new Promise<NodeJS.Signals | null>((ok) => p.on('close', (_codigo, sinal) => ok(sinal)));
      try { await esperar(async () => await conexoes(nome, true) > 0, 'a transação da CLI não chegou ao gatilho'); }
      finally { p.kill('SIGKILL'); }
      expect(await fim).toBe('SIGKILL');
      await esperar(async () => await conexoes(nome) === 0, 'a transação da CLI morta não terminou no servidor');
    } finally { await tirarGatilhoDeSono(); }
  }

  // Uma suíte da CLI do importador por vez no banco (trava-do-importador.ts). Os ganchos "after"
  // rodam em pilha no vitest, então a trava só sai depois da limpeza abaixo.
  let soltarTrava: () => Promise<void> = async () => {};
  beforeAll(async () => { soltarTrava = await travarSuiteDoImportador(URL_DO_TESTE!); }, 300_000);
  afterAll(async () => { await soltarTrava(); });
  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: URL_DO_TESTE } } });
    await db.org.upsert({ where: { id: ORG }, create: { id: ORG, name: 'reconciliar', slug: 'reconciliar-p4' }, update: {} });
    const pasta = mkdtempSync(join(tmpdir(), 'clickup-reconciliar-queda-'));
    dirs.push(pasta);
    gancho = join(pasta, 'morrer-ao-trocar-o-manifesto.cjs');
    writeFileSync(gancho, `const fs = require('node:fs');
const original = fs.renameSync;
fs.renameSync = function (de, para) {
  if (String(para).endsWith('.manifest.json')) process.kill(process.pid, 'SIGKILL');
  return original.apply(this, arguments);
};
`);
  });
  afterAll(async () => {
    if (!db) return;
    await tirarGatilhoDeSono();
    await limpar();
    await db.org.deleteMany({ where: { id: ORG } });
    await db.$disconnect();
    for (const f of dirs) rmSync(f, { recursive: true, force: true });
  });
  beforeEach(async () => { await importarLote(V1()); }, 120000);

  it('divergência histórica: o dry-run mostra título e descrição antes/depois e não escreve nada', async () => {
    const antes = await estado();
    const arquivos = readdirSync(dir).sort();
    const r = await rodar(false);
    expect(r).toMatchObject({ mode: 'reconciliar-dry-run', estado: 'reconciliar', externalId: ALVO, nativeId: idAlvo, camposAlterados: ['description', 'title'],
      rollbackDoLote: { estado: 'pronto' } });
    expect(r).toMatchObject({ antes: { title: TITULO_V1 }, depois: { title: TITULO_V2 } });
    expect((r.antes as { descricao: { caracteres: number } }).descricao.caracteres).toBe(DESCRICAO_V1.length);
    expect((r.depois as { descricao: { sha256: string } }).descricao.sha256).toBe(createHash('sha256').update(DESCRICAO_V2).digest('hex'));
    expect(await estado()).toBe(antes);
    expect(readdirSync(dir).sort()).toEqual(arquivos);
  });

  it('o importador comum continua recusando o lote por causa do cartão (a opção é explícita, não automática)', () => {
    const r = cli([], gravar('v2', V2()));
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).conflicts.join(' ')).toContain(`task:${ALVO}: registro nativo divergiu`);
    expect(cli(['--apply'], gravar('v2', V2())).status).toBe(1);
  });

  it('apply: troca só título, descrição e updatedAt de origem, preserva UUID e vizinhança, grava o RASTRO e o origemHash', async () => {
    const outrasAntes = (await db.workTask.findMany({ where: { orgId: ORG, id: { not: idAlvo } }, orderBy: { id: 'asc' }, include: { tags: true } }));
    const antes = await linhaDoAlvo();
    const comentariosAntes = await db.workComment.findMany({ where: { taskId: idAlvo }, orderBy: { id: 'asc' } });
    const contar = async () => [await db.workTask.count({ where: { orgId: ORG } }), await db.workComment.count({ where: { orgId: ORG } }),
      await db.workFieldValue.count({ where: { orgId: ORG } }), await db.workTag.count({ where: { orgId: ORG } })];
    const contagensAntes = await contar();
    const specsNovos = especificacoes(V2());
    const r = await rodar(true);
    expect(r).toMatchObject({ estado: 'reconciliar', nativeId: idAlvo });
    // A exclusão que a reconciliação mediu no savepoint foi desfeita antes do COMMIT: nenhuma linha sumiu.
    expect(await contar()).toEqual(contagensAntes);
    const depois = await linhaDoAlvo();
    expect(depois.id).toBe(idAlvo);
    expect([depois.title, depois.description]).toEqual([TITULO_V2, DESCRICAO_V2]);
    expect(depois.updatedAt.toISOString()).toBe('2026-09-30T18:40:30.000Z');
    expect({ ...depois, title: 0, description: 0, updatedAt: 0 }).toEqual({ ...antes, title: 0, description: 0, updatedAt: 0 });
    expect(await db.workTask.findMany({ where: { orgId: ORG, id: { not: idAlvo } }, orderBy: { id: 'asc' }, include: { tags: true } })).toEqual(outrasAntes);
    expect(await db.workComment.findMany({ where: { taskId: idAlvo }, orderBy: { id: 'asc' } })).toEqual(comentariosAntes);
    const rastros1 = await rastros();
    expect(rastros1).toHaveLength(1);
    expect(rastros1[0]).toMatchObject({ actorType: 'system', entityType: 'work_task', entityId: idAlvo,
      before: { title: TITULO_V1, description: DESCRICAO_V1 }, after: { title: TITULO_V2, description: DESCRICAO_V2 } });
    const m = manifesto();
    expect(m.records[`task:${ALVO}`]).toEqual({ id: idAlvo, origemHash: specsNovos.find((x) => x.chave === `task:${ALVO}`)!.origemHash });
    expect(m.reconciliations).toHaveLength(1);
    expect(m.reconciliations[0]).toMatchObject({ deOrigemHash: (r.origemHash as { de: string }).de, paraOrigemHash: (r.origemHash as { para: string }).para, auditId: rastros1[0].id });
    expect(readdirSync(dir).some((f) => f.includes('reconciliar') && f.endsWith('.pre-apply.json'))).toBe(true);
  });

  it('lote intacto: depois da reconciliação o importador comum passa (107 tarefas no caso real), o rollback do lote continua pronto e não apaga o RASTRO', async () => {
    const importado = manifesto().runs.at(-1);
    const r = await rodar(true);
    const comum = cli([], gravar('v2', V2()));
    expect(comum.status).toBe(0);
    expect(JSON.parse(comum.stdout)).toMatchObject({ toCreate: 0, conflicts: [] });
    const run = manifesto().runs.at(-1);
    expect(run.postFingerprintDoImport).toBe(importado.postFingerprint);
    expect(run.postFingerprint).toBe(manifesto().reconciliations[0].postFingerprint);
    expect(classificarRollback(await fingerprintImportado(db, especificacoes(V1())), run)).toBe('pronto');
    const confere = cli(['--rollback'], gravar('v1', V1()));
    expect(confere.status).toBe(0);
    expect(JSON.parse(confere.stdout)).toMatchObject({ rollbackSafe: true });
    const desfeito = cli(['--rollback', '--apply'], gravar('v1', V1()));
    expect(desfeito.status).toBe(0);
    expect(await db.workTask.count({ where: { orgId: ORG } })).toBe(0);
    expect(await rastros()).toHaveLength(1);
    expect(manifesto().runs.at(-1).rolledBackAt).toBeTruthy();
    // O estado que o rollback deixou é o que a reconciliação mediu no savepoint, com o RASTRO dela.
    expect(await fingerprintImportado(db, especificacoes(V1()))).toBe(run.fingerprintAposRollback);
    expect(manifesto().reconciliations[0]).toMatchObject({ preFingerprint: importado.postFingerprint, rollbackDoLote: 'pronto' });
    expect(r).toMatchObject({ estado: 'reconciliar', rollbackDoLote: { estado: 'pronto' } });
  });

  it('replay: segundo apply é no-op, sem novo RASTRO, sem novo arquivo e sem mexer em IDs', async () => {
    await rodar(true);
    const estadoDepois = await estado();
    const m1 = readFileSync(manifestPath(), 'utf8');
    const arquivos = readdirSync(dir).sort();
    const r = await rodar(true);
    expect(r).toMatchObject({ estado: 'igual', noOp: true });
    expect(await estado()).toBe(estadoDepois);
    expect(readFileSync(manifestPath(), 'utf8')).toBe(m1);
    expect(readdirSync(dir).sort()).toEqual(arquivos);
    expect(await rastros()).toHaveLength(1);
  });

  it('nova mudança de origem depois de reconciliar parte da reconciliação anterior, não do lote', async () => {
    await rodar(true);
    const v3 = snapshot({ title: 'Post 1 (revisado)', description: DESCRICAO_V2, updatedAt: '2026-10-01T10:00:00.000Z' });
    const r = await rodar(true, v3);
    expect(r).toMatchObject({ estado: 'reconciliar', camposAlterados: ['title'] });
    expect((await linhaDoAlvo()).title).toBe('Post 1 (revisado)');
    expect(manifesto().reconciliations).toHaveLength(2);
    expect(await rastros()).toHaveLength(2);
  });

  it.each([
    ['título', { title: 'Editado à mão no OS' }],
    ['descrição', { description: 'Editada à mão no OS' }],
    ['prioridade (fora do par título/descrição)', { priority: 'baixa' as const }],
  ])('edição local (%s) é recusada em dry-run e em apply, sem escrita', async (_nome, edicao) => {
    await db.workTask.update({ where: { id: idAlvo }, data: edicao });
    const antes = await estado();
    const arquivos = readdirSync(dir).sort();
    const m1 = readFileSync(manifestPath(), 'utf8');
    for (const apply of [false, true]) {
      const r = await rodar(apply);
      expect(r).toMatchObject({ estado: 'recusada', recusada: true });
      expect((r.motivos as string[]).join(' ')).toContain('edição local');
    }
    expect(await estado()).toBe(antes);
    expect(readdirSync(dir).sort()).toEqual(arquivos);
    expect(readFileSync(manifestPath(), 'utf8')).toBe(m1);
    expect(await rastros()).toHaveLength(0);
  });

  it('a CLI sai com código 2 na recusa e com 0 no dry-run bom', async () => {
    const arquivo = gravar('v2', V2());
    const bom = cli(['--reconciliar', ALVO], arquivo);
    expect(bom.status).toBe(0);
    expect(JSON.parse(bom.stdout)).toMatchObject({ mode: 'reconciliar-dry-run', estado: 'reconciliar' });
    await db.workTask.update({ where: { id: idAlvo }, data: { title: 'Editado' } });
    const ruim = cli(['--reconciliar', ALVO], arquivo);
    expect(ruim.status).toBe(2);
    expect(JSON.parse(ruim.stdout).motivos.join(' ')).toContain('edição local');
    expect(cli(['--reconciliar', ALVO, '--offline'], arquivo).status).toBe(1);
    expect(cli(['--reconciliar', ALVO, '--rollback'], arquivo).status).toBe(1);
  });

  it('a CLI reconcilia só com --apply e o replay pela CLI é no-op', async () => {
    const arquivo = gravar('v2', V2());
    expect(cli(['--reconciliar', ALVO, '--apply'], arquivo).status).toBe(0);
    expect((await linhaDoAlvo()).title).toBe(TITULO_V2);
    const replay = cli(['--reconciliar', ALVO, '--apply'], arquivo);
    expect(replay.status).toBe(0);
    expect(JSON.parse(replay.stdout)).toMatchObject({ estado: 'igual', noOp: true });
    expect(await rastros()).toHaveLength(1);
  });

  it('mudança concorrente no cartão entre o plano e a transação é recusada e a edição concorrente fica', async () => {
    const e = entrada();
    const av = await avaliarReconciliacao(db, e);
    if (av.estado !== 'reconciliar') throw new Error('esperava reconciliar');
    const pre = await fingerprintImportado(db, e.base);
    await db.workTask.update({ where: { id: idAlvo }, data: { title: 'Edição concorrente' } });
    await expect(aplicarReconciliacao(db, e, av, pre, { snapshotSha256: 'x', snapshotFile: 'x' })).rejects.toThrow('mudou durante o planejamento');
    expect((await linhaDoAlvo()).title).toBe('Edição concorrente');
    expect(await rastros()).toHaveLength(0);
  });

  it('mudança concorrente em outra linha do lote (comentário nativo) também recusa, pelo fingerprint', async () => {
    const e = entrada();
    const av = await avaliarReconciliacao(db, e);
    if (av.estado !== 'reconciliar') throw new Error('esperava reconciliar');
    const pre = await fingerprintImportado(db, e.base);
    const outra = especificacoes(V1()).find((x) => x.chave === 'task:outra-1')!.id;
    await db.workComment.create({ data: { orgId: ORG, taskId: outra, authorName: 'Pessoa', text: 'nativo' } });
    await expect(aplicarReconciliacao(db, e, av, pre, { snapshotSha256: 'x', snapshotFile: 'x' })).rejects.toThrow('Banco mudou após o backup');
    expect((await linhaDoAlvo()).title).toBe(TITULO_V1);
    expect(await rastros()).toHaveLength(0);
  });

  it('transacional: se o RASTRO falha, a linha não muda, o manifesto fica igual e a tentativa seguinte funciona', async () => {
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION falha_rastro_reconciliacao() RETURNS trigger AS $$ BEGIN
      IF NEW."action" = '${ACAO_RECONCILIACAO}' THEN RAISE EXCEPTION 'falha simulada do rastro'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe('CREATE TRIGGER falha_rastro_reconciliacao BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION falha_rastro_reconciliacao()');
    const linhaAntes = await linhaDoAlvo();
    const m1 = readFileSync(manifestPath(), 'utf8');
    try {
      await expect(rodar(true)).rejects.toThrow(/falha simulada do rastro/);
      expect(await linhaDoAlvo()).toEqual(linhaAntes);
      expect(readFileSync(manifestPath(), 'utf8')).toBe(m1);
      expect(await rastros()).toHaveLength(0);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER falha_rastro_reconciliacao ON "AuditLog"');
      await db.$executeRawUnsafe('DROP FUNCTION falha_rastro_reconciliacao()');
    }
    expect(await rodar(true)).toMatchObject({ estado: 'reconciliar' });
    expect(await rastros()).toHaveLength(1);
  });

  it('queda entre o COMMIT e o manifesto: o replay recompõe o manifesto sem novo RASTRO e sem reabrir o rollback do lote', async () => {
    const e = entrada();
    const av = await avaliarReconciliacao(db, e);
    if (av.estado !== 'reconciliar') throw new Error('esperava reconciliar');
    await aplicarReconciliacao(db, e, av, await fingerprintImportado(db, e.base), { snapshotSha256: 'x', snapshotFile: 'x' });
    expect(manifesto().reconciliations).toBeUndefined();
    const execucao = manifesto().runs.at(-1);
    const r = await rodar(true);
    expect(r).toMatchObject({ estado: 'recuperar-manifesto', manifestRecuperado: true, rollbackDoLote: { estado: 'bloqueado' } });
    expect(await rastros()).toHaveLength(1);
    const m = manifesto();
    expect(m.reconciliations[0]).toMatchObject({ recoveredWithoutRollback: true, postFingerprint: null, rollbackDoLote: 'bloqueado' });
    expect(m.records[`task:${ALVO}`].origemHash).toBe(av.paraOrigemHash);
    expect(m.runs.at(-1)).toEqual(execucao);
    expect(cli(['--rollback'], gravar('v1', V1())).status).toBe(2);
    expect(await rodar(true)).toMatchObject({ estado: 'igual', noOp: true });
  });

  it('edição local que por coincidência iguala a origem nova, sem RASTRO de reconciliação, não é aceita', async () => {
    await db.workTask.update({ where: { id: idAlvo }, data: { title: TITULO_V2, description: DESCRICAO_V2 } });
    const r = await rodar(true);
    expect(r).toMatchObject({ estado: 'recusada' });
    expect((r.motivos as string[]).join(' ')).toContain('edição local');
    expect(await rastros()).toHaveLength(0);
  });

  it('ID inválido, ausente do snapshot e ausente do banco são recusados sem escrita', async () => {
    const antes = await estado();
    for (const id of ['a,b', '*', '', ' ', 'todos os cartões', '../x']) {
      const r = await rodar(true, V2(), id);
      expect(r).toMatchObject({ estado: 'recusada' });
      expect((r.motivos as string[])[0]).toContain('ID inválido');
    }
    expect(((await rodar(true, V2(), 'nao-existe')).motivos as string[])[0]).toContain('ausente do snapshot');
    const comNova = snapshot();
    comNova.tasks.push(SnapshotSchema.parse({ ...V1(), tasks: [tarefa('nova-so-na-origem', 2)] }).tasks[0]);
    expect(((await rodar(true, comNova, 'nova-so-na-origem')).motivos as string[]).join(' ')).toContain('ausente do banco');
    const semRegistro = manifesto();
    delete semRegistro.records[`task:${ALVO}`];
    writeFileSync(manifestPath(), JSON.stringify(semRegistro));
    expect(((await rodar(true)).motivos as string[]).join(' ')).toContain('não consta do manifesto');
    expect(await estado()).toBe(antes);
    expect(await rastros()).toHaveLength(0);
  });

  it('ID ambíguo no banco (mais de uma linha, ou UUID que não é o determinístico) é recusado', async () => {
    const e = entrada();
    const falso = (linhas: Array<{ id: string }>) => ({ workTask: { findMany: async () => linhas } }) as unknown as PrismaClient;
    for (const linhas of [[{ id: idAlvo }, { id: 'outra-linha' }], [{ id: 'uuid-nativo-estranho' }]]) {
      const r = await avaliarReconciliacao(falso(linhas), e);
      expect(r).toMatchObject({ estado: 'recusada' });
      expect((r as { motivos: string[] }).motivos[0]).toContain('ambíguo no banco');
    }
    const duplicado = entrada();
    duplicado.novos = [...duplicado.novos, duplicado.novos.find((x) => x.chave === `task:${ALVO}`)!];
    expect(((await avaliarReconciliacao(db, duplicado)) as { motivos: string[] }).motivos[0]).toContain('ambíguo no snapshot');
  });

  it('conflito fora da lista explícita recusa a reconciliação inteira, mesmo com o cartão alvo intacto', async () => {
    const outra = especificacoes(V1()).find((x) => x.chave === 'task:outra-1')!.id;
    await db.workTask.update({ where: { id: outra }, data: { title: 'Editado em outro cartão' } });
    const antes = await estado();
    const r = await rodar(true);
    expect(r).toMatchObject({ estado: 'recusada' });
    expect((r.motivos as string[]).join(' ')).toContain('conflitos fora da lista explícita');
    expect((r.motivos as string[]).join(' ')).toContain('task:outra-1');
    expect(await estado()).toBe(antes);
  });

  it('origem que mudou fora de título/descrição no cartão alvo (prazo) é recusada', async () => {
    const r = await rodar(true, snapshot({ title: TITULO_V2, description: DESCRICAO_V2, dueDate: '2026-11-01T12:00:00.000Z' }));
    expect(r).toMatchObject({ estado: 'recusada' });
    expect((r.motivos as string[]).join(' ')).toContain('fora de título/descrição (dueDate)');
    expect((await linhaDoAlvo()).title).toBe(TITULO_V1);
  });

  it('snapshot do lote adulterado ou sumido recusa: sem a versão importada não há prova de que o cartão está intacto', async () => {
    const m = manifesto();
    const arquivo = join(dir, m.runs.at(-1).snapshotFile.split('/').at(-1));
    const original = readFileSync(arquivo, 'utf8');
    writeFileSync(arquivo, original.replace(TITULO_V1, 'outro título'));
    expect(((await rodar(true)).motivos as string[]).join(' ')).toContain('não confere com o hash');
    rmSync(arquivo);
    expect(((await rodar(true)).motivos as string[]).join(' ')).toContain('ilegível');
    expect((await linhaDoAlvo()).title).toBe(TITULO_V1);
  });

  it('fixture com anexos: a descrição nova leva os links internos da regra existente e o manifesto guarda o anexo conferido', async () => {
    const raiz = mkdtempSync(join(tmpdir(), 'clickup-reconciliar-anexos-'));
    dirs.push(raiz);
    const bytes = Buffer.from('filme preservado');
    const caminho = join(raiz, 'filme.pdf');
    writeFileSync(caminho, bytes);
    const anexo = { id: 'ax1', name: 'filme.pdf', url: `/api/trabalho/arquivos/${ALVO}/ax1`, sha256: createHash('sha256').update(bytes).digest('hex'), localPath: caminho, size: bytes.length };
    const comAnexo = snapshot({ title: TITULO_V2, description: DESCRICAO_V2, updatedAt: '2026-09-30T18:40:30.000Z', attachments: [anexo] });
    const r = await rodar(true, comAnexo, ALVO, { raizDosAnexos: raiz });
    expect(r).toMatchObject({ estado: 'reconciliar' });
    expect((await linhaDoAlvo()).description).toBe(`${DESCRICAO_V2}\n\nAnexos preservados\n- [filme.pdf](/api/trabalho/arquivos/${ALVO}/ax1)`);
    expect(manifesto().attachments[ALVO]).toEqual([expect.objectContaining({ id: 'ax1', sha256: anexo.sha256 })]);
  });

  it('anexo com bytes diferentes do snapshot recusa a reconciliação', async () => {
    const raiz = mkdtempSync(join(tmpdir(), 'clickup-reconciliar-anexos-'));
    dirs.push(raiz);
    const caminho = join(raiz, 'filme.pdf');
    writeFileSync(caminho, 'bytes que não são os do snapshot');
    const anexo = { id: 'ax1', name: 'filme.pdf', url: `/api/trabalho/arquivos/${ALVO}/ax1`, sha256: 'a'.repeat(64), localPath: caminho };
    const r = await rodar(true, snapshot({ title: TITULO_V2, description: DESCRICAO_V2, attachments: [anexo] }), ALVO, { raizDosAnexos: raiz });
    expect(r).toMatchObject({ estado: 'recusada' });
    expect((r.motivos as string[]).join(' ')).toContain('SHA-256');
    expect((await linhaDoAlvo()).title).toBe(TITULO_V1);
  });

  /*
   * Rollback do lote depois da reconciliação (revisão FUL-35, achados A1 e A2).
   * A1: com mudança nativa no lote, a reconciliação não pode mover o fingerprint
   * da execução; senão o rollback seguinte apagaria, em cascata, o que foi criado
   * no OS. A2: depois de reconciliar, a queda entre o COMMIT do rollback e o
   * `rolledBackAt` precisa ser reconhecida sem aceitar outro desvio.
   */
  const lista1 = () => idDe(`list:${LISTAS[1]}`);
  const etapa1 = () => idDe(`status:${LISTAS[1]}:${LISTAS[1]}-todo`);
  const nadaAPreparar = async (): Promise<unknown> => undefined;
  const comentarioEmOutra = (): Promise<unknown> => db.workComment.create({ data: { orgId: ORG, taskId: idDe('task:outra-1'), authorName: NATIVO, text: 'depois do import' } });
  const mudancasNativas: Array<[string, () => Promise<unknown>, () => Promise<number>]> = [
    ['comentário em outra tarefa', comentarioEmOutra, () => db.workComment.count({ where: { orgId: ORG, authorName: NATIVO } })],
    ['comentário na tarefa alvo', () => db.workComment.create({ data: { orgId: ORG, taskId: idAlvo, authorName: NATIVO, text: 'depois do import' } }),
      () => db.workComment.count({ where: { orgId: ORG, taskId: idAlvo, authorName: NATIVO } })],
    ['hora na tarefa alvo', () => db.workApontamento.create({ data: { orgId: ORG, taskId: idAlvo, autorNome: NATIVO, minutos: 45, dia: new Date('2026-10-02T00:00:00.000Z'), etapa: 'to do' } }),
      () => db.workApontamento.count({ where: { orgId: ORG, taskId: idAlvo, autorNome: NATIVO } })],
    ['hora em outra tarefa', () => db.workApontamento.create({ data: { orgId: ORG, taskId: idDe('task:outra-1'), autorNome: NATIVO, minutos: 30, dia: new Date('2026-10-02T00:00:00.000Z'), etapa: 'to do' } }),
      () => db.workApontamento.count({ where: { orgId: ORG, autorNome: NATIVO } })],
    ['etapa nova numa lista do lote', () => db.workStatus.create({ data: { orgId: ORG, listId: lista1(), name: 'Etapa do OS', type: 'custom', order: 7 } }),
      () => db.workStatus.count({ where: { orgId: ORG, name: 'Etapa do OS' } })],
    ['campo novo numa lista do lote', () => db.workField.create({ data: { orgId: ORG, listId: lista1(), name: 'Campo do OS', type: 'texto', order: 7 } }),
      () => db.workField.count({ where: { orgId: ORG, name: 'Campo do OS' } })],
    ['subtarefa nativa ligada à tarefa alvo', () => db.workTask.create({ data: { orgId: ORG, listId: lista1(), statusId: etapa1(), title: 'Subtarefa do OS', parentId: idAlvo } }),
      () => db.workTask.count({ where: { orgId: ORG, title: 'Subtarefa do OS', parentId: idAlvo } })],
    ['tarefa nativa numa lista do lote', () => db.workTask.create({ data: { orgId: ORG, listId: lista1(), statusId: etapa1(), title: 'Tarefa do OS' } }),
      () => db.workTask.count({ where: { orgId: ORG, title: 'Tarefa do OS' } })],
  ];

  it.each(mudancasNativas)('mudança nativa depois do import (%s): a reconciliação aplica, a execução do lote fica como estava e o rollback continua recusado, sem apagar nada', async (_nome, criar, contar) => {
    await criar();
    const v1 = gravar('v1', V1());
    const importado = manifesto().runs.at(-1);
    const antes = cli(['--rollback'], v1);
    expect(antes.status).toBe(2);
    expect(JSON.parse(antes.stdout)).toMatchObject({ rollbackSafe: false, alreadyRolledBack: false });
    const previa = await rodar(false);
    const rec = cli(['--reconciliar', ALVO, '--apply'], gravar('v2', V2()));
    expect(rec.status, rec.stderr).toBe(0);
    expect((await linhaDoAlvo()).title).toBe(TITULO_V2);
    expect(manifesto().runs.at(-1)).toEqual(importado);
    const depois = cli(['--rollback'], v1);
    expect(depois.status).toBe(2);
    expect(JSON.parse(depois.stdout)).toMatchObject({ rollbackSafe: false, alreadyRolledBack: false, reason: 'lote alterado; reversão recusada' });
    const desfazer = cli(['--rollback', '--apply'], v1);
    expect(desfazer.status).toBe(1);
    expect(desfazer.stderr).toContain('Rollback recusado');
    expect(await contar()).toBe(1);
    expect(await db.workTask.count({ where: { orgId: ORG, externalId: { not: null } } })).toBe(3);
    expect(await rastros()).toHaveLength(1);
    expect(manifesto().runs.at(-1).rolledBackAt).toBeUndefined();
    // O dry-run e o apply dizem que o rollback do lote continua bloqueado.
    expect(previa).toMatchObject({ estado: 'reconciliar', rollbackDoLote: { estado: 'bloqueado' } });
    expect(JSON.parse(rec.stdout)).toMatchObject({ estado: 'reconciliar', rollbackDoLote: { estado: 'bloqueado' } });
    expect(manifesto().reconciliations.at(-1)).toMatchObject({ rollbackDoLote: 'bloqueado' });
  }, 120000);

  it('vínculo nativo de etiqueta numa tarefa do lote: a reconciliação recusa e o rollback continua recusado, com o vínculo intacto', async () => {
    const etiqueta = await db.workTag.create({ data: { orgId: ORG, name: 'Etiqueta do OS' } });
    await db.workTask.update({ where: { id: idDe('task:outra-1') }, data: { tags: { connect: { id: etiqueta.id } } } });
    const rec = cli(['--reconciliar', ALVO, '--apply'], gravar('v2', V2()));
    expect(rec.status).toBe(2);
    expect(JSON.parse(rec.stdout).motivos.join(' ')).toContain('task:outra-1: registro nativo divergiu');
    expect(cli(['--rollback', '--apply'], gravar('v1', V1())).status).toBe(1);
    expect(await db.workTask.count({ where: { id: idDe('task:outra-1'), tags: { some: { id: etiqueta.id } } } })).toBe(1);
    expect(await rastros()).toHaveLength(0);
  }, 120000);

  it('subpasta nativa dentro da pasta do lote (no fingerprint desde a ROOT-17, senão barrada pela exclusão simulada): a reconciliação aplica e o rollback fica recusado com o motivo', async () => {
    await db.workFolder.create({ data: { orgId: ORG, parentId: idDe('folder:marketing'), name: 'Subpasta do OS' } });
    const importado = manifesto().runs.at(-1);
    const rec = cli(['--reconciliar', ALVO, '--apply'], gravar('v2', V2()));
    expect(rec.status, rec.stderr).toBe(0);
    expect((await linhaDoAlvo()).title).toBe(TITULO_V2);
    expect(manifesto().runs.at(-1)).toEqual(importado);
    expect(cli(['--rollback'], gravar('v1', V1())).status).toBe(2);
    expect(cli(['--rollback', '--apply'], gravar('v1', V1())).status).toBe(1);
    expect(await db.workFolder.count({ where: { orgId: ORG, name: 'Subpasta do OS' } })).toBe(1);
    expect(await db.workTask.count({ where: { orgId: ORG } })).toBe(3);
    expect(await rastros()).toHaveLength(1);
    const saida = JSON.parse(rec.stdout);
    expect(saida).toMatchObject({ estado: 'reconciliar', rollbackDoLote: { estado: 'bloqueado' } });
    // Com a ROOT-17 a subpasta já muda o fingerprint e a simulação nem roda; sem ela, a FK barraria a exclusão simulada.
    expect(saida.rollbackDoLote.motivo).toMatch(/o lote já não confere com o fingerprint gravado na execução|a exclusão do rollback do lote falharia agora/);
    expect(manifesto().reconciliations.at(-1)).toMatchObject({ rollbackDoLote: 'bloqueado' });
  }, 120000);

  it('segunda reconciliação com o lote alterado depois da primeira: só a primeira move o fingerprint, e o rollback volta a ficar recusado', async () => {
    const primeira = cli(['--reconciliar', ALVO, '--apply'], gravar('v2', V2()));
    expect(primeira.status, primeira.stderr).toBe(0);
    const depoisDaPrimeira = manifesto().runs.at(-1);
    await comentarioEmOutra();
    const v3 = snapshot({ title: 'Post 1 (revisado)', description: DESCRICAO_V2, updatedAt: '2026-10-01T10:00:00.000Z' });
    const segunda = cli(['--reconciliar', ALVO, '--apply'], gravar('v3', v3));
    expect(segunda.status, segunda.stderr).toBe(0);
    expect(manifesto().runs.at(-1)).toEqual(depoisDaPrimeira);
    expect(cli(['--rollback'], gravar('v1', V1())).status).toBe(2);
    expect(cli(['--rollback', '--apply'], gravar('v1', V1())).status).toBe(1);
    expect(await db.workComment.count({ where: { orgId: ORG, authorName: NATIVO } })).toBe(1);
    expect(await rastros()).toHaveLength(2);
    expect(JSON.parse(primeira.stdout)).toMatchObject({ rollbackDoLote: { estado: 'pronto' } });
    expect(JSON.parse(segunda.stdout)).toMatchObject({ estado: 'reconciliar', rollbackDoLote: { estado: 'bloqueado' } });
  }, 120000);

  it.each<[string, () => Promise<unknown>, 'pronto' | 'bloqueado']>([
    ['lote intacto', nadaAPreparar, 'pronto'],
    ['comentário nativo em outra tarefa', comentarioEmOutra, 'bloqueado'],
  ])('queda real antes do COMMIT da reconciliação (%s): banco, manifesto e RASTRO ficam como estavam e a retomada diz como fica o rollback', async (_nome, preparar, rollback) => {
    await preparar();
    const m0 = readFileSync(manifestPath(), 'utf8');
    const antes = await estado();
    await quedaAntesDoCommit(gravar('v2', V2()));
    expect(await estado()).toBe(antes);
    expect(readFileSync(manifestPath(), 'utf8')).toBe(m0);
    expect(existsSync(`${manifestPath()}.lock`)).toBe(true);
    rmSync(`${manifestPath()}.lock`);
    const retomada = cli(['--reconciliar', ALVO, '--apply'], gravar('v2', V2()));
    expect(retomada.status, retomada.stderr).toBe(0);
    expect(await rastros()).toHaveLength(1);
    expect(JSON.parse(cli(['--rollback'], gravar('v1', V1())).stdout)).toMatchObject({ rollbackSafe: rollback === 'pronto' });
    expect(JSON.parse(retomada.stdout)).toMatchObject({ estado: 'reconciliar', rollbackDoLote: { estado: rollback } });
  }, 120000);

  it.each<[string, () => Promise<unknown>]>([
    ['lote intacto', nadaAPreparar],
    ['comentário nativo em outra tarefa', comentarioEmOutra],
  ])('queda real depois do COMMIT da reconciliação e antes do manifesto (%s): o replay só recompõe o manifesto e o rollback continua recusado', async (_nome, preparar) => {
    await preparar();
    const m0 = readFileSync(manifestPath(), 'utf8');
    const execucao = manifesto().runs.at(-1);
    const queda = cli(['--reconciliar', ALVO, '--apply'], gravar('v2', V2()), morrerAoTrocarOManifesto());
    expect(queda.signal).toBe('SIGKILL');
    expect((await linhaDoAlvo()).title).toBe(TITULO_V2);
    expect(await rastros()).toHaveLength(1);
    expect(readFileSync(manifestPath(), 'utf8')).toBe(m0);
    rmSync(`${manifestPath()}.lock`);
    const previa = cli(['--reconciliar', ALVO], gravar('v2', V2()));
    expect(previa.status).toBe(0);
    expect(JSON.parse(previa.stdout)).toMatchObject({ estado: 'recuperar-manifesto', rollbackDoLote: { estado: 'bloqueado' } });
    const recuperada = cli(['--reconciliar', ALVO, '--apply'], gravar('v2', V2()));
    expect(recuperada.status, recuperada.stderr).toBe(0);
    expect(JSON.parse(recuperada.stdout)).toMatchObject({ estado: 'recuperar-manifesto', manifestRecuperado: true, rollbackDoLote: { estado: 'bloqueado' } });
    expect(manifesto().runs.at(-1)).toEqual(execucao);
    expect(manifesto().reconciliations.at(-1)).toMatchObject({ recoveredWithoutRollback: true, rollbackDoLote: 'bloqueado' });
    const confere = cli(['--rollback'], gravar('v1', V1()));
    expect(confere.status).toBe(2);
    expect(JSON.parse(confere.stdout)).toMatchObject({ rollbackSafe: false, alreadyRolledBack: false });
    expect(cli(['--rollback', '--apply'], gravar('v1', V1())).status).toBe(1);
    expect(await db.workTask.count({ where: { orgId: ORG, externalId: { not: null } } })).toBe(3);
    expect(await rastros()).toHaveLength(1);
    expect(JSON.parse(cli(['--reconciliar', ALVO, '--apply'], gravar('v2', V2())).stdout)).toMatchObject({ estado: 'igual', noOp: true });
  }, 120000);

  it('controle sem reconciliação: queda entre o COMMIT do rollback e o manifesto é reconhecida como já revertida (C0)', async () => {
    const run = manifesto().runs.at(-1);
    await reverterLote(db, especificacoes(V1()), run.created, run.postFingerprint);
    const re = cli(['--rollback', '--apply'], gravar('v1', V1()));
    expect(re.status, re.stderr).toBe(0);
    expect(JSON.parse(re.stdout)).toMatchObject({ alreadyRolledBack: true, manifestReconciled: true });
    expect(manifesto().runs.at(-1).rolledBackAt).toBeTruthy();
  }, 120000);

  it('depois de reconciliar, queda entre o COMMIT do rollback e o manifesto é reconhecida como já revertida e o RASTRO fica (C1)', async () => {
    expect(cli(['--reconciliar', ALVO, '--apply'], gravar('v2', V2())).status).toBe(0);
    const run = manifesto().runs.at(-1);
    await reverterLote(db, especificacoes(V1()), run.created, run.postFingerprint);
    expect(await db.workTask.count({ where: { orgId: ORG } })).toBe(0);
    const atual = await fingerprintImportado(db, especificacoes(V1()));
    expect(atual).not.toBe(run.preFingerprint);
    const confere = cli(['--rollback'], gravar('v1', V1()));
    expect(confere.status).toBe(0);
    expect(JSON.parse(confere.stdout)).toMatchObject({ rollbackSafe: false, alreadyRolledBack: true });
    const re = cli(['--rollback', '--apply'], gravar('v1', V1()));
    expect(re.status, re.stderr).toBe(0);
    expect(JSON.parse(re.stdout)).toMatchObject({ alreadyRolledBack: true, manifestReconciled: true });
    expect(manifesto().runs.at(-1).rolledBackAt).toBeTruthy();
    expect(await rastros()).toHaveLength(1);
    expect(atual).toBe(run.fingerprintAposRollback);
  }, 120000);

  it('depois de reconciliar, queda real do processo entre o COMMIT do rollback e o manifesto: a reexecução só reconcilia o manifesto', async () => {
    expect(cli(['--reconciliar', ALVO, '--apply'], gravar('v2', V2())).status).toBe(0);
    const m0 = readFileSync(manifestPath(), 'utf8');
    const queda = cli(['--rollback', '--apply'], gravar('v1', V1()), morrerAoTrocarOManifesto());
    expect(queda.signal).toBe('SIGKILL');
    expect(await db.workTask.count({ where: { orgId: ORG } })).toBe(0);
    expect(readFileSync(manifestPath(), 'utf8')).toBe(m0);
    rmSync(`${manifestPath()}.lock`);
    const re = cli(['--rollback', '--apply'], gravar('v1', V1()));
    expect(re.status, re.stderr).toBe(0);
    expect(JSON.parse(re.stdout)).toMatchObject({ alreadyRolledBack: true, manifestReconciled: true });
    expect(await rastros()).toHaveLength(1);
  }, 120000);

  it.each<[string, () => Promise<unknown>, number]>([
    ['AuditLog que a reconciliação não gravou (work.task.update)', () => db.auditLog.create({ data: {
      orgId: ORG, actorType: 'user', action: 'work.task.update', entityType: 'work_task', entityId: idAlvo, after: { title: 'outro' } } }), 1],
    ['AuditLog forjado com a ação da reconciliação', () => db.auditLog.create({ data: {
      orgId: ORG, actorType: 'system', action: ACAO_RECONCILIACAO, entityType: 'work_task', entityId: idAlvo, after: { title: TITULO_V2 } } }), 2],
    ['linha do lote recriada no OS com o id determinístico', () => db.workTag.create({ data: {
      id: idDe('tag:tag-roteiro'), orgId: ORG, name: 'Roteiro', color: '#ffcc00' } }), 1],
    ['RASTRO da reconciliação apagado', () => db.auditLog.deleteMany({ where: { orgId: ORG, action: ACAO_RECONCILIACAO } }), 0],
  ])('depois de reconciliar e da queda do rollback, desvio fora do estado esperado recusa (%s)', async (_nome, desviar, rastrosDepois) => {
    expect(cli(['--reconciliar', ALVO, '--apply'], gravar('v2', V2())).status).toBe(0);
    const run = manifesto().runs.at(-1);
    await reverterLote(db, especificacoes(V1()), run.created, run.postFingerprint);
    await desviar();
    const auditoria = await db.auditLog.findMany({ where: { orgId: ORG }, orderBy: { id: 'asc' } });
    const m0 = readFileSync(manifestPath(), 'utf8');
    const confere = cli(['--rollback'], gravar('v1', V1()));
    expect(confere.status).toBe(2);
    expect(JSON.parse(confere.stdout)).toMatchObject({ rollbackSafe: false, alreadyRolledBack: false, reason: 'lote alterado; reversão recusada' });
    const re = cli(['--rollback', '--apply'], gravar('v1', V1()));
    expect(re.status).toBe(1);
    expect(re.stderr).toContain('Rollback recusado');
    expect(readFileSync(manifestPath(), 'utf8')).toBe(m0);
    expect(await db.auditLog.findMany({ where: { orgId: ORG }, orderBy: { id: 'asc' } })).toEqual(auditoria);
    expect(await rastros()).toHaveLength(rastrosDepois);
  }, 120000);

  it('tarefa de uma execução anterior reconciliada: a queda do rollback da última execução é reconhecida e a execução anterior continua recusada', async () => {
    const semOutra = () => { const s = V1(); s.tasks = s.tasks.filter((t) => t.id !== 'outra-1'); return s; };
    await importarLote(semOutra());
    expect(cli(['--apply'], gravar('v1', V1())).status).toBe(0);
    const [primeira, segunda] = manifesto().runs;
    expect(segunda.created.task).toEqual([idDe('task:outra-1')]);
    const rec = cli(['--reconciliar', ALVO, '--apply'], gravar('v2', V2()));
    expect(rec.status, rec.stderr).toBe(0);
    const run = manifesto().runs.at(-1);
    await reverterLote(db, especificacoes(V1()), run.created, run.postFingerprint);
    expect(await db.workTask.count({ where: { orgId: ORG } })).toBe(2);
    expect((await linhaDoAlvo()).title).toBe(TITULO_V2);
    const re = cli(['--rollback', '--apply'], gravar('v1', V1()));
    expect(re.status, re.stderr).toBe(0);
    expect(JSON.parse(re.stdout)).toMatchObject({ alreadyRolledBack: true, manifestReconciled: true });
    expect(manifesto().runs[0]).toEqual(primeira);
    const anterior = cli(['--rollback'], gravar('lote', semOutra()));
    expect(anterior.status).toBe(2);
    expect(JSON.parse(anterior.stdout)).toMatchObject({ rollbackSafe: false, alreadyRolledBack: false });
    expect(await rastros()).toHaveLength(1);
    expect(JSON.parse(rec.stdout)).toMatchObject({ rollbackDoLote: { estado: 'pronto' } });
  }, 120000);

  it('--reconciliar sem --org-id recusa com exit 1, sem conferir nem escrever nada', async () => {
    const antes = await estado();
    const arquivos = readdirSync(dir).sort();
    const semEmpresa = cli(['--reconciliar', ALVO], gravar('v2', V2()), { alvo: [] });
    expect(semEmpresa.status).toBe(1);
    expect(semEmpresa.stderr).toContain('--reconciliar exige --org-id e --manifest-dir');
    expect(semEmpresa.stdout).toBe('');
    const semPasta = cli(['--reconciliar', ALVO], gravar('v2', V2()), { alvo: ['--org-id', ORG] });
    expect(semPasta.status).toBe(1);
    expect(semPasta.stderr).toContain('--manifest-dir é obrigatório');
    expect(await estado()).toBe(antes);
    expect(readdirSync(dir).sort()).toEqual(arquivos);
  }, 120000);

  it('--reconciliar com --arvore recusa com exit 1 no dry-run e no apply, antes de ler o snapshot, sem reconciliar nem montar a árvore', async () => {
    const antes = await estado();
    const arquivos = readdirSync(dir).sort();
    const manifestoAntes = readFileSync(manifestPath(), 'utf8');
    const pastas = () => db.workFolder.findMany({ where: { orgId: ORG }, orderBy: { id: 'asc' } });
    const pastasAntes = JSON.stringify(await pastas());
    const v2 = gravar('v2', V2());
    const juntos = ['--reconciliar', ALVO, '--arvore', '--nome-do-espaco', 'Espaço do teste'];
    for (const r of [cli(juntos, v2), cli([...juntos, '--apply'], v2), cli([...juntos, '--apply'], join(dir, '..', `nao-existe-${process.pid}.json`))]) {
      expect(r.status, r.stderr).toBe(1);
      expect(r.stderr).toContain('--reconciliar não combina com --arvore');
      expect(r.stdout).toBe('');
    }
    expect(await estado()).toBe(antes);
    expect(JSON.stringify(await pastas())).toBe(pastasAntes);
    expect(await db.workSpace.count({ where: { orgId: ORG } })).toBe(0);
    expect((await linhaDoAlvo()).title).toBe(TITULO_V1);
    expect(await rastros()).toHaveLength(0);
    expect(readFileSync(manifestPath(), 'utf8')).toBe(manifestoAntes);
    expect(readdirSync(dir).sort()).toEqual(arquivos);
  }, 120000);
});
