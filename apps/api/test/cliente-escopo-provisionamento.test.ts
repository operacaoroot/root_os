import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { provisionarTenant } from '../src/tenants/provisionar';
import { ClienteEscopoService } from '../src/clientes-escopo/cliente-escopo.service';

const url = process.env.COFRE_TEST_DATABASE_URL;
if (url && new URL(url).pathname !== '/cofre_test') throw new Error('Somente banco descartável cofre_test.');
const run = url ? describe : describe.skip;
run('escopo do primeiro administrador provisionado', () => {
  const db = new PrismaClient({ datasourceUrl: url });
  const orgs: string[] = [];
  afterAll(async () => {
    for (const orgId of orgs) {
      await db.clienteAcessoVinculo.deleteMany({where: {orgId}});
      await db.clienteAcessoPerfil.deleteMany({where: {orgId}});
      await db.user.deleteMany({where: {orgId}});
      await db.role.deleteMany({where: {orgId}});
      await db.org.deleteMany({where: {id: orgId}});
    }
    await db.$disconnect();
  });
  it('reverte a empresa inteira quando a criação do perfil falha', async () => {
    const slug = `escopo-falha-${randomUUID().slice(0,8)}`;
    const dbComFalha = new Proxy(db, {get(target, prop) {
      if (prop === '$transaction') return (fn: any, opts: any) => target.$transaction((tx) => fn(new Proxy(tx, {get(t, p) {
        if (p === 'clienteAcessoPerfil') return {create: async () => {throw new Error('falha simulada no perfil');}};
        return Reflect.get(t, p);
      }})), opts);
      const valor = Reflect.get(target, prop);
      return typeof valor === 'function' ? valor.bind(target) : valor;
    }});
    await expect(provisionarTenant(dbComFalha, {slug, admin: {email: `${slug}@example.invalid`}})).rejects.toThrow('falha simulada no perfil');
    expect(await db.org.findUnique({where: {slug}})).toBeNull();
    expect(await db.user.findUnique({where: {email: `${slug}@example.invalid`}})).toBeNull();
  }, 30000);
  it('cria perfil ALL apenas no nascimento e preserva SELECTED em reconfiguração', async () => {
    const marca = randomUUID();
    const entrada = {slug: `escopo-${marca.slice(0,8)}`, admin: {email: `${marca}@example.invalid`}};
    const auditorias: any[] = [];
    const opcoes = {auditar: async (x: any) => { auditorias.push(x); }};
    const criado = await provisionarTenant(db, entrada, opcoes);
    orgs.push(criado.orgId);
    const userId = criado.admin!.userId;
    const scope = new ClienteEscopoService(db as any, {} as any);
    expect(await scope.perfil(criado.orgId, userId)).toMatchObject({modo: 'ALL'});
    const comum = await db.user.create({data: {orgId: criado.orgId, email: `comum-${marca}@example.invalid`, name: 'Comum', passwordHash:'inutilizavel'}});
    await expect(scope.perfil(criado.orgId, comum.id)).rejects.toThrow();
    await db.clienteAcessoPerfil.update({where: {userId_orgId: {userId, orgId: criado.orgId}}, data: {modo: 'SELECTED'}});
    const repetido = await provisionarTenant(db, {...entrada, modo: 'reconfigurar'}, opcoes);
    expect(repetido.criada).toBe(false);
    expect(await scope.perfil(criado.orgId, userId)).toMatchObject({modo: 'SELECTED'});
    expect(auditorias.map(x => x.action)).toEqual(['tenant.provisionar.criado', 'tenant.provisionar.sem-mudanca']);
  }, 30000);
});
