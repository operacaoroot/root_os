import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { PendenciasRegistry } from '../src/pendencias/pendencias.registry';
import { PendenciasService, RECUSA_DE_OUTRA_PESSOA_NA_PENDENCIA } from '../src/pendencias/pendencias.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * AS PENDÊNCIAS (rodada dos agentes, 21/10/2026, Lane 0): abrir é idempotente pela
 * chave, responder toma a linha uma vez só e chama o tratador do tipo, conta de
 * máquina não responde, e a empresa vizinha não alcança.
 */

async function erro(chamada: () => Promise<unknown>): Promise<number | string> {
  try { await chamada(); return 'ok'; } catch (e) { return e instanceof HttpException ? e.getStatus() : String((e as Error).message); }
}

describe('registro dos tratadores', () => {
  it('um tratador por tipo; o segundo lança', () => {
    const r = new PendenciasRegistry();
    r.aoResponder('a', async () => undefined, 'x');
    expect(() => r.aoResponder('a', async () => undefined, 'y')).toThrow(/já tem tratador/);
    expect(r.tratador('a')).toBeTypeOf('function');
    expect(r.tratador('b')).toBeUndefined();
  });

  it('o tratador declara a permissão que a decisão exige', () => {
    const r = new PendenciasRegistry();
    r.aoResponder('com', async () => undefined, 'x', { permissao: 'tarefas.editar' });
    r.aoResponder('sem', async () => undefined, 'x');
    expect(r.permissaoDe('com')).toBe('tarefas.editar');
    expect(r.permissaoDe('sem')).toBeNull();
    expect(r.permissaoDe('nenhum')).toBeNull();
  });
});

const URL = process.env.TEST_DATABASE_URL;
const CASA = 'org-teste-pendencias-casa';
const VIZINHA = 'org-teste-pendencias-vizinha';
const EMPRESAS = [CASA, VIZINHA];
const EU = 'u-pendencias-casa';
const MAQUINA = 'u-pendencias-maquina';
/** Gente com `tarefas.editar`. */
const QUEM_PODE = 'u-pendencias-pode';

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (duas empresas e pendências)');

describe.skipIf(!URL)('pendências: contra o Postgres', () => {
  let prisma: PrismaClient;
  let registro: PendenciasRegistry;
  let svc: PendenciasService;
  const recebidas: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    registro = new PendenciasRegistry();
    svc = new PendenciasService(prisma as unknown as PrismaService, registro);
    registro.aoResponder('teste.ok', async (r) => { recebidas.push(`${r.escolha}:${r.refId}`); }, 'teste');
    registro.aoResponder('teste.falha', async () => { throw new Error('tratador caiu'); }, 'teste');
    registro.aoResponder('teste.permissao', async (r) => { recebidas.push(`perm:${r.escolha}`); }, 'teste', { permissao: 'tarefas.editar' });
    for (const orgId of EMPRESAS) await prisma.org.upsert({ where: { id: orgId }, create: { id: orgId, name: orgId, slug: orgId }, update: {} });
    const gente = await prisma.role.upsert({ where: { orgId_key: { orgId: CASA, key: 'analista' } }, create: { orgId: CASA, key: 'analista', name: 'Analista' }, update: {}, select: { id: true } });
    const ia = await prisma.role.upsert({ where: { orgId_key: { orgId: CASA, key: 'ia_acao' } }, create: { orgId: CASA, key: 'ia_acao', name: 'IA ação' }, update: {}, select: { id: true } });
    await prisma.user.upsert({ where: { id: EU }, create: { id: EU, orgId: CASA, name: 'Pessoa', email: `${EU}@teste.local`, passwordHash: 'x', roles: { connect: { id: gente.id } } }, update: {} });
    await prisma.user.upsert({ where: { id: MAQUINA }, create: { id: MAQUINA, orgId: CASA, name: 'Máquina', email: `${MAQUINA}@teste.local`, passwordHash: 'x', roles: { connect: { id: ia.id } } }, update: {} });
    const editor = await prisma.role.upsert({
      where: { orgId_key: { orgId: CASA, key: 'editor' } },
      create: { orgId: CASA, key: 'editor', name: 'Editor', permissions: { connectOrCreate: [{ where: { key: 'tarefas.editar' }, create: { key: 'tarefas.editar' } }] } },
      update: {},
      select: { id: true },
    });
    await prisma.user.upsert({ where: { id: QUEM_PODE }, create: { id: QUEM_PODE, orgId: CASA, name: 'Quem pode', email: `${QUEM_PODE}@teste.local`, passwordHash: 'x', roles: { connect: { id: editor.id } } }, update: {} });
  });

  beforeEach(async () => {
    recebidas.length = 0;
    await prisma.pendencia.deleteMany({ where: { orgId: { in: EMPRESAS } } });
  });

  afterAll(async () => {
    await prisma.pendencia.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    await prisma.user.deleteMany({ where: { id: { in: [EU, MAQUINA, QUEM_PODE] } } });
    await prisma.role.deleteMany({ where: { orgId: CASA } });
    await prisma.org.deleteMany({ where: { id: { in: EMPRESAS } } });
    await prisma.$disconnect();
  });

  const base = { funcao: 'TR-05', tipo: 'teste.ok', chave: 'k1', titulo: 'Classificar', opcoes: [{ chave: 'a', rotulo: 'A' }, { chave: 'b', rotulo: 'B' }], refTipo: 'arquivo', refId: 'r1' };

  it('abrir de novo cai na mesma linha; função desconhecida lança', async () => {
    const a = await svc.abrir(CASA, base);
    const b = await svc.abrir(CASA, { ...base, titulo: 'Classificar (de novo)' });
    expect(a.nova).toBe(true);
    expect(b).toMatchObject({ id: a.id, nova: false });
    expect((await prisma.pendencia.findUniqueOrThrow({ where: { id: a.id } })).titulo).toBe('Classificar (de novo)');
    expect(await erro(() => svc.abrir(CASA, { ...base, funcao: 'XX-99', chave: 'k2' }))).toMatch(/função desconhecida/);
  });

  it('responder toma uma vez, chama o tratador e a decidida não reabre', async () => {
    const a = await svc.abrir(CASA, base);
    expect(await erro(() => svc.responder(CASA, a.id, EU, 'z'))).toBe(409);
    await svc.responder(CASA, a.id, EU, 'b');
    expect(recebidas).toEqual(['b:r1']);
    expect(await erro(() => svc.responder(CASA, a.id, EU, 'a'))).toBe(409);
    const de_novo = await svc.abrir(CASA, { ...base, titulo: 'outra' });
    expect(de_novo.estado).toBe('resolvida');
    expect((await svc.listar(CASA, EU, {})).length).toBe(0);
    expect((await svc.listar(CASA, EU, { estado: 'resolvida' }))[0]).toMatchObject({ escolha: 'b', decididaPor: EU });
  });

  it('tratador que falha devolve a pendência a aberta', async () => {
    const a = await svc.abrir(CASA, { ...base, tipo: 'teste.falha', chave: 'k3' });
    expect(await erro(() => svc.responder(CASA, a.id, EU, 'a'))).toMatch(/tratador caiu/);
    expect((await prisma.pendencia.findUniqueOrThrow({ where: { id: a.id } })).estado).toBe('aberta');
  });

  it('conta de máquina não responde nem descarta; a vizinha não alcança', async () => {
    const a = await svc.abrir(CASA, base);
    expect(await erro(() => svc.responder(CASA, a.id, MAQUINA, 'a'))).toBe(403);
    expect(await erro(() => svc.descartar(CASA, a.id, MAQUINA))).toBe(403);
    expect(await erro(() => svc.responder(VIZINHA, a.id, EU, 'a'))).toBe(403);
    expect(await svc.listar(VIZINHA, EU, { de: 'todas' })).toEqual([]);
    await svc.descartar(CASA, a.id, EU);
    expect((await prisma.pendencia.findUniqueOrThrow({ where: { id: a.id } })).estado).toBe('descartada');
  });

  it('REVISÃO: a pendência de outra pessoa não é respondida nem descartada por mim (403, nada muda)', async () => {
    const a = await svc.abrir(CASA, { ...base, chave: 'dest', paraUsuarioId: QUEM_PODE });
    expect(await erro(() => svc.responder(CASA, a.id, EU, 'a'))).toBe(403);
    expect(await erro(() => svc.descartar(CASA, a.id, EU))).toBe(403);
    await expect(svc.responder(CASA, a.id, EU, 'a')).rejects.toThrow(RECUSA_DE_OUTRA_PESSOA_NA_PENDENCIA);
    expect((await prisma.pendencia.findUniqueOrThrow({ where: { id: a.id } })).estado).toBe('aberta');
    expect(recebidas).toEqual([]);
    await svc.responder(CASA, a.id, QUEM_PODE, 'a');
    expect(recebidas).toEqual(['a:r1']);
  });

  it('REVISÃO: a permissão que o tratador declarou é relida no banco antes de tomar a linha', async () => {
    const a = await svc.abrir(CASA, { ...base, tipo: 'teste.permissao', chave: 'perm' });
    expect(await erro(() => svc.responder(CASA, a.id, EU, 'b'))).toBe(403);
    expect(await erro(() => svc.descartar(CASA, a.id, EU))).toBe(403);
    expect((await prisma.pendencia.findUniqueOrThrow({ where: { id: a.id } })).estado).toBe('aberta');
    expect(recebidas).toEqual([]);
    await svc.responder(CASA, a.id, QUEM_PODE, 'b');
    expect(recebidas).toEqual(['perm:b']);
    const d = await svc.abrir(CASA, { ...base, tipo: 'teste.permissao', chave: 'perm-descarte' });
    await svc.descartar(CASA, d.id, QUEM_PODE);
    expect((await prisma.pendencia.findUniqueOrThrow({ where: { id: d.id } })).estado).toBe('descartada');
  });

  it('minhas = as da pessoa e as sem destinatário', async () => {
    await svc.abrir(CASA, { ...base, chave: 'p1', paraUsuarioId: EU });
    await svc.abrir(CASA, { ...base, chave: 'p2', paraUsuarioId: 'outra-pessoa' });
    await svc.abrir(CASA, { ...base, chave: 'p3' });
    expect((await svc.listar(CASA, EU, {})).length).toBe(2);
    expect((await svc.listar(CASA, EU, { de: 'todas' })).length).toBe(3);
  });
});
