'use client';

import { useEffect, useRef, useState } from 'react';
import { formatarValorMonetario, moedaDoValor } from '@mktos/shared';
import { apiGet, apiPost, ErroDaApi } from '@/lib/api';
import type {
  DecisaoFinanceiraQA, ObrigacaoFinanceiraQA, PedidoDecisaoFinanceiraQA,
  RespostaDecisaoFinanceiraQA,
} from './contrato';

type Props = { token: string; userId: string; transactionId: string };
type PedidoPreservado = {
  path: string; orgId: string; payload: PedidoDecisaoFinanceiraQA; recusado: boolean;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const diaContabil = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
const prefixoPedido = (userId: string, transactionId: string) =>
  'rootos.financeiro.exercicio:' + encodeURIComponent(userId) + ':' + encodeURIComponent(transactionId) + ':';
const chavePedido = (userId: string, transactionId: string, orgId: string) =>
  prefixoPedido(userId, transactionId) + encodeURIComponent(orgId);

function pedidoValido(p: PedidoPreservado, path: string, orgId: string): boolean {
  const body = p?.payload;
  return p?.path === path && p.orgId === orgId && typeof p.recusado === 'boolean'
    && !!body && Object.keys(body).sort().join(',') === 'aprovar,contentHash,expectedUpdatedAt,motivo,requestId,versionId'
    && UUID.test(body.requestId) && UUID.test(body.versionId) && HASH.test(body.contentHash)
    && ISO.test(body.expectedUpdatedAt) && Number.isFinite(Date.parse(body.expectedUpdatedAt))
    && typeof body.aprovar === 'boolean' && typeof body.motivo === 'string'
    && body.motivo === body.motivo.trim() && body.motivo.length > 0 && body.motivo.length <= 2000;
}

function detalheConferivel(d: ObrigacaoFinanceiraQA, transactionId: string): boolean {
  const c = d?.condicoes;
  return d?.modo === 'exercicio' && d.fonte === 'financeiro_local_qa'
    && d.transactionId === transactionId && typeof d.orgId === 'string' && d.orgId.trim().length > 0 && UUID.test(d.versionId)
    && HASH.test(d.contentHash) && ISO.test(d.expectedUpdatedAt)
    && d.status === 'previsto' && d.paidAt === null && d.reconciledAt === null
    && ['aguardando', 'aprovado', 'rejeitado'].includes(d.approvalStatus)
    && typeof d.canDecide === 'boolean' && d.alcadaExigida === 'responsavel'
    && !!c && d.origem?.contractId === c.contrato?.id && d.conta?.id === c.conta?.id
    && d.origem.tipo === 'contrato_recorrente_qa' && d.origem.comercial === null
    && d.valorCanonico === c.valorCanonico && d.currency === c.currency
    && moedaDoValor(d.valorCanonico) === d.currency && c.conta.currency === d.currency && d.conta.currency === d.currency
    && moedaDoValor(c.contrato.valorCanonico) === d.currency && d.tipo === c.tipo
    && !!c.contraparte && !!c.classificacao && c.temRateio === false
    && Array.isArray(d.historico);
}

function reciboConferivel(r: RespostaDecisaoFinanceiraQA, p: PedidoPreservado, transactionId: string, userId: string): boolean {
  const d = r?.decisao, efeito = r?.resultado;
  return r?.modo === 'exercicio' && r.orgId === p.orgId && r.transactionId === transactionId
    && r.versionId === p.payload.versionId && r.contentHash === p.payload.contentHash
    && r.decisionId === d?.id && d.versionId === p.payload.versionId && d.contentHash === p.payload.contentHash
    && d.requestId === p.payload.requestId && d.ator?.id === userId
    && d.aprovar === p.payload.aprovar && d.motivo === p.payload.motivo
    && d.alcadaExigida === 'responsavel' && ['responsavel', 'titular'].includes(d.alcadaVerificada)
    && typeof r.replayed === 'boolean' && efeito?.status === 'previsto'
    && efeito.approvalStatus === (p.payload.aprovar ? 'aprovado' : 'rejeitado')
    && efeito.paidAt === null && efeito.reconciledAt === null
    && efeito.pagamentoExecutado === false && efeito.cobrancaExecutada === false && efeito.conciliacaoExecutada === false;
}

// A troca de pessoa/token/objeto desmonta toda a leitura, inclusive rascunhos.
export function ObrigacaoFinanceira(props: Props) {
  return <Detalhe key={props.userId + ':' + props.token + ':' + props.transactionId} {...props} />;
}

function Detalhe({ token, userId, transactionId }: Props) {
  const [data, setData] = useState<ObrigacaoFinanceiraQA | null>(null);
  const [pending, setPending] = useState<PedidoPreservado | null>(null);
  const [receipt, setReceipt] = useState<RespostaDecisaoFinanceiraQA | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState(''), [checked, setChecked] = useState(false);
  const [conferidoAposRecusa, setConferidoAposRecusa] = useState(false);
  const generation = useRef(0), operation = useRef(false);
  const path = '/finance/exercicio/obrigacoes/' + encodeURIComponent(transactionId);

  function retirarConteudo() {
    setData(null); setReceipt(null); setPending(null); setReason(''); setChecked(false);
    setConferidoAposRecusa(false);
    try {
      const prefix = prefixoPedido(userId, transactionId);
      for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key);
    } catch { /* O conteúdo em memória também foi retirado. */ }
  }
  function mostrarErro(e: unknown) {
    setError(e instanceof Error ? e.message : 'Não foi possível conferir a obrigação.');
    if (e instanceof ErroDaApi && [401, 403, 404].includes(e.status)) retirarConteudo();
  }
  async function load(epoch: number) {
    const d = await apiGet<ObrigacaoFinanceiraQA>(path, token);
    if (generation.current !== epoch) return;
    if (!detalheConferivel(d, transactionId)) {
      setData(null); setReceipt(null); setPending(null);
      throw new Error('A resposta não permite conferir as condições desta obrigação.');
    }
    setData(d); setChecked(false); setConferidoAposRecusa(true);
    const key = chavePedido(userId, transactionId, d.orgId);
    try {
      const raw = localStorage.getItem(key);
      const restored = raw ? JSON.parse(raw) as PedidoPreservado : null;
      if (restored && pedidoValido(restored, path + '/decisoes', d.orgId)) {
        setPending(restored); setReason(restored.payload.motivo);
      } else {
        if (raw) localStorage.removeItem(key);
        setPending(null);
      }
    } catch { setPending(null); setError('Não foi possível ler o pedido preservado neste navegador.'); }
  }
  useEffect(() => {
    const epoch = ++generation.current;
    operation.current = true;
    load(epoch).catch((e) => { if (generation.current === epoch) mostrarErro(e); })
      .finally(() => { if (generation.current === epoch) { operation.current = false; setBusy(false); } });
    return () => { generation.current++; };
  }, [token, userId, transactionId]);

  async function conferirEstado() {
    if (operation.current) return;
    const epoch = generation.current;
    operation.current = true; setBusy(true); setError(null);
    try { await load(epoch); }
    catch (e) { if (generation.current === epoch) mostrarErro(e); }
    finally { if (generation.current === epoch) { operation.current = false; setBusy(false); } }
  }
  async function decidir(aprovar: boolean, recuperar = false) {
    if (!data || operation.current || (pending && !recuperar)) return;
    if (!recuperar && (!data.canDecide || data.approvalStatus !== 'aguardando' || !checked || !reason.trim() || reason.trim().length > 2000)) return;
    const p: PedidoPreservado = recuperar && pending ? pending : {
      path: path + '/decisoes', orgId: data.orgId, recusado: false,
      payload: { requestId: crypto.randomUUID(), versionId: data.versionId, contentHash: data.contentHash,
        expectedUpdatedAt: data.expectedUpdatedAt, aprovar, motivo: reason.trim() },
    };
    if (!pedidoValido(p, path + '/decisoes', data.orgId)) { setError('O pedido preservado não pertence a esta obrigação.'); return; }
    const epoch = generation.current, key = chavePedido(userId, transactionId, p.orgId);
    try { localStorage.setItem(key, JSON.stringify(p)); }
    catch { setError('O navegador não conseguiu preservar o pedido. Libere o armazenamento antes de decidir.'); return; }
    operation.current = true; setBusy(true); setPending(p); setError(null); setChecked(false); setConferidoAposRecusa(false);
    try {
      const r = await apiPost<RespostaDecisaoFinanceiraQA>(p.path, p.payload, token);
      if (generation.current !== epoch) return;
      if (!reciboConferivel(r, p, transactionId, userId)) throw new Error('A resposta da decisão não foi confirmada para este pedido.');
      localStorage.removeItem(key); setPending(null); setReceipt(r); setReason('');
      setData({ ...data, approvalStatus: r.resultado.approvalStatus, decisao: r.decisao,
        historico: [r.decisao], canDecide: false, impedimento: 'Esta obrigação já tem decisão registrada.' });
    } catch (e) {
      if (generation.current !== epoch) return;
      mostrarErro(e);
      if (e instanceof ErroDaApi && [400, 409].includes(e.status)) {
        const refused = { ...p, recusado: true };
        setPending(refused);
        try { localStorage.setItem(key, JSON.stringify(refused)); } catch { /* O pedido original já foi preservado. */ }
      }
    } finally { if (generation.current === epoch) { operation.current = false; setBusy(false); } }
  }
  function descartarRecusado() {
    if (!data || !pending?.recusado || !conferidoAposRecusa || operation.current) return;
    localStorage.removeItem(chavePedido(userId, transactionId, data.orgId));
    setPending(null); setReceipt(null); setChecked(false); setError(null); setConferidoAposRecusa(false);
  }
  const blocked = busy || !!pending || !data?.canDecide || data.approvalStatus !== 'aguardando';
  return <div className="mx-auto max-w-4xl space-y-5">
    <h1 className="text-xl font-semibold">Obrigação financeira</h1>
    <a href="/financeiro" className="text-brand underline">Voltar ao Financeiro</a>
    {error && <p role="alert" className="rounded-lg border border-bad/30 p-3 text-bad">{error}</p>}
    <button type="button" disabled={busy} onClick={conferirEstado} className="rounded border border-border px-3 py-2 disabled:opacity-50">Conferir estado atual</button>
    {!data && !error && <p role="status">Carregando obrigação…</p>}
    {data && <>
      <section aria-label="Origem e condições" className="space-y-3 rounded-xl border border-border p-4">
        <h2 className="font-semibold">{data.condicoes.descricao}</h2>
        <p>Dados do exercício financeiro local · consulta em {quando(data.consultadoEm)}</p>
        <p className="text-xl font-semibold">{formatarValorMonetario(data.valorCanonico)} <span className="text-sm">({data.currency})</span></p>
        <p>Valor exato: <code>{data.valorCanonico}</code> · {data.tipo === 'saida' ? 'a pagar' : 'a receber'} · previsto · {data.approvalStatus}</p>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div><dt className="text-muted">Origem</dt><dd>Contrato recorrente: {data.origem.descricao}</dd><dd className="break-all text-xs">Contrato {data.origem.contractId}</dd></div>
          <div><dt className="text-muted">Lançamento previsto</dt><dd className="break-all">{data.transactionId}</dd><dd>Gerado para {diaContabil(data.origem.vencimentoGerado)}</dd></div>
          <div><dt className="text-muted">Competência / vencimento</dt><dd>{diaContabil(data.condicoes.competencia)} / {diaContabil(data.condicoes.vencimento)}</dd></div>
          <div><dt className="text-muted">Conta</dt><dd>{data.condicoes.conta.nome} · {data.condicoes.conta.currency} · manual · {data.condicoes.conta.ativa ? 'ativa' : 'inativa'}</dd></div>
          <div><dt className="text-muted">Contraparte</dt><dd>{data.condicoes.contraparte.razaoSocial} · {data.condicoes.contraparte.ativo ? 'ativa' : 'inativa'}</dd></div>
          <div><dt className="text-muted">Classificação</dt><dd>{data.condicoes.classificacao.codigo} · {data.condicoes.classificacao.nome} · {data.condicoes.classificacao.ativo ? 'ativa' : 'inativa'}</dd></div>
          <div><dt className="text-muted">Projeto financeiro</dt><dd>{data.condicoes.projetoFinanceiro?.nome ?? 'Sem projeto financeiro'}</dd></div>
          <div><dt className="text-muted">Departamento</dt><dd>{data.condicoes.departamento?.nome ?? 'Sem departamento'} · sem rateio</dd></div>
        </dl>
        <p>Contrato {data.condicoes.contrato.status} · {data.condicoes.contrato.periodicidade} · dia {data.condicoes.contrato.diaVencimento} · valor contratual {data.condicoes.contrato.valorCanonico}</p>
        <p>Vigência: {diaContabil(data.condicoes.contrato.dataInicio)} até {data.condicoes.contrato.dataFim ? diaContabil(data.condicoes.contrato.dataFim) : 'sem data de término'}.</p>
        <details><summary className="cursor-pointer">Identificação das condições preservadas</summary><p className="break-all">Versão {data.versionId}</p><p className="break-all">Conteúdo {data.contentHash}</p><p>Registro conferido em {quando(data.expectedUpdatedAt)}</p><p className="break-all">Conta {data.condicoes.conta.id} · contraparte {data.condicoes.contraparte.id} · classificação {data.condicoes.classificacao.id}</p><p className="break-all">Projeto financeiro {data.condicoes.projetoFinanceiro?.id ?? 'ausente'} · departamento {data.condicoes.departamento?.id ?? 'ausente'}</p></details>
      </section>
      {pending && <section aria-label="Pedido a conferir" className="space-y-2 rounded-xl border border-warn/40 p-4">
        <h2 className="font-semibold">{pending.recusado ? 'Pedido recusado pelo servidor' : 'Resultado ainda não confirmado'}</h2>
        <p>Pedido original: {pending.payload.aprovar ? 'aprovar' : 'rejeitar'} · {pending.payload.motivo}</p>
        <p className="break-all text-xs">Versão {pending.payload.versionId} · pedido {pending.payload.requestId}</p>
        <button type="button" disabled={busy} onClick={() => decidir(pending.payload.aprovar, true)} className="rounded border border-border px-3 py-2 disabled:opacity-50">Conferir pedido anterior</button>
        {pending.recusado && <><p>Confira o estado atual antes de descartar este pedido e preparar outra intenção.</p><button type="button" disabled={busy || !conferidoAposRecusa} onClick={descartarRecusado} className="block underline disabled:opacity-50">Descartar pedido recusado</button></>}
      </section>}
      <section aria-label="Decisão financeira" className="space-y-3 rounded-xl border border-border p-4">
        <h2 className="font-semibold">Decisão sobre as condições apresentadas</h2>
        <p>Alçada exigida: {data.alcadaExigida} · sua alçada atual: {data.alcadaAtual ?? 'indisponível'}.</p>
        {data.impedimento && <p role="status">{data.impedimento}</p>}
        <p>A decisão altera a aprovação do registro previsto. Pagamento, cobrança e conciliação permanecem sem execução.</p>
        <label className="flex items-start gap-2"><input type="checkbox" checked={checked} disabled={blocked} onChange={(e) => setChecked(e.target.checked)} />Conferi a origem, o valor, a moeda e as condições desta versão.</label>
        <label className="block">Motivo da decisão<textarea aria-label="Motivo da decisão" rows={3} maxLength={2000} value={reason} disabled={blocked} onChange={(e) => setReason(e.target.value)} className="mt-1 block w-full rounded border border-border bg-surface p-2" /></label>
        <div className="flex flex-wrap gap-3"><button type="button" disabled={blocked || !checked || !reason.trim()} onClick={() => decidir(true)} className="rounded bg-brand px-3 py-2 text-ink disabled:opacity-50">Aprovar condições exatas</button><button type="button" disabled={blocked || !checked || !reason.trim()} onClick={() => decidir(false)} className="rounded border border-border px-3 py-2 text-bad disabled:opacity-50">Rejeitar condições exatas</button></div>
      </section>
      {receipt && <section aria-label="Resultado da decisão" role="status" className="space-y-2 rounded-xl border border-good/30 p-4"><h2 className="font-semibold">{receipt.replayed ? 'Decisão já registrada; pedido conferido.' : 'Decisão registrada.'}</h2><p>Resultado: {receipt.resultado.approvalStatus} · previsto · sem pagamento, cobrança ou conciliação.</p><p className="break-all">Decisão {receipt.decisionId}</p></section>}
      <section aria-label="Histórico da obrigação" className="space-y-2"><h2 className="font-semibold">Histórico da obrigação</h2>{data.historico.length === 0 ? <p>Nenhuma decisão registrada.</p> : data.historico.map((d) => <Decisao key={d.id} data={d} />)}</section>
    </>}
  </div>;
}
function Decisao({ data }: { data: DecisaoFinanceiraQA }) {
  return <article className="space-y-1 rounded border border-border p-3"><p>{data.aprovar ? 'Aprovada' : 'Rejeitada'} por {data.ator.nome} · {quando(data.decididoEm)} · alçada {data.alcadaVerificada}</p><p>{data.motivo}</p><p className="break-all text-xs">Decisão {data.id} · versão {data.versionId}</p></article>;
}
