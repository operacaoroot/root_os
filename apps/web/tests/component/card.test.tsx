import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CardMaterial } from "@/central/components/materiais/CardMaterial";
import { materialPorId } from "@/central/data";
import { rotas } from "@/central/lib/rotas";

describe("CardMaterial", () => {
  const m = materialPorId("m01")!;

  it("mostra card, tagline, código e CTA específico do tipo", () => {
    render(<CardMaterial m={m} />);
    expect(screen.getAllByText(m.card).length).toBeGreaterThan(0);
    expect(screen.getByText(m.tagline)).toBeInTheDocument();
    expect(screen.getByText(m.codigo)).toBeInTheDocument(); // capa tipográfica
    expect(screen.getByText(/ver o passo a passo/i)).toBeInTheDocument(); // CTA de tutorial
  });

  it("link aponta pra página do material", () => {
    render(<CardMaterial m={m} />);
    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", rotas.material(m.slug));
  });

  it("favoritar alterna aria-pressed sem navegar", async () => {
    window.localStorage.clear();
    render(<CardMaterial m={m} />);
    const botao = screen.getByRole("button", { name: /salvar .* favoritos/i });
    expect(botao).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(botao);
    expect(botao).toHaveAttribute("aria-pressed", "true");
  });

  it("material descontinuado comunica o estado em texto (faixa + badge)", () => {
    const desc = materialPorId("m29")!;
    render(<CardMaterial m={desc} />);
    expect(screen.getAllByText("Descontinuado").length).toBeGreaterThanOrEqual(1);
  });
});
