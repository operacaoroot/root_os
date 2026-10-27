'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErroDaApi, apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { KpiCard } from '@/components/KpiCard';
import { Botao, Card, Chip, inputCls } from '../referencias/ui';
import { Gaveta } from './Gaveta';
import { Aba, Barra, Estado, Mono, Rotulo, Vazio } from './ui';
import {
  ETAPA, ROTULO, TIPO_DE_EVENTO, dh, haQuanto,
  type Acesso, type CasaDetalhe, type CasaResumo, type Evento, type Politicas, type Resumo, type Estado as EstadoT,
} from './tipos';

/*
 * ============================================================================
 * FROTA — os servidores de cliente que a ROOT opera, numa tela só
 * ============================================================================
 *
 * Tela da ROOT (sessão da plataforma), como a Operação: a API recusa qualquer
 * outra sessão com 403 e esta tela explica em vez de quebrar.
 *
 * O que alimenta: o `kit-relatar` de cada casa (kit-instalacao-vps, etapa 09),
 * a cada 5 min. O que a tela faz: mostra o estado, quem tem chave em cada
 * servidor, as 10 políticas do manual do kit conferidas casa a casa, o registro
 * do que aconteceu, e enfileira ordens (revogar chave, desligar automação,
 * rodar verificar, pedir backup) que a casa puxa no relato seguinte.
 */

type Vista = 'visao' | 'servidores' | 'acessos' | 'politicas' | 'registro' | 'instalar';
type AbaDaGaveta = 'resumo' | 'apps' | 'registro' | 'acessos' | 'pendencias' | 'ficha' | 'verificar' | 'ordens';

const VISTAS: [Vista, string][] = [
  ['visao', 'Visão geral'], ['servidores', 'Servidores'], ['acessos', 'Acessos'], ['politicas', 'Políticas e LGPD'], ['registro', 'Registro'], ['instalar', 'Instalar o relator'],
];

export default function Frota() {
  const { token, ready, user } = useAuth();
  const podeAgir = !!user?.permissions.includes('admin.usuarios');
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>('visao');
  const [aberta, setAberta] = useState<{ id: string; aba?: AbaDaGaveta } | null>(null);
  const [revogando, setRevogando] = useState<{ acesso: Acesso; casa: string } | null>(null);
  const [novaCasa, setNovaCasa] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!token) return;
    try {
      setResumo(await apiGet<Resumo>('/frota/resumo', token));
      setAutorizado(true);
      setErro(null);
    } catch (e) {
      if (e instanceof ErroDaApi && e.status === 403) setAutorizado(false);
      else setErro((e as Error).message);
    }
  }, [token]);

  useEffect(() => { if (ready) void carregar(); }, [ready, carregar]);
  useEffect(() => {
    const t = setInterval(() => { void carregar(); }, 60_000);
    return () => clearInterval(t);
  }, [carregar]);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 6000);
    return () => clearTimeout(t);
  }, [aviso]);

  if (!ready || (autorizado === null && !erro)) return <p className="text-[12px] text-muted">carregando…</p>;
  if (autorizado === false) {
    return (
      <div className="max-w-[520px] rounded-root border border-border bg-surface p-5">
        <p className="text-[12px] text-text">Esta área é da ROOT.</p>
        <p className="mt-2 text-[11.5px] leading-[1.6] text-muted">A frota de servidores é vista pela sessão de quem opera a plataforma.</p>
      </div>
    );
  }
  if (!resumo) return <p className="text-[12px] text-bad">{erro ?? 'sem dados'}</p>;

  const t = resumo.tiles;
  const abrir = (id: string, aba?: AbaDaGaveta) => setAberta({ id, aba });

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-os-mono text-[13px] font-bold tracking-[-0.01em] text-text">Frota</h1>
          <p className="mt-1 max-w-[720px] text-[11.5px] leading-[1.6] text-muted">
            Os servidores de cliente que a ROOT opera. O estado de cada casa chega sozinho a cada 5 minutos; o que precisa de gente aparece primeiro.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Mono className="text-muted">atualizado {dh(resumo.atualizadoEm)}</Mono>
          {podeAgir && <Botao tone="brand" onClick={() => setNovaCasa(true)}>Nova casa</Botao>}
        </div>
      </header>

      {erro && <p className="rounded-root border border-bad/40 bg-bad/10 px-3 py-2 text-[12px] text-bad">{erro}</p>}
      {aviso && <p className="rounded-root border border-good/40 bg-good/10 px-3 py-2 text-[12px] text-text">{aviso}</p>}

      <div className="flex gap-0.5 overflow-x-auto border-b border-border" role="tablist">
        {VISTAS.map(([k, n]) => (
          <Aba key={k} ativa={vista === k} onClick={() => setVista(k)} contagem={k === 'visao' ? t.precisaDeGente : undefined} tom="warn">{n}</Aba>
        ))}
      </div>

      {vista === 'visao' && <VisaoGeral resumo={resumo} abrir={abrir} />}
      {vista === 'servidores' && <Servidores casas={resumo.casas} abrir={abrir} />}
      {vista === 'acessos' && token && <Acessos casas={resumo.casas} token={token} podeAgir={podeAgir} abrir={abrir} onRevogar={(acesso, casa) => setRevogando({ acesso, casa })} />}
      {vista === 'politicas' && token && <PoliticasView token={token} abrir={abrir} />}
      {vista === 'registro' && token && <RegistroView token={token} casas={resumo.casas} />}
      {vista === 'instalar' && <Instalar />}

      {aberta && token && (
        <Gaveta
          id={aberta.id}
          abaInicial={aberta.aba}
          token={token}
          podeAgir={podeAgir}
          onFechar={() => setAberta(null)}
          onMudou={() => void carregar()}
          onRevogar={(acesso, casa) => setRevogando({ acesso, casa: casa.casa })}
        />
      )}
      {revogando && token && (
        <Revogar
          acesso={revogando.acesso}
          casa={revogando.casa}
          token={token}
          onFechar={() => setRevogando(null)}
          onFeito={(msg) => { setRevogando(null); setAviso(msg); void carregar(); }}
        />
      )}
      {novaCasa && token && (
        <NovaCasa token={token} onFechar={() => setNovaCasa(false)} onCriada={() => { void carregar(); }} />
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- visão */

function VisaoGeral({ resumo, abrir }: { resumo: Resumo; abrir: (id: string, aba?: AbaDaGaveta) => void }) {
  const t = resumo.tiles;
  const n = t.servidores;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="servidores" value={n} hint={`${t.comKit} com kit · ${t.relatando} relatando agora`} icon="Server" />
        <KpiCard label="sonda ok" value={`${t.sondaOk}/${n}`} hint={n - t.sondaOk ? `${n - t.sondaOk} sem sonda ou com alerta` : 'todas sem alerta'} tone={n && t.sondaOk < n ? 'warn' : 'default'} icon="Activity" />
        <KpiCard label="chaves ssh" value={t.chaves} hint={`${t.pessoas} pessoas · ${t.semDono} sem dono`} tone={t.semDono ? 'warn' : 'default'} icon="KeyRound" />
        <KpiCard label="backup fora" value={`${t.backupFora}/${n}`} hint={n - t.backupFora ? `${n - t.backupFora} só com cópia local` : 'todas com cópia fora'} tone={n && t.backupFora < n ? 'warn' : 'default'} icon="HardDrive" />
        <KpiCard label="políticas" value={t.pendenciasDePolitica} hint="pendências, política × casa" tone={t.pendenciasDePolitica ? 'warn' : 'default'} icon="ShieldCheck" />
        <KpiCard label="precisa de gente" value={t.precisaDeGente} hint={t.ordensPendentes ? `${t.ordensPendentes} ordem(ns) na fila` : 'ações abertas'} tone={t.precisaDeGente ? 'bad' : 'good'} icon="AlertTriangle" />
      </div>

      {!resumo.casas.length ? (
        <Card titulo="nenhuma casa ainda">
          <p className="text-[12.5px] text-text">Cadastre a primeira casa em <b>Nova casa</b>. O cadastro dá o token do relator; a aba <b>Instalar o relator</b> mostra os três comandos que ligam o servidor a esta tela.</p>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <Card titulo="precisa de ação agora">
              {resumo.acoes.length ? (
                <div className="space-y-2">
                  {resumo.acoes.map((a, i) => (
                    <div key={i} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-root border border-border bg-surface-2 px-3 py-2">
                      <Estado estado={a.n} />
                      <div className="min-w-0 text-[12.5px] text-text"><Mono className="mr-2 text-brand">{a.casa}</Mono>{a.t}<span className="block font-os-mono text-[10px] text-muted">{a.b}</span></div>
                      <Botao onClick={() => abrir(a.casaId, 'pendencias')}>Abrir</Botao>
                    </div>
                  ))}
                  {resumo.totalDeAcoes > resumo.acoes.length && <Mono className="text-muted">+ {resumo.totalDeAcoes - resumo.acoes.length} em Servidores</Mono>}
                </div>
              ) : <Vazio>Nada pendente. Todas as casas relatando e sem falha.</Vazio>}
            </Card>
            <Card titulo="servidores">
              <div className="grid gap-3 md:grid-cols-2">
                {resumo.casas.map((c) => <CartaoDaCasa key={c.id} c={c} onClick={() => abrir(c.id)} />)}
              </div>
            </Card>
          </div>
          <Card titulo="últimos acontecimentos">
            {resumo.eventos.length ? (
              <div>
                {resumo.eventos.slice(0, 25).map((e) => <LinhaDoRegistro key={e.id} e={e} />)}
              </div>
            ) : <Vazio>Nada registrado ainda. O primeiro relato de uma casa abre o registro.</Vazio>}
          </Card>
        </div>
      )}
    </div>
  );
}

function CartaoDaCasa({ c, onClick }: { c: CasaResumo; onClick: () => void }) {
  const discoTom = (c.disco ?? 0) >= 85 ? 'bad' : (c.disco ?? 0) >= 70 ? 'warn' : undefined;
  const fato = (k: string, v: React.ReactNode, cor?: string) => (
    <div className="min-w-0"><Rotulo>{k}</Rotulo><span className={`block truncate font-os-mono text-[11px] ${cor ?? 'text-text'}`}>{v}</span></div>
  );
  return (
    <button type="button" onClick={onClick} className="group flex flex-col gap-3 rounded-root border border-border bg-surface-2 p-3 text-left transition-colors hover:border-brand/40">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><span className="block font-os-mono text-[14px] font-bold text-text">{c.casa}</span><span className="block truncate text-[11.5px] text-muted">{c.cliente}</span></div>
        <Estado estado={c.estado} texto={ROTULO[c.estado]} />
      </div>
      {c.etapa === 'pre' ? (
        <p className="text-[11.5px] text-muted">{c.pendencias[0]?.t ?? 'Sem servidor ainda.'}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {fato('servidor', `${c.hostname ?? '—'}${c.sistema ? ` · ${c.sistema.split(' ').slice(0, 2).join(' ')}` : ''}`)}
            {fato('kit · acesso', `${c.kitVersao ?? 'sem kit'} · ${c.acesso}`, c.kitVersao ? undefined : 'text-warn')}
            {fato('apps no ar', `${c.apps.rodando} de ${c.apps.total}`, c.apps.rodando < c.apps.total ? 'text-warn' : undefined)}
            {fato('relato', haQuanto(c.ultimoRelatoEm), c.relatando ? 'text-good' : 'text-warn')}
            {fato('backup', c.backup?.ultimoOk ? `${dh(c.backup.ultimoOk)} · ${c.backup.remoto ? 'local + fora' : 'só local'}` : 'nunca', c.backup?.remoto ? undefined : 'text-warn')}
            {fato('pessoas', `${c.chaves} com chave`)}
          </div>
          <div className="flex items-end gap-3 border-t border-border pt-2">
            <div className="flex-1"><Rotulo>cpu {c.cpuPct !== null ? `${c.cpuPct}%` : ''}</Rotulo><Barra pct={c.cpuPct} /></div>
            <div className="w-[110px]"><Rotulo>disco {c.disco !== null ? `${c.disco}%` : ''}</Rotulo><Barra pct={c.disco} tom={discoTom} /></div>
          </div>
        </>
      )}
    </button>
  );
}

function LinhaDoRegistro({ e, comCasa = true }: { e: Evento; comCasa?: boolean }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-3 border-t border-border py-2 first:border-t-0 first:pt-0">
      <div className="font-os-mono text-[10.5px] leading-[1.5] text-muted">{dh(e.quando)}<br /><span className="text-text">{e.quem}</span></div>
      <div className="min-w-0 text-[12px] text-text">{comCasa && e.casa && <Mono className="mr-2 text-brand">{e.casa}</Mono>}{e.acao}<span className="block font-os-mono text-[10px] text-muted">{e.origem}</span></div>
    </div>
  );
}

/* ------------------------------------------------------------ servidores */

function Servidores({ casas, abrir }: { casas: CasaResumo[]; abrir: (id: string) => void }) {
  const [filtro, setFiltro] = useState<'todos' | EstadoT>('todos');
  const [busca, setBusca] = useState('');
  const lista = casas.filter((c) => (filtro === 'todos' || c.estado === filtro) && (!busca || `${c.casa} ${c.cliente} ${c.hostname ?? ''} ${c.dono ?? ''}`.toLowerCase().includes(busca.toLowerCase())));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(['todos', 'ok', 'at', 'er', 'ne'] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFiltro(f)} aria-pressed={filtro === f} className={`rounded-root border px-2.5 py-1 font-os-mono text-[10.5px] uppercase tracking-[0.12em] ${filtro === f ? 'border-brand text-brand' : 'border-border text-muted hover:text-text'}`}>{f === 'todos' ? 'todos' : ROTULO[f]}</button>
        ))}
        <input className={`${inputCls} ml-auto w-[220px]`} placeholder="casa, cliente, host…" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar servidor" />
      </div>
      <div className="overflow-x-auto rounded-root border border-border bg-surface">
        <table className="w-full min-w-[980px] text-[12px]">
          <thead className="text-left text-[10px] uppercase tracking-wide text-muted">
            <tr>{['casa', 'cliente', 'estado', 'servidor', 'kit', 'acesso', 'apps', 'relato', 'backup', 'disco', 'chaves', 'políticas'].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr>
          </thead>
          <tbody>
            {lista.map((c) => (
              <tr key={c.id} onClick={() => abrir(c.id)} className="cursor-pointer border-t border-border hover:bg-surface-2">
                <td className="px-3 py-2"><Mono className="font-bold">{c.casa}</Mono></td>
                <td className="px-3 py-2 text-text">{c.cliente}<span className="block font-os-mono text-[10px] text-muted">{c.responsavel ?? ''}</span></td>
                <td className="px-3 py-2"><Estado estado={c.estado} /><span className="block font-os-mono text-[10px] text-muted">{c.estadoTexto}</span></td>
                <td className="px-3 py-2"><Mono>{c.hostname ?? '—'}</Mono><span className="block font-os-mono text-[10px] text-muted">{c.sistema ?? ''}{c.maquina ? ` · ${c.maquina}` : ''}</span></td>
                <td className="px-3 py-2"><Mono className={c.kitVersao ? '' : 'text-warn'}>{c.kitVersao ?? 'sem kit'}</Mono></td>
                <td className="px-3 py-2"><Mono>{c.acesso}</Mono></td>
                <td className="px-3 py-2"><Mono>{c.apps.rodando}/{c.apps.total}</Mono></td>
                <td className="px-3 py-2"><Mono className={c.relatando ? 'text-good' : 'text-warn'}>{haQuanto(c.ultimoRelatoEm)}</Mono></td>
                <td className="px-3 py-2"><Chip tone={c.backup?.remoto ? 'good' : c.backup?.ultimoOk ? 'warn' : 'muted'}>{c.backup?.remoto ? 'local + fora' : c.backup?.ultimoOk ? 'só local' : 'sem dado'}</Chip></td>
                <td className="px-3 py-2"><Mono className={(c.disco ?? 0) >= 85 ? 'text-bad' : (c.disco ?? 0) >= 70 ? 'text-warn' : ''}>{c.disco !== null ? `${c.disco}%` : '—'}</Mono></td>
                <td className="px-3 py-2"><Mono>{c.chaves}</Mono></td>
                <td className="px-3 py-2"><Mono><span className="text-good">{c.politicas.ok}</span> · <span className="text-warn">{c.politicas.at}</span> · <span className="text-bad">{c.politicas.er}</span></Mono></td>
              </tr>
            ))}
            {!lista.length && <tr><td colSpan={12} className="px-3 py-4 text-muted">Nenhum servidor com esse filtro.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- acessos */

function Acessos({ casas, token, podeAgir, abrir, onRevogar }: { casas: CasaResumo[]; token: string; podeAgir: boolean; abrir: (id: string, aba?: AbaDaGaveta) => void; onRevogar: (a: Acesso, casa: string) => void }) {
  const [detalhes, setDetalhes] = useState<CasaDetalhe[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const ids = casas.filter((c) => c.etapa !== 'pre').map((c) => c.id).join(',');
  useEffect(() => {
    let vivo = true;
    Promise.all(ids ? ids.split(',').map((id) => apiGet<CasaDetalhe>(`/frota/casas/${id}`, token)) : [])
      .then((d) => { if (vivo) { setDetalhes(d); setErro(null); } })
      .catch((e) => { if (vivo) setErro((e as Error).message); });
    return () => { vivo = false; };
  }, [ids, token]);

  const pessoas = useMemo(() => {
    const m = new Map<string, Map<string, Acesso>>();
    for (const c of detalhes ?? []) for (const a of c.acessos) {
      if (!['ativa', 'revogando', 'pedido'].includes(a.estado)) continue;
      if (!m.has(a.pessoa)) m.set(a.pessoa, new Map());
      m.get(a.pessoa)!.set(c.id, a);
    }
    return [...m.entries()].sort((x, y) => x[0].localeCompare(y[0]));
  }, [detalhes]);

  if (erro) return <p className="text-[12px] text-bad">{erro}</p>;
  if (!detalhes) return <p className="text-[12px] text-muted">carregando…</p>;
  const colunas = detalhes;
  const emCurso = detalhes.flatMap((c) => c.ordens.filter((o) => o.tipo === 'revogar_chave' && (o.estado === 'pendente' || o.estado === 'entregue')).map((o) => ({ ...o, casa: c.casa })));
  return (
    <div className="space-y-4">
      <p className="max-w-[760px] text-[11.5px] leading-[1.6] text-muted">Uma chave por pessoa, com o nome dela no comentário. Chave sem dono é falha. Revogar tira a linha do authorized_keys, derruba a sessão da pessoa e grava no diário da casa; a casa aplica no relato seguinte, em até 5 minutos.</p>
      {!pessoas.length ? <Vazio>Nenhuma chave relatada ainda. Quando uma casa mandar o primeiro relato, as chaves do authorized_keys aparecem aqui.</Vazio> : (
        <div className="overflow-x-auto rounded-root border border-border bg-surface">
          <table className="w-full text-[12px]">
            <thead className="text-left text-[10px] uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">pessoa</th>{colunas.map((c) => <th key={c.id} className="px-3 py-2 text-center"><button type="button" className="hover:text-text" onClick={() => abrir(c.id, 'acessos')}>{c.casa}</button></th>)}</tr></thead>
            <tbody>
              {pessoas.map(([pessoa, porCasa]) => (
                <tr key={pessoa} className="border-t border-border">
                  <td className="px-3 py-2 text-text">{pessoa}{/^sem dono/i.test(pessoa) && <span className="block text-[10.5px] text-warn">identificar o dono ou revogar</span>}</td>
                  {colunas.map((c) => {
                    const a = porCasa.get(c.id);
                    if (!a) return <td key={c.id} className="px-3 py-2 text-center text-dim">—</td>;
                    const tom = a.estado === 'ativa' ? (/^sem dono/i.test(pessoa) ? 'warn' : 'good') : 'warn';
                    return (
                      <td key={c.id} className="px-3 py-2 text-center">
                        <div className="inline-flex flex-col items-center gap-1">
                          <Chip tone={tom}>{a.estado === 'ativa' ? (/^sem dono/i.test(pessoa) ? 'sem dono' : 'ativa') : a.estado}</Chip>
                          <Mono className="text-[10px] text-muted">{a.ultimoLogin ? `último ${dh(a.ultimoLogin)}` : 'nunca entrou'}</Mono>
                          {podeAgir && a.estado === 'ativa' && a.fingerprint && <Botao tone="bad" onClick={() => onRevogar(a, c.casa)}>Revogar</Botao>}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Card titulo="revogações em curso">
        {emCurso.length ? emCurso.map((o) => (
          <div key={o.id} className="flex flex-wrap items-center gap-2 border-t border-border py-2 text-[12px] first:border-t-0 first:pt-0">
            <Mono className="text-brand">{o.casa}</Mono><span className="text-text">{String((o.parametros as Record<string, unknown> | null)?.pessoa ?? '')}</span><Chip tone="warn">{o.estado === 'pendente' ? 'na fila' : 'entregue à casa'}</Chip><Mono className="text-muted">pedida {dh(o.criadaEm)} por {o.criadaPor}</Mono>
          </div>
        )) : <Vazio>Nenhuma revogação esperando a casa.</Vazio>}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------- políticas */

function PoliticasView({ token, abrir }: { token: string; abrir: (id: string, aba?: AbaDaGaveta) => void }) {
  const [dados, setDados] = useState<Politicas | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    apiGet<Politicas>('/frota/politicas', token).then(setDados).catch((e) => setErro((e as Error).message));
  }, [token]);
  if (erro) return <p className="text-[12px] text-bad">{erro}</p>;
  if (!dados) return <p className="text-[12px] text-muted">carregando…</p>;
  const casas = dados.casas;
  const total = casas.reduce((n, c) => n + c.estados.filter((e) => e.estado !== 'manual' && e.estado !== 'ne').length, 0);
  const ok = casas.reduce((n, c) => n + c.estados.filter((e) => e.estado === 'ok').length, 0);
  const pend = casas.reduce((n, c) => n + c.estados.filter((e) => e.estado === 'at' || e.estado === 'er').length, 0);
  const registros = casas.filter((c) => ['controlador', 'dados', 'finalidade', 'baseLegal', 'retencao', 'encarregado'].every((k) => (c.lgpd[k] ?? '').trim())).length;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="políticas" value={dados.politicas.length} hint="do manual do kit" icon="ShieldCheck" />
        <KpiCard label="cumpridas" value={`${ok}/${total}`} hint="política × casa, onde a máquina mede" tone="good" icon="Check" />
        <KpiCard label="pendências" value={pend} hint="atenção e erro" tone={pend ? 'warn' : 'default'} icon="AlertTriangle" />
        <KpiCard label="registros de tratamento" value={`${registros}/${casas.length}`} hint="LGPD completo por casa" tone={registros < casas.length ? 'warn' : 'good'} icon="FileCheck" />
      </div>
      <div className="overflow-x-auto rounded-root border border-border bg-surface">
        <table className="w-full text-[12px]">
          <thead className="text-left text-[10px] uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">política</th>{casas.map((c) => <th key={c.id} className="px-3 py-2 text-center"><button type="button" className="hover:text-text" onClick={() => abrir(c.id, 'pendencias')}>{c.casa}</button></th>)}</tr></thead>
          <tbody>
            {dados.politicas.map((p) => (
              <tr key={p.cod} className="border-t border-border align-top">
                <td className="px-3 py-2"><span className="text-text">P-{p.cod} · {p.nome}</span><span className="block max-w-[460px] text-[11px] text-muted">{p.texto}</span><span className="block font-os-mono text-[10px] text-dim">base: {p.base}</span></td>
                {casas.map((c) => {
                  const e = c.estados.find((x) => x.cod === p.cod);
                  return <td key={c.id} className="px-3 py-2 text-center"><button type="button" title={e?.detalhe} onClick={() => abrir(c.id, 'pendencias')}><Estado estado={e?.estado ?? 'ne'} /></button></td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Card titulo="registro de tratamento por casa">
        <p className="mb-3 max-w-[760px] text-[11.5px] leading-[1.6] text-muted">O que cada servidor guarda, para quê, com que base legal e por quanto tempo. O cliente é o controlador; a ROOT é a operadora. Preenche-se na ficha de cada casa.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-[12px]">
            <thead className="text-left text-[10px] uppercase tracking-wide text-muted"><tr>{['casa', 'controlador', 'dados tratados', 'finalidade', 'base legal', 'retenção', 'encarregado', 'ia sobre os dados'].map((h) => <th key={h} className="px-2 py-2">{h}</th>)}</tr></thead>
            <tbody>
              {casas.map((c) => (
                <tr key={c.id} onClick={() => abrir(c.id, 'ficha')} className="cursor-pointer border-t border-border align-top hover:bg-surface-2">
                  <td className="px-2 py-2"><Mono className="font-bold">{c.casa}</Mono></td>
                  {['controlador', 'dados', 'finalidade', 'baseLegal', 'retencao', 'encarregado', 'ia'].map((k) => <td key={k} className="px-2 py-2 text-text">{c.lgpd[k]?.trim() ? c.lgpd[k] : <span className="text-dim">—</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------- registro */

function RegistroView({ token, casas }: { token: string; casas: CasaResumo[] }) {
  const [tipo, setTipo] = useState<string>('');
  const [casaId, setCasaId] = useState<string>('');
  const [eventos, setEventos] = useState<Evento[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams();
    if (tipo) q.set('tipo', tipo);
    if (casaId) q.set('casaId', casaId);
    q.set('limite', '300');
    apiGet<{ eventos: Evento[] }>(`/frota/eventos?${q}`, token).then((r) => { setEventos(r.eventos); setErro(null); }).catch((e) => setErro((e as Error).message));
  }, [token, tipo, casaId]);
  return (
    <div className="space-y-3">
      <p className="max-w-[760px] text-[11.5px] leading-[1.6] text-muted">Quem fez o quê, em qual servidor, por qual caminho. O registro só recebe linha nova; ninguém edita nem apaga, nem o painel.</p>
      <div className="flex flex-wrap items-center gap-2">
        {[['', 'tudo'], ...Object.entries(TIPO_DE_EVENTO)].map(([k, n]) => (
          <button key={k} type="button" onClick={() => setTipo(k)} aria-pressed={tipo === k} className={`rounded-root border px-2.5 py-1 font-os-mono text-[10.5px] uppercase tracking-[0.12em] ${tipo === k ? 'border-brand text-brand' : 'border-border text-muted hover:text-text'}`}>{n}</button>
        ))}
        <select className={`${inputCls} ml-auto w-[200px]`} value={casaId} onChange={(e) => setCasaId(e.target.value)} aria-label="Casa">
          <option value="">todas as casas</option>
          {casas.map((c) => <option key={c.id} value={c.id}>{c.casa}</option>)}
        </select>
      </div>
      {erro && <p className="text-[12px] text-bad">{erro}</p>}
      <div className="rounded-root border border-border bg-surface px-4 py-3">
        {!eventos ? <p className="text-[12px] text-muted">carregando…</p> : eventos.length ? eventos.map((e) => <LinhaDoRegistro key={e.id} e={e} />) : <Vazio>Nada com esse filtro.</Vazio>}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- instalar */

function Instalar() {
  const base = typeof window !== 'undefined' ? `${window.location.origin}/api` : 'https://os.operacaoroot.com/api';
  return (
    <div className="max-w-[820px] space-y-4">
      <Card titulo="como ligar um servidor a esta tela">
        <ol className="list-decimal space-y-3 pl-5 text-[12.5px] text-text">
          <li>Cadastre a casa em <b>Nova casa</b>. O cadastro mostra o token do relator <b>uma vez</b>.</li>
          <li>Na estação, leve o kit atual para o servidor:<pre className="mt-1 overflow-x-auto rounded-root border border-border bg-surface-2 p-2 font-os-mono text-[11px]">~/kit-instalacao-vps/ferramentas/enviar-kit.sh &lt;apelido-ssh&gt;</pre></li>
          <li>No servidor, acrescente ao <Mono>/etc/kit/maquina.env</Mono> (permissão 600):<pre className="mt-1 overflow-x-auto rounded-root border border-border bg-surface-2 p-2 font-os-mono text-[11px]">{`FROTA_URL=${base}\nFROTA_TOKEN=<token da casa>`}</pre></li>
          <li>Instale a etapa do relator e mande o primeiro relato:<pre className="mt-1 overflow-x-auto rounded-root border border-border bg-surface-2 p-2 font-os-mono text-[11px]">{`bash /opt/kit-instalacao-vps/instalar.sh 09\nkit-relatar`}</pre></li>
          <li>A casa aparece aqui em até um minuto. Depois disso o timer <Mono>kit-relatar.timer</Mono> manda um relato a cada 5 minutos e puxa as ordens do painel.</li>
        </ol>
      </Card>
      <Card titulo="o que sai do servidor, e o que não sai">
        <ul className="list-disc space-y-1 pl-5 text-[12.5px] text-text">
          <li>Sai: saída do kit-verificar, última linha da sonda, containers e imagens, comentário e impressão digital de cada chave SSH, logins aceitos (quem, quando, de onde), timers, últimas linhas do diário, uso de disco, CPU e memória.</li>
          <li>Não sai: chave privada, conteúdo de log, dado de cliente, senha, variável de ambiente, arquivo nenhum.</li>
          <li>O servidor só faz saída HTTPS para o OS. Nenhuma porta nova; nenhuma credencial da ROOT guardada lá. O token é só daquela casa e pode ser trocado na aba Ordens.</li>
          <li>Servidor fora do kit (como a VPS da própria ROOT hoje) entra com a ficha preenchida à mão e fica como <b>fora do kit</b> até receber o kit.</li>
        </ul>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- modais */

function Revogar({ acesso, casa, token, onFechar, onFeito }: { acesso: Acesso; casa: string; token: string; onFechar: () => void; onFeito: (msg: string) => void }) {
  const [motivo, setMotivo] = useState('');
  const [ciente, setCiente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const confirmar = async () => {
    setEnviando(true); setErro(null);
    try {
      await apiPost(`/frota/acessos/${acesso.id}/revogar`, { motivo }, token);
      onFeito(`Revogação de ${acesso.pessoa} em ${casa} enfileirada. A casa aplica no próximo relato (até 5 min) e o registro confirma.`);
    } catch (e) { setErro((e as Error).message); } finally { setEnviando(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true" onClick={onFechar}>
      <div className="w-full max-w-[520px] rounded-root border border-bad/60 bg-surface p-5" onClick={(e) => e.stopPropagation()}>
        <Rotulo>revogar acesso</Rotulo>
        <h3 className="mt-1 text-[14px] font-semibold text-text">Revogar {acesso.pessoa} em {casa}?</h3>
        <p className="mt-1 text-[12px] text-muted">O que acontece, nesta ordem, quando a casa puxar a ordem:</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12px] text-text">
          <li>A linha da chave <Mono>…{acesso.fingerprint?.slice(-14)}</Mono> sai do <Mono>/root/.ssh/authorized_keys</Mono> (com cópia de segurança do arquivo).</li>
          <li>Sessões SSH abertas com essa chave são encerradas.</li>
          <li>Linha no diário da casa e neste registro, com quem revogou e o motivo.</li>
          <li>Se a pessoa também está na VPN do cliente, tirar o dispositivo dela é feito no painel do Tailscale.</li>
        </ol>
        <label className="mt-3 flex items-start gap-2 text-[12px] text-text"><input type="checkbox" checked={ciente} onChange={(e) => setCiente(e.target.checked)} className="mt-0.5" />Confirmo que a pessoa saiu do projeto ou que há suspeita de uso indevido.</label>
        <textarea className={`${inputCls} mt-2 min-h-[60px]`} placeholder="Motivo (entra no diário da casa e no registro)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        {erro && <p className="mt-2 text-[12px] text-bad">{erro}</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Botao onClick={onFechar}>Cancelar</Botao>
          <Botao tone="bad" disabled={!ciente || motivo.trim().length < 3 || enviando} onClick={confirmar}>{enviando ? 'enviando…' : 'Revogar agora'}</Botao>
        </div>
      </div>
    </div>
  );
}

function NovaCasa({ token, onFechar, onCriada }: { token: string; onFechar: () => void; onCriada: () => void }) {
  const [f, setF] = useState({ casa: '', cliente: '', dono: '', responsavel: '', etapa: 'preparar', provedor: '', acesso: 'publico', ip: '' });
  const [tokenCriado, setTokenCriado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const base = typeof window !== 'undefined' ? `${window.location.origin}/api` : '';
  const criar = async () => {
    setEnviando(true); setErro(null);
    try {
      const r = await apiPost<{ token: string }>('/frota/casas', { ...f, dono: f.dono || undefined, responsavel: f.responsavel || undefined, provedor: f.provedor || undefined, ip: f.ip || undefined }, token);
      setTokenCriado(r.token);
      onCriada();
    } catch (e) { setErro((e as Error).message); } finally { setEnviando(false); }
  };
  const copiar = async () => {
    if (!tokenCriado) return;
    try { await navigator.clipboard.writeText(`FROTA_URL=${base}\nFROTA_TOKEN=${tokenCriado}`); setCopiado(true); } catch { setCopiado(false); }
  };
  const campo = (label: string, k: keyof typeof f, dica?: string) => (
    <label className="block"><span className="mb-0.5 block text-[11px] text-muted">{label}{dica ? <span className="text-dim"> · {dica}</span> : null}</span><input className={inputCls} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true" onClick={onFechar}>
      <div className="w-full max-w-[560px] rounded-root border border-border bg-surface p-5" onClick={(e) => e.stopPropagation()}>
        <Rotulo>nova casa</Rotulo>
        {tokenCriado ? (
          <div>
            <h3 className="mt-1 text-[14px] font-semibold text-text">Casa {f.casa} criada.</h3>
            <p className="mt-1 text-[12px] text-muted">Este é o token do relator. Ele aparece <b>uma vez</b>; copie e grave no <Mono>/etc/kit/maquina.env</Mono> do servidor.</p>
            <pre className="mt-2 overflow-x-auto rounded-root border border-warn/50 bg-warn/10 p-3 font-os-mono text-[11px] text-text">{`FROTA_URL=${base}\nFROTA_TOKEN=${tokenCriado}`}</pre>
            <div className="mt-3 flex flex-wrap justify-end gap-2"><Botao onClick={copiar}>{copiado ? 'copiado' : 'copiar as duas linhas'}</Botao><Botao tone="brand" onClick={onFechar}>Fechar</Botao></div>
          </div>
        ) : (
          <div>
            <h3 className="mt-1 text-[14px] font-semibold text-text">Cadastrar um servidor na frota</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {campo('Casa (nome curto do kit)', 'casa', 'a-z, 0-9, hífen')}
              {campo('Cliente', 'cliente')}
              {campo('Dono (pessoa)', 'dono')}
              {campo('Responsável na ROOT', 'responsavel')}
              <label className="block"><span className="mb-0.5 block text-[11px] text-muted">Etapa</span><select className={inputCls} value={f.etapa} onChange={(e) => setF({ ...f, etapa: e.target.value })}>{Object.entries(ETAPA).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
              <label className="block"><span className="mb-0.5 block text-[11px] text-muted">Acesso</span><select className={inputCls} value={f.acesso} onChange={(e) => setF({ ...f, acesso: e.target.value })}><option value="publico">público (80/443 abertos)</option><option value="vpn">vpn (só pela rede do cliente)</option></select></label>
              {campo('Provedor', 'provedor', 'e de quem é a conta')}
              {campo('IP público', 'ip')}
            </div>
            {erro && <p className="mt-2 text-[12px] text-bad">{erro}</p>}
            <div className="mt-4 flex flex-wrap justify-end gap-2"><Botao onClick={onFechar}>Cancelar</Botao><Botao tone="brand" disabled={!f.casa || !f.cliente || enviando} onClick={criar}>{enviando ? 'criando…' : 'Criar e gerar o token'}</Botao></div>
          </div>
        )}
      </div>
    </div>
  );
}
