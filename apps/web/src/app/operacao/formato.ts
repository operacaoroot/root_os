import type { OperacaoEstado } from '@mktos/shared';

const REAIS = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function reais(centavos: number): string {
  return REAIS.format(centavos / 100);
}

/** `2026-10-14` → `14/10/2026`; com `curta`, `14/10`. */
export function data(iso: string | null, curta = false): string {
  if (!iso) return '–';
  const [a, m, d] = iso.split('-');
  return curta ? `${d}/${m}` : `${d}/${m}/${a}`;
}

/**
 * Hoje no fuso de quem olha, no mesmo formato das datas do painel, para a
 * comparação ser de texto: `new Date('2026-10-14')` é meia-noite em UTC, que
 * no Brasil ainda é o dia 13.
 */
export function hoje(agora = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`;
}

export function atrasado(prazo: string | null, feito: boolean, referencia: string): boolean {
  return !feito && prazo !== null && prazo < referencia;
}

export function diasEntre(de: string, ate: string): number {
  const ms = Date.UTC(+ate.slice(0, 4), +ate.slice(5, 7) - 1, +ate.slice(8, 10))
    - Date.UTC(+de.slice(0, 4), +de.slice(5, 7) - 1, +de.slice(8, 10));
  return Math.round(ms / 86_400_000);
}

export const TOM_DO_ESTADO: Record<OperacaoEstado, 'good' | 'warn' | 'bad' | 'muted'> = {
  ok: 'good',
  atencao: 'warn',
  erro: 'bad',
  neutro: 'muted',
};

export const ROTULO_DO_ESTADO: Record<OperacaoEstado, string> = {
  ok: 'em dia',
  atencao: 'atenção',
  erro: 'travado',
  neutro: 'sem sinal',
};
