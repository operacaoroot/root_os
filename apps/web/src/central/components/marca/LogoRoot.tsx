import Link from "next/link";
import { rotas } from "@/central/lib/rotas";

/**
 * Wordmark oficial ROOT — JetBrains Mono 800 itálico, inclinado,
 * com o glitch de canais (magenta + ciano) do brand guide v1.
 * Nunca endireitar, nunca trocar a fonte (regra do guia).
 */
export function LogoRoot({
  tamanho = "text-xl",
  comOperacao = false,
}: {
  tamanho?: string;
  comOperacao?: boolean;
}) {
  return (
    <span className="inline-flex flex-col leading-none">
      {comOperacao && (
        <span className="font-central-mono text-[0.6rem] font-bold uppercase tracking-[0.5em] text-central-tinta-suave">
          Operação
        </span>
      )}
      <span className={`glitch-root ${tamanho}`} aria-hidden="false">
        ROOT
      </span>
    </span>
  );
}

export function LogoRootLink() {
  return (
    <Link
      href={rotas.inicio}
      className="inline-flex items-baseline gap-2 no-underline"
      aria-label="Root Central — início"
    >
      <LogoRoot />
      <span className="font-central-mono text-xs font-medium uppercase tracking-[0.25em] text-central-tinta-suave">
        central
      </span>
    </Link>
  );
}
