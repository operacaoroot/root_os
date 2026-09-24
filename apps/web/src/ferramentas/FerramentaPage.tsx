'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

type Registro = { id: string; orgId: string; titulo: string; texto: string };
type AcaoRetida = { status: 'aguardando_aprovacao'; mensagem?: string };
type RespostaDeLeitura = { registros: Registro[] } | AcaoRetida;

export function FerramentaPage({ slug }: { slug: string }) {
  const { token, ready, can } = useAuth();
  const podeVer = can('mcp.ver');
  const podeExecutar = can('mcp.executar');
  const [rows, setRows] = useState<Registro[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [titulo, setTitulo] = useState('');
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [estadoKey, setEstadoKey] = useState('');
  const epoch = useRef(0);
  const chave = `${slug}\u0000${token ?? ''}\u0000${podeVer ? 'ver' : 'sem-ver'}\u0000${podeExecutar ? 'executar' : 'sem-executar'}`;
  const chaveDoRender = useRef(chave);
  const envioEmCurso = useRef<string | null>(null);
  // Invalida respostas já no render da troca. `useEffect` só roda depois do
  // commit; uma promessa antiga pode resolver nesse intervalo.
  if (chaveDoRender.current !== chave) {
    chaveDoRender.current = chave;
    epoch.current += 1;
  }
  // A troca de sessão/slug precisa ser refletida já neste render. O efeito
  // abaixo limpa de fato os estados, mas até ele rodar nenhum dado anterior é
  // elegível para aparecer na tela.
  const estadoAtual = estadoKey === chave;
  const ownerAtual = estadoAtual && ready && !!token && podeVer;
  const rowsVisiveis = ownerAtual ? rows : null;
  const erroVisivel = ownerAtual ? erro : null;
  const enviandoVisivel = ownerAtual && podeExecutar && enviando;
  const tituloVisivel = estadoAtual ? titulo : '';
  const textoVisivel = estadoAtual ? texto : '';

  useEffect(() => {
    const meuEpoch = ++epoch.current;
    let vivo = true;
    // Não reaproveita dados da sessão anterior enquanto troca de slug/tenant.
    setEstadoKey(chave);
    setRows(null);
    setErro(null);
    setEnviando(false);
    setTitulo('');
    setTexto('');
    if (!ready || !token || !podeVer) return () => { vivo = false; };
    apiGet<RespostaDeLeitura>(`/ferramentas/${encodeURIComponent(slug)}/registros`, token)
      .then((res) => {
        if (!vivo || epoch.current !== meuEpoch) return;
        if ('status' in res && res.status === 'aguardando_aprovacao') {
          setRows([]);
          setErro(res.mensagem ?? 'A leitura ficou aguardando aprovação.');
          return;
        }
        if (!('registros' in res) || !Array.isArray(res.registros)) throw new Error('Resposta de ferramenta inválida.');
        setRows(res.registros);
      })
      .catch((error: Error) => { if (vivo && epoch.current === meuEpoch) setErro(error.message); });
    return () => { vivo = false; };
  }, [slug, ready, token, chave, podeVer, podeExecutar]);

  async function criar(event: FormEvent) {
    event.preventDefault();
    if (!ownerAtual || !podeExecutar || !token || !tituloVisivel.trim() || !textoVisivel.trim()) return;
    // Estado React não é trava síncrona: dois submits no mesmo tick enxergam
    // `enviando=false`. A ref impede que o segundo POST sequer seja iniciado.
    if (envioEmCurso.current === chave) return;
    envioEmCurso.current = chave;
    const meuEpoch = epoch.current;
    const minhaChave = chave;
    const meuSlug = slug;
    const meuToken = token;
    const meuTitulo = tituloVisivel;
    const meuTexto = textoVisivel;
    setEnviando(true); setErro(null);
    try {
      const criado = await apiPost<{ status?: string; mensagem?: string }>(`/ferramentas/${encodeURIComponent(meuSlug)}/registros`, { titulo: meuTitulo, texto: meuTexto }, meuToken);
      if (epoch.current !== meuEpoch || chaveDoRender.current !== minhaChave) return;
      if (criado.status === 'aguardando_aprovacao') {
        setErro(criado.mensagem ?? 'A criação ficou aguardando aprovação.');
        return;
      }
      setTitulo(''); setTexto('');
      const res = await apiGet<RespostaDeLeitura>(`/ferramentas/${encodeURIComponent(meuSlug)}/registros`, meuToken);
      if (epoch.current === meuEpoch && chaveDoRender.current === minhaChave) {
        if ('status' in res && res.status === 'aguardando_aprovacao') {
          setRows([]);
          setErro(res.mensagem ?? 'A leitura ficou aguardando aprovação.');
        } else if ('registros' in res && Array.isArray(res.registros)) setRows(res.registros);
        else throw new Error('Resposta de ferramenta inválida.');
      }
    } catch (error) {
      if (epoch.current === meuEpoch && chaveDoRender.current === minhaChave) setErro((error as Error).message);
    } finally {
      if (envioEmCurso.current === minhaChave) envioEmCurso.current = null;
      if (epoch.current === meuEpoch && chaveDoRender.current === minhaChave) setEnviando(false);
    }
  }

  if (!ready) return <p className="text-sm text-muted">Carregando sessão…</p>;
  if (!token) return <p className="text-sm text-muted">Entre para acessar esta ferramenta.</p>;
  if (!podeVer) return <p className="text-sm text-bad">Sem permissão para ver esta ferramenta.</p>;

  return (
    <main className="space-y-5">
      <header>
        <p className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted">ferramenta · {slug}</p>
        <h1 className="mt-2 text-xl font-semibold">Registros internos</h1>
      </header>
      {erroVisivel && <p className="text-sm text-bad">{erroVisivel}</p>}
      {podeExecutar && (
        <form onSubmit={criar} className="space-y-2 rounded-lg border border-border bg-surface p-4">
          <input value={tituloVisivel} onChange={(e) => setTitulo(e.target.value)} placeholder="Título" maxLength={200}
            className="w-full rounded border border-border bg-surface-2 px-3 py-2 text-sm" />
          <textarea value={textoVisivel} onChange={(e) => setTexto(e.target.value)} placeholder="Texto" maxLength={10000} rows={4}
            className="w-full rounded border border-border bg-surface-2 px-3 py-2 text-sm" />
          <button disabled={!ownerAtual || !podeExecutar || enviandoVisivel || !tituloVisivel.trim() || !textoVisivel.trim()} className="rounded bg-brand px-3 py-2 text-xs text-ink disabled:opacity-50">
            {enviandoVisivel ? 'Salvando…' : 'Criar registro'}
          </button>
        </form>
      )}
      <section className="space-y-2">
        {rowsVisiveis === null ? <p className="text-sm text-muted">Carregando…</p> : rowsVisiveis.length === 0 ? <p className="text-sm text-muted">Nenhum registro.</p> : rowsVisiveis.map((row) => (
          <article key={row.id} className="rounded-lg border border-border bg-surface p-4">
            <h2 className="font-medium">{row.titulo}</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{row.texto}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
