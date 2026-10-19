'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  type ConversaResumo,
  type FiltroDeConversa,
  type MensagemDaConversa,
  ROTULO_DO_ENVIO,
  envioComProblema,
} from '@mktos/shared';
import { apiBlob, apiGet, apiPatch, apiPost, apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * DIA A DIA › CONVERSAS: a caixa de atendimento por WhatsApp (19/10/2026).
 *
 * Adaptada do inbox do FinOps (`ChatPage`, `useChat`, `useVirarTarefa`). A
 * diferença que a tela precisa dizer sem rodeio: RESPONDER NÃO SAI NO CLIQUE.
 * A resposta é R3 — vai para Aprovações e só sai quando OUTRA pessoa assina.
 * Os tiques separam aceita pelo WhatsApp (✓), entregue (✓✓) e lida (✓✓ no acento).
 */

interface Lista { total: number; pagina: number; porPagina: number; totalNaoLidas: number; conversas: ConversaResumo[] }
interface Historico { mensagens: MensagemDaConversa[]; temMais: boolean; antes: string | null }
interface Apoio { pessoas: { id: string; nome: string }[]; clientes: { id: string; nome: string }[]; areas: { id: string; nome: string }[] }
interface Estado { ativo: boolean; whatsapp: boolean }
type Retida = { approvalId: string; mensagem: string; fila: string } | null;
type AvisoDeTarefa = { tipo: string; tarefa?: { id: string; titulo: string }; motivo?: string };

const FILTROS: { k: FiltroDeConversa; rotulo: string }[] = [
  { k: 'todas', rotulo: 'Abertas' },
  { k: 'minhas', rotulo: 'Minhas' },
  { k: 'sem_responsavel', rotulo: 'Sem responsável' },
  { k: 'sem_cliente', rotulo: 'Sem cliente' },
  { k: 'grupos', rotulo: 'Grupos' },
  { k: 'encerradas', rotulo: 'Encerradas' },
];
const inputCls = 'w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand-dim';

const hora = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  return mesmoDia
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
};
const novoId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

export default function ConversasPage() {
  const { token, ready, can } = useAuth();
  const podeResponder = can('atendimento.responder');
  const podeConfigurar = can('atendimento.configurar');
  const podeTarefa = podeResponder && can('tarefas.editar');

  const [estado, setEstado] = useState<Estado | null>(null);
  const [filtro, setFiltro] = useState<FiltroDeConversa>('todas');
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState<Lista | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [apoio, setApoio] = useState<Apoio | null>(null);

  const carregarLista = useCallback(async () => {
    if (!token) return;
    try {
      const q = new URLSearchParams({ filtro });
      if (busca.trim()) q.set('busca', busca.trim());
      setLista(await apiGet<Lista>(`/atendimento/conversas?${q}`, token));
    } catch (e) { setErro((e as Error).message); }
  }, [token, filtro, busca]);

  useEffect(() => {
    if (!ready || !token) return;
    apiGet<Estado>('/atendimento/estado', token).then(setEstado).catch((e) => setErro(e.message));
    apiGet<Apoio>('/atendimento/apoio', token).then(setApoio).catch(() => setApoio({ pessoas: [], clientes: [], areas: [] }));
  }, [ready, token]);
  useEffect(() => { if (estado?.ativo) carregarLista(); }, [estado?.ativo, carregarLista]);
  // Sem tempo real: confere a cada 20 s, como o FinOps fazia com as não lidas.
  useEffect(() => {
    if (!estado?.ativo) return;
    const t = window.setInterval(carregarLista, 20_000);
    return () => window.clearInterval(t);
  }, [estado?.ativo, carregarLista]);

  const ligar = async (ativo: boolean) => {
    if (!token) return;
    try { setEstado(await apiPut<Estado>('/atendimento/ajuste', { ativo }, token)); }
    catch (e) { setErro((e as Error).message); }
  };

  if (!estado) return <div className="com-tema mx-auto max-w-[1240px] text-muted">{erro ?? 'Carregando…'}</div>;

  if (!estado.ativo) {
    return (
      <div className="com-tema mx-auto max-w-[720px] space-y-4 text-text">
        <h1 className="text-xl font-semibold">A caixa de conversas está desligada</h1>
        <p className="text-muted">
          Ligada, ela guarda as mensagens que chegam no WhatsApp da empresa, mostra de quem é cada conversa e deixa
          responder. Cada resposta sai só depois que outra pessoa assinar em Aprovações. Nenhuma resposta é automática.
        </p>
        {!estado.whatsapp && <p className="text-bad">O WhatsApp (Evolution) não está configurado nesta instalação.</p>}
        {podeConfigurar
          ? <button onClick={() => ligar(true)} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-bg">Ligar a caixa</button>
          : <p className="text-sm text-muted">Peça a quem administra a empresa para ligar.</p>}
        {erro && <p className="text-sm text-bad">{erro}</p>}
      </div>
    );
  }

  const selecionada = lista?.conversas.find((c) => c.id === aberta) ?? null;

  return (
    <div className="com-tema mx-auto max-w-[1240px] space-y-4 text-text">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-[1.05rem]">
          {lista
            ? lista.totalNaoLidas > 0
              ? <><span className="com-num font-semibold text-brand">{lista.totalNaoLidas}</span> {lista.totalNaoLidas === 1 ? 'mensagem esperando' : 'mensagens esperando'} leitura</>
              : 'Nenhuma mensagem esperando leitura.'
            : 'Carregando conversas…'}
        </p>
        {podeConfigurar && (
          <button onClick={() => { if (window.confirm('Desligar a caixa? As conversas guardadas continuam, mas nada novo entra.')) ligar(false); }}
            className="text-sm text-muted hover:text-text">desligar a caixa</button>
        )}
      </div>
      {erro && <p className="text-sm text-bad" role="alert">{erro} <button className="underline" onClick={() => setErro(null)}>fechar</button></p>}

      <div className="grid gap-4 md:grid-cols-[340px_1fr]">
        <aside className={`${aberta ? 'hidden md:block' : ''} space-y-3`}>
          <input className={inputCls} placeholder="Buscar nome, cliente ou número" value={busca}
            onChange={(e) => setBusca(e.target.value)} aria-label="Buscar conversa" />
          <div className="flex flex-wrap gap-1">
            {FILTROS.map((f) => (
              <button key={f.k} onClick={() => setFiltro(f.k)}
                className={`rounded-full border px-2.5 py-1 text-xs ${filtro === f.k ? 'border-brand text-text' : 'border-border text-muted hover:text-text'}`}>
                {f.rotulo}
              </button>
            ))}
          </div>
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {lista?.conversas.length === 0 && <li className="p-4 text-sm text-muted">Nenhuma conversa aqui.</li>}
            {lista?.conversas.map((c) => (
              <li key={c.id}>
                <button onClick={() => setAberta(c.id)}
                  className={`flex w-full gap-3 px-3 py-2.5 text-left hover:bg-surface-2 ${aberta === c.id ? 'bg-surface-2' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`truncate ${c.naoLidas ? 'font-semibold' : ''}`}>{c.nome}</span>
                      <span className="com-num shrink-0 text-xs text-muted">{hora(c.ultimaMensagemEm)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm text-muted">{c.previa ?? '—'}</span>
                      {c.naoLidas > 0 && <span className="com-num rounded-full bg-brand px-1.5 text-xs font-semibold text-bg">{c.naoLidas}</span>}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted">
                      {c.cliente ? c.cliente.nome : 'sem cliente'} · {c.responsavel ? c.responsavel.nome.split(' ')[0] : 'sem responsável'}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {lista && lista.total > lista.conversas.length && (
            <p className="text-xs text-muted">Mostrando as {lista.conversas.length} mais recentes de {lista.total}.</p>
          )}
        </aside>

        <section className={aberta ? '' : 'hidden md:block'}>
          {selecionada && token
            ? <Conversa key={selecionada.id} resumo={selecionada} token={token} apoio={apoio}
                podeResponder={podeResponder} podeTarefa={podeTarefa}
                voltar={() => setAberta(null)} mudou={carregarLista} />
            : <div className="rounded-xl border border-dashed border-border p-8 text-center text-muted">Escolha uma conversa.</div>}
        </section>
      </div>
    </div>
  );
}

function Conversa({ resumo, token, apoio, podeResponder, podeTarefa, voltar, mudou }: {
  resumo: ConversaResumo; token: string; apoio: Apoio | null; podeResponder: boolean; podeTarefa: boolean;
  voltar: () => void; mudou: () => void;
}) {
  const [c, setC] = useState(resumo);
  const [h, setH] = useState<Historico | null>(null);
  const [texto, setTexto] = useState('');
  const [pendente, setPendente] = useState<{ id: string; texto: string } | null>(null);
  const [retida, setRetida] = useState<Retida>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tarefaDe, setTarefaDe] = useState<MensagemDaConversa | null>(null);
  const fim = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    try {
      const x = await apiGet<Historico>(`/atendimento/conversas/${resumo.id}/mensagens`, token);
      setH((antigo) => {
        if (!antigo) return x;
        // Mantém as páginas mais antigas já abertas.
        const ids = new Set(x.mensagens.map((m) => m.id));
        return { ...x, mensagens: [...antigo.mensagens.filter((m) => !ids.has(m.id) && m.momento < (x.mensagens[0]?.momento ?? '')), ...x.mensagens], temMais: antigo.temMais && x.temMais, antes: antigo.antes ?? x.antes };
      });
    } catch (e) { setErro((e as Error).message); }
  }, [resumo.id, token]);

  useEffect(() => {
    carregar().then(() => fim.current?.scrollIntoView({ block: 'end' }));
    apiPost(`/atendimento/conversas/${resumo.id}/lida`, {}, token).then(mudou).catch(() => {});
    const t = window.setInterval(carregar, 10_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumo.id]);

  const anteriores = async () => {
    if (!h?.antes) return;
    const x = await apiGet<Historico>(`/atendimento/conversas/${resumo.id}/mensagens?antes=${encodeURIComponent(h.antes)}`, token);
    setH({ mensagens: [...x.mensagens, ...h.mensagens], temMais: x.temMais, antes: x.antes });
  };

  const editar = async (mudanca: Record<string, unknown>) => {
    try { setC(await apiPatch<ConversaResumo>(`/atendimento/conversas/${c.id}`, mudanca, token)); mudou(); }
    catch (e) { setErro((e as Error).message); }
  };
  const encerrar = async () => {
    try {
      setC(await apiPost<ConversaResumo>(`/atendimento/conversas/${c.id}/${c.encerrada ? 'reabrir' : 'encerrar'}`, { versao: c.versao }, token));
      mudou();
    } catch (e) {
      setErro((e as Error).message);
      setC(await apiGet<ConversaResumo>(`/atendimento/conversas/${c.id}`, token));
    }
  };

  /** Mandar de novo usa o MESMO id: a API devolve a mesma resposta em vez de criar outra. */
  const responder = async (p: { id: string; texto: string }) => {
    setPendente(p); setErro(null);
    try {
      const r = await apiPost<{ retida: Retida }>(`/atendimento/conversas/${c.id}/responder`, { texto: p.texto, clienteMensagemId: p.id }, token);
      setRetida(r.retida); setPendente(null); setTexto('');
      await carregar(); mudou();
      fim.current?.scrollIntoView({ block: 'end' });
    } catch (e) {
      setErro(`Não foi: ${(e as Error).message}`);
      await carregar();
    }
  };

  const problema = h ? envioComProblema(h.mensagens) : false;

  return (
    <div className="flex h-[calc(100vh-11rem)] min-h-[480px] flex-col rounded-xl border border-border bg-surface">
      <header className="space-y-2 border-b border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <button onClick={voltar} className="text-muted md:hidden" aria-label="Voltar para a lista">←</button>
            <h2 className="truncate text-[1.05rem] font-semibold">{c.nome}</h2>
            {c.telefoneFinal && <span className="com-num text-xs text-muted">final {c.telefoneFinal}</span>}
            {c.encerrada && <span className="com-rotulo">encerrada</span>}
          </div>
          {podeResponder && (
            <button onClick={encerrar} className="shrink-0 rounded-lg border border-border px-3 py-1 text-sm hover:border-brand">
              {c.encerrada ? 'Reabrir' : 'Encerrar'}
            </button>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-muted">Cliente
            <select disabled={!podeResponder} className={inputCls} value={c.cliente?.id ?? ''}
              onChange={(e) => editar({ clienteId: e.target.value || null })}>
              <option value="">— sem cliente —</option>
              {apoio?.clientes.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted">Responsável
            <select disabled={!podeResponder} className={inputCls} value={c.responsavel?.id ?? ''}
              onChange={(e) => editar({ responsavelId: e.target.value || null })}>
              <option value="">— ninguém —</option>
              {apoio?.pessoas.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select>
          </label>
        </div>
      </header>

      {problema && (
        <p className="border-b border-border bg-surface-2 px-3 py-2 text-sm text-bad" role="alert">
          O WhatsApp não está aceitando as respostas: duas falharam nos últimos 15 minutos. Confira Integrações antes de insistir.
        </p>
      )}

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {h?.temMais && <button onClick={anteriores} className="mx-auto block text-sm text-muted hover:text-text">mensagens anteriores</button>}
        {h?.mensagens.map((m) => (
          <Bolha key={m.id} m={m} token={token} podeTarefa={podeTarefa} virarTarefa={() => setTarefaDe(m)} grupo={c.grupo} />
        ))}
        {h && h.mensagens.length === 0 && <p className="text-center text-sm text-muted">Sem mensagens guardadas.</p>}
        <div ref={fim} />
      </div>

      {retida && (
        <div className="border-t border-border bg-surface-2 px-3 py-2 text-sm">
          A resposta foi para <Link href={retida.fila} className="text-brand underline">Aprovações</Link> e sai quando outra pessoa assinar.
          Nada foi enviado ainda. <button className="text-muted underline" onClick={() => setRetida(null)}>ok</button>
        </div>
      )}
      {erro && (
        <div className="border-t border-border px-3 py-2 text-sm text-bad" role="alert">
          {erro}{' '}
          {pendente && <button className="underline" onClick={() => responder(pendente)}>tentar de novo</button>}
        </div>
      )}

      {podeResponder ? (
        <form className="flex gap-2 border-t border-border p-3"
          onSubmit={(e) => { e.preventDefault(); const t = texto.trim(); if (t) responder(pendente?.texto === t ? pendente : { id: novoId(), texto: t }); }}>
          <textarea className={`${inputCls} min-h-[44px] flex-1 resize-y`} rows={2} maxLength={4096} value={texto}
            onChange={(e) => setTexto(e.target.value)} placeholder="Escreva a resposta. Ela vai para assinatura antes de sair."
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit(); }} />
          <button type="submit" disabled={!texto.trim() || (!!pendente && !erro)}
            className="self-end rounded-lg bg-brand px-4 py-2 text-sm font-medium text-bg disabled:opacity-50">
            Pedir envio
          </button>
        </form>
      ) : (
        <p className="border-t border-border p-3 text-sm text-muted">Você pode ler. Responder pede a permissão de atendimento.</p>
      )}

      {tarefaDe && apoio && (
        <VirarTarefa m={tarefaDe} token={token} apoio={apoio} fechar={() => setTarefaDe(null)} pronto={() => { setTarefaDe(null); carregar(); }} />
      )}
    </div>
  );
}

function Tiques({ m }: { m: MensagemDaConversa }) {
  if (m.direcao !== 'saida' || !m.statusEnvio) return null;
  const s = m.statusEnvio;
  const marca = s === 'aceita' ? '✓' : s === 'entregue' || s === 'lida' ? '✓✓' : s === 'erro' ? '!' : '…';
  const cor = s === 'lida' ? 'text-brand' : s === 'erro' ? 'text-bad' : 'text-muted';
  return (
    <span className={`text-xs ${cor}`} title={ROTULO_DO_ENVIO[s]}>
      <span aria-hidden>{marca}</span> {ROTULO_DO_ENVIO[s]}
    </span>
  );
}

function Bolha({ m, token, podeTarefa, virarTarefa, grupo }: {
  m: MensagemDaConversa; token: string; podeTarefa: boolean; virarTarefa: () => void; grupo: boolean;
}) {
  const nossa = m.direcao === 'saida';
  return (
    <div className={`flex ${nossa ? 'justify-end' : 'justify-start'}`}>
      <div className={`group max-w-[85%] rounded-xl border px-3 py-2 ${nossa ? 'border-brand-dim bg-surface-2' : 'border-border bg-bg'}`}>
        {(grupo && !nossa && m.remetenteNome) && <div className="text-xs font-medium text-muted">{m.remetenteNome}</div>}
        {nossa && <div className="text-xs text-muted">{m.autor ?? m.remetenteNome ?? 'equipe'}</div>}
        {m.apagada
          ? <p className="text-sm italic text-muted">mensagem apagada</p>
          : <>
              {m.anexo && <Anexo m={m} token={token} />}
              {m.texto && <p className="whitespace-pre-wrap break-words text-[0.95rem]">{m.texto}</p>}
            </>}
        <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
          {m.tarefaId
            ? <Link href={`/dia-a-dia?tarefa=${m.tarefaId}`} className="text-xs text-brand">virou tarefa</Link>
            : podeTarefa && !m.apagada && (
                <button onClick={virarTarefa} className="text-xs text-muted opacity-70 hover:text-text group-hover:opacity-100">virar tarefa</button>
              )}
          <span className="com-num text-xs text-muted">{hora(m.momento)}</span>
          <Tiques m={m} />
        </div>
        {m.statusEnvio === 'erro' && m.erroEnvio && <p className="mt-1 text-xs text-bad">{m.erroEnvio}</p>}
      </div>
    </div>
  );
}

/** O anexo vem da API com o token (o MinIO não é público) e vira endereço local. */
function Anexo({ m, token }: { m: MensagemDaConversa; token: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);
  const a = m.anexo!;
  const guardado = a.situacao === 'guardado';
  useEffect(() => {
    if (!guardado || !(a.tipo?.startsWith('image/') || a.tipo?.startsWith('audio/'))) return;
    let local: string | null = null;
    apiBlob(`/atendimento/mensagens/${m.id}/anexo`, token)
      .then((b) => { local = URL.createObjectURL(b); setUrl(local); })
      .catch(() => setFalhou(true));
    return () => { if (local) URL.revokeObjectURL(local); };
  }, [m.id, token, guardado, a.tipo]);

  const baixar = async () => {
    try {
      const b = await apiBlob(`/atendimento/mensagens/${m.id}/anexo`, token);
      const u = URL.createObjectURL(b);
      window.open(u, '_blank', 'noopener');
      window.setTimeout(() => URL.revokeObjectURL(u), 60_000);
    } catch { setFalhou(true); }
  };

  if (!guardado || falhou) {
    const motivo = a.situacao === 'recusado' ? 'arquivo recusado (tipo ou tamanho)' : a.situacao === 'pendente' ? 'baixando o arquivo…' : 'o arquivo não pôde ser guardado';
    return <p className="text-xs text-muted">[{m.tipo}] {a.nome ?? ''} · {motivo}</p>;
  }
  if (url && a.tipo?.startsWith('image/')) return <img src={url} alt={a.nome ?? 'imagem recebida'} className="mb-1 max-h-72 rounded-lg" />;
  if (url && a.tipo?.startsWith('audio/')) return <audio controls src={url} className="mb-1 max-w-full" />;
  return (
    <button onClick={baixar} className="mb-1 text-sm text-brand underline">
      {a.nome ?? `abrir ${m.tipo}`}{a.tamanho ? ` (${Math.max(1, Math.round(a.tamanho / 1024))} KB)` : ''}
    </button>
  );
}

function VirarTarefa({ m, token, apoio, fechar, pronto }: {
  m: MensagemDaConversa; token: string; apoio: Apoio; fechar: () => void; pronto: () => void;
}) {
  const [titulo, setTitulo] = useState((m.texto ?? '').split('\n')[0].slice(0, 120));
  const [areaId, setAreaId] = useState(apoio.areas[0]?.id ?? '');
  const [pessoaId, setPessoaId] = useState('');
  const [prazo, setPrazo] = useState('');
  const [aviso, setAviso] = useState<AvisoDeTarefa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [indo, setIndo] = useState(false);

  const criar = async (confirmar: boolean) => {
    setIndo(true); setErro(null);
    try {
      const r = await apiPost<{ criada: boolean; tarefaId: string | null; aviso: AvisoDeTarefa | null }>(
        `/atendimento/mensagens/${m.id}/tarefa`,
        { titulo, areaId, pessoaId: pessoaId || null, prazo: prazo || null, ...(confirmar ? { confirmar: true } : {}) },
        token,
      );
      if (r.tarefaId) pronto();
      else setAviso(r.aviso);
    } catch (e) { setErro((e as Error).message); }
    finally { setIndo(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-label="Virar tarefa">
      <div className="w-full max-w-md space-y-3 rounded-xl border border-border bg-surface p-4">
        <h3 className="font-semibold">Virar tarefa</h3>
        <p className="line-clamp-3 text-sm text-muted">“{m.texto ?? `[${m.tipo}]`}”</p>
        <input className={inputCls} value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={300} aria-label="Título" />
        <div className="grid grid-cols-2 gap-2">
          <select className={inputCls} value={areaId} onChange={(e) => setAreaId(e.target.value)} aria-label="Área">
            {apoio.areas.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
          </select>
          <input type="date" className={inputCls} value={prazo} onChange={(e) => setPrazo(e.target.value)} aria-label="Prazo" />
        </div>
        <select className={inputCls} value={pessoaId} onChange={(e) => setPessoaId(e.target.value)} aria-label="Pessoa">
          <option value="">— sem pessoa —</option>
          {apoio.pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
        {aviso && (
          <p className="text-sm">
            {aviso.tipo === 'parecida'
              ? <>Já existe uma tarefa parecida: <b>{aviso.tarefa?.titulo}</b>. Criar mesmo assim?</>
              : aviso.tipo === 'nao_parece_tarefa'
                ? <>{aviso.motivo} Criar mesmo assim?</>
                : 'Esta mensagem já virou tarefa.'}
          </p>
        )}
        {erro && <p className="text-sm text-bad">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={fechar} className="px-3 py-1.5 text-sm text-muted">Cancelar</button>
          <button disabled={indo || !titulo.trim() || !areaId} onClick={() => criar(!!aviso && aviso.tipo !== 'ja_existe')}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-bg disabled:opacity-50">
            {aviso && aviso.tipo !== 'ja_existe' ? 'Criar mesmo assim' : 'Criar tarefa'}
          </button>
        </div>
      </div>
    </div>
  );
}
