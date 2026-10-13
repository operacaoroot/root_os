import { describe, expect, it } from 'vitest';
import type { FunilVivo, CartaoDoFunil } from '@mktos/shared';

import {
  AUSENTE,
  agruparFunil,
  contarParcelas,
  custoDaTorre,
  decisaoSemPrazo,
  dataDoDia,
  descricaoJaDizQuando,
  diaHoraSP,
  duracao,
  explicarRascunho,
  faixaDaSaude,
  ficouRetida,
  fioPorDia,
  horaSP,
  motivoDoBloqueio,
  numeroOuAusente,
  percentual,
  prazoDaDecisao,
  quandoRoda,
  quandoSP,
  reaisOuAusente,
  rotuloDoPadrao,
  segundos,
} from '@/lib/cockpit';

const cartao = (leadId: string, etapa: CartaoDoFunil['etapa']): CartaoDoFunil => ({
  leadId, nome: leadId, empresa: null, etapa, saude: null, proximaAcao: null, precisaDeDecisao: false, parado: false,
  diasNaEtapa: 0, motivoSaida: null, voltaEm: null, perfil: null, produto: null,
});

describe('cockpit — o que vem nulo aparece como ausente', () => {
  it('reais: centavos formatados e nulo como ausente, nunca zero', () => {
    expect(reaisOuAusente(1199700)).toBe('R$ 11.997');
    expect(reaisOuAusente(367908)).toBe('R$ 3.679,08');
    expect(reaisOuAusente(null)).toBe(AUSENTE);
    expect(reaisOuAusente(undefined)).toBe(AUSENTE);
    expect(reaisOuAusente(0)).toBe('R$ 0');
  });

  it('número, percentual e segundos: nulo vira ausente', () => {
    expect(numeroOuAusente(86)).toBe('86');
    expect(numeroOuAusente(null)).toBe(AUSENTE);
    expect(percentual(0.97)).toBe('97%');
    // C-23: a escala é sempre fração, sem adivinhar pelo tamanho: 0,01 é 1% e 1 é 100%.
    expect(percentual(0.01)).toBe('1%');
    expect(percentual(1)).toBe('100%');
    expect(percentual(0)).toBe('0%');
    expect(percentual(null)).toBe(AUSENTE);
    expect(segundos(400)).toBe('0,4 s');
    expect(segundos(14)).toBe('14 ms');
    expect(segundos(null)).toBe(AUSENTE);
  });

  it('faixa da saúde só existe com número', () => {
    expect(faixaDaSaude(86)).toBe('alta');
    expect(faixaDaSaude(50)).toBe('media');
    expect(faixaDaSaude(10)).toBe('baixa');
    expect(faixaDaSaude(null)).toBeNull();
  });
});

describe('cockpit — tempo em São Paulo', () => {
  it('hora e dia no fuso de São Paulo, qualquer que seja o do navegador', () => {
    expect(horaSP('2026-10-13T12:13:00.000Z')).toBe('09:13');
    expect(diaHoraSP('2026-10-13T12:13:00.000Z')).toBe('13/10 09:13');
    expect(horaSP(null)).toBe('');
    expect(dataDoDia('2026-11-17')).toBe('17/11');
  });

  it('prazo da decisão: quanto falta, ou quando venceu', () => {
    const agora = new Date('2026-10-13T15:00:00.000Z');
    expect(prazoDaDecisao('2026-10-13T19:00:00.000Z', agora)).toEqual({ texto: 'expira em 4 h', vencido: false });
    expect(prazoDaDecisao('2026-10-13T15:35:00.000Z', agora)).toEqual({ texto: 'expira em 35 min', vencido: false });
    expect(prazoDaDecisao('2026-10-13T14:00:00.000Z', agora)).toEqual({ texto: 'venceu às 11:00', vencido: true });
    expect(prazoDaDecisao('lixo', agora).texto).toBe('prazo ausente');
    // C-6: o que venceu em outro dia diz o dia.
    expect(prazoDaDecisao('2026-10-11T14:00:00.000Z', agora)).toEqual({ texto: 'venceu 11/10 11:00', vencido: true });
  });

  it('C-2: a sentinela do prazo desligado é "sem prazo", nunca uma duração', () => {
    const agora = new Date('2026-10-13T15:00:00.000Z');
    expect(decisaoSemPrazo('9999-12-31T23:59:59.000Z')).toBe(true);
    expect(decisaoSemPrazo('2026-10-13T19:00:00.000Z')).toBe(false);
    expect(prazoDaDecisao('9999-12-31T23:59:59.000Z', agora)).toEqual({ texto: 'sem prazo', vencido: false });
  });

  it('C-6: hora quando é hoje, dia e hora quando não é', () => {
    const agora = new Date('2026-10-13T15:00:00.000Z');
    expect(quandoSP('2026-10-13T17:02:00.000Z', agora)).toBe('14:02');
    expect(quandoSP('2026-10-08T17:02:00.000Z', agora)).toBe('08/10 14:02');
  });

  it('C-5: o custo da torre mostra o dólar medido e "sem medida" para stub, ponte e empresa sem livro', () => {
    expect(custoDaTorre({ custoDeIaHojeCentavos: null, custoDesconhecido: false, custoDeIaHojeUsd: 0.42, provedorDeIa: 'anthropic' }).valor).toBe('US$ 0,42');
    expect(custoDaTorre({ custoDeIaHojeCentavos: 0, custoDesconhecido: true, custoDeIaHojeUsd: 0, provedorDeIa: 'ponte' }).valor).toBe('sem medida');
    expect(custoDaTorre({ custoDeIaHojeCentavos: 0, custoDesconhecido: true, custoDeIaHojeUsd: 0, provedorDeIa: 'stub' }).valor).toBe('sem medida');
    expect(custoDaTorre({ custoDeIaHojeCentavos: null, custoDesconhecido: true, custoDeIaHojeUsd: null, provedorDeIa: 'anthropic' }).valor).toBe('sem medida');
    expect(custoDaTorre({ custoDeIaHojeCentavos: 0, custoDesconhecido: false, custoDeIaHojeUsd: 0, provedorDeIa: 'anthropic' }).valor).toBe(reaisOuAusente(0));
  });

  it('quando roda a próxima ação', () => {
    const agora = new Date('2026-10-13T15:00:00.000Z');
    expect(quandoRoda('2026-10-13T17:00:00.000Z', agora)).toBe('em 2 h');
    expect(quandoRoda('2026-10-16T15:00:00.000Z', agora)).toBe('em 3 dias');
    expect(quandoRoda('2026-10-13T12:00:00.000Z', agora)).toBe('há 3 h');
    expect(quandoRoda(null, agora)).toBe('');
    expect(duracao(30 * 60_000)).toBe('30 min');
    expect(descricaoJaDizQuando('formulário · lembrete em 2 h')).toBe(true);
    expect(descricaoJaDizQuando('assinou · Pix aguardando')).toBe(false);
  });
});

describe('cockpit — funil e fio', () => {
  it('agrupa as colunas da API nas sete da tela 04 sem perder cartão', () => {
    const funil: FunilVivo = {
      colunas: [
        { etapa: 'novo_lead', rotulo: 'E1', cartoes: [cartao('a', 'novo_lead')] },
        { etapa: 'qualificacao', rotulo: 'E2', cartoes: [cartao('b', 'qualificacao')] },
        { etapa: 'reuniao_agendada', rotulo: 'E3', cartoes: [cartao('c', 'reuniao_agendada')] },
        { etapa: 'follow_up', rotulo: 'E7', cartoes: [cartao('d', 'follow_up')] },
        { etapa: 'saidas', rotulo: 'Saídas', cartoes: [cartao('e', 'geladeira')] },
      ],
    };
    const g = agruparFunil(funil);
    expect(g.map((x) => x.rotulo)).toEqual(['novo · qualif.', 'conversa', 'diagnóstico', 'proposta · fup', 'aceite · contrato', 'fechado', 'saídas']);
    expect(g[0].cartoes.map((c) => c.leadId)).toEqual(['a', 'b']);
    expect(g[3].cartoes.map((c) => c.leadId)).toEqual(['d']);
    expect(g.flatMap((x) => x.cartoes)).toHaveLength(5);
  });

  it('o arraste bloqueado diz o motivo e a lista do portão', () => {
    expect(motivoDoBloqueio('Alicerce', 'E8 · Contrato', ['CNPJ e endereço', 'e-mail de quem assina'])).toContain('Para E8 · Contrato falta: CNPJ e endereço; e-mail de quem assina.');
    expect(motivoDoBloqueio('Alicerce', 'E8', null)).toContain('A etapa anda pelo fato');
    expect(motivoDoBloqueio('Pet', null, [])).toContain('não tem próxima etapa');
  });

  it('o fio agrupa por dia relativo, na ordem em que veio', () => {
    const l = (dia: number, id: string) => ({ eventoId: id, type: 't', fonte: 'whats' as const, resumo: id, em: '2026-10-13T12:00:00Z', dia });
    const g = fioPorDia([l(1, 'a'), l(1, 'b'), l(4, 'c'), l(5, 'd')]);
    expect(g.map((x) => [x.dia, x.linhas.length])).toEqual([[1, 2], [4, 1], [5, 1]]);
  });
});

describe('cockpit — decisão e porta', () => {
  it('o rótulo do padrão vem da opção, não da chave', () => {
    expect(rotuloDoPadrao({ padrao: 'manter', opcoes: [{ chave: 'manter', rotulo: 'Manter o preço' }] })).toBe('Manter o preço');
    expect(rotuloDoPadrao({ padrao: 'x', opcoes: [] })).toBe('x');
  });

  it('o rascunho na porta é "aguardando aprovação"', () => {
    expect(explicarRascunho('na_porta').aguardaAprovacao).toBe(true);
    // C-3: na fila de decisões do comercial, não na porta.
    expect(explicarRascunho('na_fila').aguardaAprovacao).toBe(false);
    expect(explicarRascunho('na_fila').naFilaDeDecisoes).toBe(true);
    expect(explicarRascunho('publicada').aguardaAprovacao).toBe(false);
    expect(explicarRascunho('agendada', '2026-10-13T21:00:00.000Z').rotulo).toBe('agendada: vai à porta às 18:00');
  });

  it('reconhece a resposta retida da porta', () => {
    expect(ficouRetida({ status: 'aguardando_aprovacao', approvalId: 'x' })).toBe(true);
    expect(ficouRetida({ estado: 'na_porta', approvalId: 'x' })).toBe(true);
    expect(ficouRetida({ estado: 'publicada', approvalId: null })).toBe(false);
    expect(ficouRetida(null)).toBe(false);
  });

  it('conta as parcelas pagas e atrasadas', () => {
    expect(contarParcelas([{ estado: 'paga' }, { estado: 'pendente' }, { estado: 'atrasada' }])).toEqual({ pagas: 1, total: 3, atrasadas: 1 });
  });
});

describe('cockpit — instantes legíveis no fio', () => {
  it('troca o ISO com fuso pelo dia e hora de São Paulo e deixa o resto', async () => {
    const { instantesLegiveis } = await import('@/lib/cockpit');
    expect(instantesLegiveis('escolheu 2026-10-12T14:11:25-03:00')).toBe('escolheu seg 12/10 14:11');
    expect(instantesLegiveis('kickoff 2026-10-16T13:00:00.000Z · ok')).toBe('kickoff sex 16/10 10:00 · ok');
    expect(instantesLegiveis('M3 enviada')).toBe('M3 enviada');
  });
});

describe('cockpit — revisão P3 das telas', () => {
  it('C-13: a geladeira pede data de volta depois de hoje (São Paulo) e o 409 traz o que falta', async () => {
    const { problemaDaSaida, diaDeHojeSP, diaSeguinte } = await import('@/lib/cockpit');
    const { erroDaResposta } = await import('@/lib/api');
    // 13/10 às 23:30 em São Paulo já é 14/10 em UTC: o "hoje" é o de São Paulo.
    const agora = new Date('2026-10-14T02:30:00.000Z');
    expect(diaDeHojeSP(agora)).toBe('2026-10-13');
    expect(diaSeguinte('2026-10-31')).toBe('2026-11-01');
    expect(problemaDaSaida({ saida: 'geladeira', volta: '', parceiro: '' }, agora)).toMatch(/data de volta/);
    expect(problemaDaSaida({ saida: 'geladeira', volta: '2026-10-13', parceiro: '' }, agora)).toMatch(/depois de hoje/);
    expect(problemaDaSaida({ saida: 'geladeira', volta: '2026-10-14', parceiro: '' }, agora)).toBeNull();
    expect(problemaDaSaida({ saida: 'parceiro', volta: '', parceiro: ' ' }, agora)).toMatch(/parceiro/);
    expect(problemaDaSaida({ saida: 'perdido', volta: '', parceiro: '' }, agora)).toBeNull();
    const e = erroDaResposta({ message: 'Saída recusada.', faltando: ['lead em Fechado: não sai'] }, 409);
    expect(e.message).toBe('Saída recusada.');
    expect(e.detalhes).toEqual(['lead em Fechado: não sai']);
    expect(erroDaResposta({ message: 'x' }, 400).detalhes).toEqual([]);
  });
});

describe('cockpit — funil do relatório (C-14)', () => {
  it('a etapa sai pelo rótulo da casa, nunca a chave crua; o que não é etapa fica como veio', async () => {
    const { rotuloDaLinhaDoFunil } = await import('@/lib/cockpit');
    expect(rotuloDaLinhaDoFunil('reuniao_agendada')).toBe('E3 · Reunião agendada');
    expect(rotuloDaLinhaDoFunil('follow_up')).toBe('E7 · Follow-up');
    expect(rotuloDaLinhaDoFunil('entraram')).toBe('entraram');
  });
});

describe('cockpit — a metade do ajuste (E-26)', () => {
  it('só a opção de desconto menor que o pedido é contraproposta provisória', async () => {
    const { ehContrapropostaProvisoria } = await import('@/lib/cockpit');
    const d = { tipo: 'pedido_de_ajuste', opcoes: [{ chave: 'desconto:4' }, { chave: 'desconto:8' }, { chave: 'manter' }] };
    expect(ehContrapropostaProvisoria(d, 'desconto:4')).toBe(true);
    expect(ehContrapropostaProvisoria(d, 'desconto:8')).toBe(false);
    expect(ehContrapropostaProvisoria(d, 'manter')).toBe(false);
    expect(ehContrapropostaProvisoria({ ...d, tipo: 'lead_parado' }, 'desconto:4')).toBe(false);
    expect(ehContrapropostaProvisoria({ tipo: 'pedido_de_ajuste', opcoes: [{ chave: 'desconto:1' }, { chave: 'manter' }] }, 'desconto:1')).toBe(false);
  });
});
