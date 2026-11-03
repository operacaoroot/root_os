import { deflateSync, inflateSync } from 'node:zlib';

/*
 * O PNG DO LOGO PARA DENTRO DO PDF (Contratos, F2, 02/11/2026) — puro.
 *
 * Lê os chunks (IHDR, IDAT, IEND), descomprime, desfaz os filtros de linha e separa o RGBA em
 * duas imagens: RGB e canal alfa, que no PDF vira `SMask`. Só o formato do logo oficial:
 * 8 bits, RGBA, sem entrelaçamento. Qualquer outro lança: o contrato não sai com timbre torto.
 */

const ASSINATURA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PngSeparado {
  largura: number;
  altura: number;
  /** largura × altura × 3 bytes. */
  rgb: Buffer;
  /** largura × altura bytes. */
  alfa: Buffer;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function lerPng(png: Buffer): PngSeparado {
  if (png.length < 33 || !png.subarray(0, 8).equals(ASSINATURA)) throw new Error('o arquivo não é um PNG');
  let largura = 0;
  let altura = 0;
  const idat: Buffer[] = [];
  for (let p = 8; p + 8 <= png.length; ) {
    const tamanho = png.readUInt32BE(p);
    const tipo = png.toString('latin1', p + 4, p + 8);
    const dados = png.subarray(p + 8, p + 8 + tamanho);
    if (tipo === 'IHDR') {
      largura = dados.readUInt32BE(0);
      altura = dados.readUInt32BE(4);
      if (dados[8] !== 8 || dados[9] !== 6 || dados[12] !== 0) throw new Error('o PNG precisa ser RGBA de 8 bits, sem entrelaçamento');
    } else if (tipo === 'IDAT') {
      idat.push(dados);
    } else if (tipo === 'IEND') {
      break;
    }
    p += 12 + tamanho;
  }
  if (!largura || !altura || !idat.length) throw new Error('o PNG não tem IHDR ou IDAT');

  const filtrado = inflateSync(Buffer.concat(idat));
  const passo = largura * 4;
  if (filtrado.length !== (passo + 1) * altura) throw new Error('o PNG tem tamanho de dados diferente do IHDR');

  const rgb = Buffer.alloc(largura * altura * 3);
  const alfa = Buffer.alloc(largura * altura);
  let anterior = Buffer.alloc(passo);
  let linha = Buffer.alloc(passo);
  for (let y = 0; y < altura; y++) {
    const inicio = y * (passo + 1);
    const filtro = filtrado[inicio];
    if (filtro > 4) throw new Error(`o PNG tem filtro de linha inválido: ${filtro}`);
    for (let x = 0; x < passo; x++) {
      const bruto = filtrado[inicio + 1 + x];
      const a = x >= 4 ? linha[x - 4] : 0;
      const b = anterior[x];
      const c = x >= 4 ? anterior[x - 4] : 0;
      const predito = filtro === 0 ? 0 : filtro === 1 ? a : filtro === 2 ? b : filtro === 3 ? (a + b) >> 1 : paeth(a, b, c);
      linha[x] = (bruto + predito) & 0xff;
    }
    for (let x = 0; x < largura; x++) {
      const i = y * largura + x;
      rgb[i * 3] = linha[x * 4];
      rgb[i * 3 + 1] = linha[x * 4 + 1];
      rgb[i * 3 + 2] = linha[x * 4 + 2];
      alfa[i] = linha[x * 4 + 3];
    }
    [anterior, linha] = [linha, anterior];
  }
  return { largura, altura, rgb, alfa };
}

/** O logo pronto para o PDF: as duas imagens comprimidas com zlib (`FlateDecode`). */
export interface ImagemDoPdf {
  largura: number;
  altura: number;
  rgbZ: Buffer;
  alfaZ: Buffer;
}

export function imagemDoPng(png: Buffer): ImagemDoPdf {
  const { largura, altura, rgb, alfa } = lerPng(png);
  return { largura, altura, rgbZ: deflateSync(rgb, { level: 9 }), alfaZ: deflateSync(alfa, { level: 9 }) };
}
