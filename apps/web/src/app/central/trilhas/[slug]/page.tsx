import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { materialPorId, trilhaPorSlug, trilhas } from "@/central/data";
import { rotuloNivel } from "@/central/lib/cta";
import { DetalheTrilha } from "@/central/components/trilhas/DetalheTrilha";
import { rotas } from "@/central/lib/rotas";

export function generateStaticParams() {
  return trilhas.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const t = trilhaPorSlug(slug);
  if (!t) return {};
  return { title: `Trilha: ${t.titulo}`, description: t.descricao };
}

export default async function PaginaTrilha({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const trilha = trilhaPorSlug(slug);
  if (!trilha) notFound();

  const materiais = trilha.itens.map((i) => materialPorId(i.materialId));
  const minutos = materiais.reduce((soma, m) => soma + (m?.minutosEstimados ?? 0), 0);

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <nav aria-label="Você está em" className="mb-8 font-central-mono text-xs text-central-tinta-fraca">
        <Link href={rotas.inicio} className="no-underline hover:text-central-acento">
          Início
        </Link>
        <span aria-hidden> / </span>
        <Link href={rotas.trilhas} className="no-underline hover:text-central-acento">
          Trilhas
        </Link>
      </nav>

      <header className="mb-8">
        <p className="mb-2 font-central-mono text-[0.68rem] font-semibold uppercase tracking-[0.3em] text-central-acento">
          {`// trilha · ${trilha.itens.length} materiais · ~${minutos} min · nível ${rotuloNivel[trilha.nivel]}`}
        </p>
        <h1 className="font-central-mono text-3xl font-bold uppercase tracking-tight text-central-tinta sm:text-4xl">
          {trilha.titulo}
        </h1>
        <p className="mt-3 text-lg leading-relaxed text-central-tinta-suave">{trilha.descricao}</p>
        <p className="mt-3 text-sm text-central-tinta-fraca">
          <span className="font-central-mono font-semibold uppercase">Pra quem:</span> {trilha.paraQuem}
        </p>
        {trilha.prerequisitos && trilha.prerequisitos.length > 0 && (
          <p className="mt-1 text-sm text-central-tinta-fraca">
            <span className="font-central-mono font-semibold uppercase">Antes:</span>{" "}
            {trilha.prerequisitos.join(" · ")}
          </p>
        )}
        <div className="mt-5 h-1 w-16 bg-central-lima" aria-hidden />
      </header>

      <DetalheTrilha trilha={trilha} materiais={materiais} />

      <p className="mt-12">
        <Link
          href={rotas.trilhas}
          className="inline-flex items-center gap-2 font-central-mono text-xs font-bold uppercase tracking-wider text-central-tinta-suave no-underline hover:text-central-acento"
        >
          <ArrowLeft aria-hidden className="size-4" /> Todas as trilhas
        </Link>
      </p>
    </main>
  );
}
