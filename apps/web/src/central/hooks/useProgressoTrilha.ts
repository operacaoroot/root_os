"use client";

import { useCallback, useEffect, useState } from "react";
import { gravarStorage, lerStorage } from "@/central/lib/storage";
import { trackEvent } from "@/central/lib/analytics";

const CHAVE = "progresso-trilhas";

type Progresso = Record<string, string[]>; // trilhaId -> materialIds concluídos

/** Progresso local por trilha: itens concluídos e percentual. */
export function useProgressoTrilha() {
  const [progresso, setProgresso] = useState<Progresso>({});
  const [carregado, setCarregado] = useState(false);

  useEffect(() => {
    setProgresso(lerStorage<Progresso>(CHAVE, {}));
    setCarregado(true);
  }, []);

  const alternarItem = useCallback((trilhaId: string, materialId: string) => {
    setProgresso((atual) => {
      const feitos = atual[trilhaId] ?? [];
      const tem = feitos.includes(materialId);
      const novos = tem ? feitos.filter((x) => x !== materialId) : [...feitos, materialId];
      const novo = { ...atual, [trilhaId]: novos };
      gravarStorage(CHAVE, novo);
      if (!tem) {
        trackEvent(novos.length === 1 ? "trilha_iniciada" : "trilha_item_concluido", {
          trilha: trilhaId,
        });
      }
      return novo;
    });
  }, []);

  const concluidos = useCallback(
    (trilhaId: string) => progresso[trilhaId] ?? [],
    [progresso],
  );

  const percentual = useCallback(
    (trilhaId: string, totalItens: number) => {
      if (totalItens === 0) return 0;
      return Math.round(((progresso[trilhaId]?.length ?? 0) / totalItens) * 100);
    },
    [progresso],
  );

  return { alternarItem, concluidos, percentual, carregado };
}
