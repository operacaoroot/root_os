import { EstadoDeAgente } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/* ========================================================================== *
 * O AGENTE DE UMA TAREFA, CONFERIDO CONTRA A EMPRESA — um lugar só
 * ========================================================================== *
 *
 * Irmão de `src/agents/donos-da-casa.ts`, e existe pelo mesmo defeito, na mesma
 * forma: `WorkTask.agenteId` referencia `Agent` e mais nada, o banco não guarda
 * o par (agente, empresa) nessa coluna, e o Prisma **não filtra relação para UM
 * dentro do `include`** — `include: { agente: true }` devolve o agente que
 * estiver do outro lado do ponteiro, seja de qual empresa for.
 *
 * A ESCRITA já está protegida pelo gatilho `WorkTask_orgId_confere_agente`
 * (migration `20260913030000_tarefa_com_dono_unico`): pendurar agente de outra
 * empresa numa tarefa é recusado pelo Postgres. Então por que o ajudante?
 *
 *   1. porque o gatilho é de HOJE e as linhas podem ser de ontem: qualquer
 *      migração de dados, semente ou script que tenha rodado antes dele pode ter
 *      deixado um ponteiro atravessado, e a LEITURA continuaria expondo o nome;
 *   2. porque o nome do agente vai para a mensagem de 409 ("esta tarefa já está
 *      com o agente X") e para o cartão do quadro — duas superfícies que o
 *      cliente lê. Nome da empresa vizinha ali é vazamento, não enfeite;
 *   3. porque a defesa que depende de o gatilho nunca ser removido é uma defesa
 *      só. Esta é a segunda.
 *
 * Ponteiro que não resolve devolve `null`, e a tela diz "outro agente" — que é
 * verdade, e é a única resposta segura. Inventar o nome é pior do que não dizer.
 */

/** O que a tela e as mensagens precisam saber de um agente. */
export interface AgenteDaCasa {
  id: string;
  slug: string;
  nome: string;
  iniciais: string;
  estado: EstadoDeAgente;
}

/** Mapa id -> agente, só com agentes DESTA empresa. Ids que não são daqui somem. */
export async function agentesDaCasa(
  prisma: PrismaService,
  orgId: string,
  ids: (string | null)[],
): Promise<Map<string, AgenteDaCasa>> {
  const unicos = [...new Set(ids.filter((i): i is string => !!i))];
  if (unicos.length === 0) return new Map<string, AgenteDaCasa>();
  const agentes = await prisma.agent.findMany({
    where: { orgId, id: { in: unicos } },
    select: { id: true, slug: true, nome: true, iniciais: true, estado: true },
  });
  return new Map(agentes.map((a) => [a.id, a]));
}

/**
 * O agente de UM ponteiro, ou `null` quando ele não é agente desta empresa.
 *
 * `null` e não `undefined` porque quem chama grava o resultado em campo de DTO,
 * e `null` é o que atravessa JSON dizendo "não tem" — `undefined` desapareceria
 * do corpo da resposta e a tela não distinguiria "sem agente" de "campo que a
 * API parou de mandar".
 */
export async function agenteDaCasa(
  prisma: PrismaService,
  orgId: string,
  agenteId: string | null,
): Promise<AgenteDaCasa | null> {
  if (!agenteId) return null;
  return (await agentesDaCasa(prisma, orgId, [agenteId])).get(agenteId) ?? null;
}
