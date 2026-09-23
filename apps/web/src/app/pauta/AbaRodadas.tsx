'use client';

import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  PAUTA_CANAL_LABEL,
  PAUTA_ORIGEM_ROTULOS,
  PAUTA_ORIGENS,
  type PautaCanalEstado,
  type PautaOrigem,
  type PautaRodadaDetalhe,
  type PautaRodadaList,
} from '@mktos/shared';
import { ErroDaApi, apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { Botao, Card, Chip, inputCls } from '../referencias/ui';
import { publicarComAprovacao } from './aprovacao';

interface Props {
  token: string | null;
  editavel: boolean;
  podePublicar: boolean;
  /** `codigo` é o da API (ver `ErroDaApi`); a caixa de erro decide por ele. */
  onErro: (m: string | null, codigo?: string | null) => void;
  bump: number;
  onMudou: () => void;
}

const TOM_RODADA: Record<string, 'muted' | 'good' | 'warn' | 'bad'> = {
  coletando: 'warn',
  curada: 'good',
  aprovada: 'good',
  publicada: 'good',
  falhou: 'bad',
};

// O item curado é JSON gravado: a letra só aparece se for uma das cinco.
function temOrigem(o: unknown): o is PautaOrigem {
  return typeof o === 'string' && (PAUTA_ORIGENS as readonly string[]).includes(o);
}

export function AbaRodadas({ token, editavel, podePublicar, onErro, bump, onMudou }: Props) {
  const [data, setData] = useState<PautaRodadaList | null>(null);
  const [canais, setCanais] = useState<{ whatsapp: PautaCanalEstado } | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<PautaRodadaDetalhe | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!token) return;
    apiGet<PautaRodadaList>('/pauta/rodadas', token)
      .then(setData)
      .catch((e: Error) => onErro(e.message));
    apiGet<{ whatsapp: PautaCanalEstado }>('/pauta/canais', token)
      .then(setCanais)
      .catch(() => undefined);
  }, [token, bump, onErro]);

  useEffect(() => {
    if (!token || !aberta) {
      setDetalhe(null);
      return;
    }
    apiGet<PautaRodadaDetalhe>(`/pauta/rodadas/${aberta}`, token)
      .then((d) => {
        setDetalhe(d);
        setRascunho(Object.fromEntries(d.pecas.map((p) => [p.id, p.corpo])));
      })
      .catch((e: Error) => onErro(e.message));
  }, [token, aberta, bump, onErro]);

  const acao = async (nome: string, fn: () => Promise<unknown>) => {
    onErro(null);
    setOcupado(nome);
    try {
      await fn();
      onMudou();
    } catch (e) {
      // O código sobe junto com a frase: publicar passa pela fila de aprovação,
      // e a recusa de conector desligado (RF-G-06) precisa chegar à caixa de
      // erro reconhecível, para a tela poder apontar o caminho de conserto.
      onErro((e as Error).message, e instanceof ErroDaApi ? e.codigo : null);
    } finally {
      setOcupado(null);
    }
  };

  // A coleta não para por uma fonte: a que falhou vem só contada em `erros`, e
  // a pulada com aviso (teto do mês da busca), em `puladas`; o motivo dos dois
  // fica gravado na fonte. Sem este aviso o clique pareceria ter dado certo.
  const coletar = async () => {
    const saida: { erros?: number; puladas?: number } = {};
    await acao('coletar', async () => {
      const r = await apiPost<{ novas: number; fontes: number; erros: number; puladas?: number }>(
        '/pauta/feeds/coletar',
        {},
        token,
      );
      saida.erros = r.erros;
      saida.puladas = r.puladas;
    });
    const partes = [
      saida.erros ? `${saida.erros} fonte(s) falharam na coleta` : '',
      saida.puladas ? `${saida.puladas} fonte(s) foram puladas (teto do mês ou consulta faltando)` : '',
    ].filter(Boolean);
    if (partes.length) onErro(`${partes.join('; ')} — o motivo está em Referências → Radar.`);
  };

  const publicar = async (pecaId: string, resumo: string) =>
    acao(`pub-${pecaId}`, () => publicarComAprovacao(pecaId, resumo, token));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Botao
          onClick={coletar}
          disabled={!editavel || ocupado === 'coletar'}
        >
          {ocupado === 'coletar' ? 'Coletando…' : 'Coletar fontes'}
        </Botao>
        <Botao
          tone="brand"
          onClick={() => acao('gerar', () => apiPost('/pauta/rodadas', {}, token))}
          disabled={!editavel || ocupado === 'gerar'}
        >
          {ocupado === 'gerar' ? 'Curando…' : 'Gerar rodada agora'}
        </Botao>
        {canais?.whatsapp && (
          <Chip tone={canais.whatsapp.conectada ? 'good' : 'bad'}>
            WhatsApp: {canais.whatsapp.conectada ? 'conectado' : 'indisponível'}
          </Chip>
        )}
        {canais?.whatsapp && !canais.whatsapp.conectada && canais.whatsapp.motivo && (
          <span className="text-xs text-muted">{canais.whatsapp.motivo}</span>
        )}
      </div>

      {data && data.items.length === 0 && (
        <Card>
          <p className="text-sm text-muted">
            Nenhuma rodada ainda. Cadastre feeds RSS em{' '}
            <a href="/referencias" className="text-brand hover:underline">
              Referências → Radar
            </a>
            , colete e gere a primeira.
          </p>
        </Card>
      )}

      <div className="space-y-2">
        {data?.items.map((r) => (
          <div key={r.id} className="rounded-xl border border-border bg-surface">
            <button
              onClick={() => setAberta(aberta === r.id ? null : r.id)}
              className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={TOM_RODADA[r.status] ?? 'muted'}>{r.status}</Chip>
                  <Chip>{r.itens} item(ns)</Chip>
                  <Chip tone={r.pecas ? 'brand' : 'muted'}>{r.pecas} peça(s)</Chip>
                  {r.model && <Chip>{r.model}</Chip>}
                  {r.rotina && <Chip tone="brand">{r.rotina}</Chip>}
                </div>
                <p className="mt-1 truncate text-sm">{r.titulo}</p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {new Date(r.criadaEm).toLocaleString('pt-BR')} · janela de{' '}
                  {Math.round((+new Date(r.janelaFim) - +new Date(r.janelaIni)) / 3600000)}h
                </p>
                {r.erro && <p className="mt-0.5 text-xs text-bad">{r.erro}</p>}
              </div>
            </button>

            {aberta === r.id && detalhe && (
              <div className="border-t border-border px-4 py-3">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Botao
                    tone="brand"
                    onClick={() => acao('derivar', () => apiPost(`/pauta/rodadas/${r.id}/derivar`, {}, token))}
                    disabled={!editavel || detalhe.pecas.length > 0 || ocupado === 'derivar'}
                  >
                    {ocupado === 'derivar' ? 'Derivando…' : 'Gerar peças'}
                  </Botao>
                  <Botao tone="bad" onClick={() => acao('rm', () => apiDelete(`/pauta/rodadas/${r.id}`, token))} disabled={!editavel}>
                    Remover rodada
                  </Botao>
                  <span className="text-xs text-muted">
                    {detalhe.fichasUsadas} ficha(s) campeã(s) no prompt
                  </span>
                </div>

                {detalhe.corpo && (
                  <div className="mb-4 whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-3 text-sm">
                    {detalhe.corpo}
                  </div>
                )}

                {detalhe.itens.some((i) => temOrigem(i.origem)) && (
                  <p className="mb-1.5 text-xs text-muted">
                    Origem: {PAUTA_ORIGENS.map((o) => `${o} ${PAUTA_ORIGEM_ROTULOS[o].toLowerCase()}`).join(' · ')}
                  </p>
                )}
                {detalhe.itens.length > 0 && (
                  <ul className="mb-4 space-y-1.5">
                    {detalhe.itens.map((i) => (
                      <li key={i.url} className="text-sm">
                        {temOrigem(i.origem) && (
                          <span
                            className="mr-1.5 inline-block rounded border border-border px-1 font-mono text-[11px] text-muted"
                            title={PAUTA_ORIGEM_ROTULOS[i.origem]}
                            aria-label={`Origem: ${PAUTA_ORIGEM_ROTULOS[i.origem]}`}
                          >
                            {i.origem}
                          </span>
                        )}
                        <a
                          href={i.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-brand hover:underline"
                        >
                          {i.titulo} <ExternalLink size={12} />
                        </a>
                        {i.porque && <span className="block text-xs text-muted">{i.porque}</span>}
                      </li>
                    ))}
                  </ul>
                )}

                {detalhe.pecas.map((p) => (
                  <div key={p.id} className="mb-3 rounded-lg border border-border p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Chip tone="brand">{PAUTA_CANAL_LABEL[p.canal] ?? p.canal}</Chip>
                      <Chip>{p.formato}</Chip>
                      <Chip tone={p.status === 'publicada' ? 'good' : p.status === 'descartada' ? 'muted' : 'warn'}>
                        {p.status}
                      </Chip>
                      {p.bioLinkId && <Chip tone="good">link rastreado</Chip>}
                      <span className="text-sm">{p.titulo}</span>
                    </div>

                    <textarea
                      className={`${inputCls} min-h-[120px] font-mono text-xs`}
                      value={rascunho[p.id] ?? p.corpo}
                      onChange={(e) => setRascunho((r0) => ({ ...r0, [p.id]: e.target.value }))}
                      disabled={p.status === 'publicada' || !editavel}
                    />

                    {p.canal === 'instagram' && Array.isArray((p.meta as { slides?: unknown[] }).slides) && (
                      <p className="mt-1 text-xs text-muted">
                        {((p.meta as { slides: unknown[] }).slides ?? []).length} slides prontos — use
                        “Baixar carrossel” e rode a máquina de carrossel (marca root).
                      </p>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {p.status !== 'publicada' && (
                        <>
                          <Botao
                            onClick={() =>
                              acao(`save-${p.id}`, () =>
                                apiPatch(`/pauta/pecas/${p.id}`, { corpo: rascunho[p.id] ?? p.corpo }, token),
                              )
                            }
                            disabled={!editavel}
                          >
                            Salvar texto
                          </Botao>

                          {(p.canal === 'whatsapp' || p.canal === 'clickup') && (
                            <Botao
                              tone="brand"
                              onClick={() => publicar(p.id, `Publicar "${p.titulo}" em ${p.canal}`)}
                              disabled={
                                !podePublicar ||
                                ocupado === `pub-${p.id}` ||
                                (p.canal === 'whatsapp' && !canais?.whatsapp.conectada)
                              }
                              title={
                                p.canal === 'whatsapp' && !canais?.whatsapp.conectada
                                  ? (canais?.whatsapp.motivo ?? 'WhatsApp indisponível')
                                  : 'Passa pela aprovação antes de sair'
                              }
                            >
                              {ocupado === `pub-${p.id}` ? 'Publicando…' : 'Publicar'}
                            </Botao>
                          )}

                          {p.canal === 'instagram' && (
                            <a
                              href={`/api/pauta/pecas/${p.id}/carrossel`}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm text-muted hover:text-text"
                            >
                              Baixar carrossel
                            </a>
                          )}

                          <Botao
                            tone="ghost"
                            onClick={() =>
                              acao(`desc-${p.id}`, () =>
                                apiPatch(`/pauta/pecas/${p.id}`, { status: 'descartada' }, token),
                              )
                            }
                            disabled={!editavel}
                          >
                            Descartar
                          </Botao>
                        </>
                      )}
                      {p.status === 'publicada' && p.publicadaEm && (
                        <span className="text-xs text-muted">
                          publicada em {new Date(p.publicadaEm).toLocaleString('pt-BR')}
                          {p.externalId && ` · id ${p.externalId.slice(0, 16)}`}
                        </span>
                      )}
                      {p.erro && <span className="text-xs text-bad">{p.erro}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
