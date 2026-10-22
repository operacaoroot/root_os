'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ComercialAceiteExercicioSchema, ComercialAcompanhamentoExercicioSchema, ComercialEntregaExercicioSchema,
  ComercialPropostaExercicioSchema, type ComercialExercicioLeitura, type ComercialExercicioResposta, type TrabEstrutura, listasComAsDoComercial } from '@mktos/shared';
import { apiGet,apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { pedidoDeExercicio } from './pedido-exercicio';
import { PonteComercial } from './PonteComercial';
const INP = 'mt-1 block w-full rounded-lg border border-border bg-surface-2 p-2 text-sm';
const BTN = 'rounded-lg bg-brand px-3 py-2 text-sm text-ink disabled:opacity-50';
export function ComercialExercicio({ leadId,onChanged,onIndisponivel }: { leadId: string; onChanged: () => void; onIndisponivel: () => void }) {
  const { token,user,can } = useAuth();
  const [dados,setDados] = useState<ComercialExercicioLeitura | null>(null), [erro,setErro] = useState<string | null>(null), [aviso,setAviso] = useState<string | null>(null), [busy,setBusy] = useState(false);
  const [estrutura,setEstrutura] = useState<TrabEstrutura | null>(null), [selecionada,setSelecionada] = useState<number | null>(null);
  const [titulo,setTitulo] = useState(''), [corpo,setCorpo] = useState(''), [valor,setValor] = useState(''), [inicio,setInicio] = useState(''), [prazo,setPrazo] = useState(''), [periodicidade,setPeriodicidade] = useState('');
  const [evidencia,setEvidencia] = useState(''), [confirmado,setConfirmado] = useState(false), [listaId,setListaId] = useState(''), [entregaTitulo,setEntregaTitulo] = useState(''), [pessoaId,setPessoaId] = useState('');
  const [status,setStatus] = useState('novo'), [nextAction,setNextAction] = useState('');
  const ciclo = useRef(0), perdido = useRef(onIndisponivel), mudado = useRef(onChanged), escrita = useRef(false);
  perdido.current = onIndisponivel; mudado.current = onChanged;
  const privar = useCallback(() => { setDados(null); setEstrutura(null); setErro('Oportunidade de exercício indisponível para esta conta.'); perdido.current(); },[]);
  const carregar = useCallback(async () => {
    const rodada = ++ciclo.current;
    try {
      const r = await apiGet<ComercialExercicioLeitura>(`/leads/${encodeURIComponent(leadId)}/exercicio`,token);
      if (rodada !== ciclo.current) return null;
      setDados(r); setStatus(r.lead.status); setNextAction(r.lead.nextAction ?? '');
      return r;
    } catch (e) {
      if (rodada !== ciclo.current) return null;
      if ([401,403,404].includes((e as {status?: number}).status ?? 0)) privar(); else setErro((e as Error).message);
      return null;
    }
  },[leadId,token,privar]);
  useEffect(() => { setDados(null); setEstrutura(null); setErro(null); setSelecionada(null); void carregar(); return () => { ++ciclo.current; }; },[carregar]);
  const enviar = async (acao: string, payload: Record<string,unknown>, parse: (v: unknown) => unknown, mensagem: string) => {
    if (!token || !user || escrita.current) return;
    escrita.current = true; setBusy(true); setErro(null); setAviso(null);
    const rodada = ciclo.current;
    try {
      const requestId = await pedidoDeExercicio(`root_comercial_pedido:${user.id}:${leadId}:${acao}`,payload);
      const p = parse({ ...payload,requestId });
      const r = await apiPost<ComercialExercicioResposta>(`/leads/${leadId}/exercicio/${acao}`,p,token);
      if (rodada !== ciclo.current) return;
      setAviso(r.replayed ? 'Pedido já confirmado. Nenhum efeito duplicado.' : mensagem);
      const d = await carregar(); if (d) { setSelecionada(d.versaoAtual || null); mudado.current(); }
    } catch (e) {
      if (rodada !== ciclo.current) return;
      if ([401,403,404].includes((e as {status?: number}).status ?? 0)) privar();
      else { if ((e as {status?: number}).status === 409) await carregar(); setErro((e as Error).message); }
    } finally { escrita.current = false; setBusy(false); }
  };
  const abrirListas = async () => {
    const rodada = ciclo.current;
    try { const e = await apiGet<TrabEstrutura>('/trabalho/estrutura',token); if (rodada === ciclo.current) setEstrutura(e); }
    catch (e) { if (rodada !== ciclo.current) return; if ([401,403,404].includes((e as {status?: number}).status ?? 0)) privar(); else setErro((e as Error).message); }
  };
  // A entrega do comercial pode ir para as listas do Comercial (a pasta Clientes, I3), como antes.
  const listas = useMemo(() => estrutura ? listasComAsDoComercial(estrutura) : [],[estrutura]);
  if (!dados) return <p className="text-sm text-muted">{erro ?? 'Carregando exercício Comercial…'}</p>;
  const proposta = dados.propostas.find((p) => p.versao === (selecionada ?? dados.versaoAtual)) ?? null;
  const atual = proposta?.versao === dados.versaoAtual;
  const aceite = dados.aceites.find((a) => a.propostaId === proposta?.id);
  const entrega = dados.entregas.find((d) => d.aceiteId === aceite?.id);
  const ponteDisponivel = !!proposta && !!aceite && can('leads.ver') && can('tarefas.ver');
  return <section className="space-y-5 rounded-xl border border-border bg-surface p-5">
    <div><h2 className="font-medium">Comercial — exercício de QA</h2><p className="text-sm text-muted">Proposta local e aceite de exercício. Não representam aceite de cliente, assinatura ou cobrança.</p>
      <p className="mt-2 text-xs text-muted">Origem manual única: {dados.origem.ref}</p></div>
    {erro && <p role="alert" className="text-sm text-bad">{erro}</p>}{aviso && <p role="status" className="text-sm text-good">{aviso}</p>}
    <button type="button" className="text-sm underline" disabled={busy} onClick={() => void carregar()}>Reabrir exercício</button>
    {can('leads.editar') && <fieldset className="space-y-3 rounded-lg border border-border p-3" disabled={busy}><legend>Qualificação e próxima ação</legend>
      <label className="block text-sm">Etapa do exercício<select aria-label="Etapa do exercício" className={INP} value={status} onChange={(e) => setStatus(e.target.value)}>{['novo','qualificado','oportunidade','reuniao','proposta','ganho','perdido'].map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
      <label className="block text-sm">Próxima ação do exercício<input aria-label="Próxima ação do exercício" className={INP} value={nextAction} onChange={(e) => setNextAction(e.target.value)} /></label>
      <p className="text-xs text-muted">Mudar etapa não registra aceite ou obrigação.</p>
      <button type="button" className={BTN} onClick={() => void enviar('acompanhamento',{ expectedUpdatedAt: dados.lead.updatedAt,status,nextAction: nextAction.trim() || null },(v) => ComercialAcompanhamentoExercicioSchema.parse(v),'Acompanhamento de exercício salvo.')}>Salvar acompanhamento de exercício</button>
    </fieldset>}
    <div className="space-y-3"><h3 className="font-medium">Proposta e versões</h3>
      {dados.propostas.length > 0 ? <><label className="block text-sm">Versão da proposta<select aria-label="Versão da proposta" className={INP} value={proposta?.versao ?? ''} onChange={(e) => setSelecionada(Number(e.target.value))}>{dados.propostas.map((p) => <option key={p.id} value={p.versao}>v{p.versao}{p.versao === dados.versaoAtual ? ' · atual' : ' · histórica'} — {p.documento.titulo}</option>)}</select></label>
      {proposta && <article className="rounded-lg border border-border p-3"><h4>{proposta.documento.titulo} · v{proposta.versao}</h4><p className="mt-2 whitespace-pre-wrap text-sm">{proposta.documento.corpo}</p>
        <dl className="mt-3 grid gap-2 text-sm"><div><dt className="text-muted">Valor comercial</dt><dd>{proposta.condicoes.valorCanonico ?? 'Pendente'}</dd></div><div><dt className="text-muted">Início</dt><dd>{proposta.condicoes.inicio ? new Date(proposta.condicoes.inicio).toLocaleDateString('pt-BR') : 'Pendente'}</dd></div><div><dt className="text-muted">Prazo</dt><dd>{proposta.condicoes.prazo ?? 'Pendente'}</dd></div><div><dt className="text-muted">Periodicidade</dt><dd>{proposta.condicoes.periodicidade ?? 'Pendente'}</dd></div></dl>
        <details className="mt-3 text-xs text-muted"><summary>Conferir versão e registro</summary><p>Documento: {proposta.documento.hash}</p><p>Condições: {proposta.condicoesHash}</p><p>Registro: {proposta.id} · {new Date(proposta.registradaEm).toLocaleString('pt-BR')}</p></details></article>}</> : <p className="text-sm text-muted">Ainda não há proposta de exercício.</p>}
    </div>
    {can('leads.editar') && <fieldset className="space-y-3 rounded-lg border border-border p-3" disabled={busy}><legend>Preparar nova versão de exercício</legend>
      <label className="block text-sm">Título da proposta<input aria-label="Título da proposta" className={INP} value={titulo} onChange={(e) => setTitulo(e.target.value)} /></label>
      <label className="block text-sm">Documento da proposta<textarea aria-label="Documento da proposta" className={INP} rows={5} value={corpo} onChange={(e) => setCorpo(e.target.value)} /></label>
      <label className="block text-sm">Valor comercial canônico<input aria-label="Valor comercial canônico" className={INP} placeholder="BRL 1500.00" value={valor} onChange={(e) => setValor(e.target.value)} /></label>
      <label className="block text-sm">Data de início<input aria-label="Data de início" type="date" className={INP} value={inicio} onChange={(e) => setInicio(e.target.value)} /></label>
      <label className="block text-sm">Prazo comercial<input aria-label="Prazo comercial" className={INP} value={prazo} onChange={(e) => setPrazo(e.target.value)} /></label>
      <label className="block text-sm">Periodicidade comercial<input aria-label="Periodicidade comercial" className={INP} value={periodicidade} onChange={(e) => setPeriodicidade(e.target.value)} /></label>
      <button type="button" className={BTN} disabled={!titulo.trim() || corpo.trim().length < 10} onClick={() => void enviar('propostas',{ expectedPropostaVersion: dados.versaoAtual,documento: { titulo: titulo.trim(),corpo: corpo.trim() },condicoes: { valorCanonico: valor.trim() || null,inicio: inicio ? new Date(inicio+'T12:00:00').toISOString() : null,prazo: prazo.trim() || null,periodicidade: periodicidade.trim() || null } },(v) => ComercialPropostaExercicioSchema.parse(v),'Nova versão da proposta de exercício registrada.')}>Salvar proposta de exercício</button>
    </fieldset>}
    {proposta && <div className="space-y-3"><h3 className="font-medium">Aceite de exercício · v{proposta.versao}</h3>
      {aceite ? <div className="rounded-lg border border-border p-3 text-sm"><p>Aceite de exercício registrado. Alçada verificada: {aceite.alcada.verificada}.</p><p className="mt-2 whitespace-pre-wrap">Evidência de exercício: {aceite.evidencia.texto}</p><p className="text-xs text-muted">{new Date(aceite.registradaEm).toLocaleString('pt-BR')} · pessoa {aceite.atorId}</p></div> : <>
      {!atual && <p className="text-sm text-warn">Esta versão é histórica. Abra a versão atual para registrar um novo aceite de exercício.</p>}
      {!proposta.condicoes.valorCanonico && <p className="text-sm text-warn">O valor comercial está pendente. Prepare outra versão antes do aceite de exercício.</p>}
      {!dados.podeAceitar && <p className="text-sm text-muted">Esta conta não tem a alçada e os acessos necessários ao aceite de exercício.</p>}
      {dados.podeAceitar && atual && <fieldset className="space-y-3" disabled={busy}><label className="block text-sm">Evidência do aceite de exercício<textarea aria-label="Evidência do aceite de exercício" className={INP} value={evidencia} onChange={(e) => setEvidencia(e.target.value)} /></label>
        <label className="flex gap-2 text-sm"><input aria-label="Confirmo que é um exercício" type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />Confirmo que é um exercício, sem aceite real do cliente.</label>
        <button type="button" className={BTN} disabled={!confirmado || evidencia.trim().length < 10 || !proposta.condicoes.valorCanonico} onClick={() => void enviar('aceites',{ propostaId: proposta.id,expectedPropostaVersion: proposta.versao,condicoesHash: proposta.condicoesHash,evidencia: { tipo: 'exercicio',texto: evidencia.trim() },confirmacaoExercicio: true },(v) => ComercialAceiteExercicioSchema.parse(v),'Aceite de exercício registrado.')}>Registrar aceite de exercício</button>
      </fieldset>}</>}
      {entrega ? <div className="rounded-lg border border-border p-3 text-sm"><p>Entrega ligada ao aceite de exercício da proposta v{entrega.propostaVersao}.</p><Link className="text-brand underline" href={`/trabalho?lista=${entrega.listId}&tarefa=${entrega.taskId}`}>Abrir entrega em Trabalho: {entrega.title}</Link></div> : aceite && atual && dados.podeEntregar && !ponteDisponivel && <fieldset className="space-y-3 rounded-lg border border-border p-3" disabled={busy}><legend>Entrega em Trabalho</legend>
        {!estrutura && <button type="button" className="text-sm underline" onClick={() => void abrirListas()}>Escolher destino da entrega</button>}
        {estrutura && <><label className="block text-sm">Lista da entrega<select aria-label="Lista da entrega" className={INP} value={listaId} onChange={(e) => setListaId(e.target.value)}><option value="">Selecione a lista</option>{listas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label className="block text-sm">Título da entrega<input aria-label="Título da entrega" className={INP} value={entregaTitulo} onChange={(e) => setEntregaTitulo(e.target.value)} /></label>
        <label className="block text-sm">Responsável pela entrega<select aria-label="Responsável pela entrega" className={INP} value={pessoaId} onChange={(e) => setPessoaId(e.target.value)}><option value="">Sem responsável vinculado</option>{estrutura.pessoas?.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <button type="button" className={BTN} disabled={!listaId || !entregaTitulo.trim()} onClick={() => void enviar('entrega',{ aceiteId: aceite.id,propostaId: proposta.id,expectedPropostaVersion: proposta.versao,condicoesHash: proposta.condicoesHash,listId: listaId,title: entregaTitulo.trim(),assigneeUserId: pessoaId || null },(v) => ComercialEntregaExercicioSchema.parse(v),'Entrega de exercício aberta em Trabalho.')}>Abrir entrega de exercício</button></>}
      </fieldset>}
    </div>}
    {ponteDisponivel && proposta && aceite && <PonteComercial leadId={leadId} proposta={proposta} aceite={aceite} onIndisponivel={privar} />}
    {!ponteDisponivel && <div className="rounded-lg border border-warn/40 p-3 text-sm"><h3>Pendências financeiras do exercício</h3><ul className="mt-2 list-disc pl-5">{dados.financeiro.pendencias.map((p) => <li key={p}>{p}</li>)}</ul><p className="mt-2 text-muted">O percurso de proposta e aceite não gera obrigação automaticamente. Confira o vínculo na seção do projeto.</p></div>}
  </section>;
}
