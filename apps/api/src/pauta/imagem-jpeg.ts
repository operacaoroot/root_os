import {
  PAUTA_JPEG_DA_PECA_MAX_BYTES,
  PAUTA_JPEG_LARGURA_MAXIMA,
  PAUTA_JPEG_LARGURA_MINIMA,
} from '@mktos/shared';

/*
 * O JPEG DA PEÇA (MD4) — a mídia que a Graph da Meta aceita.
 *
 * A Meta baixa a imagem de uma URL pública e só aceita JPEG, até 8 MB, com a
 * largura entre 320 e 1440 px. O Mac converte o PNG do render com o `sips` e
 * sobe os dois: o PNG continua sendo a prévia da tela e o JPEG é o que sai.
 *
 * A leitura é do cabeçalho, sem decodificar a imagem: a assinatura FFD8FF e o
 * marcador de início de quadro (SOF0 baseline, SOF1 sequencial estendido ou
 * SOF2 progressivo), que traz altura e largura. Outros SOF (sem perda,
 * aritmético, hierárquico) são raros e a Meta não promete aceitar: recusados.
 */

const SOF_ACEITOS = new Set([0xc0, 0xc1, 0xc2]);
const SOF_TODOS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
/** Marcadores sem comprimento: TEM, RST0–RST7, SOI, EOI. */
const SEM_COMPRIMENTO = (m: number) => m === 0x01 || (m >= 0xd0 && m <= 0xd9);

export type DimensoesDoJpeg = { ok: true; largura: number; altura: number } | { ok: false; motivo: string };

/** Largura e altura lidas do marcador SOF, sem decodificar a imagem. */
export function dimensoesDoJpeg(b: Buffer): DimensoesDoJpeg {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) {
    return { ok: false, motivo: 'O arquivo não é um JPEG (a assinatura não bate).' };
  }
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return { ok: false, motivo: 'O JPEG está corrompido (marcador fora do lugar).' };
    while (i < b.length && b[i] === 0xff) i++;
    if (i >= b.length) break;
    const m = b[i++];
    if (SEM_COMPRIMENTO(m)) {
      if (m === 0xd9) break;
      continue;
    }
    if (i + 2 > b.length) break;
    const comprimento = b.readUInt16BE(i);
    if (comprimento < 2 || i + comprimento > b.length) return { ok: false, motivo: 'O JPEG está corrompido (segmento cortado).' };
    if (SOF_TODOS.has(m)) {
      if (!SOF_ACEITOS.has(m)) return { ok: false, motivo: 'O JPEG usa uma codificação que a Meta não aceita: gere baseline ou progressivo.' };
      if (comprimento < 8) return { ok: false, motivo: 'O JPEG está corrompido (quadro sem tamanho).' };
      const altura = b.readUInt16BE(i + 3);
      const largura = b.readUInt16BE(i + 5);
      if (!largura || !altura) return { ok: false, motivo: 'O JPEG não declara o tamanho do quadro.' };
      return { ok: true, largura, altura };
    }
    // Os dados da imagem começam no SOS: sem SOF antes dele, não há tamanho a ler.
    if (m === 0xda) break;
    i += comprimento;
  }
  return { ok: false, motivo: 'O JPEG não tem o marcador de tamanho (SOF) antes dos dados.' };
}

/**
 * O JPEG que o Mac converteu para a peça: assinatura, até 8 MB, largura de 320
 * a 1440 e a proporção do formato (carrossel 4:5, story 9:16) — com 1% de folga,
 * porque 1440 de largura em 9:16 dá 2560 exatos, mas 1350 dá 2400.
 */
export function conferirJpegDaPeca(
  arquivo: { buffer: Buffer; mimetype: string; size?: number } | undefined,
  proporcao: { largura: number; altura: number },
  tetoBytes = PAUTA_JPEG_DA_PECA_MAX_BYTES,
): { ok: true; largura: number; altura: number } | { ok: false; motivo: string } {
  if (!arquivo) return { ok: false, motivo: 'Envie o JPEG no campo "file".' };
  if (arquivo.mimetype !== 'image/jpeg') return { ok: false, motivo: `Esperava JPEG (veio ${arquivo.mimetype || 'sem tipo'}).` };
  const tamanho = Math.max(arquivo.size ?? 0, arquivo.buffer.length);
  if (tamanho > tetoBytes) return { ok: false, motivo: `O JPEG passa de ${Math.round(tetoBytes / 1024 / 1024)} MB.` };
  const d = dimensoesDoJpeg(arquivo.buffer);
  if (!d.ok) return d;
  if (d.largura < PAUTA_JPEG_LARGURA_MINIMA || d.largura > PAUTA_JPEG_LARGURA_MAXIMA) {
    return { ok: false, motivo: `O JPEG tem ${d.largura} px de largura; a Meta aceita de ${PAUTA_JPEG_LARGURA_MINIMA} a ${PAUTA_JPEG_LARGURA_MAXIMA}.` };
  }
  const esperada = (d.largura * proporcao.altura) / proporcao.largura;
  if (Math.abs(d.altura - esperada) > esperada * 0.01) {
    return {
      ok: false,
      motivo: `O JPEG tem ${d.largura}×${d.altura}; este formato é ${proporcao.largura}×${proporcao.altura} (a mesma proporção).`,
    };
  }
  return { ok: true, largura: d.largura, altura: d.altura };
}
