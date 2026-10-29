import { describe, expect, it } from 'vitest';
import { melhorTitulo, palavras } from '../src/finance/conciliacao.service';

// Casos reais de 29/10/2026. Desde a tese do Financeiro, fora do Asaas nada casa
// sozinho: a nota só ordena as sugestões, e o nome em comum vem antes.
const dia = (d: string) => new Date(`${d}T00:00:00Z`);
const mov = (description: string, amount: number, date: string, extra = '') => ({
  id: 'm', type: 'saida' as const, amount, date: dia(date), description, accountId: 'a', texto: `${description} ${extra}`,
});
const tit = (id: string, description: string, amount: number, due: string, nomes: string[]) => ({
  id, type: 'saida' as const, amount, date: dia(due), dueDate: dia(due), description, partnerName: null,
  nomes: nomes.flatMap(palavras),
});

describe('conciliação: sugestão pelo nome, nunca casamento só pelo valor', () => {
  it('a taxa de boleto do Asaas e a ZapSign de mesmo valor viram no máximo uma sugestão sem nome em comum', () => {
    const m = mov('Taxa de boleto - fatura nr. 936653250 Promedical Equipamentos Médicos LTDA', 1.99, '2026-10-16', 'Asaas');
    const r = melhorTitulo(m, [tit('zap', 'ZapSign — 1º mês (promocional)', 1.99, '2026-10-19', ['ZapSign'])]);
    expect(r?.score).toBeGreaterThanOrEqual(0.85);
    expect(r?.nome).toBe(false);
  });

  it('o Pix para o fornecedor certo é sugerido com o nome em comum', () => {
    const m = mov('Transação via Pix com chave para AGUIA LASER PERSONALIZADOS LTDA', 375, '2026-10-31');
    const r = melhorTitulo(m, [tit('letreiro', 'Letreiro da sala — 50% restante', 375, '2026-10-31', ['Águia Laser', 'Letreiro da sala'])]);
    expect(r?.tit.id).toBe('letreiro');
    expect(r?.nome).toBe(true);
  });

  it('com dois títulos de mesmo valor, sugere o de nome em comum mesmo com nota menor', () => {
    const m = mov('Transação via Pix com chave para PEDRO HENRIQUE MAGNAGO GONCALVES', 140, '2026-10-30');
    const r = melhorTitulo(m, [
      tit('outro', 'Internet da sala', 140, '2026-10-30', ['Operadora de internet']),
      tit('pedro', 'Reembolso de despesa', 140, '2026-10-27', ['Pedro Magnago']),
    ]);
    expect(r?.tit.id).toBe('pedro');
  });

  it('palavras genéricas, números e acentos não contam como nome', () => {
    expect(palavras('Transação via Pix — fatura 2026 Operação ROOT Águia')).toEqual(['aguia']);
  });
});
