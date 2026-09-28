// @ts-check
/*
 * A trava do bruto. Comparar o caminho como texto não basta: o APFS do Mac não
 * diferencia maiúscula de minúscula e um link simbólico dá outro nome ao mesmo
 * arquivo — e o `-y` do ffmpeg truncaria a gravação enquanto a lê.
 */

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

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

/**
 * A pasta de um `--saida` existe (criada se preciso) ANTES do trabalho longo:
 * sem isso o whisper roda minutos num bruto de 10 min e a transcrição se perde
 * no ENOENT da gravação. Criar é dito em voz alta, com o caminho absoluto: um
 * caminho relativo no diretório errado (a pasta do Drive) aparece na hora.
 * Devolve o caminho absoluto da saída.
 * @param {string} saida
 * @param {(m: string) => void} [avisar]
 */
export function garantirPastaDaSaida(saida, avisar) {
  const absoluto = resolve(saida);
  const pasta = dirname(absoluto);
  if (!existsSync(pasta)) {
    mkdirSync(pasta, { recursive: true });
    avisar?.(`Criei a pasta ${pasta}.`);
  }
  return absoluto;
}
