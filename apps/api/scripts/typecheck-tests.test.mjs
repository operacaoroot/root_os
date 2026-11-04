import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planChecks, runChecks } from './typecheck-tests.mjs';

test('every configured file is checked, including declarations and non-test roots', () => {
  const files = ['/api/src/a.ts', '/api/prisma/seed.ts', '/api/test/globals.d.ts', ...Array.from({length: 121}, (_, i) => `/api/test/case-${i}.ts`)];
  const checks = planChecks(files, '/api', 40);
  assert.deepEqual(new Set(checks.flat()), new Set(files));
  assert.equal(checks.length, 5);
  for (const check of checks) assert.ok(check.includes('/api/test/globals.d.ts'));
  for (const check of checks) assert.ok(check.filter(f => /case-/.test(f)).length <= 40);
});

test('a type error in the last batch fails the command; temporary configs are removed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'root-typecheck-'));
  const tempBefore = readdirSync(tmpdir()).filter(f => f.startsWith('rootos-typecheck-')).sort();
  try {
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({compilerOptions:{noEmit:true,strict:true,skipLibCheck:true,types:[]}}));
    const good = join(dir, 'good.ts'), bad = join(dir, 'bad.ts');
    writeFileSync(good, 'export const good: string = "ok";');
    writeFileSync(bad, 'export const bad: string = 123;');
    assert.equal(runChecks([[good], [bad]], join(dir, 'tsconfig.json'), {stdio:'pipe'}), 2);
    assert.equal(runChecks([[bad], [good]], join(dir, 'tsconfig.json'), {stdio:'pipe'}), 2);
    writeFileSync(bad, 'export const bad: string = "fixed";');
    assert.equal(runChecks([[good], [bad]], join(dir, 'tsconfig.json'), {stdio:'pipe'}), 0);
    assert.equal(readdirSync(dir).filter(f => f.startsWith('.typecheck-tests-')).length, 0);
    assert.deepEqual(readdirSync(tmpdir()).filter(f => f.startsWith('rootos-typecheck-')).sort(), tempBefore);
  } finally { rmSync(dir, {recursive:true, force:true}); }
});

test('global augmentations in different batches are checked together', () => {
  const dir = mkdtempSync(join(tmpdir(), 'root-globals-'));
  try {
    mkdirSync(join(dir, 'test'));
    const config = join(dir, 'tsconfig.json');
    writeFileSync(config, JSON.stringify({compilerOptions:{noEmit:true,strict:true,skipLibCheck:true,types:[]}}));
    const a = join(dir, 'test/a.ts'), b = join(dir, 'test/b.ts');
    writeFileSync(a, 'export {}; declare global { interface RootGlobal { id: string } }');
    writeFileSync(b, 'export {}; declare global { interface RootGlobal { id: number } }');
    assert.equal(runChecks(planChecks([a,b], dir, 1), config, {stdio:'pipe'}), 2);
  } finally { rmSync(dir, {recursive:true,force:true}); }
});
