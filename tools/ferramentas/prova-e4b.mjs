#!/usr/bin/env node
// Prova reproduzível E4b. A ferramenta e sua migration existem somente durante
// esta execução; a migration entra pelo histórico Prisma, nunca por psql/DDL.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const slug = 'e4b-prova-sintetica';
const table = 'tool_e4b_prova_sintetica_registro';
const toolDir = join(repo, 'ferramentas', slug);
const migrationDir = join(repo, 'apps/api/prisma/migrations/99999999999999_e4b_prova_sintetica');
const ownerUrl = process.env.TEST_DATABASE_URL;
const tenantUrl = process.env.TENANT_DATABASE_URL;

function validarUrls() {
  assert(ownerUrl && tenantUrl, 'Exige TEST_DATABASE_URL e TENANT_DATABASE_URL sintéticas.');
  const urls = [ownerUrl, tenantUrl].map((value) => new URL(value));
  for (const url of urls) {
    assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'E4b aceita somente banco loopback.');
    assert.equal(url.pathname, '/marketing_os_tools_test', 'E4b aceita somente marketing_os_tools_test.');
  }
  assert.equal(urls[0].host, urls[1].host, 'As URLs E4b precisam usar o mesmo host/porta.');
  assert.notEqual(urls[0].username, urls[1].username, 'O papel restrito precisa ser distinto do dono.');
}

function run(label, command, args, extraEnv = {}, capture = false) {
  const result = spawnSync(command, args, {
    cwd: repo,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 180_000,
  });
  if (capture) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  if (result.error || result.status !== 0) {
    throw new Error(`${label} falhou${result.error ? `: ${result.error.message}` : ` (exit ${result.status})`}`);
  }
  return result.stdout ?? '';
}

function ferramentasPresentes() {
  const dir = join(repo, 'ferramentas');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

validarUrls();
const existentes = ferramentasPresentes();
assert.deepEqual(existentes, [], `a prova exige ferramentas/ vazio; encontrados: ${existentes.join(', ')}`);
assert(!existsSync(migrationDir), 'migration temporária E4b já existe; limpe a execução anterior.');

let criouTemporarios = false;
let falhou = true;
try {
  run('criação da ferramenta', process.execPath, ['tools/ferramentas/cli.mjs', 'criar-ferramenta', slug, '--root', repo]);
  criouTemporarios = true;
  run('preparação da ferramenta', process.execPath, ['tools/ferramentas/build-hook.mjs', '--root', repo]);
  const inventory = JSON.parse(readFileSync(join(repo, '.staging/ferramentas/inventory.json'), 'utf8'));
  assert.equal(inventory.tools.length, 1);
  assert.equal(inventory.tools[0].slug, slug);
  assert.match(inventory.toolHash, /^[a-f0-9]{64}$/);

  mkdirSync(migrationDir, { recursive: false });
  writeFileSync(join(migrationDir, 'migration.sql'), readFileSync(join(toolDir, 'migration.sql')), { flag: 'wx', mode: 0o600 });

  const dbEnv = { DATABASE_URL: ownerUrl, TEST_DATABASE_URL: ownerUrl, TENANT_DATABASE_URL: tenantUrl };
  run('reset Prisma agregado', 'pnpm', ['--filter', '@mktos/api', 'exec', 'prisma', 'migrate', 'reset', '--force', '--skip-seed'], dbEnv);
  run('seed preservador', 'pnpm', ['--filter', '@mktos/api', 'db:seed'], dbEnv);
  run('seed de política base', 'pnpm', ['--filter', '@mktos/api', 'db:seed:politica'], dbEnv);
  run('build compilado com ferramenta', 'pnpm', ['--filter', '@mktos/api', 'build'], dbEnv);
  run('isolamento com fixture da ferramenta', 'pnpm', ['--filter', '@mktos/api', 'test:isolamento'], dbEnv);
  const smoke = run('smoke compilado E4b', process.execPath, ['apps/api/scripts/smoke-restrito.cjs'], {
    ...dbEnv,
    E4B_TOOL_REQUIRED: '1', E4B_TOOL_SLUG: slug, E4B_TOOL_TABLE: table, E4B_TOOL_HASH: inventory.toolHash,
  }, true);
  assert.match(smoke, /E4B_TOOL_HTTP_RLS_OK/);
  assert.match(smoke, /SMOKE_RESTRITO_OK/);
  console.log(`E4B_PROVA_OK: ${slug} ${inventory.toolHash}`);
  falhou = false;
} finally {
  if (criouTemporarios) {
    rmSync(migrationDir, { recursive: true, force: true });
    rmSync(toolDir, { recursive: true, force: true });
    run('limpeza do staging gerado', process.execPath, ['tools/ferramentas/build-hook.mjs', '--root', repo]);
    // O banco termina somente com o histórico core. Isso torna a próxima
    // rodada independente do checksum/nome sintético desta execução.
    run('reset final do banco E4b para core', 'pnpm', ['--filter', '@mktos/api', 'exec', 'prisma', 'migrate', 'reset', '--force', '--skip-seed'], {
      DATABASE_URL: ownerUrl,
    });
  }
  if (falhou) process.exitCode = 1;
}
