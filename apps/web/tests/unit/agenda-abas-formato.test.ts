import { describe, expect, it } from 'vitest';
import type { FeriadoDaAgenda } from '@mktos/shared';

import {
  mensagemDaEscrita,
  quandoDoCartao,
  rotuloDoCartao,
  textoDoVigia,
  tituloDosConflitos,
  tomDoTipo,
} from '@/app/agenda/abas/conflitos-formato';
import { proximosFeriados, quandoDoRito, textoDaDuracao, textoDosBloqueios } from '@/app/agenda/abas/regras-formato';

/*
 * O TEXTO DAS ABAS REGRAS E CONFLITOS (agenda v2, 29/10/2026, lanes G2 e G5),
 * no formato dos desenhos. Relógio de São Paulo.
 */

const AGORA = new Date('2026-10-29T14:20:00-03:00');

describe('Conflitos: o texto', () => {
  it('"qua 04/11 · 09:00 · em 6 dias"', () => {
    expect(quandoDoCartao('2026-11-04T09:00:00-03:00', AGORA)).toBe('qua 04/11 · 09:00 · em 6 dias');
    expect(quandoDoCartao('2026-10-30T09:00:00-03:00', AGORA)).toBe('sex 30/10 · 09:00 · amanhã');
    expect(quandoDoCartao('2026-10-29T18:00:00-03:00', AGORA)).toBe('qui 29/10 · 18:00 · hoje');
  });

  it('o título do topo por extenso', () => {
    expect(tituloDosConflitos(6)).toEqual({ comeco: 'Seis coisas pedem', fim: 'uma decisão de vocês.' });
    expect(tituloDosConflitos(1).comeco).toBe('Uma coisa pede');
    expect(tituloDosConflitos(0).comeco).toBe('Nada pede');
    expect(tituloDosConflitos(14).comeco).toBe('14 coisas pedem');
  });

  it('o selo do vigia', () => {
    expect(textoDoVigia('2026-10-29T14:15:00-03:00', AGORA)).toBe('vigia AG-01 passou às 14:15');
    expect(textoDoVigia(null, AGORA)).toBe('vigia AG-01 ainda não passou');
  });

  it('tom e rótulo: choque magenta, janela neutra, o resto atenção', () => {
    expect(tomDoTipo('choque')).toBe('choque');
    expect(tomDoTipo('janela')).toBe('neutro');
    expect(tomDoTipo('sem_meet')).toBe('atencao');
    expect(rotuloDoCartao({ tipo: 'rito', id: 'rito-sem-gente:x' })).toBe('rito sem gente');
    expect(rotuloDoCartao({ tipo: 'padrao', id: 'padrao:x' })).toBe('fora do padrão');
  });

  it('a mensagem da escrita: saiu, fila ou recusa', () => {
    expect(mensagemDaEscrita({ status: 'executado' }).texto).toBe('Saiu: gravado no Google e no histórico.');
    expect(mensagemDaEscrita({ status: 'aguardando_aprovacao', precisaDeOutraPessoa: true })).toEqual({
      tom: 'fila',
      texto: 'Foi para a fila de aprovação. Outra pessoa com alçada confirma em Aprovações. Nada mudou na agenda ainda.',
    });
    expect(
      mensagemDaEscrita({ status: 'recusado', regua: { cor: 'vermelho', itens: [{ nivel: 'bloqueio', regra: 'choque', frase: 'Rodrigo já tem X.' }] } }).texto,
    ).toBe('A régua deu vermelho: Rodrigo já tem X. Nada foi enviado.');
    expect(mensagemDaEscrita({ status: 'recusado', mensagem: 'conector desligado' }).texto).toBe('conector desligado');
  });
});

describe('Regras: o texto', () => {
  it('bloqueio fixo, duração e quando do rito como no desenho', () => {
    expect(textoDosBloqueios([{ diaDaSemana: 4, inicio: '19:00', fim: null }])).toBe('qui a partir de 19:00');
    expect(textoDosBloqueios([])).toBe('nenhum');
    expect(textoDosBloqueios([{ diaDaSemana: 5, inicio: '16:00', fim: '18:00' }])).toBe('sex das 16:00 às 18:00');
    expect(textoDaDuracao(60)).toBe('1 h');
    expect(textoDaDuracao(90)).toBe('1h30');
    expect(textoDaDuracao(45)).toBe('45 min');
    expect(quandoDoRito({ diaDaSemana: 2, ordinalNoMes: null, inicio: '08:00', duracaoMin: 60 })).toBe('ter 08:00 · 1 h');
    expect(quandoDoRito({ diaDaSemana: 4, ordinalNoMes: null, inicio: '19:30', duracaoMin: 90 })).toBe('qui 19:30 · 1h30');
    expect(quandoDoRito({ diaDaSemana: 6, ordinalNoMes: 1, inicio: null, duracaoMin: 1440 })).toBe('1º sáb · dia inteiro');
  });

  it('os próximos feriados ligados, sem repetir o dia', () => {
    const f = (data: string, nome: string, ligado = true): FeriadoDaAgenda => ({ id: data + nome, data, nome, tipo: 'nacional', cidade: null, ligado });
    expect(
      proximosFeriados([f('2026-11-20', 'Consciência Negra'), f('2026-11-02', 'Finados'), f('2026-10-12', 'Aparecida'), f('2026-11-15', 'Proclamação'), f('2026-11-03', 'Desligado', false)], '2026-10-29'),
    ).toEqual(['02/11 Finados', '15/11 Proclamação', '20/11 Consciência Negra']);
  });
});
