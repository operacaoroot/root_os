import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { ESTRUTURA_SUGERIDA, MODELOS_DE_LISTA } from '@mktos/shared';
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
  it('três pastas de topo, e as três listas dentro de Clientes', () => {
    expect(ESTRUTURA_SUGERIDA.map((p) => p.nome)).toEqual(['Administrativa', 'Gestão', 'Clientes']);
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

  it('a primeira chamada cria as 3 pastas e as 3 listas, com as etapas de cada modelo', async () => {
    const r = await svc.criarEstruturaSugerida(ORG, EU);
    expect(r.criadas.pastas).toEqual(['Administrativa', 'Gestão', 'Clientes']);
    expect(r.criadas.listas).toEqual([
      'Clientes / Esteira de clientes', 'Clientes / Onboarding de cliente', 'Clientes / Execução',
    ]);
    expect(r.jaExistiam).toEqual({ pastas: [], listas: [] });

    const e = await svc.estrutura(ORG);
    expect(e.folders.map((f) => f.name)).toEqual(['Administrativa', 'Gestão', 'Clientes']);
    expect(e.folders.every((f) => f.parentId === null && f.spaceId === null)).toBe(true);
    const clientes = e.folders.find((f) => f.name === 'Clientes')!;
    expect(clientes.lists.map((l) => l.name)).toEqual(['Esteira de clientes', 'Onboarding de cliente', 'Execução']);
    const etapas = (nome: string) => clientes.lists.find((l) => l.name === nome)!.statuses.map((s) => s.name);
    expect(etapas('Esteira de clientes')).toEqual(MODELOS_DE_LISTA['esteira-de-clientes'].etapas.map((x) => x.name));
    expect(etapas('Onboarding de cliente')).toEqual(MODELOS_DE_LISTA['onboarding-de-cliente'].etapas.map((x) => x.name));
    expect(etapas('Execução')).toEqual(ETAPAS_PADRAO_DA_LISTA.map((x) => x.name));
    // a esteira leva os campos e o limite do modelo
    const esteira = clientes.lists.find((l) => l.name === 'Esteira de clientes')!;
    expect(esteira.fields.map((f) => f.name)).toEqual(MODELOS_DE_LISTA['esteira-de-clientes'].campos.map((c) => c.name));
    expect(esteira.statuses.find((s) => s.name === 'Implantação')?.limite).toBe(2);
    expect(e.folders.find((f) => f.name === 'Administrativa')!.lists).toEqual([]);

    const auditoria = await prisma.auditLog.findMany({ where: { orgId: ORG, action: 'work.structure.suggested' } });
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0].actorId).toBe(EU);
  });

  it('a segunda chamada não duplica nada e devolve tudo como já existente', async () => {
    await svc.criarEstruturaSugerida(ORG, EU);
    const antes = { pastas: await prisma.workFolder.count({ where: { orgId: ORG } }), listas: await prisma.workList.count({ where: { orgId: ORG } }), etapas: await prisma.workStatus.count({ where: { orgId: ORG } }) };
    const r = await svc.criarEstruturaSugerida(ORG, EU);
    expect(r.criadas).toEqual({ pastas: [], listas: [] });
    expect(r.jaExistiam.pastas).toEqual(['Administrativa', 'Gestão', 'Clientes']);
    expect(r.jaExistiam.listas).toHaveLength(3);
    expect({ pastas: await prisma.workFolder.count({ where: { orgId: ORG } }), listas: await prisma.workList.count({ where: { orgId: ORG } }), etapas: await prisma.workStatus.count({ where: { orgId: ORG } }) }).toEqual(antes);
    expect(antes).toEqual({ pastas: 3, listas: 3, etapas: 7 + 7 + 3 });
  });

  it('duas chamadas ao mesmo tempo criam uma estrutura só (cadeado da árvore)', async () => {
    await Promise.all([svc.criarEstruturaSugerida(ORG, EU), svc.criarEstruturaSugerida(ORG, EU)]);
    expect(await prisma.workFolder.count({ where: { orgId: ORG } })).toBe(3);
    expect(await prisma.workList.count({ where: { orgId: ORG } })).toBe(3);
  });

  it('o que já existe não é renomeado nem duplicado: só o que falta nasce', async () => {
    const minha = await svc.criarPasta(ORG, EU, { name: 'clientes' });
    await svc.criarLista(ORG, EU, { folderId: minha.id, name: 'Execução' });
    const r = await svc.criarEstruturaSugerida(ORG, EU);
    expect(r.criadas.pastas).toEqual(['Administrativa', 'Gestão']);
    expect(r.jaExistiam.pastas).toEqual(['clientes']);
    expect(r.criadas.listas).toEqual(['clientes / Esteira de clientes', 'clientes / Onboarding de cliente']);
    expect(r.jaExistiam.listas).toEqual(['clientes / Execução']);
    const pasta = await prisma.workFolder.findUniqueOrThrow({ where: { id: minha.id } });
    expect(pasta.name).toBe('clientes');
    expect(await prisma.workList.count({ where: { orgId: ORG, folderId: minha.id } })).toBe(3);
  });

  it('outra empresa fica isolada: não recebe nada e não conta como existente', async () => {
    await svc.criarPasta(VIZINHA, EU, { name: 'Clientes' });
    const r = await svc.criarEstruturaSugerida(ORG, EU);
    expect(r.criadas.pastas).toEqual(['Administrativa', 'Gestão', 'Clientes']);
    expect(await prisma.workFolder.count({ where: { orgId: VIZINHA } })).toBe(1);
    expect(await prisma.workList.count({ where: { orgId: VIZINHA } })).toBe(0);
    const daVizinha = await svc.estrutura(VIZINHA);
    expect(daVizinha.folders.map((f) => f.name)).toEqual(['Clientes']);
    expect(daVizinha.folders[0].lists).toEqual([]);
    // as listas criadas na ORG pertencem à ORG, com as etapas carimbadas nela
    const etapas = await prisma.workStatus.findMany({ where: { list: { orgId: ORG } }, select: { orgId: true } });
    expect(etapas.length).toBeGreaterThan(0);
    expect(etapas.every((s) => s.orgId === ORG)).toBe(true);
  });
});
