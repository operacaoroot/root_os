'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TotemGestaoLoja, TotemUnidadePreco } from '@mktos/shared';
import { apiGet } from '@/lib/api';

/*
 * Apoio das telas da frente A: a lista de lojas que alimenta os filtros e os
 * formatos de data e preço. Mora aqui porque a pasta de cada tela é o limite da
 * frente; as outras telas importam de `../lojas/apoio`.
 */

const FUSO = 'America/Sao_Paulo';

export function dataBR(iso: string | null | undefined): string {
  if (!iso) return '—';
  // Dia puro (`AAAA-MM-DD`) é lido em UTC para não voltar um dia no fuso de São Paulo.
  const soDia = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(soDia ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { timeZone: soDia ? 'UTC' : FUSO });
}

export function dataHoraBR(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('pt-BR', { timeZone: FUSO })} às ${d.toLocaleTimeString('pt-BR', {
    timeZone: FUSO,
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export function horaBR(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
}

/** "há 3 min", "há 2 h", "há 4 dias": quanto tempo faz, para a coluna de último sinal. */
export function haQuantoTempo(iso: string | null | undefined, agora = Date.now()): string {
  if (!iso) return 'nunca';
  const minutos = Math.max(0, Math.round((agora - new Date(iso).getTime()) / 60_000));
  if (minutos < 1) return 'agora há pouco';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 48) return `há ${horas} h`;
  return `há ${Math.round(horas / 24)} dias`;
}

export const ROTULO_UNIDADE: Record<TotemUnidadePreco, string> = {
  kg: 'por kg',
  '100g': 'por 100 g',
  un: 'por unidade',
};

export function precoBR(centavos: number | null, unidade: TotemUnidadePreco | null): string {
  if (centavos == null) return 'sem preço';
  const valor = (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return unidade ? `${valor} ${ROTULO_UNIDADE[unidade]}` : valor;
}

/** "12,90" ou "12.90" em centavos; `null` para vazio e `NaN` para texto que não é preço. */
export function centavosDoTexto(texto: string): number | null {
  const limpo = texto.trim().replace(/^R\$\s*/i, '');
  if (!limpo) return null;
  const normal = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return Number.NaN;
  return Math.round(Number(normal) * 100);
}

export function textoDosCentavos(centavos: number | null): string {
  return centavos == null ? '' : (centavos / 100).toFixed(2).replace('.', ',');
}

/** As lojas do escopo de quem está logado, para filtros e seletores. */
export function useLojasDoPainel(token: string | null, situacao: 'ativas' | 'todas' = 'todas') {
  const [lojas, setLojas] = useState<TotemGestaoLoja[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(() => {
    if (!token) return;
    apiGet<TotemGestaoLoja[]>(`/totem-gestao/lojas?situacao=${situacao}`, token)
      .then((l) => {
        setLojas(l);
        setErro(null);
      })
      .catch((e: Error) => setErro(e.message));
  }, [token, situacao]);

  useEffect(() => {
    recarregar();
  }, [recarregar]);

  return { lojas, erro, recarregar };
}

/** Escreve `ABCD1234` como `ABCD-1234`, que é mais fácil de ler em voz alta; o totem aceita os dois. */
export function codigoEmBlocos(codigo: string): string {
  return codigo.length === 8 ? `${codigo.slice(0, 4)}-${codigo.slice(4)}` : codigo;
}
