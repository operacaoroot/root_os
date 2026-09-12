import { ContextKind, ContextSource } from '@prisma/client';

import { CHAVE_DO_RETRATO, TEMAS_DA_CARGA, chaveDoTema, temaPorId } from '../agents/roster';
import { cortar, normalizar } from './carga-guiada';

/* ==========================================================================
 * O RETRATO — a primeira resposta, e por que ela NÃO passa pela busca
 * ==========================================================================
 *
 * A fatia pede "primeira resposta com procedência". Esta é ela: a leitura de
 * volta do que a carga entendeu, com a nota de origem ao lado de cada parte.
 * É o último passo do procedimento do carregador ("no fim, leia de volta o que
 * você entendeu, citando a nota de onde veio cada parte") e a definição de
 * pronto dele.
 *
 * ----------------------------------------------------------------------------
 * POR QUE A PRIMEIRA RESPOSTA É CONSTRUÍDA, E NÃO PEDIDA AO MODELO
 * ----------------------------------------------------------------------------
 * Porque a resposta do modelo, numa empresa recém-criada, tem chance concreta
 * de sair SEM FONTE — e a onda 10 ligou a consequência disso. O caminho é
 * este, e ele foi medido no código, não suposto:
 *
 *   1. o contexto do agente vem de `ContextBuilder.montar`, que busca em
 *      `ObsidianService.search` — ou seja, na tabela `KnowledgeNote`;
 *   2. `search` roda em modo SEMÂNTICO sempre que `OPENAI_API_KEY` existe, e o
 *      SQL daquele modo filtra `embedding IS NOT NULL`;
 *   3. `reindex` (que é quem gera embedding de `KnowledgeNote`) só roda para a
 *      empresa da CASA — `obsidian.service.ts`, no laço do `onModuleInit`. A
 *      vetorização por empresa que roda ali é a da MEMÓRIA (`ContextItem`), não
 *      a do índice;
 *   4. logo, numa empresa cliente com a chave da OpenAI presente, as notas da
 *      carga NÃO aparecem na busca do contexto. O modelo responde sem trecho
 *      nenhum, e `respostaSemProcedencia` marca a sessão assim que a resposta
 *      tiver um algarismo;
 *   4b. E NÃO HÁ REDE DE PROTEÇÃO NESSE CAMINHO, que é o elo que fecha o
 *      argumento: `ObsidianService.search` só cai para a busca textual dentro do
 *      `catch` — ou seja, quando o modo semântico LANÇA. Resultado vazio não é
 *      exceção: o SQL devolve zero linha, a função devolve zero linha, e
 *      pronto. Ela não acha nada **e não avisa que não achou por falta de
 *      vetor**. Quem lê o traço vê `nada_na_base`, que é a leitura errada — a
 *      base TEM o registro, o índice é que não o alcança;
 *   5. marcada, a sessão acende sinal em `SinaisService`, a barra sobe um
 *      degrau nas ações seguintes daquele agente por 24h, e numa empresa com
 *      UM usuário — onde quem propõe não pode aprovar — isso trava a operação
 *      no primeiro dia.
 *
 * Gerar o embedding aqui não é opção: ler `OPENAI_API_KEY` fora de `src/llm/`
 * reprova a catraca de arquitetura (`test/arquitetura.test.ts`, "o modelo tem
 * uma casa só"), e com razão — seria a quarta cópia da mesma chamada.
 *
 * Então a primeira resposta é CONSTRUÍDA a partir das notas que a carga acabou
 * de gravar. Ela não pode sair sem fonte porque ela É as fontes: cada parágrafo
 * é um trecho de uma nota, com a chave e a procedência dela ao lado. A pergunta
 * livre ao assistente continua existindo (`/primeira-pergunta`), roda pelo laço
 * de verdade e RELATA a procedência medida — inclusive quando ela vem vazia,
 * que é o caso acima e está no roteiro de teste como critério de falha.
 */

/** Uma nota da carga, como o retrato precisa dela. */
export interface NotaParaRetrato {
  id: string;
  chave: string;
  titulo: string;
  corpo: string;
  /** O rótulo pronto (`operador:carregador-de-contexto:negocio`). */
  procedencia: string;
  versao: number;
}

/** A fonte citada, no mesmo vocabulário que o laço do agente usa. */
export interface FonteDoRetrato {
  tipo: 'nota';
  id: string;
  titulo: string;
  ref: string;
  procedencia: string;
}

export interface Retrato {
  texto: string;
  fontes: FonteDoRetrato[];
  /** Temas obrigatórios que ficaram de fora. O retrato os DECLARA. */
  pendentes: string[];
  /** A nota que o retrato vira na memória. `null` quando não há o que gravar. */
  nota: {
    chave: string;
    titulo: string;
    corpo: string;
    kind: ContextKind;
    tags: string[];
    sourceType: ContextSource;
    sourceRef: string;
    motivo: string;
  } | null;
}

/**
 * Retrato pedido sem nota nenhuma.
 *
 * LANÇA em vez de devolver um texto vazio, e a diferença é a regra da casa: a
 * primeira resposta do produto não pode ser uma frase amável sobre uma memória
 * que não existe. Sem nota não há o que ler de volta — e o que a tela deve
 * mostrar nesse caso é a carga guiada, não um retrato.
 */
export class RetratoSemFonteError extends Error {
  constructor() {
    super(
      'não há nota carregada para ler de volta. A primeira resposta do OS é feita das notas da ' +
        'carga; sem nenhuma, ela sairia afirmando coisas sem fonte — que é exatamente o defeito ' +
        'que marca a sessão e sobe a barra da régua (RF-M-02, RNF-03).',
    );
    this.name = 'RetratoSemFonteError';
  }
}

/** Quanto de cada nota entra no retrato. O resto fica na nota, que é onde mora. */
const TRECHO = 320;

/**
 * Monta a leitura de volta.
 *
 * A ordem é a do ROTEIRO, não a de gravação: o retrato é o negócio contado na
 * ordem em que ele foi perguntado, e uma ordem que dependesse de quando a
 * pessoa respondeu deixaria dois retratos da mesma empresa diferentes.
 *
 * TODO PARÁGRAFO É CITAÇÃO. Não há frase de ligação que afirme algo que não
 * esteja numa nota — é o que torna impossível esta resposta sair sem fonte.
 */
export function montarRetrato(
  notas: readonly NotaParaRetrato[],
  empresa: { nome: string; slug: string },
): Retrato {
  const porChave = new Map(notas.map((n) => [n.chave, n]));
  const linhas: string[] = [];
  const fontes: FonteDoRetrato[] = [];
  const pendentes: string[] = [];

  for (const tema of TEMAS_DA_CARGA) {
    const nota = porChave.get(chaveDoTema(tema.id));
    if (!nota) {
      if (tema.obrigatorio) pendentes.push(tema.id);
      continue;
    }
    const trecho = cortar(normalizar(nota.corpo), TRECHO);
    linhas.push(`## ${nota.titulo}`, trecho, `— fonte: ${nota.chave} (${nota.procedencia})`, '');
    fontes.push({
      tipo: 'nota',
      id: nota.id,
      titulo: nota.titulo,
      ref: nota.chave,
      procedencia: nota.procedencia,
    });
  }

  if (fontes.length === 0) throw new RetratoSemFonteError();

  const cabecalho = [
    `Isto é o que o OS entendeu sobre ${empresa.nome} a partir do que você respondeu.`,
    'Cada parte abaixo cita a nota da memória de onde veio — nada aqui foi inventado.',
    '',
  ];

  const rodape: string[] = [];
  if (pendentes.length) {
    /*
     * O PENDENTE É DECLARADO, e não silenciado. É a mesma disciplina da
     * declaração de ausência do contexto (`context-builder.service.ts`): o que
     * não está carregado tem de aparecer como ausência, senão a próxima
     * resposta sobre aquele assunto vai sair de lugar nenhum.
     */
    rodape.push(
      'Ainda falta carregar: ' +
        pendentes.map((id) => temaPorId(id)?.titulo ?? id).join(' · ') +
        '. Enquanto faltar, o OS vai dizer que não sabe quando perguntarem sobre isso.',
    );
  }

  const texto = [...cabecalho, ...linhas, ...rodape].join('\n').trim();

  return {
    texto,
    fontes,
    pendentes,
    nota: {
      chave: CHAVE_DO_RETRATO,
      titulo: `Retrato de ${empresa.nome}`,
      corpo: texto,
      kind: ContextKind.nota,
      tags: ['onboarding', 'retrato'],
      /*
       * `promocao` é a procedência certa: RF-M-06 chama assim a resposta do
       * agente promovida a nota, e é exatamente o que o retrato é. O
       * `sourceRef` aponta para a empresa, que é a "sessão" desta promoção —
       * a carga guiada não abre `Session`, e inventar um identificador de
       * sessão que não existe seria procedência falsa.
       */
      sourceType: ContextSource.promocao,
      sourceRef: `onboarding:${empresa.slug}`,
      motivo: 'retrato lido de volta no fim da carga guiada',
    },
  };
}
