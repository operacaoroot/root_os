"use client";

import { useEffect, useRef, useState } from 'react';
import type { TrabAtividadeDto, TrabAtividadePagina } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { resumirAtividade } from '@/lib/work-activity';

type Props = { taskId: string; token: string | null; userId: string | null };
type Tentativa = { cursor: string | null; recomecar: boolean };
class EscopoIncompativel extends Error {}
const texto = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0;
const dataValida = (s: unknown): s is string => texto(s) && Number.isFinite(Date.parse(s));
const mesmaAncora = (a: TrabAtividadePagina['anchor'], b: TrabAtividadePagina['anchor']) =>
  a === null && b === null || !!a && !!b && a.id === b.id && a.createdAt === b.createdAt;

function conferirPagina(p: TrabAtividadePagina, props: Props, anterior: TrabAtividadePagina | null, cursor: string | null, usados: Set<string>) {
  if (!p || !p.escopo || !texto(p.escopo.orgId) || p.escopo.taskId !== props.taskId || p.escopo.userId !== props.userId
    || anterior && p.escopo.orgId !== anterior.escopo.orgId) {
    throw new EscopoIncompativel('A resposta não corresponde à pessoa e à tarefa desta consulta.');
  }
  if (!Array.isArray(p.items) || p.limit !== 50 || p.items.length > p.limit || !dataValida(p.consultadoEm)
    || typeof p.hasMore !== 'boolean' || !(p.nextCursor === null || texto(p.nextCursor))
    || p.hasMore !== (p.nextCursor !== null)
    || !(p.anchor === null || p.anchor && texto(p.anchor.id) && dataValida(p.anchor.createdAt))
    || p.items.length > 0 && p.anchor === null
    || anterior && !mesmaAncora(p.anchor, anterior.anchor)
    || p.hasMore && p.items.length === 0
    || p.nextCursor !== null && (p.nextCursor === cursor || usados.has(p.nextCursor))) {
    throw new Error('A resposta não permite continuar o histórico. Atualize a consulta.');
  }
  const ids = new Set(anterior?.items.map((a) => a.id));
  for (const a of p.items) {
    if (!a || !texto(a.id) || !texto(a.action) || !texto(a.actorType) || !dataValida(a.createdAt)
      || !(a.actorName === null || typeof a.actorName === 'string') || ids.has(a.id)) {
      throw new Error('A página de atividades contém registros incompatíveis ou repetidos.');
    }
    ids.add(a.id);
  }
}
function retrato(value: unknown): string {
  if (value == null) return 'Não registrado';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2) ?? 'Não registrado'; }
  catch { return 'Registro indisponível'; }
}

export function AtividadeDaTarefa(props: Props) {
  return <ConsultaDeAtividade key={props.userId + ':' + props.token + ':' + props.taskId} {...props} />;
}
function ConsultaDeAtividade(props: Props) {
  const { taskId, token, userId } = props;
  const [pagina, setPagina] = useState<TrabAtividadePagina | null>(null);
  const [ocupado, setOcupado] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState<Tentativa | null>(null);
  const geracao = useRef(0), emCurso = useRef(false), usados = useRef(new Set<string>());

  async function carregar(cursor: string | null, recomecar: boolean, epoch = geracao.current) {
    if (emCurso.current || !token || !userId) return;
    emCurso.current = true; setOcupado(true); setErro(null);
    const anterior = recomecar ? null : pagina;
    try {
      const query = new URLSearchParams({ limit: '50' });
      if (cursor !== null) query.set('cursor', cursor);
      const p = await apiGet<TrabAtividadePagina>(`/trabalho/tarefas/${encodeURIComponent(taskId)}/atividade?${query}`, token);
      if (geracao.current !== epoch) return;
      conferirPagina(p, props, anterior, cursor, recomecar ? new Set() : usados.current);
      if (recomecar) usados.current.clear();
      if (cursor !== null) usados.current.add(cursor);
      setPagina({ ...p, items: [...(anterior?.items ?? []), ...p.items] });
      setTentativa(null);
    } catch (e) {
      if (geracao.current !== epoch) return;
      const status = (e as { status?: number } | null)?.status;
      if (e instanceof EscopoIncompativel || status && [401, 403, 404].includes(status)) {
        setPagina(null); usados.current.clear(); setTentativa(null);
      } else setTentativa({ cursor, recomecar });
      setErro(e instanceof Error ? e.message : 'Não foi possível consultar as atividades.');
    } finally {
      if (geracao.current === epoch) { emCurso.current = false; setOcupado(false); }
    }
  }
  useEffect(() => {
    const epoch = ++geracao.current;
    if (token && userId) void carregar(null, true, epoch);
    else { setOcupado(false); setErro('Entre na sua conta para consultar as atividades.'); }
    return () => { geracao.current += 1; emCurso.current = false; };
    // A chave do componente separa pessoa, token e tarefa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, token, userId]);

  return <section aria-label="Atividade da tarefa" className="space-y-2">
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted">Atividade</h2>
      <button type="button" disabled={ocupado || !token || !userId} onClick={() => void carregar(null, true)} className="text-xs underline disabled:opacity-50">Atualizar atividade</button>
    </div>
    {ocupado && <p role="status" className="text-xs text-muted">Carregando atividades…</p>}
    {erro && <div className="space-y-1 text-xs"><p role="status">{erro}</p>{tentativa && <button type="button" disabled={ocupado} onClick={() => void carregar(tentativa.cursor, tentativa.recomecar)} className="underline disabled:opacity-50">Tentar novamente</button>}</div>}
    {pagina && <>
      {pagina.anchor && <p className="text-xs text-muted">Atividades até {new Date(pagina.anchor.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Atualize para consultar novas entradas.</p>}
      <ol className="space-y-2">{pagina.items.map((a: TrabAtividadeDto) => <li key={a.id} data-work-activity-id={a.id} className="text-xs">
        <p><time dateTime={a.createdAt}>{new Date(a.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</time> · {a.actorName ?? a.actorType} · {resumirAtividade(a)}</p>
        <details><summary className="cursor-pointer text-muted">Antes e depois</summary><dl className="space-y-1"><div><dt>Antes</dt><dd className="whitespace-pre-wrap break-words">{retrato(a.before)}</dd></div><div><dt>Depois</dt><dd className="whitespace-pre-wrap break-words">{retrato(a.after)}</dd></div></dl></details>
      </li>)}</ol>
      <p className="text-xs text-muted">{pagina.items.length} {pagina.items.length === 1 ? 'atividade carregada' : 'atividades carregadas'}.</p>
      {pagina.hasMore
        ? <button type="button" disabled={ocupado || tentativa !== null} onClick={() => void carregar(pagina.nextCursor, false)} className="text-xs underline disabled:opacity-50">Carregar atividades anteriores</button>
        : <p className="text-xs text-muted">{pagina.items.length ? 'Fim desta consulta.' : 'Sem atividades nesta consulta.'}</p>}
    </>}
  </section>;
}
