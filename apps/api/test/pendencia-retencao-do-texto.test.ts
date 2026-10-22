import { describe, expect, it } from 'vitest';

import {
  DIAS_DE_RETENCAO_DO_TEXTO,
  contextoSemTrecho,
  dadosSemTexto,
  prazoDoTexto,
} from '../src/pendencias/retencao-do-texto';

/*
 * PRODUÇÃO 22, M4 · O PRAZO DO TEXTO NA PENDÊNCIA (a parte pura).
 * O caso de ponta a ponta (triagem, prazo, expurgo) está em
 * `comercial-agentes-entrada.test.ts`.
 */
describe('o texto guardado numa pendência vence em 14 dias', () => {
  it('o prazo é de 14 dias a partir de agora', () => {
    const agora = new Date('2026-10-22T12:00:00Z');
    expect(DIAS_DE_RETENCAO_DO_TEXTO).toBe(14);
    expect(prazoDoTexto(agora).toISOString()).toBe('2026-11-05T12:00:00.000Z');
  });

  it('dados sem o texto: o resto fica, com a marca de quando saiu', () => {
    const agora = new Date('2026-11-05T12:00:00Z');
    expect(dadosSemTexto({ telefone: '5532900000000', nome: 'Contato', texto: 'mensagem', mensagemId: 'm1', classe: 'outro', confianca: 0.3 }, agora)).toEqual({
      telefone: '5532900000000',
      nome: 'Contato',
      mensagemId: 'm1',
      classe: 'outro',
      confianca: 0.3,
      textoApagadoEm: '2026-11-05T12:00:00.000Z',
    });
    expect(dadosSemTexto(null, agora)).toBeNull();
    expect(dadosSemTexto(['x'], agora)).toBeNull();
  });

  it('o contexto perde o trecho da mensagem, mesmo quando o trecho imita a frase do sistema', () => {
    const normal = '“Oi, quanto custa?”. A triagem achou lead novo com confiança 40% (cumprimento). Nada foi respondido ao contato.';
    expect(contextoSemTrecho(normal)).toBe('(texto apagado depois de 14 dias) A triagem achou lead novo com confiança 40% (cumprimento). Nada foi respondido ao contato.');
    const imitando = '“segredo”. A triagem achou nada ”. A triagem achou outro assunto com confiança 0%. Nada foi respondido ao contato.';
    const limpo = contextoSemTrecho(imitando);
    expect(limpo).not.toContain('segredo');
    expect(limpo).toContain('A triagem achou outro assunto');
    // sem trecho (mensagem vazia), nada muda
    const semTrecho = 'A triagem achou outro assunto com confiança 0%. Nada foi respondido ao contato.';
    expect(contextoSemTrecho(semTrecho)).toBe(semTrecho);
  });
});
