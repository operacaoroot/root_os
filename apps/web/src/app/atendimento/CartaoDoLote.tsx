'use client';

import { useEffect, useState } from 'react';
import {
  PAUTA_CAPACIDADE_DE_ENVIAR_AO_YOUTUBE,
  diaNoFuso,
  horaNoFuso,
  type PautaConteudoDoLote,
  type PautaItemDaDmNoLote,
  type PautaItemDoConteudoDoLote,
  type PautaItemDoYoutubeNoLote,
} from '@mktos/shared';
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
 *
 * MD10: o vídeo do YouTube aparece como os posts — o título, a descrição
 * inteira, a imagem da thumb, o arquivo (sha256 e tamanho) e o horário que o
 * OS vai marcar —, com a mesma marca de divergência.
 *
 * MD11: a regra da DM automática de cada matéria também — a palavra, o texto
 * EXATO que estranhos vão receber (com a linha de mensagem automática), para
 * onde o link leva, os posts onde ela vale, o teto por dia e a janela.
 */

const quando = (iso: string) => {
  const d = new Date(iso);
  return `${diaNoFuso(d).slice(8, 10)}/${diaNoFuso(d).slice(5, 7)} ${horaNoFuso(d)}`;
};

/** A imagem de um item, pela rota autenticada, como URL de blob enquanto o cartão vive. */
function useImagem(caminho: string | null, token: string | null): { url: string | null; falhou: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);
  useEffect(() => {
    if (!caminho) {
      setFalhou(true);
      return;
    }
    let vivo = true;
    let criada: string | null = null;
    apiBlob(caminho, token)
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
  }, [caminho, token]);
  return { url, falhou };
}

function Miniatura({ pecaId, token }: { pecaId: string; token: string | null }) {
  const { url, falhou } = useImagem(`/pauta/pecas/${pecaId}/imagens/1?tipo=jpeg`, token);
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

/** A thumb assinada, em 16:9: ela entra no hash e fica pública no horário, então a titular a vê, e não só o número. */
function ThumbDoVideo({ episodioId, n, token }: { episodioId: string; n: number | null; token: string | null }) {
  const { url, falhou } = useImagem(n ? `/pauta/episodios/${episodioId}/thumbs/${n}/imagem` : null, token);
  if (url) return <img src={url} alt={`Thumb ${n} do vídeo`} className="h-[72px] w-32 shrink-0 rounded object-cover" />;
  return (
    <div className="flex h-[72px] w-32 shrink-0 items-center justify-center rounded bg-surface-2 text-center text-[9px] text-muted">
      {falhou ? 'sem thumb' : '…'}
    </div>
  );
}

function ItemDoYoutube({ item, token }: { item: PautaItemDoYoutubeNoLote; token: string | null }) {
  const envio = item.capabilityId === PAUTA_CAPACIDADE_DE_ENVIAR_AO_YOUTUBE;
  return (
    <li
      className={`space-y-2 rounded-lg border p-2 ${item.divergente ? 'border-bad/50 bg-bad/5' : 'border-border'}`}
      data-testid={`item-do-youtube-${item.itemId}`}
    >
      <div className="flex flex-wrap gap-2">
        <ThumbDoVideo episodioId={item.episodioId} n={item.thumbN} token={token} />
        <div className="min-w-0 flex-1 space-y-0.5 text-xs">
          <p className="font-medium">
            YouTube · {envio ? 'envio privado (o Mac sobe o vídeo)' : `agendado para ${item.publicarEm ? quando(item.publicarEm) : '?'}`}
          </p>
          {!envio && <p className="text-muted">o agendamento sai sozinho só com a publicação automática ligada</p>}
          <p className="break-words text-muted">
            vídeo de {Math.round(item.arquivo.bytes / 1024 / 1024)} MB (sha256 {item.arquivo.sha256Curto}) · thumb {item.thumbN ?? '?'} · categoria{' '}
            {item.categoria} · até {quando(item.janelaAte)} · hash {item.hashCurto}
          </p>
          <p className="break-words font-medium">{item.titulo}</p>
          {item.estadoDoItem !== 'ativo' && <p className="text-muted">item {item.estadoDoItem}</p>}
        </div>
      </div>
      <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded bg-surface-2 px-2 py-1 text-[12px] text-text">
        {item.descricao || '(sem descrição)'}
      </pre>
      <p className="text-[11px] text-muted">{item.bytesDaDescricao} de 5000 bytes</p>
      {item.divergente && (
        <p className="break-words text-xs text-bad" data-testid={`divergente-${item.itemId}`}>
          {item.divergente}
        </p>
      )}
    </li>
  );
}

function ItemDaDm({ item }: { item: PautaItemDaDmNoLote }) {
  return (
    <li
      className={`space-y-2 rounded-lg border p-2 ${item.divergente ? 'border-bad/50 bg-bad/5' : 'border-border'}`}
      data-testid={`item-da-dm-${item.itemId}`}
    >
      <div className="min-w-0 space-y-0.5 text-xs">
        <p className="font-medium">
          DM automática · quem comentar {item.palavra} · {item.apelido} m{item.itemN}
        </p>
        <p className="break-words text-muted">
          de {item.handle ? `@${item.handle}` : '(sem conta de publicação)'} · até {item.tetoPorDia ?? '?'} por dia · de {quando(item.janelaDe)} a{' '}
          {quando(item.janelaAte)} · hash {item.hashCurto}
        </p>
        <p className="break-words">
          {item.materia} · vale nos posts: {item.pecas.map((p) => p.formato).join(' e ') || '(nenhum)'}
        </p>
        <p className="break-all text-muted">o link leva a {item.destino || '(sem destino)'}</p>
        {item.estadoDoItem !== 'ativo' && <p className="text-muted">item {item.estadoDoItem}</p>}
      </div>
      <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded bg-surface-2 px-2 py-1 text-[12px] text-text">
        {item.texto || '(sem texto)'}
      </pre>
      <p className="text-[11px] text-muted">
        {item.bytes} de 1000 bytes · sai sozinha só com a nota pauta.dm.automatica ligada, uma por pessoa, das {item.horario} ({item.fuso})
      </p>
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
        {(conteudo.youtube ?? []).map((i) => (
          <ItemDoYoutube key={i.itemId} item={i} token={token} />
        ))}
        {(conteudo.dm ?? []).map((i) => (
          <ItemDaDm key={i.itemId} item={i} />
        ))}
      </ul>
    </section>
  );
}
