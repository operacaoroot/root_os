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
