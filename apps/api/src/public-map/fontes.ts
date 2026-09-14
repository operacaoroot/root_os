import type { PrismaClient } from '@prisma/client';

/*
 * O REGISTRO FECHADO DE LEITURAS AGREGADAS — fatia 6.5
 * ====================================================
 *
 * O mapa público mostra TEXTO escrito à mão (ver `prisma/schema.prisma`,
 * `MapaPublicoItem`) e, ao lado de alguns nós, um NÚMERO ao vivo. Este arquivo é
 * o conjunto inteiro de números que a página pode mostrar.
 *
 * TRÊS REGRAS, E AS TRÊS SÃO O QUE FAZ ISTO NÃO SER UMA BRECHA
 *
 *  1. CADA ENTRADA DEVOLVE UM INTEIRO. Nunca uma linha, nunca um nome, nunca um
 *     trecho de texto. Não há caminho daqui para o conteúdo de registro nenhum —
 *     o que sai é uma contagem.
 *  2. O NÚMERO SÓ APARECE SE UMA LINHA PUBLICADA O PEDIR PELO NOME. Este
 *     registro não é uma lista de coisas públicas: é uma lista do que EXISTE
 *     para ser pedido. Enquanto ninguém publicar uma linha com `fonte =
 *     'rastro.eventos.30d'`, esse número não aparece em lugar nenhum.
 *  3. CHAVE DESCONHECIDA NÃO DERRUBA E NÃO INVENTA. Uma linha que peça uma
 *     fonte que não existe (erro de digitação, fonte removida do código) mostra
 *     o nó SEM número. Recusar a página inteira por causa de uma linha seria
 *     trocar um nó sem número por uma porta de entrada fora do ar.
 *
 * POR QUE ISTO NÃO É A "LISTA DE PERMISSÃO POR TIPO" QUE A FATIA PROÍBE
 * A proibição é contra "toda nota do tipo X é pública" — a regra que vaza no dia
 * em que alguém criar uma nota daquele tipo sem pensar nesta tela. Aqui não há
 * registro que se torne público por pertencer a um tipo: o que existe são
 * CONTAGENS, que não são registro de ninguém, e cada uma só aparece porque uma
 * linha publicada a nomeou.
 *
 * ONDE ESTAS CONSULTAS RODAM
 * Dentro de `comTenantPublico(orgId, …)` (ver `mapa-publico.service.ts`), com a
 * empresa já resolvida e publicada na sessão de banco. Todas filtram `orgId`
 * EXPLICITAMENTE além disso, e não por desconfiança da policy: enquanto a
 * aplicação conectar como DONA das tabelas o isolamento é inerte, e uma contagem
 * sem `where` somaria as empresas todas. A proteção tem de estar no código.
 */

/** Uma leitura agregada que a página pode mostrar. */
export interface FonteDeNumero {
  /** O que este número quer dizer. Aparece no relatório, não na tela. */
  descricao: string;
  /** A leitura. Recebe `agora` para o teste não depender do relógio. */
  ler(prisma: PrismaClient, orgId: string, agora: Date): Promise<number>;
}

/** A janela do número do rastro, em dias. Um mês fechado é o que se lê rápido. */
export const JANELA_DO_RASTRO_DIAS = 30;

function diasAtras(agora: Date, dias: number): Date {
  return new Date(agora.getTime() - dias * 24 * 60 * 60 * 1000);
}

export const FONTES_DO_MAPA: Readonly<Record<string, FonteDeNumero>> = {
  /*
   * A CHAVE CONTINUA SENDO `agentes.rodando` e o valor consultado virou `ativo`
   * (fatia A2, quando o agente ganhou enum próprio e `rodando` deixou de ser
   * estado declarado).
   *
   * A chave NÃO é renomeada de propósito: ela é DADO, gravada em
   * `MapaPublicoItem.fonte` pelas linhas que uma empresa já publicou. Trocar o
   * nome aqui faria cada uma dessas linhas pedir uma fonte que não existe mais —
   * e a regra 3 do cabeçalho é que chave desconhecida não derruba e não inventa,
   * ou seja, o número simplesmente desapareceria da página pública, em silêncio.
   */
  'agentes.rodando': {
    descricao: 'agentes da empresa em operação (estado declarado "ativo")',
    ler: (prisma, orgId) => prisma.agent.count({ where: { orgId, estado: 'ativo' } }),
  },

  'rotinas.rodando': {
    descricao: 'rotinas ativas da empresa com estado "rodando"',
    ler: (prisma, orgId) =>
      prisma.rotina.count({ where: { orgId, ativo: true, estado: 'rodando' } }),
  },

  'contexto.itens': {
    descricao: 'itens de contexto da empresa que não foram arquivados',
    ler: (prisma, orgId) =>
      prisma.contextItem.count({ where: { orgId, arquivadoEm: null } }),
  },

  'rastro.eventos.30d': {
    descricao: `eventos do RASTRO da empresa nos últimos ${JANELA_DO_RASTRO_DIAS} dias`,
    ler: (prisma, orgId, agora) =>
      prisma.eventLog.count({
        where: { orgId, ocorreuEm: { gte: diasAtras(agora, JANELA_DO_RASTRO_DIAS) } },
      }),
  },
};

/** A chave está no registro? A pergunta que decide se o nó ganha número. */
export function fonteConhecida(chave: string | null | undefined): chave is string {
  return typeof chave === 'string' && Object.hasOwn(FONTES_DO_MAPA, chave);
}

/**
 * Lê as fontes pedidas, uma vez cada, em paralelo.
 *
 * Chave desconhecida sai do conjunto ANTES da consulta — ver a regra 3. Consulta
 * que falha devolve `null` para aquele nó em vez de derrubar a página: o mapa
 * público é a porta de entrada do domínio, e um `count` que estourou não pode
 * ser o motivo de ela não abrir.
 */
export async function lerFontes(
  prisma: PrismaClient,
  orgId: string,
  pedidas: Iterable<string>,
  agora: Date = new Date(),
  aoFalhar?: (chave: string, erro: unknown) => void,
): Promise<Map<string, number>> {
  const chaves = [...new Set([...pedidas].filter(fonteConhecida))];
  const numeros = new Map<string, number>();

  await Promise.all(
    chaves.map(async (chave) => {
      try {
        numeros.set(chave, await FONTES_DO_MAPA[chave].ler(prisma, orgId, agora));
      } catch (e) {
        aoFalhar?.(chave, e);
      }
    }),
  );

  return numeros;
}
