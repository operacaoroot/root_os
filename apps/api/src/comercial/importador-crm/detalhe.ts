import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * O arquivo de `--detalhe` do importador tem título e nome de cliente: nunca dentro de um
 * repositório git (rodada de produção 1). Sobe a árvore a partir da pasta do arquivo
 * procurando `.git` (pasta ou, num worktree, arquivo).
 */
export function dentroDeGit(arquivo: string): boolean {
  let dir = path.dirname(path.resolve(arquivo));
  for (;;) {
    if (existsSync(path.join(dir, '.git'))) return true;
    const pai = path.dirname(dir);
    if (pai === dir) return false;
    dir = pai;
  }
}
