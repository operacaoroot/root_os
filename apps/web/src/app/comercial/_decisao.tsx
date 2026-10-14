'use client';

/*
 * O CARTÃO DE UMA DECISÃO (lane C, extraído na lane UX). O mesmo cartão vale
 * na fila (tela 03) e na aba Decisões do painel do lead: as opções em um
 * toque, o padrão destacado e nomeado como padrão, o prazo e o que acontece se
 * ninguém responder. Responder é a mesma rota nos dois lugares.
 */
import { useState } from 'react';
import type { DecisaoNaFila } from '@mktos/shared';

import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ROTULO_DO_TIPO_DE_DECISAO, comNivelExplicado, decisaoSemPrazo, ehContrapropostaProvisoria, prazoDaDecisao, quandoCurtoSP, rotuloDoPadrao } from '@/lib/cockpit';

import { Aviso, BOTAO, BOTAO_PRIMARIO, CARTAO, Chip, ErroDaAcao, FOCO } from './_ui';
import { LinkDoLead } from './_painel/provedor';

/** O que o aviso do canto diz depois de responder: a opção e o efeito escrito pela API. */
export function textoDaResposta(rotulo: string, efeito: string | undefined): string {
  return efeito ? `Respondido: ${rotulo}. ${efeito.charAt(0).toUpperCase()}${efeito.slice(1)}.`.replace(/\.\.$/, '.') : `Respondido: ${rotulo}. A resposta entrou no fio do lead.`;
}

export function CartaoDeDecisao({
  d,
  aoResponder,
  noPainel = false,
}: {
  d: DecisaoNaFila;
  /** Chamado depois que a API aceitou a resposta, com o texto para o aviso. */
  aoResponder: (texto: string) => void | Promise<void>;
  /** Dentro do painel do lead o cartão não repete o link para o próprio lead. */
  noPainel?: boolean;
}) {
  const { token, user, can } = useAuth();
  // C-12: quem propôs não responde (a API devolve 403), e responder pede aprovacoes.decidir.
  const propostaMinha = !!user?.id && !!d.propostoPor && d.propostoPor === user.id;
  const podeResponder = can('aprovacoes.decidir') && !propostaMinha;
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const prazo = prazoDaDecisao(d.expiraEm);
  // O mesmo cartão pode estar na fila e no painel ao mesmo tempo: os ids não se repetem.
  const base = noPainel ? `painel-dec-${d.id}` : `dec-${d.id}`;

  async function responder(escolha: string, rotulo: string, efeito: string | undefined) {
    if (enviando) return;
    setEnviando(escolha);
    setErro(null);
    try {
      await apiPost(`/comercial/decisoes/${d.id}/responder`, { escolha }, token);
      await aoResponder(textoDaResposta(rotulo, efeito));
    } catch (e) {
      setErro(e);
    } finally {
      setEnviando(null);
    }
  }

  return (
    <article id={base} className={`${CARTAO} space-y-3`} aria-labelledby={`${base}-titulo`}>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tom="brand">{ROTULO_DO_TIPO_DE_DECISAO[d.tipo] ?? d.tipo}</Chip>
        <Chip tom={prazo.vencido ? 'ruim' : 'alerta'}>{prazo.texto}</Chip>
        {!noPainel && (
          <LinkDoLead leadId={d.leadId} aba="decisoes" className={`ml-auto text-[12px] text-muted underline-offset-2 hover:text-brand hover:underline max-md:py-2 ${FOCO}`}>
            {d.leadNome} · ver o lead
          </LinkDoLead>
        )}
      </div>
      <div>
        <h3 id={`${base}-titulo`} className="text-[15px] font-semibold">{d.titulo}</h3>
        <p className="mt-1 text-[13px] text-muted">{d.contexto}</p>
      </div>
      {propostaMinha && <Aviso>Você propôs esta decisão. Outra pessoa da mesa responde.</Aviso>}
      {!propostaMinha && !can('aprovacoes.decidir') && <Aviso>Responder pede a permissão de decidir aprovações. Quem tem a permissão responde por aqui.</Aviso>}
      {podeResponder && (
        <div className="flex flex-wrap gap-2">
          {d.opcoes.map((o) => {
            const ehPadrao = o.chave === d.padrao;
            return (
              <button
                key={o.chave}
                type="button"
                disabled={!!enviando || d.estado !== 'aberta'}
                aria-busy={enviando === o.chave || undefined}
                onClick={() => void responder(o.chave, o.rotulo, o.efeito)}
                className={ehPadrao ? BOTAO_PRIMARIO : BOTAO}
                title={o.efeito ? comNivelExplicado(o.efeito) : undefined}
              >
                {enviando === o.chave ? `${o.rotulo}…` : o.rotulo}
                {ehPadrao && <span className="ml-1.5 font-os-mono text-[9.5px] uppercase opacity-80">padrão</span>}
                {ehContrapropostaProvisoria(d, o.chave) && <span className="ml-1.5 font-os-mono text-[9.5px] uppercase opacity-80">provisória</span>}
              </button>
            );
          })}
        </div>
      )}
      <ErroDaAcao erro={erro} />
      <ul className="space-y-0.5 text-[12px] text-muted">
        {d.opcoes.filter((o) => o.efeito).map((o) => (
          <li key={o.chave}>
            <span className="text-text">{o.rotulo}:</span> {comNivelExplicado(o.efeito ?? '')}
            {ehContrapropostaProvisoria(d, o.chave) && (
              <span className="text-warn"> Contraproposta provisória [a decidir]: a metade do pedido é número do sistema, sem base no mapa de preço.</span>
            )}
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-muted">
        {decisaoSemPrazo(d.expiraEm) ? (
          <>
            Sem prazo configurado: a decisão só sai com uma resposta. O padrão escrito é <span className="text-text">{rotuloDoPadrao(d)}</span>.
          </>
        ) : (
          <>
            Se ninguém responder até {quandoCurtoSP(d.expiraEm)}, vale o padrão: <span className="text-text">{rotuloDoPadrao(d)}</span>.
          </>
        )}
      </p>
    </article>
  );
}
