import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ApprovalsService } from '../src/approvals/approvals.service';
import { AuditService } from '../src/audit/audit.service';
import { ReauthService } from '../src/auth/reauth.service';
import { comContexto } from '../src/common/contexto-execucao';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { LeituraEReacaoService } from '../src/comercial/leitura-e-reacao.service';
import { RelogioComercialRegistry } from '../src/comercial/relogio.registry';
import { CAPACIDADE_DA_SALA, SalaVersaoService } from '../src/comercial/sala-versao.service';
import { SalaService } from '../src/comercial/sala.service';
import { WhatsappComercialService } from '../src/comercial/whatsapp.service';
import { uuidDe } from '../src/comercial/eventos';
import { AcoesService } from '../src/gateway/acoes.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { EventLogService } from '../src/gateway/event-log.service';
import { InterruptoresRegistry } from '../src/gateway/interruptores.registry';
import { PortaDoOperador } from '../src/gateway/porta-do-operador.service';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { ConectoresService } from '../src/integrations/conectores.service';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * A SALA PUBLICADA POR VERSÃO (I3) E O RELATÓRIO DE LEITURA E REAÇÃO (I5),
 * contra o banco e a régua de verdade (rodada da implantação, 18/10/2026).
 *
 * I3:
 *  1. o rascunho nunca chega ao cliente: publicar fica RETIDO (R3) e a sala
 *     continua sem versão até outra pessoa liberar;
 *  2. quem pediu não libera (invariante 7); a segunda pessoa libera e a v1 vai
 *     ao ar com o fato `sala.publicada`;
 *  3. a v2 editada e pedida: o cliente segue na v1 até a liberação; editar a
 *     versão na porta a devolve a rascunho e a aprovação antiga não publica
 *     nada; a v2 liberada substitui a v1;
 *  4. o cartão de /atendimento confere o hash; outra empresa não vê nada.
 * I5:
 *  5. o relatório conta acessos, seção mais lida e ideias do que está gravado,
 *     e diz a situação acionável;
 *  6. a ideia vira UMA tarefa (dois cliques) com a procedência e o trecho;
 *  7. leu N vezes sem responder prepara o FUP 1 (M5) com o FUP ligado.
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (lead, sala, versões, aprovações, reações e tarefas)');
process.env.ENCRYPTION_KEY ??= 'chave-de-teste-da-sala-0123456789abcdef';

const MARCA = `sp${Date.now().toString(36).slice(-6)}`;
const SENHA_DA_SOCIA = 'senha-da-socia-da-sala';

describe.skipIf(!URL)('a sala publicada por versão e o relatório de leitura', { timeout: 30_000 }, () => {
  const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
  const p = prisma as unknown as PrismaService;
  let ORG = '';
  let OUTRA = '';
  let socia = { id: '' };
  const lucas = { id: '', papeis: ['gestor_marketing'] };
  const rodrigo = { id: '', papeis: ['gestor_marketing'] };
  let fio: FioService;
  let sala: SalaService;
  let versoes: SalaVersaoService;
  let leitura: LeituraEReacaoService;
  let whats: WhatsappComercialService;
  let approvals: ApprovalsService;
  let acoes: AcoesService;
  let leadId = '';
  let token = '';

  const naEmpresa = <T>(fn: () => Promise<T>, org = ORG): Promise<T> => comContexto({ orgId: org, correlationId: `sala-${MARCA}`, origem: 'http' }, fn);
  const liberar = async (approvalId: string, quem: { id: string; papeis: string[] }) => {
    const a = await prisma.approval.findUniqueOrThrow({ where: { id: approvalId } });
    const assina = a.alcadaMinima === 'titular' ? { id: socia.id, papeis: ['admin_master'], reauth: { senha: SENHA_DA_SOCIA } } : quem;
    await naEmpresa(() => approvals.confirm(ORG, approvalId, assina, a.exigeReauth ? 'conferi a versão da sala' : undefined));
    return naEmpresa(() => acoes.executarAprovada(ORG, approvalId, assina.id));
  };
  const passo = (oque: string) => ({ oque, quando: '2026-10-21', comQuem: 'Marina' });

  beforeAll(async () => {
    // 14:00 de São Paulo: dentro da janela da régua (fora dela, R3 sobe a R4).
    vi.setSystemTime(new Date('2026-10-18T14:00:00-03:00'));
    process.env.GATEWAY_MODO = 'impor';
    ORG = (await prisma.org.create({ data: { name: `Sala ${MARCA}`, slug: `sala-${MARCA}` } })).id;
    OUTRA = (await prisma.org.create({ data: { name: `Outra ${MARCA}`, slug: `outra-${MARCA}` } })).id;
    const admin = await prisma.role.create({ data: { orgId: ORG, key: 'admin_master', name: 'Admin Master' } });
    const gestor = await prisma.role.create({ data: { orgId: ORG, key: 'gestor_marketing', name: 'Gestor' } });
    socia = await prisma.user.create({ data: { orgId: ORG, name: 'Sócia', email: `socia.${MARCA}@root.local`, passwordHash: await bcrypt.hash(SENHA_DA_SOCIA, 4), roles: { connect: { id: admin.id } } }, select: { id: true } });
    lucas.id = (await prisma.user.create({ data: { orgId: ORG, name: 'Lucas', email: `lucas.${MARCA}@root.local`, passwordHash: 'x', roles: { connect: { id: gestor.id } } } })).id;
    rodrigo.id = (await prisma.user.create({ data: { orgId: ORG, name: 'Rodrigo', email: `rodrigo.${MARCA}@root.local`, passwordHash: 'x', roles: { connect: { id: gestor.id } } } })).id;

    const audit = new AuditService(p);
    const policy = new PolicyService(p);
    await policy.onModuleInit();
    approvals = new ApprovalsService(p, audit, new ReauthService(p, new JwtService({ secret: `segredo-${MARCA}` }), audit));
    const log = new EventLogService(p);
    const efeitos = new EfeitosRegistry();
    const interruptores = new InterruptoresRegistry();
    new ConectoresService(p, audit, log, interruptores).onModuleInit();
    const gateway = new ToolGateway(p, policy, new SinaisService(p, policy), approvals, log, undefined, interruptores, efeitos);
    acoes = new AcoesService(p, gateway, log, interruptores, policy);
    const porta = new PortaDoOperador(gateway, efeitos);
    const reacoes = new ReacoesRegistry();
    fio = new FioService(p, reacoes);
    sala = new SalaService(p, fio, reacoes);
    versoes = new SalaVersaoService(p, fio, efeitos, porta);
    versoes.inscrever();
    leitura = new LeituraEReacaoService(p);
    // O M5 vai à fila da régua; aqui só importa que o rascunho nasça (a porta de mentira segura tudo).
    const portaQueSegura = { executar: async () => ({ status: 'aguardando_aprovacao', approvalId: `ap-${MARCA}` }) } as unknown as PortaDoOperador;
    whats = new WhatsappComercialService(p, fio, reacoes, new RelogioComercialRegistry(), sala, new EfeitosRegistry(), portaQueSegura);

    leadId = (await prisma.lead.create({ data: { orgId: ORG, name: 'Marina Duarte', phone: '5532999990001' } })).id;
    await prisma.comercialFicha.create({ data: { leadId, orgId: ORG, empresa: 'Construtora Alicerce', donoId: lucas.id } });
    const s = await naEmpresa(() => sala.garantir(ORG, leadId));
    token = s.link!.split('/s/').pop()!;
  });

  afterAll(async () => {
    vi.useRealTimers();
    for (const org of [ORG, OUTRA].filter(Boolean)) {
      const leads = (await prisma.lead.findMany({ where: { orgId: org }, select: { id: true } })).map((l) => l.id);
      await prisma.workComment.deleteMany({ where: { orgId: org } });
      await prisma.workTask.deleteMany({ where: { orgId: org } });
      await prisma.workStatus.deleteMany({ where: { orgId: org } });
      await prisma.workList.deleteMany({ where: { orgId: org } });
      await prisma.workFolder.deleteMany({ where: { orgId: org } });
      await prisma.comercialMensagem.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.salaVersao.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.leadReacao.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.salaDoCliente.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.comercialReacao.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.comercialFicha.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.leadEvent.deleteMany({ where: { leadId: { in: leads } } });
      await prisma.lead.deleteMany({ where: { orgId: org } });
      await prisma.comercialConfig.deleteMany({ where: { orgId: org } });
      await prisma.approval.deleteMany({ where: { orgId: org } });
      await prisma.policyDecision.deleteMany({ where: { orgId: org } });
      await prisma.toolCall.deleteMany({ where: { orgId: org } });
      await prisma.eventLog.deleteMany({ where: { orgId: org } });
      await prisma.auditLog.deleteMany({ where: { orgId: org } });
      await prisma.user.deleteMany({ where: { orgId: org } });
      await prisma.role.deleteMany({ where: { orgId: org } });
      await prisma.org.deleteMany({ where: { id: org } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it('1 · sem passo não publica; o rascunho gravado nunca chega ao cliente; publicar fica retido (R3)', async () => {
    const antes = await naEmpresa(() => versoes.versoes(ORG, leadId));
    expect(antes.rascunho.estado).toBe('novo');
    expect(antes.rascunho.conteudo.estacoes[0]).toMatchObject({ chave: 'conversa', estado: 'atual' });
    expect(antes.rascunho.conteudo.quemCuida).toEqual({ nome: 'Lucas', papel: 'cuida da sua conta na Root' });
    await expect(naEmpresa(() => versoes.publicar(ORG, leadId, { id: rodrigo.id }))).rejects.toThrow(/ao menos um próximo passo/);

    await naEmpresa(() => versoes.salvarRascunho(ORG, leadId, { proximosPassos: [passo('marcar o kickoff')], combinado: ['Resposta em até 4 horas úteis'], quemCuida: { nome: 'Lucas', papel: 'sócio' } }, { id: rodrigo.id }));
    expect((await sala.estado(token)).publicada).toBeNull();

    const r = await naEmpresa(() => versoes.publicar(ORG, leadId, { id: rodrigo.id }));
    expect(r.estado).toBe('na_porta');
    expect(r.approvalId).toBeTruthy();
    const a = await prisma.approval.findUniqueOrThrow({ where: { id: r.approvalId! } });
    expect(a.capabilityId).toBe(CAPACIDADE_DA_SALA);
    expect(['R3', 'R4']).toContain(a.nivelExigido);
    expect((await sala.estado(token)).publicada).toBeNull();
  });

  it('2 · quem pediu não libera; a segunda pessoa libera e a v1 vai ao ar com o fato no fio', async () => {
    const v = await naEmpresa(() => versoes.versoes(ORG, leadId));
    const approvalId = v.rascunho.approvalId!;
    await expect(naEmpresa(() => approvals.confirm(ORG, approvalId, rodrigo))).rejects.toThrow();
    const conteudo = await naEmpresa(() => versoes.conteudoParaLiberar(ORG, leadId, 1, v.rascunho.hash));
    expect(conteudo.confere).toBe(true);
    expect(conteudo.anterior).toBeNull();
    await liberar(approvalId, lucas);
    const e = await sala.estado(token);
    expect(e.publicada).toMatchObject({ versao: 1 });
    expect(e.publicada!.conteudo.proximosPassos).toEqual([passo('marcar o kickoff')]);
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'sala.publicada' } })).toBe(1);
    const linha = await prisma.salaVersao.findFirstOrThrow({ where: { leadId, numero: 1 } });
    expect(linha.estado).toBe('publicada');
    expect([lucas.id, socia.id]).toContain(linha.publicadaPor);
  });

  it('3 · a v2 pedida não troca a v1; editar na porta derruba o pedido; a v2 liberada substitui a v1', async () => {
    await naEmpresa(() => versoes.salvarRascunho(ORG, leadId, { proximosPassos: [passo('marcar o kickoff'), passo('mandar os acessos')], combinado: ['Resposta em até 4 horas úteis'], quemCuida: { nome: 'Lucas', papel: 'sócio' } }, { id: rodrigo.id }));
    const pedido = await naEmpresa(() => versoes.publicar(ORG, leadId, { id: rodrigo.id }));
    expect(pedido.rascunho.versao).toBe(2);
    expect((await sala.estado(token)).publicada!.versao).toBe(1);

    // Mudou depois do pedido: volta a rascunho, e a aprovação antiga não publica nada.
    await naEmpresa(() => versoes.salvarRascunho(ORG, leadId, { proximosPassos: [passo('marcar o kickoff'), passo('mandar os acessos ao Omie')], combinado: ['Resposta em até 4 horas úteis'], quemCuida: { nome: 'Lucas', papel: 'sócio' } }, { id: rodrigo.id }));
    const card = await naEmpresa(() => versoes.conteudoParaLiberar(ORG, leadId, 2, (pedido.rascunho.hash)));
    expect(card.confere).toBe(false);
    await liberar(pedido.approvalId!, lucas).catch(() => undefined);
    expect((await sala.estado(token)).publicada!.versao).toBe(1);
    expect((await prisma.salaVersao.findFirstOrThrow({ where: { leadId, numero: 2 } })).estado).toBe('rascunho');

    const de_novo = await naEmpresa(() => versoes.publicar(ORG, leadId, { id: rodrigo.id }));
    await liberar(de_novo.approvalId!, lucas);
    const e = await sala.estado(token);
    expect(e.publicada!.versao).toBe(2);
    expect(e.publicada!.conteudo.proximosPassos.map((x) => x.oque)).toEqual(['marcar o kickoff', 'mandar os acessos ao Omie']);
    expect((await prisma.salaVersao.findFirstOrThrow({ where: { leadId, numero: 1 } })).estado).toBe('substituida');
    const tela = await naEmpresa(() => versoes.versoes(ORG, leadId));
    expect(tela.historico.map((h) => [h.versao, h.estado])).toEqual([[2, 'publicada'], [1, 'substituida']]);
    // Nada mudou desde a v2: publicar de novo é recusado com a frase, sem pedido novo.
    await expect(naEmpresa(() => versoes.publicar(ORG, leadId, { id: rodrigo.id }))).rejects.toThrow(/Nada mudou desde a versão 2/);
  });

  it('4 · outra empresa não lê as versões nem o conteúdo', async () => {
    await expect(naEmpresa(() => versoes.versoes(OUTRA, leadId), OUTRA)).rejects.toThrow(/Lead não encontrado/);
    await expect(naEmpresa(() => versoes.conteudoParaLiberar(OUTRA, leadId, 1, null), OUTRA)).rejects.toThrow(/não existe/);
  });

  it('5 · o relatório conta acessos, a seção mais lida e as ideias; leu 3× sem responder', async () => {
    const em = (min: number) => new Date(Date.now() - min * 60_000);
    await naEmpresa(() => fio.registrar(ORG, leadId, 'proposta.publicada', 'v1', { versao: 1, produto: 'operacao', valorCentavos: 1199700, parcelas: 3, validaAte: '2026-10-26T23:59:00.000Z' } as never, { em: em(600), semReacoes: true }));
    for (const visita of [1, 2, 3]) {
      await naEmpresa(() => fio.registrar(ORG, leadId, 'proposta.lida', `1:ouvimos:${visita}`, { versao: 1, bloco: 'ouvimos', visita } as never, { em: em(500 - visita * 10), semReacoes: true }));
    }
    await prisma.leadReacao.createMany({
      data: [
        { id: uuidDe([ORG, 'r', '1']), orgId: ORG, leadId, versao: 1, secao: 'investimento', tipo: 'leitura', segundos: 140, acesso: 1 },
        { id: uuidDe([ORG, 'r', '2']), orgId: ORG, leadId, versao: 1, secao: 'montar', tipo: 'leitura', segundos: 40, acesso: 2 },
      ],
    });
    const r = await naEmpresa(() => leitura.relatorio(ORG, 30));
    const linha = r.leitura.find((l) => l.leadId === leadId)!;
    expect(linha).toMatchObject({ acessos: 3, versao: 1, ideias: 0, nome: 'Construtora Alicerce' });
    expect(linha.secaoMaisLida).toEqual({ secao: 'investimento', rotulo: 'INVESTIMENTO', segundos: 140 });
    expect(linha.situacao).toEqual({ tipo: 'leu_sem_responder', acessos: 3, fupPreparado: false });
    expect(r.n).toEqual({ valor: 3, provisorio: true });
    expect(r.tiles.propostasVivas).toBeGreaterThanOrEqual(1);
  });

  it('6 · leu 3 vezes sem responder prepara o FUP 1 (M5) com o FUP ligado; desligado, não', async () => {
    expect(await naEmpresa(() => whats.followUps(ORG, new Date()))).toEqual({ m5: 0, m6: 0 });
    await prisma.comercialConfig.upsert({ where: { orgId: ORG }, update: { fupLeuDias: 30, fupSilencioDias: null }, create: { orgId: ORG, fupLeuDias: 30 } });
    const r = await naEmpresa(() => whats.followUps(ORG, new Date()));
    expect(r.m5).toBe(1);
    expect(await prisma.comercialMensagem.count({ where: { leadId, template: 'M5' } })).toBe(1);
    // De novo: o mesmo rascunho, nunca dois.
    await naEmpresa(() => whats.followUps(ORG, new Date()));
    expect(await prisma.comercialMensagem.count({ where: { leadId, template: 'M5' } })).toBe(1);
    const linha = (await naEmpresa(() => leitura.relatorio(ORG, 30))).leitura.find((l) => l.leadId === leadId)!;
    expect(linha.frase).toBe('leu 3× sem responder · FUP 1 preparado');
  });

  it('7 · a ideia vira UMA tarefa com a procedência e o trecho; conta de máquina é recusada', async () => {
    const ideia = await prisma.leadReacao.create({
      data: { id: uuidDe([ORG, 'r', 'ideia']), orgId: ORG, leadId, versao: 1, secao: 'funciona', tipo: 'ideia', texto: 'dá para integrar com o banco Inter?', acesso: 3 },
    });
    const rel = await naEmpresa(() => leitura.relatorio(ORG, 30));
    expect(rel.ideias.map((i) => i.texto)).toContain('dá para integrar com o banco Inter?');
    expect(rel.leitura.find((l) => l.leadId === leadId)!.situacao.tipo).toBe('leu_sem_responder');

    await expect(naEmpresa(() => leitura.virarTarefa(ORG, ideia.id, { id: lucas.id, papeis: ['ia_servico'] }))).rejects.toThrow(/Conta de máquina/);
    await expect(naEmpresa(() => leitura.virarTarefa(ORG, ideia.id, { id: lucas.id, papeis: ['gestor_marketing'] }))).rejects.toThrow(/não tem lista/);
    const pasta = await prisma.workFolder.create({ data: { orgId: ORG, name: 'Clientes' } });
    const lista = await prisma.workList.create({ data: { orgId: ORG, folderId: pasta.id, name: 'Esteira de clientes' } });
    await prisma.workStatus.create({ data: { orgId: ORG, listId: lista.id, name: 'Qualificação', type: 'open', order: 0 } });
    const [a, b] = await Promise.all([
      naEmpresa(() => leitura.virarTarefa(ORG, ideia.id, { id: lucas.id, papeis: ['gestor_marketing'] })),
      naEmpresa(() => leitura.virarTarefa(ORG, ideia.id, { id: lucas.id, papeis: ['gestor_marketing'] })),
    ]);
    expect(a.tarefaId).toBe(b.tarefaId);
    expect(await prisma.workTask.count({ where: { orgId: ORG, listId: lista.id } })).toBe(1);
    const t = await prisma.workTask.findUniqueOrThrow({ where: { id: a.tarefaId } });
    // Rodada do trabalho T4: nome imperativo, o cliente vai no campo (lead sem cliente ainda = o da casa).
    expect(t.title).toBe('Responder a ideia: dá para integrar com o banco Inter?');
    expect(t.clienteId).toBeTruthy();
    expect(t.description).toContain('Procedência: ideia deixada pelo cliente na proposta v1, seção COMO FUNCIONA');
    expect(t.description).toContain(`/comercial/lead/${leadId}`);
    expect(t.description).toContain('> dá para integrar com o banco Inter?');
    expect((await prisma.leadReacao.findUniqueOrThrow({ where: { id: ideia.id } })).tarefaId).toBe(a.tarefaId);
    expect(await prisma.auditLog.count({ where: { orgId: ORG, action: 'work.task.create', entityId: a.tarefaId } })).toBe(1);
  });
});
