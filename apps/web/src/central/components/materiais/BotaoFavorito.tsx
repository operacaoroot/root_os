"use client";

import { Bookmark } from "lucide-react";
import { useFavoritos } from "@/central/hooks/useFavoritos";

export function BotaoFavorito({ id, rotulo }: { id: string; rotulo: string }) {
  const { ehFavorito, alternar, carregado } = useFavoritos();
  const favorito = carregado && ehFavorito(id);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        alternar(id);
      }}
      aria-pressed={favorito}
      aria-label={favorito ? `Tirar ${rotulo} dos favoritos` : `Salvar ${rotulo} nos favoritos`}
      className={`cursor-pointer p-2 transition-colors ${
        favorito ? "text-central-magenta" : "text-central-tinta-fraca hover:text-central-tinta"
      }`}
    >
      <Bookmark aria-hidden className={`size-4 ${favorito ? "fill-current" : ""}`} />
    </button>
  );
}
