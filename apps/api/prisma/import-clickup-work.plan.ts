import type { ClickupSnapshot, ClickupTask } from './import-clickup-work.contract';
import { descricaoNativa, idNativo, prioridade, sha256 } from './import-clickup-work.contract';

type Tipo = 'folder' | 'list' | 'status' | 'field' | 'option' | 'tag' | 'task' | 'value' | 'comment';
export interface Spec {
  tipo: Tipo;
  chave: string;
  id: string;
  origemHash: string;
  /** Somente colunas projetadas; nenhum apply faz update em linha existente. */
  conferir: Record<string, unknown>;
  dados: Record<string, unknown>;
}
export type Inventario = { specs: Spec[]; avisos: string[] };

function data(v: string | null | undefined): Date | null { return v ? new Date(v) : null; }
function dataIso(v: string | null | undefined): string | null { return v ? new Date(v).toISOString() : null; }
function textoValor(v: string | number | boolean | null | undefined): string | null {
  return v == null ? null : String(v);
}

function ordenarTarefas(tasks: ClickupTask[]): ClickupTask[] {
  const porId = new Map(tasks.map((t) => [t.id, t]));
  const estado = new Map<string, 1 | 2>();
  const ordem: ClickupTask[] = [];
  function visita(t: ClickupTask) {
    const e = estado.get(t.id);
    if (e === 1) throw new Error(`Ciclo de subtarefas em ${t.id}`);
    if (e === 2) return;
    estado.set(t.id, 1);
    if (t.parentId && porId.has(t.parentId)) visita(porId.get(t.parentId)!);
    estado.set(t.id, 2);
    ordem.push(t);
  }
  for (const t of tasks) visita(t);
  return ordem;
}

/** Constrói IDs e payloads antes de tocar no banco. Sempre em ordem de dependência. */
export function inventariar(snapshot: ClickupSnapshot, orgId: string, caminhos: Map<string, string>): Inventario {
  const specs: Spec[] = [];
  const avisos: string[] = [];
  const id = (tipo: string, origem: string) => idNativo(orgId, snapshot.spaceId, tipo, origem);
  const listaPorId = new Map(snapshot.lists.map((l) => [l.id, l]));
  const folderPorId = new Map(snapshot.folders.map((f) => [f.id, f]));
  const tasks = new Map(snapshot.tasks.map((t) => [t.id, t]));
  const leafIds = [...new Set(snapshot.lists.map((l) => l.folderId!))];

  for (const fid of leafIds) {
    const f = folderPorId.get(fid)!;
    const caminho = caminhos.get(snapshot.lists.find((l) => l.folderId === fid)!.id)!;
    specs.push({
      tipo: 'folder', chave: `folder:${fid}`, id: id('folder', fid), origemHash: sha256({ f, caminho }),
      conferir: { orgId, name: caminho }, dados: { orgId, name: caminho, order: 0 },
    });
  }
  for (const l of snapshot.lists) {
    specs.push({
      tipo: 'list', chave: `list:${l.id}`, id: id('list', l.id), origemHash: sha256(l),
      conferir: { orgId, folderId: id('folder', l.folderId!), name: l.name, externalId: l.id },
      dados: { orgId, folderId: id('folder', l.folderId!), name: l.name, externalId: l.id, order: l.order },
    });
  }
  for (const l of snapshot.lists) {
    for (const s of l.statuses) {
      const sid = id('status', `${l.id}:${s.id}`);
      specs.push({
        tipo: 'status', chave: `status:${l.id}:${s.id}`, id: sid, origemHash: sha256(s),
        conferir: { orgId, listId: id('list', l.id), name: s.name, type: s.type, color: s.color, order: s.order },
        dados: { orgId, listId: id('list', l.id), name: s.name, type: s.type, color: s.color, order: s.order },
      });
    }
    for (const f of l.fields) {
      const fid = id('field', `${l.id}:${f.id}`);
      specs.push({
        tipo: 'field', chave: `field:${l.id}:${f.id}`, id: fid, origemHash: sha256(f),
        conferir: { orgId, listId: id('list', l.id), name: f.name, type: f.type, order: f.order },
        dados: { orgId, listId: id('list', l.id), name: f.name, type: f.type, order: f.order },
      });
    }
  }
  for (const l of snapshot.lists) for (const f of l.fields) for (const o of f.options) {
    specs.push({
      tipo: 'option', chave: `option:${l.id}:${f.id}:${o.id}`, id: id('option', `${l.id}:${f.id}:${o.id}`), origemHash: sha256(o),
      conferir: { orgId, fieldId: id('field', `${l.id}:${f.id}`), name: o.name, color: o.color, order: o.order },
      dados: { orgId, fieldId: id('field', `${l.id}:${f.id}`), name: o.name, color: o.color, order: o.order },
    });
  }
  const tags = new Map<string, ClickupTask['tags'][number]>();
  const nomesTags = new Map<string, string>();
  for (const t of snapshot.tasks) for (const tag of t.tags) {
    const outra = nomesTags.get(tag.name.toLocaleLowerCase('pt-BR'));
    if (outra && outra !== tag.id) throw new Error(`Tags distintas com mesmo nome nativo: ${outra} e ${tag.id} (${tag.name})`);
    nomesTags.set(tag.name.toLocaleLowerCase('pt-BR'), tag.id);
    tags.set(tag.id, tag);
  }
  for (const tag of tags.values()) {
    specs.push({
      tipo: 'tag', chave: `tag:${tag.id}`, id: id('tag', tag.id), origemHash: sha256(tag),
      conferir: { orgId, name: tag.name, color: tag.color }, dados: { orgId, name: tag.name, color: tag.color },
    });
  }
  for (const t of ordenarTarefas(snapshot.tasks)) {
    const l = listaPorId.get(t.listId)!;
    const parentId = t.parentId && tasks.has(t.parentId) ? id('task', t.parentId) : null;
    const relacoes = t.dependencies.map((d) => {
      const alvo = tasks.get(d.taskId);
      if (!alvo) return `- ${d.type}: tarefa ClickUp ${d.taskId} fora deste lote`;
      const rotulo = alvo.title.replace(/[\[\]()\r\n]/g, '').slice(0, 180);
      const href = `/trabalho?lista=${encodeURIComponent(alvo.listId)}&tarefa=${id('task', alvo.id)}`;
      return `- ${d.type}: [${rotulo}](${href})`;
    });
    const description = descricaoNativa(t, relacoes);
    if (description && description.length > 20000) avisos.push(`${t.id}: descrição >20 mil caracteres; preservada no banco/snapshot, editor web pode recusá-la`);
    const tagIds = [...new Set(t.tags.map((tag) => id('tag', tag.id)))].sort();
    const assignee = t.assignees[0]?.name ?? null;
    const dados = {
      orgId, listId: id('list', l.id), statusId: id('status', `${l.id}:${t.statusId}`),
      title: t.title, description, priority: prioridade(t.priority), assignee,
      dueDate: data(t.dueDate), startDate: data(t.startDate), parentId,
      externalId: t.id, externalUrl: t.url ?? null, archived: t.archived ?? false, order: t.order,
      ...(t.createdAt ? { createdAt: data(t.createdAt) } : {}),
      ...(t.updatedAt ? { updatedAt: data(t.updatedAt) } : {}),
      tags: { connect: tagIds.map((id) => ({ id })) },
    };
    specs.push({
      tipo: 'task', chave: `task:${t.id}`, id: id('task', t.id), origemHash: sha256(t),
      conferir: {
        orgId, listId: dados.listId, statusId: dados.statusId, title: t.title,
        description, priority: dados.priority, assignee, dueDate: dataIso(t.dueDate), startDate: dataIso(t.startDate),
        parentId, externalId: t.id, externalUrl: t.url ?? null, archived: t.archived ?? false, order: t.order, tagIds,
      },
      dados,
    });
  }
  for (const t of snapshot.tasks) {
    const l = listaPorId.get(t.listId)!;
    for (const v of t.fieldValues) {
      const f = l.fields.find((f) => f.id === v.fieldId);
      if (!f || (v.optionId && !f.options.some((o) => o.id === v.optionId))) continue;
      const fieldId = id('field', `${l.id}:${f.id}`);
      const optionId = v.optionId ? id('option', `${l.id}:${f.id}:${v.optionId}`) : null;
      const value = textoValor(v.value);
      specs.push({
        tipo: 'value', chave: `value:${t.id}:${v.fieldId}`, id: id('value', `${t.id}:${v.fieldId}`), origemHash: sha256(v),
        conferir: { orgId, taskId: id('task', t.id), fieldId, optionId, value },
        dados: { orgId, taskId: id('task', t.id), fieldId, optionId, value },
      });
    }
    for (const c of t.comments) {
      specs.push({
        tipo: 'comment', chave: `comment:${t.id}:${c.id}`, id: id('comment', `${t.id}:${c.id}`), origemHash: sha256(c),
        conferir: { orgId, taskId: id('task', t.id), authorId: null, authorName: c.authorName,
          text: c.text, createdAt: new Date(c.createdAt).toISOString() },
        dados: { orgId, taskId: id('task', t.id), authorId: null, authorName: c.authorName,
          text: c.text, createdAt: new Date(c.createdAt) },
      });
    }
  }
  return { specs, avisos };
}
