import { listaDaImplantacao, type TrabArquivadaPor } from '@mktos/shared';
import type { Prisma } from '@prisma/client';

/*
 * AS REGRAS DA LIXEIRA QUE NÃO PRECISAM DO NEST (rodada de produção 3, I2).
 *
 * Moram fora do serviço porque o script `restaurar-tarefas` (compilado, sem Nest)
 * e o expurgo usam as mesmas perguntas: qual é a lista da implantação, quais
 * tarefas são card de cliente, e QUANDO uma tarefa arquivada saiu.
 *
 * DE ONDE VEM "ARQUIVADA EM". `WorkTask` não tem coluna de arquivamento: só o
 * booleano `archived`. A hora e quem arquivou vêm da AUDITORIA da tarefa:
 *  1. a linha mais nova da tarefa (`entityType = work_task`) cujo `after.archived`
 *     é `true` (o PATCH grava a chave desde 22/10/2026; o "Arquivar todas as
 *     tarefas" da lista e o mesclar sempre gravaram);
 *  2. senão, a linha mais nova de arquivar do importador (`importacao.crm.*`
 *     com "arquiv" na ação);
 *  3. senão, a linha `work.task.update` mais nova (antes de 22/10/2026 o PATCH não
 *     dizia `archived`; a tarefa arquivada some da tela, então a última edição é,
 *     na prática, a de arquivar: foi assim com os 4 cards de 21/10/2026);
 *  4. senão, `updatedAt` da tarefa, sem autor.
 */

type Leitor = Pick<Prisma.TransactionClient, 'workFolder' | 'workList' | 'onboardingTrilho' | 'auditLog' | 'user'>;

/** O id da lista da implantação desta empresa (Onboarding de cliente, na pasta Clientes), ou nulo. */
export async function idDaListaDaImplantacao(db: Leitor, orgId: string): Promise<string | null> {
  const pastas = await db.workFolder.findMany({
    where: { orgId, parentId: null },
    select: { id: true, name: true, parentId: true, lists: { select: { id: true, name: true } } },
  });
  return listaDaImplantacao(pastas)?.listaId ?? null;
}

/** Das tarefas pedidas, as que são card de cliente: na lista da implantação (sem mãe) ou com trilho de onboarding. */
export async function cardsDaImplantacao(
  db: Leitor,
  orgId: string,
  tarefas: readonly { id: string; listId: string; parentId: string | null }[],
): Promise<Set<string>> {
  if (!tarefas.length) return new Set();
  const [lista, trilhos] = await Promise.all([
    idDaListaDaImplantacao(db, orgId),
    db.onboardingTrilho.findMany({ where: { orgId, cardId: { in: tarefas.map((t) => t.id) } }, select: { cardId: true } }),
  ]);
  const comTrilho = new Set(trilhos.map((t) => t.cardId).filter((x): x is string => !!x));
  return new Set(tarefas.filter((t) => comTrilho.has(t.id) || (!!lista && t.listId === lista && !t.parentId)).map((t) => t.id));
}

export interface LinhaDeSaida {
  entityId: string | null;
  action: string;
  actorId: string | null;
  createdAt: Date;
  after: Prisma.JsonValue | null;
}

function arquivouNaLinha(l: LinhaDeSaida): boolean {
  const after = l.after && typeof l.after === 'object' && !Array.isArray(l.after) ? (l.after as Record<string, unknown>) : null;
  return after?.archived === true;
}

/**
 * A linha da auditoria que diz quando a tarefa foi arquivada (a regra do
 * cabeçalho). `linhas` vem da mais nova para a mais velha.
 */
export function linhaDoArquivamento(linhas: readonly LinhaDeSaida[]): LinhaDeSaida | null {
  return linhas.find(arquivouNaLinha)
    ?? linhas.find((l) => l.action.startsWith('importacao.crm.') && /arquiv/.test(l.action))
    ?? linhas.find((l) => l.action === 'work.task.update')
    ?? null;
}

/** Quando e por quem cada tarefa arquivada saiu, pela auditoria (ver o cabeçalho). */
export async function quandoForamArquivadas(
  db: Leitor,
  orgId: string,
  tarefas: readonly { id: string; updatedAt: Date }[],
): Promise<Map<string, { em: Date; actorId: string | null }>> {
  const r = new Map<string, { em: Date; actorId: string | null }>();
  if (!tarefas.length) return r;
  const linhas = await db.auditLog.findMany({
    where: {
      orgId, entityType: 'work_task', entityId: { in: tarefas.map((t) => t.id) },
      OR: [{ action: 'work.task.update' }, { action: 'work.task.merge' }, { action: { startsWith: 'importacao.crm.' } }],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { entityId: true, action: true, actorId: true, createdAt: true, after: true },
  });
  const porTarefa = new Map<string, LinhaDeSaida[]>();
  for (const l of linhas) {
    if (!l.entityId) continue;
    const lista = porTarefa.get(l.entityId) ?? [];
    lista.push(l);
    porTarefa.set(l.entityId, lista);
  }
  for (const t of tarefas) {
    const l = linhaDoArquivamento(porTarefa.get(t.id) ?? []);
    r.set(t.id, l ? { em: l.createdAt, actorId: l.actorId } : { em: t.updatedAt, actorId: null });
  }
  return r;
}

/** O nome de cada pessoa desta empresa (quem tirou da lista). Conta de outra empresa não resolve. */
export async function nomesDasPessoas(db: Leitor, orgId: string, ids: readonly (string | null)[]): Promise<Map<string, TrabArquivadaPor>> {
  const unicos = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unicos.length) return new Map();
  const gente = await db.user.findMany({ where: { orgId, id: { in: unicos } }, select: { id: true, name: true } });
  return new Map(gente.map((u) => [u.id, { id: u.id, nome: u.name }]));
}

/** O primeiro uuid de 8 caracteres: o que o script e o relatório imprimem no lugar do título. */
export function idCurto(id: string): string {
  return id.slice(0, 8);
}
