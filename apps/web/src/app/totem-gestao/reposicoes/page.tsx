'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  TotemReposicaoNovaSchema,
  totemLoteDataBR,
  type TotemLoteDoPainel,
  type TotemLotePendente,
  type TotemPendenciasDaLoja,
  type TotemReposicaoDoPainel,
} from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Botao, Campo, Card, Chip, Kpi, inputCls } from '../../referencias/ui';
import { dataHoraBR, mensagemDoErro, useCadastrosDoLote } from '../lotes/comum';

interface Formulario {
  lojaId: string;
  produtoId: string;
  modo: 'lista' | 'manual';
  loteId: string;
  codigo: string;
  fabricadoEm: string;
  validadeEm: string;
}

const VAZIO: Formulario = {
  lojaId: '',
  produtoId: '',
  modo: 'lista',
  loteId: '',
  codigo: '',
  fabricadoEm: '',
  validadeEm: '',
};

function textoDosDias(l: TotemLotePendente): string {
  if (l.dias < 0) return `venceu em ${totemLoteDataBR(l.validadeEm)}`;
  if (l.dias === 0) return 'vence hoje';
  return l.dias === 1 ? 'vence amanhã' : `vence em ${l.dias} dias`;
}

function ListaDeLotes({ titulo, lotes, tom }: { titulo: string; lotes: TotemLotePendente[]; tom: 'bad' | 'warn' }) {
  if (lotes.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted">{titulo}</p>
      <ul className="space-y-1 text-sm">
        {lotes.map((l) => (
          <li key={`${l.produtoId}-${l.loteId}`} className="flex flex-wrap items-center gap-2">
            <span>
              {l.codigo} · {l.nome}, lote {l.loteCodigo}
            </span>
            <Chip tone={tom}>{textoDosDias(l)}</Chip>
            {l.presumido && <Chip tone="muted">recebimento não confirmado</Chip>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PaginaDasReposicoes() {
  const { token, ready, can } = useAuth();
  const { lojas, produtos, erro: erroDosCadastros } = useCadastrosDoLote(token);
  const [filtroLoja, setFiltroLoja] = useState('');
  const [pendencias, setPendencias] = useState<TotemPendenciasDaLoja[]>([]);
  const [reposicoes, setReposicoes] = useState<TotemReposicaoDoPainel[]>([]);
  const [lotes, setLotes] = useState<TotemLoteDoPainel[]>([]);
  const [form, setForm] = useState<Formulario>(VAZIO);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const podeRegistrar = can('totem.reposicao');

  const carregar = useCallback(() => {
    if (!token) return;
    const q = filtroLoja ? `?lojaId=${filtroLoja}` : '';
    Promise.all([
      apiGet<TotemPendenciasDaLoja[]>(`/totem-lotes/pendencias${q}`, token),
      apiGet<TotemReposicaoDoPainel[]>(`/totem-lotes/reposicoes${q}`, token),
    ])
      .then(([p, r]) => {
        setPendencias(p);
        setReposicoes(r);
      })
      .catch((e: unknown) => setErro(mensagemDoErro(e)));
  }, [token, filtroLoja]);

  useEffect(carregar, [carregar]);

  useEffect(() => {
    setLotes([]);
    if (!token || !form.produtoId) return;
    apiGet<TotemLoteDoPainel[]>(`/totem-lotes/lotes?produtoId=${form.produtoId}`, token)
      .then(setLotes)
      .catch((e: unknown) => setErro(mensagemDoErro(e)));
  }, [token, form.produtoId]);

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setAviso(null);
    const lido = TotemReposicaoNovaSchema.safeParse({
      lojaId: form.lojaId,
      produtoId: form.produtoId,
      ...(form.modo === 'lista'
        ? { loteId: form.loteId || undefined }
        : {
            loteManual: {
              codigo: form.codigo,
              fabricadoEm: form.fabricadoEm || null,
              validadeEm: form.validadeEm || null,
            },
          }),
    });
    if (!lido.success) return setErro(lido.error.issues[0]?.message ?? 'Confira a reposição.');
    setSalvando(true);
    try {
      const r = await apiPost<TotemReposicaoDoPainel>('/totem-lotes/reposicoes', lido.data, token);
      setForm({ ...VAZIO, lojaId: form.lojaId });
      setAviso(`Reposição de ${r.produtoNome} registrada em ${r.lojaNome}, lote ${r.loteCodigo}.`);
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
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Reposições</h1>
          <p className="text-sm text-muted">
            A reposição diz qual lote está na prateleira de cada loja. É ela que o totem e a etiqueta mostram primeiro.
          </p>
        </div>
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
      </header>

      {(erro || erroDosCadastros) && <p className="text-sm text-bad">{erro ?? erroDosCadastros}</p>}
      {aviso && <p className="text-sm text-good">{aviso}</p>}

      {pendencias.map((p) => (
        <Card key={p.lojaId} titulo={`Pendências de ${p.lojaNome}`}>
          <div className="grid grid-cols-3 gap-3">
            <Kpi label="Sem lote" valor={p.semLote.length} />
            <Kpi label="Vencidos" valor={p.vencidos.length} />
            <Kpi label="Vencendo" valor={p.vencendo.length} />
          </div>
          <div className="mt-4 space-y-3">
            <ListaDeLotes titulo="Lote vencido na prateleira" lotes={p.vencidos} tom="bad" />
            <ListaDeLotes titulo="Vence em até 15 dias" lotes={p.vencendo} tom="warn" />
            {p.semLote.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted">Produto sem lote registrado na loja</p>
                <p className="text-sm">{p.semLote.map((s) => `${s.codigo} · ${s.nome}`).join('; ')}</p>
              </div>
            )}
            {p.semLote.length + p.vencidos.length + p.vencendo.length === 0 && (
              <p className="text-sm text-muted">Nenhuma pendência nesta loja.</p>
            )}
          </div>
        </Card>
      ))}

      {podeRegistrar && (
        <Card titulo="Registrar reposição">
          <form onSubmit={registrar} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo label="Loja">
                <select className={inputCls} value={form.lojaId} onChange={(e) => setForm({ ...form, lojaId: e.target.value })}>
                  <option value="">Selecione a loja</option>
                  {lojas.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo label="Produto">
                <select
                  className={inputCls}
                  value={form.produtoId}
                  onChange={(e) => setForm({ ...form, produtoId: e.target.value, loteId: '' })}
                >
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
            </div>
            <fieldset className="flex flex-wrap gap-4 text-sm">
              <legend className="mb-1 text-xs text-muted">De onde veio o lote</legend>
              <label className="flex items-center gap-2">
                <input type="radio" checked={form.modo === 'lista'} onChange={() => setForm({ ...form, modo: 'lista' })} />
                Lote já registrado
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={form.modo === 'manual'}
                  onChange={() => setForm({ ...form, modo: 'manual' })}
                />
                Lote que a loja recebeu fora da remessa
              </label>
            </fieldset>
            {form.modo === 'lista' ? (
              <Campo label="Lote">
                <select
                  className={inputCls}
                  value={form.loteId}
                  disabled={!form.produtoId}
                  onChange={(e) => setForm({ ...form, loteId: e.target.value })}
                >
                  <option value="">Selecione o lote</option>
                  {lotes.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.codigo} · validade {totemLoteDataBR(l.validadeEm)}
                      {l.situacao === 'vencido' ? ' (vencido)' : ''}
                    </option>
                  ))}
                </select>
              </Campo>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <Campo label="Código do lote">
                  <input
                    className={inputCls}
                    value={form.codigo}
                    maxLength={40}
                    onChange={(e) => setForm({ ...form, codigo: e.target.value })}
                  />
                </Campo>
                <Campo label="Fabricação">
                  <input
                    type="date"
                    className={inputCls}
                    value={form.fabricadoEm}
                    onChange={(e) => setForm({ ...form, fabricadoEm: e.target.value })}
                  />
                </Campo>
                <Campo label="Validade" hint="Em branco, sai da fabricação e da validade padrão do produto.">
                  <input
                    type="date"
                    className={inputCls}
                    value={form.validadeEm}
                    onChange={(e) => setForm({ ...form, validadeEm: e.target.value })}
                  />
                </Campo>
              </div>
            )}
            <Botao type="submit" tone="brand" disabled={salvando || !form.lojaId || !form.produtoId}>
              Registrar reposição
            </Botao>
          </form>
        </Card>
      )}

      <Card titulo="Últimas reposições">
        {reposicoes.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma reposição registrada ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="py-2 pr-3 font-medium">Quando</th>
                  <th className="py-2 pr-3 font-medium">Loja</th>
                  <th className="py-2 pr-3 font-medium">Produto</th>
                  <th className="py-2 pr-3 font-medium">Lote</th>
                  <th className="py-2 pr-3 font-medium">Validade</th>
                  <th className="py-2 font-medium">Origem</th>
                </tr>
              </thead>
              <tbody>
                {reposicoes.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3 whitespace-nowrap">{dataHoraBR(r.repostoEm)}</td>
                    <td className="py-2 pr-3">{r.lojaNome}</td>
                    <td className="py-2 pr-3">
                      {r.produtoCodigo} · {r.produtoNome}
                    </td>
                    <td className="py-2 pr-3">{r.loteCodigo}</td>
                    <td className="py-2 pr-3">{totemLoteDataBR(r.validadeEm)}</td>
                    <td className="py-2 text-muted">{r.origem === 'remessa' ? 'Recebimento da remessa' : 'Registro manual'}</td>
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
