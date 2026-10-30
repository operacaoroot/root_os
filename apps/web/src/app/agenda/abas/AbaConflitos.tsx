'use client';

/*
 * A ABA CONFLITOS (agenda v2, 29/10/2026, lane G5) — desenho `Conflitos`.
 * ESQUELETO DA LANE 0: a lane G5 implementa. A página (`../page.tsx`, lane G3)
 * só a monta; quem pede uma escrita aqui usa `POST /agenda/escritas`.
 */
export interface PropsDaAbaConflitos {
  /** Abre o painel de editar no compromisso (o "Remarcar…" do cartão). */
  aoRemarcar?: (eventoId: string) => void;
  /** Depois de uma escrita, a página recarrega a semana. */
  aoMudar?: () => void;
}

export function AbaConflitos(_props: PropsDaAbaConflitos) {
  return <p className="text-sm text-[var(--os-mut)]">Conflitos: em construção.</p>;
}
