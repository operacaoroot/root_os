import type { Metadata } from "next";
import Link from "next/link";
import { LogoRoot } from "@/central/components/marca/LogoRoot";
import { materiaisAtivos, trilhas } from "@/central/data";
import { rotas } from "@/central/lib/rotas";

export const metadata: Metadata = {
  title: "Sobre",
  description:
    "O que é a Root Central, como funciona o resgate por código e o que a comunidade Root faz.",
};

export default function PaginaSobre() {
  const total = materiaisAtivos().length;
  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <header className="mb-10 text-center">
        <LogoRoot tamanho="text-5xl" comOperacao />
        <p className="mt-4 text-lg text-central-tinta-suave">
          A central de conhecimento aplicado da comunidade Root.
        </p>
        <div className="mx-auto mt-5 h-1 w-16 bg-central-lima" aria-hidden />
      </header>

      <section className="mb-10 space-y-4 leading-relaxed text-central-tinta-suave">
        <p>
          <strong className="text-central-tinta">Root é acesso total.</strong> Em sistemas, é o nível mais
          alto de permissão — quem tem root manda em tudo. A comunidade carrega esse significado:
          dar ao operador o controle que ele não tinha.
        </p>
        <p>
          Esta central junta num lugar só o material que circula nos vídeos, aulas e encontros da
          comunidade: <strong className="text-central-tinta">{total} materiais</strong> entre tutoriais,
          prompts, automações e checklists, mais {trilhas.length} trilhas com a ordem certa de
          execução. Tudo em português direto, com prompt pronto pra copiar e link verificado.
        </p>
        <p>
          Aqui não tem promessa de riqueza fácil nem curso que envelhece em três meses. Tem passo a
          passo honesto — inclusive sobre o que dá trabalho.
        </p>
      </section>

      <section className="mb-10 border border-central-linha bg-central-painel p-6 sm:p-8">
        <h2 className="mb-4 font-central-mono text-lg font-bold uppercase text-central-tinta">
          Como funciona o resgate
        </h2>
        <ol className="space-y-3 text-sm leading-relaxed text-central-tinta-suave">
          <li>
            <span className="font-central-mono font-bold text-central-acento">01.</span> Cada vídeo tem um{" "}
            <strong className="text-central-tinta">código único</strong> — a palavra que você comenta.
          </li>
          <li>
            <span className="font-central-mono font-bold text-central-acento">02.</span> Digita o código na busca
            (ou abre o link direto <span className="font-central-mono text-central-acento">/r/CODIGO</span>) e o
            material certo abre na hora. Um código, um material — sem lista pra adivinhar.
          </li>
          <li>
            <span className="font-central-mono font-bold text-central-acento">03.</span> Não lembra o código? Busca
            pelo problema: <em>“a IA esquece tudo”</em>, <em>“conta alta de token”</em>. A busca
            entende.
          </li>
        </ol>
      </section>

      <section className="mb-10 space-y-4 leading-relaxed text-central-tinta-suave">
        <h2 className="font-central-mono text-lg font-bold uppercase text-central-tinta">
          O que este site guarda de você
        </h2>
        <p>
          Nada em servidor. Favoritos, histórico e progresso de trilha ficam salvos{" "}
          <strong className="text-central-tinta">no seu navegador</strong> — sem conta, sem cadastro, sem
          rastreador de terceiros. Limpou o navegador, limpou os dados.
        </p>
      </section>

      <section className="border border-central-linha bg-central-painel p-8 text-center">
        <p className="mb-3 font-central-mono text-[0.68rem] font-semibold uppercase tracking-[0.3em] text-central-acento">
          {"// pare de assistir"}
        </p>
        <h2 className="font-central-mono text-2xl font-bold uppercase text-central-tinta">Comece a operar.</h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-central-tinta-suave">
          O material é o mapa. A operação é com você — e na comunidade a gente executa junto.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href={rotas.materiais}
            className="bg-central-lima px-6 py-3 font-central-mono text-sm font-bold uppercase tracking-wide text-black no-underline"
          >
            Ver os materiais
          </Link>
          <Link
            href={rotas.trilhas}
            className="border border-central-linha px-6 py-3 font-central-mono text-sm font-semibold uppercase tracking-wide text-central-tinta no-underline hover:border-central-acento hover:text-central-acento"
          >
            Começar uma trilha
          </Link>
        </div>
      </section>
    </main>
  );
}
