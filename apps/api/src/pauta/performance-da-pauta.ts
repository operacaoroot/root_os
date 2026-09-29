import {
  PAUTA_METRICAS_DA_CASA,
  PAUTA_PISO_DE_POSTS_DO_INDICE,
  faixaDoIndice,
  indiceDoPost,
  medianaDe,
  type PautaMetricaDaCasa,
  type PautaNumerosDoPost,
  type PautaPostMedido,
  type PautaSnapshotDaPerformance,
} from '@mktos/shared';

/*
 * ============================================================================
 * A PERFORMANCE DA CASA (MK5) — a parte pura
 * ============================================================================
 *
 * A MESMA RÉGUA DA MK2, de propósito: a mediana do próprio perfil e o índice de
 * cada post contra ela. Duas contas diferentes para "o que rendeu" dariam dois
 * números para a mesma pergunta — e o de dentro sempre pareceria melhor.
 *
 * O snapshot é uma FOTOGRAFIA do mês. Os números da Graph não param: um post de
 * março continua somando visualização em setembro. Comparar meses só faz
 * sentido se cada mês guardar o que viu no dia em que viu — por isso
 * `coletadoEm` fica gravado ao lado dos números, e recoletar o mesmo mês
 * substitui a fotografia inteira em vez de mesclar.
 */

export interface PostParaMedir {
  pecaId: string;
  titulo: string;
  formato: string;
  publicadaEm: string | null;
  urlPublicada: string | null;
  /** O id na rede. Sem ele não há o que perguntar à Graph. */
  externalId: string | null;
  /** Os números lidos, ou nulo quando a leitura falhou ou nem foi tentada. */
  numeros: PautaNumerosDoPost | null;
  /** Por que ficou sem número, quando ficou. */
  erro: string | null;
}

const SEM_ID =
  'Publicada à mão: o OS não guardou o id do post na rede, então não há o que perguntar à Graph.';

const VAZIO: PautaNumerosDoPost = {
  visualizacoes: null,
  curtidas: null,
  comentarios: null,
  salvamentos: null,
  compartilhamentos: null,
};

/**
 * O snapshot do mês. Post sem número entra na lista — com o motivo — em vez de
 * sumir: a lista é a prestação de contas do que foi publicado, e um post que
 * some da medição some da conversa.
 */
export function montarSnapshot(args: {
  mes: string;
  coletadoEm: Date;
  seguidores: number | null;
  posts: PostParaMedir[];
}): PautaSnapshotDaPerformance {
  const avisos: string[] = [];
  const comNumero = args.posts.filter((p) => p.numeros);

  const medianas = Object.fromEntries(
    PAUTA_METRICAS_DA_CASA.map((m) => [m, medianaDe(comNumero.map((p) => p.numeros![m]))]),
  ) as Record<PautaMetricaDaCasa, number | null>;

  const poucos = comNumero.length < PAUTA_PISO_DE_POSTS_DO_INDICE;
  if (!args.posts.length) {
    avisos.push(`Nenhuma peça publicada em ${args.mes}.`);
  } else if (!comNumero.length) {
    avisos.push('Nenhum post trouxe número: confira a conexão do Instagram e as permissões da conta.');
  } else if (poucos) {
    avisos.push(
      `Com ${comNumero.length} post(s) medido(s) a mediana não diz nada: o índice aparece a partir de ${PAUTA_PISO_DE_POSTS_DO_INDICE}.`,
    );
  }

  const metricaDeReferencia = poucos
    ? null
    : (PAUTA_METRICAS_DA_CASA.find((m) => (medianas[m] ?? 0) > 0) ?? null);

  const semNumero = args.posts.length - comNumero.length;
  if (semNumero && comNumero.length) {
    avisos.push(`${semNumero} post(s) sem número — o motivo está na linha de cada um.`);
  }

  const posts: PautaPostMedido[] = args.posts.map((p) => {
    const numeros = p.numeros ?? VAZIO;
    const indices = Object.fromEntries(
      PAUTA_METRICAS_DA_CASA.map((m) => [m, poucos || !p.numeros ? null : indiceDoPost(numeros[m], medianas[m])]),
    ) as Record<PautaMetricaDaCasa, number | null>;
    return {
      pecaId: p.pecaId,
      titulo: p.titulo,
      formato: p.formato,
      publicadaEm: p.publicadaEm,
      urlPublicada: p.urlPublicada,
      numeros,
      indices,
      faixa: metricaDeReferencia && p.numeros ? faixaDoIndice(indices[metricaDeReferencia]) : null,
      semNumero: p.numeros ? null : (p.erro ?? (p.externalId ? 'A leitura não trouxe número para este post.' : SEM_ID)),
    };
  });

  // Do que mais rendeu para o que menos, e os sem número no fim: é a ordem em
  // que alguém lê, e deixar o não medido no meio esconde o que foi medido.
  const ordem = metricaDeReferencia
    ? [...posts].sort((a, b) => {
        const va = a.indices[metricaDeReferencia];
        const vb = b.indices[metricaDeReferencia];
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        return vb - va;
      })
    : posts;

  return {
    mes: args.mes,
    coletadoEm: args.coletadoEm.toISOString(),
    seguidores: args.seguidores,
    posts: ordem,
    medianas,
    metricaDeReferencia,
    medidos: comNumero.length,
    publicados: args.posts.length,
    avisos,
  };
}

/** O motivo pelo qual ainda não dá para medir, ou nulo quando dá. */
export function comoConectar(conta: { externalId: string; escopos: string[] } | null): string | null {
  if (!conta) {
    return 'O Instagram não está conectado nesta empresa. Conecte a conta de publicação na aba Semana da Pauta — a mesma conexão que publica é a que lê os números.';
  }
  return null;
}
