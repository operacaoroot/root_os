import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { NotaDoVaultLida } from '../src/agents/atribuicoes-do-vault';

/*
 * Dublês do perfil e da Equipe (produção 22B, I6): imagens mínimas montadas
 * byte a byte (só o cabeçalho que o servidor lê) e as notas do vault-dublê
 * (`homolog/fixtures/vault-equipe/`, a mesma pasta que a homologação copia).
 */

export function pngDe(largura: number, altura: number, extra = 0, animado = false): Buffer {
  const assinatura = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (tipo: string, dados: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(dados.length);
    return Buffer.concat([len, Buffer.from(tipo, 'latin1'), dados, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const partes = [assinatura, chunk('IHDR', ihdr)];
  if (animado) partes.push(chunk('acTL', Buffer.alloc(8)));
  partes.push(chunk('IDAT', Buffer.alloc(extra)), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(partes);
}

export function jpegDe(largura: number, altura: number): Buffer {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  sof.writeUInt16BE(altura, 5);
  sof.writeUInt16BE(largura, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46]), sof, Buffer.from([0xff, 0xd9])]);
}

function webpBase(chunk: string): Buffer {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(32, 4);
  b.write('WEBP', 8, 'latin1');
  b.write(chunk, 12, 'latin1');
  b.writeUInt32LE(20, 16);
  return b;
}

export function webpLosslessDe(largura: number, altura: number): Buffer {
  const b = webpBase('VP8L');
  b[20] = 0x2f;
  b.writeUInt32LE(((largura - 1) & 0x3fff) | (((altura - 1) & 0x3fff) << 14), 21);
  return b;
}

export function webpVp8xDe(largura: number, altura: number, animado = false): Buffer {
  const b = webpBase('VP8X');
  b[20] = animado ? 0x02 : 0;
  b.writeUIntLE(largura - 1, 24, 3);
  b.writeUIntLE(altura - 1, 27, 3);
  return b;
}

export function webpLossyDe(largura: number, altura: number): Buffer {
  const b = webpBase('VP8 ');
  b[23] = 0x9d;
  b[24] = 0x01;
  b[25] = 0x2a;
  b.writeUInt16LE(largura, 26);
  b.writeUInt16LE(altura, 28);
  return b;
}

const RAIZ_DO_DUBLE = join(__dirname, '..', '..', '..', 'homolog', 'fixtures', 'vault-equipe');

/** As notas do vault-dublê, com o caminho relativo à raiz do vault. */
export function notasDoDuble(): NotaDoVaultLida[] {
  const out: NotaDoVaultLida[] = [];
  const descer = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) descer(p);
      else if (e.name.endsWith('.md')) {
        const caminho = relative(RAIZ_DO_DUBLE, p).replace(/\\/g, '/');
        out.push({ caminho, conteudo: readFileSync(p, 'utf8'), notaId: `nota:${caminho}` });
      }
    }
  };
  descer(RAIZ_DO_DUBLE);
  return out;
}
