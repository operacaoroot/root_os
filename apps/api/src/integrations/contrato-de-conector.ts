/*
 * ============================================================================
 * O CONTRATO ÚNICO DE CONECTOR — RF-X-01, RF-X-02, RF-X-06 (fatia 5.4)
 * ============================================================================
 *
 * Quatro verbos, e só quatro: AUTORIZAR, SINCRONIZAR, SAÚDE, REVOGAR.
 *
 * Este arquivo é a parte PURA da fatia — tipos, os três estados de saúde e as
 * funções que os constroem. Não toca banco, não sobe Nest e não conhece nenhum
 * conector em particular: é por isso que a suíte consegue interrogar o contrato
 * inteiro sem Postgres.
 *
 * ----------------------------------------------------------------------------
 * O QUE ESTE CONTRATO **NÃO** É — três confusões que custam caro
 * ----------------------------------------------------------------------------
 *
 *  1. NÃO SUBSTITUI O DESLIGAMENTO POR EMPRESA (RF-G-06, `conectores.ts`).
 *     DESLIGAR é PAUSA: a decisão fica gravada, a chamada é recusada com motivo,
 *     e a CREDENCIAL NÃO É TOCADA — religar é apagar uma linha e ninguém refaz
 *     OAuth. REVOGAR é QUEIMAR: o valor some do cofre e não volta; reautorizar é
 *     a única saída. São duas perguntas diferentes, feitas em momentos
 *     diferentes, com preços diferentes, e o contrato ACOMODA a primeira em vez
 *     de reimplementá-la. Ver `RegistroDeConectores.saudeDe`, que se recusa a
 *     sondar um conector desligado justamente porque sondar é sair da casa.
 *
 *  2. NÃO SUBSTITUI `ConectoresConfiguradosRegistry` (pasta da porta). Aquele
 *     responde "o PROCESSO tem credencial para falar com este fornecedor?", uma
 *     propriedade do ambiente, e é ele que derruba o arranque quando um conector
 *     dono de segredo não se inscreve. Este aqui responde "ESTA EMPRESA consegue
 *     usar este conector AGORA?", que é outra pergunta e tem outra resposta. As
 *     duas convivem: o `status` legado da tela continua vindo de lá quando o
 *     contrato não tem nada a dizer.
 *
 *  3. NÃO É A PORTA. Quem classifica risco, retém para aprovação e escreve no
 *     RASTRO é o Tool Gateway. O contrato é o ciclo de vida da LIGAÇÃO, não da
 *     ação: autorizar não é ação sobre o mundo (é o consentimento que a torna
 *     possível), e sondar saúde é leitura sem efeito. O que AGE continua
 *     passando pela porta — inclusive `sincronizar`, que quando escreve fora da
 *     casa delega ao método do conector que já pergunta ao interruptor.
 *
 * ----------------------------------------------------------------------------
 * A REGRA QUE MANDA NESTE ARQUIVO: NUNCA LUZ VERDE FALSA
 * ----------------------------------------------------------------------------
 * `conectado` SÓ pode nascer de uma TENTATIVA contra a dependência real, e a
 * regra é cobrada em TRÊS degraus — porque os dois primeiros, sozinhos, cobram
 * ASSINATURA e não MEDIÇÃO:
 *
 *  1. `conectado()` exige latência como argumento e recusa número que não seja
 *     finito. Fecha o erro por descuido de quem escreve o conector;
 *  2. `normalizarSaude` rebaixa para `erro` (com grito no log) toda resposta
 *     verde que se declare fora de `tentativa` OU cuja latência não seja um
 *     número finito. Fecha o objeto montado à mão;
 *  3. `carimbarMedicao` — e este é o degrau que faltava — TROCA a latência
 *     declarada pela que o REGISTRO mediu com o relógio dele. Um conector que
 *     monte `{conectado, tentativa, latenciaMs: 3}` sem ter chamado ninguém não
 *     consegue mais escolher o número que a tela mostra: o que aparece é o tempo
 *     real que a sonda levou. A assinatura continua sendo do conector; a
 *     MEDIÇÃO passou a ser de quem mede.
 *
 * Isto não é zelo abstrato: já aconteceu nesta execução. A tela passou a exibir
 * o Google como CONECTADO em empresa que nunca autorizou nada, porque a pergunta
 * respondida era "o aplicativo tem credencial" — verdadeira em produção para
 * todo mundo — e não "esta empresa autorizou". Por isso `saude` recebe `orgId` e
 * a assinatura não tem como esquecer a empresa.
 */

/**
 * Os estados que a tela mostra.
 *
 * TRÊS SÃO ESTADOS DE SAÚDE e um é a AUSÊNCIA DE MEDIÇÃO:
 *
 *   · `conectado`       — sondado agora, respondeu. Verde;
 *   · `nao_configurado` — falta o que é preciso (credencial do processo, ou
 *                         autorização DESTA empresa, ou a vault no disco).
 *                         Cinza. Não é erro: nada quebrou, ninguém ligou ainda;
 *   · `erro`            — tentou e falhou. Vermelho, com a mensagem REAL;
 *   · `nao_verificado`  — NÃO É COR. É o que sobra quando a sonda não podia ser
 *                         feita: o conector está desligado para esta empresa e
 *                         sondar seria sair da casa depois de alguém ter mandado
 *                         parar. Cinza, e a tela diz por quê.
 *
 * O quarto valor existe porque a alternativa era pior: sem ele, um conector
 * desligado teria de ser exibido como `conectado` (verde sem sonda — a mentira
 * que esta fatia veio matar), como `nao_configurado` (falso: a credencial está
 * lá) ou como `erro` (falso: nada falhou).
 */
export type EstadoDeConector = 'conectado' | 'nao_configurado' | 'erro' | 'nao_verificado';

/** Como o estado foi apurado. `conectado` só vale com `tentativa`. */
export type ApuracaoDeSaude = 'tentativa' | 'declaracao' | 'nao_verificado';

export interface SaudeDeConector {
  estado: EstadoDeConector;
  /**
   * A frase em português. Obrigatória quando o estado não é `conectado` — é ela
   * que a tela mostra em vermelho, e ela carrega a MENSAGEM REAL do fornecedor,
   * não um rótulo genérico. Em `conectado` pode trazer um detalhe útil
   * ("conta pedro@…", "432 nota(s) indexada(s)") ou vir nula.
   */
  mensagem: string | null;
  apuracao: ApuracaoDeSaude;
  /** ISO. Quem lê a tela precisa saber de QUANDO é o verde. */
  verificadoEm: string;
  /** Milissegundos da sonda, quando houve sonda. */
  latenciaMs: number | null;
}

/** O que `autorizar` pode devolver. */
export type ResultadoDeAutorizacao =
  /** Mande o navegador para cá (OAuth). */
  | { tipo: 'redirecionar'; url: string }
  /**
   * Não há fluxo automático: alguém precisa fazer algo fora do OS. A
   * `instrucao` é escrita para a pessoa que vai fazer, não para o log.
   */
  | { tipo: 'manual'; instrucao: string }
  /** Já autorizado; não há o que pedir. */
  | { tipo: 'pronto'; detalhe: string }
  /** Este conector não tem autorização — e o motivo fica escrito. */
  | { tipo: 'nao_se_aplica'; motivo: string };

/** O que `sincronizar` pode devolver. */
export type ResultadoDeSincronizacao =
  | { tipo: 'feito'; resumo: string; numeros?: Record<string, number> }
  | { tipo: 'nao_se_aplica'; motivo: string };

/** O que `revogar` pode devolver. */
export type ResultadoDeRevogacao =
  | {
      tipo: 'revogado';
      /** Os nomes de segredo que foram queimados. */
      segredos: string[];
      resumo: string;
    }
  /**
   * Nada a revogar NESTA empresa — e a distinção importa: quase sempre quer
   * dizer "a credencial é do processo, não desta empresa; o que existe aqui é
   * DESLIGAR". O motivo tem de dizer isso com todas as letras, senão quem clica
   * acha que queimou algo.
   */
  | { tipo: 'nao_se_aplica'; motivo: string };

/**
 * De quem é a credencial deste conector.
 *
 * `empresa` — cada empresa autoriza a sua (Google, Meta). Revogar faz sentido, e
 *             a saúde varia de empresa para empresa.
 * `processo` — a credencial é do ambiente e vale para todas as empresas (ClickUp,
 *             Evolution, vault do Obsidian). Revogar NÃO faz sentido por empresa:
 *             o que existe é desligar. A saúde é praticamente a mesma para todo
 *             mundo, e a tela diz isso em vez de fingir que é por cliente.
 *
 * O campo existe para a tela não ter de adivinhar qual botão oferecer, e para o
 * contrato poder ser conferido: conector de credencial de processo que devolve
 * `revogado` está mentindo sobre o alcance do que fez.
 */
export type EscopoDaCredencial = 'empresa' | 'processo';

/** A empresa em nome de quem o verbo é executado, e quem mandou. */
export interface ContextoDoVerbo {
  orgId: string;
  actorId?: string | null;
}

/**
 * O CONTRATO. Um conector implementa os quatro verbos — todos os quatro.
 *
 * NÃO HÁ VERBO OPCIONAL, e a escolha é deliberada. Um método ausente obriga
 * quem chama a adivinhar por que ele não existe, e obriga a tela a inventar uma
 * frase. Um método presente que devolve `nao_se_aplica` com motivo em português
 * é a mesma informação, dita pelo lado que sabe. Foi assim que o registro de
 * desligamento resolveu o mesmo problema (`SEM_INTERRUPTOR`, em `conectores.ts`):
 * o valor é o MOTIVO, porque é ele que a próxima pessoa lê.
 */
export interface ConectorDoContrato {
  /**
   * A chave do conector — a UNIDADE DE CREDENCIAL, não a superfície.
   *
   * `google` e não `gmail`/`gcal`/`gdocs`/`drive`: o catálogo lista quatro
   * porque são quatro telas, mas a credencial é uma só (uma linha de
   * `GoogleAccount` por empresa), e é a mesma chave sob a qual o cofre guarda o
   * par de tokens (`cofre/migrar-credenciais.ts`). Guardar sob `gmail` faria o
   * `gcal` procurar um segredo que não existe.
   */
  readonly chave: string;

  /** O nome que uma pessoa lê. */
  readonly rotulo: string;

  readonly escopoDaCredencial: EscopoDaCredencial;

  /**
   * As linhas do catálogo de conexões por que este conector responde.
   *
   * Vazio (ou ausente) quer dizer `[chave]`. O Google declara as quatro
   * superfícies; um conector novo que ainda não existe em `CONNECTORS`
   * (`packages/shared`) declara `[]` e ganha uma linha própria montada a partir
   * do que ele diz aqui — é ASSIM que conector novo aparece no catálogo SEM
   * tocar no núcleo.
   */
  readonly linhasDoCatalogo?: readonly string[];

  /** Para a linha montada quando o conector não existe em `CONNECTORS`. */
  readonly categoria?: string;
  readonly exige?: string;

  /**
   * A permissão que o verbo genérico `sincronizar` EXIGE A MAIS, neste conector.
   *
   * ----------------------------------------------------------------------------
   * POR QUE ISTO EXISTE: O VERBO ÚNICO NÃO PODE SER UMA SEGUNDA PORTA
   * ----------------------------------------------------------------------------
   * Sincronizar o ClickUp tinha (e tem) rota própria exigindo `tarefas.editar`;
   * reindexar o Obsidian exige `obsidian.editar`. A rota genérica do contrato
   * exige `admin.usuarios` — que é outra permissão, não uma permissão MAIOR.
   * Sem este campo, quem administrava usuários passava a poder disparar as duas
   * operações sem ter a permissão que elas sempre pediram: um caminho novo para
   * o mesmo efeito, com a trava antiga intacta e inútil ao lado.
   *
   * O conector declara a exigência porque é ele que sabe o que o `sincronizar`
   * dele faz. Ausente quer dizer "nada além do que a rota já exige" — o caso do
   * Google (renovar o próprio token) e da Meta (`nao_se_aplica`).
   */
  readonly permissaoParaSincronizar?: string;

  /**
   * O consentimento que TORNA a ação possível. Não é ação sobre o mundo, e por
   * isso não vira capacidade da régua (ver `google-conexao.controller.ts`).
   */
  autorizar(ctx: ContextoDoVerbo): Promise<ResultadoDeAutorizacao>;

  /**
   * Traz o estado do fornecedor para dentro do OS — ou renova o que mantém a
   * ligação viva. Conector sem espelho local devolve `nao_se_aplica` dizendo
   * onde o dado é lido em vez disso.
   */
  sincronizar(ctx: ContextoDoVerbo): Promise<ResultadoDeSincronizacao>;

  /**
   * ESTA EMPRESA consegue usar este conector AGORA?
   *
   * Recebe `orgId` porque a resposta é POR EMPRESA. A pergunta que NÃO se deve
   * responder aqui é "o aplicativo tem credencial": ela é verdadeira em produção
   * para todo mundo e foi ela que fez a tela exibir o Google como conectado em
   * empresa que nunca autorizou nada.
   *
   * Nunca lança: o registro trata exceção como `erro` com a mensagem real, mas
   * um conector que devolve em vez de estourar dá uma frase melhor.
   */
  saude(ctx: ContextoDoVerbo): Promise<SaudeDeConector>;

  /**
   * QUEIMA a credencial desta empresa. Não tem volta — é o contrário de
   * desligar, que é pausa e preserva tudo. Conector de credencial de processo
   * devolve `nao_se_aplica` apontando o desligamento.
   */
  revogar(ctx: ContextoDoVerbo & { motivo?: string | null }): Promise<ResultadoDeRevogacao>;
}

/** O nome do verbo, para mensagens e para a tela. */
export type VerboDoContrato = 'autorizar' | 'sincronizar' | 'saude' | 'revogar';

export const VERBOS_DO_CONTRATO: readonly VerboDoContrato[] = [
  'autorizar',
  'sincronizar',
  'saude',
  'revogar',
];

/*
 * ==========================================================================
 * OS CONSTRUTORES DE SAÚDE — a única porta de entrada de cada estado
 * ==========================================================================
 *
 * Existem para que nenhum conector monte o objeto à mão. `conectado` exige
 * latência medida como ARGUMENTO: não dá para escrevê-lo sem ter sondado, e
 * quem tentasse fabricar o número estaria mentindo de propósito, que é outra
 * conversa — o que se fecha aqui é a mentira POR DESCUIDO.
 */

const agora = () => new Date().toISOString();

/** A latência é uma medição utilizável? (finita, não negativa, não `NaN`) */
export function latenciaEhMedida(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/**
 * Verde. `latenciaMs` é o tempo da sonda que acabou de responder — e o parâmetro
 * é obrigatório justamente para que não exista `conectado` sem sonda.
 *
 * LANÇA quando o número não é uma medição. `Math.round(NaN)` é `NaN`, e um
 * `NaN` que escorregue para dentro de um verde sai na tela como "conectado ·
 * NaN ms" — aparência de medição sem medição nenhuma, que é a mentira desta
 * fatia com outra roupa. Lançar é seguro aqui: a sonda roda dentro do `try` do
 * registro, então o defeito vira uma linha VERMELHA com a mensagem real em vez
 * de derrubar a tela.
 */
export function conectado(latenciaMs: number, detalhe?: string | null): SaudeDeConector {
  if (!latenciaEhMedida(latenciaMs)) {
    throw new TypeError(
      `conectado(${String(latenciaMs)}): verde exige latência MEDIDA (número finito e não ` +
        'negativo). Se a sonda não chegou a sair, o estado certo é `naoConfigurado` ou ' +
        '`erroDeConector` — nunca verde (RF-X-02).',
    );
  }
  return {
    estado: 'conectado',
    mensagem: detalhe ?? null,
    apuracao: 'tentativa',
    verificadoEm: agora(),
    latenciaMs: Math.max(0, Math.round(latenciaMs)),
  };
}

/**
 * Cinza. Falta o que é preciso, e o motivo é lido por quem vai consertar: diga
 * QUAL variável, ou que ESTA empresa não autorizou — nunca "não configurado".
 */
export function naoConfigurado(motivo: string): SaudeDeConector {
  return {
    estado: 'nao_configurado',
    mensagem: motivo,
    apuracao: 'declaracao',
    verificadoEm: agora(),
    latenciaMs: null,
  };
}

/**
 * Vermelho, com a MENSAGEM REAL. `latenciaMs` entra quando a falha veio de uma
 * sonda que chegou a sair (um HTTP 401 tem latência; um `assert` local não).
 */
export function erroDeConector(mensagem: string, latenciaMs?: number | null): SaudeDeConector {
  return {
    estado: 'erro',
    mensagem,
    apuracao: latenciaMs === null || latenciaMs === undefined ? 'declaracao' : 'tentativa',
    verificadoEm: agora(),
    latenciaMs: latenciaMs === null || latenciaMs === undefined ? null : Math.max(0, Math.round(latenciaMs)),
  };
}

/** A ausência de medição. Ver `EstadoDeConector`. */
export function naoVerificado(motivo: string): SaudeDeConector {
  return {
    estado: 'nao_verificado',
    mensagem: motivo,
    apuracao: 'nao_verificado',
    verificadoEm: agora(),
    latenciaMs: null,
  };
}

/**
 * O aviso que acompanha um rebaixamento — exportado para a suíte poder afirmar
 * sobre ele sem casar por substring de uma frase que vai mudar de redação.
 */
export const MOTIVO_DE_REBAIXAMENTO =
  'o conector respondeu "conectado" sem ter sondado nada; rebaixado para erro. ' +
  'Verde só existe depois de uma tentativa contra a dependência real (RF-X-02).';

/**
 * O segundo motivo de rebaixamento: verde que se diz medido e não traz medição.
 *
 * Exportado pelo mesmo motivo do primeiro — para a suíte afirmar sobre ele sem
 * casar por substring de uma frase que vai mudar de redação.
 */
export const MOTIVO_DE_LATENCIA_INVALIDA =
  'o conector respondeu "conectado" declarando tentativa, mas sem latência medida ' +
  '(nula, NaN, infinita ou negativa); rebaixado para erro. Verde é uma MEDIÇÃO, não ' +
  'uma assinatura (RF-X-02).';

/**
 * A CATRACA DA LUZ VERDE, aplicada a toda resposta que entra no registro.
 *
 * DOIS CORTES, porque o primeiro sozinho cobrava só a assinatura:
 *
 *  1. `apuracao` fora de `tentativa` — o formato mais fácil de escrever errado,
 *     e o defeito que já apareceu nesta base;
 *  2. `latenciaMs` que não é medição (`null`, `NaN`, texto, negativo). Sem este
 *     corte, um conector que montasse a resposta à mão com
 *     `apuracao:'tentativa'` passava intacto — bastava ASSINAR que tinha
 *     sondado. Quem de fato mede é o registro (ver `carimbarMedicao`), e a
 *     ordem lá é: carimbar primeiro, normalizar depois.
 *
 * Rebaixar para `erro` e não para `nao_verificado` é deliberado: `nao_verificado`
 * é cinza, e cinza é fácil de ignorar por meses. Um defeito de programação tem
 * de doer.
 */
export function normalizarSaude(saude: SaudeDeConector): SaudeDeConector {
  if (saude.estado !== 'conectado') return saude;
  if (saude.apuracao !== 'tentativa') {
    return { ...saude, estado: 'erro', mensagem: MOTIVO_DE_REBAIXAMENTO };
  }
  if (!latenciaEhMedida(saude.latenciaMs)) {
    return { ...saude, estado: 'erro', mensagem: MOTIVO_DE_LATENCIA_INVALIDA };
  }
  return saude;
}

/**
 * CARIMBA A MEDIÇÃO DE QUEM MEDIU por cima do que o conector declarou.
 *
 * O registro cronometra a sonda de ponta a ponta — é ele quem sabe quanto tempo
 * a chamada levou. Enquanto a `latenciaMs` exibida era a que o conector
 * devolvia, o número da tela era palavra dele: um conector podia inventar `3` e
 * a tela mostrava "3 ms" sobre uma chamada que nunca saiu, ou (pior, porque é
 * honesto e errado) devolver a latência de uma chamada interna enquanto a sonda
 * inteira levou dez vezes mais.
 *
 * Só carimba onde há o que carimbar: resposta que NÃO se declara `tentativa`
 * fica como está — ali a ausência de latência é a verdade, e é ela que a catraca
 * acima usa para rebaixar.
 */
export function carimbarMedicao(saude: SaudeDeConector, latenciaMs: number): SaudeDeConector {
  if (saude.apuracao !== 'tentativa') return saude;
  if (!latenciaEhMedida(latenciaMs)) return saude;
  return { ...saude, latenciaMs: Math.max(0, Math.round(latenciaMs)) };
}

/**
 * A frase de um erro que veio de qualquer lugar — incluindo o que não é `Error`.
 *
 * Serve para a mensagem REAL chegar à tela. `String(e)` num objeto qualquer
 * devolve "[object Object]", que é a forma mais eficiente de esconder a causa.
 */
export function frasedoErro(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e)?.slice(0, 300) ?? 'erro sem mensagem';
  } catch {
    return 'erro sem mensagem';
  }
}
