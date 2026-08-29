#!/usr/bin/env node
/*
 * Sobe o artefato COMPILADO e confere que a aplicação inicia.
 *
 * Existe porque em 29/08/2026 a produção caiu por dois minutos com
 * `tsc --noEmit` limpo e 130 testes verdes: o AgentsModule injetava serviços
 * que os módulos donos não exportavam. TypeScript não enxerga o grafo de
 * injeção do Nest.
 *
 * E não dá para cobrir isso com vitest: o esbuild não emite
 * `emitDecoratorMetadata`, então o Nest não resolve NADA por tipo lá dentro —
 * o teste passaria verde por outro motivo, que é pior que não existir.
 *
 * Então o teste é o boot de verdade, do dist de verdade. Se o Nest não subir,
 * isto falha aqui em vez de falhar no deploy.
 *
 *   DATABASE_URL=<banco de teste> pnpm --filter @mktos/api smoke
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const ENTRY = 'dist/main.js';
const LIMITE_MS = 45_000;
const SINAL = 'Nest application successfully started';

if (!existsSync(ENTRY)) {
  console.error(`${ENTRY} não existe — rode o build antes.`);
  process.exit(1);
}

const filho = spawn(process.execPath, [ENTRY], {
  env: { ...process.env, API_PORT: process.env.SMOKE_PORT ?? '4099' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let decidido = false;

const encerrar = (codigo, mensagem) => {
  if (decidido) return;
  decidido = true;
  clearTimeout(prazo);
  filho.kill('SIGTERM');
  setTimeout(() => filho.kill('SIGKILL'), 3000).unref();
  console.log(mensagem);
  process.exit(codigo);
};

const olhar = (chunk) => {
  const texto = String(chunk);
  process.stdout.write(texto);
  if (texto.includes(SINAL)) encerrar(0, '\nSMOKE OK — a aplicação subiu.');
  // O Nest imprime o erro de injeção e SÓ DEPOIS morre. Pegar na hora dá
  // mensagem melhor do que esperar o exit.
  if (/Nest can't resolve dependencies|ExceptionHandler/.test(texto)) {
    encerrar(1, '\nSMOKE FALHOU — o grafo de injeção não resolve. É o que derruba o deploy.');
  }
};

filho.stdout.on('data', olhar);
filho.stderr.on('data', olhar);

filho.on('exit', (codigo) => {
  if (decidido) return;
  encerrar(1, `\nSMOKE FALHOU — o processo morreu com código ${codigo} antes de subir.`);
});

const prazo = setTimeout(() => {
  encerrar(1, `\nSMOKE FALHOU — ${LIMITE_MS / 1000}s sem "${SINAL}".`);
}, LIMITE_MS);
