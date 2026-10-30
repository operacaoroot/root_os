'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SOCIOS_DA_AGENDA, type AcaoDoConflito, type CartaoDeConflito, type ResultadoDaEscrita, type RespostaDosConflitos, type SocioDaAgenda, type TipoDeConflito } from '@mktos/shared';

import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { mensagemDoPedido } from '../fora-do-padrao';
import { Historico } from './Historico';
import {
  FILTRO_DO_TIPO,
  ORDEM_DOS_TIPOS,
  horaDoCartao,
  mensagemDaEscrita,
  quandoDoCartao,
  rotuloDoCartao,
  textoDoVigia,
  tituloDosConflitos,
  tomDoTipo,
  type TomDoConflito,
} from './conflitos-formato';

/*
 * A ABA CONFLITOS (agenda v2, 29/10/2026, lane G5) — desenho `Conflitos`.
 *
 * `GET /agenda/conflitos?dias=60` (o motor da régua sobre os próximos 60 dias
 * mais o que o vigia AG-01 achou fora do padrão), em ordem de urgência. Cada
 * cartão traz o conserto pronto: o botão manda o `PedidoDeEscrita` a
 * `POST /agenda/escritas` (a mesma porta e a mesma regra de aprovação da tela)
 * e diz o que aconteceu: saiu, ou foi para a fila de aprovação. Aplicar o título
 * e "não é reunião" vão à rota do vigia. "Remarcar…" abre o painel de editar da
 * página; "Deixar assim" só tira o cartão desta tela.
 *
 * A página (`../page.tsx`, lane C) só a monta. O histórico embaixo é o da lane D.
 */
export interface PropsDaAbaConflitos {
  /** Abre o painel de editar no compromisso (o "Remarcar…" do cartão). */
  aoRemarcar?: (eventoId: string) => void;
  /** Depois de uma escrita, a página recarrega a semana. */
  aoMudar?: () => void;
}

const BORDA: Record<TomDoConflito, string> = { choque: 'border-mag', atencao: 'border-warn', neutro: 'border-border' };
const SELO: Record<TomDoConflito, string> = { choque: 'text-mag border-mag', atencao: 'text-warn border-warn', neutro: 'text-muted border-border-strong' };

type Aviso = { tom: 'ok' | 'fila' | 'recusa'; texto: string };

const corDoAviso = (t: Aviso['tom']) => (t === 'ok' ? 'text-info' : t === 'fila' ? 'text-warn' : 'text-mag');

function Botao({
  primario,
  ativo,
  children,
  onClick,
  disabled,
  title,
}: {
  primario?: boolean;
  /** Botão de filtro: ligado ou não (`aria-pressed`). */
  ativo?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const p = { onClick, disabled, title };
  const cls = primario
    ? 'border-brand bg-brand font-semibold text-ink hover:bg-brand/90'
    : ativo
      ? 'border-brand bg-brand/10 text-text'
      : 'border-border bg-bg text-text hover:border-brand-dim';
  return (
    <button
      type="button"
      onClick={p.onClick}
      disabled={p.disabled}
      title={p.title}
      aria-pressed={ativo === undefined ? undefined : ativo}
      className={`rounded-[3px] border px-3 py-1.5 text-[13px] disabled:cursor-not-allowed disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  );
}

function Cartao({
  c,
  token,
  aoRemarcar,
  aoMudar,
  aoDispensar,
}: {
  c: CartaoDeConflito;
  token: string | null;
  aoRemarcar?: (eventoId: string) => void;
  aoMudar: () => void;
  aoDispensar: (id: string) => void;
}) {
  const [enviando, setEnviando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const tom = tomDoTipo(c.tipo);

  const agir = (a: AcaoDoConflito, i: number) => {
    const chave = `${i}`;
    if (a.tipo === 'remarcar') {
      if (c.eventos[0]) aoRemarcar?.(c.eventos[0].id);
      return;
    }
    if (a.tipo === 'manter' && !a.pedido) {
      aoDispensar(c.id);
      return;
    }
    if (a.pedido) {
      setEnviando(chave);
      setAviso(null);
      apiPost<ResultadoDaEscrita>('/agenda/escritas', a.pedido, token)
        .then((r) => {
          setAviso(mensagemDaEscrita(r));
          if (r.status !== 'recusado') aoMudar();
        })
        .catch((e: Error) => setAviso({ tom: 'recusa', texto: e.message }))
        .finally(() => setEnviando(null));
      return;
    }
    if (a.rota) {
      setEnviando(chave);
      setAviso(null);
      apiPost<{ status?: string; jaNaFila?: boolean; precisaDeOutraPessoa?: boolean }>(a.rota.caminho, a.rota.corpo ?? {}, token)
        .then((r) => {
          setAviso(
            a.tipo === 'nao_e_reuniao'
              ? { tom: 'ok', texto: 'Anotado: não é reunião. O vigia não pergunta mais por este evento.' }
              : { tom: r?.status === 'aguardando_aprovacao' ? 'fila' : 'ok', texto: mensagemDoPedido(r) },
          );
          aoMudar();
        })
        .catch((e: Error) => setAviso({ tom: 'recusa', texto: e.message }))
        .finally(() => setEnviando(null));
    }
  };

  return (
    <article
      className={`flex flex-col gap-2 rounded-[3px] border bg-surface px-4 py-3.5 ${c.confirmado ? 'border-border opacity-80' : BORDA[tom]}`}
      data-cartao-de-conflito={c.id}
      data-tipo={c.tipo}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-[3px] border px-1.5 py-0.5 font-os-mono text-[10px] font-bold uppercase tracking-[1px] ${c.confirmado ? SELO.neutro : SELO[tom]}`}>
          {rotuloDoCartao(c)}
        </span>
        <span className="font-os-mono text-[11px] text-muted">{quandoDoCartao(c.quando)}</span>
        {c.confirmado && (
          <span className="rounded-[3px] border border-info px-1.5 py-0.5 font-os-mono text-[10px] font-bold uppercase tracking-[1px] text-info">
            OK · confirmado com o cliente
          </span>
        )}
        {c.pessoas.length > 0 && <span className="font-os-mono text-[11px] text-dim">{c.pessoas.join(' · ')}</span>}
      </div>
      <div className="text-[15px] font-semibold">{c.titulo}</div>
      <p className="text-[13px] leading-snug text-muted">{c.frase}</p>
      {c.eventos.some((e) => e.titulo) && (
        <div className="font-os-mono text-xs text-text">
          {c.eventos.filter((e) => e.titulo).map((e) => (
            <div key={e.id}>{e.titulo}</div>
          ))}
        </div>
      )}
      {c.acoes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {c.acoes.map((a, i) => (
            <Botao
              key={`${a.tipo}-${i}`}
              primario={i === 0 && !c.confirmado && (!!a.pedido || !!a.rota)}
              onClick={() => agir(a, i)}
              disabled={enviando !== null || (a.tipo === 'remarcar' && !aoRemarcar)}
            >
              {enviando === `${i}` ? 'Enviando…' : a.rotulo}
            </Botao>
          ))}
        </div>
      )}
      {aviso && (
        <p className={`text-xs ${corDoAviso(aviso.tom)}`} role={aviso.tom === 'recusa' ? 'alert' : 'status'}>
          {aviso.texto}
        </p>
      )}
    </article>
  );
}

export function AbaConflitos({ aoRemarcar, aoMudar }: PropsDaAbaConflitos) {
  const { token, ready } = useAuth();
  const [dados, setDados] = useState<RespostaDosConflitos | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoDeConflito | null>(null);
  const [socio, setSocio] = useState<SocioDaAgenda | null>(null);
  const [dispensados, setDispensados] = useState<Set<string>>(new Set());

  const carregar = useCallback(() => {
    if (!token) return;
    const q = new URLSearchParams({ dias: '60' });
    if (socio) q.set('socio', socio);
    apiGet<RespostaDosConflitos>(`/agenda/conflitos?${q.toString()}`, token)
      .then((r) => { setDados(r); setErro(null); })
      .catch((e: Error) => setErro(e.message));
  }, [token, socio]);

  useEffect(() => { if (ready && token) carregar(); }, [ready, token, carregar]);

  const mudou = useCallback(() => { carregar(); aoMudar?.(); }, [carregar, aoMudar]);

  const visiveis = useMemo(() => (dados?.cartoes ?? []).filter((c) => !dispensados.has(c.id)), [dados, dispensados]);
  const lista = visiveis.filter((c) => c.tipo !== 'feriado' && (!tipo || c.tipo === tipo));
  const foraDaTela = visiveis.filter((c) => c.tipo === 'feriado' && (!tipo || tipo === 'feriado'));
  const titulo = tituloDosConflitos(visiveis.length);

  return (
    <div className="font-central-sans flex flex-col gap-4" data-aba-conflitos="">
      <div className="flex items-center justify-between gap-3">
        <span className="font-os-mono text-[10px] font-bold uppercase tracking-[4px] text-mag">// conflitos · próximos 60 dias</span>
        {dados && <span className="font-os-mono text-[11px] text-info" data-selo-do-vigia="">● {textoDoVigia(dados.vigiaPassouEm)}</span>}
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        <section className="flex min-w-0 flex-1 flex-col gap-3">
          <div>
            <h2 className="text-[28px] font-bold leading-tight tracking-[-1px]">
              {titulo.comeco} <span className="text-brand">{titulo.fim}</span>
            </h2>
            <p className="mt-1.5 text-sm text-muted">
              Ordem por urgência. Cada cartão traz o conserto pronto; um clique grava no Google e fica no histórico com desfazer.
            </p>
          </div>
          {erro && <p className="text-sm text-mag" role="alert">{erro}</p>}
          {!dados && !erro && <p className="text-sm text-muted">Lendo os próximos 60 dias…</p>}
          {dados && lista.length === 0 && (
            <p className="rounded-[3px] border border-border bg-surface px-4 py-3 text-sm">
              <span className="font-os-mono text-info">OK</span> Nada {tipo || socio ? 'neste filtro' : 'na agenda'} pede decisão.
            </p>
          )}
          {lista.map((c) => (
            <Cartao
              key={c.id}
              c={c}
              token={token}
              aoRemarcar={aoRemarcar}
              aoMudar={mudou}
              aoDispensar={(id) => setDispensados((s) => new Set(s).add(id))}
            />
          ))}
        </section>

        <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-[360px]">
          <div className="flex flex-col gap-2.5 rounded-[3px] border border-border bg-surface px-4 py-3.5">
            <span className="font-os-mono text-[10px] uppercase tracking-[2px] text-muted">Filtrar</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por tipo">
              <Botao ativo={!tipo} onClick={() => setTipo(null)}>
                Tudo <span className="font-os-mono">{dados?.contagem.tudo ?? 0}</span>
              </Botao>
              {ORDEM_DOS_TIPOS.filter((t) => (dados?.contagem[t] ?? 0) > 0 || tipo === t).map((t) => (
                <Botao key={t} ativo={tipo === t} onClick={() => setTipo(tipo === t ? null : t)}>
                  {FILTRO_DO_TIPO[t]} <span className="font-os-mono">{dados?.contagem[t] ?? 0}</span>
                </Botao>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por sócio">
              <Botao ativo={!socio} onClick={() => setSocio(null)}>Todos</Botao>
              {SOCIOS_DA_AGENDA.map((s) => (
                <Botao key={s} ativo={socio === s} onClick={() => setSocio(socio === s ? null : s)}>{s}</Botao>
              ))}
            </div>
          </div>

          {foraDaTela.length > 0 && (
            <div className="flex flex-col gap-2.5 rounded-[3px] border border-border bg-surface px-4 py-3.5" data-fora-da-tela="">
              <span className="font-os-mono text-[10px] uppercase tracking-[2px] text-muted">Fora da tela</span>
              {foraDaTela.map((c) => (
                <ForaDaTela key={c.id} c={c} token={token} aoMudar={mudou} aoRemarcar={aoRemarcar} />
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2.5 rounded-[3px] border border-border bg-surface px-4 py-3.5">
            <span className="font-os-mono text-[10px] uppercase tracking-[2px] text-muted">Histórico · o que foi gravado no Google</span>
            <Historico limite={6} aoMudar={mudou} />
          </div>
        </aside>
      </div>
    </div>
  );
}

/** O compromisso marcado em feriado, no canto: "Levar para ter 03/11, mesmo horário". */
function ForaDaTela({ c, token, aoMudar, aoRemarcar }: { c: CartaoDeConflito; token: string | null; aoMudar: () => void; aoRemarcar?: (id: string) => void }) {
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [enviando, setEnviando] = useState(false);
  const levar = c.acoes.find((a) => a.tipo === 'levar_para_dia_util' && a.pedido);
  const nome = c.frase.replace(/\.?\s*Agenda fechada\.?$/, '');
  return (
    <div className="flex flex-col gap-2" data-cartao-de-conflito={c.id} data-tipo={c.tipo}>
      <p className="text-[13px]">
        <span className="font-os-mono text-[10px] font-bold uppercase tracking-[1px] text-warn">feriado</span>{' '}
        {c.titulo} · {nome} · <span className="font-os-mono text-xs text-muted">{horaDoCartao(c.quando)}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {levar && (
          <Botao
            disabled={enviando}
            onClick={() => {
              setEnviando(true);
              apiPost<ResultadoDaEscrita>('/agenda/escritas', levar.pedido, token)
                .then((r) => { setAviso(mensagemDaEscrita(r)); if (r.status !== 'recusado') aoMudar(); })
                .catch((e: Error) => setAviso({ tom: 'recusa', texto: e.message }))
                .finally(() => setEnviando(false));
            }}
          >
            {enviando ? 'Enviando…' : levar.rotulo}
          </Botao>
        )}
        {aoRemarcar && c.eventos[0] && <Botao onClick={() => aoRemarcar(c.eventos[0].id)}>Remarcar…</Botao>}
      </div>
      {aviso && <p className={`text-xs ${corDoAviso(aviso.tom)}`} role={aviso.tom === 'recusa' ? 'alert' : 'status'}>{aviso.texto}</p>}
    </div>
  );
}
