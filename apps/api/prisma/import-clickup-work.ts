import { PrismaClient, type Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { closeSync, createReadStream, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { SnapshotSchema, VPS_FILES_ROOT, canonical, raizPermitidaDoAnexo, sha256, validarSnapshot } from './import-clickup-work.contract';
import { arvoreDoLote, inventariar, type ArvoreDoLote, type NoDaArvore, type PosicaoDaPasta, type Spec } from './import-clickup-work.plan';

// Uso e garantias: ver import-clickup-work.md. Esta CLI não é chamada pelo runtime.
type Db = PrismaClient | Prisma.TransactionClient;
type Acao = { spec: Spec; estado: 'criar' | 'igual' | 'conflito'; motivo?: string };
type Registro = { id: string; origemHash: string };
type Run = { at: string; snapshotFile: string; snapshotSha256: string; backupFile: string; created: Record<string, string[]>; preFingerprint: string; postFingerprint: string; rolledBackAt?: string };
type Posicao = { spaceId: string | null; parentId: string | null; externalId: string | null };
/** Registro da transformação em árvore. Os nós criados aqui não são do lote: o rollback não os apaga. */
type ArvoreRun = {
  at: string; snapshotSha256: string; nomeDoEspaco: string;
  criados: { space: string[]; folder: string[] };
  movidas: Array<{ id: string; antes: Posicao; depois: Posicao }>;
  fingerprint: string;
};
type Manifesto = {
  schemaVersion: 1; source: 'clickup'; orgId: string; spaceId: string; scopeListIds: string[];
  records: Record<string, Registro>;
  attachments: Record<string, Array<{ id: string; name: string; url: string | null; sha256: string | null; localPath: string | null; mimeType: string | null; size: number | null }>>;
  runs: Run[];
  recoveredAt?: string;
  arvore?: ArvoreRun[];
};
export type EstadoDoNo = { no: NoDaArvore; estado: 'criar' | 'igual' | 'conflito'; motivo?: string; aviso?: string };
export type EstadoDaPosicao = {
  posicao: PosicaoDaPasta; estado: 'mover' | 'igual' | 'conflito'; motivo?: string;
  antes?: Posicao & { updatedAt: Date };
};
export type PlanoDaArvore = { nos: EstadoDoNo[]; posicoes: EstadoDaPosicao[] };
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
  const flags = new Set(['--apply', '--rollback', '--arvore', '--offline', '--help']);
  const valores = new Set(['--snapshot', '--org-id', '--manifest-dir', '--nome-do-espaco']);
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
  return `Uso: pnpm --filter @mktos/api exec tsx prisma/import-clickup-work.ts --snapshot arquivo.json [--org-id UUID] [--manifest-dir DIR] [--offline] [--apply] [--rollback] [--arvore --nome-do-espaco NOME]\n` +
    `Padrão: dry-run, sem escrita. --offline valida contrato sem conectar ao banco. --apply exige org-id e manifest-dir. --rollback sem --apply só confere; --rollback --apply reverte o último lote intocado. ` +
    `--arvore sem --apply só confere; --arvore --apply põe a pasta do lote ativo dentro do espaço e das pastas-mãe da origem, sem mudar o fingerprint do lote.`;
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
      const raizDeste = raiz ?? raizPermitidaDoAnexo(path);
      if (!raizDeste) throw new Error('fora do vault permitido');
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
async function colisao(db: Db, s: Spec, existe: boolean): Promise<string | null> {
  const d = s.dados;
  let row: { id: string } | null = null;
  switch (s.tipo) {
    case 'folder': {
      // Errata E-1 da ROOT-16-REV: com homônimas permitidas em ramos diferentes, `(orgId, name)`
      // deixou de ser identidade, e o `findFirst` sem ordem devolvia a nativa ou a do lote
      // conforme a ordem física das linhas. A identidade agora é o id do ClickUp em `externalId`
      // ou, se a pasta ainda vai nascer, a posição onde ela nasceria, que o índice
      // `(orgId, spaceId, parentId, name)` torna única.
      const orgId = d.orgId as string;
      const onde: Prisma.WorkFolderWhereInput[] = [{ orgId, externalId: s.chave.slice('folder:'.length) }];
      if (!existe) {
        onde.push({ orgId, spaceId: (d.spaceId as string | undefined) ?? null, parentId: (d.parentId as string | undefined) ?? null, name: d.name as string });
      }
      const achadas = await db.workFolder.findMany({ where: { OR: onde }, select: { id: true }, orderBy: { id: 'asc' } });
      row = achadas.find((r) => r.id !== s.id) ?? null;
      break;
    }
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
    const row = await linha(db, spec);
    const collision = await colisao(db, spec, row !== null);
    if (collision) { actions.push({ spec, estado: 'conflito', motivo: collision }); continue; }
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
  /*
   * F-a (ROOT-16, contrato C-15): a captura lê as colunas que os 11 modelos tinham
   * em `1194a49`, quando o lote de 30/09 entrou, e não "todas as colunas". Assim
   * coluna nova (espaço, pasta-mãe, e as de qualquer fatia seguinte) não muda o
   * fingerprint gravado no manifesto, e o rollback automático do lote continua
   * valendo. O preço: edição só em coluna nova não bloqueia o rollback. Mudar
   * qualquer coluna desta lista numa linha do lote ainda bloqueia.
   */
  const PASTA = { id: true, orgId: true, name: true, order: true, createdAt: true, updatedAt: true } as const;
  const LISTA = { id: true, orgId: true, folderId: true, name: true, order: true, externalId: true, createdAt: true, updatedAt: true } as const;
  const ETAPA = { id: true, orgId: true, listId: true, name: true, type: true, color: true, order: true, limite: true } as const;
  const CAMPO = { id: true, orgId: true, listId: true, name: true, type: true, order: true } as const;
  const OPCAO = { id: true, orgId: true, fieldId: true, name: true, color: true, order: true } as const;
  const ETIQUETA = { id: true, orgId: true, name: true, color: true } as const;
  const TAREFA = {
    id: true, orgId: true, listId: true, statusId: true, title: true, description: true, priority: true,
    assignee: true, agenteId: true, agenteEm: true, statusDesde: true, dueDate: true, startDate: true,
    parentId: true, externalId: true, externalUrl: true, archived: true, order: true, createdAt: true, updatedAt: true,
  } as const;
  const VALOR = { id: true, orgId: true, taskId: true, fieldId: true, optionId: true, value: true } as const;
  const COMENTARIO = { id: true, orgId: true, taskId: true, authorId: true, authorName: true, text: true, createdAt: true } as const;
  const APONTAMENTO = {
    id: true, orgId: true, taskId: true, autorId: true, autorNome: true, minutos: true, dia: true, etapa: true, nota: true, createdAt: true,
  } as const;
  const AUDITORIA = {
    id: true, orgId: true, actorType: true, actorId: true, action: true, entityType: true, entityId: true,
    before: true, after: true, ip: true, metadata: true, createdAt: true,
  } as const;
  const ids = (tipo: Spec['tipo']) => specs.filter((s) => s.tipo === tipo).map((s) => s.id);
  const pastas = await db.workFolder.findMany({ where: { id: { in: ids('folder') } }, select: { ...PASTA, lists: { select: { id: true } } } });
  // Condição 2 da ROOT-16-REV: pasta criada dentro da pasta do lote prende o rollback (a
  // chave da pasta-mãe é RESTRICT). A filha entra na captura só quando existe, para o hash
  // do lote sem filhas continuar o de 30/09.
  const filhas = await db.workFolder.findMany({ where: { parentId: { in: ids('folder') } }, select: { id: true, parentId: true } });
  const folders = pastas.map((p) => {
    const delas = filhas.filter((f) => f.parentId === p.id).map((f) => ({ id: f.id }));
    return delas.length ? { ...p, children: delas } : p;
  });
  const lists = await db.workList.findMany({ where: { id: { in: ids('list') } }, select: {
    ...LISTA, statuses: { select: { id: true } }, fields: { select: { id: true } }, tasks: { select: { id: true } },
  } });
  const statuses = await db.workStatus.findMany({ where: { id: { in: ids('status') } }, select: ETAPA });
  const fields = await db.workField.findMany({ where: { id: { in: ids('field') } }, select: {
    ...CAMPO, options: { select: { id: true } }, values: { select: { id: true } },
  } });
  const options = await db.workFieldOption.findMany({ where: { id: { in: ids('option') } }, select: OPCAO });
  const tags = await db.workTag.findMany({ where: { id: { in: ids('tag') } }, select: { ...ETIQUETA, tasks: { select: { id: true } } } });
  const tasks = await db.workTask.findMany({ where: { id: { in: ids('task') } }, select: {
    ...TAREFA, tags: { select: { id: true } }, values: { select: VALOR }, comments: { select: COMENTARIO },
    subtasks: { select: { id: true } }, apontamentos: { select: APONTAMENTO }, onboardingTrilhos: { select: { id: true } },
  } });
  const values = await db.workFieldValue.findMany({ where: { id: { in: ids('value') } }, select: VALOR });
  const comments = await db.workComment.findMany({ where: { id: { in: ids('comment') } }, select: COMENTARIO });
  const audit = await db.auditLog.findMany({ where: {
    orgId: specs[0]?.conferir.orgId as string, entityType: 'work_task', entityId: { in: ids('task') },
  }, select: AUDITORIA });
  const externos = await vinculosExternos(db, specs);
  return ordenar({ folders, lists, statuses, fields, options, tags, tasks, values, comments, audit,
    ...(externos.length ? { vinculosExternos: externos } : {}) });
}

const TABELA_DO_TIPO: Record<Spec['tipo'], string> = {
  folder: 'WorkFolder', list: 'WorkList', status: 'WorkStatus', field: 'WorkField', option: 'WorkFieldOption',
  tag: 'WorkTag', task: 'WorkTask', value: 'WorkFieldValue', comment: 'WorkComment',
};
/**
 * As chaves estrangeiras para as tabelas do lote que `capturar()` já lê pelas relações
 * (ou, `statusId` e `optionId`, que só ligam linhas do próprio lote pelo serviço).
 * Qualquer outra é vínculo externo.
 */
const RELACOES_DA_CAPTURA = new Set([
  'WorkFolder.parentId', 'WorkList.folderId', 'WorkStatus.listId', 'WorkField.listId', 'WorkFieldOption.fieldId',
  'WorkTask.listId', 'WorkTask.statusId', 'WorkTask.parentId', 'WorkFieldValue.taskId', 'WorkFieldValue.fieldId',
  'WorkFieldValue.optionId', 'WorkComment.taskId', 'WorkApontamento.taskId', 'OnboardingTrilho.cardId',
  '_WorkTaskTags.A', '_WorkTaskTags.B',
]);
type ChaveExterna = { restricao: string; tabela: string; coluna: string; alvo: string };
const identificador = (nome: string) => `"${nome.replace(/"/g, '""')}"`;

/** Lidas do catálogo: a tabela que entra depois (a PR35 traz duas) aparece sem mudar este arquivo. */
async function chavesExternas(db: Db): Promise<ChaveExterna[]> {
  const fks = await db.$queryRaw<ChaveExterna[]>`
    SELECT c.conname AS restricao, t.relname AS tabela, a.attname AS coluna, r.relname AS alvo
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_class r ON r.oid = c.confrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      CROSS JOIN LATERAL unnest(c.conkey, c.confkey) AS k(col, fcol)
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.col
      JOIN pg_attribute fa ON fa.attrelid = c.confrelid AND fa.attnum = k.fcol
     WHERE c.contype = 'f' AND n.nspname = current_schema()
       AND r.relname = ANY(${Object.values(TABELA_DO_TIPO)}) AND fa.attname = 'id'
     ORDER BY 1, 2, 3`;
  return fks.filter((fk) => !RELACOES_DA_CAPTURA.has(`${fk.tabela}.${fk.coluna}`));
}

/**
 * Errata E-2 da ROOT-16-REV: relação que a captura fixa não lê e que aponta para linha do
 * lote fazia o dry-run dizer "pronto" com o rollback fadado a cair na chave (RESTRICT) ou,
 * com CASCADE, a apagar linha nativa sem aviso. Entra só quando há linha apontando, então
 * o hash de 30/09 não muda enquanto ninguém criar o vínculo.
 */
async function vinculosExternos(db: Db, specs: Spec[]) {
  const out: Array<{ restricao: string; tabela: string; coluna: string; linhas: number }> = [];
  for (const fk of await chavesExternas(db)) {
    const tipo = (Object.keys(TABELA_DO_TIPO) as Spec['tipo'][]).find((t) => TABELA_DO_TIPO[t] === fk.alvo)!;
    const alvos = specs.filter((s) => s.tipo === tipo).map((s) => s.id);
    if (!alvos.length) continue;
    const [{ linhas }] = await db.$queryRawUnsafe<Array<{ linhas: number }>>(
      `SELECT count(*)::int AS linhas FROM ${identificador(fk.tabela)} WHERE ${identificador(fk.coluna)} = ANY($1::text[])`, alvos);
    if (linhas > 0) out.push({ restricao: fk.restricao, tabela: fk.tabela, coluna: fk.coluna, linhas });
  }
  return out;
}

/** O que a captura viu além do lote: pastas dentro das do lote e vínculos externos. */
function vinculosNovos(capturado: unknown) {
  const c = capturado as {
    folders: Array<{ id: string; children?: Array<{ id: string }> }>;
    vinculosExternos?: Array<{ restricao: string; tabela: string; coluna: string; linhas: number }>;
  };
  return {
    childFolders: c.folders.flatMap((f) => (f.children ?? []).map((x) => ({ folder: f.id, child: x.id }))),
    external: c.vinculosExternos ?? [],
  };
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

async function tabelasExternas(db: Db): Promise<string[]> {
  return [...new Set((await chavesExternas(db)).map((fk) => identificador(fk.tabela)))];
}

/**
 * Rollback é raro e destrutivo: bloqueia escritas que alterariam fingerprint/cascade até o COMMIT.
 * As tabelas dos vínculos externos entram também, senão um vínculo criado entre a captura e
 * o DELETE passaria sem ser visto.
 */
async function trancarTabelasWork(tx: Prisma.TransactionClient, externas: string[]) {
  // O catálogo é lido antes da transação para este LOCK ser a primeira instrução: o snapshot serializável nasce depois de todos os locks (A-1).
  await tx.$executeRawUnsafe(`LOCK TABLE "WorkFolder", "WorkList", "WorkStatus", "WorkField",
    "WorkFieldOption", "WorkTag", "WorkTask", "WorkFieldValue", "WorkComment",
    "WorkApontamento", "_WorkTaskTags", "OnboardingTrilho", "AuditLog"${externas.map((t) => `, ${t}`).join('')}
    IN SHARE ROW EXCLUSIVE MODE`);
}

export async function fingerprintImportado(db: Db, specs: Spec[]): Promise<string> {
  return sha256(await capturar(db, specs));
}

export async function reverterLote(
  db: PrismaClient, specs: Spec[], created: Record<string, string[]>, postFingerprint: string,
): Promise<void> {
  const externas = await tabelasExternas(db);
  await db.$transaction(async (tx) => {
    await trancarTabelasWork(tx, externas);
    const atual = await fingerprintImportado(tx, specs);
    if (atual !== postFingerprint) throw new Error('Rollback recusado: houve edição ou novo vínculo nativo após o import');
    await apagarCriados(tx, created);
  }, { isolationLevel: 'Serializable', timeout: 120000 });
}

/*
 * A TRANSFORMAÇÃO EM ÁRVORE (ROOT-17, decisão F-a estendida).
 *
 * Cria o espaço e as pastas-mãe que faltam e grava a posição da pasta do lote só em colunas
 * novas, devolvendo o `updatedAt` lido: sem isso o Prisma carimbaria a hora e o fingerprint
 * do lote mudaria. Nome, ordem e listas da pasta do lote ficam como em 30/09, então o
 * rollback automático continua valendo; ele apaga as linhas do lote e, com elas, a posição.
 */
export async function planejarArvore(db: Db, arvore: ArvoreDoLote, specs: Spec[]): Promise<PlanoDaArvore> {
  const nos: EstadoDoNo[] = [];
  for (const no of arvore.nos) nos.push(await estadoDoNo(db, no));
  const posicoes: EstadoDaPosicao[] = [];
  for (const posicao of arvore.posicoes) {
    const spec = specs.find((s) => s.chave === posicao.chave);
    posicoes.push(spec ? await estadoDaPosicao(db, posicao, spec) : { posicao, estado: 'conflito', motivo: 'pasta sem spec no lote' });
  }
  return { nos, posicoes };
}

async function estadoDoNo(db: Db, no: NoDaArvore): Promise<EstadoDoNo> {
  const { orgId, name } = no.dados;
  const spaceId = no.dados.spaceId ?? null;
  const parentId = no.dados.parentId ?? null;
  const row: { orgId: string; name: string; externalId: string | null; spaceId?: string | null; parentId?: string | null } | null =
    no.tipo === 'space'
      ? await db.workSpace.findUnique({ where: { id: no.id }, select: { orgId: true, name: true, externalId: true } })
      : await db.workFolder.findUnique({ where: { id: no.id }, select: { orgId: true, name: true, externalId: true, spaceId: true, parentId: true } });
  if (row) {
    if (row.orgId !== orgId) return { no, estado: 'conflito', motivo: 'id pertence a outra empresa' };
    if (row.externalId !== no.externalId) return { no, estado: 'conflito', motivo: `externalId atual ${row.externalId ?? 'nulo'}; a árvore pede ${no.externalId}` };
    // Depois de criado o nó é nativo: renomear ou mover é decisão de quem usa, não conflito.
    const mudou = [
      row.name !== name ? `nome atual "${row.name}"` : null,
      no.tipo === 'folder' && (row.spaceId !== spaceId || row.parentId !== parentId) ? 'em outro lugar da árvore' : null,
    ].filter(Boolean);
    return { no, estado: 'igual', ...(mudou.length ? { aviso: `${mudou.join(', ')}; fica como está` } : {}) };
  }
  const outra = no.tipo === 'space'
    ? await db.workSpace.findMany({ where: { orgId, OR: [{ name }, { externalId: no.externalId }] }, select: { id: true }, orderBy: { id: 'asc' } })
    : await db.workFolder.findMany({ where: { orgId, OR: [{ spaceId, parentId, name }, { externalId: no.externalId }] }, select: { id: true }, orderBy: { id: 'asc' } });
  return outra.length ? { no, estado: 'conflito', motivo: `identidade nativa existente ${outra[0].id}` } : { no, estado: 'criar' };
}

async function estadoDaPosicao(db: Db, posicao: PosicaoDaPasta, spec: Spec): Promise<EstadoDaPosicao> {
  const conflito = (motivo: string): EstadoDaPosicao => ({ posicao, estado: 'conflito', motivo });
  const row = await db.workFolder.findUnique({ where: { id: posicao.id } });
  if (!row) return conflito('a pasta do lote não existe; aplique o lote antes da árvore');
  if (canonical(projeção(row, spec)) !== canonical(spec.conferir)) return conflito('a pasta do lote divergiu do snapshot; reconcilie antes da árvore');
  const antes = { spaceId: row.spaceId, parentId: row.parentId, externalId: row.externalId, updatedAt: row.updatedAt };
  if (row.spaceId === posicao.spaceId && row.parentId === posicao.parentId && row.externalId === posicao.externalId) {
    return { posicao, estado: 'igual', antes };
  }
  if (row.spaceId !== null || row.parentId !== null || row.externalId !== null) {
    return conflito('a pasta do lote já está em outro lugar da árvore; mova à mão ou reconcilie');
  }
  const orgId = row.orgId;
  const outra = await db.workFolder.findMany({ where: { id: { not: posicao.id }, orgId, OR: [
    { externalId: posicao.externalId }, { spaceId: posicao.spaceId, parentId: posicao.parentId, name: row.name },
  ] }, select: { id: true }, orderBy: { id: 'asc' } });
  if (outra.length) return conflito(`identidade nativa existente ${outra[0].id}`);
  for (let mae = posicao.parentId, passos = 0; mae; passos++) {
    if (mae === posicao.id || passos > 1000) return conflito('a pasta-mãe está dentro da pasta do lote');
    mae = (await db.workFolder.findUnique({ where: { id: mae }, select: { parentId: true } }))?.parentId ?? null;
  }
  return { posicao, estado: 'mover', antes };
}

const resumoDoPlano = (p: PlanoDaArvore) => ({
  nos: p.nos.map((n) => [n.no.chave, n.no.id, n.estado]),
  posicoes: p.posicoes.map((x) => [x.posicao.id, x.estado, x.antes?.updatedAt.toISOString() ?? null]),
});

export async function transformarEmArvore(
  db: PrismaClient, specs: Spec[], arvore: ArvoreDoLote, esperado: { fingerprint: string; plano: PlanoDaArvore },
): Promise<{ criados: ArvoreRun['criados']; movidas: ArvoreRun['movidas']; fingerprint: string }> {
  const orgId = specs[0]?.conferir.orgId as string;
  const externas = await tabelasExternas(db);
  return db.$transaction(async (tx) => {
    await trancarTabelasWork(tx, externas);
    // O mesmo cadeado que o serviço toma para mover pasta para dentro de outra (ciclo).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`work-arvore:${orgId}`}))`;
    if (await fingerprintImportado(tx, specs) !== esperado.fingerprint) {
      throw new Error('Banco mudou durante o planejamento; rode o dry-run outra vez');
    }
    const plano = await planejarArvore(tx, arvore, specs);
    if (canonical(resumoDoPlano(plano)) !== canonical(resumoDoPlano(esperado.plano))) {
      throw new Error('Banco mudou durante o planejamento; rode o dry-run outra vez');
    }
    const conflitos = [...plano.nos, ...plano.posicoes].filter((x) => x.estado === 'conflito');
    if (conflitos.length) throw new Error(`Árvore recusada: ${conflitos.map((x) => x.motivo).join('; ')}`);
    const criados: ArvoreRun['criados'] = { space: [], folder: [] };
    for (const { no } of plano.nos.filter((n) => n.estado === 'criar')) {
      const { orgId: org, name, externalId, order, spaceId = null, parentId = null } = no.dados;
      if (no.tipo === 'space') await tx.workSpace.create({ data: { id: no.id, orgId: org, name, externalId, order } });
      else await tx.workFolder.create({ data: { id: no.id, orgId: org, name, externalId, order, spaceId, parentId } });
      criados[no.tipo].push(no.id);
    }
    const movidas: ArvoreRun['movidas'] = [];
    for (const { posicao, antes } of plano.posicoes.filter((x) => x.estado === 'mover')) {
      const depois = { spaceId: posicao.spaceId, parentId: posicao.parentId, externalId: posicao.externalId };
      const { count } = await tx.workFolder.updateMany({
        where: { id: posicao.id, orgId, spaceId: null, parentId: null, externalId: null, updatedAt: antes!.updatedAt },
        data: { ...depois, updatedAt: antes!.updatedAt },
      });
      if (count !== 1) throw new Error('A pasta do lote mudou durante a transformação; nada gravado');
      movidas.push({ id: posicao.id, antes: { spaceId: null, parentId: null, externalId: null }, depois });
    }
    const fingerprint = await fingerprintImportado(tx, specs);
    if (fingerprint !== esperado.fingerprint) {
      throw new Error('A árvore mudaria o fingerprint do lote; nada gravado');
    }
    return { criados, movidas, fingerprint };
  }, { isolationLevel: 'Serializable', timeout: 120000 });
}

/** Nós que a árvore criou: o rollback apaga as linhas do lote e a posição delas, não estes. */
function nosQueFicam(manifest: Manifesto) {
  const ids = [...new Set((manifest.arvore ?? []).flatMap((r) => [...r.criados.space, ...r.criados.folder]))];
  return ids.length ? { treeNodesKept: ids } : {};
}

async function passoDaArvore(
  db: PrismaClient, opt: Record<string, string | boolean>, snapshot: ReturnType<typeof SnapshotSchema.parse>, orgId: string,
  specs: Spec[], manifest: Manifesto, manifestPath: string, dir: string, plano: Record<string, unknown> & { snapshotSha256: string },
) {
  const arvore = arvoreDoLote(snapshot, orgId, opt['--nome-do-espaco'] as string);
  const last = [...manifest.runs].reverse().find((r) => !r.rolledBackAt);
  if (!last) throw new Error('Nenhum lote ativo; aplique o lote antes da árvore');
  if (plano.snapshotSha256 !== last.snapshotSha256) throw new Error('A árvore exige o snapshot exato do último lote ativo');
  const fingerprint = await fingerprintImportado(db, specs);
  const planoDaArvore = await planejarArvore(db, arvore, specs);
  const conflitos = [
    ...planoDaArvore.nos.filter((n) => n.estado === 'conflito').map((n) => `${n.no.chave}: ${n.motivo}`),
    ...planoDaArvore.posicoes.filter((x) => x.estado === 'conflito').map((x) => `${x.posicao.chave}: ${x.motivo}`),
  ];
  const saida = {
    ...plano,
    tree: {
      spaceName: arvore.nos[0].dados.name,
      nodes: planoDaArvore.nos.map((n) => ({ key: n.no.chave, id: n.no.id, kind: n.no.tipo, name: n.no.dados.name,
        spaceId: n.no.dados.spaceId ?? null, parentId: n.no.dados.parentId ?? null, state: n.estado,
        reason: n.motivo ?? null, warning: n.aviso ?? null })),
      positions: planoDaArvore.posicoes.map((x) => ({ key: x.posicao.chave, id: x.posicao.id, spaceId: x.posicao.spaceId,
        parentId: x.posicao.parentId, externalId: x.posicao.externalId, state: x.estado, reason: x.motivo ?? null })),
      conflicts: conflitos,
    },
    fingerprint, rollbackBefore: classificarRollback(fingerprint, last),
  };
  if (!opt['--apply']) {
    console.log(JSON.stringify(saida, null, 2));
    if (conflitos.length) process.exitCode = 2;
    return;
  }
  if (conflitos.length) throw new Error(`Árvore recusada: ${conflitos.join('; ')}`);
  if (!planoDaArvore.nos.some((n) => n.estado === 'criar') && !planoDaArvore.posicoes.some((x) => x.estado === 'mover')) {
    console.log(JSON.stringify({ ...saida, noOp: true }, null, 2));
    return;
  }
  validarDiretorio(dir);
  await trancar(manifestPath, async () => {
    if (canonical(lerManifesto(manifestPath)) !== canonical(manifest)) {
      throw new Error('Manifesto mudou durante o planejamento; rode o dry-run outra vez');
    }
    const r = await transformarEmArvore(db, specs, arvore, { fingerprint, plano: planoDaArvore });
    manifest.arvore = [...(manifest.arvore ?? []), {
      at: new Date().toISOString(), snapshotSha256: plano.snapshotSha256, nomeDoEspaco: arvore.nos[0].dados.name, ...r,
    }];
    salvarAtomico(manifestPath, manifest);
    console.log(JSON.stringify({ ...saida, created: r.criados, moved: r.movidas, fingerprintAfter: r.fingerprint,
      rollbackAfter: classificarRollback(r.fingerprint, last), manifestPath }, null, 2));
  });
}

async function main() {
  const opt = args();
  if (opt['--help']) { console.log(mensagemDeUso()); return; }
  if (typeof opt['--snapshot'] !== 'string') throw new Error(mensagemDeUso());
  if (opt['--offline'] && (opt['--apply'] || opt['--rollback'] || opt['--arvore'])) throw new Error('--offline só vale para dry-run');
  if (opt['--arvore'] && opt['--rollback']) throw new Error('--arvore e --rollback são passos separados');
  if (Boolean(opt['--arvore']) !== (typeof opt['--nome-do-espaco'] === 'string')) throw new Error('--arvore e --nome-do-espaco andam juntos');
  const raw = readFileSync(resolve(opt['--snapshot']), 'utf8');
  const snapshot = SnapshotSchema.parse(JSON.parse(raw));
  const validacao = validarSnapshot(snapshot);
  if (opt['--apply'] && !opt['--rollback'] && !opt['--arvore'] && snapshot.tasks.some((t) => t.attachments.some((a) =>
    !a.localPath?.startsWith(VPS_FILES_ROOT)))) {
    validacao.erros.push('apply exige binários no caminho persistente /vault/90-OS/migrations/marketing-20260929/files/');
  }
  const orgId = typeof opt['--org-id'] === 'string' ? opt['--org-id'] : null;
  if ((opt['--apply'] || opt['--rollback'] || opt['--arvore']) && !orgId) throw new Error('--org-id é obrigatório para apply/rollback/arvore');
  if (orgId && !uuid(orgId)) throw new Error('--org-id precisa ser UUID');
  const inventario = orgId && !validacao.erros.length ? inventariar(snapshot, orgId, validacao.caminhos) : null;
  const resumo = {
    mode: opt['--arvore'] ? (opt['--apply'] ? 'tree-apply' : 'tree-dry-run')
      : opt['--rollback'] ? 'rollback' : opt['--apply'] ? 'apply' : opt['--offline'] ? 'offline-dry-run' : 'dry-run',
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
    // Arquivos externos podem desaparecer depois do apply. Isso não deve impedir rollback do
    // banco, nem a árvore, que não toca em anexo.
    const errosArquivos = opt['--rollback'] || opt['--arvore'] ? [] : await verificarArquivos(snapshot.tasks);
    const org = await db.org.findUnique({ where: { id: orgId }, select: { id: true } });
    if (!org) throw new Error('Org inexistente; nenhuma escrita feita');
    const actions = await planejar(db, inventario!.specs, manifest.records);
    const conflitos = actions.filter((a) => a.estado === 'conflito').map((a) => `${a.spec.chave}: ${a.motivo}`);
    const plano = { ...resumo, attachmentFileErrors: errosArquivos, toCreate: actions.filter((a) => a.estado === 'criar').length,
      alreadySame: actions.filter((a) => a.estado === 'igual').length, conflicts: conflitos };
    if (opt['--arvore']) { await passoDaArvore(db, opt, snapshot, orgId, inventario!.specs, manifest, manifestPath, dir, plano); return; }
    if (!opt['--apply'] && !opt['--rollback']) { console.log(JSON.stringify(plano, null, 2)); if (validacao.erros.length || conflitos.length || errosArquivos.length) process.exitCode = 2; return; }
    if (validacao.erros.length) throw new Error(`Snapshot incompleto: ${validacao.erros.join('; ')}`);
    if (errosArquivos.length) throw new Error(`Anexos não conferem: ${errosArquivos.join('; ')}`);
      if (opt['--rollback'] && !opt['--apply']) {
      const last = [...manifest.runs].reverse().find((r) => !r.rolledBackAt);
      if (!last) throw new Error('Nenhum lote ativo para reverter');
      if (resumo.snapshotSha256 !== last.snapshotSha256) throw new Error('Rollback exige o snapshot exato do último lote ativo');
      const capturado = await capturar(db, inventario!.specs);
      const estado = classificarRollback(sha256(capturado), last);
      const novos = vinculosNovos(capturado);
      console.log(JSON.stringify({ ...plano, rollbackSafe: estado === 'pronto',
        alreadyRolledBack: estado === 'ja-revertido', rollbackRun: last.at,
        reason: estado !== 'divergente' ? null : 'lote alterado; reversão recusada',
        ...(novos.childFolders.length || novos.external.length ? { newLinks: novos } : {}),
        ...nosQueFicam(manifest) }, null, 2));
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
        console.log(JSON.stringify({ ...plano, rolledBack: last.created, ...nosQueFicam(manifest) }, null, 2));
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
