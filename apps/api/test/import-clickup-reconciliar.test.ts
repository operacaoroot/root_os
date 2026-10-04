import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { SnapshotSchema, validarSnapshot } from '../prisma/import-clickup-work.contract';
import { inventariar } from '../prisma/import-clickup-work.plan';
import {
  ACAO_RECONCILIACAO, aplicarReconciliacao, avaliarReconciliacao, classificarRollback, fingerprintImportado, reconciliarTarefa,
} from '../prisma/import-clickup-work';
import { exigirBancoDescartavel } from './banco-de-teste';

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

exigirBancoDescartavel(URL_DO_TESTE ?? '', 'ESCREVE nele (uma empresa com o lote sintético da reconciliação)');

describe.skipIf(!URL_DO_TESTE)('importador ClickUp → Work: --reconciliar (ROOT-11 P4)', () => {
  let db: PrismaClient;
  let dir: string;
  const dirs: string[] = [];
  const idAlvo = especificacoes(V1()).find((x) => x.chave === `task:${ALVO}`)!.id;

  const cli = (args: string[], arquivo: string) => spawnSync(process.execPath, [
    '--import', 'tsx', 'prisma/import-clickup-work.ts', '--snapshot', arquivo, '--org-id', ORG, '--manifest-dir', dir, ...args,
  ], { cwd: resolve('.'), env: { ...process.env, DATABASE_URL: URL_DO_TESTE }, encoding: 'utf8' });
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
    await db.workFolder.deleteMany({ where: { orgId: ORG } });
  }

  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: URL_DO_TESTE } } });
    await db.org.upsert({ where: { id: ORG }, create: { id: ORG, name: 'reconciliar', slug: 'reconciliar-p4' }, update: {} });
  });
  afterAll(async () => {
    if (!db) return;
    await limpar();
    await db.org.deleteMany({ where: { id: ORG } });
    await db.$disconnect();
    for (const f of dirs) rmSync(f, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await limpar();
    dir = mkdtempSync(join(tmpdir(), 'clickup-reconciliar-'));
    chmodSync(dir, 0o700);
    dirs.push(dir);
    const importacao = cli(['--apply'], gravar('v1', V1()));
    if (importacao.status !== 0) throw new Error(`lote sintético não entrou: ${importacao.stderr}`);
  }, 120000);

  it('divergência histórica: o dry-run mostra título e descrição antes/depois e não escreve nada', async () => {
    const antes = await estado();
    const arquivos = readdirSync(dir).sort();
    const r = await rodar(false);
    expect(r).toMatchObject({ mode: 'reconciliar-dry-run', estado: 'reconciliar', externalId: ALVO, nativeId: idAlvo, camposAlterados: ['description', 'title'] });
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
    const specsNovos = especificacoes(V2());
    const r = await rodar(true);
    expect(r).toMatchObject({ estado: 'reconciliar', nativeId: idAlvo });
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

  it('depois da reconciliação o importador comum passa (107 tarefas no caso real) e o rollback do lote continua pronto', async () => {
    await rodar(true);
    const comum = cli([], gravar('v2', V2()));
    expect(comum.status).toBe(0);
    expect(JSON.parse(comum.stdout)).toMatchObject({ toCreate: 0, conflicts: [] });
    const run = manifesto().runs.at(-1);
    expect(run.postFingerprintDoImport).toBeTruthy();
    expect(classificarRollback(await fingerprintImportado(db, especificacoes(V1())), run)).toBe('pronto');
    const confere = cli(['--rollback'], gravar('v1', V1()));
    expect(confere.status).toBe(0);
    expect(JSON.parse(confere.stdout)).toMatchObject({ rollbackSafe: true });
    const desfeito = cli(['--rollback', '--apply'], gravar('v1', V1()));
    expect(desfeito.status).toBe(0);
    expect(await db.workTask.count({ where: { orgId: ORG } })).toBe(0);
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
    const r = await rodar(true);
    expect(r).toMatchObject({ estado: 'recuperar-manifesto', manifestRecuperado: true });
    expect(await rastros()).toHaveLength(1);
    const m = manifesto();
    expect(m.reconciliations[0]).toMatchObject({ recoveredWithoutRollback: true, postFingerprint: null });
    expect(m.records[`task:${ALVO}`].origemHash).toBe(av.paraOrigemHash);
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
});
