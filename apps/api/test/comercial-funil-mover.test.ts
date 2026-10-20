/**
 * MOVER O CARTÃO DO FUNIL, SEM LIMITAÇÃO (rodada da interface U4, 20/10/2026), contra o banco.
 *
 * Decisão do dono do produto: a PESSOA com `leads.editar` move o lead para
 * qualquer etapa, direto, sem pedido nem assinatura de outra pessoa. Esta
 * suíte substitui a da rodada do painel (P5, 18/10), que media a trava antiga
 * (pedido → assinatura → token). O que se prova:
 *   · a rota de mover é só `leads.editar` + `SoGenteGuard` (sem `ApprovalGuard`,
 *     sem escrita sensível); o pedido e o estado do pedido estão aposentados;
 *   · o `PATCH /leads/:id` continua com a proteção dele (escrita sensível + aprovação);
 *   · mover para a frente, para trás, para E8 e E9, de saída para ativa, da
 *     geladeira para qualquer etapa e para a geladeira sem data: grava direto;
 *   · cada mover grava `etapa.mudou` e `etapa.movida_a_mao` (idempotente) e a
 *     linha `comercial.etapa.movida_a_mao` na auditoria, na mesma transação;
 *   · a mensagem da tela, com e sem as conclusões que ficaram para trás;
 *   · o balão encolhe e some quando os fatos chegam (como na P5);
 *   · mover para "negócio fechado" à mão é só a etapa: nenhuma cobrança,
 *     contrato, card, cliente (Partner), trilho ou fechamento nasce; nenhuma
 *     reação está inscrita para os fatos de etapa; o cartão ganha o aviso;
 *   · a saída pelo mover leva o motivo no mesmo gesto; sem motivo, vale
 *     "sem motivo informado" e o cartão ganha o aviso;
 *   · conta de máquina é recusada no token e no banco; sem `leads.editar` no
 *     banco, 403; o caminho sem pessoa (reação, agente) continua barrado pelos portões;
 *   · outra empresa não move.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { ForbiddenException, GoneException, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { destinoDoMover, mensagemDoMover, COMERCIAL_ESTAGIOS } from '@mktos/shared';

import { ApprovalGuard } from '../src/approvals/approval.guard';
import { SENSITIVE_WRITE_KEY } from '../src/approvals/sensitive-write.decorator';
import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import { ComercialController } from '../src/comercial/comercial.controller';
import { ConfigComercialService } from '../src/comercial/config.service';
import { eventoIdComercial } from '../src/comercial/eventos';
import { FichaService } from '../src/comercial/ficha.service';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { MoverService, SoGenteGuard } from '../src/comercial/mover.service';
import { pendenciasDoMover, pendenciasQueRestam } from '../src/comercial/portoes';
import { LeadsController } from '../src/leads/leads.controller';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (leads, fichas, eventos e auditoria do mover do funil)');

const MARCA = `mv${Date.now().toString(36).slice(-6)}`;
const SUFIXO = Date.now().toString().slice(-8);

type Pessoa = { id: string; name: string; roles: string[] };

describe('o balão e o destino são conta pura', () => {
  const base = { nome: 'Marina', telefone: '5532999990000' };
  it('pular E2 lista o que falta em E1 e E2, com a etapa entre parênteses', () => {
    const p = pendenciasDoMover({ etapa: 'novo_lead', ...base, canal: 'conteudo', perfil: 'P1', donoId: 'u1' }, 'novo_lead', 'reuniao_agendada');
    expect(p.atravessadas).toEqual(['novo_lead', 'qualificacao']);
    expect(p.pendencias).toEqual(['sistema ou ERP em uso (E2)', 'base de dados: sim ou não (E2)', 'produto-alvo proposto (E2)']);
  });
  it('rota de proposta direta não cobra o diagnóstico; saída e fechado não têm balão', () => {
    const e = { etapa: 'sessao' as const, ataHash: 'h', rota: 'proposta_direta' as const, socioDaConta: 'Sócia' };
    expect(pendenciasDoMover(e, 'sessao', 'proposta').atravessadas).toEqual(['sessao']);
    expect(pendenciasQueRestam({ etapa: 'perdido' }, ['novo_lead'])).toEqual([]);
    expect(pendenciasQueRestam({ etapa: 'fechado' }, ['novo_lead'])).toEqual([]);
    expect(pendenciasQueRestam({ etapa: 'qualificacao' }, ['qualificacao'])).toEqual([]);
  });
  it('para gente, todo destino vale, menos a etapa em que o lead já está; saída leva o motivo no mesmo gesto', () => {
    for (const de of COMERCIAL_ESTAGIOS) {
      for (const para of COMERCIAL_ESTAGIOS) {
        const d = destinoDoMover(de, para, 'qualificacao');
        if (de === para) expect(d).toMatchObject({ permitido: false, caminho: null, motivo: 'o lead já está nesta etapa' });
        else expect(d).toMatchObject({ permitido: true, motivo: null, caminho: ['desqualificado', 'geladeira', 'perdido', 'parceiro'].includes(para) ? 'saida' : 'mover' });
      }
    }
    expect(destinoDoMover('novo_lead', 'fechado').dica).toMatch(/só a etapa muda/);
    expect(destinoDoMover('geladeira', 'qualificacao', 'qualificacao').dica).toMatch(/antes da geladeira/);
    expect(destinoDoMover('novo_lead', 'reuniao_agendada', null, ['dono do lead (E1)']).pendencias).toEqual(['dono do lead (E1)']);
    expect(destinoDoMover('novo_lead', 'perdido', null, ['dono do lead (E1)']).pendencias).toEqual([]);
  });
  it('a mensagem diz só para onde foi e, com pendência, sem as conclusões de quê', () => {
    expect(mensagemDoMover('qualificacao', [], [])).toBe('Movido para E2 · Qualificação.');
    expect(mensagemDoMover('reuniao_agendada', ['novo_lead', 'qualificacao'], ['dono do lead (E1)', 'sistema ou ERP em uso (E2)'])).toBe(
      'Movido para E3 · Reunião agendada sem as conclusões de E1 · Novo lead e E2 · Qualificação: dono do lead (E1); sistema ou ERP em uso (E2).',
    );
  });
});

describe('nenhuma reação nasce da etapa (estático)', () => {
  /** Todos os `.ts` de `src/`. */
  function arquivos(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const c = join(dir, n);
      return statSync(c).isDirectory() ? arquivos(c) : c.endsWith('.ts') ? [c] : [];
    });
  }
  it('nenhuma inscrição de reação escuta etapa.mudou, etapa.movida_a_mao ou etapa.movida_com_pendencia', () => {
    const src = join(__dirname, '..', 'src');
    const inscritos: string[] = [];
    for (const f of arquivos(src)) {
      const texto = readFileSync(f, 'utf8');
      for (const m of texto.matchAll(/reacoes\??\.inscrever\(\s*'([a-z_.]+)'/g)) inscritos.push(m[1]);
      // As inscrições em laço (`for (const tipo of [...])`) também não podem citar etapa.
      for (const m of texto.matchAll(/for \(const (?:tipo|type) of \[([^\]]*)\]/g)) inscritos.push(...(m[1].match(/'[a-z_.]+'/g) ?? []).map((x) => x.slice(1, -1)));
    }
    expect(inscritos.length).toBeGreaterThan(10);
    expect(inscritos.filter((t) => t.startsWith('etapa.'))).toEqual([]);
  });
});

describe.skipIf(!URL)('mover o cartão do funil, contra o banco', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
  const p = prisma as unknown as PrismaService;
  let ORG = '';
  let ORG2 = '';
  let socia: Pessoa;
  let semEditar: Pessoa;
  let maquina: Pessoa;
  let deFora: Pessoa;
  let fio: FioService;
  let fichas: FichaService;
  let mover: MoverService;

  const ficha = (leadId: string) => prisma.comercialFicha.findFirst({ where: { leadId } });
  const etapa = async (leadId: string) => (await ficha(leadId))?.etapa;
  const status = async (leadId: string) => (await prisma.lead.findFirst({ where: { id: leadId } }))?.status;
  const fatos = (leadId: string, type: string) => prisma.leadEvent.findMany({ where: { leadId, type }, orderBy: { occurredAt: 'asc' } });
  const auditoria = (leadId: string) => prisma.auditLog.findMany({ where: { entityId: leadId, action: 'comercial.etapa.movida_a_mao' }, orderBy: { createdAt: 'asc' } });

  async function novoLead(orgId: string, nome: string, n: number, campos: Record<string, unknown> = {}): Promise<string> {
    const lead = await prisma.lead.create({ data: { orgId, name: nome, phone: `55329${SUFIXO}${n}`, status: 'novo' }, select: { id: true } });
    await prisma.comercialFicha.create({ data: { leadId: lead.id, etapa: 'novo_lead', ...campos } });
    return lead.id;
  }

  /** O handler da rota, com os guardas que o decorador declara, na ordem. */
  async function pelaRota(quem: Pessoa, orgId: string, leadId: string, corpo: unknown) {
    const req = { user: { sub: quem.id, orgId, name: quem.name, roles: quem.roles, permissions: ['leads.editar'] }, params: { id: leadId }, body: corpo, headers: {} };
    const ctx = {
      getHandler: () => ComercialController.prototype.mover,
      getClass: () => ComercialController,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    const guardas = Reflect.getMetadata('__guards__', ComercialController.prototype.mover) as unknown[];
    expect(guardas).toEqual([SoGenteGuard]);
    new SoGenteGuard().canActivate(ctx);
    return mover.mover(orgId, leadId, corpo, { id: quem.id, nome: quem.name, papeis: quem.roles });
  }
  const daSocia = (leadId: string, corpo: unknown) => pelaRota(socia, ORG, leadId, corpo);

  beforeAll(async () => {
    ORG = (await prisma.org.create({ data: { name: `Mover ${MARCA}`, slug: `mover-${MARCA}` } })).id;
    ORG2 = (await prisma.org.create({ data: { name: `Outra ${MARCA}`, slug: `outra-${MARCA}` } })).id;
    for (const key of ['leads.ver', 'leads.editar']) await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
    const comEditar = { connect: [{ key: 'leads.ver' }, { key: 'leads.editar' }] };
    const admin = await prisma.role.create({ data: { orgId: ORG, key: 'admin_master', name: 'Admin Master', permissions: comEditar } });
    const leitor = await prisma.role.create({ data: { orgId: ORG, key: 'leitor', name: 'Leitor', permissions: { connect: [{ key: 'leads.ver' }] } } });
    const ia = await prisma.role.create({ data: { orgId: ORG, key: 'ia_acao', name: 'IA / Ação', permissions: comEditar } });
    const admin2 = await prisma.role.create({ data: { orgId: ORG2, key: 'admin_master', name: 'Admin Master', permissions: comEditar } });
    const criar = async (orgId: string, nome: string, papel: { id: string; key: string }) => {
      const u = await prisma.user.create({ data: { orgId, name: nome, email: `${nome.toLowerCase().replace(/\W/g, '')}.${MARCA}@root.local`, passwordHash: 'x', roles: { connect: { id: papel.id } } }, select: { id: true, name: true } });
      return { ...u, roles: [papel.key] };
    };
    socia = await criar(ORG, 'Sócia da conta', admin);
    semEditar = await criar(ORG, 'Leitora da mesa', leitor);
    maquina = await criar(ORG, 'Conta de ação', ia);
    deFora = await criar(ORG2, 'Pessoa de fora', admin2);

    fio = new FioService(p, new ReacoesRegistry());
    fichas = new FichaService(p, fio, new ConfigComercialService(p));
    mover = new MoverService(p, fichas);
  });

  afterAll(async () => {
    for (const org of [ORG, ORG2].filter(Boolean)) {
      const leads = (await prisma.lead.findMany({ where: { orgId: org }, select: { id: true } })).map((l) => l.id);
      await prisma.comercialReacao.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.comercialFicha.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.leadEvent.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.lead.deleteMany({ where: { orgId: org } });
      await prisma.approval.deleteMany({ where: { orgId: org } });
      await prisma.auditLog.deleteMany({ where: { orgId: org } });
      await prisma.comercialConfig.deleteMany({ where: { orgId: org } });
      await prisma.user.deleteMany({ where: { orgId: org } });
      await prisma.role.deleteMany({ where: { orgId: org } });
      await prisma.org.deleteMany({ where: { id: org } });
    }
    await prisma.$disconnect();
  });

  it('a rota é leads.editar + SoGenteGuard, sem aprovação; o pedido e o estado do pedido estão aposentados', () => {
    const h = ComercialController.prototype;
    expect(Reflect.getMetadata(SENSITIVE_WRITE_KEY, h.mover)).toBeUndefined();
    expect(Reflect.getMetadata('__guards__', h.mover)).toEqual([SoGenteGuard]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, h.mover)).toEqual(['leads.editar']);
    expect(() => h.pedirMover()).toThrow(GoneException);
    expect(() => h.pedirMover()).toThrow(/move direto no funil/);
    expect((h.estadoDoPedido as () => { pedido: null }).call({}).pedido).toBeNull();
  });

  it('o PATCH /leads/:id mantém a proteção que tinha: leads.editar, escrita sensível do lead e a aprovação', () => {
    const u = LeadsController.prototype.update;
    expect(Reflect.getMetadata(SENSITIVE_WRITE_KEY, u)).toBe('lead');
    expect(Reflect.getMetadata('__guards__', u)).toEqual([ApprovalGuard]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, u)).toEqual(['leads.editar']);
  });

  it('mover sem pendência grava direto: etapa, Lead.status, etapa.mudou, etapa.movida_a_mao e a auditoria; sem balão', async () => {
    const lead = await novoLead(ORG, 'Lead Pronto', 1, { canal: 'conteudo', perfil: 'P1', donoId: 'x' });
    const r = await daSocia(lead, { para: 'qualificacao' });
    expect(r).toMatchObject({ ok: true, mudou: true, de: 'novo_lead', para: 'qualificacao', balao: null, pendencias: [], semConclusoesDe: [], aviso: null });
    expect(r.mensagem).toBe('Movido para E2 · Qualificação.');
    expect(await etapa(lead)).toBe('qualificacao');
    expect(await status(lead)).toBe('qualificado');
    expect(await fatos(lead, 'etapa.mudou')).toHaveLength(1);
    const [fato] = await fatos(lead, 'etapa.movida_a_mao');
    expect(fato.payload).toMatchObject({ de: 'novo_lead', para: 'qualificacao', pendencias: [], por: 'Sócia da conta', porId: socia.id });
    const [linha] = await auditoria(lead);
    expect(linha).toMatchObject({ orgId: ORG, actorId: socia.id, actorType: 'user', entityType: 'lead' });
    expect(linha.before).toEqual({ etapa: 'novo_lead' });
    expect(linha.after).toMatchObject({ etapa: 'qualificacao', pendencias: [], eventoId: fato.id });
    // Nada foi pedido: nenhuma aprovação nasce do mover.
    expect(await prisma.approval.count({ where: { orgId: ORG, resourceId: lead } })).toBe(0);
  });

  let comPendencia = '';

  it('mover com pendência grava, devolve a mensagem "sem as conclusões de…", o balão e o fato idempotente', async () => {
    comPendencia = await novoLead(ORG, 'Construtora Alicerce', 3);
    const antes = (await ficha(comPendencia))!.etapaDesde;
    const esperadas = [
      'canal de entrada (E1)',
      'perfil P1, P2 ou P3 pontuado (E1)',
      'dono do lead (E1)',
      'perfil confirmado (E2)',
      'sistema ou ERP em uso (E2)',
      'base de dados: sim ou não (E2)',
      'produto-alvo proposto (E2)',
    ];
    const r = await daSocia(comPendencia, { para: 'reuniao_agendada' });
    expect(r).toMatchObject({ ok: true, mudou: true, de: 'novo_lead', para: 'reuniao_agendada', pendencias: esperadas, semConclusoesDe: ['novo_lead', 'qualificacao'] });
    expect(r.mensagem).toBe(`Movido para E3 · Reunião agendada sem as conclusões de E1 · Novo lead e E2 · Qualificação: ${esperadas.join('; ')}.`);
    expect(r.balao).toMatchObject({ pendencias: esperadas, movidoPor: 'Sócia da conta' });
    expect(await etapa(comPendencia)).toBe('reuniao_agendada');
    expect(await status(comPendencia)).toBe('reuniao');

    const [fato] = await fatos(comPendencia, 'etapa.movida_a_mao');
    expect(fato.payload).toMatchObject({ de: 'novo_lead', para: 'reuniao_agendada', pendencias: esperadas, atravessadas: ['novo_lead', 'qualificacao'], por: 'Sócia da conta', porId: socia.id });
    // Idempotente: id derivado da mudança (etapa de origem e o instante em que entrou nela), o mesmo de `etapa.mudou`.
    const chave = `novo_lead>reuniao_agendada:mao:${antes.toISOString()}`;
    expect(fato.id).toBe(eventoIdComercial(ORG, comPendencia, 'etapa.movida_a_mao', chave));
    expect((await fatos(comPendencia, 'etapa.mudou'))[0].id).toBe(eventoIdComercial(ORG, comPendencia, 'etapa.mudou', chave));
    const regravado = await prisma.$transaction((tx) =>
      fio.gravarNaTransacao(tx, ORG, comPendencia, 'etapa.movida_a_mao', chave, { de: 'novo_lead', para: 'reuniao_agendada', pendencias: [], atravessadas: [], por: null, porId: null }, new Date()),
    );
    expect(regravado.novo).toBe(false);
    expect(await fatos(comPendencia, 'etapa.movida_a_mao')).toHaveLength(1);
    // A mesma mudança de novo: o lead já está lá, nada muda.
    const de_novo = await daSocia(comPendencia, { para: 'reuniao_agendada' });
    expect(de_novo).toMatchObject({ mudou: false });
    expect(de_novo.mensagem).toBe('O lead já está em E3 · Reunião agendada.');
    expect(await auditoria(comPendencia)).toHaveLength(1);

    // A tela lê o mesmo balão no funil e na ficha; o fio ganha a linha.
    const cartao = (await fichas.funil(ORG, 'todos')).colunas.flatMap((c) => c.cartoes).find((c) => c.leadId === comPendencia);
    expect(cartao?.balao?.pendencias).toEqual(esperadas);
    const f = await fichas.projecao(ORG, comPendencia);
    expect(f.balao?.pendencias).toEqual(esperadas);
    expect(f.fio.some((l) => l.type === 'etapa.movida_a_mao' && /sem as conclusões: canal de entrada/.test(l.resumo))).toBe(true);
  });

  it('o balão encolhe com cada fato que chega e some quando a pendência é sanada', async () => {
    const aplicar = async (type: 'lead.chegou' | 'lead.pontuado' | 'dono.atribuido' | 'form.respondido', chave: string, payload: Record<string, unknown>) => {
      const ev = await fio.registrar(ORG, comPendencia, type, chave, payload as never);
      await fichas.aplicar({ eventoId: ev.eventoId, orgId: ORG, leadId: comPendencia, type, payload: payload as never, em: new Date() });
    };
    await aplicar('lead.chegou', 'whatsapp', { telefone: 'x', texto: 'oi', canal: 'conteudo' });
    await aplicar('lead.pontuado', 'inicial', { pontuacao: 40, perfil: 'P1', criterios: {} });
    const meio = (await fichas.baloes(ORG, [comPendencia])).get(comPendencia);
    expect(meio?.pendencias).toEqual(['dono do lead (E1)', 'sistema ou ERP em uso (E2)', 'base de dados: sim ou não (E2)', 'produto-alvo proposto (E2)']);
    await aplicar('dono.atribuido', 'regra', { donoId: socia.id, donoNome: socia.name, regra: 'teste' });
    await aplicar('form.respondido', 'form-1', { sistema: 'Omie', baseOrganizada: true, maiorDor: 'fechamento', equipeFinanceiro: 2 });
    expect((await fichas.baloes(ORG, [comPendencia])).has(comPendencia)).toBe(false);
    const cartao = (await fichas.funil(ORG, 'todos')).colunas.flatMap((c) => c.cartoes).find((c) => c.leadId === comPendencia);
    expect(cartao?.balao).toBeNull();
  });

  it('para trás: de E6 para E2 grava direto, sem pendência e sem balão', async () => {
    const lead = await novoLead(ORG, 'Lead Que Volta', 4);
    await prisma.comercialFicha.updateMany({ where: { leadId: lead }, data: { etapa: 'proposta' } });
    const r = await daSocia(lead, { para: 'qualificacao' });
    expect(r).toMatchObject({ ok: true, mudou: true, de: 'proposta', para: 'qualificacao', pendencias: [], balao: null });
    expect(r.mensagem).toBe('Movido para E2 · Qualificação.');
    expect(await etapa(lead)).toBe('qualificacao');
    expect(await status(lead)).toBe('qualificado');
  });

  it('para "negócio fechado" à mão é só a etapa: nenhuma cobrança, contrato, card, cliente, trilho ou fechamento; o cartão ganha o aviso', async () => {
    const lead = await novoLead(ORG, 'Lead Fechado à Mão', 5);
    await prisma.comercialFicha.updateMany({ where: { leadId: lead }, data: { etapa: 'contrato' } });
    const partners = await prisma.partner.count({ where: { orgId: ORG } });
    const tarefas = await prisma.workTask.count({ where: { orgId: ORG } });
    const r = await daSocia(lead, { para: 'fechado' });
    expect(r).toMatchObject({ ok: true, mudou: true, de: 'contrato', para: 'fechado' });
    expect(r.aviso).toMatch(/Negócio fechado à mão: só a etapa mudou/);
    expect(r.mensagem).toMatch(/^Movido para E9 · Negócio fechado sem as conclusões de E8 · Contrato: /);
    expect(await etapa(lead)).toBe('fechado');
    expect(await status(lead)).toBe('ganho');
    // Nenhuma escrita automática do fechamento ou do contrato.
    expect(await prisma.comercialCobranca.count({ where: { leadId: lead } })).toBe(0);
    expect(await prisma.comercialDocumento.count({ where: { leadId: lead } })).toBe(0);
    expect(await prisma.comercialFechamento.count({ where: { leadId: lead } })).toBe(0);
    expect(await prisma.onboardingTrilho.count({ where: { orgId: ORG } })).toBe(0);
    expect(await prisma.partner.count({ where: { orgId: ORG } })).toBe(partners);
    expect(await prisma.workTask.count({ where: { orgId: ORG } })).toBe(tarefas);
    const depois = await ficha(lead);
    expect(depois).toMatchObject({ clienteAtivoEm: null, cardId: null, trilhoId: null });
    // Nenhum fato de fechamento: só os dois da etapa.
    const tipos = (await prisma.leadEvent.findMany({ where: { leadId: lead }, select: { type: true } })).map((e) => e.type).sort();
    expect(tipos).toEqual(['etapa.movida_a_mao', 'etapa.mudou']);
    expect(await prisma.comercialReacao.count({ where: { leadId: lead } })).toBe(0);
    expect(await auditoria(lead)).toHaveLength(1);
    // O cartão no funil mostra o aviso; o fechamento de verdade (cliente.ativo) o tiraria.
    const cartao = (await fichas.funil(ORG, null)).colunas.flatMap((c) => c.cartoes).find((c) => c.leadId === lead);
    expect(cartao?.avisoDoMover).toMatchObject({ texto: expect.stringMatching(/só a etapa mudou/), por: 'Sócia da conta' });
    await prisma.comercialFicha.updateMany({ where: { leadId: lead }, data: { clienteAtivoEm: new Date() } });
    const sem = (await fichas.funil(ORG, null)).colunas.flatMap((c) => c.cartoes).find((c) => c.leadId === lead);
    expect(sem?.avisoDoMover).toBeNull();
  });

  it('de "negócio fechado" para trás também grava direto', async () => {
    const lead = await novoLead(ORG, 'Lead Reaberto', 6);
    await prisma.comercialFicha.updateMany({ where: { leadId: lead }, data: { etapa: 'fechado' } });
    const r = await daSocia(lead, { para: 'proposta' });
    expect(r).toMatchObject({ ok: true, mudou: true, de: 'fechado', para: 'proposta' });
    expect(await etapa(lead)).toBe('proposta');
  });

  it('saída com motivo escrito: grava a etapa, os campos da saída e o fato saida.registrada no mesmo gesto', async () => {
    const lead = await novoLead(ORG, 'Lead Que Sai', 7);
    await prisma.comercialFicha.updateMany({ where: { leadId: lead }, data: { etapa: 'proposta' } });
    const r = await daSocia(lead, { para: 'perdido', motivo: 'fechou com outro fornecedor', tipoDeMotivo: 'preco' });
    expect(r).toMatchObject({ ok: true, mudou: true, de: 'proposta', para: 'perdido', aviso: null, pendencias: [] });
    expect(r.mensagem).toBe('Movido para Saída · Perdido.');
    expect(await ficha(lead)).toMatchObject({ etapa: 'perdido', etapaAntesDaSaida: 'proposta', motivoSaida: 'preco', motivoDetalhe: 'fechou com outro fornecedor' });
    expect(await status(lead)).toBe('perdido');
    const [saida] = await fatos(lead, 'saida.registrada');
    expect(saida.payload).toMatchObject({ saida: 'perdido', motivo: 'preco', detalhe: 'fechou com outro fornecedor', por: 'Sócia da conta' });
    expect((await fatos(lead, 'etapa.movida_a_mao'))[0].payload).toMatchObject({ motivo: 'fechou com outro fornecedor', semMotivo: false });
  });

  it('saída sem motivo escrito: vale "sem motivo informado" e o cartão ganha o aviso', async () => {
    const lead = await novoLead(ORG, 'Lead Sem Motivo', 8);
    const r = await daSocia(lead, { para: 'desqualificado' });
    expect(r.aviso).toBe('Saída sem motivo informado.');
    expect(await ficha(lead)).toMatchObject({ etapa: 'desqualificado', motivoSaida: 'outro', motivoDetalhe: 'sem motivo informado' });
    const cartao = (await fichas.funil(ORG, { etapa: 'saidas' })).colunas.flatMap((c) => c.cartoes).find((c) => c.leadId === lead);
    expect(cartao?.avisoDoMover?.texto).toBe('Saída sem motivo informado.');
    const [linha] = await auditoria(lead);
    expect(linha.after).toMatchObject({ etapa: 'desqualificado', semMotivo: true });
  });

  it('de uma saída de volta ao funil: grava direto e limpa os campos da saída', async () => {
    const lead = await novoLead(ORG, 'Lead Que Volta da Saída', 9);
    await daSocia(lead, { para: 'perdido', motivo: 'sumiu' });
    const r = await daSocia(lead, { para: 'diagnostico' });
    expect(r).toMatchObject({ ok: true, mudou: true, de: 'perdido', para: 'diagnostico', aviso: null });
    expect(await ficha(lead)).toMatchObject({ etapa: 'diagnostico', motivoSaida: null, motivoDetalhe: null, voltaEm: null, parceiro: null });
    const cartao = (await fichas.funil(ORG, null)).colunas.flatMap((c) => c.cartoes).find((c) => c.leadId === lead);
    expect(cartao).toMatchObject({ etapa: 'diagnostico', motivoSaida: null, avisoDoMover: null });
  });

  it('para a geladeira sem data e da geladeira para qualquer etapa (não só a de antes)', async () => {
    const lead = await novoLead(ORG, 'Lead da Geladeira', 10);
    await prisma.comercialFicha.updateMany({ where: { leadId: lead }, data: { etapa: 'qualificacao' } });
    const ida = await daSocia(lead, { para: 'geladeira', motivo: 'volta no ano que vem' });
    expect(ida).toMatchObject({ ok: true, mudou: true, para: 'geladeira' });
    expect(await ficha(lead)).toMatchObject({ etapa: 'geladeira', etapaAntesDaSaida: 'qualificacao', voltaEm: null });
    const volta = await daSocia(lead, { para: 'follow_up' });
    expect(volta).toMatchObject({ ok: true, mudou: true, de: 'geladeira', para: 'follow_up' });
    expect(await etapa(lead)).toBe('follow_up');
    // E de uma saída para outra: do perdido para a geladeira, com data.
    await daSocia(lead, { para: 'perdido' });
    const outra = await daSocia(lead, { para: 'geladeira', voltaEm: '2027-01-15T12:00:00-03:00' });
    expect(outra).toMatchObject({ ok: true, mudou: true, de: 'perdido', para: 'geladeira' });
    expect((await ficha(lead))?.voltaEm?.toISOString()).toBe('2027-01-15T15:00:00.000Z');
  });

  it('pessoa ≠ agente: conta de máquina é recusada no token e no banco; o caminho sem pessoa segue barrado pelos portões', async () => {
    const lead = await novoLead(ORG, 'Lead da Máquina', 11);
    await expect(pelaRota(maquina, ORG, lead, { para: 'qualificacao' })).rejects.toThrow(/conta de serviço/);
    // O token mentindo (sem papel de máquina): o banco diz máquina.
    await expect(mover.mover(ORG, lead, { para: 'qualificacao' }, { id: maquina.id, nome: maquina.name, papeis: ['admin_master'] })).rejects.toThrow(/conta de serviço/);
    expect(await etapa(lead)).toBe('novo_lead');

    // O caminho das reações e do agente (sem `pessoa`) não ganhou nada: avançar com portão aberto, pular,
    // voltar, ir a E9 e sair de E9 continuam recusados pelos portões.
    const r = await fichas.mudarEtapa(ORG, lead, 'qualificacao', { motivo: 'agente tentou' });
    expect(r).toMatchObject({ ok: false, mudou: false });
    expect(r.faltando).toEqual(['canal de entrada', 'perfil P1, P2 ou P3 pontuado', 'dono do lead']);
    expect((await fichas.mudarEtapa(ORG, lead, 'reuniao_agendada', { motivo: 'agente pulou' })).ok).toBe(false);
    expect((await fichas.mudarEtapa(ORG, lead, 'fechado', { motivo: 'agente fechou' })).ok).toBe(false);
    const ate = await fichas.avancarAte(ORG, lead, 'reuniao_agendada', 'agente tentou', null);
    expect(ate.ok).toBe(false);
    await prisma.comercialFicha.updateMany({ where: { leadId: lead }, data: { etapa: 'proposta' } });
    const volta = await fichas.mudarEtapa(ORG, lead, 'qualificacao', { motivo: 'agente voltou' });
    expect(volta).toMatchObject({ ok: false, faltando: [expect.stringMatching(/não é avanço/)] });
    await prisma.comercialFicha.updateMany({ where: { leadId: lead }, data: { etapa: 'fechado' } });
    expect((await fichas.mudarEtapa(ORG, lead, 'perdido', { motivo: 'agente tirou' })).ok).toBe(false);
    await prisma.comercialFicha.updateMany({ where: { leadId: lead }, data: { etapa: 'geladeira', etapaAntesDaSaida: 'qualificacao' } });
    expect((await fichas.mudarEtapa(ORG, lead, 'proposta', { motivo: 'agente tirou da geladeira' })).ok).toBe(false);
    expect(await fatos(lead, 'etapa.movida_a_mao')).toHaveLength(0);
    expect(await auditoria(lead)).toHaveLength(0);
  });

  it('sem leads.editar no banco não move (o token antigo não basta), mesmo sendo gente desta empresa', async () => {
    const lead = await novoLead(ORG, 'Lead da Leitora', 12);
    await expect(pelaRota(semEditar, ORG, lead, { para: 'qualificacao' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(await etapa(lead)).toBe('novo_lead');
  });

  it('outra empresa não move: a pessoa de fora não existe aqui e o lead não existe lá', async () => {
    const lead = await novoLead(ORG, 'Lead da Casa', 13);
    await expect(mover.mover(ORG, lead, { para: 'qualificacao' }, { id: deFora.id, nome: deFora.name, papeis: deFora.roles })).rejects.toThrow(/usuário ativo desta empresa/);
    await expect(pelaRota(deFora, ORG2, lead, { para: 'qualificacao' })).rejects.toBeInstanceOf(NotFoundException);
    expect(await etapa(lead)).toBe('novo_lead');
  });

  it('corpo inválido é 400: etapa desconhecida ou chave a mais', async () => {
    const lead = await novoLead(ORG, 'Lead do Corpo', 14);
    await expect(daSocia(lead, { para: 'ganho' })).rejects.toThrow(/Destino inválido/);
    await expect(daSocia(lead, { para: 'qualificacao', token: 'x' })).rejects.toThrow(/Destino inválido/);
  });

  it('os filtros do painel: responsável (eu, sem, id), etapa, busca e o link antigo ?filtro=', async () => {
    const meu = await novoLead(ORG, 'Padaria do Bairro', 15, { donoId: socia.id, empresa: 'Padaria Pão Quente', perfil: 'P2', produto: 'operacao' });
    const semDono = await novoLead(ORG, 'Mercado Sem Dono', 16, { perfil: 'P1' });
    const ids = async (f: Parameters<FichaService['funil']>[1]) =>
      (await fichas.funil(ORG, f, undefined, undefined, socia.id)).colunas.flatMap((c) => c.cartoes).map((c) => c.leadId);
    expect(await ids({ dono: 'eu' })).toContain(meu);
    expect(await ids({ dono: 'eu' })).not.toContain(semDono);
    expect(await ids({ dono: socia.id })).toContain(meu);
    expect(await ids({ dono: 'sem' })).toContain(semDono);
    expect(await ids({ dono: 'sem' })).not.toContain(meu);
    expect(await ids({ q: 'pão quente' })).toEqual([meu]);
    expect(await ids({ q: 'mercado sem' })).toEqual([semDono]);
    expect(await ids({ produto: 'operacao', perfil: 'P2' })).toEqual([meu]);
    expect(await ids('P2')).toEqual([meu]);
    expect(await ids({ etapa: 'etapa-que-nao-existe' })).toEqual([]);
    const f = await fichas.funil(ORG, { dono: 'eu' }, undefined, undefined, socia.id);
    expect(f.donos).toEqual(expect.arrayContaining([{ id: socia.id, nome: 'Sócia da conta' }]));
    expect(f.filtros).toMatchObject({ dono: 'eu' });
    const cartao = f.colunas.flatMap((c) => c.cartoes).find((c) => c.leadId === meu);
    expect(cartao).toMatchObject({ donoId: socia.id, dono: 'Sócia da conta' });
  });
});
