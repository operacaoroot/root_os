import { Prisma, WorkListaNatureza, WorkStatusType, type PrismaClient } from '@prisma/client';
import { AREAS_PADRAO } from '@mktos/shared';

/*
 * A LISTA DO COMERCIAL (adendo da rodada de produção 1, 21/10/2026).
 *
 * "Comercial são leads, vai para dentro do Funil vivo." As tarefas do comercial
 * continuam sendo `WorkTask` (mesma edição, mesmo Dia a dia, mesmas "minhas
 * tarefas"), mas moram numa lista de natureza própria, achada pela CHAVE
 * `externalId = comercial:tarefas` (única por empresa), e essa lista NÃO aparece
 * na árvore do Trabalho nem em Todas: quem a mostra é o bloco "Tarefas do
 * comercial" do Funil vivo e o painel do lead (a tarefa com `leadId`).
 *
 * A regra mora aqui, num lugar só: o Comercial cria por ela, o importador move
 * para ela, e a árvore e Todas a tiram por `foraDaArvore`.
 */
export const LISTA_DO_COMERCIAL = 'comercial:tarefas';
export const NOME_DA_LISTA_DO_COMERCIAL = 'Tarefas do comercial';
export const AREA_DO_COMERCIAL = 'Comercial';

const STATUS_DA_LISTA_DO_COMERCIAL = [
  { name: 'A fazer', type: WorkStatusType.open, color: '#87909e' },
  { name: 'Fazendo', type: WorkStatusType.custom, color: '#f9a400' },
  { name: 'Feito', type: WorkStatusType.closed, color: '#30a46c' },
];

/** O recorte que tira a lista do comercial (o `externalId` nulo tem ramo próprio: NULL <> x é desconhecido). */
export function foraDaArvore(): Prisma.WorkListWhereInput {
  return { OR: [{ externalId: null }, { externalId: { not: LISTA_DO_COMERCIAL } }] };
}

export function ehListaDoComercial(l: { externalId: string | null }): boolean {
  return l.externalId === LISTA_DO_COMERCIAL;
}

type Cliente = Pick<PrismaClient, 'workList' | 'workSpace' | 'workArea'> | Prisma.TransactionClient;

export interface ListaDoComercial {
  id: string;
  areaId: string;
  statuses: { id: string; name: string; type: WorkStatusType; order: number }[];
  criada: boolean;
}

/**
 * Acha ou cria a lista do comercial da empresa (idempotente pela chave; a corrida
 * de duas criações cai no índice único e relê). Nasce no espaço "Tarefas", sem
 * pasta, com a área Comercial como padrão (a mesma de Comercial › Tarefas) e as
 * três etapas da lista de área.
 */
export async function acharOuCriarListaDoComercial(db: Cliente, orgId: string): Promise<ListaDoComercial> {
  const include = { statuses: { orderBy: { order: 'asc' as const }, select: { id: true, name: true, type: true, order: true } } };
  const ja = await db.workList.findFirst({ where: { orgId, externalId: LISTA_DO_COMERCIAL }, include });
  const area = await acharOuCriarAreaDoComercial(db, orgId);
  if (ja) return { id: ja.id, areaId: ja.areaPadraoId ?? area, statuses: ja.statuses, criada: false };
  const espaco = await db.workSpace.upsert({
    where: { orgId_name: { orgId, name: 'Tarefas' } },
    update: {},
    create: { orgId, name: 'Tarefas', order: 0 },
  });
  try {
    const l = await db.workList.create({
      data: {
        orgId, spaceId: espaco.id, name: NOME_DA_LISTA_DO_COMERCIAL, externalId: LISTA_DO_COMERCIAL,
        natureza: WorkListaNatureza.tarefas, areaPadraoId: area,
        statuses: { create: STATUS_DA_LISTA_DO_COMERCIAL.map((s, i) => ({ name: s.name, type: s.type, color: s.color, order: i })) },
      },
      include,
    });
    return { id: l.id, areaId: area, statuses: l.statuses, criada: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const outra = await db.workList.findFirst({ where: { orgId, externalId: LISTA_DO_COMERCIAL }, include });
      if (outra) return { id: outra.id, areaId: outra.areaPadraoId ?? area, statuses: outra.statuses, criada: false };
    }
    throw e;
  }
}

/** A área Comercial (pelo nome, sem diferença de maiúscula); sem ela, cria com a cor padrão. */
async function acharOuCriarAreaDoComercial(db: Cliente, orgId: string): Promise<string> {
  const ja = await db.workArea.findFirst({ where: { orgId, nome: { equals: AREA_DO_COMERCIAL, mode: 'insensitive' } }, select: { id: true } });
  if (ja) return ja.id;
  const cor = AREAS_PADRAO.find((a) => a.nome === AREA_DO_COMERCIAL)?.cor ?? '#2a78d6';
  try {
    return (await db.workArea.create({ data: { orgId, nome: AREA_DO_COMERCIAL, cor }, select: { id: true } })).id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const outra = await db.workArea.findFirst({ where: { orgId, nome: { equals: AREA_DO_COMERCIAL, mode: 'insensitive' } }, select: { id: true } });
      if (outra) return outra.id;
    }
    throw e;
  }
}
