/*
 * O COCKPIT DO COMERCIAL: o que as telas internas calculam sozinhas (lane C, 13/10/2026).
 *
 * Só formatação, agrupamento e texto de estado. Nenhum número nasce aqui: o
 * que vem nulo da API aparece como AUSENTE, nunca como zero nem como palpite.
 * O horário vem em ISO com fuso e a tela mostra em São Paulo.
 */
import type {
  CartaoDoFunil,
  ComercialEtapa,
  ComercialFonte,
  ComercialMotivoDeSaida,
  ComercialProduto,
  ComercialTipoDeDecisao,
  FunilVivo,
  LinhaDoFio,
} from '@mktos/shared';

import { ErroDaApi } from './api';

const FUSO = 'America/Sao_Paulo';

/** A palavra que a tela escreve quando a API não tem o dado. */
export const AUSENTE = 'ausente';

const dd = (n: number) => n.toString().padStart(2, '0');

function partesSP(iso: string): { dia: number; mes: number; hora: number; minuto: number } | null {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const f = new Intl.DateTimeFormat('en-US', { timeZone: FUSO, month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: false });
  const p = Object.fromEntries(f.formatToParts(t).map((x) => [x.type, x.value]));
  return { dia: Number(p.day), mes: Number(p.month), hora: Number(p.hour) % 24, minuto: Number(p.minute) };
}

/** "09:13" em São Paulo. Vazio quando não há instante. */
export function horaSP(iso: string | null | undefined): string {
  if (!iso) return '';
  const p = partesSP(iso);
  return p ? `${dd(p.hora)}:${dd(p.minuto)}` : '';
}

/** "13/10" em São Paulo. */
export function diaSP(iso: string | null | undefined): string {
  if (!iso) return '';
  const p = partesSP(iso);
  return p ? `${dd(p.dia)}/${dd(p.mes)}` : '';
}

/** "13/10 09:13" em São Paulo. */
export function diaHoraSP(iso: string | null | undefined): string {
  if (!iso) return '';
  const p = partesSP(iso);
  return p ? `${dd(p.dia)}/${dd(p.mes)} ${dd(p.hora)}:${dd(p.minuto)}` : '';
}

/** Data só (AAAA-MM-DD, sem hora) como "17/11", sem passar pelo fuso. */
export function dataDoDia(data: string | null | undefined): string {
  if (!data) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  return m ? `${m[3]}/${m[2]}` : diaSP(data);
}

/** Uma distância de tempo em palavras: "35 min", "4 h", "2 dias". */
export function duracao(ms: number): string {
  const min = Math.max(0, Math.round(Math.abs(ms) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} dias`;
}

/**
 * A decisão nasceu sem prazo? Com `decisaoExpiraHoras` desligado ([a decidir]),
 * a API grava a sentinela 9999-12-31: ela não é prazo, e o padrão nunca vale
 * sozinho (C-2 da revisão).
 */
export function decisaoSemPrazo(expiraEm: string | null | undefined): boolean {
  if (!expiraEm) return true;
  const t = new Date(expiraEm).getTime();
  return !Number.isNaN(t) && new Date(t).getUTCFullYear() >= 9999;
}

/** Hora de São Paulo quando o instante é de hoje; dia e hora quando é de outro dia (C-6). */
export function quandoSP(iso: string | null | undefined, agora: Date = new Date()): string {
  if (!iso) return '';
  return diaSP(iso) === diaSP(agora.toISOString()) ? horaSP(iso) : diaHoraSP(iso);
}

/**
 * O custo de IA do dia na torre (C-5): reais quando a API mediu em reais; o
 * dólar quando só há dólar (sem câmbio decidido); "sem medida" para o stub, a
 * ponte (que gasta a assinatura do host) e a empresa sem livro-caixa.
 */
export function custoDaTorre(t: {
  custoDeIaHojeCentavos: number | null;
  custoDesconhecido: boolean;
  custoDeIaHojeUsd?: number | null;
  provedorDeIa?: string;
}): { valor: string; legenda: string } {
  const provedor = t.provedorDeIa ? ` · provedor ${t.provedorDeIa}` : '';
  if (t.provedorDeIa === 'stub' || t.provedorDeIa === 'ponte') {
    return { valor: 'sem medida', legenda: `custo de IA hoje${provedor}, sem preço conhecido` };
  }
  const parte = t.custoDesconhecido ? ', parte sem preço conhecido' : '';
  if (t.custoDeIaHojeCentavos != null) return { valor: reaisOuAusente(t.custoDeIaHojeCentavos), legenda: `custo de IA hoje${provedor}${parte}` };
  if (t.custoDeIaHojeUsd != null) {
    const usd = t.custoDeIaHojeUsd.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    return { valor: `US$ ${usd}`, legenda: `custo de IA hoje em dólar (câmbio [a decidir])${provedor}${parte}` };
  }
  return { valor: 'sem medida', legenda: `custo de IA hoje${provedor}: empresa sem teto, o gasto não é medido` };
}

/** O prazo de uma decisão: "expira em 4 h", "venceu às 16:58" (ou "venceu 12/10 16:58") ou "sem prazo". */
export function prazoDaDecisao(expiraEm: string, agora: Date = new Date()): { texto: string; vencido: boolean } {
  if (decisaoSemPrazo(expiraEm)) return { texto: 'sem prazo', vencido: false };
  const t = new Date(expiraEm).getTime();
  if (Number.isNaN(t)) return { texto: 'prazo ausente', vencido: false };
  const falta = t - agora.getTime();
  if (falta <= 0) {
    const quando = quandoSP(expiraEm, agora);
    return { texto: quando.includes('/') ? `venceu ${quando}` : `venceu às ${quando}`, vencido: true };
  }
  return { texto: `expira em ${duracao(falta)}`, vencido: false };
}

/** Quando roda a próxima ação: "em 2 h", "há 3 h", ou vazio sem data. */
export function quandoRoda(iso: string | null | undefined, agora: Date = new Date()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const d = t - agora.getTime();
  if (Math.abs(d) < 60_000) return 'agora';
  return d > 0 ? `em ${duracao(d)}` : `há ${duracao(d)}`;
}

/** A descrição já diz quando roda ("lembrete em 2 h")? Então a tela não repete o prazo. */
export function descricaoJaDizQuando(descricao: string | null | undefined): boolean {
  return !!descricao && /(^|\s)(em|até|às|volta)\s+\d/.test(descricao);
}

/** Reais a partir de centavos; nulo vira ausente (nunca zero). */
export function reaisOuAusente(centavos: number | null | undefined): string {
  if (centavos == null || !Number.isFinite(centavos)) return AUSENTE;
  const inteiro = Math.trunc(Math.abs(centavos) / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const resto = (Math.abs(centavos) % 100).toString().padStart(2, '0');
  return `${centavos < 0 ? '-' : ''}R$ ${inteiro}${resto === '00' ? '' : `,${resto}`}`;
}

/** Número ou ausente. */
export function numeroOuAusente(n: number | null | undefined, sufixo = ''): string {
  if (n == null || !Number.isFinite(n)) return AUSENTE;
  return `${n}${sufixo}`;
}

/** Tempo de uma escrita do fechamento: "0,4 s"; abaixo de 100 ms, "14 ms" (para não escrever "0,0 s"). */
export function segundos(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return AUSENTE;
  if (ms < 100) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

/** Percentual de 0 a 1 ou de 0 a 100 escrito como "97%". */
export function percentual(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return AUSENTE;
  const pct = v <= 1 ? v * 100 : v;
  return `${Math.round(pct)}%`;
}

export const ROTULO_DA_FONTE: Record<ComercialFonte, string> = {
  whats: 'whats',
  form: 'form',
  sala: 'sala',
  agenda: 'agenda',
  ata: 'ata',
  agente: 'agente',
  asaas: 'asaas',
  zapsign: 'zapsign',
  relogio: 'relógio',
  decisao: 'decisão',
  sistema: 'sistema',
  pessoa: 'pessoa',
};

export const ROTULO_DO_MOTIVO: Record<ComercialMotivoDeSaida, string> = {
  sem_base: 'sem base',
  preco: 'preço',
  sumiu: 'sumiu',
  momento: 'momento',
  nao_e_cliente_root: 'não é cliente Root',
  outro: 'outro',
};

export const ROTULO_DO_PRODUTO: Record<ComercialProduto, string> = {
  imersao: 'Imersão',
  operacao: 'Operação ROOT',
  kit: 'Kit',
  turma: 'Turma',
};

export const ROTULO_DO_TIPO_DE_DECISAO: Record<ComercialTipoDeDecisao, string> = {
  proposta_fora_da_tabela: 'proposta fora da tabela',
  ponto_zero: 'regra do ponto zero',
  lead_parado: 'lead parado',
  pedido_de_ajuste: 'pedido de ajuste',
  veto_de_fechamento: 'veto de fechamento',
  excecao_do_vigia: 'exceção do vigia',
  aprovacao_de_envio: 'aprovação de envio',
};

/** O rótulo da opção que vale se ninguém responder. */
export function rotuloDoPadrao(d: { padrao: string; opcoes: { chave: string; rotulo: string }[] }): string {
  return d.opcoes.find((o) => o.chave === d.padrao)?.rotulo ?? d.padrao;
}

/*
 * As colunas da tela 04. O funil da API vem por estágio (nove etapas e as
 * saídas); a tela junta os vizinhos como o mapa os desenha, sem mudar a
 * etapa de ninguém: é só a moldura.
 */
const GRUPOS_DO_FUNIL: { chave: string; rotulo: string; etapas: (ComercialEtapa | 'saidas')[] }[] = [
  { chave: 'entrada', rotulo: 'novo · qualif.', etapas: ['novo_lead', 'qualificacao'] },
  { chave: 'conversa', rotulo: 'conversa', etapas: ['reuniao_agendada', 'sessao'] },
  { chave: 'diagnostico', rotulo: 'diagnóstico', etapas: ['diagnostico'] },
  { chave: 'proposta', rotulo: 'proposta · fup', etapas: ['proposta', 'follow_up'] },
  { chave: 'contrato', rotulo: 'aceite · contrato', etapas: ['contrato'] },
  { chave: 'fechado', rotulo: 'fechado', etapas: ['fechado'] },
  { chave: 'saidas', rotulo: 'saídas', etapas: ['saidas'] },
];

export interface GrupoDoFunil {
  chave: string;
  rotulo: string;
  etapas: (ComercialEtapa | 'saidas')[];
  cartoes: CartaoDoFunil[];
}

export function agruparFunil(funil: FunilVivo): GrupoDoFunil[] {
  return GRUPOS_DO_FUNIL.map((g) => ({
    ...g,
    cartoes: funil.colunas.filter((c) => g.etapas.includes(c.etapa)).flatMap((c) => c.cartoes),
  }));
}

/** A faixa da saúde, para a cor da barra. Sem número, sem faixa. */
export function faixaDaSaude(s: number | null | undefined): 'alta' | 'media' | 'baixa' | null {
  if (s == null || !Number.isFinite(s)) return null;
  if (s >= 70) return 'alta';
  if (s >= 40) return 'media';
  return 'baixa';
}

/** O texto de quando alguém tenta arrastar um cartão (tela 04). */
export function motivoDoBloqueio(nome: string, proxima: string | null, faltando: string[] | null): string {
  const base = `${nome} não muda de etapa por arraste. A etapa anda pelo fato: quando o evento chega, o cartão vai sozinho.`;
  if (!proxima) return `${base} Este lead não tem próxima etapa no funil.`;
  if (faltando == null) return `${base} Lendo o portão de ${proxima}.`;
  if (!faltando.length) return `${base} O portão de ${proxima} já está cumprido; o cartão anda no próximo fato.`;
  return `${base} Para ${proxima} falta: ${faltando.join('; ')}.`;
}

/** O fio agrupado pelo dia relativo à entrada (D1, D4...), na ordem em que veio. */
export function fioPorDia(fio: LinhaDoFio[]): { dia: number; linhas: LinhaDoFio[] }[] {
  const grupos: { dia: number; linhas: LinhaDoFio[] }[] = [];
  for (const l of fio) {
    const ult = grupos[grupos.length - 1];
    if (ult && ult.dia === l.dia) ult.linhas.push(l);
    else grupos.push({ dia: l.dia, linhas: [l] });
  }
  return grupos;
}

/**
 * O estado do rascunho da proposta (tela 06), dito para quem olha. `na_porta`
 * espera aprovação em /atendimento; `na_fila` espera a fila de decisões do
 * comercial (laudo com apontamento ou fora da tabela), em /comercial (C-3).
 */
export function explicarRascunho(estado: string, publicarEm?: string | null): { rotulo: string; aguardaAprovacao: boolean; naFilaDeDecisoes?: boolean } {
  switch (estado) {
    case 'pronta':
      return { rotulo: 'pronta, esperando liberar', aguardaAprovacao: false };
    case 'agendada':
      return { rotulo: publicarEm ? `agendada: vai à porta às ${horaSP(publicarEm)}` : 'agendada', aguardaAprovacao: false };
    case 'na_porta':
      return { rotulo: 'aguardando aprovação de outra pessoa', aguardaAprovacao: true };
    case 'na_fila':
      return { rotulo: 'na fila de decisões do comercial', aguardaAprovacao: false, naFilaDeDecisoes: true };
    case 'segurada':
      return { rotulo: 'segurada: só sai se alguém liberar', aguardaAprovacao: false };
    case 'publicada':
      return { rotulo: 'publicada na sala', aguardaAprovacao: false };
    default:
      return { rotulo: estado, aguardaAprovacao: false };
  }
}

/** A resposta de uma ação que foi à porta e ficou retida? */
export function ficouRetida(r: unknown): r is { approvalId: string } {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  return (o.status === 'aguardando_aprovacao' || o.estado === 'aguardando_aprovacao' || o.estado === 'na_porta' || o.estado === 'na_fila') && typeof o.approvalId === 'string';
}

/** O endereço ainda não foi entregue pela API (501)? A tela diz isso com honestidade. */
export function ehNaoImplementado(e: unknown): boolean {
  return e instanceof ErroDaApi && e.status === 501;
}

/** Parcelas pagas sobre o total. */
export function contarParcelas(parcelas: { estado: string }[]): { pagas: number; total: number; atrasadas: number } {
  return {
    pagas: parcelas.filter((p) => p.estado === 'paga').length,
    total: parcelas.length,
    atrasadas: parcelas.filter((p) => p.estado === 'atrasada').length,
  };
}

const ISO_NO_TEXTO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})/g;
const DIAS_DA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/**
 * Um resumo do fio que traz um instante cru ("escolheu 2026-10-12T14:11:25-03:00")
 * vira legível em São Paulo ("escolheu seg 12/10 14:11"). Só troca o que é ISO
 * com fuso; o resto do texto fica como a API escreveu.
 */
export function instantesLegiveis(texto: string): string {
  return texto.replace(ISO_NO_TEXTO, (iso) => {
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) return iso;
    const f = new Intl.DateTimeFormat('en-US', { timeZone: FUSO, weekday: 'short' }).format(t);
    const semana = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(f);
    return `${DIAS_DA_SEMANA[semana] ?? ''} ${diaHoraSP(iso)}`.trim();
  });
}
