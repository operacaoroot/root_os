import { describe, expect, it } from "vitest";
import {
  categoriaPorId,
  categorias,
  materialPorCodigo,
  materialPorId,
  relacionadosDe,
  todosMateriais,
  trilhas,
} from "@/central/data";
import { situacaoDe, ativo } from "@/central/lib/frescor";

/* O import de @/data já roda a validação Zod + unicidade — se chegou aqui, passou. */

describe("catálogo", () => {
  it("valida no import sem lançar", () => {
    expect(todosMateriais.length).toBeGreaterThan(0);
  });

  it("toda categoria referenciada existe", () => {
    for (const m of todosMateriais) {
      expect(categoriaPorId(m.categoriaId), `categoria de ${m.slug}`).toBeDefined();
    }
  });

  it("todo relacionado aponta pra material existente", () => {
    for (const m of todosMateriais) {
      for (const id of m.relacionados ?? []) {
        expect(materialPorId(id), `relacionado ${id} de ${m.slug}`).toBeDefined();
      }
    }
  });

  it("toda trilha só referencia materiais existentes", () => {
    for (const t of trilhas) {
      for (const item of t.itens) {
        expect(materialPorId(item.materialId), `item de ${t.slug}`).toBeDefined();
      }
    }
  });

  it("resgate por código é case/acento-insensível", () => {
    expect(materialPorCodigo("vault")?.slug).toBe("memoria-permanente-com-obsidian");
    expect(materialPorCodigo("VAULT")?.slug).toBe("memoria-permanente-com-obsidian");
    expect(materialPorCodigo("NAOEXISTE")).toBeUndefined();
  });

  it("há 8 categorias ordenadas", () => {
    expect(categorias).toHaveLength(8);
    expect(categorias.map((c) => c.ordem)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("frescor derivado", () => {
  const agora = new Date("2026-08-01");

  it("verificado há pouco → verificado", () => {
    const m = materialPorId("m01")!;
    expect(situacaoDe(m, agora)).toBe("verificado");
  });

  it("verificação antiga → atualizado ou requer-revisao", () => {
    const m = materialPorId("m12")!; // verificado em 10/06
    expect(situacaoDe(m, agora)).toBe("atualizado");
  });

  it("sem verificação há 90+ dias → requer-revisao", () => {
    const m = materialPorId("m03")!; // publicado 20/04, nunca verificado
    expect(situacaoDe(m, agora)).toBe("requer-revisao");
  });

  it("descontinuado manual vence tudo", () => {
    const m = materialPorId("m29")!;
    expect(situacaoDe(m, agora)).toBe("descontinuado");
  });
});

describe("drip (ativoEm)", () => {
  it("material sem ativoEm está sempre ativo", () => {
    expect(ativo(materialPorId("m01")!, new Date("2026-01-01"))).toBe(true);
  });
});

describe("relacionados", () => {
  it("devolve no máximo o pedido e nunca o próprio material", () => {
    const m = materialPorId("m01")!;
    const r = relacionadosDe(m, 3);
    expect(r.length).toBeLessThanOrEqual(3);
    expect(r.every((x) => x.id !== m.id)).toBe(true);
  });

  it("completa por categoria/tags quando os declarados não bastam", () => {
    const m = materialPorId("m29")!; // só 1 relacionado declarado
    const r = relacionadosDe(m, 3);
    expect(r.length).toBeGreaterThanOrEqual(1);
  });
});
