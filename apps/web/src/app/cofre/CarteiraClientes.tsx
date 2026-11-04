'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPut } from '@/lib/api';

type Modo = 'ALL' | 'SELECTED';
type Carteira = { modo: Modo; vinculos: { clienteId: string }[] };
type Pessoa = { id: string; name: string; email: string; clienteAcessoPerfil: Carteira | null };
type Cliente = { id: string; nome: string };

const rotaPessoas = '/clientes-escopo/pessoas';
const selectClass = 'mt-1 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm';

type Props = { token: string; usuarioId: string; clientes: Cliente[]; obterSinal: () => AbortSignal };

export function CarteiraClientes(props: Props) {
  const [aberto, setAberto] = useState(false);
  return (
    <section className="rounded-xl border border-border bg-surface p-4 text-sm">
      <button type="button" aria-expanded={aberto} onClick={() => setAberto(!aberto)} className="font-medium">
        Acesso por cliente
      </button>
      {aberto && <GerenciarCarteiras {...props} />}
    </section>
  );
}

function GerenciarCarteiras({ token, usuarioId, clientes, obterSinal }: Props) {
  const [pessoas, setPessoas] = useState<Pessoa[] | null>(null);
  const [pessoaId, setPessoaId] = useState('');
  const [modo, setModo] = useState<Modo | ''>('');
  const [clienteIds, setClienteIds] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    const signal = obterSinal();
    let consultando = true;
    apiGet<Pessoa[]>(rotaPessoas, token)
      .then((lista) => { if (consultando && !signal.aborted) setPessoas(lista); })
      .catch((e: Error) => { if (consultando && !signal.aborted) setErro(e.message); });
    return () => { consultando = false; };
  }, [obterSinal, token]);

  function escolher(pessoa?: Pessoa) {
    setPessoaId(pessoa?.id ?? '');
    setModo(pessoa?.clienteAcessoPerfil?.modo ?? '');
    const ids = pessoa?.clienteAcessoPerfil?.vinculos.map((v) => v.clienteId) ?? [];
    setClienteIds(clientes.filter((c) => ids.includes(c.id)).map((c) => c.id));
    setErro('');
    setAviso('');
  }

  async function salvar() {
    if (!pessoaId || pessoaId === usuarioId || !modo || salvando) return;
    const signal = obterSinal();
    const ids = modo === 'SELECTED' ? clienteIds : [];
    setSalvando(true);
    setErro('');
    setAviso('');
    let salvo = false;
    try {
      await apiPut(`${rotaPessoas}/${encodeURIComponent(pessoaId)}`, { modo, clienteIds: ids }, token);
      salvo = true;
      if (signal.aborted) return;
      const lista = await apiGet<Pessoa[]>(rotaPessoas, token);
      if (signal.aborted) return;
      setPessoas(lista);
      escolher(lista.find((pessoa) => pessoa.id === pessoaId));
      setAviso('Acesso atualizado.');
    } catch (e) {
      if (!signal.aborted) {
        setErro(salvo ? 'O acesso foi salvo, mas a consulta falhou. Feche e abra o painel para conferir.' : (e as Error).message);
      }
    } finally {
      if (!signal.aborted) setSalvando(false);
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <p className="text-muted">Quem tem acesso a clientes selecionados só pode abrir as áreas do OS que já aplicam esse filtro. As demais ficam bloqueadas.</p>
      {erro && <p role="alert" className="text-bad">{erro}</p>}
      {aviso && <p role="status" className="text-good">{aviso}</p>}
      {!pessoas && !erro && <p className="text-muted">Carregando pessoas…</p>}
      {pessoas && (
        <form onSubmit={(e) => { e.preventDefault(); void salvar(); }}>
          <fieldset disabled={salvando} className="space-y-3">
            <label className="block max-w-md">
              Pessoa
              <select className={selectClass} value={pessoaId} onChange={(e) => escolher(pessoas.find((p) => p.id === e.target.value))}>
                <option value="">Escolha uma pessoa</option>
                {pessoas.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.id === usuarioId}>
                    {p.name} · {p.email}{p.id === usuarioId ? ' (você)' : ''}
                  </option>
                ))}
              </select>
            </label>
            {pessoaId && (
              <>
                <label className="block max-w-md">
                  Tipo de acesso
                  <select className={selectClass} value={modo} onChange={(e) => setModo(e.target.value as Modo)}>
                    <option value="" disabled>Sem perfil definido</option>
                    <option value="ALL">Acesso amplo</option>
                    <option value="SELECTED">Clientes selecionados</option>
                  </select>
                </label>
                {modo === 'SELECTED' && (
                  <fieldset className="space-y-1">
                    <legend className="mb-1 font-medium">Clientes liberados</legend>
                    {clientes.map((cliente) => (
                      <label key={cliente.id} className="flex items-center gap-2">
                        <input type="checkbox" checked={clienteIds.includes(cliente.id)} onChange={(e) => {
                          const marcado = e.target.checked;
                          setClienteIds((ids) => marcado ? [...ids, cliente.id] : ids.filter((id) => id !== cliente.id));
                        }} />
                        {cliente.nome}
                      </label>
                    ))}
                    {clienteIds.length === 0 && <p className="text-muted">Com a lista vazia, a pessoa fica sem acesso a clientes do cofre.</p>}
                  </fieldset>
                )}
                <button disabled={!modo} className="rounded-lg bg-brand px-3 py-2 font-medium text-ink disabled:opacity-50">
                  {salvando ? 'Salvando…' : 'Salvar acesso'}
                </button>
              </>
            )}
          </fieldset>
        </form>
      )}
    </div>
  );
}
