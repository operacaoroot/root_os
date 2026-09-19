#!/usr/bin/env node
// E4a: contrato/geração determinística. Este processo trata TS/SQL como dados;
// não importa nem executa código da ferramenta.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

const VERSION = 1;
const FILES = [
  'README.md', 'capability-proposal.json', 'fixture.json', 'migration.sql',
  'api/module.ts', 'web/page.tsx', 'manifest.json',
];
const slugRe = /^[a-z][a-z0-9-]{1,47}$/;

function fail(message) { throw new Error(message); }
function parseArgs(argv) {
  const command = argv[0];
  const takesValue = command === 'criar-ferramenta';
  const value = takesValue ? argv[1] : undefined;
  const rest = takesValue ? argv.slice(2) : argv.slice(1);
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i];
    if (!key.startsWith('--') || !rest[i + 1] || rest[i + 1].startsWith('--')) fail(`opção inválida: ${key}`);
    options[key.slice(2)] = rest[++i];
  }
  return { command, value, options };
}
function safeSlug(slug) {
  if (typeof slug !== 'string' || !slugRe.test(slug)) fail('slug inválido: use minúsculas, hífen e 2–48 caracteres');
  return slug;
}
function under(base, child) {
  const resolvedBase = resolve(base);
  const resolvedChild = resolve(resolvedBase, child);
  if (resolvedChild !== resolvedBase && !resolvedChild.startsWith(`${resolvedBase}${sep}`)) fail('caminho fora da raiz permitida');
  return resolvedChild;
}
function rejectSymlinkChain(base, target) {
  const root = resolve(base);
  const child = under(root, target);
  try { if (lstatSync(root).isSymbolicLink()) fail('symlink não é aceito na raiz'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const rel = relative(root, child).split(sep).filter(Boolean);
  let current = root;
  for (const part of rel) {
    current = join(current, part);
    try { if (lstatSync(current).isSymbolicLink()) fail('symlink não é aceito no caminho da ferramenta'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
function overlaps(first, second) {
  const a = resolve(first); const b = resolve(second);
  return a === b || a.startsWith(`${b}${sep}`) || b.startsWith(`${a}${sep}`);
}
function writeText(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value, { encoding: 'utf8', mode: 0o600 }); }
function hash(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function stable(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function tableFor(slug) { return `tool_${slug.replaceAll('-', '_')}_registro`; }
function expectedManifest(slug) {
  return {
    schemaVersion: VERSION, kind: 'rootos-tool', slug,
    apiPrefix: `/ferramentas/${slug}`, tableName: tableFor(slug),
    generatedFiles: [...FILES], migrationName: `e4a_${slug.replaceAll('-', '_')}_001_tool_registro`,
    outputs: {
      api: `apps/api/src/ferramentas-geradas/${slug}/module.ts`,
      web: `apps/web/src/app/ferramentas-geradas/${slug}/page.tsx`,
    },
    capability: { proposalId: `ferramenta:${slug}:proposal`, activationKey: `ferramentas:${slug}`, status: 'proposta', active: false, risk: 'R5', permissions: ['mcp.ver', 'mcp.executar'], reason: 'capacidade proposta; requer aprovação explícita' },
  };
}
function generatedFiles(slug) {
  const manifest = expectedManifest(slug);
  const cap = { ...manifest.capability };
  const fixture = { schemaVersion: 1, tenants: [
    { orgId: 'fixture-org-a', records: [{ id: 'a', titulo: 'A' }] },
    { orgId: 'fixture-org-b', records: [{ id: 'b', titulo: 'B' }] },
  ] };
  const sql = `-- E4a scaffold; migration própria, sem ativação.\nCREATE TABLE "${manifest.tableName}" (\n  "id" TEXT NOT NULL,\n  "orgId" TEXT NOT NULL,\n  "titulo" TEXT NOT NULL,\n  CONSTRAINT "${manifest.tableName}_pkey" PRIMARY KEY ("id"),\n  CONSTRAINT "${manifest.tableName}_org_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE\n);\nALTER TABLE "${manifest.tableName}" ENABLE ROW LEVEL SECURITY;\nALTER TABLE "${manifest.tableName}" FORCE ROW LEVEL SECURITY;\nSELECT app_rls_aplicar_policies(\n  '${manifest.tableName}',\n  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()',\n  'public.app_org_resolvida() AND "orgId" = public.app_org_atual()'\n);\n`;
  const files = new Map([
    ['README.md', `# Ferramenta ${slug}\n\nMolde E4a não publicado nem ativado. A capability proposta permanece R5.\n`],
    ['capability-proposal.json', stable(cap)],
    ['fixture.json', stable(fixture)],
    ['migration.sql', sql],
    ['api/module.ts', `export const ferramenta = ${JSON.stringify({ slug, tableName: manifest.tableName, query: `SELECT "id", "orgId", "titulo" FROM "${manifest.tableName}" WHERE "orgId" = $1 ORDER BY "id"` }, null, 2)} as const;\n`],
    ['web/page.tsx', `export default function ${slug.replaceAll('-', '_')}Page() { return <main><h1>${slug}</h1><p>Molde não ativado.</p></main>; }\n`],
  ]);
  files.set('manifest.json', stable(manifest));
  return files;
}
function createTool(slug, options) {
  safeSlug(slug);
  const root = resolve(options.root || process.cwd());
  const toolsRoot = under(root, options.tools || join(root, 'ferramentas'));
  const target = under(toolsRoot, join(toolsRoot, slug));
  rejectSymlinkChain(root, toolsRoot); rejectSymlinkChain(toolsRoot, target);
  if (existsSync(target)) fail('colisão: pasta da ferramenta já existe');
  mkdirSync(toolsRoot, { recursive: true });
  const temp = mkdtempSync(join(toolsRoot, `.rootos-tool-${slug}-`));
  try {
    for (const [path, content] of generatedFiles(slug)) writeText(join(temp, path), content);
    renameSync(temp, target);
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    throw error;
  }
  return target;
}
function readManifest(toolDir) {
  const path = join(toolDir, 'manifest.json');
  if (!existsSync(path) || !lstatSync(path).isFile()) fail(`manifesto ausente: ${toolDir}`);
  let manifest;
  try { manifest = JSON.parse(readFileSync(path, 'utf8')); } catch { fail(`manifesto JSON inválido: ${toolDir}`); }
  safeSlug(manifest.slug);
  if (manifest.schemaVersion !== VERSION || manifest.kind !== 'rootos-tool' || manifest.slug !== toolDir.split(sep).pop()) fail(`manifesto incompatível: ${toolDir}`);
  const expected = expectedManifest(manifest.slug);
  if (JSON.stringify(manifest) !== JSON.stringify(expected)) fail(`manifesto não corresponde ao contrato: ${manifest.slug}`);
  const listed = [...manifest.generatedFiles].sort();
  if (JSON.stringify(listed) !== JSON.stringify([...FILES].sort())) fail(`arquivos declarados inválidos: ${manifest.slug}`);
  const found = [];
  const walk = (dir, prefix = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name); const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) fail(`symlink no artefato: ${manifest.slug}/${rel}`);
      if (entry.isDirectory()) walk(path, rel);
      else if (entry.isFile()) found.push(rel);
      else fail(`tipo de arquivo não suportado: ${manifest.slug}/${rel}`);
    }
  };
  walk(toolDir);
  found.sort();
  if (JSON.stringify(found) !== JSON.stringify([...FILES].sort())) fail(`arquivo ausente ou extra: ${manifest.slug}`);
  if (manifest.capability.active !== false || manifest.capability.status !== 'proposta') fail(`capability não pode estar ativa: ${manifest.slug}`);
  return manifest;
}
function copyStageBytes(bytes, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes, { mode: 0o600 });
}
function validateDestinations(stage, paths) {
  for (const path of paths) {
    const target = under(stage, path);
    if (!existsSync(target)) continue;
    const info = lstatSync(target);
    if (info.isSymbolicLink() || info.isDirectory() || !info.isFile()) fail('destino staged colide com diretório, symlink ou tipo inválido');
  }
}
function safeMarkerFile(stage, value) {
  if (typeof value !== 'string' || !value || isAbsolute(value) || value.split('/').some(part => !part || part === '.' || part === '..')) fail('marcador de staging inválido');
  const target = under(stage, value);
  if (!existsSync(target) || !lstatSync(target).isFile() || lstatSync(target).isSymbolicLink()) fail('marcador aponta para saída inválida');
  return target;
}
function recognizedMarkerPath(value) {
  if (value === 'inventory.json') return true;
  const parts = value.split('/');
  if (parts.length >= 3 && parts[0] === 'ferramentas' && slugRe.test(parts[1]) && FILES.includes(parts.slice(2).join('/'))) return true;
  if (parts.length === 6 && parts[0] === 'apps' && parts[1] === 'api' && parts[2] === 'src' && parts[3] === 'ferramentas-geradas' && slugRe.test(parts[4]) && parts[5] === 'module.ts') return true;
  if (parts.length === 7 && parts[0] === 'apps' && parts[1] === 'web' && parts[2] === 'src' && parts[3] === 'app' && parts[4] === 'ferramentas-geradas' && slugRe.test(parts[5]) && parts[6] === 'page.tsx') return true;
  return false;
}
function actualFiles(root) {
  const files = [];
  const walk = (dir, prefix = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name); const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) fail(`symlink no staging: ${rel}`);
      if (entry.isDirectory()) walk(path, rel);
      else if (entry.isFile()) files.push(rel);
      else fail(`tipo de arquivo não suportado no staging: ${rel}`);
    }
  };
  walk(root);
  return files.sort();
}
function validateMarkerFile(stage, entry) {
  if (!entry || JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(['path', 'sha256', 'size']) || typeof entry.path !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isInteger(entry.size) || entry.size < 0) fail('marcador de staging inválido');
  if (!recognizedMarkerPath(entry.path)) fail('marcador contém caminho de saída não reconhecido');
  const target = safeMarkerFile(stage, entry.path);
  if (statSync(target).size !== entry.size || hash(target) !== entry.sha256) fail('saída staged foi alterada; recusa limpeza');
  return target;
}
function prepare(options) {
  const root = resolve(options.root || process.cwd());
  const toolsRoot = under(root, options.tools || join(root, 'ferramentas'));
  const stage = under(root, options.stage || join(root, '.staging/ferramentas'));
  if (resolve(stage) === resolve(root) || overlaps(stage, toolsRoot)) fail('staging sobrepõe raiz ou entrada de ferramentas');
  rejectSymlinkChain(root, toolsRoot); rejectSymlinkChain(root, stage);
  const dirs = existsSync(toolsRoot) ? readdirSync(toolsRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)) : [];
  if (dirs.some(entry => entry.isSymbolicLink())) fail('symlink na raiz de ferramentas');
  const manifests = dirs.filter(entry => entry.isDirectory()).map(entry => readManifest(join(toolsRoot, entry.name)));
  const inventory = { schemaVersion: VERSION, tools: [] };
  const inputBytes = new Map();
  for (const manifest of manifests.sort((a, b) => a.slug.localeCompare(b.slug))) {
    const dir = join(toolsRoot, manifest.slug);
    const files = manifest.generatedFiles.map(path => {
      const source = join(dir, path); const bytes = readFileSync(source); inputBytes.set(source, bytes);
      return { path, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    });
    inventory.tools.push({ slug: manifest.slug, manifestSha256: createHash('sha256').update(inputBytes.get(join(dir, 'manifest.json'))).digest('hex'), files, outputs: manifest.outputs });
  }
  const nextPaths = ['inventory.json'];
  for (const manifest of inventory.tools) {
    for (const file of manifest.files) nextPaths.push(`ferramentas/${manifest.slug}/${file.path}`);
    nextPaths.push(manifest.outputs.api, manifest.outputs.web);
  }
  const marker = join(stage, '.rootos-generated.json');
  if (existsSync(stage)) {
    if (!existsSync(marker)) fail('staging existente não foi gerado por este preparador');
    if (lstatSync(stage).isSymbolicLink() || !lstatSync(marker).isFile() || lstatSync(marker).isSymbolicLink()) fail('staging ou marcador é symlink');
    let previous;
    try { previous = JSON.parse(readFileSync(marker, 'utf8')); } catch { fail('marcador de staging inválido'); }
    if (previous.schemaVersion !== VERSION || JSON.stringify(Object.keys(previous).sort()) !== JSON.stringify(['files', 'schemaVersion']) || !Array.isArray(previous.files)) fail('marcador de staging inválido');
    const entries = previous.files;
    const listed = entries.map(entry => entry.path);
    const actual = actualFiles(stage).filter(path => path !== '.rootos-generated.json');
    if (new Set(listed).size !== listed.length || JSON.stringify([...listed].sort()) !== JSON.stringify(actual)) fail('staging contém arquivo extra, ausente ou não inventariado');
    const targets = entries.map(entry => validateMarkerFile(stage, entry));
    validateDestinations(stage, nextPaths);
    for (const target of targets) unlinkSync(target);
  } else { mkdirSync(stage, { recursive: true }); validateDestinations(stage, nextPaths); }
  const paths = [];
  for (const manifest of inventory.tools) {
    const sourceDir = join(toolsRoot, manifest.slug);
    for (const file of manifest.files) {
      const destination = join(stage, 'ferramentas', manifest.slug, file.path);
      copyStageBytes(inputBytes.get(join(sourceDir, file.path)), destination); paths.push(relative(stage, destination));
    }
    const apiDestination = join(stage, manifest.outputs.api);
    const webDestination = join(stage, manifest.outputs.web);
    copyStageBytes(inputBytes.get(join(sourceDir, 'api/module.ts')), apiDestination); paths.push(relative(stage, apiDestination));
    copyStageBytes(inputBytes.get(join(sourceDir, 'web/page.tsx')), webDestination); paths.push(relative(stage, webDestination));
  }
  const inventoryJson = stable(inventory);
  writeText(join(stage, 'inventory.json'), inventoryJson); paths.push('inventory.json');
  const stagedFiles = paths.sort().map(path => ({ path, size: statSync(join(stage, path)).size, sha256: hash(join(stage, path)) }));
  writeText(marker, stable({ schemaVersion: VERSION, files: stagedFiles }));
  return inventory;
}
function main(argv) {
  const { command, value, options } = parseArgs(argv);
  if (command === 'criar-ferramenta') { const target = createTool(value, options); console.log(JSON.stringify({ created: relative(resolve(options.root || process.cwd()), target) })); return; }
  if (command === 'preparar-ferramentas') { console.log(stable(prepare(options))); return; }
  fail('uso: criar-ferramenta <slug> | preparar-ferramentas');
}
try { main(process.argv.slice(2)); } catch (error) { console.error(error instanceof Error ? error.message : 'falha sanitizada'); process.exitCode = 4; }
