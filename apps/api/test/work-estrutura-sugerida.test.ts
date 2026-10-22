import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { ESTRUTURA_SUGERIDA, MODELOS_DE_LISTA, pastasComAsDoComercial } from '@mktos/shared';
import { AuditService } from '../src/audit/audit.service';
import { PermissionsGuard } from '../src/auth/permissions.guard';
import { EventLogService } from '../src/gateway/event-log.service';
import { CheckoutDeTarefaService } from '../src/work/checkout-de-tarefa.service';
import { ETAPAS_PADRAO_DA_LISTA } from '../src/work/estrutura-sugerida';
import { WorkController } from '../src/work/work.controller';
import { WorkService } from '../src/work/work.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * ==========================================================================
 * A ESTRUTURA SUGERIDA DO TRABALHO (rodada do painel P2, 18/10/2026)
 * ==========================================================================
 *
 * `POST /trabalho/estrutura/sugerida` cria Administrativa, Gestão e Clientes e,
 * dentro de Clientes, a esteira, o onboarding e a execução. Esta suíte cobra:
 *
 *  1. a primeira chamada cria as três pastas e as três listas, cada lista com as
 *     etapas do seu modelo (ou as três padrão, na Execução);
 *  2. a segunda chamada não cria nada: tudo volta em `jaExistiam`;
 *  3. o que a pessoa já tinha não é renomeado nem duplicado (pasta "clientes"
 *     em minúscula é a mesma Clientes; lista com o mesmo nome também);
 *  4. outra empresa não enxerga nem recebe nada;
 *  5. sem `tarefas.editar` a rota responde 403 (o guarda de permissão);
 *  6. pasta é `WorkFolder`: nenhuma tabela de pasta paralela no schema.
 */

const URL = process.env.TEST_DATABASE_URL;
const ORG = 'org-teste-estrutura-sugerida';
const VIZINHA = 'org-teste-estrutura-sugerida-vizinha';
const EU = 'u-estrutura-sugerida';

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (pastas, listas e auditoria)');

describe('estrutura sugerida: o dado e a permissão (sem banco)', () => {
  it('duas pastas de topo (Gestão e Clientes, sem Administrativa desde 21/10), três listas em cada', () => {
    expect(ESTRUTURA_SUGERIDA.map((p) => p.nome)).toEqual(['Gestão', 'Clientes']);
    expect(ESTRUTURA_SUGERIDA[0].listas.map((l) => [l.nome, l.modelo])).toEqual([
      ['Administrativo', null], ['Financeiro', null], ['Pessoas', null],
    ]);
    const clientes = ESTRUTURA_SUGERIDA.find((p) => p.nome === 'Clientes')!;
    expect(clientes.listas.map((l) => [l.nome, l.modelo])).toEqual([
      ['Esteira de clientes', 'esteira-de-clientes'],
      ['Onboarding de cliente', 'onboarding-de-cliente'],
      ['Execução', null],
    ]);
  });

  it('o modelo do onboarding são as etapas do mockup aprovado (rodada da implantação I1), sem regra inventada', () => {
    const m = MODELOS_DE_LISTA['onboarding-de-cliente'];
    expect(m.etapas.map((e) => e.name)).toEqual([
      'Fechado no comercial', 'Kickoff marcado', 'Kit montado', 'Contexto carregado', 'Imersão', 'Operação assistida', 'Encerrado',
    ]);
    expect(m.etapas[0].type).toBe('open');
    expect(m.etapas.filter((e) => e.type === 'closed').map((e) => e.name)).toEqual(['Encerrado']);
    expect(m.etapas.every((e) => e.limite === null)).toBe(true);
    expect(m.campos).toEqual([]);
  });

  it('pasta é WorkFolder: o schema não ganhou tabela de pasta paralela', () => {
    const schema = readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
    expect(schema).toMatch(/^model WorkFolder \{/m);
    expect(schema).not.toMatch(/^model WorkPasta\b/m);
    expect(schema).not.toMatch(/\bpastaId\b/);
  });

  function contexto(permissions: string[]) {
    return {
      getHandler: () => WorkController.prototype.criarEstruturaSugerida,
      getClass: () => WorkController,
      switchToHttp: () => ({ getRequest: () => ({ user: { orgId: ORG, sub: EU, permissions } }) }),
    } as never;
  }

  it('sem tarefas.editar é 403; com ela passa; só ver não basta', () => {
    const guarda = new PermissionsGuard(new Reflector());
    expect(() => guarda.canActivate(contexto(['tarefas.ver']))).toThrow(ForbiddenException);
    expect(() => guarda.canActivate(contexto([]))).toThrow(ForbiddenException);
    expect(guarda.canActivate(contexto(['tarefas.ver', 'tarefas.editar']))).toBe(true);
  });
});

describe.skipIf(!URL)('estrutura sugerida: contra o Postgres', () => {
  let prisma: PrismaClient;
  let svc: WorkService;

  async function limpar(orgs: string[]) {
    await prisma.workFieldOption.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.workField.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.workStatus.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.workList.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.workFolder.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.auditLog.deleteMany({ where: { orgId: { in: orgs } } });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    svc = new WorkService(p, audit, new CheckoutDeTarefaService(p, audit, new EventLogService(p)));
    for (const orgId of [ORG, VIZINHA]) {
      await prisma.org.upsert({ where: { id: orgId }, create: { id: orgId, name: orgId, slug: orgId }, update: {} });
    }
    await prisma.user.upsert({
      where: { id: EU },
      create: { id: EU, orgId: ORG, name: 'Rodrigo', email: `${EU}@teste.local`, passwordHash: 'x' },
      update: {},
    });
  });

  beforeEach(async () => { await limpar([ORG, VIZINHA]); });

  afterAll(async () => {
    if (!prisma) return;
    await limpar([ORG, VIZINHA]);
    await prisma.user.deleteMany({ where: { id: EU } });
    await prisma.org.deleteMany({ where: { id: { in: [ORG, VIZINHA] } } });
    await prisma.$disconnect();
  });

  it('a primeira chamada cria as 2 pastas e as 6 listas, com as etapas de cada modelo', async () => {
    const r = await svc.criarEstruturaSugerida(ORG, EU);
    expect(r.criadas.pastas).toEqual(['Gestão', 'Clientes']);
    expect(r.criadas.listas).toEqual([
      'Gestão / Administrativo', 'Gestão / Financeiro', 'Gestão / Pessoas',
      'Clientes / Esteira de clientes', 'Clientes / Onboarding de cliente', 'Clientes / Execução',
    ]);
    expect(r.jaExistiam).toEqual({ pastas: [], listas: [] });
    expect(r.movidas).toEqual({ listas: [] });

    const e = await svc.estrutura(ORG);
    // A Clientes é do Comercial (I3, 22/10/2026): fora da árvore, à parte em `pastasDoComercial`, e marcada no banco.
    expect(e.folders.map((f) => f.name)).toEqual(['Gestão']);
    expect(e.pastasDoComercial?.map((f) => f.name)).toEqual(['Clientes']);
    expect(pastasComAsDoComercial(e).every((f) => f.parentId === null && f.spaceId === null)).toBe(true);
    const clientes = e.pastasDoComercial!.find((f) => f.name === 'Clientes')!;
    expect((await prisma.workFolder.findUniqueOrThrow({ where: { id: clientes.id } })).doComercial).toBe(true);
    expect(await prisma.workList.count({ where: { folderId: clientes.id, doComercial: true } })).toBe(3);
    expect(await prisma.workList.count({ where: { orgId: ORG, doComercial: false } })).toBe(3);
    expect(clientes.lists.map((l) => l.name)).toEqual(['Esteira de clientes', 'Onboarding de cliente', 'Execução']);
    const etapas = (nome: string) => clientes.lists.find((l) => l.name === nome)!.statuses.map((s) => s.name);
    expect(etapas('Esteira de clientes')).toEqual(MODELOS_DE_LISTA['esteira-de-clientes'].etapas.map((x) => x.name));
    expect(etapas('Onboarding de cliente')).toEqual(MODELOS_DE_LISTA['onboarding-de-cliente'].etapas.map((x) => x.name));
    expect(etapas('Execução')).toEqual(ETAPAS_PADRAO_DA_LISTA.map((x) => x.name));
    // a esteira leva os campos e o limite do modelo
    const esteira = clientes.lists.find((l) => l.name === 'Esteira de clientes')!;
    expect(esteira.fields.map((f) => f.name)).toEqual(MODELOS_DE_LISTA['esteira-de-clientes'].campos.map((c) => c.name));
    expect(esteira.statuses.find((s) => s.name === 'Implantação')?.limite).toBe(2);
    expect(e.folders.find((f) => f.name === 'Gestão')!.lists.map((l) => l.name)).toEqual(['Administrativo', 'Financeiro', 'Pessoas']);

    const auditoria = await prisma.auditLog.findMany({ where: { orgId: ORG, action: 'work.structure.suggested' } });
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0].actorId).toBe(EU);
  });

  it('a segunda chamada não duplica nada e devolve tudo como já existente', async () => {
    await svc.criarEstruturaSugerida(ORG, EU);
    const antes = { pastas: await prisma.workFolder.count({ where: { orgId: ORG } }), listas: await prisma.workList.count({ where: { orgId: ORG } }), etapas: await prisma.workStatus.count({ where: { orgId: ORG } }) };
    const r = await svc.criarEstruturaSugerida(ORG, EU);
    expect(r.criadas).toEqual({ pastas: [], listas: [] });
    expect(r.jaExistiam.pastas).toEqual(['Gestão', 'Clientes']);
    expect(r.jaExistiam.listas).toHaveLength(6);
    expect(r.movidas).toEqual({ listas: [] });
    expect({ pastas: await prisma.workFolder.count({ where: { orgId: ORG } }), listas: await prisma.workList.count({ where: { orgId: ORG } }), etapas: await prisma.workStatus.count({ where: { orgId: ORG } }) }).toEqual(antes);
    expect(antes).toEqual({ pastas: 2, listas: 6, etapas: 3 + 3 + 3 + 7 + 7 + 3 });
  });

  it('duas chamadas ao mesmo tempo criam uma estrutura só (cadeado da árvore)', async () => {
    await Promise.all([svc.criarEstruturaSugerida(ORG, EU), svc.criarEstruturaSugerida(ORG, EU)]);
    expect(await prisma.workFolder.count({ where: { orgId: ORG } })).toBe(2);
    expect(await prisma.workList.count({ where: { orgId: ORG } })).toBe(6);
  });

  it('o que já existe não é renomeado nem duplicado: só o que falta nasce', async () => {
    const minha = await svc.criarPasta(ORG, EU, { name: 'clientes' });
    await svc.criarLista(ORG, EU, { folderId: minha.id, name: 'Execução' });
    const r = await svc.criarEstruturaSugerida(ORG, EU);
    expect(r.criadas.pastas).toEqual(['Gestão']);
    expect(r.jaExistiam.pastas).toEqual(['clientes']);
    expect(r.criadas.listas).toEqual([
      'Gestão / Administrativo', 'Gestão / Financeiro', 'Gestão / Pessoas',
      'clientes / Esteira de clientes', 'clientes / Onboarding de cliente',
    ]);
    expect(r.jaExistiam.listas).toEqual(['clientes / Execução']);
    const pasta = await prisma.workFolder.findUniqueOrThrow({ where: { id: minha.id } });
    expect(pasta.name).toBe('clientes');
    expect(await prisma.workList.count({ where: { orgId: ORG, folderId: minha.id } })).toBe(3);
  });

  it('lista SOLTA de mesmo nome vai para a pasta sugerida (mesmo id, mesmas etapas); a segunda passada não mexe', async () => {
    const solta = await svc.criarLista(ORG, EU, { name: 'administrativo' });
    const etapasAntes = await prisma.workStatus.findMany({ where: { listId: solta.id }, select: { id: true } });
    const r = await svc.criarEstruturaSugerida(ORG, EU);
    expect(r.movidas).toEqual({ listas: ['Gestão / administrativo'] });
    expect(r.criadas.listas).not.toContain('Gestão / Administrativo');
    const depois = await prisma.workList.findUniqueOrThrow({ where: { id: solta.id }, include: { folder: true } });
    expect(depois.folder?.name).toBe('Gestão');
    expect(depois.name).toBe('administrativo');
    expect(await prisma.workStatus.findMany({ where: { listId: solta.id }, select: { id: true } })).toEqual(etapasAntes);
    expect(await prisma.workList.count({ where: { orgId: ORG, name: { equals: 'administrativo', mode: 'insensitive' } } })).toBe(1);
    const segunda = await svc.criarEstruturaSugerida(ORG, EU);
    expect(segunda.movidas).toEqual({ listas: [] });
    expect(segunda.criadas).toEqual({ pastas: [], listas: [] });
  });

  it('a pasta Administrativa nunca é recriada, e pasta ou lista arquivada não conta', async () => {
    await prisma.workFolder.create({ data: { orgId: ORG, name: 'Gestão', arquivadaEm: new Date() } });
    const arquivada = await prisma.workList.create({ data: { orgId: ORG, name: 'Financeiro', arquivadaEm: new Date() } });
    const r = await svc.criarEstruturaSugerida(ORG, EU);
    expect(r.criadas.pastas).toEqual(['Clientes']);
    expect(r.criadas.pastas).not.toContain('Administrativa');
    // a Gestão arquivada não é a sugerida e não se recria ao lado (nome único entre irmãs) nem se desarquiva sozinha
    expect(r.jaExistiam.pastas).toEqual(['Gestão (arquivada)']);
    expect(r.movidas).toEqual({ listas: [] });
    expect((await prisma.workList.findUniqueOrThrow({ where: { id: arquivada.id } })).folderId).toBeNull();
  });

  it('outra empresa fica isolada: não recebe nada e não conta como existente', async () => {
    await svc.criarPasta(VIZINHA, EU, { name: 'Clientes' });
    const r = await svc.criarEstruturaSugerida(ORG, EU);
    expect(r.criadas.pastas).toEqual(['Gestão', 'Clientes']);
    expect(await prisma.workFolder.count({ where: { orgId: VIZINHA } })).toBe(1);
    expect(await prisma.workList.count({ where: { orgId: VIZINHA } })).toBe(0);
    const daVizinha = await svc.estrutura(VIZINHA);
    // Criada à mão pelo Trabalho, a Clientes da vizinha não é do Comercial: ninguém rodou a estrutura sugerida lá.
    expect(daVizinha.folders.map((f) => f.name)).toEqual(['Clientes']);
    expect(daVizinha.folders[0].lists).toEqual([]);
    // as listas criadas na ORG pertencem à ORG, com as etapas carimbadas nela
    const etapas = await prisma.workStatus.findMany({ where: { list: { orgId: ORG } }, select: { orgId: true } });
    expect(etapas.length).toBeGreaterThan(0);
    expect(etapas.every((s) => s.orgId === ORG)).toBe(true);
  });
});
