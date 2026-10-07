'use client';
import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost, ErroDaApi } from '@/lib/api';

interface Configuracao {
  pessoas: { id: string; name: string }[];
  modelo: { disponivel: boolean; modelo: string | null; motivo: string | null };
  procedimentoSuportado: string;
}
const campos = 'mt-1 w-full rounded border border-border bg-bg px-2 py-2 text-sm';
const inicial = { nome: '', proposito: '', pilar: 'Operação', donoId: '',
  passos: 'Ler a versão escolhida da fonte\nPreparar um resumo com a versão identificada\nRegistrar o texto e o consumo observado',
  pronto: 'Resumo encontrado na execução, com fonte e versão identificadas.' };
export function CriarAgente({ token, pessoaId, aoCriar, aoFechar }: {
  token: string | null; pessoaId: string; aoCriar: (slug: string) => void; aoFechar: () => void;
}) {
  const [config, setConfig] = useState<Configuracao | null>(null);
  const [form, setForm] = useState(inicial);
  const [pendente, setPendente] = useState<Record<string, unknown> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const generation = useRef(0);
  const storage = `rootos:criar-agente:${pessoaId}`;
  useEffect(() => {
    const atual = ++generation.current; let vivo = true; setConfig(null); setErro(null); setPendente(null); setForm(inicial);
    try { const p = JSON.parse(localStorage.getItem(storage) ?? 'null');
      if (p?.requestId && p?.nome && p?.donoId) { setPendente(p); setForm({ nome: p.nome, proposito: p.missao, pilar: p.pilar, donoId: p.donoId,
        passos: p.procedimento.passos.join('\n'), pronto: p.procedimento.definicaoDePronto }); }
    } catch { /* Dados incompletos não são enviados. */ }
    apiGet<Configuracao>('/agents/configuracao', token).then((c) => { if (vivo) setConfig(c); }).catch((e) => { if (vivo) setErro(e.message); });
    return () => { vivo = false; generation.current++; };
  }, [token, storage]);
  async function salvar() {
    const atual = generation.current;
    const input = pendente ?? { requestId: crypto.randomUUID(), nome: form.nome, missao: form.proposito, pilar: form.pilar,
      donoId: form.donoId, modelo: config?.modelo.disponivel ? config.modelo.modelo : null,
      procedimento: { proposito: form.proposito, gatilho: 'Sob demanda da pessoa autorizada, sem agendamento automático.',
        passos: form.passos.split('\n').map((p) => p.trim()).filter(Boolean), definicaoDePronto: form.pronto } };
    setPendente(input); localStorage.setItem(storage, JSON.stringify(input)); setOcupado(true); setErro(null);
    try { const r = await apiPost<{ slug: string }>('/agents', input, token); if (generation.current !== atual) return; localStorage.removeItem(storage); aoCriar(r.slug); }
    catch (e) { if (generation.current === atual) { setErro((e as Error).message); if (e instanceof ErroDaApi && e.status === 400) { setPendente(null); localStorage.removeItem(storage); } } }
    finally { if (generation.current === atual) setOcupado(false); }
  }
  return <section role="dialog" aria-label="Criar agente local" className="rounded border border-border bg-surface p-4 space-y-3">
    <h2 className="text-lg">Criar agente</h2>
    <p className="text-sm text-muted">O agente será salvo como planejado. Ativá-lo e executar são ações separadas.</p>
    {config && <><p className="text-sm">{config.procedimentoSuportado}</p>
      <p className="text-sm">Modelo local: {config.modelo.disponivel ? config.modelo.modelo : config.modelo.motivo}</p></>}
    {erro && <p role="alert" className="text-bad">{erro}</p>}
    {pendente && <p role="status" className="text-sm">Há um pedido de criação para conferir. Os campos foram preservados para reenviar o mesmo pedido.</p>}
    <fieldset disabled={ocupado || !!pendente} className="space-y-3">
      <label className="block">Nome do agente<input className={campos} value={form.nome} maxLength={80} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></label>
      <label className="block">Propósito<input className={campos} value={form.proposito} maxLength={400} onChange={(e) => setForm({ ...form, proposito: e.target.value })} /></label>
      <label className="block">Área<input className={campos} value={form.pilar} maxLength={60} onChange={(e) => setForm({ ...form, pilar: e.target.value })} /></label>
      <label className="block">Responsável<select className={campos} value={form.donoId} onChange={(e) => setForm({ ...form, donoId: e.target.value })}>
        <option value="">Escolha uma pessoa</option>{config?.pessoas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
      <label className="block">Passos do procedimento<textarea className={campos} rows={4} value={form.passos} onChange={(e) => setForm({ ...form, passos: e.target.value })} /></label>
      <label className="block">Resultado esperado<textarea className={campos} value={form.pronto} onChange={(e) => setForm({ ...form, pronto: e.target.value })} /></label>
    </fieldset>
    <div className="flex gap-3"><button className="rounded bg-brand px-3 py-2 text-ink disabled:opacity-50" type="button"
      disabled={ocupado || !config || !form.donoId || form.nome.trim().length < 2 || form.proposito.trim().length < 10}
      onClick={salvar}>{ocupado ? 'Conferindo…' : pendente ? 'Conferir criação' : 'Salvar agente planejado'}</button>
      <button type="button" onClick={aoFechar} disabled={ocupado}>Fechar</button>
    </div>
  </section>;
}
