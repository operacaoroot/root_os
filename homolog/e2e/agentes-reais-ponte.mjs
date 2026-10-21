#!/usr/bin/env node
/*
 * Sobe a ponte de modelo DESTA worktree para a prova `agentes-reais.mjs` (A8, 21/10/2026).
 *
 * A worktree não tem `homolog/.env.homolog`: o token compartilhado vem do arquivo
 * que `PONTE_ENV_HOMOLOG` aponta (padrão: o `.env.homolog` do clone principal),
 * lido aqui e passado à ponte pelo ambiente do processo. Nada é impresso.
 *
 *   node homolog/e2e/agentes-reais-ponte.mjs [caminho do .env.homolog]
 *
 * O processo filho é a ponte de sempre (`homolog/ponte-modelo/ponte.mjs`, porta 4099),
 * com prazo de 300 s por chamada. Encerrar este processo encerra a ponte.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const arquivo = process.argv[2] || process.env.PONTE_ENV_HOMOLOG || resolve(AQUI, '..', '.env.homolog');
const linha = readFileSync(arquivo, 'utf8').split(/\r?\n/).find((l) => l.startsWith('PONTE_MODELO_TOKEN='));
if (!linha) {
  console.error('[ponte-da-prova] não achei PONTE_MODELO_TOKEN no arquivo indicado.');
  process.exit(1);
}
const filho = spawn(process.execPath, [resolve(AQUI, '..', 'ponte-modelo', 'ponte.mjs')], {
  stdio: 'inherit',
  env: { ...process.env, PONTE_MODELO_TOKEN: linha.slice('PONTE_MODELO_TOKEN='.length).trim(), PONTE_PRAZO_MS: process.env.PONTE_PRAZO_MS ?? '300000' },
});
console.log(`[ponte-da-prova] ponte no pid ${filho.pid}`);
const parar = () => filho.kill('SIGTERM');
process.on('SIGINT', parar);
process.on('SIGTERM', parar);
filho.on('exit', (c) => process.exit(c ?? 0));
