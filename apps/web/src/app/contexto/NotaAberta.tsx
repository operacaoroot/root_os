'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TrabEstrutura, ContextoTarefaCreateInput, ContextoTarefaCreateResponse, M05EscopoDto, M05FonteAutorizadaDto } from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dia, quando, rotuloDaNatureza, type NotaDeContexto, type VersaoDeNota } from './tipos';
import { RetratoDaFonte, RecuperacaoIndisponivel, escopoConfere, retratoConfere, chaveDoPedido, lerIdentificador, guardarIdentificador, removerIdentificador, migrarPedidoLegado, type IdentificadorDePedido } from './RetratoDaFonte';

const INP = 'mt-1 w-full rounded-root border border-border bg-surface-2 px-2 py-2 text-sm text-text disabled:opacity-60';
type Nota = NotaDeContexto & { escopo: M05EscopoDto; retratoFonte: M05FonteAutorizadaDto };
type Versao = VersaoDeNota & { escopo: M05EscopoDto; retratoFonte: M05FonteAutorizadaDto };
const recusada = (e: unknown) => [401, 403, 404].includes((e as { status?: number }).status ?? 0);

export function NotaAberta({ notaId, versaoInicial, onIndisponivel }: { notaId: string; versaoInicial?: string | null; onIndisponivel?: () => void }) {
  const { token, ready, can, user } = useAuth();
  if (!ready) return <p className="text-sm text-muted">Carregando fonte…</p>;
  if (!token || !user || !can('obsidian.ver')) return <p className="text-sm text-muted">Fonte não disponível para esta conta.</p>;
  return <NotaAutorizada key={`${token}:${user.id}:${notaId}:${versaoInicial ?? ''}`} notaId={notaId} versaoInicial={versaoInicial} onIndisponivel={onIndisponivel} />;
}

function NotaAutorizada({ notaId, versaoInicial, onIndisponivel }: { notaId: string; versaoInicial?: string | null; onIndisponivel?: () => void }) {
  const { token, user, can } = useAuth();
  const pessoaAtual = user?.id ?? '';
  const [atual, setAtual] = useState<Nota | null>(null), [versoes, setVersoes] = useState<Versao[] | null>(null);
  const [selecionadaId, setSelecionadaId] = useState<string | null>(versaoInicial ?? null);
  const [erro, setErro] = useState<string | null>(null), [conflito, setConflito] = useState(false), [carregando, setCarregando] = useState(true);
  const [formulario, setFormulario] = useState(false), [estrutura, setEstrutura] = useState<TrabEstrutura | null>(null);
  const [listaId, setListaId] = useState(''), [titulo, setTitulo] = useState(''), [pessoaId, setPessoaId] = useState('');
  const [salvando, setSalvando] = useState(false), [resultado, setResultado] = useState<ContextoTarefaCreateResponse | null>(null);
  const [pendente, setPendente] = useState<IdentificadorDePedido | null>(null);
  const input = useRef<ContextoTarefaCreateInput | null>(null), escopo = useRef<M05EscopoDto | null>(null), ciclo = useRef(0), escrita = useRef(false);
  const indisponivelAtual = useRef(onIndisponivel); indisponivelAtual.current = onIndisponivel;
  const podeCriar = can('tarefas.ver') && can('tarefas.editar');
  const privar = useCallback(() => {
    ++ciclo.current; escrita.current = false; input.current = null;
    setAtual(null); setVersoes(null); setEstrutura(null); setFormulario(false); setResultado(null);
    setTitulo(''); setListaId(''); setPessoaId(''); setSalvando(false); setCarregando(false); setConflito(false);
    setErro('Fonte não disponível para esta conta.'); indisponivelAtual.current?.();
  }, []);
  const aceitar = useCallback((r: ContextoTarefaCreateResponse, original?: ContextoTarefaCreateInput | null) => {
    if (!user || !escopoConfere(r.escopo, user.id, escopo.current) || !r.taskId || !r.listId || !r.fonte || r.fonte.itemId !== notaId
      || !retratoConfere(r.fonte.retratoFonte, { ...r.fonte, itemId: notaId })
      || (original && (r.fonte.versionId !== original.versionId || r.fonte.contentHash !== original.contentHash))) { privar(); return false; }
    setResultado(r); input.current = null; setConflito(false); setErro(null);
    const chave = chaveDoPedido(r.escopo, 'tarefa', notaId); removerIdentificador(chave);
    setPendente(lerIdentificador(chave, r.escopo, 'tarefa', notaId)); return true;
  }, [notaId, pessoaAtual, privar]);
  const conferir = useCallback(async (id: IdentificadorDePedido, rodada: number) => {
    setSalvando(true); setErro(null);
    try {
      const r = await apiGet<ContextoTarefaCreateResponse>(`/memoria/${encodeURIComponent(notaId)}/tarefas/pedidos/${encodeURIComponent(id.requestId)}`, token);
      if (rodada !== ciclo.current) return;
      aceitar(r, input.current);
    } catch (e) {
      if (rodada !== ciclo.current) return;
      if (recusada(e) || e instanceof RecuperacaoIndisponivel) { privar(); setPendente(id); if (e instanceof RecuperacaoIndisponivel) setErro(e.message); }
      else setErro((e as Error).message);
    } finally { if (rodada === ciclo.current) setSalvando(false); }
  }, [notaId, token, aceitar, privar]);
  const carregar = useCallback(async () => {
    const rodada = ++ciclo.current; escrita.current = false;
    setAtual(null); setVersoes(null); setCarregando(true); setErro(null);
    try {
      const [nota, historico] = await Promise.all([
        apiGet<Nota>(`/memoria/${encodeURIComponent(notaId)}`, token), apiGet<Versao[]>(`/memoria/${encodeURIComponent(notaId)}/versoes`, token),
      ]);
      if (rodada !== ciclo.current) return false;
      if (!user || nota.id !== notaId || !escopoConfere(nota.escopo, user.id, escopo.current) || !retratoConfere(nota.retratoFonte, { itemId: notaId, chave: nota.chave, versao: nota.versao, contentHash: nota.contentHash, title: nota.title, body: nota.body })
        || !Array.isArray(historico) || historico.some((v) => !escopoConfere(v.escopo, user.id, nota.escopo) || !retratoConfere(v.retratoFonte, { itemId: notaId, versionId: v.id, versao: v.versao, contentHash: v.contentHash, title: v.title, body: v.body }))) { privar(); return false; }
      escopo.current = nota.escopo; setAtual(nota); setVersoes(historico);
      const migrado = migrarPedidoLegado(`root_contexto_pedido:${user.id}:${notaId}`, chaveDoPedido(nota.escopo, 'tarefa', notaId), nota.escopo, 'tarefa', notaId);
      const id = lerIdentificador(chaveDoPedido(nota.escopo, 'tarefa', notaId), nota.escopo, 'tarefa', notaId) ?? migrado;
      if (id) { setPendente(id); await conferir(id, rodada); }
      return true;
    } catch (e) {
      if (rodada !== ciclo.current) return false;
      if (recusada(e) || e instanceof RecuperacaoIndisponivel) { privar(); if (e instanceof RecuperacaoIndisponivel) setErro(e.message); } else setErro((e as Error).message);
      return false;
    } finally { if (rodada === ciclo.current) setCarregando(false); }
  }, [notaId, token, pessoaAtual, conferir, privar]);
  useEffect(() => { void carregar(); return () => { ++ciclo.current; }; }, [carregar]);
  const selecionada = versoes?.find((v) => selecionadaId ? v.id === selecionadaId : v.versao === atual?.versao) ?? null;
  const historica = !!selecionada && selecionada.versao !== atual?.versao;
  const listas = useMemo(() => estrutura ? [...estrutura.folders.flatMap((f) => f.lists), ...estrutura.listasSoltas] : [], [estrutura]);
  const abrirFormulario = async () => {
    if (!podeCriar || !atual || !selecionada || atual.arquivadoEm || pendente || resultado || !selecionada.retratoFonte.acesso.novoUsoPermitido) return;
    setFormulario(true); setErro(null); const rodada = ciclo.current;
    try { const e = await apiGet<TrabEstrutura>('/trabalho/estrutura', token); if (rodada === ciclo.current) setEstrutura(e); }
    catch (e) { if (rodada !== ciclo.current) return; if (recusada(e) || e instanceof RecuperacaoIndisponivel) { privar(); if (e instanceof RecuperacaoIndisponivel) setErro(e.message); } else setErro((e as Error).message); }
  };
  const criarTarefa = async (repetir = false) => {
    if (!user || !token || !escopo.current || !podeCriar || escrita.current || resultado || conflito) return;
    if (!repetir && (!atual || !selecionada || atual.arquivadoEm || !listaId || !titulo.trim() || pendente)) return;
    const dados = repetir ? input.current : { requestId: crypto.randomUUID(), versionId: selecionada!.id, contentHash: selecionada!.contentHash, expectedItemVersion: atual!.versao, listId: listaId, title: titulo.trim(), assigneeUserId: pessoaId || null };
    if (!dados) return;
    const id: IdentificadorDePedido = { ...escopo.current, requestId: dados.requestId, operation: 'tarefa', itemId: notaId };
    if (!guardarIdentificador(chaveDoPedido(escopo.current, 'tarefa', notaId), id)) { setErro('Não foi possível guardar o identificador. O pedido não foi enviado.'); return; }
    input.current = dados; setPendente(id); escrita.current = true; setSalvando(true); setErro(null); const rodada = ciclo.current;
    try { const r = await apiPost<ContextoTarefaCreateResponse>(`/memoria/${encodeURIComponent(notaId)}/tarefas`, dados, token); if (rodada === ciclo.current) aceitar(r, dados); }
    catch (e) {
      if (rodada !== ciclo.current) return;
      if (recusada(e) || e instanceof RecuperacaoIndisponivel) { privar(); if (e instanceof RecuperacaoIndisponivel) setErro(e.message); } else { setErro((e as Error).message); if ((e as { status?: number }).status === 409) setConflito(true); }
    } finally { if (rodada === ciclo.current) { escrita.current = false; setSalvando(false); } }
  };
  const confirmacao = pendente && <div className="space-y-2 rounded-root border border-border p-3">
    <p role="status" className="text-sm">Pedido sem confirmação. Confira o pedido original antes de iniciar outra tarefa.</p>
    <button type="button" disabled={salvando} className="text-brand underline" onClick={() => void conferir(pendente, ciclo.current)}>Conferir criação</button>
    {input.current && !conflito && <button type="button" disabled={salvando} className="ml-3 text-brand underline" onClick={() => void criarTarefa(true)}>Reenviar mesmo pedido</button>}
  </div>;
  const entrega = resultado && <p role="status" className="text-sm">{resultado.replayed ? 'A tarefa deste pedido já estava criada.' : 'Tarefa criada com a versão selecionada.'} <a className="underline text-brand" href={`/trabalho?lista=${encodeURIComponent(resultado.listId)}&tarefa=${encodeURIComponent(resultado.taskId)}`}>Abrir tarefa criada</a></p>;
  if (carregando) return <p className="text-sm text-muted">Carregando fonte…</p>;
  if (!atual) return <div className="space-y-3">{erro && <p role="alert" className="text-sm text-muted">{erro}</p>}{confirmacao}{entrega}</div>;
  return <div className="space-y-3">
    <h3 className="text-sm font-semibold">{selecionada?.title ?? atual.title}</h3>
    {erro && <div role="alert" className="space-y-2 rounded-root border border-warn/40 p-2 text-sm"><p>{erro}</p>{conflito && <button type="button" className="underline" onClick={() => void carregar()}>Recarregar fonte</button>}</div>}
    {confirmacao}{entrega}
    {selecionada && <RetratoDaFonte fonte={selecionada.retratoFonte} />}
    <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
      <dt className="text-dim">natureza</dt><dd>{rotuloDaNatureza(selecionada?.kind ?? atual.kind)}</dd>
      <dt className="text-dim">procedência</dt><dd className="break-words">{selecionada?.procedencia ?? atual.procedencia}</dd>
      <dt className="text-dim">validade atual</dt><dd>{atual.validFrom || atual.validUntil ? `${dia(atual.validFrom)} → ${atual.validUntil ? dia(atual.validUntil) : 'sem fim'}` : 'sem prazo declarado'}</dd>
      <dt className="text-dim">busca semântica</dt><dd>{atual.temVetor ? 'com vetor' : 'só por palavra'}</dd>
    </dl>
    {historica && <p className="rounded-root bg-surface-2 p-2 text-xs text-muted">Você está lendo a versão v{selecionada!.versao}. A memória já está na v{atual.versao}.</p>}
    {selecionada ? <pre className="whitespace-pre-wrap break-words rounded-root bg-surface-2 p-3 font-os-sans text-[13px] leading-relaxed text-muted">{selecionada.body}</pre> : <p role="alert" className="text-sm text-muted">A versão do vínculo não está disponível. O conteúdo atual não substitui essa versão.</p>}
    {!formulario && podeCriar && selecionada && !atual.arquivadoEm && !pendente && !resultado && selecionada.retratoFonte.acesso.novoUsoPermitido && <button type="button" className="rounded-root border border-border px-3 py-2 text-sm text-brand" onClick={() => void abrirFormulario()}>Criar tarefa usando esta versão</button>}
    {formulario && <form aria-label="Criar tarefa com fonte" className="space-y-2 rounded-root border border-border p-3" onSubmit={(e) => { e.preventDefault(); void criarTarefa(); }}>
      <p className="text-sm font-medium">Criar tarefa com a versão v{selecionada?.versao}</p>
      <label className="block text-xs">Título da nova tarefa<input className={INP} maxLength={300} value={titulo} disabled={salvando || !!pendente || !!resultado} onChange={(e) => setTitulo(e.target.value)} /></label>
      <label className="block text-xs">Lista de destino<select className={INP} value={listaId} disabled={salvando || !!pendente || !!resultado} onChange={(e) => setListaId(e.target.value)}><option value="">Escolha a lista</option>{listas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      <label className="block text-xs">Responsável pela nova tarefa<select className={INP} value={pessoaId} disabled={salvando || !!pendente || !!resultado} onChange={(e) => setPessoaId(e.target.value)}><option value="">Sem vínculo de pessoa</option>{estrutura?.pessoas?.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.email})</option>)}</select></label>
      {!resultado && !pendente && <button type="submit" disabled={salvando || conflito || !selecionada || !listaId || !titulo.trim()} className="rounded-root border border-border px-3 py-2 text-sm text-brand disabled:opacity-60">{salvando ? 'Criando…' : 'Criar tarefa'}</button>}
    </form>}
    <section aria-label="Histórico da fonte" className="space-y-2"><h4 className="text-xs text-dim">histórico</h4>
      {!versoes?.length ? <p className="text-xs text-muted">Sem versões registradas.</p> : <ol className="space-y-2">{versoes.map((v) => <li key={v.id} className="border-l border-border pl-2 text-xs">
        <button type="button" disabled={salvando || !!pendente || !!resultado} aria-pressed={selecionada?.id === v.id} className="text-left text-brand underline disabled:opacity-60" onClick={() => setSelecionadaId(v.id)}>Abrir versão v{v.versao}</button>
        <p>v{v.versao} · {v.mudanca} · {quando(v.criadoEm)}</p><p>{v.motivo ?? 'sem motivo declarado'} · por {v.autorTipo}</p>
        <p className="text-dim">{v.eventoSeq ? `evento #${v.eventoSeq} no rastro` : v.semEventoPorque === 'migracao' ? 'sem evento: veio da migração do acervo' : v.semEventoPorque === 'falha_ao_registrar' ? 'sem evento: o registro no rastro falhou' : 'sem elo com o rastro'}</p>
      </li>)}</ol>}
    </section>
  </div>;
}
