'use client';

import { useEffect, useState } from 'react';
import type { ConteudoDaSalaPublicada } from '@mktos/shared';
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

interface ConteudoDaSala {
  leadId: string;
  versao: number;
  estado: string;
  conteudo: ConteudoDaSalaPublicada;
  anterior: { versao: number; conteudo: ConteudoDaSalaPublicada } | null;
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

export function CartaoDaSala({ recursoId, hashAssinado, onPronto }: { recursoId: string; hashAssinado: string | null; onPronto: (ok: boolean) => void }) {
  const { token } = useAuth();
  const [c, setC] = useState<ConteudoDaSala | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const recurso = recursoDaSala(recursoId);

  useEffect(() => {
    if (!recurso) {
      setErro('o recurso da aprovação não diz qual versão é');
      onPronto(false);
      return;
    }
    let vivo = true;
    const q = hashAssinado ? `?hash=${encodeURIComponent(hashAssinado)}` : '';
    apiGet<ConteudoDaSala>(`/comercial/lead/${encodeURIComponent(recurso.leadId)}/sala/v/${recurso.versao}/conteudo${q}`, token)
      .then((r) => {
        if (!vivo) return;
        setC(r);
        onPronto(r.confere);
      })
      .catch((e) => {
        if (!vivo) return;
        setErro((e as Error).message);
        onPronto(false);
      });
    return () => {
      vivo = false;
    };
  }, [recursoId, hashAssinado, token, onPronto]);

  if (erro) {
    return (
      <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad" data-testid="sala-sem-conteudo">
        A versão da sala não carregou ({erro}). Sem ver o que o cliente vai ler, não libere.
      </p>
    );
  }
  if (!c) return <p className="text-xs text-muted">Carregando a versão da sala…</p>;

  const s = c.conteudo;
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
