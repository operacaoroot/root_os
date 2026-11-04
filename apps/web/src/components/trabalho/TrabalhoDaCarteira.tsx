'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { TrabComentarioDto, TrabTarefaDetalhe, TrabTarefaLista } from '@mktos/shared';
import type { ClienteDaCarteira } from '@/components/clientes/ClienteEscopo';
import { useConsultaPorEscopo } from '@/lib/consulta-por-escopo';
import { diaCompleto } from '@/lib/datas-do-cartao';
import { apiPatch, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AnexosDaTarefa } from './AnexosDaTarefa';

const campo = 'min-h-11 rounded-root border border-border bg-surface px-3 py-2 text-sm';
const botao = 'min-h-11 rounded-root border border-border px-3 py-2 text-sm hover:bg-surface-2 disabled:opacity-50';
const limite = 30;
type TarefaRestrita = TrabTarefaDetalhe & {
  carteira?: { podeCriar: boolean; podeCriarSubtarefa: boolean; podeEditar: boolean };
};
type Formulario = 'editar' | 'nova' | 'subtarefa';

export function TrabalhoForaDaCarteira() {
  return (
    <section className="space-y-2 rounded-root border border-border bg-surface p-4 text-sm">
      <p>Esta área requer acesso amplo. Consulte as tarefas dos seus clientes em Trabalho.</p>
      <Link href="/trabalho" className="text-brand underline">Abrir Trabalho</Link>
    </section>
  );
}

export function TrabalhoDaCarteira({ clientes, token }: { clientes: ClienteDaCarteira[]; token: string }) {
  const [endereco] = useState(() => new URLSearchParams(window.location.search));
  const [escolha, setEscolha] = useState(() => endereco.get('cliente'));
  const cliente = clientes.find((c) => c.id === escolha) ?? clientes[0];
  const [tarefaDoEndereco, setTarefaDoEndereco] = useState(() =>
    cliente && escolha === cliente.id ? endereco.get('tarefa') : null,
  );

  if (!cliente) return <p className="text-sm text-muted">Nenhum cliente disponível em Trabalho.</p>;
  return (
    <div className="space-y-4">
      <label className="block max-w-sm text-sm">
        <span className="mb-1 block text-muted">Cliente do Trabalho</span>
        <select className={`w-full ${campo}`} value={cliente.id} onChange={(e) => {
          setTarefaDoEndereco(null);
          setEscolha(e.target.value);
        }}>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </label>
      <TarefasDoCliente key={cliente.id} clienteId={cliente.id} token={token} tarefaInicial={tarefaDoEndereco} />
    </div>
  );
}

function TarefasDoCliente({ clienteId, token, tarefaInicial }: { clienteId: string; token: string; tarefaInicial: string | null }) {
  const [tarefaId, setTarefaId] = useState(tarefaInicial);
  const origemDaTarefa = useRef<HTMLButtonElement | null>(null);
  const [texto, setTexto] = useState('');
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [revisao, setRevisao] = useState(0);
  const filtros = new URLSearchParams({ cliente: clienteId, page: String(pagina), limit: String(limite) });
  if (busca) filtros.set('q', busca);
  const lista = useConsultaPorEscopo<TrabTarefaLista>(`/trabalho/tarefas?${filtros}`, token, revisao);

  return (
    <section aria-label="Tarefas do cliente" className="space-y-3">
      <form className="flex max-w-md flex-wrap gap-2" role="search" onSubmit={(e) => {
        e.preventDefault();
        setPagina(1);
        setBusca(texto.trim());
      }}>
        <input className={`min-w-0 flex-1 ${campo}`} type="search" aria-label="Buscar tarefas" placeholder="Buscar tarefas" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <button type="submit" className={botao}>Buscar</button>
      </form>
      {tarefaId && (
        <TarefaDoCliente key={tarefaId} id={tarefaId} clienteId={clienteId} token={token}
          abrir={setTarefaId} fechar={() => {
            setTarefaId(null);
            origemDaTarefa.current?.focus();
          }}
          revisao={revisao} aoMudar={() => setRevisao((v) => v + 1)} />
      )}
      {!lista && <p role="status" className="text-sm text-muted">Carregando tarefas…</p>}
      {lista?.erro !== undefined && <p role="alert" className="text-sm text-bad">{lista.erro}</p>}
      {lista?.dados && (
        <>
          {lista.dados.total === 0 && <p className="text-sm text-muted">Nenhuma tarefa encontrada.</p>}
          <ul className="divide-y divide-border rounded-root border-border bg-surface empty:hidden [&:not(:empty)]:border">
            {lista.dados.items.filter((t) => t.clienteId === clienteId).map((t) => {
              const prazo = diaCompleto(t.dueDate);
              return (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <button type="button" className="min-h-11 min-w-0 break-words text-left text-brand underline" onClick={(e) => {
                    origemDaTarefa.current = e.currentTarget;
                    setTarefaId(t.id);
                  }}>{t.title}</button>
                  <span className="text-muted">{t.statusName}{prazo && ` · ${prazo}`}</span>
                </li>
              );
            })}
          </ul>
          {(pagina > 1 || lista.dados.total > limite) && (
            <nav aria-label="Páginas de tarefas" className="flex flex-wrap items-center gap-2">
              <button type="button" className={botao} disabled={pagina === 1} onClick={() => setPagina(pagina - 1)}>Anterior</button>
              <span className="text-sm text-muted">Página {pagina}</span>
              <button type="button" className={botao} disabled={pagina * limite >= lista.dados.total} onClick={() => setPagina(pagina + 1)}>Próxima</button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}

function TarefaDoCliente({ id, clienteId, token, abrir, fechar, revisao, aoMudar }: {
  id: string; clienteId: string; token: string; abrir: (id: string) => void; fechar: () => void;
  revisao: number; aoMudar: () => void;
}) {
  const { can } = useAuth();
  const [formulario, setFormulario] = useState<Formulario | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const painel = useRef<HTMLElement>(null);
  useLayoutEffect(() => painel.current?.focus(), []);
  const resultado = useConsultaPorEscopo<TarefaRestrita>(`/trabalho/tarefas/${encodeURIComponent(id)}`, token, revisao);
  const tarefa = resultado?.dados;
  const disponivel = tarefa?.id === id && tarefa.clienteId === clienteId;
  const carteira = tarefa?.carteira;
  const acoes: { modo: Formulario; rotulo: string; habilitada: boolean }[] = [
    { modo: 'editar', rotulo: 'Editar tarefa', habilitada: carteira?.podeEditar === true && !!tarefa?.updatedAt },
    { modo: 'nova', rotulo: 'Nova tarefa nesta lista', habilitada: carteira?.podeCriar === true },
    { modo: 'subtarefa', rotulo: 'Nova subtarefa', habilitada: carteira?.podeCriarSubtarefa === true },
  ];
  const disponiveis = acoes.filter((acao) => acao.habilitada);

  return (
    <section ref={painel} tabIndex={-1} aria-label="Detalhes da tarefa" className="space-y-3 rounded-root border border-border bg-surface p-4 text-sm">
      <button type="button" onClick={fechar} className={botao}>Fechar tarefa</button>
      {aviso && <p role="status" className="text-good">{aviso}</p>}
      {!resultado && <p role="status" className="text-muted">Carregando tarefa…</p>}
      {resultado && !disponivel && <p role="alert" className="text-bad">Tarefa indisponível para este cliente.</p>}
      {disponivel && (
        <>
          <h2 className="text-base font-semibold">{tarefa.title}</h2>
          <p className="text-muted">{tarefa.statusName}</p>
          {formulario !== 'editar' && tarefa.description && (
            <p className="whitespace-pre-wrap break-words">{tarefa.description}</p>
          )}
          {can('tarefas.editar') && disponiveis.length > 0 && (
            formulario && disponiveis.some((acao) => acao.modo === formulario)
              ? <FormularioDaTarefa modo={formulario} tarefa={tarefa} clienteId={clienteId} token={token}
                  cancelar={() => setFormulario(null)} aoSalvar={() => {
                    setAviso(formulario === 'editar' ? 'Tarefa atualizada.' : 'Tarefa criada.');
                    setFormulario(null);
                    aoMudar();
                  }} />
              : <div className="flex flex-wrap gap-2">
                  {disponiveis.map((acao) => (
                    <button key={acao.modo} type="button" className={botao} onClick={() => {
                      setAviso(null);
                      setFormulario(acao.modo);
                    }}>{acao.rotulo}</button>
                  ))}
                </div>
          )}
          <AnexosDaTarefa taskId={tarefa.id} restrito />
          <ComentariosDaCarteira taskId={tarefa.id} token={token} comentarios={tarefa.comentarios} />
          {!!tarefa.filhos.length && (
            <section aria-label="Subtarefas">
              <h3 className="mb-1 font-medium">Subtarefas</h3>
              <ul className="space-y-1">
                {tarefa.filhos.map((filho) => (
                  <li key={filho.id}>
                    <button type="button" className="min-h-11 break-words text-left text-brand underline" onClick={() => abrir(filho.id)}>{filho.title}</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </section>
  );
}

function FormularioDaTarefa({ modo, tarefa, clienteId, token, cancelar, aoSalvar }: {
  modo: Formulario; tarefa: TrabTarefaDetalhe; clienteId: string; token: string;
  cancelar: () => void; aoSalvar: () => void;
}) {
  const editando = modo === 'editar';
  const [titulo, setTitulo] = useState(editando ? tarefa.title : '');
  const [descricao, setDescricao] = useState(editando ? tarefa.description ?? '' : '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const envio = useRef<AbortController | null>(null);

  useLayoutEffect(() => () => envio.current?.abort(), []);

  async function salvar() {
    const title = titulo.trim();
    if (!title || envio.current) return;
    const controle = new AbortController();
    envio.current = controle;
    setSalvando(true);
    setErro(null);
    try {
      if (editando) {
        await apiPatch(`/trabalho/tarefas/${encodeURIComponent(tarefa.id)}`, {
          title, description: descricao || null, expectedUpdatedAt: tarefa.updatedAt,
        }, token, controle.signal);
      } else {
        await apiPost('/trabalho/tarefas', {
          title, clienteId, listId: tarefa.listId,
          ...(descricao ? { description: descricao } : {}),
          ...(modo === 'subtarefa' ? { parentId: tarefa.id } : {}),
        }, token, controle.signal);
      }
      if (!controle.signal.aborted) aoSalvar();
    } catch (e) {
      if (!controle.signal.aborted) setErro((e as Error).message);
    } finally {
      if (!controle.signal.aborted) {
        envio.current = null;
        setSalvando(false);
      }
    }
  }

  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void salvar(); }}>
      <label className="block">
        <span className="mb-1 block text-muted">Título</span>
        <input className={`w-full ${campo}`} value={titulo} maxLength={300} disabled={salvando}
          onChange={(e) => setTitulo(e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-muted">Descrição</span>
        <textarea className={`w-full ${campo}`} value={descricao} rows={4} maxLength={20000} disabled={salvando}
          onChange={(e) => setDescricao(e.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={botao} disabled={!titulo.trim() || salvando}>
          {salvando ? 'Salvando…' : 'Salvar tarefa'}
        </button>
        <button type="button" className={botao} onClick={cancelar} disabled={salvando}>Cancelar</button>
      </div>
      {erro && <p role="alert" className="text-bad">{erro}</p>}
    </form>
  );
}

function ComentariosDaCarteira({ taskId, token, comentarios }: {
  taskId: string; token: string; comentarios: TrabComentarioDto[];
}) {
  const { user, can } = useAuth();
  const [novos, setNovos] = useState<TrabComentarioDto[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const envio = useRef<AbortController | null>(null);

  useLayoutEffect(() => () => envio.current?.abort(), []);

  async function comentar() {
    const text = texto.trim();
    if (!text || !user || !can('tarefas.editar') || envio.current) return;
    const controle = new AbortController();
    envio.current = controle;
    setEnviando(true);
    setErro(null);
    try {
      const recibo = await apiPost<Pick<TrabComentarioDto, 'id' | 'createdAt'>>(
        `/trabalho/tarefas/${encodeURIComponent(taskId)}/comentarios`, { text }, token, controle.signal,
      );
      if (!controle.signal.aborted) {
        setNovos((lista) => [...lista, { ...recibo, authorId: user.id, authorName: user.name || 'Você', text }]);
        setTexto('');
      }
    } catch (e) {
      if (!controle.signal.aborted) setErro((e as Error).message);
    } finally {
      if (!controle.signal.aborted) {
        envio.current = null;
        setEnviando(false);
      }
    }
  }

  return (
    <section aria-label="Comentários" className="space-y-2">
      <h3 className="font-medium">Comentários</h3>
      <ul className="space-y-2 empty:hidden">
        {[...comentarios, ...novos].map((c) => (
          <li key={c.id} className="rounded-root border border-border px-3 py-2">
            <p className="text-muted">{c.authorName}</p>
            <p className="whitespace-pre-wrap break-words">{c.text}</p>
          </li>
        ))}
      </ul>
      {can('tarefas.editar') && (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void comentar(); }}>
          <label className="block">
            <span className="mb-1 block text-muted">Novo comentário</span>
            <textarea className={`w-full ${campo}`} value={texto} onChange={(e) => setTexto(e.target.value)}
              disabled={enviando} maxLength={10000} />
          </label>
          <button type="submit" className={botao} disabled={enviando || !texto.trim()}>
            {enviando ? 'Enviando…' : 'Comentar'}
          </button>
        </form>
      )}
      {erro && <p role="alert" className="text-bad">{erro}</p>}
    </section>
  );
}
