'use client';
import { useEffect, useRef, useState } from 'react';
import type { M05EscopoDto } from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { RecuperacaoIndisponivel, escopoConfere, chaveDoPedido, lerIdentificador, guardarIdentificador, removerIdentificador, migrarPedidoLegado, type IdentificadorDePedido } from '@/app/contexto/RetratoDaFonte';
interface Configuracao { escopo: M05EscopoDto; pessoas: { id: string; name: string }[]; modelo: { disponivel: boolean; modelo: string | null; motivo: string | null }; procedimentoSuportado: string }
interface Criacao { id: string; slug: string; repetido?: boolean; escopo: M05EscopoDto }
type Props = { token: string | null; pessoaId: string; aoCriar: (slug: string) => void; aoFechar: () => void };
const campos = 'mt-1 w-full rounded border border-border bg-bg px-2 py-2 text-sm';
const inicial = { nome: '', proposito: '', pilar: 'Operação', donoId: '', passos: 'Ler a versão escolhida da fonte\nPreparar um resumo com a versão identificada\nRegistrar o texto e o consumo observado', pronto: 'Resumo encontrado na execução, com fonte e versão identificadas.' };
export function CriarAgente(props: Props) { return <CriacaoAutorizada key={`${props.token}:${props.pessoaId}`} {...props} />; }
function CriacaoAutorizada({ token, pessoaId, aoCriar, aoFechar }: Props) {
  const [config, setConfig] = useState<Configuracao | null>(null), [form, setForm] = useState(inicial);
  const [pendente, setPendente] = useState<IdentificadorDePedido | null>(null), [confirmado, setConfirmado] = useState(false);
  const [erro, setErro] = useState<string | null>(null), [ocupado, setOcupado] = useState(false);
  const generation = useRef(0), input = useRef<Record<string, unknown> | null>(null), escopo = useRef<M05EscopoDto | null>(null), escrita = useRef(false);
  const callback = useRef(aoCriar); callback.current = aoCriar;
  function privar() { generation.current++; escrita.current = false; input.current = null; setConfig(null); setForm(inicial); setConfirmado(false); setOcupado(false); setErro('Criação não disponível para esta conta.'); }
  function aceitar(r: Criacao) {
    if (!escopo.current || !escopoConfere(r.escopo, pessoaId) || r.escopo.orgId !== escopo.current?.orgId || !r.id || !r.slug || r.escopo.agentId !== r.id || r.escopo.agentSlug !== r.slug) { privar(); return; }
    setConfirmado(true); input.current = null; setErro(null);
    const chave = chaveDoPedido(escopo.current, 'criacao'); removerIdentificador(chave);
    setPendente(lerIdentificador(chave, escopo.current, 'criacao')); callback.current(r.slug);
  }
  async function conferir(id: IdentificadorDePedido, atual = generation.current) {
    setOcupado(true); setErro(null);
    try { const r = await apiGet<Criacao>(`/agents/pedidos/${encodeURIComponent(id.requestId)}`, token); if (generation.current === atual) aceitar(r); }
    catch (e) { if (generation.current !== atual) return; if ([401, 403, 404].includes((e as { status?: number }).status ?? 0) || e instanceof RecuperacaoIndisponivel) { privar(); setPendente(id); } else setErro((e as Error).message); }
    finally { if (generation.current === atual) setOcupado(false); }
  }
  useEffect(() => {
    const atual = ++generation.current; setOcupado(true);
    apiGet<Configuracao>('/agents/configuracao', token).then(async (c) => {
      if (generation.current !== atual) return;
      if (!escopoConfere(c.escopo, pessoaId, escopo.current)) { privar(); return; }
      escopo.current = c.escopo; setConfig(c);
      const migrado = migrarPedidoLegado(`rootos:criar-agente:${pessoaId}`, chaveDoPedido(c.escopo, 'criacao'), c.escopo, 'criacao');
      const id = lerIdentificador(chaveDoPedido(c.escopo, 'criacao'), c.escopo, 'criacao') ?? migrado;
      if (id) { setPendente(id); await conferir(id, atual); }
    }).catch((e) => { if (generation.current !== atual) return; if ([401, 403, 404].includes(e.status) || e instanceof RecuperacaoIndisponivel) { privar(); if (e instanceof RecuperacaoIndisponivel) setErro(e.message); } else setErro(e.message); })
      .finally(() => { if (generation.current === atual) setOcupado(false); });
    return () => { generation.current++; };
  }, [token, pessoaId]);
  async function salvar(repetir = false) {
    if (!token || !config || !escopo.current || ocupado || escrita.current || confirmado || (!repetir && pendente)) return;
    const dados = repetir ? input.current : { requestId: crypto.randomUUID(), nome: form.nome, missao: form.proposito, pilar: form.pilar, donoId: form.donoId, modelo: config.modelo.disponivel ? config.modelo.modelo : null,
      procedimento: { proposito: form.proposito, gatilho: 'Sob demanda da pessoa autorizada, sem agendamento automático.', passos: form.passos.split('\n').map((p) => p.trim()).filter(Boolean), definicaoDePronto: form.pronto } };
    if (!dados) return;
    const id: IdentificadorDePedido = { ...escopo.current, requestId: dados.requestId as string, operation: 'criacao' };
    if (!guardarIdentificador(chaveDoPedido(escopo.current, 'criacao'), id)) { setErro('Não foi possível guardar o identificador. O pedido não foi enviado.'); return; }
    const atual = generation.current; input.current = dados; setPendente(id); escrita.current = true; setOcupado(true); setErro(null);
    try { const r = await apiPost<Criacao>('/agents', dados, token); if (generation.current === atual) aceitar(r); }
    catch (e) { if (generation.current !== atual) return; if ([401, 403, 404].includes((e as { status?: number }).status ?? 0) || e instanceof RecuperacaoIndisponivel) privar(); else setErro((e as Error).message); }
    finally { if (generation.current === atual) { escrita.current = false; setOcupado(false); } }
  }
  return <section role="dialog" aria-label="Criar agente local" className="rounded border border-border bg-surface p-4 space-y-3">
    <h2 className="text-lg">Criar agente</h2><p className="text-sm text-muted">O agente será salvo como planejado. Ativá-lo e executar são ações separadas.</p>
    {config && <><p className="text-sm">{config.procedimentoSuportado}</p><p className="text-sm">Modelo local: {config.modelo.disponivel ? config.modelo.modelo : config.modelo.motivo}</p></>}
    {erro && <p role="alert" className="text-bad">{erro}</p>}{confirmado && <p role="status">Criação confirmada no servidor.</p>}
    {pendente && <div className="space-y-2"><p role="status" className="text-sm">Pedido sem confirmação. Confira a criação original antes de iniciar outro agente.</p><button type="button" disabled={ocupado} className="text-brand" onClick={() => void conferir(pendente)}>Conferir criação</button>{input.current && <button type="button" disabled={ocupado} className="ml-3 text-brand" onClick={() => void salvar(true)}>Reenviar mesmo pedido</button>}</div>}
    <fieldset disabled={ocupado || !!pendente || !config || confirmado} className="space-y-3">
      <label className="block">Nome do agente<input className={campos} value={form.nome} maxLength={80} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></label>
      <label className="block">Propósito<input className={campos} value={form.proposito} maxLength={400} onChange={(e) => setForm({ ...form, proposito: e.target.value })} /></label>
      <label className="block">Área<input className={campos} value={form.pilar} maxLength={60} onChange={(e) => setForm({ ...form, pilar: e.target.value })} /></label>
      <label className="block">Responsável<select className={campos} value={form.donoId} onChange={(e) => setForm({ ...form, donoId: e.target.value })}><option value="">Escolha uma pessoa</option>{config?.pessoas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="block">Passos do procedimento<textarea className={campos} rows={4} value={form.passos} onChange={(e) => setForm({ ...form, passos: e.target.value })} /></label>
      <label className="block">Resultado esperado<textarea className={campos} value={form.pronto} onChange={(e) => setForm({ ...form, pronto: e.target.value })} /></label>
    </fieldset>
    <div className="flex gap-3">{!pendente && !confirmado && <button className="rounded bg-brand px-3 py-2 text-ink disabled:opacity-50" type="button" disabled={ocupado || !config || !form.donoId || form.nome.trim().length < 2 || form.proposito.trim().length < 10} onClick={() => void salvar()}>Salvar agente planejado</button>}<button type="button" onClick={aoFechar} disabled={ocupado}>Fechar</button></div>
  </section>;
}
