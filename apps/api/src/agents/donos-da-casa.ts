import { PrismaService } from '../prisma/prisma.service';

/* ========================================================================== *
 * O DONO DE UM AGENTE, CONFERIDO CONTRA A EMPRESA — um lugar só
 * ========================================================================== *
 *
 * `Agent.donoId` referencia `User` e mais nada: o banco não guarda o par
 * (usuário, empresa) nessa coluna, então um ponteiro atravessado é permitido e
 * existe de verdade (semente, migração, script). E o Prisma **não filtra
 * relação para UM dentro do `include`** — `include: { dono: ... }` traz o nome
 * de quem estiver do outro lado, seja de qual empresa for.
 *
 * Havia QUATRO lugares que expunham esse nome. Três ficavam no serviço (`roster`,
 * `detalhe`, `organograma`) e foram corrigidos em 11/09/2026. O quarto era o pior:
 * `AgentRuntime.executar`, o CAMINHO REAL DE EXECUÇÃO, de onde o nome vai para a
 * linha "DONO HUMANO" e para o bloco de ESCALAÇÃO do prompt de sistema.
 * `montarSop` limpa o TEXTO — quebra de linha, cabeçalho disfarçado —, mas não
 * tem como saber de que empresa é o nome.
 *
 * Por isso a resolução mora AQUI, num arquivo próprio, e não como método privado
 * de um dos dois donos: o defeito é do tipo que volta pela quinta porta. Quem
 * precisar do nome do dono chama daqui, ou repete o defeito.
 *
 * Ponteiro atravessado simplesmente não resolve, e o agente aparece "sem dono" —
 * que é verdade, e é a única resposta segura. A consequência vale também para os
 * SETE campos do procedimento: se o ponteiro não resolve em nome, ele também não
 * conta como DONO (ver `agents.service.ts`).
 */

/** Mapa id -> dono, só com gente DESTA empresa. Ids que não são daqui somem. */
export async function donosDaCasa(
  prisma: PrismaService,
  orgId: string,
  ids: (string | null)[],
): Promise<Map<string, { id: string; nome: string }>> {
  const unicos = [...new Set(ids.filter((i): i is string => !!i))];
  if (unicos.length === 0) return new Map<string, { id: string; nome: string }>();
  const gente = await prisma.user.findMany({
    where: { orgId, id: { in: unicos } },
    select: { id: true, name: true },
  });
  return new Map(gente.map((u) => [u.id, { id: u.id, nome: u.name }]));
}

/**
 * O nome do dono, ou `undefined` quando o ponteiro não é gente desta empresa.
 *
 * `undefined` e não `null` porque é o que `montarSop` espera para cair no "o
 * responsável pelo agente" genérico.
 */
export async function nomeDoDonoDaCasa(
  prisma: PrismaService,
  orgId: string,
  donoId: string | null,
): Promise<string | undefined> {
  if (!donoId) return undefined;
  return (await donosDaCasa(prisma, orgId, [donoId])).get(donoId)?.nome;
}
