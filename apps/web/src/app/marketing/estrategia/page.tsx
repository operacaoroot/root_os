'use client';

import { useState } from 'react';
import { chaveDaEstrategia, PAUTA_TETO_DA_ESTRATEGIA, PautaEstrategiaHumanoPainelSchema, PautaEstrategiaSalvarHumanoSchema, type PautaEstrategiaPainel } from '@mktos/shared';
import { useAuth } from '@/lib/auth';
import { apiPost } from '@/lib/api';
import { useEdicaoHumana, ConferenciaEdicaoHumana } from '../../pauta/InterruptorDaAutomacao';

/*
 * MK4 na tela. Um documento por mês: a IA propõe, a pessoa edita, e a última
 * palavra é dela — por isso o texto fica num campo editável e não num painel
 * de leitura com botão de "aceitar".
 *
 * A rota vive sob `/marketing` porque é ali que o bloco vai morar (mapa da MK0);
 * o item no menu entra na MK7, com a reorganização.
 */

/** `AAAA-MM` de hoje, no relógio de quem abre. */
function mesDeHoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const botaoCls =
  'rounded-lg px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50';

export default function EstrategiaPage() {
  const { token, user, ready } = useAuth();
  const [mes, setMes] = useState(mesDeHoje);
  const [visitados, setVisitados] = useState<string[]>([]);
  const escolher = (m: string) => { setVisitados(v => [...new Set([...v, mes, m])]); setMes(m); };
  if (!ready) return <p className="text-muted">Carregando…</p>;
  return <div key={`${token ?? ''}|${user?.id ?? ''}`}>{[...new Set([...visitados, mes])].map(m =>
    <div key={m} hidden={m !== mes} style={{ display: m === mes ? undefined : 'none' }}>
      <DocumentoDoMes mes={m} escolher={escolher} />
    </div>)}</div>;
}

function DocumentoDoMes({ mes, escolher }: { mes: string; escolher: (mes: string) => void }) {
  const { token, can } = useAuth();
  const editor = useEdicaoHumana({ token, path: `/pauta/estrategia/${mes}`, schema: PautaEstrategiaHumanoPainelSchema,
    destino: p => p.destinos.documento, texto: p => p.destinos.documento.estado === 'existente' ? p.destinos.documento.conteudo.corpo : p.painel.documento,
    conferir: p => p.mes === mes && p.painel.mes === mes && p.destinos.documento.chave === chaveDaEstrategia(mes) });
  const editavel = can('pauta.editar') && editor.visivel;
  const painel = editor.atual?.painel ?? null;
  const documento = editor.texto;
  const ocupado = editor.ocupado;
  const erro = null;
  const mudou = !!editor.base && documento !== (editor.destinoBase?.estado === 'existente' ? editor.destinoBase.conteudo.corpo : editor.base.painel.documento);
  const salvar = (reativar = false) => editor.enviar({ schema: PautaEstrategiaSalvarHumanoSchema, campos: { documento, mesEsperado: mes }, acao: 'salvar_estrategia', reativar });
  const gerar = () => editor.executarExterno(() => apiPost<PautaEstrategiaPainel>(`/pauta/estrategia/${mes}/gerar`, {}, token));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Estratégia do mês</h1>
        <p className="mt-1 text-sm text-muted">
          O que este mês prioriza: os pilares da vez, a cadência, as metas, as apostas e o que
          parar. A IA propõe a partir da marca, dos pilares, do que rende nos perfis observados e do
          que foi publicado no mês passado — e você reescreve o que quiser.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted">Mês</span>
          <input
            type="month"
            value={mes}
            onChange={(e) => e.target.value && escolher(e.target.value)}
            className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none focus:border-brand-dim"
          />
        </label>
        {painel?.meses.length ? (
          <div className="flex flex-wrap gap-1">
            {painel.meses.map((m) => (
              <button
                key={m}
                onClick={() => escolher(m)}
                className={`rounded px-2 py-0.5 font-os-mono text-xs ${
                  m === mes ? 'bg-brand/15 text-brand' : 'bg-surface-2 text-muted hover:text-text'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {erro && (
        <div className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{erro}</div>
      )}

      {painel?.avisos.length ? (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          {painel.avisos.map((a) => (
            <p key={a}>{a}</p>
          ))}
        </div>
      ) : null}

      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-os-mono text-[10px] uppercase tracking-[0.16em] font-semibold text-muted">
            O documento de {mes}
          </h2>
          <span className="font-os-mono text-[11px] tabular-nums text-muted">
            {documento.length} / {PAUTA_TETO_DA_ESTRATEGIA}
            {painel?.versao ? ` · versão ${painel.versao}` : ''}
            {painel?.origem === 'promocao' ? ' · proposta pela IA' : painel?.origem ? ' · escrita à mão' : ''}
          </span>
        </div>

        <ConferenciaEdicaoHumana editor={editor} />
        {editor.visivel && <textarea
          value={documento}
          onChange={(e) => editor.alterar(e.target.value)}
          disabled={!editavel || editor.ocupado}
          rows={22}
          placeholder="Ainda não há estratégia para este mês. Peça uma proposta à IA, ou escreva a sua."
          className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-os-mono text-sm outline-none focus:border-brand-dim disabled:opacity-50"
        />}

        {editavel && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => void salvar()}
              disabled={!editor.editavel || !documento.trim() || !mudou}
              className={`${botaoCls} bg-brand text-bg hover:bg-brand/90`}
            >
              {ocupado ? 'Salvando…' : editor.destinoBase?.estado === 'existente' && editor.destinoBase.arquivada ? 'Salvar mantendo arquivada' : 'Salvar'}
            </button>
            {editor.destinoBase?.estado === 'existente' && editor.destinoBase.arquivada && <button
              onClick={() => void salvar(true)} disabled={!editor.editavel || !documento.trim()}
              className={`${botaoCls} border border-brand text-brand`}>Salvar e reativar</button>}
            <button
              onClick={() => void gerar()}
              disabled={ocupado || editor.bloqueado || !painel?.iaConfigurada || !can('automacoes.executar')}
              title={painel?.iaConfigurada ? undefined : 'A IA não está configurada nesta instalação.'}
              className={`${botaoCls} border border-border bg-surface-2 hover:border-brand-dim`}
            >
              {ocupado
                ? 'A IA está propondo…'
                : painel?.documento
                  ? 'Propor de novo'
                  : 'Pedir uma proposta'}
            </button>
            {painel?.documento && (
              <span className="text-xs text-muted">
                A proposta grava outra versão na nota. Seu texto local permanece até você escolher usar o conteúdo atual.
              </span>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
