'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TotemGestaoUsuario } from '@mktos/shared';
import { apiDelete, apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Botao, Card, Chip, inputCls } from '../../referencias/ui';
import { useLojasDoPainel } from '../lojas/apoio';

/*
 * QUEM VÊ QUAL LOJA. O papel diz o que a pessoa pode fazer; o vínculo diz em
 * quais lojas. Quem tem a permissão de rede vê todas sem vínculo, e quem não
 * tem papel do totem não ganha nada com o vínculo: a tela avisa os dois casos
 * para ninguém achar que vinculou e liberou.
 */

export default function PaginaDosUsuarios() {
  const { token, ready, can } = useAuth();
  const pode = can('totem.lojas');
  const { lojas } = useLojasDoPainel(token, 'todas');
  const [usuarios, setUsuarios] = useState<TotemGestaoUsuario[] | null>(null);
  const [escolha, setEscolha] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [busca, setBusca] = useState('');

  const carregar = useCallback(() => {
    if (!token) return;
    apiGet<TotemGestaoUsuario[]>('/totem-gestao/usuarios', token)
      .then((u) => {
        setUsuarios(u);
        setErro(null);
      })
      .catch((e: Error) => setErro(e.message));
  }, [token]);

  useEffect(() => {
    if (ready && pode) carregar();
  }, [ready, pode, carregar]);

  async function executar(acao: () => Promise<unknown>) {
    setErro(null);
    setEnviando(true);
    try {
      await acao();
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  if (!ready) return null;
  if (!pode) return <p className="text-sm text-muted">Você não tem permissão para vincular usuários às lojas.</p>;

  const nomeDaLoja = new Map((lojas ?? []).map((l) => [l.id, l.nome]));
  const termo = busca.trim().toLocaleLowerCase('pt-BR');
  const visiveis = (usuarios ?? []).filter(
    (u) => !termo || u.nome.toLocaleLowerCase('pt-BR').includes(termo) || u.email.toLocaleLowerCase('pt-BR').includes(termo),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Usuários</h1>
        <p className="text-sm text-muted">
          O papel define o que a pessoa faz no painel, e o vínculo define em quais lojas. Quem muda o papel é quem
          administra a empresa no OS.
        </p>
      </div>

      {erro && <p className="text-sm text-bad">{erro}</p>}

      <input
        className={`${inputCls} max-w-sm`}
        placeholder="Procurar por nome ou e-mail"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        aria-label="Procurar usuário"
      />

      <Card titulo={`Pessoas da empresa · ${visiveis.length}`}>
        {!usuarios ? (
          <p className="text-[12px] text-muted">Carregando as pessoas…</p>
        ) : visiveis.length === 0 ? (
          <p className="text-[12px] text-muted">Ninguém encontrado.</p>
        ) : (
          <ul className="space-y-2">
            {visiveis.map((u) => {
              const livres = (lojas ?? []).filter((l) => l.ativa && !u.lojaIds.includes(l.id));
              return (
                <li key={u.id} className="rounded-lg border border-border bg-surface-2 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {u.nome}
                        {!u.ativo && <span className="ml-1 text-[12px] text-muted">(inativo)</span>}
                      </p>
                      <p className="truncate text-[12px] text-muted">{u.email}</p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                      {u.papeis.length === 0 ? (
                        <Chip tone="muted">Sem papel</Chip>
                      ) : (
                        u.papeis.map((p) => (
                          <Chip key={p.chave} tone="muted">
                            {p.nome}
                          </Chip>
                        ))
                      )}
                    </div>
                  </div>

                  {u.redeInteira ? (
                    <p className="mt-2 text-[12px] text-good">Vê todas as lojas pela permissão de rede, sem precisar de vínculo.</p>
                  ) : (
                    <>
                      {!u.acessoAoTotem && (
                        <p className="mt-2 text-[12px] text-warn">
                          Nenhum papel desta pessoa dá acesso ao totem. O vínculo fica guardado, mas só vale depois que ela
                          receber um papel do totem.
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {u.lojaIds.length === 0 && <span className="text-[12px] text-muted">Nenhuma loja vinculada.</span>}
                        {u.lojaIds.map((id) => (
                          <span key={id} className="inline-flex items-center gap-1 rounded bg-surface px-2 py-0.5 text-[12px]">
                            {nomeDaLoja.get(id) ?? 'Loja fora do seu escopo'}
                            {nomeDaLoja.has(id) && (
                              <button
                                type="button"
                                disabled={enviando}
                                onClick={() => {
                                  if (!token) return;
                                  if (!window.confirm(`Tirar ${u.nome} da loja ${nomeDaLoja.get(id)}?`)) return;
                                  void executar(() => apiDelete(`/totem-gestao/usuarios/${u.id}/lojas/${id}`, token));
                                }}
                                className="text-muted hover:text-bad"
                                aria-label={`Desvincular de ${nomeDaLoja.get(id)}`}
                                title="Desvincular"
                              >
                                ×
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                      {livres.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <select
                            className={`${inputCls} w-auto`}
                            value={escolha[u.id] ?? ''}
                            onChange={(e) => setEscolha({ ...escolha, [u.id]: e.target.value })}
                            aria-label={`Loja para vincular ${u.nome}`}
                          >
                            <option value="">Escolha uma loja</option>
                            {livres.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.nome}
                              </option>
                            ))}
                          </select>
                          <Botao
                            disabled={enviando || !escolha[u.id]}
                            onClick={() => {
                              if (!token) return;
                              const lojaId = escolha[u.id];
                              void executar(async () => {
                                await apiPost(`/totem-gestao/usuarios/${u.id}/lojas`, { lojaId }, token);
                                setEscolha((x) => ({ ...x, [u.id]: '' }));
                              });
                            }}
                          >
                            Vincular
                          </Botao>
                        </div>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
