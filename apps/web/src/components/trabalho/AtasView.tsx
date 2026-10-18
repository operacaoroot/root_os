'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ATA_MIN_CARACTERES } from '@mktos/shared';
import type {
  TrabAtaDetalhe, TrabAtaGeracao, TrabAtaLista, TrabAtaResumo, TrabAtaSugestaoDto, TrabEstrutura,
} from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { RoteiroMarkdown } from '@/app/pauta/roteiro-markdown';

/*
 * O BANCO DE ATAS DO TRABALHO (rodada do painel P3, 18/10/2026).
 *
 * À esquerda, as atas da operação: as do vault (a pasta das reuniões) e as
 * coladas aqui, a mais nova primeiro, com data, participantes e resumo. À
 * direita, a ata aberta inteira (markdown renderizado sem innerHTML) e as
 * sugestões de tarefa que ela rendeu.
 *
 * "Sugerir tarefas" pede a leitura ao agente; o que volta são RASCUNHOS. Cada
 * um mostra o trecho da ata de onde saiu, e só vira tarefa com o clique em
 * Aceitar (na lista escolhida, pelo mesmo caminho do botão "Nova tarefa"). Nada
 * vira tarefa sozinho. Descartar fica registrado.
 */

const INP = 'w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none focus:border-brand-dim disabled:opacity-60';
const BTN = 'rounded-lg border border-border bg-surface px-3 py-1.5 text-sm hover:border-brand-dim disabled:opacity-50';
const BTN_PRIMARIO = 'rounded-lg bg-brand/15 px-3 py-1.5 text-sm text-text outline outline-1 outline-brand-dim hover:bg-brand/25 disabled:opacity-50';

const dataBR = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : null);

function ataDoEndereco(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('ata');
}

function escreverAtaNoEndereco(ref: string | null) {
  const u = new URL(window.location.href);
  if (ref) u.searchParams.set('ata', ref);
  else u.searchParams.delete('ata');
  window.history.replaceState({}, '', `${u.pathname}${u.search}`);
}

interface OpcaoDeLista {
  id: string;
  rotulo: string;
}

function listasDaEstrutura(e: TrabEstrutura | null): OpcaoDeLista[] {
  if (!e) return [];
  const nomeDaPasta = new Map(e.folders.map((f) => [f.id, f.name]));
  const daPasta = e.folders.flatMap((f) =>
    f.lists.map((l) => ({ id: l.id, rotulo: `${f.parentId && nomeDaPasta.get(f.parentId) ? `${nomeDaPasta.get(f.parentId)} › ` : ''}${f.name} › ${l.name}` })),
  );
  return [...daPasta, ...e.listasSoltas.map((l) => ({ id: l.id, rotulo: l.name }))];
}

export function AtasView() {
  const { token, ready, can } = useAuth();
  const podeVer = can('tarefas.ver');
  const podeEditar = can('tarefas.editar');

  const [lista, setLista] = useState<TrabAtaLista | null>(null);
  const [aberta, setAberta] = useState<TrabAtaDetalhe | null>(null);
  const [refAberta, setRefAberta] = useState<string | null>(null);
  const [estrutura, setEstrutura] = useState<TrabEstrutura | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [lendo, setLendo] = useState(false);
  const [decidindo, setDecidindo] = useState<string | null>(null);
  const [listaEscolhida, setListaEscolhida] = useState<Record<string, string>>({});
  const [colando, setColando] = useState(false);

  const carregarLista = useCallback(() => {
    if (!token || !podeVer) return;
    apiGet<TrabAtaLista>('/trabalho/atas', token)
      .then((l) => {
        setLista(l);
        setRefAberta((atual) => atual ?? ataDoEndereco() ?? l.atas[0]?.id ?? null);
      })
      .catch((e) => setErro(e.message));
  }, [token, podeVer]);

  useEffect(() => { carregarLista(); }, [carregarLista]);

  useEffect(() => {
    if (!token || !podeEditar) return;
    apiGet<TrabEstrutura>('/trabalho/estrutura', token).then(setEstrutura).catch(() => setEstrutura(null));
  }, [token, podeEditar]);

  const abrir = useCallback((ref: string) => {
    if (!token) return;
    setRefAberta(ref);
    escreverAtaNoEndereco(ref);
    apiGet<TrabAtaDetalhe>(`/trabalho/atas/${encodeURIComponent(ref)}`, token)
      .then((a) => { setAberta(a); setErro(null); })
      .catch((e) => setErro(e.message));
  }, [token]);

  useEffect(() => {
    if (refAberta && (!aberta || aberta.id !== refAberta)) abrir(refAberta);
    // abrir só quando a ata pedida muda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refAberta]);

  const opcoes = useMemo(() => listasDaEstrutura(estrutura), [estrutura]);

  const gerar = () => {
    if (!aberta || !token) return;
    setLendo(true);
    setErro(null);
    apiPost<TrabAtaGeracao>(`/trabalho/atas/${encodeURIComponent(aberta.id)}/sugestoes`, {}, token)
      .then((g) => {
        setAvisos([
          g.criadas.length
            ? `${g.criadas.length} ${g.criadas.length === 1 ? 'sugestão nova' : 'sugestões novas'} em rascunho.`
            : 'Nenhuma sugestão nova nesta leitura.',
          ...(g.repetidas ? [`${g.repetidas} já tinha${g.repetidas === 1 ? '' : 'm'} sido sugerida${g.repetidas === 1 ? '' : 's'} antes.`] : []),
          ...g.avisos,
        ]);
        abrir(aberta.id);
        carregarLista();
      })
      .catch((e) => setErro(e.message))
      .finally(() => setLendo(false));
  };

  const decidir = (s: TrabAtaSugestaoDto, como: 'aceitar' | 'descartar') => {
    if (!token || !aberta) return;
    setDecidindo(s.id);
    setErro(null);
    const corpo = como === 'aceitar' ? { listaId: listaEscolhida[s.id] || s.listaId || undefined } : {};
    apiPost<TrabAtaSugestaoDto>(`/trabalho/atas/sugestoes/${s.id}/${como}`, corpo, token)
      .then(() => { abrir(aberta.id); carregarLista(); })
      .catch((e) => setErro(e.message))
      .finally(() => setDecidindo(null));
  };

  if (!ready) return <p className="text-muted">Carregando…</p>;
  if (!token || !podeVer) return <p className="text-muted">Sem permissão para ver as atas.</p>;

  const rascunhos = aberta?.sugestoesDaAta.filter((s) => s.estado === 'rascunho') ?? [];
  const decididas = aberta?.sugestoesDaAta.filter((s) => s.estado !== 'rascunho') ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">Atas</h1>
          <p className="text-sm text-muted">
            As reuniões da operação e as tarefas que elas combinaram. Toda sugestão é rascunho até alguém aceitar.
          </p>
        </div>
        {podeEditar && (
          <button type="button" data-testid="ata-colar" className={BTN} onClick={() => setColando((v) => !v)} aria-expanded={colando}>
            {colando ? 'Fechar' : 'Colar ata'}
          </button>
        )}
      </div>

      {erro && <p role="alert" className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm break-words">{erro}</p>}

      {colando && podeEditar && (
        <ColarAta
          token={token}
          onSalva={(a) => {
            setColando(false);
            setAberta(a);
            setRefAberta(a.id);
            escreverAtaNoEndereco(a.id);
            carregarLista();
          }}
          onErro={setErro}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
        <section aria-label="Atas da operação" className="min-w-0 space-y-2">
          {lista && (
            <p className="px-1 text-[12px] text-muted break-words">
              {lista.notasDoVault > 0
                ? `Do vault, a pasta ${lista.pasta}; e as coladas aqui.`
                : `Nenhuma nota do vault indexada nesta empresa: aparecem só as atas coladas aqui (a pasta ${lista.pasta} entra quando o vault for indexado).`}
            </p>
          )}
          <ul data-testid="atas-lista" className="space-y-1.5">
            {lista?.atas.map((a) => (
              <li key={a.id}>
                <ItemDaAta ata={a} ativa={a.id === refAberta} onAbrir={() => { setAvisos([]); abrir(a.id); }} />
              </li>
            ))}
          </ul>
          {lista && lista.atas.length === 0 && (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted">
              Nenhuma ata ainda. {podeEditar ? 'Cole a primeira em "Colar ata".' : 'Quem edita o Trabalho pode colar a primeira.'}
            </p>
          )}
          {!lista && !erro && <p className="text-sm text-muted">Carregando…</p>}
        </section>

        <section aria-label="Ata aberta" className="min-w-0 space-y-4">
          {!aberta && lista && lista.atas.length > 0 && <p className="text-sm text-muted">Escolha uma ata à esquerda.</p>}
          {aberta && (
            <>
              <header className="space-y-1 rounded-lg border border-border bg-surface p-3">
                <h2 className="text-lg font-semibold break-words">{aberta.titulo}</h2>
                <p className="text-[12px] text-muted break-words">
                  {[dataBR(aberta.data) ?? 'sem data', aberta.participantes.length ? aberta.participantes.join(', ') : 'participantes não informados', aberta.procedencia].join(' · ')}
                </p>
              </header>

              <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Sugestões de tarefa</h3>
                  {podeEditar && (
                    <button
                      type="button"
                      data-testid={`ata-gerar-${aberta.id}`}
                      className={BTN_PRIMARIO}
                      disabled={lendo || lista?.iaConfigurada === false}
                      onClick={gerar}
                      title={lista?.iaConfigurada === false ? 'A IA não está configurada nesta instalação.' : 'O agente lê a ata e propõe tarefas em rascunho.'}
                    >
                      {lendo ? 'Lendo a ata…' : 'Sugerir tarefas'}
                    </button>
                  )}
                </div>
                {avisos.length > 0 && (
                  <ul aria-label="O que a leitura disse" className="space-y-0.5 rounded-lg bg-surface-2 px-3 py-2 text-[12px] text-muted">
                    {avisos.map((a, i) => <li key={i} className="break-words">{a}</li>)}
                  </ul>
                )}
                {rascunhos.length === 0 && decididas.length === 0 && (
                  <p className="text-sm text-muted">Nenhuma sugestão desta ata ainda.</p>
                )}
                <ul className="space-y-2">
                  {rascunhos.map((s) => (
                    <li key={s.id} data-testid={`ata-sugestao-${s.id}`} className="space-y-2 rounded-lg border border-border bg-surface-2 p-3">
                      <p className="font-medium break-words">{s.titulo}</p>
                      <blockquote className="border-l-2 border-brand-dim pl-2 text-[13px] text-muted break-words">{s.trecho}</blockquote>
                      <p className="text-[12px] text-muted break-words">
                        {[s.donoSugerido ? `dono sugerido: ${s.donoSugerido}` : 'sem dono sugerido', s.vencimento ? `vence ${dataBR(s.vencimento)}` : 'sem vencimento na ata'].join(' · ')}
                      </p>
                      {podeEditar && (
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            aria-label={`Lista da tarefa "${s.titulo}"`}
                            value={listaEscolhida[s.id] ?? s.listaId ?? ''}
                            onChange={(e) => setListaEscolhida((m) => ({ ...m, [s.id]: e.target.value }))}
                            className="min-w-0 max-w-full flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none"
                          >
                            <option value="">Escolha a lista…</option>
                            {s.listaId && !opcoes.some((o) => o.id === s.listaId) && <option value={s.listaId}>{s.listaNome ?? 'lista sugerida'}</option>}
                            {opcoes.map((o) => <option key={o.id} value={o.id}>{o.rotulo}</option>)}
                          </select>
                          <button
                            type="button"
                            data-testid={`ata-aceitar-${s.id}`}
                            className={BTN_PRIMARIO}
                            disabled={decidindo === s.id || !(listaEscolhida[s.id] || s.listaId)}
                            onClick={() => decidir(s, 'aceitar')}
                          >
                            Aceitar
                          </button>
                          <button
                            type="button"
                            data-testid={`ata-descartar-${s.id}`}
                            className={BTN}
                            disabled={decidindo === s.id}
                            onClick={() => decidir(s, 'descartar')}
                          >
                            Descartar
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                {decididas.length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted">Decididas ({decididas.length})</summary>
                    <ul className="mt-2 space-y-1">
                      {decididas.map((s) => (
                        <li key={s.id} data-testid={`ata-sugestao-${s.id}`} className="flex flex-wrap items-baseline gap-x-2 break-words">
                          <span className={s.estado === 'aceita' ? 'text-brand' : 'text-muted line-through'}>{s.titulo}</span>
                          <span className="text-[12px] text-muted">
                            {s.estado === 'aceita' ? `aceita${s.listaNome ? ` em ${s.listaNome}` : ''}` : 'descartada'}
                            {s.decididaPor ? ` por ${s.decididaPor}` : ''}
                          </span>
                          {s.estado === 'aceita' && s.workTaskId && s.listaId && (
                            <a className="text-[12px] text-brand underline underline-offset-2" href={`/trabalho?lista=${s.listaId}&tarefa=${s.workTaskId}`}>abrir a tarefa</a>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>

              <article aria-label="A ata inteira" className="rounded-lg border border-border bg-surface p-3">
                <RoteiroMarkdown texto={aberta.texto} />
              </article>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function ItemDaAta({ ata, ativa, onAbrir }: { ata: TrabAtaResumo; ativa: boolean; onAbrir: () => void }) {
  const { rascunho, aceitas } = ata.sugestoes;
  return (
    <button
      type="button"
      data-testid={`ata-${ata.id}`}
      onClick={onAbrir}
      aria-current={ativa ? 'true' : undefined}
      className={`w-full space-y-1 rounded-lg border px-3 py-2 text-left ${ativa ? 'border-brand-dim bg-brand/10' : 'border-border bg-surface hover:border-brand-dim'}`}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate font-medium" title={ata.titulo}>{ata.titulo}</span>
        <span className="shrink-0 font-mono text-[11px] text-muted">{dataBR(ata.data) ?? 'sem data'}</span>
      </span>
      {ata.participantes.length > 0 && (
        <span className="block truncate text-[12px] text-muted" title={ata.participantes.join(', ')}>{ata.participantes.join(', ')}</span>
      )}
      {ata.resumo && <span className="line-clamp-2 block text-[12px] text-muted break-words">{ata.resumo}</span>}
      <span className="flex flex-wrap gap-1.5 text-[11px] text-muted">
        <span className="rounded bg-surface-2 px-1.5 py-0.5">{ata.fonte === 'vault' ? 'vault' : 'colada'}</span>
        {rascunho > 0 && <span className="rounded bg-brand/10 px-1.5 py-0.5 text-brand">{rascunho} para decidir</span>}
        {aceitas > 0 && <span className="rounded bg-surface-2 px-1.5 py-0.5">{aceitas} {aceitas === 1 ? 'virou tarefa' : 'viraram tarefas'}</span>}
      </span>
    </button>
  );
}

function ColarAta({ token, onSalva, onErro }: { token: string; onSalva: (a: TrabAtaDetalhe) => void; onErro: (m: string) => void }) {
  const [titulo, setTitulo] = useState('');
  const [data, setData] = useState('');
  const [participantes, setParticipantes] = useState('');
  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);

  const lerArquivo = (f: File | undefined) => {
    if (!f) return;
    if (!/\.(md|txt)$/i.test(f.name)) { onErro('Envie um arquivo .md ou .txt.'); return; }
    f.text().then((t) => {
      setTexto(t);
      if (!titulo) setTitulo(f.name.replace(/\.(md|txt)$/i, ''));
    }).catch(() => onErro('Não consegui ler o arquivo.'));
  };

  const curta = Array.from(texto.trim()).length < ATA_MIN_CARACTERES;
  const salvar = () => {
    setSalvando(true);
    apiPost<TrabAtaDetalhe>('/trabalho/atas', {
      titulo: titulo.trim(),
      data: data || null,
      participantes: participantes.split(',').map((p) => p.trim()).filter(Boolean),
      texto,
    }, token)
      .then(onSalva)
      .catch((e) => onErro(e.message))
      .finally(() => setSalvando(false));
  };

  return (
    <form
      aria-label="Colar ata"
      className="space-y-2 rounded-lg border border-border bg-surface p-3"
      onSubmit={(e) => { e.preventDefault(); if (!curta && titulo.trim().length >= 3) salvar(); }}
    >
      <p className="text-[12px] text-muted">A ata vira nota da memória da empresa, com versão e registro no rastro. Senha, token ou chave que estiverem no texto são mascarados antes de gravar.</p>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <label className="space-y-1 text-[12px] text-muted">
          <span>Título</span>
          <input data-testid="ata-colar-titulo" className={INP} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Reunião de operação" />
        </label>
        <label className="space-y-1 text-[12px] text-muted">
          <span>Data da reunião</span>
          <input type="date" aria-label="Data da reunião" className={INP} value={data} onChange={(e) => setData(e.target.value)} />
        </label>
      </div>
      <label className="block space-y-1 text-[12px] text-muted">
        <span>Participantes (separados por vírgula)</span>
        <input className={INP} value={participantes} onChange={(e) => setParticipantes(e.target.value)} />
      </label>
      <label className="block space-y-1 text-[12px] text-muted">
        <span>Texto da ata</span>
        <textarea data-testid="ata-colar-texto" className={`${INP} min-h-48 font-mono text-[13px]`} value={texto} onChange={(e) => setTexto(e.target.value)} />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-[12px] text-muted">
          <span className="mr-2">Ou envie um arquivo .md ou .txt</span>
          <input type="file" accept=".md,.txt,text/markdown,text/plain" aria-label="Arquivo da ata" onChange={(e) => lerArquivo(e.target.files?.[0])} className="text-[12px]" />
        </label>
        <button type="submit" data-testid="ata-colar-salvar" className={BTN_PRIMARIO} disabled={salvando || curta || titulo.trim().length < 3}>
          {salvando ? 'Salvando…' : 'Salvar ata'}
        </button>
      </div>
      {texto && curta && <p className="text-[12px] text-muted">A ata precisa de ao menos {ATA_MIN_CARACTERES} caracteres.</p>}
    </form>
  );
}
