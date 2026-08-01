"use client";

import { useCallback, useEffect, useState } from "react";
import { gravarStorage, lerStorage } from "@/central/lib/storage";
import { trackEvent } from "@/central/lib/analytics";

const CHAVE = "favoritos";

/** Favoritos por id de material, persistidos no navegador. */
export function useFavoritos() {
  const [ids, setIds] = useState<string[]>([]);
  const [carregado, setCarregado] = useState(false);

  useEffect(() => {
    setIds(lerStorage<string[]>(CHAVE, []));
    setCarregado(true);
  }, []);

  const alternar = useCallback((id: string) => {
    setIds((atual) => {
      const tem = atual.includes(id);
      const novo = tem ? atual.filter((x) => x !== id) : [...atual, id];
      gravarStorage(CHAVE, novo);
      trackEvent(tem ? "material_desfavoritado" : "material_favoritado", { id });
      return novo;
    });
  }, []);

  const ehFavorito = useCallback((id: string) => ids.includes(id), [ids]);

  return { favoritos: ids, alternar, ehFavorito, carregado };
}
