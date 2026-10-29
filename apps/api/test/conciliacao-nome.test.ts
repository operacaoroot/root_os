import { describe, expect, it } from 'vitest';
import { melhorTitulo, palavras } from '../src/finance/conciliacao.service';

// Casos reais de 29/10/2026: valor e data iguais não bastam para casar sozinho.
const dia = (d: string) => new Date(`${d}T00:00:00Z`);
const mov = (description: string, amount: number, date: string, extra = '') => ({
  id: 'm', type: 'saida' as const, amount, date: dia(date), description, accountId: 'a', texto: `${description} ${extra}`,
});
const tit = (id: string, description: string, amount: number, due: string, nomes: string[]) => ({
  id, type: 'saida' as const, amount, date: dia(due), dueDate: dia(due), description, partnerName: null,
  nomes: nomes.flatMap(palavras),
});

describe('conciliação: o nome precisa bater para casar sozinho', () => {
  it('taxa de boleto do Asaas não casa sozinha com a ZapSign de mesmo valor', () => {
    const m = mov('Taxa de boleto - fatura nr. 936653250 Promedical Equipamentos Médicos LTDA', 1.99, '2026-10-16', 'Asaas');
    const r = melhorTitulo(m, [tit('zap', 'ZapSign — 1º mês (promocional)', 1.99, '2026-10-19', ['ZapSign', 'ZapSign'])]);
    expect(r?.score).toBeGreaterThanOrEqual(0.85);
    expect(r?.auto).toBe(false);
  });

  it('Pix para o fornecedor certo casa sozinho', () => {
    const m = mov('Transação via Pix com chave para AGUIA LASER PERSONALIZADOS LTDA', 375, '2026-10-31');
    const r = melhorTitulo(m, [tit('letreiro', 'Letreiro da sala — 50% restante', 375, '2026-10-31', ['Águia Laser', 'Letreiro da sala'])]);
    expect(r?.auto).toBe(true);
  });

  it('o apelido do acordo liga o nome da pessoa à empresa', () => {
    const m = { ...mov('Cobrança recebida - fatura nr. 1 ANTONIO F JUNIOR', 397, '2026-11-23'), type: 'entrada' as const };
    const t = { ...tit('affari', 'Affari — parcela', 397, '2026-11-23', ['Affari', 'Affari', 'Antonio f junior']), type: 'entrada' as const };
    expect(melhorTitulo(m, [t])?.auto).toBe(true);
  });

  it('com dois títulos de mesmo valor, prefere o de nome em comum', () => {
    const m = mov('Transação via Pix com chave para PEDRO HENRIQUE MAGNAGO GONCALVES', 140, '2026-10-30');
    const r = melhorTitulo(m, [
      tit('outro', 'Internet da sala', 140, '2026-10-30', ['Operadora de internet']),
      tit('pedro', 'Reembolso de despesa', 140, '2026-10-27', ['Pedro Magnago']),
    ]);
    expect(r?.tit.id).toBe('pedro');
    expect(r?.auto).toBe(true);
  });

  it('palavras genéricas, números e acentos não contam como nome', () => {
    expect(palavras('Transação via Pix — fatura 2026 Operação ROOT Águia')).toEqual(['aguia']);
  });
});
