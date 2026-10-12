import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { TOTEM_MIDIA_MAX_BYTES, totemEhUrlDeMidia } from '@mktos/shared';

import { conferirMidia, midiaPedidaValida, tipoPelaAssinatura } from '../src/totem/comum/midia';

const ORG = '11111111-2222-4333-8444-555555555555';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const WEBP = Uint8Array.from([...'RIFF'].map((c) => c.charCodeAt(0)).concat([0x24, 0, 0, 0], [...'WEBPVP8 '].map((c) => c.charCodeAt(0))));
const HTML = new TextEncoder().encode('<html><script>alert(1)</script></html>');

describe('tipoPelaAssinatura', () => {
  it('reconhece jpeg, png e webp pelos primeiros bytes', () => {
    expect(tipoPelaAssinatura(JPEG)).toBe('image/jpeg');
    expect(tipoPelaAssinatura(PNG)).toBe('image/png');
    expect(tipoPelaAssinatura(WEBP)).toBe('image/webp');
  });

  it('recusa o que não é imagem, mesmo curto ou com RIFF de outro formato', () => {
    expect(tipoPelaAssinatura(HTML)).toBeNull();
    expect(tipoPelaAssinatura(Uint8Array.from([0xff, 0xd8]))).toBeNull();
    const wav = Uint8Array.from([...'RIFF\0\0\0\0WAVE'].map((c) => c.charCodeAt(0)));
    expect(tipoPelaAssinatura(wav)).toBeNull();
    expect(tipoPelaAssinatura(new Uint8Array(0))).toBeNull();
  });
});

describe('conferirMidia', () => {
  it('nomeia pelo hash do conteúdo, com a extensão da assinatura', () => {
    const a = conferirMidia(ORG, PNG);
    expect(a.tipo).toBe('image/png');
    expect(a.arquivo).toMatch(/^[a-f0-9]{32}\.png$/);
    expect(a.chave).toBe(`totem/${ORG}/${a.arquivo}`);
    expect(a.url).toBe(`/api/totem-publico/midia/${ORG}/${a.arquivo}`);
    expect(totemEhUrlDeMidia(a.url)).toBe(true);
    expect(conferirMidia(ORG, PNG).arquivo).toBe(a.arquivo);
    expect(conferirMidia(ORG, JPEG).arquivo).toMatch(/\.jpg$/);
  });

  it('recusa vazio, grande demais e o que não é imagem', () => {
    expect(() => conferirMidia(ORG, undefined)).toThrow(BadRequestException);
    expect(() => conferirMidia(ORG, new Uint8Array(0))).toThrow(BadRequestException);
    expect(() => conferirMidia(ORG, HTML)).toThrow('JPG, PNG ou WEBP');
    const grande = new Uint8Array(TOTEM_MIDIA_MAX_BYTES + 1);
    grande.set(JPEG);
    expect(() => conferirMidia(ORG, grande)).toThrow('2 MB');
  });
});

describe('midiaPedidaValida', () => {
  it('aceita só uuid e o nome que o envio gera', () => {
    const arquivo = `${'a'.repeat(32)}.webp`;
    expect(midiaPedidaValida(ORG, arquivo)).toBe(true);
    expect(midiaPedidaValida('nao-e-uuid', arquivo)).toBe(false);
    expect(midiaPedidaValida(ORG, '../segredo.png')).toBe(false);
    expect(midiaPedidaValida(ORG, `${'a'.repeat(32)}.svg`)).toBe(false);
    expect(midiaPedidaValida(ORG, `${'A'.repeat(32)}.png`)).toBe(false);
  });
});
