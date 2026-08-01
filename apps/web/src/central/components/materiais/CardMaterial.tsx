import Link from "next/link";
import type { Material } from "@/central/types";
import { ctaPorTipo } from "@/central/lib/cta";
import { CapaMaterial } from "./CapaMaterial";
import { BadgesMaterial } from "./Badges";
import { BotaoFavorito } from "./BotaoFavorito";
import { rotas } from "@/central/lib/rotas";

/**
 * Card do catálogo. O link cobre a capa e o título (área principal);
 * o favorito é um controle independente — sem link aninhado.
 */
export function CardMaterial({ m }: { m: Material }) {
  return (
    <article className="group relative flex flex-col">
      <Link
        href={rotas.material(m.slug)}
        className="flex flex-col no-underline focus-visible:outline-2"
        aria-label={`${m.card} — ${ctaPorTipo[m.tipo]}`}
      >
        <CapaMaterial m={m} />
        <h3 className="mt-3 font-central-mono text-base font-bold leading-snug text-central-tinta">{m.card}</h3>
        <p className="mt-1 text-sm leading-snug text-central-tinta-suave">{m.tagline}</p>
      </Link>
      <div className="mt-2 flex items-center justify-between gap-2">
        <BadgesMaterial m={m} compacto />
        <BotaoFavorito id={m.id} rotulo={m.card} />
      </div>
      <Link
        href={rotas.material(m.slug)}
        tabIndex={-1}
        aria-hidden="true"
        className="mt-2 font-central-mono text-xs font-bold uppercase tracking-wider text-central-acento no-underline group-hover:underline"
      >
        {ctaPorTipo[m.tipo]} →
      </Link>
    </article>
  );
}
