import type { Metadata } from "next";
import Link from "next/link";
import { trilhas } from "@/central/data";
import { rotuloNivel } from "@/central/lib/cta";
import { rotas } from "@/central/lib/rotas";

export const metadata: Metadata = {
  title: "Trilhas",
  description:
    "As trilhas da Root Central: sequências de materiais na ordem certa, com progresso salvo no seu navegador.",
};

export default function PaginaTrilhas() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <header className="mb-8">
        <p className="mb-2 font-central-mono text-[0.68rem] font-semibold uppercase tracking-[0.3em] text-central-acento">
          {"// trilhas"}
        </p>
        <h1 className="font-central-mono text-3xl font-bold uppercase tracking-tight text-central-tinta sm:text-4xl">
          Trilhas
        </h1>
        <p className="mt-2 max-w-2xl text-central-tinta-suave">
          Material solto vira aba aberta. Trilha é sequência com ordem certa — cada uma termina com
          algo seu rodando. O progresso fica salvo neste navegador.
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        {trilhas.map((t) => (
          <Link
            key={t.id}
            href={rotas.trilha(t.slug)}
            className="group flex flex-col border border-central-linha bg-central-painel p-6 no-underline transition-colors hover:border-central-acento"
          >
            <p className="font-central-mono text-[0.62rem] font-semibold uppercase tracking-[0.25em] text-central-tinta-fraca">
              {t.itens.length} materiais · nível {rotuloNivel[t.nivel]}
            </p>
            <h2 className="mt-2 font-central-mono text-xl font-bold uppercase leading-tight text-central-tinta group-hover:text-central-acento">
              {t.titulo}
            </h2>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-central-tinta-suave">{t.descricao}</p>
            <p className="mt-4 text-xs text-central-tinta-fraca">
              <span className="font-central-mono font-semibold uppercase">Pra quem:</span> {t.paraQuem}
            </p>
            <p className="mt-4 font-central-mono text-xs font-bold uppercase tracking-wider text-central-acento">
              Iniciar trilha →
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}
