'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  METAS_ESTADO_ROTULO,
  METAS_FUSO,
  partesNoFuso,
  type MetaMedida,
  type MetasDoMesPainel,
  type MetasLinhaDaEstrategia,
  type MetasMedidaDaSemana,
} from '@mktos/shared';
import { apiGet, apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * METAS DO MÊS (ROOT-53a, C-12). O alvo é do mês e é revisado pela pessoa; o
 * número é calculado pela API, por semana, e a tela só o mostra. Três coisas que
 * a tela não faz de propósito: não escreve número de fonte, não transforma o
 * texto da estratégia em meta sozinha (a pessoa escolhe indicador e alvo) e não
 * mostra zero onde a API disse "sem dado".
 */

const nf = (n: number) => n.toLocaleString('pt-BR');

const ESTADO_COR: Record<string, string> = {
  com_dado: 'bg-good/15 text-good border-good/30',
  parcial: 'bg-warn/15 text-warn border-warn/30',
  sem_dado: 'bg-surface-2 text-muted border-border',
  bloqueada: 'bg-bad/15 text-bad border-bad/30',
  sem_acesso: 'bg-surface-2 text-muted border-border',
};

// O mês é o de São Paulo, não o do relógio do navegador: quem abre a tela de
// outro fuso no último dia do mês cairia no mês errado.
function mesAtual(): string {
  return partesNoFuso(new Date(), METAS_FUSO).dia.slice(0, 7);
}

const diaMes = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

interface LinhaEditavel {
  indicador: string;
  alvo: string;
  campanhaId: string;
  origem: string | null;
  observacao: string;
}

const deMeta = (m: MetaMedida): LinhaEditavel => ({
  indicador: m.indicador,
  alvo: String(m.alvo).replace('.', ','),
  campanhaId: m.campanhaId ?? '',
  origem: m.origem,
  observacao: m.observacao ?? '',
});

export function MetasDoMes() {
  const { token, ready, can } = useAuth();
  const [mes, setMes] = useState(mesAtual());
  const [painel, setP] = useState<MetasDoMesPainel | null>(null);
  const p = painel?.mes === mes ? painel : null;
  const geracao = useRef(0);
  const [erro, setErro] = useState<string | null>(null);
  const [linhas, setLinhas] = useState<LinhaEditavel[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const podeEditar = can('relatorios.gerar');

  useEffect(() => {
    const pedido = ++geracao.current;
    const mesPedido = mes;
    setP(null);
    setLinhas(null);
    setErro(null);
    setAviso(null);
    setSalvando(false);
    if (ready && token) {
      apiGet<MetasDoMesPainel>(`/goals/month/${mesPedido}`, token)
        .then((novo) => {
          if (geracao.current === pedido && novo.mes === mesPedido) setP(novo);
        })
        .catch((e: Error) => { if (geracao.current === pedido) setErro(e.message); });
    }
    return () => { geracao.current++; };
  }, [ready, token, mes]);

  const catalogo = p?.catalogo ?? [];
  const indicador = (chave: string) => catalogo.find((i) => i.chave === chave);

  const salvar = () => {
    if (!token || !linhas || !p) return;
    const mesPedido = mes;
    const pedido = geracao.current;
    setAviso(null);
    const metas = [];
    for (const l of linhas) {
      const ind = indicador(l.indicador);
      const alvo = Number(l.alvo.replace(/\./g, '').replace(',', '.'));
      if (!ind) return setAviso('Escolha o indicador de cada meta.');
      if (!Number.isFinite(alvo) || alvo <= 0) return setAviso(`Informe um alvo maior que zero para ${ind.rotulo}.`);
      if (ind.exigeCampanha && !l.campanhaId.trim()) return setAviso(`${ind.rotulo} pede o código da campanha.`);
      metas.push({
        indicador: l.indicador,
        alvo,
        campanhaId: ind.exigeCampanha ? l.campanhaId.trim() : null,
        origem: l.origem,
        observacao: l.observacao.trim() || null,
      });
    }
    setSalvando(true);
    apiPut<MetasDoMesPainel>(`/goals/month/${mesPedido}`, { metas, versao: p.nota?.versao }, token)
      .then((novo) => {
        if (geracao.current === pedido && novo.mes === mesPedido) {
          setP(novo);
          setLinhas(null);
        }
      })
      .catch((e: Error) => { if (geracao.current === pedido) setAviso(e.message); })
      .finally(() => { if (geracao.current === pedido) setSalvando(false); });
  };

  const mudar = (i: number, campo: keyof LinhaEditavel, valor: string) =>
    setLinhas((ls) => (ls ? ls.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)) : ls));

  const daEstrategia = (l: MetasLinhaDaEstrategia) =>
    setLinhas((ls) => [
      ...(ls ?? (p?.metas ?? []).map(deMeta)),
      { indicador: '', alvo: '', campanhaId: '', origem: l.origem, observacao: l.texto.slice(0, 500) },
    ]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="text-xs text-muted">
          Mês
          <input
            type="month"
            value={mes}
            onChange={(e) => e.target.value && setMes(e.target.value)}
            className="mt-0.5 block rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm text-text"
          />
        </label>
        {podeEditar && p && !linhas && (
          <button
            onClick={() => setLinhas((p.metas ?? []).map(deMeta))}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-ink hover:opacity-90"
          >
            {p.metas.length ? 'Revisar as metas do mês' : 'Definir as metas do mês'}
          </button>
        )}
      </div>

      {erro && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">Erro ao carregar as metas: {erro}</div>}
      {!p && !erro && <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center text-sm text-muted">Carregando as metas do mês…</div>}

      {p?.avisos.map((a) => (
        <div key={a} className="rounded-lg border border-warn/30 bg-warn/10 px-4 py-2 text-sm text-warn">{a}</div>
      ))}

      {p && linhas && (
        <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <div className="text-sm font-medium">Revisão de {mes}</div>
          {linhas.length === 0 && <p className="text-sm text-muted">Nenhuma meta na revisão. Adicione uma abaixo.</p>}
          {linhas.map((l, i) => {
            const ind = indicador(l.indicador);
            return (
              <div key={i} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-12">
                <select
                  aria-label={`Indicador da meta ${i + 1}`}
                  value={l.indicador}
                  onChange={(e) => mudar(i, 'indicador', e.target.value)}
                  className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm sm:col-span-4"
                >
                  <option value="">Escolha o indicador</option>
                  {catalogo.map((c) => (
                    <option key={c.chave} value={c.chave}>{c.rotulo}</option>
                  ))}
                </select>
                <input
                  aria-label={`Alvo da meta ${i + 1}`}
                  inputMode="decimal"
                  value={l.alvo}
                  onChange={(e) => mudar(i, 'alvo', e.target.value)}
                  placeholder={ind ? `alvo em ${ind.unidade}` : 'alvo'}
                  className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm sm:col-span-2"
                />
                {ind?.exigeCampanha && (
                  <input
                    aria-label={`Campanha da meta ${i + 1}`}
                    value={l.campanhaId}
                    onChange={(e) => mudar(i, 'campanhaId', e.target.value)}
                    placeholder="código da campanha"
                    className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm sm:col-span-3"
                  />
                )}
                <input
                  aria-label={`Observação da meta ${i + 1}`}
                  value={l.observacao}
                  onChange={(e) => mudar(i, 'observacao', e.target.value)}
                  placeholder="observação"
                  className={`rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm ${ind?.exigeCampanha ? 'sm:col-span-2' : 'sm:col-span-5'}`}
                />
                <button
                  aria-label={`Remover a meta ${i + 1}`}
                  onClick={() => setLinhas((ls) => (ls ? ls.filter((_, j) => j !== i) : ls))}
                  className="inline-flex items-center justify-center rounded-lg border border-border p-1.5 text-muted hover:text-bad sm:col-span-1"
                >
                  <Trash2 size={14} />
                </button>
                {l.origem && <p className="text-[11px] text-muted sm:col-span-12">Veio da estratégia do mês: {l.origem}</p>}
              </div>
            );
          })}
          {aviso && <p className="text-xs text-bad">{aviso}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setLinhas((ls) => [...(ls ?? []), { indicador: '', alvo: '', campanhaId: '', origem: null, observacao: '' }])}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-brand hover:bg-surface-2"
            >
              <Plus size={12} /> Adicionar meta
            </button>
            <button onClick={salvar} disabled={salvando} className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-60">
              {salvando ? 'Salvando…' : 'Salvar revisão'}
            </button>
            <button onClick={() => { setLinhas(null); setAviso(null); }} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {p && !linhas && p.metas.length === 0 && !p.avisos.length && (
        <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-center text-sm text-muted">
          Este mês ainda não tem meta.{podeEditar ? ' Defina as metas para acompanhar semana a semana.' : ''}
        </div>
      )}

      {p && p.metas.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          {p.metas.map((m) => (
            <CartaoDaMeta key={`${m.indicador}|${m.campanhaId ?? ''}`} m={m} />
          ))}
        </div>
      )}

      {p?.estrategia && p.estrategia.linhas.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Metas escritas na estratégia do mês (versão {p.estrategia.versao})</div>
          <p className="mb-3 text-[11px] text-muted">
            O texto não vira meta sozinho: você escolhe o indicador e o alvo, e a meta guarda de qual linha veio.
          </p>
          <ul className="space-y-2">
            {p.estrategia.linhas.map((l) => (
              <li key={l.itemId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{l.texto}</span>
                {l.jaViraMeta ? (
                  <span className="text-[11px] text-good">já virou meta</span>
                ) : podeEditar ? (
                  <button onClick={() => daEstrategia(l)} className="rounded-lg border border-border px-2.5 py-1 text-xs text-brand hover:bg-surface-2">
                    Criar meta desta linha
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {p && (
        <p className="text-[11px] text-muted">
          Semana de segunda a domingo, no horário de São Paulo; a semana que cruza o mês conta só os dias do mês. O número é calculado pelo
          sistema a partir de cada fonte e nunca é digitado. Sem registro na fonte aparece "sem dado", não zero.
        </p>
      )}
    </div>
  );
}

function CartaoDaMeta({ m }: { m: MetaMedida }) {
  const semNumero = m.valor === null;
  return (
    <div className="rounded-xl border border-border bg-surface p-4" data-indicador={m.indicador}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{m.rotulo}</div>
          {m.campanhaNome && <div className="text-[11px] text-muted">Campanha: {m.campanhaNome}</div>}
        </div>
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${ESTADO_COR[m.estado]}`}>{METAS_ESTADO_ROTULO[m.estado]}</span>
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold">{semNumero ? '—' : nf(m.valor as number)}</span>
        <span className="text-sm text-muted">/ {nf(m.alvo)} {m.unidade}</span>
        {m.pct !== null && <span className="text-xs text-muted">{String(m.pct).replace('.', ',')}%</span>}
      </div>
      {m.pct !== null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded bg-surface-2">
          <div className="h-full rounded bg-brand" style={{ width: `${Math.min(100, m.pct)}%` }} />
        </div>
      )}

      {m.motivo && <p className="mt-2 text-[11px] text-muted">{m.motivo}</p>}
      {m.observacao && <p className="mt-1 text-[11px] text-muted">{m.observacao}</p>}
      {m.origem && <p className="mt-1 text-[11px] text-muted">Origem: estratégia do mês</p>}

      {m.estado !== 'sem_acesso' && m.estado !== 'bloqueada' && (
        <ul className="mt-3 grid gap-1 text-[11px]">
          {m.semanas.map((s) => (
            <LinhaDaSemana key={s.semana} s={s} unidade={m.unidade} />
          ))}
        </ul>
      )}
      <p className="mt-2 text-[10px] text-muted">{m.calculo}</p>
    </div>
  );
}

function LinhaDaSemana({ s, unidade }: { s: MetasMedidaDaSemana; unidade: string }) {
  return (
    <li className="flex items-center justify-between gap-2 rounded bg-surface-2 px-2 py-1" data-semana={s.semana}>
      <span className="text-muted">
        {s.semana.slice(5)} · {diaMes(s.primeiroDia)}–{diaMes(s.ultimoDia)}
      </span>
      <span className={s.estado === 'com_dado' ? 'text-text' : 'text-muted'}>
        {s.estado === 'com_dado' ? `${nf(s.valor as number)} ${unidade}` : s.estado === 'futura' ? 'ainda não começou' : 'sem dado'}
      </span>
    </li>
  );
}
