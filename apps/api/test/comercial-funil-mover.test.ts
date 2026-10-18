/**
 * MOVER O CARTÃO DO FUNIL (rodada do painel P5, 18/10/2026), contra o banco.
 *
 * Os serviços de verdade, montados à mão (nada de Nest sob vitest), e os
 * guardas da ROTA rodando sobre os metadados do próprio handler. O que se prova:
 *   · a rota de mover tem a MESMA proteção da mudança manual de etapa que já
 *     existia (`PATCH /leads/:id`): escrita sensível do recurso `lead`, token de
 *     uso único confirmado por OUTRA pessoa, preso ao destino;
 *   · mover sem pendência muda etapa, `Lead.status` e grava `etapa.mudou`, sem balão;
 *   · mover com pendência EXECUTA, grava `etapa.movida_com_pendencia` com a
 *     lista exata e quem moveu, e devolve o balão; o funil e a ficha mostram o mesmo;
 *   · o balão encolhe e some quando os fatos que faltavam chegam;
 *   · etapa de sistema (E8, E9) e voltar são recusados com o porquê;
 *   · conta de máquina é recusada no token e no banco, sem queimar a aprovação;
 *     o caminho sem pessoa (reação, agente) continua barrado pelo portão;
 *   · outra empresa não move; o fato é idempotente e o token não se reusa.
 */
import { ConflictException, ForbiddenException, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApprovalGuard } from '../src/approvals/approval.guard';
import { ApprovalsService } from '../src/approvals/approvals.service';
import { SENSITIVE_WRITE_KEY } from '../src/approvals/sensitive-write.decorator';
import { AuditService } from '../src/audit/audit.service';
import { ComercialController } from '../src/comercial/comercial.controller';
import { ConfigComercialService } from '../src/comercial/config.service';
import { eventoIdComercial } from '../src/comercial/eventos';
import { FichaService } from '../src/comercial/ficha.service';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { MoverService, SoGenteGuard, chaveDoMover } from '../src/comercial/mover.service';
import { pendenciasDoMover, pendenciasQueRestam } from '../src/comercial/portoes';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (leads, fichas, eventos e aprovações do mover do funil)');

const MARCA = `mv${Date.now().toString(36).slice(-6)}`;
const SUFIXO = Date.now().toString().slice(-8);

type Pessoa = { id: string; name: string; roles: string[] };

describe('o balão é conta pura dos portões', () => {
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
    // Só conta etapa que ficou ATRÁS da atual.
    expect(pendenciasQueRestam({ etapa: 'qualificacao' }, ['qualificacao'])).toEqual([]);
  });
});

describe.skipIf(!URL)('mover o cartão do funil, contra o banco', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
  const p = prisma as unknown as PrismaService;
  let ORG = '';
  let ORG2 = '';
  let socia: Pessoa;
  let gestor: Pessoa;
  let maquina: Pessoa;
  let deFora: Pessoa;
  let fio: FioService;
  let fichas: FichaService;
  let approvals: ApprovalsService;
  let mover: MoverService;
  const guardaDaAprovacao = () => new ApprovalGuard(new Reflector(), approvals);

  const etapa = async (leadId: string) => (await prisma.comercialFicha.findFirst({ where: { leadId } }))?.etapa;
  const status = async (leadId: string) => (await prisma.lead.findFirst({ where: { id: leadId } }))?.status;
  const fatos = (leadId: string, type: string) => prisma.leadEvent.findMany({ where: { leadId, type } });

  async function novoLead(orgId: string, nome: string, n: number, campos: Record<string, unknown> = {}): Promise<string> {
    const lead = await prisma.lead.create({ data: { orgId, name: nome, phone: `55329${SUFIXO}${n}`, status: 'novo' }, select: { id: true } });
    await prisma.comercialFicha.create({ data: { leadId: lead.id, etapa: 'novo_lead', ...campos } });
    return lead.id;
  }

  /** O handler da rota, com os guardas que o decorador declara, na ordem. */
  async function pelaRota(quem: Pessoa, orgId: string, leadId: string, corpo: unknown, token?: string) {
    const req = { user: { sub: quem.id, orgId, name: quem.name, roles: quem.roles, permissions: ['leads.editar'] }, params: { id: leadId }, body: corpo, headers: token ? { 'x-approval-token': token } : {} };
    const ctx = {
      getHandler: () => ComercialController.prototype.mover,
      getClass: () => ComercialController,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    const guardas = Reflect.getMetadata('__guards__', ComercialController.prototype.mover) as unknown[];
    expect(guardas).toEqual([SoGenteGuard, ApprovalGuard]);
    new SoGenteGuard().canActivate(ctx);
    await guardaDaAprovacao().canActivate(ctx);
    return mover.mover(orgId, leadId, corpo, { id: quem.id, nome: quem.name, papeis: quem.roles }, token ?? '');
  }

  /** Pedido pela sócia, assinatura do gestor: o caminho inteiro de gente. */
  async function pedirEAssinar(leadId: string, para: string) {
    const pedido = await mover.pedir(ORG, leadId, { para }, { id: socia.id, nome: socia.name, papeis: socia.roles });
    await approvals.confirm(ORG, pedido.approvalId, { id: gestor.id, papeis: gestor.roles });
    return pedido;
  }

  beforeAll(async () => {
    ORG = (await prisma.org.create({ data: { name: `Mover ${MARCA}`, slug: `mover-${MARCA}` } })).id;
    ORG2 = (await prisma.org.create({ data: { name: `Outra ${MARCA}`, slug: `outra-${MARCA}` } })).id;
    const admin = await prisma.role.create({ data: { orgId: ORG, key: 'admin_master', name: 'Admin Master' } });
    const ia = await prisma.role.create({ data: { orgId: ORG, key: 'ia_acao', name: 'IA / Ação' } });
    const admin2 = await prisma.role.create({ data: { orgId: ORG2, key: 'admin_master', name: 'Admin Master' } });
    const criar = async (orgId: string, nome: string, papel: { id: string; key: string }) => {
      const u = await prisma.user.create({ data: { orgId, name: nome, email: `${nome.toLowerCase().replace(/\W/g, '')}.${MARCA}@root.local`, passwordHash: 'x', roles: { connect: { id: papel.id } } }, select: { id: true, name: true } });
      return { ...u, roles: [papel.key] };
    };
    socia = await criar(ORG, 'Sócia da conta', admin);
    gestor = await criar(ORG, 'Gestor da mesa', admin);
    maquina = await criar(ORG, 'Conta de ação', ia);
    deFora = await criar(ORG2, 'Pessoa de fora', admin2);

    const reacoes = new ReacoesRegistry();
    fio = new FioService(p, reacoes);
    fichas = new FichaService(p, fio, new ConfigComercialService(p));
    approvals = new ApprovalsService(p, new AuditService(p));
    mover = new MoverService(p, fichas, approvals);
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

  it('a rota tem a proteção do PATCH /leads/:id: escrita sensível do recurso lead, guarda de gente antes da aprovação', () => {
    expect(Reflect.getMetadata(SENSITIVE_WRITE_KEY, ComercialController.prototype.mover)).toBe('lead');
    expect(Reflect.getMetadata(SENSITIVE_WRITE_KEY, ComercialController.prototype.pedirMover)).toBeUndefined();
    expect(Reflect.getMetadata('__guards__', ComercialController.prototype.mover)).toEqual([SoGenteGuard, ApprovalGuard]);
    expect(Reflect.getMetadata('__guards__', ComercialController.prototype.pedirMover)).toEqual([SoGenteGuard]);
  });

  it('mover sem pendência: pedido, outra pessoa assina, a etapa muda, Lead.status segue e não há balão', async () => {
    const lead = await novoLead(ORG, 'Lead Pronto', 1, { canal: 'conteudo', perfil: 'P1', donoId: socia.id });
    const pedido = await pedirEAssinar(lead, 'qualificacao');
    expect(pedido).toMatchObject({ de: 'novo_lead', para: 'qualificacao', pendencias: [] });
    expect(pedido.resumo).toMatch(/portões cumpridos/);

    const r = await pelaRota(socia, ORG, lead, { para: 'qualificacao' }, pedido.token);
    expect(r).toMatchObject({ ok: true, mudou: true, de: 'novo_lead', para: 'qualificacao', balao: null });
    expect(await etapa(lead)).toBe('qualificacao');
    expect(await status(lead)).toBe('qualificado');
    expect(await fatos(lead, 'etapa.mudou')).toHaveLength(1);
    expect(await fatos(lead, 'etapa.movida_com_pendencia')).toHaveLength(0);
    const ap = await prisma.approval.findFirst({ where: { id: pedido.approvalId } });
    expect(ap?.status).toBe('consumida');
  });

  it('sem assinatura não move; quem pediu não assina; token de outro destino é recusado', async () => {
    const lead = await novoLead(ORG, 'Lead Sem Assinatura', 2);
    await expect(pelaRota(socia, ORG, lead, { para: 'qualificacao' })).rejects.toThrow(/aprovação humana confirmada/);
    const pedido = await mover.pedir(ORG, lead, { para: 'qualificacao' }, { id: socia.id, nome: socia.name, papeis: socia.roles });
    await expect(pelaRota(socia, ORG, lead, { para: 'qualificacao' }, pedido.token)).rejects.toThrow(/não confirmada/);
    await expect(approvals.confirm(ORG, pedido.approvalId, { id: socia.id, papeis: socia.roles })).rejects.toThrow(ForbiddenException);
    await approvals.confirm(ORG, pedido.approvalId, { id: gestor.id, papeis: gestor.roles });
    await expect(pelaRota(socia, ORG, lead, { para: 'reuniao_agendada' }, pedido.token)).rejects.toThrow(/difere do que foi aprovado/);
    expect(await etapa(lead)).toBe('novo_lead');
    expect(await fatos(lead, 'etapa.mudou')).toHaveLength(0);
  });

  let comPendencia = '';
  let tokenUsado = '';

  it('mover com pendência EXECUTA, grava o fato com a lista e quem moveu, e devolve o balão', async () => {
    comPendencia = await novoLead(ORG, 'Construtora Alicerce', 3);
    const pedido = await pedirEAssinar(comPendencia, 'reuniao_agendada');
    const esperadas = [
      'canal de entrada (E1)',
      'perfil P1, P2 ou P3 pontuado (E1)',
      'dono do lead (E1)',
      'perfil confirmado (E2)',
      'sistema ou ERP em uso (E2)',
      'base de dados: sim ou não (E2)',
      'produto-alvo proposto (E2)',
    ];
    expect(pedido.pendencias).toEqual(esperadas);
    expect(pedido.resumo).toContain('com pendências: canal de entrada (E1)');

    tokenUsado = pedido.token;
    const r = await pelaRota(socia, ORG, comPendencia, { para: 'reuniao_agendada' }, pedido.token);
    expect(r).toMatchObject({ ok: true, mudou: true, de: 'novo_lead', para: 'reuniao_agendada' });
    expect(r.balao).toMatchObject({ pendencias: esperadas, movidoPor: 'Sócia da conta' });
    expect(await etapa(comPendencia)).toBe('reuniao_agendada');
    expect(await status(comPendencia)).toBe('reuniao');

    const [fato] = await fatos(comPendencia, 'etapa.movida_com_pendencia');
    expect(fato.payload).toMatchObject({ de: 'novo_lead', para: 'reuniao_agendada', pendencias: esperadas, atravessadas: ['novo_lead', 'qualificacao'], por: 'Sócia da conta', porId: socia.id });
    // O fato é idempotente: id derivado da chave da mudança (o resumo do token), o mesmo de `etapa.mudou`.
    const chave = `novo_lead>reuniao_agendada:${chaveDoMover(pedido.token)}`;
    expect(fato.id).toBe(eventoIdComercial(ORG, comPendencia, 'etapa.movida_com_pendencia', chave));
    expect((await fatos(comPendencia, 'etapa.mudou'))[0].id).toBe(eventoIdComercial(ORG, comPendencia, 'etapa.mudou', chave));

    // A tela lê o mesmo balão no funil e na ficha; o fio ganha a linha.
    const funil = await fichas.funil(ORG, 'todos');
    const cartao = funil.colunas.flatMap((c) => c.cartoes).find((c) => c.leadId === comPendencia);
    expect(cartao?.balao?.pendencias).toEqual(esperadas);
    const ficha = await fichas.projecao(ORG, comPendencia);
    expect(ficha.balao?.pendencias).toEqual(esperadas);
    expect(ficha.fio.some((l) => l.type === 'etapa.movida_com_pendencia' && /com pendências: canal de entrada/.test(l.resumo))).toBe(true);
  });

  it('o mesmo pedido não grava dois fatos: o token não se reusa e a regravação cai no mesmo id', async () => {
    await expect(pelaRota(socia, ORG, comPendencia, { para: 'reuniao_agendada' }, tokenUsado)).rejects.toThrow(/uso único/);
    const chave = `novo_lead>reuniao_agendada:${chaveDoMover(tokenUsado)}`;
    const de_novo = await prisma.$transaction((tx) =>
      fio.gravarNaTransacao(tx, ORG, comPendencia, 'etapa.movida_com_pendencia', chave, { de: 'novo_lead', para: 'reuniao_agendada', pendencias: [], atravessadas: [], por: null, porId: null }, new Date()),
    );
    expect(de_novo.novo).toBe(false);
    expect(await fatos(comPendencia, 'etapa.movida_com_pendencia')).toHaveLength(1);
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
    expect((await fichas.projecao(ORG, comPendencia)).balao).toBeNull();
  });

  it('etapa de sistema e voltar são recusados com o porquê, no pedido e no mudarEtapa da pessoa', async () => {
    const lead = await novoLead(ORG, 'Lead Sistema', 4);
    const pedir = (para: string) => mover.pedir(ORG, lead, { para }, { id: socia.id, nome: socia.name, papeis: socia.roles });
    await expect(pedir('contrato')).rejects.toMatchObject({ response: { faltando: [expect.stringMatching(/aceita a proposta na sala/)] } });
    await expect(pedir('fechado')).rejects.toMatchObject({ response: { faltando: [expect.stringMatching(/fecha sozinho quando a 1ª parcela é paga/)] } });
    await expect(pedir('perdido')).rejects.toThrow(/Saída vai por \/saida/);
    const pessoa = { id: socia.id, nome: socia.name };
    expect(await fichas.mudarEtapa(ORG, lead, 'fechado', { motivo: 't', pessoa })).toMatchObject({ ok: false, mudou: false, faltando: [expect.stringMatching(/fecha sozinho/)] });
    // Voltar: o lead em E3 não volta a E1 pelo mover.
    await prisma.comercialFicha.updateMany({ where: { leadId: lead }, data: { etapa: 'reuniao_agendada' } });
    await expect(pedir('novo_lead')).rejects.toBeInstanceOf(ConflictException);
    expect(await etapa(lead)).toBe('reuniao_agendada');
  });

  it('pessoa ≠ agente: conta de máquina é recusada sem queimar a aprovação; sem pessoa, o portão segue recusando', async () => {
    const lead = await novoLead(ORG, 'Lead da Máquina', 5);
    // No pedido: o token diz máquina; e, com o token mentindo, o banco diz máquina.
    await expect(mover.pedir(ORG, lead, { para: 'qualificacao' }, { id: maquina.id, nome: maquina.name, papeis: maquina.roles })).rejects.toThrow(/conta de serviço/);
    await expect(mover.pedir(ORG, lead, { para: 'qualificacao' }, { id: maquina.id, nome: maquina.name, papeis: ['admin_master'] })).rejects.toThrow(/conta de serviço/);

    // Na rota: a aprovação confirmada fica intacta quando a máquina tenta usá-la.
    const pedido = await pedirEAssinar(lead, 'qualificacao');
    await expect(pelaRota(maquina, ORG, lead, { para: 'qualificacao' }, pedido.token)).rejects.toThrow(/conta de serviço/);
    expect((await prisma.approval.findFirst({ where: { id: pedido.approvalId } }))?.status).toBe('confirmada');
    expect(await etapa(lead)).toBe('novo_lead');

    // O caminho das reações e do agente (sem `pessoa`) continua barrado pelo portão.
    const r = await fichas.mudarEtapa(ORG, lead, 'qualificacao', { motivo: 'agente tentou' });
    expect(r).toMatchObject({ ok: false, mudou: false });
    expect(r.faltando).toEqual(['canal de entrada', 'perfil P1, P2 ou P3 pontuado', 'dono do lead']);
    const ate = await fichas.avancarAte(ORG, lead, 'reuniao_agendada', 'agente tentou', null);
    expect(ate.ok).toBe(false);
    expect(await etapa(lead)).toBe('novo_lead');
    expect(await fatos(lead, 'etapa.movida_com_pendencia')).toHaveLength(0);
  });

  it('outra empresa não move: o lead não existe para ela e o token desta empresa não vale lá', async () => {
    const lead = await novoLead(ORG, 'Lead da Casa', 6);
    await expect(mover.pedir(ORG2, lead, { para: 'qualificacao' }, { id: deFora.id, nome: deFora.name, papeis: deFora.roles })).rejects.toBeInstanceOf(NotFoundException);
    const pedido = await pedirEAssinar(lead, 'qualificacao');
    await expect(pelaRota(deFora, ORG2, lead, { para: 'qualificacao' }, pedido.token)).rejects.toThrow(/Token de aprovação inválido/);
    // A pessoa de fora, relida no banco desta empresa, não existe aqui.
    await expect(mover.mover(ORG, lead, { para: 'qualificacao' }, { id: deFora.id, nome: deFora.name, papeis: deFora.roles }, 'x')).rejects.toThrow(/usuário ativo desta empresa/);
    expect(await etapa(lead)).toBe('novo_lead');
  });
});
