"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";
import { trackEvent } from "@/central/lib/analytics";
import { rotas } from "@/central/lib/rotas";

/**
 * Busca do hero: envia pra biblioteca com o termo na URL.
 * O resgate por código acontece lá (camada 1 abre o material direto).
 */
export function CampoBusca({ sugestoes }: { sugestoes: string[] }) {
  const router = useRouter();
  const [termo, setTermo] = useState("");

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const limpo = termo.trim();
    if (!limpo) return;
    trackEvent("busca_feita", { origem: "hero" });
    router.push(rotas.busca(limpo));
  }

  return (
    <div className="mx-auto w-full max-w-lg">
      <form onSubmit={enviar} role="search" aria-label="Buscar material" className="flex gap-2">
        <label htmlFor="busca-hero" className="sr-only">
          Buscar material por código, ferramenta ou problema
        </label>
        <input
          id="busca-hero"
          type="search"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Código do reel, ferramenta ou problema…"
          className="min-w-0 flex-1 border border-central-linha bg-central-painel px-4 py-3 text-central-tinta outline-none transition-colors placeholder:text-central-tinta-fraca focus:border-central-acento"
        />
        <button
          type="submit"
          className="inline-flex cursor-pointer items-center gap-2 bg-central-lima px-5 py-3 font-central-mono text-sm font-bold uppercase tracking-wide text-black transition-opacity hover:opacity-90"
        >
          <Search aria-hidden className="size-4" />
          Buscar
        </button>
      </form>
      {sugestoes.length > 0 && (
        <p className="mt-3 text-center text-xs text-central-tinta-fraca">
          Tenta:{" "}
          {sugestoes.map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                trackEvent("busca_feita", { origem: "sugestao" });
                router.push(rotas.busca(s));
              }}
              className="cursor-pointer font-central-mono font-semibold text-central-acento hover:underline"
            >
              {s}
              {i < sugestoes.length - 1 ? <span className="text-central-tinta-fraca">, </span> : null}
            </button>
          ))}
        </p>
      )}
    </div>
  );
}
