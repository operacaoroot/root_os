import { API_BASE, apiPost, erroDaResposta } from '@/lib/api';

// Publicar uma peça é escrita sensível: o backend exige um x-approval-token
// confirmado e casado com a mudança exata (ver ApprovalGuard). O fluxo é
// propor → confirmar → executar, e os três passos são deste helper porque o
// cliente genérico (lib/api.ts) não manda header extra.

/*
 * ============================================================================
 * ESTE FLUXO NÃO FUNCIONA HOJE — regressão DECLARADA, medida em 11/09/2026
 * ============================================================================
 *
 * Os três passos abaixo saem da MESMA sessão, com o MESMO usuário. O passo 1
 * grava quem clicou como PROPONENTE; o passo 2 pede a assinatura à mesma
 * pessoa, e `ApprovalsService.confirm` recusa — invariante 7 da escada, quem
 * propôs não aprova. A regra entrou em 29/08/2026 (commit `3adfdc1`) e este
 * arquivo é anterior a ela.
 *
 * Há uma segunda causa, independente e mais antiga: a rota do passo 3 exige
 * `pauta.publicar` E `whatsapp.enviar` juntas, e a segunda mora só no Admin
 * Master — os perfis que publicam no produto (Gestor de Marketing, Social
 * Media) não a têm.
 *
 * O CONSERTO APONTADO é propor EM NOME DO AGENTE, não da pessoa que clicou:
 * quem propõe ali é o sistema derivando a peça, e quem assina é a pessoa. Ele
 * mora na API (`approvals.service.ts` / `approvals.controller.ts`) e é decisão
 * de produto — muda quem pode publicar sozinho. NÃO se conserta afrouxando a
 * separação de funções.
 *
 * As duas causas estão travadas por `apps/api/test/publicar-peca.test.ts`, que
 * fica VERMELHO no dia em que qualquer uma for arrumada. Enquanto isso, o que
 * este arquivo pode fazer é não mentir: a recusa do passo 2 vira uma frase que
 * explica o que aconteceu, em vez do erro cru da API.
 */

interface Ticket {
  approvalId: string;
  token: string;
  summary: string;
  expiresAt: string;
}

export async function publicarComAprovacao(
  pecaId: string,
  resumo: string,
  token: string | null,
): Promise<{ ok: true; canal: string }> {
  const changes = { status: 'publicada' };

  const ticket = await apiPost<Ticket>(
    '/approvals',
    { resourceType: 'content', resourceId: pecaId, changes, summary: resumo },
    token,
  );
  try {
    await apiPost(`/approvals/${ticket.approvalId}/confirm`, {}, token);
  } catch (e) {
    /*
     * A recusa esperada (ver o bloco no topo). Sem esta tradução, quem clica
     * em "publicar" recebe "Quem propôs a ação não pode aprová-la" e vai
     * procurar um problema de permissão que não existe — o problema é que a
     * tela pede a assinatura a quem acabou de propor.
     */
    const frase = (e as Error).message ?? '';
    if (/propôs a ação não pode aprová-la/i.test(frase)) {
      throw new Error(
        'Publicar pela tela está bloqueado: o OS registra VOCÊ como quem propôs a publicação e, ' +
          'logo depois, pede a sua assinatura — e quem propõe não assina. É um defeito conhecido ' +
          'do fluxo (a proposta deveria sair em nome do agente), não uma falta de permissão sua. ' +
          'Até o conserto, publique pela fila de aprovações com duas pessoas.',
      );
    }
    throw e;
  }

  const res = await fetch(`${API_BASE}/pauta/pecas/${pecaId}/publicar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-approval-token': ticket.token,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(changes),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // Mesmo tradutor do cliente genérico: este `fetch` é feito à mão só por
    // causa do header `x-approval-token`, e não pode perder o código da recusa
    // no caminho — é ele que faz a tela oferecer Conexões (RF-G-06).
    throw erroDaResposta(body, res.status);
  }
  return res.json();
}
