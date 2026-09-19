import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarPrismaService, type PrismaService } from '../src/prisma/prisma.service';
import { AgentDataGrantService } from '../src/memory/agent-data-grant.service';
import { MemoriaService } from '../src/memory/memoria.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { exigirBancoDescartavel } from './banco-de-teste';

const URL_ADMIN = process.env.TEST_DATABASE_URL ?? '';
const URL_TENANT = process.env.TENANT_DATABASE_URL ?? '';
const dedicado = process.env.MKTOS_CONJUNTO_DE_TESTES === 'memoria-agente';
if (dedicado) {
  if (!URL_ADMIN || !URL_TENANT) throw new Error('memoria-agente exige TEST_DATABASE_URL e TENANT_DATABASE_URL.');
  exigirBancoDescartavel(URL_ADMIN, 'fixtures ADR-015');
  exigirBancoDescartavel(URL_TENANT, 'leitura ADR-015');
  const adminUrl = new URL(URL_ADMIN);
  const tenantUrl = new URL(URL_TENANT);
  if (adminUrl.hostname !== tenantUrl.hostname || adminUrl.port !== tenantUrl.port || adminUrl.pathname !== tenantUrl.pathname) {
    throw new Error('memoria-agente exige TEST_DATABASE_URL e TENANT_DATABASE_URL no mesmo banco/host.');
  }
  if (adminUrl.username === tenantUrl.username) throw new Error('memoria-agente exige usuários admin e mktos_app distintos.');
}

describe('fronteira ADR-015 da busca de memória', () => {
  const marca = `memoria_agent_${Date.now().toString(36)}_${randomUUID()}`;
  const admin = new Pool({ connectionString: URL_ADMIN, max: 2 });
  let prisma: PrismaService;
  let memoria: MemoriaService;
  let grants: AgentDataGrantService;
  let orgA: string;
  let orgB: string;
  let userA: string;
  let userB: string;
  let roleA: string;
  let roleB: string;
  let grantARef: string;
  let grantARestrictedRef: string;
  let ungrantedARef: string;
  let grantBRef: string;

  beforeAll(async () => {
    const now = new Date();
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      orgA = randomUUID();
      orgB = randomUUID();
      grantARef = `a_${marca}_arquivo.md`;
      grantBRef = `b_${marca}_arquivo.md`;
      await c.query(
        'INSERT INTO "Org" ("id","name","slug") VALUES ($1,$2,$3),($4,$5,$6)',
        [orgA, `Memória A ${marca}`, `memoria-a-${marca}`, orgB, `Memória B ${marca}`, `memoria-b-${marca}`],
      );
      userA = randomUUID();
      userB = randomUUID();
      await c.query(
        'INSERT INTO "User" ("id","orgId","name","email","passwordHash","updatedAt") VALUES ($1,$2,$3,$4,$5,$6),($7,$8,$9,$10,$11,$12)',
        [userA, orgA, 'Agente A', `${userA}@${marca}.local`, 'sintetico', now, userB, orgB, 'Agente B', `${userB}@${marca}.local`, 'sintetico', now],
      );
      roleA = randomUUID();
      roleB = randomUUID();
      await c.query(
        'INSERT INTO "Role" ("id","orgId","key","name") VALUES ($1,$2,$3,$4),($5,$6,$7,$8)',
        [roleA, orgA, `grant_admin_a_${marca}`, 'Grant admin A', roleB, orgB, `grant_admin_b_${marca}`, 'Grant admin B'],
      );
      const permission = await c.query('SELECT "id" FROM "Permission" WHERE "key"=$1', ['admin.permissoes']);
      await c.query('INSERT INTO "_UserRoles" ("A","B") VALUES ($1,$2),($3,$4)', [roleA, userA, roleB, userB]);
      await c.query('INSERT INTO "_RolePermissions" ("A","B") VALUES ($1,$2),($1,$3)', [permission.rows[0].id, roleA, roleB]);
      grantARestrictedRef = `a_${marca}_restrito%_arquivo.md`;
      ungrantedARef = `a_${marca}_sem_consentimento.md`;
      const itemA = randomUUID();
      const itemARestricted = randomUUID();
      const itemAUnGranted = randomUUID();
      const itemB = randomUUID();
      const items = [
        [itemA, orgA, `${marca}:a`, `Título A marcador ${marca}`, `corpo permitido A ${marca} marcador`, grantARef, 'hash-a', now],
        [itemARestricted, orgA, `${marca}:a-restrito`, `Título B marcador ${marca}`, `corpo proibido B ${marca} termo-corpo-b`, grantARestrictedRef, 'hash-a-restrito', new Date(now.getTime() + 1000)],
        [itemAUnGranted, orgA, `${marca}:a-sem-grant`, `Título C marcador ${marca}`, `corpo sem consentimento ${marca} marcador`, ungrantedARef, 'hash-a-sem-grant', new Date(now.getTime() + 2000)],
        [itemB, orgB, `${marca}:b`, 'Título B autorizado', `corpo proibido B ${marca}`, grantBRef, 'hash-b', new Date(now.getTime() + 3000)],
      ];
      for (const item of items) {
        await c.query(
          `INSERT INTO "ContextItem" ("id","orgId","chave","title","body","sourceType","sourceRef","contentHash","atualizadoEm")
           VALUES ($1,$2,$3,$4,$5,'upload',$6,$7,$8)`,
          item,
        );
      }
      const grantRows = [
        [orgA, 'sourceRef', grantARef], [orgA, 'title', grantARef], [orgA, 'body', grantARef],
        [orgA, 'sourceRef', grantARestrictedRef], [orgA, 'title', grantARestrictedRef],
        [orgB, 'sourceRef', grantBRef], [orgB, 'title', grantBRef],
      ];
      for (const [orgId, field, sourceRef] of grantRows) {
        await c.query(
          `INSERT INTO "AgentDataGrant" ("id","orgId","sourceType","sourceRef","field","provider","consentVersion","consentText","grantedByUserId")
           SELECT $1,$2,'upload',$3,$4,'agente_externo','${marca}-v1','Consentimento sintético: fonte e campo autorizados',"id"
             FROM "User" WHERE "orgId"=$2 LIMIT 1`,
          [randomUUID(), orgId, sourceRef, field],
        );
      }
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }

    process.env.TENANT_MODO = 'impor';
    process.env.APP_DATABASE_URL = URL_TENANT;
    prisma = await criarPrismaService();
    grants = new AgentDataGrantService(prisma);
    memoria = new MemoriaService(prisma, new EventLogService(prisma), grants);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query('DELETE FROM "AgentDataGrant" WHERE "orgId" IN ($1,$2)', [orgA, orgB]);
      await c.query('DELETE FROM "ContextItemVersion" WHERE "orgId" IN ($1,$2)', [orgA, orgB]);
      await c.query('DELETE FROM "ContextItem" WHERE "orgId" IN ($1,$2)', [orgA, orgB]);
      await c.query('DELETE FROM "_UserRoles" WHERE "B" IN ($1,$2)', [userA, userB]);
      await c.query('DELETE FROM "_RolePermissions" WHERE "B" IN ($1,$2)', [roleA, roleB]);
      await c.query('DELETE FROM "Role" WHERE "id" IN ($1,$2)', [roleA, roleB]);
      await c.query('DELETE FROM "AuditLog" WHERE "orgId" IN ($1,$2)', [orgA, orgB]);
      // EventLog is append-only by policy. This is a disposable fixture DB;
      // temporarily remove and restore only its two no-op cleanup rules. RLS
      // is also restored before the test process exits.
      await c.query('ALTER TABLE "EventLog" DISABLE ROW LEVEL SECURITY');
      await c.query('DROP RULE eventlog_sem_delete ON "EventLog"');
      await c.query('DROP RULE eventlog_sem_update ON "EventLog"');
      await c.query('DELETE FROM "EventLog" WHERE "orgId" IN ($1,$2)', [orgA, orgB]);
      await c.query('CREATE RULE eventlog_sem_delete AS ON DELETE TO public."EventLog" DO INSTEAD NOTHING');
      await c.query('CREATE RULE eventlog_sem_update AS ON UPDATE TO public."EventLog" DO INSTEAD NOTHING');
      await c.query('ALTER TABLE "EventLog" ENABLE ROW LEVEL SECURITY');
      await c.query('ALTER TABLE "EventLog" FORCE ROW LEVEL SECURITY');
      await c.query('DELETE FROM "User" WHERE "orgId" IN ($1,$2)', [orgA, orgB]);
      await c.query('DELETE FROM "Org" WHERE "id" IN ($1,$2)', [orgA, orgB]);
      await c.query('COMMIT');
    } finally {
      c.release();
      await admin.end();
    }
  });

  it('aplica grants por fonte antes de LIMIT e nunca devolve body de fonte restrita', async () => {
    const a = await memoria.buscarParaAgente(orgA, 'marcador', 20, { userId: userA, tokenId: 'token-a' });
    expect(a.diagnostico).toBe('ok');
    expect(a.itens).toHaveLength(2);
    const porFonte = new Map(a.itens.map((item) => [item.sourceRef, item]));
    expect(porFonte.get(grantARef)?.fields.body).toContain('corpo permitido A');
    expect(porFonte.get(grantARestrictedRef)?.fields).toMatchObject({ title: expect.stringContaining('Título B marcador') });
    expect(porFonte.get(grantARestrictedRef)?.fields.body).toBeUndefined();

    const corpoNegado = await memoria.buscarParaAgente(orgA, 'termo-corpo-b', 20);
    expect(corpoNegado.diagnostico).toBe('ok');
    expect(corpoNegado.itens).toEqual([]);
    expect(JSON.stringify(corpoNegado)).not.toContain('corpo proibido B');

    const limitado = await memoria.buscarParaAgente(orgA, 'marcador', 1);
    expect(limitado.itens).toHaveLength(1);
    expect([grantARef, grantARestrictedRef]).toContain(limitado.itens[0].sourceRef);
    expect(limitado.itens[0].sourceRef).not.toBe(ungrantedARef);

    const b = await memoria.buscarParaAgente(orgB, 'proibido', 20, { userId: userB, tokenId: 'token-b' });
    expect(b.diagnostico).toBe('ok');
    expect(b.itens).toHaveLength(0);
    expect(JSON.stringify(b)).not.toContain('corpo proibido B');
    const eventos = await admin.query(
      'SELECT "payload","actorId","correlationId" FROM "EventLog" WHERE "orgId"=$1 AND "tipo"=$2 ORDER BY "seq" DESC',
      [orgA, 'memoria.agent_busca'],
    );
    expect(eventos.rows.length).toBeGreaterThanOrEqual(3);
    expect(eventos.rows.some((row) => row.actorId === userA)).toBe(true);
    expect(eventos.rows.every((row) => row.correlationId)).toBe(true);
    expect(JSON.stringify(eventos.rows.map((row) => row.payload))).not.toContain('corpo permitido A');
  });

  it('distingue busca autorizada vazia e revogação efetiva no próximo request', async () => {
    const vazio = await memoria.buscarParaAgente(orgB, 'Título B autorizado', 20);
    expect(vazio.diagnostico).toBe('ok');
    expect(vazio.itens[0]?.fields).toEqual({ title: 'Título B autorizado' });

    const c = await admin.connect();
    try {
      await c.query('UPDATE "AgentDataGrant" SET "revokedAt"=CURRENT_TIMESTAMP WHERE "orgId"=$1', [orgB]);
    } finally {
      c.release();
    }
    const revogado = await memoria.buscarParaAgente(orgB, 'Título B autorizado');
    expect(revogado.diagnostico).toBe('sem_consentimento');
    expect(revogado.itens).toEqual([]);
  });

  it('concede e revoga rechecando admin.permissoes atual e registra auditoria', async () => {
    const sourceRef = `service_${marca}.md`;
    await expect(grants.conceder(orgA, userA, {
      sourceType: 'upload', sourceRef: '*', field: 'title', provider: 'agente_externo',
      consentVersion: `${marca}-service-invalid`, consentText: 'Seletor curinga recusado.',
    })).rejects.toThrow(/coringa|curinga|fonte/i);
    const created = await grants.conceder(orgA, userA, {
      sourceType: 'upload',
      sourceRef,
      field: 'sourceRef',
      provider: 'agente_externo',
      consentVersion: `${marca}-service-v1`,
      consentText: 'Consentimento sintético explícito para agente externo.',
    });
    expect(created.sourceRef).toBe(sourceRef);
    expect(created.allowVectorization).toBe(false);
    const audit = await admin.query(
      'SELECT "action","after" FROM "AuditLog" WHERE "orgId"=$1 AND "entityId"=$2 ORDER BY "createdAt" DESC LIMIT 1',
      [orgA, created.id],
    );
    expect(audit.rows[0].action).toBe('memoria.agent_grant.concedido');
    expect(JSON.stringify(audit.rows[0].after)).not.toContain('corpo');

    await grants.revogar(orgA, userA, created.id);
    const revoked = await grants.listar(orgA, userA);
    expect(revoked.find((row) => row.id === created.id)?.revokedAt).not.toBeNull();
    const audits = await admin.query(
      'SELECT "action" FROM "AuditLog" WHERE "orgId"=$1 AND "entityId"=$2 ORDER BY "createdAt" ASC',
      [orgA, created.id],
    );
    expect(audits.rows.map((row) => row.action)).toEqual([
      'memoria.agent_grant.concedido',
      'memoria.agent_grant.revogado',
    ]);

    await admin.query('DELETE FROM "_RolePermissions" WHERE "B"=$1', [roleA]);
    await expect(grants.conceder(orgA, userA, {
      sourceType: 'upload', sourceRef: `after-downgrade-${marca}.md`, field: 'title',
      provider: 'agente_externo', consentVersion: `${marca}-service-v2`,
      consentText: 'Não deve ser concedido após rebaixamento.',
    })).rejects.toThrow(/admin\.permissoes|permissão/i);
    await expect(grants.revogar(orgA, userA, created.id)).rejects.toThrow(/admin\.permissoes|permissão/i);
  });
});
