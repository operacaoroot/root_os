'use client';

import type { ReactNode } from 'react';
import type { Gaveta, Nivel } from './tipos';

/*
 * Peças visuais da fila. Nada aqui decide nada: cor de nível é aparência, e o
 * nível sempre chega pronto do servidor.
 */

/** Do mais frio ao mais quente — mesma escala da tela da Régua, de propósito. */
const COR: Record<Nivel, string> = {
  R0: 'bg-surface-2 text-muted',
  R1: 'bg-surface-2 text-text',
  R2: 'bg-good/15 text-good',
  R3: 'bg-brand/15 text-brand',
  R4: 'bg-warn/15 text-warn',
  R5: 'bg-bad/15 text-bad',
};

export function Selo({ nivel, marca }: { nivel: Nivel; marca?: string }) {
  return (
    <span
      data-testid={marca}
      className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[11px] font-medium ${
        COR[nivel] ?? COR.R0
      }`}
    >
      {nivel}
    </span>
  );
}

export function Etiqueta({ children, tom }: { children: ReactNode; tom?: 'quente' }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] ${
        tom === 'quente' ? 'bg-warn/15 text-warn' : 'bg-surface-2 text-muted'
      }`}
    >
      {children}
    </span>
  );
}

export const TITULO_DA_GAVETA: Record<Gaveta, string> = {
  esperando: 'Esperando decisão',
  confirmada: 'Confirmada, aguardando execução',
  expirou: 'Expirou',
  recusada: 'Recusada',
};

/*
 * A GAVETA "CONFIRMADA" — as QUATRO causas, e não só a que era fácil de nomear.
 *
 * O texto anterior culpava o conector desligado, que é justamente a única das
 * quatro que a fila já perguntava antes de confirmar — ou seja, a menos provável
 * de ter posto o item ali. As outras três moram em `ToolGateway.conferirAprovado`
 * e recusavam DEPOIS do `confirm`, que é o que produzia esta gaveta. Agora a
 * fila pergunta as quatro antes; quando um item cai aqui mesmo assim, a mudança
 * aconteceu na janela entre a pergunta e o envio, ou a confirmação veio de fora
 * desta tela (script de terminal).
 */
export const EXPLICACAO_DA_GAVETA: Record<Gaveta, string> = {
  esperando: 'A ação está retida. Ninguém a executou e nada saiu da casa.',
  confirmada:
    'Alguém assinou e a execução não concluiu. Quatro coisas param uma ação já confirmada: o conector do canal foi desligado, a capacidade saiu do catálogo da empresa, a régua de hoje deixou de permiti-la, ou os argumentos gravados não casam mais com o formato atual. A aprovação NÃO foi consumida e nada saiu, mas confirmar de novo não é possível. A saída é recusar aqui mesmo (e propor de novo depois de consertar a causa).',
  expirou: 'O prazo venceu sem decisão. Nada saiu, e ela não se aprova mais: o caminho é pedir de novo, com o conteúdo de agora.',
  recusada: 'Uma pessoa disse não. Nada saiu, e a recusa está no rastro.',
};

/** "há 3 min", "há 2 h 10" — a espera é o que faz a fila ser uma fila. */
export function esperaLegivel(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60000));
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto ? `há ${h} h ${resto}` : `há ${h} h`;
}

export function horaLegivel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export const inputCls =
  'w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand-dim';
