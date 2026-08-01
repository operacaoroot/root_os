import { describe, expect, it } from "vitest";
import { buscar, normalizar, quaseIgual, singular } from "@/central/lib/busca";
import { materiaisAtivos, todosMateriais } from "@/central/data";

describe("normalizar", () => {
  it("remove acentos e caixa", () => {
    expect(normalizar("MEMÓRIA")).toBe("memoria");
    expect(normalizar("  Automação ")).toBe("automacao");
  });
  it("remove aspas", () => {
    expect(normalizar('"vault"')).toBe("vault");
  });
});

describe("singular", () => {
  it("reduz plural simples", () => {
    expect(singular("skills")).toBe("skill");
    expect(singular("tokens")).toBe("token");
  });
});

describe("quaseIgual (tolerância a erro de digitação)", () => {
  it("aceita um caractere trocado em termos longos", () => {
    expect(quaseIgual("vaultt", "vault")).toBe(true);
    expect(quaseIgual("tokems", "tokens")).toBe(true);
  });
  it("não aceita em termos curtos", () => {
    expect(quaseIgual("mcp", "mpc")).toBe(false);
  });
  it("não aceita dois erros", () => {
    expect(quaseIgual("vaalts", "vault")).toBe(false);
  });
});

describe("buscar — 3 camadas", () => {
  const catalogo = materiaisAtivos(new Date("2026-08-01"));

  it("camada 1: código exato abre um único material", () => {
    const r = buscar("VAULT", catalogo);
    expect(r.camada).toBe("codigo");
    expect(r.materiais).toHaveLength(1);
    expect(r.materiais[0]?.slug).toBe("memoria-permanente-com-obsidian");
  });

  it("camada 1: código com acento/caixa diferente ainda acha", () => {
    const r = buscar("vault", catalogo);
    expect(r.camada).toBe("codigo");
  });

  it("camada 2: alias acha lista", () => {
    const r = buscar("obsidian", catalogo);
    expect(r.camada).toBe("termo");
    expect(r.materiais.length).toBeGreaterThan(0);
  });

  it("camada 3: busca por problema (campo resolve)", () => {
    const r = buscar("a ia esquece tudo", catalogo);
    expect(r.camada).toBe("texto");
    expect(r.materiais.some((m) => m.categoriaId === "memoria")).toBe(true);
  });

  it("camada 3: busca por título parcial", () => {
    const r = buscar("landing page", catalogo);
    expect(r.materiais.some((m) => m.slug === "landing-page-em-uma-tarde")).toBe(true);
  });

  it("sem resultado: termo aleatório", () => {
    const r = buscar("xyzabc123", catalogo);
    expect(r.camada).toBe("nenhuma");
    expect(r.materiais).toHaveLength(0);
  });

  it("vazio: termo em branco", () => {
    expect(buscar("   ", catalogo).camada).toBe("nenhuma");
  });
});

describe("integridade do catálogo (a regra que a referência não tem)", () => {
  it("códigos são únicos", () => {
    const vistos = new Set<string>();
    for (const m of todosMateriais) {
      const chave = normalizar(m.codigo);
      expect(vistos.has(chave), `código duplicado: ${m.codigo}`).toBe(false);
      vistos.add(chave);
    }
  });

  it("catálogo tem volume de demonstração (24+)", () => {
    expect(todosMateriais.length).toBeGreaterThanOrEqual(24);
  });
});
