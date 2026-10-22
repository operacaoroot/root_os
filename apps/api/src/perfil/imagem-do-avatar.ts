import { createHash } from 'node:crypto';
import {
  MIME_DA_FOTO,
  PERFIL_FOTO_LADO_MAXIMO,
  PERFIL_FOTO_LADO_MINIMO,
  PERFIL_FOTO_MAX_BYTES_DO_ENVIO,
  PERFIL_FOTO_MAX_BYTES_GUARDADOS,
  type TipoDaFoto,
} from '@mktos/shared';
import { dimensoesDoJpeg } from '../pauta/imagem-jpeg';

/*
 * A FOTO DE PERFIL, CONFERIDA PELOS BYTES (produção 22B, I6).
 *
 * O tipo NUNCA vem do nome nem do `Content-Type` que o navegador declarou: vem
 * da assinatura do arquivo. Só três formatos passam:
 *
 *   · JPEG  FF D8 FF, tamanho do marcador SOF (o leitor da pauta, `imagem-jpeg.ts`);
 *   · PNG   89 50 4E 47 0D 0A 1A 0A + IHDR (largura e altura nos bytes 16 a 23);
 *           PNG animado (chunk `acTL` antes do IDAT) é recusado;
 *   · WebP  RIFF....WEBP com VP8 (com perda), VP8L (sem perda) ou VP8X
 *           (estendido); WebP animado (bit de animação do VP8X) é recusado.
 *
 * SVG, GIF, HEIC, BMP, PDF e qualquer outra coisa ficam de fora porque não
 * casam assinatura nenhuma: SVG é texto e pode carregar script, e a regra é
 * nunca servir conteúdo que o navegador execute.
 *
 * NÃO HÁ REDIMENSIONAMENTO NO SERVIDOR: o repositório não tem biblioteca de
 * imagem e dependência nova é decisão humana ([a decidir]). A tela reduz a
 * 256 px num canvas antes de enviar (o que também tira os metadados, como o
 * GPS de uma foto de celular); o servidor confere o lado (16 a 512 px) e o
 * tamanho guardado (até 256 KB) e recusa o resto com a frase do que fazer.
 */

export type FotoConferida =
  | { ok: true; tipo: TipoDaFoto; mime: string; largura: number; altura: number; tamanho: number; sha256: string; conteudo: Buffer }
  | { ok: false; motivo: string };

const ASSINATURA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** O tipo pela assinatura dos bytes, ou nulo. */
export function tipoPelaAssinatura(b: Buffer): TipoDaFoto | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && ASSINATURA_PNG.every((x, i) => b[i] === x)) return 'png';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

type Dimensoes = { ok: true; largura: number; altura: number } | { ok: false; motivo: string };

/** Largura e altura do IHDR; recusa o PNG animado (APNG). */
export function dimensoesDoPng(b: Buffer): Dimensoes {
  if (b.length < 33 || !ASSINATURA_PNG.every((x, i) => b[i] === x) || b.toString('latin1', 12, 16) !== 'IHDR') {
    return { ok: false, motivo: 'O PNG está corrompido (sem o cabeçalho IHDR).' };
  }
  const largura = b.readUInt32BE(16);
  const altura = b.readUInt32BE(20);
  // Os chunks até o primeiro IDAT: o `acTL` de um PNG animado vem antes dele.
  let i = 8;
  while (i + 8 <= b.length) {
    const comprimento = b.readUInt32BE(i);
    const tipo = b.toString('latin1', i + 4, i + 8);
    if (tipo === 'acTL') return { ok: false, motivo: 'PNG animado não serve de foto de perfil.' };
    if (tipo === 'IDAT' || tipo === 'IEND') break;
    if (comprimento > b.length) break;
    i += 12 + comprimento;
  }
  if (!largura || !altura) return { ok: false, motivo: 'O PNG não declara o tamanho.' };
  return { ok: true, largura, altura };
}

/** Largura e altura do primeiro chunk do WebP (VP8, VP8L ou VP8X); recusa o animado. */
export function dimensoesDoWebp(b: Buffer): Dimensoes {
  if (b.length < 30) return { ok: false, motivo: 'O WebP está corrompido (curto demais).' };
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') {
    // Quadro-chave: 3 bytes de cabeçalho, a marca 9D 01 2A, e 14 bits de largura e de altura.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return { ok: false, motivo: 'O WebP está corrompido (quadro sem a marca).' };
    return dimensoesValidas(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return { ok: false, motivo: 'O WebP está corrompido (sem a assinatura do VP8L).' };
    const bits = b.readUInt32LE(21);
    return dimensoesValidas((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (chunk === 'VP8X') {
    const flags = b[20];
    if (flags & 0x02) return { ok: false, motivo: 'WebP animado não serve de foto de perfil.' };
    const largura = (b[24] | (b[25] << 8) | (b[26] << 16)) + 1;
    const altura = (b[27] | (b[28] << 8) | (b[29] << 16)) + 1;
    return dimensoesValidas(largura, altura);
  }
  return { ok: false, motivo: 'O WebP usa um formato que esta tela não lê.' };
}

function dimensoesValidas(largura: number, altura: number): Dimensoes {
  if (!largura || !altura) return { ok: false, motivo: 'A imagem não declara o tamanho.' };
  return { ok: true, largura, altura };
}

/**
 * A conferência inteira da foto que chegou. O `mimetype` declarado não decide
 * nada: só serve para a frase, quando ele diz SVG.
 */
export function conferirFotoDePerfil(arquivo: { buffer: Buffer; mimetype?: string; size?: number } | undefined): FotoConferida {
  if (!arquivo || !arquivo.buffer?.length) return { ok: false, motivo: 'Envie a foto no campo "file".' };
  const b = arquivo.buffer;
  const tamanho = Math.max(arquivo.size ?? 0, b.length);
  if (tamanho > PERFIL_FOTO_MAX_BYTES_DO_ENVIO) return { ok: false, motivo: 'A foto passa de 2 MB.' };
  const tipo = tipoPelaAssinatura(b);
  if (!tipo) {
    const svg = /svg/i.test(arquivo.mimetype ?? '') || /^\s*(<\?xml|<svg)/i.test(b.toString('utf8', 0, Math.min(b.length, 256)));
    return {
      ok: false,
      motivo: svg ? 'SVG não serve de foto de perfil. Envie JPG, PNG ou WebP.' : 'O arquivo não é JPG, PNG nem WebP (conferido pelos bytes).',
    };
  }
  const d = tipo === 'jpeg' ? dimensoesDoJpegDoAvatar(b) : tipo === 'png' ? dimensoesDoPng(b) : dimensoesDoWebp(b);
  if (!d.ok) return d;
  if (d.largura > PERFIL_FOTO_LADO_MAXIMO || d.altura > PERFIL_FOTO_LADO_MAXIMO) {
    return {
      ok: false,
      motivo: `A foto tem ${d.largura}×${d.altura} px; o máximo é ${PERFIL_FOTO_LADO_MAXIMO} px de lado. Envie pela tela do perfil, que reduz antes de enviar.`,
    };
  }
  if (d.largura < PERFIL_FOTO_LADO_MINIMO || d.altura < PERFIL_FOTO_LADO_MINIMO) {
    return { ok: false, motivo: `A foto tem ${d.largura}×${d.altura} px; o mínimo é ${PERFIL_FOTO_LADO_MINIMO} px de lado.` };
  }
  // O que se guarda é a imagem SEM metadados: o envio direto pela API (sem o canvas da
  // tela) traria o EXIF de uma foto de celular, com o GPS de onde ela foi tirada.
  const limpo = semMetadados(tipo, b);
  if (limpo.length > PERFIL_FOTO_MAX_BYTES_GUARDADOS) {
    return { ok: false, motivo: 'A foto passa de 256 KB. Envie pela tela do perfil, que reduz antes de enviar.' };
  }
  return {
    ok: true,
    tipo,
    mime: MIME_DA_FOTO[tipo],
    largura: d.largura,
    altura: d.altura,
    tamanho: limpo.length,
    sha256: createHash('sha256').update(limpo).digest('hex'),
    conteudo: limpo,
  };
}

/*
 * Os metadados saem antes de guardar (revisão do orquestrador, produção 22B).
 * Sem biblioteca: só se tiram blocos inteiros que o decodificador ignora.
 *   · JPEG: APP1 (EXIF e XMP), APP13 (IPTC) e COM, até o SOS; o resto fica (APP0,
 *     APP2 com o perfil de cor, APP14 da Adobe, tabelas e o quadro).
 *   · PNG: eXIf, tEXt, zTXt, iTXt e tIME.
 *   · WebP: os chunks EXIF e XMP, com os bits do VP8X e o tamanho do RIFF acertados.
 * Arquivo que não se deixa percorrer volta como veio: a conferência de cima já
 * recusou o que não é imagem, e o erro é para o lado de guardar a foto.
 */
export function semMetadados(tipo: TipoDaFoto, b: Buffer): Buffer {
  try {
    if (tipo === 'jpeg') return jpegSemMetadados(b);
    if (tipo === 'png') return pngSemMetadados(b);
    return webpSemMetadados(b);
  } catch {
    return b;
  }
}

function jpegSemMetadados(b: Buffer): Buffer {
  const partes: Buffer[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return b;
    const marca = b[i + 1];
    if (marca === 0xff) { i += 1; continue; }
    if (marca === 0xda || marca === 0xd9) { partes.push(b.subarray(i)); return Buffer.concat(partes); }
    if (marca === 0xd8 || (marca >= 0xd0 && marca <= 0xd7) || marca === 0x01) { partes.push(b.subarray(i, i + 2)); i += 2; continue; }
    const fim = i + 2 + b.readUInt16BE(i + 2);
    if (fim > b.length) return b;
    if (!(marca === 0xe1 || marca === 0xed || marca === 0xfe)) partes.push(b.subarray(i, fim));
    i = fim;
  }
  return b;
}

const CHUNKS_DE_TEXTO_DO_PNG = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

function pngSemMetadados(b: Buffer): Buffer {
  const partes: Buffer[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const fim = i + 12 + b.readUInt32BE(i);
    if (fim > b.length) return b;
    const tipo = b.toString('latin1', i + 4, i + 8);
    if (!CHUNKS_DE_TEXTO_DO_PNG.has(tipo)) partes.push(b.subarray(i, fim));
    i = fim;
    if (tipo === 'IEND') return Buffer.concat(partes);
  }
  return b;
}

function webpSemMetadados(b: Buffer): Buffer {
  const partes: Buffer[] = [];
  let i = 12;
  let tirou = false;
  while (i + 8 <= b.length) {
    const tamanho = b.readUInt32LE(i + 4);
    const fim = i + 8 + tamanho + (tamanho % 2);
    if (fim > b.length) return b;
    const tipo = b.toString('latin1', i, i + 4);
    if (tipo === 'EXIF' || tipo === 'XMP ') tirou = true;
    else partes.push(Buffer.from(b.subarray(i, fim)));
    i = fim;
  }
  if (!tirou) return b;
  const vp8x = partes.find((p) => p.toString('latin1', 0, 4) === 'VP8X');
  if (vp8x) vp8x[8] &= ~0x0c;
  const corpo = Buffer.concat(partes);
  const cabecalho = Buffer.alloc(12);
  cabecalho.write('RIFF', 0, 'latin1');
  cabecalho.writeUInt32LE(corpo.length + 4, 4);
  cabecalho.write('WEBP', 8, 'latin1');
  return Buffer.concat([cabecalho, corpo]);
}

/** O leitor do JPEG da pauta, com a frase do perfil (a da pauta fala da Meta). */
function dimensoesDoJpegDoAvatar(b: Buffer): Dimensoes {
  const d = dimensoesDoJpeg(b);
  if (d.ok) return d;
  if (d.motivo.includes('Meta')) return { ok: false, motivo: 'O JPEG usa uma codificação rara: salve como JPG comum ou PNG.' };
  return d;
}

/**
 * Os cabeçalhos de quem serve a foto: o tipo CONFERIDO (nunca o declarado no
 * envio), `nosniff` para o navegador não adivinhar outro, `inline`, uma CSP que
 * não deixa nada rodar nem carregar, e cache só privado.
 */
export function cabecalhosDaFoto(tipo: TipoDaFoto, tamanho: number): Record<string, string> {
  return {
    'Content-Type': MIME_DA_FOTO[tipo],
    'Content-Length': String(tamanho),
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `inline; filename="foto.${tipo === 'jpeg' ? 'jpg' : tipo}"`,
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'private, max-age=300',
  };
}
