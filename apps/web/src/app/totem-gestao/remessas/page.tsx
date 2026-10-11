'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  TOTEM_STATUS_REMESSA,
  TOTEM_UNIDADES_REMESSA,
  TotemRemessaNovaSchema,
  totemLoteDataBR,
  type TotemLoteDoPainel,
  type TotemRemessaDoPainel,
  type TotemStatusRemessa,
} from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Botao, Campo, Card, inputCls } from '../../referencias/ui';
import { ChipDaRemessa, dataHoraBR, mensagemDoErro, useCadastrosDoLote } from '../lotes/comum';

interface ItemDoFormulario {
  produtoId: string;
  loteId: string;
  quantidade: string;
  unidade: '' | (typeof TOTEM_UNIDADES_REMESSA)[number];
}

const ITEM_VAZIO: ItemDoFormulario = { produtoId: '', loteId: '', quantidade: '', unidade: '' };

const ROTULO_DO_STATUS: Record<TotemStatusRemessa, string> = {
  enviada: 'Enviadas',
  recebida: 'Recebidas',
  cancelada: 'Canceladas',
};

export default function PaginaDasRemessas() {
  const { token, ready, can } = useAuth();
  const { lojas, produtos, erro: erroDosCadastros } = useCadastrosDoLote(token);
  const [filtroLoja, setFiltroLoja] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<'' | TotemStatusRemessa>('enviada');
  const [remessas, setRemessas] = useState<TotemRemessaDoPainel[]>([]);
  const [lotesPorProduto, setLotesPorProduto] = useState<Record<string, TotemLoteDoPainel[]>>({});
  const [lojaId, setLojaId] = useState('');
  const [observacao, setObservacao] = useState('');
  const [itens, setItens] = useState<ItemDoFormulario[]>([ITEM_VAZIO]);
  const [comReposicao, setComReposicao] = useState<Record<string, boolean>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const podeEnviar = can('totem.lotes');
  const podeReceber = can('totem.reposicao');

  const carregar = useCallback(() => {
    if (!token) return;
    const q = new URLSearchParams();
    if (filtroLoja) q.set('lojaId', filtroLoja);
    if (filtroStatus) q.set('status', filtroStatus);
    apiGet<TotemRemessaDoPainel[]>(`/totem-lotes/remessas?${q}`, token)
      .then(setRemessas)
      .catch((e: unknown) => setErro(mensagemDoErro(e)));
  }, [token, filtroLoja, filtroStatus]);

  useEffect(carregar, [carregar]);

  function lotesDo(produtoId: string) {
    if (!token || !produtoId || lotesPorProduto[produtoId]) return;
    apiGet<TotemLoteDoPainel[]>(`/totem-lotes/lotes?produtoId=${produtoId}`, token)
      .then((lotes) => setLotesPorProduto((m) => ({ ...m, [produtoId]: lotes })))
      .catch((e: unknown) => setErro(mensagemDoErro(e)));
  }

  function mudarItem(i: number, parcial: Partial<ItemDoFormulario>) {
    setItens((lista) => lista.map((it, j) => (j === i ? { ...it, ...parcial } : it)));
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setAviso(null);
    const lido = TotemRemessaNovaSchema.safeParse({
      lojaId,
      observacao: observacao || null,
      itens: itens.map((it) => ({
        loteId: it.loteId,
        quantidade: it.quantidade ? Number(it.quantidade.replace(',', '.')) : null,
        unidade: it.unidade || null,
      })),
    });
    if (!lido.success) return setErro(lido.error.issues[0]?.message ?? 'Confira a remessa.');
    setOcupado(true);
    try {
      const remessa = await apiPost<TotemRemessaDoPainel>('/totem-lotes/remessas', lido.data, token);
      setItens([ITEM_VAZIO]);
      setObservacao('');
      setAviso(`Remessa para ${remessa.lojaNome} registrada com ${remessa.itens.length} lote(s).`);
      carregar();
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function agir(remessa: TotemRemessaDoPainel, acao: 'receber' | 'cancelar') {
    setErro(null);
    setAviso(null);
    if (acao === 'cancelar' && !window.confirm(`Cancelar a remessa para ${remessa.lojaNome}?`)) return;
    setOcupado(true);
    try {
      if (acao === 'receber') {
        const registrarReposicao = comReposicao[remessa.id] ?? true;
        await apiPost(`/totem-lotes/remessas/${remessa.id}/receber`, { registrarReposicao }, token);
        setAviso(
          registrarReposicao
            ? `Recebimento e reposição registrados em ${remessa.lojaNome}.`
            : `Recebimento registrado em ${remessa.lojaNome}.`,
        );
      } else {
        await apiPost(`/totem-lotes/remessas/${remessa.id}/cancelar`, {}, token);
        setAviso(`Remessa para ${remessa.lojaNome} cancelada.`);
      }
      carregar();
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setOcupado(false);
    }
  }

  if (!ready) return null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Remessas</h1>
        <p className="text-sm text-muted">
          O CD registra o que mandou para cada loja, e a loja confirma quando recebe. Enquanto a loja não confirma, o
          totem mostra o lote enviado como presumido.
        </p>
      </header>

      {(erro || erroDosCadastros) && <p className="text-sm text-bad">{erro ?? erroDosCadastros}</p>}
      {aviso && <p className="text-sm text-good">{aviso}</p>}

      {podeEnviar && (
        <Card titulo="Nova remessa">
          <form onSubmit={enviar} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo label="Loja de destino">
                <select className={inputCls} value={lojaId} onChange={(e) => setLojaId(e.target.value)}>
                  <option value="">Selecione a loja</option>
                  {lojas.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo label="Observação">
                <input
                  className={inputCls}
                  value={observacao}
                  maxLength={500}
                  onChange={(e) => setObservacao(e.target.value)}
                />
              </Campo>
            </div>

            {itens.map((it, i) => (
              <div key={i} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[2fr_2fr_1fr_1fr_auto]">
                <Campo label="Produto">
                  <select
                    className={inputCls}
                    value={it.produtoId}
                    onChange={(e) => {
                      mudarItem(i, { produtoId: e.target.value, loteId: '' });
                      lotesDo(e.target.value);
                    }}
                  >
                    <option value="">Selecione</option>
                    {produtos
                      .filter((p) => p.ativo)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.codigo} · {p.nome}
                        </option>
                      ))}
                  </select>
                </Campo>
                <Campo label="Lote">
                  <select
                    className={inputCls}
                    value={it.loteId}
                    disabled={!it.produtoId}
                    onChange={(e) => mudarItem(i, { loteId: e.target.value })}
                  >
                    <option value="">Selecione</option>
                    {(lotesPorProduto[it.produtoId] ?? []).map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.codigo} · validade {totemLoteDataBR(l.validadeEm)}
                        {l.situacao === 'vencido' ? ' (vencido)' : ''}
                      </option>
                    ))}
                  </select>
                </Campo>
                <Campo label="Quantidade">
                  <input
                    className={inputCls}
                    inputMode="decimal"
                    value={it.quantidade}
                    onChange={(e) => mudarItem(i, { quantidade: e.target.value })}
                  />
                </Campo>
                <Campo label="Unidade">
                  <select
                    className={inputCls}
                    value={it.unidade}
                    onChange={(e) => mudarItem(i, { unidade: e.target.value as ItemDoFormulario['unidade'] })}
                  >
                    <option value="">—</option>
                    <option value="kg">kg</option>
                    <option value="un">unidade</option>
                  </select>
                </Campo>
                <div className="flex items-end">
                  <Botao
                    tone="ghost"
                    disabled={itens.length === 1}
                    onClick={() => setItens((lista) => lista.filter((_, j) => j !== i))}
                    title="Tirar este lote da remessa"
                  >
                    Remover
                  </Botao>
                </div>
              </div>
            ))}

            <div className="flex flex-wrap gap-2">
              <Botao onClick={() => setItens((lista) => [...lista, ITEM_VAZIO])}>Adicionar outro lote</Botao>
              <Botao type="submit" tone="brand" disabled={ocupado || !lojaId}>
                Registrar remessa
              </Botao>
            </div>
          </form>
        </Card>
      )}

      <Card
        titulo="Remessas"
        acao={
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Filtrar por loja"
              className={`${inputCls} w-auto`}
              value={filtroLoja}
              onChange={(e) => setFiltroLoja(e.target.value)}
            >
              <option value="">Todas as lojas</option>
              {lojas.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
            </select>
            <select
              aria-label="Filtrar por situação"
              className={`${inputCls} w-auto`}
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value as '' | TotemStatusRemessa)}
            >
              <option value="">Todas as situações</option>
              {TOTEM_STATUS_REMESSA.map((s) => (
                <option key={s} value={s}>
                  {ROTULO_DO_STATUS[s]}
                </option>
              ))}
            </select>
          </div>
        }
      >
        {remessas.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma remessa com esse filtro.</p>
        ) : (
          <ul className="space-y-4">
            {remessas.map((r) => (
              <li key={r.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{r.lojaNome}</p>
                    <p className="text-xs text-muted">
                      Enviada em {dataHoraBR(r.enviadaEm)}
                      {r.recebidaEm ? `, recebida em ${dataHoraBR(r.recebidaEm)}` : ''}
                    </p>
                  </div>
                  <ChipDaRemessa status={r.status} />
                </div>
                {r.observacao && <p className="mt-2 text-sm text-muted">{r.observacao}</p>}
                <ul className="mt-3 space-y-1 text-sm">
                  {r.itens.map((it) => (
                    <li key={it.id} className="flex flex-wrap justify-between gap-2">
                      <span>
                        {it.produtoCodigo} · {it.produtoNome}, lote {it.loteCodigo}
                      </span>
                      <span className="text-muted">
                        validade {totemLoteDataBR(it.validadeEm)}
                        {it.quantidade != null ? `, ${it.quantidade.toLocaleString('pt-BR')} ${it.unidade ?? ''}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
                {r.status === 'enviada' && (podeReceber || podeEnviar) && (
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    {podeReceber && (
                      <>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={comReposicao[r.id] ?? true}
                            onChange={(e) => setComReposicao((m) => ({ ...m, [r.id]: e.target.checked }))}
                          />
                          Os produtos já foram para a prateleira
                        </label>
                        <Botao tone="brand" disabled={ocupado} onClick={() => agir(r, 'receber')}>
                          Confirmar recebimento
                        </Botao>
                      </>
                    )}
                    {podeEnviar && (
                      <Botao tone="bad" disabled={ocupado} onClick={() => agir(r, 'cancelar')}>
                        Cancelar remessa
                      </Botao>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
