'use client';

/*
 * A VARIANTE DO PAINEL (leva 5, L4, 27/10/2026): o Rodrigo compara duas formas
 * da aba Geral antes de escolher.
 *   · A: três cartões lado a lado (Quem · Origem · Negócio), a etapa como faixa no topo;
 *   · B: os cartões numa coluna à esquerda e, à direita, a linha do tempo
 *     resumida (os 5 últimos fatos do fio) com "ver tudo" (abre o Histórico).
 * A escolha fica no navegador (`localStorage`, chave `painel.variante`); sem
 * armazenamento, vale a A até recarregar.
 */
import { useCallback, useEffect, useState } from 'react';
import { CHAVE_DA_VARIANTE_DO_PAINEL, VARIANTE_PADRAO_DO_PAINEL, lerVariante, type VarianteDoPainel } from '@mktos/shared';

export function lerVarianteGuardada(): VarianteDoPainel {
  try {
    return lerVariante(window.localStorage.getItem(CHAVE_DA_VARIANTE_DO_PAINEL));
  } catch {
    return VARIANTE_PADRAO_DO_PAINEL;
  }
}

export function guardarVariante(v: VarianteDoPainel): void {
  try {
    window.localStorage.setItem(CHAVE_DA_VARIANTE_DO_PAINEL, v);
  } catch {
    /* navegador sem armazenamento: a escolha vale até recarregar */
  }
}

/** A variante de agora e o botão que alterna. Começa na A no servidor e lê o navegador ao montar. */
export function useVarianteDoPainel(): [VarianteDoPainel, () => void] {
  const [variante, setVariante] = useState<VarianteDoPainel>(VARIANTE_PADRAO_DO_PAINEL);
  useEffect(() => setVariante(lerVarianteGuardada()), []);
  const alternar = useCallback(() => {
    setVariante((v) => {
      const nova: VarianteDoPainel = v === 'A' ? 'B' : 'A';
      guardarVariante(nova);
      return nova;
    });
  }, []);
  return [variante, alternar];
}
