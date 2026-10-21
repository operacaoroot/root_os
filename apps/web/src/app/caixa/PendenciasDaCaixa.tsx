'use client';

/*
 * AS PENDÊNCIAS DOS AGENTES NA CAIXA (rodada dos agentes, 21/10/2026).
 *
 * O que um agente ou uma rotina deixou para uma pessoa (o cobrador de tarefas, o
 * arquivista sem subpasta certa, a triagem do WhatsApp com confiança baixa, o vigia
 * da agenda): a lista é a de `GET /pendencias` (abertas, as suas e as sem
 * destinatário), já TRIADA (`GET /caixa/pendencias`, TR-08): agrupada por urgência
 * (a regra decide: prazo, aprovação vencendo) e por cliente (o explícito, ou o que a
 * triagem agrupou do texto do item).
 *
 * Responder é UM TOQUE na opção (`POST /pendencias/:id/responder`), e "descartar"
 * fica registrado (`POST /pendencias/:id/descartar`); os dois são de gente, e quem
 * confere é a API. O CONTADOR É HONESTO: é o total que a mesma leitura devolveu, e
 * o item que você respondeu ou descartou sai da lista e do número na releitura.
 */
import { useState } from 'react';
import type { GrupoDaCaixa, PendenciaNaCaixa, PendenciasDaCaixa, UrgenciaDaPendencia } from '@mktos/shared';

import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCarregar } from '../comercial/_ui';
import { BOTAO_PEQUENO, CARTAO, FOCO, ROTULO, Vazio, haQuanto } from './comum';

export interface PendenciasLidas {
  dados: PendenciasDaCaixa | null;
  erro: unknown;
  carregando: boolean;
  recarregar: () => Promise<void>;
}

/** A leitura, uma vez, para o contador do topo e para a aba (os dois publicam o mesmo número). */
export function usePendenciasDaCaixa(): PendenciasLidas {
  const { dados, erro, carregando, recarregar } = useCarregar<PendenciasDaCaixa>('/caixa/pendencias', 30_000);
  return { dados, erro, carregando, recarregar };
}

const ROTULO_DA_URGENCIA: Record<UrgenciaDaPendencia, string> = { urgente: 'Urgente', hoje: 'Hoje', depois: 'Depois' };
const COR_DA_URGENCIA: Record<UrgenciaDaPendencia, string> = { urgente: 'text-bad', hoje: 'text-warn', depois: 'text-muted' };

/** "Pendências dos agentes N" no Resumo do topo. */
export function ContadorDePendencias({ pendencias, aoAbrir }: { pendencias: PendenciasLidas; aoAbrir: () => void }) {
  const n = pendencias.dados?.total;
  return (
    <p className="text-sm" data-testid="caixa-pendencias-contador">
      <span className={ROTULO}>Pendências dos agentes</span>{' '}
      {n !== undefined ? (
        <span className="font-os-mono text-base text-text">{n}</span>
      ) : pendencias.erro ? (
        <span className="text-xs text-muted">sem leitura agora</span>
      ) : (
        <span className="text-xs text-muted">medindo...</span>
      )}{' '}
      <button type="button" onClick={aoAbrir} className={`text-xs text-brand hover:underline ${FOCO}`}>
        abrir
      </button>
    </p>
  );
}

function CartaoDaPendencia({ p, aoAgir }: { p: PendenciaNaCaixa; aoAgir: (texto: string) => Promise<void> }) {
  const { token } = useAuth();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const agir = async (caminho: string, corpo: unknown, texto: string) => {
    setOcupado(true);
    setErro(null);
    try {
      await apiPost(caminho, corpo, token);
      await aoAgir(texto);
    } catch (e) {
      setErro((e as Error).message);
      setOcupado(false);
    }
  };
  return (
    <li className={`${CARTAO} space-y-1.5 px-3 py-2`} data-testid={`pendencia-${p.id}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[13px] font-medium text-text">{p.titulo}</span>
        <span className="font-os-mono text-[10px] text-muted" title="A função que deixou este item">
          {p.funcao}{p.funcaoNome ? ` · ${p.funcaoNome}` : ''}
        </span>
        <span className="text-[11px] text-muted">{haQuanto(p.criadaEm, new Date())}</span>
        {p.motivoDaUrgencia && <span className={`text-[11px] ${COR_DA_URGENCIA[p.urgencia]}`}>{p.motivoDaUrgencia}</span>}
      </div>
      {p.contexto && (
        <details className="text-[12px] text-muted" open={p.contexto.length <= 280}>
          <summary className="cursor-pointer select-none">contexto</summary>
          <p className="whitespace-pre-wrap break-words">{p.contexto}</p>
        </details>
      )}
      <div className="flex flex-wrap gap-2">
        {p.opcoes.map((o) => (
          <button
            key={o.chave}
            type="button"
            disabled={ocupado}
            className={BOTAO_PEQUENO}
            data-testid={`pendencia-${p.id}-opcao-${o.chave}`}
            onClick={() => agir(`/pendencias/${encodeURIComponent(p.id)}/responder`, { escolha: o.chave }, `Respondido: ${o.rotulo}.`)}
          >
            {o.rotulo}
          </button>
        ))}
        <button
          type="button"
          disabled={ocupado}
          className={BOTAO_PEQUENO}
          data-testid={`pendencia-${p.id}-descartar`}
          onClick={() => agir(`/pendencias/${encodeURIComponent(p.id)}/descartar`, {}, 'Descartado.')}
        >
          descartar
        </button>
      </div>
      {erro && (
        <p role="alert" className="text-xs text-bad">
          {erro}
        </p>
      )}
    </li>
  );
}

function tituloDoGrupo(g: GrupoDaCaixa): string {
  return `${ROTULO_DA_URGENCIA[g.urgencia]} · ${g.cliente ?? 'sem cliente'}`;
}

export function ListaDePendencias({ pendencias }: { pendencias: PendenciasLidas }) {
  const { dados, erro, carregando, recarregar } = pendencias;
  const [aviso, setAviso] = useState<string | null>(null);
  if (erro && !dados) {
    return <p className="text-sm text-muted">As pendências dos agentes não responderam agora. A lista volta na próxima leitura.</p>;
  }
  if (carregando && !dados) return <p className="text-sm text-muted">Lendo as pendências dos agentes...</p>;
  if (!dados) return null;
  return (
    <section aria-label="Pendências dos agentes" className="space-y-3" data-testid="caixa-pendencias">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={ROTULO}>Pendências dos agentes · {dados.total}</h2>
        <p className="text-[11.5px] text-muted">
          {dados.triagem === 'modelo'
            ? 'Agrupadas por urgência (regra) e por cliente; o cliente sem nome no item foi agrupado pela triagem.'
            : dados.triagem === 'regra'
              ? 'Agrupadas por urgência (regra); a triagem por cliente não respondeu agora.'
              : 'Agrupadas por urgência (regra) e pelo cliente que cada item diz.'}
        </p>
      </div>
      <p aria-live="polite" className="text-xs text-good empty:hidden" data-testid="caixa-pendencias-aviso">
        {aviso ?? ''}
      </p>
      {dados.total === 0 ? (
        <Vazio>Nenhuma pendência dos agentes esperando por você.</Vazio>
      ) : (
        dados.grupos.map((g) => (
          <div key={tituloDoGrupo(g)} className="space-y-2" data-testid="caixa-pendencias-grupo">
            <h3 className={`text-[12px] font-semibold ${COR_DA_URGENCIA[g.urgencia]}`}>
              {tituloDoGrupo(g)} <span className="font-os-mono text-muted">({g.itens.length})</span>
            </h3>
            <ul className="space-y-2">
              {g.itens.map((p) => (
                <CartaoDaPendencia
                  key={p.id}
                  p={p}
                  aoAgir={async (texto) => {
                    setAviso(texto);
                    await recarregar();
                  }}
                />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
