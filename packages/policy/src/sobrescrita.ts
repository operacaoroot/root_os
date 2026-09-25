import type { Nivel } from './escada.js';
import type { CapacidadeCatalogo, DeltaPolitica, Politica } from './esquema.js';

/*
 * A SOBRESCRITA DE POLÍTICA POR EMPRESA — RF-P-04 e RF-P-06.
 *
 * `resolverPolitica()` (esquema.ts) já sabe APLICAR um delta sobre uma base.
 * O que faltava é a outra metade, que é a que o documento normativo cobra:
 * dizer O QUE mudou e se a mudança pode acontecer sozinha.
 *
 *   RF-P-04 — "cada tenant herda a política padrão da ROOT e sobrescreve
 *   apenas o que a operação dele exigir. A sobrescrita é versionada, com data
 *   e responsável."
 *
 *   RF-P-06 — "rebaixar nível nunca é automático. Só por configuração escrita,
 *   com data e responsável identificado."
 *
 * Daí as funções daqui:
 *
 *  - `diffDePolitica()` responde "o que mudou", capacidade a capacidade,
 *    limite a limite e seção a seção, com a DIREÇÃO de cada mudança.
 *
 *  - `redundanciasDoDelta()` responde "sobrescreveu o que não precisava". É o
 *    "APENAS o que a operação dele exigir" do RF-P-04 virando algo verificável:
 *    capacidade repetida idêntica à base não é sobrescrita, é cópia — e cópia é
 *    o que deixa de herdar a correção do dia em que a base mudar.
 *
 *  - `afrouxamentosDoDiff()` extrai do diff o que deixou a empresa MENOS
 *    restrita, já classificado por tipo (rebaixamento, capacidade nova, trava
 *    de execução, limite, seção). O tipo existe porque quem consome precisa
 *    tratar cada um diferente: acrescentar capacidade ao catálogo do
 *    repositório não é a mesma decisão que rebaixar um nível em produção.
 *
 *  - `recusasDaSobrescrita()` é a trava. Afrouxou alguma coisa e não tem
 *    responsável identificado (ou não tem motivo escrito)? A sobrescrita
 *    INTEIRA é recusada. Apertar segue livre: subir nível pode ser automático,
 *    e é o lado da assimetria que o documento autoriza de propósito.
 *
 * CONTRA O QUE SE MEDE — a parte que já esteve errada
 * `diffDePolitica()` NÃO sabe qual é a referência certa: ela é escolha de quem
 * chama, e há duas perguntas diferentes:
 *
 *   a) AUDITORIA — "o que esta empresa tem de diferente do que a ROOT entrega".
 *      Referência: a base herdada. É o que o histórico mostra numa tela.
 *   b) TRAVA — "o que esta mudança afrouxou em relação ao que estava valendo
 *      para esta empresa". Referência: o documento ATIVO dela.
 *
 * Medir a trava contra a base deixava passar toda redução em relação à versão
 * anterior da própria empresa: quem sobe uma capacidade de R2 para R4 podia
 * devolvê-la para R2 com um delta VAZIO — sem responsável, sem motivo e com o
 * diff gravado dizendo que nada mudou, porque contra a base realmente não
 * mudou. Quem chama a trava passa os afrouxamentos das DUAS referências
 * (`uniaoDosAfrouxamentos`); quem grava o histórico guarda os dois diffs em
 * campos separados, para ninguém comparar coisas diferentes sem saber.
 *
 * Puro como o resto do pacote: sem I/O, sem Nest, sem Prisma. Quem persiste a
 * versão e identifica o responsável é `apps/api/src/policy/policy.service.ts`.
 */

/** Do mais frouxo ao mais estrito. Índice maior = degrau mais alto. */
export const ORDEM_DOS_NIVEIS: readonly Nivel[] = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5'];

const degrau = (n: Nivel): number => ORDEM_DOS_NIVEIS.indexOf(n);

/**
 * JSON com chaves ordenadas, recursivamente — a mesma função que o seed usa
 * para não abrir versão nova a cada deploy.
 *
 * Existe porque JSONB do Postgres devolve as chaves em outra ordem, e um diff
 * que confia em `JSON.stringify` acusa mudança em documento idêntico. Aqui o
 * estrago seria pior que ruído: "a empresa mudou 51 capacidades" num histórico
 * que existe para dizer quem mudou o quê.
 *
 * CHAVE COM VALOR `undefined` NÃO CONTA, e é o mesmo que `JSON.stringify` faz.
 * Não é detalhe estético: `{ desfazer: undefined }` é o que sai de um objeto
 * montado por spread quando o campo opcional não se aplica. Contando a chave,
 * o valor canônico do documento em memória NUNCA batia com o que volta do
 * banco (o Postgres descarta a chave ao gravar), e a comparação de
 * idempotência dizia "mudou" em toda chamada — três execuções idênticas do
 * mesmo script abriam três versões.
 */
export function canonico(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`)
    .join(',')}}`;
}

export type DirecaoDoNivel = 'sobe' | 'desce' | 'igual' | 'nova';

/** Vale para limite, para campo de capacidade e para seção do documento. */
export type DirecaoDaTrava = 'aperta' | 'afrouxa' | 'igual';
export type DirecaoDoLimite = DirecaoDaTrava;

/**
 * Campos da capacidade que SÃO trava de execução — mexer neles muda o que o
 * sistema deixa acontecer, mesmo com o nível parado no mesmo degrau.
 *
 * `ferramenta` é o que o adaptador expõe ao modelo (`agents/tool-adapter.ts`
 * filtra por ela): capacidade sem ferramenta é declarada e inalcançável.
 * `argsSchema` é o que a porta valida no passo 1 (`gateway/validacao.ts`), e
 * esse validador devolve lista vazia quando o schema não declara
 * `properties` — ou seja, trocar o schema por `{type:'object'}` DESLIGA a
 * validação de argumento em silêncio.
 *
 * `rota`, `descricao` e `desfazer` ficam de fora de propósito: a primeira é
 * descritiva (o despacho é por id/ferramenta), a segunda é texto, e o
 * `desfazer` já é cobrado por `verificarReversibilidade()`, que reprova a
 * promessa vazia antes de a trava daqui ser consultada. `efeito` também fica
 * de fora porque o nível é calculado dele: mudança de efeito que importa
 * aparece como mudança de nível, e `verificarCatalogo()` reprova quando não
 * aparece.
 *
 * `aprovacao` (MD7) entrou na lista porque decide COMO a assinatura vale: com
 * `sob_lote`, a capacidade passa a sair por um item de lote assinado uma vez
 * para a semana inteira, sem aprovação por pedido. Qualquer mudança nesse campo
 * é afrouxamento — ver `direcaoDaAprovacao`.
 */
export const TRAVAS_DE_EXECUCAO = ['ferramenta', 'argsSchema', 'aprovacao'] as const;
export type TravaDeExecucao = (typeof TRAVAS_DE_EXECUCAO)[number];

export interface MudancaDeTrava {
  direcao: DirecaoDaTrava;
  /** Por que esta direção. Entra na mensagem da recusa — é o que dá o conserto. */
  porque: string;
}

export interface MudancaDeCapacidade {
  id: string;
  /** Nível na referência. `null` quando a capacidade só existe na sobrescrita. */
  de: Nivel | null;
  para: Nivel;
  /** `nova` conta como afrouxamento — ver `direcaoDeNivel`. */
  direcao: DirecaoDoNivel;
  /** Campos que mudaram, em ordem alfabética. Inclui `nivel` quando o nível mudou. */
  campos: string[];
  /**
   * Direção de cada campo que é trava de execução E mudou. Vazio quando só
   * mudaram campos sem direção (descrição, rota). É por aqui que
   * `afrouxamentosDoDiff` pega o que afrouxa sem o nível descer.
   */
  travas: Partial<Record<TravaDeExecucao, MudancaDeTrava>>;
}

export interface MudancaDeLimite {
  campo: keyof Politica['limitesPadrao'];
  de: unknown;
  para: unknown;
  direcao: DirecaoDaTrava;
}

/**
 * As seções do documento que não são capacidade nem limite e ainda assim
 * decidem o que acontece: quando um nível exige aprovação, com que alçada,
 * o que escala e por quanto tempo o rastro fica.
 */
export type SecaoDaPolitica = 'niveis' | 'gatilhos' | 'escalonamento' | 'invariantes' | 'retencao';

export interface MudancaDeSecao {
  secao: SecaoDaPolitica;
  direcao: DirecaoDaTrava;
  /** O que mudou dentro da seção, em texto legível — um item por mudança. */
  itens: string[];
}

export interface DiffDePolitica {
  capacidades: MudancaDeCapacidade[];
  limites: MudancaDeLimite[];
  /** Nulo nunca: lista vazia quando as seções são idênticas. */
  secoes: MudancaDeSecao[];
}

/** Os campos da capacidade que o diff compara. Um campo novo no esquema que
 *  não entre aqui passa a mudar em silêncio — por isso a lista é derivada do
 *  objeto, e não escrita à mão (ver `camposDaCapacidade`). */
function camposDaCapacidade(a: CapacidadeCatalogo, b: CapacidadeCatalogo): string[] {
  const chaves = new Set([...Object.keys(a), ...Object.keys(b)]);
  chaves.delete('id');
  return [...chaves]
    .filter((k) => {
      const va = (a as Record<string, unknown>)[k];
      const vb = (b as Record<string, unknown>)[k];
      return canonico(va) !== canonico(vb);
    })
    .sort();
}

/**
 * Capacidade que só existe na sobrescrita sai como `nova` — e `nova` AFROUXA.
 *
 * Parece contraintuitivo quando ela entra em R0, o degrau mais baixo: afrouxar
 * em relação a quê? À invariante 2 da escada, "capacidade sem classificação
 * vale R5". Antes da sobrescrita aquele id estava bloqueado; depois, liberado.
 * É a maior queda de exigência que existe no sistema, e tratá-la como mudança
 * neutra deixaria a trava do RF-P-06 aberta pelo caminho mais óbvio: em vez de
 * rebaixar `whatsapp.mensagem.enviar` de R3 para R2, a empresa declara
 * `whatsapp.mensagem.enviar.v2` em R0 e manda a mesma mensagem.
 *
 * Fica separado de `desce` porque o histórico precisa distinguir as duas: uma
 * é a empresa mexendo no que herdou, a outra é ela acrescentando o que a ROOT
 * nunca classificou.
 */
function direcaoDeNivel(de: Nivel | null, para: Nivel): DirecaoDoNivel {
  if (de === null) return 'nova';
  if (degrau(para) > degrau(de)) return 'sobe';
  if (degrau(para) < degrau(de)) return 'desce';
  return 'igual';
}

/** Minutos desde a meia-noite. `'08:00'` → 480. Formato inválido vira NaN. */
function minutos(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return Number.NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Janela horária: mais larga afrouxa, mais estreita aperta.
 *
 * Janela DESLOCADA (08:00-20:00 → 10:00-22:00) conta como afrouxamento, e é de
 * propósito: ela libera duas horas que a anterior proibia. Falha fechada —
 * qualquer janela que não seja subconjunto da anterior exige responsável.
 * Horário ilegível também afrouxa, pelo mesmo motivo: não dá para provar que
 * aperta.
 */
function direcaoDaJanela(de: unknown, para: unknown): DirecaoDaTrava {
  if (canonico(de) === canonico(para)) return 'igual';
  const [d0, d1] = (de as [string, string]).map(minutos);
  const [p0, p1] = (para as [string, string]).map(minutos);
  if ([d0, d1, p0, p1].some(Number.isNaN)) return 'afrouxa';
  const contida = p0 >= d0 && p1 <= d1;
  return contida ? 'aperta' : 'afrouxa';
}

/** Nos tetos numéricos, maior é mais permissivo. */
function direcaoDeTeto(de: unknown, para: unknown): DirecaoDaTrava {
  if (de === para) return 'igual';
  if (typeof de !== 'number' || typeof para !== 'number') return 'afrouxa';
  return para > de ? 'afrouxa' : 'aperta';
}

/* ------------------------------------------------ travas de execução -------- */

/** Ferramenta ausente que passa a existir AFROUXA: o modelo não a via. */
function direcaoDaFerramenta(de: unknown, para: unknown): MudancaDeTrava {
  if (de === para) return { direcao: 'igual', porque: 'sem mudança' };
  if (!de && para) {
    return {
      direcao: 'afrouxa',
      porque: `ganhou a ferramenta "${String(para)}" — nenhum agente alcançava esta capacidade`,
    };
  }
  if (de && !para) {
    return { direcao: 'aperta', porque: 'perdeu a ferramenta — sai da lista exposta ao modelo' };
  }
  // Renomear uma ferramenta que já existia não muda o alcance: o adaptador
  // expunha a capacidade antes e continua expondo.
  return { direcao: 'igual', porque: 'ferramenta renomeada, alcance igual' };
}

const objeto = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Nomes que o schema declara. Vazio = a porta não valida campo nenhum. */
function propriedadesDeclaradas(s: Record<string, unknown> | null): string[] {
  const p = s ? objeto(s.properties) : null;
  return p ? Object.keys(p) : [];
}

/** `additionalProperties` ausente vale `true` em JSON Schema: aceita extra. */
const aceitaPropriedadeExtra = (s: Record<string, unknown> | null): boolean =>
  s ? s.additionalProperties !== false : true;

/**
 * O esquema de argumentos é trava de execução, e a direção dele é
 * deliberadamente pessimista — falha fechada, como a janela horária.
 *
 * A porta (`gateway/validacao.ts`) só valida quando o schema é
 * `type: 'object'` COM `properties`. Então:
 *
 *  - schema que SOME: a validação morre inteira → afrouxa;
 *  - schema que perde a declaração de propriedades (`{type:'object'}`, ou
 *    `type` trocado): idem, `validarArgs` devolve `[]` → afrouxa;
 *  - schema que passa a aceitar propriedade extra (`additionalProperties`
 *    deixando de ser `false`) ou que declara propriedade nova: campo que a
 *    porta recusava passa a entrar → afrouxa;
 *  - schema que NASCE onde não havia (e declara propriedades): a validação
 *    passa a existir → aperta;
 *  - qualquer outra diferença: afrouxa. Não dá para provar que aperta lendo
 *    JSON Schema com o validador pequeno que a porta tem, e o lado errado de
 *    errar aqui é o tenant desligar a validação de argumento em silêncio.
 */
function direcaoDoArgsSchema(de: unknown, para: unknown): MudancaDeTrava {
  if (canonico(de) === canonico(para)) return { direcao: 'igual', porque: 'sem mudança' };

  const antes = objeto(de);
  const depois = objeto(para);

  const valida = (s: Record<string, unknown> | null) =>
    !!s && s.type === 'object' && propriedadesDeclaradas(s).length > 0;

  if (!depois) {
    return { direcao: 'afrouxa', porque: 'o esquema sumiu — a porta para de validar argumento' };
  }
  if (!valida(depois)) {
    return {
      direcao: 'afrouxa',
      porque:
        'o esquema deixou de declarar propriedades — `validarArgs` devolve vazio e ' +
        'qualquer argumento passa',
    };
  }
  if (!valida(antes)) {
    return { direcao: 'aperta', porque: 'passou a declarar propriedades: a porta começa a validar' };
  }
  if (aceitaPropriedadeExtra(depois) && !aceitaPropriedadeExtra(antes)) {
    return {
      direcao: 'afrouxa',
      porque: 'passou a aceitar propriedade extra (additionalProperties deixou de ser false)',
    };
  }
  const declaradasAntes = new Set(propriedadesDeclaradas(antes));
  const novas = propriedadesDeclaradas(depois).filter((p) => !declaradasAntes.has(p));
  if (novas.length) {
    return { direcao: 'afrouxa', porque: `declara propriedade nova: ${novas.join(', ')}` };
  }
  /*
   * Falha fechada, como a janela horária: sobrou diferença que este código não
   * sabe ler (tipo de campo, enum, minLength, required). Não dá para PROVAR
   * que aperta lendo JSON Schema com o validador pequeno que a porta tem, e o
   * lado errado de errar aqui é o tenant desligar a validação em silêncio.
   */
  return { direcao: 'afrouxa', porque: 'mudou de um jeito que não dá para provar que aperta' };
}

/**
 * O modo de aprovação da capacidade (`lote`/`sob_lote`, MD7). Toda mudança
 * AFROUXA, inclusive a que parece apertar, e é falha fechada como a janela
 * horária: o campo decide quantas saídas uma assinatura cobre, e trocar o teto
 * de itens, o prazo máximo ou o lote apontado muda o alcance de uma assinatura
 * que ninguém releu. Quem mexe assina.
 */
function direcaoDaAprovacao(de: unknown, para: unknown): MudancaDeTrava {
  if (canonico(de) === canonico(para)) return { direcao: 'igual', porque: 'sem mudança' };
  const modo = (v: unknown) => (objeto(v)?.modo as string | undefined) ?? 'uso único';
  return {
    direcao: 'afrouxa',
    porque: `o modo de aprovação mudou (${modo(de)} → ${modo(para)}): decide quantas saídas uma assinatura cobre`,
  };
}

function travasDaCapacidade(
  a: CapacidadeCatalogo,
  b: CapacidadeCatalogo,
  campos: readonly string[],
): Partial<Record<TravaDeExecucao, MudancaDeTrava>> {
  const r: Partial<Record<TravaDeExecucao, MudancaDeTrava>> = {};
  for (const campo of TRAVAS_DE_EXECUCAO) {
    if (!campos.includes(campo)) continue;
    const de = (a as Record<string, unknown>)[campo];
    const para = (b as Record<string, unknown>)[campo];
    r[campo] =
      campo === 'ferramenta'
        ? direcaoDaFerramenta(de, para)
        : campo === 'aprovacao'
          ? direcaoDaAprovacao(de, para)
          : direcaoDoArgsSchema(de, para);
  }
  return r;
}

/* --------------------------------------- seções fora de capacidade/limite --- */

/** Do mais frouxo ao mais estrito, para os dois enums que têm ordem. */
const ORDEM_DA_EXIGENCIA = ['nunca', 'configuravel', 'sempre'];
const ORDEM_DA_ALCADA = ['operador', 'responsavel', 'titular'];

type Registro = Record<string, unknown>;

/** Campos do nível que este código sabe ler — o resto falha fechado. */
const CONHECIDOS_DO_NIVEL = ['nome', 'escreve', 'bloqueado', 'aprovacao', 'rastro'];
const CONHECIDOS_DA_APROVACAO = [
  'exigida',
  'vinculo',
  'usoUnico',
  'validadeSegundos',
  'reautenticacao',
  'alcadaMinima',
];

/** O objeto sem as chaves que a função sabe ler — o que sobra é desconhecido. */
const resto = (o: Registro, conhecidos: string[]): Registro =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !conhecidos.includes(k)));

/**
 * Um nível do documento: `escreve`, `bloqueado`, o bloco de aprovação e a
 * lista de rastro. Tudo aqui decide execução, e nada disso é capacidade nem
 * limite — era a metade do documento que a trava dizia cobrir e não cobria.
 */
function afrouxamentosDoNivel(rotulo: string, de: Registro, para: Registro): string[] {
  const itens: string[] = [];
  const diz = (campo: string, a: unknown, b: unknown) =>
    `${rotulo}.${campo}: ${JSON.stringify(a) ?? 'nada'} → ${JSON.stringify(b) ?? 'nada'}`;

  if (de.escreve === false && para.escreve === true) itens.push(diz('escreve', false, true));
  if (de.bloqueado === true && para.bloqueado === false) itens.push(diz('bloqueado', true, false));

  const aDe = objeto(de.aprovacao) ?? {};
  const aPara = objeto(para.aprovacao) ?? {};

  const menor = (ordem: string[], a: unknown, b: unknown) =>
    ordem.indexOf(String(b)) < ordem.indexOf(String(a));
  if (menor(ORDEM_DA_EXIGENCIA, aDe.exigida, aPara.exigida)) {
    itens.push(diz('aprovacao.exigida', aDe.exigida, aPara.exigida));
  }
  if (menor(ORDEM_DA_ALCADA, aDe.alcadaMinima, aPara.alcadaMinima)) {
    itens.push(diz('aprovacao.alcadaMinima', aDe.alcadaMinima, aPara.alcadaMinima));
  }
  if (aDe.vinculo === 'conteudo' && aPara.vinculo !== 'conteudo') {
    itens.push(diz('aprovacao.vinculo', aDe.vinculo, aPara.vinculo));
  }
  if (aDe.usoUnico === true && aPara.usoUnico === false) {
    itens.push(diz('aprovacao.usoUnico', true, false));
  }
  if (aDe.reautenticacao === true && aPara.reautenticacao === false) {
    itens.push(diz('aprovacao.reautenticacao', true, false));
  }
  if (
    typeof aDe.validadeSegundos === 'number' &&
    typeof aPara.validadeSegundos === 'number' &&
    aPara.validadeSegundos > aDe.validadeSegundos
  ) {
    itens.push(diz('aprovacao.validadeSegundos', aDe.validadeSegundos, aPara.validadeSegundos));
  }

  const rastroDe = Array.isArray(de.rastro) ? (de.rastro as unknown[]).map(String) : [];
  const rastroPara = new Set(Array.isArray(para.rastro) ? (para.rastro as unknown[]).map(String) : []);
  const perdidos = rastroDe.filter((r) => !rastroPara.has(r));
  if (perdidos.length) itens.push(`${rotulo}.rastro perdeu: ${perdidos.join(', ')}`);

  /*
   * Falha fechada para o RESTO: campo que este código não sabe ler (um campo
   * novo no esquema do nível, ou dentro do bloco de aprovação) não pode passar
   * por "apertou". Note que só o desconhecido entra aqui — um endurecimento
   * reconhecido, como `exigida: nunca → sempre`, sai com a lista vazia e a
   * seção é classificada como `aperta`.
   */
  const sobraDe = resto(de, CONHECIDOS_DO_NIVEL);
  const sobraPara = resto(para, CONHECIDOS_DO_NIVEL);
  const aprovDe = resto(objeto(de.aprovacao) ?? {}, CONHECIDOS_DA_APROVACAO);
  const aprovPara = resto(objeto(para.aprovacao) ?? {}, CONHECIDOS_DA_APROVACAO);
  if (canonico(sobraDe) !== canonico(sobraPara) || canonico(aprovDe) !== canonico(aprovPara)) {
    itens.push(`${rotulo}: mudança em campo sem direção conhecida`);
  }
  return itens;
}

function diffDasSecoes(referencia: Politica, resolvida: Politica): MudancaDeSecao[] {
  const secoes: MudancaDeSecao[] = [];
  /** Sem item de afrouxamento = a mudança é reconhecida e endurece. */
  const anota = (secao: SecaoDaPolitica, itens: string[]) => {
    secoes.push({ secao, direcao: itens.length ? 'afrouxa' : 'aperta', itens });
  };

  /* niveis — tem direção de verdade, campo a campo */
  const niveisDe = (referencia.niveis ?? {}) as Registro;
  const niveisPara = (resolvida.niveis ?? {}) as Registro;
  if (canonico(niveisDe) !== canonico(niveisPara)) {
    const itens: string[] = [];
    for (const chave of new Set([...Object.keys(niveisDe), ...Object.keys(niveisPara)])) {
      const a = objeto(niveisDe[chave]);
      const b = objeto(niveisPara[chave]);
      // Nível que some ou aparece muda o chão de tudo: sem direção legível.
      if (!a || !b) {
        itens.push(`niveis.${chave}: ${a ? 'removido' : 'acrescentado'}`);
        continue;
      }
      itens.push(...afrouxamentosDoNivel(`niveis.${chave}`, a, b));
    }
    anota('niveis', itens);
  }

  /* invariantes — perder uma afrouxa; só acrescentar aperta */
  const invDe = referencia.invariantes ?? [];
  const invPara = new Set(resolvida.invariantes ?? []);
  if (canonico(invDe) !== canonico(resolvida.invariantes ?? [])) {
    const perdidas = invDe.filter((i) => !invPara.has(i));
    anota(
      'invariantes',
      perdidas.map((i) => `invariante removida: ${i}`),
    );
  }

  /* escalonamento — sinal que some afrouxa; a REGRA é prosa, e prosa falha fechada */
  const escDe = objeto(referencia.escalonamento) ?? {};
  const escPara = objeto(resolvida.escalonamento) ?? {};
  if (canonico(escDe) !== canonico(escPara)) {
    const itens: string[] = [];
    const idsDe = Array.isArray(escDe.sinais)
      ? (escDe.sinais as Registro[]).map((s) => String(s?.id))
      : [];
    const idsPara = new Set(
      Array.isArray(escPara.sinais) ? (escPara.sinais as Registro[]).map((s) => String(s?.id)) : [],
    );
    for (const id of idsDe.filter((i) => !idsPara.has(i))) {
      itens.push(`escalonamento: sinal removido — ${id}`);
    }
    if (escDe.regra !== escPara.regra) itens.push('escalonamento.regra mudou');
    anota('escalonamento', itens);
  }

  /*
   * gatilhos e retencao — não têm ordem definida em lugar nenhum, e ninguém
   * lê nenhum dos dois hoje. Falha fechada: qualquer mudança exige assinatura.
   * É a alternativa honesta a dizer que a trava cobre o documento inteiro e
   * não cobrir.
   */
  for (const secao of ['gatilhos', 'retencao'] as const) {
    const a = (referencia as unknown as Registro)[secao];
    const b = (resolvida as unknown as Registro)[secao];
    if (canonico(a) === canonico(b)) continue;
    anota(secao, [`${secao} mudou — seção sem direção definida, exige assinatura`]);
  }

  return secoes;
}

/* ------------------------------------------------------------- o diff ------- */

/**
 * O que `resolvida` tem de diferente de `referencia`.
 *
 * A REFERÊNCIA É ESCOLHA DE QUEM CHAMA, e existem duas perguntas (ver o
 * cabeçalho): a base herdada responde "o que esta empresa tem de diferente da
 * ROOT" (auditoria); o documento ativo da empresa responde "o que esta mudança
 * fez" (trava e histórico honesto). Passar a base onde se queria a segunda foi
 * o furo que deixava toda redução em relação à versão anterior da própria
 * empresa entrar sem responsável.
 *
 * Recebe as duas POLÍTICAS RESOLVIDAS, não o delta: é a comparação do estado
 * final que importa. Um delta pode declarar uma capacidade idêntica à da
 * referência (não muda nada) e pode deixar de declarar uma que ela acrescentou
 * depois (herda, e o diff mostra isso como ausência de mudança).
 */
export function diffDePolitica(referencia: Politica, resolvida: Politica): DiffDePolitica {
  const naReferencia = new Map(referencia.capacidades.map((c) => [c.id, c]));
  const capacidades: MudancaDeCapacidade[] = [];

  for (const c of resolvida.capacidades) {
    const anterior = naReferencia.get(c.id);
    if (!anterior) {
      capacidades.push({
        id: c.id,
        de: null,
        para: c.nivel,
        direcao: direcaoDeNivel(null, c.nivel),
        campos: ['(nova)'],
        travas: {},
      });
      continue;
    }
    const campos = camposDaCapacidade(anterior, c);
    if (campos.length === 0) continue;
    capacidades.push({
      id: c.id,
      de: anterior.nivel,
      para: c.nivel,
      direcao: direcaoDeNivel(anterior.nivel, c.nivel),
      campos,
      travas: travasDaCapacidade(anterior, c, campos),
    });
  }

  /*
   * Capacidade que some da resolvida NÃO é registrada como mudança porque não
   * pode acontecer: `resolverPolitica()` só faz `set`, nunca `delete`. E se um
   * dia puder, sumir é fail-closed — some do catálogo, vale R5, entra
   * bloqueada. É a única direção segura, e por isso não precisa de trava.
   */

  const limites: MudancaDeLimite[] = [];
  for (const campo of Object.keys(
    referencia.limitesPadrao,
  ) as (keyof Politica['limitesPadrao'])[]) {
    const de = referencia.limitesPadrao[campo];
    const para = resolvida.limitesPadrao[campo];
    const direcao = campo === 'janelaHoraria' ? direcaoDaJanela(de, para) : direcaoDeTeto(de, para);
    if (direcao !== 'igual') limites.push({ campo, de, para, direcao });
  }

  return { capacidades, limites, secoes: diffDasSecoes(referencia, resolvida) };
}

/**
 * Ids que o delta declara e que são idênticos à base — sobrescrita que não
 * sobrescreve nada.
 *
 * Não é erro: é dívida. Cada cópia dessas é uma capacidade que PAROU de herdar.
 * No dia em que a base subir `email.enviar` de R3 para R4, a empresa que tinha
 * copiado a versão R3 continua em R3, e ninguém vai notar — foi exatamente
 * assim que os desfazer pendurados sobreviveram no catálogo até a fatia 2.2.
 */
export function redundanciasDoDelta(base: Politica, delta: DeltaPolitica): string[] {
  const naBase = new Map(base.capacidades.map((c) => [c.id, c]));
  return delta.capacidades
    .filter((c) => {
      const anterior = naBase.get(c.id);
      return anterior ? camposDaCapacidade(anterior, c).length === 0 : false;
    })
    .map((c) => c.id);
}

/* ------------------------------------------------------- afrouxamentos ------ */

/**
 * Por que o tipo importa: quem consome trata cada um diferente.
 *
 * `capacidade-nova` no catálogo do repositório é a evolução normal do produto,
 * revisada em código; `nivel-rebaixado` em produção é decisão de operação. Sem
 * a distinção, o seed derrubava a rodada inteira com a mensagem errada e uma
 * assinatura pedida para acrescentar capacidade liberava, no mesmo comando,
 * qualquer rebaixamento que estivesse no arquivo.
 */
export type TipoDeAfrouxamento =
  | 'nivel-rebaixado'
  | 'capacidade-nova'
  | 'trava-de-execucao'
  | 'limite'
  | 'secao';

export interface Afrouxamento {
  tipo: TipoDeAfrouxamento;
  /** Id da capacidade, campo do limite ou nome da seção. */
  alvo: string;
  /** Frase pronta para log, erro de API e saída de script. */
  texto: string;
}

/** O que, no diff, deixa a empresa MENOS restrita do que a referência deixava. */
export function afrouxamentosDoDiff(diff: DiffDePolitica): Afrouxamento[] {
  const itens: Afrouxamento[] = [];

  for (const c of diff.capacidades) {
    if (c.direcao === 'nova') {
      itens.push({
        tipo: 'capacidade-nova',
        alvo: c.id,
        texto: `${c.id}: capacidade nova em ${c.para} (não declarada valia R5)`,
      });
    } else if (c.direcao === 'desce') {
      itens.push({ tipo: 'nivel-rebaixado', alvo: c.id, texto: `${c.id}: ${c.de} → ${c.para}` });
    }
    for (const [campo, trava] of Object.entries(c.travas)) {
      if (trava.direcao !== 'afrouxa') continue;
      itens.push({
        tipo: 'trava-de-execucao',
        alvo: c.id,
        texto: `${c.id}: ${campo} — ${trava.porque} (nível segue ${c.para})`,
      });
    }
  }

  for (const l of diff.limites) {
    if (l.direcao !== 'afrouxa') continue;
    itens.push({
      tipo: 'limite',
      alvo: String(l.campo),
      texto: `limite ${String(l.campo)}: ${JSON.stringify(l.de)} → ${JSON.stringify(l.para)}`,
    });
  }

  for (const s of diff.secoes) {
    if (s.direcao !== 'afrouxa') continue;
    for (const texto of s.itens) itens.push({ tipo: 'secao', alvo: s.secao, texto });
  }

  return itens;
}

/** A lista em texto — é o que vai na mensagem de erro e no log. */
export const textosDosAfrouxamentos = (itens: readonly Afrouxamento[]): string[] =>
  itens.map((i) => i.texto);

/**
 * Junta os afrouxamentos de mais de uma referência, sem repetir.
 *
 * É o que a trava consome: a mesma sobrescrita é medida contra a base herdada
 * E contra o documento que estava valendo para a empresa, e basta afrouxar em
 * uma das duas para exigir assinatura. Contra uma só, o ataque é trivial —
 * subir de R2 para R4 e depois devolver para R2 com delta vazio não afrouxa
 * nada em relação à base.
 */
export function uniaoDosAfrouxamentos(
  ...listas: readonly (readonly Afrouxamento[])[]
): Afrouxamento[] {
  const vistos = new Set<string>();
  const juntos: Afrouxamento[] = [];
  for (const lista of listas) {
    for (const item of lista) {
      const chave = `${item.tipo}|${item.alvo}|${item.texto}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      juntos.push(item);
    }
  }
  return juntos;
}

export type MotivoDeRecusa = 'afrouxamento-sem-responsavel' | 'afrouxamento-sem-motivo';

export interface RecusaDeSobrescrita {
  motivo: MotivoDeRecusa;
  /** O que afrouxou, em texto legível — é o que vai na mensagem do erro. */
  itens: string[];
  /** O mesmo, classificado, para quem precisa decidir por tipo. */
  afrouxamentos: Afrouxamento[];
}

export interface AssinaturaDaSobrescrita {
  /** Quem responde pela mudança. Vazio = ninguém identificado. */
  autorId?: string | null;
  /** A configuração ESCRITA que o documento exige. Vazio = decisão sem registro. */
  motivo?: string | null;
}

/**
 * Tamanho mínimo do motivo.
 *
 * Um limite arbitrário é pior que nenhum quando ele só empurra o problema (o
 * operador escreve "aaaaaaaaaa"). Este não existe para provar qualidade: existe
 * para separar "alguém escreveu uma frase" de `motivo: ''` e `motivo: 'x'`,
 * que é o que um chamador automático manda quando o campo é obrigatório no
 * banco e ninguém pensou nele. Quem quiser burlar, burla — mas aí a burla está
 * assinada, com data e responsável, que é o que o RF-P-06 pede.
 */
export const MINIMO_DO_MOTIVO = 10;

const preenchido = (v: string | null | undefined) => typeof v === 'string' && v.trim() !== '';

export const motivoEscrito = (v: string | null | undefined): boolean =>
  preenchido(v) && v!.trim().length >= MINIMO_DO_MOTIVO;

/**
 * A trava do RF-P-06, em uma frase: afrouxou, tem de estar assinado.
 *
 * Recebe os AFROUXAMENTOS já apurados, e não o diff, de propósito: qual é a
 * referência certa é decisão de quem chama, e a resposta é "as duas" —
 * `uniaoDosAfrouxamentos(afrouxamentosDoDiff(contraABase),
 * afrouxamentosDoDiff(contraOQueValia))`. Enquanto esta função tirava o diff
 * sozinha, ela media contra o que o chamador tivesse passado, e o chamador
 * passava a base.
 *
 * Devolve lista vazia quando a sobrescrita pode ser aplicada. Devolve uma
 * recusa por requisito faltando — as duas juntas quando faltam os dois, para
 * que quem chamou conserte de uma vez em vez de descobrir o segundo problema
 * depois de resolver o primeiro.
 *
 * Note que é a sobrescrita INTEIRA que cai, não só o item que afrouxou.
 * Aplicar metade deixaria a empresa num estado que ninguém pediu e que não
 * corresponde a documento nenhum — e o histórico precisa poder dizer "neste
 * dia, esta empresa passou a valer ISTO".
 */
export function recusasDaSobrescrita(
  afrouxamentos: readonly Afrouxamento[],
  assinatura: AssinaturaDaSobrescrita,
): RecusaDeSobrescrita[] {
  if (afrouxamentos.length === 0) return [];
  const itens = textosDosAfrouxamentos(afrouxamentos);
  const lista = [...afrouxamentos];

  const recusas: RecusaDeSobrescrita[] = [];
  if (!preenchido(assinatura.autorId)) {
    recusas.push({ motivo: 'afrouxamento-sem-responsavel', itens, afrouxamentos: lista });
  }
  if (!motivoEscrito(assinatura.motivo)) {
    recusas.push({ motivo: 'afrouxamento-sem-motivo', itens, afrouxamentos: lista });
  }
  return recusas;
}

/** A recusa em texto, para log, erro de API e saída de script. */
export function explicarRecusas(recusas: readonly RecusaDeSobrescrita[]): string {
  const exigencia = recusas
    .map((r) =>
      r.motivo === 'afrouxamento-sem-responsavel'
        ? 'responsável identificado (autorId)'
        : `motivo escrito com pelo menos ${MINIMO_DO_MOTIVO} caracteres`,
    )
    .join(' e ');
  const itens = recusas[0]?.itens ?? [];
  return (
    `rebaixar nível nunca é automático (RF-P-06): esta sobrescrita afrouxa ${itens.length} ` +
    `item(ns) e exige ${exigencia}.\n  ` +
    itens.join('\n  ')
  );
}
