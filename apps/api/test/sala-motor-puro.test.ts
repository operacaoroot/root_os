import { describe, expect, it } from 'vitest';
import { COMERCIAL_ESTAGIOS, SALA_VALIDADE_DIAS } from '@mktos/shared';

import {
  ETAPA_PARA_O_CLIENTE,
  acompanhamentoDaSala,
  documentosParaOCliente,
  etapaParaOCliente,
  projetarSala,
  proximosPassosParaOCliente,
  type EntradaDaProjecao,
  type EventoDaSala,
} from '../src/comercial/sala-projecao';
import { MARCO_SEM_SALA, marcoDoLinkIndisponivel, motivoDoLinkIndisponivel } from '../src/comercial/sala-estado.service';

/*
 * O MOTOR DA SALA DO CLIENTE (leva 5, L6, 27/10/2026): a parte pura.
 *
 *  1. o acompanhamento é DERIVADO do mesmo material da projeção (nenhuma versão
 *     nova): a etapa em palavras de cliente (sem enum, sem "E3", sem travessão),
 *     os próximos passos por estágio com data só quando há fonte, os documentos
 *     trocados sem a minuta e sem link interno, e o contato só com número da nota;
 *  2. o motivo do link indisponível cobre os seis casos e o marco diz o que
 *     resolve; o marco "sem sala" aponta o botão.
 */

const agora = new Date('2026-10-27T12:00:00Z');
const ev = (type: string, iso: string, payload: Record<string, unknown> = {}): EventoDaSala => ({ type, occurredAt: new Date(iso), payload });

function entrada(over: Partial<EntradaDaProjecao> = {}): EntradaDaProjecao {
  return {
    slug: 'alicerce',
    nomeDoLead: 'Marina Duarte',
    validoAte: new Date('2027-01-25T00:00:00Z'),
    dados: {},
    ficha: null,
    eventos: [ev('lead.chegou', '2026-10-20T12:00:00Z', { telefone: '5532999990000', texto: 'oi' })],
    cobrancas: [],
    documentos: [],
    agora,
    ...over,
  };
}

const ficha = (etapa: string, over: Partial<NonNullable<EntradaDaProjecao['ficha']>> = {}): NonNullable<EntradaDaProjecao['ficha']> => ({
  etapa,
  empresa: 'Construtora Alicerce',
  reuniaoEm: null,
  quadroDeCustos: null,
  grupoJid: null,
  kickoffEm: null,
  clienteAtivoEm: null,
  trilhoId: null,
  ...over,
});

const PROPOSTA = { versao: 2, produto: 'operacao', valorCentavos: 1_800_000, parcelas: 3, parcelaCentavos: 600_000, formas: ['pix'], validaAte: '2026-11-05T03:00:00Z', hash: 'h2' };

describe('a etapa em palavras de cliente', () => {
  it('cobre todas as etapas do enum, sem o enum, sem "E3" e sem travessão', () => {
    for (const etapa of COMERCIAL_ESTAGIOS) {
      const t = ETAPA_PARA_O_CLIENTE[etapa];
      expect(t, etapa).toBeDefined();
      for (const texto of [t.rotulo, t.descricao]) {
        expect(texto).not.toMatch(/[—–]/);
        expect(texto).not.toMatch(/\bE\d\b/);
        expect(texto).not.toContain('_');
        expect(texto).not.toBe(etapa);
      }
    }
  });
  it('dá a posição no funil nas ativas e marca a saída', () => {
    expect(etapaParaOCliente('reuniao_agendada')).toMatchObject({ chave: 'reuniao_agendada', rotulo: 'Conversa marcada', ordem: 3, total: 9, saida: false });
    expect(etapaParaOCliente('geladeira')).toMatchObject({ ordem: null, saida: true, rotulo: 'Conversa pausada' });
    expect(etapaParaOCliente('o que for')).toBeNull();
    expect(etapaParaOCliente(null)).toBeNull();
  });
});

describe('os próximos passos para o cliente', () => {
  it('conversa: responder, depois escolher horário, depois a conversa com data e hora', () => {
    const base = entrada({ ficha: ficha('novo_lead') });
    expect(proximosPassosParaOCliente(projetarSala(base), base)).toEqual([{ texto: 'Responder as quatro perguntas aqui na sala', quando: null, quandoTipo: null, deQuem: 'voce' }]);

    const comForm = entrada({
      ficha: ficha('qualificacao'),
      dados: { horariosOferecidos: ['2026-10-29T13:00:00.000Z', '2026-10-29T18:00:00.000Z'] },
      eventos: [...base.eventos, ev('form.respondido', '2026-10-21T12:00:00Z', { sistema: 'Omie', baseOrganizada: true, maiorDor: 'conciliação', equipeFinanceiro: 2 })],
    });
    expect(proximosPassosParaOCliente(projetarSala(comForm), comForm)[0]).toMatchObject({ texto: 'Escolher um horário para a conversa com um dos sócios', deQuem: 'voce' });

    const marcada = entrada({ ficha: ficha('reuniao_agendada'), eventos: [...comForm.eventos, ev('agenda.escolhida', '2026-10-21T13:00:00Z', { horario: '2026-10-29T13:00:00.000Z', oferecidos: [] })] });
    expect(proximosPassosParaOCliente(projetarSala(marcada), marcada)[0]).toEqual({ texto: 'Conversa com um dos sócios', quando: '2026-10-29T13:00:00.000Z', quandoTipo: 'em', deQuem: 'voce' });
  });

  it('proposta: a dúvida aberta e o ajuste vêm antes; ler ou aceitar leva a validade como prazo', () => {
    const e = entrada({
      ficha: ficha('proposta'),
      eventos: [
        ev('proposta.publicada', '2026-10-25T12:00:00Z', PROPOSTA),
        ev('proposta.duvida', '2026-10-26T12:00:00Z', { versao: 2, pergunta: 'Inclui o ERP?', resposta: null }),
        ev('proposta.ajuste_pedido', '2026-10-26T13:00:00Z', { versao: 2, pedido: 'parcelar em 4' }),
      ],
    });
    const passos = proximosPassosParaOCliente(projetarSala(e), e);
    expect(passos.map((p) => p.texto)).toEqual(['A Root responde ao seu pedido de ajuste', 'A Root responde a sua dúvida', 'Ler a proposta']);
    expect(passos[2]).toMatchObject({ quando: PROPOSTA.validaAte, quandoTipo: 'ate', deQuem: 'voce' });
    expect(passos.length).toBeLessThanOrEqual(3);
  });

  it('contrato: dados, cobrança, pagamento, contrato e assinaturas, na ordem do que falta', () => {
    const aceita = [ev('proposta.publicada', '2026-10-25T12:00:00Z', PROPOSTA), ev('aceite.dados', '2026-10-26T12:00:00Z', { cnpj: '1', razaoSocial: 'A', endereco: 'R', quemAssina: 'M', email: 'm@a.com' })];
    const soDados = entrada({ ficha: ficha('contrato'), eventos: aceita });
    expect(proximosPassosParaOCliente(projetarSala(soDados), soDados)[0].texto).toBe('Confirmar os seus dados e aceitar a forma de pagamento');

    const comAceite = entrada({ ficha: ficha('contrato'), eventos: [...aceita, ev('proposta.aceita', '2026-10-26T12:30:00Z', { versao: 2, produto: 'operacao', valorCentavos: 1_800_000, parcelas: 3, forma: 'pix', hash: 'h2' })] });
    expect(proximosPassosParaOCliente(projetarSala(comAceite), comAceite).map((p) => p.texto)).toEqual(['A Root gera a cobrança da primeira parcela', 'A Root gera o contrato com os seus dados']);

    const cobrada = entrada({
      ...comAceite,
      cobrancas: [{ parcela: 1, estado: 'pendente', valorCentavos: 600_000, linkPagamento: 'https://pag', pixCopiaECola: null }],
      documentos: [{ estado: 'enviado', linkCliente: 'https://assina/x', assinadoClienteEm: null, assinadoRootEm: null, criadoEm: new Date('2026-10-26T13:00:00Z'), provedor: 'zapsign' }],
    });
    expect(proximosPassosParaOCliente(projetarSala(cobrada), cobrada).map((p) => [p.deQuem, p.texto])).toEqual([['voce', 'Pagar a primeira parcela'], ['voce', 'Assinar o contrato pelo celular']]);
  });

  it('começo: o kickoff a marcar, marcado com hora, e o kit depois; saída só fala da geladeira', () => {
    const ativo = entrada({ ficha: ficha('fechado', { clienteAtivoEm: new Date('2026-10-27T10:00:00Z'), grupoJid: 'g@g.us' }), eventos: [ev('cliente.ativo', '2026-10-27T10:00:00Z', { chave: 'x' })] });
    expect(proximosPassosParaOCliente(projetarSala(ativo), ativo)).toEqual([{ texto: 'Escolher o horário do kickoff', quando: null, quandoTipo: null, deQuem: 'voce' }]);

    const marcado = entrada({ ...ativo, eventos: [...ativo.eventos, ev('kickoff.marcado', '2026-10-27T11:00:00Z', { horario: '2026-10-30T13:00:00.000Z' })] });
    expect(proximosPassosParaOCliente(projetarSala(marcado), marcado)[0]).toEqual({ texto: 'Kickoff com a Root', quando: '2026-10-30T13:00:00.000Z', quandoTipo: 'em', deQuem: 'voce' });

    const geladeira = entrada({ ficha: ficha('geladeira') });
    expect(proximosPassosParaOCliente(projetarSala(geladeira), { ...geladeira, voltaEm: new Date('2026-12-01T12:00:00Z') })).toEqual([{ texto: 'Retomamos a conversa', quando: '2026-12-01T12:00:00.000Z', quandoTipo: 'em', deQuem: 'root' }]);
    expect(proximosPassosParaOCliente(projetarSala(entrada({ ficha: ficha('perdido') })), entrada({ ficha: ficha('perdido') }))).toEqual([]);
  });
});

describe('os documentos trocados', () => {
  it('lista proposta por versão, arquivo do cliente, diagnóstico aprovado e contrato; a minuta e o link interno ficam fora', () => {
    const e = entrada({
      ficha: ficha('contrato'),
      eventos: [
        ev('arquivo.enviado', '2026-10-21T12:00:00Z', { nome: 'fechamento-set.pdf', bytes: 250_000, tipo: 'application/pdf' }),
        ev('diagnostico.pronto', '2026-10-23T12:00:00Z', { dores: [{ n: 1, texto: 'conciliação manual', minuto: null }], objecoes: [], aprovadoEm: '2026-10-23T13:00:00Z' }),
        ev('diagnostico.pronto', '2026-10-22T12:00:00Z', { dores: [{ n: 1, texto: 'rascunho', minuto: null }], objecoes: [], aprovadoEm: null }),
        ev('proposta.publicada', '2026-10-24T12:00:00Z', { ...PROPOSTA, versao: 1, hash: 'h1' }),
        ev('proposta.publicada', '2026-10-25T12:00:00Z', PROPOSTA),
        ev('aceite.dados', '2026-10-26T12:00:00Z', { cnpj: '1', razaoSocial: 'A', endereco: 'R', quemAssina: 'M', email: 'm@a.com' }),
      ],
      documentos: [
        { estado: 'enviado', linkCliente: 'https://assina/x', assinadoClienteEm: null, assinadoRootEm: null, criadoEm: new Date('2026-10-26T13:00:00Z'), provedor: 'zapsign' },
        { estado: 'rascunho', linkCliente: null, assinadoClienteEm: null, assinadoRootEm: null, criadoEm: new Date('2026-10-26T14:00:00Z'), provedor: 'minuta' },
      ],
    });
    const docs = documentosParaOCliente(e, projetarSala(e));
    expect(docs.map((d) => [d.tipo, d.titulo, d.de])).toEqual([
      ['contrato', 'Contrato', 'root'],
      ['proposta', 'Proposta v2', 'root'],
      ['proposta', 'Proposta v1', 'root'],
      ['diagnostico', 'O seu diagnóstico', 'root'],
      ['arquivo', 'fechamento-set.pdf', 'voce'],
    ]);
    expect(docs[0]).toMatchObject({ estado: 'aguardando a sua assinatura', link: 'https://assina/x' });
    expect(docs[1]).toMatchObject({ versao: 2, estado: 'publicada para você ler' });
    expect(docs[2]).toMatchObject({ versao: 1, estado: 'substituída por uma versão mais nova' });
    expect(docs[4].estado).toBe('244 KB, recebido pela Root');
    expect(docs.some((d) => d.estado === 'rascunho')).toBe(false);
  });

  it('contrato assinado pelos dois não leva link; o anexado fora diz que a Root o guarda', () => {
    const e = entrada({
      documentos: [
        { estado: 'assinado', linkCliente: 'https://assina/x', assinadoClienteEm: new Date('2026-10-27T10:00:00Z'), assinadoRootEm: new Date('2026-10-27T11:00:00Z'), criadoEm: new Date('2026-10-26T13:00:00Z'), provedor: 'zapsign' },
        { estado: 'assinado', linkCliente: null, assinadoClienteEm: null, assinadoRootEm: null, criadoEm: new Date('2026-10-20T13:00:00Z'), provedor: 'anexo' },
      ],
    });
    const docs = documentosParaOCliente(e, projetarSala(e));
    expect(docs[0]).toMatchObject({ estado: 'assinado pelos dois', link: null });
    expect(docs[1]).toMatchObject({ estado: 'assinado, guardado pela Root', link: null });
  });
});

describe('o acompanhamento inteiro', () => {
  it('junta os quatro blocos; o contato só tem número quando a nota traz um número válido', () => {
    const e = entrada({ ficha: ficha('qualificacao') });
    const estado = projetarSala(e);
    const sem = acompanhamentoDaSala(e, estado);
    expect(sem.etapa?.rotulo).toBe('Entendendo o seu cenário');
    expect(sem.contato).toEqual({ whatsapp: null, rotulo: expect.stringContaining('chega em breve') });
    expect(sem.proximosPassos.length).toBeGreaterThan(0);
    expect(sem.documentos).toEqual([]);

    const com = acompanhamentoDaSala({ ...e, whatsappDaRoot: '5532999990000' }, estado);
    expect(com.contato).toEqual({ whatsapp: '5532999990000', rotulo: 'Falar com a Root no WhatsApp' });
    expect(acompanhamentoDaSala({ ...e, whatsappDaRoot: 'liga lá' }, estado).contato.whatsapp).toBeNull();
  });

  it('nenhum texto do acompanhamento tem travessão', () => {
    const e = entrada({
      ficha: ficha('proposta'),
      eventos: [ev('proposta.publicada', '2026-10-25T12:00:00Z', PROPOSTA), ev('arquivo.enviado', '2026-10-21T12:00:00Z', { nome: 'x.pdf', bytes: 10, tipo: 'application/pdf' })],
    });
    const a = acompanhamentoDaSala(e, projetarSala(e));
    const textos = [a.etapa?.rotulo, a.etapa?.descricao, a.contato.rotulo, ...a.proximosPassos.map((p) => p.texto), ...a.documentos.flatMap((d) => [d.titulo, d.estado])];
    for (const t of textos) expect(String(t)).not.toMatch(/[—–]/);
  });
});

describe('por que o link não abre (o painel)', () => {
  const sala = (over: Partial<{ validoAte: Date; revogadoEm: Date | null; tokenCifrado: string | null }> = {}) => ({
    validoAte: new Date(agora.getTime() + SALA_VALIDADE_DIAS * 86_400_000),
    revogadoEm: null,
    tokenCifrado: 'v1.a.b.c',
    ...over,
  });
  const ok = { temChave: true, linkAbre: true };

  it('os seis motivos, na ordem em que a tela os deve dizer, e nulo quando o link abre', () => {
    expect(motivoDoLinkIndisponivel(null, ok, agora)).toBe('sem_sala');
    expect(motivoDoLinkIndisponivel(sala({ revogadoEm: new Date('2026-10-26T00:00:00Z') }), ok, agora)).toBe('revogada');
    expect(motivoDoLinkIndisponivel(sala({ validoAte: new Date('2026-10-26T00:00:00Z') }), ok, agora)).toBe('vencida');
    expect(motivoDoLinkIndisponivel(sala(), { temChave: false, linkAbre: false }, agora)).toBe('sem_chave_no_ambiente');
    expect(motivoDoLinkIndisponivel(sala({ tokenCifrado: null }), { temChave: true, linkAbre: false }, agora)).toBe('token_nao_guardado');
    expect(motivoDoLinkIndisponivel(sala(), { temChave: true, linkAbre: false }, agora)).toBe('chave_de_outro_ambiente');
    expect(motivoDoLinkIndisponivel(sala(), ok, agora)).toBeNull();
  });

  it('cada marco diz o que resolve: gerar link novo, ou a configuração quando falta a chave', () => {
    const s = sala({ validoAte: new Date('2026-10-26T00:00:00Z') });
    expect(marcoDoLinkIndisponivel('vencida', s)).toMatchObject({ tipo: 'validade', rotulo: 'Sala vencida', em: '2026-10-26T00:00:00.000Z', tom: 'ruim' });
    expect(marcoDoLinkIndisponivel('vencida', s).detalhe).toContain('Gerar link novo');
    expect(marcoDoLinkIndisponivel('chave_de_outro_ambiente', s).detalhe).toContain('outro ambiente');
    expect(marcoDoLinkIndisponivel('token_nao_guardado', s).detalhe).toContain('Gerar link novo');
    expect(marcoDoLinkIndisponivel('sem_chave_no_ambiente', s).detalhe).toContain('ENCRYPTION_KEY');
    expect(marcoDoLinkIndisponivel('sem_chave_no_ambiente', s).detalhe).not.toContain('Gerar link novo');
    expect(MARCO_SEM_SALA).toMatchObject({ tipo: 'criada', em: null, tom: 'alerta' });
    expect(MARCO_SEM_SALA.detalhe).toContain('crie agora pelo botão');
    for (const m of ['revogada', 'vencida', 'sem_chave_no_ambiente', 'token_nao_guardado', 'chave_de_outro_ambiente'] as const) {
      const marco = marcoDoLinkIndisponivel(m, s);
      expect(`${marco.rotulo} ${marco.detalhe}`).not.toMatch(/[—–]/);
    }
    expect(`${MARCO_SEM_SALA.rotulo} ${MARCO_SEM_SALA.detalhe}`).not.toMatch(/[—–]/);
  });
});
