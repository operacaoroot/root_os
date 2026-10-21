/*
 * ============================================================================
 * O PADRÃO DE NOMENCLATURA DA AGENDA DA ROOT
 * ============================================================================
 *
 * A agenda da Root vive no Google Calendar da conta `operacao.root@gmail.com`,
 * e o ROOT OS é a porta pela qual ela é marcada. O combinado (24/09/2026) é
 * literal:
 *
 *   Reunião Online - Andrade Peças - Pedro
 *   Reunião Presencial - Andrade Peças - Rodrigo
 *   Reunião Interna - Lucas
 *   Reunião Interna - Todos
 *
 * Duas formas, e só duas: a de CLIENTE declara a modalidade, o cliente e quem
 * atende; a INTERNA declara quem conduz — um sócio ou `Todos` — e não fala de
 * modalidade, porque entre nós ela não muda nada do que a linha precisa dizer.
 *
 * POR QUE O PADRÃO MORA AQUI, e não na tela nem no conector: são três
 * consumidores com a mesma pergunta e nenhum motivo para respostas diferentes —
 * a tela que monta o título, a API que o escreve no Google (inclusive quando
 * quem pede é um agente, que assim não consegue fugir do padrão) e a leitura,
 * que precisa DESMONTAR o título do evento para mostrar cliente e responsável
 * em colunas. Duas cópias desta gramática é como o calendário volta a ter
 * "Reunião c/ Andrade" escrito na mão.
 *
 * A LEITURA É TOLERANTE E A ESCRITA É ESTRITA. Escrever é sempre por
 * `montarTituloDeReuniao`, que só sabe produzir a forma canônica. Ler aceita o
 * que o Google já tem: hífen de qualquer largura, espaço sobrando, "Reuniao"
 * sem acento, e a variante com modalidade na interna. O que não couber em forma
 * nenhuma volta como `null`, e a tela mostra isso como "fora do padrão" em vez
 * de inventar um cliente que ninguém escreveu.
 */

/** Como a reunião acontece. Só entra no título quando é reunião de cliente. */
export type ModalidadeDeReuniao = 'online' | 'presencial';

export const MODALIDADES_DE_REUNIAO: readonly ModalidadeDeReuniao[] = ['online', 'presencial'];

/** O rótulo de quem conduz quando a casa inteira vai. */
export const RESPONSAVEL_TODOS = 'Todos';

/** A palavra que abre toda linha da agenda da Root. */
const PREFIXO = 'Reunião';

/** O separador canônico — hífen simples cercado de espaço. */
const SEPARADOR = ' - ';

const rotuloDaModalidade: Record<ModalidadeDeReuniao, string> = {
  online: 'Online',
  presencial: 'Presencial',
};

/** A palavra que marca a reunião de dentro de casa. */
const INTERNA = 'Interna';

export interface ReuniaoDeCliente {
  tipo: 'cliente';
  modalidade: ModalidadeDeReuniao;
  /** O nome do cliente como a Root o chama. */
  cliente: string;
  /** O sócio que atende — ou `Todos`. */
  responsavel: string;
}

export interface ReuniaoInterna {
  tipo: 'interna';
  /**
   * A modalidade da interna NÃO vai para o título (é o combinado), mas ela
   * existe: é ela que decide se o evento nasce com link do Meet. Na leitura,
   * vem preenchida só quando o título veio na variante que a declara.
   */
  modalidade?: ModalidadeDeReuniao;
  /** O sócio que conduz — ou `Todos`. */
  responsavel: string;
}

export type ReuniaoDaAgenda = ReuniaoDeCliente | ReuniaoInterna;

/** Espaço normalizado e pontas limpas. Nome com espaço duplo vira nome simples. */
const limpar = (v: string): string => v.replace(/\s+/g, ' ').trim();

/**
 * Monta o título canônico. É o ÚNICO jeito de um título nascer no OS — a rota
 * de marcar reunião recebe os campos, nunca o texto pronto.
 *
 * Lança quando falta o que o padrão exige, em vez de produzir
 * `Reunião Online -  - Pedro`: um título quebrado no Google é corrigido na mão
 * por alguém, um dia, se alguém reparar.
 */
export function montarTituloDeReuniao(r: ReuniaoDaAgenda): string {
  const responsavel = limpar(r.responsavel);
  if (!responsavel) throw new Error('Toda reunião precisa de um responsável (um sócio ou "Todos").');

  if (r.tipo === 'interna') {
    return `${PREFIXO} ${INTERNA}${SEPARADOR}${responsavel}`;
  }

  const cliente = limpar(r.cliente);
  if (!cliente) throw new Error('Reunião de cliente precisa do nome do cliente.');
  if (cliente.toLowerCase() === INTERNA.toLowerCase()) {
    throw new Error('"Interna" não é nome de cliente — marque a reunião como interna.');
  }
  return `${PREFIXO} ${rotuloDaModalidade[r.modalidade]}${SEPARADOR}${cliente}${SEPARADOR}${responsavel}`;
}

/** Hífen, travessão e meia-risca são o mesmo separador para quem lê. */
const SEPARADOR_LIDO = /\s+[-–—]\s+/;

const modalidadeLida = (v: string): ModalidadeDeReuniao | null => {
  const n = limpar(v).toLowerCase();
  if (n === 'online' || n === 'on-line') return 'online';
  if (n === 'presencial') return 'presencial';
  return null;
};

const ehInterna = (v: string): boolean => limpar(v).toLowerCase() === INTERNA.toLowerCase();

/**
 * Desmonta o título de um evento do Google. `null` = fora do padrão, e a tela
 * diz isso com todas as letras.
 *
 * As formas aceitas, e por que cada uma:
 *   `Reunião Online - Cliente - Pedro`    a forma canônica de cliente
 *   `Reunião Online - Cliente`            padrão antigo, sem responsável — ainda
 *                                         é uma reunião de cliente, e escondê-la
 *                                         seria pior que mostrá-la incompleta
 *   `Reunião Interna - Pedro`             a forma canônica de interna
 *   `Reunião Online - Interna - Pedro`    interna que declarou modalidade
 *   `Reunião Interna`                     interna sem dono declarado
 */
export function lerTituloDeReuniao(titulo: string | null | undefined): ReuniaoDaAgenda | null {
  const texto = limpar(titulo ?? '');
  if (!texto) return null;

  const partes = texto.split(SEPARADOR_LIDO).map(limpar).filter(Boolean);
  if (partes.length === 0) return null;

  // A cabeça é `Reunião`, `Reunião Online`, `Reunião Presencial` ou `Reunião Interna`.
  const cabeca = partes[0];
  const m = /^reuni[ãa]o\b\s*(.*)$/i.exec(cabeca);
  if (!m) return null;
  const qualificador = limpar(m[1]);

  let modalidade: ModalidadeDeReuniao | null = null;
  let interna = false;
  if (qualificador) {
    modalidade = modalidadeLida(qualificador);
    if (!modalidade) {
      if (!ehInterna(qualificador)) return null; // "Reunião de alinhamento" não é o padrão
      interna = true;
    }
  }

  const resto = partes.slice(1);

  // `Reunião Interna - Fulano` / `Reunião Interna`
  if (interna) {
    return { tipo: 'interna', responsavel: resto[0] ?? RESPONSAVEL_TODOS };
  }

  // `Reunião Online - Interna - Fulano`
  if (resto.length > 0 && ehInterna(resto[0])) {
    return {
      tipo: 'interna',
      ...(modalidade ? { modalidade } : {}),
      responsavel: resto[1] ?? RESPONSAVEL_TODOS,
    };
  }

  // Sem modalidade e sem "Interna", só "Reunião - alguma coisa": não dá para
  // dizer se é cliente ou casa. Fora do padrão, e quem marcou refaz.
  if (!modalidade) return null;
  if (resto.length === 0) return null;

  return {
    tipo: 'cliente',
    modalidade,
    cliente: resto[0],
    responsavel: resto[1] ?? '',
  };
}

/** O título segue o padrão da casa? Atalho de leitura para telas e testes. */
export const tituloNoPadrao = (titulo: string | null | undefined): boolean =>
  lerTituloDeReuniao(titulo) !== null;

/**
 * O rótulo curto de quem a reunião é — o que a tela mostra na coluna "com
 * quem": o cliente, ou `Interna`.
 */
export function comQuemDaReuniao(r: ReuniaoDaAgenda): string {
  return r.tipo === 'cliente' ? r.cliente : INTERNA;
}

/*
 * ============================================================================
 * O VIGIA DA AGENDA (AG-01, rodada dos agentes, 21/10/2026)
 * ============================================================================
 *
 * O que vem abaixo é a CONFERÊNCIA: a pergunta "este evento é reunião, e se é,
 * está no padrão?". Mora aqui, ao lado da gramática, pelo mesmo motivo dela: a
 * tela que mostra o selo, a API que conta e o vigia que propõe a correção
 * fazem a mesma pergunta, e duas respostas diferentes seriam o calendário
 * dizendo "no padrão" numa tela e "fora" na outra.
 *
 * DUAS RÉGUAS, e a diferença é de propósito:
 *   · `lerTituloDeReuniao` é TOLERANTE: serve para mostrar cliente e
 *     responsável em colunas, e aceita travessão, acento faltando e a variante
 *     sem responsável;
 *   · `conferirEvento` é ESTRITA: o título tem de ser EXATAMENTE o que
 *     `montarTituloDeReuniao` escreveria, o responsável tem de ser um dos
 *     quatro e a reunião online tem de ter Meet. É a régua do vigia: o que a
 *     leitura tolera, ele propõe consertar.
 *
 * PURO: sem relógio, sem rede, sem banco. O vigia (`apps/api/src/agenda/`) lê
 * a agenda pela porta e chama estas funções.
 */

/** Quem pode estar no fim do título: os três sócios da Root, ou a casa inteira. */
export const RESPONSAVEIS_DA_AGENDA = ['Rodrigo', 'Lucas', 'Pedro', RESPONSAVEL_TODOS] as const;
export type ResponsavelDaAgenda = (typeof RESPONSAVEIS_DA_AGENDA)[number];

/** Minúsculo, sem acento, espaço normalizado: a forma de comparar nome escrito por gente. */
export function normalizarParaAgenda(v: string | null | undefined): string {
  return limpar(String(v ?? ''))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** O responsável na grafia canônica (`pedro` → `Pedro`), ou `null` se não é um dos quatro. */
export function responsavelDaAgenda(nome: string | null | undefined): ResponsavelDaAgenda | null {
  const n = normalizarParaAgenda(nome);
  if (!n) return null;
  return RESPONSAVEIS_DA_AGENDA.find((r) => normalizarParaAgenda(r) === n) ?? null;
}

/** O que a conferência precisa saber de um evento — o recorte de `GET /google/calendar/periodo`. */
export interface EventoParaConferir {
  titulo: string | null;
  /** Os e-mails de `attendees`, como o Google devolve (o organizador costuma vir junto). */
  convidados: readonly string[];
  organizador?: string | null;
  meet?: string | null;
  local?: string | null;
  descricao?: string | null;
  /** `cancelled` não é reunião de ninguém. */
  status?: string | null;
}

/** Os convidados de verdade: sem o organizador, sem repetição, em minúsculas. */
export function convidadosDoEvento(e: Pick<EventoParaConferir, 'convidados' | 'organizador'>): string[] {
  const organizador = String(e.organizador ?? '').trim().toLowerCase();
  const vistos = new Set<string>();
  for (const bruto of e.convidados ?? []) {
    const email = String(bruto ?? '').trim().toLowerCase();
    if (!email || email === organizador) continue;
    vistos.add(email);
  }
  return [...vistos];
}

/**
 * As palavras que fazem do título uma reunião mesmo sem convidado nem Meet.
 * Comparadas sem acento e por palavra inteira: "recall" não é "call", e
 * "reconversa" não existe, mas a regra não aposta nisso.
 */
const PALAVRAS_DE_REUNIAO = /(^|[^a-z0-9])(reuniao|reunioes|call|calls|conversa|kickoff|kick-off|kick off)([^a-z0-9]|$)/;

/**
 * ESTE EVENTO É REUNIÃO?
 *
 * Sim quando tem convidado (alguém além de quem marcou), OU tem link de Meet,
 * OU o título fala em reunião, call, conversa ou kickoff. O resto — bloqueio
 * pessoal, lembrete, "academia", "buscar as crianças" — não é da conta do
 * vigia: o padrão é de REUNIÃO, e cobrar título de compromisso pessoal seria
 * ruído que ensina a ignorar o selo.
 *
 * Evento cancelado nunca é: ele ainda aparece na leitura com `status`
 * `cancelled`, e propor título para ele seria trabalho sobre o que não vai
 * acontecer.
 */
export function ehReuniao(e: EventoParaConferir): boolean {
  if (String(e.status ?? '').toLowerCase() === 'cancelled') return false;
  if (convidadosDoEvento(e).length > 0) return true;
  if (String(e.meet ?? '').trim()) return true;
  return PALAVRAS_DE_REUNIAO.test(normalizarParaAgenda(e.titulo));
}

/** Por que um título não está no padrão. A frase de cada um está em `FRASE_DO_PROBLEMA`. */
export type ProblemaDoPadrao =
  | 'titulo_fora_da_gramatica'
  | 'titulo_fora_da_forma'
  | 'sem_responsavel'
  | 'responsavel_fora_da_lista'
  | 'online_sem_meet';

export const FRASE_DO_PROBLEMA: Readonly<Record<ProblemaDoPadrao, string>> = {
  titulo_fora_da_gramatica: 'o título não segue nenhuma das duas formas da casa',
  titulo_fora_da_forma: 'o título é legível, mas não está escrito na forma canônica',
  sem_responsavel: 'o título não diz quem conduz',
  responsavel_fora_da_lista: 'o responsável não é Rodrigo, Lucas, Pedro nem Todos',
  online_sem_meet: 'reunião online sem link do Meet',
};

export interface ConferenciaDoEvento {
  /** `ehReuniao`. Quando é `false`, o resto não se aplica e vem neutro. */
  reuniao: boolean;
  /** Reunião, título canônico, responsável válido e, se online, com Meet. */
  noPadrao: boolean;
  /** A leitura tolerante do título, ou `null` quando ele não cabe em forma nenhuma. */
  lido: ReuniaoDaAgenda | null;
  problemas: ProblemaDoPadrao[];
  /**
   * O conserto que a GRAMÁTICA sozinha garante, sem modelo nenhum: o título é
   * legível, cliente e responsável estão ESCRITOS nele e o responsável é um dos
   * quatro — falta só a forma canônica (acento, hífen, caixa) e/ou o Meet.
   * `null` quando consertar exigiria adivinhar alguma coisa.
   */
  conserto: { titulo: string; adicionarMeet: boolean } | null;
}

/** Os pedaços do título, como a leitura os separa. */
const partesDoTitulo = (titulo: string): string[] =>
  limpar(titulo).split(SEPARADOR_LIDO).map(limpar).filter(Boolean);

/**
 * O responsável foi ESCRITO no título, ou a leitura o completou?
 *
 * `lerTituloDeReuniao('Reunião Interna')` devolve `Todos` como responsável, e
 * está certo para MOSTRAR; para CONSERTAR, não: "Todos" ali é preenchimento, e
 * gravar `Reunião Interna - Todos` seria pôr no Google um dono que ninguém
 * declarou. Escrito = é o último pedaço do título.
 */
function responsavelEscrito(titulo: string, lido: ReuniaoDaAgenda): boolean {
  const partes = partesDoTitulo(titulo);
  if (partes.length < 2 || !lido.responsavel) return false;
  return normalizarParaAgenda(partes[partes.length - 1]) === normalizarParaAgenda(lido.responsavel);
}

/** A modalidade que o título declara (a interna só declara na variante antiga). */
const modalidadeDeclarada = (lido: ReuniaoDaAgenda): ModalidadeDeReuniao | null =>
  lido.tipo === 'cliente' ? lido.modalidade : (lido.modalidade ?? null);

/**
 * CONFERE UM EVENTO CONTRA O PADRÃO DA CASA.
 *
 * Não é reunião → `{ reuniao: false, noPadrao: true }`: fora do alcance do
 * vigia, e por isso "no padrão" do ponto de vista dele.
 */
export function conferirEvento(e: EventoParaConferir): ConferenciaDoEvento {
  if (!ehReuniao(e)) return { reuniao: false, noPadrao: true, lido: null, problemas: [], conserto: null };

  const titulo = limpar(e.titulo ?? '');
  const lido = lerTituloDeReuniao(titulo);
  if (!lido) {
    return { reuniao: true, noPadrao: false, lido: null, problemas: ['titulo_fora_da_gramatica'], conserto: null };
  }

  const problemas: ProblemaDoPadrao[] = [];
  const escrito = responsavelEscrito(titulo, lido);
  const responsavel = escrito ? responsavelDaAgenda(lido.responsavel) : null;
  if (!escrito) problemas.push('sem_responsavel');
  else if (!responsavel) problemas.push('responsavel_fora_da_lista');

  // A forma canônica com o responsável na grafia da casa. Sem responsável
  // válido não há forma canônica a comparar: o problema já foi dito acima.
  let canonico: string | null = null;
  if (responsavel) {
    try {
      canonico = montarTituloDeReuniao({ ...lido, responsavel } as ReuniaoDaAgenda);
    } catch {
      canonico = null;
    }
    if (canonico === null) problemas.push('titulo_fora_da_gramatica');
    else if (canonico !== titulo) problemas.push('titulo_fora_da_forma');
  }

  const online = modalidadeDeclarada(lido) === 'online';
  const semMeet = online && !String(e.meet ?? '').trim();
  if (semMeet) problemas.push('online_sem_meet');

  const so = (p: ProblemaDoPadrao) => p === 'titulo_fora_da_forma' || p === 'online_sem_meet';
  const conserto =
    problemas.length > 0 && canonico !== null && problemas.every(so)
      ? { titulo: canonico, adicionarMeet: semMeet }
      : null;

  return { reuniao: true, noPadrao: problemas.length === 0, lido, problemas, conserto };
}

/**
 * O TÍTULO PROPOSTO PASSA PELA GRAMÁTICA?
 *
 * É a peneira de toda proposta, venha ela do modelo ou de uma pessoa
 * respondendo a pendência: o título tem de ser lido por `lerTituloDeReuniao`,
 * ser exatamente o que `montarTituloDeReuniao` escreveria (forma canônica) e
 * ter um dos quatro responsáveis. O que não passa é descartado — nunca
 * "consertado" por aqui, porque consertar proposta é inventar uma segunda.
 */
export function conferirTituloProposto(
  titulo: string | null | undefined,
): { ok: true; reuniao: ReuniaoDaAgenda; titulo: string } | { ok: false; motivo: string } {
  const texto = limpar(titulo ?? '');
  if (!texto) return { ok: false, motivo: 'proposta vazia' };
  const lido = lerTituloDeReuniao(texto);
  if (!lido) return { ok: false, motivo: 'a proposta não segue nenhuma das duas formas da casa' };
  if (!responsavelEscrito(texto, lido)) return { ok: false, motivo: 'a proposta não diz quem conduz' };
  const responsavel = responsavelDaAgenda(lido.responsavel);
  if (!responsavel || responsavel !== lido.responsavel) {
    return { ok: false, motivo: 'o responsável da proposta não é Rodrigo, Lucas, Pedro nem Todos (na grafia da casa)' };
  }
  let canonico: string;
  try {
    canonico = montarTituloDeReuniao(lido);
  } catch (e) {
    return { ok: false, motivo: (e as Error).message };
  }
  if (canonico !== texto) return { ok: false, motivo: `a proposta não está na forma canônica ("${canonico}")` };
  // A interna não leva modalidade no título: a variante antiga não é forma de escrever.
  if (lido.tipo === 'interna' && lido.modalidade) return { ok: false, motivo: 'a interna não declara modalidade no título' };
  return { ok: true, reuniao: lido, titulo: canonico };
}

/* ----------------------------------------------------------------------------
 * O CONTRATO DA TELA `/agenda` — `GET /agenda/fora-do-padrao`
 * --------------------------------------------------------------------------*/

/**
 * Em que pé está a conferência de um evento fora do padrão:
 *   proposta       há um título no padrão esperando a porta (ou já na fila);
 *   pendencia      o vigia não teve proposta segura: uma pessoa escolhe o cliente;
 *   nao_e_reuniao  uma pessoa disse que não é reunião — o vigia não pergunta mais;
 *   resolvido      o evento voltou ao padrão (pela porta ou à mão) ou deixou de ser reunião.
 */
export type EstadoDaConferencia = 'proposta' | 'pendencia' | 'nao_e_reuniao' | 'resolvido';

/** De onde veio a proposta: da gramática sozinha, do modelo (AG-01) ou de uma pessoa. */
export type OrigemDaProposta = 'gramatica' | 'modelo' | 'pessoa';

export interface ItemForaDoPadrao {
  eventoId: string;
  tituloAtual: string;
  /** ISO, ou a data pura do evento de dia inteiro. */
  inicio: string | null;
  estado: EstadoDaConferencia;
  problemas: string[];
  tituloProposto: string | null;
  adicionarMeet: boolean;
  origem: OrigemDaProposta | null;
  /** A aprovação na fila (`/atendimento`), quando a proposta já foi à porta. */
  aprovacao: {
    id: string;
    /** `pendente` só enquanto não venceu; vencida aparece como `expirada`. */
    status: string;
    expiraEm: string;
    /** Quem propôs: o vigia (sistema) ou uma pessoa. Muda quem pode confirmar. */
    propostaPor: 'vigia' | 'pessoa';
  } | null;
  /** A pendência aberta, quando o vigia deixou a decisão para gente. */
  pendencia: {
    id: string;
    /** `pedeNome`: a opção "outro cliente", que manda o nome no complemento da resposta. */
    opcoes: Array<{ chave: string; rotulo: string; pedeNome?: boolean }>;
  } | null;
  atualizadoEm: string;
}

export interface ForaDoPadraoDaAgenda {
  itens: ItemForaDoPadrao[];
  /** O selo: quantas reuniões o vigia achou fora do padrão e ainda não resolvidas. */
  total: number;
  /** A última passagem que deixou registro no histórico da rotina (`agenda.vigia`). */
  ultimaPassagemEm: string | null;
  /** A rotina do vigia nesta empresa (nasce na primeira leitura desta lista). */
  rotina: { ativa: boolean; estado: string; dispara: boolean } | null;
}
