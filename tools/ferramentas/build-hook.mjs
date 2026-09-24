#!/usr/bin/env node
// Build hook: prepara uma visão determinística das ferramentas e materializa
// somente bytes marcados como próprios nas árvores compiladas. Não importa TS,
// não abre banco e não executa código da ferramenta.
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  closeSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const rootArg = process.argv.indexOf('--root');
const root = resolve(rootArg >= 0 ? process.argv[rootArg + 1] : repoRoot);
const cli = join(repoRoot, 'tools/ferramentas/cli.mjs');
const stage = join(root, '.staging/ferramentas');
const lockPath = join(root, '.staging/.ferramentas-build.lock');
const apiTarget = join(root, 'apps/api/src/ferramentas-geradas');
const webTarget = join(root, 'apps/web/src/app/ferramentas');
const apiMarker = join(apiTarget, '.rootos-generated.json');
const webMarker = join(webTarget, '.rootos-generated.json');

function fail(message) { throw new Error(message); }
function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function bytes(path) { return readFileSync(path); }
function writeAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.rootos-tmp-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(temp, data, { flag: 'wx', mode: 0o600 });
    renameSync(temp, path);
  } finally {
    try { unlinkSync(temp); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
}
function acquireLock() {
  mkdirSync(dirname(lockPath), { recursive: true });
  const token = `${process.pid}:${randomUUID()}`;
  const started = Date.now();
  for (;;) {
    try {
      const fd = openSync(lockPath, 'wx', 0o600);
      writeFileSync(fd, JSON.stringify({ pid: process.pid, started, token }), { encoding: 'utf8' });
      closeSync(fd);
      return token;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (Date.now() - started > 15_000) fail('preparação de ferramentas bloqueada por outro processo; o lock não foi removido');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}
function releaseLock(token) {
  try {
    const current = JSON.parse(readFileSync(lockPath, 'utf8'));
    if (current.token === token) unlinkSync(lockPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
function pathInside(base, value) {
  const b = resolve(base); const p = resolve(value);
  if (p !== b && !p.startsWith(`${b}${sep}`)) fail(`saída fora da árvore permitida: ${value}`);
  return p;
}
function rejectSymlinkChain(base, target) {
  const rootPath = resolve(base);
  const child = pathInside(rootPath, target);
  const parts = relative(rootPath, child).split(sep).filter(Boolean);
  let current = rootPath;
  for (const part of parts) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) fail(`symlink não permitido em saída: ${current}`);
    } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
}
function readMarker(path, target) {
  if (!existsSync(path)) return { files: [] };
  if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) fail(`marcador inválido: ${path}`);
  let marker;
  try { marker = JSON.parse(readFileSync(path, 'utf8')); } catch { fail(`marcador inválido: ${path}`); }
  if (marker.schemaVersion !== 1 || !Array.isArray(marker.files)) fail(`marcador inválido: ${path}`);
  const seen = new Set();
  for (const entry of marker.files) {
    if (!entry || typeof entry.path !== 'string' || seen.has(entry.path) || !/^[A-Za-z0-9._/-]+$/.test(entry.path)) fail(`marcador contém caminho inválido: ${entry?.path ?? ''}`);
    if (!caminhoGeradoPermitido(target, entry.path)) fail(`marcador reivindica saída não permitida: ${entry.path}`);
    seen.add(entry.path);
    const out = pathInside(target, join(target, entry.path));
    if (!existsSync(out) || lstatSync(out).isSymbolicLink() || !lstatSync(out).isFile()) fail(`saída gerada sumiu ou virou symlink: ${entry.path}`);
    if (hash(bytes(out)) !== entry.bytes) fail(`saída gerada foi alterada; recusa limpeza: ${entry.path}`);
  }
  return marker;
}
function caminhoGeradoPermitido(target, value) {
  if (resolve(target) === resolve(apiTarget)) return value === 'index.ts' || /^[a-z][a-z0-9-]{1,47}\/module\.ts$/.test(value);
  if (resolve(target) === resolve(webTarget)) return /^[a-z][a-z0-9-]{1,47}\/page\.tsx$/.test(value);
  return false;
}
function markerFiles(stageRoot, targetPrefix, target) {
  const result = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) fail(`symlink no staging: ${relative(stageRoot, full)}`);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const relStage = relative(stageRoot, full).split(sep).join('/');
        if (!relStage.startsWith(`${targetPrefix}/`)) continue;
        const relTarget = relStage.slice(targetPrefix.length + 1);
        if (!caminhoGeradoPermitido(target, relTarget)) fail(`staging contém saída não permitida: ${relTarget}`);
        pathInside(target, join(target, relTarget));
        result.push({ path: relTarget, bytes: hash(bytes(full)) });
      } else fail(`tipo não suportado no staging: ${relative(stageRoot, full)}`);
    }
  };
  walk(stageRoot);
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
function targetFiles(target) {
  const files = [];
  const walk = (dir, prefix = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) fail(`symlink em saída: ${full}`);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile()) files.push(rel);
      else fail(`tipo não suportado em saída: ${full}`);
    }
  };
  if (existsSync(target)) walk(target);
  return files.sort();
}
function caminhoEstranhoPermitido(target, value) {
  // `/ferramentas/page.tsx` é a landing core; páginas de slug são geradas.
  return resolve(target) === resolve(webTarget) && value === 'page.tsx';
}
function stagePath(path) { return pathInside(stage, join(stage, path)); }
function materializePlan(target, markerPath, targetPrefix) {
  rejectSymlinkChain(root, target);
  const previous = readMarker(markerPath, target);
  const next = markerFiles(stage, targetPrefix, target);
  const oldByPath = new Map(previous.files.map((entry) => [entry.path, entry]));
  const nextByPath = new Map(next.map((entry) => [entry.path, entry]));

  for (const existing of targetFiles(target)) {
    if (existing === '.rootos-generated.json' || nextByPath.has(existing) || oldByPath.has(existing) || caminhoEstranhoPermitido(target, existing)) continue;
    fail(`saída contém arquivo não gerado: ${existing}`);
  }

  // Validate every destination before changing any byte. Existing files are
  // replaceable only if the prior marker owns them; foreign files are kept and
  // cause a closed failure instead of being overwritten.
  for (const entry of next) {
    const out = pathInside(target, join(target, entry.path));
    rejectSymlinkChain(target, out);
    if (!existsSync(out)) continue;
    const info = lstatSync(out);
    if (info.isSymbolicLink() || info.isDirectory() || !info.isFile()) fail(`destino gerado colide: ${entry.path}`);
    if (!oldByPath.has(entry.path)) fail(`destino existente não pertence ao preparador: ${entry.path}`);
  }
  return { previous, next, nextByPath, target, markerPath, targetPrefix };
}
function applyPlan(plan) {
  for (const entry of plan.next) {
    const source = stagePath(join(plan.targetPrefix, entry.path));
    writeAtomic(pathInside(plan.target, join(plan.target, entry.path)), bytes(source));
  }
  for (const entry of plan.previous.files) {
    if (!plan.nextByPath.has(entry.path)) unlinkSync(pathInside(plan.target, join(plan.target, entry.path)));
  }
  writeAtomic(plan.markerPath, `${JSON.stringify({ schemaVersion: 1, files: plan.next }, null, 2)}\n`);
}
function run() {
  rejectSymlinkChain(root, join(root, '.staging'));
  rejectSymlinkChain(root, apiTarget);
  rejectSymlinkChain(root, webTarget);
  const token = acquireLock();
  try {
    execFileSync(process.execPath, [cli, 'preparar-ferramentas', '--root', root, '--stage', stage], { stdio: 'inherit' });
    mkdirSync(apiTarget, { recursive: true });
    mkdirSync(webTarget, { recursive: true });
    // Plan and validate BOTH trees before mutating either one.
    const apiPlan = materializePlan(apiTarget, apiMarker, 'apps/api/src/ferramentas-geradas');
    const webPlan = materializePlan(webTarget, webMarker, 'apps/web/src/app/ferramentas');
    applyPlan(apiPlan);
    applyPlan(webPlan);
  } finally {
    releaseLock(token);
  }
}
try { run(); } catch (error) { console.error(error instanceof Error ? error.message : 'falha sanitizada'); process.exitCode = 4; }
