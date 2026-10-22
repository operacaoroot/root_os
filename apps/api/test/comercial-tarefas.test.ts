import 'reflect-metadata';
import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { TAREFA_IGUAL_JA_EXISTE, type CartaoDoFunil, type TarefaDoComercial, type TarefasDoComercial } from '@mktos/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuditService } from '../src/audit/audit.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { PermissionsGuard } from '../src/auth/permissions.guard';
import { ContextoInterceptor } from '../src/common/contexto.interceptor';
import { ZodExceptionFilter } from '../src/common/zod-exception.filter';
import { ConfigComercialService } from '../src/comercial/config.service';
import { FichaService } from '../src/comercial/ficha.service';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { antesNaFila, tarefaEhAProximaAcao, tarefasDosCartoes } from '../src/comercial/tarefas/tarefa-do-cartao';
import { TarefasDoComercialController } from '../src/comercial/tarefas/tarefas-do-comercial.controller';
import { TarefasDoComercialService } from '../src/comercial/tarefas/tarefas-do-comercial.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { AcessoAtualGuard } from '../src/memory/acesso-atual.guard';
import type { PrismaService } from '../src/prisma/prisma.service';
import { CheckoutDeTarefaService } from '../src/work/checkout-de-tarefa.service';
import { LISTA_DO_COMERCIAL } from '../src/work/lista-do-comercial';
import { WorkService } from '../src/work/work.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * AS TAREFAS DO COMERCIAL (adendo de 21/10/2026, §A1).
 *
 *  1. a regra pura do cartão: a mais antiga (menor prazo; sem prazo, a criada
 *     primeiro) e quando ela passa à frente da próxima ação da ficha;
 *  2. criar com e sem lead (na lista do comercial, área Comercial, auditado);
 *     lead de outra empresa é recusado;
 *  3. editar e concluir/reabrir pela versão lida (409 com versão velha);
 *     ligar e desligar o lead; tarefa do Trabalho sem lead não é do comercial (404);
 *  4. permissões: ler com `leads.ver`; escrever pede `leads.editar` E
 *     `tarefas.editar`, relidas no banco;
 *  5. o cartão do funil traz a tarefa mais antiga como próxima ação e a contagem,
 *     sem escrever a ficha;
 *  6. a lista do comercial fica fora da árvore do Trabalho e de Todas.
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (empresa, pessoas, leads, fichas, listas e tarefas)');

const MARCA = `ct${Date.now().toString(36).slice(-6)}`;
const PERMS = ['leads.ver', 'leads.editar', 'tarefas.ver', 'tarefas.editar'];

describe('a tarefa no cartão do funil (pura)', () => {
  const t = (id: string, prazo: string | null, criada: string) => ({
    id, leadId: 'L', title: id, dueDate: prazo ? new Date(`${prazo}T03:00:00.000Z`) : null, createdAt: new Date(criada), responsavel: null,
  });
  it('a mais antiga é a de menor prazo; sem prazo vai para o fim, pela criação', () => {
    const fila = [t('sem-velha', null, '2026-10-01T10:00:00Z'), t('dia-25', '2026-10-25', '2026-10-20T10:00:00Z'), t('dia-22', '2026-10-22', '2026-10-21T10:00:00Z'), t('sem-nova', null, '2026-10-10T10:00:00Z')];
    expect([...fila].sort(antesNaFila).map((x) => x.id)).toEqual(['dia-22', 'dia-25', 'sem-velha', 'sem-nova']);
  });
  it('a tarefa é a próxima ação sem ação na ficha, ou com prazo no mesmo dia ou antes', () => {
    const daFicha = (quando: string | null) => ({ tipo: 'x', quando, descricao: 'ação da ficha' });
    expect(tarefaEhAProximaAcao(null, null)).toBe(true);
    expect(tarefaEhAProximaAcao('2026-10-22', daFicha('2026-10-23T12:00:00Z'))).toBe(true);
    expect(tarefaEhAProximaAcao('2026-10-22', daFicha('2026-10-22T20:00:00Z'))).toBe(true);
    expect(tarefaEhAProximaAcao('2026-10-24', daFicha('2026-10-23T12:00:00Z'))).toBe(false);
    expect(tarefaEhAProximaAcao('2026-10-24', daFicha(null))).toBe(true);
    expect(tarefaEhAProximaAcao(null, daFicha(null))).toBe(false);
  });
  it('agrupa por lead com a contagem e a situação do prazo', () => {
    const r = tarefasDosCartoes([t('a', '2026-10-20', '2026-10-01T00:00:00Z'), t('b', null, '2026-10-01T00:00:00Z')], new Map([['L', null]]), '2026-10-21');
    expect(r.get('L')).toMatchObject({ abertas: 2, tarefa: { id: 'a', prazo: '2026-10-20', situacao: 'atrasada', ehProximaAcao: true } });
  });
});

describe.skipIf(!URL)('as tarefas do comercial no banco', { timeout: 60_000 }, () => {
  const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
  const p = prisma as unknown as PrismaService;
  let ORG = '';
  let VIZINHA = '';
  let app: INestApplication;
  let baseUrl = '';
  let jwt: JwtService;
  let work: WorkService;
  let fichas: FichaService;
  const ana = { id: '' };
  const leo = { id: '' };
  const bia = { id: '' };
  let leadA = '';
  let leadB = '';
  let leadDeFora = '';
  let tarefaDoTrabalho = '';

  const sessao = (id: string, permissions: string[]) =>
    jwt.signAsync({ typ: 'sessao', sub: id, orgId: ORG, permissions, roles: ['gestor_marketing'], email: `${id}@qa.invalid`, name: 'Pessoa sintética' });
  const pedir = async (metodo: 'GET' | 'POST' | 'PATCH', caminho: string, tk: string, corpo?: unknown) => {
    const r = await fetch(`${baseUrl}${caminho}`, {
      method: metodo,
      headers: { authorization: `Bearer ${tk}`, 'content-type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await r.text();
    return { status: r.status, corpo: texto ? JSON.parse(texto) : null };
  };
  const daAna = () => sessao(ana.id, PERMS);

  beforeAll(async () => {
    ORG = (await prisma.org.create({ data: { name: `Tarefas comercial ${MARCA}`, slug: `tarefas-com-${MARCA}` } })).id;
    VIZINHA = (await prisma.org.create({ data: { name: `Vizinha ${MARCA}`, slug: `vizinha-com-${MARCA}` } })).id;
    for (const key of PERMS) await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
    const gestor = await prisma.role.create({ data: { orgId: ORG, key: 'gestor_marketing', name: 'Gestor', permissions: { connect: PERMS.map((key) => ({ key })) } } });
    const leitor = await prisma.role.create({ data: { orgId: ORG, key: 'leitor', name: 'Leitor', permissions: { connect: [{ key: 'leads.ver' }] } } });
    const soLeads = await prisma.role.create({ data: { orgId: ORG, key: 'so_leads', name: 'Só leads', permissions: { connect: [{ key: 'leads.ver' }, { key: 'leads.editar' }] } } });
    ana.id = (await prisma.user.create({ data: { orgId: ORG, name: 'Ana Sintética', email: `ana.${MARCA}@qa.invalid`, passwordHash: 'x', roles: { connect: { id: gestor.id } } } })).id;
    leo.id = (await prisma.user.create({ data: { orgId: ORG, name: 'Leo Sintético', email: `leo.${MARCA}@qa.invalid`, passwordHash: 'x', roles: { connect: { id: leitor.id } } } })).id;
    bia.id = (await prisma.user.create({ data: { orgId: ORG, name: 'Bia Sintética', email: `bia.${MARCA}@qa.invalid`, passwordHash: 'x', roles: { connect: { id: soLeads.id } } } })).id;

    leadA = (await prisma.lead.create({ data: { orgId: ORG, name: 'Contato A', phone: '5532999990101' } })).id;
    leadB = (await prisma.lead.create({ data: { orgId: ORG, name: 'Contato B', phone: '5532999990102' } })).id;
    leadDeFora = (await prisma.lead.create({ data: { orgId: VIZINHA, name: 'Contato de fora', phone: '5532999990103' } })).id;
    await prisma.comercialFicha.create({ data: { leadId: leadA, orgId: ORG, empresa: 'Empresa A Sintética', etapa: 'qualificacao' } });
    await prisma.comercialFicha.create({ data: { leadId: leadB, orgId: ORG, empresa: 'Empresa B Sintética', etapa: 'qualificacao' } });

    // Uma tarefa comum do Trabalho, sem lead: não é do comercial.
    const espaco = await prisma.workSpace.create({ data: { orgId: ORG, name: 'Operação', order: 1 } });
    const lista = await prisma.workList.create({
      data: { orgId: ORG, spaceId: espaco.id, name: 'Rotina', natureza: 'tarefas', statuses: { create: [{ orgId: ORG, name: 'A fazer', type: 'open', order: 0 }, { orgId: ORG, name: 'Feito', type: 'closed', order: 1 }] } },
      include: { statuses: true },
    });
    tarefaDoTrabalho = (await prisma.workTask.create({ data: { orgId: ORG, listId: lista.id, statusId: lista.statuses[0].id, title: 'Trocar o filtro de linha' } })).id;

    const audit = new AuditService(p);
    work = new WorkService(p, audit, new CheckoutDeTarefaService(p, audit, new EventLogService(p)));
    const servico = new TarefasDoComercialService(p, audit, work);
    fichas = new FichaService(p, new FioService(p, new ReacoesRegistry()), new ConfigComercialService(p));

    jwt = new JwtService({ secret: randomUUID() + randomUUID(), signOptions: { expiresIn: '15m' } });
    const reflector = new Reflector();
    Reflect.defineMetadata('design:paramtypes', [TarefasDoComercialService], TarefasDoComercialController);
    const modulo = await Test.createTestingModule({
      controllers: [TarefasDoComercialController],
      providers: [{ provide: TarefasDoComercialService, useValue: servico }, { provide: JwtService, useValue: jwt }, Reflector],
    })
      .overrideGuard(JwtAuthGuard).useValue(new JwtAuthGuard(jwt))
      .overrideGuard(PermissionsGuard).useValue(new PermissionsGuard(reflector))
      .overrideGuard(AcessoAtualGuard).useValue(new AcessoAtualGuard(p, reflector))
      .compile();
    app = modulo.createNestApplication({ logger: ['error', 'warn'] });
    app.useGlobalInterceptors(new ContextoInterceptor());
    app.useGlobalFilters(new ZodExceptionFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    if (app) await app.close();
    for (const orgId of [ORG, VIZINHA].filter(Boolean)) {
      await prisma.workTask.deleteMany({ where: { orgId } });
      await prisma.workStatus.deleteMany({ where: { orgId } });
      await prisma.workList.deleteMany({ where: { orgId } });
      await prisma.workSpace.deleteMany({ where: { orgId } });
      await prisma.workArea.deleteMany({ where: { orgId } });
      await prisma.auditLog.deleteMany({ where: { orgId } });
      await prisma.comercialFicha.deleteMany({ where: { orgId } });
      await prisma.leadEvent.deleteMany({ where: { orgId } });
      await prisma.lead.deleteMany({ where: { orgId } });
      await prisma.user.deleteMany({ where: { orgId } });
      await prisma.role.deleteMany({ where: { orgId } });
      await prisma.org.delete({ where: { id: orgId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  let semLead: TarefaDoComercial;
  let doLead: TarefaDoComercial;

  it('cria sem lead e com lead, na lista do comercial e na área Comercial, com auditoria', async () => {
    const r1 = await pedir('POST', '/comercial/tarefas', await daAna(), { titulo: 'Atualizar o pipe', pessoaId: ana.id, prazo: '2026-10-30' });
    expect(r1.status).toBe(201);
    semLead = r1.corpo;
    expect(semLead).toMatchObject({ titulo: 'Atualizar o pipe', lead: null, prazo: '2026-10-30', status: { tipo: 'aberta' }, pessoa: { id: ana.id } });

    const r2 = await pedir('POST', '/comercial/tarefas', await daAna(), { titulo: 'Fazer FUP da proposta', leadId: leadA, prazo: '2026-10-22' });
    expect(r2.status).toBe(201);
    doLead = r2.corpo;
    expect(doLead.lead).toEqual({ id: leadA, nome: 'Empresa A Sintética' });

    const gravadas = await prisma.workTask.findMany({ where: { id: { in: [semLead.id, doLead.id] } }, include: { list: true, area: true } });
    for (const g of gravadas) {
      expect(g.list.externalId).toBe(LISTA_DO_COMERCIAL);
      expect(g.area?.nome).toBe('Comercial');
    }
    expect(gravadas.find((g) => g.id === doLead.id)?.leadId).toBe(leadA);
    const acoes = await prisma.auditLog.findMany({ where: { orgId: ORG, entityId: doLead.id }, select: { action: true, after: true } });
    expect(acoes.map((a) => a.action)).toEqual(expect.arrayContaining(['work.task.create', 'work.task.update']));
    expect(acoes.some((a) => (a.after as { leadId?: string } | null)?.leadId === leadA)).toBe(true);
  });

  it('lead de outra empresa e lead que não existe são recusados, sem criar nada', async () => {
    const antes = await prisma.workTask.count({ where: { orgId: ORG } });
    const r = await pedir('POST', '/comercial/tarefas', await daAna(), { titulo: 'Tarefa errada', leadId: leadDeFora });
    expect(r.status).toBe(400);
    expect(r.corpo.message).toContain('Lead não encontrado');
    expect((await pedir('POST', '/comercial/tarefas', await daAna(), { titulo: 'Outra', leadId: randomUUID() })).status).toBe(400);
    expect(await prisma.workTask.count({ where: { orgId: ORG } })).toBe(antes);
    // Também na edição.
    expect((await pedir('PATCH', `/comercial/tarefas/${semLead.id}`, await daAna(), { expectedUpdatedAt: semLead.updatedAt, leadId: leadDeFora })).status).toBe(400);
  });

  it('lista com os filtros: do lead, sem lead e por responsável', async () => {
    const doA = (await pedir('GET', `/comercial/tarefas?leadId=${leadA}`, await daAna())).corpo as TarefasDoComercial;
    expect(doA.tarefas.map((t) => t.id)).toEqual([doLead.id]);
    const soltas = (await pedir('GET', '/comercial/tarefas?semLead=1', await daAna())).corpo as TarefasDoComercial;
    expect(soltas.tarefas.map((t) => t.id)).toEqual([semLead.id]);
    expect(soltas.abertas).toBe(1);
    expect(soltas.pessoas.map((x) => x.nome)).toContain('Ana Sintética');
    const daAnaMesmo = (await pedir('GET', `/comercial/tarefas?pessoa=${ana.id}`, await daAna())).corpo as TarefasDoComercial;
    expect(daAnaMesmo.tarefas.map((t) => t.id)).toEqual([semLead.id]);
    const eu = (await pedir('GET', '/comercial/tarefas?pessoa=eu', await daAna())).corpo as TarefasDoComercial;
    expect(eu.tarefas.map((t) => t.id)).toEqual([semLead.id]);
    const semDono = (await pedir('GET', '/comercial/tarefas?pessoa=sem', await daAna())).corpo as TarefasDoComercial;
    expect(semDono.tarefas.map((t) => t.id)).toEqual([doLead.id]);
    // A tarefa do Trabalho sem lead não entra em lista nenhuma do comercial.
    const todas = (await pedir('GET', '/comercial/tarefas', await daAna())).corpo as TarefasDoComercial;
    expect(todas.tarefas.map((t) => t.id)).not.toContain(tarefaDoTrabalho);
  });

  it('edita título, responsável e prazo pela versão lida; versão velha é 409', async () => {
    const r = await pedir('PATCH', `/comercial/tarefas/${semLead.id}`, await daAna(), { expectedUpdatedAt: semLead.updatedAt, titulo: 'Atualizar o pipe do mês', pessoaId: null, prazo: '2026-10-28' });
    expect(r.status).toBe(200);
    expect(r.corpo).toMatchObject({ titulo: 'Atualizar o pipe do mês', pessoa: null, prazo: '2026-10-28' });
    const velha = await pedir('PATCH', `/comercial/tarefas/${semLead.id}`, await daAna(), { expectedUpdatedAt: semLead.updatedAt, titulo: 'Outro título' });
    expect(velha.status).toBe(409);
    semLead = r.corpo;
  });

  it('concluir e reabrir trocam pelo tipo do status da lista; a concluída vira histórico', async () => {
    const feita = await pedir('PATCH', `/comercial/tarefas/${semLead.id}`, await daAna(), { expectedUpdatedAt: semLead.updatedAt, etapa: 'concluida' });
    expect(feita.status).toBe(200);
    expect(feita.corpo.status).toEqual({ nome: 'Feito', tipo: 'concluida' });
    expect(feita.corpo.situacao).toBe('feita');
    const soltas = (await pedir('GET', '/comercial/tarefas?semLead=1', await daAna())).corpo as TarefasDoComercial;
    expect(soltas.abertas).toBe(0);
    expect(soltas.tarefas.map((t) => t.id)).toEqual([semLead.id]);
    const reaberta = await pedir('PATCH', `/comercial/tarefas/${semLead.id}`, await daAna(), { expectedUpdatedAt: feita.corpo.updatedAt, etapa: 'aberta' });
    expect(reaberta.corpo.status.tipo).toBe('aberta');
    semLead = reaberta.corpo;
  });

  it('liga e desliga o lead, com auditoria; a tarefa do Trabalho sem lead não se edita por aqui', async () => {
    const ligada = await pedir('PATCH', `/comercial/tarefas/${semLead.id}`, await daAna(), { expectedUpdatedAt: semLead.updatedAt, leadId: leadB });
    expect(ligada.status).toBe(200);
    expect(ligada.corpo.lead).toEqual({ id: leadB, nome: 'Empresa B Sintética' });
    const desligada = await pedir('PATCH', `/comercial/tarefas/${semLead.id}`, await daAna(), { expectedUpdatedAt: ligada.corpo.updatedAt, leadId: null });
    expect(desligada.corpo.lead).toBeNull();
    semLead = desligada.corpo;
    const linhas = await prisma.auditLog.findMany({ where: { orgId: ORG, entityId: semLead.id, action: 'work.task.update' }, select: { before: true, after: true } });
    expect(linhas.some((l) => (l.after as { leadId?: unknown }).leadId === leadB)).toBe(true);
    expect(linhas.some((l) => (l.before as { leadId?: unknown }).leadId === leadB && (l.after as { leadId?: unknown }).leadId === null)).toBe(true);

    const t = await prisma.workTask.findUniqueOrThrow({ where: { id: tarefaDoTrabalho } });
    const r = await pedir('PATCH', `/comercial/tarefas/${tarefaDoTrabalho}`, await daAna(), { expectedUpdatedAt: t.updatedAt.toISOString(), titulo: 'Mudou pelo comercial' });
    expect(r.status).toBe(404);
    expect((await prisma.workTask.findUniqueOrThrow({ where: { id: tarefaDoTrabalho } })).title).toBe('Trocar o filtro de linha');
  });

  it('permissões: ler pede leads.ver; escrever pede leads.editar e tarefas.editar, relidas no banco', async () => {
    const leitor = await sessao(leo.id, ['leads.ver']);
    expect((await pedir('GET', '/comercial/tarefas', leitor)).status).toBe(200);
    expect((await pedir('POST', '/comercial/tarefas', leitor, { titulo: 'Não pode' })).status).toBe(403);
    expect((await pedir('GET', '/comercial/tarefas', await sessao(leo.id, []))).status).toBe(403);
    // Sem tarefas.editar no token: a guarda recusa.
    expect((await pedir('POST', '/comercial/tarefas', await sessao(bia.id, ['leads.ver', 'leads.editar']), { titulo: 'Não pode' })).status).toBe(403);
    // Com as duas no token, mas não no banco (a permissão saiu depois do login): recusa também.
    expect((await pedir('POST', '/comercial/tarefas', await sessao(bia.id, PERMS), { titulo: 'Não pode' })).status).toBe(403);
    expect((await pedir('PATCH', `/comercial/tarefas/${doLead.id}`, await sessao(bia.id, PERMS), { expectedUpdatedAt: doLead.updatedAt, etapa: 'concluida' })).status).toBe(403);
    expect(await prisma.workTask.count({ where: { orgId: ORG, title: 'Não pode' } })).toBe(0);
  });

  it('o cartão do funil traz a tarefa mais antiga como próxima ação e a contagem, sem escrever a ficha', async () => {
    // Mais duas do lead A: uma sem prazo e uma com prazo depois; a de 22/10 continua a mais antiga.
    await pedir('POST', '/comercial/tarefas', await daAna(), { titulo: 'Mandar o material', leadId: leadA });
    await pedir('POST', '/comercial/tarefas', await daAna(), { titulo: 'Marcar a reunião', leadId: leadA, prazo: '2026-11-05' });
    // Uma concluída do lead B não conta.
    const feita = (await pedir('POST', '/comercial/tarefas', await daAna(), { titulo: 'Ligar para o contato', leadId: leadB })).corpo as TarefaDoComercial;
    await pedir('PATCH', `/comercial/tarefas/${feita.id}`, await daAna(), { expectedUpdatedAt: feita.updatedAt, etapa: 'concluida' });

    const fichaAntes = await prisma.comercialFicha.findUniqueOrThrow({ where: { leadId: leadA } });
    const funil = await fichas.funil(ORG, null, new Date('2026-10-21T12:00:00-03:00'));
    const cartoes = funil.colunas.flatMap((c) => c.cartoes) as CartaoDoFunil[];
    const a = cartoes.find((c) => c.leadId === leadA)!;
    const b = cartoes.find((c) => c.leadId === leadB)!;
    expect(a.tarefasAbertas).toBe(3);
    expect(a.tarefa).toMatchObject({ id: doLead.id, titulo: 'Fazer FUP da proposta', prazo: '2026-10-22', situacao: 'proximos_7' });
    // Na qualificação a ficha pede o formulário sem data: a tarefa com prazo passa à frente.
    expect(a.proximaAcao?.quando ?? null).toBeNull();
    expect(a.tarefa?.ehProximaAcao).toBe(true);
    expect(b.tarefa).toBeNull();
    expect(b.tarefasAbertas).toBe(0);
    const fichaDepois = await prisma.comercialFicha.findUniqueOrThrow({ where: { leadId: leadA } });
    expect(fichaDepois).toEqual(fichaAntes);
  });

  it('a lista do comercial fica fora da árvore do Trabalho e de Todas', async () => {
    const lista = await prisma.workList.findFirstOrThrow({ where: { orgId: ORG, externalId: LISTA_DO_COMERCIAL } });
    const arvore = JSON.stringify(await work.estrutura(ORG));
    expect(arvore).not.toContain(lista.id);
    expect(arvore).toContain('Rotina');
    const todas = await work.tarefas(ORG, { todas: true });
    const ids = todas.items.map((t) => t.id);
    expect(ids).toContain(tarefaDoTrabalho);
    expect(ids).not.toContain(doLead.id);
    expect(ids).not.toContain(semLead.id);
  });

  it('M3: "+ tarefa" recusa título repetido aberto do mesmo lead com a frase do Dia a dia; outro lead e concluída passam', async () => {
    const antes = await prisma.workTask.count({ where: { orgId: ORG } });
    // A mesma do lead A em outra grafia (maiúscula, acento, palavras trocadas): igual.
    const r = await pedir('POST', '/comercial/tarefas', await daAna(), { titulo: '  fazer fup da PROPOSTA ', leadId: leadA });
    expect(r.status).toBe(409);
    expect(r.corpo).toMatchObject({ message: TAREFA_IGUAL_JA_EXISTE, code: 'tarefa_igual', tarefaId: doLead.id });
    const trocada = await pedir('POST', '/comercial/tarefas', await daAna(), { titulo: 'Proposta: fazer FUP', leadId: leadA });
    expect(trocada.status).toBe(409);
    expect(await prisma.workTask.count({ where: { orgId: ORG } })).toBe(antes);
    // Sem lead, a comparação é entre as sem lead.
    expect((await pedir('POST', '/comercial/tarefas', await daAna(), { titulo: 'Conferir a régua do funil' })).status).toBe(201);
    expect((await pedir('POST', '/comercial/tarefas', await daAna(), { titulo: 'conferir a REGUA do funil' })).status).toBe(409);
    expect((await pedir('POST', '/comercial/tarefas', await daAna(), { titulo: 'Conferir a régua do funil', leadId: leadA })).status).toBe(201);
    // Do lead B, o mesmo título é outra tarefa.
    expect((await pedir('POST', '/comercial/tarefas', await daAna(), { titulo: 'Fazer FUP da proposta', leadId: leadB })).status).toBe(201);
    // A concluída do lead B ("Ligar para o contato") não segura uma nova.
    expect((await pedir('POST', '/comercial/tarefas', await daAna(), { titulo: 'Ligar para o contato', leadId: leadB })).status).toBe(201);
  });

  it('M3: a tarefa que se repete, ligada a lead e concluída pelo Trabalho, cria a próxima com o mesmo lead', async () => {
    const criada = (await pedir('POST', '/comercial/tarefas', await daAna(), { titulo: 'Revisar o contrato toda semana', leadId: leadB, prazo: '2026-10-23' })).corpo as TarefaDoComercial;
    const comRegra = await work.editarTarefa(ORG, ana.id, criada.id, {
      expectedUpdatedAt: criada.updatedAt, recorrencia: { tipo: 'semanal', dias: [4] },
    });
    const lista = await prisma.workList.findFirstOrThrow({ where: { orgId: ORG, externalId: LISTA_DO_COMERCIAL }, include: { statuses: true } });
    const feito = lista.statuses.find((s) => s.type === 'closed')!;
    // Concluída pela tela do Trabalho (o `WorkService`, sem passar pelo Comercial).
    const r = await work.editarTarefa(ORG, ana.id, criada.id, { expectedUpdatedAt: comRegra.updatedAt, statusId: feito.id }) as { proxima?: { id: string } };
    expect(r.proxima?.id).toBeTruthy();
    const proxima = await prisma.workTask.findUniqueOrThrow({ where: { id: r.proxima!.id } });
    expect(proxima.leadId).toBe(leadB);
    expect(proxima.listId).toBe(lista.id);
  });
});
