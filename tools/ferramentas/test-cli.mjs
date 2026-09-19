import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const repo = new URL('../..', import.meta.url).pathname;
const cli = join(repo, 'tools/ferramentas/cli.mjs');
function run(args, root) { return execFileSync(process.execPath, [cli, ...args, '--root', root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
function fails(args, root) { assert.throws(() => run(args, root)); }
function temp() { return mkdtempSync(join(tmpdir(), 'rootos-e4a-')); }

const root = temp();
try {
  run(['criar-ferramenta', 'alpha-tool'], root);
  run(['criar-ferramenta', 'beta-tool'], root);
  const first = JSON.parse(run(['preparar-ferramentas', '--stage', join(root, 'stage')], root));
  run(['preparar-ferramentas', '--stage', join(root, 'stage-ancestor')], root);
  const generatedDir = join(root, 'stage-ancestor/apps/api/src/ferramentas-geradas/alpha-tool');
  rmSync(generatedDir, { recursive: true, force: true });
  const outside = join(root, 'outside-sentinel'); writeFileSync(outside, 'untouched');
  symlinkSync(join(root, 'outside-dir'), generatedDir, 'dir');
  fails(['preparar-ferramentas', '--stage', join(root, 'stage-ancestor')], root);
  assert.equal(readFileSync(outside, 'utf8'), 'untouched');
  const firstBytes = readFileSync(join(root, 'stage', 'inventory.json'), 'utf8');
  const second = JSON.parse(run(['preparar-ferramentas', '--stage', join(root, 'stage-2')], root));
  assert.deepEqual(second, first);
  assert.equal(readFileSync(join(root, 'stage-2', 'inventory.json'), 'utf8'), firstBytes);
  writeFileSync(join(root, 'stage-2', '.rootos-generated.json'), JSON.stringify({ files: [{ path: '.', size: 0, sha256: 'bad' }] }));
  fails(['preparar-ferramentas', '--stage', join(root, 'stage-2')], root);
  run(['preparar-ferramentas', '--stage', join(root, 'stage-collision')], root);
  run(['criar-ferramenta', 'collision-tool'], root);
  const collisionDir = join(root, 'stage-collision/apps/api/src/ferramentas-geradas/collision-tool/module.ts');
  mkdirSync(collisionDir, { recursive: true });
  fails(['preparar-ferramentas', '--stage', join(root, 'stage-collision')], root);
  assert(statSync(collisionDir).isDirectory());
  writeFileSync(join(root, 'stage-2', '.rootos-generated.json'), '{invalid');
  fails(['preparar-ferramentas', '--stage', join(root, 'stage-2')], root);
  assert.equal(first.tools.length, 2);
  assert.match(readFileSync(join(root, 'stage', 'ferramentas/alpha-tool/migration.sql'), 'utf8'), /FORCE ROW LEVEL SECURITY/);
  assert.match(readFileSync(join(root, 'stage', 'ferramentas/alpha-tool/migration.sql'), 'utf8'), /app_rls_aplicar_policies/);
  assert.match(readFileSync(join(root, 'stage', 'ferramentas/alpha-tool/migration.sql'), 'utf8'), /REFERENCES "Org"\("id"\)/);
  assert.match(readFileSync(join(root, 'stage', 'ferramentas/alpha-tool/api/module.ts'), 'utf8'), /\$1/);
  assert.equal(JSON.parse(readFileSync(join(root, 'stage', 'ferramentas/alpha-tool/fixture.json'), 'utf8')).tenants.length, 2);
  assert.match(readFileSync(join(root, 'stage/apps/api/src/ferramentas-geradas/alpha-tool/module.ts'), 'utf8'), /export const ferramenta/);
  assert.match(readFileSync(join(root, 'stage/apps/web/src/app/ferramentas-geradas/alpha-tool/page.tsx'), 'utf8'), /Molde não ativado/);
  execFileSync('pnpm', ['exec', 'tsc', '--noEmit', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--jsx', 'preserve', '--skipLibCheck', join(root, 'stage/apps/api/src/ferramentas-geradas/alpha-tool/module.ts'), join(root, 'stage/apps/web/src/app/ferramentas-geradas/alpha-tool/page.tsx')], { cwd: repo, stdio: 'pipe' });
  const edited = join(root, 'stage/apps/api/src/ferramentas-geradas/alpha-tool/module.ts');
  const editedBytes = readFileSync(edited);
  writeFileSync(edited, Buffer.concat([editedBytes, Buffer.from('edited')]));
  fails(['preparar-ferramentas', '--stage', join(root, 'stage')], root);
  assert.deepEqual(readFileSync(edited), Buffer.concat([editedBytes, Buffer.from('edited')]));
  writeFileSync(edited, editedBytes);
  fails(['criar-ferramenta', 'alpha-tool'], root);
  for (const bad of ['A', '../escape', 'has/slash', 'ümlaut']) fails(['criar-ferramenta', bad], root);
  writeFileSync(join(root, 'ferramentas/alpha-tool/extra.txt'), 'extra');
  fails(['preparar-ferramentas', '--stage', join(root, 'stage-3')], root);
  rmSync(join(root, 'ferramentas/alpha-tool/extra.txt'));
  rmSync(join(root, 'ferramentas/beta-tool/fixture.json'));
  fails(['preparar-ferramentas', '--stage', join(root, 'stage-3')], root);
  writeFileSync(join(root, 'ferramentas/beta-tool/fixture.json'), readFileSync(join(root, 'ferramentas/alpha-tool/fixture.json')));
  run(['criar-ferramenta', 'beta-tool-2'], root);
  symlinkSync(join(root, 'ferramentas/beta-tool-2'), join(root, 'ferramentas/link-tool'));
  fails(['preparar-ferramentas', '--stage', join(root, 'stage-4')], root);
  rmSync(join(root, 'ferramentas/link-tool'));
  symlinkSync(join(root, 'ferramentas/missing-target'), join(root, 'ferramentas/dangling-link'));
  fails(['preparar-ferramentas', '--stage', join(root, 'stage-4b')], root);
  rmSync(join(root, 'ferramentas/dangling-link'));
  fails(['preparar-ferramentas', '--stage', root], root);
  // Removing a tool may only remove paths listed by the previous generator marker.
  rmSync(join(root, 'ferramentas/collision-tool'), { recursive: true, force: true });
  rmSync(join(root, 'ferramentas/beta-tool'), { recursive: true, force: true });
  rmSync(join(root, 'ferramentas/beta-tool-2'), { recursive: true, force: true });
  run(['preparar-ferramentas', '--stage', join(root, 'stage')], root);
  assert.equal(JSON.parse(readFileSync(join(root, 'stage/inventory.json'), 'utf8')).tools.length, 1);
  rmSync(join(root, 'ferramentas/alpha-tool'), { recursive: true, force: true });
  run(['preparar-ferramentas', '--stage', join(root, 'stage')], root);
  assert.equal(JSON.parse(readFileSync(join(root, 'stage/inventory.json'), 'utf8')).tools.length, 0);
  writeFileSync(join(root, 'stage/foreign.txt'), 'preserve');
  fails(['preparar-ferramentas', '--stage', join(root, 'stage')], root);
  assert.equal(readFileSync(join(root, 'stage/foreign.txt'), 'utf8'), 'preserve');
  console.log('E4A_TOOL_TESTS_OK');
} finally { rmSync(root, { recursive: true, force: true }); }
