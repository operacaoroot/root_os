'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  TOTEM_ROTULO_DO_SELO,
  type TotemGestaoProduto,
  type TotemGestaoProdutoCriar,
  type TotemGestaoProdutoResposta,
  type TotemGestaoProdutosPagina,
} from '@mktos/shared';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Miniatura } from '@/components/totem/Miniatura';
import { Botao, Card, Chip, inputCls } from '../../referencias/ui';
import { dataBR, precoBR } from '../lojas/apoio';
import { FichaDoProduto } from './FichaDoProduto';

/*
 * O CATÁLOGO DO TOTEM. A busca usa o mesmo nome normalizado do totem (sem
 * acento, sem caixa), então o que acha aqui acha lá. Quem tem só `totem.ver`
 * abre a ficha para conferir; criar e editar pedem `totem.produtos`. Produto
 * não se apaga: desativado, ele some da busca do totem e o histórico fica.
 */

const POR_PAGINA = 25;
type Situacao = 'ativos' | 'inativos' | 'todos';
type Falta = '' | 'foto' | 'tabela';

export default function PaginaDosProdutos() {
  const { token, ready, can } = useAuth();
  const pode = can('totem.ver');
  const editavel = can('totem.produtos');
  const [texto, setTexto] = useState('');
  const [busca, setBusca] = useState('');
  const [situacao, setSituacao] = useState<Situacao>('todos');
  const [falta, setFalta] = useState<Falta>('');
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<TotemGestaoProdutosPagina | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<TotemGestaoProduto | 'novo' | null>(null);
  const [modelo, setModelo] = useState<TotemGestaoProduto | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      setBusca(texto.trim());
      setPagina(1);
    }, 300);
    return () => clearTimeout(id);
  }, [texto]);

  const carregar = useCallback(() => {
    if (!token) return;
    const q = new URLSearchParams({ situacao, pagina: String(pagina), porPagina: String(POR_PAGINA) });
    if (busca) q.set('busca', busca);
    if (falta) q.set('falta', falta);
    apiGet<TotemGestaoProdutosPagina>(`/totem-gestao/produtos?${q.toString()}`, token)
      .then((d) => {
        setDados(d);
        setErro(null);
      })
      .catch((e: Error) => setErro(e.message));
  }, [token, busca, situacao, falta, pagina]);

  useEffect(() => {
    if (ready && pode) carregar();
  }, [ready, pode, carregar]);

  async function salvar(corpo: TotemGestaoProdutoCriar) {
    if (!token) return;
    const atual = aberto !== 'novo' ? aberto : null;
    const r = atual
      ? await apiPatch<TotemGestaoProdutoResposta>(`/totem-gestao/produtos/${atual.id}`, corpo, token)
      : await apiPost<TotemGestaoProdutoResposta>('/totem-gestao/produtos', corpo, token);
    setAberto(null);
    setModelo(null);
    setAviso(`${r.produto.nome} foi ${atual ? 'atualizado' : 'cadastrado'}.`);
    carregar();
  }

  function abrir(p: TotemGestaoProduto | 'novo', copiaDe: TotemGestaoProduto | null = null) {
    setAviso(null);
    setModelo(copiaDe);
    setAberto(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (!ready) return null;
  if (!pode) return <p className="text-sm text-muted">Você não tem acesso ao painel do totem.</p>;

  const paginas = dados ? Math.max(1, Math.ceil(dados.total / dados.porPagina)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Produtos</h1>
          <p className="text-sm text-muted">
            {editavel
              ? 'O catálogo que o totem consulta, com a ficha nutricional, os selos e o preço.'
              : 'O catálogo que o totem consulta. Para cadastrar ou editar, peça a permissão de produtos.'}
          </p>
        </div>
        {editavel && aberto === null && (
          <Botao tone="brand" onClick={() => abrir('novo')}>
            Novo produto
          </Botao>
        )}
      </div>

      {dados?.avisoPreco && <p className="rounded-lg border border-warn/40 bg-surface-2 p-3 text-sm text-warn">{dados.avisoPreco}</p>}
      {aviso && <p className="text-sm text-good">{aviso}</p>}
      {erro && <p className="text-sm text-bad">{erro}</p>}

      {aberto !== null && (
        <FichaDoProduto
          key={aberto === 'novo' ? `novo-${modelo?.id ?? ''}` : aberto.id}
          produto={aberto === 'novo' ? null : aberto}
          modelo={modelo}
          editavel={editavel}
          avisoPreco={dados?.avisoPreco ?? null}
          token={token}
          aoSalvar={salvar}
          aoDuplicar={aberto !== 'novo' ? () => abrir('novo', aberto) : undefined}
          aoFechar={() => {
            setAberto(null);
            setModelo(null);
          }}
        />
      )}

      <div className="flex flex-wrap gap-2">
        <input
          className={`${inputCls} max-w-sm`}
          placeholder="Procurar pelo nome, com ou sem acento"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          aria-label="Procurar produto"
        />
        <select
          className={`${inputCls} w-auto`}
          value={situacao}
          onChange={(e) => {
            setSituacao(e.target.value as Situacao);
            setPagina(1);
          }}
          aria-label="Situação do produto"
        >
          <option value="todos">Todos</option>
          <option value="ativos">Só os ativos</option>
          <option value="inativos">Só os inativos</option>
        </select>
        <select
          className={`${inputCls} w-auto`}
          value={falta}
          onChange={(e) => {
            setFalta(e.target.value as Falta);
            setPagina(1);
          }}
          aria-label="O que falta no produto"
        >
          <option value="">Com ou sem foto e tabela</option>
          <option value="foto">Só os sem foto</option>
          <option value="tabela">Só os sem tabela nutricional</option>
        </select>
      </div>

      <Card titulo={`Produtos · ${dados?.total ?? 0}`}>
        {!dados ? (
          <p className="text-[12px] text-muted">Carregando o catálogo…</p>
        ) : dados.itens.length === 0 ? (
          <p className="text-[12px] text-muted">
            {busca
              ? `Nenhum produto encontrado para "${busca}".`
              : falta === 'foto'
                ? 'Todos os produtos desta lista têm foto.'
                : falta === 'tabela'
                  ? 'Todos os produtos desta lista têm tabela nutricional.'
                  : 'Nenhum produto cadastrado.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {dados.itens.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => abrir(p)}
                  className="flex w-full gap-3 rounded-lg border border-border bg-surface-2 p-3 text-left hover:border-brand/40"
                >
                  <Miniatura url={p.imagemUrl} tamanho="h-14 w-14" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {p.nome} <span className="font-os-mono text-[11px] text-muted">{p.codigo}</span>
                        </p>
                        <p className="text-[12px] text-muted">
                          {[p.categoria, precoBR(p.precoCentavos, p.unidadePreco)].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1">
                        {!p.ativo && <Chip tone="muted">Inativo</Chip>}
                        {p.exemplo && <Chip tone="warn">Exemplo</Chip>}
                        {p.nutricional.length === 0 && <Chip tone="warn">Sem tabela nutricional</Chip>}
                      </div>
                    </div>
                    {p.selos.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {p.selos.map((s) => (
                          <Chip key={s} tone="good">
                            {TOTEM_ROTULO_DO_SELO[s]}
                          </Chip>
                        ))}
                      </div>
                    )}
                    <p className="mt-1 text-[11px] text-muted">Alterado em {dataBR(p.atualizadoEm)}.</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {dados && paginas > 1 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Botao onClick={() => setPagina((n) => n - 1)} disabled={pagina <= 1}>
              Anterior
            </Botao>
            <span className="text-[12px] text-muted">
              Página {pagina} de {paginas}
            </span>
            <Botao onClick={() => setPagina((n) => n + 1)} disabled={pagina >= paginas}>
              Próxima
            </Botao>
          </div>
        )}
      </Card>
    </div>
  );
}
