import type { Material, Situacao } from "@/central/types";

const DIA = 24 * 60 * 60 * 1000;

/**
 * Situação derivada de datas, não digitada à mão:
 * verificado ≤30d · atualizado ≤90d · requer-revisao >90d · descontinuado = manual.
 */
export function situacaoDe(m: Material, agora: Date = new Date()): Situacao {
  if (m.descontinuado) return "descontinuado";
  const ref = m.verificadoEm ?? m.publicadoEm;
  const dias = Math.floor((agora.getTime() - new Date(ref).getTime()) / DIA);
  if (dias <= 30) return "verificado";
  if (dias <= 90) return "atualizado";
  return "requer-revisao";
}

export const rotuloSituacao: Record<Situacao, string> = {
  verificado: "Verificado",
  atualizado: "Atualizado",
  "requer-revisao": "Requer revisão",
  descontinuado: "Descontinuado",
};

/** Material só aparece no catálogo a partir de `ativoEm` (drip do reel). */
export function ativo(m: Material, agora: Date = new Date()): boolean {
  return !m.ativoEm || new Date(m.ativoEm).getTime() <= agora.getTime();
}
