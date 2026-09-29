import { createHash } from 'node:crypto';
import { z } from 'zod';

const id = z.string().min(1);
const nome = z.string().min(1);
const data = z.string().datetime({ offset: true });
const opcional = data.nullable();
const cor = z.string().min(1);

const pasta = z.object({ id, name: nome, parentId: id.nullable() }).passthrough();
const status = z.object({
  id, name: nome, type: z.string().min(1), color: cor, order: z.number().int(),
}).passthrough();
const opcao = z.object({ id, name: nome, color: cor, order: z.number().int() }).passthrough();
const campo = z.object({
  id, name: nome, type: z.string().min(1),
  order: z.number().int(), options: z.array(opcao),
}).passthrough();
const lista = z.object({
  id, name: nome, folderId: id.nullable(), order: z.number().int(),
  statuses: z.array(status).min(1), fields: z.array(campo),
}).passthrough();
const anexo = z.object({
  id, name: nome, url: z.string().nullish(), mimeType: z.string().nullish(), size: z.number().int().nonnegative().nullish(),
  sha256: z.string().nullish(), localPath: z.string().nullish(),
}).passthrough();
const tarefa = z.object({
  id, listId: id, statusId: id, title: nome, description: z.string().nullable(),
  priority: z.union([z.enum(['urgente', 'alta', 'normal', 'baixa']), z.number().int().min(1).max(4)]).nullable(),
  assignees: z.array(z.object({ id, name: nome }).passthrough()),
  startDate: opcional, dueDate: opcional, createdAt: opcional, updatedAt: opcional,
  parentId: id.nullable(), archived: z.boolean().nullable(), order: z.number().int(),
  url: z.string().url().refine((u) => new URL(u).protocol === 'https:', 'URL externa deve usar HTTPS').nullable(),
  tags: z.array(z.object({ id, name: nome, color: cor }).passthrough()),
  fieldValues: z.array(z.object({
    fieldId: id, optionId: id.nullish(), value: z.union([z.string(), z.number(), z.boolean()]).nullish(),
  }).passthrough()),
  comments: z.array(z.object({
    id, authorId: id.nullish(), authorName: nome, text: z.string(), createdAt: data,
  }).passthrough()),
  attachments: z.array(anexo),
  checklists: z.array(z.object({
    id, name: nome, items: z.array(z.object({
      id, name: nome, resolved: z.boolean(), assigneeId: id.nullish(),
    }).passthrough()),
  }).passthrough()),
  dependencies: z.array(z.object({ taskId: id, type: z.string().min(1) }).passthrough()),
  raw: z.unknown().optional(),
}).passthrough();

export const SnapshotSchema = z.object({
  schemaVersion: z.literal(1), source: z.literal('clickup'), capturedAt: data, spaceId: id,
  scope: z.object({ folderPath: z.array(nome).min(1), listIds: z.array(id).min(1) }).passthrough(),
  completeness: z.object({
    allLists: z.boolean(), allTasks: z.boolean(), includeClosed: z.boolean(), paginationComplete: z.boolean(),
  }).passthrough(),
  extractionGaps: z.array(z.string()),
  unknownSourceFields: z.array(z.string()),
  folders: z.array(pasta), lists: z.array(lista), tasks: z.array(tarefa),
}).passthrough();
export type ClickupSnapshot = z.infer<typeof SnapshotSchema>;
export type ClickupTask = ClickupSnapshot['tasks'][number];
export type ClickupList = ClickupSnapshot['lists'][number];

// IDs conferidos com a hierarquia do espaço ROOT; nunca inferir por nomes repetidos.
export const MARKETING_LIST_IDS: readonly string[] = [
  '901328341442', // Gestão de Temas
  '901328341443', // Copy
  '901328341445', // Rotina de stories
  '901328341450', // Design & Gravação
  '901328341456', // Calendário de conteúdo
  '901328341455', // Análise
  '901328341451', // Demandas gerais
];

/** Hash estável mesmo que o exportador mude a ordem das chaves de objeto. */
export function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${canonical(obj[key])}`).join(',')}}`;
}
export const sha256 = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');

/** UUID determinístico: permite retomar lote após DB commit e antes do manifesto. */
export function idNativo(orgId: string, spaceId: string, kind: string, sourceId: string): string {
  const bytes = createHash('sha256').update(`${orgId}\0${spaceId}\0${kind}\0${sourceId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function distintos(ids: string[], contexto: string, erros: string[]) {
  const vistos = new Set<string>();
  for (const valor of ids) {
    if (vistos.has(valor)) erros.push(`${contexto}: id repetido ${valor}`);
    vistos.add(valor);
  }
}

/** Rejeita escopo diferente e referências ambíguas antes de qualquer conexão de banco. */
export function validarSnapshot(snapshot: ClickupSnapshot): { erros: string[]; avisos: string[]; caminhos: Map<string, string> } {
  const erros: string[] = [];
  const avisos: string[] = [];
  const caminhos = new Map<string, string>();
  if (snapshot.spaceId !== '901313864063') erros.push(`spaceId não permitido para o lote Marketing: ${snapshot.spaceId}`);
  if (snapshot.scope.folderPath.join(' / ') !== 'Demandas internas / Marketing') erros.push('folderPath fora do lote Marketing');
  if (snapshot.scope.listIds.length !== 7) erros.push(`lote Marketing exige 7 IDs de lista; veio ${snapshot.scope.listIds.length}`);
  if (MARKETING_LIST_IDS.length !== 7) erros.push('allowlist local incompleta: apply bloqueado até confirmar os sete IDs da ROOT Marketing');
  else if (canonical([...snapshot.scope.listIds].sort()) !== canonical([...MARKETING_LIST_IDS].sort())) {
    erros.push('IDs das listas não coincidem com a allowlist fixa da ROOT Marketing');
  }
  if (snapshot.scope.listIds.includes('901327640001')) erros.push('ID 901327640001 é Lucas Creator, fora do lote ROOT Marketing');
  if (snapshot.tasks.some((t) => t.archived === null) && !snapshot.unknownSourceFields.includes('tasks.archived')) {
    erros.push('archived desconhecido precisa constar em unknownSourceFields');
  }
  if (snapshot.unknownSourceFields.length) avisos.push(`campos não fornecidos pela origem: ${snapshot.unknownSourceFields.join(', ')}`);
  const folders = new Map(snapshot.folders.map((f) => [f.id, f]));
  const listas = new Map(snapshot.lists.map((l) => [l.id, l]));
  const tarefas = new Map(snapshot.tasks.map((t) => [t.id, t]));
  distintos(snapshot.folders.map((f) => f.id), 'pasta', erros);
  distintos(snapshot.lists.map((l) => l.id), 'lista', erros);
  distintos(snapshot.tasks.map((t) => t.id), 'tarefa', erros);
  distintos(snapshot.scope.listIds, 'allowlist', erros);
  const permitidas = new Set(snapshot.scope.listIds);
  if (listas.size !== permitidas.size || [...listas.keys()].some((id) => !permitidas.has(id))) {
    erros.push('listas do arquivo não coincidem exatamente com scope.listIds');
  }
  for (const l of snapshot.lists) {
    distintos(l.statuses.map((s) => s.id), `status da lista ${l.id}`, erros);
    distintos(l.statuses.map((s) => s.name), `nome de status da lista ${l.id}`, erros);
    distintos(l.fields.map((f) => f.id), `campo da lista ${l.id}`, erros);
    distintos(l.fields.map((f) => f.name), `nome de campo da lista ${l.id}`, erros);
    for (const s of l.statuses) {
      if (!['open', 'custom', 'closed'].includes(s.type)) erros.push(`status ${l.id}/${s.id}: tipo ${s.type} sem mapeamento nativo`);
    }
    for (const f of l.fields) {
      distintos(f.options.map((o) => o.id), `opção ${l.id}/${f.id}`, erros);
      distintos(f.options.map((o) => o.name), `nome de opção ${l.id}/${f.id}`, erros);
      if (!['drop_down', 'texto', 'numero', 'data', 'checkbox', 'url'].includes(f.type)) {
        erros.push(`campo ${l.id}/${f.id}: tipo ${f.type} sem mapeamento nativo`);
      }
    }
    if (!l.folderId) { erros.push(`lista ${l.id} sem folderId; este lote requer caminho completo`); continue; }
    const partes: string[] = [];
    const visitados = new Set<string>();
    let atual: string | null | undefined = l.folderId;
    while (atual) {
      if (visitados.has(atual)) { erros.push(`ciclo na pasta ${atual}`); break; }
      visitados.add(atual);
      const f = folders.get(atual);
      if (!f) { erros.push(`pasta ${atual} da lista ${l.id} ausente`); break; }
      partes.unshift(f.name);
      atual = f.parentId;
    }
    const caminho = partes.join(' / ');
    caminhos.set(l.id, caminho);
    if (snapshot.scope.folderPath.join(' / ') !== caminho) {
      erros.push(`lista ${l.id} fora do caminho permitido: ${caminho}`);
    }
  }
  for (const t of snapshot.tasks) {
    if (t.title.length > 300) avisos.push(`${t.id}: título >300 caracteres; editor nativo pode recusar alteração`);
    const l = listas.get(t.listId);
    if (!l || !permitidas.has(t.listId)) erros.push(`tarefa ${t.id} fora da allowlist: ${t.listId}`);
    else {
      if (!l.statuses.some((s) => s.id === t.statusId)) erros.push(`status ${t.statusId} da tarefa ${t.id} não pertence à lista ${l.id}`);
      for (const v of t.fieldValues) {
        const f = l.fields.find((item) => item.id === v.fieldId);
        if (!f) avisos.push(`campo ${v.fieldId} da tarefa ${t.id} fica apenas no snapshot`);
        else if (v.optionId && !f.options.some((o) => o.id === v.optionId)) avisos.push(`opção ${v.optionId} da tarefa ${t.id} fica apenas no snapshot`);
      }
    }
    if (t.parentId && !tarefas.has(t.parentId)) avisos.push(`pai ${t.parentId} da subtarefa ${t.id} fora do lote; relação fica apenas no snapshot`);
    distintos(t.comments.map((c) => c.id), `comentários da tarefa ${t.id}`, erros);
    distintos(t.attachments.map((a) => a.id), `anexos da tarefa ${t.id}`, erros);
    distintos(t.checklists.map((c) => c.id), `checklists da tarefa ${t.id}`, erros);
    for (const c of t.checklists) distintos(c.items.map((i) => i.id), `itens do checklist ${t.id}/${c.id}`, erros);
    distintos(t.fieldValues.map((v) => v.fieldId), `valores de campo da tarefa ${t.id}`, erros);
    for (const a of t.attachments) {
      const esperado = `/api/trabalho/arquivos/${encodeURIComponent(t.id)}/${encodeURIComponent(a.id)}`;
      if (a.url !== esperado) erros.push(`anexo ${t.id}/${a.id} sem URL interna estável ${esperado}`);
      if (!a.sha256 || !/^[0-9a-f]{64}$/i.test(a.sha256)) erros.push(`anexo ${t.id}/${a.id} sem SHA-256 dos bytes`);
      if (!a.localPath ||
          !(a.localPath.startsWith('/vault/90-OS/migrations/marketing-20260929/files/') ||
            a.localPath.startsWith('/private/tmp/root-os-migration-20260929/files/')) ||
          a.localPath.includes('..')) {
        erros.push(`anexo ${t.id}/${a.id} sem caminho permitido no vault ou staging local`);
      }
    }
    if (t.checklists.length) avisos.push(`${t.id}: ${t.checklists.length} checklist(s) somente no snapshot; Work não tem modelo nativo`);
    if (t.dependencies.length) avisos.push(`${t.id}: ${t.dependencies.length} dependência(s) somente no snapshot; Work não tem modelo nativo`);
    for (const d of t.dependencies) if (!tarefas.has(d.taskId)) avisos.push(`${t.id}: dependência ${d.taskId} fora do lote, preservada só no snapshot`);
    if (t.assignees.length > 1) avisos.push(`${t.id}: múltiplos responsáveis; primeiro no campo nativo, todos no snapshot`);
  }
  if (snapshot.extractionGaps.length) erros.push(...snapshot.extractionGaps.map((g) => `lacuna de extração: ${g}`));
  for (const [chave, valor] of Object.entries(snapshot.completeness)) {
    if (typeof valor === 'boolean' && !valor) erros.push(`cobertura incompleta: ${chave}=false`);
  }
  return { erros, avisos, caminhos };
}

export function prioridade(v: ClickupTask['priority']): 'urgente' | 'alta' | 'normal' | 'baixa' {
  if (typeof v === 'string') return v;
  if (v === 1) return 'urgente';
  if (v === 2) return 'alta';
  if (v === 4) return 'baixa';
  return 'normal';
}

/** Os bytes de anexo ficam na rota autenticada; só URLs estáveis entram na descrição. */
export function descricaoNativa(t: ClickupTask, relacoes: string[] = []): string | null {
  const partes = [t.description ?? ''];
  const extras = t.assignees.slice(1).map((a) => a.name);
  if (extras.length) partes.push(`Outros responsáveis no ClickUp: ${extras.join(', ')}`);
  if (relacoes.length) partes.push(`Dependências preservadas\n${relacoes.join('\n')}`);
  const links = t.attachments
    .filter((a) => a.url === `/api/trabalho/arquivos/${encodeURIComponent(t.id)}/${encodeURIComponent(a.id)}`)
    .map((a) => `- [${a.name.replace(/[\[\]()\r\n]/g, '')}](${a.url})`);
  if (links.length) partes.push(`Anexos preservados\n${links.join('\n')}`);
  return partes.filter(Boolean).join('\n\n') || null;
}
