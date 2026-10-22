'use client';

import { useCallback, useEffect, useState } from 'react';
import { listasComAsDoComercial, type TrabCampoDto, type TrabEstrutura } from '@mktos/shared';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * AJUSTES DO COMERCIAL: as listas de opção do CRM (canal de aquisição,
 * vendedor, produto, motivo da perda) cadastradas aqui, sem passar pelo quadro.
 * São as opções dos campos da lista "Gestão de Leads"; trocar o nome de uma
 * opção troca em todos os leads que a usam.
 */
const ORDEM = ['canal', 'vendedor', 'produto', 'motivo'];
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const posicao = (nome: string) => {
  const i = ORDEM.findIndex((o) => semAcento(nome).startsWith(o));
  return i < 0 ? ORDEM.length : i;
};

export function Ajustes({ listaId }: { listaId: string }) {
  const { token, can } = useAuth();
  const pode = can('tarefas.editar');
  const [campos, setCampos] = useState<TrabCampoDto[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!token) return;
    try {
      const e = await apiGet<TrabEstrutura>('/trabalho/estrutura', token);
      const l = listasComAsDoComercial(e).find((x) => x.id === listaId);
      setCampos((l?.fields ?? []).filter((f) => f.type === 'drop_down').sort((a, b) => posicao(a.name) - posicao(b.name)));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [token, listaId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const agir = async (fn: () => Promise<unknown>) => {
    setErro(null);
    try {
      await fn();
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  if (!campos) return <p className="text-muted">{erro ?? 'Carregando…'}</p>;
  return (
    <div className="space-y-4">
      {erro && <div className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-bad">{erro}</div>}
      <div className="grid gap-6 md:grid-cols-2">
        {campos.map((f) => (
          <ListaDeOpcoes
            key={f.id}
            campo={f}
            pode={pode}
            criar={(nome) => agir(() => apiPost(`/trabalho/campos/${f.id}/opcoes`, { name: nome }, token))}
            renomear={(id, nome) => agir(() => apiPatch(`/trabalho/opcoes/${id}`, { name: nome }, token))}
            apagar={(id) => agir(() => apiDelete(`/trabalho/opcoes/${id}`, token))}
          />
        ))}
      </div>
    </div>
  );
}

function ListaDeOpcoes(props: {
  campo: TrabCampoDto;
  pode: boolean;
  criar: (nome: string) => Promise<void>;
  renomear: (id: string, nome: string) => Promise<void>;
  apagar: (id: string) => Promise<void>;
}) {
  const { campo, pode } = props;
  const [novo, setNovo] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const input = 'min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none focus:border-brand';
  const opcoes = [...campo.options].sort((a, b) => a.order - b.order);

  return (
    <section className="rounded-md border border-border bg-surface px-5 py-4">
      <h2 className="text-[1.05rem] font-semibold">{campo.name}</h2>
      <p className="text-sm text-muted">{opcoes.length} opção(ões)</p>
      <ul className="mt-3 divide-y divide-border">
        {opcoes.map((o) => (
          <li key={o.id} className="group flex items-center gap-2 py-2">
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: o.color }} />
            {editando === o.id ? (
              <form
                className="flex flex-1 gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (texto.trim() && texto.trim() !== o.name) await props.renomear(o.id, texto.trim());
                  setEditando(null);
                }}
              >
                <input className={input} value={texto} autoFocus onChange={(e) => setTexto(e.target.value)} />
                <button className="text-sm text-brand">salvar</button>
                <button type="button" className="text-sm text-muted" onClick={() => setEditando(null)}>cancelar</button>
              </form>
            ) : (
              <>
                <span className="flex-1">{o.name}</span>
                {pode && (
                  <span className="flex gap-3 text-sm opacity-0 transition group-hover:opacity-100">
                    <button className="text-muted hover:text-text" onClick={() => { setEditando(o.id); setTexto(o.name); }}>renomear</button>
                    <button
                      className="text-muted hover:text-bad"
                      onClick={() => { if (window.confirm(`Tirar "${o.name}" de ${campo.name}? Os leads que usam ficam sem essa opção.`)) props.apagar(o.id); }}
                    >
                      tirar
                    </button>
                  </span>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {pode && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!novo.trim()) return;
            await props.criar(novo.trim());
            setNovo('');
          }}
        >
          <input className={input} value={novo} placeholder={`Novo em ${campo.name}`} onChange={(e) => setNovo(e.target.value)} />
          <button disabled={!novo.trim()} className="rounded-md border border-brand px-3 py-1.5 text-sm text-brand hover:bg-brand/10 disabled:opacity-40">
            + adicionar
          </button>
        </form>
      )}
    </section>
  );
}
