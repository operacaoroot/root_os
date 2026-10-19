'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MaquinaEtapa, MaquinaPainel, MaquinaPost, MaquinaPostSalvarInput } from '@mktos/shared';
import { apiGet, apiPatch, apiPost, apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * Os dados da Máquina de Conteúdo da empresa numa tela. Cada ação devolve o post
 * como o servidor gravou e troca só ele na lista: sem recarregar a tela inteira,
 * e sem a tela acreditar numa versão que o servidor recusou.
 */
export function useMaquina() {
  const { token, ready, can } = useAuth();
  const [painel, setPainel] = useState<MaquinaPainel | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!token) return;
    try {
      setPainel(await apiGet<MaquinaPainel>('/marketing/maquina', token));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [token]);

  useEffect(() => {
    if (ready) void carregar();
  }, [ready, carregar]);

  const trocar = useCallback((p: MaquinaPost) => {
    setPainel((atual) => {
      if (!atual) return atual;
      const existe = atual.posts.some((x) => x.id === p.id);
      return { ...atual, posts: existe ? atual.posts.map((x) => (x.id === p.id ? p : x)) : [...atual.posts, p] };
    });
    return p;
  }, []);

  const agir = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        setErro(null);
        return await fn();
      } catch (e) {
        setErro((e as Error).message);
        return null;
      }
    },
    [],
  );

  return {
    painel,
    erro,
    setErro,
    pronto: ready,
    podeVer: can('pauta.ver'),
    editavel: can('pauta.editar'),
    recarregar: carregar,
    criar: (input: MaquinaPostSalvarInput) =>
      agir(async () => trocar(await apiPost<MaquinaPost>('/marketing/maquina/posts', input, token))),
    salvar: (id: string, input: MaquinaPostSalvarInput) =>
      agir(async () => trocar(await apiPut<MaquinaPost>(`/marketing/maquina/posts/${id}`, input, token))),
    mudarEtapa: (id: string, etapa: MaquinaEtapa, data?: string | null, linkPublicado?: string) =>
      agir(async () =>
        trocar(await apiPatch<MaquinaPost>(`/marketing/maquina/posts/${id}/etapa`, { etapa, data: data ?? null, linkPublicado }, token)),
      ),
    mudarData: (id: string, data: string | null) =>
      agir(async () => trocar(await apiPatch<MaquinaPost>(`/marketing/maquina/posts/${id}/data`, { data }, token))),
    comentar: (id: string, texto: string) =>
      agir(async () => trocar(await apiPost<MaquinaPost>(`/marketing/maquina/posts/${id}/comentarios`, { texto }, token))),
    salvarMetricas: (id: string, linkPublicado: string, metricas: Record<string, number>) =>
      agir(async () => trocar(await apiPut<MaquinaPost>(`/marketing/maquina/posts/${id}/metricas`, { linkPublicado, metricas }, token))),
    ordenar: async (ids: string[]) => {
      // A ordem muda na tela na hora; se o servidor recusar, recarrega a verdadeira.
      setPainel((atual) => {
        if (!atual) return atual;
        const pos = new Map(ids.map((id, i) => [id, i + 1]));
        return { ...atual, posts: atual.posts.map((p) => (pos.has(p.id) ? { ...p, ordem: pos.get(p.id)! } : p)) };
      });
      const ok = await agir(() => apiPost('/marketing/maquina/ordem', { ids }, token));
      if (!ok) await carregar();
    },
    salvarCadencia: (dias: number[]) =>
      agir(async () => {
        const r = await apiPut<{ cadencia: number[] }>('/marketing/maquina/cadencia', { dias }, token);
        await carregar();
        return r;
      }),
  };
}

export type Maquina = ReturnType<typeof useMaquina>;
