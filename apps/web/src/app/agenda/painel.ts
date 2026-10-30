import {
  montarTituloDeCompromisso,
  SOCIOS_DA_AGENDA,
  type CamposDaFrase,
  type ClienteDaBuscaDaAgenda,
  type CompromissoProposto,
  type ModalidadeDeReuniao,
  type NovoCompromisso,
  type PedidoDeEscrita,
  type ResultadoDaEscrita,
  type SocioDaAgenda,
  type TipoQueSeMarca,
} from '@mktos/shared';

import { horaDeMinutos, instanteNoFuso, minutosDeHora, minutosDoEvento, type EventoV2 } from './v2';

/*
 * O PAINEL DE MARCAR — a conta pura (agenda v2, 29/10/2026, lane G3).
 *
 * O rascunho do painel, o que a frase muda nele, o título (pela MESMA função do
 * servidor, `montarTituloDeCompromisso`), a proposta que vai à régua e o pedido
 * que vai a `POST /agenda/escritas`. A tela só desenha.
 */

export interface Rascunho {
  tipo: TipoQueSeMarca;
  modalidade: ModalidadeDeReuniao;
  cliente: string;
  leadId: string | null;
  clienteId: string | null;
  responsaveis: SocioDaAgenda[];
  /** `AAAA-MM-DD`. */
  dia: string;
  /** `HH:MM`. */
  hora: string;
  duracaoMin: number;
  motivo: string;
  local: string;
  convidados: string;
  pauta: string;
}

export const ROTULO_DO_TIPO: Record<TipoQueSeMarca, string> = {
  cliente: 'Cliente',
  interna: 'Interna',
  bloqueio: 'Bloqueio',
  pessoal: 'Pessoal',
  fora: 'Fora',
};
export const TIPOS_DO_PAINEL: readonly TipoQueSeMarca[] = ['cliente', 'interna', 'bloqueio', 'pessoal', 'fora'];

/** Tipos de uma pessoa só (a gramática recusa mais de um). */
export const UMA_PESSOA: ReadonlySet<TipoQueSeMarca> = new Set(['bloqueio', 'pessoal', 'fora']);

export function rascunhoVazio(dia: string, hora = '09:00'): Rascunho {
  return {
    tipo: 'cliente',
    modalidade: 'online',
    cliente: '',
    leadId: null,
    clienteId: null,
    responsaveis: [],
    dia,
    hora,
    duracaoMin: 60,
    motivo: '',
    local: '',
    convidados: '',
    pauta: '',
  };
}

/** As durações do seletor: de 5 min até o fim do dia. */
export function duracoesAte(hora: string): number[] {
  const ini = minutosDeHora(hora) ?? 0;
  const max = Math.max(5, 24 * 60 - ini);
  const base = [5, 10, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 360, 480, 600, 720];
  const lista = base.filter((m) => m <= max);
  if (!lista.includes(max)) lista.push(max);
  return lista;
}

/**
 * A frase sobre o rascunho: SÓ o que a frase disse muda. `base` é o rascunho de
 * antes de a pessoa começar a escrever a frase; apagar uma palavra da frase volta
 * o campo ao que estava.
 */
export function aplicarFrase(base: Rascunho, campos: CamposDaFrase): Rascunho {
  const r: Rascunho = { ...base };
  if (campos.tipo) r.tipo = campos.tipo;
  if (campos.modalidade) r.modalidade = campos.modalidade;
  if (campos.cliente) {
    r.cliente = campos.cliente;
    if (campos.cliente !== base.cliente) { r.leadId = null; r.clienteId = null; }
  }
  if (campos.responsaveis?.length) r.responsaveis = [...campos.responsaveis];
  if (campos.dia) r.dia = campos.dia;
  if (campos.hora) r.hora = campos.hora;
  if (campos.duracaoMin) r.duracaoMin = campos.duracaoMin;
  if (campos.motivo) r.motivo = campos.motivo;
  return r;
}

/** Liga o rascunho a um resultado da busca (lead ou cliente). */
export function comCliente(r: Rascunho, c: ClienteDaBuscaDaAgenda): Rascunho {
  return {
    ...r,
    tipo: r.tipo === 'cliente' ? r.tipo : 'cliente',
    cliente: c.nome,
    leadId: c.tipo === 'lead' ? c.id : null,
    clienteId: c.tipo === 'cliente' ? c.id : null,
    convidados: r.convidados || c.contato?.email || '',
  };
}

/** O título como vai ficar no Google, ou o que falta para ele existir. */
export function tituloDoRascunho(r: Rascunho): { titulo: string | null; falta: string | null } {
  try {
    return {
      titulo: montarTituloDeCompromisso({
        tipo: r.tipo,
        modalidade: r.modalidade,
        cliente: r.cliente.trim(),
        responsaveis: r.responsaveis,
        motivo: r.motivo,
      }),
      falta: r.tipo === 'cliente' && !r.cliente.trim() ? 'Falta o cliente.' : null,
    };
  } catch (e) {
    return { titulo: null, falta: (e as Error).message };
  }
}

/** O intervalo do rascunho em instantes (ISO), ou nulo se a hora não é válida. */
export function intervaloDoRascunho(r: Rascunho): { inicio: string; fim: string } | null {
  const m = minutosDeHora(r.hora);
  if (m === null || !/^\d{4}-\d{2}-\d{2}$/.test(r.dia) || !(r.duracaoMin > 0)) return null;
  return {
    inicio: instanteNoFuso(r.dia, m).toISOString(),
    fim: instanteNoFuso(r.dia, Math.min(24 * 60, m + r.duracaoMin)).toISOString(),
  };
}

/** O que a régua avalia (`avaliarNaRegua`). */
export function propostaDoRascunho(r: Rascunho, ignorarEventoId: string | null = null): CompromissoProposto | null {
  const i = intervaloDoRascunho(r);
  if (!i) return null;
  return {
    tipo: r.tipo,
    modalidade: r.tipo === 'cliente' || r.tipo === 'interna' ? r.modalidade : null,
    responsaveis: r.responsaveis,
    inicio: i.inicio,
    fim: i.fim,
    ignorarEventoId,
  };
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Os e-mails do campo "convidados" e o primeiro que não parece e-mail. */
export function lerConvidados(texto: string): { emails: string[]; invalido: string | null } {
  const emails = texto.split(/[,;\s]+/).map((v) => v.trim()).filter(Boolean);
  return { emails, invalido: emails.find((v) => !EMAIL.test(v)) ?? null };
}

/** Uma chave nova por pedido (a escrita é idempotente por ela). */
export function novaChave(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `ag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** O pedido de MARCAR. Lança com a frase do que falta. */
export function pedidoDeMarcar(r: Rascunho, chave: string, forcado?: { motivo: string }): PedidoDeEscrita {
  const t = tituloDoRascunho(r);
  if (!t.titulo || t.falta) throw new Error(t.falta ?? 'Falta o que o título exige.');
  const i = intervaloDoRascunho(r);
  if (!i) throw new Error('Falta o dia e a hora.');
  const { emails, invalido } = lerConvidados(r.convidados);
  if (invalido) throw new Error(`"${invalido}" não parece um e-mail.`);
  const reuniao = r.tipo === 'cliente' || r.tipo === 'interna';
  const compromisso: NovoCompromisso = {
    tipo: r.tipo,
    modalidade: reuniao ? r.modalidade : 'presencial',
    responsaveis: r.responsaveis,
    inicio: i.inicio,
    fim: i.fim,
    ...(r.tipo === 'cliente' ? { cliente: r.cliente.trim() } : {}),
    ...(r.tipo === 'cliente' && r.leadId ? { leadId: r.leadId } : {}),
    ...(r.tipo === 'cliente' && r.clienteId ? { clienteId: r.clienteId } : {}),
    ...(reuniao && r.modalidade === 'presencial' && r.local.trim() ? { local: r.local.trim() } : {}),
    ...(reuniao && r.pauta.trim() ? { pauta: r.pauta.trim() } : {}),
    ...(reuniao && emails.length ? { convidados: emails } : {}),
    ...(r.tipo === 'fora' ? { motivo: r.motivo.trim() } : {}),
  };
  return { acao: 'marcar', chave, compromisso, ...(forcado ? { forcado } : {}) };
}

const TIPO_LIDO_PARA_O_PAINEL: Record<string, TipoQueSeMarca | undefined> = {
  cliente: 'cliente',
  interna: 'interna',
  fechado: 'bloqueio',
  pessoal: 'pessoal',
  fora: 'fora',
};

/** O tipo do painel de um evento, ou nulo quando o título não está em forma nenhuma (aí só o horário muda). */
export const tipoDoPainel = (e: EventoV2): TipoQueSeMarca | null => TIPO_LIDO_PARA_O_PAINEL[e.leitura.tipo] ?? null;

/** O rascunho de EDITAR um evento (o mesmo painel, preenchido com o que está no Google). */
export function rascunhoDoEvento(e: EventoV2): Rascunho {
  const m = minutosDoEvento(e);
  const tipo = tipoDoPainel(e) ?? 'cliente';
  return {
    tipo,
    modalidade: e.leitura.modalidade ?? (e.meet ? 'online' : 'presencial'),
    cliente: e.leitura.cliente ?? '',
    leadId: null,
    clienteId: null,
    responsaveis: [...e.leitura.responsaveis],
    dia: m?.dia ?? '',
    hora: m ? horaDeMinutos(m.inicio) : '09:00',
    duracaoMin: m ? Math.max(5, m.fim - m.inicio) : 60,
    motivo: e.leitura.motivo ?? '',
    local: e.local ?? '',
    convidados: '',
    pauta: '',
  };
}

const mesmos = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * O pedido de ALTERAR: `antes` é o retrato de agora (o efeito confere contra o
 * Google), `depois` leva SÓ o que mudou. Evento fora de forma (`outro`) só muda
 * o horário. Nulo = nada mudou.
 */
export function pedidoDeAlterar(e: EventoV2, r: Rascunho, chave: string, forcado?: { motivo: string }): PedidoDeEscrita | null {
  const i = intervaloDoRascunho(r);
  if (!i) throw new Error('Falta o dia e a hora.');
  const original = rascunhoDoEvento(e);
  const depois: Extract<PedidoDeEscrita, { acao: 'alterar' }>['depois'] = {};
  if (new Date(i.inicio).getTime() !== new Date(e.inicio).getTime()) depois.inicio = i.inicio;
  if (new Date(i.fim).getTime() !== new Date(e.fim).getTime()) depois.fim = i.fim;
  if (tipoDoPainel(e)) {
    if (r.tipo !== original.tipo) depois.tipo = r.tipo;
    if ((r.tipo === 'cliente' || r.tipo === 'interna') && r.modalidade !== original.modalidade) depois.modalidade = r.modalidade;
    if (r.tipo === 'cliente' && r.cliente.trim() !== original.cliente) depois.cliente = r.cliente.trim();
    if (!mesmos(r.responsaveis, original.responsaveis)) depois.responsaveis = [...r.responsaveis];
    if ((r.local.trim() || null) !== (e.local ?? null)) depois.local = r.local.trim() || null;
    if (depois.tipo || depois.cliente || depois.responsaveis || depois.modalidade) {
      const t = tituloDoRascunho(r);
      if (!t.titulo || t.falta) throw new Error(t.falta ?? 'Falta o que o título exige.');
    }
  }
  if (!Object.keys(depois).length) return null;
  return {
    acao: 'alterar',
    chave,
    eventoId: e.id,
    antes: { titulo: e.titulo ?? '', inicio: e.inicio, fim: e.fim, local: e.local, meet: !!e.meet },
    depois,
    ...(forcado ? { forcado } : {}),
  };
}

export function pedidoDeCancelar(e: EventoV2, motivo: string, avisar: boolean, chave: string): PedidoDeEscrita {
  const m = motivo.trim();
  if (!m) throw new Error('Diga o motivo do cancelamento.');
  return { acao: 'cancelar', chave, eventoId: e.id, tituloAtual: e.titulo ?? '', motivo: m, avisar };
}

export type DesfechoDaEscrita =
  | { tipo: 'saiu'; texto: string; desfazer: PedidoDeEscrita | null; eventoId: string | null }
  | { tipo: 'fila'; texto: string; approvalId: string | null }
  | { tipo: 'regua'; texto: string }
  | { tipo: 'recusado'; texto: string };

/**
 * O que `POST /agenda/escritas` devolve (o corpo do pedido é o `PedidoDeEscrita`
 * cru). A lane G4 acrescenta `responsaveisSemEmail` quando o convite saiu sem o
 * e-mail de algum sócio (sem e-mail na Equipe).
 */
export type ResultadoDaEscritaNaTela = ResultadoDaEscrita & { responsaveisSemEmail?: SocioDaAgenda[] };

/** "convite saiu sem o e-mail de Lucas e Pedro", ou nulo. */
export function avisoSemEmail(r: ResultadoDaEscritaNaTela): string | null {
  const s = Array.isArray(r.responsaveisSemEmail) ? r.responsaveisSemEmail.filter(Boolean) : [];
  if (!s.length) return null;
  const nomes = s.length === 1 ? s[0] : `${s.slice(0, -1).join(', ')} e ${s[s.length - 1]}`;
  return `convite saiu sem o e-mail de ${nomes}`;
}

/** O que a tela diz depois de `POST /agenda/escritas`. */
export function desfechoDa(r: ResultadoDaEscritaNaTela): DesfechoDaEscrita {
  if (r.regua && r.status !== 'executado') {
    return { tipo: 'regua', texto: r.mensagem || 'A régua deu vermelho: nada foi enviado ao Google.' };
  }
  if (r.status === 'executado') {
    const aviso = avisoSemEmail(r);
    const texto = r.mensagem || 'Feito no Google.';
    return { tipo: 'saiu', texto: aviso ? `${texto} Atenção: ${aviso}.` : texto, desfazer: r.desfazer ?? null, eventoId: r.eventoId };
  }
  if (r.status === 'aguardando_aprovacao') {
    const quem = r.precisaDeOutraPessoa ? ' Quem confirma é outra pessoa.' : '';
    return { tipo: 'fila', texto: `Foi para a fila de aprovação.${quem} Nada mudou na agenda ainda.`, approvalId: r.approvalId };
  }
  return { tipo: 'recusado', texto: r.mensagem || 'A escrita foi recusada.' };
}

/** Quem pode receber o link de escolha: um sócio só, e reunião (cliente ou interna). */
export function motivoSemLink(r: Rascunho): string | null {
  if (r.tipo !== 'cliente' && r.tipo !== 'interna') return 'O link de escolha é para reunião (cliente ou interna).';
  if (r.responsaveis.length !== 1) return 'O link de escolha é de um sócio só: escolha um responsável.';
  return null;
}

/** Os sócios em ordem fixa (Rodrigo, Lucas, Pedro). */
export const ordenarSocios = (s: readonly SocioDaAgenda[]): SocioDaAgenda[] => SOCIOS_DA_AGENDA.filter((x) => s.includes(x));
