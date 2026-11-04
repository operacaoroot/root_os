import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ClienteEscopoService } from '../src/clientes-escopo/cliente-escopo.service';
import { AuditService } from '../src/audit/audit.service';
import { CofreDepositoService } from '../src/cofre-da-empresa/deposito.service';
import { comTenantNaSessao } from '../src/prisma/sessao-de-banco';
import { comContexto } from '../src/common/contexto-execucao';
import { decifrar } from '../src/common/crypto';
const url = process.env.COFRE_TEST_DATABASE_URL;
if (url && new URL(url).pathname !== '/cofre_test') throw new Error('Esta suíte só roda no banco descartável cofre_test.');
const run = url ? describe : describe.skip;
run('depósito com Postgres e papel restrito', () => {
  const orgId = randomUUID(), outra = randomUUID(), userId = randomUUID(), clienteId = randomUUID();
  let admin: PrismaClient, base: PrismaClient, db: PrismaClient, svc: CofreDepositoService;
  const contexto = <T>(org: string, fn: () => Promise<T>) => comContexto({ orgId: org, correlationId: 'teste-deposito' }, async () => await fn());
  const emitir = () => contexto(orgId, () => svc.emitir(orgId, userId, clienteId));
  const entrada = (caminho: string) => ({ token: caminho.split('#')[1], envioId: randomUUID(), titulo: 'ERP sintético', usuario: 'usuario-teste', segredo: 'senha-sintetica-qa', notas: 'nota de teste' });
  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    admin = new PrismaClient({ datasourceUrl: url });
    const restrita = new URL(url!); restrita.username = 'mktos_app'; restrita.password = 'cofre-app-test-only';
    base = new PrismaClient({ datasourceUrl: restrita.toString() });
    db = comTenantNaSessao(base, { modo: 'impor', avisar: () => {} });
    svc = new CofreDepositoService(db as any, new AuditService(db as any), new ClienteEscopoService(db as any, new AuditService(db as any)));
    await admin.org.createMany({ data: [{ id: orgId, name: 'QA depósito A', slug: `qa-${orgId}` }, { id: outra, name: 'QA depósito B', slug: `qa-${outra}` }] });
    await admin.partner.create({ data: { id: clienteId, orgId, razaoSocial: 'JUMA QA', isCliente: true } });
    const perm = await admin.permission.upsert({ where: { key: 'cofre.editar' }, create: { key: 'cofre.editar' }, update: {} });
    await admin.user.create({ data: { id: userId, orgId, name: 'Operador QA', email: `${userId}@test.invalid`, passwordHash: 'INUTILIZAVEL',
      roles: { create: { orgId, key: `qa-${userId}`, name: 'Cofre QA', permissions: { connect: { id: perm.id } } } } } });
    await admin.clienteAcessoPerfil.create({ data: { orgId, userId, modo: 'ALL' } });
  });
  afterAll(async () => { await base?.$disconnect(); await admin?.$disconnect(); });
  it('RLS esconde links e recibos de outra empresa, inclusive sem filtro explícito', async () => {
    const d = await emitir(); const input = entrada(d.caminho); await svc.receber(input);
    const visible = await contexto(outra, () => db.cofreDeposito.findMany());
    expect(visible).toEqual([]);
    expect(await contexto(outra, () => db.cofreDepositoRecibo.findMany())).toEqual([]);
    await expect(contexto(outra, () => db.cofreDeposito.create({ data: { orgId, cliente: 'inválido', tokenHash: randomUUID(), criadoPor: userId, expiraEm: new Date() } }))).rejects.toThrow();
  });
  it('concorrência repete o mesmo recibo e grava apenas um item e uma auditoria', async () => {
    const d = await emitir(); const input = entrada(d.caminho);
    const rs = await Promise.all(Array.from({ length: 8 }, () => svc.receber(input)));
    expect(new Set(rs.map((r) => r.recibo)).size).toBe(1);
    const receipts = await admin.cofreDepositoRecibo.findMany({ where: { depositoId: d.id } });
    expect(receipts).toHaveLength(1);
    const item = await admin.cofreItem.findUniqueOrThrow({ where: { id: receipts[0].itemId } });
    expect(item.clienteId).toBe(clienteId);
    expect(decifrar(item.segredoCifrado!, { aad: `cofre-da-empresa:${orgId}:${item.id}:segredo` })).toBe(input.segredo);
    const logs = await admin.auditLog.findMany({ where: { entityId: item.id } });
    expect(logs).toHaveLength(1); expect(JSON.stringify(logs)).not.toContain(input.segredo);
    expect((await admin.cofreDeposito.findUniqueOrThrow({ where: { id: d.id } })).recebidos).toBe(1);
  });
  it('a transação desfaz item, contador e recibo se a auditoria falhar', async () => {
    const d = await emitir(); const input = entrada(d.caminho);
    const falha = new CofreDepositoService(db as any, { log: async () => { throw new Error('falha de auditoria'); } } as any, new ClienteEscopoService(db as any, new AuditService(db as any)));
    await expect(falha.receber(input)).rejects.toThrow('falha de auditoria');
    expect(await admin.cofreItem.count({ where: { criadoPor: `deposito:${d.id}` } })).toBe(0);
    expect(await admin.cofreDepositoRecibo.count({ where: { depositoId: d.id } })).toBe(0);
    expect((await admin.cofreDeposito.findUniqueOrThrow({ where: { id: d.id } })).recebidos).toBe(0);
  });
  it('expiração e revogação preservam o item e rejeitam novos depósitos', async () => {
    const d = await emitir(); const input = entrada(d.caminho); await svc.receber(input);
    await contexto(orgId, () => svc.revogar(orgId, userId, d.id));
    await expect(svc.receber({ ...input, envioId: randomUUID() })).rejects.toThrow('indisponível');
    expect(await admin.cofreItem.count({ where: { criadoPor: `deposito:${d.id}` } })).toBe(1);
    const e = await emitir(); await admin.cofreDeposito.update({ where: { id: e.id }, data: { expiraEm: new Date(0) } });
    await expect(svc.estado(entrada(e.caminho).token)).rejects.toThrow('indisponível');
  });
  it('perda de vínculo SELECTED encerra link e não grava outro recibo', async () => {
    const d = await emitir(); const input = entrada(d.caminho);
    await admin.clienteAcessoPerfil.update({where: {userId_orgId: {userId, orgId}}, data: {modo: 'SELECTED'}});
    await admin.clienteAcessoVinculo.create({data: {orgId, userId, clienteId}});
    try {
      await svc.receber(input);
      await admin.clienteAcessoVinculo.deleteMany({where: {orgId, userId, clienteId}});
      await expect(svc.receber({...input, envioId: randomUUID()})).rejects.toThrow('indisponível');
      await expect(svc.receber(input)).rejects.toThrow('indisponível');
      expect(await admin.cofreDepositoRecibo.count({where: {depositoId: d.id}})).toBe(1);
    } finally {
      await admin.clienteAcessoVinculo.deleteMany({where: {orgId, userId}});
      await admin.clienteAcessoPerfil.update({where: {userId_orgId: {userId, orgId}}, data: {modo: 'ALL'}});
    }
  });
  it('FK impede item e depósito apontarem para cliente de outra empresa', async () => {
    const estrangeiro = randomUUID();
    await admin.partner.create({data: {id: estrangeiro, orgId: outra, razaoSocial: 'Outro QA', isCliente: true}});
    await expect(admin.cofreItem.create({data: {id: randomUUID(), orgId, clienteId: estrangeiro, tipo: 'senha', titulo: 'inválido', criadoPor: userId}})).rejects.toThrow();
    await expect(admin.cofreDeposito.create({data: {orgId, clienteId: estrangeiro, cliente: 'inválido', tokenHash: randomUUID(), criadoPor: userId, expiraEm: new Date()}})).rejects.toThrow();
  });
  it('recibo não pode ser associado a um link de outra empresa pelo banco', async () => {
    const d = await emitir();
    await expect(admin.cofreDepositoRecibo.create({ data: { orgId: outra, depositoId: d.id, envioId: randomUUID(), itemId: randomUUID() } })).rejects.toThrow();
  });
});
