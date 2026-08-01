import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PromptCopiavel, ComandoCopiavel } from "@/central/components/blocos/Copiavel";
import { LinkExterno } from "@/central/components/blocos/LinkExterno";
import { RenderBlocos } from "@/central/components/blocos/RenderBlocos";

describe("PromptCopiavel", () => {
  it("copia o conteúdo e mostra feedback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<PromptCopiavel rotulo="teste" conteudo={"linha 1\nlinha 2"} />);
    await userEvent.click(screen.getByRole("button", { name: /copiar teste/i }));

    expect(writeText).toHaveBeenCalledWith("linha 1\nlinha 2");
    expect(await screen.findByText("Copiado")).toBeInTheDocument();
  });

  it("preserva quebras de linha no conteúdo exibido", () => {
    render(<PromptCopiavel rotulo="quebras" conteudo={"a\nb"} />);
    const pre = screen.getByText(/a\s*b/);
    expect(pre.tagName).toBe("PRE");
  });
});

describe("ComandoCopiavel", () => {
  it("mostra o aviso de segurança quando existe", () => {
    render(<ComandoCopiavel linguagem="bash" conteudo="mkdir x" aviso="Cria uma pasta." />);
    expect(screen.getByText("Cria uma pasta.")).toBeInTheDocument();
  });
});

describe("LinkExterno", () => {
  it("mostra o domínio de destino e usa rel de segurança", () => {
    render(<LinkExterno label="Documentação" href="https://obsidian.md/download" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByText("obsidian.md")).toBeInTheDocument();
    expect(screen.getByText("(abre em nova aba)")).toBeInTheDocument();
  });
});

describe("RenderBlocos", () => {
  it("renderiza passo com número, título e sub", () => {
    render(
      <RenderBlocos
        blocos={[
          {
            tipo: "passo",
            n: 1,
            titulo: "Primeiro passo",
            sub: "o começo",
            blocos: [{ tipo: "texto", conteudo: "conteúdo interno" }],
          },
        ]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Primeiro passo" })).toBeInTheDocument();
    expect(screen.getByText("conteúdo interno")).toBeInTheDocument();
  });

  it("renderiza callout de risco com título", () => {
    render(
      <RenderBlocos
        blocos={[{ tipo: "callout", variante: "risco", titulo: "Cuidado:", conteudo: "perigo real" }]}
      />,
    );
    expect(screen.getByText("Cuidado:")).toBeInTheDocument();
    expect(screen.getByText("perigo real")).toBeInTheDocument();
  });

  it("renderiza lista com letras", () => {
    render(
      <RenderBlocos blocos={[{ tipo: "lista", estilo: "letras", itens: ["um", "dois"] }]} />,
    );
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });
});
