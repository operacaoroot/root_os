'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  TOTEM_GESTAO_ROTULO_EVENTO,
  TOTEM_TIPOS_EVENTO,
  type TotemGestaoAlertaLote,
  type TotemGestaoEventosPagina,
  type TotemGestaoResumo,
  type TotemTipoEvento,
} from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Botao, Card, Chip, Kpi, inputCls } from '../referencias/ui';
import { dataBR, dataHoraBR, haQuantoTempo } from './lojas/apoio';

/*
 * O RESUMO DO TOTEM — o que está ligado, o que está vencendo e o que o cliente
 * procurou sem achar, por loja. Quem tem a rede vê a soma de todas as lojas e
 * pode filtrar uma; o gerente vê só as lojas a que está vinculado.
 *
 * Os totais contam tudo; as listas de alerta vêm cortadas pela API, e a tela
 * diz quando há mais do que mostra.
 */

export default function PaginaDoResumo() {
  const { token, ready, can } = useAuth();
  const [lojaId, setLojaId] = useState('');
  const [resumo, setResumo] = useState<TotemGestaoResumo | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    if (!token) return;
    setErro(null);
    apiGet<TotemGestaoResumo>(`/totem-gestao/resumo${lojaId ? `?lojaId=${lojaId}` : ''}`, token)
      .then(setResumo)
      .catch((e: Error) => setErro(e.message));
  }, [token, lojaId]);

  useEffect(() => {
    if (ready) carregar();
  }, [ready, carregar]);

  if (!ready) return null;
  if (!can('totem.ver')) {
    return <p className="text-sm text-muted">Você não tem acesso ao painel do totem. Peça a permissão a quem administra a empresa.</p>;
  }
  if (!resumo) return <p className="text-sm text-muted">{erro ?? 'Carregando o resumo…'}</p>;

  const t = resumo.total;
  const varias = resumo.lojasDoEscopo.length > 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Totem</h1>
          <p className="text-sm text-muted">
            {resumo.lojaFiltrada
              ? 'Os números da loja escolhida.'
              : resumo.redeInteira
                ? 'A soma de todas as lojas da rede.'
                : 'Os números das lojas a que você está vinculado.'}{' '}
            Atualizado em {dataHoraBR(resumo.geradoEm)}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {varias && (
            <select
              className={`${inputCls} w-auto`}
              value={lojaId}
              onChange={(e) => setLojaId(e.target.value)}
              aria-label="Filtrar por loja"
            >
              <option value="">{resumo.redeInteira ? 'Todas as lojas' : 'Todas as minhas lojas'}</option>
              {resumo.lojasDoEscopo.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                  {l.ativa ? '' : ' (desativada)'}
                </option>
              ))}
            </select>
          )}
          <Botao onClick={carregar}>Atualizar</Botao>
        </div>
      </div>

      {erro && <p className="text-sm text-bad">{erro}</p>}

      {resumo.lojasDoEscopo.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            Você ainda não está vinculado a nenhuma loja. Peça a quem gerencia a rede para vincular o seu usuário na tela
            de usuários.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Totens ligados" valor={t.totensOnline} />
            <Kpi label="Totens sem sinal" valor={t.totensOffline} />
            <Kpi label="Buscas hoje" valor={t.buscasHoje} />
            <Kpi label="Buscas em 7 dias" valor={t.buscas7Dias} />
            <Kpi label="Cadastros hoje" valor={t.cadastrosHoje} />
            <Kpi label="Produtos sem lote" valor={t.produtosSemLote} />
            <Kpi label="Lotes vencidos" valor={t.lotesVencidos} />
            <Kpi label="Lotes vencendo em 15 dias" valor={t.lotesAVencer} />
          </div>
          <p className="text-[12px] text-muted">
            {t.ultimaSincronizacao
              ? `A última sincronização de um totem foi em ${dataHoraBR(t.ultimaSincronizacao)} (${haQuantoTempo(t.ultimaSincronizacao)}).`
              : 'Nenhum totem sincronizou ainda.'}
            {t.totensAguardando > 0 && ` ${t.totensAguardando} totem(ns) ainda aguardam ativação.`}
          </p>

          {resumo.porLoja.length > 1 && (
            <Card titulo="Por loja">
              <ul className="divide-y divide-border">
                {resumo.porLoja.map((l) => (
                  <li key={l.lojaId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-[13px]">
                    <button
                      type="button"
                      onClick={() => setLojaId(l.lojaId)}
                      className="text-left font-medium underline-offset-2 hover:underline"
                    >
                      {l.nome}
                      {!l.ativa && <span className="ml-1 text-muted">(desativada)</span>}
                    </button>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
                      <span>
                        {l.indicadores.totensOnline} ligado(s), {l.indicadores.totensOffline} sem sinal
                      </span>
                      <span>{l.indicadores.buscasHoje} busca(s) hoje</span>
                      <span>{l.indicadores.cadastrosHoje} cadastro(s) hoje</span>
                      {l.indicadores.lotesVencidos > 0 && <Chip tone="bad">{l.indicadores.lotesVencidos} vencido(s)</Chip>}
                      {l.indicadores.lotesAVencer > 0 && <Chip tone="warn">{l.indicadores.lotesAVencer} vencendo</Chip>}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <ListaDeLotes
              titulo="Lotes vencidos"
              vazio="Nenhum lote vencido nas lojas deste resumo."
              total={t.lotesVencidos}
              itens={resumo.lotesVencidos}
              tom="bad"
            />
            <ListaDeLotes
              titulo="Lotes vencendo nos próximos 15 dias"
              vazio="Nenhum lote vence nos próximos 15 dias."
              total={t.lotesAVencer}
              itens={resumo.lotesAVencer}
              tom="warn"
            />
            <Card titulo={`Produtos sem lote · ${t.produtosSemLote}`}>
              {resumo.produtosSemLote.length === 0 ? (
                <p className="text-[12px] text-muted">Todo produto ativo tem lote registrado nas lojas deste resumo.</p>
              ) : (
                <>
                  <ul className="space-y-1 text-[13px]">
                    {resumo.produtosSemLote.map((p) => (
                      <li key={`${p.lojaId}-${p.produtoId}`}>
                        {p.produtoNome} <span className="text-muted">· {p.lojaNome}</span>
                      </li>
                    ))}
                  </ul>
                  {t.produtosSemLote > resumo.produtosSemLote.length && (
                    <p className="mt-2 text-[11px] text-muted">
                      Mostrando {resumo.produtosSemLote.length} de {t.produtosSemLote}.
                    </p>
                  )}
                  <p className="mt-2 text-[11px] text-muted">
                    Sem lote, o totem mostra o produto sem lote e sem validade. O registro de lotes fica na tela{' '}
                    <Link href="/totem-gestao/lotes" className="underline underline-offset-2">Lotes</Link>.
                  </p>
                </>
              )}
            </Card>
            <Card titulo="O que buscaram e não acharam (7 dias)">
              {resumo.termosSemResultado.length === 0 ? (
                <p className="text-[12px] text-muted">Nenhuma busca ficou sem resultado nos últimos 7 dias.</p>
              ) : (
                <ol className="space-y-1 text-[13px]">
                  {resumo.termosSemResultado.map((x) => (
                    <li key={x.termo} className="flex justify-between gap-3">
                      <span>{x.termo}</span>
                      <span className="tabular-nums text-muted">{x.vezes} vez(es)</span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>

          <Eventos token={token} lojaId={lojaId} />
        </>
      )}
    </div>
  );
}

function ListaDeLotes({
  titulo,
  vazio,
  total,
  itens,
  tom,
}: {
  titulo: string;
  vazio: string;
  total: number;
  itens: TotemGestaoAlertaLote[];
  tom: 'bad' | 'warn';
}) {
  return (
    <Card titulo={`${titulo} · ${total}`}>
      {itens.length === 0 ? (
        <p className="text-[12px] text-muted">{vazio}</p>
      ) : (
        <>
          <ul className="space-y-1.5 text-[13px]">
            {itens.map((l) => (
              <li key={`${l.lojaId}-${l.produtoId}-${l.loteCodigo}`} className="flex flex-wrap items-baseline gap-x-2">
                <Chip tone={tom}>{dataBR(l.validadeEm)}</Chip>
                <span>{l.produtoNome}</span>
                <span className="text-muted">
                  · lote {l.loteCodigo} · {l.lojaNome}
                  {l.presumido && ' · remessa ainda não confirmada'}
                </span>
              </li>
            ))}
          </ul>
          {total > itens.length && (
            <p className="mt-2 text-[11px] text-muted">
              Mostrando {itens.length} de {total}.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function Eventos({ token, lojaId }: { token: string | null; lojaId: string }) {
  const [tipo, setTipo] = useState<TotemTipoEvento | ''>('');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<TotemGestaoEventosPagina | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setPagina(1);
  }, [lojaId, tipo, de, ate]);

  useEffect(() => {
    if (!token) return;
    const q = new URLSearchParams({ pagina: String(pagina), porPagina: '50' });
    if (lojaId) q.set('lojaId', lojaId);
    if (tipo) q.set('tipo', tipo);
    if (de) q.set('de', de);
    if (ate) q.set('ate', ate);
    apiGet<TotemGestaoEventosPagina>(`/totem-gestao/eventos?${q}`, token)
      .then((r) => {
        setDados(r);
        setErro(null);
      })
      .catch((e: Error) => setErro(e.message));
  }, [token, lojaId, tipo, de, ate, pagina]);

  const paginas = dados ? Math.max(1, Math.ceil(dados.total / dados.porPagina)) : 1;

  return (
    <Card titulo="O que aconteceu nos totens">
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <select
          className={inputCls}
          value={tipo}
          onChange={(e) => setTipo(e.target.value as TotemTipoEvento | '')}
          aria-label="Tipo de evento"
        >
          <option value="">Todos os tipos</option>
          {TOTEM_TIPOS_EVENTO.map((x) => (
            <option key={x} value={x}>
              {TOTEM_GESTAO_ROTULO_EVENTO[x]}
            </option>
          ))}
        </select>
        <input className={inputCls} type="date" value={de} onChange={(e) => setDe(e.target.value)} aria-label="Desde o dia" title="Desde o dia" />
        <input className={inputCls} type="date" value={ate} onChange={(e) => setAte(e.target.value)} aria-label="Até o dia" title="Até o dia" />
      </div>
      {erro && <p className="mb-2 text-sm text-bad">{erro}</p>}
      {!dados ? (
        <p className="text-[12px] text-muted">Carregando os eventos…</p>
      ) : dados.itens.length === 0 ? (
        <p className="text-[12px] text-muted">Nenhum evento com esses filtros.</p>
      ) : (
        <>
          <ul className="divide-y divide-border text-[13px]">
            {dados.itens.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5">
                <span className="tabular-nums text-muted">{dataHoraBR(e.ocorridoEm)}</span>
                <Chip tone={e.tipo === 'busca_sem_resultado' ? 'warn' : 'muted'}>
                  {TOTEM_GESTAO_ROTULO_EVENTO[e.tipo as TotemTipoEvento] ?? e.tipo}
                </Chip>
                {e.termo && <span>“{e.termo}”</span>}
                {e.produtoNome && <span>{e.produtoNome}</span>}
                <span className="text-muted">{[e.lojaNome, e.dispositivoNome].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted">
            <span>
              {dados.total.toLocaleString('pt-BR')} evento(s), página {dados.pagina} de {paginas}
            </span>
            <span className="flex gap-2">
              <Botao disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
                Anterior
              </Botao>
              <Botao disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>
                Próxima
              </Botao>
            </span>
          </div>
        </>
      )}
    </Card>
  );
}
