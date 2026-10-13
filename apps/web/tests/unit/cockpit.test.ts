import { describe, expect, it } from 'vitest';
import type { FunilVivo, CartaoDoFunil } from '@mktos/shared';

import { ErroDaApi } from '@/lib/api';
import {
  AUSENTE,
  agruparFunil,
  contarParcelas,
  dataDoDia,
  diaHoraSP,
  duracao,
  ehNaoImplementado,
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
    expect(percentual(92)).toBe('92%');
    expect(percentual(null)).toBe(AUSENTE);
    expect(segundos(400)).toBe('0,4 s');
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
  });

  it('quando roda a próxima ação', () => {
    const agora = new Date('2026-10-13T15:00:00.000Z');
    expect(quandoRoda('2026-10-13T17:00:00.000Z', agora)).toBe('em 2 h');
    expect(quandoRoda('2026-10-16T15:00:00.000Z', agora)).toBe('em 3 dias');
    expect(quandoRoda('2026-10-13T12:00:00.000Z', agora)).toBe('há 3 h');
    expect(quandoRoda(null, agora)).toBe('');
    expect(duracao(30 * 60_000)).toBe('30 min');
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

describe('cockpit — decisão, porta e 501', () => {
  it('o rótulo do padrão vem da opção, não da chave', () => {
    expect(rotuloDoPadrao({ padrao: 'manter', opcoes: [{ chave: 'manter', rotulo: 'Manter o preço' }] })).toBe('Manter o preço');
    expect(rotuloDoPadrao({ padrao: 'x', opcoes: [] })).toBe('x');
  });

  it('o rascunho na porta é "aguardando aprovação"', () => {
    expect(explicarRascunho('na_porta').aguardaAprovacao).toBe(true);
    expect(explicarRascunho('na_fila').aguardaAprovacao).toBe(true);
    expect(explicarRascunho('publicada').aguardaAprovacao).toBe(false);
    expect(explicarRascunho('agendada', '2026-10-13T21:00:00.000Z').rotulo).toBe('agendada: vai à porta às 18:00');
  });

  it('reconhece a resposta retida da porta', () => {
    expect(ficouRetida({ status: 'aguardando_aprovacao', approvalId: 'x' })).toBe(true);
    expect(ficouRetida({ estado: 'na_porta', approvalId: 'x' })).toBe(true);
    expect(ficouRetida({ estado: 'publicada', approvalId: null })).toBe(false);
    expect(ficouRetida(null)).toBe(false);
  });

  it('501 é "ainda não entregue"; outro erro não é', () => {
    expect(ehNaoImplementado(new ErroDaApi('fase 2', 501))).toBe(true);
    expect(ehNaoImplementado(new ErroDaApi('caiu', 500))).toBe(false);
    expect(ehNaoImplementado(new Error('x'))).toBe(false);
  });

  it('conta as parcelas pagas e atrasadas', () => {
    expect(contarParcelas([{ estado: 'paga' }, { estado: 'pendente' }, { estado: 'atrasada' }])).toEqual({ pagas: 1, total: 3, atrasadas: 1 });
  });
});
