import { valorMonetarioCanonico } from '@mktos/shared';
import type { ClickupSnapshot, ClickupTask } from './import-clickup-work.contract';
import { descricaoNativa, idNativo, prioridade, sha256, tipoNativoDoStatus } from './import-clickup-work.contract';

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
/** `validarSnapshot` já recusou o que não converte; lançar aqui é defesa para quem chamar sem ele. */
function canonicoDoValor(
  taskId: string, f: ClickupSnapshot['lists'][number]['fields'][number], v: string | number | boolean | null | undefined,
): string {
  const r = valorMonetarioCanonico(v, f.moeda ?? '', f.casas ?? Number.NaN);
  if (r.motivo !== undefined) throw new Error(`valor do campo ${f.id} da tarefa ${taskId}: ${r.motivo}`);
  return r.valor;
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
      const type = tipoNativoDoStatus(s.type);
      if (!type) throw new Error(`status ${l.id}/${s.id}: tipo ${s.type} sem mapeamento nativo`);
      specs.push({
        tipo: 'status', chave: `status:${l.id}:${s.id}`, id: sid, origemHash: sha256(s),
        conferir: { orgId, listId: id('list', l.id), name: s.name, type, color: s.color, order: s.order },
        dados: { orgId, listId: id('list', l.id), name: s.name, type, color: s.color, order: s.order },
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
      // `moeda` grava o canônico; o `origemHash` segue sobre o valor da origem,
      // então `"1500.50"` e `1500.5` dão o mesmo valor no banco sem conflito falso.
      const value = f.type === 'moeda' ? canonicoDoValor(t.id, f, v.value) : textoValor(v.value);
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

/*
 * A ÁRVORE DO LOTE (ROOT-17, C-15). `inventariar` continua igual: a pasta do lote
 * nasce plana, com o caminho inteiro no nome, porque é isso que o fingerprint gravado
 * no manifesto de 30/09 conhece. A árvore é o que falta em volta dela: o espaço e as
 * pastas-mãe da origem, com `idNativo` de `kind` `space` e `folder`, e a posição da
 * pasta do lote, que mora só em colunas novas (`spaceId`, `parentId`, `externalId`).
 * Nenhum nó da árvore é linha do lote: o rollback não os apaga.
 */
export interface NoDaArvore {
  tipo: 'space' | 'folder';
  chave: string;
  id: string;
  externalId: string;
  dados: { orgId: string; name: string; externalId: string; order: number; spaceId?: string | null; parentId?: string | null };
}
/** Pai imediato da pasta do lote: só um dos dois é preenchido, como pede o CHECK `WorkFolder_um_pai_so`. */
export interface PosicaoDaPasta { chave: string; id: string; externalId: string; spaceId: string | null; parentId: string | null }
export type ArvoreDoLote = { nos: NoDaArvore[]; posicoes: PosicaoDaPasta[] };

export function arvoreDoLote(snapshot: ClickupSnapshot, orgId: string, nomeDoEspaco: string): ArvoreDoLote {
  const nome = nomeDoEspaco.trim();
  if (!nome) throw new Error('nome do espaço vazio');
  const id = (tipo: string, origem: string) => idNativo(orgId, snapshot.spaceId, tipo, origem);
  const espaco: NoDaArvore = {
    tipo: 'space', chave: `space:${snapshot.spaceId}`, id: id('space', snapshot.spaceId), externalId: snapshot.spaceId,
    dados: { orgId, name: nome, externalId: snapshot.spaceId, order: 0 },
  };
  const folderPorId = new Map(snapshot.folders.map((f) => [f.id, f]));
  const pai = (parentId: string | null) => parentId
    ? { spaceId: null, parentId: id('folder', parentId) }
    : { spaceId: espaco.id, parentId: null };
  const folhas = [...new Set(snapshot.lists.map((l) => l.folderId!))];
  // Cada cadeia vem do topo para baixo, então a mãe sempre entra antes da filha.
  const maes: string[] = [];
  for (const folha of folhas) {
    const cadeia: string[] = [];
    const vistas = new Set([folha]);
    let atual = folderPorId.get(folha)?.parentId ?? null;
    while (atual) {
      if (vistas.has(atual)) throw new Error(`ciclo na pasta ${atual}`);
      vistas.add(atual);
      const f = folderPorId.get(atual);
      if (!f) throw new Error(`pasta ${atual} ausente do snapshot`);
      cadeia.unshift(atual);
      atual = f.parentId;
    }
    for (const fid of cadeia) if (!folhas.includes(fid) && !maes.includes(fid)) maes.push(fid);
  }
  const nos: NoDaArvore[] = [espaco, ...maes.map((fid): NoDaArvore => {
    const f = folderPorId.get(fid)!;
    return {
      tipo: 'folder', chave: `folder:${fid}`, id: id('folder', fid), externalId: fid,
      dados: { orgId, name: f.name, externalId: fid, order: 0, ...pai(f.parentId) },
    };
  })];
  const posicoes = folhas.map((fid): PosicaoDaPasta => {
    const f = folderPorId.get(fid);
    if (!f) throw new Error(`pasta ${fid} ausente do snapshot`);
    return { chave: `folder:${fid}`, id: id('folder', fid), externalId: fid, ...pai(f.parentId) };
  });
  return { nos, posicoes };
}
