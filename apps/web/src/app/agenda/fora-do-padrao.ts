import type { ForaDoPadraoDaAgenda, ItemForaDoPadrao } from '@mktos/shared';

/*
 * O VIGIA DA AGENDA NA TELA (AG-01, rodada dos agentes, 21/10/2026) — a parte pura.
 *
 * O selo "N fora do padrão" e o que cada linha da lista diz e oferece. Puro para
 * a suíte (`tests/unit/agenda-vigia.test.ts`) prender as três frases que
 * importam: o selo não diz zero quando não sabe; a correção NÃO sai no clique
 * (vai à fila de aprovações); e quem confirma depende de quem propôs.
 */

/**
 * O texto do selo, ou `null` quando ele não aparece. Não sabe (a lista não
 * chegou, ou falhou) → `null`, nunca "0": zero é a leitura que faz a pessoa não
 * abrir a lista, e seria falso. Zero de verdade também não desenha selo.
 */
export function textoDoSelo(dados: ForaDoPadraoDaAgenda | null | undefined): string | null {
  if (!dados || typeof dados.total !== 'number' || !Number.isFinite(dados.total) || dados.total <= 0) return null;
  return `${dados.total} fora do padrão`;
}

/** O título proposto como a tela mostra: com "+ Meet" quando a correção acrescenta a sala. */
export function rotuloDaProposta(item: Pick<ItemForaDoPadrao, 'tituloProposto' | 'adicionarMeet'>): string | null {
  if (!item.tituloProposto) return null;
  return item.adicionarMeet ? `${item.tituloProposto} + Meet` : item.tituloProposto;
}

/** De onde veio a proposta, em palavras. */
export function origemDaProposta(item: Pick<ItemForaDoPadrao, 'origem'>): string | null {
  if (item.origem === 'gramatica') return 'pela gramática da casa';
  if (item.origem === 'modelo') return 'pelo vigia (modelo), conferida pela gramática';
  if (item.origem === 'pessoa') return 'por uma pessoa, na pendência';
  return null;
}

/** Em que pé está a correção — uma frase, sem jargão. */
export function situacaoDoItem(item: ItemForaDoPadrao): string {
  if (item.estado === 'pendencia') return 'O vigia não teve proposta segura: qual é o cliente?';
  const a = item.aprovacao;
  if (!a) {
    return 'Proposta pronta, ainda fora da fila: ela vai na próxima passagem do vigia dentro da janela das 08h às 20h, ou peça aqui.';
  }
  if (a.status === 'pendente') {
    return a.propostaPor === 'vigia'
      ? 'Na fila de aprovações, proposta pelo vigia: qualquer pessoa com alçada confirma.'
      : 'Na fila de aprovações: espera a confirmação de OUTRA pessoa com alçada (quem pediu não confirma).';
  }
  if (a.status === 'expirada') return 'A aprovação venceu sem confirmação: peça de novo.';
  if (a.status === 'rejeitada') return 'A correção foi recusada na fila de aprovações.';
  return 'A correção foi confirmada; a agenda é relida na próxima passagem do vigia.';
}

export type AcaoDoItem =
  | { tipo: 'pedir'; rotulo: string }
  | { tipo: 'fila'; rotulo: string; href: string }
  | { tipo: 'responder' }
  | { tipo: 'nenhuma'; motivo: string };

/**
 * O botão de cada linha. "Aprovar aqui" leva à MESMA porta: com aprovação viva
 * na fila, o lugar de confirmar é a fila; sem ela, o clique pede a correção (e
 * a tela diz que ela espera a segunda pessoa).
 */
export function acaoDoItem(item: ItemForaDoPadrao, podeEditar: boolean, fila = '/atendimento'): AcaoDoItem {
  if (item.estado === 'pendencia') return item.pendencia ? { tipo: 'responder' } : { tipo: 'nenhuma', motivo: 'a pendência já foi decidida' };
  if (item.estado !== 'proposta' || !item.tituloProposto) return { tipo: 'nenhuma', motivo: 'nada a corrigir' };
  if (item.aprovacao?.status === 'pendente') return { tipo: 'fila', rotulo: 'Abrir na fila de aprovações', href: fila };
  if (!podeEditar) return { tipo: 'nenhuma', motivo: 'pedir a correção exige a permissão de marcar reunião' };
  return { tipo: 'pedir', rotulo: 'Aprovar aqui' };
}

/** O que a tela diz depois do clique em "Aprovar aqui" (a resposta de `POST /agenda/padronizar/:id`). */
export function mensagemDoPedido(r: { status?: string; jaNaFila?: boolean; precisaDeOutraPessoa?: boolean; mensagem?: string } | null | undefined): string {
  if (r?.status === 'aguardando_aprovacao') {
    if (r.jaNaFila && !r.precisaDeOutraPessoa) {
      return 'O vigia já pôs esta correção na fila de aprovações: confirme lá. Nada mudou na agenda ainda.';
    }
    return 'Foi para a fila de aprovações e espera a confirmação de OUTRA pessoa com alçada. Nada mudou na agenda ainda.';
  }
  return 'Corrigido na agenda.';
}
