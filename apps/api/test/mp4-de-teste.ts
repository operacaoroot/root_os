import { createHash } from 'node:crypto';

/*
 * Um mp4 mínimo, montado caixa por caixa, para as suítes da MD4: `ftyp`, `moov`
 * (com `mvhd` para a duração e um `trak/tkhd` para o tamanho) e `mdat` com
 * bytes de enchimento. Não toca vídeo nenhum — é o que a conferência lê.
 */

export function caixa(tipo: string, corpo: Buffer): Buffer {
  const cab = Buffer.alloc(8);
  cab.writeUInt32BE(8 + corpo.length, 0);
  cab.write(tipo, 4, 'latin1');
  return Buffer.concat([cab, corpo]);
}

function mvhd(duracaoSeg: number): Buffer {
  const c = Buffer.alloc(100);
  c.writeUInt32BE(1000, 12);
  c.writeUInt32BE(Math.round(duracaoSeg * 1000), 16);
  return caixa('mvhd', c);
}

function tkhd(largura: number, altura: number): Buffer {
  const c = Buffer.alloc(84);
  c.writeUInt32BE((largura << 16) >>> 0, 76);
  c.writeUInt32BE((altura << 16) >>> 0, 80);
  return caixa('tkhd', c);
}

export function mp4DeTeste(o: { duracaoSeg?: number; largura?: number; altura?: number; faststart?: boolean; mdat?: number } = {}): Buffer {
  const ftyp = caixa('ftyp', Buffer.from('isom\0\0\x02\0isomiso2avc1mp41', 'latin1'));
  const moov = caixa('moov', Buffer.concat([mvhd(o.duracaoSeg ?? 60), caixa('trak', tkhd(o.largura ?? 1080, o.altura ?? 1920))]));
  const mdat = caixa('mdat', Buffer.alloc(o.mdat ?? 4096, 7));
  return Buffer.concat(o.faststart === false ? [ftyp, mdat, moov] : [ftyp, moov, mdat]);
}

export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Um JPEG mínimo: SOI, um APP0 e o SOF0 com o tamanho pedido, e o EOI. Só o cabeçalho importa. */
export function jpegDeTeste(largura: number, altura: number, o: { sof?: number; total?: number } = {}): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.alloc(19);
  sof[0] = 0xff;
  sof[1] = o.sof ?? 0xc0;
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(altura, 5);
  sof.writeUInt16BE(largura, 7);
  sof[9] = 3;
  const corpo = Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xda, 0x00, 0x02]), Buffer.alloc(Math.max(0, (o.total ?? 64) - 45), 0x11), Buffer.from([0xff, 0xd9])]);
  return corpo;
}
