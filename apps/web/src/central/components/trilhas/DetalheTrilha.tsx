"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import type { Material, Trilha } from "@/central/types";
import { useProgressoTrilha } from "@/central/hooks/useProgressoTrilha";
import { rotuloNivel } from "@/central/lib/cta";
import { rotas } from "@/central/lib/rotas";

/** Corpo da trilha: sequência numerada, marcar concluído, barra de progresso local. */
export function DetalheTrilha({
  trilha,
  materiais,
}: {
  trilha: Trilha;
  materiais: (Material | undefined)[];
}) {
  const { alternarItem, concluidos, percentual, carregado } = useProgressoTrilha();
  const feitos = concluidos(trilha.id);
  const pct = percentual(trilha.id, trilha.itens.length);
  const proximo = trilha.itens.find((i) => !feitos.includes(i.materialId));

  return (
    <div>
      {/* progresso */}
      <div className="mb-8 border border-central-linha bg-central-painel p-5">
        <div className="flex items-center justify-between gap-4">
          <p className="font-central-mono text-xs font-bold uppercase tracking-[0.2em] text-central-tinta-suave">
            Progresso
          </p>
          <p className="font-central-mono text-sm font-bold text-central-acento" aria-live="polite">
            {carregado ? `${pct}%` : "—"}
          </p>
        </div>
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Progresso na trilha ${trilha.titulo}`}
          className="mt-3 h-2 w-full bg-central-painel2"
        >
          <div className="h-full bg-central-lima transition-all" style={{ width: `${pct}%` }} />
        </div>
        {carregado && pct === 0 && (
          <p className="mt-3 text-sm text-central-tinta-suave">
            Trilha sem progresso ainda. Abre o primeiro material e marca como concluído quando
            executar — não quando ler.
          </p>
        )}
        {carregado && pct > 0 && pct < 100 && proximo && (
          <p className="mt-3 text-sm text-central-tinta-suave">
            Próximo:{" "}
            <Link
              href={rotas.material(materiais[trilha.itens.indexOf(proximo)]?.slug ?? "")}
              className="font-semibold text-central-acento"
            >
              {materiais[trilha.itens.indexOf(proximo)]?.card}
            </Link>
          </p>
        )}
        {carregado && pct === 100 && (
          <p className="mt-3 text-sm font-semibold text-central-acento">
            Trilha concluída. Sistema rodando? Então valeu. Escolhe a próxima.
          </p>
        )}
      </div>

      {/* sequência */}
      <ol className="space-y-3">
        {trilha.itens.map((item, i) => {
          const m = materiais[i];
          if (!m) return null;
          const feito = feitos.includes(item.materialId);
          return (
            <li
              key={item.materialId}
              className={`flex items-start gap-4 border border-central-linha p-4 transition-colors ${
                feito ? "bg-central-acento-soft" : "bg-central-painel"
              }`}
            >
              <button
                type="button"
                onClick={() => alternarItem(trilha.id, item.materialId)}
                aria-pressed={feito}
                aria-label={
                  feito ? `Desmarcar ${m.card} como concluído` : `Marcar ${m.card} como concluído`
                }
                className={`mt-0.5 flex size-8 shrink-0 cursor-pointer items-center justify-center border font-central-mono text-sm font-bold transition-colors ${
                  feito
                    ? "border-central-acento bg-central-lima text-black"
                    : "border-central-linha text-central-tinta-fraca hover:border-central-acento"
                }`}
              >
                {feito ? <Check aria-hidden className="size-4" /> : i + 1}
              </button>
              <div className="min-w-0 flex-1">
                <Link
                  href={rotas.material(m.slug)}
                  className={`font-central-mono text-sm font-bold uppercase leading-snug no-underline hover:text-central-acento ${
                    feito ? "text-central-tinta-suave line-through" : "text-central-tinta"
                  }`}
                >
                  {m.card}
                </Link>
                {item.nota && <p className="mt-1 text-xs text-central-tinta-suave">{item.nota}</p>}
                <p className="mt-1 font-central-mono text-[0.62rem] uppercase tracking-wider text-central-tinta-fraca">
                  código {m.codigo}
                  {m.minutosEstimados ? ` · ${m.minutosEstimados} min` : ""} ·{" "}
                  {rotuloNivel[m.nivel]}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
