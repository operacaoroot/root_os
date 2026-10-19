'use client';
import { useEffect, useRef, useState } from 'react';
import { PonteConfiguracaoSchema, PonteOrigemSchema, PonteSnapshotSchema, type PonteResposta } from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
export type EscopoPonte = PonteResposta['escopo'];
export type AcaoPonte = 'projeto' | 'obrigacao' | 'decisao';
export interface PistaPonte extends EscopoPonte { entityId: string; action: AcaoPonte; requestId: string }
export function chavePonte(e: EscopoPonte, entityId: string) {
  return ['rootos', 'ponte', 'v1', e.orgId, e.userId, entityId].map(encodeURIComponent).join(':');
}
export function escopoPonteConfere(e: EscopoPonte | undefined, userId: string, anterior?: EscopoPonte | null): e is EscopoPonte {
  return !!e && typeof e.orgId === 'string' && e.orgId.trim().length > 0 && e.userId === userId && typeof userId === 'string' && userId.trim().length > 0
    && (!anterior || anterior.orgId === e.orgId && anterior.userId === e.userId);
}
export function respostaPonteConfere(r: PonteResposta, userId: string, alvo: { leadId?: string; transactionId?: string }, anterior?: EscopoPonte | null): boolean {
  if (!r || r.modo !== 'exercicio' || !UUID.test(r.requestId) || typeof r.replayed !== 'boolean' || !escopoPonteConfere(r.escopo, userId, anterior)) return false;
  const e = r.efeitos, c = r.capacidades;
  if (!e || !c || [c.podeCriarProjeto,c.podeRegistrarObrigacao,c.podeDecidir,e.tarefaCriada,e.projetoCriado,e.obrigacaoCriada,e.decisaoRegistrada].some(v => typeof v !== 'boolean')
    || e.pagamentoExecutado !== false || e.cobrancaExecutada !== false || e.conciliacaoExecutada !== false
    || !r.financeiro || !['pendente','registrado','restrito'].includes(r.financeiro.situacao) || !Array.isArray(r.financeiro.pendencias)) return false;
  if (r.projeto) {
    const p = r.projeto;
    if (!UUID.test(p.id) || !UUID.test(p.taskId) || !PonteOrigemSchema.safeParse(p.origem).success || !PonteConfiguracaoSchema.safeParse(p.configuracaoOriginal).success
      || alvo.leadId && p.origem.leadId !== alvo.leadId || !p.atual || typeof p.atual.title !== 'string' || !UUID.test(p.atual.listId) || !UUID.test(p.atual.statusId)
      || p.atual.assigneeUserId !== null && !UUID.test(p.atual.assigneeUserId) || typeof p.atual.archived !== 'boolean') return false;
  }
  if (r.obrigacao) {
    const o = r.obrigacao;
    if (!UUID.test(o.id) || !UUID.test(o.transactionId) || !UUID.test(o.versionId) || !HASH.test(o.contentHash) || !Number.isFinite(Date.parse(o.expectedUpdatedAt))
      || !PonteSnapshotSchema.safeParse(o.snapshot).success || o.snapshot.transactionId !== o.transactionId || o.status !== 'previsto'
      || !['aguardando','aprovado','rejeitado'].includes(o.approvalStatus) || o.paidAt !== null || o.reconciledAt !== null || typeof o.canDecide !== 'boolean'
      || alvo.transactionId && o.transactionId !== alvo.transactionId || alvo.leadId && o.snapshot.origem.leadId !== alvo.leadId
      || r.projeto && (o.snapshot.projectId !== r.projeto.id || o.snapshot.taskId !== r.projeto.taskId)) return false;
    const d = o.decisao;
    if (d && (!UUID.test(d.id) || !UUID.test(d.atorId) || typeof d.aprovar !== 'boolean' || typeof d.motivo !== 'string'
      || !['responsavel','titular'].includes(d.alcada) || !Number.isFinite(Date.parse(d.decididaEm)) || o.approvalStatus !== (d.aprovar ? 'aprovado' : 'rejeitado'))) return false;
    if (!d && o.approvalStatus !== 'aguardando') return false;
  }
  return !alvo.transactionId || !!r.obrigacao;
}
function lerPista(e: EscopoPonte, entityId: string, actions: AcaoPonte[]): PistaPonte | null {
  const raw = localStorage.getItem(chavePonte(e, entityId));
  if (raw === null) return null;
  const p: PistaPonte = JSON.parse(raw);
  if (!p || Object.keys(p).sort().join(',') !== 'action,entityId,orgId,requestId,userId' || !UUID.test(p.requestId)
    || !escopoPonteConfere(p, e.userId, e) || p.entityId !== entityId || !actions.includes(p.action)) throw new Error('O identificador preservado não pôde ser conferido.');
  return p;
}
export function usePedidoPonte({ token, userId, entityId, path, recoveryPath, actions, alvo, onIndisponivel }: {
  token: string; userId: string; entityId: string; path: string; recoveryPath: string; actions: AcaoPonte[];
  alvo: { leadId?: string; transactionId?: string }; onIndisponivel?: () => void;
}) {
  const [data,setData] = useState<PonteResposta | null>(null), [pending,setPending] = useState<PistaPonte | null>(null);
  const [busy,setBusy] = useState(true), [blocked,setBlocked] = useState(false), [error,setError] = useState<string | null>(null), [notice,setNotice] = useState<string | null>(null);
  const generation = useRef(0), lock = useRef(false), scope = useRef<EscopoPonte | null>(null), unavailable = useRef(onIndisponivel);
  unavailable.current = onIndisponivel;
  function conferir(r: PonteResposta, pista?: PistaPonte) {
    if (!respostaPonteConfere(r,userId,alvo,scope.current) || pista && (r.requestId !== pista.requestId || pista.action === 'projeto' && !r.projeto
      || pista.action === 'obrigacao' && !r.obrigacao || pista.action === 'decisao' && (!r.obrigacao?.decisao || r.obrigacao.decisao.atorId !== userId))) throw new Error('A resposta não confirma este pedido e seu escopo.');
    scope.current = r.escopo; setData(r);
  }
  function falhar(e: unknown, recovery = false) {
    const status = (e as { status?: number })?.status;
    if (recovery && status === 404) { setData(null); setError('Pedido ainda sem confirmação. O servidor não encontrou um resultado; nenhum novo pedido foi enviado.'); return; }
    setError(e instanceof Error ? e.message : 'Não foi possível conferir a ponte.');
    if ([401,403,404].includes(status ?? 0)) { setData(null); setPending(null); setBlocked(true); unavailable.current?.(); }
  }
  async function recuperar(p: PistaPonte, epoch: number) {
    const r = await apiGet<PonteResposta>(recoveryPath + '/' + encodeURIComponent(p.requestId),token);
    if (generation.current !== epoch) return;
    conferir(r,p);
    try { localStorage.removeItem(chavePonte(p,entityId)); } catch { /* A pista remanescente só leva a outra consulta GET. */ }
    setPending(null); setNotice('Pedido confirmado pelo servidor. Nenhum efeito foi repetido.');
  }
  useEffect(() => {
    const epoch = ++generation.current; lock.current = true;
    const load = async () => {
      const r = await apiGet<PonteResposta>(path,token);
      if (generation.current !== epoch) return;
      conferir(r);
      let pista: PistaPonte | null;
      try { pista = lerPista(r.escopo,entityId,actions); }
      catch { setData(null); setBlocked(true); throw new Error('O armazenamento do navegador está indisponível. Reabra a tela antes de criar outro pedido.'); }
      if (pista) { setPending(pista); try { await recuperar(pista,epoch); } catch (e) { if (generation.current === epoch) falhar(e,true); } }
    };
    load().catch(e => { if (generation.current === epoch) falhar(e); })
      .finally(() => { if (generation.current === epoch) { lock.current = false; setBusy(false); } });
    return () => { generation.current++; };
    // A casca monta outra instância ao trocar sessão, pessoa ou objeto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token,userId,entityId,path,recoveryPath]);
  async function recuperarPedido() {
    if (!pending || lock.current || blocked) return;
    const epoch = generation.current; lock.current = true; setBusy(true); setError(null);
    try { await recuperar(pending,epoch); } catch(e) { if (generation.current === epoch) falhar(e,true); }
    finally { if (generation.current === epoch) { lock.current = false; setBusy(false); } }
  }
  async function enviar(action: AcaoPonte, postPath: string, body: Record<string,unknown>, parse: (v: unknown) => unknown,
    confirmar: (r: PonteResposta) => boolean = () => true) {
    if (!data || !scope.current || pending || blocked || lock.current || !actions.includes(action)) return;
    const requestId = crypto.randomUUID(), pista: PistaPonte = { ...scope.current,entityId,action,requestId };
    let payload: unknown;
    try { payload = parse({ ...body,requestId }); }
    catch { setError('Confira os campos e as condições antes de registrar o pedido.'); return; }
    try { localStorage.setItem(chavePonte(pista,entityId),JSON.stringify(pista)); }
    catch { setError('O navegador não conseguiu guardar o identificador. O pedido não foi enviado.'); return; }
    const epoch = generation.current; lock.current = true; setBusy(true); setPending(pista); setError(null); setNotice(null);
    try {
      const r = await apiPost<PonteResposta>(postPath,payload,token);
      if (generation.current !== epoch) return;
      if (!confirmar(r)) throw new Error('O retorno não confirmou as condições enviadas. Confira o pedido original.');
      conferir(r,pista);
      try { localStorage.removeItem(chavePonte(pista,entityId)); } catch { /* Nunca gera outro efeito; o estado confirmado vem do servidor. */ }
      setPending(null); setNotice(r.replayed ? 'Pedido já confirmado. Nenhum efeito duplicado.' : 'Registro do exercício confirmado.');
    } catch(e) { if (generation.current === epoch) falhar(e); }
    finally { if (generation.current === epoch) { lock.current = false; setBusy(false); } }
  }
  return { data,pending,busy,blocked,error,notice,enviar,recuperarPedido };
}
