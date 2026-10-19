'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { CaixaResposta } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCaixa } from '@/components/caixa';
import { AbaAtividade } from './AbaAtividade';
import { AbaMinhasTarefas } from './AbaMinhasTarefas';
import { AbaDecisoes, ContadorDeDecisoes, useFilaDoComercial, useVeDecisoes, type FilaDoComercial } from './AbaDecisoes';
import { CARTAO, FOCO, ROTULO } from './comum';

/*
 * ==========================================================================
 * A CAIXA DE ENTRADA — "Pendências" no Dia a dia (rodada do painel P1, 18/10/2026)
 * ==========================================================================
 *
 * O pedido: "semelhante à caixa do ClickUp". Duas abas sobre o quadro de
 * trabalho, e no topo o que espera a sua assinatura:
 *
 *  · ATIVIDADE — o que mudou nas tarefas em que você é o responsável (status,
 *    responsável, vencimento, comentário novo), do mais novo para o mais velho,
 *    com Limpar e Limpar tudo. Limpar é uma marca SUA: o item sai da sua caixa,
 *    fica no histórico e continua na caixa de quem mais acompanha a tarefa;
 *  · MINHAS TAREFAS — a tabela, com filtros, colunas que se escondem e os
 *    comentários num balão, sem sair da tela.
 *
 * ONDE ESTA TELA SE OBRIGA A NÃO MENTIR (as regras da fatia A7 continuam):
 *
 *  1. PERMISSÃO NÃO É ALÇADA. O número do topo é o das aprovações que VOCÊ pode
 *     assinar (alçada, invariante 7, prazo e o impedimento da porta), e quem
 *     acompanha a fila sem decidir lê a frase, não um zero;
 *  2. O CONTEÚDO EXATO DE UMA AÇÃO RETIDA NÃO PASSA POR AQUI. A fila, e a
 *     assinatura, continuam em `/atendimento`;
 *  3. "MINHAS" É CASAMENTO POR NOME, e a tela diz por quais nomes procurou;
 *  4. A CAIXA LÊ. Quem mexe na tarefa é o quadro; a única escrita daqui é o
 *     Limpar, que não muda tarefa nenhuma.
 *
 * A aba vai na query (`?aba=atividade|tarefas|decisoes`) por `history.replaceState`, como
 * a Pauta faz: o endereço copiado abre na mesma aba, e a troca não empilha
 * histórico do navegador.
 *
 * Rodada do trabalho T6 (19/10/2026): a terceira aba, DECISÕES, traz a fila de
 * decisões do comercial com os mesmos cartões de um toque (`AbaDecisoes.tsx`).
 * Só existe para quem tem `leads.ver` com o módulo `leads` ligado.
 */

const ABAS = [
  { chave: 'atividade', rotulo: 'Atividade' },
  { chave: 'tarefas', rotulo: 'Minhas tarefas' },
  { chave: 'decisoes', rotulo: 'Decisões' },
] as const;
type Aba = (typeof ABAS)[number]['chave'];

function abaDoEndereco(): Aba {
  if (typeof window === 'undefined') return 'atividade';
  const pedida = new URLSearchParams(window.location.search).get('aba');
  return pedida === 'tarefas' || pedida === 'decisoes' ? pedida : 'atividade';
}

/* ------------------------------------------------------------------------ *
 * O topo: o que espera a sua assinatura
 * ------------------------------------------------------------------------ */

function fraseDasAprovacoes(caixa: CaixaResposta): string | null {
  const e = caixa.aprovacoes.estado;
  if (e === 'ok') return null;
  if (e === 'fora_da_casa') {
    return 'Sua sessão não corresponde a um usuário ativo desta empresa. Saia e entre de novo.';
  }
  if (e === 'sem_permissao') {
    return 'Seu perfil não acompanha a fila de aprovação. O papel de cada pessoa define o que ela vê.';
  }
  if (e === 'nao_decide') {
    return 'Você acompanha a fila de aprovação, mas não decide nela (falta "aprovacoes.decidir"). Nada lá espera a sua assinatura.';
  }
  return null;
}

function Resumo({
  caixa,
  erro,
  onTentar,
  decisoes,
}: {
  caixa: CaixaResposta | null;
  erro: string | null;
  onTentar: () => void;
  /** O contador das decisões do comercial; ausente para quem não vê a aba. */
  decisoes?: { fila: FilaDoComercial; aoAbrir: () => void };
}) {
  if (erro) {
    return (
      <div role="alert" className={`${CARTAO} flex flex-wrap items-center gap-2 px-4 py-3 text-sm`}>
        <span className="text-bad">Não foi possível medir as aprovações: {erro}</span>
        <button type="button" onClick={onTentar} className={`text-xs text-brand hover:underline ${FOCO}`}>
          tentar de novo
        </button>
      </div>
    );
  }
  if (!caixa) return <p className="text-sm text-muted">Medindo o que espera por você...</p>;

  const frase = fraseDasAprovacoes(caixa);
  const n = caixa.aprovacoes.itens.length;
  const paradas = caixa.tarefas.itens.length;
  const medido = new Date(caixa.agora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  return (
    <section aria-label="O que espera por você" className={`${CARTAO} space-y-2 px-4 py-3`}>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <p className="text-sm" data-testid="caixa-aprovacoes">
          <span className={ROTULO}>Aprovações para você assinar</span>{' '}
          {frase ? (
            <span className="text-muted">{frase}</span>
          ) : (
            <>
              <span className="font-os-mono text-base text-text">
                {n}
                {caixa.aprovacoes.truncado ? '+' : ''}
              </span>{' '}
              <Link href="/atendimento" className={`text-xs text-brand hover:underline ${FOCO}`}>
                {n === 0 ? 'nada esperando; abrir Aprovações' : 'abrir Aprovações'}
              </Link>
            </>
          )}
        </p>
        {caixa.tarefas.estado === 'ok' && (
          <p className="text-sm">
            <span className={ROTULO}>Tarefas suas paradas</span>{' '}
            <span className="font-os-mono text-base text-text">
              {paradas}
              {caixa.tarefas.truncado ? '+' : ''}
            </span>
          </p>
        )}
        {decisoes && <ContadorDeDecisoes fila={decisoes.fila} aoAbrir={decisoes.aoAbrir} />}
        <p className="text-xs text-muted">
          sua alçada: <span className="text-text">{caixa.eu.alcada}</span> · medido às {medido}
        </p>
      </div>
      {caixa.eu.decide && !caixa.eu.decideNestaSessao && (
        <p className="text-xs text-warn">
          Seu perfil passou a decidir depois que esta sessão começou. Saia e entre de novo para valer.
        </p>
      )}
      {caixa.aprovacoes.retidasPorImpedimento > 0 && (
        <p className="text-xs text-warn">
          {caixa.aprovacoes.retidasPorImpedimento} aprovação(ões) alcançam a sua alçada, mas a porta recusaria hoje.
          Elas esperam um conserto, e{' '}
          <Link href="/atendimento" className="text-brand hover:underline">
            Aprovações
          </Link>{' '}
          diz qual é.
        </p>
      )}
      {caixa.totalParcial && (
        <p className="text-xs text-muted">Alguma contagem bateu no teto da consulta: o número é um piso.</p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------ *
 * A tela
 * ------------------------------------------------------------------------ */

export default function CaixaPage() {
  const { token, ready } = useAuth();
  const { recarregar } = useCaixa();
  const [caixa, setCaixa] = useState<CaixaResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>('atividade');
  const botoes = useRef<Record<Aba, HTMLButtonElement | null>>({ atividade: null, tarefas: null, decisoes: null });
  const veDecisoes = useVeDecisoes();
  const fila = useFilaDoComercial(veDecisoes);
  const abas = ABAS.filter((a) => a.chave !== 'decisoes' || veDecisoes);
  // `?aba=decisoes` de quem não vê a aba cai na Atividade.
  const abaAtiva: Aba = aba === 'decisoes' && !veDecisoes ? 'atividade' : aba;

  useEffect(() => {
    setAba(abaDoEndereco());
  }, []);

  const buscar = useCallback(async () => {
    if (!token) return;
    setErro(null);
    try {
      setCaixa(await apiGet<CaixaResposta>('/caixa', token));
      // O selo da barra lateral remede junto, para as duas superfícies não
      // publicarem números diferentes do mesmo número.
      recarregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [token, recarregar]);

  useEffect(() => {
    if (!ready || !token) return;
    void buscar();
  }, [ready, token, buscar]);

  function trocar(nova: Aba) {
    setAba(nova);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('aba', nova);
      window.history.replaceState(window.history.state, '', url.toString());
    } catch {
      /* endereço fora do navegador (teste): a aba troca do mesmo jeito */
    }
  }

  function teclaNasAbas(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const i = abas.findIndex((a) => a.chave === abaAtiva);
    const proxima =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? abas.length - 1
          : (i + (e.key === 'ArrowRight' ? 1 : -1) + abas.length) % abas.length;
    const alvo = abas[proxima].chave;
    trocar(alvo);
    botoes.current[alvo]?.focus();
  }

  return (
    <div className="space-y-4">
      <Resumo
        caixa={caixa}
        erro={erro}
        onTentar={() => void buscar()}
        decisoes={veDecisoes ? { fila, aoAbrir: () => trocar('decisoes') } : undefined}
      />

      <div role="tablist" aria-label="Caixa de entrada" onKeyDown={teclaNasAbas} className="flex gap-1 border-b border-border">
        {abas.map((a) => (
          <button
            key={a.chave}
            ref={(el) => {
              botoes.current[a.chave] = el;
            }}
            type="button"
            role="tab"
            id={`caixa-aba-${a.chave}-botao`}
            aria-selected={abaAtiva === a.chave}
            aria-controls={`caixa-painel-${a.chave}`}
            tabIndex={abaAtiva === a.chave ? 0 : -1}
            data-testid={`caixa-aba-${a.chave}`}
            onClick={() => trocar(a.chave)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] max-md:min-h-[44px] ${FOCO} ${
              abaAtiva === a.chave ? 'border-brand text-text' : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {a.rotulo}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`caixa-painel-${abaAtiva}`}
        aria-labelledby={`caixa-aba-${abaAtiva}-botao`}
        tabIndex={0}
        className="focus-visible:outline-none"
      >
        {ready && token ? (
          abaAtiva === 'atividade' ? (
            <AbaAtividade token={token} />
          ) : abaAtiva === 'decisoes' ? (
            <AbaDecisoes fila={fila} />
          ) : (
            <AbaMinhasTarefas token={token} />
          )
        ) : null}
      </div>
    </div>
  );
}
