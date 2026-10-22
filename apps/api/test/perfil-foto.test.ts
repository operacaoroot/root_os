import { describe, expect, it } from 'vitest';
import {
  PERFIL_FOTO_MAX_BYTES_DO_ENVIO,
  PERFIL_FOTO_MAX_BYTES_GUARDADOS,
  PerfilUpdateSchema,
  aniversariantesDoDia,
  aniversarioDaData,
  dataDeNascimentoValida,
  fusoValido,
  iniciaisDoNome,
  rotaDaFoto,
  sugerirNomeNoVault,
} from '@mktos/shared';

import {
  cabecalhosDaFoto,
  conferirFotoDePerfil,
  dimensoesDoPng,
  dimensoesDoWebp,
  tipoPelaAssinatura,
} from '../src/perfil/imagem-do-avatar';
import { jpegDe, pngDe, webpLosslessDe, webpLossyDe, webpVp8xDe } from './perfil-dubles';

/*
 * A FOTO DE PERFIL CONFERIDA PELOS BYTES (produção 22B, I6). Parte pura:
 * o tipo vem da assinatura e não do `Content-Type`, SVG é recusado, o lado
 * máximo é 512 px (o servidor não redimensiona), o tamanho guardado é 256 KB,
 * e quem serve manda o tipo conferido com `nosniff`, `inline` e CSP fechada.
 */

const arquivo = (buffer: Buffer, mimetype = 'image/png') => ({ buffer, mimetype, size: buffer.length });

describe('o tipo vem dos bytes', () => {
  it('JPEG, PNG e WebP pela assinatura; o resto é nulo', () => {
    expect(tipoPelaAssinatura(jpegDe(10, 10))).toBe('jpeg');
    expect(tipoPelaAssinatura(pngDe(10, 10))).toBe('png');
    expect(tipoPelaAssinatura(webpLosslessDe(10, 10))).toBe('webp');
    expect(tipoPelaAssinatura(Buffer.from('GIF89a........'))).toBeNull();
    expect(tipoPelaAssinatura(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });

  it('o Content-Type declarado não decide: PNG declarado como JPEG passa como PNG; texto declarado PNG é recusado', () => {
    const r = conferirFotoDePerfil(arquivo(pngDe(256, 256), 'image/jpeg'));
    expect(r).toMatchObject({ ok: true, tipo: 'png', mime: 'image/png' });
    const falso = conferirFotoDePerfil(arquivo(Buffer.from('não sou imagem, sou texto puro'), 'image/png'));
    expect(falso).toEqual({ ok: false, motivo: 'O arquivo não é JPG, PNG nem WebP (conferido pelos bytes).' });
  });

  it('SVG é recusado com a frase própria (pelo tipo declarado ou pelo conteúdo)', () => {
    const svg = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(conferirFotoDePerfil(arquivo(svg, 'image/svg+xml'))).toEqual({ ok: false, motivo: 'SVG não serve de foto de perfil. Envie JPG, PNG ou WebP.' });
    expect(conferirFotoDePerfil(arquivo(svg, 'image/png'))).toMatchObject({ ok: false, motivo: expect.stringContaining('SVG') });
  });

  it('as dimensões vêm do cabeçalho: SOF do JPEG, IHDR do PNG, VP8/VP8L/VP8X do WebP', () => {
    expect(conferirFotoDePerfil(arquivo(jpegDe(300, 200), 'image/jpeg'))).toMatchObject({ ok: true, largura: 300, altura: 200 });
    expect(dimensoesDoPng(pngDe(64, 48))).toEqual({ ok: true, largura: 64, altura: 48 });
    expect(dimensoesDoWebp(webpLosslessDe(256, 128))).toEqual({ ok: true, largura: 256, altura: 128 });
    expect(dimensoesDoWebp(webpVp8xDe(500, 400))).toEqual({ ok: true, largura: 500, altura: 400 });
    expect(dimensoesDoWebp(webpLossyDe(320, 240))).toEqual({ ok: true, largura: 320, altura: 240 });
  });

  it('animação é recusada (APNG e WebP animado)', () => {
    expect(conferirFotoDePerfil(arquivo(pngDe(64, 64, 0, true)))).toEqual({ ok: false, motivo: 'PNG animado não serve de foto de perfil.' });
    expect(conferirFotoDePerfil(arquivo(webpVp8xDe(64, 64, true), 'image/webp'))).toEqual({ ok: false, motivo: 'WebP animado não serve de foto de perfil.' });
  });
});

describe('tamanho e lado', () => {
  it('lado acima de 512 px é recusado com a instrução de enviar pela tela (o servidor não redimensiona)', () => {
    const r = conferirFotoDePerfil(arquivo(pngDe(1024, 768)));
    expect(r).toMatchObject({ ok: false, motivo: expect.stringContaining('máximo é 512 px') });
    expect(conferirFotoDePerfil(arquivo(pngDe(512, 512)))).toMatchObject({ ok: true });
    expect(conferirFotoDePerfil(arquivo(pngDe(8, 8)))).toMatchObject({ ok: false, motivo: expect.stringContaining('mínimo') });
  });

  it('mais de 2 MB no envio é recusado; mais de 256 KB guardados também', () => {
    const grande = pngDe(256, 256, PERFIL_FOTO_MAX_BYTES_DO_ENVIO);
    expect(conferirFotoDePerfil(arquivo(grande))).toEqual({ ok: false, motivo: 'A foto passa de 2 MB.' });
    const medio = pngDe(256, 256, PERFIL_FOTO_MAX_BYTES_GUARDADOS);
    expect(conferirFotoDePerfil(arquivo(medio))).toMatchObject({ ok: false, motivo: expect.stringContaining('256 KB') });
  });

  it('a foto aceita leva o sha256 e o tamanho real', () => {
    const b = jpegDe(256, 256);
    const r = conferirFotoDePerfil(arquivo(b, 'image/jpeg'));
    expect(r).toMatchObject({ ok: true, tamanho: b.length, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it('sem arquivo, a frase diz o campo', () => {
    expect(conferirFotoDePerfil(undefined)).toEqual({ ok: false, motivo: 'Envie a foto no campo "file".' });
  });
});

describe('servir a foto', () => {
  it('tipo conferido, nosniff, inline, CSP fechada e cache privado', () => {
    const h = cabecalhosDaFoto('webp', 1234);
    expect(h['Content-Type']).toBe('image/webp');
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Content-Disposition']).toMatch(/^inline;/);
    expect(h['Content-Security-Policy']).toContain("default-src 'none'");
    expect(h['Content-Security-Policy']).toContain('sandbox');
    expect(h['Content-Length']).toBe('1234');
    expect(h['Cache-Control']).toMatch(/^private/);
  });

  it('a rota da foto muda com o sha256', () => {
    expect(rotaDaFoto('u-1', 'a'.repeat(64))).toBe('/perfil/u-1/foto?v=aaaaaaaaaaaa');
  });
});

describe('o cadastro', () => {
  it('fuso IANA e data de nascimento conferidos', () => {
    expect(fusoValido('America/Sao_Paulo')).toBe(true);
    expect(fusoValido('Lua/Mar_da_Tranquilidade')).toBe(false);
    expect(fusoValido('../etc')).toBe(false);
    expect(dataDeNascimentoValida('1990-02-29')).toBe(false);
    expect(dataDeNascimentoValida('1992-02-29')).toBe(true);
    expect(dataDeNascimentoValida('2999-01-01')).toBe(false);
    expect(PerfilUpdateSchema.safeParse({ esperado: 'x', fuso: 'Nada/Nada' }).success).toBe(false);
    expect(PerfilUpdateSchema.safeParse({ esperado: 'x', nomeNoVault: '../Alice' }).success).toBe(false);
    expect(PerfilUpdateSchema.safeParse({ esperado: 'x', papel: 'admin' }).success).toBe(false);
    expect(PerfilUpdateSchema.parse({ esperado: 'x', cargo: '  Sócia  ' }).cargo).toBe('Sócia');
  });

  it('aniversário é só dia e mês; 29/02 comemora no 28 em ano comum', () => {
    expect(aniversarioDaData('1988-03-12')).toBe('03-12');
    const pessoas = [{ id: 'a', aniversario: '03-12' }, { id: 'b', aniversario: '02-29' }, { id: 'c', aniversario: null }];
    expect(aniversariantesDoDia(pessoas, new Date('2026-03-12T15:00:00Z')).map((p) => p.id)).toEqual(['a']);
    expect(aniversariantesDoDia(pessoas, new Date('2026-02-28T15:00:00Z')).map((p) => p.id)).toEqual(['b']);
    // 00:30 de 13/03 em UTC ainda é 12/03 em São Paulo.
    expect(aniversariantesDoDia(pessoas, new Date('2026-03-13T00:30:00Z')).map((p) => p.id)).toEqual(['a']);
  });

  it('iniciais e a sugestão do nome no vault (dúvida fica nula)', () => {
    expect(iniciaisDoNome('Alice Fictícia da Silva')).toBe('AS');
    expect(iniciaisDoNome('bruno')).toBe('B');
    expect(iniciaisDoNome('   ')).toBe('?');
    expect(sugerirNomeNoVault('Alice Exemplo', ['Alice', 'Bruno'], ['Alice Exemplo', 'Bruno Exemplo'])).toBe('Alice');
    // Duas pessoas com o mesmo primeiro nome: [a decidir].
    expect(sugerirNomeNoVault('Bruno Um', ['Alice', 'Bruno'], ['Bruno Um', 'Bruno Dois'])).toBeNull();
    // Sem sócio com o primeiro nome: [a decidir].
    expect(sugerirNomeNoVault('Davi Exemplo', ['Alice', 'Bruno'], ['Davi Exemplo'])).toBeNull();
  });
});
