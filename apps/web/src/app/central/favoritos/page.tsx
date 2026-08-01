import type { Metadata } from "next";
import { materiaisAtivos } from "@/central/data";
import { ListaFavoritos } from "@/central/components/materiais/ListaFavoritos";

export const metadata: Metadata = {
  title: "Favoritos",
  description: "Materiais que você salvou e os últimos que visitou — guardados no seu navegador.",
  robots: { index: false },
};

export default function PaginaFavoritos() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <header className="mb-8">
        <p className="mb-2 font-central-mono text-[0.68rem] font-semibold uppercase tracking-[0.3em] text-central-acento">
          {"// seu arsenal"}
        </p>
        <h1 className="font-central-mono text-3xl font-bold uppercase tracking-tight text-central-tinta sm:text-4xl">
          Favoritos
        </h1>
        <p className="mt-2 max-w-2xl text-central-tinta-suave">
          Salvo neste navegador, sem conta e sem nuvem. Trocou de máquina, os favoritos não vão
          junto — por enquanto.
        </p>
      </header>
      <ListaFavoritos materiais={materiaisAtivos()} />
    </main>
  );
}
