import { describe, expect, it } from 'vitest';

import { novaChave } from '../../src/app/agenda/painel';

/*
 * A chave do pedido de escrita vira o id do evento no Google, e a API só aceita
 * base32hex minúsculo (`CHAVE_DO_PEDIDO` em apps/api/src/agenda/escrita/escrita-pura.ts).
 * A integração achou a tela mandando UUID com hífen: o painel respondia "Pedido de
 * escrita inválido" em todo Marcar. Este teste prende a tela ao formato da API.
 */
const CHAVE_DO_PEDIDO = /^[a-v0-9]{10,64}$/;

describe('a chave do pedido da tela', () => {
  it('cabe no formato que a API aceita, e muda a cada pedido', () => {
    const vistas = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = novaChave();
      expect(c).toMatch(CHAVE_DO_PEDIDO);
      vistas.add(c);
    }
    expect(vistas.size).toBe(200);
  });
});
