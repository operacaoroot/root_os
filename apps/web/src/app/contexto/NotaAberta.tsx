'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TrabEstrutura, ContextoTarefaCreateInput, ContextoTarefaCreateResponse } from '@mktos/shared';
import { ContextoTarefaCreateSchema } from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dia, quando, rotuloDaNatureza, type NotaDeContexto, type VersaoDeNota } from './tipos';

const INP = 'mt-1 w-full rounded-root border border-border bg-surface-2 px-2 py-2 text-sm text-text disabled:opacity-60';
type ResultadoDeTarefa = Pick<ContextoTarefaCreateResponse, 'taskId' | 'listId' | 'replayed'>;

function lerPedidoSalvo(chave: string): ContextoTarefaCreateInput | null {
  try {
    const guardado = JSON.parse(localStorage.getItem(chave) ?? 'null') as { pedido?: unknown } | null;
    const resultado = ContextoTarefaCreateSchema.safeParse(guardado?.pedido);
    return resultado.success ? resultado.data : null;
  } catch { return null; }
}

export function NotaAberta({ notaId, versaoInicial, onIndisponivel }: { notaId: string; versaoInicial?: string | null; onIndisponivel?: () => void }) {
  const { token, ready, can, user } = useAuth();
  if (!ready) return <p className="text-sm text-muted">Carregando fonte…</p>;
  if (!token || !user || !can('obsidian.ver')) return <p className="text-sm text-muted">Fonte não disponível para esta conta.</p>;
  return <NotaAutorizada key={`${token}:${notaId}`} notaId={notaId} versaoInicial={versaoInicial} onIndisponivel={onIndisponivel} />;
}

function NotaAutorizada({ notaId, versaoInicial, onIndisponivel }: { notaId: string; versaoInicial?: string | null; onIndisponivel?: () => void }) {
  const { token, user, can } = useAuth();
  const [atual, setAtual] = useState<NotaDeContexto | null>(null);
  const [versoes, setVersoes] = useState<VersaoDeNota[] | null>(null);
  const [selecionadaId, setSelecionadaId] = useState<string | null>(versaoInicial ?? null);
  const [erro, setErro] = useState<string | null>(null);
  const [conflito, setConflito] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [formulario, setFormulario] = useState(false);
  const [estrutura, setEstrutura] = useState<TrabEstrutura | null>(null);
  const [listaId, setListaId] = useState('');
  const [titulo, setTitulo] = useState('');
  const [pessoaId, setPessoaId] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoDeTarefa | null>(null);
  const [pendente, setPendente] = useState(false);
  const pedidoPendente = useRef<ContextoTarefaCreateInput | null>(null);
  const indisponivelAtual = useRef(onIndisponivel);
  indisponivelAtual.current = onIndisponivel;
  const ciclo = useRef(0);
  const escrita = useRef(false);
  const identidade = useRef(token);
  identidade.current = token;
  const podeCriar = can('tarefas.ver') && can('tarefas.editar');
  const privar = useCallback(() => {
    setAtual(null); setVersoes(null); setEstrutura(null); setFormulario(false); setResultado(null);
    setErro('Fonte não disponível para esta conta.');
    indisponivelAtual.current?.();
  }, []);
  const carregar = useCallback(async () => {
    const rodada = ++ciclo.current;
    setAtual(null); setVersoes(null); setCarregando(true); setErro(null);
    try {
      const [nota, historico] = await Promise.all([
        apiGet<NotaDeContexto>(`/memoria/${encodeURIComponent(notaId)}`, token),
        apiGet<VersaoDeNota[]>(`/memoria/${encodeURIComponent(notaId)}/versoes`, token),
      ]);
      if (rodada !== ciclo.current) return false;
      setAtual(nota); setVersoes(historico); setConflito(false);
      return true;
    } catch (e) {
      if (rodada !== ciclo.current) return false;
      if ([403, 404].includes((e as { status?: number }).status ?? 0)) privar();
      else setErro((e as Error).message);
      return false;
    } finally { if (rodada === ciclo.current) setCarregando(false); }
  }, [notaId, token, privar]);
  useEffect(() => { void carregar(); return () => { ++ciclo.current; }; }, [carregar]);
  useEffect(() => { setSelecionadaId(versaoInicial ?? null); }, [versaoInicial]);

  const selecionada = versoes?.find((v) => selecionadaId ? v.id === selecionadaId : v.versao === atual?.versao) ?? null;
  const historica = !!selecionada && selecionada.versao !== atual?.versao;
  const corpo = selecionada?.body ?? (!selecionadaId || selecionada?.versao === atual?.versao ? atual?.body : undefined);
  const listas = useMemo(() => estrutura ? [...estrutura.folders.flatMap((f) => f.lists), ...estrutura.listasSoltas] : [], [estrutura]);
  const salvo = lerPedidoSalvo(`root_contexto_pedido:${user?.id}:${notaId}`);
  const recuperavel = salvo && versoes?.some((v) => v.id === salvo.versionId && v.contentHash === salvo.contentHash) ? salvo : null;

  const abrirFormulario = async () => {
    if (!podeCriar || !atual || (!selecionada && !recuperavel) || (atual.arquivadoEm && !recuperavel)) return;
    setFormulario(true); setErro(null); setResultado(null);
    if (recuperavel) {
      pedidoPendente.current = recuperavel; setPendente(true); setSelecionadaId(recuperavel.versionId);
      setTitulo(recuperavel.title); setListaId(recuperavel.listId); setPessoaId(recuperavel.assigneeUserId ?? '');
    }
    const rodada = ciclo.current;
    try {
      const e = await apiGet<TrabEstrutura>('/trabalho/estrutura', token);
      if (rodada !== ciclo.current) return;
      setEstrutura(e);
    } catch (e) {
      if (rodada !== ciclo.current) return;
      if ([403, 404].includes((e as { status?: number }).status ?? 0)) privar();
      else setErro((e as Error).message);
    }
  };

  const criarTarefa = async () => {
    if (!atual || !selecionada || !user || !token || !podeCriar || (atual.arquivadoEm && !pedidoPendente.current) || !listaId || !titulo.trim() || conflito || escrita.current || resultado) return;
    escrita.current = true; setSalvando(true); setErro(null);
    const rodada = ciclo.current;
    const pedido = {
      versionId: selecionada.id, contentHash: selecionada.contentHash, expectedItemVersion: atual.versao,
      listId: listaId, title: titulo.trim(), assigneeUserId: pessoaId || null,
    };
    const chave = `root_contexto_pedido:${user.id}:${notaId}`;
    try {
      const assinatura = JSON.stringify(pedido);
      let requestId: string | undefined;
      try {
        const guardado = JSON.parse(localStorage.getItem(chave) ?? 'null') as { assinatura?: string; requestId?: string } | null;
        if (guardado?.assinatura === assinatura && typeof guardado.requestId === 'string') requestId = guardado.requestId;
      } catch { /* Um pedido antigo ilegível não é reutilizado. */ }
      requestId ??= crypto.randomUUID();
      // O ID deve sobreviver a uma resposta perdida ou a uma nova abertura da fonte.
      localStorage.setItem(chave, JSON.stringify({ assinatura, requestId }));
      const dados: ContextoTarefaCreateInput = pedidoPendente.current ?? { requestId, ...pedido };
      pedidoPendente.current = dados; setPendente(true);
      localStorage.setItem(chave, JSON.stringify({ assinatura, requestId: dados.requestId, pedido: dados }));
      const r = await apiPost<ResultadoDeTarefa>(`/memoria/${encodeURIComponent(notaId)}/tarefas`, dados, token);
      if (rodada !== ciclo.current || identidade.current !== token) return;
      setResultado(r); setPendente(false); pedidoPendente.current = null; localStorage.removeItem(chave);
    } catch (e) {
      if (rodada !== ciclo.current || identidade.current !== token) return;
      const status = (e as { status?: number }).status;
      if (status === 403 || status === 404) privar();
      else if (status === 409) {
        setConflito(true);
        setErro('A fonte ou o pedido mudou. A tarefa não foi confirmada. Recarregue a fonte e confira a versão antes de tentar novamente.');
      } else setErro((e as Error).message);
    } finally {
      escrita.current = false;
      if (rodada === ciclo.current) setSalvando(false);
    }
  };

  if (carregando) return <p className="text-sm text-muted">Carregando fonte…</p>;
  if (!atual) return <p role="alert" className="text-sm text-muted">{erro ?? 'Fonte não disponível.'}</p>;
  return <div className="space-y-3">
    <h3 className="text-sm font-semibold">{selecionada?.title ?? atual.title}</h3>
    {erro && <div role="alert" className="space-y-2 rounded-root border border-warn/40 p-2 text-sm"><p>{erro}</p>{conflito && <button type="button" className="underline" onClick={async () => { if (await carregar()) { pedidoPendente.current = null; setPendente(false); localStorage.removeItem(`root_contexto_pedido:${user?.id}:${notaId}`); } }}>Recarregar fonte</button>}</div>}
    <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
      <dt className="text-dim">natureza</dt><dd>{rotuloDaNatureza(selecionada?.kind ?? atual.kind)}</dd>
      <dt className="text-dim">procedência</dt><dd className="break-words">{selecionada?.procedencia ?? atual.procedencia}</dd>
      <dt className="text-dim">chave</dt><dd className="break-words">{atual.chave}</dd>
      <dt className="text-dim">versão selecionada</dt><dd>{selecionada ? `v${selecionada.versao}` : 'Versão indisponível'}</dd>
      <dt className="text-dim">versão atual</dt><dd>v{atual.versao}{atual.arquivadoEm ? ' · fonte arquivada' : ''}</dd>
      <dt className="text-dim">atualizada na memória</dt><dd>{quando(atual.atualizadoEm)}</dd>
      {selecionada && <><dt className="text-dim">versão registrada</dt><dd>{quando(selecionada.criadoEm)}</dd></>}
      <dt className="text-dim">validade atual</dt><dd>{atual.validFrom || atual.validUntil ? `${dia(atual.validFrom)} → ${atual.validUntil ? dia(atual.validUntil) : 'sem fim'}` : 'sem prazo declarado'}</dd>
      <dt className="text-dim">busca semântica</dt><dd>{atual.temVetor ? 'indexada' : 'só por palavra'}</dd>
    </dl>
    {historica && <p className="rounded-root bg-surface-2 p-2 text-xs text-muted">Você está lendo a versão v{selecionada!.versao}. A memória já está na v{atual.versao}.</p>}
    {corpo !== undefined && corpo !== null ? <pre className="whitespace-pre-wrap break-words rounded-root bg-surface-2 p-3 font-os-sans text-[13px] leading-relaxed text-muted">{corpo}</pre> : <p role="alert" className="text-sm text-muted">A versão do vínculo não está disponível. O conteúdo atual não substitui essa versão.</p>}
    {!formulario && podeCriar && (selecionada || recuperavel) && (!atual.arquivadoEm || recuperavel) && <button type="button" className="rounded-root border border-border px-3 py-2 text-sm text-brand" onClick={() => void abrirFormulario()}>{atual.arquivadoEm ? 'Conferir pedido anterior' : 'Criar tarefa usando esta versão'}</button>}
    {formulario && <form aria-label="Criar tarefa com fonte" className="space-y-2 rounded-root border border-border p-3" onSubmit={(e) => { e.preventDefault(); void criarTarefa(); }}>
      <p className="text-sm font-medium">Criar tarefa com a versão v{selecionada?.versao}</p>
      {pendente && !resultado && <p className="text-xs text-muted">O pedido anterior ainda precisa de confirmação. Confira a criação com os mesmos dados antes de iniciar outra tarefa.</p>}
      <label className="block text-xs">Título da nova tarefa<input className={INP} maxLength={300} value={titulo} disabled={salvando || pendente || !!resultado} onChange={(e) => setTitulo(e.target.value)} /></label>
      <label className="block text-xs">Lista de destino<select className={INP} value={listaId} disabled={salvando || pendente || !!resultado} onChange={(e) => setListaId(e.target.value)}><option value="">Escolha a lista</option>{listas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      <label className="block text-xs">Responsável pela nova tarefa<select className={INP} value={pessoaId} disabled={salvando || pendente || !!resultado} onChange={(e) => setPessoaId(e.target.value)}><option value="">Sem vínculo de pessoa</option>{estrutura?.pessoas?.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.email})</option>)}</select></label>
      {!resultado && <button type="submit" disabled={salvando || conflito || (atual.arquivadoEm && !pedidoPendente.current) || !selecionada || !listaId || !titulo.trim()} className="rounded-root border border-border px-3 py-2 text-sm text-brand disabled:opacity-60">{salvando ? 'Criando…' : pendente ? 'Conferir criação' : 'Criar tarefa'}</button>}
      {resultado && <p role="status" className="text-sm">{resultado.replayed ? 'A tarefa deste pedido já estava criada.' : 'Tarefa criada com a versão selecionada.'} <a className="underline text-brand" href={`/trabalho?lista=${encodeURIComponent(resultado.listId)}&tarefa=${encodeURIComponent(resultado.taskId)}`}>Abrir tarefa criada</a></p>}
    </form>}
    <section aria-label="Histórico da fonte" className="space-y-2"><h4 className="text-xs text-dim">histórico</h4>
      {!versoes?.length ? <p className="text-xs text-muted">Sem versões registradas.</p> : <ol className="space-y-2">{versoes.map((v) => <li key={v.id} className="border-l border-border pl-2 text-xs">
        <button type="button" disabled={salvando || pendente || !!resultado} aria-pressed={selecionada?.id === v.id} className="text-left text-brand underline disabled:opacity-60" onClick={() => { setSelecionadaId(v.id); if (!conflito) setErro(null); }}>Abrir versão v{v.versao}</button>
        <p>v{v.versao} · {v.mudanca} · {quando(v.criadoEm)}</p><p>{v.motivo ?? 'sem motivo declarado'} · por {v.autorTipo}</p>
        <p className="text-dim">{v.eventoSeq ? `evento #${v.eventoSeq} no rastro` : v.semEventoPorque === 'migracao' ? 'sem evento: veio da migração do acervo' : v.semEventoPorque === 'falha_ao_registrar' ? 'sem evento: o registro no rastro falhou' : 'sem elo com o rastro'}</p>
      </li>)}</ol>}
    </section>
  </div>;
}
