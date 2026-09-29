import { PrismaClient, type Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { closeSync, createReadStream, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { SnapshotSchema, canonical, sha256, validarSnapshot } from './import-clickup-work.contract';
import { inventariar, type Spec } from './import-clickup-work.plan';

// Uso e garantias: ver import-clickup-work.md. Esta CLI não é chamada pelo runtime.
type Db = PrismaClient | Prisma.TransactionClient;
type Acao = { spec: Spec; estado: 'criar' | 'igual' | 'conflito'; motivo?: string };
type Registro = { id: string; origemHash: string };
type Run = { at: string; snapshotFile: string; snapshotSha256: string; backupFile: string; created: Record<string, string[]>; preFingerprint: string; postFingerprint: string; rolledBackAt?: string };
type Manifesto = {
  schemaVersion: 1; source: 'clickup'; orgId: string; spaceId: string; scopeListIds: string[];
  records: Record<string, Registro>;
  attachments: Record<string, Array<{ id: string; name: string; url: string | null; sha256: string | null; localPath: string | null; mimeType: string | null; size: number | null }>>;
  runs: Run[];
  recoveredAt?: string;
};
const TIPOS = ['folder', 'list', 'status', 'field', 'option', 'tag', 'task', 'value', 'comment'] as const;

export function classificarRollback(
  atual: string, run: Pick<Run, 'preFingerprint' | 'postFingerprint'>,
): 'pronto' | 'ja-revertido' | 'divergente' {
  if (atual === run.postFingerprint) return 'pronto';
  if (atual === run.preFingerprint) return 'ja-revertido';
  return 'divergente';
}

function args() {
  const out: Record<string, string | boolean> = {};
  const flags = new Set(['--apply', '--rollback', '--offline', '--help']);
  const valores = new Set(['--snapshot', '--org-id', '--manifest-dir']);
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (flags.has(arg)) out[arg] = true;
    else if (valores.has(arg)) {
      const value = process.argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Falta valor para ${arg}`);
      out[arg] = value;
    } else throw new Error(`Argumento desconhecido: ${arg}`);
  }
  return out;
}

function mensagemDeUso(): string {
  return `Uso: pnpm --filter @mktos/api exec tsx prisma/import-clickup-work.ts --snapshot arquivo.json [--org-id UUID] [--manifest-dir DIR] [--offline] [--apply] [--rollback]\n` +
    `Padrão: dry-run, sem escrita. --offline valida contrato sem conectar ao banco. --apply exige org-id e manifest-dir. --rollback sem --apply só confere; --rollback --apply reverte o último lote intocado.`;
}

function uuid(v: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v); }
function nomeManifesto(orgId: string, spaceId: string, listIds: string[]): string {
  return `clickup-work-${orgId}-${sha256({ spaceId, listIds: [...listIds].sort() }).slice(0, 16)}.manifest.json`;
}
function lerManifesto(path: string): Manifesto | null {
  if (!existsSync(path)) return null;
  const m = JSON.parse(readFileSync(path, 'utf8')) as Manifesto;
  if (m.schemaVersion !== 1 || m.source !== 'clickup') throw new Error('Manifesto incompatível');
  return m;
}
function salvarAtomico(path: string, data: unknown) {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  renameSync(temp, path);
}
function arquivoNovo(path: string, data: string) {
  if (existsSync(path)) {
    if (readFileSync(path, 'utf8') !== data) throw new Error(`Arquivo existente difere: ${path}`);
    return;
  }
  writeFileSync(path, data, { mode: 0o600, flag: 'wx' });
}
function validarDiretorio(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const mode = statSync(path).mode & 0o777;
  if (mode & 0o077) throw new Error(`Diretório do manifesto deve ser privado (chmod 700): ${path}`);
}
export async function verificarArquivos(
  tasks: ReturnType<typeof SnapshotSchema.parse>['tasks'],
  raiz?: string,
): Promise<string[]> {
  const erros: string[] = [];
  for (const t of tasks) for (const a of t.attachments) {
    const path = a.localPath;
    if (!path) continue; // o validador de contrato já acusa ausência
    try {
      const raizDeste = raiz ?? (path.startsWith('/private/tmp/root-os-migration-20260929/files/')
        ? '/private/tmp/root-os-migration-20260929/files/'
        : '/vault/90-OS/migrations/marketing-20260929/files/');
      const s = lstatSync(path);
      if (!s.isFile() || s.isSymbolicLink()) throw new Error('não é arquivo regular');
      if (!realpathSync(path).startsWith(`${realpathSync(raizDeste).replace(/\/$/, '')}/`)) throw new Error('fora do vault permitido');
      if (a.size != null && s.size !== a.size) throw new Error(`tamanho ${s.size} difere de ${a.size}`);
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      if (hash.digest('hex').toLowerCase() !== a.sha256?.toLowerCase()) throw new Error('SHA-256 dos bytes diverge');
    } catch (e) { erros.push(`${t.id}/${a.id}: ${(e as Error).message}`); }
  }
  return erros;
}
function preencherManifesto(manifest: Manifesto, specs: Spec[], tasks: ReturnType<typeof SnapshotSchema.parse>['tasks']) {
  for (const s of specs) manifest.records[s.chave] = { id: s.id, origemHash: s.origemHash };
  for (const t of tasks) manifest.attachments[t.id] = t.attachments.map((a) => ({
    id: a.id, name: a.name, url: a.url ?? null, sha256: a.sha256 ?? null,
    localPath: a.localPath ?? null, mimeType: a.mimeType ?? null, size: a.size ?? null,
  }));
}
async function trancar<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const lock = `${path}.lock`;
  const fd = openSync(lock, 'wx', 0o600);
  try { return await fn(); }
  finally { closeSync(fd); unlinkSync(lock); }
}

async function linha(db: Db, spec: Spec): Promise<Record<string, unknown> | null> {
  const where = { id: spec.id };
  let row: unknown;
  switch (spec.tipo) {
    case 'folder': row = await db.workFolder.findUnique({ where }); break;
    case 'list': row = await db.workList.findUnique({ where }); break;
    case 'status': row = await db.workStatus.findUnique({ where }); break;
    case 'field': row = await db.workField.findUnique({ where }); break;
    case 'option': row = await db.workFieldOption.findUnique({ where }); break;
    case 'tag': row = await db.workTag.findUnique({ where }); break;
    case 'task': row = await db.workTask.findUnique({ where, include: { tags: { select: { id: true } } } }); break;
    case 'value': row = await db.workFieldValue.findUnique({ where }); break;
    case 'comment': row = await db.workComment.findUnique({ where }); break;
  }
  return row as Record<string, unknown> | null;
}
function projeção(row: Record<string, unknown>, spec: Spec): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(spec.conferir)) {
    if (key === 'tagIds') result[key] = ((row.tags as Array<{ id: string }> | undefined) ?? []).map((t) => t.id).sort();
    else {
      const v = row[key];
      result[key] = v instanceof Date ? v.toISOString() : v ?? null;
    }
  }
  return result;
}
async function colisao(db: Db, s: Spec): Promise<string | null> {
  const d = s.dados;
  let row: { id: string } | null = null;
  switch (s.tipo) {
    case 'folder': row = await db.workFolder.findFirst({ where: { orgId: d.orgId as string, name: d.name as string }, select: { id: true } }); break;
    case 'list': row = (await db.workList.findMany({ where: { orgId: d.orgId as string, externalId: d.externalId as string }, select: { id: true } })).find((r) => r.id !== s.id) ?? null; break;
    case 'status': row = await db.workStatus.findFirst({ where: { listId: d.listId as string, name: d.name as string }, select: { id: true } }); break;
    case 'field': row = (await db.workField.findMany({ where: { orgId: d.orgId as string, listId: d.listId as string, name: d.name as string }, select: { id: true } })).find((r) => r.id !== s.id) ?? null; break;
    case 'option': row = await db.workFieldOption.findFirst({ where: { fieldId: d.fieldId as string, name: d.name as string }, select: { id: true } }); break;
    case 'tag': row = await db.workTag.findFirst({ where: { orgId: d.orgId as string, name: d.name as string }, select: { id: true } }); break;
    case 'task': row = await db.workTask.findFirst({ where: { orgId: d.orgId as string, externalId: d.externalId as string }, select: { id: true } }); break;
    case 'value': row = await db.workFieldValue.findFirst({ where: { taskId: d.taskId as string, fieldId: d.fieldId as string }, select: { id: true } }); break;
  }
  return row && row.id !== s.id ? `identidade nativa existente ${row.id}` : null;
}
export async function planejar(db: Db, specs: Spec[], records: Record<string, Registro> = {}): Promise<Acao[]> {
  const actions: Acao[] = [];
  for (const spec of specs) {
    const collision = await colisao(db, spec);
    if (collision) { actions.push({ spec, estado: 'conflito', motivo: collision }); continue; }
    const row = await linha(db, spec);
    if (row) {
      if (row.orgId !== spec.conferir.orgId) actions.push({ spec, estado: 'conflito', motivo: 'id pertence a outra empresa' });
      else if (canonical(projeção(row, spec)) !== canonical(spec.conferir)) {
        actions.push({ spec, estado: 'conflito', motivo: 'registro nativo divergiu; edição local preservada' });
      } else if (records[spec.chave] && records[spec.chave].origemHash !== spec.origemHash) {
        actions.push({ spec, estado: 'conflito', motivo: 'origem mudou desde o último snapshot; reconciliação manual' });
      } else actions.push({ spec, estado: 'igual' });
      continue;
    }
    actions.push({ spec, estado: 'criar' });
  }
  return actions;
}

async function criar(db: Db, s: Spec) {
  const data = { id: s.id, ...s.dados } as never;
  switch (s.tipo) {
    case 'folder': await db.workFolder.create({ data }); break;
    case 'list': await db.workList.create({ data }); break;
    case 'status': await db.workStatus.create({ data }); break;
    case 'field': await db.workField.create({ data }); break;
    case 'option': await db.workFieldOption.create({ data }); break;
    case 'tag': await db.workTag.create({ data }); break;
    case 'task': await db.workTask.create({ data }); break;
    case 'value': await db.workFieldValue.create({ data }); break;
    case 'comment': await db.workComment.create({ data }); break;
  }
}
function ordenar(value: unknown): unknown {
  if (Array.isArray(value)) {
    const sorted = value.map(ordenar);
    if (sorted.every((v) => v && typeof v === 'object' && 'id' in v))
      return sorted.sort((a, b) => String((a as { id: string }).id).localeCompare(String((b as { id: string }).id)));
    return sorted;
  }
  if (value && typeof value === 'object' && !(value instanceof Date))
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, ordenar(v)]));
  return value;
}

/** Abrange filhos e relações locais: rollback recusa edição, comentário ou task nova. */
async function capturar(db: Db, specs: Spec[]) {
  const ids = (tipo: Spec['tipo']) => specs.filter((s) => s.tipo === tipo).map((s) => s.id);
  const folders = await db.workFolder.findMany({ where: { id: { in: ids('folder') } }, include: { lists: { select: { id: true } } } });
  const lists = await db.workList.findMany({ where: { id: { in: ids('list') } }, include: {
    statuses: { select: { id: true } }, fields: { select: { id: true } }, tasks: { select: { id: true } },
  } });
  const statuses = await db.workStatus.findMany({ where: { id: { in: ids('status') } } });
  const fields = await db.workField.findMany({ where: { id: { in: ids('field') } }, include: {
    options: { select: { id: true } }, values: { select: { id: true } },
  } });
  const options = await db.workFieldOption.findMany({ where: { id: { in: ids('option') } } });
  const tags = await db.workTag.findMany({ where: { id: { in: ids('tag') } }, include: { tasks: { select: { id: true } } } });
  const tasks = await db.workTask.findMany({ where: { id: { in: ids('task') } }, include: {
    tags: { select: { id: true } }, values: true, comments: true, subtasks: { select: { id: true } },
    apontamentos: true, onboardingTrilhos: { select: { id: true } },
  } });
  const values = await db.workFieldValue.findMany({ where: { id: { in: ids('value') } } });
  const comments = await db.workComment.findMany({ where: { id: { in: ids('comment') } } });
  const audit = await db.auditLog.findMany({ where: {
    orgId: specs[0]?.conferir.orgId as string, entityType: 'work_task', entityId: { in: ids('task') },
  } });
  return ordenar({ folders, lists, statuses, fields, options, tags, tasks, values, comments, audit });
}

async function apagarCriados(db: Db, created: Record<string, string[]>) {
  // Reversão conservadora de uma transação de criação: nunca toca IDs anteriores.
  await db.workComment.deleteMany({ where: { id: { in: created.comment ?? [] } } });
  await db.workFieldValue.deleteMany({ where: { id: { in: created.value ?? [] } } });
  await db.workTask.deleteMany({ where: { id: { in: created.task ?? [] } } });
  await db.workFieldOption.deleteMany({ where: { id: { in: created.option ?? [] } } });
  await db.workField.deleteMany({ where: { id: { in: created.field ?? [] } } });
  await db.workStatus.deleteMany({ where: { id: { in: created.status ?? [] } } });
  await db.workList.deleteMany({ where: { id: { in: created.list ?? [] } } });
  await db.workFolder.deleteMany({ where: { id: { in: created.folder ?? [] } } });
  await db.workTag.deleteMany({ where: { id: { in: created.tag ?? [] } } });
}

/** Rollback é raro e destrutivo: bloqueia escritas que alterariam fingerprint/cascade até o COMMIT. */
async function trancarTabelasWork(tx: Prisma.TransactionClient) {
  await tx.$executeRawUnsafe(`LOCK TABLE "WorkFolder", "WorkList", "WorkStatus", "WorkField",
    "WorkFieldOption", "WorkTag", "WorkTask", "WorkFieldValue", "WorkComment",
    "WorkApontamento", "_WorkTaskTags", "OnboardingTrilho", "AuditLog"
    IN SHARE ROW EXCLUSIVE MODE`);
}

export async function fingerprintImportado(db: Db, specs: Spec[]): Promise<string> {
  return sha256(await capturar(db, specs));
}

export async function reverterLote(
  db: PrismaClient, specs: Spec[], created: Record<string, string[]>, postFingerprint: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await trancarTabelasWork(tx);
    const atual = await fingerprintImportado(tx, specs);
    if (atual !== postFingerprint) throw new Error('Rollback recusado: houve edição ou novo vínculo nativo após o import');
    await apagarCriados(tx, created);
  }, { isolationLevel: 'Serializable', timeout: 120000 });
}

async function main() {
  const opt = args();
  if (opt['--help']) { console.log(mensagemDeUso()); return; }
  if (typeof opt['--snapshot'] !== 'string') throw new Error(mensagemDeUso());
  if (opt['--offline'] && (opt['--apply'] || opt['--rollback'])) throw new Error('--offline só vale para dry-run');
  const raw = readFileSync(resolve(opt['--snapshot']), 'utf8');
  const snapshot = SnapshotSchema.parse(JSON.parse(raw));
  const validacao = validarSnapshot(snapshot);
  if (opt['--apply'] && !opt['--rollback'] && snapshot.tasks.some((t) => t.attachments.some((a) =>
    !a.localPath?.startsWith('/vault/90-OS/migrations/marketing-20260929/files/')))) {
    validacao.erros.push('apply exige binários no caminho persistente /vault/90-OS/migrations/marketing-20260929/files/');
  }
  const orgId = typeof opt['--org-id'] === 'string' ? opt['--org-id'] : null;
  if ((opt['--apply'] || opt['--rollback']) && !orgId) throw new Error('--org-id é obrigatório para apply/rollback');
  if (orgId && !uuid(orgId)) throw new Error('--org-id precisa ser UUID');
  const inventario = orgId && !validacao.erros.length ? inventariar(snapshot, orgId, validacao.caminhos) : null;
  const resumo = {
    mode: opt['--rollback'] ? 'rollback' : opt['--apply'] ? 'apply' : opt['--offline'] ? 'offline-dry-run' : 'dry-run',
    snapshot: basename(resolve(opt['--snapshot'])), snapshotSha256: createHash('sha256').update(raw).digest('hex'),
    spaceId: snapshot.spaceId, scopeListIds: snapshot.scope.listIds,
    counts: { folders: snapshot.folders.length, lists: snapshot.lists.length, tasks: snapshot.tasks.length,
      comments: snapshot.tasks.reduce((n, t) => n + t.comments.length, 0),
      attachments: snapshot.tasks.reduce((n, t) => n + t.attachments.length, 0),
      checklists: snapshot.tasks.reduce((n, t) => n + t.checklists.length, 0),
      dependencies: snapshot.tasks.reduce((n, t) => n + t.dependencies.length, 0) },
    byList: snapshot.lists.map((l) => {
      const tasks = snapshot.tasks.filter((t) => t.listId === l.id);
      return { id: l.id, name: l.name, path: validacao.caminhos.get(l.id) ?? null,
        tasks: tasks.length, byStatus: l.statuses.map((s) => ({ id: s.id, name: s.name,
          tasks: tasks.filter((t) => t.statusId === s.id).length })),
        comments: tasks.reduce((n, t) => n + t.comments.length, 0),
        attachments: tasks.reduce((n, t) => n + t.attachments.length, 0),
        checklistsOnlyInSnapshot: tasks.reduce((n, t) => n + t.checklists.length, 0),
        dependenciesOnlyInSnapshot: tasks.reduce((n, t) => n + t.dependencies.length, 0),
      };
    }),
    errors: validacao.erros, warnings: [...validacao.avisos, ...(inventario?.avisos ?? [])],
  };
  if (!orgId || opt['--offline'] || validacao.erros.length) {
    console.log(JSON.stringify(resumo, null, 2));
    if (validacao.erros.length) process.exitCode = 2;
    return;
  }
  if (typeof opt['--manifest-dir'] !== 'string') throw new Error('--manifest-dir é obrigatório com --org-id');
  const dir = resolve(opt['--manifest-dir']);
  const manifestPath = join(dir, nomeManifesto(orgId, snapshot.spaceId, snapshot.scope.listIds));
  const manifest = lerManifesto(manifestPath) ?? {
    schemaVersion: 1 as const, source: 'clickup' as const, orgId, spaceId: snapshot.spaceId,
    scopeListIds: [...snapshot.scope.listIds].sort(), records: {}, attachments: {}, runs: [],
  };
  if (manifest.orgId !== orgId || manifest.spaceId !== snapshot.spaceId ||
      canonical(manifest.scopeListIds) !== canonical([...snapshot.scope.listIds].sort())) {
    throw new Error('Escopo do manifesto não coincide com snapshot/org');
  }
  const db = new PrismaClient();
  try {
    // Arquivos externos podem desaparecer depois do apply. Isso não deve impedir rollback do banco.
    const errosArquivos = opt['--rollback'] ? [] : await verificarArquivos(snapshot.tasks);
    const org = await db.org.findUnique({ where: { id: orgId }, select: { id: true } });
    if (!org) throw new Error('Org inexistente; nenhuma escrita feita');
    const actions = await planejar(db, inventario!.specs, manifest.records);
    const conflitos = actions.filter((a) => a.estado === 'conflito').map((a) => `${a.spec.chave}: ${a.motivo}`);
    const plano = { ...resumo, attachmentFileErrors: errosArquivos, toCreate: actions.filter((a) => a.estado === 'criar').length,
      alreadySame: actions.filter((a) => a.estado === 'igual').length, conflicts: conflitos };
    if (!opt['--apply'] && !opt['--rollback']) { console.log(JSON.stringify(plano, null, 2)); if (validacao.erros.length || conflitos.length || errosArquivos.length) process.exitCode = 2; return; }
    if (validacao.erros.length) throw new Error(`Snapshot incompleto: ${validacao.erros.join('; ')}`);
    if (errosArquivos.length) throw new Error(`Anexos não conferem: ${errosArquivos.join('; ')}`);
      if (opt['--rollback'] && !opt['--apply']) {
      const last = [...manifest.runs].reverse().find((r) => !r.rolledBackAt);
      if (!last) throw new Error('Nenhum lote ativo para reverter');
      if (resumo.snapshotSha256 !== last.snapshotSha256) throw new Error('Rollback exige o snapshot exato do último lote ativo');
      const atual = await fingerprintImportado(db, inventario!.specs);
      const estado = classificarRollback(atual, last);
      console.log(JSON.stringify({ ...plano, rollbackSafe: estado === 'pronto',
        alreadyRolledBack: estado === 'ja-revertido', rollbackRun: last.at,
        reason: estado !== 'divergente' ? null : 'lote alterado; reversão recusada' }, null, 2));
      if (estado === 'divergente') process.exitCode = 2;
      return;
    }
    validarDiretorio(dir);
    await trancar(manifestPath, async () => {
      if (canonical(lerManifesto(manifestPath)) !== canonical(existsSync(manifestPath) ? manifest : null)) {
        throw new Error('Manifesto mudou durante o planejamento; rode o dry-run outra vez');
      }
      if (opt['--rollback']) {
        const last = [...manifest.runs].reverse().find((r) => !r.rolledBackAt);
        if (!last) throw new Error('Nenhum lote ativo para reverter');
        if (resumo.snapshotSha256 !== last.snapshotSha256) throw new Error('Rollback exige o snapshot exato do último lote ativo');
        const atual = await fingerprintImportado(db, inventario!.specs);
        if (classificarRollback(atual, last) === 'ja-revertido') {
          // Crash após COMMIT do delete e antes de gravar o manifesto: não excluir outra vez.
          last.rolledBackAt = new Date().toISOString();
          salvarAtomico(manifestPath, manifest);
          console.log(JSON.stringify({ ...plano, alreadyRolledBack: true, manifestReconciled: true }, null, 2));
          return;
        }
        await reverterLote(db, inventario!.specs, last.created, last.postFingerprint);
        last.rolledBackAt = new Date().toISOString();
        salvarAtomico(manifestPath, manifest);
        console.log(JSON.stringify({ ...plano, rolledBack: last.created }, null, 2));
        return;
      }
      if (conflitos.length) throw new Error(`Apply recusado: ${conflitos.join('; ')}`);
      const criarAgora = actions.filter((a) => a.estado === 'criar');
      const sha = resumo.snapshotSha256;
      const snapshotFile = join(dir, `clickup-work-${sha}.snapshot.json`);
      if (!criarAgora.length) {
        // Pode ser reexecução normal ou queda entre COMMIT e escrita do manifesto.
        // Reconstituímos o mapa sem duplicar. Sem prova do que nasceu aqui,
        // recuperação sem manifesto não oferece rollback automático.
        await db.$transaction(async (tx) => {
          const atual = await planejar(tx, inventario!.specs, manifest.records);
          if (atual.some((a) => a.estado !== 'igual')) {
            throw new Error('Banco mudou durante o planejamento; rode o dry-run outra vez');
          }
        }, { isolationLevel: 'Serializable', timeout: 120000 });
        arquivoNovo(snapshotFile, raw);
        preencherManifesto(manifest, inventario!.specs, snapshot.tasks);
        if (!existsSync(manifestPath)) manifest.recoveredAt = new Date().toISOString();
        salvarAtomico(manifestPath, manifest);
        console.log(JSON.stringify({ ...plano, noOp: true, recoveredWithoutRollback: !!manifest.recoveredAt, manifestPath }, null, 2));
        return;
      }
      const backupFile = join(dir, `clickup-work-${Date.now()}-${sha.slice(0, 12)}.pre-apply.json`);
      // O snapshot integral e o estado anterior existem ANTES de qualquer INSERT.
      arquivoNovo(snapshotFile, raw);
      const antes = await capturar(db, inventario!.specs);
      const preFingerprint = sha256(antes);
      arquivoNovo(backupFile, JSON.stringify({ orgId, snapshotSha256: sha, capturedAt: new Date().toISOString(),
        plan: criarAgora.map((a) => ({ key: a.spec.chave, id: a.spec.id })), before: antes,
        previousManifest: manifest }, null, 2) + '\n');
      const { created, postFingerprint } = await db.$transaction(async (tx) => {
        const agora = await planejar(tx, inventario!.specs, manifest.records);
        if (canonical(agora.map((a) => [a.spec.chave, a.estado])) !== canonical(actions.map((a) => [a.spec.chave, a.estado]))) {
          throw new Error('Banco mudou durante o planejamento; rode o dry-run outra vez');
        }
        if (await fingerprintImportado(tx, inventario!.specs) !== preFingerprint) {
          throw new Error('Banco mudou após o backup; rode o dry-run outra vez');
        }
        for (const a of criarAgora) await criar(tx, a.spec);
        const created = Object.fromEntries(TIPOS.map((tipo) => [tipo, criarAgora.filter((a) => a.spec.tipo === tipo).map((a) => a.spec.id)]));
        return { created, postFingerprint: await fingerprintImportado(tx, inventario!.specs) };
      }, { isolationLevel: 'Serializable', timeout: 120000 });
      preencherManifesto(manifest, inventario!.specs, snapshot.tasks);
      manifest.runs.push({ at: new Date().toISOString(), snapshotFile, snapshotSha256: sha,
        backupFile, created, preFingerprint, postFingerprint });
      salvarAtomico(manifestPath, manifest);
      console.log(JSON.stringify({ ...plano, manifestPath, snapshotFile, backupFile, created }, null, 2));
    });
  } finally { await db.$disconnect(); }
}

if (require.main === module) main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
