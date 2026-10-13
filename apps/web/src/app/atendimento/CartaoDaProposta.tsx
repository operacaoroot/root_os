'use client';

import { useEffect, useState } from 'react';
import type { ComercialProduto } from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AUSENTE, ROTULO_DO_PRODUTO, diaHoraSP, reaisOuAusente } from '@/lib/cockpit';

/*
 * A PROPOSTA, COMO QUEM LIBERA O R3 A LÊ (revisão E-7).
 *
 * A aprovação de `comercial.proposta.publicar` guarda produto, valor, parcelas
 * e o hash. O hash prende muito mais: desconto, validade, quadro de custos, "o
 * que ouvimos" e a frase de "como é diferente". Este cartão busca a versão
 * inteira na API, com o hash RECALCULADO agora, e marca a divergência. O botão
 * de aprovar só aparece com o conteúdo carregado e conferido.
 */

export const CAPACIDADE_DA_PROPOSTA = 'comercial.proposta.publicar';

interface ConteudoDaProposta {
  leadId: string;
  versao: number;
  estado: string;
  conteudo: {
    produto: ComercialProduto;
    rotulo: string;
    valorCentavos: number;
    parcelas: number;
    parcelaCentavos: number;
    ultimaParcelaCentavos: number;
    formas: string[];
    descricao: string;
    descontoPct: number | null;
    alternativa: ComercialProduto | null;
    ouvimos: string[];
    comoEDiferente: string | null;
    quadroDeCustos: { mesNormalCentavos: number | null; piorMesCentavos: number | null; exemplo: boolean; origem: string } | null;
    validaAte: string | null;
    tabelaData: string;
  };
  laudo: { ok: boolean; apontamentos: string[]; notas: string[] };
  dentroDaTabela: boolean;
  hashGravado: string;
  hashDeAgora: string;
  hashAssinado: string | null;
  confere: boolean;
}

/** `leadId:vN`, o recurso que a proposta grava na porta. */
export function recursoDaProposta(id: string): { leadId: string; versao: number } | null {
  const m = /^(.+):v(\d+)$/.exec(id);
  return m ? { leadId: m[1], versao: Number(m[2]) } : null;
}

export function CartaoDaProposta({
  recursoId,
  hashAssinado,
  onPronto,
}: {
  recursoId: string;
  hashAssinado: string | null;
  /** `true` só com o conteúdo carregado e o hash de agora igual ao assinado. */
  onPronto: (ok: boolean) => void;
}) {
  const { token } = useAuth();
  const [c, setC] = useState<ConteudoDaProposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const recurso = recursoDaProposta(recursoId);

  useEffect(() => {
    if (!recurso) {
      setErro('o recurso da aprovação não diz qual versão é');
      onPronto(false);
      return;
    }
    let vivo = true;
    const q = hashAssinado ? `?hash=${encodeURIComponent(hashAssinado)}` : '';
    apiGet<ConteudoDaProposta>(`/comercial/lead/${encodeURIComponent(recurso.leadId)}/proposta/v/${recurso.versao}/conteudo${q}`, token)
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
      <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad" data-testid="proposta-sem-conteudo">
        A proposta não carregou ({erro}). Sem ver o que o cliente vai ler, não libere.
      </p>
    );
  }
  if (!c) return <p className="text-xs text-muted">Carregando a proposta…</p>;

  const p = c.conteudo;
  const q = p.quadroDeCustos;
  return (
    <section className="space-y-2 rounded-lg border border-border p-3 text-xs" data-testid="cartao-da-proposta" aria-label="Proposta que vai à sala">
      {!c.confere && (
        <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-bad" data-testid="proposta-divergente">
          A proposta mudou depois do pedido: o hash de agora não é o que esta aprovação prende. Ela não sai com esta assinatura.
        </p>
      )}
      <p className="text-sm font-medium">
        v{c.versao} · {p.rotulo || ROTULO_DO_PRODUTO[p.produto]} · {reaisOuAusente(p.valorCentavos)} em {p.parcelas}× de {reaisOuAusente(p.parcelaCentavos)}
        {p.ultimaParcelaCentavos !== p.parcelaCentavos && ` (última ${reaisOuAusente(p.ultimaParcelaCentavos)})`}
      </p>
      <dl className="grid grid-cols-[150px_minmax(0,1fr)] gap-x-2 gap-y-1">
        <dt className="text-muted">formas</dt>
        <dd>{p.formas.join(', ') || AUSENTE}</dd>
        <dt className="text-muted">desconto</dt>
        <dd>{p.descontoPct != null ? `${p.descontoPct}%` : 'nenhum'}</dd>
        <dt className="text-muted">vale até</dt>
        <dd>{p.validaAte ? diaHoraSP(p.validaAte) : AUSENTE}</dd>
        <dt className="text-muted">custos de terceiros</dt>
        <dd>
          mês normal {reaisOuAusente(q?.mesNormalCentavos)} · pior mês {reaisOuAusente(q?.piorMesCentavos)}
          {q?.exemplo && <span className="text-bad"> · VALORES DE EXEMPLO</span>}
        </dd>
        <dt className="text-muted">alternativa</dt>
        <dd>{p.alternativa ? ROTULO_DO_PRODUTO[p.alternativa] : 'nenhuma'}</dd>
        <dt className="text-muted">o que ouvimos</dt>
        <dd>{p.ouvimos.length ? p.ouvimos.join(' · ') : AUSENTE}</dd>
        <dt className="text-muted">como é diferente</dt>
        <dd>{p.comoEDiferente ?? AUSENTE}</dd>
        <dt className="text-muted">descrição</dt>
        <dd>{p.descricao}</dd>
        <dt className="text-muted">tabela</dt>
        <dd>{p.tabelaData} · {c.dentroDaTabela ? 'dentro da tabela' : 'fora da tabela'}</dd>
        <dt className="text-muted">laudo</dt>
        <dd>{c.laudo.apontamentos.length ? c.laudo.apontamentos.join('; ') : 'sem apontamento'}</dd>
      </dl>
      <p className="font-mono text-[10px] text-muted">
        hash de agora {c.hashDeAgora.slice(0, 12)}… · {c.confere ? 'confere com o da aprovação' : 'NÃO confere com o da aprovação'}
      </p>
    </section>
  );
}
