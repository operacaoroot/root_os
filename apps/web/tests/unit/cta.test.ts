import { describe, expect, it } from "vitest";
import { ctaPorTipo, rotuloTipo } from "@/central/lib/cta";
import { todosMateriais } from "@/central/data";

describe("CTA por tipo", () => {
  it("todo tipo usado no catálogo tem CTA e rótulo próprios", () => {
    for (const m of todosMateriais) {
      expect(ctaPorTipo[m.tipo], `CTA de ${m.tipo}`).toBeTruthy();
      expect(rotuloTipo[m.tipo], `rótulo de ${m.tipo}`).toBeTruthy();
    }
  });

  it("nenhum CTA genérico repetido pra tipos diferentes", () => {
    const valores = Object.values(ctaPorTipo);
    expect(new Set(valores).size).toBe(valores.length);
  });
});
