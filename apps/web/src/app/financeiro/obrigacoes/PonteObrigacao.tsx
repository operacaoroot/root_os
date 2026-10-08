'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PonteDecisaoPedidoSchema } from '@mktos/shared';
import { useAuth } from '@/lib/auth';
import { usePedidoPonte } from '@/app/leads/pedido-ponte';
type Props = { token: string; userId: string; transactionId: string };
const BUTTON='min-h-11 cursor-pointer rounded border border-border px-3 py-2 disabled:cursor-default disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand';
const dia=(iso:string)=>new Date(iso).toLocaleDateString('pt-BR',{timeZone:'UTC'});
export function PonteObrigacao(props: Props) {
  return <Detalhe key={props.userId+':'+props.token+':'+props.transactionId} {...props}/>;
}
function Detalhe({token,userId,transactionId}:Props) {
  const {can}=useAuth();
  const path='/finance/exercicio/comercial/obrigacoes/'+encodeURIComponent(transactionId);
  const p=usePedidoPonte({token,userId,entityId:transactionId,path,recoveryPath:path+'/pedidos',actions:['decisao'],alvo:{transactionId}});
  const [motivo,setMotivo]=useState(''), [conferido,setConferido]=useState(false);
  useEffect(()=>{if(p.blocked){setMotivo('');setConferido(false);}},[p.blocked]);
  const o=p.data?.obrigacao, c=o?.snapshot.condicoes;
  const blocked=p.busy||p.blocked||!!p.pending||!o?.canDecide||!p.data?.capacidades.podeDecidir||o.approvalStatus!=='aguardando';
  async function decidir(aprovar:boolean) {
    if (!o || !conferido || blocked || !motivo.trim()) return;
    const texto=motivo.trim();
    await p.enviar('decisao',path+'/decisoes',{versionId:o.versionId,contentHash:o.contentHash,expectedUpdatedAt:o.expectedUpdatedAt,aprovar,motivo:texto},v=>PonteDecisaoPedidoSchema.parse(v),r=>{
      const resultado=r.obrigacao;
      return resultado?.versionId===o.versionId && resultado.contentHash===o.contentHash && resultado.decisao?.atorId===userId
        && resultado.decisao.aprovar===aprovar && resultado.decisao.motivo===texto;
    });
    setConferido(false);
  }
  return <div className="mx-auto max-w-4xl space-y-5">
    <h1 className="text-xl font-semibold">Obrigação comercial do exercício</h1><Link className="text-brand underline" href="/financeiro">Voltar ao Financeiro</Link>
    {p.error&&<p role="alert" className="rounded-lg border border-bad/30 p-3 text-bad">{p.error}</p>}{p.notice&&<p role="status" className="text-good">{p.notice}</p>}
    {!p.data&&!p.error&&<p role="status">Carregando obrigação comercial…</p>}
    {p.pending&&<section aria-label="Pedido comercial a conferir" className="space-y-2 rounded-lg border border-warn/40 p-4"><p>Resultado ainda não confirmado. A decisão fica bloqueada até conferir este pedido.</p><p className="break-all text-xs">Pedido {p.pending.requestId}</p><button type="button" className={BUTTON} disabled={p.busy||p.blocked} onClick={()=>void p.recuperarPedido()}>Conferir pedido da decisão</button></section>}
    {o&&c&&<>
      <section aria-label="Condições comerciais preservadas" className="space-y-3 rounded-xl border border-border p-4">
        <h2 className="font-semibold">{c.descricao}</h2><p className="text-xl font-semibold">{c.valorCanonico}</p><p>{c.currency} · a receber · previsto · {o.approvalStatus}</p>
        <p>Origem preservada: proposta v{o.snapshot.origem.propostaVersao} e aceite de exercício.</p>
        {can('leads.ver')&&<Link className="text-brand underline" href={'/leads/'+encodeURIComponent(o.snapshot.origem.leadId)}>Voltar à origem comercial</Link>}
        {p.data?.projeto&&<Link className="block text-brand underline" href={'/trabalho?lista='+encodeURIComponent(p.data.projeto.atual.listId)+'&tarefa='+encodeURIComponent(o.snapshot.taskId)}>Abrir tarefa do projeto</Link>}
        <dl className="grid gap-3 sm:grid-cols-2"><div><dt className="text-muted">Competência</dt><dd>{dia(c.competencia)}</dd></div><div><dt className="text-muted">Vencimento</dt><dd>{dia(c.vencimento)}</dd></div>
          <div><dt className="text-muted">Conta preservada</dt><dd className="break-all">{c.accountId}</dd></div><div><dt className="text-muted">Contraparte preservada</dt><dd className="break-all">{c.partnerId}</dd></div><div><dt className="text-muted">Classificação preservada</dt><dd className="break-all">{c.chartAccountId}</dd></div>
          <div><dt className="text-muted">Projeto financeiro / departamento</dt><dd className="break-all">{c.projetoFinanceiroId??'Sem projeto financeiro'} / {c.departamentoId??'Sem departamento'} · sem rateio</dd></div></dl>
        <details><summary className="cursor-pointer">Conferir identificação da versão</summary><p className="break-all">Versão {o.versionId} · conteúdo {o.contentHash}</p><p className="break-all">Projeto operacional {o.snapshot.projectId} · tarefa {o.snapshot.taskId}</p><p className="break-all">Documento {o.snapshot.origem.documentoHash} · condições comerciais {o.snapshot.origem.condicoesHash}</p></details>
      </section>
      <section aria-label="Decisão comercial" className="space-y-3 rounded-xl border border-border p-4"><h2 className="font-semibold">Decisão sobre as condições apresentadas</h2><p>Alçada exigida: responsável. O servidor confere a alçada atual ao registrar.</p>
        {o.impedimento&&<p role="status">{o.impedimento}</p>}
        <label className="flex gap-2"><input type="checkbox" disabled={blocked} checked={conferido} onChange={e=>setConferido(e.target.checked)}/>Conferi a origem, o valor, a moeda e as condições comerciais.</label>
        <label className="block">Motivo da decisão comercial<textarea aria-label="Motivo da decisão comercial" rows={3} maxLength={2000} disabled={blocked} value={motivo} onChange={e=>setMotivo(e.target.value)} className="mt-1 block w-full rounded border border-border bg-surface p-2 focus:outline-none focus:ring-2 focus:ring-brand"/></label>
        <div className="flex flex-wrap gap-3"><button type="button" className={BUTTON+' bg-brand text-ink'} disabled={blocked||!conferido||!motivo.trim()} onClick={()=>void decidir(true)}>Aprovar condições comerciais</button><button type="button" className={BUTTON+' text-bad'} disabled={blocked||!conferido||!motivo.trim()} onClick={()=>void decidir(false)}>Rejeitar condições comerciais</button></div>
        <p className="text-sm text-muted">A decisão altera a aprovação do registro previsto. Pagamento, cobrança e conciliação ficam sem execução.</p>
      </section>
      {o.decisao&&<section aria-label="Decisão comercial registrada" className="space-y-2 rounded-lg border border-good/30 p-4"><h2 className="font-semibold">{o.decisao.aprovar?'Condições aprovadas':'Condições rejeitadas'}</h2><p>{o.decisao.motivo}</p><p className="text-xs">Alçada verificada: {o.decisao.alcada} · {new Date(o.decisao.decididaEm).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}</p><p className="break-all text-xs">Decisão {o.decisao.id} · pessoa {o.decisao.atorId}</p></section>}
    </>}
  </div>;
}
