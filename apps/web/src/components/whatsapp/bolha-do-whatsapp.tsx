'use client';

/*
 * A BOLHA DE NÃO LIDAS DO WHATSAPP NO MENU (produção 22C, W4, lane D).
 *
 * Lê o mesmo resumo do cartão do Dia a dia (`GET /whatsapp/resumo`, guardado
 * 30 s por empresa na API) e mostra o total de não lidas no item WhatsApp do
 * menu lateral. Relê a cada 30 s só com a aba visível, ao voltar para a aba e a
 * cada navegação. Sem a área WhatsApp no menu (sem `leads.ver` ou sem o módulo
 * `leads`), não pergunta nada. Zero, falha ou ainda não lido: sem bolha.
 * Só leitura: nada vira tarefa nem pendência.
 */
import { useEffect, useState } from 'react';
import type { FiltroDaCaixa, ResumoDoWhatsapp } from '@mktos/shared';

import { apiGet } from '@/lib/api';

/** De quanto em quanto tempo a bolha relê, com a aba visível. */
export const INTERVALO_DA_BOLHA_MS = 30_000;

/** O endereço da caixa já filtrada. */
export function urlDaCaixa(filtro: FiltroDaCaixa): string {
  return `/whatsapp?filtro=${filtro}`;
}

/** O que a bolha escreve: `null` = sem bolha. Acima de 99, "99+". */
export function textoDaBolha(n: number | null | undefined): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  return n > 99 ? '99+' : String(Math.floor(n));
}

/** A frase da bolha para leitor de tela e `title`. */
export function fraseDaBolha(n: number): string {
  // Layout 27/10: o número é de conversas com mensagem nova, não de mensagens.
  return n === 1 ? '1 conversa com mensagem nova no WhatsApp' : `${n} conversas com mensagem nova no WhatsApp`;
}

function abaVisivel(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/**
 * O total de não lidas do WhatsApp, ou `null` (sem bolha). `ativo` = a pessoa vê
 * a área WhatsApp no menu; `chave` muda a cada navegação e pede uma releitura.
 */
export function useNaoLidasDoWhatsapp(token: string | null | undefined, ativo: boolean, chave?: string): number | null {
  const [n, setN] = useState<number | null>(null);

  useEffect(() => {
    if (!ativo || !token) {
      setN(null);
      return;
    }
    let vivo = true;
    const ler = () => {
      if (!abaVisivel()) return;
      // Embrulhada: a bolha é cosmética e nunca pode derrubar o menu, nem quando a leitura falha antes da promessa.
      Promise.resolve()
        .then(() => apiGet<ResumoDoWhatsapp>('/whatsapp/resumo', token))
        .then((r) => {
          if (!vivo) return;
          // Layout 27/10 (Lucas): conta conversas com mensagem nova; a API antiga só manda o total de mensagens.
          const total = r?.conversasNaoLidas ?? r?.naoLidas?.total;
          setN(typeof total === 'number' && Number.isFinite(total) ? total : null);
        })
        .catch(() => {
          if (vivo) setN(null);
        });
    };
    ler();
    const relogio = window.setInterval(ler, INTERVALO_DA_BOLHA_MS);
    const aoMudarAba = () => {
      if (abaVisivel()) ler();
    };
    document.addEventListener('visibilitychange', aoMudarAba);
    return () => {
      vivo = false;
      window.clearInterval(relogio);
      document.removeEventListener('visibilitychange', aoMudarAba);
    };
  }, [token, ativo, chave]);

  return n;
}

/** A bolha no item WhatsApp do menu. No menu recolhido, ela sobe para o canto do ícone. */
export function BolhaDoWhatsapp({ n, compacta }: { n: number | null; compacta: boolean }) {
  const texto = textoDaBolha(n);
  if (!texto || n == null) return null;
  const frase = fraseDaBolha(n);
  return (
    <span
      role="img"
      aria-label={frase}
      title={frase}
      data-testid="whatsapp-bolha"
      className={`com-num rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold leading-none text-ink ${compacta ? 'min-[820px]:absolute min-[820px]:right-1 min-[820px]:top-1 min-[820px]:px-1 min-[820px]:py-0 min-[820px]:text-[9px]' : ''}`}
    >
      {texto}
    </span>
  );
}
