'use client';

import { useEffect, useState } from 'react';
import {
  TOTEM_PRODUTOS_POR_CAMPANHA,
  type TotemGestaoProdutosPagina,
  type TotemProdutoDaCampanha,
} from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { inputCls } from '@/app/referencias/ui';
import { Miniatura } from '@/components/totem/Miniatura';

/*
 * Os produtos que o botão da campanha abre no totem. A busca é a mesma da tela
 * de produtos, só com os ativos; a lista escolhida fica na ordem em que o
 * cliente vai vê-la, e as setas mudam essa ordem.
 */

const POR_BUSCA = 12;

export function SeletorDeProdutos({
  escolhidos,
  aoMudar,
  token,
}: {
  escolhidos: TotemProdutoDaCampanha[];
  aoMudar: (produtos: TotemProdutoDaCampanha[]) => void;
  token: string | null;
}) {
  const [texto, setTexto] = useState('');
  const [achados, setAchados] = useState<TotemProdutoDaCampanha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const termo = texto.trim();
    if (!token || termo.length < 2) {
      setAchados(null);
      return;
    }
    let valendo = true;
    const id = setTimeout(() => {
      const q = new URLSearchParams({ situacao: 'ativos', porPagina: String(POR_BUSCA), busca: termo });
      apiGet<TotemGestaoProdutosPagina>(`/totem-gestao/produtos?${q.toString()}`, token)
        .then((d) => {
          if (!valendo) return;
          setAchados(d.itens.map(({ id, codigo, nome, imagemUrl }) => ({ id, codigo, nome, imagemUrl })));
          setErro(null);
        })
        .catch((e: Error) => valendo && setErro(e.message));
    }, 300);
    return () => {
      valendo = false;
      clearTimeout(id);
    };
  }, [texto, token]);

  const cheio = escolhidos.length >= TOTEM_PRODUTOS_POR_CAMPANHA;
  const jaEscolhido = (id: string) => escolhidos.some((p) => p.id === id);

  function mover(de: number, para: number) {
    if (para < 0 || para >= escolhidos.length) return;
    const nova = [...escolhidos];
    const [item] = nova.splice(de, 1);
    nova.splice(para, 0, item!);
    aoMudar(nova);
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="block space-y-1.5">
            <span className="block text-xs text-muted">Procurar produto</span>
            <input
              className={inputCls}
              value={texto}
              placeholder="Nome ou código, com pelo menos 2 letras"
              onChange={(e) => setTexto(e.target.value)}
            />
          </label>
          {erro && <p className="text-xs text-bad">{erro}</p>}
          {achados && achados.length === 0 && <p className="text-xs text-muted">Nenhum produto ativo com esse nome.</p>}
          {achados && achados.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {achados.map((p) => {
                const escolhido = jaEscolhido(p.id);
                return (
                  <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                    <Miniatura url={p.imagemUrl} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{p.nome}</span>
                      <span className="block text-[11px] text-muted">{p.codigo}</span>
                    </span>
                    <button
                      type="button"
                      disabled={escolhido || cheio}
                      onClick={() => aoMudar([...escolhidos, p])}
                      className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:border-brand-dim disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {escolhido ? 'Na lista' : 'Pôr na lista'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="space-y-2">
          <span className="block text-xs text-muted">
            Na campanha: {escolhidos.length} de até {TOTEM_PRODUTOS_POR_CAMPANHA}
          </span>
          {escolhidos.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted">
              Procure e ponha na lista os produtos que o botão vai mostrar.
            </p>
          ) : (
            <ol className="divide-y divide-border rounded-lg border border-border">
              {escolhidos.map((p, i) => (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="w-5 text-right text-xs text-muted">{i + 1}</span>
                  <Miniatura url={p.imagemUrl} />
                  <span className="min-w-0 flex-1 truncate text-sm">{p.nome}</span>
                  <span className="flex gap-1">
                    <button
                      type="button"
                      aria-label={`Subir ${p.nome}`}
                      disabled={i === 0}
                      onClick={() => mover(i, i - 1)}
                      className="rounded-md px-2 py-1 text-xs text-muted hover:text-text disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Descer ${p.nome}`}
                      disabled={i === escolhidos.length - 1}
                      onClick={() => mover(i, i + 1)}
                      className="rounded-md px-2 py-1 text-xs text-muted hover:text-text disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => aoMudar(escolhidos.filter((x) => x.id !== p.id))}
                      className="rounded-md px-2 py-1 text-xs text-muted hover:text-bad"
                    >
                      Tirar
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
