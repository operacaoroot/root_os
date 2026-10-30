/*
 * ============================================================================
 * A AGENDA V2 — o contrato (rodada da Agenda v2, 29/10/2026, lane G0)
 * ============================================================================
 *
 * Tipos que a API, a tela e o link público trocam, mais a gramática nova
 * (Fechado, Fora, Pessoal, feriado). As decisões que este arquivo serve estão em
 * `docs/AGENDA.md`, seção "A agenda v2":
 *
 *   1. O Google continua sendo A agenda. O OS guarda um ESPELHO só de leitura
 *      (`AgendaEvento`), atualizado por sincronia incremental; ninguém o edita.
 *   2. Marcar pela tela sai no clique (R2 com desfazer implementado), só para
 *      gente na tela; agente, rotina, WhatsApp e link público seguem pela fila.
 *   3. A agenda pessoal de cada sócio entra como "Fechado <Nome>", lida pelo
 *      freeBusy do Google, sem título.
 *
 * PURO: sem relógio, sem rede, sem banco. A régua (`agenda-regua.ts`) e o
 * intérprete de frase (`agenda-frase.ts`) moram ao lado e usam estes tipos.
 */

import {
  lerTituloDeReuniao,
  montarTituloDeReuniao,
  normalizarParaAgenda,
  responsavelDaAgenda,
  RESPONSAVEL_TODOS,
  type ModalidadeDeReuniao,
} from './agenda.js';

/** O fuso da agenda da Root. Toda conta de dia e hora da régua é feita nele. */
export const AGENDA_FUSO = 'America/Sao_Paulo';

/** Os sócios da Root, na ordem das colunas e do filtro "Quem". */
export const SOCIOS_DA_AGENDA = ['Rodrigo', 'Lucas', 'Pedro'] as const;
export type SocioDaAgenda = (typeof SOCIOS_DA_AGENDA)[number];

/* ---------------------------------------------------------------------------
 * A gramática nova: o que não é reunião também tem forma.
 * ------------------------------------------------------------------------- */

/**
 * O tipo de um compromisso, lido do título (ou da origem, no Fechado da agenda
 * pessoal). `outro` é o que não coube em forma nenhuma: a tela o mostra cru e
 * o vigia decide se é reunião fora do padrão.
 */
export type TipoDeCompromisso = 'cliente' | 'interna' | 'fechado' | 'fora' | 'pessoal' | 'feriado' | 'outro';

/** Os tipos que o painel de marcar escreve. `fechado` = Bloqueio. */
export type TipoQueSeMarca = 'cliente' | 'interna' | 'bloqueio' | 'pessoal' | 'fora';

export interface LeituraDoCompromisso {
  tipo: TipoDeCompromisso;
  modalidade: ModalidadeDeReuniao | null;
  cliente: string | null;
  /** Os sócios envolvidos, na grafia canônica. `Todos` vira os três. */
  responsaveis: SocioDaAgenda[];
  /** O motivo do Fora (`Pedro Fora - viagem` → `viagem`). */
  motivo: string | null;
  /** O nome do feriado, quando o título é exatamente o de um feriado conhecido. */
  feriado: string | null;
}

const limpar = (v: string): string => v.replace(/\s+/g, ' ').trim();
const SEPARADOR_LIDO = /\s+[-–—]\s+/;

const socio = (nome: string | null | undefined): SocioDaAgenda | null => {
  const r = responsavelDaAgenda(nome);
  return r && r !== RESPONSAVEL_TODOS ? (r as SocioDaAgenda) : null;
};

/** `Todos` → os três; um sócio → ele; o resto → ninguém. */
export function sociosDoResponsavel(nome: string | null | undefined): SocioDaAgenda[] {
  const r = responsavelDaAgenda(nome);
  if (r === RESPONSAVEL_TODOS) return [...SOCIOS_DA_AGENDA];
  const s = socio(nome);
  return s ? [s] : [];
}

/**
 * Lê qualquer título da agenda da Root. Tolerante, como `lerTituloDeReuniao`:
 *   `Reunião …`                → cliente / interna (a gramática de sempre)
 *   `Fechado Rodrigo`          → fechado (bloqueio)
 *   `Pedro Fora - viagem`      → fora (o motivo é obrigatório na escrita, opcional na leitura)
 *   `Pessoal - Lucas`          → pessoal ("Pessoal" por palavra inteira: "Pessoalmente" não é)
 *   `Finados`                  → feriado, só pelo NOME EXATO de um feriado conhecido
 * `feriadosConhecidos` vem da tabela `Feriado` (ou de `feriadosDoAno`); sem ela,
 * nenhum título vira feriado — nunca por sufixo ("Reunião pós-Finados" é reunião).
 */
export function lerCompromisso(
  titulo: string | null | undefined,
  feriadosConhecidos: readonly string[] = [],
): LeituraDoCompromisso {
  const vazio: LeituraDoCompromisso = {
    tipo: 'outro', modalidade: null, cliente: null, responsaveis: [], motivo: null, feriado: null,
  };
  const texto = limpar(titulo ?? '');
  if (!texto) return vazio;

  const reuniao = lerTituloDeReuniao(texto);
  if (reuniao) {
    return {
      ...vazio,
      tipo: reuniao.tipo,
      modalidade: reuniao.modalidade ?? null,
      cliente: reuniao.tipo === 'cliente' ? reuniao.cliente : null,
      responsaveis: sociosDoResponsavel(reuniao.responsavel),
    };
  }

  const n = normalizarParaAgenda(texto);

  // Fechado <Nome>
  const fechado = /^fechado\s+(.+)$/.exec(n);
  if (fechado) {
    const s = socio(fechado[1]);
    if (s) return { ...vazio, tipo: 'fechado', responsaveis: [s] };
  }

  // <Nome> Fora[ - motivo]
  const partes = texto.split(SEPARADOR_LIDO).map(limpar).filter(Boolean);
  const fora = /^(.+?)\s+fora$/.exec(normalizarParaAgenda(partes[0] ?? ''));
  if (fora) {
    const s = socio(fora[1]);
    if (s) return { ...vazio, tipo: 'fora', responsaveis: [s], motivo: partes.slice(1).join(' - ') || null };
  }

  // Pessoal - <Nome> (palavra inteira)
  if (normalizarParaAgenda(partes[0] ?? '') === 'pessoal') {
    const s = socio(partes[1]);
    return { ...vazio, tipo: 'pessoal', responsaveis: s ? [s] : [] };
  }

  // Feriado: o nome EXATO.
  const feriado = feriadosConhecidos.find((f) => normalizarParaAgenda(f) === n);
  if (feriado) return { ...vazio, tipo: 'feriado', feriado };

  return vazio;
}

export interface CompromissoParaTitulo {
  tipo: TipoQueSeMarca;
  modalidade?: ModalidadeDeReuniao;
  cliente?: string;
  /** Os sócios que vão. O título leva o primeiro, ou `Todos` quando vão os três. */
  responsaveis: string[];
  /** Só no Fora. */
  motivo?: string;
}

/**
 * O título de qualquer compromisso que o OS escreve. ESTRITA: lança quando falta
 * o que a forma exige. A tela e o servidor chamam a mesma função.
 */
export function montarTituloDeCompromisso(c: CompromissoParaTitulo): string {
  const socios = c.responsaveis.map(socio).filter((s): s is SocioDaAgenda => !!s);
  const unicos = [...new Set(socios)];
  if (unicos.length === 0) throw new Error('Escolha quem vai (um sócio, ou os três).');
  const responsavel = unicos.length === SOCIOS_DA_AGENDA.length ? RESPONSAVEL_TODOS : unicos[0];
  const um = unicos[0];

  switch (c.tipo) {
    case 'cliente':
      return montarTituloDeReuniao({
        tipo: 'cliente',
        modalidade: c.modalidade ?? 'online',
        cliente: c.cliente ?? '',
        responsavel,
      });
    case 'interna':
      return montarTituloDeReuniao({ tipo: 'interna', responsavel });
    case 'bloqueio':
      if (unicos.length !== 1) throw new Error('Bloqueio é de uma pessoa só.');
      return `Fechado ${um}`;
    case 'pessoal':
      if (unicos.length !== 1) throw new Error('Compromisso pessoal é de uma pessoa só.');
      return `Pessoal - ${um}`;
    case 'fora': {
      if (unicos.length !== 1) throw new Error('Fora é de uma pessoa só.');
      const motivo = limpar(c.motivo ?? '');
      if (!motivo) throw new Error('Diga o motivo do Fora (viagem, férias, curso…).');
      return `${um} Fora - ${motivo}`;
    }
  }
}

/* ---------------------------------------------------------------------------
 * O espelho (G1)
 * ------------------------------------------------------------------------- */

export type RespostaDoConvidado = 'aceito' | 'recusado' | 'talvez' | 'pendente';

export interface ConvidadoDoEvento {
  email: string;
  nome?: string | null;
  organizador?: boolean;
  opcional?: boolean;
  resposta: RespostaDoConvidado;
}

export type StatusDoEvento = 'confirmado' | 'provisorio' | 'cancelado';

/** De onde a linha veio: a agenda da Root ou o livre/ocupado da agenda pessoal de um sócio. */
export type OrigemDoEvento = 'google' | 'livre_ocupado';

/** Uma linha do espelho, como a tela, a régua e o link a recebem. */
export interface EventoDaAgenda {
  /** O id do Google (`origem: google`) ou uma chave estável do intervalo (`livre_ocupado`). */
  id: string;
  /** `primary` (a agenda da Root) ou o e-mail da agenda pessoal. */
  agenda: string;
  origem: OrigemDoEvento;
  /** Nulo no Fechado da agenda pessoal: o OS nunca vê o título dela. */
  titulo: string | null;
  inicio: string;
  fim: string;
  diaInteiro: boolean;
  local: string | null;
  meet: string | null;
  convidados: ConvidadoDoEvento[];
  organizador: string | null;
  organizadorEhAgenda: boolean;
  status: StatusDoEvento;
  atualizadoNoGoogle: string | null;
  /** O evento de origem da série (`recurringEventId`), para agrupar nos Conflitos. */
  serieId: string | null;
  /** Criado pelo OS (propriedade privada do evento no Google). */
  criadoPeloOs: boolean;
  /** O `htmlLink` do Google. */
  link: string | null;
  /** A descrição do evento (até 8 mil caracteres), quando quem leu pediu (o vigia AG-01, o detalhe). Nulo no Fechado. */
  descricao?: string | null;
  leitura: LeituraDoCompromisso;
  /**
   * As propriedades privadas que o OS grava (`PROPRIEDADES_DO_OS`), copiadas de
   * `AgendaEvento.propriedades`. Opcional (lane B, 29/10): sem ela, quem precisa
   * (Conflitos, Relatórios) lê a coluna do espelho pelo id.
   */
  propriedades?: Record<string, string>;
}

export interface EstadoDaSincronia {
  /** Última passagem que terminou bem (ISO), ou nulo se nunca houve. */
  ultimaPassagem: string | null;
  /** A última passagem falhou com isto. */
  erro: string | null;
  /** Mais de 10 min sem passagem: a tela avisa e cai na leitura direta. */
  atrasada: boolean;
}

/**
 * As propriedades PRIVADAS (`extendedProperties.private`) que o OS grava no evento
 * do Google quando escreve, e que a sincronia copia para `AgendaEvento.propriedades`.
 * É por elas que a tela, os Conflitos e os Relatórios sabem o que o OS criou, o que
 * foi "marcado assim mesmo" (e por quê) e o que foi "confirmado com o cliente".
 */
export const PROPRIEDADES_DO_OS = {
  /** `'1'` = o OS criou o evento (o `desmarcar` só cancela estes). */
  criadoPeloOs: 'mktos',
  /** A chave do pedido que criou o evento (idempotência). */
  chave: 'mktosChave',
  /** O motivo do "marcar assim mesmo" (a régua deu vermelho). */
  forcado: 'mktosForcado',
  /** Quem pediu (id do usuário no OS), para o histórico e o relatório. */
  pedidoPor: 'mktosPedidoPor',
  /** `'1'` = choque conhecido, "confirmado com o cliente" nos Conflitos. */
  confirmadoComCliente: 'mktosConfirmado',
  leadId: 'mktosLeadId',
  clienteId: 'mktosClienteId',
  /** O tipo que o OS escreveu (`cliente`, `interna`, `bloqueio`, `pessoal`, `fora`). */
  tipo: 'mktosTipo',
  /**
   * A chave do ÚLTIMO pedido que o OS aplicou no evento (lane G4): o mesmo pedido
   * repetido (alterar, cancelar, desmarcar, reabrir) devolve o que já saiu em vez
   * de recusar por "o evento mudou".
   */
  ultimaEscrita: 'mktosUltimaChave',
} as const;

/** O limite de atraso do espelho antes de a tela cair na leitura direta. */
export const AGENDA_ESPELHO_ATRASO_MAXIMO_MS = 10 * 60_000;
/** A janela que a sincronia completa refaz (dias antes e depois de hoje). */
export const AGENDA_JANELA_DIAS = { antes: 30, depois: 180 } as const;

/** `GET /agenda/espelho?de=&ate=` */
export interface RespostaDoEspelho {
  eventos: EventoDaAgenda[];
  sincronia: EstadoDaSincronia;
  /** `espelho` normalmente; `google` quando o espelho está atrasado e a leitura foi direta. */
  fonte: 'espelho' | 'google';
}

/* ---------------------------------------------------------------------------
 * As regras (G2)
 * ------------------------------------------------------------------------- */

/** `HH:MM`, 24 h. */
export type HoraDoDia = string;

export interface BloqueioFixo {
  /** 0 = domingo … 6 = sábado. */
  diaDaSemana: number;
  inicio: HoraDoDia;
  /** Sem fim = até o fim do dia. */
  fim?: HoraDoDia | null;
}

export interface RegraDaPessoa {
  id: string;
  nome: SocioDaAgenda;
  /** A área que a tela mostra embaixo do nome ("onboarding e contrato"). */
  area: string | null;
  /** E-mail do sócio no OS (convite e Equipe). */
  email: string | null;
  janela: { inicio: HoraDoDia; fim: HoraDoDia };
  intervaloMin: number;
  trajetoMin: number;
  tetoPorDia: number;
  bloqueiosFixos: BloqueioFixo[];
  /** E-mail da agenda pessoal lida como livre/ocupado (decisão 3). Opcional. */
  emailPessoal: string | null;
  fechadoLigado: boolean;
  substituto: SocioDaAgenda | null;
}

export type PoliticaDoRito = 'pergunta' | 'bloqueia';

export interface RitoDaAgenda {
  id: string;
  nome: string;
  /** O título no Google (`Reunião Interna - Todos`). */
  titulo: string;
  diaDaSemana: number;
  /** 1 = primeiro do mês (`1º sábado`); nulo = toda semana. */
  ordinalNoMes: number | null;
  /** Nulo = dia inteiro. */
  inicio: HoraDoDia | null;
  duracaoMin: number;
  /** `Todos` ou um sócio. */
  quem: string;
  politica: PoliticaDoRito;
  ligado: boolean;
  /** Horário semeado sem fonte que o confirme: a tela marca `[a decidir]`. */
  aDecidir: boolean;
}

export type TipoDeFeriado = 'nacional' | 'facultativo' | 'municipal';

export interface FeriadoDaAgenda {
  id: string;
  /** `AAAA-MM-DD`. */
  data: string;
  nome: string;
  tipo: TipoDeFeriado;
  cidade: string | null;
  /** Facultativo nasce desligado: ligado, ele avisa (nunca fecha). */
  ligado: boolean;
}

export interface RegraEmTexto {
  id: string;
  frase: string;
  ligada: boolean;
}

/** `GET /agenda/regras` */
export interface RegrasDaAgenda {
  pessoas: RegraDaPessoa[];
  ritos: RitoDaAgenda[];
  feriados: FeriadoDaAgenda[];
  textos: RegraEmTexto[];
  /** Quem lê pode editar? (`agenda.regras`) */
  podeEditar: boolean;
}

/* ---------------------------------------------------------------------------
 * A régua (G2) — entrada e saída do motor puro de `agenda-regua.ts`
 * ------------------------------------------------------------------------- */

export interface CompromissoProposto {
  tipo: TipoQueSeMarca;
  modalidade?: ModalidadeDeReuniao | null;
  responsaveis: SocioDaAgenda[];
  inicio: string;
  fim: string;
  /** Ao editar, arrastar ou esticar: o próprio evento fica fora da conta. */
  ignorarEventoId?: string | null;
}

export type CorDaRegua = 'verde' | 'amarelo' | 'vermelho';
export type NivelDoItemDaRegua = 'ok' | 'atencao' | 'bloqueio';

export type CodigoDaRegra =
  | 'livre'
  | 'janela'
  | 'intervalo'
  | 'trajeto'
  | 'teto'
  | 'bloqueio_fixo'
  | 'fechado'
  | 'fora'
  | 'feriado'
  | 'feriado_facultativo'
  | 'rito'
  | 'choque'
  | 'meet';

export interface ItemDaRegua {
  nivel: NivelDoItemDaRegua;
  regra: CodigoDaRegra;
  frase: string;
  pessoa?: SocioDaAgenda;
  /** O evento que causou o item (choque, intervalo, rito). */
  eventoId?: string;
}

export interface ResultadoDaRegua {
  cor: CorDaRegua;
  itens: ItemDaRegua[];
}

export interface HorarioSugerido {
  inicio: string;
  fim: string;
}

/** O que o link público mostra de um dia: só horários (sem título, sem quem). */
export interface DiaLivre {
  /** `AAAA-MM-DD`. */
  dia: string;
  manha: HoraDoDia[];
  tarde: HoraDoDia[];
}

/* ---------------------------------------------------------------------------
 * Conflitos e relatórios (G5)
 * ------------------------------------------------------------------------- */

export type TipoDeConflito = 'choque' | 'padrao' | 'sem_meet' | 'rito' | 'feriado' | 'janela' | 'fora' | 'teto';

export interface AcaoDoConflito {
  rotulo: string;
  /** O pedido que o botão manda a `POST /agenda/escritas`; nulo = ação só da tela (abrir o painel). */
  pedido: PedidoDeEscrita | null;
  /** `remarcar` abre o painel de editar; `nao_e_reuniao`/`aplicar_titulo` vão ao vigia. */
  tipo:
    | 'empurrar'
    | 'passar'
    | 'remarcar'
    | 'criar_meet'
    | 'trocar_modalidade'
    | 'aplicar_titulo'
    | 'nao_e_reuniao'
    | 'confirmado_com_cliente'
    | 'levar_para_dia_util'
    | 'pular_ocorrencia'
    | 'manter';
  /**
   * As ações que não são escrita na agenda (`aplicar_titulo` e `nao_e_reuniao`,
   * do vigia AG-01): a rota que o botão chama, com o corpo pronto. Opcional
   * (lane B, 29/10). `pedido` e `rota` nunca vêm juntos.
   */
  rota?: { metodo: 'POST'; caminho: string; corpo?: Record<string, unknown> } | null;
}

export interface CartaoDeConflito {
  id: string;
  tipo: TipoDeConflito;
  /** Menor = mais urgente (minutos até o início, com peso por tipo). */
  urgencia: number;
  quando: string;
  pessoas: SocioDaAgenda[];
  titulo: string;
  frase: string;
  eventos: Array<{ id: string; titulo: string | null; inicio: string; fim: string }>;
  acoes: AcaoDoConflito[];
  serieId: string | null;
  /** Já marcado "confirmado com o cliente": continua na lista, sem alarme. */
  confirmado: boolean;
}

/** `GET /agenda/conflitos?dias=60` */
export interface RespostaDosConflitos {
  cartoes: CartaoDeConflito[];
  /** A última passagem do vigia AG-01 (ISO), para o selo do topo. */
  vigiaPassouEm: string | null;
  contagem: Record<TipoDeConflito | 'tudo', number>;
}

/** `GET /agenda/relatorios?de=&ate=` */
export interface RelatorioDaAgenda {
  de: string;
  ate: string;
  porSocio: Array<{ socio: SocioDaAgenda; total: number; porTipo: Partial<Record<TipoDeCompromisso, number>> }>;
  porTipo: Partial<Record<TipoDeCompromisso, number>>;
  semMeet: Array<{ id: string; titulo: string | null; inicio: string }>;
  responsavelSemEmail: SocioDaAgenda[];
  marcadosAssimMesmo: Array<{ eventoId: string; titulo: string | null; inicio: string; motivo: string; quem: string | null; quando: string }>;
  /** Só contagem: marcar direto no Google é a redundância da casa, não é erro. */
  criadosDiretoNoGoogle: number;
}

/* ---------------------------------------------------------------------------
 * A escrita no Google (G4)
 * ------------------------------------------------------------------------- */

export interface NovoCompromisso {
  tipo: TipoQueSeMarca;
  modalidade: ModalidadeDeReuniao;
  cliente?: string;
  leadId?: string;
  clienteId?: string;
  responsaveis: SocioDaAgenda[];
  inicio: string;
  fim: string;
  local?: string;
  pauta?: string;
  /** E-mails de fora (o cliente). Os dos responsáveis vêm da Equipe. */
  convidados?: string[];
  /** Só no Fora. */
  motivo?: string;
}

/** O retrato do que muda num alterar: o efeito confere `antes` contra o Google. */
export interface RetratoDoCompromisso {
  titulo: string;
  inicio: string;
  fim: string;
  local: string | null;
  meet: boolean;
}

export type PedidoDeEscrita =
  | { acao: 'marcar'; chave: string; compromisso: NovoCompromisso; forcado?: { motivo: string } }
  | {
      acao: 'alterar';
      chave: string;
      eventoId: string;
      antes: RetratoDoCompromisso;
      /** O que muda. `titulo` nunca vem pronto: sai da gramática pelos campos. */
      depois: {
        inicio?: string;
        fim?: string;
        modalidade?: ModalidadeDeReuniao;
        responsaveis?: SocioDaAgenda[];
        tipo?: TipoQueSeMarca;
        cliente?: string;
        local?: string | null;
        criarMeet?: boolean;
        /** "Confirmado com o cliente": marca no evento, sem mexer no horário. */
        confirmadoComCliente?: boolean;
      };
      forcado?: { motivo: string };
    }
  | { acao: 'cancelar'; chave: string; eventoId: string; tituloAtual: string; motivo: string; avisar: boolean }
  | { acao: 'desmarcar'; chave: string; eventoId: string; tituloAtual: string }
  | { acao: 'reabrir'; chave: string; eventoId: string; tituloAtual: string };

export type StatusDaEscrita = 'executado' | 'aguardando_aprovacao' | 'recusado';

/** `POST /agenda/escritas` */
export interface ResultadoDaEscrita {
  status: StatusDaEscrita;
  /** O nível que a régua deu. */
  nivel: string;
  eventoId: string | null;
  approvalId: string | null;
  /** Retido: quem confirma? (`true` = outra pessoa, porque quem pediu não assina). */
  precisaDeOutraPessoa: boolean;
  mensagem: string;
  /** O pedido que desfaz o que acabou de sair, quando existe. */
  desfazer: PedidoDeEscrita | null;
  /** A régua deu vermelho e não veio `forcado`: nada foi enviado. */
  regua?: ResultadoDaRegua;
  /** Responsáveis sem e-mail na Equipe: o convite saiu sem eles (lane G4). */
  responsaveisSemEmail?: SocioDaAgenda[];
}

/** Uma linha do histórico (`GET /agenda/historico`), lida do RASTRO da porta. */
export interface LinhaDoHistorico {
  id: string;
  quando: string;
  quem: string | null;
  /** `marcou`, `alterou`, `cancelou`, `desmarcou`, `reabriu`, `padronizou`, `restaurou`. */
  verbo: string;
  capacidade: string;
  eventoId: string | null;
  titulo: string | null;
  status: 'executado' | 'aguardando_aprovacao' | 'recusado' | 'erro';
  forcado: { motivo: string } | null;
  desfazer: PedidoDeEscrita | null;
}

/** Capacidades da agenda v2 (o catálogo em `packages/policy/politica-marketing-os.json`). */
export const CAPACIDADES_DA_AGENDA = {
  sincronizar: 'comunicacao.agenda.sincronizar',
  livreOcupado: 'comunicacao.agenda.livre_ocupado',
  marcar: 'agenda.reuniao.marcar',
  alterar: 'agenda.reuniao.alterar',
  cancelar: 'agenda.reuniao.cancelar',
  desmarcar: 'agenda.reuniao.desmarcar',
  reabrir: 'agenda.reuniao.reabrir',
} as const;

/* ---------------------------------------------------------------------------
 * O link de escolha (G6)
 * ------------------------------------------------------------------------- */

/** `POST /agenda/convites` */
export interface NovoConviteDeAgenda {
  socio: SocioDaAgenda;
  tipo: 'cliente' | 'interna';
  modalidade: ModalidadeDeReuniao;
  duracaoMin: number;
  leadId?: string;
  clienteId?: string;
  /** Dias de validade (padrão 7, até 30). */
  validadeDias?: number;
}

/** `GET /api/agendar/:token` — o que a página pública vê. Nada da agenda além de horários. */
export interface EstadoDoConvitePublico {
  socio: SocioDaAgenda;
  modalidade: ModalidadeDeReuniao;
  duracaoMin: number;
  /** O primeiro nome do lead, quando o convite tem lead. */
  nome: string | null;
  emailObrigatorio: boolean;
  dias: DiaLivre[];
  validoAte: string;
  /** Já usado: a página mostra o que foi escolhido. */
  escolhido: { inicio: string; fim: string } | null;
}

/** `POST /api/agendar/:token/confirmar` */
export interface ConfirmacaoDoConvite {
  dia: string;
  hora: HoraDoDia;
  email?: string;
  nome?: string;
}
