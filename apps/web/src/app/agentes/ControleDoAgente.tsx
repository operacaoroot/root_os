'use client';

import { useState } from 'react';
import { apiPost } from '@/lib/api';
import {
  AVISO_DA_INVOCACAO,
  EXPLICA_O_ESTADO,
  ROTULO_DA_SITUACAO,
  ROTULO_DO_ESTADO,
  TOM_DA_SITUACAO,
  botoesDeEstado,
  type BotaoDeEstado,
  type EstadoDeAgente,
  type SituacaoDeAgente,
  type Tom,
} from './estado';

/*
 * ============================================================================
 * O ESTADO DO AGENTE NA MÃO DO DONO — fatia A2
 * ============================================================================
 *
 * DOIS SELOS, e não um. O de cima é a DECISÃO (ativo, pausado, encerrado); o de
 * baixo é o que ESTÁ ACONTECENDO (rodando agora, ocioso, erro na última
 * passagem). Os dois vêm do servidor — `estado` é coluna, `situacao` é derivada
 * lá — e aparecem juntos porque um sozinho esconderia o outro: "ativo" não
 * responde se ele trabalhou hoje, e "erro" não responde se alguém já o parou.
 *
 * Quando os dois dizem a mesma coisa (agente pausado tem situação `pausado`), o
 * segundo selo não aparece: repetir a palavra ocuparia espaço sem informar.
 *
 * A TELA NÃO CALCULA NADA. Quais botões existem vem de `agente.transicoes`;
 * quem recusa de verdade é a API. O que esta peça faz é DIZER O QUE CADA BOTÃO
 * FAZ antes de alguém clicar — inclusive que uma ação do agente pode ficar
 * retida esperando outra pessoa.
 */

const CORES: Record<Tom, string> = {
  ok: 'bg-good/15 text-good',
  atencao: 'bg-warn/15 text-warn',
  erro: 'bg-bad/15 text-bad',
  neutro: 'bg-surface-3 text-muted',
};

function Selo({ texto, tom, titulo }: { texto: string; tom: Tom; titulo?: string }) {
  return (
    <span
      title={titulo}
      className={`inline-flex items-center gap-[5px] whitespace-nowrap rounded-root px-[6px] py-[2px] font-os-mono text-[10px] font-medium uppercase tracking-[0.1em] ${CORES[tom]}`}
    >
      {/* O ponto faz o estado ler por FORMA também, não só por cor — a mesma
          decisão do `StatusChip` dos leads (daltonismo, tema mono, impressão). */}
      <span aria-hidden className="h-[5px] w-[5px] rounded-full bg-current" />
      {texto}
    </span>
  );
}

export interface AgenteComEstado {
  slug: string;
  nome: string;
  estado: EstadoDeAgente;
  situacao: SituacaoDeAgente;
  estadoPor: string | null;
  estadoEm: string | null;
  estadoMotivo: string | null;
  transicoes: string[];
}

/** Os dois selos, lado a lado. Vale sozinho — a lista e o mapa também o usam. */
export function SelosDoAgente({ agente }: { agente: AgenteComEstado }) {
  const mesmaPalavra = agente.situacao === agente.estado;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Selo
        texto={ROTULO_DO_ESTADO[agente.estado] ?? agente.estado}
        tom={TOM_DA_SITUACAO[agente.estado] ?? 'neutro'}
        titulo={EXPLICA_O_ESTADO[agente.estado]}
      />
      {!mesmaPalavra && (
        <Selo
          texto={ROTULO_DA_SITUACAO[agente.situacao] ?? agente.situacao}
          tom={TOM_DA_SITUACAO[agente.situacao] ?? 'neutro'}
          titulo="o que está acontecendo agora — medido das sessões, não declarado"
        />
      )}
    </span>
  );
}

interface Props {
  agente: AgenteComEstado;
  token: string | null;
  /** `admin.usuarios` — a mesma chave que o interruptor de conector pede. */
  podeComandar: boolean;
  /** A dupla que a API exige para fazer um agente rodar. */
  podeInvocar: boolean;
  aoMudar: () => void;
}

export function ControleDoAgente({ agente, token, podeComandar, podeInvocar, aoMudar }: Props) {
  const [abrindo, setAbrindo] = useState<BotaoDeEstado | null>(null);
  const [motivo, setMotivo] = useState('');
  const [emCurso, setEmCurso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /*
   * O DESFECHO DA INVOCAÇÃO, DITO COMO ELE FOI.
   *
   * A rota devolve o resumo da sessão, com `status` — que pode ser `recusada`
   * (agente pausado, teto de custo) ou `retida`. Anunciar "invocado" em cima de
   * qualquer um dos dois é o defeito que a tela do Google cometeu com o 200 de
   * retenção. Aqui o que aparece é o status e o motivo que a API mandou.
   */
  const [desfecho, setDesfecho] = useState<{ status: string; texto: string | null } | null>(null);

  const botoes = botoesDeEstado(agente.transicoes);

  async function mandar(botao: BotaoDeEstado, motivoTexto: string) {
    setEmCurso(botao.rota);
    setErro(null);
    try {
      await apiPost(
        `/agents/${agente.slug}/${botao.rota}`,
        { motivo: motivoTexto.trim() || undefined },
        token,
      );
      setAbrindo(null);
      setMotivo('');
      aoMudar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEmCurso(null);
    }
  }

  async function invocar() {
    setEmCurso('invocar');
    setErro(null);
    setDesfecho(null);
    try {
      const r = await apiPost<{ status: string; motivo?: string | null; resposta?: string }>(
        `/agents/${agente.slug}/invocar`,
        {},
        token,
      );
      setDesfecho({ status: r.status, texto: r.motivo ?? r.resposta ?? null });
      aoMudar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEmCurso(null);
    }
  }

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <SelosDoAgente agente={agente} />
        {/* A PROCEDÊNCIA DA DECISÃO. Sem ela, "pausado" é um agente parado que
            ninguém sabe se pode religar. */}
        {agente.estadoEm && (
          <span className="font-os-mono text-[9.5px] text-dim">
            desde {new Date(agente.estadoEm).toLocaleString('pt-BR')}
            {agente.estadoPor ? ` · por ${agente.estadoPor}` : ''}
          </span>
        )}
      </div>

      {agente.estadoMotivo && (
        <p className="font-os-mono text-[9.5px] leading-[1.6] text-muted">
          motivo: {agente.estadoMotivo}
        </p>
      )}

      {erro && (
        <p role="alert" className="font-os-mono text-[9.5px] leading-[1.6] text-bad">
          {erro}
        </p>
      )}

      {desfecho && (
        <p className="font-os-mono text-[9.5px] leading-[1.6] text-muted">
          passagem: <span className="text-text">{desfecho.status}</span>
          {desfecho.texto ? ` — ${desfecho.texto}` : ''}
        </p>
      )}

      {/* O PEDIDO DE MOTIVO, em cima do botão que o exige. Duas etapas de
          propósito: encerrar é definitivo, e um clique só seria barato demais
          para uma decisão que não volta. */}
      {abrindo ? (
        <div className="space-y-2 rounded-root border border-bad/40 bg-bad/5 p-2">
          <p className="text-[11px] leading-[1.5] text-muted">{abrindo.explica}</p>
          <label className="block text-[10px] text-dim" htmlFor={`motivo-${agente.slug}`}>
            Motivo (obrigatório — vai para o rastro)
          </label>
          <input
            id={`motivo-${agente.slug}`}
            autoFocus
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={500}
            placeholder="ex.: trabalho absorvido pela rotina de pauta"
            className="w-full rounded border border-border bg-bg px-2 py-1 font-os-mono text-[10px] text-text outline-none focus:border-brand"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!motivo.trim() || emCurso === abrindo.rota}
              onClick={() => mandar(abrindo, motivo)}
              className="rounded-root bg-bad px-2 py-1 font-os-mono text-[9.5px] uppercase tracking-[0.1em] text-ink disabled:opacity-50"
            >
              {emCurso === abrindo.rota ? 'encerrando…' : `${abrindo.rotulo} de vez`}
            </button>
            <button
              type="button"
              onClick={() => {
                setAbrindo(null);
                setMotivo('');
              }}
              className="font-os-mono text-[9.5px] uppercase tracking-[0.1em] text-muted"
            >
              cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {podeComandar &&
            botoes.map((b) => (
              <button
                key={b.rota}
                type="button"
                title={b.explica}
                disabled={emCurso !== null}
                onClick={() => (b.pedeMotivo ? setAbrindo(b) : mandar(b, ''))}
                className={`rounded-root border px-2 py-1 font-os-mono text-[9.5px] uppercase tracking-[0.1em] disabled:opacity-50 ${
                  b.tom === 'erro'
                    ? 'border-bad/50 text-bad hover:bg-bad/10'
                    : b.tom === 'atencao'
                      ? 'border-warn/50 text-warn hover:bg-warn/10'
                      : 'border-good/50 text-good hover:bg-good/10'
                }`}
              >
                {emCurso === b.rota ? '…' : b.rotulo}
              </button>
            ))}

          {/* INVOCAR só aparece para quem pode fazer o agente rodar, e só
              enquanto ele PODE rodar: oferecer o botão a um agente encerrado
              seria prometer uma passagem que a API recusa. */}
          {podeInvocar && agente.estado === 'ativo' && (
            <button
              type="button"
              title={AVISO_DA_INVOCACAO}
              disabled={emCurso !== null}
              onClick={invocar}
              className="rounded-root bg-brand px-2 py-1 font-os-mono text-[9.5px] uppercase tracking-[0.1em] text-ink disabled:opacity-50"
            >
              {emCurso === 'invocar' ? 'invocando…' : 'Invocar'}
            </button>
          )}
        </div>
      )}

      {/* O QUE CADA BOTÃO FAZ, escrito — não só no `title`, que não existe no
          celular. A frase da invocação inclui a RETENÇÃO: ela é o que a pessoa
          precisa saber ANTES do clique. */}
      {!abrindo && podeComandar && botoes.length > 0 && (
        <ul className="space-y-[2px] font-os-mono text-[9px] leading-[1.6] text-dim">
          {botoes.map((b) => (
            <li key={b.rota}>
              <span className="text-muted">{b.rotulo.toLowerCase()}</span> — {b.explica}
            </li>
          ))}
        </ul>
      )}
      {!abrindo && podeInvocar && agente.estado === 'ativo' && (
        <p className="font-os-mono text-[9px] leading-[1.6] text-dim">{AVISO_DA_INVOCACAO}</p>
      )}
      {agente.estado === 'encerrado' && (
        <p className="font-os-mono text-[9px] leading-[1.6] text-dim">
          Encerrado não volta. O histórico dele segue em Sessões e no Rastro.
        </p>
      )}
    </div>
  );
}
