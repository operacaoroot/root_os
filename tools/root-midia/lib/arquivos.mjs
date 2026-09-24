// @ts-check
/*
 * A trava do bruto. Comparar o caminho como texto não basta: o APFS do Mac não
 * diferencia maiúscula de minúscula e um link simbólico dá outro nome ao mesmo
 * arquivo — e o `-y` do ffmpeg truncaria a gravação enquanto a lê.
 */

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Os dois caminhos são o MESMO arquivo no disco (mesmo dispositivo e inode)?
 * @param {string} a
 * @param {string} b
 */
export function mesmoArquivo(a, b) {
  if (resolve(a) === resolve(b)) return true;
  if (!existsSync(a) || !existsSync(b)) return false;
  const x = statSync(a);
  const y = statSync(b);
  return x.dev === y.dev && x.ino === y.ino;
}
