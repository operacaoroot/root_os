import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { ForbiddenException, NotFoundException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LEAD_ORIGEM_TIPOS, LeadEntradaSchema, LeadTrocaDeDonoSchema, type LeadEntradaInput } from '@mktos/shared';
import { LeadsController } from '../src/leads/leads.controller';
import { LeadsService, type AtorDaEntrada } from '../src/leads/leads.service';
import {
  camposRecebidos,
  diferencaDaEntrada,
  eventoIdDaEntrada,
  hashDoPedido,
  leadIdDaEntrada,
  nomeDeReserva,
} from '../src/leads/entrada-de-lead';
import { AuditService } from '../src/audit/audit.service';
import { ApprovalGuard } from '../src/approvals/approval.guard';
import { ApprovalsService } from '../src/approvals/approvals.service';
import { SENSITIVE_WRITE_KEY } from '../src/approvals/sensitive-write.decorator';
import { PermissionsGuard } from '../src/auth/permissions.guard';
import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import { ModulosService } from '../src/tenants/modulos.service';
import { ModulosInterceptor } from '../src/tenants/modulos.interceptor';
import { comContexto, novaCorrelacao } from '../src/common/contexto-execucao';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * ROOT-48 — A ENTRADA DE LEAD (C-01, C-13, C-14), DONO E PROCEDÊNCIA DA PAUTA.
 *
 * Sem banco: identidade determinística, hash do pedido, diferença, schema e as
 * permissões declaradas. Com banco (Postgres descartável): a repetição, a
 * CORRIDA de verdade, a referência de outra empresa, as permissões e o módulo.
 * Nenhum dado de produção: toda linha nasce e morre aqui, em empresas próprias.
 */

const ORG_A = 'org-root48-a';
const ORG_B = 'org-root48-b';
const ORG_SEM_LEADS = 'org-root48-sem-leads';
const ORG_SEM_PAUTA = 'org-root48-sem-pauta';
const TODAS = [ORG_A, ORG_B, ORG_SEM_LEADS, ORG_SEM_PAUTA];

const manual = (ref: string, extra: Record<string, unknown> = {}) =>
  LeadEntradaSchema.parse({ origem: { tipo: 'manual', ref }, nome: 'Maria Souza', ...extra });

describe('ROOT-48: a identidade e o pedido (puro)', () => {
  it('o id do lead é a origem: estável, por empresa e por tipo', () => {
    const origem = { tipo: 'manual', ref: 'k-1' } as const;
    const id = leadIdDaEntrada('org-1', origem);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(leadIdDaEntrada('org-1', origem)).toBe(id);
    expect(leadIdDaEntrada('org-2', origem)).not.toBe(id);
    expect(leadIdDaEntrada('org-1', { tipo: 'pixel', ref: 'k-1' })).not.toBe(id);
    expect(leadIdDaEntrada('org-1', { tipo: 'manual', ref: 'k-2' })).not.toBe(id);
    for (const tipo of LEAD_ORIGEM_TIPOS) expect(leadIdDaEntrada('o', { tipo, ref: 'r' })).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('o id do evento é o conteúdo: o mesmo pedido cai no mesmo id, conteúdo novo ganha id novo', () => {
    const a = manual('k-1');
    const b = manual('k-1', { email: 'Maria@Exemplo.com' });
    expect(hashDoPedido(a)).toBe(hashDoPedido(manual('k-1')));
    expect(hashDoPedido(a)).not.toBe(hashDoPedido(b));
    const lead = leadIdDaEntrada('o', a.origem);
    expect(eventoIdDaEntrada('o', lead, hashDoPedido(a))).toBe(eventoIdDaEntrada('o', lead, hashDoPedido(a)));
    expect(eventoIdDaEntrada('o', lead, hashDoPedido(a))).not.toBe(eventoIdDaEntrada('o', lead, hashDoPedido(b)));
  });

  it('a ordem das chaves do corpo não muda o hash, e o e-mail é normalizado antes dele', () => {
    const x = LeadEntradaSchema.parse({ nome: 'Ana', origem: { ref: 'r', tipo: 'manual' }, email: ' ANA@Exemplo.com ' });
    const y = LeadEntradaSchema.parse({ origem: { tipo: 'manual', ref: 'r' }, email: 'ana@exemplo.com', nome: 'Ana' });
    expect(x.email).toBe('ana@exemplo.com');
    expect(hashDoPedido(x)).toBe(hashDoPedido(y));
  });

  it('a diferença só olha o que o pedido traz: campo ausente não apaga nem aparece', () => {
    const atual = {
      name: 'Maria', email: 'm@x.com', phone: null, campaignId: null, sourceId: null, ownerId: null,
      utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null, utmTerm: null, landingPage: null,
    };
    const input = manual('k', { nome: 'Maria', email: 'm@x.com', telefone: '1199' });
    const recebido = camposRecebidos(input, { nome: 'Maria' });
    expect(diferencaDaEntrada(atual, recebido)).toEqual({ phone: { atual: null, recebido: '1199' } });
    expect(diferencaDaEntrada(atual, camposRecebidos(manual('k', { nome: 'Maria' }), { nome: 'Maria' }))).toEqual({});
  });

  it('o schema recusa campo fora da lista, etapa e próxima ação (a entrada não escreve Lead.status)', () => {
    expect(LeadEntradaSchema.safeParse({ origem: { tipo: 'manual', ref: 'k' }, nome: 'A', status: 'ganho' }).success).toBe(false);
    expect(LeadEntradaSchema.safeParse({ origem: { tipo: 'manual', ref: 'k' }, nome: 'A', nextAction: 'ligar' }).success).toBe(false);
    expect(LeadEntradaSchema.safeParse({ origem: { tipo: 'whatsapp', ref: 'k' }, nome: 'A' }).success).toBe(false);
    expect(LeadEntradaSchema.safeParse({ origem: { tipo: 'manual', ref: '  ' }, nome: 'A' }).success).toBe(false);
    expect(LeadEntradaSchema.safeParse({ origem: { tipo: 'manual', ref: 'k' } }).success).toBe(false);
    expect(LeadEntradaSchema.safeParse({ origem: { tipo: 'clickup', ref: 'k' } }).success).toBe(false);
  });

  it('o @ só entra com o clique: incluirUsuario vale só na Pauta e não convive com nome', () => {
    expect(LeadEntradaSchema.safeParse({ origem: { tipo: 'pauta-comentario', ref: 'c' } }).success).toBe(true);
    expect(LeadEntradaSchema.safeParse({ origem: { tipo: 'pauta-comentario', ref: 'c' }, incluirUsuario: true }).success).toBe(true);
    expect(LeadEntradaSchema.safeParse({ origem: { tipo: 'pauta-comentario', ref: 'c' }, incluirUsuario: true, nome: 'X' }).success).toBe(false);
    expect(LeadEntradaSchema.safeParse({ origem: { tipo: 'manual', ref: 'c' }, nome: 'X', incluirUsuario: true }).success).toBe(false);
    const sem = LeadEntradaSchema.parse({ origem: { tipo: 'pauta-comentario', ref: 'c' } });
    const com = LeadEntradaSchema.parse({ origem: { tipo: 'pauta-comentario', ref: 'c' }, incluirUsuario: true });
    const c = { usuario: 'fulano.silva', palavra: 'AGENTES' };
    expect(nomeDeReserva(sem, c)).toBe('Comentário com a palavra AGENTES');
    expect(nomeDeReserva(com, c)).toBe('@fulano.silva');
    expect(nomeDeReserva(LeadEntradaSchema.parse({ origem: { tipo: 'pixel', ref: 'rid' } }), null)).toBe('Visitante do site');
  });

  it('a troca de dono aceita id ou nulo, e nada além do motivo', () => {
    expect(LeadTrocaDeDonoSchema.safeParse({ ownerId: null }).success).toBe(true);
    expect(LeadTrocaDeDonoSchema.safeParse({ ownerId: 'u-1', motivo: 'férias' }).success).toBe(true);
    expect(LeadTrocaDeDonoSchema.safeParse({ ownerId: 'u-1', status: 'ganho' }).success).toBe(false);
    expect(LeadTrocaDeDonoSchema.safeParse({}).success).toBe(false);
  });

  it('ACL declarada: entrada e dono pedem leads.editar; ler pede leads.ver; etapa segue sob aprovação', () => {
    const p = LeadsController.prototype;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, p.entrada)).toEqual(['leads.editar']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, p.trocarDono)).toEqual(['leads.editar']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, p.getOne)).toEqual(['leads.ver']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, p.update)).toEqual(['leads.editar']);
    expect(Reflect.getMetadata(SENSITIVE_WRITE_KEY, p.update)).toBe('lead');
    expect(Reflect.getMetadata('__guards__', p.update)).toContain(ApprovalGuard);
    // Dono e entrada NÃO são escrita sensível (E26): o porquê está em `LeadsService.trocarDono`.
    expect(Reflect.getMetadata(SENSITIVE_WRITE_KEY, p.entrada)).toBeUndefined();
    expect(Reflect.getMetadata(SENSITIVE_WRITE_KEY, p.trocarDono)).toBeUndefined();
  });

  it('o prefixo leads é do módulo leads: sem o módulo, a rota nova responde 404', async () => {
    const modulos = { modulosDaOrg: async () => new Set(['pauta']) } as unknown as ModulosService;
    const interceptor = new ModulosInterceptor(modulos);
    const ctx = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => ({ originalUrl: '/api/leads/entrada', user: { orgId: 'org-x' } }) }),
    } as unknown as ExecutionContext;
    const handler: CallHandler = { handle: () => of('passou') };
    await expect(lastValueFrom(interceptor.intercept(ctx, handler))).rejects.toBeInstanceOf(NotFoundException);
    const ligado = new ModulosInterceptor({ modulosDaOrg: async () => new Set(['leads']) } as unknown as ModulosService);
    await expect(lastValueFrom(ligado.intercept(ctx, handler))).resolves.toBe('passou');
  });

  it('sem leads.editar, o guarda de permissão recusa com 403', () => {
    const guarda = new PermissionsGuard(new Reflector());
    const contexto = (permissions: string[], handler: (...a: never[]) => unknown) =>
      ({
        getHandler: () => handler,
        getClass: () => LeadsController,
        switchToHttp: () => ({ getRequest: () => ({ user: { permissions } }) }),
      }) as unknown as ExecutionContext;
    for (const handler of [LeadsController.prototype.entrada, LeadsController.prototype.trocarDono]) {
      expect(() => guarda.canActivate(contexto(['leads.ver'], handler as never))).toThrow(ForbiddenException);
      expect(guarda.canActivate(contexto(['leads.editar'], handler as never))).toBe(true);
    }
  });
});

const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'ESCREVE nele (empresas, usuários, leads, campanhas e auditoria da ROOT-48)');

describe.skipIf(!URL)('ROOT-48: a entrada contra o Postgres descartável', () => {
  let prisma: PrismaClient;
  let svc: LeadsService;
  let modulos: ModulosService;
  let userA: string;
  let userA2: string;
  let userB: string;
  let campanhaA: string;
  let campanhaB: string;
  let comentarioA: string;
  let comentarioA2: string;
  let comentarioB: string;
  let pecaA: string;

  const ator = (over: Partial<AtorDaEntrada> = {}): AtorDaEntrada => ({
    sub: userA,
    orgId: ORG_A,
    permissions: ['leads.ver', 'leads.editar', 'pauta.ver'],
    ...over,
  });
  const entrar = (input: LeadEntradaInput, a: AtorDaEntrada = ator()) => comContexto({ orgId: a.orgId, correlationId: novaCorrelacao() }, () => svc.entrada(a, input));
  const eventos = (leadId: string, type = 'entrada') => prisma.leadEvent.findMany({ where: { leadId, type }, orderBy: { occurredAt: 'asc' } });
  const auditorias = (leadId: string, action: string) => prisma.auditLog.count({ where: { entityId: leadId, action } });

  async function limpar() {
    await prisma.auditLog.deleteMany({ where: { orgId: { in: TODAS } } });
    await prisma.leadEvent.deleteMany({ where: { lead: { orgId: { in: TODAS } } } });
    await prisma.lead.deleteMany({ where: { orgId: { in: TODAS } } });
    await prisma.pixelEvent.deleteMany({ where: { orgId: { in: TODAS } } });
    await prisma.comentarioComPalavra.deleteMany({ where: { orgId: { in: TODAS } } });
    await prisma.pautaPeca.deleteMany({ where: { orgId: { in: TODAS } } });
    await prisma.pautaRodada.deleteMany({ where: { orgId: { in: TODAS } } });
    await prisma.campaign.deleteMany({ where: { orgId: { in: TODAS } } });
    await prisma.leadSource.deleteMany({ where: { orgId: { in: TODAS } } });
    await prisma.user.deleteMany({ where: { orgId: { in: TODAS } } });
    await prisma.org.deleteMany({ where: { id: { in: TODAS } } });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    await limpar();
    const orgs: Array<[string, string[]]> = [
      [ORG_A, ['leads', 'pauta']],
      [ORG_B, ['leads', 'pauta']],
      [ORG_SEM_LEADS, ['pauta']],
      [ORG_SEM_PAUTA, ['leads']],
    ];
    for (const [id, mods] of orgs) await prisma.org.create({ data: { id, name: id, slug: id, modulos: mods } });
    const usuario = (id: string, orgId: string, ativo = true) =>
      prisma.user.create({ data: { id, orgId, email: `${id}@root48.teste`, name: `Usuário ${id}`, passwordHash: 'sem-senha-util', isActive: ativo } });
    userA = (await usuario('root48-ua', ORG_A)).id;
    userA2 = (await usuario('root48-ua2', ORG_A)).id;
    userB = (await usuario('root48-ub', ORG_B)).id;
    await usuario('root48-inativo', ORG_A, false);
    await prisma.leadSource.create({ data: { orgId: ORG_A, key: 'site', name: 'Site' } });
    await prisma.leadSource.create({ data: { orgId: ORG_B, key: 'so-da-b', name: 'Só da B' } });
    campanhaA = (await prisma.campaign.create({ data: { orgId: ORG_A, name: 'Campanha A' } })).id;
    campanhaB = (await prisma.campaign.create({ data: { orgId: ORG_B, name: 'Campanha B' } })).id;

    const agora = new Date();
    const comentario = async (orgId: string, commentId: string, hmac: string, usuarioIg: string | null) => {
      const rodada = await prisma.pautaRodada.create({ data: { orgId, status: 'curada', titulo: `Rodada ${commentId}`, janelaIni: agora, janelaFim: agora } });
      const peca = await prisma.pautaPeca.create({ data: { orgId, rodadaId: rodada.id, canal: 'instagram', formato: 'carrossel', titulo: 'Carrossel', corpo: 'x', status: 'publicada' } });
      const c = await prisma.comentarioComPalavra.create({
        data: { pecaId: peca.id, commentId, midiaId: 'midia-1', palavra: 'AGENTES', pessoaHmac: hmac, usuario: usuarioIg, comentadoEm: agora, expiraEm: new Date(agora.getTime() + 7 * 86_400_000) },
      });
      return { peca: peca.id, comentario: c.id };
    };
    const a1 = await comentario(ORG_A, 'meta-c-1', 'hmac-da-pessoa', 'fulano.silva');
    const a2 = await comentario(ORG_A, 'meta-c-2', 'hmac-da-pessoa', 'fulano.silva');
    const b1 = await comentario(ORG_B, 'meta-c-3', 'hmac-da-b', 'beltrano');
    pecaA = a1.peca;
    comentarioA = a1.comentario;
    comentarioA2 = a2.comentario;
    comentarioB = b1.comentario;
    await prisma.pixelEvent.create({ data: { orgId: ORG_B, eventId: 'root48-ev-b', sessionId: 's', anonymousId: 'rid-da-b', eventName: 'page_view' } });
    await prisma.pixelEvent.create({ data: { orgId: ORG_A, eventId: 'root48-ev-a', sessionId: 's', anonymousId: 'rid-da-a', eventName: 'page_view' } });

    const p = prisma as unknown as PrismaService;
    modulos = new ModulosService(p);
    svc = new LeadsService(p, new AuditService(p), modulos);
  }, 60_000);

  afterAll(async () => {
    await limpar();
    await prisma.$disconnect();
  });

  it('o mesmo pedido duas vezes: um lead e um evento entrada; a segunda é replay e não grava nada', async () => {
    const pedido = manual('dupla-1', { email: 'maria@exemplo.com' });
    const a = await entrar(pedido);
    const b = await entrar(pedido);
    expect(a).toMatchObject({ criado: true, replayed: false, diferenca: null });
    expect(b).toMatchObject({ id: a.id, criado: false, replayed: true, diferenca: null, eventoId: a.eventoId });
    expect(await prisma.lead.count({ where: { orgId: ORG_A, id: a.id } })).toBe(1);
    const evs = await eventos(a.id);
    expect(evs).toHaveLength(1);
    expect(evs[0].id).toBe(a.eventoId);
    expect(evs[0].payload).toMatchObject({
      origem: { tipo: 'manual', ref: 'dupla-1' },
      chaveDoPedido: 'manual:dupla-1',
      requestHash: hashDoPedido(pedido),
      ator: userA,
      criouLead: true,
    });
    expect(await auditorias(a.id, 'lead.entrada')).toBe(1);
    // A entrada não escreve etapa nem próxima ação.
    const lead = await prisma.lead.findFirstOrThrow({ where: { id: a.id } });
    expect(lead).toMatchObject({ status: 'novo', nextAction: null, orgId: ORG_A });
  });

  it('chamadas simultâneas do mesmo pedido: um lead, um evento, uma só criou (Postgres real)', async () => {
    const pedido = manual('corrida-1', { telefone: '11999990000' });
    const respostas = await Promise.all(Array.from({ length: 12 }, () => entrar(pedido)));
    const id = leadIdDaEntrada(ORG_A, pedido.origem);
    expect(new Set(respostas.map((r) => r.id))).toEqual(new Set([id]));
    expect(respostas.filter((r) => r.criado)).toHaveLength(1);
    expect(respostas.filter((r) => r.replayed)).toHaveLength(11);
    expect(await prisma.lead.count({ where: { orgId: ORG_A, id } })).toBe(1);
    expect(await eventos(id)).toHaveLength(1);
    expect(await auditorias(id, 'lead.entrada')).toBe(1);
  });

  it('simultâneas com dois conteúdos da mesma origem: um lead, um evento por conteúdo, campos do primeiro preservados', async () => {
    const x = manual('corrida-2', { email: 'um@exemplo.com' });
    const y = manual('corrida-2', { email: 'dois@exemplo.com' });
    const respostas = await Promise.all([x, y, x, y, x, y].map((p) => entrar(p)));
    const id = leadIdDaEntrada(ORG_A, x.origem);
    expect(await prisma.lead.count({ where: { orgId: ORG_A, id } })).toBe(1);
    expect(await eventos(id)).toHaveLength(2);
    expect(respostas.filter((r) => r.criado)).toHaveLength(1);
    const lead = await prisma.lead.findFirstOrThrow({ where: { id } });
    expect(['um@exemplo.com', 'dois@exemplo.com']).toContain(lead.email);
  });

  it('mesma origem com conteúdo diferente: campos preservados, evento novo com a diferença', async () => {
    const primeiro = manual('dif-1', { email: 'antigo@exemplo.com', telefone: '1111' });
    const a = await entrar(primeiro);
    const segundo = manual('dif-1', { nome: 'Maria Outra', email: 'novo@exemplo.com', campaignId: campanhaA, sourceKey: 'site' });
    const b = await entrar(segundo);
    expect(b).toMatchObject({ id: a.id, criado: false, replayed: false });
    expect(b.eventoId).not.toBe(a.eventoId);
    expect(b.diferenca).toMatchObject({
      name: { atual: 'Maria Souza', recebido: 'Maria Outra' },
      email: { atual: 'antigo@exemplo.com', recebido: 'novo@exemplo.com' },
      campaignId: { atual: null, recebido: campanhaA },
    });
    expect(b.diferenca).not.toHaveProperty('phone');
    const lead = await prisma.lead.findFirstOrThrow({ where: { id: a.id } });
    expect(lead).toMatchObject({ name: 'Maria Souza', email: 'antigo@exemplo.com', phone: '1111', campaignId: null });
    const evs = await eventos(a.id);
    expect(evs).toHaveLength(2);
    expect(evs[1].payload).toMatchObject({ criouLead: false, diferenca: { email: { atual: 'antigo@exemplo.com', recebido: 'novo@exemplo.com' } } });
    expect(await auditorias(a.id, 'lead.entrada')).toBe(2);
    // Repetir o segundo pedido agora é replay.
    expect(await entrar(segundo)).toMatchObject({ replayed: true, diferenca: null });
    expect(await eventos(a.id)).toHaveLength(2);
  });

  it('campaignId, sourceKey, ownerId e origem de outra empresa: 404, e nada é gravado', async () => {
    const antes = await prisma.lead.count({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    const casos: LeadEntradaInput[] = [
      manual('x-camp', { campaignId: campanhaB }),
      manual('x-camp-inexistente', { campaignId: 'nao-existe' }),
      manual('x-fonte', { sourceKey: 'so-da-b' }),
      manual('x-dono', { ownerId: userB }),
      LeadEntradaSchema.parse({ origem: { tipo: 'pauta-comentario', ref: comentarioB } }),
      LeadEntradaSchema.parse({ origem: { tipo: 'pixel', ref: 'rid-da-b' } }),
    ];
    for (const caso of casos) await expect(entrar(caso)).rejects.toBeInstanceOf(NotFoundException);
    expect(await prisma.lead.count({ where: { orgId: { in: [ORG_A, ORG_B] } } })).toBe(antes);
  });

  it('dono inativo também é 404; dono da própria empresa entra como dono do lead', async () => {
    await expect(entrar(manual('dono-inativo', { ownerId: 'root48-inativo' }))).rejects.toBeInstanceOf(NotFoundException);
    const r = await entrar(manual('dono-ok', { ownerId: userA2 }));
    expect((await prisma.lead.findFirstOrThrow({ where: { id: r.id } })).ownerId).toBe(userA2);
  });

  it('origem da Pauta sem pauta.ver: 403 (e nada gravado); com o módulo pauta desligado: 404', async () => {
    const pedido = LeadEntradaSchema.parse({ origem: { tipo: 'pauta-comentario', ref: comentarioA } });
    await expect(entrar(pedido, ator({ permissions: ['leads.ver', 'leads.editar'] }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(await prisma.lead.count({ where: { id: leadIdDaEntrada(ORG_A, pedido.origem) } })).toBe(0);

    const semPauta = ator({ orgId: ORG_SEM_PAUTA });
    await expect(entrar(pedido, semPauta)).rejects.toBeInstanceOf(NotFoundException);
    // Origem que não é da Pauta segue sem pauta.ver.
    const r = await entrar(manual('sem-pauta-ok'), ator({ permissions: ['leads.editar'] }));
    expect(r.criado).toBe(true);
    // Sem o módulo leads, o gate de prefixo recusa antes do serviço (interceptor real, módulos do banco).
    const interceptor = new ModulosInterceptor(modulos);
    const ctx = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ originalUrl: '/api/leads/entrada', user: { orgId: ORG_SEM_LEADS } }) }) } as unknown as ExecutionContext;
    await expect(lastValueFrom(interceptor.intercept(ctx, { handle: () => of(1) }))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('Pauta: o lead leva o que sobrevive à expurgação e NUNCA o HMAC, o id da Meta nem o @ sem o clique', async () => {
    const pedido = LeadEntradaSchema.parse({ origem: { tipo: 'pauta-comentario', ref: comentarioA } });
    const r = await entrar(pedido);
    const lead = await prisma.lead.findFirstOrThrow({ where: { id: r.id } });
    expect(lead.name).toBe('Comentário com a palavra AGENTES');
    const [ev] = await eventos(r.id);
    expect(ev.payload).toMatchObject({
      origem: { tipo: 'pauta-comentario', ref: comentarioA },
      procedencia: { pecaId: pecaA, palavra: 'AGENTES', usuarioCopiado: false },
    });
    expect((ev.payload as { procedencia: { comentadoEm: string } }).procedencia.comentadoEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const bruto = JSON.stringify([lead, ev]);
    for (const segredo of ['hmac-da-pessoa', 'meta-c-1', 'fulano.silva']) expect(bruto).not.toContain(segredo);

    // O clique humano leva o @ para o nome.
    const comClique = await entrar(LeadEntradaSchema.parse({ origem: { tipo: 'pauta-comentario', ref: comentarioA2 }, incluirUsuario: true }));
    const l2 = await prisma.lead.findFirstOrThrow({ where: { id: comClique.id } });
    expect(l2.name).toBe('@fulano.silva');
    const [e2] = await eventos(comClique.id);
    expect(e2.payload).toMatchObject({ procedencia: { usuarioCopiado: true } });
    expect(JSON.stringify(e2.payload)).not.toContain('hmac-da-pessoa');
  });

  it('o lead sobrevive à expurgação: repetir o pedido depois de a linha sumir é replay, e o @ expirado recusa o clique', async () => {
    const expira = await prisma.comentarioComPalavra.findFirstOrThrow({ where: { orgId: ORG_A, commentId: 'meta-c-1' } });
    const pedido = LeadEntradaSchema.parse({ origem: { tipo: 'pauta-comentario', ref: comentarioA } });
    const antes = await eventos(leadIdDaEntrada(ORG_A, pedido.origem));
    expect(antes).toHaveLength(1);

    await prisma.comentarioComPalavra.update({ where: { id: expira.id }, data: { usuario: null } });
    await expect(entrar(LeadEntradaSchema.parse({ origem: { tipo: 'pauta-comentario', ref: comentarioA }, incluirUsuario: true }))).rejects.toThrow(/expirou/);

    // Expurgou: a linha foi apagada (14 dias). O mesmo pedido é replay, sem consultar a Pauta.
    const lead = leadIdDaEntrada(ORG_A, pedido.origem);
    await prisma.comentarioComPalavra.delete({ where: { id: expira.id } });
    expect(await entrar(pedido)).toMatchObject({ id: lead, replayed: true });
    expect(await prisma.lead.count({ where: { id: lead } })).toBe(1);
    expect((await eventos(lead))[0].payload).toMatchObject({ procedencia: { pecaId: pecaA, palavra: 'AGENTES' } });
  });

  it('um lead por comentário; o aviso de possível mesma pessoa vem da LEITURA e some com a expurgação', async () => {
    // comentarioA já foi apagado no caso anterior; refaz a dupla do mesmo HMAC.
    const agora = new Date();
    const c1 = await prisma.comentarioComPalavra.create({
      data: { pecaId: pecaA, commentId: 'meta-c-9', midiaId: 'midia-1', palavra: 'AGENTES', pessoaHmac: 'hmac-dupla', usuario: 'dupla', comentadoEm: agora, expiraEm: new Date(agora.getTime() + 86_400_000) },
    });
    const c2 = await prisma.comentarioComPalavra.create({
      data: { pecaId: pecaA, commentId: 'meta-c-10', midiaId: 'midia-1', palavra: 'PLANILHA', pessoaHmac: 'hmac-dupla', usuario: 'dupla', comentadoEm: agora, expiraEm: new Date(agora.getTime() + 86_400_000) },
    });
    const l1 = await entrar(LeadEntradaSchema.parse({ origem: { tipo: 'pauta-comentario', ref: c1.id } }));
    const l2 = await entrar(LeadEntradaSchema.parse({ origem: { tipo: 'pauta-comentario', ref: c2.id } }));
    expect(l1.id).not.toBe(l2.id);

    const lido = await svc.getOne(ORG_A, l1.id, ['leads.ver', 'pauta.ver']);
    expect(lido.origem).toEqual({ tipo: 'pauta-comentario', ref: c1.id });
    expect(lido.avisos.possivelMesmaPessoa).toEqual([l2.id]);
    expect(JSON.stringify(lido)).not.toContain('hmac-dupla');
    // Sem pauta.ver o aviso nem é calculado.
    expect((await svc.getOne(ORG_A, l1.id, ['leads.ver'])).avisos.possivelMesmaPessoa).toEqual([]);
    // O aviso não se guarda: com a linha expurgada ele some, e o lead continua.
    await prisma.comentarioComPalavra.delete({ where: { id: c2.id } });
    expect((await svc.getOne(ORG_A, l1.id, ['leads.ver', 'pauta.ver'])).avisos.possivelMesmaPessoa).toEqual([]);
  });

  it('origem pixel exige o visitante da própria empresa e guarda o anonymousId', async () => {
    const r = await entrar(LeadEntradaSchema.parse({ origem: { tipo: 'pixel', ref: 'rid-da-a' } }));
    const lead = await prisma.lead.findFirstOrThrow({ where: { id: r.id } });
    expect(lead).toMatchObject({ anonymousId: 'rid-da-a', name: 'Visitante do site' });
  });

  it('troca de dono: usuário de outra empresa é 404; a troca grava evento dono e AuditLog; repetir não muda nada', async () => {
    const lead = await entrar(manual('dono-troca'));
    const roda = (ownerId: string | null, motivo?: string, orgId = ORG_A, id = lead.id) =>
      comContexto({ orgId, correlationId: novaCorrelacao() }, () => svc.trocarDono(orgId, id, { ownerId, motivo }, userA));

    await expect(roda(userB)).rejects.toBeInstanceOf(NotFoundException);
    await expect(roda('root48-inativo')).rejects.toBeInstanceOf(NotFoundException);
    await expect(roda(userA2, undefined, ORG_B)).rejects.toBeInstanceOf(NotFoundException); // lead de outra empresa
    expect((await prisma.lead.findFirstOrThrow({ where: { id: lead.id } })).ownerId).toBeNull();
    expect(await auditorias(lead.id, 'lead.dono')).toBe(0);

    expect(await roda(userA2, 'assumiu o contato')).toEqual({ ok: true, mudou: true, ownerId: userA2 });
    expect((await prisma.lead.findFirstOrThrow({ where: { id: lead.id } })).ownerId).toBe(userA2);
    const [ev] = await eventos(lead.id, 'dono');
    expect(ev.payload).toEqual({ de: null, para: userA2, motivo: 'assumiu o contato', ator: userA });
    const [aud] = await prisma.auditLog.findMany({ where: { entityId: lead.id, action: 'lead.dono' } });
    expect(aud).toMatchObject({ orgId: ORG_A, actorId: userA, before: { ownerId: null }, after: { ownerId: userA2, motivo: 'assumiu o contato' } });

    expect(await roda(userA2)).toMatchObject({ mudou: false });
    expect(await eventos(lead.id, 'dono')).toHaveLength(1);
    expect(await roda(null)).toMatchObject({ mudou: true, ownerId: null });
    expect(await eventos(lead.id, 'dono')).toHaveLength(2);
  });

  it('getOne devolve dono e origem; lead de outra empresa é 404', async () => {
    const r = await entrar(manual('leitura-1', { ownerId: userA2 }));
    const lido = await svc.getOne(ORG_A, r.id, ['leads.ver']);
    expect(lido.owner).toEqual({ id: userA2, name: 'Usuário root48-ua2' });
    expect(lido.origem).toEqual({ tipo: 'manual', ref: 'leitura-1' });
    await expect(svc.getOne(ORG_B, r.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('PATCH de etapa e próxima ação continua exigindo x-approval-token (guarda real, banco real)', async () => {
    const lead = await entrar(manual('patch-1'));
    const p = prisma as unknown as PrismaService;
    const guarda = new ApprovalGuard(new Reflector(), new ApprovalsService(p, new AuditService(p)));
    const contexto = (handler: (...a: never[]) => unknown, headers: Record<string, string>) =>
      ({
        getHandler: () => handler,
        getClass: () => LeadsController,
        switchToHttp: () => ({ getRequest: () => ({ user: { orgId: ORG_A, sub: userA }, headers, params: { id: lead.id }, body: { status: 'qualificado' } }) }),
      }) as unknown as ExecutionContext;

    await expect(guarda.canActivate(contexto(LeadsController.prototype.update as never, {}))).rejects.toBeDefined();
    await expect(guarda.canActivate(contexto(LeadsController.prototype.update as never, { 'x-approval-token': 'token-que-nao-existe' }))).rejects.toBeDefined();
    // Entrada e dono passam pela guarda sem token: não são escrita sensível.
    await expect(guarda.canActivate(contexto(LeadsController.prototype.entrada as never, {}))).resolves.toBe(true);
    await expect(guarda.canActivate(contexto(LeadsController.prototype.trocarDono as never, {}))).resolves.toBe(true);
    expect((await prisma.lead.findFirstOrThrow({ where: { id: lead.id } })).status).toBe('novo');
  });
});
