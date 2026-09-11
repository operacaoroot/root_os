import { SessionCanal } from '@prisma/client';
import type { Alcada } from '@mktos/policy';

import { alcadaDe, atendeAlcada, temPapelDeMaquina } from '../../approvals/alcada';
import { exigirTenant } from '../../common/contexto-execucao';
import { formasDaChave } from './identidade-de-canal';

/*
 * ============================================================================
 * QUEM PODE DECIDIR POR ESTE CANAL — as mesmas perguntas de `confirm`, do BANCO
 * ============================================================================
 *
 * Funções que recebem o cliente do banco por PARÂMETRO, em vez de injetá-lo.
 * Duas razões, e a segunda é a que importa:
 *
 *  1. o teste consegue exercitá-las com um cliente próprio sem levantar o Nest;
 *  2. elas são usadas pelos DOIS serviços do canal — o que manda o pedido e o
 *     que recebe a decisão —, e um deles não pode depender do outro (o de
 *     receber depende de `ApprovalsService`, que depende do de mandar). Uma
 *     função solta quebra esse nó sem `forwardRef`.
 *
 * ----------------------------------------------------------------------------
 * A AUTORIDADE VEM DO BANCO, EM TODO NÍVEL — e aqui não existe nem token
 * ----------------------------------------------------------------------------
 * Na tela, `confirm` relê os papéis do banco porque o token de sessão dura oito
 * horas e não acompanha rebaixamento, desativação nem troca de perfil. Neste
 * canal o argumento é mais simples: **não há token nenhum**. Quem chega é um
 * número de telefone. Toda a autoridade — ser gente, ter `aprovacoes.decidir`,
 * alcançar a alçada da linha — sai da consulta abaixo, feita AGORA.
 *
 * `ApprovalsService.confirm` refaz todas elas por conta própria, e isso não é
 * redundância desperdiçada: é onde a trava de verdade mora. O que estas funções
 * acrescentam é RECUSAR ANTES de mexer no estado da aprovação, para que a recusa
 * não custe a linha — o mesmo motivo pelo qual a pergunta do conector e a da
 * régua vêm antes do `confirm` (ver `AcoesService.conectorDesligado`).
 *
 * ----------------------------------------------------------------------------
 * `aprovacoes.decidir` É CONFERIDO AQUI, E TEM DE SER
 * ----------------------------------------------------------------------------
 * Na tela quem confere a permissão é o `PermissionsGuard` do controlador, não o
 * serviço. Um canal que chamasse `confirm` sem conferi-la seria uma porta dos
 * fundos em volta do RBAC: `ApprovalsService.confirm` nunca olhou para
 * `aprovacoes.decidir` — ele olha para alçada, que é outra coisa. Sem a linha
 * abaixo, um usuário de perfil `consulta_limitada` com alçada... não teria
 * alçada; mas um `analista` (alçada `operador`) aprovaria um R2 pelo celular sem
 * ter a permissão que a tela exige dele. A permissão é parte da decisão.
 */

/** A permissão que a tela exige para confirmar ou rejeitar. A mesma vale aqui. */
export const PERMISSAO_DE_DECIDIR = 'aprovacoes.decidir';

/** O canal que esta fatia liga. `ChannelIdentity.canal` é um enum do banco. */
export const CANAL = SessionCanal.whatsapp;

/** Quem é a pessoa, o que ela pode, e por onde se fala com ela. */
export interface DecisorDoCanal {
  userId: string;
  nome: string;
  /** A alçada lida dos papéis do BANCO. `null` = não decide nada. */
  alcada: Alcada | null;
  /** Tem `aprovacoes.decidir` por algum perfil? Também do banco. */
  decide: boolean;
  /** É conta de máquina? Basta um papel de máquina para deixar de ser gente. */
  maquina: boolean;
  /** O endereço cadastrado neste canal, na forma em que está gravado. */
  enderecoDoCanal: string;
}

/** O recorte de `User` que estas funções leem. Nada além disto. */
const SELECAO = {
  id: true,
  name: true,
  isActive: true,
  roles: { select: { key: true, permissions: { select: { key: true } } } },
} as const;

interface LinhaDeUsuario {
  id: string;
  name: string;
  isActive: boolean;
  roles: { key: string; permissions: { key: string }[] }[];
}

/** O cliente do banco, reduzido ao que estas funções usam. */
interface ClienteDeLeitura {
  channelIdentity: {
    findFirst(args: unknown): Promise<{ userId: string | null; externalId: string } | null>;
    findMany(
      args: unknown,
    ): Promise<{ userId: string | null; externalId: string; criadoEm?: Date }[]>;
  };
  user: {
    findFirst(args: unknown): Promise<LinhaDeUsuario | null>;
    findMany(args: unknown): Promise<LinhaDeUsuario[]>;
  };
}

function montar(u: LinhaDeUsuario, endereco: string): DecisorDoCanal {
  const papeis = u.roles.map((r) => r.key);
  return {
    userId: u.id,
    nome: u.name,
    alcada: alcadaDe(papeis),
    decide: u.roles.some((r) => r.permissions.some((p) => p.key === PERMISSAO_DE_DECIDIR)),
    maquina: temPapelDeMaquina(papeis),
    enderecoDoCanal: endereco,
  };
}

/**
 * A IDENTIDADE DESTE REMETENTE, ou `null` — e `null` quer dizer IGNORAR.
 *
 * Três recusas viram o mesmo `null`, de propósito: identidade não cadastrada,
 * identidade desligada (`ativo: false`) e identidade cadastrada sem usuário
 * (`userId` nulo — a tabela permite, e um endereço sem pessoa não é pessoa). As
 * três são "não sei quem é você", e quem chama trata todas do mesmo jeito:
 * silêncio absoluto.
 *
 * A busca é por IGUALDADE, nas duas formas literais em que a chave pode estar
 * gravada (ver `formasDaChave`). Nunca `contains`, nunca `startsWith`.
 */
export async function identidadeDoCanal(
  prisma: ClienteDeLeitura,
  orgId: string,
  chave: string,
): Promise<DecisorDoCanal | null> {
  exigirTenant(orgId, 'canais.identidadeDoCanal');

  const identidade = await prisma.channelIdentity.findFirst({
    where: { orgId, canal: CANAL, ativo: true, externalId: { in: formasDaChave(chave) } },
    select: { userId: true, externalId: true },
  });
  if (!identidade?.userId) return null;

  const usuario = await prisma.user.findFirst({
    where: { id: identidade.userId, orgId, isActive: true },
    select: SELECAO,
  });
  if (!usuario) return null;

  return montar(usuario, identidade.externalId);
}

/**
 * Quem, nesta empresa, pode assinar uma linha de `alcadaMinima` — e tem canal.
 *
 * As mesmas três perguntas da fila na tela (`ApprovalsController.fila`): tem a
 * permissão de decidir, alcança a alçada, e NÃO é quem propôs. A quarta é desta
 * fatia: tem identidade ativa neste canal.
 *
 * `propostoPorId` fora por último e por escrito, porque é a invariante 7 da
 * escada e é a que o canal mais poderia afrouxar sem ninguém notar — a lista de
 * destinatários é invisível para quem olha a tela.
 *
 * ----------------------------------------------------------------------------
 * O CORTE VEM DEPOIS DO FILTRO, E A ORDEM É DECLARADA — defeito medido
 * ----------------------------------------------------------------------------
 * A primeira versão cortava em vinte NA CONSULTA, antes de filtrar, e sem
 * `orderBy`. As duas coisas juntas produzem o pior resultado possível: a ordem
 * de um `findMany` sem ordenação é a que o Postgres achar mais barata (e ela
 * muda com o plano, com o VACUUM, com a página em cache), então QUEM PODE
 * ASSINAR podia simplesmente não estar entre os vinte primeiros — e ninguém era
 * avisado. Uma empresa com vinte e um números cadastrados, dos quais um só tem
 * alçada, tinha uma chance real de nunca notificar justamente esse.
 *
 * Agora a consulta traz o conjunto INTEIRO das identidades ativas com pessoa,
 * ordenado por `criadoEm` (e por `id` para desempate — `criadoEm` tem resolução
 * de milissegundo e duas identidades cadastradas no mesmo instante existem), e o
 * corte acontece DEPOIS do filtro. O teto de leitura continua existindo, mas é
 * de outra ordem de grandeza e serve a outra coisa: impedir que uma empresa com
 * milhares de identidades carregue tudo em memória.
 */
export const TETO_DE_IDENTIDADES_LIDAS = 500;

export async function decisoresComCanal(
  prisma: ClienteDeLeitura,
  orgId: string,
  alcadaMinima: unknown,
  propostoPorId: string,
  teto = 20,
): Promise<DecisorDoCanal[]> {
  exigirTenant(orgId, 'canais.decisoresComCanal');

  const identidades = await prisma.channelIdentity.findMany({
    where: { orgId, canal: CANAL, ativo: true, userId: { not: null } },
    select: { userId: true, externalId: true, criadoEm: true },
    orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }],
    take: TETO_DE_IDENTIDADES_LIDAS,
  });
  if (identidades.length === 0) return [];

  const ids = [...new Set(identidades.map((i) => i.userId as string))];
  const usuarios = await prisma.user.findMany({
    where: { id: { in: ids }, orgId, isActive: true },
    select: SELECAO,
  });
  const porId = new Map(usuarios.map((u) => [u.id, u]));

  const saida: DecisorDoCanal[] = [];
  for (const identidade of identidades) {
    const u = porId.get(identidade.userId as string);
    if (!u) continue;
    const d = montar(u, identidade.externalId);
    if (d.maquina || !d.decide) continue;
    if (!atendeAlcada(alcadaMinima, d.alcada)) continue;
    if (d.userId === propostoPorId) continue;
    saida.push(d);
    // O corte do ENVIO, depois do filtro: vinte mensagens de WhatsApp por
    // aprovação já é muito, e quem passa disso tem um problema de cadastro.
    if (saida.length >= teto) break;
  }
  return saida;
}
