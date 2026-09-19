import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bancoDescartavelEstrito } from '../src/common/banco-descartavel';
import { EventLogService } from '../src/gateway/event-log.service';
import { AgentDataGrantService } from '../src/memory/agent-data-grant.service';
import { MemoriaService } from '../src/memory/memoria.service';
import { comTenantResolvido } from '../src/common/contexto-execucao';
import { ConectorRemessaService } from '../src/conector/conector-remessa.service';
import { ConectorService } from '../src/conector/conector.service';
import { criarPrismaService, type PrismaService } from '../src/prisma/prisma.service';

const URL_ADMIN = process.env.TEST_DATABASE_URL ?? '';
const URL_TENANT = process.env.TENANT_DATABASE_URL ?? '';
const dedicado = process.env.MKTOS_CONJUNTO_DE_TESTES === 'conector-remessa';
if (dedicado) {
  if (!URL_ADMIN || !URL_TENANT) throw new Error('conector-remessa exige TEST_DATABASE_URL e TENANT_DATABASE_URL.');
  const a = new URL(URL_ADMIN); const t = new URL(URL_TENANT);
  if (!['localhost', '127.0.0.1'].includes(a.hostname) || !['localhost', '127.0.0.1'].includes(t.hostname) || a.hostname !== t.hostname || a.port !== t.port || a.pathname !== t.pathname) {
    throw new Error('conector-remessa exige as duas URLs no mesmo host/porta/banco.');
  }
  if (!bancoDescartavelEstrito(URL_ADMIN) || !bancoDescartavelEstrito(URL_TENANT)) throw new Error('conector-remessa exige banco descartável estrito.');
  if (a.username === t.username) throw new Error('conector-remessa exige papéis distintos.');
}

const sha = (text: string) => createHash('sha256').update(text.replace(/\r\n/g, '\n').trim()).digest('hex');
const item = (path: string, text: string) => ({ caminhoRelativo: path, texto: text, hashConteudo: sha(text), tamanho: Buffer.byteLength(text), mime: path.endsWith('.csv') ? 'text/csv' : 'text/markdown' });

describe.skipIf(!dedicado)('remessas locais e projeção transacional', () => {
  const admin = new Pool({ connectionString: URL_ADMIN, max: 5 });
  let prisma: PrismaService; let conector: ConectorService; let remessas: ConectorRemessaService; let eventos: EventLogService; let memoria: MemoriaService;
  let orgA: string; let orgB: string; let userA: string; let userB: string;
  let sourceA: string; let sourceB: string; let sourceIgnore: string; let tokenA: string; let tokenB: string;
  let deviceA: string; let deviceB: string;

  beforeAll(async () => {
    const c = await admin.connect(); const now = new Date();
    try {
      await c.query('BEGIN');
      orgA = randomUUID(); orgB = randomUUID(); userA = randomUUID(); userB = randomUUID();
      const roleA = randomUUID(); const roleB = randomUUID();
      await c.query('INSERT INTO "Org" ("id","name","slug") VALUES ($1,$2,$3),($4,$5,$6)', [orgA, 'Remessa A', `remessa-a-${orgA}`, orgB, 'Remessa B', `remessa-b-${orgB}`]);
      await c.query('INSERT INTO "User" ("id","orgId","name","email","passwordHash","updatedAt") VALUES ($1,$2,$3,$4,$5,$6),($7,$8,$9,$10,$11,$12)', [userA, orgA, 'A', `${userA}@local`, 'synthetic', now, userB, orgB, 'B', `${userB}@local`, 'synthetic', now]);
      await c.query('INSERT INTO "Role" ("id","orgId","key","name") VALUES ($1,$2,$3,$4),($5,$6,$7,$8)', [roleA, orgA, 'remessa-a', 'Remessa A', roleB, orgB, 'remessa-b', 'Remessa B']);
      await c.query('INSERT INTO "_UserRoles" ("A","B") VALUES ($1,$2),($3,$4)', [roleA, userA, roleB, userB]);
      for (const key of ['admin.permissoes', 'obsidian.editar']) await c.query('INSERT INTO "Permission" ("id","key") VALUES ($1,$2) ON CONFLICT ("key") DO NOTHING', [randomUUID(), key]);
      const p = await c.query('SELECT "id","key" FROM "Permission" WHERE "key" IN ($1,$2)', ['admin.permissoes', 'obsidian.editar']);
      for (const role of [roleA, roleB]) for (const permission of p.rows) await c.query('INSERT INTO "_RolePermissions" ("A","B") VALUES ($1,$2)', [permission.id, role]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    process.env.TENANT_MODO = 'impor'; process.env.APP_DATABASE_URL = URL_TENANT;
    prisma = await criarPrismaService(); eventos = new EventLogService(prisma); memoria = new MemoriaService(prisma, eventos, new AgentDataGrantService(prisma)); conector = new ConectorService(prisma); remessas = new ConectorRemessaService(prisma, eventos);
    const a = await conector.criarFonte(orgA, userA, { nome: 'A', tipo: 'pasta', raizLogica: 'docs', incluir: ['**/*.md'], excluir: ['privado/**'], tiposPermitidos: ['.md'], modo: 'sincronizacao', regraExclusao: 'arquivar', tamanhoMaximo: 100_000 });
    const b = await conector.criarFonte(orgB, userB, { nome: 'B', tipo: 'pasta', raizLogica: 'docs', incluir: ['**/*.md'], excluir: [], tiposPermitidos: ['.md'], modo: 'importacao', regraExclusao: 'arquivar', tamanhoMaximo: 100_000 });
    const ignored = await conector.criarFonte(orgB, userB, { nome: 'Ignorar', tipo: 'pasta', raizLogica: 'docs', incluir: ['**/*.md'], excluir: [], tiposPermitidos: ['.md'], modo: 'sincronizacao', regraExclusao: 'ignorar', tamanhoMaximo: 100_000 });
    sourceA = a.id; sourceB = b.id; sourceIgnore = ignored.id;
    const ca = await conector.emitirCodigo(orgA, userA, 'A', [sourceA]); const cb = await conector.emitirCodigo(orgB, userB, 'B', [sourceB, sourceIgnore]);
    const pa = await conector.parear(orgA, ca.id, ca.codigo, 'A'); const pb = await conector.parear(orgB, cb.id, cb.codigo, 'B');
    tokenA = pa.token; tokenB = pb.token; deviceA = pa.id; deviceB = pb.id;
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect(); const c = await admin.connect();
    try {
      await c.query('DROP TRIGGER IF EXISTS test_remessa_audit_fail ON "AuditLog"');
      await c.query('DROP FUNCTION IF EXISTS test_remessa_audit_fail()');
      await c.query('DELETE FROM "AuditLog" WHERE "orgId" IN ($1,$2)', [orgA, orgB]);
      await c.query('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete');
      try { await c.query('DELETE FROM "EventLog" WHERE "orgId" IN ($1,$2)', [orgA, orgB]); }
      finally { await c.query('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'); }
      await c.query('SELECT app_rls_desligar()');
      await c.query('DELETE FROM "ContextItemVersion" WHERE "orgId" IN ($1,$2)', [orgA, orgB]);
      await c.query('DELETE FROM "ContextItem" WHERE "orgId" IN ($1,$2)', [orgA, orgB]);
      await c.query('SELECT app_rls_ligar()');
      await c.query('DELETE FROM "_UserRoles" WHERE "B" IN ($1,$2)', [userA, userB]);
      await c.query('DELETE FROM "_RolePermissions" WHERE "B" IN (SELECT "id" FROM "Role" WHERE "orgId" IN ($1,$2))', [orgA, orgB]);
      await c.query('DELETE FROM "Role" WHERE "orgId" IN ($1,$2)', [orgA, orgB]);
      await c.query('DELETE FROM "User" WHERE "id" IN ($1,$2)', [userA, userB]);
      await c.query('DELETE FROM "Org" WHERE "id" IN ($1,$2)', [orgA, orgB]);
    } finally { c.release(); await admin.end(); }
  });

  it('abre de forma idempotente e separa dispositivo e tenant', async () => {
    const one = await remessas.abrir(await conector.resolverDispositivo(tokenA), { fonteId: sourceA, modo: 'sincronizacao', chaveRequisicao: 'same-open' });
    const two = await remessas.abrir(await conector.resolverDispositivo(tokenA), { fonteId: sourceA, modo: 'sincronizacao', chaveRequisicao: 'same-open' });
    expect(two.remessaId).toBe(one.remessaId);
    const concurrent = await Promise.all(Array.from({ length: 8 }, async () => remessas.abrir(await conector.resolverDispositivo(tokenA), { fonteId: sourceA, modo: 'sincronizacao', chaveRequisicao: 'concurrent-open' })));
    expect(new Set(concurrent.map((row) => row.remessaId)).size).toBe(1);
    await expect(remessas.lote(await conector.resolverDispositivo(tokenB), one.remessaId, [item('docs/no.md', 'no')])).rejects.toThrow();
    await expect(admin.query('INSERT INTO "ConnectorDelivery" ("id","orgId","deviceId","sourceId","chaveRequisicao","ordem","modo","escopoVersao") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), orgA, deviceA, sourceB, 'cross-parent', 900, 'sincronizacao', 1])).rejects.toThrow(/empresa cruzada/i);
    await expect(admin.query('INSERT INTO "ConnectorDeliveryItem" ("id","orgId","deliveryId","sourceId","caminhoRelativo","hashConteudo","tamanho","revisao") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), orgA, one.remessaId, sourceB, 'docs/cross.md', sha('cross'), 5, 1])).rejects.toThrow(/fonte cruzada/i);
    const contextB = randomUUID();
    await admin.query('INSERT INTO "ContextItem" ("id","orgId","chave","kind","title","body","sourceType","sourceRef","contentHash","atualizadoEm") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())', [contextB, orgB, `conector:${sourceB}:docs/cross.md`, 'nota', 'B', 'B', 'conector', `${sourceB}/docs/cross.md`, sha('B')]);
    await expect(admin.query('INSERT INTO "ConnectorDeliveryItem" ("id","orgId","deliveryId","sourceId","contextItemId","caminhoRelativo","hashConteudo","tamanho","revisao") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [randomUUID(), orgA, one.remessaId, sourceA, contextB, 'docs/cross.md', sha('B'), 1, 1])).rejects.toThrow(/memória cruzada/i);
    await expect(admin.query('INSERT INTO "ConnectorItemState" ("id","orgId","sourceId","contextItemId","caminhoRelativo","hashConteudo","revisao") VALUES ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), orgA, sourceA, contextB, 'docs/cross.md', sha('B'), 1])).rejects.toThrow(/memória cruzada/i);
    const forged = randomUUID();
    await admin.query('INSERT INTO "ContextItem" ("id","orgId","chave","kind","title","body","sourceType","sourceRef","contentHash","atualizadoEm") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())', [forged, orgA, `conector:${sourceA}:docs/forged.md`, 'nota', 'forjado', 'forjado', 'vault', `${sourceA}/docs/forged.md`, sha('forjado')]);
    await expect(admin.query('INSERT INTO "ConnectorDeliveryItem" ("id","orgId","deliveryId","sourceId","contextItemId","caminhoRelativo","hashConteudo","tamanho","revisao") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [randomUUID(), orgA, one.remessaId, sourceA, forged, 'docs/forged.md', sha('forjado'), 7, 1])).rejects.toThrow(/memória cruzada/i);
    await expect(admin.query('INSERT INTO "ConnectorItemState" ("id","orgId","sourceId","contextItemId","caminhoRelativo","hashConteudo","revisao") VALUES ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), orgA, sourceA, forged, 'docs/forged.md', sha('forjado'), 1])).rejects.toThrow(/memória cruzada/i);
    const collision = randomUUID();
    await admin.query('INSERT INTO "ContextItem" ("id","orgId","chave","kind","title","body","sourceType","sourceRef","contentHash","atualizadoEm") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())', [collision, orgA, `conector:${sourceA}:docs/collision.md`, 'nota', 'original', 'não substituir', 'vault', `${sourceA}/docs/collision.md`, sha('original')]);
    const collisionDelivery = await remessas.abrir(await conector.resolverDispositivo(tokenA), { fonteId: sourceA, modo: 'sincronizacao', chaveRequisicao: 'collision' });
    await expect(remessas.lote(await conector.resolverDispositivo(tokenA), collisionDelivery.remessaId, [item('docs/collision.md', 'novo')])).rejects.toThrow(/proveniência/i);
    const collisionRow = await admin.query('SELECT "body" FROM "ContextItem" WHERE "id"=$1', [collision]);
    expect(collisionRow.rows[0].body).toBe('não substituir');
  });

  it('usa ordem de abertura, rejeita lote atrasado e versiona A→B→A', async () => {
    const d0 = await remessas.abrir(await conector.resolverDispositivo(tokenA), { fonteId: sourceA, modo: 'sincronizacao', chaveRequisicao: 'v0' });
    await remessas.lote(await conector.resolverDispositivo(tokenA), d0.remessaId, [item('docs/a.md', 'A')]);
    await remessas.fim(await conector.resolverDispositivo(tokenA), d0.remessaId, { itensVistos: [{ caminhoRelativo: 'docs/a.md' }], itensEnviados: 1, erros: [], manifestoCompleto: true });
    const old = await remessas.abrir(await conector.resolverDispositivo(tokenA), { fonteId: sourceA, modo: 'sincronizacao', chaveRequisicao: 'old' });
    const newer = await remessas.abrir(await conector.resolverDispositivo(tokenA), { fonteId: sourceA, modo: 'sincronizacao', chaveRequisicao: 'new' });
    await remessas.lote(await conector.resolverDispositivo(tokenA), newer.remessaId, [item('docs/a.md', 'B')]);
    await expect(remessas.lote(await conector.resolverDispositivo(tokenA), old.remessaId, [item('docs/a.md', 'A')])).rejects.toThrow(/antigo/i);
    await expect(remessas.lote(await conector.resolverDispositivo(tokenA), old.remessaId, [item('docs/never-old.md', 'old')])).rejects.toThrow(/antigo/i);
    await expect(remessas.fim(await conector.resolverDispositivo(tokenA), old.remessaId, { itensVistos: [], itensEnviados: 0, erros: [], manifestoCompleto: true })).rejects.toThrow(/antigo/i);
    const again = await remessas.abrir(await conector.resolverDispositivo(tokenA), { fonteId: sourceA, modo: 'sincronizacao', chaveRequisicao: 'again' });
    await remessas.lote(await conector.resolverDispositivo(tokenA), again.remessaId, [item('docs/a.md', 'A')]);
    const rows = await admin.query('SELECT count(*)::int AS n FROM "ContextItemVersion" WHERE "orgId"=$1 AND "sourceType"=\'conector\' AND "sourceRef"=$2', [orgA, `${sourceA}/docs/a.md`]);
    expect(rows.rows[0].n).toBe(3);
    const chain = await comTenantResolvido(orgA, () => eventos.verificar(orgA));
    expect(chain.ok).toBe(true);
    const elos = await comTenantResolvido(orgA, () => memoria.conferirElos(orgA));
    expect(elos.semElo).toHaveLength(0);
    await remessas.fim(await conector.resolverDispositivo(tokenA), again.remessaId, { itensVistos: [{ caminhoRelativo: 'docs/a.md' }], itensEnviados: 1, erros: [], manifestoCompleto: true });
    const againReceipt = await remessas.fim(await conector.resolverDispositivo(tokenA), again.remessaId, { itensVistos: [{ caminhoRelativo: 'docs/a.md' }], itensEnviados: 1, erros: [], manifestoCompleto: true });
    expect(againReceipt.status).toBe('concluida');
  });

  it('calcula hash/tamanho e aplica extensão/filtros no servidor', async () => {
    const d = await remessas.abrir(await conector.resolverDispositivo(tokenA), { fonteId: sourceA, modo: 'sincronizacao', chaveRequisicao: 'invalid' });
    const valid = item('docs/ok.md', 'ok');
    await expect(remessas.lote(await conector.resolverDispositivo(tokenA), d.remessaId, [{ ...valid, hashConteudo: '0'.repeat(64) }])).rejects.toThrow(/Hash/i);
    await expect(remessas.lote(await conector.resolverDispositivo(tokenA), d.remessaId, [{ ...valid, tamanho: 99 }])).rejects.toThrow(/Tamanho/i);
    await expect(remessas.lote(await conector.resolverDispositivo(tokenA), d.remessaId, [valid, item('docs/ok.md', 'different')])).rejects.toThrow(/duas vezes/i);
    await expect(remessas.lote(await conector.resolverDispositivo(tokenA), d.remessaId, [item('../privado.md', 'x')])).rejects.toThrow(/Caminho/i);
    await expect(remessas.lote(await conector.resolverDispositivo(tokenA), d.remessaId, [item('privado/segredo.md', 'x')])).rejects.toThrow(/filtro/i);
    await expect(remessas.lote(await conector.resolverDispositivo(tokenA), d.remessaId, [{ ...valid, caminhoRelativo: 'docs/ok.csv', mime: 'text/csv' }])).rejects.toThrow(/filtro|extensão/i);
  });

  it('só arquiva ausências em manifesto completo e não arquiva ignorar', async () => {
    const d = await remessas.abrir(await conector.resolverDispositivo(tokenA), { fonteId: sourceA, modo: 'sincronizacao', chaveRequisicao: 'snapshot-all' });
    await remessas.lote(await conector.resolverDispositivo(tokenA), d.remessaId, [item('docs/x.md', 'x'), item('docs/y.md', 'y')]);
    await remessas.fim(await conector.resolverDispositivo(tokenA), d.remessaId, { itensVistos: [{ caminhoRelativo: 'docs/x.md' }, { caminhoRelativo: 'docs/y.md' }], itensEnviados: 2, erros: [], manifestoCompleto: true });
    const partial = await remessas.abrir(await conector.resolverDispositivo(tokenA), { fonteId: sourceA, modo: 'sincronizacao', chaveRequisicao: 'snapshot-partial' });
    const failed = await remessas.fim(await conector.resolverDispositivo(tokenA), partial.remessaId, { itensVistos: [{ caminhoRelativo: 'docs/x.md' }], itensEnviados: 0, erros: ['interrompido'], manifestoCompleto: false });
    expect(failed.status).toBe('falha');
    const yBefore = await admin.query('SELECT "arquivadoEm" FROM "ContextItem" WHERE "orgId"=$1 AND "chave"=$2', [orgA, `conector:${sourceA}:docs/y.md`]);
    expect(yBefore.rows[0].arquivadoEm).toBeNull();
    const falseCount = await remessas.abrir(await conector.resolverDispositivo(tokenA), { fonteId: sourceA, modo: 'sincronizacao', chaveRequisicao: 'snapshot-false-count' });
    await expect(remessas.fim(await conector.resolverDispositivo(tokenA), falseCount.remessaId, { itensVistos: [], itensEnviados: 1, erros: [], manifestoCompleto: true })).rejects.toThrow(/Contagem/i);
    const unknownManifest = await remessas.abrir(await conector.resolverDispositivo(tokenA), { fonteId: sourceA, modo: 'sincronizacao', chaveRequisicao: 'snapshot-unknown' });
    await expect(remessas.fim(await conector.resolverDispositivo(tokenA), unknownManifest.remessaId, { itensVistos: [{ caminhoRelativo: 'docs/never-received.md' }], itensEnviados: 0, erros: [], manifestoCompleto: true })).rejects.toThrow(/não recebida/i);
    const omittedReceived = await remessas.abrir(await conector.resolverDispositivo(tokenA), { fonteId: sourceA, modo: 'sincronizacao', chaveRequisicao: 'snapshot-omitted-received' });
    await remessas.lote(await conector.resolverDispositivo(tokenA), omittedReceived.remessaId, [item('docs/received-but-omitted.md', 'recebido')]);
    await expect(remessas.fim(await conector.resolverDispositivo(tokenA), omittedReceived.remessaId, { itensVistos: [], itensEnviados: 1, erros: [], manifestoCompleto: true })).rejects.toThrow(/não contém item recebido/i);
    const complete = await remessas.abrir(await conector.resolverDispositivo(tokenA), { fonteId: sourceA, modo: 'sincronizacao', chaveRequisicao: 'snapshot-missing' });
    await remessas.fim(await conector.resolverDispositivo(tokenA), complete.remessaId, { itensVistos: [{ caminhoRelativo: 'docs/x.md' }], itensEnviados: 0, erros: [], manifestoCompleto: true });
    const yAfter = await admin.query('SELECT "arquivadoEm" FROM "ContextItem" WHERE "orgId"=$1 AND "chave"=$2', [orgA, `conector:${sourceA}:docs/y.md`]);
    expect(yAfter.rows[0].arquivadoEm).not.toBeNull();
    const restore = await remessas.abrir(await conector.resolverDispositivo(tokenA), { fonteId: sourceA, modo: 'sincronizacao', chaveRequisicao: 'snapshot-restore' });
    await remessas.lote(await conector.resolverDispositivo(tokenA), restore.remessaId, [item('docs/x.md', 'x'), item('docs/y.md', 'restaurado')]);
    await remessas.fim(await conector.resolverDispositivo(tokenA), restore.remessaId, { itensVistos: [{ caminhoRelativo: 'docs/x.md' }, { caminhoRelativo: 'docs/y.md' }], itensEnviados: 2, erros: [], manifestoCompleto: true });
    const yRestored = await admin.query('SELECT "arquivadoEm" FROM "ContextItem" WHERE "orgId"=$1 AND "chave"=$2', [orgA, `conector:${sourceA}:docs/y.md`]);
    expect(yRestored.rows[0].arquivadoEm).toBeNull();
    const chain = await comTenantResolvido(orgA, () => eventos.verificar(orgA));
    expect(chain.ok).toBe(true);
    const elos = await comTenantResolvido(orgA, () => memoria.conferirElos(orgA));
    expect(elos.ok).toBe(true);
    expect(elos.semElo).toHaveLength(0);
  });

  it('serializa lotes concorrentes e não arquiva importação', async () => {
    const concurrent = await remessas.abrir(await conector.resolverDispositivo(tokenA), { fonteId: sourceA, modo: 'sincronizacao', chaveRequisicao: 'batch-concurrent' });
    const [first, second] = await Promise.all([
      remessas.lote(await conector.resolverDispositivo(tokenA), concurrent.remessaId, [item('docs/concurrent.md', 'same')]),
      remessas.lote(await conector.resolverDispositivo(tokenA), concurrent.remessaId, [item('docs/concurrent.md', 'same')]),
    ]) as Array<{ aceitos: number; duplicados: number }>;
    expect(first.aceitos + second.aceitos).toBe(1);
    expect(first.duplicados + second.duplicados).toBe(1);

    const imported = await remessas.abrir(await conector.resolverDispositivo(tokenB), { fonteId: sourceB, modo: 'importacao', chaveRequisicao: 'import-1' });
    await remessas.lote(await conector.resolverDispositivo(tokenB), imported.remessaId, [item('docs/import.md', 'importado')]);
    await remessas.fim(await conector.resolverDispositivo(tokenB), imported.remessaId, { itensVistos: [{ caminhoRelativo: 'docs/import.md' }], itensEnviados: 1, erros: [], manifestoCompleto: true });
    const importedAgain = await remessas.abrir(await conector.resolverDispositivo(tokenB), { fonteId: sourceB, modo: 'importacao', chaveRequisicao: 'import-2' });
    await remessas.fim(await conector.resolverDispositivo(tokenB), importedAgain.remessaId, { itensVistos: [], itensEnviados: 0, erros: [], manifestoCompleto: true });
    const stillThere = await admin.query('SELECT "arquivadoEm" FROM "ContextItem" WHERE "orgId"=$1 AND "chave"=$2', [orgB, `conector:${sourceB}:docs/import.md`]);
    expect(stillThere.rows[0].arquivadoEm).toBeNull();
    const ignoredFirst = await remessas.abrir(await conector.resolverDispositivo(tokenB), { fonteId: sourceIgnore, modo: 'sincronizacao', chaveRequisicao: 'ignore-1' });
    await remessas.lote(await conector.resolverDispositivo(tokenB), ignoredFirst.remessaId, [item('docs/ignored.md', 'ignorado')]);
    await remessas.fim(await conector.resolverDispositivo(tokenB), ignoredFirst.remessaId, { itensVistos: [{ caminhoRelativo: 'docs/ignored.md' }], itensEnviados: 1, erros: [], manifestoCompleto: true });
    const ignoredSecond = await remessas.abrir(await conector.resolverDispositivo(tokenB), { fonteId: sourceIgnore, modo: 'sincronizacao', chaveRequisicao: 'ignore-2' });
    await remessas.fim(await conector.resolverDispositivo(tokenB), ignoredSecond.remessaId, { itensVistos: [], itensEnviados: 0, erros: [], manifestoCompleto: true });
    const ignoredRow = await admin.query('SELECT "arquivadoEm" FROM "ContextItem" WHERE "orgId"=$1 AND "chave"=$2', [orgB, `conector:${sourceIgnore}:docs/ignored.md`]);
    expect(ignoredRow.rows[0].arquivadoEm).toBeNull();
  });

  it('revalida revogação e desfaz projeção/recibo se auditoria falha', async () => {
    const d = await remessas.abrir(await conector.resolverDispositivo(tokenA), { fonteId: sourceA, modo: 'sincronizacao', chaveRequisicao: 'atomic' });
    const beforeAtomicEvents = await admin.query('SELECT count(*)::int AS n FROM "EventLog" WHERE "orgId"=$1 AND "tipo"=\'memoria.item.criado\'', [orgA]);
    await admin.query(`CREATE OR REPLACE FUNCTION test_remessa_audit_fail() RETURNS trigger AS $$ BEGIN IF NEW."action" = 'conector.remessa.lote' THEN RAISE EXCEPTION 'falha sintética do rastro'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await admin.query('CREATE TRIGGER test_remessa_audit_fail BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION test_remessa_audit_fail()');
    await expect(remessas.lote(await conector.resolverDispositivo(tokenA), d.remessaId, [item('docs/atomic.md', 'atomic')])).rejects.toThrow(/rastro|sintética/i);
    await admin.query('DROP TRIGGER test_remessa_audit_fail ON "AuditLog"');
    const atomic = await admin.query('SELECT count(*)::int AS n FROM "ContextItem" WHERE "orgId"=$1 AND "chave"=$2', [orgA, `conector:${sourceA}:docs/atomic.md`]);
    expect(atomic.rows[0].n).toBe(0);
    const atomicArtifacts = await admin.query('SELECT (SELECT count(*) FROM "ConnectorDeliveryItem" WHERE "deliveryId"=$1)::int AS items, (SELECT count(*) FROM "ConnectorItemState" WHERE "sourceId"=$2 AND "caminhoRelativo"=$3)::int AS state, (SELECT count(*) FROM "ContextItemVersion" WHERE "orgId"=$4 AND "sourceRef"=$5)::int AS versions, (SELECT count(*) FROM "EventLog" WHERE "orgId"=$4 AND "tipo"=\'memoria.item.criado\')::int AS events', [d.remessaId, sourceA, 'docs/atomic.md', orgA, `${sourceA}/docs/atomic.md`]);
    expect(atomicArtifacts.rows[0]).toEqual({ items: 0, state: 0, versions: 0, events: beforeAtomicEvents.rows[0].n });
    await remessas.lote(await conector.resolverDispositivo(tokenA), d.remessaId, [item('docs/atomic.md', 'atomic')]);
    const afterAtomicEvents = await admin.query('SELECT count(*)::int AS n FROM "EventLog" WHERE "orgId"=$1 AND "tipo"=\'memoria.item.criado\'', [orgA]);
    expect(afterAtomicEvents.rows[0].n - beforeAtomicEvents.rows[0].n).toBe(1);
    const atomicReceipt = await admin.query('SELECT count(*)::int AS n FROM "ConnectorDeliveryItem" WHERE "deliveryId"=$1', [d.remessaId]);
    expect(atomicReceipt.rows[0].n).toBe(1);
    await conector.revogarFonte(orgA, userA, sourceA);
    await expect(remessas.fim(await conector.resolverDispositivo(tokenA), d.remessaId, { itensVistos: [{ caminhoRelativo: 'docs/atomic.md' }], itensEnviados: 1, erros: [], manifestoCompleto: true })).rejects.toThrow();
  });
});
