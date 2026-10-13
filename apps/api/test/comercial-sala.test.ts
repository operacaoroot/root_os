import { NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { leadIdDoTelefone } from '../src/comercial/eventos';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { RelogioComercialRegistry } from '../src/comercial/relogio.registry';
import { SALA_NAO_ENCONTRADA, SalaService } from '../src/comercial/sala.service';
import { SimuladoProvider } from '../src/comercial/canais/simulado.provider';
import { hashDoTokenDaSala, MARCADOR_DO_LINK_DA_SALA } from '../src/comercial/sala-token';
import { CAPACIDADE_DO_WHATSAPP, WhatsappComercialService } from '../src/comercial/whatsapp.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import type { PortaDoOperador } from '../src/gateway/porta-do-operador.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * A SALA E O CANAL COM BANCO (Lane B, 13/10/2026).
 *
 * A jornada do primeiro contato até o aceite, pelos mesmos métodos que o
 * simulador, a sala e o relógio chamam: o lead entra pelo WhatsApp, a sala
 * nasce com o token só em hash, a M1 sai com o formulário e vai à PORTA, o
 * formulário respondido prepara a M2 com dois horários, o horário escolhido
 * marca a conversa, a véspera prepara a M3, a proposta publicada prepara a M4,
 * e o aceite congela a versão e o hash.
 *
 * A PORTA AQUI É UM DUBLÊ QUE RETÉM, de propósito: o que esta suíte mede é que
 * o canal SÓ fala com a porta (capacidade, ator do sistema, conteúdo exato) e
 * que nada sai antes do efeito. A régua de verdade (R3 retido, segunda pessoa)
 * é medida contra a política do banco em `comercial-canal-porta.test.ts`.
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (leads, eventos, salas e mensagens do comercial)');
process.env.ENCRYPTION_KEY ??= 'chave-de-teste-da-sala-0123456789abcdef';
process.env.PUBLIC_BASE_URL = 'http://sala.teste';

const MARCA = `sb${Date.now().toString(36).slice(-6)}`;
const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
const p = prisma as unknown as PrismaService;

let ORG = '';
let reacoes: ReacoesRegistry;
let fio: FioService;
let relogio: RelogioComercialRegistry;
let sala: SalaService;
let whats: WhatsappComercialService;
let efeitos: EfeitosRegistry;
const pedidos: { capabilityId: string; actorType?: string; actorId: string; args: Record<string, unknown> }[] = [];

const portaQueRetem = {
  executar: vi.fn(async (e: { capabilityId: string; actorType?: string; actorId: string; args: Record<string, unknown> }) => {
    pedidos.push(e);
    return { status: 'aguardando_aprovacao', approvalId: `ap-${pedidos.length}`, resumo: '', expiraEm: '', nivel: 'R3', mensagem: '', precisaDeOutraPessoa: true, fila: '/atendimento' };
  }),
};

const TEL = `+55329${Date.now().toString().slice(-8)}`;
const TEL2 = `+55319${Date.now().toString().slice(-8)}`;

function tokenDoTexto(texto: string): string {
  const m = /\/s\/([A-Za-z0-9_-]{40,48})/.exec(texto);
  if (!m) throw new Error(`sem link da sala em: ${texto}`);
  return m[1];
}

/** O que o provedor recebeu de fato (o único lugar onde o link aparece decifrado). */
class ProvedorQueGuarda extends SimuladoProvider {
  readonly entregues: string[] = [];
  override async enviarTexto(d: string, t: string) {
    this.entregues.push(t);
    return super.enviarTexto(d, t);
  }
  override async enviarFormulario(d: string, t: string, f: never) {
    this.entregues.push(t);
    return super.enviarFormulario(d, t, f);
  }
}
const provedor = new ProvedorQueGuarda();

/** O token da sala, pelo link que o OS reescreve da cifra (o texto guardado só tem o marcador, B-1). */
async function tokenDaSalaDo(leadId: string): Promise<string> {
  return tokenDoTexto((await sala.linkDoLead(ORG, leadId)) ?? '');
}

async function eventos(leadId: string, type?: string) {
  return prisma.leadEvent.findMany({ where: { leadId, ...(type ? { type } : {}) }, orderBy: { occurredAt: 'asc' } });
}

beforeAll(async () => {
  const org = await prisma.org.create({ data: { name: `Sala ${MARCA}`, slug: `sala-${MARCA}` } });
  ORG = org.id;
  reacoes = new ReacoesRegistry();
  fio = new FioService(p, reacoes);
  relogio = new RelogioComercialRegistry();
  sala = new SalaService(p, fio, reacoes);
  sala.onModuleInit();
  efeitos = new EfeitosRegistry();
  whats = new WhatsappComercialService(p, fio, reacoes, relogio, sala, efeitos, portaQueRetem as unknown as PortaDoOperador, provedor);
  whats.onModuleInit();
});

afterAll(async () => {
  if (ORG) {
    const leads = await prisma.lead.findMany({ where: { orgId: ORG }, select: { id: true } });
    const ids = leads.map((l) => l.id);
    await prisma.comercialMensagem.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.comercialReacao.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.salaDoCliente.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.comercialConfig.deleteMany({ where: { orgId: ORG } });
    await prisma.leadEvent.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.lead.deleteMany({ where: { orgId: ORG } });
    await prisma.org.delete({ where: { id: ORG } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

describe('o lead entra pelo simulador e a casa responde pela porta', () => {
  let leadId = '';
  let token = '';

  it('a primeira mensagem cria o lead, grava lead.chegou e whats.recebida, abre a sala e prepara a M1 com o formulário', async () => {
    const r = await whats.receberEntrada(ORG, { telefone: TEL, texto: 'Oi! Funciona com Omie?', nome: 'Marina Duarte', palavraChave: 'FECHAMENTO', mensagemId: `${MARCA}-1` });
    leadId = r.leadId;
    expect(leadId).toBe(leadIdDoTelefone(ORG, TEL));
    expect(r.leadNovo).toBe(true);
    const tipos = (await eventos(leadId)).map((e) => e.type);
    expect(tipos).toEqual(expect.arrayContaining(['lead.chegou', 'whats.recebida', 'sala.aberta']));

    const m1 = await prisma.comercialMensagem.findFirstOrThrow({ where: { leadId, template: 'M1' } });
    expect(m1.direcao).toBe('saida');
    expect(m1.estado).toBe('na_fila');
    expect(m1.approvalId).toBe('ap-1');
    expect((m1.interativo as { formulario?: { campos: unknown[] } }).formulario?.campos).toHaveLength(4);
    expect(m1.texto.startsWith('Oi, Marina.')).toBe(true);

    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({ capabilityId: CAPACIDADE_DO_WHATSAPP, actorType: 'system', actorId: 'comercial' });
    expect(pedidos[0].args).toMatchObject({ mensagemId: m1.id, destino: 'lead', texto: m1.texto, template: 'M1' });
    // B-1: o texto guardado e o assinado levam o marcador, nunca o token.
    expect(m1.texto).toContain(MARCADOR_DO_LINK_DA_SALA);
    expect(m1.texto).not.toMatch(/\/s\/[A-Za-z0-9_-]{20,}/);
    token = await tokenDaSalaDo(leadId);
  });

  it('o banco não guarda o token em claro', async () => {
    const s = await prisma.salaDoCliente.findUniqueOrThrow({ where: { leadId } });
    expect(s.tokenHash).toBe(hashDoTokenDaSala(token));
    expect(JSON.stringify(s)).not.toContain(token);
    const evs = await eventos(leadId);
    expect(JSON.stringify(evs)).not.toContain(token);
  });

  it('a mesma mensagem reentregue não duplica nada; a seguinte vira só whats.recebida', async () => {
    const antes = (await eventos(leadId)).length;
    await whats.receberEntrada(ORG, { telefone: TEL, texto: 'Oi! Funciona com Omie?', mensagemId: `${MARCA}-1` });
    expect((await eventos(leadId)).length).toBe(antes);
    expect(pedidos).toHaveLength(1);

    const r = await whats.receberEntrada(ORG, { telefone: TEL, texto: 'Consigo falar amanhã?', mensagemId: `${MARCA}-2` });
    expect(r.leadNovo).toBe(false);
    expect((await eventos(leadId, 'lead.chegou')).length).toBe(1);
    expect((await eventos(leadId, 'whats.recebida')).length).toBe(2);
    expect(pedidos).toHaveLength(1);
  });

  it('a sala abre em "conversa" e conta uma visita por dia por estágio', async () => {
    const e1 = await sala.visita(token);
    const e2 = await sala.visita(token);
    expect(e1.estagio).toBe('conversa');
    expect(e2.contato).toBe('Marina Duarte');
    expect((await prisma.salaDoCliente.findUniqueOrThrow({ where: { leadId } })).acessos).toBe(2);
    expect((await eventos(leadId, 'sala.visitada')).length).toBe(1);
  });

  it('o formulário respondido na sala prepara a M2 com dois horários em botões', async () => {
    const e = await sala.form(token, { sistema: 'Omie', baseOrganizada: true, maiorDor: 'fechamento leva 9 dias', equipeFinanceiro: 3 });
    expect(e.conversa.oQueContou).toContain('Omie');
    expect(e.conversa.horariosOferecidos.length).toBeGreaterThanOrEqual(2);
    const m2 = await prisma.comercialMensagem.findFirstOrThrow({ where: { leadId, template: 'M2' } });
    const botoes = (m2.interativo as { botoes: { chave: string; rotulo: string }[] }).botoes;
    expect(botoes).toHaveLength(2);
    expect(m2.texto).toContain(botoes[0].rotulo);
    expect(m2.estado).toBe('na_fila');
    // o mesmo formulário de novo: o mesmo fato, nenhuma M2 a mais
    await sala.form(token, { sistema: 'Omie', baseOrganizada: true, maiorDor: 'fechamento leva 9 dias', equipeFinanceiro: 3 });
    expect((await eventos(leadId, 'form.respondido')).length).toBe(1);
    expect(await prisma.comercialMensagem.count({ where: { leadId, template: 'M2' } })).toBe(1);
  });

  it('o horário tem de estar entre os oferecidos; o escolhido marca a conversa uma vez', async () => {
    await expect(sala.agenda(token, { horario: '2031-01-01T10:00:00-03:00' })).rejects.toThrow(/oferecidos/);
    const m2 = await prisma.comercialMensagem.findFirstOrThrow({ where: { leadId, template: 'M2' } });
    const [b1, b2] = (m2.interativo as { botoes: { chave: string }[] }).botoes;
    // pelo celular do simulador: o toque no botão
    await sala.escolherHorario(ORG, leadId, b1.chave);
    const e = await sala.agenda(token, { horario: b1.chave });
    expect(e.conversa.horario).toBe(b1.chave);
    expect((await eventos(leadId, 'agenda.escolhida')).length).toBe(1);
    await expect(sala.agenda(token, { horario: b2.chave })).rejects.toThrow(/já está marcada/);
  });

  it('a véspera prepara a M3 uma vez, pelo relógio', async () => {
    const [ag] = await eventos(leadId, 'agenda.escolhida');
    const horario = new Date(String((ag.payload as { horario: string }).horario));
    const tarefa = relogio.inscritas().find(([n]) => n === 'whats.vespera')![1];
    await tarefa(ORG, new Date(horario.getTime() - 2 * 86_400_000));
    expect(await prisma.comercialMensagem.count({ where: { leadId, template: 'M3' } })).toBe(0);
    await tarefa(ORG, new Date(horario.getTime() - 12 * 3_600_000));
    await tarefa(ORG, new Date(horario.getTime() - 11 * 3_600_000));
    const m3 = await prisma.comercialMensagem.findMany({ where: { leadId, template: 'M3' } });
    expect(m3).toHaveLength(1);
    expect(m3[0].texto).toContain(MARCADOR_DO_LINK_DA_SALA);
    expect(m3[0].texto).not.toContain(token);
  });

  it('a M3 ENVIADA grava a confirmação de véspera (o portão de E3 pede este fato); a retida não grava', async () => {
    expect(await eventos(leadId, 'agenda.confirmada')).toHaveLength(0);
    const m3 = await prisma.comercialMensagem.findFirstOrThrow({ where: { leadId, template: 'M3' } });
    const pedido = pedidos.find((x) => x.args.mensagemId === m3.id);
    expect(pedido, 'a M3 não foi à porta').toBeTruthy();
    await efeitos.executar(CAPACIDADE_DO_WHATSAPP, pedido!.args, { orgId: ORG, actorId: 'quem-liberou', approvalId: 'ap-m3' });
    const [ag] = await eventos(leadId, 'agenda.escolhida');
    const conf = await eventos(leadId, 'agenda.confirmada');
    expect(conf).toHaveLength(1);
    expect(conf[0].payload).toMatchObject({ horario: (ag.payload as { horario: string }).horario, via: 'simulado' });
    // Reexecutar o efeito não duplica o fato.
    await efeitos.executar(CAPACIDADE_DO_WHATSAPP, pedido!.args, { orgId: ORG, actorId: 'quem-liberou', approvalId: 'ap-m3' });
    expect(await eventos(leadId, 'agenda.confirmada')).toHaveLength(1);
  });

  it('a proposta publicada prepara a M4; a sala vai a "proposta" e rastreia a leitura por bloco', async () => {
    await fio.registrar(ORG, leadId, 'proposta.publicada', 'v1', {
      versao: 1,
      produto: 'operacao',
      valorCentavos: 1_199_700,
      parcelas: 3,
      parcelaCentavos: 399_900,
      formas: ['pix', 'boleto', 'cartao'],
      validaAte: '2026-10-24T23:59:00-03:00',
      dentroDaTabela: true,
      laudo: { ok: true, apontamentos: [] },
      hash: 'hash-da-v1',
    });
    const m4 = await prisma.comercialMensagem.findFirstOrThrow({ where: { leadId, template: 'M4' } });
    expect(m4.texto).toContain('24/10');
    const e = await sala.propostaLida(token, { bloco: 'recomendada', versao: 1 });
    expect(e.estagio).toBe('proposta');
    expect(e.proposta?.blocosLidos).toEqual(['recomendada']);
    await sala.propostaLida(token, { bloco: 'recomendada', versao: 1 });
    expect((await eventos(leadId, 'proposta.lida')).length).toBe(1);
    await expect(sala.propostaLida(token, { bloco: 'custos', versao: 2 })).rejects.toThrow(/versão vigente é a 1/);
  });

  it('dúvida e ajuste viram fatos; a dúvida aparece sem resposta até a lane E responder', async () => {
    const e = await sala.duvida(token, { pergunta: 'O painel funciona no celular?' });
    expect(e.proposta?.duvidas?.[0]).toMatchObject({ pergunta: 'O painel funciona no celular?', resposta: null });
    expect(await sala.duvidasSemResposta(ORG, leadId)).toEqual([expect.objectContaining({ versao: 1, pergunta: 'O painel funciona no celular?' })]);
    await sala.responderDuvida(ORG, leadId, { versao: 1, pergunta: 'O painel funciona no celular?' }, 'Funciona: o painel abre no navegador do celular.');
    expect((await sala.estado(token)).proposta?.duvidas?.[0].resposta).toBe('Funciona: o painel abre no navegador do celular.');
    expect(await sala.duvidasSemResposta(ORG, leadId)).toEqual([]);
    const a = await sala.ajuste(token, { pedido: 'Dá para 5% de desconto?', descontoPct: 5 });
    expect(a.proposta?.ajustePendente).toBe(true);
    expect((await eventos(leadId, 'proposta.ajuste_pedido')).length).toBe(1);
  });

  it('o aceite pede os dados antes, recusa versão velha e congela versão e hash', async () => {
    await expect(sala.aceitePagamento(token, { produto: 'operacao', forma: 'pix', versao: 1 })).rejects.toThrow(/confira os seus dados/);
    await sala.aceiteDados(token, { cnpj: '12345678000199', razaoSocial: 'Construtora Alicerce Ltda', endereco: 'Rua A, 1, Juiz de Fora', quemAssina: 'Marina Duarte', email: 'marina@alicerce.test' });
    await expect(sala.aceitePagamento(token, { produto: 'operacao', forma: 'pix', versao: 2 })).rejects.toMatchObject({ status: 409 });
    await expect(sala.aceitePagamento(token, { produto: 'kit', forma: 'pix', versao: 1 })).rejects.toThrow(/não está nesta proposta/);
    const e = await sala.aceitePagamento(token, { produto: 'operacao', forma: 'pix', versao: 1 });
    expect(e.estagio).toBe('contrato');
    const [aceita] = await eventos(leadId, 'proposta.aceita');
    expect(aceita.payload).toMatchObject({ versao: 1, produto: 'operacao', valorCentavos: 1_199_700, parcelas: 3, forma: 'pix', hash: 'hash-da-v1' });
    await sala.aceitePagamento(token, { produto: 'operacao', forma: 'pix', versao: 1 });
    await expect(sala.aceitePagamento(token, { produto: 'operacao', forma: 'boleto', versao: 1 })).rejects.toMatchObject({ status: 409 });
    expect((await eventos(leadId, 'proposta.aceita')).length).toBe(1);
  });

  it('depois do aceite o ajuste é 409 e não entra no fio; a dúvida continua (B-6)', async () => {
    const antes = (await eventos(leadId, 'proposta.ajuste_pedido')).length;
    await expect(sala.ajuste(token, { pedido: 'Agora quero 10% de desconto', descontoPct: 10 })).rejects.toMatchObject({ status: 409 });
    await expect(sala.ajuste(token, { pedido: 'Agora quero 10% de desconto', descontoPct: 10 })).rejects.toThrow(/já foi aceita/);
    expect((await eventos(leadId, 'proposta.ajuste_pedido')).length).toBe(antes);
    const d = await sala.duvida(token, { pergunta: 'Quando começa a implantação?' });
    expect(d.proposta?.duvidas?.some((x) => x.pergunta === 'Quando começa a implantação?')).toBe(true);
  });

  it('o efeito, e só ele, entrega no simulado; o mesmo pedido não sai duas vezes; texto trocado não sai', async () => {
    const m1 = await prisma.comercialMensagem.findFirstOrThrow({ where: { leadId, template: 'M1' } });
    const args = pedidos[0].args;
    const ctx = { orgId: ORG, actorId: 'pessoa-que-confirmou', approvalId: 'ap-1' };
    await expect(efeitos.executar(CAPACIDADE_DO_WHATSAPP, { ...args, texto: 'outro texto' }, ctx)).rejects.toThrow(/texto mudou/);
    const r = (await efeitos.executar(CAPACIDADE_DO_WHATSAPP, args, ctx)) as { mensagemExternaId: string };
    expect(r.mensagemExternaId).toMatch(/^sim-/);
    const depois = await prisma.comercialMensagem.findUniqueOrThrow({ where: { id: m1.id } });
    expect(depois.estado).toBe('enviada');
    // A M3 já saiu no caso da véspera: aqui conta só a M1.
    const daM1 = async () => (await eventos(leadId, 'whats.enviada')).filter((e) => (e.payload as { template?: string }).template === 'M1');
    const [enviada] = await daM1();
    expect(enviada.payload).toMatchObject({ template: 'M1', aprovadaPor: 'pessoa-que-confirmou' });
    // B-1: o provedor recebe o link reescrito; o fato e a linha continuam só com o marcador.
    expect(provedor.entregues.some((t) => t.includes(`/s/${token}`) && t.startsWith('Oi, Marina.'))).toBe(true);
    expect(JSON.stringify(enviada.payload)).not.toContain(token);
    expect(depois.texto).not.toContain(token);
    const de_novo = (await efeitos.executar(CAPACIDADE_DO_WHATSAPP, args, ctx)) as { jaEnviada: boolean };
    expect(de_novo.jaEnviada).toBe(true);
    expect((await daM1()).length).toBe(1);
  });
});

describe('o token errado, vencido ou revogado responde o MESMO 404', () => {
  it('três casos, uma resposta', async () => {
    const r = await whats.receberEntrada(ORG, { telefone: TEL2, texto: 'oi', mensagemId: `${MARCA}-b1` });
    const m1 = await prisma.comercialMensagem.findFirstOrThrow({ where: { leadId: r.leadId, template: 'M1' } });
    const token = await tokenDaSalaDo(r.leadId);
    // sem nome: o vocativo sai inteiro, nenhum nome inventado
    expect(m1.texto.startsWith('Oi. Recebemos')).toBe(true);
    expect((await sala.estado(token)).estagio).toBe('conversa');

    const mensagens: string[] = [];
    const pegar = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        mensagens.push('passou');
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
        mensagens.push((e as NotFoundException).message);
      }
    };
    await pegar(() => sala.estado('x'.repeat(43)));
    await pegar(() => sala.estado('curto'));
    await prisma.salaDoCliente.update({ where: { leadId: r.leadId }, data: { validoAte: new Date(Date.now() - 1000) } });
    await pegar(() => sala.estado(token));
    await pegar(() => sala.form(token, { sistema: 'x', baseOrganizada: false, maiorDor: 'y', equipeFinanceiro: 1 }));
    await prisma.salaDoCliente.update({ where: { leadId: r.leadId }, data: { validoAte: new Date(Date.now() + 86_400_000), revogadoEm: new Date() } });
    await pegar(() => sala.estado(token));
    expect(mensagens).toEqual(Array(5).fill(SALA_NAO_ENCONTRADA));
  });
});

describe('a janela de veto não tira a mensagem da régua', () => {
  it('com o envio automático ligado, a mensagem espera a janela e depois vai à porta, que retém', async () => {
    await prisma.comercialConfig.upsert({ where: { orgId: ORG }, create: { orgId: ORG, envioAutomatico: true, janelaDeVetoMinutos: 10 }, update: { envioAutomatico: true, janelaDeVetoMinutos: 10 } });
    const antes = pedidos.length;
    const tel = `+55219${Date.now().toString().slice(-8)}`;
    const r = await whats.receberEntrada(ORG, { telefone: tel, texto: 'oi', nome: 'Paulo', mensagemId: `${MARCA}-c1` });
    const m1 = await prisma.comercialMensagem.findFirstOrThrow({ where: { leadId: r.leadId, template: 'M1' } });
    expect(m1.estado).toBe('em_veto');
    expect(pedidos.length).toBe(antes);

    const soltar = relogio.inscritas().find(([n]) => n === 'whats.janela-de-veto')![1];
    await soltar(ORG, new Date(m1.vetoAte!.getTime() - 60_000));
    expect((await prisma.comercialMensagem.findUniqueOrThrow({ where: { id: m1.id } })).estado).toBe('em_veto');
    await soltar(ORG, new Date(m1.vetoAte!.getTime() + 1000));
    const depois = await prisma.comercialMensagem.findUniqueOrThrow({ where: { id: m1.id } });
    expect(depois.estado).toBe('na_fila');
    expect(pedidos.length).toBe(antes + 1);

    // VETO só vale dentro da janela
    expect(await whats.vetar(ORG, m1.id)).toBe(false);
    await prisma.comercialConfig.update({ where: { orgId: ORG }, data: { envioAutomatico: false, janelaDeVetoMinutos: null } });
  });
});
