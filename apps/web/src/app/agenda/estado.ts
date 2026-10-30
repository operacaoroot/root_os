import { SOCIOS_DA_AGENDA } from '@mktos/shared';

import { ehChaveDeDia } from './semana';
import { OPCOES_DE_DIAS, type QuantosDias, type Quem } from './v2';

/*
 * O ESTADO DA AGENDA V2 NO ENDEREÇO (29/10/2026, lane G3):
 * `?aba=semana&dia=AAAA-MM-DD&dias=5&quem=Rodrigo`. O endereço de antes
 * (`?visao=mes|semana|dia`) continua valendo: mês abre o Mês, semana abre
 * "Semana e dia" com 5 dias, dia abre com 1.
 */

export type AbaDaAgenda = 'semana' | 'lista' | 'mes' | 'conflitos' | 'relatorios' | 'regras';
export const ABAS: readonly AbaDaAgenda[] = ['semana', 'lista', 'mes', 'conflitos', 'relatorios', 'regras'];
export const ROTULO_DA_ABA: Record<AbaDaAgenda, string> = {
  semana: 'Semana e dia',
  lista: 'Lista',
  mes: 'Mês',
  conflitos: 'Conflitos',
  relatorios: 'Relatórios',
  regras: 'Regras',
};

export interface EstadoDaAgendaV2 {
  aba: AbaDaAgenda;
  dia: string;
  dias: QuantosDias;
  quem: Quem;
}

/** Lê o endereço. Sem aba: a Lista no celular (abaixo de 860 px), "Semana e dia" no computador. */
export function lerEstadoV2(busca: string, hoje: string, estreito: boolean): EstadoDaAgendaV2 {
  const q = new URLSearchParams(busca);
  const aba = q.get('aba');
  const visao = q.get('visao');
  const dia = q.get('dia');
  const dias = Number(q.get('dias'));
  const quem = q.get('quem');
  let abaLida: AbaDaAgenda = estreito ? 'lista' : 'semana';
  let diasLidos: QuantosDias = 5;
  if ((ABAS as readonly string[]).includes(aba ?? '')) abaLida = aba as AbaDaAgenda;
  else if (visao === 'mes') abaLida = 'mes';
  else if (visao === 'semana') abaLida = 'semana';
  else if (visao === 'dia') { abaLida = 'semana'; diasLidos = 1; }
  if ((OPCOES_DE_DIAS as readonly number[]).includes(dias)) diasLidos = dias as QuantosDias;
  return {
    aba: abaLida,
    dia: ehChaveDeDia(dia) ? dia : hoje,
    dias: diasLidos,
    quem: (SOCIOS_DA_AGENDA as readonly string[]).includes(quem ?? '') ? (quem as Quem) : 'Todos',
  };
}

/** O endereço com o estado novo, preservando o resto da query (e tirando a `visao` antiga). */
export function urlDoEstadoV2(atual: string, e: EstadoDaAgendaV2): string {
  const u = new URL(atual, 'http://x');
  u.searchParams.delete('visao');
  u.searchParams.set('aba', e.aba);
  u.searchParams.set('dia', e.dia);
  u.searchParams.set('dias', String(e.dias));
  if (e.quem === 'Todos') u.searchParams.delete('quem');
  else u.searchParams.set('quem', e.quem);
  return `${u.pathname}?${u.searchParams.toString()}${u.hash}`;
}
