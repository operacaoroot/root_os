// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { gravarStorage, lerStorage, storageDisponivel } from "@/central/lib/storage";

beforeEach(() => {
  window.localStorage.clear();
});

describe("storage seguro", () => {
  it("grava e lê com envelope de versão", () => {
    expect(gravarStorage("teste", ["a", "b"])).toBe(true);
    expect(lerStorage<string[]>("teste", [])).toEqual(["a", "b"]);
    const cru = window.localStorage.getItem("root-central:teste");
    expect(JSON.parse(cru!)).toHaveProperty("v");
  });

  it("devolve o padrão quando a chave não existe", () => {
    expect(lerStorage("inexistente", "padrao")).toBe("padrao");
  });

  it("descarta versão desconhecida (migração segura)", () => {
    window.localStorage.setItem("root-central:velho", JSON.stringify({ v: 999, dados: ["x"] }));
    expect(lerStorage<string[]>("velho", [])).toEqual([]);
  });

  it("não explode com JSON corrompido", () => {
    window.localStorage.setItem("root-central:ruim", "{quebrado");
    expect(lerStorage("ruim", "ok")).toBe("ok");
  });

  it("storageDisponivel detecta ambiente são", () => {
    expect(storageDisponivel()).toBe(true);
  });
});
