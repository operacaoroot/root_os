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

/**
 * Layout 26/10: o link de uma tarefa (o `href` para /trabalho continua, para abrir em
 * outra aba e para copiar) abre o pop-up AQUI MESMO no clique comum. Ctrl, ⌘, Shift,
 * Alt e o botão do meio seguem o link, como o navegador faz.
 */
export function abrirAquiNoClique(abrir: (id: string) => void, id: string) {
  return (e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number; preventDefault: () => void }) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    abrir(id);
  };
}

export function useTarefaNaUrl(): TarefaNaUrl {
  const [estado, setEstado] = useState<{ tarefaId: string | null; aba: AbaDaTarefa }>({ tarefaId: null, aba: 'tarefa' });
  // A entrada do histórico é nossa (abrimos por clique): fechar volta em vez de reescrever.
  const empilhou = useRef(false);
  /*
   * O `history.back()` é ASSÍNCRONO: o navegador só volta numa tarefa seguinte, e a
   * volta é contada a partir da entrada em que estiver NAQUELE momento. Abrir outra
   * tarefa logo depois de fechar empilhava a entrada nova e a volta pendente a tirava,
   * fechando a tarefa recém-aberta. Enquanto a volta não chega, quem pede para abrir
   * fica guardado aqui e a entrada nova só é empilhada depois do `popstate`.
   */
  const voltando = useRef(false);
  const pendente = useRef<{ tarefaId: string; aba: AbaDaTarefa } | null>(null);
  const reserva = useRef<ReturnType<typeof setTimeout> | null>(null);

  const empilhar = useCallback((id: string, aba: AbaDaTarefa) => {
    const url = urlComTarefa(window.location.href, id, aba);
    if (lerTarefaDaUrl(window.location.search).tarefaId) {
      window.history.replaceState(window.history.state, '', url);
    } else {
      window.history.pushState(window.history.state, '', url);
      empilhou.current = true;
    }
  }, []);

  const terminarVolta = useCallback(() => {
    voltando.current = false;
    if (reserva.current) clearTimeout(reserva.current);
    reserva.current = null;
    const p = pendente.current;
    pendente.current = null;
    if (p) {
      empilhar(p.tarefaId, p.aba);
      setEstado(p);
      return true;
    }
    return false;
  }, [empilhar]);

  useEffect(() => {
    const ler = () => {
      if (voltando.current && terminarVolta()) return;
      const lido = lerTarefaDaUrl(window.location.search);
      if (!lido.tarefaId) empilhou.current = false;
      setEstado((antes) => (antes.tarefaId === lido.tarefaId && antes.aba === lido.aba ? antes : lido));
    };
    ler();
    window.addEventListener('popstate', ler);
    return () => {
      window.removeEventListener('popstate', ler);
      if (reserva.current) clearTimeout(reserva.current);
    };
  }, [terminarVolta]);

  const abrir = useCallback((id: string, aba: AbaDaTarefa = 'tarefa') => {
    setEstado({ tarefaId: id, aba });
    if (voltando.current) {
      pendente.current = { tarefaId: id, aba };
      return;
    }
    empilhar(id, aba);
  }, [empilhar]);

  const trocarAba = useCallback((aba: AbaDaTarefa) => {
    if (voltando.current && pendente.current) {
      pendente.current = { ...pendente.current, aba };
      setEstado(pendente.current);
      return;
    }
    const atual = lerTarefaDaUrl(window.location.search).tarefaId;
    if (!atual) return;
    window.history.replaceState(window.history.state, '', urlComTarefa(window.location.href, atual, aba));
    setEstado({ tarefaId: atual, aba });
  }, []);

  const fechar = useCallback(() => {
    setEstado({ tarefaId: null, aba: 'tarefa' });
    pendente.current = null;
    if (voltando.current) return;
    // O endereço fica certo na hora; a volta só devolve a entrada que empilhamos.
    window.history.replaceState(window.history.state, '', urlComTarefa(window.location.href, null));
    if (empilhou.current) {
      empilhou.current = false;
      voltando.current = true;
      window.history.back();
      // Se o navegador não devolver o `popstate` (aba sem a entrada), a espera não trava a tela.
      reserva.current = setTimeout(() => { if (voltando.current) terminarVolta(); }, 1000);
    }
  }, [terminarVolta]);

  return { ...estado, abrir, trocarAba, fechar };
}
