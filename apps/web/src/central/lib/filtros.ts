import type { Custo, Material, Nivel, Situacao, TipoMaterial } from "@/central/types";
import { situacaoDe } from "@/central/lib/frescor";

export type Ordenacao =
  | "recentes"
  | "verificados"
  | "alfabetica"
  | "menor-duracao"
  | "destaques";

export interface Filtros {
  busca: string;
  categoria: string | null;
  tipos: TipoMaterial[];
  niveis: Nivel[];
  custos: Custo[];
  situacoes: Situacao[];
  ferramenta: string | null;
  ordenacao: Ordenacao;
}

export const filtrosVazios: Filtros = {
  busca: "",
  categoria: null,
  tipos: [],
  niveis: [],
  custos: [],
  situacoes: [],
  ferramenta: null,
  ordenacao: "recentes",
};

export function contarAtivos(f: Filtros): number {
  return (
    (f.categoria ? 1 : 0) +
    f.tipos.length +
    f.niveis.length +
    f.custos.length +
    f.situacoes.length +
    (f.ferramenta ? 1 : 0)
  );
}

export function aplicarFiltros(materiais: Material[], f: Filtros, agora?: Date): Material[] {
  return materiais.filter((m) => {
    if (f.categoria && m.categoriaId !== f.categoria) return false;
    if (f.tipos.length > 0 && !f.tipos.includes(m.tipo)) return false;
    if (f.niveis.length > 0 && !f.niveis.includes(m.nivel)) return false;
    if (f.custos.length > 0 && !f.custos.includes(m.custo)) return false;
    if (f.situacoes.length > 0 && !f.situacoes.includes(situacaoDe(m, agora))) return false;
    if (
      f.ferramenta &&
      !m.ferramentas.some((t) => t.toLowerCase() === f.ferramenta!.toLowerCase())
    )
      return false;
    return true;
  });
}

export function ordenar(materiais: Material[], ordem: Ordenacao): Material[] {
  const copia = [...materiais];
  switch (ordem) {
    case "recentes":
      return copia.sort(
        (a, b) => new Date(b.publicadoEm).getTime() - new Date(a.publicadoEm).getTime(),
      );
    case "verificados":
      return copia.sort(
        (a, b) =>
          new Date(b.verificadoEm ?? b.publicadoEm).getTime() -
          new Date(a.verificadoEm ?? a.publicadoEm).getTime(),
      );
    case "alfabetica":
      return copia.sort((a, b) => a.card.localeCompare(b.card, "pt-BR"));
    case "menor-duracao":
      return copia.sort((a, b) => (a.minutosEstimados ?? 999) - (b.minutosEstimados ?? 999));
    case "destaques":
      return copia.sort((a, b) => Number(b.destaque) - Number(a.destaque));
  }
}

/* ---------- filtros ⇄ URL (compartilhável) ---------- */

export function filtrosParaQuery(f: Filtros): URLSearchParams {
  const q = new URLSearchParams();
  if (f.busca) q.set("busca", f.busca);
  if (f.categoria) q.set("categoria", f.categoria);
  if (f.tipos.length) q.set("tipo", f.tipos.join(","));
  if (f.niveis.length) q.set("nivel", f.niveis.join(","));
  if (f.custos.length) q.set("custo", f.custos.join(","));
  if (f.situacoes.length) q.set("situacao", f.situacoes.join(","));
  if (f.ferramenta) q.set("ferramenta", f.ferramenta);
  if (f.ordenacao !== "recentes") q.set("ordem", f.ordenacao);
  return q;
}

function lista<T extends string>(valor: string | null, validos: readonly T[]): T[] {
  if (!valor) return [];
  return valor.split(",").filter((v): v is T => (validos as readonly string[]).includes(v));
}

const TIPOS: readonly TipoMaterial[] = [
  "tutorial",
  "prompt",
  "repositorio",
  "curso",
  "template",
  "automacao",
  "skill",
  "mcp",
  "ferramenta",
  "checklist",
  "estudo-de-caso",
];
const NIVEIS: readonly Nivel[] = ["iniciante", "intermediario", "avancado"];
const CUSTOS: readonly Custo[] = ["gratuito", "freemium", "pago"];
const SITUACOES: readonly Situacao[] = [
  "verificado",
  "atualizado",
  "requer-revisao",
  "descontinuado",
];
const ORDENS: readonly Ordenacao[] = [
  "recentes",
  "verificados",
  "alfabetica",
  "menor-duracao",
  "destaques",
];

export function queryParaFiltros(q: URLSearchParams): Filtros {
  const ordem = q.get("ordem");
  return {
    busca: q.get("busca") ?? "",
    categoria: q.get("categoria"),
    tipos: lista(q.get("tipo"), TIPOS),
    niveis: lista(q.get("nivel"), NIVEIS),
    custos: lista(q.get("custo"), CUSTOS),
    situacoes: lista(q.get("situacao"), SITUACOES),
    ferramenta: q.get("ferramenta"),
    ordenacao: ORDENS.includes(ordem as Ordenacao) ? (ordem as Ordenacao) : "recentes",
  };
}
