'use client';

import { useEffect, useState } from 'react';
import { diaNoFuso, horaNoFuso, type PautaConteudoDoLote, type PautaItemDoConteudoDoLote } from '@mktos/shared';
import { apiBlob, apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * O LOTE DA SEMANA, COMO A TITULAR O ASSINA (MD8).
 *
 * A aprovação de `pauta.semana.aprovar` guarda só o hash da lista: sozinha, ela
 * mostraria "lote X, 11 itens, hash abc". Assinar isso seria assinar sem ler.
 * Este cartão busca o conteúdo de cada item na peça de AGORA (legenda inteira,
 * miniatura, horário em São Paulo, @ de destino), com o hash recalculado pela
 * API — e marca o item cuja peça mudou depois de o lote ser montado (ele não
 * sai). O botão de aprovar só aparece depois que o conteúdo carregou.
 */

const quando = (iso: string) => {
  const d = new Date(iso);
  return `${diaNoFuso(d).slice(8, 10)}/${diaNoFuso(d).slice(5, 7)} ${horaNoFuso(d)}`;
};

function Miniatura({ pecaId, token }: { pecaId: string; token: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);
  useEffect(() => {
    let vivo = true;
    let criada: string | null = null;
    apiBlob(`/pauta/pecas/${pecaId}/imagens/1?tipo=jpeg`, token)
      .then((b) => {
        if (!vivo || typeof URL.createObjectURL !== 'function') return;
        criada = URL.createObjectURL(b);
        setUrl(criada);
      })
      .catch(() => vivo && setFalhou(true));
    return () => {
      vivo = false;
      if (criada) URL.revokeObjectURL(criada);
    };
  }, [pecaId, token]);
  if (url) return <img src={url} alt="Miniatura do primeiro slide" className="h-20 w-16 shrink-0 rounded object-cover" />;
  return (
    <div className="flex h-20 w-16 shrink-0 items-center justify-center rounded bg-surface-2 text-center text-[9px] text-muted">
      {falhou ? 'sem miniatura' : '…'}
    </div>
  );
}

function ItemDoLote({ item, token }: { item: PautaItemDoConteudoDoLote; token: string | null }) {
  return (
    <li
      className={`space-y-2 rounded-lg border p-2 ${item.divergente ? 'border-bad/50 bg-bad/5' : 'border-border'}`}
      data-testid={`item-do-lote-${item.itemId}`}
    >
      <div className="flex gap-2">
        {item.midia.tipo === 'imagens' ? (
          <Miniatura pecaId={item.pecaId} token={token} />
        ) : (
          <div className="flex h-20 w-16 shrink-0 items-center justify-center rounded bg-surface-2 text-center text-[9px] text-muted">
            {item.midia.tipo === 'video' ? `mp4${item.midia.duracaoSeg ? ` ${Math.round(item.midia.duracaoSeg)} s` : ''}` : 'sem mídia'}
          </div>
        )}
        <div className="min-w-0 space-y-0.5 text-xs">
          <p className="font-medium">
            {quando(item.agendadaPara)} · {item.formato} · {item.apelido} m{item.itemN}
          </p>
          <p className="break-words text-muted">
            para {item.handle ? `@${item.handle}` : '(sem conta de publicação)'}
            {item.midia.tipo === 'imagens' ? ` · ${item.midia.n.length} imagem(ns)` : ''} · hash {item.hashCurto}
          </p>
          <p className="break-words">{item.titulo}</p>
          {item.estadoDoItem !== 'ativo' && <p className="text-muted">item {item.estadoDoItem}</p>}
        </div>
      </div>
      <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded bg-surface-2 px-2 py-1 text-[12px] text-text">
        {item.legenda || '(sem texto)'}
      </pre>
      {item.divergente && (
        <p className="break-words text-xs text-bad" data-testid={`divergente-${item.itemId}`}>
          {item.divergente}
        </p>
      )}
    </li>
  );
}

export function CartaoDoLote({
  loteId,
  onPronto,
}: {
  loteId: string;
  /** Chamado quando o conteúdo carregou (ou falhou): o botão de aprovar espera por ele. */
  onPronto: (ok: boolean) => void;
}) {
  const { token } = useAuth();
  const [conteudo, setConteudo] = useState<PautaConteudoDoLote | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    apiGet<PautaConteudoDoLote>(`/pauta/lotes/${loteId}/conteudo`, token)
      .then((c) => {
        if (!vivo) return;
        setConteudo(c);
        onPronto(true);
      })
      .catch((e) => {
        if (!vivo) return;
        setErro((e as Error).message);
        onPronto(false);
      });
    return () => {
      vivo = false;
    };
  }, [loteId, token, onPronto]);

  if (erro) {
    return (
      <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad" data-testid="lote-sem-conteudo">
        O conteúdo do lote não carregou ({erro}). Sem ver o que cada post leva, não assine.
      </p>
    );
  }
  if (!conteudo) return <p className="text-xs text-muted">Carregando os posts do lote…</p>;

  return (
    <section className="space-y-2" data-testid="cartao-do-lote" aria-label="Posts do lote">
      <p className="text-xs text-muted">
        {conteudo.total} post(s) · hash da lista {conteudo.hashCurto} · vale até {quando(conteudo.validaAte)} · destino{' '}
        {conteudo.handle ? `@${conteudo.handle}` : '(sem conta)'}
      </p>
      {conteudo.divergentes > 0 && (
        <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">
          {conteudo.divergentes} post(s) mudaram depois de o lote ser montado e NÃO saem com esta assinatura. O resto sai no horário.
        </p>
      )}
      <ul className="space-y-2">
        {conteudo.itens.map((i) => (
          <ItemDoLote key={i.itemId} item={i} token={token} />
        ))}
      </ul>
    </section>
  );
}
