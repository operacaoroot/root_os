import type { ReuniaoDaAgenda } from '@mktos/shared';

import { FUSO_DA_AGENDA, noFuso } from './semana';

/**
 * Um evento como a API devolve em `GET /google/calendar/periodo`.
 *
 * `reuniao` é o padrão da casa JÁ DESMONTADO pelo servidor (ver `agenda.ts` no
 * shared): vem `null` quando o título do evento foge do padrão, e é isso que a
 * tela mostra como "fora do padrão" em vez de adivinhar um cliente.
 */
export interface EventoDaAgenda {
  id: string;
  title: string;
  reuniao: ReuniaoDaAgenda | null;
  start: string | null;
  end: string | null;
  diaInteiro: boolean;
  location: string | null;
  description: string | null;
  link: string | null;
  meet: string | null;
  status: string | null;
  organizador: string | null;
  attendees: string[];
}

/** O bilhete de retenção da porta — o mesmo contrato da tela do Google. */
export interface RespostaDeEscrita {
  status?: string;
  approvalId?: string;
  mensagem?: string;
  fila?: string;
  precisaDeOutraPessoa?: boolean;
}

export const foiRetida = (r: RespostaDeEscrita): boolean => r?.status === 'aguardando_aprovacao';

/** Chave `AAAA-MM-DD` no fuso de quem está olhando, não em UTC. */
export function chaveDoDia(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * O dia a que um evento pertence na grade.
 *
 * Evento de dia inteiro chega como `AAAA-MM-DD` puro. Passar isso por `new
 * Date()` o lê como UTC meia-noite e, em Brasília, o joga para o dia anterior —
 * é o mesmo erro de fuso que o link do onboarding já teve. Por isso a string é
 * cortada, não convertida.
 */
export function diaDoEvento(e: EventoDaAgenda): string | null {
  if (!e.start) return null;
  if (e.diaInteiro) return e.start.slice(0, 10);
  // P2 (21/10): o dia do evento com hora é o de America/Sao_Paulo, não o do navegador.
  return noFuso(new Date(e.start)).dia;
}

export const horaCurta = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: FUSO_DA_AGENDA }) : '';

/** As cores por natureza do compromisso. Fora do padrão é warn de propósito. */
export function tomDoEvento(e: EventoDaAgenda): 'brand' | 'good' | 'muted' | 'warn' {
  if (!e.reuniao) return 'warn';
  if (e.reuniao.tipo === 'interna') return 'muted';
  return e.reuniao.modalidade === 'online' ? 'brand' : 'good';
}

/** O rótulo curto do evento na célula do mês. */
export function rotuloCurto(e: EventoDaAgenda): string {
  if (!e.reuniao) return e.title;
  return e.reuniao.tipo === 'cliente' ? e.reuniao.cliente : `Interna · ${e.reuniao.responsavel}`;
}
