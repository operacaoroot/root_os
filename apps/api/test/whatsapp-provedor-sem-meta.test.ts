import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ProvedorExcluidoError,
  ProvedorNaoAceitoError,
  RECUSA_DO_PROVEDOR_META,
  provedorDoAmbiente,
} from '../src/comercial/canais/whatsapp.port';

/*
 * PRODUÇÃO 22, M4 · `meta` SAIU DE `WHATSAPP_PROVEDOR`.
 *
 * Só `simulado` e `evolution`. `meta` era um esqueleto que recusava todo envio:
 * subir com ele faria a mesa achar que o comercial estava ligado. Agora a API
 * não sobe e a frase diz o que trocar, como já era com o valor excluído.
 */
describe('os provedores do WhatsApp do comercial', () => {
  it('meta derruba o arranque com a frase, sem diferença de maiúscula nem espaço', () => {
    for (const v of ['meta', 'META', ' Meta ']) {
      expect(() => provedorDoAmbiente(v)).toThrow(ProvedorNaoAceitoError);
      expect(() => provedorDoAmbiente(v)).toThrow(RECUSA_DO_PROVEDOR_META);
    }
    expect(RECUSA_DO_PROVEDOR_META).toMatch(/só simulado e evolution/);
    expect(RECUSA_DO_PROVEDOR_META).not.toMatch(/—/);
  });

  it('simulado e evolution seguem; vazio é simulado; o valor excluído antes continua recusado', () => {
    expect(provedorDoAmbiente('evolution')).toBe('evolution');
    expect(provedorDoAmbiente('simulado')).toBe('simulado');
    expect(provedorDoAmbiente('')).toBe('simulado');
    expect(provedorDoAmbiente(undefined)).toBe('simulado');
    expect(() => provedorDoAmbiente(['digi', 'sac'].join(''))).toThrow(ProvedorExcluidoError);
  });

  it('o esqueleto da Cloud API saiu do caminho de arranque (nenhum código instancia o MetaProvider)', () => {
    const servico = readFileSync(join(__dirname, '../src/comercial/whatsapp.service.ts'), 'utf8');
    expect(servico).not.toMatch(/MetaProvider/);
    expect(servico).not.toMatch(/meta\.provider/);
  });
});
