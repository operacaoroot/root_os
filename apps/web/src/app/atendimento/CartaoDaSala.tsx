'use client';

import { useEffect, useState } from 'react';
import { ehConteudoDeItem, type ConteudoDaSalaPublicada, type ConteudoGuardadoDoItemDaArea } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { diaHoraSP } from '@/lib/cockpit';

/*
 * A SALA, COMO QUEM LIBERA O R3 A LÊ (rodada da implantação I3, 18/10/2026).
 *
 * A aprovação de `comercial.sala.publicar` guarda o lead, a versão e o hash.
 * Este cartão busca a versão inteira (o que o cliente vai ler no link) com o
 * hash RECALCULADO agora e, quando há, a versão que está no ar, para quem
 * libera ver o que muda. Como a proposta (E-7): o botão de aprovar só aparece
 * com o conteúdo carregado e conferido.
 */

export const CAPACIDADE_DA_SALA = 'comercial.sala.publicar';

/** A versão pode ser da sala inteira (`item` nulo) ou de um item da área do cliente (leva A, 30/10/2026). */
type ConteudoDaVersao = ConteudoDaSalaPublicada | ConteudoGuardadoDoItemDaArea;

interface ConteudoDaSala {
  leadId: string;
  versao: number;
  item?: string | null;
  titulo?: string | null;
  estado: string;
  conteudo: ConteudoDaVersao;
  anterior: { versao: number; conteudo: ConteudoDaVersao } | null;
  hashGravado: string;
  hashDeAgora: string;
  hashAssinado: string | null;
  confere: boolean;
}

/** `leadId:vN`, o recurso que a sala grava na porta. */
export function recursoDaSala(id: string): { leadId: string; versao: number } | null {
  const m = /^(.+):v(\d+)$/.exec(id);
  return m ? { leadId: m[1], versao: Number(m[2]) } : null;
}

const diaCurto = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : d);

/**
 * A conferência da versão (o conteúdo inteiro, com o hash de agora). Usada pelo
 * cartão e, na rodada do trabalho T7, pela LINHA da fila: "publicar a sala
 * versão N" cabe na linha, mas o botão de um clique só acende com a versão
 * carregada e conferida, como no cartão. `ativo: false` não busca nada.
 */
export function useConferenciaDaSala(
  recursoId: string,
  hashAssinado: string | null,
  onPronto?: (ok: boolean) => void,
  ativo = true,
): { c: ConteudoDaSala | null; erro: string | null } {
  const { token } = useAuth();
  const [c, setC] = useState<ConteudoDaSala | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!ativo) return;
    const recurso = recursoDaSala(recursoId);
    if (!recurso) {
      setErro('o recurso da aprovação não diz qual versão é');
      onPronto?.(false);
      return;
    }
    let vivo = true;
    const q = hashAssinado ? `?hash=${encodeURIComponent(hashAssinado)}` : '';
    apiGet<ConteudoDaSala>(`/comercial/lead/${encodeURIComponent(recurso.leadId)}/sala/v/${recurso.versao}/conteudo${q}`, token)
      .then((r) => {
        if (!vivo) return;
        setC(r);
        onPronto?.(r.confere);
      })
      .catch((e) => {
        if (!vivo) return;
        setErro((e as Error).message);
        onPronto?.(false);
      });
    return () => {
      vivo = false;
    };
  }, [recursoId, hashAssinado, token, onPronto, ativo]);

  return { c, erro };
}

export function CartaoDaSala({ recursoId, hashAssinado, onPronto }: { recursoId: string; hashAssinado: string | null; onPronto: (ok: boolean) => void }) {
  const { c, erro } = useConferenciaDaSala(recursoId, hashAssinado, onPronto);

  if (erro) {
    return (
      <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad" data-testid="sala-sem-conteudo">
        A versão da sala não carregou ({erro}). Sem ver o que o cliente vai ler, não libere.
      </p>
    );
  }
  if (!c) return <p className="text-xs text-muted">Carregando a versão da sala…</p>;

  // Leva A: a versão de UM item da área do cliente lê diferente da sala inteira.
  if (ehConteudoDeItem(c.conteudo)) return <CartaoDoItemDaArea c={c} conteudo={c.conteudo} />;

  const s = c.conteudo as ConteudoDaSalaPublicada;
  return (
    <section className="space-y-2 rounded-lg border border-border p-3 text-xs" data-testid="cartao-da-sala" aria-label="Versão da sala que vai ao cliente">
      {!c.confere && (
        <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-bad" data-testid="sala-divergente">
          A sala mudou depois do pedido: o hash de agora não é o que esta aprovação prende. Ela não sai com esta assinatura.
        </p>
      )}
      <p className="text-sm font-medium">
        {s.nome} · versão {c.versao}
        {c.anterior ? <span className="text-muted"> (no ar hoje: versão {c.anterior.versao})</span> : <span className="text-muted"> (a primeira)</span>}
      </p>
      <dl className="grid grid-cols-[130px_minmax(0,1fr)] gap-x-2 gap-y-1">
        <dt className="text-muted">onde estamos</dt>
        <dd>{s.estacoes.map((e) => `${e.rotulo}${e.estado === 'feita' ? ` (feita${e.em ? ` ${diaHoraSP(e.em)}` : ''})` : e.estado === 'atual' ? ' (agora)' : ''}`).join(' → ')}</dd>
        <dt className="text-muted">próximos passos</dt>
        <dd>
          {s.proximosPassos.length ? (
            <ul className="space-y-0.5">{s.proximosPassos.map((p, i) => <li key={i}>{p.oque} · {diaCurto(p.quando)} · com {p.comQuem}</li>)}</ul>
          ) : 'nenhum'}
        </dd>
        <dt className="text-muted">publicado</dt>
        <dd>{s.publicados.map((p) => `${p.titulo}: ${p.estado}`).join(' · ')}</dd>
        <dt className="text-muted">o combinado</dt>
        <dd>{s.combinado.join(' · ') || 'nada escrito'}</dd>
        <dt className="text-muted">quem cuida</dt>
        <dd>{s.quemCuida ? `${s.quemCuida.nome}${s.quemCuida.papel ? `, ${s.quemCuida.papel}` : ''}` : 'ninguém escrito'}</dd>
        <dt className="text-muted">WhatsApp</dt>
        <dd>{s.whatsapp.numero ?? s.whatsapp.rotulo}</dd>
      </dl>
      <p className="font-mono text-[10px] text-muted">
        hash de agora {c.hashDeAgora.slice(0, 12)}… · {c.confere ? 'confere com o da aprovação' : 'NÃO confere com o da aprovação'}
      </p>
    </section>
  );
}

/**
 * A versão de um item da área do cliente (leva A, 30/10/2026), como quem libera
 * a lê: o item, o escrito inteiro (resumo, texto, tópicos, data, documento, o
 * que mudou) e a edição que está no ar hoje, para ver o que muda.
 */
function CartaoDoItemDaArea({ c, conteudo: i }: { c: ConteudoDaSala; conteudo: ConteudoGuardadoDoItemDaArea }) {
  const anterior = c.anterior && ehConteudoDeItem(c.anterior.conteudo) ? c.anterior.conteudo : null;
  return (
    <section className="space-y-2 rounded-lg border border-border p-3 text-xs" data-testid="cartao-do-item-da-area" aria-label="Item da área do cliente que vai ao cliente">
      {!c.confere && (
        <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-bad" data-testid="sala-divergente">
          O item mudou depois do pedido: o hash de agora não é o que esta aprovação prende. Ele não sai com esta assinatura.
        </p>
      )}
      <p className="text-sm font-medium">
        Área do cliente · {c.titulo ?? i.item} · versão {c.versao}
        {c.anterior ? <span className="text-muted"> (no ar hoje: versão {c.anterior.versao})</span> : <span className="text-muted"> (a primeira edição deste item)</span>}
      </p>
      <dl className="grid grid-cols-[130px_minmax(0,1fr)] gap-x-2 gap-y-1">
        <dt className="text-muted">resumo</dt>
        <dd>{i.resumo ?? 'sem resumo'}</dd>
        <dt className="text-muted">texto</dt>
        <dd className="whitespace-pre-line">{i.texto?.trim() ? i.texto : 'sem texto'}</dd>
        <dt className="text-muted">tópicos</dt>
        <dd>{i.topicos?.length ? <ul className="list-disc space-y-0.5 pl-4">{i.topicos.map((t, k) => <li key={k}>{t}</li>)}</ul> : 'nenhum'}</dd>
        <dt className="text-muted">data</dt>
        <dd>{i.quando ? diaCurto(i.quando) : 'sem data'}</dd>
        <dt className="text-muted">documento</dt>
        <dd>{i.documentoId ? `arquivo do cliente ${i.documentoId.slice(0, 8)}…` : 'nenhum'}</dd>
        <dt className="text-muted">o que mudou</dt>
        <dd>{i.oQueMudou ?? (anterior ? 'não escrito' : 'primeira edição')}</dd>
        {anterior && (
          <>
            <dt className="text-muted">no ar hoje</dt>
            <dd className="text-muted">{anterior.resumo ?? anterior.texto?.slice(0, 160) ?? (anterior.topicos ?? []).join(' · ')}</dd>
          </>
        )}
      </dl>
      <p className="font-mono text-[10px] text-muted">
        hash de agora {c.hashDeAgora.slice(0, 12)}… · {c.confere ? 'confere com o da aprovação' : 'NÃO confere com o da aprovação'}
      </p>
    </section>
  );
}
