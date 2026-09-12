import { ForbiddenException } from '@nestjs/common';
import { inspect } from 'node:util';

/*
 * ============================================================================
 * A PARTE PURA DO COFRE — o vocabulário, e a CREDENCIAL EMPRESTADA (RF-C-02)
 * ============================================================================
 *
 * Nada aqui toca banco, e é de propósito: a promessa central desta fatia — "o
 * modelo NUNCA recebe credencial" — precisa poder ser exercitada por tentativa,
 * sem Postgres e sem Nest, tantas vezes quantas forem os caminhos por onde um
 * segredo poderia escapar.
 *
 * ----------------------------------------------------------------------------
 * O DESENHO, EM UMA FRASE
 * ----------------------------------------------------------------------------
 * O cofre não DEVOLVE segredo. Ele empresta uma CAPACIDADE COM ESCOPO: um objeto
 * que sabe usar o segredo dentro de um fechamento curto, tem prazo com TETO, tem
 * escopo declarado, e que — se por descuido for parar num lugar que serializa —
 * sai como `[credencial no cofre]`, nunca como o valor.
 *
 * POR QUE NÃO DEVOLVER A STRING E CONFIAR EM QUEM CHAMA. Porque o caminho pelo
 * qual o segredo escaparia não é alguém decidindo vazá-lo: é `JSON.stringify` do
 * resultado de uma ferramenta indo para dentro da conversa do modelo. O laço do
 * agente devolve ao modelo `JSON.stringify(resultado)` do efeito
 * (`agents/tool-adapter.ts`, `paraModelo`) e grava `resumirResultado` no passo da
 * sessão. Uma string de token que caísse num campo do resultado atravessaria os
 * dois sem ninguém decidir nada. Um objeto que se recusa a serializar não
 * atravessa.
 *
 * TRÊS PORTAS DE SAÍDA, TRÊS FECHADAS:
 *   · `JSON.stringify(x)`        → chama `toJSON()`  → marca redigida;
 *   · `` `${x}` `` / `String(x)` → chama `toString()`→ marca redigida;
 *   · `console.log(x)` / logger  → `util.inspect`    → marca redigida.
 *
 * E o campo é privado de JavaScript (`#segredo`), não `private` de TypeScript:
 * `private` é apagado na compilação e `Object.entries`/spread continuariam
 * enxergando o valor. `#` não aparece em `Object.keys`, em spread, em
 * `structuredClone` nem em `JSON.stringify` — nem para quem escrever o código
 * errado de propósito.
 *
 * O QUE ELE **NÃO** PROTEGE, e está provado na suíte em vez de prometido: um
 * efeito que tire o valor de dentro de `usar` e o ponha num campo do resultado,
 * ou na mensagem de uma exceção, VAZA. O objeto emprestado fecha as portas de
 * serialização; ele não pode fechar a mão de quem copiou a string para fora.
 * Ver a seção 5 de `test/cofre.test.ts`, onde os dois casos são exercitados de
 * propósito e o vazamento é ACUSADO — é assim que se sabe que a varredura
 * enxerga, e é assim que a fronteira da promessa fica escrita.
 */

/** O que sai no lugar do segredo em qualquer serialização. */
export const MARCA_REDIGIDA = '[credencial no cofre]';

/**
 * Nomes de segredo que já existem no produto. NÃO é enum e NÃO é exaustivo: o
 * conjunto muda a cada API externa, e um enum viraria migration de tipo a cada
 * conector novo. Existe para que os quatro pontos que gravam token usem a mesma
 * grafia — `access_token` num lado e `accessToken` no outro criariam duas linhas
 * para o mesmo segredo, e revogar uma deixaria a outra viva.
 */
export const NOMES_CONHECIDOS = {
  acesso: 'access_token',
  renovacao: 'refresh_token',
  segredoDoApp: 'app_secret',
  tokenDePagina: 'page_token',
} as const;

/**
 * O SEGREDO DO APLICATIVO É DE OUTRA NATUREZA, e a revogação em massa precisa
 * saber disso.
 *
 * `access_token` e `refresh_token` nascem de uma autorização: revogá-los custa
 * ao cliente clicar em "conectar" de novo, e o valor volta. `app_secret` NÃO
 * nasce de autorização nenhuma — ele é digitado na tela por quem administra o
 * app da plataforma, e nenhum fluxo de OAuth o traz de volta. Revogá-lo por
 * tabela, junto com o par de tokens, é apagar um valor que só existe na consola
 * da Meta/TikTok e na cabeça de quem o colou ali.
 *
 * Por isso `CofreService.revogar` sem `nome` PRESERVA o segredo do aplicativo, e
 * só o queima quando alguém pede por ele com todas as letras.
 */
export function ehSegredoDoAplicativo(nome: string): boolean {
  return nome === NOMES_CONHECIDOS.segredoDoApp || nome.startsWith(`${NOMES_CONHECIDOS.segredoDoApp}:`);
}

/**
 * O dado associado do GCM: o valor fica amarrado a ESTA empresa, ESTE conector e
 * ESTE nome. Linha copiada para outra empresa não abre, nem com a chave certa.
 *
 * A ordem e os separadores importam (são parte do criptograma, na prática):
 * mudar este formato torna ilegível tudo o que já foi cifrado. Se um dia
 * precisar mudar, é chave nova no chaveiro e rotação — nunca edição aqui.
 */
export function dadoAssociado(orgId: string, conector: string, nome: string): string {
  return `cofre.v1|${orgId}|${conector}|${nome}`;
}

/* ==========================================================================
 * ESCOPO — um vocabulário só, e lista vazia é NADA
 * ==========================================================================
 *
 * O PROBLEMA REAL, e ele é bidirecional. O Google devolve escopo como URL
 * inteira (`https://www.googleapis.com/auth/gmail.send`); quem escreve a ação
 * pede `gmail.send`, que é como o catálogo de capacidades fala. Comparando as
 * duas grafias cruas:
 *
 *   · declarado URL × exigido curto  → recusa uma credencial que TEM o escopo;
 *   · declarado curto × exigido URL  → recusa também, pelo mesmo motivo.
 *
 * Os dois sentidos falham fechados, o que é menos grave do que o contrário — mas
 * é falha: a ação legítima para de funcionar e alguém "conserta" tirando a
 * exigência de escopo do caminho, que é como um controle de segurança morre.
 *
 * A NORMALIZAÇÃO é deliberadamente burra: apara, baixa a caixa e, quando o
 * escopo é uma URL, fica com o último segmento do caminho. Não há tabela de
 * tradução por plataforma e não deve haver — tabela envelhece em silêncio, e o
 * dia em que ela não tiver a entrada nova, a comparação volta a falhar sem
 * ninguém entender.
 */
export function normalizarEscopo(escopo: string): string {
  const limpo = escopo.trim().toLowerCase();
  if (!limpo) return '';
  if (/^https?:\/\//.test(limpo)) {
    const corte = limpo.lastIndexOf('/');
    const cauda = corte >= 0 ? limpo.slice(corte + 1) : limpo;
    return cauda || limpo;
  }
  return limpo;
}

/** A lista declarada, normalizada e sem vazios. */
export function normalizarEscopos(escopos: readonly string[]): string[] {
  return escopos.map(normalizarEscopo).filter(Boolean);
}

/**
 * O segredo declara o escopo exigido?
 *
 * LISTA VAZIA É NADA, NÃO É TUDO — e esta é a decisão explícita que a revisão
 * cobrou. A versão anterior devolvia "pode" quando a lista estava vazia, o que
 * transformava a ausência de declaração em permissão total: um controle de
 * segurança que se DESLIGA sozinho justamente nas linhas de que menos se sabe
 * (as que vieram migradas de antes do cofre, todas sem escopo).
 *
 * O preço é conhecido e é o certo: uma ação que exija escopo sobre credencial
 * migrada recusa até alguém reautorizar o conector declarando o escopo. Quem NÃO
 * exige escopo (`escopoExigido` ausente) não é afetado em nada.
 */
export function escopoAtendido(declarados: readonly string[], exigido: string): boolean {
  const alvo = normalizarEscopo(exigido);
  if (!alvo) return false;
  return normalizarEscopos(declarados).includes(alvo);
}

/** Recusa de ESCOPO — 403, não 500: é decisão declarada, não defeito. */
export class EscopoInsuficienteError extends ForbiddenException {
  constructor(conector: string, exigido: string, declarado: readonly string[]) {
    super(
      `A credencial de "${conector}" guardada no cofre não declara o escopo "${exigido}" ` +
        `(declarados: ${declarado.length ? declarado.join(', ') : 'nenhum'}). ` +
        'Lista vazia significa NADA, não tudo: reautorize o conector pedindo esse escopo, ' +
        'ou ajuste o que a ação exige.',
    );
    this.name = 'EscopoInsuficienteError';
  }
}

/** Empréstimo vencido, devolvido ou revogado enquanto estava na mão. */
export class EmprestimoEncerradoError extends Error {
  constructor(conector: string, motivo: string) {
    super(
      `A credencial de "${conector}" não está mais disponível neste empréstimo: ${motivo}. ` +
        'Peça outra ao cofre — empréstimo é de uso imediato, não é para guardar.',
    );
    this.name = 'EmprestimoEncerradoError';
  }
}

/**
 * TETO DO PRAZO DE EMPRÉSTIMO — cinco minutos, e é um teto, não um padrão.
 *
 * O padrão é um minuto (`CofreService.VALIDADE_PADRAO_MS`), e o argumento da
 * revogação com efeito imediato repousa inteiro sobre ele: o empréstimo que já
 * estava na mão quando alguém clicou em revogar morre em até um minuto mesmo
 * numa segunda instância da API, onde o mapa de empréstimos deste processo não
 * alcança. Sem TETO, esse argumento vale zero — qualquer chamador escreve
 * `validadeMs: 86_400_000` e o "até um minuto" vira "até amanhã".
 *
 * Cinco minutos e não um: um upload grande para o Drive, uma chamada de API que
 * pagina, um conector lento — todos legítimos e todos capazes de passar de um
 * minuto. Acima disso não é chamada externa, é guardar credencial na memória, e
 * o cofre recusa em vez de aceitar calado.
 */
export const VALIDADE_MAXIMA_DE_EMPRESTIMO_MS = 300_000;

/** Prazo de empréstimo acima do teto. Recusa, nunca corte silencioso. */
export class PrazoDeEmprestimoExcessivoError extends Error {
  constructor(pedidoMs: number) {
    super(
      `Empréstimo de ${Math.round(pedidoMs / 1000)}s recusado: o teto é ` +
        `${VALIDADE_MAXIMA_DE_EMPRESTIMO_MS / 1000}s. Empréstimo atravessa UMA chamada externa; ` +
        'prazo maior que isso é guardar credencial em memória, e é o que torna falsa a ' +
        'promessa de revogação com efeito imediato. Peça outro empréstimo em vez de esticar este.',
    );
    this.name = 'PrazoDeEmprestimoExcessivoError';
  }
}

export interface DadosDoEmprestimo {
  orgId: string;
  conector: string;
  nome: string;
  /** O id da linha no cofre — o que vai para o RASTRO no lugar do valor. */
  referencia: string;
  escopo: readonly string[];
  /** Quando ESTE empréstimo vence (não é a validade do token). */
  expiraEm: Date;
  /** A capacidade que motivou o empréstimo, quando houver. Só para registro. */
  capabilityId?: string | null;
}

/**
 * A CAPACIDADE COM ESCOPO — o que o cofre entrega no lugar do segredo.
 *
 * Uso:
 *
 *   const cred = await cofre.emprestar({ orgId, conector: 'gmail', nome: 'access_token' });
 *   const r = await cred.usar((token) => fetch(url, { headers: { Authorization: `Bearer ${token}` } }));
 *
 * O `token` existe só dentro daquele fechamento. Guardá-lo numa variável de fora
 * é possível — nenhuma linguagem impede — mas deixa de ser descuido e passa a
 * ser uma linha que a revisão enxerga.
 */
export class CredencialEmprestada {
  readonly orgId: string;
  readonly conector: string;
  readonly nome: string;
  readonly referencia: string;
  readonly escopo: readonly string[];
  readonly expiraEm: Date;
  readonly capabilityId: string | null;

  /** Privado de JAVASCRIPT. Ver a nota de três portas no topo do arquivo. */
  #segredo: string | null;
  #motivoDoFim: string | null = null;
  /**
   * O despertador do vencimento.
   *
   * ELE É A CORREÇÃO DE UM DEFEITO REAL: antes, um empréstimo vencido continuava
   * com o valor EM CLARO na memória até que alguém pedisse OUTRO empréstimo da
   * mesma chave — e se ninguém pedisse, ficava lá pelo tempo de vida do
   * processo. É exatamente o despejo de memória (`heap dump`) que o comentário
   * de `usar` dizia estar evitando: o objeto recusava o uso e guardava o
   * segredo, que é o pior dos dois mundos.
   *
   * `unref()` para que um empréstimo em voo não segure o processo de pé no
   * encerramento — o timer é higiene, não trabalho.
   */
  #despertador: ReturnType<typeof setTimeout> | null = null;
  /** O cofre se pendura aqui para tirar o empréstimo do mapa de vivos. */
  #aoEncerrar: ((c: CredencialEmprestada) => void) | null = null;

  constructor(dados: DadosDoEmprestimo, segredo: string) {
    const restaMs = dados.expiraEm.getTime() - Date.now();
    if (restaMs > VALIDADE_MAXIMA_DE_EMPRESTIMO_MS) {
      throw new PrazoDeEmprestimoExcessivoError(restaMs);
    }

    this.orgId = dados.orgId;
    this.conector = dados.conector;
    this.nome = dados.nome;
    this.referencia = dados.referencia;
    this.escopo = Object.freeze([...dados.escopo]);
    this.expiraEm = dados.expiraEm;
    this.capabilityId = dados.capabilityId ?? null;
    this.#segredo = segredo;

    if (restaMs <= 0) {
      // Nasceu vencido: não há um instante em que valha guardar o valor.
      this.#encerrar('o empréstimo venceu');
    } else {
      this.#despertador = setTimeout(() => this.#encerrar('o empréstimo venceu'), restaMs);
      this.#despertador.unref?.();
    }
  }

  /** Este empréstimo ainda vale? */
  get valido(): boolean {
    return this.#segredo !== null && this.expiraEm.getTime() > Date.now();
  }

  /**
   * Usa o segredo. É o ÚNICO caminho para ele.
   *
   * Devolve o que o fechamento devolver — inclusive quando o fechamento é
   * assíncrono, que é o caso normal (uma chamada HTTP a um conector).
   */
  async usar<T>(fn: (segredo: string) => T | Promise<T>): Promise<T> {
    if (this.#segredo === null) {
      throw new EmprestimoEncerradoError(this.conector, this.#motivoDoFim ?? 'já foi devolvido');
    }
    if (this.expiraEm.getTime() <= Date.now()) {
      // Cinto além do despertador: o timer pode não ter disparado ainda quando o
      // laço de eventos está ocupado, e vencido é vencido.
      this.#encerrar('o empréstimo venceu');
      throw new EmprestimoEncerradoError(this.conector, 'o empréstimo venceu');
    }
    return fn(this.#segredo);
  }

  /** Exige um escopo declarado. Ver `escopoAtendido` e `EscopoInsuficienteError`. */
  exigirEscopo(escopo: string): void {
    if (!normalizarEscopo(escopo)) {
      throw new Error(
        'CredencialEmprestada.exigirEscopo: escopo exigido vazio. Exigir "nada" não é uma ' +
          'conferência — se a ação não tem escopo a exigir, não chame este método.',
      );
    }
    if (!escopoAtendido(this.escopo, escopo)) {
      throw new EscopoInsuficienteError(this.conector, escopo, this.escopo);
    }
  }

  /** Devolve o empréstimo: o valor some da memória deste objeto. */
  devolver(): void {
    this.#encerrar('foi devolvido');
  }

  /** Chamado pelo cofre quando o segredo é revogado com o empréstimo na rua. */
  invalidar(motivo: string): void {
    this.#encerrar(motivo);
  }

  /** O cofre registra aqui como tirar este empréstimo do mapa de vivos. */
  quandoEncerrar(fn: (c: CredencialEmprestada) => void): void {
    if (this.#segredo === null) {
      // Já encerrou antes de o cofre se pendurar (empréstimo nascido vencido):
      // avisa na hora, senão a linha ficaria no mapa para sempre.
      fn(this);
      return;
    }
    this.#aoEncerrar = fn;
  }

  #encerrar(motivo: string): void {
    if (this.#despertador) {
      clearTimeout(this.#despertador);
      this.#despertador = null;
    }
    const jaEstavaFechado = this.#segredo === null;
    this.#segredo = null;
    if (!jaEstavaFechado) this.#motivoDoFim = motivo;
    const aviso = this.#aoEncerrar;
    this.#aoEncerrar = null;
    aviso?.(this);
  }

  /** O retrato SEM segredo — o que pode ir para o RASTRO e para a tela. */
  descrever(): {
    conector: string;
    nome: string;
    referencia: string;
    escopo: readonly string[];
    valido: boolean;
    credencial: string;
  } {
    return {
      conector: this.conector,
      nome: this.nome,
      referencia: this.referencia,
      escopo: this.escopo,
      valido: this.valido,
      credencial: MARCA_REDIGIDA,
    };
  }

  toJSON(): ReturnType<CredencialEmprestada['descrever']> {
    return this.descrever();
  }

  toString(): string {
    return `${MARCA_REDIGIDA} ${this.conector}/${this.nome}`;
  }

  /** `console.log`, o Logger do Nest e qualquer `util.inspect` passam por aqui. */
  [inspect.custom](): string {
    return this.toString();
  }
}

/* ==========================================================================
 * A VARREDURA — "existe algum destes segredos aqui dentro?"
 * ==========================================================================
 *
 * Serve à catraca da suíte, e por isso mora no código do produto e não no
 * arquivo de teste: uma varredura escrita dentro do teste prova o que o próprio
 * teste escreveu. Aqui ela é a mesma função que qualquer um pode apontar para o
 * payload que quiser.
 *
 * ----------------------------------------------------------------------------
 * A REGRA QUE ELA TEM DE OBEDECER, E QUE A VERSÃO ANTERIOR QUEBRAVA
 * ----------------------------------------------------------------------------
 * A varredura precisa ser SUPERCONJUNTO das três portas de serialização. Se ela
 * enxerga menos do que `JSON.stringify`, `String()` e `util.inspect`, então ela
 * certifica como limpo um payload que vaza — e certificado falso é pior do que
 * nenhum, porque é ele que fecha a revisão.
 *
 * A versão anterior andava só por `Object.entries`, e por isso deixava passar
 * SEIS coisas que a revisão derrubou executando:
 *
 *   1. objeto com `toJSON()` próprio. `JSON.stringify` chama `toJSON()` e
 *      serializa o que ELE devolver; `Object.entries` mostra os campos do
 *      objeto, que podem ser outros. Este é o mecanismo do próprio objeto
 *      emprestado desta fatia — ou seja, um embrulho futuro escrito errado
 *      seria certificado limpo pela varredura que deveria pegá-lo;
 *   2. `Error` com mensagem e pilha: `message` e `stack` são NÃO ENUMERÁVEIS, e
 *      `Object.entries(new Error(segredo))` devolve `[]`. É o caminho por onde
 *      um token em URL chega ao modelo (`paraModelo` manda a mensagem do erro);
 *   3. propriedade não enumerável em objeto comum (`defineProperty` sem
 *      `enumerable`);
 *   4. chave simbólica — invisível a `Object.entries`, visível a `util.inspect`;
 *   5. segredo em base64 (ou hex): a comparação por substring crua não casa;
 *   6. `toString()` / `[util.inspect.custom]` próprios devolvendo o valor.
 *
 * E a sétima, que não é cegueira e sim mentira: segredo com menos de oito
 * caracteres era DESCARTADO EM SILÊNCIO. Quem passasse `['abc']` recebia
 * "nada encontrado" sobre uma varredura que não procurou nada. Agora LANÇA.
 *
 * ----------------------------------------------------------------------------
 * O QUE ELA CUSTA, e por que isso é aceitável
 * ----------------------------------------------------------------------------
 * Ela CHAMA código do objeto varrido: `toJSON()`, `toString()`, o inspetor
 * personalizado e os getters. Isso tem efeito colateral em tese, e é o mesmo
 * efeito colateral que `JSON.stringify` e `console.log` já teriam — não dá para
 * ser superconjunto de uma serialização sem executar o que a serialização
 * executa. Consequência prática: aponte-a para PAYLOAD (o que já foi produzido),
 * nunca para um serviço vivo.
 */

/** Alvo curto demais para uma varredura honesta. Ver o item 7 acima. */
export class AlvoDeVarreduraInvalidoError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'AlvoDeVarreduraInvalidoError';
  }
}

/** A varredura desistiu antes de terminar. NUNCA vira "nada encontrado". */
export class VarreduraIncompletaError extends Error {
  constructor(nos: number) {
    super(
      `A varredura de segredo passou de ${nos} nós sem terminar e PAROU. ` +
        'Ela não devolve "limpo" quando não terminou: um payload que não cabe na varredura ' +
        'não foi verificado. Reduza o que está sendo varrido (um campo por vez).',
    );
    this.name = 'VarreduraIncompletaError';
  }
}

/** O menor alvo que a varredura aceita. Abaixo disso, casaria por acidente. */
export const TAMANHO_MINIMO_DE_ALVO = 8;

/** Teto de nós visitados. Alto o bastante para payload real, finito por segurança. */
const TETO_DE_NOS = 200_000;

export interface AchadoDaVarredura {
  achou: true;
  /** O caminho onde o segredo apareceu — para a mensagem de falha ser útil. */
  onde: string;
  /** O segredo ORIGINAL, mesmo quando o que casou foi a forma base64 ou hex. */
  segredo: string;
  /** Como ele apareceu: cru, base64, base64url ou hex. */
  forma: 'cru' | 'base64' | 'base64url' | 'hex';
}

/**
 * Procura cada segredo como SUBSTRING, em toda forma por onde ele sairia.
 *
 * Substring e não igualdade: o jeito como um token vaza quase nunca é um campo
 * `token`; é um cabeçalho `Authorization: Bearer …` montado dentro de uma
 * string, ou uma URL com a chave na query.
 *
 * E não só cru: um token que passe por `Buffer.from(t).toString('base64')` —
 * `Basic` auth, corpo de webhook, cabeçalho assinado — continua sendo o token.
 * A comparação crua diria "limpo" sobre exatamente o mesmo segredo.
 */
export function contemAlgumSegredo(
  valor: unknown,
  segredos: readonly string[],
): { achou: false } | AchadoDaVarredura {
  if (!Array.isArray(segredos) || segredos.length === 0) {
    throw new AlvoDeVarreduraInvalidoError(
      'contemAlgumSegredo: nenhum segredo para procurar. Uma varredura sem alvo devolve ' +
        '"limpo" sobre qualquer coisa — é a forma mais barata de uma suíte provar nada.',
    );
  }

  /** forma buscada -> (segredo original, como ele foi codificado) */
  const alvos: Array<{ agulha: string; segredo: string; forma: AchadoDaVarredura['forma'] }> = [];
  for (const s of segredos) {
    if (typeof s !== 'string' || s.length < TAMANHO_MINIMO_DE_ALVO) {
      throw new AlvoDeVarreduraInvalidoError(
        `contemAlgumSegredo: alvo "${String(s).slice(0, 4)}…" tem menos de ` +
          `${TAMANHO_MINIMO_DE_ALVO} caracteres. Alvo curto casa por acidente em qualquer texto ` +
          '(um "abc" aparece em meia dúzia de campos), e a versão anterior desta função o ' +
          'DESCARTAVA EM SILÊNCIO — devolvendo "limpo" sobre uma varredura que não procurou nada. ' +
          'Use um valor de teste do tamanho de um token real.',
      );
    }
    const bruto = Buffer.from(s, 'utf8');
    alvos.push({ agulha: s, segredo: s, forma: 'cru' });
    alvos.push({ agulha: bruto.toString('base64'), segredo: s, forma: 'base64' });
    const url = bruto.toString('base64url');
    if (url !== bruto.toString('base64')) alvos.push({ agulha: url, segredo: s, forma: 'base64url' });
    alvos.push({ agulha: bruto.toString('hex'), segredo: s, forma: 'hex' });
  }

  const vistos = new WeakSet<object>();
  let nos = 0;

  function texto(s: string, onde: string): AchadoDaVarredura | null {
    for (const a of alvos) {
      if (s.includes(a.agulha)) return { achou: true, onde, segredo: a.segredo, forma: a.forma };
    }
    return null;
  }

  /** Chama algo do objeto varrido sem deixar a exceção dele matar a varredura. */
  function tentar<T>(fn: () => T): { ok: true; v: T } | { ok: false } {
    try {
      return { ok: true, v: fn() };
    } catch {
      return { ok: false };
    }
  }

  function andar(v: unknown, onde: string): AchadoDaVarredura | null {
    nos += 1;
    if (nos > TETO_DE_NOS) throw new VarreduraIncompletaError(TETO_DE_NOS);

    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return texto(v, onde);
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return null;
    if (typeof v === 'symbol') return texto(String(v), onde);

    if (typeof v === 'function') {
      const fonte = tentar(() => (v as () => unknown).toString());
      if (fonte.ok && typeof fonte.v === 'string') {
        const r = texto(fonte.v, `${onde}()`);
        if (r) return r;
      }
      return propriedades(v as unknown as object, onde);
    }

    if (typeof v !== 'object') return null;

    if (vistos.has(v)) return null;
    vistos.add(v);

    // --- tipos que têm uma representação textual própria e conhecida ---------
    if (v instanceof Date || v instanceof RegExp || v instanceof URL) {
      return texto(String(v), onde);
    }
    if (Buffer.isBuffer(v)) return texto(v.toString('utf8'), onde);
    if (ArrayBuffer.isView(v)) {
      const b = tentar(() => Buffer.from(v.buffer as ArrayBuffer, v.byteOffset, v.byteLength));
      return b.ok ? texto(b.v.toString('utf8'), onde) : null;
    }

    /*
     * ERRO. `message` e `stack` são não enumeráveis: sem estas quatro linhas, a
     * varredura diz "limpo" sobre `new Error('Bearer ' + token)` — que é, hoje,
     * o caminho mais provável de um token chegar ao modelo, porque `paraModelo`
     * manda a mensagem do erro para dentro da conversa.
     */
    if (v instanceof Error) {
      for (const [campo, val] of [
        ['name', v.name],
        ['message', v.message],
        ['stack', v.stack],
      ] as const) {
        if (typeof val === 'string') {
          const r = texto(val, `${onde}.${campo}`);
          if (r) return r;
        }
      }
      if ('cause' in v) {
        const r = andar((v as { cause?: unknown }).cause, `${onde}.cause`);
        if (r) return r;
      }
      return propriedades(v, onde);
    }

    if (v instanceof Map) {
      for (const [k, val] of v) {
        // A CHAVE também: um Map com o token na chave aparece no `inspect`.
        const rk = andar(k, `${onde}.chave(${String(k).slice(0, 24)})`);
        if (rk) return rk;
        const r = andar(val, `${onde}.get(${String(k).slice(0, 24)})`);
        if (r) return r;
      }
      return null;
    }
    if (v instanceof Set) {
      let i = 0;
      for (const val of v) {
        const r = andar(val, `${onde}#${i++}`);
        if (r) return r;
      }
      return null;
    }

    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i += 1) {
        const r = andar(v[i], `${onde}[${i}]`);
        if (r) return r;
      }
      // As chaves que NÃO são índice: array com propriedade pendurada existe, e
      // `util.inspect` a mostra. `pularIndices` evita andar duas vezes no corpo.
      return propriedades(v, onde, true);
    }

    // --- as três portas de serialização, no próprio objeto -------------------
    return portasDeSerializacao(v, onde) ?? propriedades(v, onde);
  }

  /**
   * `toJSON`, `toString` e o inspetor personalizado. É o que torna a varredura
   * superconjunto de `JSON.stringify`, `String()` e `console.log`.
   */
  function portasDeSerializacao(v: object, onde: string): AchadoDaVarredura | null {
    const obj = v as Record<string | symbol, unknown>;

    if (typeof obj.toJSON === 'function') {
      const r = tentar(() => (obj.toJSON as () => unknown).call(v));
      if (r.ok) {
        const achado = andar(r.v, `${onde}.toJSON()`);
        if (achado) return achado;
      }
    }

    const ts = obj.toString;
    if (typeof ts === 'function' && ts !== Object.prototype.toString) {
      const r = tentar(() => (ts as () => unknown).call(v));
      if (r.ok && typeof r.v === 'string') {
        const achado = texto(r.v, `${onde}.toString()`);
        if (achado) return achado;
      }
    }

    const custom = obj[inspect.custom as unknown as symbol];
    if (typeof custom === 'function') {
      const r = tentar(() => (custom as () => unknown).call(v));
      if (r.ok) {
        const achado = andar(r.v, `${onde}[inspect.custom]()`);
        if (achado) return achado;
      }
    }

    return null;
  }

  /**
   * TODAS as chaves próprias — enumeráveis ou não, texto ou símbolo.
   *
   * `Reflect.ownKeys` e não `Object.entries`: propriedade não enumerável e chave
   * simbólica são invisíveis à segunda e visíveis ao `util.inspect`. Campo
   * `#privado` continua fora daqui — que é exatamente o ponto da
   * `CredencialEmprestada`, e o motivo de ela passar nesta varredura.
   *
   * GETTER É INVOCADO: `JSON.stringify` invoca os enumeráveis, então uma
   * varredura que não invocasse seria menos do que ele. Exceção do getter é
   * engolida — ela já explodiria do mesmo jeito na serialização.
   */
  function propriedades(v: object, onde: string, pularIndices = false): AchadoDaVarredura | null {
    for (const chave of Reflect.ownKeys(v)) {
      if (pularIndices && typeof chave === 'string' && /^(?:\d+|length)$/.test(chave)) continue;
      const d = Object.getOwnPropertyDescriptor(v, chave);
      if (!d) continue;
      const rotulo = onde ? `${onde}.${String(chave)}` : String(chave);

      if ('value' in d) {
        const r = andar(d.value, rotulo);
        if (r) return r;
        continue;
      }
      if (typeof d.get === 'function') {
        const lido = tentar(() => d.get!.call(v));
        if (lido.ok) {
          const r = andar(lido.v, `${rotulo} (getter)`);
          if (r) return r;
        }
      }
    }
    return null;
  }

  return andar(valor, '') ?? { achou: false };
}
