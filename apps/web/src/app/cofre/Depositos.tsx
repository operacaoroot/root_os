'use client';
import { useEffect, useState } from 'react';
type Link = { id: string; cliente: string; expiraEm: string; revogadoEm: string | null; recebidos: number };
export function Depositos({ chamar, consulta, cliente }: {
  chamar: <T>(path: string, init?: RequestInit) => Promise<T>;
  consulta: string;
  cliente?: { id: string; nome: string };
}) {
  const [lista, setLista] = useState<Link[]>([]);
  const [novo, setNovo] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    chamar<Link[]>(`/depositos${consulta}`).then(setLista).catch((e) => {
      if (e.name !== 'AbortError') setErro(e.message);
    });
  }, [chamar, consulta]);
  async function emitir() {
    if (!cliente) return;
    setOcupado(true); setErro(''); setNovo('');
    try {
      const r = await chamar<Link & { caminho: string }>('/depositos', { method: 'POST', body: JSON.stringify({ clienteId: cliente.id }) });
      setNovo(`${window.location.origin}${r.caminho}`); setLista((l) => [r, ...l]);
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  }
  async function revogar(id: string) {
    setOcupado(true); setErro('');
    try {
      await chamar(`/depositos/${id}/revogar`, { method: 'POST' });
      setLista((l) => l.map((x) => x.id === id ? { ...x, revogadoEm: new Date().toISOString() } : x));
      setNovo('');
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  }
  return <details className="rounded-xl border border-border bg-surface p-4">
    <summary className="cursor-pointer font-medium">Receber acessos de um cliente</summary>
    <p className="mt-3 text-sm text-muted">O link aceita envios por 7 dias. O cliente não consulta o cofre. Encerrar o link preserva os itens recebidos.</p>
    <div className="mt-3 flex flex-wrap gap-2">
      {cliente && <span className="self-center text-sm font-medium">{cliente.nome}</span>}
      <button disabled={ocupado || !cliente} onClick={emitir} className="rounded-lg bg-brand px-3 py-2 text-sm text-ink disabled:opacity-50">Gerar link de 7 dias</button>
    </div>
    {erro && <p role="alert" className="mt-2 text-sm text-bad">{erro}</p>}
    {novo && <div className="mt-3 rounded-lg border border-brand/30 p-3 text-sm">
      <p>Copie agora. O link completo não fica disponível após sair desta tela.</p>
      <input aria-label="Link para o cliente" readOnly value={novo} className="mt-2 w-full rounded border border-border bg-surface-2 p-2 text-xs" onFocus={(e) => e.target.select()} />
      <button className="mt-2 underline" onClick={() => navigator.clipboard.writeText(novo).catch(() => setErro('Selecione o link e copie manualmente.'))}>Copiar link</button>
    </div>}
    <ul className="mt-4 space-y-2 text-sm">{lista.map((l) => {
      const ativo = !l.revogadoEm && new Date(l.expiraEm).getTime() > Date.now();
      return <li key={l.id} className="flex flex-wrap items-center gap-3 border-t border-border pt-2">
        <span className="flex-1">{l.cliente} · {l.recebidos} envio(s) · {l.revogadoEm ? 'Encerrado' : `${ativo ? 'Até' : 'Expirou em'} ${new Date(l.expiraEm).toLocaleString('pt-BR')}`}</span>
        {ativo && <button disabled={ocupado} className="underline" onClick={() => revogar(l.id)}>Encerrar link</button>}
      </li>;
    })}</ul>
  </details>;
}
