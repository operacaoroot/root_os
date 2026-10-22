'use client';

import type { ConversaDaCaixa } from '@mktos/shared';

/*
 * O VÍNCULO DA CONVERSA no cabeçalho da caixa de WhatsApp (produção 22C, W3).
 * CONTRATO: a caixa (lane B) embute este componente; a lane C o preenche com
 * o link para o lead ou a ficha do cliente, a sugestão de um clique e as ações
 * Vincular a lead, Vincular a cliente e Desvincular. `aoMudar` é chamado depois
 * de qualquer mudança, para a caixa reler a conversa.
 */
export function VinculoDaConversa({ conversa }: { conversa: ConversaDaCaixa; podeVincular: boolean; aoMudar: () => void | Promise<void> }) {
  if (conversa.vinculo) {
    return (
      <span data-testid="whats-vinculo" className="text-xs text-text-dim">
        {conversa.vinculo.tipo === 'lead' ? 'Lead' : 'Cliente'}: {conversa.vinculo.nome}
      </span>
    );
  }
  return (
    <span data-testid="whats-vinculo" className="text-xs text-text-dim">
      {conversa.equipe ? 'Equipe' : 'sem vínculo'}
    </span>
  );
}
