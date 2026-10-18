/*
 * MOVER O CARTÃO DO FUNIL (rodada do painel P5, 18/10/2026) — a parte sem tela.
 *
 * Mudar a etapa pela tela é escrita sensível, como sempre foi o `PATCH
 * /leads/:id`: quem move PEDE, outra pessoa assina em /atendimento, e quem
 * pediu conclui com o token de uso único. Este arquivo guarda o pedido na aba
 * (sessionStorage, vence com a aprovação, em 10 min) e fala com as duas rotas.
 * Fica fora do page.tsx porque página do App Router não exporta nada além do
 * componente.
 */
import {
  COMERCIAL_ETAPAS,
  COMERCIAL_ROTULO_DA_ETAPA,
  COMERCIAL_SAIDAS,
  destinoDoMover,
  type CartaoDoFunil,
  type ComercialDestinoDoMover,
  type ComercialEtapa,
  type ComercialPedidoDeMover,
  type ComercialResultadoDoMover,
} from '@mktos/shared';

import { API_BASE, ErroDaApi, apiPost, erroDaResposta } from '@/lib/api';

const CHAVE = (leadId: string) => `comercial.mover.${leadId}`;

/** Os pedidos desta aba ainda dentro do prazo, por lead. O vencido some. */
export function lerPedidos(agora = Date.now()): Record<string, ComercialPedidoDeMover> {
  const saida: Record<string, ComercialPedidoDeMover> = {};
  if (typeof window === 'undefined') return saida;
  for (let i = 0; i < window.sessionStorage.length; i++) {
    const k = window.sessionStorage.key(i);
    if (!k?.startsWith('comercial.mover.')) continue;
    try {
      const p = JSON.parse(window.sessionStorage.getItem(k) ?? '') as ComercialPedidoDeMover & { leadId?: string };
      if (new Date(p.expiraEm).getTime() > agora && p.leadId) saida[p.leadId] = p;
    } catch {
      /* linha ilegível: ignora */
    }
  }
  return saida;
}

export function guardarPedido(leadId: string, p: ComercialPedidoDeMover): void {
  window.sessionStorage.setItem(CHAVE(leadId), JSON.stringify({ ...p, leadId }));
}

export function esquecerPedido(leadId: string): void {
  window.sessionStorage.removeItem(CHAVE(leadId));
}

/** O rótulo curto da coluna ("E3", "Saídas"). */
export function rotuloCurto(etapa: ComercialEtapa | 'saidas'): string {
  return etapa === 'saidas' ? 'Saídas' : COMERCIAL_ROTULO_DA_ETAPA[etapa].split(' · ')[0];
}

/** As opções do menu "Mover para": cada etapa ativa e cada saída, com o porquê das desligadas. */
export function opcoesDoMenu(c: Pick<CartaoDoFunil, 'etapa' | 'voltaPara'>): ComercialDestinoDoMover[] {
  return [...COMERCIAL_ETAPAS, ...COMERCIAL_SAIDAS].filter((e) => e !== c.etapa).map((e) => destinoDoMover(c.etapa, e, c.voltaPara ?? null));
}

/** Soltar na coluna: a coluna "Saídas" leva ao registro de saída; as outras, ao destino da etapa. */
export function destinoDaColuna(c: Pick<CartaoDoFunil, 'etapa' | 'voltaPara'>, coluna: ComercialEtapa | 'saidas'): ComercialDestinoDoMover {
  if (coluna === 'saidas') {
    const d = destinoDoMover(c.etapa, 'perdido', c.voltaPara ?? null);
    return d.permitido ? { ...d, caminho: 'saida' } : d;
  }
  return destinoDoMover(c.etapa, coluna, c.voltaPara ?? null);
}

export function pedirMudanca(leadId: string, para: ComercialEtapa, token: string | null): Promise<ComercialPedidoDeMover> {
  return apiPost<ComercialPedidoDeMover>(`/comercial/lead/${leadId}/mover/pedido`, { para }, token);
}

/**
 * Conclui com o token de uso único. A assinatura que ainda não veio responde
 * 403 e o pedido FICA (dá para tentar de novo); vencido, usado ou recusado, o
 * pedido sai da aba.
 */
export async function concluirMudanca(leadId: string, p: ComercialPedidoDeMover, token: string | null): Promise<ComercialResultadoDoMover> {
  const res = await fetch(`${API_BASE}/comercial/lead/${leadId}/mover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-approval-token': p.token, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ para: p.para }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const erro = erroDaResposta(body, res.status);
    if (!/não confirmada/i.test(erro.message)) esquecerPedido(leadId);
    throw erro;
  }
  esquecerPedido(leadId);
  return res.json();
}

/** A frase da assinatura que ainda não veio, traduzida para quem clicou. */
export function fraseDoErro(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? '');
  if (/não confirmada/i.test(m)) return 'A assinatura ainda não veio: outra pessoa precisa confirmar em /atendimento. O pedido continua de pé.';
  if (/expirada/i.test(m)) return 'O pedido venceu sem assinatura. Peça de novo.';
  if (/uso único/i.test(m)) return 'Este pedido já foi usado. Releia o funil.';
  const detalhes = e instanceof ErroDaApi && e.detalhes.length ? `: ${e.detalhes.join('; ')}` : '';
  return `${m || 'Não deu para mover agora.'}${detalhes}`;
}

/** Data do formulário (AAAA-MM-DD) para o instante que a saída pede (meio-dia em São Paulo). */
export function voltaEmDoDia(dia: string): string {
  return `${dia}T12:00:00-03:00`;
}
