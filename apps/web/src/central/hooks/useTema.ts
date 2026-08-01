"use client";

import { useCallback, useEffect, useState } from "react";
import { gravarStorage, lerStorage } from "@/central/lib/storage";

export type Tema = "dark" | "light" | "system";
const CHAVE = "tema";

function aplicar(tema: Tema) {
  const raiz = document.documentElement;
  const efetivo =
    tema === "system"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : tema;
  if (efetivo === "light") raiz.setAttribute("data-theme", "light");
  else raiz.removeAttribute("data-theme");
}

/** Tema com persistência e respeito à preferência do sistema. Escuro é o padrão da marca. */
export function useTema() {
  const [tema, setTema] = useState<Tema>("system");

  useEffect(() => {
    const salvo = lerStorage<Tema>(CHAVE, "system");
    setTema(salvo);
    aplicar(salvo);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const ouvir = () => {
      if (lerStorage<Tema>(CHAVE, "system") === "system") aplicar("system");
    };
    mq.addEventListener("change", ouvir);
    return () => mq.removeEventListener("change", ouvir);
  }, []);

  const trocar = useCallback((novo: Tema) => {
    setTema(novo);
    gravarStorage(CHAVE, novo);
    aplicar(novo);
  }, []);

  const alternar = useCallback(() => {
    const atualEfetivo =
      tema === "system"
        ? window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark"
        : tema;
    trocar(atualEfetivo === "dark" ? "light" : "dark");
  }, [tema, trocar]);

  return { tema, trocar, alternar };
}
