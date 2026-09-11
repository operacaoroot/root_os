/*
 * ============================================================================
 * QUANDO UMA REVOGAÇÃO JÁ NÃO VALE — a saída da armadilha permanente
 * ============================================================================
 *
 * A REGRA GERAL CONTINUA DE PÉ, e ela é a razão de o cofre distinguir "não
 * existe" de "revogado" num CAMPO: cair para a coluna antiga depois de uma
 * revogação é NÃO TER REVOGADO. Quem lê credencial (`GoogleService`,
 * `MetaService`, o consumidor da bio) trata "revogado" como terminal e manda
 * reautorizar.
 *
 * SÓ QUE HÁ UM CASO EM QUE "REAUTORIZE" É A INSTRUÇÃO QUE NÃO RESOLVE, e ele é
 * o defeito que esta função existe para fechar:
 *
 *   1. alguém desconecta o Google/Instagram → a linha local é apagada E o
 *      segredo é marcado como revogado no cofre;
 *   2. alguém reautoriza → a linha local NASCE DE NOVO, com o token novo; a
 *      gravação no cofre é "tenta e segue" e, se falhar, a marca de revogação
 *      CONTINUA LÁ;
 *   3. a leitura seguinte vê "revogado", lança "reautorize em Conexões" — e
 *      reautorizar cai de novo no passo 2. O conector morre para sempre, com uma
 *      mensagem mandando fazer o que não adianta.
 *
 * A PERGUNTA QUE DESFAZ O NÓ é de ordem no tempo: a autorização local é
 * POSTERIOR à revogação? Se for, uma pessoa autorizou DEPOIS de alguém ter
 * queimado — e a revogação foi substituída por um ato humano mais recente, não
 * ignorada. A comparação é honesta porque desconectar APAGA a linha local: uma
 * linha que exista com `connectedAt` posterior ao `revogadoEm` só pode ter
 * nascido de uma autorização nova.
 *
 * O QUE ISTO **NÃO** AFROUXA: revogação feita direto no cofre (pela linha de
 * comando, num incidente) sem mexer na linha local continua terminal — ali o
 * `revogadoEm` é mais novo que o `connectedAt`, e a resposta é a de sempre.
 *
 * NA DÚVIDA, TERMINAL. Se o cofre não puder responder quando a revogação
 * aconteceu, esta função devolve "não superada": preferimos um conector parado
 * com instrução errada (que uma pessoa desfaz apagando a linha do cofre) a uma
 * revogação silenciosamente ignorada.
 */

/** O mínimo do cofre de que esta função precisa — tipado por forma, para não
 *  arrastar o `CofreService` (e o Nest junto) para dentro de quem só compara
 *  duas datas. */
export interface LeitorDoEstadoDoCofre {
  estado(orgId: string): Promise<{
    items: ReadonlyArray<{ conector: string; nome: string; revogadoEm: string | null }>;
  }>;
}

export interface RevogacaoSuperada {
  /** A revogação foi substituída por uma autorização posterior? */
  superada: boolean;
  /** Quando a credencial foi revogada, se deu para saber. */
  revogadaEm: Date | null;
  /** Por que não foi possível decidir (só quando `superada` é falso). */
  porque: string | null;
}

export async function revogacaoFoiSuperada(
  cofre: LeitorDoEstadoDoCofre | undefined,
  entrada: {
    orgId: string;
    conector: string;
    nome: string;
    /** `connectedAt` da linha local — a hora em que ESTA autorização nasceu. */
    autorizadaEm?: Date | null;
  },
): Promise<RevogacaoSuperada> {
  if (!cofre) {
    return { superada: false, revogadaEm: null, porque: 'não há cofre neste processo' };
  }
  if (!entrada.autorizadaEm) {
    return {
      superada: false,
      revogadaEm: null,
      porque: 'não há autorização local com data para comparar',
    };
  }
  let revogadaEm: Date | null = null;
  try {
    const { items } = await cofre.estado(entrada.orgId);
    const linha = items.find((i) => i.conector === entrada.conector && i.nome === entrada.nome);
    revogadaEm = linha?.revogadoEm ? new Date(linha.revogadoEm) : null;
  } catch (e) {
    return {
      superada: false,
      revogadaEm: null,
      porque: `o cofre não disse quando a revogação aconteceu (${(e as Error).message})`,
    };
  }
  if (!revogadaEm || Number.isNaN(revogadaEm.getTime())) {
    return { superada: false, revogadaEm: null, porque: 'o cofre não tem data de revogação' };
  }
  if (entrada.autorizadaEm.getTime() <= revogadaEm.getTime()) {
    return { superada: false, revogadaEm, porque: 'a revogação é posterior à autorização local' };
  }
  return { superada: true, revogadaEm, porque: null };
}
