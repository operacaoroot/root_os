'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { PonteObrigacaoPedidoSchema, PonteProjetoPedidoSchema, type PonteCatalogos, type ComercialPropostaExercicioDto, type ComercialAceiteExercicioDto } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { escopoPonteConfere, usePedidoPonte } from './pedido-ponte';
const INPUT = 'mt-1 block w-full rounded-lg border border-border bg-surface-2 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand';
const BUTTON = 'min-h-11 cursor-pointer rounded-lg bg-brand px-3 py-2 text-sm text-ink disabled:cursor-default disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand';
const OUTLINE = 'min-h-11 cursor-pointer rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand';
type Props = { leadId: string; proposta: ComercialPropostaExercicioDto; aceite: ComercialAceiteExercicioDto; onIndisponivel: () => void };
export function PonteComercial(props: Props) {
  const { token,user,can } = useAuth();
  if (!token || !user || !can('leads.ver') || !can('tarefas.ver')) return null;
  return <Ponte key={user.id+':'+token+':'+props.leadId+':'+props.aceite.id} {...props} token={token} userId={user.id} />;
}
function Ponte({ leadId,proposta,aceite,onIndisponivel,token,userId }: Props & { token: string; userId: string }) {
  const base = '/leads/'+encodeURIComponent(leadId)+'/exercicio';
  const p = usePedidoPonte({token,userId,entityId:leadId,path:base+'/ponte',recoveryPath:base+'/ponte/pedidos',actions:['projeto','obrigacao'],alvo:{leadId},onIndisponivel});
  const [catalogos,setCatalogos] = useState<PonteCatalogos | null>(null), [catalogError,setCatalogError] = useState<string | null>(null);
  const [lista,setLista] = useState(''), [etapa,setEtapa] = useState(''), [titulo,setTitulo] = useState(''), [responsavel,setResponsavel] = useState('');
  const [conta,setConta] = useState(''), [contraparte,setContraparte] = useState(''), [classificacao,setClassificacao] = useState(''), [projetoFinanceiro,setProjetoFinanceiro] = useState(''), [departamento,setDepartamento] = useState('');
  const [descricao,setDescricao] = useState(''), [valor,setValor] = useState(proposta.condicoes.valorCanonico ?? ''), [competencia,setCompetencia] = useState(''), [vencimento,setVencimento] = useState(''), [confirmado,setConfirmado] = useState(false);
  const generation = useRef(0), indisponivel = useRef(onIndisponivel); indisponivel.current=onIndisponivel;
  useEffect(() => {
    const epoch=++generation.current;
    if (!p.data || p.blocked || p.pending) { setCatalogos(null); return; }
    apiGet<PonteCatalogos>(base+'/ponte/catalogos',token).then(c=>{
      if (generation.current!==epoch) return;
      if (c?.modo!=='exercicio' || !escopoPonteConfere(c.escopo,userId,p.data!.escopo) || !Array.isArray(c.listas) || !Array.isArray(c.responsaveis)) throw new Error('Catálogos sem escopo confirmado.');
      setCatalogos(c); setCatalogError(null);
    }).catch(e=>{ if (generation.current!==epoch) return; setCatalogos(null);setCatalogError(e instanceof Error?e.message:'Não foi possível carregar os destinos.');if ([401,403,404].includes((e as {status?:number}).status??0)) indisponivel.current(); });
    return ()=>{generation.current++;};
  },[base,token,userId,p.data,p.blocked,p.pending]);
  const projeto=p.data?.projeto, obrigacao=p.data?.obrigacao;
  const origem=projeto?.origem;
  const origemSelecionada=!origem || origem.aceiteId===aceite.id && origem.propostaId===proposta.id && origem.propostaVersao===proposta.versao && origem.documentoHash===proposta.documento.hash && origem.condicoesHash===proposta.condicoesHash;
  const refs={aceiteId:aceite.id,propostaId:proposta.id,expectedPropostaVersion:proposta.versao,documentoHash:proposta.documento.hash,condicoesHash:proposta.condicoesHash};
  const blocked=p.busy||p.blocked||!!p.pending;
  const financeiro=catalogos?.financeiro;
  async function criarProjeto() {
    if (!p.data?.capacidades.podeCriarProjeto || projeto || !origemSelecionada) return;
    const body={...refs,listId:lista,statusId:etapa,title:titulo.trim(),assigneeUserId:responsavel||null};
    await p.enviar('projeto',base+'/projeto',body,v=>PonteProjetoPedidoSchema.parse(v),r=>!!r.projeto && r.projeto.origem.aceiteId===aceite.id
      && r.projeto.origem.propostaId===proposta.id && r.projeto.origem.documentoHash===refs.documentoHash && r.projeto.origem.condicoesHash===refs.condicoesHash
      && r.projeto.configuracaoOriginal.listId===lista && r.projeto.configuracaoOriginal.statusId===etapa && r.projeto.configuracaoOriginal.title===body.title && r.projeto.configuracaoOriginal.assigneeUserId===body.assigneeUserId);
  }
  async function registrarObrigacao() {
    if (!projeto || !p.data?.capacidades.podeRegistrarObrigacao || !confirmado || !origemSelecionada) return;
    const body={...refs,partnerId:contraparte,accountId:conta,chartAccountId:classificacao,projetoFinanceiroId:projetoFinanceiro||null,departamentoId:departamento||null,
      descricao:descricao.trim(),valorCanonico:valor.trim(),competencia:competencia?new Date(competencia+'T12:00:00Z').toISOString():'',vencimento:vencimento?new Date(vencimento+'T12:00:00Z').toISOString():'',confirmacaoExercicio:true};
    await p.enviar('obrigacao',base+'/projetos/'+encodeURIComponent(projeto.id)+'/obrigacao',body,v=>PonteObrigacaoPedidoSchema.parse(v),r=>{
      const s=r.obrigacao?.snapshot,c=s?.condicoes;
      return !!s && s.projectId===projeto.id && s.taskId===projeto.taskId && s.origem.aceiteId===aceite.id && s.origem.documentoHash===refs.documentoHash && s.origem.condicoesHash===refs.condicoesHash
        && c?.accountId===conta && c.partnerId===contraparte && c.chartAccountId===classificacao && c.projetoFinanceiroId===body.projetoFinanceiroId && c.departamentoId===body.departamentoId
        && c.descricao===body.descricao && c.valorCanonico===body.valorCanonico && c.competencia===body.competencia && c.vencimento===body.vencimento;
    });
  }
  return <section aria-label="Projeto e obrigação do aceite" className="space-y-4 rounded-xl border border-border p-4">
    <div><h3 className="font-semibold">Projeto e obrigação do aceite</h3><p className="text-sm text-muted">Exercício local com origem na proposta v{proposta.versao} e no aceite registrado.</p></div>
    {p.error && <p role="alert" className="text-sm text-bad">{p.error}</p>}{catalogError&&<p role="alert" className="text-sm text-bad">{catalogError}</p>}{p.notice&&<p role="status" className="text-sm text-good">{p.notice}</p>}
    {p.pending&&<div className="space-y-2 rounded-lg border border-warn/40 p-3"><p>Resultado ainda não confirmado. Outra intenção fica bloqueada até conferir este pedido.</p><p className="break-all text-xs">Pedido {p.pending.requestId}</p><button type="button" className={OUTLINE} disabled={p.busy||p.blocked} onClick={()=>void p.recuperarPedido()}>Conferir pedido da ponte</button></div>}
    {!p.data&&!p.error&&<p role="status">Carregando vínculo do exercício…</p>}
    {p.data&&<>
      {projeto?<div className="space-y-2 rounded-lg border border-border p-3"><p>Projeto de exercício criado · {projeto.atual.archived?'tarefa arquivada':'tarefa ativa'}.</p>
        <Link className="text-brand underline" href={'/trabalho?lista='+encodeURIComponent(projeto.atual.listId)+'&tarefa='+encodeURIComponent(projeto.taskId)}>Abrir tarefa do projeto: {projeto.atual.title}</Link>
        <p className="text-sm">Origem preservada: proposta v{projeto.origem.propostaVersao} · aceite de exercício.</p>
        <details className="text-xs"><summary className="cursor-pointer">Conferir origem e configuração</summary><p className="break-all">Projeto {projeto.id} · tarefa {projeto.taskId}</p><p>Destino original: lista {projeto.configuracaoOriginal.listId} · etapa {projeto.configuracaoOriginal.statusId}</p><p>Etapa atual: {catalogos?.listas.flatMap(l=>l.etapas).find(e=>e.id===projeto.atual.statusId)?.nome??projeto.atual.statusId}</p><p className="break-all">Documento {projeto.origem.documentoHash} · condições {projeto.origem.condicoesHash}</p></details>
      </div>:p.data.capacidades.podeCriarProjeto&&<fieldset className="space-y-3" disabled={blocked||!catalogos}><legend className="font-medium">Abrir projeto de exercício</legend>
        <label className="block text-sm">Lista do projeto<select aria-label="Lista do projeto" className={INPUT} value={lista} onChange={e=>{setLista(e.target.value);setEtapa('');}}><option value="">Selecione</option>{catalogos?.listas.map(l=><option key={l.id} value={l.id}>{l.nome}</option>)}</select></label>
        <label className="block text-sm">Etapa inicial do projeto<select aria-label="Etapa inicial do projeto" className={INPUT} value={etapa} onChange={e=>setEtapa(e.target.value)}><option value="">Selecione</option>{catalogos?.listas.find(l=>l.id===lista)?.etapas.map(e=><option key={e.id} value={e.id}>{e.nome}</option>)}</select></label>
        <label className="block text-sm">Título do projeto<input aria-label="Título do projeto" className={INPUT} maxLength={300} value={titulo} onChange={e=>setTitulo(e.target.value)}/></label>
        <label className="block text-sm">Responsável do projeto<select aria-label="Responsável do projeto" className={INPUT} value={responsavel} onChange={e=>setResponsavel(e.target.value)}><option value="">Sem responsável vinculado</option>{catalogos?.responsaveis.map(r=><option key={r.id} value={r.id}>{r.nome}</option>)}</select></label>
        <button type="button" className={BUTTON} disabled={!lista||!etapa||!titulo.trim()} onClick={()=>void criarProjeto()}>Criar projeto de exercício</button>
      </fieldset>}
      {!origemSelecionada&&<p role="status" className="text-sm text-warn">O projeto usa outra versão preservada. Abra a proposta v{projeto?.origem.propostaVersao} para conferir sua origem antes de registrar a obrigação.</p>}
      {obrigacao?<div className="space-y-2 rounded-lg border border-border p-3"><p>Obrigação registrada · {obrigacao.snapshot.condicoes.valorCanonico} · previsto · {obrigacao.approvalStatus}.</p><Link className="text-brand underline" href={'/financeiro/obrigacoes/'+encodeURIComponent(obrigacao.transactionId)+'?origem=comercial'}>Conferir obrigação comercial</Link></div>:<div className="space-y-2 text-sm"><p>Financeiro: {p.data.financeiro.situacao}.</p><ul className="list-disc pl-5">{p.data.financeiro.pendencias.map(t=><li key={t}>{t}</li>)}</ul></div>}
      {projeto&&!obrigacao&&p.data.capacidades.podeRegistrarObrigacao&&origemSelecionada&&<fieldset className="space-y-3 rounded-lg border border-border p-3" disabled={blocked||!financeiro}><legend className="font-medium">Registrar obrigação do exercício</legend>
        <p className="text-sm">Informe destino, classificação e datas. O valor integral será conferido com a proposta preservada.</p>
        <label className="block text-sm">Contraparte da obrigação<select aria-label="Contraparte da obrigação" className={INPUT} value={contraparte} onChange={e=>setContraparte(e.target.value)}><option value="">Selecione</option>{financeiro?.contrapartes.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
        <label className="block text-sm">Conta manual da obrigação<select aria-label="Conta manual da obrigação" className={INPUT} value={conta} onChange={e=>setConta(e.target.value)}><option value="">Selecione</option>{financeiro?.contas.map(c=><option key={c.id} value={c.id}>{c.nome} · {c.currency}</option>)}</select></label>
        <label className="block text-sm">Classificação da obrigação<select aria-label="Classificação da obrigação" className={INPUT} value={classificacao} onChange={e=>setClassificacao(e.target.value)}><option value="">Selecione</option>{financeiro?.classificacoes.map(c=><option key={c.id} value={c.id}>{c.codigo} · {c.nome}</option>)}</select></label>
        <label className="block text-sm">Projeto financeiro da obrigação<select aria-label="Projeto financeiro da obrigação" className={INPUT} value={projetoFinanceiro} onChange={e=>setProjetoFinanceiro(e.target.value)}><option value="">Sem dimensão de projeto</option>{financeiro?.projetos.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
        <label className="block text-sm">Departamento da obrigação<select aria-label="Departamento da obrigação" className={INPUT} value={departamento} onChange={e=>setDepartamento(e.target.value)}><option value="">Sem departamento</option>{financeiro?.departamentos.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
        <label className="block text-sm">Descrição da obrigação<input aria-label="Descrição da obrigação" className={INPUT} maxLength={500} value={descricao} onChange={e=>setDescricao(e.target.value)}/></label>
        <label className="block text-sm">Valor exato da obrigação<input aria-label="Valor exato da obrigação" className={INPUT} value={valor} onChange={e=>setValor(e.target.value)}/></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">Competência da obrigação<input aria-label="Competência da obrigação" type="date" className={INPUT} value={competencia} onChange={e=>setCompetencia(e.target.value)}/></label><label className="block text-sm">Vencimento da obrigação<input aria-label="Vencimento da obrigação" type="date" className={INPUT} value={vencimento} onChange={e=>setVencimento(e.target.value)}/></label></div>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmado} onChange={e=>setConfirmado(e.target.checked)}/>Confirmo a obrigação de exercício com estas condições.</label>
        <button type="button" className={BUTTON} disabled={!confirmado||!conta||!contraparte||!classificacao||!descricao.trim()||!valor.trim()||!competencia||!vencimento} onClick={()=>void registrarObrigacao()}>Registrar obrigação comercial de exercício</button>
      </fieldset>}
      <p className="text-xs text-muted">Este percurso não executa pagamento, cobrança ou conciliação.</p>
    </>}
  </section>;
}
