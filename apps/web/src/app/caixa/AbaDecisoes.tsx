'use client';

/*
 * ==========================================================================
 * A ABA DECISÕES DE PENDÊNCIAS (rodada do trabalho T6, 19/10/2026)
 * ==========================================================================
 *
 * A fila de decisões do comercial (manter preço, liberar proposta...) saiu do
 * menu do Motor Comercial e mora aqui, ao lado do resto do que espera por você.
 *
 * NADA DE REGRA NOVA. A lista é a mesma rota da tela antiga
 * (`GET /comercial/fila`) e cada cartão é o MESMO `CartaoDeDecisao` de
 * `app/comercial/_decisao.tsx`: as opções em um toque, o padrão nomeado, o
 * prazo e o que acontece se ninguém responder. Responder é a mesma rota
 * (`POST /comercial/decisoes/:id/responder`), com a mesma conferência de quem
 * propôs e de quem decide. Vencida segue o que a API faz hoje: o relógio
 * aplica o padrão.
 *
 * QUEM VÊ: quem tem `leads.ver` (a permissão da rota da fila) com o módulo
 * `leads` ligado, como o menu confere. Enquanto a lista de módulos não chega,
 * "não sei" mostra (a mesma direção da barra lateral); quem recusa de verdade é
 * a API.
 *
 * O nome do lead leva ao Funil vivo com o painel do lead aberto na aba
 * Decisões: aqui não há o provedor do painel, porque a query `?aba=` já é a
 * aba da caixa.
 *
 * RODADA DOS AGENTES (21/10/2026): a aba passa a mostrar também as PENDÊNCIAS
 * dos agentes (`PendenciasDaCaixa.tsx`), para TODA pessoa da caixa, antes da fila
 * do comercial. A fila do comercial continua só para quem tem `leads.ver` com o
 * módulo `leads` ligado; sem isso, a aba traz só as pendências.
 */
import { useState } from 'react';
import Link from 'next/link';
import type { FilaDeDecisoes } from '@mktos/shared';

import { useAuth } from '@/lib/auth';
import { useModulos } from '@/components/modulos';
import { useCarregar } from '../comercial/_ui';
import { CartaoDeDecisao } from '../comercial/_decisao';
import { Carregando, ErroComRetentativa, FOCO, ROTULO, Vazio } from './comum';
import { ListaDePendencias, type PendenciasLidas } from './PendenciasDaCaixa';

/** Quem vê a aba e o contador: `leads.ver` e o módulo `leads` ligado. */
export function useVeDecisoes(): boolean {
  const { can } = useAuth();
  const { ligado } = useModulos();
  return can('leads.ver') && ligado('leads');
}

export interface FilaDoComercial {
  dados: FilaDeDecisoes | null;
  erro: unknown;
  carregando: boolean;
  recarregar: () => Promise<void>;
}

/**
 * A fila do comercial, lida uma vez para o contador do topo e para a aba (os
 * dois publicam o mesmo número). Sem a aba, não lê nada.
 */
export function useFilaDoComercial(ve: boolean): FilaDoComercial {
  const { dados, erro, carregando, recarregar } = useCarregar<FilaDeDecisoes>(ve ? '/comercial/fila' : null, 30_000);
  return { dados, erro, carregando, recarregar };
}

/** "Decisões do comercial N" no Resumo do topo, que leva à aba. */
export function ContadorDeDecisoes({ fila, aoAbrir }: { fila: FilaDoComercial; aoAbrir: () => void }) {
  const n = fila.dados?.resumo?.decisoes;
  return (
    <p className="text-sm" data-testid="caixa-decisoes">
      <span className={ROTULO}>Decisões do comercial</span>{' '}
      {n !== undefined ? (
        <span className="font-os-mono text-base text-text">{n}</span>
      ) : fila.erro ? (
        <span className="text-xs text-muted">sem leitura agora</span>
      ) : (
        <span className="text-xs text-muted">medindo...</span>
      )}{' '}
      <button type="button" onClick={aoAbrir} className={`text-xs text-brand hover:underline ${FOCO}`}>
        abrir Decisões
      </button>
    </p>
  );
}

/** A aba: as pendências dos agentes (todos) e, para quem vê, a fila do comercial. */
export function AbaDecisoes({ fila, pendencias }: { fila: FilaDoComercial | null; pendencias: PendenciasLidas }) {
  return (
    <div className="space-y-6">
      <ListaDePendencias pendencias={pendencias} />
      {fila && <DecisoesDoComercial fila={fila} />}
    </div>
  );
}

function DecisoesDoComercial({ fila }: { fila: FilaDoComercial }) {
  const { dados, erro, carregando, recarregar } = fila;
  const [aviso, setAviso] = useState<string | null>(null);
  // Os cartões que acabaram de ser respondidos saem com a transição antes da fila reler.
  const [saindo, setSaindo] = useState<Set<string>>(new Set());

  async function respondida(id: string, texto: string) {
    setAviso(texto);
    setSaindo((s) => new Set(s).add(id));
    await new Promise((r) => setTimeout(r, 220));
    await recarregar();
    setSaindo((s) => {
      const novo = new Set(s);
      novo.delete(id);
      return novo;
    });
  }

  if (erro && !dados) {
    const mensagem = erro instanceof Error ? erro.message : 'a fila de decisões não respondeu';
    return <ErroComRetentativa mensagem={mensagem} onTentar={() => void recarregar()} />;
  }
  if (carregando && !dados) return <Carregando texto="Lendo a fila de decisões do comercial..." />;
  if (!dados) return null;

  const decisoes = dados.decisoes;

  return (
    <section aria-label="Decisões do comercial" className="space-y-3" data-testid="caixa-decisoes-lista">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <p className="max-w-2xl text-[13px] text-muted">
          Só o que saiu da regra no comercial. Cada decisão tem o padrão escrito e o prazo; se ninguém responder, vale o
          padrão.
        </p>
        <Link href="/comercial/funil" className={`text-xs text-brand hover:underline ${FOCO}`}>
          abrir o Funil vivo
        </Link>
      </div>
      <p aria-live="polite" className="text-xs text-good empty:hidden" data-testid="caixa-decisoes-aviso">
        {aviso ?? ''}
      </p>
      {decisoes.length === 0 ? (
        <Vazio>
          Nenhuma decisão do comercial esperando agora.{' '}
          {dados.resumo.acoesAutomaticasHoje > 0
            ? `${dados.resumo.acoesAutomaticasHoje} ${dados.resumo.acoesAutomaticasHoje === 1 ? 'ação rodou sozinha' : 'ações rodaram sozinhas'} hoje.`
            : 'Nada saiu da regra.'}
        </Vazio>
      ) : (
        decisoes.map((d) => (
          <div
            key={d.id}
            className={`transition-all duration-200 ease-out motion-reduce:transition-none ${saindo.has(d.id) ? 'pointer-events-none -translate-x-2 opacity-0' : 'opacity-100'}`}
          >
            <CartaoDeDecisao d={d} aoResponder={(texto) => respondida(d.id, texto)} />
          </div>
        ))
      )}
    </section>
  );
}
