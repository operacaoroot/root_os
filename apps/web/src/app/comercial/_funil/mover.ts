/*
 * MOVER O CARTÃO DO FUNIL (rodada do painel P5, 18/10/2026; sem limitação desde
 * a rodada da interface U4, 20/10/2026) — a parte sem tela.
 *
 * Decisão do dono do produto (20/10/2026): a pessoa com `leads.editar` move o
 * lead para QUALQUER etapa, por arrasto ou pelo menu "Mover para", direto, sem
 * pedido nem assinatura de outra pessoa. A tela diz só a mensagem que a API
 * devolve ("Movido para…", e "sem as conclusões de…" quando ficou portão para
 * trás). Saída leva o motivo no mesmo gesto, sem trava.
 *
 * Fica fora do page.tsx porque página do App Router não exporta nada além do componente.
 */
import {
  COMERCIAL_ETAPAS,
  COMERCIAL_ROTULO_DA_ETAPA,
  COMERCIAL_SAIDAS,
  destinoDoMover,
  type CartaoDoFunil,
  type ComercialDestinoDoMover,
  type ComercialEtapa,
  type ComercialMoverInput,
  type ComercialPedidoDeMover,
  type ComercialResultadoDoMover,
} from '@mktos/shared';

import { ErroDaApi, apiPost } from '@/lib/api';

/** "10:42" no relógio de São Paulo. */
export function horaSP(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
}

/**
 * APOSENTADO (U4): o pedido de mover não existe mais. Fica para a tela da fila,
 * que ainda o chama ao "pedir de novo" (a API responde 410 antes de chegar aqui).
 */
export function guardarPedido(leadId: string, p: ComercialPedidoDeMover): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(`comercial.mover.${leadId}`, JSON.stringify({ ...p, leadId }));
}

/** O rótulo curto da coluna ("E3", "Saídas"). */
export function rotuloCurto(etapa: ComercialEtapa | 'saidas'): string {
  return etapa === 'saidas' ? 'Saídas' : COMERCIAL_ROTULO_DA_ETAPA[etapa].split(' · ')[0];
}

/** As opções do menu "Mover para": cada etapa ativa e cada saída, menos a etapa em que o cartão está. */
export function opcoesDoMenu(c: Pick<CartaoDoFunil, 'etapa' | 'voltaPara'>): ComercialDestinoDoMover[] {
  return [...COMERCIAL_ETAPAS, ...COMERCIAL_SAIDAS].filter((e) => e !== c.etapa).map((e) => destinoDoMover(c.etapa, e, c.voltaPara ?? null));
}

/** Soltar na coluna: a coluna "Saídas" abre o motivo da saída; as outras levam à etapa. */
export function destinoDaColuna(c: Pick<CartaoDoFunil, 'etapa' | 'voltaPara'>, coluna: ComercialEtapa | 'saidas'): ComercialDestinoDoMover {
  if (coluna === 'saidas') {
    const para = c.etapa === 'perdido' ? 'geladeira' : 'perdido';
    return { ...destinoDoMover(c.etapa, para, c.voltaPara ?? null), caminho: 'saida' };
  }
  return destinoDoMover(c.etapa, coluna, c.voltaPara ?? null);
}

/** Move direto: a API grava e devolve a mensagem da tela. */
export function moverCartao(leadId: string, corpo: ComercialMoverInput, token: string | null): Promise<ComercialResultadoDoMover> {
  return apiPost<ComercialResultadoDoMover>(`/comercial/lead/${leadId}/mover`, corpo, token);
}

/** O erro do mover, traduzido para quem clicou. */
export function fraseDoErro(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? '');
  const detalhes = e instanceof ErroDaApi && e.detalhes.length ? `: ${e.detalhes.join('; ')}` : '';
  return `${m || 'Não deu para mover agora.'}${detalhes}`;
}

/** Data do formulário (AAAA-MM-DD) para o instante que a saída pede (meio-dia em São Paulo). */
export function voltaEmDoDia(dia: string): string {
  return `${dia}T12:00:00-03:00`;
}
