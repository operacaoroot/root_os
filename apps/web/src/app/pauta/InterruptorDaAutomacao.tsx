'use client';

import { useState } from 'react';
import { PAUTA_AUTOMACAO_ROTULO, faltaNaRotinaDePublicacao, type PautaAutomacao, type PautaRotinaDaPauta } from '@mktos/shared';
import { apiPut } from '@/lib/api';
import { Botao, Chip } from '../referencias/ui';

/*
 * D-MD1: os dois interruptores da empresa (a publicação automática e a DM
 * automática) são notas da memória. Aqui eles se ligam e desligam pela aba
 * Semana, com confirmação e motivo, e a API grava a versão nova da nota pelo
 * MemoriaService, com o RASTRO. A DM só liga depois do App Review (a API
 * recusa); desligar vale sempre, é o freio de emergência.
 *
 * Com a publicação ligada e sem a rotina que a cumpre (ausente, parada ou
 * calada neste servidor), o chip diz isso em vez de "ligada": a promessa do
 * "sai no horário" precisa de quem a cumpra.
 */

const MOTIVO_MINIMO = 10;

export function InterruptorDaAutomacao({
  qual,
  ligada,
  token,
  podeMudar,
  podeLigar = true,
  rotina,
  onMudou,
  onErro,
}: {
  qual: PautaAutomacao;
  ligada: boolean | undefined;
  token: string | null;
  /** `pauta.publicar`. */
  podeMudar: boolean;
  /** Na DM, falso até `INSTAGRAM_PEDIR_MENSAGENS=sim` no servidor. */
  podeLigar?: boolean;
  /** Só na publicação: a rotina que publica no horário. */
  rotina?: PautaRotinaDaPauta;
  onMudou: () => void;
  onErro: (m: string) => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);
  if (ligada === undefined) return null;

  const rotulo = PAUTA_AUTOMACAO_ROTULO[qual];
  const semRotina = ligada && qual === 'publicacao' ? faltaNaRotinaDePublicacao(rotina) : null;
  const vaiLigar = !ligada;
  const bloqueadaAteOAppReview = vaiLigar && !podeLigar;

  const salvar = async () => {
    setSalvando(true);
    try {
      await apiPut(`/pauta/automacao/${qual}`, { ligada: vaiLigar, motivo: motivo.trim() }, token);
      setConfirmando(false);
      setMotivo('');
      onMudou();
    } catch (e) {
      onErro((e as Error).message);
    }
    setSalvando(false);
  };

  return (
    <div className="space-y-1" aria-label={`Interruptor da ${rotulo}`}>
      <div className="flex flex-wrap items-center gap-2">
        {semRotina ? (
          <Chip tone="bad">{rotulo} ligada, mas {semRotina}</Chip>
        ) : ligada ? (
          <Chip tone="good">{rotulo} ligada</Chip>
        ) : (
          <Chip tone="warn">{rotulo} desligada</Chip>
        )}
        {semRotina && (
          <a className="text-xs text-brand underline" href="/rotinas">
            abrir /rotinas
          </a>
        )}
        {podeMudar && !confirmando && !bloqueadaAteOAppReview && (
          <Botao tone={ligada ? 'ghost' : 'default'} onClick={() => setConfirmando(true)}>
            {ligada ? 'Desligar' : 'Ligar'}
          </Botao>
        )}
      </div>
      {podeMudar && bloqueadaAteOAppReview && (
        <p className="break-words text-xs text-muted">
          Só liga depois do App Review da Meta, com INSTAGRAM_PEDIR_MENSAGENS=sim no servidor e a conta de publicação reconectada.
        </p>
      )}
      {confirmando && (
        <div className="space-y-2 rounded-lg border border-warn/40 bg-warn/10 p-2 text-xs">
          <p className="break-words">
            {vaiLigar
              ? qual === 'publicacao'
                ? 'Ligada, cada semana assinada pela titular sai sozinha no horário, sem ninguém olhando na hora.'
                : 'Ligada, quem comentar a palavra recebe a DM da regra assinada sozinho, até o teto por dia.'
              : qual === 'publicacao'
                ? 'Desligada, nada mais sai sozinho no horário: a semana assinada volta ao "Publicar agora" e ao manual.'
                : 'Desligada, nenhuma DM sai sozinha: a resposta volta à fila de comentários, à mão.'}
          </p>
          <label className="block space-y-1">
            <span className="text-muted">Motivo (fica no histórico da nota e no RASTRO)</span>
            <input
              className="w-full min-w-0 rounded border border-border bg-surface px-2 py-1 text-sm"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={300}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Botao tone={vaiLigar ? 'brand' : 'bad'} onClick={() => void salvar()} disabled={salvando || motivo.trim().length < MOTIVO_MINIMO}>
              {salvando ? 'Gravando…' : `Confirmar: ${vaiLigar ? 'ligar' : 'desligar'} a ${rotulo}`}
            </Botao>
            <Botao tone="ghost" onClick={() => setConfirmando(false)} disabled={salvando}>
              Manter
            </Botao>
          </div>
        </div>
      )}
    </div>
  );
}
