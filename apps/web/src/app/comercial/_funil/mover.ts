/*
 * MOVER O CARTÃO DO FUNIL (rodada do painel P5, 18/10/2026; sem limitação desde
 * a rodada da interface U4, 20/10/2026; fluido na leva 5, L5, 27/10/2026) — a
 * parte sem tela.
 *
 * Decisão do dono do produto (20/10/2026): a pessoa com `leads.editar` move o
 * lead para QUALQUER etapa, por arrasto ou pelo menu "Mover para", direto, sem
 * pedido nem assinatura de outra pessoa. A tela diz só a mensagem que a API
 * devolve ("Movido para…", e "sem as conclusões de…" quando ficou portão para
 * trás). Saída leva o motivo no mesmo gesto, sem trava.
 *
 * LEVA 5 (L5): o cartão ANDA NA HORA (estado local por cima do que a API deu)
 * e volta se a API negar; a coluna não recarrega inteira, o cartão é refeito
 * com a resposta do mover. Para E8 e E9 o arrasto e o menu abrem a confirmação
 * com o aviso que a regra já tem (`COMERCIAL_ETAPAS_DE_SISTEMA`), em vez de
 * mover sem dizer nada. `mover.service.ts` e a regra de aprovação não mudam.
 *
 * Fica fora do page.tsx porque página do App Router não exporta nada além do componente.
 */
import {
  COMERCIAL_ETAPAS,
  COMERCIAL_ETAPAS_DE_SISTEMA,
  COMERCIAL_ROTULO_DA_ETAPA,
  COMERCIAL_SAIDAS,
  destinoDoMover,
  ehSaida,
  type CartaoDoFunil,
  type ComercialDestinoDoMover,
  type ComercialEtapa,
  type ComercialMoverInput,
  type ComercialPedidoDeMover,
  type ComercialResultadoDoMover,
  type FunilVivo,
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

/**
 * L5: E8 e E9 nascem de efeito de sistema (aceite, fechamento). Mover à mão
 * para elas vale, mas pede a confirmação com o aviso da regra em vez de
 * acontecer calado no arrasto. As saídas já pedem o motivo; as outras etapas
 * vão direto.
 */
export function precisaDeConfirmacao(d: ComercialDestinoDoMover): boolean {
  return d.permitido && d.caminho === 'mover' && d.para in COMERCIAL_ETAPAS_DE_SISTEMA;
}

/** O aviso que a confirmação de E8/E9 mostra. */
export function avisoDaConfirmacao(d: ComercialDestinoDoMover): string {
  return COMERCIAL_ETAPAS_DE_SISTEMA[d.para] ?? d.dica ?? '';
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

// ---------------------------------------------------------------------------
// L5 · o estado local do funil: o cartão anda na hora
// ---------------------------------------------------------------------------

/** Os cartões que a tela moveu e a API ainda não devolveu na lista, por lead. */
export type MovimentosLocais = Record<string, CartaoDoFunil>;

/**
 * O cartão como fica logo que a pessoa solta (otimista): na etapa de destino,
 * recém-chegado, sem o balão e o aviso antigos (a resposta da API os refaz).
 */
export function cartaoOtimista(c: CartaoDoFunil, para: ComercialEtapa, agora = new Date()): CartaoDoFunil {
  return {
    ...c,
    etapa: para,
    etapaDesde: agora.toISOString(),
    diasNaEtapa: 0,
    parado: false,
    voltaPara: para === 'geladeira' && !ehSaida(c.etapa) ? (c.etapa as CartaoDoFunil['voltaPara']) : null,
    balao: null,
    avisoDoMover: null,
    // Fora da saída, o motivo e a volta não valem mais; na saída, quem os sabe é a API (a resposta refaz).
    ...(ehSaida(para) ? {} : { motivoSaida: null, voltaEm: null }),
  };
}

/** O cartão refeito com a resposta do mover: a etapa gravada, o balão e o aviso que a API devolveu. */
export function cartaoDepoisDoMover(c: CartaoDoFunil, r: ComercialResultadoDoMover, agora = new Date()): CartaoDoFunil {
  const base = cartaoOtimista(c, r.para, agora);
  return {
    ...base,
    balao: r.balao ?? null,
    avisoDoMover: r.aviso ? { texto: r.aviso, por: null, em: agora.toISOString() } : null,
  };
}

/**
 * As colunas da tela: as da API com os movimentos locais por cima. O cartão
 * movido sai da coluna onde a API o tinha e entra no fim da coluna de destino
 * (o mais novo na etapa fica embaixo, como a API ordena).
 */
export function aplicarMovimentosLocais(colunas: FunilVivo['colunas'], locais: MovimentosLocais): FunilVivo['colunas'] {
  const ids = Object.keys(locais);
  if (!ids.length) return colunas;
  // Só sai da coluna antiga quem tem coluna de destino na tela (uma leitura filtrada pode não trazer todas).
  const colunaDe = (c: CartaoDoFunil) => colunas.find((x) => x.etapa === (ehSaida(c.etapa) ? 'saidas' : c.etapa));
  const movidos = new Set(ids.filter((id) => colunaDe(locais[id])));
  if (!movidos.size) return colunas;
  const semOsMovidos = colunas.map((col) => ({ ...col, cartoes: (col.cartoes ?? []).filter((c) => !movidos.has(c.leadId)) }));
  for (const c of Object.values(locais)) {
    if (!movidos.has(c.leadId)) continue;
    const destino = ehSaida(c.etapa) ? 'saidas' : c.etapa;
    const col = semOsMovidos.find((x) => x.etapa === destino);
    if (col) col.cartoes = [...col.cartoes, c];
  }
  return semOsMovidos;
}

/**
 * Quando a lista da API já traz o cartão na etapa para onde a tela o levou, o
 * movimento local cumpriu o papel e sai (o servidor é a verdade). O que a API
 * ainda mostra na etapa antiga (uma leitura que saiu antes do mover) fica por
 * cima, para o cartão não voltar e piscar.
 */
export function locaisQueAindaValem(colunas: FunilVivo['colunas'], locais: MovimentosLocais): MovimentosLocais {
  const doServidor = new Map(colunas.flatMap((c) => c.cartoes ?? []).map((c) => [c.leadId, c.etapa]));
  const restam: MovimentosLocais = {};
  for (const [leadId, c] of Object.entries(locais)) {
    const etapaNoServidor = doServidor.get(leadId);
    if (etapaNoServidor === undefined) continue; // o cartão saiu da leitura (filtro, teto): nada a sobrepor
    if (etapaNoServidor !== c.etapa) restam[leadId] = c;
  }
  return restam;
}
