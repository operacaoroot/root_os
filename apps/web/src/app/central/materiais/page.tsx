import type { Metadata } from "next";
import { Suspense } from "react";
import { categorias, materiaisAtivos } from "@/central/data";
import { Biblioteca } from "@/central/components/materiais/Biblioteca";

export const metadata: Metadata = {
  title: "Materiais",
  description:
    "A biblioteca completa da Root Central: busca por código do reel, ferramenta ou problema, com filtros por categoria, tipo, nível e custo.",
};

export default function PaginaMateriais() {
  const catalogo = materiaisAtivos();
  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <header className="mb-8">
        <p className="mb-2 font-central-mono text-[0.68rem] font-semibold uppercase tracking-[0.3em] text-central-acento">
          {"// biblioteca"}
        </p>
        <h1 className="font-central-mono text-3xl font-bold uppercase tracking-tight text-central-tinta sm:text-4xl">
          Materiais
        </h1>
        <p className="mt-2 max-w-2xl text-central-tinta-suave">
          Busca pelo código do reel, pela ferramenta ou pelo problema que você quer resolver. Filtro
          e busca ficam na URL — compartilha o link que a pessoa cai no mesmo recorte.
        </p>
      </header>
      <Suspense
        fallback={<p className="py-10 text-center font-central-mono text-sm text-central-tinta-fraca">Carregando…</p>}
      >
        <Biblioteca materiais={catalogo} categorias={categorias} />
      </Suspense>
    </main>
  );
}
