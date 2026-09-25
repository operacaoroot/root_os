'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  LOTE_ESTADO_ROTULO,
  PAUTA_CAPACIDADE_DE_ENVIAR_AO_YOUTUBE,
  PAUTA_CAPACIDADE_DE_PUBLICAR_NO_YOUTUBE,
  PAUTA_FORA_DO_LOTE_DM,
  PAUTA_FORA_DO_LOTE_YOUTUBE,
  PAUTA_FORMATO_DA_SEMANA_ROTULO,
  diaNoFuso,
  horaNoFuso,
  type PautaAprovacaoDaSemana,
  type PautaLoteMontado,
} from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { Botao, Chip } from '../referencias/ui';
import { LinhaDoTempoDaPeca } from './LinhaDoTempoDaPeca';

/*
 * MD8: "Aprovar a semana" de um episódio num ponto só.
 *
 * O botão monta o lote com o conteúdo EXATO de cada peça (legenda, mídia,
 * conta e horário) e pede a assinatura: vai a /atendimento como R4, e quem
 * assina é OUTRA pessoa, titular, com senha e motivo. Quem montou não assina.
 * Depois de assinado, cada peça sai no horário pela rotina de publicação — se
 * a publicação automática da empresa estiver ligada; desligada, nada sai
 * sozinho e a semana segue manual. Marcar "fica fora" deixa a peça fora do
 * lote (e manual). "Cancelar a semana" revoga o lote sem pedir assinatura:
 * só diminui o alcance.
 *
 * MD10: o vídeo do episódio no YouTube entra no MESMO lote quando está pronto
 * (o envio privado e, com a auditoria aprovada, o agendamento). A linha do
 * YouTube diz o que falta e o que entra, e ele também pode ficar fora.
 *
 * MD11: as regras da DM automática (uma por matéria com palavra e link
 * público) também entram no lote, com o texto exato e o teto por dia. Elas só
 * mandam alguma coisa com a nota `pauta.dm.automatica` ligada — a tela diz.
 */

/** O que do YouTube entra no lote, pelo que a API mandou: os dois, só o envio (modo teste) ou só o agendamento (o vídeo já subiu). */
export function oQueEntraDoYoutube(capacidades: string[]): string {
  const envio = capacidades.includes(PAUTA_CAPACIDADE_DE_ENVIAR_AO_YOUTUBE);
  const publicacao = capacidades.includes(PAUTA_CAPACIDADE_DE_PUBLICAR_NO_YOUTUBE);
  if (envio && publicacao) return 'Entra com o envio privado (o Mac sobe o vídeo) e o agendamento no horário.';
  if (envio) return 'Modo teste: entra só o envio, para o canal de teste. O vídeo enviado agora fica privado para sempre e não é publicado depois.';
  return 'O vídeo já está no YouTube, privado: entra o agendamento no horário.';
}

interface Retida {
  status: 'aguardando_aprovacao';
  fila?: string;
  expiraEm?: string;
}

const foiRetida = (r: unknown): r is Retida => !!r && typeof r === 'object' && (r as { status?: unknown }).status === 'aguardando_aprovacao';
const quando = (iso: string) => {
  const d = new Date(iso);
  return `${diaNoFuso(d).slice(8, 10)}/${diaNoFuso(d).slice(5, 7)} ${horaNoFuso(d)}`;
};

export function AprovarASemana({
  episodioId,
  token,
  podePublicar,
  onErro,
  onMudou,
}: {
  episodioId: string;
  token: string | null;
  /** `pauta.publicar`: montar, pedir a assinatura e cancelar. */
  podePublicar: boolean;
  onErro: (m: string | null) => void;
  onMudou: () => void;
}) {
  const [estado, setEstado] = useState<PautaAprovacaoDaSemana | null>(null);
  const [fora, setFora] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState(false);
  const [pedido, setPedido] = useState<{ fila: string; expiraEm: string | null } | null>(null);
  const [cancelando, setCancelando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!token) return;
    try {
      const e = await apiGet<PautaAprovacaoDaSemana>(`/pauta/episodios/${episodioId}/semana/aprovacao`, token);
      setEstado(e);
      // Começa fora o que não pode entrar agora; o resto entra marcado.
      setFora(new Set(e.pecas.filter((p) => p.problema && !p.noLote).map((p) => p.id)));
    } catch (err) {
      onErro(`A aprovação da semana não carregou: ${(err as Error).message}`);
    }
  }, [token, episodioId, onErro]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const agir = async (fn: () => Promise<void>) => {
    onErro(null);
    setOcupado(true);
    try {
      await fn();
      await carregar();
      onMudou();
    } catch (err) {
      onErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const pedirAssinatura = async (loteId: string) => {
    const r = await apiPost<unknown>(`/approvals/lotes/${loteId}/pedir-assinatura`, {}, token);
    if (foiRetida(r)) setPedido({ fila: r.fila ?? '/atendimento', expiraEm: r.expiraEm ?? null });
  };

  const aprovar = () =>
    agir(async () => {
      const m = await apiPost<PautaLoteMontado>(`/pauta/episodios/${episodioId}/semana/preparar-aprovacao`, { fora: [...fora] }, token);
      await pedirAssinatura(m.loteId);
    });

  if (!estado) return <p className="text-xs text-muted">Carregando a aprovação da semana…</p>;

  const livres = estado.pecas.filter((p) => p.status !== 'publicada' && p.noLote?.estadoDoLote !== 'ativo');
  const entram = livres.filter((p) => !fora.has(p.id));
  const yt = estado.youtube ?? null;
  const youtubeEntra = !!yt?.entra && !fora.has(PAUTA_FORA_DO_LOTE_YOUTUBE);
  const dm = estado.dm ?? null;
  const regrasQueEntram = (dm?.regras ?? []).filter((r) => !r.problema && r.noLote?.estadoDoLote !== 'ativo');
  const dmEntra = regrasQueEntram.length > 0 && !fora.has(PAUTA_FORA_DO_LOTE_DM);
  const bloqueio = estado.impedimentos.length > 0 || entram.some((p) => p.problema) || (entram.length === 0 && !youtubeEntra && !dmEntra);
  const rotuloDoBotao = [
    entram.length ? `${entram.length} post${entram.length === 1 ? '' : 's'}` : '',
    youtubeEntra ? 'o vídeo no YouTube' : '',
    dmEntra ? `${regrasQueEntram.length} DM${regrasQueEntram.length === 1 ? '' : 's'} automática${regrasQueEntram.length === 1 ? '' : 's'}` : '',
  ]
    .filter(Boolean)
    .join(' + ');
  const alternar = (id: string) =>
    setFora((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="space-y-3 text-sm" aria-label={`Aprovar a semana de ${estado.apelido}`}>
      <p className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-muted">Publicação automática da empresa:</span>
        {estado.automaticaLigada ? (
          <Chip tone="good">ligada</Chip>
        ) : (
          <Chip tone="warn">desligada — assinada, a semana não sai sozinha</Chip>
        )}
      </p>

      {estado.impedimentos.map((i) => (
        <p key={i} className="break-words rounded-lg border border-warn/40 bg-warn/10 px-2 py-1 text-xs text-warn">
          {i}
        </p>
      ))}

      <ul className="space-y-2">
        {estado.pecas.map((p) => {
          const travada = p.status === 'publicada' || p.noLote?.estadoDoLote === 'ativo';
          return (
            <li key={p.id} className="space-y-1 rounded-lg border border-border p-2" aria-label={`${PAUTA_FORMATO_DA_SEMANA_ROTULO[p.formato]} da matéria ${p.itemN}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium">
                  {PAUTA_FORMATO_DA_SEMANA_ROTULO[p.formato]} · matéria {p.itemN}
                </span>
                {p.slot && <span className="font-mono text-xs text-muted">{quando(p.slot)}</span>}
                {!travada && podePublicar && (
                  <label className="ml-auto flex items-center gap-1 text-xs text-muted">
                    <input type="checkbox" checked={fora.has(p.id)} onChange={() => alternar(p.id)} />
                    fica fora
                  </label>
                )}
              </div>
              <p className="break-words text-xs">{p.titulo}</p>
              <LinhaDoTempoDaPeca etapa={p.etapa} />
              {p.problema && !fora.has(p.id) && <p className="break-words text-xs text-bad">{p.problema}</p>}
              {p.problema && fora.has(p.id) && <p className="break-words text-xs text-muted">Fora do lote: {p.problema}</p>}
            </li>
          );
        })}
      </ul>

      {yt && (
        <div className="space-y-1 rounded-lg border border-border p-2" aria-label="O vídeo no YouTube">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium">Vídeo no YouTube</span>
            {yt.publicarEm && <span className="font-mono text-xs text-muted">{quando(yt.publicarEm)}</span>}
            {yt.noLote && <Chip tone={yt.noLote.estadoDoLote === 'ativo' ? 'good' : 'warn'}>{LOTE_ESTADO_ROTULO[yt.noLote.estadoDoLote]}</Chip>}
            {yt.entra && podePublicar && (
              <label className="ml-auto flex items-center gap-1 text-xs text-muted">
                <input type="checkbox" checked={fora.has(PAUTA_FORA_DO_LOTE_YOUTUBE)} onChange={() => alternar(PAUTA_FORA_DO_LOTE_YOUTUBE)} />
                fica fora
              </label>
            )}
          </div>
          {yt.entra && <p className="break-words text-xs text-muted">{oQueEntraDoYoutube(yt.capacidades)}</p>}
          {yt.entra && yt.capacidades.includes(PAUTA_CAPACIDADE_DE_PUBLICAR_NO_YOUTUBE) && !yt.automatica && (
            <p className="break-words text-xs text-warn">
              A publicação automática está desligada: o agendamento não sai sozinho, e o horário é marcado à mão no Studio.
            </p>
          )}
          {!yt.entra && yt.faltas.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">
              {yt.faltas.map((f) => (
                <li key={f} className="break-words">
                  {f}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {dm && dm.regras.length > 0 && (
        <div className="space-y-2 rounded-lg border border-border p-2" aria-label="A DM automática">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium">DM automática a quem comentar a palavra</span>
            {dm.automatica ? <Chip tone="good">ligada</Chip> : <Chip tone="warn">desligada — assinada, nada sai sozinho</Chip>}
            {regrasQueEntram.length > 0 && podePublicar && (
              <label className="ml-auto flex items-center gap-1 text-xs text-muted">
                <input type="checkbox" checked={fora.has(PAUTA_FORA_DO_LOTE_DM)} onChange={() => alternar(PAUTA_FORA_DO_LOTE_DM)} />
                fica fora
              </label>
            )}
          </div>
          {!dm.automatica && (
            <p className="break-words text-xs text-muted">
              Enquanto a nota pauta.dm.automatica não for ligada (depois do App Review da Meta), a resposta segue à mão, pela fila de comentários.
            </p>
          )}
          <ul className="space-y-2">
            {dm.regras.map((r) => (
              <li key={r.itemId} className="space-y-1 text-xs" aria-label={`DM da matéria ${r.itemN}`}>
                <p className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">
                    matéria {r.itemN} · {r.palavra}
                  </span>
                  <span className="text-muted">até {r.tetoPorDia} por dia{r.janelaAte ? `, até ${quando(r.janelaAte)}` : ''}</span>
                  {r.noLote && <Chip tone={r.noLote.estadoDoLote === 'ativo' ? 'good' : 'warn'}>{LOTE_ESTADO_ROTULO[r.noLote.estadoDoLote]}</Chip>}
                </p>
                {r.texto ? (
                  <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded bg-surface-2 px-2 py-1 text-[12px]">{r.texto}</pre>
                ) : (
                  !r.problema && <p className="break-words text-muted">O link rastreado da matéria nasce na montagem, e o texto sai com ele.</p>
                )}
                {r.problema && <p className="break-words text-muted">Fica de fora: {r.problema}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {podePublicar && (
        <div className="space-y-1">
          <Botao tone="brand" onClick={aprovar} disabled={ocupado || bloqueio}>
            {ocupado ? 'Montando…' : `Aprovar a semana (${rotuloDoBotao || '0 posts'})`}
          </Botao>
          <p className="text-[11px] text-muted">
            Monta o lote com o conteúdo exato de cada post e pede a assinatura de outra pessoa, titular, em /atendimento (senha e
            motivo, em até 10 minutos). Quem monta não assina.
          </p>
        </div>
      )}

      {pedido && (
        <p role="status" className="break-words text-xs text-warn">
          A semana foi para a fila: a titular assina em{' '}
          <a className="underline" href={pedido.fila}>
            {pedido.fila}
          </a>
          {pedido.expiraEm ? ` até ${horaNoFuso(new Date(pedido.expiraEm))}` : ''}. Nada sai antes disso.
        </p>
      )}

      {estado.lotes.length > 0 && (
        <section className="space-y-2" aria-label="Lotes da semana">
          {estado.lotes.map((l) => (
            <div key={l.id} className="space-y-1 rounded-lg border border-border p-2 text-xs" aria-label={`Lote ${l.hashCurto}`}>
              <p className="flex flex-wrap items-center gap-1.5">
                <Chip tone={l.estado === 'ativo' ? 'good' : 'warn'}>{LOTE_ESTADO_ROTULO[l.estado]}</Chip>
                <span className="text-muted">
                  {l.ativos} de {l.itens} post(s) valendo · hash {l.hashCurto} · vale até {quando(l.validaAte)}
                </span>
              </p>
              {podePublicar && (
                <div className="flex flex-wrap gap-2">
                  {l.estado !== 'ativo' && l.montadoPorMim && (
                    <Botao onClick={() => agir(() => pedirAssinatura(l.id))} disabled={ocupado}>
                      Pedir a assinatura de novo
                    </Botao>
                  )}
                  {cancelando === l.id ? (
                    <>
                      <Botao
                        tone="bad"
                        onClick={() =>
                          agir(async () => {
                            await apiPost(`/pauta/lotes/${l.id}/cancelar`, {}, token);
                            setCancelando(null);
                            setPedido(null);
                          })
                        }
                        disabled={ocupado}
                      >
                        Confirmar: cancelar a semana
                      </Botao>
                      <Botao tone="ghost" onClick={() => setCancelando(null)}>
                        Manter
                      </Botao>
                    </>
                  ) : (
                    <Botao tone="bad" onClick={() => setCancelando(l.id)} disabled={ocupado}>
                      Cancelar a semana
                    </Botao>
                  )}
                </div>
              )}
              {cancelando === l.id && (
                <p className="break-words text-muted">Nada mais sai por este lote. O que já foi publicado fica, e as peças aprovadas seguem na agenda, no manual.</p>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
