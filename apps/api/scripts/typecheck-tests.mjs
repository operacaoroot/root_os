import ts from 'typescript';
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);

// All configured roots are covered. Ambient roots are shared by every program,
// including global scripts and module/global augmentations written in .ts files.
// Imports retain their production dependencies; no generated stubs are used.
function ambientRoot(file) {
  if (file.endsWith('.d.ts')) return true;
  if (!existsSync(file)) return false;
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  if (!ts.isExternalModule(source)) return true;
  let ambient = false;
  const visit = node => {
    if (ts.isModuleDeclaration(node) &&
        ((node.flags & ts.NodeFlags.GlobalAugmentation) || ts.isStringLiteral(node.name))) ambient = true;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return ambient;
}
export function planChecks(files, root, batchSize = 40) {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('Invalid batch size');
  const declarations = files.filter(ambientRoot);
  const tests = files.filter(f => relative(root, f).startsWith('test/') && !declarations.includes(f)).sort();
  const other = files.filter(f => !tests.includes(f) && !declarations.includes(f));
  const checks = other.length ? [[...other, ...declarations]] : [];
  for (let i = 0; i < tests.length; i += batchSize) checks.push([...tests.slice(i, i + batchSize), ...declarations]);
  if (!checks.length && declarations.length) checks.push(declarations);
  if (!checks.length) throw new Error('No files found for typecheck');
  return checks;
}

export function runChecks(checks, config, {stdio = 'inherit'} = {}) {
  // Keep generated root lists outside the source tree and its architecture scans.
  const temp = join(tmpdir(), `rootos-typecheck-${randomUUID()}.json`);
  let exitCode = 0;
  try {
    for (const [i, files] of checks.entries()) {
      if (stdio === 'inherit') console.log(`Typecheck ${i + 1}/${checks.length}: ${files.length} roots`);
      writeFileSync(temp, JSON.stringify({extends:config,compilerOptions:{noEmit:true,incremental:false},files,include:[],exclude:[]}));
      const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', temp], {stdio, env:process.env});
      if (result.error) throw result.error;
      if (result.signal) throw new Error(`Typecheck terminated: ${result.signal}`);
      if (result.status !== 0) exitCode = result.status ?? 1;
    }
    return exitCode;
  } finally { try { unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = resolve(fileURLToPath(new URL('../tsconfig.test.json', import.meta.url)));
  const read = ts.readConfigFile(config, ts.sys.readFile);
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(config));
  if (parsed.errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(parsed.errors, {getCurrentDirectory:ts.sys.getCurrentDirectory,getCanonicalFileName:f=>f,getNewLine:()=> '\n'}));
  const checks = planChecks(parsed.fileNames, dirname(config));
  console.log(`Checking all ${parsed.fileNames.length} configured files in ${checks.length} sequential programs.`);
  process.exitCode = runChecks(checks, config);
}
