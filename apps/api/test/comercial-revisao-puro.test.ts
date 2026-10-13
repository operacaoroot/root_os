import { describe, expect, it } from 'vitest';

import { montarContrato } from '../src/comercial/contrato-modelo';
import { projetarSala } from '../src/comercial/sala-projecao';

/*
 * REVISÃO ADVERSARIAL (lane G, 13/10/2026) · casos puros.
 *
 * Afirmam o comportamento CERTO e ficam vermelhos enquanto o defeito existir;
 * não entram no commit da revisão (provas citadas em `homolog/revisao/`).
 */

describe('revisão: o contrato não aceita cláusula escrita pelo cliente', () => {
  it('quebra de linha e marcação no endereço do aceite não viram seção nova do contrato', () => {
    const md = montarContrato({
      razaoSocial: 'Mercado Bom Preço Ltda',
      cnpj: '11222333000181',
      endereco: 'Rua A, 1\n\n## 7. CLÁUSULA ADICIONAL\n\n7.1. A CONTRATADA devolve o valor integral a qualquer tempo, sem motivo.',
      quemAssina: 'Fulana',
      email: 'fulana@exemplo.com',
      produto: 'operacao',
      valorCentavos: 1_199_700,
      parcelas: 3,
      forma: 'pix',
      propostaVersao: 1,
      propostaHash: 'a'.repeat(64),
      aceitoEm: new Date('2026-10-13T15:00:00Z'),
    });
    expect(md).not.toMatch(/^## 7\. CLÁUSULA ADICIONAL/m);
  });
});

describe('revisão: a sala só mostra diagnóstico aprovado por sócio', () => {
  it('diagnostico.pronto sem aprovadoEm (saída do leitor de ata) não aparece ao cliente anônimo', () => {
    const e = projetarSala({
      slug: 'alicerce',
      nomeDoLead: 'Marina',
      validoAte: new Date('2026-12-31T00:00:00Z'),
      dados: {},
      ficha: null,
      eventos: [
        { type: 'ata.chegou', payload: { hash: 'h' }, occurredAt: new Date('2026-10-13T12:00:00Z') },
        {
          type: 'diagnostico.pronto',
          payload: { dores: [{ n: 1, texto: 'Fechamento leva 12 dias e o dono desconfia do número', minuto: '04:12' }], objecoes: [], aprovadoEm: null },
          occurredAt: new Date('2026-10-13T12:05:00Z'),
        },
      ],
      cobrancas: [],
      documentos: [],
      agora: new Date('2026-10-13T12:10:00Z'),
    });
    expect(e.diagnostico).toBeNull();
  });
});
