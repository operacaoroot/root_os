'use client';

/*
 * O HISTÓRICO DO QUE O OS GRAVOU NO GOOGLE (agenda v2, 29/10/2026, lane G4),
 * com "desfazer" onde existe. Lido de `GET /agenda/historico` (o RASTRO da porta).
 * Mora na aba Conflitos (desenho) e pode aparecer no detalhe do compromisso.
 * ESQUELETO DA LANE 0: a lane G4 implementa.
 */
export interface PropsDoHistorico {
  /** Só as linhas de um evento (no detalhe). */
  eventoId?: string;
  limite?: number;
  aoMudar?: () => void;
}

export function Historico(_props: PropsDoHistorico) {
  return null;
}
