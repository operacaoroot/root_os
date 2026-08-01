import Link from "next/link";
import { LogoRoot } from "@/central/components/marca/LogoRoot";
import { rotas } from "@/central/lib/rotas";

export function Footer() {
  return (
    <footer className="mt-20 border-t border-central-linha">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <LogoRoot comOperacao />
          <p className="mt-3 max-w-xs text-sm text-central-tinta-suave">
            Conhecimento aplicado da comunidade Root. Pare de assistir. Comece a operar.
          </p>
        </div>
        <nav aria-label="Links do rodapé" className="flex flex-wrap gap-x-5 gap-y-2">
          {[
            { href: rotas.materiais, rotulo: "Materiais" },
            { href: rotas.trilhas, rotulo: "Trilhas" },
            { href: rotas.favoritos, rotulo: "Favoritos" },
            { href: rotas.sobre, rotulo: "Sobre" },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="font-central-mono text-xs font-semibold uppercase tracking-wider text-central-tinta-suave transition-colors hover:text-central-acento"
            >
              {l.rotulo}
            </Link>
          ))}
        </nav>
      </div>
      <div className="border-t border-central-linha py-4 text-center font-central-mono text-[0.65rem] uppercase tracking-[0.25em] text-central-tinta-fraca">
        Root Central · @operacao.root
      </div>
    </footer>
  );
}
