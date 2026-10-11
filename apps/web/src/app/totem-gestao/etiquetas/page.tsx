'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  TOTEM_MAXIMO_ETIQUETAS_POR_VEZ,
  TotemEtiquetasNovasSchema,
  totemLoteDataBR,
  type TotemEtiquetaDoPainel,
  type TotemLoteDoPainel,
} from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Botao, Campo, Card, Chip, inputCls } from '../../referencias/ui';
import { codigoLegivel } from '../../p/formato';
import { dataHoraBR, mensagemDoErro, useCadastrosDoLote } from '../lotes/comum';

function linkDeImpressao(ids: string[]): string {
  return `/totem-gestao/etiquetas/imprimir?ids=${ids.join(',')}`;
}

export default function PaginaDasEtiquetas() {
  const { token, ready } = useAuth();
  const { lojas, produtos, erro: erroDosCadastros } = useCadastrosDoLote(token);
  const [filtroLoja, setFiltroLoja] = useState('');
  const [filtroProduto, setFiltroProduto] = useState('');
  const [comRevogadas, setComRevogadas] = useState(false);
  const [etiquetas, setEtiquetas] = useState<TotemEtiquetaDoPainel[]>([]);
  const [escolhidas, setEscolhidas] = useState<Set<string>>(new Set());
  const [lojaId, setLojaId] = useState('');
  const [produtoId, setProdutoId] = useState('');
  const [loteId, setLoteId] = useState('');
  const [quantidade, setQuantidade] = useState('1');
  const [lotes, setLotes] = useState<TotemLoteDoPainel[]>([]);
  const [geradas, setGeradas] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(() => {
    if (!token) return;
    const q = new URLSearchParams();
    if (filtroLoja) q.set('lojaId', filtroLoja);
    if (filtroProduto) q.set('produtoId', filtroProduto);
    if (comRevogadas) q.set('revogadas', '1');
    apiGet<TotemEtiquetaDoPainel[]>(`/totem-lotes/etiquetas?${q}`, token)
      .then((lista) => {
        setEtiquetas(lista);
        setEscolhidas(new Set());
      })
      .catch((e: unknown) => setErro(mensagemDoErro(e)));
  }, [token, filtroLoja, filtroProduto, comRevogadas]);

  useEffect(carregar, [carregar]);

  useEffect(() => {
    setLotes([]);
    setLoteId('');
    if (!token || !produtoId) return;
    apiGet<TotemLoteDoPainel[]>(`/totem-lotes/lotes?produtoId=${produtoId}`, token)
      .then(setLotes)
      .catch((e: unknown) => setErro(mensagemDoErro(e)));
  }, [token, produtoId]);

  async function gerar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setAviso(null);
    const lido = TotemEtiquetasNovasSchema.safeParse({
      lojaId,
      produtoId,
      loteId: loteId || null,
      quantidade: Number(quantidade),
    });
    if (!lido.success) return setErro(lido.error.issues[0]?.message ?? 'Confira as etiquetas.');
    setOcupado(true);
    try {
      const novas = await apiPost<TotemEtiquetaDoPainel[]>('/totem-lotes/etiquetas', lido.data, token);
      setGeradas(novas.map((n) => n.id));
      setAviso(`${novas.length} etiqueta(s) gerada(s). Agora é só imprimir.`);
      carregar();
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function revogar(etiqueta: TotemEtiquetaDoPainel) {
    setErro(null);
    setAviso(null);
    const ok = window.confirm(
      `Revogar a etiqueta ${codigoLegivel(etiqueta.codigo)}? O QR dela deixa de abrir a ficha do produto.`,
    );
    if (!ok) return;
    setOcupado(true);
    try {
      await apiPost(`/totem-lotes/etiquetas/${etiqueta.id}/revogar`, {}, token);
      setAviso(`Etiqueta ${codigoLegivel(etiqueta.codigo)} revogada.`);
      carregar();
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setOcupado(false);
    }
  }

  function alternar(id: string) {
    setEscolhidas((atual) => {
      const nova = new Set(atual);
      if (nova.has(id)) nova.delete(id);
      else if (nova.size < TOTEM_MAXIMO_ETIQUETAS_POR_VEZ) nova.add(id);
      return nova;
    });
  }

  if (!ready) return null;

  const ativas = etiquetas.filter((e) => !e.revogadaEm);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Etiquetas</h1>
        <p className="text-sm text-muted">
          Cada etiqueta tem um QR que abre a ficha do produto no celular do cliente. Sem lote escolhido, a etiqueta é
          de gôndola e mostra o lote que está na prateleira da loja.
        </p>
      </header>

      {(erro || erroDosCadastros) && <p className="text-sm text-bad">{erro ?? erroDosCadastros}</p>}
      {aviso && (
        <p className="text-sm text-good">
          {aviso}{' '}
          {geradas.length > 0 && (
            <Link href={linkDeImpressao(geradas)} className="underline">
              Imprimir as etiquetas geradas
            </Link>
          )}
        </p>
      )}

      <Card titulo="Gerar etiquetas">
        <form onSubmit={gerar} className="grid gap-3 sm:grid-cols-2">
          <Campo label="Loja">
            <select className={inputCls} value={lojaId} onChange={(e) => setLojaId(e.target.value)}>
              <option value="">Selecione a loja</option>
              {lojas.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
            </select>
          </Campo>
          <Campo label="Produto">
            <select className={inputCls} value={produtoId} onChange={(e) => setProdutoId(e.target.value)}>
              <option value="">Selecione o produto</option>
              {produtos
                .filter((p) => p.ativo)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.codigo} · {p.nome}
                  </option>
                ))}
            </select>
          </Campo>
          <Campo label="Lote" hint="Deixe em branco para a etiqueta de gôndola, que acompanha a reposição da loja.">
            <select
              className={inputCls}
              value={loteId}
              disabled={!produtoId}
              onChange={(e) => setLoteId(e.target.value)}
            >
              <option value="">Lote que estiver na prateleira</option>
              {lotes.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.codigo} · validade {totemLoteDataBR(l.validadeEm)}
                </option>
              ))}
            </select>
          </Campo>
          <Campo label="Quantidade" hint={`Até ${TOTEM_MAXIMO_ETIQUETAS_POR_VEZ} etiquetas por vez.`}>
            <input
              type="number"
              min={1}
              max={TOTEM_MAXIMO_ETIQUETAS_POR_VEZ}
              className={inputCls}
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
            />
          </Campo>
          <div className="sm:col-span-2">
            <Botao type="submit" tone="brand" disabled={ocupado || !lojaId || !produtoId}>
              Gerar etiquetas
            </Botao>
          </div>
        </form>
      </Card>

      <Card
        titulo="Etiquetas geradas"
        acao={
          escolhidas.size > 0 ? (
            <Link
              href={linkDeImpressao([...escolhidas])}
              className="rounded-lg bg-brand px-3 py-1.5 text-sm text-bg hover:bg-brand/90"
            >
              Imprimir {escolhidas.size} escolhida(s)
            </Link>
          ) : undefined
        }
      >
        <div className="mb-4 flex flex-wrap gap-2">
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
            aria-label="Filtrar por produto"
            className={`${inputCls} w-auto`}
            value={filtroProduto}
            onChange={(e) => setFiltroProduto(e.target.value)}
          >
            <option value="">Todos os produtos</option>
            {produtos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.codigo} · {p.nome}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={comRevogadas} onChange={(e) => setComRevogadas(e.target.checked)} />
            Mostrar as revogadas
          </label>
        </div>

        {etiquetas.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma etiqueta com esse filtro.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="py-2 pr-3 font-medium">
                    <input
                      type="checkbox"
                      aria-label="Escolher todas as ativas"
                      checked={ativas.length > 0 && ativas.every((e) => escolhidas.has(e.id))}
                      onChange={(e) =>
                        setEscolhidas(
                          e.target.checked
                            ? new Set(ativas.slice(0, TOTEM_MAXIMO_ETIQUETAS_POR_VEZ).map((a) => a.id))
                            : new Set(),
                        )
                      }
                    />
                  </th>
                  <th className="py-2 pr-3 font-medium">Código</th>
                  <th className="py-2 pr-3 font-medium">Produto</th>
                  <th className="py-2 pr-3 font-medium">Loja</th>
                  <th className="py-2 pr-3 font-medium">Lote</th>
                  <th className="py-2 pr-3 font-medium">Impressa</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {etiquetas.map((e) => (
                  <tr key={e.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3">
                      {!e.revogadaEm && (
                        <input
                          type="checkbox"
                          aria-label={`Escolher a etiqueta ${codigoLegivel(e.codigo)}`}
                          checked={escolhidas.has(e.id)}
                          onChange={() => alternar(e.id)}
                        />
                      )}
                    </td>
                    <td className="py-2 pr-3 font-os-mono whitespace-nowrap">{codigoLegivel(e.codigo)}</td>
                    <td className="py-2 pr-3">
                      {e.produtoCodigo} · {e.produtoNome}
                    </td>
                    <td className="py-2 pr-3">{e.lojaNome}</td>
                    <td className="py-2 pr-3">
                      {e.loteCodigo ? (
                        <>
                          {e.loteCodigo}
                          {e.validadeEm && (
                            <span className="block text-xs text-muted">validade {totemLoteDataBR(e.validadeEm)}</span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted">Gôndola</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {e.revogadaEm ? (
                        <Chip tone="bad">Revogada</Chip>
                      ) : e.impressaEm ? (
                        dataHoraBR(e.impressaEm)
                      ) : (
                        <Chip tone="warn">Ainda não</Chip>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {!e.revogadaEm && (
                        <Botao tone="bad" disabled={ocupado} onClick={() => revogar(e)}>
                          Revogar
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
    </div>
  );
}
