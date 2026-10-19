'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * A TAREFA ABERTA MORA NA URL (rodada do trabalho T2, 19/10/2026).
 *
 * O pop-up da tarefa abre por cima da tela atual (Pendências, Minhas tarefas,
 * Trabalho, Implantação) com `?tarefa=<id>` no endereço, no mesmo padrão do
 * painel do lead: abrir EMPILHA uma entrada no histórico, então o voltar do
 * navegador fecha; fechar pelo X ou pelo Esc volta a entrada que abrimos; o link
 * copiado abre direto na tarefa. `?tarefaAba=trilho` abre na aba do trilho.
 */

export type AbaDaTarefa = 'tarefa' | 'trilho';

const ID = /^[0-9a-f-]{36}$/i;

export interface TarefaNaUrl {
  tarefaId: string | null;
  aba: AbaDaTarefa;
  abrir: (id: string, aba?: AbaDaTarefa) => void;
  trocarAba: (aba: AbaDaTarefa) => void;
  fechar: () => void;
}

export function lerTarefaDaUrl(busca: string): { tarefaId: string | null; aba: AbaDaTarefa } {
  const p = new URLSearchParams(busca);
  const id = p.get('tarefa');
  return { tarefaId: id && ID.test(id) ? id : null, aba: p.get('tarefaAba') === 'trilho' ? 'trilho' : 'tarefa' };
}

export function urlComTarefa(href: string, id: string | null, aba: AbaDaTarefa = 'tarefa'): string {
  const url = new URL(href);
  if (id) url.searchParams.set('tarefa', id);
  else url.searchParams.delete('tarefa');
  if (id && aba === 'trilho') url.searchParams.set('tarefaAba', 'trilho');
  else url.searchParams.delete('tarefaAba');
  return `${url.pathname}${url.search}${url.hash}`;
}

export function useTarefaNaUrl(): TarefaNaUrl {
  const [estado, setEstado] = useState<{ tarefaId: string | null; aba: AbaDaTarefa }>({ tarefaId: null, aba: 'tarefa' });
  // A entrada do histórico é nossa (abrimos por clique): fechar volta em vez de reescrever.
  const empilhou = useRef(false);

  useEffect(() => {
    const ler = () => {
      const lido = lerTarefaDaUrl(window.location.search);
      if (!lido.tarefaId) empilhou.current = false;
      setEstado((antes) => (antes.tarefaId === lido.tarefaId && antes.aba === lido.aba ? antes : lido));
    };
    ler();
    window.addEventListener('popstate', ler);
    return () => window.removeEventListener('popstate', ler);
  }, []);

  const abrir = useCallback((id: string, aba: AbaDaTarefa = 'tarefa') => {
    const url = urlComTarefa(window.location.href, id, aba);
    if (lerTarefaDaUrl(window.location.search).tarefaId) {
      window.history.replaceState(window.history.state, '', url);
    } else {
      window.history.pushState(window.history.state, '', url);
      empilhou.current = true;
    }
    setEstado({ tarefaId: id, aba });
  }, []);

  const trocarAba = useCallback((aba: AbaDaTarefa) => {
    const atual = lerTarefaDaUrl(window.location.search).tarefaId;
    if (!atual) return;
    window.history.replaceState(window.history.state, '', urlComTarefa(window.location.href, atual, aba));
    setEstado({ tarefaId: atual, aba });
  }, []);

  const fechar = useCallback(() => {
    setEstado({ tarefaId: null, aba: 'tarefa' });
    if (empilhou.current) {
      empilhou.current = false;
      window.history.back();
      return;
    }
    window.history.replaceState(window.history.state, '', urlComTarefa(window.location.href, null));
  }, []);

  return { ...estado, abrir, trocarAba, fechar };
}
