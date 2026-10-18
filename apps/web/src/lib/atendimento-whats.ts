/*
 * As contas da tela de atendimento do WhatsApp do comercial (lane P6, rodada
 * do painel). Só forma: quem aparece na lista com a busca e os filtros, a
 * prévia de uma linha, o corte da mensagem comprida e a marca de "nova".
 * Nada aqui fala com a API nem decide o que sai para o lead.
 */
import type { ListaDeCelulares, MensagemNoCelular } from '@mktos/shared';
import { COMERCIAL_ROTULO_DA_ETAPA } from '@mktos/shared';

export type LeadDaLista = ListaDeCelulares['leads'][number];

/** O filtro de estado da lista: todos, só quem tem mensagem esperando liberação, ou sem nada na fila. */
export type FiltroDeEstado = 'todos' | 'na_fila' | 'sem_fila';

export const FILTROS_DE_ESTADO: { chave: FiltroDeEstado; rotulo: string }[] = [
  { chave: 'todos', rotulo: 'estado: todos' },
  { chave: 'na_fila', rotulo: 'com fila' },
  { chave: 'sem_fila', rotulo: 'sem fila' },
];

/** Sem acento e em minúsculas, para a busca casar "joão" com "joao". */
export function normalizarBusca(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function rotuloDaEtapa(etapa: string | null | undefined): string {
  if (!etapa) return 'sem etapa';
  return COMERCIAL_ROTULO_DA_ETAPA[etapa as keyof typeof COMERCIAL_ROTULO_DA_ETAPA] ?? etapa;
}

/**
 * A lista que a coluna mostra: busca por nome ou telefone (só os dígitos
 * contam no telefone), filtro por etapa e por estado, e a conversa mais
 * recente em cima. Quem não tem hora fica no fim, na ordem em que veio.
 */
export function filtrarConversas(
  leads: LeadDaLista[],
  { busca = '', etapa = '', estado = 'todos' }: { busca?: string; etapa?: string; estado?: FiltroDeEstado },
): LeadDaLista[] {
  const termo = normalizarBusca(busca);
  const digitos = busca.replace(/\D/g, '');
  return leads
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => {
      if (etapa && (l.etapa ?? '') !== etapa) return false;
      if (estado === 'na_fila' && !(l.naFila > 0)) return false;
      if (estado === 'sem_fila' && l.naFila > 0) return false;
      if (!termo) return true;
      if (normalizarBusca(l.nome).includes(termo)) return true;
      return digitos.length >= 2 && (l.telefone ?? '').includes(digitos);
    })
    .sort((a, b) => {
      const ta = a.l.ultimaEm ? Date.parse(a.l.ultimaEm) : NaN;
      const tb = b.l.ultimaEm ? Date.parse(b.l.ultimaEm) : NaN;
      if (Number.isNaN(ta) && Number.isNaN(tb)) return a.i - b.i;
      if (Number.isNaN(ta)) return 1;
      if (Number.isNaN(tb)) return -1;
      return tb - ta || a.i - b.i;
    })
    .map(({ l }) => l);
}

/** As etapas que aparecem na lista agora, na ordem do funil, para o seletor de filtro. */
export function etapasPresentes(leads: LeadDaLista[]): string[] {
  const ordem = Object.keys(COMERCIAL_ROTULO_DA_ETAPA);
  const tem = new Set(leads.map((l) => l.etapa).filter((e): e is NonNullable<typeof e> => !!e));
  return ordem.filter((e) => tem.has(e as never));
}

/** A prévia de uma linha: a última mensagem, sem quebra de linha, com quem falou. */
export function previaDaMensagem(m: Pick<MensagemNoCelular, 'direcao' | 'texto'> | null | undefined, limite = 120): string {
  if (!m) return '';
  const limpo = m.texto.replace(/\s+/g, ' ').trim();
  const corpo = limpo.length > limite ? `${limpo.slice(0, limite - 1).trimEnd()}…` : limpo;
  return m.direcao === 'saida' ? `casa: ${corpo}` : corpo;
}

/** Mensagem comprida aparece cortada até a pessoa pedir o resto (a mensagem inteira continua no `title` do botão). */
export const LIMITE_DA_MENSAGEM_RECOLHIDA = 700;

export function textoRecolhido(texto: string, limite = LIMITE_DA_MENSAGEM_RECOLHIDA): { texto: string; cortado: boolean } {
  if (texto.length <= limite) return { texto, cortado: false };
  return { texto: `${texto.slice(0, limite).trimEnd()}…`, cortado: true };
}

/**
 * "Nova" é a conversa que mexeu depois da última vez que esta pessoa a abriu
 * neste navegador. A API não conta mensagens não lidas; isto é só a marca
 * local. Sem registro nenhum (primeira visita), nada aparece como novo.
 */
export type VistoPorLead = Record<string, string>;

export function temNovidade(l: Pick<LeadDaLista, 'leadId' | 'ultimaEm'>, visto: VistoPorLead | null): boolean {
  if (!visto || !l.ultimaEm) return false;
  const antes = visto[l.leadId];
  if (!antes) return false;
  return Date.parse(l.ultimaEm) > Date.parse(antes);
}

/** O registro inicial: quem já está na lista na primeira visita conta como visto. */
export function vistoInicial(leads: LeadDaLista[]): VistoPorLead {
  const v: VistoPorLead = {};
  for (const l of leads) if (l.ultimaEm) v[l.leadId] = l.ultimaEm;
  return v;
}

/** Quem entrou na lista depois da primeira visita começa como visto até mexer. */
export function completarVisto(visto: VistoPorLead, leads: LeadDaLista[]): VistoPorLead {
  let mudou = false;
  const v = { ...visto };
  for (const l of leads) {
    if (l.ultimaEm && !v[l.leadId]) {
      v[l.leadId] = l.ultimaEm;
      mudou = true;
    }
  }
  return mudou ? v : visto;
}

/** Hora curta de São Paulo para a lista: só HH:MM se for hoje, senão DD/MM. */
export function horaDaLista(iso: string | null | undefined, agora: Date = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dia = (x: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(x);
  if (dia(d) === dia(agora)) return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return dia(d);
}
