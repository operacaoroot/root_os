'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LinhaDoHistorico, ResultadoDaEscrita } from '@mktos/shared';

import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Botao, Chip } from '../../referencias/ui';
import { FUSO_DA_AGENDA } from '../semana';

/*
 * O HISTÓRICO DO QUE O OS GRAVOU NO GOOGLE (agenda v2, 29/10/2026, lane G4),
 * com "desfazer" onde existe. Lido de `GET /agenda/historico` (o registro da
 * porta). Mora na aba Conflitos (desenho) e pode aparecer no detalhe do
 * compromisso. O desfazer é um pedido como outro qualquer: vai a
 * `POST /agenda/escritas` e passa pela mesma régua e pela mesma porta (reabrir é
 * R3 e vai para a fila; o resto sai no clique só com a aprovação de R2 da casa
 * desligada).
 */
export interface PropsDoHistorico {
  /** Só as linhas de um evento (no detalhe). */
  eventoId?: string;
  limite?: number;
  aoMudar?: () => void;
}

const hora = (iso: string): string => {
  const d = new Date(iso);
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: FUSO_DA_AGENDA });
  const dia = d.toLocaleDateString('pt-BR', { timeZone: FUSO_DA_AGENDA });
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: FUSO_DA_AGENDA });
  return dia === hoje ? hm : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: FUSO_DA_AGENDA })} ${hm}`;
};

const SITUACAO: Record<LinhaDoHistorico['status'], { rotulo: string; tom: 'good' | 'warn' | 'bad' | 'muted' } | null> = {
  executado: null,
  aguardando_aprovacao: { rotulo: 'na fila', tom: 'warn' },
  recusado: { rotulo: 'recusado', tom: 'bad' },
  erro: { rotulo: 'erro', tom: 'bad' },
};

/** "14:02 Rodrigo marcou Papeleira Santa Rita". */
export function fraseDaLinha(l: LinhaDoHistorico): string {
  const quem = l.quem ?? 'Alguém';
  return `${quem} ${l.verbo}${l.titulo ? ` ${l.titulo}` : ''}`;
}

function Linha({ linha, token, aoMudar }: { linha: LinhaDoHistorico; token: string | null; aoMudar: () => void }) {
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; tom: 'good' | 'warn' | 'bad' } | null>(null);
  const situacao = SITUACAO[linha.status];

  const desfazer = async () => {
    if (!linha.desfazer) return;
    setEnviando(true);
    setAviso(null);
    try {
      const r = await apiPost<ResultadoDaEscrita>('/agenda/escritas', linha.desfazer, token);
      setAviso({
        texto: r.status === 'aguardando_aprovacao' ? `${r.mensagem} Confira em /atendimento.` : r.mensagem,
        tom: r.status === 'executado' ? 'good' : r.status === 'aguardando_aprovacao' ? 'warn' : 'bad',
      });
      if (r.status !== 'recusado') aoMudar();
    } catch (e) {
      setAviso({ texto: (e as Error).message, tom: 'bad' });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <li className="flex flex-col gap-1 border-b border-border py-2 last:border-b-0" data-historico-linha={linha.id}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-os-mono text-[11px] text-muted">{hora(linha.quando)}</span>
        <span className="min-w-0 flex-1 break-words">{fraseDaLinha(linha)}</span>
        {situacao && <Chip tone={situacao.tom}>{situacao.rotulo}</Chip>}
        {linha.forcado && <Chip tone="warn">marcado assim mesmo</Chip>}
        {linha.desfazer && (
          <Botao tone="ghost" onClick={desfazer} disabled={enviando} title="Manda o pedido que volta esta escrita, pela mesma régua e pela mesma porta">
            {enviando ? 'desfazendo…' : 'desfazer'}
          </Botao>
        )}
      </div>
      {linha.forcado && <p className="text-[12px] text-muted">Motivo: {linha.forcado.motivo}</p>}
      {aviso && (
        <p role="status" className={`text-[12px] ${aviso.tom === 'good' ? 'text-good' : aviso.tom === 'warn' ? 'text-warn' : 'text-bad'}`}>
          {aviso.texto}
        </p>
      )}
    </li>
  );
}

export function Historico({ eventoId, limite = 30, aoMudar }: PropsDoHistorico) {
  const { token, ready } = useAuth();
  const [linhas, setLinhas] = useState<LinhaDoHistorico[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    if (!ready || !token) return;
    const q = new URLSearchParams({ limite: String(limite) });
    if (eventoId) q.set('eventoId', eventoId);
    apiGet<LinhaDoHistorico[]>(`/agenda/historico?${q.toString()}`, token)
      .then((l) => { setLinhas(l); setErro(null); })
      .catch((e: Error) => setErro(e.message));
  }, [ready, token, eventoId, limite]);

  useEffect(() => { carregar(); }, [carregar]);

  const mudou = useCallback(() => {
    carregar();
    aoMudar?.();
  }, [carregar, aoMudar]);

  if (erro) return <p className="text-sm text-bad">Histórico indisponível: {erro}</p>;
  if (!linhas) return <p className="text-sm text-muted">Carregando o histórico…</p>;
  if (!linhas.length) {
    return <p className="text-sm text-muted">{eventoId ? 'O OS ainda não gravou nada neste compromisso.' : 'O OS ainda não gravou nada na agenda.'}</p>;
  }
  return (
    <ul className="flex flex-col" aria-label="O que o OS gravou no Google">
      {linhas.map((l) => <Linha key={l.id} linha={l} token={token} aoMudar={mudou} />)}
    </ul>
  );
}
