'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { instanteNoFuso } from '@mktos/shared';
import { apiGet, ErroDaApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePedidoMarketing, type ReciboMarketing } from './pedido-recuperacao';
import { abrirAquiNoClique, useTarefaNaUrl } from '@/lib/tarefa-na-url';
import { TarefaFlutuante } from '@/components/trabalho/TrabalhoView';

type Account = { id: string; handle: string; ownerId: string; operators: string[]; revision: number; active: boolean; canPrepare: boolean; status: string; pending: string };
type Preparation = { id: string; accountId: string; handle: string; taskId: string; versionId: string; decisionId: string; contentHash: string; scheduledAt: string; timezone: string; state: string };
type Catalog = { accounts: Account[]; preparations: Preparation[]; qa: boolean };
type Config = { connections: { id: string; handle: string; status: string }[]; people: { id: string; name: string }[] };
const inputClass = 'w-full rounded border border-border bg-surface p-2';
const buttonClass = 'min-h-11 rounded border border-border px-3 py-2 disabled:opacity-40';
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const igualLista = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
function horario(diaHora: string, timezone: string) { return instanteNoFuso(diaHora.slice(0, 10), diaHora.slice(11, 16), timezone).toISOString(); }
function formatarHorario(iso: string, timezone: string) { return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: timezone }).format(new Date(iso)); }

export default function PreparacaoMarketingPage() {
  const { ready, token, user, can } = useAuth();
  if (!ready) return <p>Carregando…</p>;
  if (!token || !user || !can('pauta.ver')) return <p>Acesso insuficiente para Marketing.</p>;
  return <PreparacaoAutorizada key={user.id + ':' + token} actorId={user.id} token={token} can={can} />;
}
function PreparacaoAutorizada({ actorId, token, can }: { actorId: string; token: string; can: (p: string) => boolean }) {
  // Layout 26/10: "Abrir tarefa" abre o pop-up único da tarefa aqui mesmo, sem sair da Preparação.
  const popup = useTarefaNaUrl();
  const query = useSearchParams();
  const geracao = useRef(0), privada = useRef(false), viva = useRef(true);
  const [catalog, setCatalog] = useState<Catalog | null>(null), [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null), [acessoPerdido, setAcessoPerdido] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [accountId, setAccountId] = useState(''), [when, setWhen] = useState(''), [timezone, setTimezone] = useState('America/Sao_Paulo');
  const [connection, setConnection] = useState(''), [owner, setOwner] = useState(''), [operators, setOperators] = useState<string[]>([]);
  const [contaConfirmada, setContaConfirmada] = useState(false), [preparoConfirmado, setPreparoConfirmado] = useState(false);
  const mayConfigure = can('bio.editar') && can('admin.usuarios');
  const mayConsult = can('pauta.ver') && can('tarefas.ver');
  const mayPrepare = ['pauta.editar', 'pauta.publicar', 'tarefas.ver', 'tarefas.editar'].every(can);
  const fonte = { taskId: query.get('taskId') ?? '', versionId: query.get('versionId') ?? '', decisionId: query.get('decisionId') ?? '', contentHash: query.get('contentHash') ?? '' };
  const completeSource = uuid.test(fonte.taskId) && uuid.test(fonte.versionId) && uuid.test(fonte.decisionId) && /^[a-f0-9]{64}$/.test(fonte.contentHash);
  const selected = catalog?.accounts.find(a => a.id === accountId);
  function privar(e: unknown) {
    privada.current = true; ++geracao.current; setAcessoPerdido(true); setCatalog(null); setConfig(null);
    setAccountId(''); setWhen(''); setConnection(''); setOwner(''); setOperators([]); setContaConfirmada(false); setPreparoConfirmado(false);
    setError(e instanceof Error ? e.message : 'Marketing indisponível para esta conta.');
  }
  async function load() {
    if (!viva.current || privada.current) return;
    const g = ++geracao.current; setCarregando(true); setError(null);
    try {
      const c = await apiGet<Catalog>('/marketing/preparacao', token);
      if (!viva.current || privada.current || g !== geracao.current) return;
      if (!c || !Array.isArray(c.accounts) || !Array.isArray(c.preparations)) throw new Error('O catálogo de Marketing não pôde ser conferido.');
      setCatalog(c);
      if (mayConfigure) {
        const settings = await apiGet<Config>('/marketing/preparacao/configuracao', token);
        if (!viva.current || privada.current || g !== geracao.current) return;
        if (!settings || !Array.isArray(settings.connections) || !Array.isArray(settings.people)) throw new Error('A configuração de Marketing não pôde ser conferida.');
        setConfig(settings);
      }
    } catch (e) {
      if (!viva.current || privada.current || g !== geracao.current) return;
      setCatalog(null); setConfig(null); setError(e instanceof Error ? e.message : 'Não foi possível consultar Marketing.');
      if (e instanceof ErroDaApi && [401, 403].includes(e.status)) privar(e);
    } finally { if (viva.current && !privada.current && g === geracao.current) setCarregando(false); }
  }
  function confereConta(r: ReciboMarketing): boolean | null {
    if (r.tipo !== 'configuracao_conta' || (!connection && !owner && !operators.length)) return null;
    return r.conta.connectionId === connection && r.conta.ownerId === owner && igualLista(r.conta.operators, operators);
  }
  function conferePreparo(r: ReciboMarketing): boolean | null {
    if (r.tipo !== 'preparo' || (!accountId && !when)) return null;
    try { return completeSource && r.preparo.accountId === accountId && r.preparo.taskId === fonte.taskId
      && r.preparo.versionId === fonte.versionId && r.preparo.decisionId === fonte.decisionId && r.preparo.contentHash === fonte.contentHash
      && r.preparo.scheduledAt === horario(when, timezone) && r.preparo.timezone === timezone; }
    catch { return false; }
  }
  const conta = usePedidoMarketing({ tipo: 'configuracao_conta', actorId, token, permitido: mayConfigure,
    sessaoAtual: () => viva.current && !privada.current, onIndisponivel: privar, onAtualizar: () => void load(), confereProposta: confereConta });
  const preparo = usePedidoMarketing({ tipo: 'preparo', actorId, token, permitido: mayConsult,
    sessaoAtual: () => viva.current && !privada.current, onIndisponivel: privar, onAtualizar: () => void load(), confereProposta: conferePreparo });
  useEffect(() => { viva.current = true; void load(); return () => { viva.current = false; ++geracao.current; }; }, [actorId, token, mayConfigure]);
  useEffect(() => { setPreparoConfirmado(false); }, [fonte.taskId, fonte.versionId, fonte.decisionId, fonte.contentHash, selected?.revision]);
  const busy = conta.ocupado || preparo.ocupado;
  const travaConta = busy || conta.bloqueado || !!conta.recibo || !!conta.legado || (!!conta.pendente && !conta.podeReusar);
  const travaPreparo = busy || preparo.bloqueado || !!preparo.recibo || !!preparo.legado || (!!preparo.pendente && !preparo.podeReusar);
  async function configurar() {
    if (!mayConfigure || travaConta || !contaConfirmada || !config || !conta.escopo) return;
    if (!uuid.test(connection) || !uuid.test(owner) || operators.length > 30 || !operators.every(id => uuid.test(id))
      || !config.connections.some(c => c.id === connection) || !config.people.some(p => p.id === owner)
      || !operators.every(id => config.people.some(p => p.id === id))) { setError('Confira a conexão, o dono e os operadores disponíveis.'); return; }
    setContaConfirmada(false); await conta.enviar({ connectionId: connection, ownerId: owner, operators: [...operators] });
  }
  async function preparar() {
    if (!mayPrepare || travaPreparo || !preparoConfirmado || !selected?.canPrepare || !completeSource || !when || !preparo.escopo) return;
    try {
      const scheduledAt = horario(when, timezone);
      if (!Number.isInteger(selected.revision) || selected.revision < 1) throw new Error('A revisão da conta precisa ser conferida novamente.');
      setPreparoConfirmado(false); await preparo.enviar({ accountId, expectedAccountRevision: selected.revision, ...fonte, scheduledAt, timezone });
    } catch (e) { setError(e instanceof Error ? e.message : 'Confira data, hora e fuso do preparo.'); }
  }
  if (acessoPerdido) return <p role="alert">{error ?? 'O acesso a Marketing precisa ser conferido novamente.'}</p>;
  const sourceHref = fonte.taskId ? '/pauta/producao?taskId=' + encodeURIComponent(fonte.taskId) + (fonte.versionId ? '&versionId=' + encodeURIComponent(fonte.versionId) : '') : '/trabalho';
  const reciboConta = conta.recibo?.tipo === 'configuracao_conta' ? conta.recibo : null;
  const reciboPreparo = preparo.recibo?.tipo === 'preparo' ? preparo.recibo : null;
  return <div className="space-y-5">
    <h1 className="text-xl font-semibold">Contas e preparação de Marketing</h1>
    <p>Escolha a conta e o horário para uma versão aprovada. O preparo fica salvo; publicar exige a integração e a autorização da ação.</p>
    {catalog?.qa && <p className="text-warn">Ambiente local de QA. As contas desta prova são sintéticas.</p>}
    {error && <p role="alert" className="text-bad">{error}</p>}
    <button type="button" className={buttonClass} onClick={() => void load()} disabled={busy || carregando}>Conferir contas e preparos</button>
    {carregando && <p>Carregando contas…</p>}
    {catalog && <section aria-label="Contas disponíveis" className="space-y-2">
      <h2 className="font-semibold">Contas disponíveis</h2>
      {!catalog.accounts.length && <><p>Nenhuma conta foi concedida à sua pessoa.</p><p className="text-sm text-muted">{mayConfigure ? 'Confira as conexões disponíveis e defina dono e operadores na seção abaixo.' : 'Uma pessoa com acesso de configuração precisa conceder o destino à sua conta.'}</p></>}
      {catalog.accounts.map(a => <div className="rounded border border-border p-3" key={a.id}><p>@{a.handle} · {a.canPrepare ? 'disponível para preparar' : 'preparo indisponível'}</p><p className="text-sm">{a.pending}</p></div>)}
    </section>}
    {mayConfigure && <section aria-label="Configurar dono e operadores" className="space-y-3 rounded border border-border p-4">
      <h2 className="font-semibold">Dono e operadores da conexão</h2>
      <EstadoDoPedido pedido={conta} busy={busy} />
      {reciboConta && <section aria-label="Configuração recuperada" className="space-y-2 rounded border border-border p-3">
        <h3 className="font-medium">Pedido de configuração confirmado</h3>
        {conta.divergente && <p className="text-warn">O recibo real difere dos campos locais; ele não confirma essa proposta diferente.</p>}
        <p>@{reciboConta.conta.handle} · conexão {reciboConta.conta.connectionId}</p>
        <p className="text-sm">Dono: {config?.people.find(p => p.id === reciboConta.conta.ownerId)?.name ?? reciboConta.conta.ownerId}. Operadores: {reciboConta.conta.operators.map(id => config?.people.find(p => p.id === id)?.name ?? id).join(', ') || 'nenhum'}.</p>
        <p className="text-sm">Estado atual da configuração: revisão {reciboConta.conta.revision} · {reciboConta.conta.active ? 'ativa' : 'inativa'}.</p>
        <p className="text-sm">Disponibilidade por registro local: conta {reciboConta.disponibilidadeAtual.contaAtiva ? 'ativa' : 'inativa'} · conexão {reciboConta.disponibilidadeAtual.conexaoCorrespondente ? 'correspondente' : 'não corresponde'} · {reciboConta.disponibilidadeAtual.conexaoAptaPorRegistroLocal ? 'apta no cadastro' : 'não apta no cadastro'}. Nenhuma verificação externa foi feita nesta consulta.</p>
        <button type="button" className={buttonClass} disabled={busy || conta.bloqueado} onClick={() => { conta.concluirConferencia(); setContaConfirmada(false); }}>Conferi a configuração recuperada</button>
      </section>}
      {config && <>
        {!config.connections.length && <p className="text-sm text-muted">Não há conexões Instagram disponíveis para configurar. Primeiro é necessária uma conexão autorizada; o cadastro de dono e operadores não conecta o provedor.</p>}
        <label className="block">Conexão Instagram<select aria-label="Conexão Instagram" className={inputClass} value={connection} onChange={e => { setConnection(e.target.value); setContaConfirmada(false); }} disabled={travaConta}><option value="">Selecione</option>{config.connections.map(c => <option key={c.id} value={c.id}>@{c.handle}</option>)}</select></label>
        <label className="block">Dono da conta<select aria-label="Dono da conta" className={inputClass} value={owner} onChange={e => { setOwner(e.target.value); setContaConfirmada(false); }} disabled={travaConta}><option value="">Selecione</option>{config.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="block">Operadores da conta<select multiple aria-label="Operadores da conta" className={inputClass} value={operators} onChange={e => { setOperators(Array.from(e.target.selectedOptions, v => v.value)); setContaConfirmada(false); }} disabled={travaConta}>{config.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={contaConfirmada} onChange={e => setContaConfirmada(e.target.checked)} disabled={travaConta || !connection || !owner} />{conta.podeReusar ? 'Confirmo a configuração e o reenvio explícito com o mesmo pedido preservado.' : 'Confirmo esta conexão, dono e operadores.'}</label>
        <button type="button" className={buttonClass} onClick={() => void configurar()} disabled={travaConta || !conta.escopo || !contaConfirmada || !connection || !owner}>{conta.podeReusar ? 'Reenviar o mesmo pedido de configuração' : 'Salvar dono e operadores'}</button>
      </>}
    </section>}
    {mayConsult && <section aria-label="Pedido de preparo" className="space-y-3"><EstadoDoPedido pedido={preparo} busy={busy} />
      {reciboPreparo && <section aria-label="Preparo recuperado" className="space-y-2 rounded border border-border p-3">
        <h2 className="font-medium">Pedido de preparo confirmado</h2>
        {preparo.divergente && <p className="text-warn">Este é o preparo real do pedido preservado. Ele difere da proposta local e não confirma esses campos diferentes.</p>}
        <p>@{reciboPreparo.preparo.handle} · {formatarHorario(reciboPreparo.preparo.scheduledAt, reciboPreparo.preparo.timezone)} · {reciboPreparo.preparo.timezone}</p>
        <p className="text-sm">Versão e decisão preservadas. Revisão da conta usada no preparo: {reciboPreparo.preparo.accountRevision}.</p>
        <p className="text-sm">Estado atual por registro local: conta {reciboPreparo.disponibilidadeAtual.contaAtiva ? 'ativa' : 'inativa'} · conexão {reciboPreparo.disponibilidadeAtual.conexaoAptaPorRegistroLocal ? 'apta no cadastro' : 'não apta no cadastro'} · material {reciboPreparo.disponibilidadeAtual.materialNaVersaoSelecionada ? 'na versão selecionada' : 'em outra versão'} · decisão {reciboPreparo.disponibilidadeAtual.decisaoPreservadaAprovada ? 'preservada como aprovada' : 'não aprovada atualmente'}.</p>
        <p className="text-sm">A consulta não verifica nova preparação nem conexão externa. Publicação e métricas não foram executadas.</p>
        <Link className="underline" href={'/pauta/producao?taskId=' + encodeURIComponent(reciboPreparo.preparo.taskId) + '&versionId=' + encodeURIComponent(reciboPreparo.preparo.versionId)}>Abrir versão preparada</Link>
        <details className="text-xs"><summary className="cursor-pointer">Conferir origem</summary><p className="break-all">Decisão {reciboPreparo.preparo.decisionId} · hash {reciboPreparo.preparo.contentHash}</p></details>
        <button type="button" className={buttonClass} disabled={busy || preparo.bloqueado} onClick={() => { preparo.concluirConferencia(); setPreparoConfirmado(false); }}>Conferi o preparo recuperado</button>
      </section>}
    </section>}
    {mayPrepare && catalog && completeSource && <form aria-label="Preparar versão para a conta" className="space-y-3" onSubmit={e => { e.preventDefault(); void preparar(); }}>
      <h2 className="font-semibold">Preparar versão aprovada</h2>
      <label className="block">Conta de destino<select aria-label="Conta de destino" className={inputClass} value={accountId} onChange={e => { setAccountId(e.target.value); setPreparoConfirmado(false); }} disabled={travaPreparo}><option value="">Selecione</option>{catalog.accounts.map(a => <option value={a.id} key={a.id} disabled={!a.canPrepare}>@{a.handle}</option>)}</select></label>
      <label className="block">Horário de preparo<input aria-label="Horário de preparo" type="datetime-local" className={inputClass} value={when} onChange={e => { setWhen(e.target.value); setPreparoConfirmado(false); }} disabled={travaPreparo} /></label>
      <label className="block">Fuso horário<select aria-label="Fuso horário" className={inputClass} value={timezone} onChange={e => { setTimezone(e.target.value); setPreparoConfirmado(false); }} disabled={travaPreparo}><option>America/Sao_Paulo</option><option>America/Manaus</option><option>UTC</option></select></label>
      <p className="text-sm text-muted">A confirmação usa a tarefa, versão e decisão trazidas pelo material aprovado. O servidor reconfere a origem e a revisão da conta.</p>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={preparoConfirmado} onChange={e => setPreparoConfirmado(e.target.checked)} disabled={travaPreparo || !selected?.canPrepare || !when} />{preparo.podeReusar ? 'Confirmo este destino e horário e o reenvio explícito do mesmo pedido.' : 'Confirmo este destino e horário para a versão aprovada.'}</label>
      <button type="submit" className={buttonClass} disabled={travaPreparo || !preparo.escopo || !selected?.canPrepare || !when || !preparoConfirmado}>{preparo.podeReusar ? 'Reenviar o mesmo pedido de preparo' : 'Salvar preparo'}</button>
    </form>}
    {catalog && !completeSource && <section aria-label="Escolher versão para o preparo" className="space-y-3 rounded border border-border p-4"><h2 className="font-semibold">Comece pela versão aprovada</h2><p className="text-sm text-muted">Abra o material de uma tarefa, confira a aprovação e escolha “Preparar conta e horário”. Esse caminho traz a tarefa, a versão e a decisão corretas.</p>{can('tarefas.ver') ? <Link href={sourceHref} className="inline-flex min-h-11 items-center rounded border border-brand-dim px-3 text-sm text-brand">{fonte.taskId ? 'Abrir material da tarefa' : 'Escolher tarefa em Trabalho'}</Link> : <p className="text-sm text-muted">Sua conta também precisa de acesso a Trabalho para escolher a tarefa.</p>}</section>}
    {catalog && !mayPrepare && <p className="text-sm text-muted">Sua conta pode consultar os preparos. Salvar um preparo exige acesso para editar e publicar na Pauta e editar a tarefa.</p>}
    {catalog && <section aria-label="Preparos salvos" className="space-y-2"><h2 className="font-semibold">Preparos salvos</h2>{!catalog.preparations.length && <p className="text-sm text-muted">Nenhum preparo salvo está disponível para sua conta.</p>}{catalog.preparations.map(p => <article key={p.id} className="rounded border border-border p-3"><p>@{p.handle} · {formatarHorario(p.scheduledAt, p.timezone)} · {p.timezone}</p><p>Preparado. Publicação e métricas externas pendentes.</p><Link className="underline" href={'/pauta/producao?taskId=' + encodeURIComponent(p.taskId) + '&versionId=' + encodeURIComponent(p.versionId)}>Abrir versão preparada</Link>{' · '}<Link className="underline" href={'/trabalho?tarefa=' + encodeURIComponent(p.taskId)} onClick={abrirAquiNoClique(popup.abrir, p.taskId)}>Abrir tarefa</Link></article>)}</section>}
    <TarefaFlutuante tarefa={popup} />
  </div>;
}
function EstadoDoPedido({ pedido: p, busy }: { pedido: ReturnType<typeof usePedidoMarketing>; busy: boolean }) {
  return <div className="space-y-2">
    {p.erro && <p role="alert" className="text-bad">{p.erro}</p>}{p.aviso && <p role="status" className="text-sm">{p.aviso}</p>}
    {!p.escopo && !p.bloqueado && <p className="text-sm text-muted">Conferindo empresa e pessoa da sessão…</p>}
    {p.pendente && <div className="space-y-2 rounded border border-warn/40 p-3"><p className="text-sm">Pedido preservado neste escopo. A consulta abaixo não reenviará o pedido.</p><p className="break-all text-xs">Pedido {p.pendente.requestId}</p><button type="button" className={buttonClass} disabled={busy || p.bloqueado || !p.escopo} onClick={() => void p.recuperar()}>Conferir pedido preservado</button></div>}
    {p.legado && <div className="space-y-2 rounded border border-warn/40 p-3"><p className="text-sm">Pedido antigo preservado. A empresa de origem precisa ser conferida pelo recibo; seus campos antigos não serão reenviados.</p><p className="break-all text-xs">Pedido antigo {p.legado}</p><button type="button" className={buttonClass} disabled={busy || p.bloqueado || !p.escopo} onClick={() => void p.recuperar(true)}>Conferir ID antigo</button></div>}
  </div>;
}
