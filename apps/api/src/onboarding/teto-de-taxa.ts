/* ==========================================================================
 * O TETO DE TAXA DA ROTA ANÔNIMA — por que ele é pré-condição de subir
 * ==========================================================================
 *
 * `POST /api/tenants/onboarding/cadastro` é anônima de propósito: quem chega
 * não tem conta, e esse é o degrau de entrada inteiro. Só que cada chamada
 * BEM-SUCEDIDA escreve cerca de vinte linhas — a empresa, o usuário, nove
 * papéis com os vínculos de permissão de cada um, dois agentes, dois
 * procedimentos, a linha de auditoria e o evento do RASTRO. Sem teto, um laço
 * de shell enche o banco de produção numa tarde, e o `EventLog` **não se
 * apaga** (RULE de append-only): a limpeza depois não é `DELETE`, é operação.
 *
 * A primeira entrega desta fatia DECLAROU o problema numa PERGUNTA do relatório
 * e subiu assim mesmo. Declarar não contém. Isto contém.
 *
 * ----------------------------------------------------------------------------
 * O QUE ESTE TETO É, E O QUE ELE NÃO É
 * ----------------------------------------------------------------------------
 * É um contador EM MEMÓRIA, por processo. Consequências, ditas antes que
 * alguém suponha o contrário:
 *
 *   · duas réplicas da API = dois contadores, e o teto efetivo dobra. Hoje o
 *     compose sobe UMA (`mktos_api`), então o número é o número; o dia em que
 *     houver duas, ou o teto vira contagem no banco/Redis, ou ele vira metade
 *     do que diz;
 *   · reiniciar o container zera a contagem. Para um teto por HORA isso é uma
 *     janela por reinício, não um buraco permanente;
 *   · quem tiver mil endereços passa por baixo do teto POR ORIGEM. É para isso
 *     que existe o teto GLOBAL, abaixo — e é por isso que ele existe apesar de
 *     ter um custo próprio (ver `TETO_GLOBAL`).
 *
 * O lugar definitivo de um limite de taxa é a borda (Traefik, um middleware de
 * rede), onde o pedido morre antes de chegar ao Node. Isto aqui é o remendo
 * honesto que cabe dentro desta fatia, sem dependência nova — `02-CONSTRAINTS`
 * é explícito: dependência nova é decisão humana. Está no relatório como
 * pendência de infraestrutura, não como trabalho feito.
 *
 * ----------------------------------------------------------------------------
 * A ORIGEM VEM DE `enderecoDeOrigem`, E NÃO DE `X-Forwarded-For` LIDO À MÃO
 * ----------------------------------------------------------------------------
 * `main.ts` declara `app.set('trust proxy', 1)` — UM salto, o Traefik —, e
 * `auth/endereco-de-origem.ts` lê o resultado já PODADO pelo Express. Ler o
 * cabeçalho aqui deixaria quem chama escolher o balde em que cai, que é o
 * mesmo que não ter teto. Quando não há endereço nenhum (script, teste sem
 * `req`), a chave vira `SEM_ORIGEM` — um balde só, compartilhado, que é o lado
 * seguro: na dúvida, contar junto.
 *
 * PURO: sem Nest, sem banco, sem rede. O relógio é injetável para a suíte poder
 * andar com o tempo em vez de dormir.
 */

/** Quantos cadastros um mesmo endereço pode tentar por janela. */
export const TETO_POR_ORIGEM = 5;

/**
 * Quantos cadastros a instalação inteira aceita por janela.
 *
 * ELE TEM UM CUSTO E ELE ESTÁ DECLARADO: um teto global é, por construção, uma
 * alavanca de negação de serviço — quem estourar o número fecha o cadastro para
 * todo mundo até a janela virar. Por isso o valor é GENEROSO (bem acima de
 * qualquer dia real de entrada da ROOT em 2026) e por isso o estouro sai no log
 * como aviso, não em silêncio: ele é sinal de ataque, e alguém precisa olhar.
 *
 * O teto por origem é o que contém o laço de shell; este é o que contém o laço
 * de shell distribuído. Nenhum dos dois substitui a borda.
 */
export const TETO_GLOBAL = 100;

/** A janela dos dois tetos, em milissegundos. */
export const JANELA_MS = 60 * 60 * 1000;

/**
 * Quantas origens diferentes o contador guarda ao mesmo tempo.
 *
 * Existe para o mapa não virar vazamento de memória sob rotação de endereço. A
 * poda tira primeiro o que já venceu; só se ainda passar do teto é que sai a
 * origem tocada há mais tempo. Isso significa que quem tiver
 * `MAX_ORIGENS` + 1 endereços consegue se empurrar para fora do próprio balde —
 * e está tudo bem que signifique: nesse cenário o teto POR ORIGEM já não era a
 * defesa, o GLOBAL é.
 */
export const MAX_ORIGENS = 10_000;

/** Quando não dá para saber de onde veio. Um balde só, de propósito. */
export const SEM_ORIGEM = 'sem-origem';

export interface VeredictoDoTeto {
  permitido: boolean;
  /** `origem` ou `global` — qual teto recusou. `null` quando passou. */
  estourou: 'origem' | 'global' | null;
  /** Quantos segundos até a janela abrir de novo. 0 quando passou. */
  esperarSegundos: number;
}

/**
 * Contador de janela deslizante, por origem e global.
 *
 * CONTA TENTATIVA, NÃO SUCESSO — e a diferença é a defesa inteira: um contador
 * que só marcasse cadastro criado deixaria passar infinitas tentativas com
 * e-mail repetido, que escrevem menos mas ainda percorrem o provisionamento
 * inteiro antes de recusar.
 */
export class TetoDeCadastro {
  private readonly porOrigem = new Map<string, number[]>();
  private global: number[] = [];

  constructor(
    private readonly tetoPorOrigem: number = TETO_POR_ORIGEM,
    private readonly tetoGlobal: number = TETO_GLOBAL,
    private readonly janelaMs: number = JANELA_MS,
    private readonly agora: () => number = () => Date.now(),
  ) {}

  /**
   * Registra uma tentativa e diz se ela pode seguir.
   *
   * A tentativa é contada MESMO QUANDO RECUSADA. Se só as permitidas contassem,
   * a sexta chamada da hora abriria espaço para a sétima assim que a primeira
   * vencesse — e o atacante manteria exatamente o teto de vazão para sempre,
   * que é o oposto de uma trava.
   */
  registrar(origem: string | undefined | null): VeredictoDoTeto {
    const chave = (origem ?? '').trim() || SEM_ORIGEM;
    const agora = this.agora();
    const corte = agora - this.janelaMs;

    this.global = this.global.filter((t) => t > corte);
    const doBalde = (this.porOrigem.get(chave) ?? []).filter((t) => t > corte);

    doBalde.push(agora);
    this.global.push(agora);
    this.porOrigem.set(chave, doBalde);
    this.podar(corte);

    if (doBalde.length > this.tetoPorOrigem) {
      return { permitido: false, estourou: 'origem', esperarSegundos: this.espera(doBalde, agora) };
    }
    if (this.global.length > this.tetoGlobal) {
      return { permitido: false, estourou: 'global', esperarSegundos: this.espera(this.global, agora) };
    }
    return { permitido: true, estourou: null, esperarSegundos: 0 };
  }

  /** Quantas origens estão sendo contadas agora. Para a suíte medir a poda. */
  get origensContadas(): number {
    return this.porOrigem.size;
  }

  /** Quanto falta para a marca mais velha da janela vencer. */
  private espera(marcas: readonly number[], agora: number): number {
    const maisVelha = marcas[0] ?? agora;
    return Math.max(1, Math.ceil((maisVelha + this.janelaMs - agora) / 1000));
  }

  /** Tira o que venceu e, se ainda for demais, o que foi tocado há mais tempo. */
  private podar(corte: number): void {
    for (const [chave, marcas] of this.porOrigem) {
      const vivas = marcas.filter((t) => t > corte);
      if (vivas.length === 0) this.porOrigem.delete(chave);
      else if (vivas.length !== marcas.length) this.porOrigem.set(chave, vivas);
    }
    if (this.porOrigem.size <= MAX_ORIGENS) return;

    const porUltimoToque = [...this.porOrigem.entries()].sort(
      (a, b) => (a[1][a[1].length - 1] ?? 0) - (b[1][b[1].length - 1] ?? 0),
    );
    for (const [chave] of porUltimoToque.slice(0, this.porOrigem.size - MAX_ORIGENS)) {
      this.porOrigem.delete(chave);
    }
  }
}
