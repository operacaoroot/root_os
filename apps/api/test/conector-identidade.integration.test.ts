import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bancoDescartavelEstrito } from '../src/common/banco-descartavel';
import { ConectorService } from '../src/conector/conector.service';
import { criarPrismaService, type PrismaService } from '../src/prisma/prisma.service';

const URL_ADMIN = process.env.TEST_DATABASE_URL ?? '';
const URL_TENANT = process.env.TENANT_DATABASE_URL ?? '';
const dedicado = process.env.MKTOS_CONJUNTO_DE_TESTES === 'conector-identidade';

if (dedicado) {
  if (!URL_ADMIN || !URL_TENANT) throw new Error('conector-identidade exige TEST_DATABASE_URL e TENANT_DATABASE_URL.');
  const admin = new URL(URL_ADMIN);
  const tenant = new URL(URL_TENANT);
  if (!['localhost', '127.0.0.1'].includes(admin.hostname) || !['localhost', '127.0.0.1'].includes(tenant.hostname)) {
    throw new Error('conector-identidade exige conexões em localhost/127.0.0.1.');
  }
  if (admin.hostname !== tenant.hostname || admin.port !== tenant.port || admin.pathname !== tenant.pathname) {
    throw new Error('conector-identidade exige as duas URLs no mesmo host/porta/banco.');
  }
  if (!bancoDescartavelEstrito(URL_ADMIN) || !bancoDescartavelEstrito(URL_TENANT)) {
    throw new Error('conector-identidade exige banco descartável por nome, sem override.');
  }
  if (admin.username === tenant.username) throw new Error('conector-identidade exige papéis distintos.');
}

describe.skipIf(!dedicado)('identidade e pareamento do conector local', () => {
  const marca = `conector_${Date.now().toString(36)}_${randomUUID()}`;
  const admin = new Pool({ connectionString: URL_ADMIN, max: 3 });
  let prisma: PrismaService;
  let conector: ConectorService;
  let orgA: string;
  let orgB: string;
  let userA: string;
  let userB: string;
  let roleA: string;
  let roleB: string;
  let sourceA: string;
  let sourceB: string;
  let deviceA: string;
  let tokenA: string;

  beforeAll(async () => {
    const now = new Date();
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      orgA = randomUUID();
      orgB = randomUUID();
      userA = randomUUID();
      userB = randomUUID();
      roleA = randomUUID();
      roleB = randomUUID();
      await c.query(
        'INSERT INTO "Org" ("id","name","slug") VALUES ($1,$2,$3),($4,$5,$6)',
        [orgA, `Conector A ${marca}`, `conector-a-${marca}`, orgB, `Conector B ${marca}`, `conector-b-${marca}`],
      );
      await c.query(
        'INSERT INTO "User" ("id","orgId","name","email","passwordHash","updatedAt") VALUES ($1,$2,$3,$4,$5,$6),($7,$8,$9,$10,$11,$12)',
        [userA, orgA, 'Operador A', `${userA}@${marca}.local`, 'sintetico', now, userB, orgB, 'Operador B', `${userB}@${marca}.local`, 'sintetico', now],
      );
      await c.query(
        'INSERT INTO "Role" ("id","orgId","key","name") VALUES ($1,$2,$3,$4),($5,$6,$7,$8)',
        [roleA, orgA, `conector_admin_a_${marca}`, 'Conector admin A', roleB, orgB, `conector_admin_b_${marca}`, 'Conector admin B'],
      );
      await c.query(
        'INSERT INTO "Permission" ("id","key") VALUES ($1,$2),($3,$4) ON CONFLICT ("key") DO NOTHING',
        [randomUUID(), 'admin.permissoes', randomUUID(), 'obsidian.editar'],
      );
      const perms = await c.query('SELECT "id","key" FROM "Permission" WHERE "key" IN ($1,$2)', ['admin.permissoes', 'obsidian.editar']);
      const byKey = new Map(perms.rows.map((row) => [row.key, row.id]));
      await c.query('INSERT INTO "_UserRoles" ("A","B") VALUES ($1,$2),($3,$4)', [roleA, userA, roleB, userB]);
      await c.query('INSERT INTO "_RolePermissions" ("A","B") VALUES ($1,$2),($1,$3),($4,$2),($4,$3)', [byKey.get('admin.permissoes'), roleA, roleB, byKey.get('obsidian.editar')]);
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      c.release();
    }
    process.env.TENANT_MODO = 'impor';
    process.env.APP_DATABASE_URL = URL_TENANT;
    prisma = await criarPrismaService();
    conector = new ConectorService(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    const c = await admin.connect();
    try {
      await c.query('DROP TRIGGER IF EXISTS test_conector_audit_fail ON "AuditLog"');
      await c.query('DROP FUNCTION IF EXISTS test_conector_audit_fail()');
      await c.query('DELETE FROM "AuditLog" WHERE "orgId" IN ($1,$2)', [orgA, orgB]);
      await c.query('DELETE FROM "_UserRoles" WHERE "B" IN ($1,$2)', [userA, userB]);
      await c.query('DELETE FROM "_RolePermissions" WHERE "B" IN ($1,$2)', [roleA, roleB]);
      await c.query('DELETE FROM "Role" WHERE "id" IN ($1,$2)', [roleA, roleB]);
      await c.query('DELETE FROM "User" WHERE "id" IN ($1,$2)', [userA, userB]);
      await c.query('DELETE FROM "Org" WHERE "id" IN ($1,$2)', [orgA, orgB]);
    } finally {
      c.release();
      await admin.end();
    }
  });

  it('recusa raiz absoluta, travessia e limites inválidos antes de persistir', async () => {
    await expect(conector.criarFonte(orgA, userA, {
      nome: 'fora', tipo: 'pasta', raizLogica: '/etc', incluir: [], excluir: [], tiposPermitidos: ['.md'],
      modo: 'sincronizacao', regraExclusao: 'ignorar', tamanhoMaximo: 100,
    })).rejects.toThrow(/lógico|absoluta/i);
    await expect(conector.criarFonte(orgA, userA, {
      nome: 'travessa', tipo: 'pasta', raizLogica: 'cliente/../segredo', incluir: [], excluir: [], tiposPermitidos: ['.md'],
      modo: 'sincronizacao', regraExclusao: 'ignorar', tamanhoMaximo: 100,
    })).rejects.toThrow(/travessia/i);
    await expect(conector.criarFonte(orgA, userA, {
      nome: 'limite', tipo: 'pasta', raizLogica: 'cliente/documentos', incluir: [], excluir: [], tiposPermitidos: ['.md'],
      modo: 'sincronizacao', regraExclusao: 'ignorar', tamanhoMaximo: 0,
    })).rejects.toThrow(/limite/i);
  });

  it('emite fonte lógica sem segredo e audita criação', async () => {
    const created = await conector.criarFonte(orgA, userA, {
      nome: 'Documentos A', tipo: 'pasta', raizLogica: 'cliente/documentos', incluir: ['**/*.md'], excluir: ['privado/**'],
      tiposPermitidos: ['.md', '.txt'], modo: 'sincronizacao', regraExclusao: 'arquivar', tamanhoMaximo: 1024,
    });
    sourceA = created.id;
    expect(created.raizLogica).toBe('cliente/documentos');
    expect(JSON.stringify(created)).not.toContain('tokenHash');
    const audit = await admin.query('SELECT "action","after" FROM "AuditLog" WHERE "entityId"=$1 ORDER BY "createdAt" DESC LIMIT 1', [sourceA]);
    expect(audit.rows[0].action).toBe('conector.fonte.criada');
    expect(JSON.stringify(audit.rows[0].after)).not.toContain('segredo');
  });

  it('persiste tentativas erradas e bloqueia o código correto após o limite', async () => {
    const issued = await conector.emitirCodigo(orgA, userA, 'laptop A limite', [sourceA]);
    for (let i = 0; i < 5; i++) {
      await expect(conector.parear(orgA, issued.id, `codigo-errado-${i}-com-tamanho`, 'laptop A')).rejects.toThrow(/inválido/i);
    }
    await expect(conector.parear(orgA, issued.id, issued.codigo, 'laptop A')).rejects.toThrow(/inválido/i);
    const row = await admin.query('SELECT "attempts","usedAt" FROM "ConnectorPairingCode" WHERE "id"=$1', [issued.id]);
    expect(row.rows[0]).toMatchObject({ attempts: 5, usedAt: null });
  });

  it('consome um código uma única vez mesmo em concorrência real', async () => {
    const issued = await conector.emitirCodigo(orgA, userA, 'laptop A', [sourceA]);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => conector.parear(orgA, issued.id, issued.codigo, `laptop concorrente ${i}`)),
    );
    const ok = results.filter((result): result is PromiseFulfilledResult<{ id: string; orgId: string; nome: string; token: string }> => result.status === 'fulfilled');
    expect(ok).toHaveLength(1);
    tokenA = ok[0].value.token;
    deviceA = ok[0].value.id;
    expect(tokenA).toMatch(/^rcon1\./);
    const hashes = await admin.query('SELECT "tokenHash" FROM "ConnectorDevice" WHERE "id"=$1', [deviceA]);
    expect(hashes.rows[0].tokenHash).not.toBe(tokenA);
    expect(JSON.stringify(hashes.rows)).not.toContain(tokenA);
    const pairing = await admin.query('SELECT "codeHash" FROM "ConnectorPairingCode" WHERE "id"=$1', [issued.id]);
    expect(pairing.rows[0].codeHash).not.toBe(issued.codigo);
    expect((await conector.listarDispositivos(orgA, userA))[0]).not.toHaveProperty('tokenHash');
  });

  it('pulso deriva o tenant do bearer, anuncia apenas fontes ativas e não contém hash', async () => {
    const identity = await conector.resolverDispositivo(tokenA);
    const pulse = await conector.pulso(identity, { versao: '1.0', so: 'teste', usuarioLocal: 'fixture', relogio: new Date().toISOString() });
    expect(pulse.revogado).toBe(false);
    expect(pulse.fontes.map((source) => source.id)).toEqual([sourceA]);
    expect(JSON.stringify(pulse)).not.toContain(tokenA);
    const altered = tokenA.replace(`.${orgA}.`, `.${orgB}.`);
    await expect(conector.resolverDispositivo(altered)).rejects.toThrow(/inválida/i);
  });

  it('impede relação dispositivo-fonte entre tenants no gatilho de integridade', async () => {
    const b = await conector.criarFonte(orgB, userB, {
      nome: 'Documentos B', tipo: 'arquivo', raizLogica: 'cliente/b', incluir: [], excluir: [], tiposPermitidos: ['.txt'],
      modo: 'importacao', regraExclusao: 'ignorar', tamanhoMaximo: 2048,
    });
    sourceB = b.id;
    await expect(admin.query(
      'INSERT INTO "ConnectorDeviceSource" ("id","orgId","deviceId","sourceId") VALUES ($1,$2,$3,$4)',
      [randomUUID(), orgA, deviceA, sourceB],
    )).rejects.toThrow(/diferentes|empresa cruzada/i);
    const issued = await conector.emitirCodigo(orgB, userB, 'laptop B', [sourceB]);
    const paired = await conector.parear(orgB, issued.id, issued.codigo, 'laptop B');
    const pulse = await conector.pulso(await conector.resolverDispositivo(paired.token), {
      versao: '1.0', so: 'teste', usuarioLocal: 'fixture', relogio: new Date().toISOString(),
    });
    expect(pulse.fontes.map((source) => source.id)).toEqual([sourceB]);
    expect(pulse.fontes.map((source) => source.id)).not.toContain(sourceA);
  });

  it('revoga fonte no próximo pulso e dispositivo no próximo request', async () => {
    await conector.revogarFonte(orgA, userA, sourceA);
    const pulse = await conector.pulso(await conector.resolverDispositivo(tokenA), {
      versao: '1.0', so: 'teste', usuarioLocal: 'fixture', relogio: new Date().toISOString(),
    });
    expect(pulse).toMatchObject({ revogado: true, fontes: [] });
    await conector.revogarDispositivo(orgA, userA, deviceA);
    await expect(conector.resolverDispositivo(tokenA)).rejects.toThrow(/inválida/i);
  });

  it('recusa código expirado sem criar dispositivo', async () => {
    const issued = await conector.emitirCodigo(orgB, userB, 'expirado', [sourceB]);
    await admin.query('UPDATE "ConnectorPairingCode" SET "expiresAt"=CURRENT_TIMESTAMP - INTERVAL \'1 minute\' WHERE "id"=$1', [issued.id]);
    await expect(conector.parear(orgB, issued.id, issued.codigo, 'expirado')).rejects.toThrow(/inválido/i);
    const devices = await admin.query('SELECT "id" FROM "ConnectorDevice" WHERE "nome"=$1', ['expirado']);
    expect(devices.rows).toHaveLength(0);
  });

  it('reconsulta as permissões atuais e desfaz fonte se a auditoria falhar', async () => {
    const authoritySource = await conector.criarFonte(orgA, userA, {
      nome: 'fonte autoridade', tipo: 'pasta', raizLogica: 'autoridade/atual', incluir: [], excluir: [], tiposPermitidos: ['.md'],
      modo: 'sincronizacao', regraExclusao: 'ignorar', tamanhoMaximo: 100,
    });
    const authorityCode = await conector.emitirCodigo(orgA, userA, 'autoridade atual', [authoritySource.id]);
    await admin.query('DELETE FROM "_RolePermissions" WHERE "A"=(SELECT "id" FROM "Permission" WHERE "key"=$1) AND "B"=$2', ['obsidian.editar', roleA]);
    await expect(conector.parear(orgA, authorityCode.id, authorityCode.codigo, 'autoridade atual')).rejects.toThrow(/inválido/i);
    const deniedPairing = await admin.query('SELECT "attempts","usedAt" FROM "ConnectorPairingCode" WHERE "id"=$1', [authorityCode.id]);
    expect(deniedPairing.rows[0]).toMatchObject({ attempts: 0, usedAt: null });
    await expect(conector.criarFonte(orgA, userA, {
      nome: 'sem permissão', tipo: 'pasta', raizLogica: 'sem/permissao', incluir: [], excluir: [], tiposPermitidos: ['.md'],
      modo: 'sincronizacao', regraExclusao: 'ignorar', tamanhoMaximo: 100,
    })).rejects.toThrow(/permissões atuais/i);
    await admin.query('INSERT INTO "_RolePermissions" ("A","B") SELECT "id",$1 FROM "Permission" WHERE "key"=$2', [roleA, 'obsidian.editar']);
    const inactiveCode = await conector.emitirCodigo(orgA, userA, 'empresa inativa', [authoritySource.id]);
    await admin.query('UPDATE "Org" SET "isActive"=false WHERE "id"=$1', [orgA]);
    await expect(conector.parear(orgA, inactiveCode.id, inactiveCode.codigo, 'empresa inativa')).rejects.toThrow(/inválido/i);
    await admin.query('UPDATE "Org" SET "isActive"=true WHERE "id"=$1', [orgA]);
    await admin.query(`CREATE OR REPLACE FUNCTION test_conector_audit_fail() RETURNS trigger AS $$
      BEGIN IF NEW."action" = 'conector.fonte.criada' THEN RAISE EXCEPTION 'falha sintética do rastro'; END IF; RETURN NEW; END;
    $$ LANGUAGE plpgsql`);
    await admin.query(`CREATE TRIGGER test_conector_audit_fail BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION test_conector_audit_fail()`);
    await expect(conector.criarFonte(orgA, userA, {
      nome: 'deve voltar', tipo: 'pasta', raizLogica: 'atomicidade/falha', incluir: [], excluir: [], tiposPermitidos: ['.md'],
      modo: 'sincronizacao', regraExclusao: 'ignorar', tamanhoMaximo: 100,
    })).rejects.toThrow(/rastro|sintética/i);
    await admin.query('DROP TRIGGER test_conector_audit_fail ON "AuditLog"');
    const rows = await admin.query('SELECT "id" FROM "ConnectorSource" WHERE "orgId"=$1 AND "nome"=$2', [orgA, 'deve voltar']);
    expect(rows.rows).toHaveLength(0);
  });
});
