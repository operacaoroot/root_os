import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import {
  categoriaPorId,
  materialPorSlug,
  relacionadosDe,
  todosMateriais,
} from "@/central/data";
import { rotuloCusto, rotuloNivel, rotuloTipo } from "@/central/lib/cta";
import { rotuloSituacao, situacaoDe } from "@/central/lib/frescor";
import { RenderBlocos } from "@/central/components/blocos/RenderBlocos";
import { BadgeSituacao } from "@/central/components/materiais/Badges";
import { AcoesMaterial } from "@/central/components/materiais/AcoesMaterial";
import { CardMaterial } from "@/central/components/materiais/CardMaterial";
import { rotas } from "@/central/lib/rotas";

export function generateStaticParams() {
  return todosMateriais.map((m) => ({ slug: m.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const m = materialPorSlug(slug);
  if (!m) return {};
  return {
    title: m.card,
    description: m.resumo,
    alternates: { canonical: rotas.material(m.slug) },
    openGraph: {
      title: m.card,
      description: m.tagline,
      type: "article",
      locale: "pt_BR",
    },
  };
}

function dataLegivel(iso: string): string {
  return new Date(iso + (iso.length === 10 ? "T12:00:00" : "")).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default async function PaginaMaterial({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const m = materialPorSlug(slug);
  if (!m) notFound();

  const categoria = categoriaPorId(m.categoriaId);
  const situacao = situacaoDe(m);
  const relacionados = relacionadosDe(m);

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      {/* breadcrumb */}
      <nav aria-label="Você está em" className="mb-8 font-central-mono text-xs text-central-tinta-fraca">
        <Link href={rotas.inicio} className="no-underline hover:text-central-acento">
          Início
        </Link>
        <span aria-hidden> / </span>
        <Link href={rotas.materiais} className="no-underline hover:text-central-acento">
          Materiais
        </Link>
        {categoria && (
          <>
            <span aria-hidden> / </span>
            <Link
              href={`?categoria=${categoria.id}`}
              className="no-underline hover:text-central-acento"
            >
              {categoria.nome}
            </Link>
          </>
        )}
      </nav>

      {/* aviso de descontinuado — texto, não só cor */}
      {situacao === "descontinuado" && (
        <div className="mb-8 border-l-4 border-central-magenta bg-central-magenta-soft px-4 py-3.5">
          <p className="font-central-mono text-sm font-bold uppercase text-central-magenta">
            Material descontinuado
          </p>
          <p className="mt-1 text-sm text-central-tinta-suave">
            Segue no ar porque link antigo não deve quebrar — mas o conteúdo não vale mais pra
            versão atual das ferramentas.
          </p>
        </div>
      )}
      {situacao === "requer-revisao" && (
        <div className="mb-8 border-l-4 border-central-alerta bg-central-painel2 px-4 py-3.5">
          <p className="font-central-mono text-sm font-bold uppercase text-central-alerta">Requer revisão</p>
          <p className="mt-1 text-sm text-central-tinta-suave">
            Faz mais de 90 dias que este material não passa por verificação. Os passos podem ter
            mudado — confira na fonte oficial antes de seguir.
          </p>
        </div>
      )}

      {/* cabeçalho */}
      <header className="mb-10">
        <p className="mb-3 font-central-mono text-[0.68rem] font-semibold uppercase tracking-[0.3em] text-central-acento">
          {`// ${categoria?.nome ?? "material"} · código `}
          <span className="text-central-magenta">{m.codigo}</span>
        </p>
        <h1 className="font-central-mono text-3xl font-bold uppercase leading-tight tracking-tight text-central-tinta sm:text-4xl">
          {m.titulo}
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-central-tinta-suave">{m.resumo}</p>
        <div className="mt-5 h-1 w-16 bg-central-lima" aria-hidden />
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <AcoesMaterial id={m.id} slug={m.slug} titulo={m.card} />
          <p className="font-central-mono text-xs text-central-tinta-fraca">
            publicado {dataLegivel(m.publicadoEm)}
            {m.verificadoEm && <> · verificado {dataLegivel(m.verificadoEm)}</>}
          </p>
        </div>
      </header>

      {/* informações rápidas */}
      <dl className="mb-10 grid grid-cols-2 gap-px border border-central-linha bg-central-linha sm:grid-cols-4">
        {[
          ["Tipo", rotuloTipo[m.tipo]],
          ["Nível", rotuloNivel[m.nivel]],
          ["Custo", rotuloCusto[m.custo]],
          ["Duração", m.minutosEstimados ? `${m.minutosEstimados} min` : "—"],
        ].map(([rotulo, valor]) => (
          <div key={rotulo} className="bg-central-painel px-4 py-3">
            <dt className="font-central-mono text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-central-tinta-fraca">
              {rotulo}
            </dt>
            <dd className="mt-0.5 font-central-mono text-sm font-bold text-central-tinta">{valor}</dd>
          </div>
        ))}
        <div className="col-span-2 bg-central-painel px-4 py-3 sm:col-span-2">
          <dt className="font-central-mono text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-central-tinta-fraca">
            Ferramentas
          </dt>
          <dd className="mt-0.5 font-central-mono text-sm font-bold text-central-tinta">
            {m.ferramentas.join(" · ")}
          </dd>
        </div>
        <div className="col-span-2 bg-central-painel px-4 py-3 sm:col-span-2">
          <dt className="font-central-mono text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-central-tinta-fraca">
            Situação
          </dt>
          <dd className="mt-1">
            <BadgeSituacao situacao={situacao} />
            <span className="sr-only">{rotuloSituacao[situacao]}</span>
          </dd>
        </div>
      </dl>

      {/* pré-requisitos */}
      {m.prerequisitos && m.prerequisitos.length > 0 && (
        <div className="mb-8 border border-central-linha bg-central-painel2 px-4 py-3.5">
          <p className="font-central-mono text-[0.68rem] font-bold uppercase tracking-[0.2em] text-central-tinta-fraca">
            Antes de começar
          </p>
          <ul className="mt-2 space-y-1">
            {m.prerequisitos.map((p) => (
              <li key={p} className="text-sm text-central-tinta-suave">
                → {p}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* conteúdo */}
      <article>
        <RenderBlocos blocos={m.blocos} />
      </article>

      {/* origem */}
      {m.origemUrl && (
        <p className="mt-6 text-sm text-central-tinta-fraca">
          <ExternalLink aria-hidden className="mr-1 inline size-3.5" />
          Este material nasceu de um vídeo:{" "}
          <a href={m.origemUrl} target="_blank" rel="noopener noreferrer" className="text-central-acento">
            assistir a origem
          </a>
        </p>
      )}

      {/* CTA comunidade */}
      <section className="mt-12 border border-central-linha bg-central-painel p-8 text-center sm:p-10">
        <p className="mb-3 font-central-mono text-[0.68rem] font-semibold uppercase tracking-[0.3em] text-central-acento">
          {"// material parado não muda nada"}
        </p>
        <h2 className="font-central-mono text-2xl font-bold uppercase leading-tight text-central-tinta">
          Pegou o passo a passo. Agora opera.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-central-tinta-suave">
          O que separa quem assiste de quem opera é executar com cobrança do lado. Na comunidade
          Root a gente faz junto — sistema rodando, não certificado.
        </p>
        <a
          href={`https://operacaoroot.com/?utm_source=root-central&utm_medium=cta&utm_campaign=${m.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-block bg-central-lima px-8 py-3.5 font-central-mono text-sm font-bold uppercase tracking-wide text-black no-underline transition-opacity hover:opacity-90"
        >
          Conhecer a Root →
        </a>
      </section>

      {/* relacionados */}
      {relacionados.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-5 font-central-mono text-lg font-bold uppercase text-central-tinta">
            Quem pegou este também opera
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {relacionados.map((r) => (
              <CardMaterial key={r.id} m={r} />
            ))}
          </div>
        </section>
      )}

      <p className="mt-12">
        <Link
          href={rotas.materiais}
          className="inline-flex items-center gap-2 font-central-mono text-xs font-bold uppercase tracking-wider text-central-tinta-suave no-underline hover:text-central-acento"
        >
          <ArrowLeft aria-hidden className="size-4" /> Voltar pra biblioteca
        </Link>
      </p>
    </main>
  );
}
