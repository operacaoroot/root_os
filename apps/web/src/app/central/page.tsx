import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { categorias, materiaisAtivos, trilhas } from "@/central/data";
import { CampoBusca } from "@/central/components/busca/CampoBusca";
import { GridMateriais } from "@/central/components/materiais/GridMateriais";
import { LogoRoot } from "@/central/components/marca/LogoRoot";
import { rotas } from "@/central/lib/rotas";

function TituloSecao({ children, href }: { children: React.ReactNode; href?: string }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <h2 className="font-central-mono text-xl font-bold uppercase tracking-tight text-central-tinta sm:text-2xl">
        {children}
      </h2>
      {href && (
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-1 font-central-mono text-xs font-bold uppercase tracking-wider text-central-acento no-underline hover:underline"
        >
          Ver tudo <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      )}
    </div>
  );
}

export default function PaginaInicial() {
  const catalogo = materiaisAtivos();
  const destaques = catalogo.filter((m) => m.destaque).slice(0, 4);
  const recentes = catalogo.slice(0, 8);
  const sugestoes = ["VAULT", "TOKENS", "N8N", "PRIMEIRO"];

  return (
    <main className="mx-auto max-w-6xl px-5">
      {/* hero */}
      <section className="py-14 text-center sm:py-20">
        <p className="mb-5 font-central-mono text-[0.68rem] font-semibold uppercase tracking-[0.4em] text-central-acento">
          {"// acesso concedido"}
        </p>
        <h1 className="mx-auto mb-4 max-w-3xl">
          <span className="block font-central-mono text-sm font-bold uppercase tracking-[0.4em] text-central-tinta-suave">
            Central da
          </span>
          <span className="mt-1 block">
            <LogoRoot tamanho="text-6xl sm:text-8xl" />
          </span>
        </h1>
        <p className="mx-auto mb-8 max-w-xl text-lg leading-relaxed text-central-tinta-suave">
          Todo material da comunidade num lugar só: tutoriais, prompts, automações e trilhas de IA
          aplicada. <strong className="text-central-tinta">Pare de assistir. Comece a operar.</strong>
        </p>
        <CampoBusca sugestoes={sugestoes} />
        <p className="mt-6 font-central-mono text-xs text-central-tinta-fraca">
          <span className="font-bold text-central-acento">{catalogo.length}</span> materiais no catálogo ·
          atualizado toda semana
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={rotas.materiais}
            className="bg-central-lima px-6 py-3 font-central-mono text-sm font-bold uppercase tracking-wide text-black no-underline transition-opacity hover:opacity-90"
          >
            Explorar os materiais
          </Link>
          <Link
            href={rotas.trilhas}
            className="border border-central-linha px-6 py-3 font-central-mono text-sm font-semibold uppercase tracking-wide text-central-tinta no-underline transition-colors hover:border-central-acento hover:text-central-acento"
          >
            Seguir uma trilha
          </Link>
        </div>
      </section>

      {/* categorias */}
      <section className="py-10">
        <TituloSecao>Por onde você quer entrar</TituloSecao>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {categorias.map((c) => (
            <Link
              key={c.id}
              href={`?categoria=${c.id}`}
              className="group border border-central-linha bg-central-painel p-4 no-underline transition-colors hover:border-central-acento"
            >
              <p className="font-central-mono text-sm font-bold uppercase tracking-wide text-central-tinta group-hover:text-central-acento">
                {c.nome}
              </p>
              <p className="mt-1 text-xs leading-snug text-central-tinta-suave">{c.descricao}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* destaques */}
      <section className="py-10">
        <TituloSecao href={`?ordem=destaques`}>Destaques da central</TituloSecao>
        <GridMateriais materiais={destaques} />
      </section>

      {/* como funciona */}
      <section className="py-10">
        <div className="border border-central-linha bg-central-painel p-6 sm:p-10">
          <p className="mb-2 font-central-mono text-[0.68rem] font-semibold uppercase tracking-[0.3em] text-central-acento">
            {"// como funciona"}
          </p>
          <h2 className="mb-6 font-central-mono text-xl font-bold uppercase text-central-tinta sm:text-2xl">
            Viu no reel? Resgata aqui.
          </h2>
          <ol className="grid gap-5 sm:grid-cols-3">
            {[
              ["01", "Comenta o código", "Cada vídeo tem um código único — a palavra que você comenta."],
              ["02", "Busca o código aqui", "Digita na busca e o material certo abre direto. Sem lista pra adivinhar."],
              ["03", "Executa o passo a passo", "Prompt pronto pra copiar, link verificado e o caminho numerado."],
            ].map(([n, titulo, texto]) => (
              <li key={n} className="flex gap-3">
                <span className="glitch-root text-2xl">{n}</span>
                <div>
                  <p className="font-central-mono text-sm font-bold uppercase text-central-tinta">{titulo}</p>
                  <p className="mt-1 text-sm leading-snug text-central-tinta-suave">{texto}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* trilhas */}
      <section className="py-10">
        <TituloSecao href={rotas.trilhas}>Trilhas recomendadas</TituloSecao>
        <div className="grid gap-3 sm:grid-cols-2">
          {trilhas.slice(0, 4).map((t) => (
            <Link
              key={t.id}
              href={rotas.trilha(t.slug)}
              className="group border border-central-linha bg-central-painel p-5 no-underline transition-colors hover:border-central-acento"
            >
              <p className="font-central-mono text-[0.62rem] font-semibold uppercase tracking-[0.25em] text-central-tinta-fraca">
                trilha · {t.itens.length} materiais
              </p>
              <p className="mt-2 font-central-mono text-lg font-bold uppercase leading-tight text-central-tinta group-hover:text-central-acento">
                {t.titulo}
              </p>
              <p className="mt-2 text-sm leading-snug text-central-tinta-suave">{t.descricao}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* recentes */}
      <section className="py-10">
        <TituloSecao href={rotas.materiais}>Chegaram por último</TituloSecao>
        <GridMateriais materiais={recentes} />
      </section>
    </main>
  );
}
