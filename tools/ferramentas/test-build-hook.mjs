import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const cli = join(repo, 'tools/ferramentas/cli.mjs');
const hook = join(repo, 'tools/ferramentas/build-hook.mjs');
const root = mkdtempSync(join(tmpdir(), 'rootos-e4a-hook-'));
function run(file, args) {
  return new Promise((resolve, reject) => execFile(process.execPath, [file, ...args], { encoding: 'utf8' }, (error, stdout, stderr) => error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr })));
}
try {
  await run(cli, ['criar-ferramenta', 'alpha-tool', '--root', root]);
  await Promise.all([run(hook, ['--root', root]), run(hook, ['--root', root])]);
  const api = join(root, 'apps/api/src/ferramentas-geradas');
  const web = join(root, 'apps/web/src/app/ferramentas');
  assert.match(readFileSync(join(api, 'index.ts'), 'utf8'), /alpha-tool/);
  assert.match(readFileSync(join(web, 'alpha-tool/page.tsx'), 'utf8'), /FerramentaPage/);
  writeFileSync(join(api, 'foreign.ts'), 'do not touch');
  await assert.rejects(run(hook, ['--root', root]));
  assert.equal(readFileSync(join(api, 'foreign.ts'), 'utf8'), 'do not touch');
  rmSync(join(api, 'foreign.ts'));
  const betaPage = join(web, 'beta-tool/page.tsx');
  mkdirSync(join(web, 'beta-tool'), { recursive: true });
  writeFileSync(betaPage, 'do not touch');
  const apiBeforeBeta = readFileSync(join(api, 'index.ts'));
  const apiMarkerBeforeBeta = readFileSync(join(api, '.rootos-generated.json'));
  await assert.rejects(run(hook, ['--root', root]));
  assert.equal(readFileSync(betaPage, 'utf8'), 'do not touch');
  assert.deepEqual(readFileSync(join(api, 'index.ts')), apiBeforeBeta);
  assert.deepEqual(readFileSync(join(api, '.rootos-generated.json')), apiMarkerBeforeBeta);
  rmSync(join(web, 'beta-tool'), { recursive: true, force: true });
  const webMarker = join(web, '.rootos-generated.json');
  const markerBytes = readFileSync(webMarker);
  const invalidMarker = Buffer.from(JSON.stringify({ schemaVersion: 1, files: [{ path: 'page.tsx', bytes: '0'.repeat(64) }] }));
  writeFileSync(webMarker, invalidMarker);
  await assert.rejects(run(hook, ['--root', root]));
  assert.deepEqual(readFileSync(webMarker), invalidMarker);
  writeFileSync(webMarker, markerBytes);
  const apiMarkerPath = join(api, '.rootos-generated.json');
  const apiMarkerOriginal = readFileSync(apiMarkerPath);
  const coreClaim = Buffer.from(JSON.stringify({ schemaVersion: 1, files: [{ path: '../app.module.ts', bytes: '0'.repeat(64) }] }));
  writeFileSync(apiMarkerPath, coreClaim);
  await assert.rejects(run(hook, ['--root', root]));
  assert.deepEqual(readFileSync(apiMarkerPath), coreClaim);
  writeFileSync(apiMarkerPath, apiMarkerOriginal);
  const apiBytes = readFileSync(join(api, 'index.ts'));
  const apiMarkerBytes = readFileSync(join(api, '.rootos-generated.json'));
  const webPage = join(web, 'alpha-tool/page.tsx');
  const webPageBytes = readFileSync(webPage);
  writeFileSync(webPage, Buffer.concat([webPageBytes, Buffer.from('changed')]));
  await assert.rejects(run(hook, ['--root', root]));
  assert.deepEqual(readFileSync(join(api, 'index.ts')), apiBytes);
  assert.deepEqual(readFileSync(join(api, '.rootos-generated.json')), apiMarkerBytes);
  writeFileSync(webPage, webPageBytes);
  const symlinkRoot = mkdtempSync(join(tmpdir(), 'rootos-e4a-symlink-'));
  mkdirSync(join(symlinkRoot, 'apps/api/src'), { recursive: true });
  symlinkSync(join(symlinkRoot, 'outside'), join(symlinkRoot, 'apps/api/src/ferramentas-geradas'), 'dir');
  await assert.rejects(run(hook, ['--root', symlinkRoot]));
  rmSync(symlinkRoot, { recursive: true, force: true });
  // Lock estrangeiro não é removido por idade nem por conteúdo. Mantemos o
  // processo esperando por um instante, conferimos os mesmos bytes e o
  // encerramos sem dar ao hook a chance de materializar saída.
  const lockPath = join(root, '.staging/.ferramentas-build.lock');
  const foreignLock = Buffer.from(JSON.stringify({ pid: 999999, started: 1, token: 'estrangeiro' }));
  writeFileSync(lockPath, foreignLock);
  const blocked = spawn(process.execPath, [hook, '--root', root], { stdio: 'ignore' });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(blocked.exitCode, null);
  assert.deepEqual(readFileSync(lockPath), foreignLock);
  blocked.kill('SIGKILL');
  await new Promise((resolve) => blocked.once('close', resolve));
  assert(existsSync(lockPath));
  rmSync(lockPath);
  rmSync(join(root, 'ferramentas/alpha-tool'), { recursive: true, force: true });
  await run(hook, ['--root', root]);
  assert.doesNotMatch(readFileSync(join(api, 'index.ts'), 'utf8'), /alpha-tool/);
  assert.throws(() => readFileSync(join(web, 'alpha-tool/page.tsx')));
  console.log('E4A_HOOK_TESTS_OK');
} finally {
  rmSync(root, { recursive: true, force: true });
}
