import { API_BASE, apiPost } from '@/lib/api';

// Publicar uma peça é escrita sensível: o backend exige um x-approval-token
// confirmado e casado com a mudança exata (ver ApprovalGuard). O fluxo é
// propor → confirmar → executar, e os três passos são deste helper porque o
// cliente genérico (lib/api.ts) não manda header extra.

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
  await apiPost(`/approvals/${ticket.approvalId}/confirm`, {}, token);

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
    throw new Error(body.message || body.error || `Erro ${res.status}`);
  }
  return res.json();
}
