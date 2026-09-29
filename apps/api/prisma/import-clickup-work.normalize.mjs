#!/usr/bin/env node
// Converte o export read-only ClickUp do lote ROOT Marketing para o contrato v1.
// Gera duas variantes de path do mesmo conteúdo; jamais conecta ao banco.
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = '/private/tmp/root-os-migration-20260929';
const VAULT = '/vault/90-OS/migrations/marketing-20260929';
const IDS = ['901328341442', '901328341443', '901328341445', '901328341450',
  '901328341456', '901328341455', '901328341451'];
const PASTA_PAI = '901318536003';
const PASTA_MARKETING = '901318837280';
const SPACE = '901313864063';
const ORG = '63cdd80e-0435-488d-98b5-c2653d235e50';

function args() {
  const opts = { tasks: join(ROOT, 'raw-tasks.json'), lists: join(ROOT, 'raw-lists.json'),
    files: join(ROOT, 'files.json'), outputDir: ROOT, expectedFiles: 20, expectedTasks: 70 };
  const keys = { '--raw-tasks': 'tasks', '--raw-lists': 'lists', '--files': 'files', '--output-dir': 'outputDir', '--expected-files': 'expectedFiles', '--expected-tasks': 'expectedTasks' };
  for (let i = 2; i < process.argv.length; i++) {
    const key = keys[process.argv[i]];
    if (!key || !process.argv[i + 1]) throw new Error(`Argumento inválido: ${process.argv[i]}`);
    opts[key] = process.argv[++i];
  }
  opts.expectedFiles = Number(opts.expectedFiles);
  opts.expectedTasks = Number(opts.expectedTasks);
  if (!Number.isSafeInteger(opts.expectedFiles) || opts.expectedFiles < 0) throw new Error('Contagem esperada de arquivos inválida');
  if (!Number.isSafeInteger(opts.expectedTasks) || opts.expectedTasks < 0) throw new Error('Contagem esperada de tarefas inválida');
  return opts;
}
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const iso = (v) => v == null ? null : new Date(Number(v)).toISOString();
const falhar = (msg) => { throw new Error(msg); };
const semRepetidos = (values, label) => {
  if (new Set(values).size !== values.length) falhar(`${label}: IDs repetidos`);
};
const prioridade = (v) => ({ urgent: 'urgente', high: 'alta', normal: 'normal', low: 'baixa' })[v?.priority] ?? null;
const tipoCampo = (v) => ({ date: 'data', drop_down: 'drop_down', text: 'texto', number: 'numero', checkbox: 'checkbox', url: 'url' })[v];
const fileKey = (taskId, id) => `${taskId}\0${id}`;

function validarArquivo(file, root) {
  const path = resolve(file.localPath);
  const realRoot = realpathSync(join(root, 'files')) + sep;
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || !realpathSync(path).startsWith(realRoot)) {
    falhar(`Arquivo fora do staging ou não regular: ${file.taskId}/${file.id}`);
  }
  const rel = relative(join(root, 'files'), path);
  if (rel !== join(file.taskId, file.id)) falhar(`Caminho do anexo diverge do ID: ${file.taskId}/${file.id}`);
  if (info.size !== file.size) falhar(`Tamanho do anexo diverge: ${file.taskId}/${file.id}`);
  const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (hash !== file.sha256) falhar(`SHA-256 do anexo diverge: ${file.taskId}/${file.id}`);
  return rel;
}

function main() {
  const opt = args();
  const tasks = json(opt.tasks);
  const lists = json(opt.lists);
  const files = json(opt.files);
  if (!Array.isArray(tasks) || !Array.isArray(lists) || !Array.isArray(files)) falhar('Export esperado: três arrays JSON');
  if (tasks.length !== opt.expectedTasks || lists.length !== 7 || files.length !== opt.expectedFiles) {
    falhar(`Cardinalidade mudou: ${tasks.length} tarefas, ${lists.length} listas, ${files.length} anexos`);
  }
  semRepetidos(tasks.map((t) => t.id), 'tarefas');
  semRepetidos(lists.map((l) => l.id), 'listas');
  semRepetidos(files.map((f) => fileKey(f.taskId, f.id)), 'anexos');
  if (JSON.stringify(lists.map((l) => l.id).sort()) !== JSON.stringify([...IDS].sort())) falhar('Listas fora da allowlist fixa');
  const listMap = new Map(lists.map((l) => [l.id, l]));
  const taskIds = new Set(tasks.map((t) => t.id));
  const fileMap = new Map(files.map((f) => [fileKey(f.taskId, f.id), { ...f, relativePath: validarArquivo(f, dirname(resolve(opt.files))) }]));
  const usados = new Set();
  const gaps = [];
  const counters = new Map();
  function comentariosNormalizados(task) {
    const out = [];
    function adicionar(c, parentId = null) {
      const texto = c.comment_text ?? c.text;
      if (typeof texto !== 'string' || !c.id || !(c.date ?? c.date_created)) {
        gaps.push(`${task.id}: comentário sem ID, texto ou data`);
        return;
      }
      const autor = c.user?.username ?? c.user?.name;
      if (!autor) gaps.push(`${task.id}/${c.id}: autor do comentário não informado`);
      out.push({ id: String(c.id), authorId: c.user?.id ? String(c.user.id) : null,
        authorName: autor || 'Autor não informado', text: parentId ? `Em resposta a ${parentId}:\n${texto}` : texto,
        createdAt: iso(c.date ?? c.date_created), raw: c });
      if ((c.replies_count ?? 0) > 0 && !Array.isArray(c.replies)) {
        gaps.push(`${task.id}/${c.id}: respostas não exportadas`);
      }
      for (const reply of c.replies ?? []) adicionar(reply, String(c.id));
    }
    for (const c of task.commentsExport.comments) adicionar(c);
    return out;
  }
  const normalLists = lists.map((l, order) => {
    if (l.space?.id !== SPACE) falhar(`Lista ${l.id} fora do espaço ROOT`);
    const nomesStatus = new Set();
    const statuses = l.statuses.map((s) => {
      if (nomesStatus.has(s.status)) falhar(`Status ambíguo em ${l.id}: ${s.status}`);
      nomesStatus.add(s.status);
      if (!['open', 'custom', 'closed'].includes(s.type)) falhar(`Tipo de status desconhecido ${s.type}`);
      return { id: s.id, name: s.status, type: s.type, color: s.color, order: s.orderindex, raw: s };
    });
    const fields = l.fields.map((f, order) => {
      const type = tipoCampo(f.type);
      if (!type) falhar(`Tipo de campo desconhecido ${l.id}/${f.id}: ${f.type}`);
      return { id: f.id, name: f.name, type, order,
        options: (f.type_config?.options ?? []).map((o) => ({ id: o.id, name: o.name,
          color: o.color, order: o.orderindex, raw: o })), raw: f };
    });
    return { id: l.id, name: l.name.trim(), folderId: PASTA_MARKETING, order, statuses, fields, raw: l };
  });
  const taskBase = tasks.map((t) => {
    const list = listMap.get(t.list?.id);
    if (!list || t.space?.id !== SPACE || t.folder?.id !== PASTA_MARKETING) falhar(`Tarefa fora da origem: ${t.id}`);
    const status = list.statuses.find((s) => s.status === t.status);
    if (!status) falhar(`Status da tarefa ${t.id} não existe na lista ${list.id}`);
    if (t.commentsExport?.count !== t.commentsExport?.comments?.length) falhar(`Comentários incompletos: ${t.id}`);
    const order = counters.get(list.id) ?? 0;
    counters.set(list.id, order + 1);
    const values = [];
    for (const f of t.custom_fields) {
      if (!Object.hasOwn(f, 'value')) continue;
      const meta = list.fields.find((m) => m.id === f.id);
      if (!meta) { gaps.push(`${t.id}: campo ${f.id} sem metadados na lista`); continue; }
      if (f.type === 'drop_down') {
        const option = meta.type_config?.options?.find((o) => o.orderindex === f.value);
        if (!option) { gaps.push(`${t.id}: opção ${f.id}/${f.value} sem ID`); continue; }
        values.push({ fieldId: f.id, optionId: option.id, value: null });
      } else if (f.type === 'date') {
        values.push({ fieldId: f.id, optionId: null, value: iso(f.value) });
      } else values.push({ fieldId: f.id, optionId: null, value: String(f.value) });
    }
    const deps = t.dependencies.map((d) => {
      if (d.task_id === t.id) return { taskId: d.depends_on, type: 'depende de', raw: d };
      if (d.depends_on === t.id) return { taskId: d.task_id, type: 'bloqueia', raw: d };
      gaps.push(`${t.id}: relação ${d.chain_id} não contém a tarefa`);
      return { taskId: d.depends_on, type: 'direção desconhecida', raw: d };
    });
    for (const d of deps) if (!taskIds.has(d.taskId)) gaps.push(`${t.id}: dependência externa ${d.taskId}`);
    const base = {
      id: t.id, listId: list.id, statusId: status.id, title: t.name,
      description: t.markdown_description || t.text_content || null,
      priority: prioridade(t.priority),
      assignees: t.assignees.map((a) => ({ id: String(a.id), name: a.username || a.email || String(a.id) })),
      startDate: iso(t.start_date), dueDate: iso(t.due_date), createdAt: iso(t.date_created), updatedAt: iso(t.date_updated),
      parentId: t.parent ?? null, archived: null, order, url: t.url,
      tags: t.tags.map((a) => ({ id: String(a.id ?? a.name), name: a.name, color: a.tag_bg ?? '#87909e', raw: a })),
      fieldValues: values,
      comments: comentariosNormalizados(t),
      checklists: t.checklists.map((c) => ({ id: String(c.id), name: c.name,
        items: (c.items ?? []).map((i) => ({ id: String(i.id), name: i.name, resolved: !!i.resolved,
          assigneeId: i.assignee?.id ? String(i.assignee.id) : null, raw: i })), raw: c })),
      dependencies: deps,
      raw: t,
    };
    return { base, rawAttachments: t.attachments };
  });
  const snapshot = (environment) => ({
    schemaVersion: 1, source: 'clickup', capturedAt: statSync(opt.tasks).mtime.toISOString(), spaceId: SPACE,
    scope: { folderPath: ['Demandas internas', 'Marketing'], listIds: IDS },
    completeness: { allLists: true, allTasks: true, includeClosed: true, paginationComplete: true },
    extractionGaps: gaps,
    unknownSourceFields: ['tasks.archived', 'tasks.order', 'lists.order', 'fields.order'],
    folders: [
      { id: PASTA_PAI, name: 'Demandas internas', parentId: null },
      { id: PASTA_MARKETING, name: 'Marketing', parentId: PASTA_PAI },
    ],
    lists: normalLists,
    tasks: taskBase.map(({ base, rawAttachments }) => ({ ...base,
      attachments: rawAttachments.map((a) => {
        const key = fileKey(base.id, a.id);
        const file = fileMap.get(key);
        if (!file) { gaps.push(`${base.id}/${a.id}: binário não encontrado`); return null; }
        usados.add(key);
        if (file.size !== a.size || file.title !== a.title) falhar(`Metadados do anexo divergem: ${base.id}/${a.id}`);
        return { id: a.id, name: a.title, url: `/api/trabalho/arquivos/${encodeURIComponent(base.id)}/${encodeURIComponent(a.id)}`,
          mimeType: a.mimetype, size: file.size, sha256: file.sha256,
          localPath: environment === 'local' ? file.localPath : join(VAULT, 'files', file.relativePath), raw: a };
      }).filter(Boolean),
    })),
  });
  const local = snapshot('local');
  const vps = snapshot('vps');
  if (usados.size !== files.length || gaps.length) falhar(`Export incompleto: ${gaps.join('; ') || 'arquivo sem tarefa'}`);
  mkdirSync(opt.outputDir, { recursive: true, mode: 0o700 });
  for (const [name, data] of [['marketing.local.snapshot.json', local], ['marketing.vps.snapshot.json', vps]]) {
    writeFileSync(join(opt.outputDir, name), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  }
  const index = { orgId: ORG, files: files.map((f) => ({ taskId: f.taskId, id: f.id,
    name: f.title, path: join('files', fileMap.get(fileKey(f.taskId, f.id)).relativePath),
    sha256: f.sha256, size: f.size })) };
  writeFileSync(join(opt.outputDir, 'attachments-index.json'), JSON.stringify(index, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ outputDir: resolve(opt.outputDir), lists: lists.length, tasks: tasks.length,
    attachments: usados.size, dependencies: tasks.reduce((n, t) => n + t.dependencies.length, 0), gaps,
    files: ['marketing.local.snapshot.json', 'marketing.vps.snapshot.json', 'attachments-index.json'] }, null, 2));
}
try { main(); } catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; }
