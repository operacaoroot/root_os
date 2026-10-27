'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { FORMATOS_COM_REGUA, MOTIVOS_RAPIDOS, type TriagemCard, type TriagemPainel } from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { btn, btnPrimario } from '@/components/maquina/pecas';

/*
 * Marketing › IDEIAS (Triagem), a do ROOT Estúdio (26/10/2026): um card por vez.
 * A IA lê o que o OS junta (capturas da Pauta e notas da Memória) e escreve o
 * card. Aprovar manda para o Banco da Máquina; recusar ensina (o peso da fonte
 * desce). Teclas: ← recusa, → aprova. "Desfazer" volta a última decisão.
 */

const campo = 'w-full rounded border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-brand';

export default function TriagemPage() {
  const { token, ready, can } = useAuth();
  const editavel = can('pauta.editar');
  const [painel, setPainel] = useState<TriagemPainel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [montando, setMontando] = useState(false);
  const [recusando, setRecusando] = useState(false);
  const [edicao, setEdicao] = useState<{ titulo: string; gancho: string; formato: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    if (!token) return;
    try {
      setPainel(await apiGet<TriagemPainel>('/marketing/estudio/triagem', token));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [token]);

  useEffect(() => {
    if (ready) void carregar();
  }, [ready, carregar]);

  const card: TriagemCard | undefined = painel?.cards[0];
  useEffect(() => {
    setRecusando(false);
    setEdicao(card ? { titulo: card.titulo, gancho: card.como.gancho, formato: card.como.formato } : null);
  }, [card?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const decidir = useCallback(
    async (decisao: 'aprovada' | 'recusada', motivo?: string) => {
      if (!card || ocupado) return;
      setOcupado(true);
      try {
        const corpo = decisao === 'aprovada' ? { decisao, titulo: edicao?.titulo, gancho: edicao?.gancho, formato: edicao?.formato } : { decisao, motivo };
        await apiPost(`/marketing/estudio/triagem/${card.id}/decisao`, corpo, token);
        setAviso(decisao === 'aprovada' ? 'Aprovada: está no Banco de ideias da Produção.' : 'Recusada. A fonte pesa um pouco menos na próxima.');
        await carregar();
      } catch (e) {
        setErro((e as Error).message);
      } finally {
        setOcupado(false);
      }
    },
    [card, ocupado, edicao, token, carregar],
  );

  useEffect(() => {
    if (!editavel) return;
    const tecla = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight') void decidir('aprovada');
      if (e.key === 'ArrowLeft') setRecusando(true);
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [decidir, editavel]);

  const montar = async () => {
    setMontando(true);
    setAviso('A IA está lendo o que chegou. Pode levar um minuto.');
    try {
      const r = await apiPost<{ lidos: number; cards: number; descartados: number; falharam: number }>('/marketing/estudio/triagem/montar', { quantas: 12 }, token);
      setAviso(
        r.lidos === 0
          ? 'Nada novo para ler. Guarde links na Memória ou cadastre fontes em Fontes e referências.'
          : `${r.lidos} lidos: ${r.cards} cards novos${r.descartados ? `, ${r.descartados} fora do tema` : ''}${r.falharam ? `, ${r.falharam} falharam` : ''}.`,
      );
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
      setAviso(null);
    } finally {
      setMontando(false);
    }
  };

  const desfazer = async () => {
    if (!painel?.ultima) return;
    try {
      await apiPost(`/marketing/estudio/triagem/${painel.ultima.id}/desfazer`, {}, token);
      setAviso('Desfeito. O card voltou para a fila.');
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  if (ready && !can('pauta.ver')) return <p className="text-muted">Acesso insuficiente para Marketing.</p>;
  if (!painel) return erro ? <p className="text-bad">{erro}</p> : <p className="text-muted">Carregando…</p>;

  return (
    <div className="com-tema mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <span>
          <span className="font-os-mono">{painel.contagem.nova}</span> na fila · <span className="font-os-mono">{painel.contagem.aprovada}</span> aprovadas ·{' '}
          <span className="font-os-mono">{painel.contagem.recusada}</span> recusadas · <span className="font-os-mono">{painel.pendentes >= 500 ? '500+' : painel.pendentes}</span> itens ainda não lidos
        </span>
        <span className="flex gap-2">
          {editavel && painel.ultima && (
            <button className={btn} onClick={() => void desfazer()}>
              Desfazer: {painel.ultima.titulo.slice(0, 30)}
              {painel.ultima.titulo.length > 30 ? '…' : ''}
            </button>
          )}
          {editavel && painel.ia && painel.pendentes > 0 && (
            <button className={btn} onClick={() => void montar()} disabled={montando}>
              {montando ? 'Lendo…' : 'Buscar ideias agora'}
            </button>
          )}
        </span>
      </div>
      {aviso && (
        <p role="status" className="rounded border border-brand-dim bg-brand/5 px-3 py-2 text-sm">
          {aviso}
        </p>
      )}
      {erro && (
        <p role="alert" className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {erro}
        </p>
      )}

      {!card ? (
        <div className="rounded border border-border p-8 text-center">
          <p className="text-lg font-semibold">Sem ideias na fila.</p>
          <p className="mt-1 text-sm text-muted">
            {painel.pendentes > 0 ? `Há ${painel.pendentes >= 500 ? 'mais de 500' : painel.pendentes} itens esperando a IA ler.` : 'Guarde links e Reels na Memória, ou cadastre fontes, para a fila encher.'}
          </p>
          {editavel && painel.ia && painel.pendentes > 0 && (
            <button className={`${btnPrimario} mt-4`} onClick={() => void montar()} disabled={montando}>
              {montando ? 'Lendo…' : 'Buscar ideias agora'}
            </button>
          )}
          <p className="mt-4 text-sm">
            <Link href="/marketing/memoria" className="text-brand underline">
              Abrir a Memória
            </Link>{' '}
            ·{' '}
            <Link href="/referencias" className="text-brand underline">
              Fontes e referências
            </Link>
          </p>
        </div>
      ) : (
        <article className="overflow-hidden rounded border border-border bg-surface">
          {card.imagemUrl && /^https?:\/\//.test(card.imagemUrl) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={card.imagemUrl} alt="" className="max-h-64 w-full object-cover" referrerPolicy="no-referrer" />
          )}
          <div className="space-y-4 p-5">
            <p className="text-xs text-muted">
              {card.fonte?.nome}
              {card.fonte && card.fonte.peso !== 1 && <span className="font-os-mono"> · peso {card.fonte.peso.toFixed(2)}</span>}
              {card.publicadoEm && ` · ${new Date(card.publicadoEm).toLocaleDateString('pt-BR')}`}
              {card.url && (
                <>
                  {' · '}
                  <a href={card.url} target="_blank" rel="noopener noreferrer" className="text-brand underline">
                    abrir a fonte ↗
                  </a>
                </>
              )}
            </p>
            {edicao && editavel ? (
              <textarea rows={2} value={edicao.titulo} onChange={(e) => setEdicao({ ...edicao, titulo: e.target.value })} className={`${campo} text-xl font-semibold`} aria-label="Título" />
            ) : (
              <h2 className="text-xl font-semibold leading-snug">{card.titulo}</h2>
            )}
            {card.resumo && <p className="text-[0.95rem]">{card.resumo}</p>}
            {card.porque && (
              <div>
                <h3 className="com-rotulo mb-1">Por que tem a ver</h3>
                <p className="text-sm">{card.porque}</p>
              </div>
            )}
            <div className="space-y-2">
              <h3 className="com-rotulo">Como fazer</h3>
              {edicao && editavel ? (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {FORMATOS_COM_REGUA.map((f) => (
                      <button key={f} onClick={() => setEdicao({ ...edicao, formato: f })} className={`${btn} ${edicao.formato === f ? 'border-brand bg-brand/10 text-brand' : ''}`}>
                        {f}
                        {f === card.formatoSugerido ? ' · sugerido' : ''}
                      </button>
                    ))}
                  </div>
                  <label className="block text-sm">
                    <span className="com-rotulo mb-1 block">Gancho</span>
                    <textarea rows={2} value={edicao.gancho} onChange={(e) => setEdicao({ ...edicao, gancho: e.target.value })} className={campo} />
                  </label>
                </>
              ) : (
                <p className="text-sm">
                  <span className="font-medium">{card.como.formato}</span>
                  {card.como.gancho && ` · ${card.como.gancho}`}
                </p>
              )}
              {card.como.clipe && <p className="text-sm text-muted">Clipe de abertura: {card.como.clipe}</p>}
              {card.como.pontos.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted">
                  {card.como.pontos.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              )}
            </div>

            {editavel && (
              <div className="space-y-2 border-t border-border pt-4">
                {recusando ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted">Motivo:</span>
                    {MOTIVOS_RAPIDOS.map((m) => (
                      <button key={m} className={btn} onClick={() => void decidir('recusada', m)} disabled={ocupado}>
                        {m}
                      </button>
                    ))}
                    <button className={btn} onClick={() => void decidir('recusada')} disabled={ocupado}>
                      Sem motivo
                    </button>
                    <button className={btn} onClick={() => setRecusando(false)}>
                      Voltar
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button className={`${btn} hover:border-bad hover:text-bad`} onClick={() => setRecusando(true)} disabled={ocupado}>
                      ← Recusar
                    </button>
                    <span className="font-os-mono text-xs text-muted">score {card.score.toFixed(1)}</span>
                    <button className={btnPrimario} onClick={() => void decidir('aprovada')} disabled={ocupado}>
                      Aprovar →
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </article>
      )}
    </div>
  );
}
