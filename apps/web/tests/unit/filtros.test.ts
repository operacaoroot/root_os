import { describe, expect, it } from "vitest";
import {
  aplicarFiltros,
  contarAtivos,
  filtrosParaQuery,
  filtrosVazios,
  ordenar,
  queryParaFiltros,
} from "@/central/lib/filtros";
import { materiaisAtivos } from "@/central/data";

const AGORA = new Date("2026-08-01");
const catalogo = materiaisAtivos(AGORA);

describe("aplicarFiltros", () => {
  it("filtra por categoria", () => {
    const r = aplicarFiltros(catalogo, { ...filtrosVazios, categoria: "memoria" }, AGORA);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((m) => m.categoriaId === "memoria")).toBe(true);
  });

  it("combina tipo + custo", () => {
    const r = aplicarFiltros(
      catalogo,
      { ...filtrosVazios, tipos: ["tutorial"], custos: ["gratuito"] },
      AGORA,
    );
    expect(r.every((m) => m.tipo === "tutorial" && m.custo === "gratuito")).toBe(true);
  });

  it("filtra por nível", () => {
    const r = aplicarFiltros(catalogo, { ...filtrosVazios, niveis: ["avancado"] }, AGORA);
    expect(r.every((m) => m.nivel === "avancado")).toBe(true);
  });

  it("filtro vazio devolve tudo", () => {
    expect(aplicarFiltros(catalogo, filtrosVazios, AGORA)).toHaveLength(catalogo.length);
  });
});

describe("ordenar", () => {
  it("recentes: mais novo primeiro", () => {
    const r = ordenar(catalogo, "recentes");
    for (let i = 1; i < r.length; i++) {
      expect(new Date(r[i - 1]!.publicadoEm).getTime()).toBeGreaterThanOrEqual(
        new Date(r[i]!.publicadoEm).getTime(),
      );
    }
  });

  it("alfabética respeita pt-BR", () => {
    const r = ordenar(catalogo, "alfabetica");
    const cards = r.map((m) => m.card);
    expect(cards).toEqual([...cards].sort((a, b) => a.localeCompare(b, "pt-BR")));
  });

  it("menor duração primeiro", () => {
    const r = ordenar(catalogo, "menor-duracao");
    const comTempo = r.filter((m) => m.minutosEstimados);
    for (let i = 1; i < comTempo.length; i++) {
      expect(comTempo[i - 1]!.minutosEstimados!).toBeLessThanOrEqual(
        comTempo[i]!.minutosEstimados!,
      );
    }
  });

  it("não muta o array original", () => {
    const antes = [...catalogo];
    ordenar(catalogo, "alfabetica");
    expect(catalogo).toEqual(antes);
  });
});

describe("filtros ⇄ URL (round-trip)", () => {
  it("serializa e volta igual", () => {
    const f = {
      ...filtrosVazios,
      busca: "memória",
      categoria: "memoria",
      tipos: ["tutorial" as const, "prompt" as const],
      niveis: ["iniciante" as const],
      ordenacao: "alfabetica" as const,
    };
    const q = filtrosParaQuery(f);
    const volta = queryParaFiltros(q);
    expect(volta).toEqual(f);
  });

  it("ignora valores inválidos na URL", () => {
    const q = new URLSearchParams("tipo=hack,tutorial&nivel=deus&ordem=aleatoria");
    const f = queryParaFiltros(q);
    expect(f.tipos).toEqual(["tutorial"]);
    expect(f.niveis).toEqual([]);
    expect(f.ordenacao).toBe("recentes");
  });

  it("filtros vazios geram URL limpa", () => {
    expect(filtrosParaQuery(filtrosVazios).toString()).toBe("");
  });
});

describe("contarAtivos", () => {
  it("conta só o que está ativo (busca não conta)", () => {
    expect(contarAtivos(filtrosVazios)).toBe(0);
    expect(
      contarAtivos({ ...filtrosVazios, busca: "x", categoria: "memoria", tipos: ["tutorial"] }),
    ).toBe(2);
  });
});
