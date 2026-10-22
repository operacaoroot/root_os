import { z } from 'zod';

/*
 * O CARTÃO DA IMPLANTAÇÃO SABE MAIS (rodada de produção 2, M1, 22/10/2026)
 *
 * As sugestões 1 a 5 de `docs/comercial/SUGESTOES-IMPLANTACAO.md`, todas só
 * leitura, menos o limite por etapa (escrita de gente):
 *
 *   · S1 a próxima reunião do cliente, lida da Agenda pela porta (API);
 *   · S2 a etapa do card contra a fase do trilho ligado (o mapa mora aqui);
 *   · S3 "Pedir agora" em cada agente de "Quem trabalha nesta etapa";
 *   · S4 o limite de cartões de cada etapa pelo menu da coluna;
 *   · S5 o cartão "Implantação" no Dia a dia › Visão geral.
 *
 * PURO: sem relógio, sem rede, sem banco. A API e a tela fazem a mesma pergunta
 * ("este card está na fase certa do trilho?") e não podem responder diferente.
 */

/** As fases do trilho, na ordem (`OnboardingFase` do banco). `encerrado` fica fora da contagem "de 5". */
export const FASES_DO_TRILHO = ['qualificar', 'diagnostico', 'contrato', 'imersao', 'operacao'] as const;
export type FaseDoTrilho = (typeof FASES_DO_TRILHO)[number];
export type FaseDoTrilhoOuEncerrado = FaseDoTrilho | 'encerrado';

/** O nome curto de cada fase, como a bancada mostra (sem o número). */
export const NOME_DA_FASE_DO_TRILHO: Readonly<Record<FaseDoTrilho, string>> = {
  qualificar: 'Qualificar',
  diagnostico: 'Diagnóstico',
  contrato: 'Contrato e onboarding',
  imersao: 'Imersão',
  operacao: 'Operação assistida',
};

/** "fase 3 de 5": a posição de 1 a 5. Encerrado e desconhecido = nulo. */
export function numeroDaFase(fase: string | null | undefined): number | null {
  const i = (FASES_DO_TRILHO as readonly string[]).indexOf(String(fase ?? ''));
  return i >= 0 ? i + 1 : null;
}

/** A etapa comparável: minúscula, sem acento, espaço normalizado. */
export function chaveDaEtapa(nome: string | null | undefined): string {
  return String(nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/*
 * O MAPA ETAPA → FASE, escrito sobre as etapas REAIS do modelo
 * `onboarding-de-cliente` (`MODELOS_DE_LISTA` em `schemas.ts`), todas elas:
 *
 *   Fechado no comercial  → qualificar ou diagnostico (as fases anteriores: o
 *                           trilho nasce em Qualificar no fechamento, e o
 *                           diagnóstico pode já ter acontecido no comercial)
 *   Kickoff marcado       → contrato   (kickoff, ata, bancada e link, D-10 a D-1)
 *   Kit montado           → contrato   (o kit é preparo do kickoff para a imersão)
 *   Contexto carregado    → contrato   (o link B–D e a memória antes da imersão)
 *   Imersão               → imersao
 *   Operação assistida    → operacao
 *   Encerrado             → sem fase   (etapa de saída: nunca tem selo)
 *
 * Etapa que não está no mapa (lista editada, outra lista) não tem selo: o mapa
 * não adivinha. Mover o card ou o trilho sozinho NÃO é desta rodada.
 */
export const FASES_DA_ETAPA: Readonly<Record<string, readonly FaseDoTrilho[] | null>> = {
  'fechado no comercial': ['qualificar', 'diagnostico'],
  'kickoff marcado': ['contrato'],
  'kit montado': ['contrato'],
  'contexto carregado': ['contrato'],
  imersao: ['imersao'],
  'operacao assistida': ['operacao'],
  encerrado: null,
};

/**
 * As fases que a etapa aceita. `null` = etapa de saída (sem fase, sem selo);
 * `undefined` = etapa fora do mapa (sem selo também).
 */
export function fasesDaEtapa(etapa: string | null | undefined): readonly FaseDoTrilho[] | null | undefined {
  const chave = chaveDaEtapa(etapa);
  return Object.prototype.hasOwnProperty.call(FASES_DA_ETAPA, chave) ? FASES_DA_ETAPA[chave] : undefined;
}

export interface FaseDoCartao {
  /** A fase gravada no trilho ligado ao card. */
  fase: FaseDoTrilhoOuEncerrado;
  /** 1 a 5; nulo com o trilho encerrado. */
  numero: number | null;
  /** O card e o trilho divergem. */
  diverge: boolean;
  /** O selo do cartão ("fase do trilho: 3 de 5"); nulo quando não diverge. */
  selo: string | null;
  /** A frase do painel; nula quando não diverge. */
  frase: string | null;
}

/**
 * A ETAPA DO CARD CONTRA A FASE DO TRILHO. Nulo quando não há o que dizer: sem
 * trilho, etapa de saída ou etapa fora do mapa. Diverge quando a fase do trilho
 * não é uma das que a etapa aceita; "ainda" quando o trilho está atrás, "já"
 * quando está à frente.
 */
export function faseDoCartao(e: { etapa: string | null | undefined; faseDoTrilho: string | null | undefined }): FaseDoCartao | null {
  const fase = String(e.faseDoTrilho ?? '');
  if (!fase) return null;
  const aceitas = fasesDaEtapa(e.etapa);
  if (!aceitas) return null;
  const etapa = String(e.etapa ?? '').trim();
  if (fase === 'encerrado') {
    return { fase: 'encerrado', numero: null, diverge: true, selo: 'trilho encerrado', frase: `o card está em ${etapa} e o trilho já foi encerrado` };
  }
  const numero = numeroDaFase(fase);
  if (numero === null) return null;
  const f = fase as FaseDoTrilho;
  if (aceitas.includes(f)) return { fase: f, numero, diverge: false, selo: null, frase: null };
  const esperada = Math.min(...aceitas.map((a) => numeroDaFase(a) ?? 0));
  const tempo = numero < esperada ? 'ainda' : 'já';
  return {
    fase: f,
    numero,
    diverge: true,
    selo: `fase do trilho: ${numero} de ${FASES_DO_TRILHO.length}`,
    frase: `o card está em ${etapa} e o trilho ${tempo} na fase ${numero} de ${FASES_DO_TRILHO.length} (${NOME_DA_FASE_DO_TRILHO[f]})`,
  };
}

/* ----------------------------------------------------------------------------
 * S1 · a próxima reunião do cliente no cartão
 * -------------------------------------------------------------------------- */

/** Quantos dias à frente a leitura da agenda olha. */
export const DIAS_DA_AGENDA_DO_CARTAO = 14;

/** Como a leitura da agenda terminou nesta passagem. */
export type EstadoDaAgendaDoCartao = 'ok' | 'indisponivel' | 'sem-permissao';

/** A frase do painel quando a agenda não pôde ser lida. */
export const AGENDA_INDISPONIVEL = 'Agenda indisponível';
export const AGENDA_SEM_PERMISSAO = 'Sem permissão para ler a agenda';

export interface ProximaReuniaoDoCartao {
  /** ISO do início. Evento de dia inteiro vem à meia-noite de São Paulo. */
  inicio: string;
  diaInteiro: boolean;
  /** O título do evento, como está no Google. */
  titulo: string;
  /** Por onde o evento casou com o card. */
  casadoPor: 'email' | 'nome';
}

export interface ImplantacaoDoCartao {
  tarefaId: string;
  reuniao: ProximaReuniaoDoCartao | null;
  fase: FaseDoCartao | null;
}

export interface ImplantacaoDoQuadro {
  agenda: EstadoDaAgendaDoCartao;
  itens: ImplantacaoDoCartao[];
}

/* ----------------------------------------------------------------------------
 * S5 · o cartão "Implantação" no Dia a dia › Visão geral
 * -------------------------------------------------------------------------- */

/** Os filtros que a Implantação aceita no endereço (`?pendencia=`). */
export const PENDENCIAS_DA_IMPLANTACAO = ['sem-proximo-passo', 'passo-vencido', 'sem-reuniao'] as const;
export type PendenciaDaImplantacao = (typeof PENDENCIAS_DA_IMPLANTACAO)[number];

export const ROTULO_DA_PENDENCIA_DA_IMPLANTACAO: Readonly<Record<PendenciaDaImplantacao, { um: string; varios: string }>> = {
  'sem-proximo-passo': { um: 'cliente sem próximo passo', varios: 'clientes sem próximo passo' },
  'passo-vencido': { um: 'com passo vencido', varios: 'com passo vencido' },
  'sem-reuniao': { um: 'sem reunião marcada', varios: 'sem reunião marcada' },
};

export function ehPendenciaDaImplantacao(v: unknown): v is PendenciaDaImplantacao {
  return typeof v === 'string' && (PENDENCIAS_DA_IMPLANTACAO as readonly string[]).includes(v);
}

export interface ResumoDaImplantacao {
  /** Os cards abertos da lista da implantação (sem a etapa de saída). Nulo = a lista não existe. */
  cartoes: number | null;
  agenda: EstadoDaAgendaDoCartao;
  /** Os ids dos cards em cada pendência. `sem-reuniao` vazio quando a agenda não foi lida. */
  pendencias: Record<PendenciaDaImplantacao, string[]>;
}

/* ----------------------------------------------------------------------------
 * S3 · "Pedir agora" em cada agente de "Quem trabalha nesta etapa"
 * -------------------------------------------------------------------------- */

/** Onde cada agente é pedido hoje: a seção da bancada, o roteiro ou o kit no painel. */
export type FocoDoPedido = 'dossie' | 'ata' | 'roteiro' | 'kit';

export const FOCO_DO_AGENTE: Readonly<Record<string, FocoDoPedido>> = {
  'pesquisador-de-conta': 'dossie',
  'leitor-de-ata': 'ata',
  'roteirista-de-kickoff': 'roteiro',
  'montador-do-kit': 'kit',
};

/** As fases em que a bancada mostra cada seção sem pedido (fora delas, o pedido a abre mesmo assim). */
export const FASES_DE_COSTUME_DO_FOCO: Readonly<Record<'dossie' | 'ata', readonly FaseDoTrilho[]>> = {
  dossie: ['qualificar', 'diagnostico'],
  ata: ['contrato'],
};

export function ehFocoDaBancada(v: unknown): v is 'dossie' | 'ata' {
  return v === 'dossie' || v === 'ata';
}

export interface PedidoDoAgente {
  foco: FocoDoPedido;
  /** Para onde o botão leva. O kit mora no próprio painel (`#kit-da-implantacao`). */
  href: string;
  /** A razão do botão desabilitado; nulo = pode pedir. */
  desabilitado: string | null;
}

/**
 * O "PEDIR AGORA" de um agente: o atalho até onde ele é acionado hoje, com o
 * cliente (o trilho) já escolhido. Desabilitado, com a razão, quando o agente
 * está desligado no cadastro ou parado no banco, quando o trilho acabou ou
 * quando quem olha não pode editar tarefas. Agente sem foco conhecido = nulo.
 */
export function pedidoDoAgente(
  a: { slug: string; estado: string; estadoDeclarado?: string | null },
  trilho: { id: string; fase: string },
  podeEditar: boolean,
): PedidoDoAgente | null {
  const foco = FOCO_DO_AGENTE[a.slug];
  if (!foco) return null;
  const id = encodeURIComponent(trilho.id);
  const href = foco === 'kit'
    ? '#kit-da-implantacao'
    : foco === 'roteiro'
      ? `/onboarding/${id}/roteiro?foco=personalizar`
      : `/onboarding/${id}?foco=${foco}`;
  let desabilitado: string | null = null;
  if (a.estadoDeclarado === 'desligado') desabilitado = 'Desligado no cadastro de agentes: ligue antes de pedir.';
  else if (a.estadoDeclarado === 'aposentado') desabilitado = 'Aposentado no cadastro de agentes.';
  else if (a.estado === 'pausado' || a.estado === 'encerrado' || a.estado === 'planejado') desabilitado = `Está ${a.estado} em Agentes: ligue antes de pedir.`;
  else if (trilho.fase === 'encerrado') desabilitado = 'O trilho deste cliente está encerrado.';
  else if (!podeEditar) desabilitado = 'Pedir exige a permissão de editar tarefas.';
  return { foco, href, desabilitado };
}

/* ----------------------------------------------------------------------------
 * S4 · o limite de cartões da etapa, pelo menu da coluna
 * -------------------------------------------------------------------------- */

/** O teto que o editor de etapas já aceita (1 a 99). */
export const LIMITE_MAXIMO_DA_ETAPA = 99;

const limiteDaEtapa = z.number().int().min(1).max(LIMITE_MAXIMO_DA_ETAPA).nullable();

/**
 * `PATCH /trabalho/statuses/:id/limite`: o limite novo (nulo = sem limite) e o
 * que a tela leu (`esperado`). Se o limite mudou desde a leitura, 409.
 */
export const TrabLimiteDaEtapaSchema = z.object({
  limite: limiteDaEtapa,
  esperado: limiteDaEtapa,
}).strict();
export type TrabLimiteDaEtapaInput = z.infer<typeof TrabLimiteDaEtapaSchema>;

export interface TrabLimiteDaEtapaResultado {
  statusId: string;
  limite: number | null;
}

export const LIMITE_MUDOU_NO_MEIO = 'O limite desta etapa mudou desde que a tela foi lida. Recarregue e tente de novo.';
export const LIMITE_SO_DE_GENTE = 'Definir o limite de uma etapa é de gente: conta de máquina não faz.';
