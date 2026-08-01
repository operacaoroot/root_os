"use client";

import { useCallback, useEffect, useState } from "react";
import { gravarStorage, lerStorage } from "@/central/lib/storage";

const CHAVE = "vistos";
const MAXIMO = 12;

/** Últimos materiais visitados (mais recente primeiro). */
export function useVistosRecentemente() {
  const [ids, setIds] = useState<string[]>([]);
  const [carregado, setCarregado] = useState(false);

  useEffect(() => {
    setIds(lerStorage<string[]>(CHAVE, []));
    setCarregado(true);
  }, []);

  const registrar = useCallback((id: string) => {
    setIds((atual) => {
      const novo = [id, ...atual.filter((x) => x !== id)].slice(0, MAXIMO);
      gravarStorage(CHAVE, novo);
      return novo;
    });
  }, []);

  return { vistos: ids, registrar, carregado };
}
