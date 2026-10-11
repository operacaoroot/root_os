'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  TotemLoteEdicaoSchema,
  TotemLoteNovoSchema,
  totemLoteDataBR,
  type TotemLoteDoPainel,
  type TotemLoteEdicao,
} from '@mktos/shared';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Botao, Campo, Card, inputCls } from '../../referencias/ui';
import { ChipDaValidade, mensagemDoErro, useCadastrosDoLote } from './comum';

interface Formulario {
  codigo: string;
  fabricadoEm: string;
  validadeEm: string;
  observacao: string;
}

const VAZIO: Formulario = { codigo: '', fabricadoEm: '', validadeEm: '', observacao: '' };

function primeiraMensagem(issues: { message: string }[]): string {
  return issues[0]?.message ?? 'Confira os campos.';
}

export default function PaginaDosLotes() {
  const { token, ready, can } = useAuth();
  const { produtos, erro: erroDosCadastros } = useCadastrosDoLote(token);
  const [produtoId, setProdutoId] = useState('');
  const [lotes, setLotes] = useState<TotemLoteDoPainel[]>([]);
  const [novo, setNovo] = useState<Formulario>(VAZIO);
  const [editando, setEditando] = useState<{ lote: TotemLoteDoPainel; form: Formulario } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const podeEditar = can('totem.lotes');
  const produto = produtos.find((p) => p.id === produtoId);

  const carregar = useCallback(() => {
    if (!token || !produtoId) return;
    apiGet<TotemLoteDoPainel[]>(`/totem-lotes/lotes?produtoId=${produtoId}`, token)
      .then(setLotes)
      .catch((e: unknown) => setErro(mensagemDoErro(e)));
  }, [token, produtoId]);

  useEffect(() => {
    setLotes([]);
    setEditando(null);
    carregar();
  }, [carregar]);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setAviso(null);
    const lido = TotemLoteNovoSchema.safeParse({
      produtoId,
      codigo: novo.codigo,
      fabricadoEm: novo.fabricadoEm || null,
      validadeEm: novo.validadeEm || null,
      observacao: novo.observacao || null,
    });
    if (!lido.success) return setErro(primeiraMensagem(lido.error.issues));
    setSalvando(true);
    try {
      const lote = await apiPost<TotemLoteDoPainel>('/totem-lotes/lotes', lido.data, token);
      setNovo(VAZIO);
      setAviso(`Lote ${lote.codigo} registrado, com validade até ${totemLoteDataBR(lote.validadeEm)}.`);
      carregar();
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setSalvando(false);
    }
  }

  async function salvarEdicao(e: React.FormEvent) {
    e.preventDefault();
    if (!editando) return;
    setErro(null);
    setAviso(null);
    const { lote, form } = editando;
    const mudancas: TotemLoteEdicao = {};
    if (form.codigo !== lote.codigo) mudancas.codigo = form.codigo;
    if (form.fabricadoEm !== (lote.fabricadoEm ?? '')) mudancas.fabricadoEm = form.fabricadoEm || null;
    if (form.validadeEm !== lote.validadeEm) mudancas.validadeEm = form.validadeEm;
    if (form.observacao !== (lote.observacao ?? '')) mudancas.observacao = form.observacao || null;
    const lido = TotemLoteEdicaoSchema.safeParse(mudancas);
    if (!lido.success) return setErro(primeiraMensagem(lido.error.issues));
    setSalvando(true);
    try {
      await apiPatch<TotemLoteDoPainel>(`/totem-lotes/lotes/${lote.id}`, lido.data, token);
      setEditando(null);
      setAviso(`Lote ${form.codigo} atualizado.`);
      carregar();
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setSalvando(false);
    }
  }

  if (!ready) return null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Lotes</h1>
        <p className="text-sm text-muted">
          Cada lote tem código, fabricação e validade. É ele que a remessa leva à loja e que a etiqueta mostra.
        </p>
      </header>

      {(erro || erroDosCadastros) && <p className="text-sm text-bad">{erro ?? erroDosCadastros}</p>}
      {aviso && <p className="text-sm text-good">{aviso}</p>}

      <Card titulo="Produto">
        <Campo label="Escolha o produto para ver os lotes dele">
          <select className={inputCls} value={produtoId} onChange={(e) => setProdutoId(e.target.value)}>
            <option value="">Selecione um produto</option>
            {produtos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.codigo} · {p.nome}
                {p.ativo ? '' : ' (inativo)'}
              </option>
            ))}
          </select>
        </Campo>
      </Card>

      {produto && podeEditar && (
        <Card titulo="Novo lote">
          <form onSubmit={criar} className="grid gap-3 sm:grid-cols-2">
            <Campo label="Código do lote">
              <input
                className={inputCls}
                value={novo.codigo}
                maxLength={40}
                onChange={(e) => setNovo({ ...novo, codigo: e.target.value })}
              />
            </Campo>
            <Campo label="Fabricação">
              <input
                type="date"
                className={inputCls}
                value={novo.fabricadoEm}
                onChange={(e) => setNovo({ ...novo, fabricadoEm: e.target.value })}
              />
            </Campo>
            <Campo
              label="Validade"
              hint={
                produto.validadeDiasPadrao
                  ? `Em branco, a validade é a fabricação mais ${produto.validadeDiasPadrao} dias.`
                  : 'Este produto não tem validade padrão, então informe a data.'
              }
            >
              <input
                type="date"
                className={inputCls}
                value={novo.validadeEm}
                onChange={(e) => setNovo({ ...novo, validadeEm: e.target.value })}
              />
            </Campo>
            <Campo label="Observação">
              <input
                className={inputCls}
                value={novo.observacao}
                maxLength={500}
                onChange={(e) => setNovo({ ...novo, observacao: e.target.value })}
              />
            </Campo>
            <div className="sm:col-span-2">
              <Botao type="submit" tone="brand" disabled={salvando || !novo.codigo.trim()}>
                Registrar lote
              </Botao>
            </div>
          </form>
        </Card>
      )}

      {editando && (
        <Card titulo={`Editar o lote ${editando.lote.codigo}`}>
          <form onSubmit={salvarEdicao} className="grid gap-3 sm:grid-cols-2">
            <Campo label="Código do lote">
              <input
                className={inputCls}
                value={editando.form.codigo}
                maxLength={40}
                onChange={(e) => setEditando({ ...editando, form: { ...editando.form, codigo: e.target.value } })}
              />
            </Campo>
            <Campo label="Fabricação">
              <input
                type="date"
                className={inputCls}
                value={editando.form.fabricadoEm}
                onChange={(e) => setEditando({ ...editando, form: { ...editando.form, fabricadoEm: e.target.value } })}
              />
            </Campo>
            <Campo label="Validade">
              <input
                type="date"
                className={inputCls}
                value={editando.form.validadeEm}
                onChange={(e) => setEditando({ ...editando, form: { ...editando.form, validadeEm: e.target.value } })}
              />
            </Campo>
            <Campo label="Observação">
              <input
                className={inputCls}
                value={editando.form.observacao}
                maxLength={500}
                onChange={(e) => setEditando({ ...editando, form: { ...editando.form, observacao: e.target.value } })}
              />
            </Campo>
            <div className="flex gap-2 sm:col-span-2">
              <Botao type="submit" tone="brand" disabled={salvando}>
                Salvar alterações
              </Botao>
              <Botao tone="ghost" onClick={() => setEditando(null)}>
                Cancelar
              </Botao>
            </div>
          </form>
        </Card>
      )}

      {produto && (
        <Card titulo={`Lotes de ${produto.nome}`}>
          {lotes.length === 0 ? (
            <p className="text-sm text-muted">Este produto ainda não tem lote registrado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="py-2 pr-3 font-medium">Lote</th>
                    <th className="py-2 pr-3 font-medium">Fabricação</th>
                    <th className="py-2 pr-3 font-medium">Validade</th>
                    <th className="py-2 pr-3 font-medium">Situação</th>
                    <th className="py-2 pr-3 font-medium">Origem</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {lotes.map((l) => (
                    <tr key={l.id} className="border-b border-border last:border-0">
                      <td className="py-2 pr-3 font-medium">
                        {l.codigo}
                        {l.observacao && <span className="block text-xs text-muted">{l.observacao}</span>}
                      </td>
                      <td className="py-2 pr-3">{l.fabricadoEm ? totemLoteDataBR(l.fabricadoEm) : '—'}</td>
                      <td className="py-2 pr-3">{totemLoteDataBR(l.validadeEm)}</td>
                      <td className="py-2 pr-3">
                        <ChipDaValidade situacao={l.situacao} />
                      </td>
                      <td className="py-2 pr-3 text-muted">
                        {l.origem === 'manual_loja' ? 'Registrado pela loja' : 'Produção central'}
                      </td>
                      <td className="py-2 text-right">
                        {podeEditar && (
                          <Botao
                            tone="ghost"
                            onClick={() =>
                              setEditando({
                                lote: l,
                                form: {
                                  codigo: l.codigo,
                                  fabricadoEm: l.fabricadoEm ?? '',
                                  validadeEm: l.validadeEm,
                                  observacao: l.observacao ?? '',
                                },
                              })
                            }
                          >
                            Editar
                          </Botao>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
