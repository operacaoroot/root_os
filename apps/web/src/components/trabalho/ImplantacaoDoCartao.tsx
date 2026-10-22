'use client';

/*
 * O CARTÃO DA IMPLANTAÇÃO SABE MAIS (rodada de produção 2, M1, 22/10/2026).
 *
 *  · S1 "reunião dd/mm" no cartão, com o dia da semana e a hora no balão (`title`),
 *    em São Paulo; sem evento, nada. No painel, a reunião por extenso ou "Agenda
 *    indisponível" quando a leitura falhou;
 *  · S2 o selo "fase do trilho: N de 5" quando a etapa do card e a fase do trilho
 *    divergem, e a frase no painel ("o card está em Imersão e o trilho ainda na
 *    fase 3 de 5"). Só leitura: nada se move sozinho.
 *
 * Uma leitura por lista aberta (`GET /trabalho/implantacao/cartoes?listId=`),
 * separada do movimento do quadro: falhar aqui só tira a reunião e o selo.
 * O quadro entrega o resultado aos cartões por contexto, sem passar prop por
 * dentro do `Board`.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import {
  AGENDA_INDISPONIVEL, AGENDA_SEM_PERMISSAO, DIAS_DA_AGENDA_DO_CARTAO,
  type EstadoDaAgendaDoCartao, type ImplantacaoDoCartao, type ImplantacaoDoQuadro, type ProximaReuniaoDoCartao,
} from '@mktos/shared';

import { apiGet } from '@/lib/api';

const FUSO = 'America/Sao_Paulo';

export interface ImplantacaoDoQuadroNaTela {
  agenda: EstadoDaAgendaDoCartao | null;
  porCartao: Map<string, ImplantacaoDoCartao>;
}

const VAZIO: ImplantacaoDoQuadroNaTela = { agenda: null, porCartao: new Map() };

export const ImplantacaoDoQuadroContexto = createContext<ImplantacaoDoQuadroNaTela>(VAZIO);

function lida(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "23/10", em São Paulo. */
export function diaDaReuniao(r: ProximaReuniaoDoCartao): string | null {
  const d = lida(r.inicio);
  return d ? d.toLocaleDateString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' }) : null;
}

/** "quinta-feira, 23/10/2026 às 14:00" (dia inteiro: sem a hora), em São Paulo. */
export function quandoDaReuniao(r: ProximaReuniaoDoCartao): string | null {
  const d = lida(r.inicio);
  if (!d) return null;
  const semana = d.toLocaleDateString('pt-BR', { timeZone: FUSO, weekday: 'long' });
  const dia = d.toLocaleDateString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric' });
  if (r.diaInteiro) return `${semana}, ${dia} (dia inteiro)`;
  const hora = d.toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
  return `${semana}, ${dia} às ${hora}`;
}

/** A leitura de uma lista. `listaId` nulo = não lê (outra visão, Todas). */
export function useImplantacaoDoQuadro(listaId: string | null, token: string | null, versao: number = 0): ImplantacaoDoQuadroNaTela {
  const [estado, setEstado] = useState<ImplantacaoDoQuadroNaTela>(VAZIO);
  useEffect(() => {
    if (!listaId || !token) { setEstado(VAZIO); return; }
    let vivo = true;
    apiGet<ImplantacaoDoQuadro>(`/trabalho/implantacao/cartoes?listId=${encodeURIComponent(listaId)}`, token)
      .then((r) => {
        if (!vivo) return;
        const itens = Array.isArray(r?.itens) ? r.itens : [];
        setEstado({ agenda: r?.agenda ?? null, porCartao: new Map(itens.map((i) => [i.tarefaId, i])) });
      })
      .catch(() => { if (vivo) setEstado(VAZIO); });
    return () => { vivo = false; };
  }, [listaId, token, versao]);
  return estado;
}

/** No cartão: "reunião 23/10" e o selo da fase do trilho. Sem dado, nada. */
export function ReuniaoESeloNoCartao({ tarefaId, linha = false }: { tarefaId: string; linha?: boolean }) {
  const item = useContext(ImplantacaoDoQuadroContexto).porCartao.get(tarefaId);
  if (!item) return null;
  const dia = item.reuniao ? diaDaReuniao(item.reuniao) : null;
  const selo = item.fase?.diverge ? item.fase.selo : null;
  if (!dia && !selo) return null;
  const conteudo = (
    <>
      {item.reuniao && dia && (
        <span data-testid="cartao-reuniao" className="text-text" title={`Próxima reunião: ${quandoDaReuniao(item.reuniao) ?? ''}`}>
          reunião {dia}
        </span>
      )}
      {selo && (
        <span
          data-testid="cartao-selo-fase"
          data-fase-do-trilho={item.fase?.fase}
          className="rounded border border-warn/50 px-1 font-os-mono text-[10px] text-warn"
          title={item.fase?.frase ? `Etapa e trilho divergem: ${item.fase.frase}. Nada se move sozinho.` : undefined}
        >
          {selo}
        </span>
      )}
    </>
  );
  // No cartão compacto (a densidade padrão) não há linha de metadados: vira uma linha própria.
  return linha ? <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px]">{conteudo}</div> : conteudo;
}

/** No painel do card: a reunião por extenso (ou por que não há) e a frase da divergência. */
export function ImplantacaoNoPainel({ tarefaId, listId, token }: { tarefaId: string; listId: string; token: string | null }) {
  const dados = useImplantacaoDoQuadro(listId, token);
  const item = dados.porCartao.get(tarefaId);
  if (!dados.agenda || !item) return null;
  const quando = item.reuniao ? quandoDaReuniao(item.reuniao) : null;
  return (
    <section aria-label="Agenda e trilho do cliente" data-testid="painel-implantacao" className="space-y-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12px]">
      <p data-testid="painel-reuniao" data-agenda={dados.agenda} className="break-words">
        <span className="text-muted">Próxima reunião: </span>
        {dados.agenda === 'indisponivel' ? AGENDA_INDISPONIVEL
          : dados.agenda === 'sem-permissao' ? AGENDA_SEM_PERMISSAO
          : quando ? <>{quando}{item.reuniao?.titulo ? <span className="text-muted"> · {item.reuniao.titulo}</span> : null}</>
          : `nenhuma nos próximos ${DIAS_DA_AGENDA_DO_CARTAO} dias`}
      </p>
      {item.fase?.diverge && item.fase.frase && (
        <p data-testid="painel-fase-diverge" className="break-words text-warn">
          Etapa e trilho divergem: {item.fase.frase}. Nada se move sozinho; acerte o card ou o trilho.
        </p>
      )}
    </section>
  );
}
