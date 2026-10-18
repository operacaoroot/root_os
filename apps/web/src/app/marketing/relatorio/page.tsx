'use client';

import { useState } from 'react';
import { chaveDoRelatorio, PAUTA_TETO_DO_RELATORIO, PautaRelatorioHumanoPainelSchema, PautaRelatorioSalvarHumanoSchema, type PautaRelatorioPainel } from '@mktos/shared';
import { useAuth } from '@/lib/auth';
import { apiPost } from '@/lib/api';
import { useEdicaoHumana, ConferenciaEdicaoHumana } from '../../pauta/InterruptorDaAutomacao';

/*
 * MK6 na tela. O relatório fecha um mês: o que foi ao ar sai da consulta, a
 * narrativa sai da IA, e a pessoa reescreve o que quiser.
 *
 * O mês que abre é o ANTERIOR ao de hoje, e não o corrente: relatório se faz de
 * mês fechado, e abrir no mês em curso convidaria a fechar o que ainda anda.
 */

function mesAnteriorDeHoje(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const botaoCls = 'rounded-lg px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50';

export default function RelatorioPage() {
  const { token, user, ready } = useAuth();
  const [mes, setMes] = useState(mesAnteriorDeHoje);
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
  const editor = useEdicaoHumana({ token, path: `/pauta/relatorio/${mes}`, schema: PautaRelatorioHumanoPainelSchema,
    destino: p => p.destinos.documento, texto: p => p.destinos.documento.estado === 'existente' ? p.destinos.documento.conteudo.corpo : p.painel.documento,
    conferir: p => p.mes === mes && p.painel.mes === mes && p.destinos.documento.chave === chaveDoRelatorio(mes) });
  const editavel = can('pauta.editar') && editor.visivel;
  const painel = editor.atual?.painel ?? null;
  const documento = editor.texto;
  const ocupado = editor.ocupado;
  const erro = null;
  const mudou = !!editor.base && documento !== (editor.destinoBase?.estado === 'existente' ? editor.destinoBase.conteudo.corpo : editor.base.painel.documento);
  const salvar = (reativar = false) => editor.enviar({ schema: PautaRelatorioSalvarHumanoSchema, campos: { documento, mesEsperado: mes }, acao: 'salvar_relatorio', reativar });
  const gerar = () => editor.executarExterno(() => apiPost<PautaRelatorioPainel>(`/pauta/relatorio/${mes}/gerar`, {}, token));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Relatório do mês</h1>
        <p className="mt-1 text-sm text-muted">
          O fechamento de um mês: o que foi ao ar, o que foi decidido, como rendeu, o que vem e a
          estratégia que valia. <strong>Os números saem da consulta, não do modelo</strong> — a IA
          escreve só a leitura, as decisões e os próximos passos.
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
        {painel ? (
          <span className="font-os-mono text-xs text-muted">
            {painel.publicadas} peça(s) publicada(s) em {mes}
          </span>
        ) : null}
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

      {erro && <div className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{erro}</div>}

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
            O relatório de {mes}
          </h2>
          <span className="font-os-mono text-[11px] tabular-nums text-muted">
            {documento.length} / {PAUTA_TETO_DO_RELATORIO}
            {painel?.versao ? ` · versão ${painel.versao}` : ''}
            {painel?.origem === 'promocao' ? ' · gerado pela IA' : painel?.origem ? ' · escrito à mão' : ''}
          </span>
        </div>

        <ConferenciaEdicaoHumana editor={editor} />
        {editor.visivel && <textarea
          value={documento}
          onChange={(e) => editor.alterar(e.target.value)}
          disabled={!editavel || editor.ocupado}
          rows={24}
          placeholder="Este mês ainda não foi fechado. Gere o relatório, ou escreva o seu."
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
              {ocupado ? 'A IA está escrevendo…' : painel?.documento ? 'Gerar de novo' : 'Fechar o mês'}
            </button>
            <span className="text-xs text-muted">
              A rotina mensal existe e nasce desligada; enquanto ninguém a liga, o fechamento é por
              aqui. Ela nunca refaz mês que já tem relatório.
            </span>
          </div>
        )}
      </section>
    </div>
  );
}
