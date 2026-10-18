'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  FinanceiroGeracaoEntradaSchema, FinanceiroGeracaoPedidoSchema,
  FinanceiroGeracaoPreviaSchema, FinanceiroGeracaoRespostaSchema, FinanceiroGeracaoRecuperacaoSchema,
  type ContractList, type FinanceiroGeracaoCondicoes, type FinanceiroGeracaoPedido,
  type FinanceiroGeracaoPrevia, type FinanceiroGeracaoResposta,
} from '@mktos/shared';
import { apiGet, apiPost, ErroDaApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';

type Props = { contracts: ContractList | null; onAtualizar: () => void; onError: (e: unknown) => void };
type Identificador = { schemaVersion: 1; orgId: string; actorId: string; requestId: string };
type Envio = { identificador: Identificador; pedido: FinanceiroGeracaoPedido; previa: FinanceiroGeracaoPrevia };
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const INP = 'mt-1 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm disabled:opacity-60';
const BTN = 'min-h-11 rounded-lg border border-brand-dim px-3 py-2 text-sm text-brand disabled:opacity-50';
const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
const chave = (actorId: string, orgId: string) => `rootos:financeiro-inscricao:${encodeURIComponent(actorId)}:${encodeURIComponent(orgId)}`;
const indice = (actorId: string) => `rootos:financeiro-inscricao:${encodeURIComponent(actorId)}:ultimo`;

function lerIdentificador(key: string, actorId: string): Identificador | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  if (raw.length > 1000) throw new Error('O identificador preservado não pôde ser conferido.');
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Identificador inválido.');
    const p = v as Partial<Identificador>;
    return p.schemaVersion === 1 && p.actorId === actorId && typeof p.orgId === 'string'
      && p.orgId.length > 0 && p.orgId.length <= 200 && typeof p.requestId === 'string' && UUID.test(p.requestId)
      ? { schemaVersion: 1, actorId, orgId: p.orgId, requestId: p.requestId } : (() => { throw new Error('Identificador inválido.'); })();
  } catch { throw new Error('O identificador preservado não pôde ser conferido. Nenhum novo envio foi autorizado.'); }
}
function guardarIdentificador(p: Identificador) {
  localStorage.setItem(chave(p.actorId, p.orgId), JSON.stringify(p));
  localStorage.setItem(indice(p.actorId), JSON.stringify(p));
}
function limparIdentificador(p: Identificador) {
  for (const key of [chave(p.actorId, p.orgId), indice(p.actorId)]) {
    if (lerIdentificador(key, p.actorId)?.requestId === p.requestId) localStorage.removeItem(key);
  }
}
function condicoesConferem(c: FinanceiroGeracaoCondicoes, contractId: string, vencimento: string) {
  return c.contrato.id === contractId && c.vencimento === vencimento && c.contrato.tipo === c.tipo
    && c.contrato.valorCanonico === c.valorCanonico && c.conta.currency === c.currency
    && c.valorCanonico.startsWith(c.currency + ' ') && c.conta.ativa && c.contraparte.ativo
    && c.classificacao.ativo && c.classificacao.permiteLancamento && c.projetoFinanceiro?.ativo !== false
    && c.departamento?.ativo !== false;
}

export function NovaInscricaoFinanceira(props: Props) {
  const { ready, token, user, can } = useAuth();
  if (!ready || !token || !user || !can('financeiro.ver') || !can('financeiro.editar')) return null;
  return <InscricaoAutorizada key={user.id + ':' + token} {...props} actorId={user.id} token={token} />;
}

function InscricaoAutorizada({ contracts, onAtualizar, onError, actorId, token }: Props & { actorId: string; token: string }) {
  const [contractId, setContractId] = useState(''), [vencimentoDia, setVencimentoDia] = useState('');
  const [previa, setPrevia] = useState<FinanceiroGeracaoPrevia | null>(null);
  const [pendente, setPendente] = useState<Identificador | null>(null);
  const [resultado, setResultado] = useState<FinanceiroGeracaoResposta | null>(null);
  const [confirmado, setConfirmado] = useState(false), [ocupado, setOcupado] = useState(false);
  const [bloqueado, setBloqueado] = useState(false), [erro, setErro] = useState<string | null>(null);
  const [orgConferida, setOrgConferida] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ausenciaObservada, setAusenciaObservada] = useState<Identificador | null>(null);
  const [reciboDivergente, setReciboDivergente] = useState(false), [reciboRecuperado, setReciboRecuperado] = useState(false);
  const geracao = useRef(0), escrita = useRef(false), envio = useRef<Envio | null>(null);
  const callbacks = useRef({ onAtualizar, onError }); callbacks.current = { onAtualizar, onError };
  useEffect(() => {
    ++geracao.current;
    try { setPendente(lerIdentificador(indice(actorId), actorId)); }
    catch { setBloqueado(true); setErro('Não foi possível consultar os pedidos preservados. Nenhuma inscrição será enviada.'); }
    return () => { ++geracao.current; escrita.current = false; envio.current = null; };
  }, [actorId, token]);
  const contratos = contracts?.items.filter((c) => c.status === 'ativo') ?? [];
  const contrato = contratos.find((c) => c.id === contractId);
  const pendenciaDestaEmpresa = !!pendente && pendente.orgId === orgConferida;
  const podeReusarPendente = !!pendente && !!ausenciaObservada && pendente.actorId === actorId
    && pendente.orgId === orgConferida && ausenciaObservada.actorId === actorId
    && ausenciaObservada.orgId === pendente.orgId && ausenciaObservada.requestId === pendente.requestId;
  const pendenciaBloqueia = pendenciaDestaEmpresa && !podeReusarPendente;
  const camposBloqueados = ocupado || bloqueado || !!resultado || pendenciaBloqueia;
  function invalidarPrevia() { setPrevia(null); setConfirmado(false); setErro(null); setAviso(null); }
  function mudarContrato(id: string) {
    setContractId(id); setVencimentoDia(contratos.find((c) => c.id === id)?.proximoVencimento.slice(0, 10) ?? ''); invalidarPrevia();
  }
  function privar(e: unknown) {
    setPrevia(null); setResultado(null); setContractId(''); setVencimentoDia(''); setConfirmado(false); setBloqueado(true); setAviso(null); setAusenciaObservada(null); envio.current = null;
    setErro(e instanceof Error ? e.message : 'Inscrição indisponível para esta conta.'); callbacks.current.onError(e);
  }
  function aceitar(r: FinanceiroGeracaoResposta, id: Identificador, consulta = false) {
    if (r.actorId !== actorId || r.orgId !== id.orgId || r.requestId !== id.requestId
      || !condicoesConferem(r.condicoes, r.contractId, r.vencimento)) {
      privar(new Error('O recibo não confere com a empresa, a pessoa ou o pedido preservado.')); return;
    }
    const proposta = previa ?? envio.current?.previa;
    const divergente = (!!contractId && (r.contractId !== contractId || r.vencimento.slice(0, 10) !== vencimentoDia))
      || (!!proposta && (r.contractId !== proposta.contractId || r.vencimento !== proposta.vencimento
      || r.marcaOrigem.updatedAt !== proposta.marcaOrigem.updatedAt || r.marcaOrigem.contentHash !== proposta.marcaOrigem.contentHash
      || r.transactionId !== proposta.transactionIdPrevisto || r.proximoVencimento !== proposta.proximoVencimento
      || JSON.stringify(r.condicoes) !== JSON.stringify(proposta.condicoes)));
    setResultado(r); setReciboDivergente(divergente); setReciboRecuperado(consulta || r.replayed);
    setOrgConferida(r.orgId); setConfirmado(false); setAusenciaObservada(null); envio.current = null;
    // Um recibo real diferente da proposta permanece recuperável até a conferência explícita.
    if (divergente) {
      setPendente(id); setErro(null); setAviso('Este é o recibo real do pedido preservado. Suas condições diferem da proposta local; ele não confirma essa proposta. Confira o recibo antes de iniciar outra inscrição.');
    } else {
      setPendente(null); setAviso(null);
      try { limparIdentificador(id); setErro(null); }
      catch { setErro('Recibo confirmado. O identificador ainda está preservado; consulte o mesmo pedido antes de criar outra inscrição.'); setPendente(id); }
    }
    callbacks.current.onAtualizar();
  }
  function concluirConferenciaDoRecibo() {
    if (ocupado || bloqueado || !resultado || !pendente || !reciboDivergente
      || resultado.requestId !== pendente.requestId || resultado.orgId !== pendente.orgId || resultado.actorId !== actorId) return;
    try { limparIdentificador(pendente); setPendente(null); setErro(null); }
    catch { setErro('O identificador não pôde ser retirado. O recibo permanece disponível para conferência.'); }
  }
  async function conferirPrevia() {
    if (escrita.current || bloqueado || resultado || pendenciaBloqueia || !contrato || !vencimentoDia) return;
    const vencimento = contrato.proximoVencimento.slice(0, 10) === vencimentoDia
      ? contrato.proximoVencimento : vencimentoDia + 'T00:00:00.000Z';
    const entrada = FinanceiroGeracaoEntradaSchema.safeParse({ contractId, vencimento });
    if (!entrada.success) { setErro('Confira o contrato e a data do vencimento.'); return; }
    const rodada = geracao.current; escrita.current = true; setOcupado(true); setErro(null); setAviso(null); setPrevia(null); setConfirmado(false);
    try {
      const raw = await apiPost<unknown>('/finance/exercicio/contratos/previa', entrada.data, token);
      if (rodada !== geracao.current) return;
      const parsed = FinanceiroGeracaoPreviaSchema.safeParse(raw);
      if (!parsed.success) throw new Error('A API retornou condições de prévia que não puderam ser conferidas.');
      const r = parsed.data;
      if (r.actorId !== actorId || r.contractId !== entrada.data.contractId || r.vencimento !== entrada.data.vencimento
        || !condicoesConferem(r.condicoes, r.contractId, r.vencimento) || (orgConferida && r.orgId !== orgConferida)) {
        privar(new Error('A prévia não confere com a pessoa, a empresa ou o contrato escolhido.')); return;
      }
      setOrgConferida(r.orgId);
      // A organização vem da leitura autorizada; nunca é deduzida do usuário ou do ID do contrato.
      const armazenado = lerIdentificador(chave(actorId, r.orgId), actorId);
      const local = pendente?.orgId === r.orgId ? pendente : null;
      if (armazenado && local && armazenado.requestId !== local.requestId) {
        privar(new Error('O pedido preservado mudou em outra aba. Nenhum novo envio foi autorizado.')); return;
      }
      const preservado = armazenado ?? local;
      setPendente(preservado); setPrevia(r);
      if (preservado) {
        const ausenciaDestePedido = ausenciaObservada?.actorId === actorId && ausenciaObservada.orgId === preservado.orgId
          && ausenciaObservada.requestId === preservado.requestId;
        if (ausenciaDestePedido) setAviso('A ausência foi observada na consulta anterior. Um envio atrasado ainda pode chegar. A confirmação abaixo reutiliza o mesmo pedido preservado.');
        else { setAusenciaObservada(null); setErro('Já existe um pedido desta empresa aguardando conferência. Consulte esse pedido antes de outro envio.'); }
      } else setAusenciaObservada(null);
    } catch (e) {
      if (rodada !== geracao.current) return;
      if (e instanceof ErroDaApi && [401, 403].includes(e.status)) privar(e);
      else setErro(e instanceof Error ? e.message : 'Não foi possível conferir a prévia.');
    } finally { if (rodada === geracao.current) { escrita.current = false; setOcupado(false); } }
  }
  async function gerarInscricao() {
    if (escrita.current || bloqueado || resultado || (pendente && !podeReusarPendente) || !previa || !confirmado || previa.actorId !== actorId
      || previa.orgId !== orgConferida || previa.contractId !== contractId || previa.vencimento.slice(0, 10) !== vencimentoDia) return;
    const pedido = FinanceiroGeracaoPedidoSchema.safeParse({ contractId: previa.contractId, vencimento: previa.vencimento,
      requestId: pendente?.requestId ?? crypto.randomUUID(), marcaOrigem: previa.marcaOrigem });
    if (!pedido.success) { setErro('A prévia precisa ser conferida novamente antes da inscrição.'); setPrevia(null); setConfirmado(false); return; }
    const id: Identificador = { schemaVersion: 1, orgId: previa.orgId, actorId, requestId: pedido.data.requestId };
    const rodada = geracao.current; escrita.current = true; setOcupado(true); setErro(null);
    let enviado = false;
    try {
      const anterior = lerIdentificador(chave(actorId, id.orgId), actorId);
      if (anterior && (!podeReusarPendente || anterior.requestId !== id.requestId || anterior.orgId !== id.orgId)) {
        setConfirmado(false); setAusenciaObservada(null); throw new Error('Outro pedido desta empresa está preservado. Nenhum identificador foi substituído; confira o pedido antes de enviar.');
      }
      guardarIdentificador(id); setPendente(id); setAusenciaObservada(null); envio.current = { identificador: id, pedido: pedido.data, previa };
      enviado = true;
      const raw = await apiPost<unknown>('/finance/exercicio/contratos/gerar', pedido.data, token);
      if (rodada !== geracao.current) return;
      const parsed = FinanceiroGeracaoRespostaSchema.safeParse(raw);
      if (!parsed.success) throw new Error('O resultado recebido não pôde ser conferido. Consulte o pedido preservado.');
      aceitar(parsed.data, id);
    } catch (e) {
      if (rodada !== geracao.current) return;
      if (e instanceof ErroDaApi && [401, 403].includes(e.status)) privar(e);
      else if (enviado && e instanceof ErroDaApi && e.status === 409 && ['financeiro_exercicio_origem_alterada', 'financeiro_exercicio_origem_ja_gerada'].includes(e.codigo ?? '')) {
        // O rollback deste envio não cancela uma tentativa anterior atrasada com o mesmo ID.
        setPrevia(null); setConfirmado(false); setAusenciaObservada(null);
        setErro(e.message + ' O pedido continua preservado; consulte seu resultado antes de revisar a prévia.'); callbacks.current.onAtualizar();
      } else setErro(e instanceof Error ? e.message : enviado ? 'Resultado não confirmado. Consulte o pedido preservado.' : 'Não foi possível preservar o pedido; a inscrição não foi enviada.');
    } finally { if (rodada === geracao.current) { escrita.current = false; setOcupado(false); } }
  }
  async function recuperarPedido() {
    if (escrita.current || bloqueado || !pendente) return;
    const id = pendente, rodada = geracao.current; escrita.current = true; setOcupado(true); setErro(null);
    try {
      const raw = await apiGet<unknown>('/finance/exercicio/contratos/pedidos/' + encodeURIComponent(id.requestId), token);
      if (rodada !== geracao.current) return;
      const parsed = FinanceiroGeracaoRecuperacaoSchema.safeParse(raw);
      if (!parsed.success) throw new Error('A conferência retornada não pôde ser validada. O pedido permanece preservado.');
      const r = parsed.data;
      if (r.orgId !== id.orgId || r.actorId !== actorId || r.requestId !== id.requestId) { privar(new Error('A conferência não corresponde à empresa, pessoa e pedido preservados.')); return; }
      if (r.estado === 'confirmado') aceitar(r.recibo, id, true);
      else {
        if (resultado) { setErro('A consulta atual divergiu do recibo já recebido. O recibo e seu identificador permanecem para conferência.'); return; }
        setAusenciaObservada(id); setPrevia(null); setConfirmado(false); setOrgConferida(r.orgId);
        setAviso('O servidor observou ausência nesta consulta. Isso não cancela um envio atrasado. O pedido permanece recuperável; uma nova prévia e confirmação explícitas reutilizam esse mesmo identificador.');
      }
    } catch (e) {
      if (rodada !== geracao.current) return;
      if (e instanceof ErroDaApi && [401, 403].includes(e.status)) privar(e);
      else setErro(e instanceof ErroDaApi && e.status === 404
        ? 'Pedido não localizado ou indisponível para esta conta. Isso não confirma ausência de gravação; o identificador permanece preservado.'
        : e instanceof Error ? e.message : 'Não foi possível conferir o pedido preservado.');
    } finally { if (rodada === geracao.current) { escrita.current = false; setOcupado(false); } }
  }
  function novaInscricao() {
    if (pendente || ocupado || bloqueado) return;
    setResultado(null); setPrevia(null); setConfirmado(false); setErro(null); setAviso(null); setAusenciaObservada(null); setReciboDivergente(false); setReciboRecuperado(false); envio.current = null;
    setVencimentoDia(contratos.find((c) => c.id === contractId)?.proximoVencimento.slice(0, 10) ?? '');
  }
  return <details open={pendente || resultado ? true : undefined} className="rounded-xl border border-border bg-surface p-4">
    <summary className="cursor-pointer font-medium">Inscrever obrigação de exercício</summary>
    <div className="mt-4 space-y-4">
      <p className="text-sm text-muted">Escolha um contrato e confira as condições. A inscrição gera o previsto e seu registro de exercício na mesma operação. Aprovação é feita depois, no detalhe.</p>
      <p className="text-xs text-muted">O servidor confere disponibilidade do exercício, acesso e elegibilidade. Este percurso não executa pagamento, cobrança ou conciliação.</p>
      {erro && <p role="alert" className="rounded-lg border border-warn/40 p-3 text-sm">{erro}</p>}
      {aviso && <p role="status" className="rounded-lg border border-border p-3 text-sm">{aviso}</p>}
      {pendente && <section aria-label="Pedido de inscrição preservado" className="space-y-2 rounded-lg border border-warn/40 p-3 text-sm">
        <p>{podeReusarPendente ? 'Ausência observada. O pedido continua recuperável; outra confirmação reutiliza seu identificador.' : 'Há um pedido preservado. Outro envio para a mesma empresa fica bloqueado até conferir seu resultado.'}</p>
        <p className="break-all text-xs text-muted">Pedido {pendente.requestId}</p>
        <button type="button" className={BTN} disabled={ocupado || bloqueado} onClick={() => void recuperarPedido()}>Conferir pedido preservado</button>
        {!orgConferida && <p className="text-xs text-muted">A prévia de um contrato identifica a empresa atual e localiza os pedidos preservados desse escopo.</p>}
      </section>}
      {!resultado && <form aria-label="Inscrição inicial F08" className="space-y-3" onSubmit={(e) => { e.preventDefault(); void conferirPrevia(); }}>
        {!contracts ? <p className="text-sm text-muted">Carregando contratos…</p> : !contratos.length && <p className="text-sm text-muted">Não há contratos ativos disponíveis. Confira os cadastros de contrato, conta manual, contraparte e classificação no Financeiro.</p>}
        <label className="block text-sm">Contrato<select aria-label="Contrato da obrigação de exercício" className={INP} value={contractId} disabled={camposBloqueados || !contracts} onChange={(e) => mudarContrato(e.target.value)}><option value="">Selecione o contrato</option>{contratos.map((c) => <option key={c.id} value={c.id}>{c.descricao}</option>)}</select></label>
        <label className="block text-sm">Vencimento<input aria-label="Vencimento da obrigação de exercício" type="date" className={INP} value={vencimentoDia} disabled={camposBloqueados || !contrato} onChange={(e) => { setVencimentoDia(e.target.value); invalidarPrevia(); }} /></label>
        <button type="submit" className={BTN} disabled={ocupado || bloqueado || pendenciaBloqueia || !contrato || !vencimentoDia}>{ocupado ? 'Conferindo…' : 'Conferir condições do contrato'}</button>
      </form>}
      {previa && !resultado && <section aria-label="Prévia da inscrição" className="space-y-3 rounded-lg border border-border p-4">
        <h3 className="font-semibold">Condições conferidas</h3><CondicoesDaInscricao condicoes={previa.condicoes} />
        <p className="text-xs text-muted">Previsto · aguardando decisão. A aprovação exige alçada responsável; sua alçada na prévia: {previa.alcadaNoPedido ?? 'não definida'}.</p>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmado} disabled={ocupado || bloqueado || (!!pendente && !podeReusarPendente)} onChange={(e) => setConfirmado(e.target.checked)} /><span>{podeReusarPendente ? 'Confirmo estas condições e o reenvio explícito com o mesmo identificador preservado.' : 'Confirmo a inscrição de exercício com estas condições exatas.'}</span></label>
        <button type="button" className={BTN} disabled={ocupado || bloqueado || (!!pendente && !podeReusarPendente) || !confirmado} onClick={() => void gerarInscricao()}>{podeReusarPendente ? 'Reenviar o mesmo pedido com estas condições' : 'Gerar previsto e inscrever exercício'}</button>
      </section>}
      {resultado && <section aria-label={reciboDivergente ? 'Recibo em conferência' : 'Inscrição confirmada'} className="space-y-3 rounded-lg border border-good/40 p-4">
        <h3 className="font-semibold">{reciboDivergente ? 'Recibo do pedido preservado' : reciboRecuperado ? 'Pedido recuperado' : 'Inscrição confirmada'}</h3><CondicoesDaInscricao condicoes={resultado.condicoes} />
        <p className="text-sm">Previsto · aguardando decisão. {reciboDivergente ? 'Estas são as condições gravadas; elas não confirmam a proposta local diferente.' : reciboRecuperado ? 'O servidor confirmou a inscrição deste pedido.' : 'Inscrição registrada.'}</p>
        <Link className="inline-flex min-h-11 items-center text-brand underline" href={'/financeiro/obrigacoes/' + encodeURIComponent(resultado.transactionId)}>Conferir obrigação e decidir</Link>
        <details className="text-xs text-muted"><summary className="cursor-pointer">Conferir recibo e origem</summary><p className="mt-2 break-all">Versão {resultado.versionId} · hash {resultado.contentHash}</p><p className="break-all">Pedido {resultado.requestId} · contrato {resultado.contractId}</p></details>
        {reciboDivergente && pendente && <button type="button" className={BTN} disabled={ocupado || bloqueado} onClick={concluirConferenciaDoRecibo}>Conferi o recibo real</button>}
        <button type="button" className={BTN} disabled={ocupado || bloqueado || !!pendente} onClick={novaInscricao}>Começar outra inscrição</button>
      </section>}
    </div>
  </details>;
}

function CondicoesDaInscricao({ condicoes: c }: { condicoes: FinanceiroGeracaoCondicoes }) {
  return <dl className="grid gap-2 text-sm sm:grid-cols-2">
    <div><dt className="text-muted">Descrição</dt><dd>{c.descricao}</dd></div><div><dt className="text-muted">Valor exato</dt><dd>{c.valorCanonico} · {c.tipo === 'entrada' ? 'a receber' : 'a pagar'}</dd></div>
    <div><dt className="text-muted">Competência / vencimento</dt><dd>{dia(c.competencia)} / {dia(c.vencimento)}</dd></div><div><dt className="text-muted">Conta manual</dt><dd>{c.conta.nome} · {c.conta.currency}</dd></div>
    <div><dt className="text-muted">Contraparte</dt><dd>{c.contraparte.razaoSocial}</dd></div><div><dt className="text-muted">Classificação</dt><dd>{c.classificacao.codigo} · {c.classificacao.nome}</dd></div>
    <div><dt className="text-muted">Contrato</dt><dd>{c.contrato.descricao} · {c.contrato.periodicidade}</dd></div><div><dt className="text-muted">Projeto / departamento</dt><dd>{c.projetoFinanceiro?.nome ?? 'Sem projeto'} / {c.departamento?.nome ?? 'Sem departamento'} · sem rateio</dd></div>
  </dl>;
}
