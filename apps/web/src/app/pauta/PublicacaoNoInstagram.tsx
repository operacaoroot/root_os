'use client';

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { PAUTA_PUBLICACAO_ESTADO_ROTULO, type PautaPecaNaAgenda, type PautaPublicacaoEstado } from '@mktos/shared';
import { apiPost } from '@/lib/api';
import { Botao, Chip } from '../referencias/ui';

/*
 * MD6: a publicação da peça no Instagram pelo OS, dentro do slot da Semana.
 *
 * "Publicar agora" pede à porta, e a porta retém: é R3, e quem confirma é
 * OUTRA pessoa com alçada em /atendimento. Nada vai à Meta no clique. Depois
 * disso o slot mostra onde a publicação está (pendente, processando, publicada
 * com o link, erro com o motivo) e o "Voltar ao manual", que tira a peça das
 * mãos do OS — o "Marcar como postada" de sempre continua valendo.
 */

const TOM: Record<PautaPublicacaoEstado, 'brand' | 'good' | 'warn' | 'bad' | 'muted'> = {
  pendente: 'warn',
  container_criado: 'warn',
  processando: 'warn',
  publicada: 'brand',
  erro: 'bad',
  recusada: 'muted',
};

const PODE_PEDIR: readonly PautaPublicacaoEstado[] = ['erro', 'recusada'];
// `pendente` com motivo é pedido que morreu (venceu, foi recusado, o container
// venceu): a API já o manda como `erro`, e a tela não depende disso para pedir de novo.
const podePedirDe = (pub: { estado: PautaPublicacaoEstado; erro: string | null }) =>
  PODE_PEDIR.includes(pub.estado) || (pub.estado === 'pendente' && !!pub.erro);
const PODE_VOLTAR: readonly PautaPublicacaoEstado[] = ['pendente', 'container_criado', 'processando', 'erro'];

interface Retida {
  status: 'aguardando_aprovacao';
  mensagem?: string;
  fila?: string;
}

const foiRetida = (r: unknown): r is Retida => !!r && typeof r === 'object' && (r as { status?: unknown }).status === 'aguardando_aprovacao';

export function PublicacaoNoInstagram({
  peca,
  token,
  podePublicar,
  ocupado,
  onAcao,
}: {
  peca: PautaPecaNaAgenda;
  token: string | null;
  /** `pauta.publicar`: pedir e voltar ao manual. */
  podePublicar: boolean;
  ocupado: boolean;
  onAcao: (fn: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [aviso, setAviso] = useState<Retida | null>(null);
  const pub = peca.publicacao ?? null;
  const aprovada = peca.status === 'aprovada';
  const podePedir = podePublicar && aprovada && !peca.postada && (!pub || podePedirDe(pub));

  const pedir = () =>
    onAcao(async () => {
      const r = await apiPost<unknown>(`/pauta/pecas/${peca.id}/publicar-instagram`, {}, token);
      setAviso(foiRetida(r) ? r : null);
    });

  const voltar = () =>
    onAcao(async () => {
      await apiPost(`/pauta/pecas/${peca.id}/publicacao/manual`, {}, token);
      setAviso(null);
    });

  if (!pub && !podePedir) return null;

  return (
    <div className="space-y-1 rounded-lg border border-border p-2 text-xs" aria-label="Publicação no Instagram">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted">Instagram pelo OS:</span>
        {pub ? <Chip tone={TOM[pub.estado]}>{PAUTA_PUBLICACAO_ESTADO_ROTULO[pub.estado]}</Chip> : <Chip>não pedida</Chip>}
      </div>

      {pub?.estado === 'pendente' && !pub.erro && !aviso && (
        <p className="break-words text-muted">
          Esperando a confirmação de outra pessoa com alçada em{' '}
          <a className="text-brand underline" href="/atendimento">
            /atendimento
          </a>
          . Nada foi enviado ainda.
        </p>
      )}
      {(pub?.estado === 'processando' || pub?.estado === 'container_criado') && (
        <p className="break-words text-muted">A Meta está recebendo a mídia. A rotina de publicação confere a cada minuto e publica quando terminar.</p>
      )}
      {pub?.estado === 'publicada' && pub.permalink && (
        <a href={pub.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand hover:underline">
          ver no Instagram <ExternalLink size={11} />
        </a>
      )}
      {pub?.erro && pub.estado !== 'publicada' && <p className="break-words text-bad">{pub.erro}</p>}
      {pub?.estado === 'publicada' && pub.erro && <p className="break-words text-warn">{pub.erro}</p>}

      {aviso && (
        <p role="status" className="break-words text-warn">
          Pedido na fila: outra pessoa com alçada confirma em{' '}
          <a className="underline" href={aviso.fila ?? '/atendimento'}>
            {aviso.fila ?? '/atendimento'}
          </a>
          . Quem pediu não confirma.
        </p>
      )}

      {(podePedir || (podePublicar && pub && PODE_VOLTAR.includes(pub.estado))) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {podePedir && (
            <Botao tone="brand" onClick={pedir} disabled={ocupado}>
              Publicar agora
            </Botao>
          )}
          {podePublicar && pub && PODE_VOLTAR.includes(pub.estado) && (
            <Botao tone="ghost" onClick={voltar} disabled={ocupado}>
              Voltar ao manual
            </Botao>
          )}
        </div>
      )}
    </div>
  );
}
