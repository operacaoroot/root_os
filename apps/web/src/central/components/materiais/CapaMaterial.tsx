import type { Material } from "@/central/types";
import { situacaoDe } from "@/central/lib/frescor";

/**
 * Capa do card em 4:5. Sem imagem, renderiza o fallback tipográfico
 * da marca — código de resgate + título, no padrão "tela hackeada".
 * (Herdado do melhor acerto da referência: nunca há buraco visual.)
 */
export function CapaMaterial({ m }: { m: Material }) {
  const descontinuado = situacaoDe(m) === "descontinuado";
  return (
    <div
      className={`relative aspect-[4/5] w-full overflow-hidden border border-central-linha bg-central-painel transition-colors group-hover:border-central-acento ${
        descontinuado ? "opacity-60 grayscale" : ""
      }`}
    >
      {/* fallback tipográfico — o visual padrão da v1 */}
      <div className="absolute inset-0 flex flex-col justify-between p-4">
        <p className="font-central-mono text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-central-tinta-fraca">
          root central
        </p>
        <div>
          <p className="glitch-root text-2xl" aria-hidden="true">
            {m.codigo}
          </p>
          <p className="mt-3 font-central-mono text-sm font-bold uppercase leading-snug text-central-tinta">
            {m.card}
          </p>
        </div>
        <div className="h-1 w-10 bg-central-lima" aria-hidden="true" />
      </div>
      {descontinuado && (
        <div className="absolute inset-x-0 top-0 bg-central-magenta px-2 py-1 text-center font-central-mono text-[0.6rem] font-bold uppercase tracking-widest text-white">
          Descontinuado
        </div>
      )}
    </div>
  );
}
