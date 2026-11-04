import { WorkListaNatureza, type Prisma } from '@prisma/client';
import { CARTOES_QUE_NAO_SAO_TAREFA } from '@mktos/shared';

import { tarefaDeListaVisivel, tarefaForaDoArquivoDoClickUp, tarefaViva } from './arquivadas';
import { tarefaForaDoComercial } from './pasta-do-comercial';

/*
 * UMA REGRA SÓ DE "O QUE É TAREFA" (etapa 6, F-15 / P-20, 04/11/2026). Dia a dia, Todas,
 * Minhas tarefas e Agenda contam a mesma coisa: lista de natureza `tarefas`; subtarefa fica
 * dentro da tarefa (sobe só a que pende de um CADASTRO, a da ficha do cliente); o cartão que
 * não é tarefa fica fora; lista ou pasta arquivada, a pasta Clientes (cards da Implantação), o
 * Arquivo do ClickUp e a Lixeira ficam fora. Vai num `AND`, junto do `list`.
 */
export function listaDeTarefas(): Prisma.WorkListWhereInput {
  return { natureza: WorkListaNatureza.tarefas };
}

export function tarefaQueConta(): Prisma.WorkTaskWhereInput[] {
  return [
    { OR: [{ parentId: null }, { parent: { list: { natureza: WorkListaNatureza.cadastro } } }] },
    // externalId nulo precisa de ramo próprio: em SQL, NULL NOT IN (...) é desconhecido e a linha some.
    { OR: [{ externalId: null }, { externalId: { notIn: [...CARTOES_QUE_NAO_SAO_TAREFA] } }] },
    tarefaDeListaVisivel(),
    tarefaForaDoComercial(),
    tarefaForaDoArquivoDoClickUp(),
    tarefaViva(),
  ];
}
