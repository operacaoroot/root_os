import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/*
 * A VAULT DE TESTE, VERSIONADA (ROOT-20).
 *
 * Desde a ROOT-20 só pertence à coleção `vault:` o `.md` que o git rastreia, com
 * os bytes do blob (C19-03), e uma pasta sem `.git` é "rastreamento não
 * verificável": a volta não escreve nada. Toda suíte que reindexa uma vault de
 * mentira passa por aqui depois de escrever os arquivos — é o equivalente ao
 * `pull` que traz o commit para a pasta da VPS.
 *
 * O GIT DA SUÍTE NÃO LÊ A CONFIGURAÇÃO DA MÁQUINA (`GIT_CONFIG_GLOBAL=/dev/null`,
 * `GIT_CONFIG_NOSYSTEM=1`): um `core.autocrlf` ou um gancho de commit de quem
 * roda a suíte mudaria o blob gravado ou o próprio commit. `core.autocrlf=false`
 * e `core.precomposeunicode=false` ficam no repositório, como no clone da VPS
 * (Linux, sem conversão): no macOS o git ligaria o segundo sozinho e gravaria
 * em NFC um nome que o disco guarda em NFD.
 *
 * Este arquivo NÃO termina em `.test.ts` — ver a nota em `banco-de-teste.ts`.
 */

export function git(raiz: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=Suite', '-c', 'user.email=suite@teste.local', '-c', 'commit.gpgsign=false', ...args],
    {
      cwd: raiz,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
    },
  );
}

/** Inicia o repositório se preciso. */
export function iniciarGit(raiz: string): void {
  if (existsSync(join(raiz, '.git'))) return;
  git(raiz, 'init', '-q', '-b', 'main');
  git(raiz, 'config', 'core.autocrlf', 'false');
  git(raiz, 'config', 'core.precomposeunicode', 'false');
}

/** Versiona TUDO o que está na pasta, num commit. */
export function versionarVault(raiz: string, mensagem = 'volta da suíte'): void {
  iniciarGit(raiz);
  git(raiz, 'add', '-A');
  git(raiz, 'commit', '-q', '--allow-empty', '-m', mensagem);
}
