"use client";

import { useEffect, useState } from "react";
import { Check, Share2 } from "lucide-react";
import { useFavoritos } from "@/central/hooks/useFavoritos";
import { useVistosRecentemente } from "@/central/hooks/useVistosRecentemente";
import { trackEvent } from "@/central/lib/analytics";
import { Bookmark } from "lucide-react";
import { rotas } from "@/central/lib/rotas";

/** Barra de ações da página do material: favoritar + compartilhar. Registra a visita. */
export function AcoesMaterial({ id, slug, titulo }: { id: string; slug: string; titulo: string }) {
  const { ehFavorito, alternar, carregado } = useFavoritos();
  const { registrar } = useVistosRecentemente();
  const [compartilhado, setCompartilhado] = useState(false);

  useEffect(() => {
    registrar(id);
    trackEvent("material_aberto", { slug });
  }, [id, slug, registrar]);

  const favorito = carregado && ehFavorito(id);

  async function compartilhar() {
    const url = window.location.origin + rotas.material(slug);
    trackEvent("compartilhar_clicado", { slug });
    try {
      if (navigator.share) {
        await navigator.share({ title: titulo, url });
      } else {
        await navigator.clipboard.writeText(url);
        setCompartilhado(true);
        setTimeout(() => setCompartilhado(false), 2000);
      }
    } catch {
      // usuário cancelou — sem drama
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => alternar(id)}
        aria-pressed={favorito}
        className={`inline-flex cursor-pointer items-center gap-2 border px-4 py-2 font-central-mono text-xs font-bold uppercase tracking-wider transition-colors ${
          favorito
            ? "border-central-magenta bg-central-magenta-soft text-central-magenta"
            : "border-central-linha text-central-tinta-suave hover:border-central-magenta hover:text-central-magenta"
        }`}
      >
        <Bookmark aria-hidden className={`size-4 ${favorito ? "fill-current" : ""}`} />
        {favorito ? "Salvo" : "Salvar"}
      </button>
      <button
        type="button"
        onClick={compartilhar}
        className="inline-flex cursor-pointer items-center gap-2 border border-central-linha px-4 py-2 font-central-mono text-xs font-bold uppercase tracking-wider text-central-tinta-suave transition-colors hover:border-central-acento hover:text-central-acento"
      >
        {compartilhado ? (
          <Check aria-hidden className="size-4" />
        ) : (
          <Share2 aria-hidden className="size-4" />
        )}
        {compartilhado ? "Link copiado" : "Compartilhar"}
      </button>
      <span aria-live="polite" className="sr-only">
        {compartilhado ? "Link copiado pra área de transferência" : ""}
      </span>
    </div>
  );
}
