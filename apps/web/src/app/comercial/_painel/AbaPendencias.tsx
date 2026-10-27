'use client';

/*
 * A ABA "PENDÊNCIAS E SUGESTÕES" DO PAINEL DO LEAD (leva 5, L4, 27/10/2026).
 *
 * Duas listas e as tarefas:
 *   · FALTA PREENCHER: os campos vazios da aba Geral (`camposVazios`, no shared,
 *     a mesma conta da API); um clique troca para a Geral com o campo aberto;
 *   · PRÓXIMOS PASSOS: o que a API deriva do que já está gravado
 *     (`GET /comercial/lead/:id/pendencias`): a próxima ação da ficha, o que o
 *     portão da etapa pede, as decisões abertas, a AUTOMAÇÃO QUE NÃO CONCLUIU
 *     (o passo que travava o Rodrigo: aqui ele ganha "fazer à mão" e "subir
 *     documento") e os fatos de pendência do fio. Cada passo tem "fazer" (leva à
 *     aba, ao campo ou ao endereço certo) ou "marcar como feito" (grava uma
 *     nota no fio, `POST .../fio/nota`, com a chave do passo; a lista o esconde);
 *   · as TAREFAS do comercial ligadas ao lead (o bloco que morava no Fio).
 *
 * "Subir documento" leva à aba Dinheiro, onde o painel já tem o anexo do
 * contrato (`ContratosImportados`): não há segundo upload.
 */
import { useState } from 'react';
import Link from 'next/link';
import { camposVazios, type FichaDoLead, type FichaGeralExtra, type OrigemDoPasso, type PassoSugerido, type PendenciasDoLead } from '@mktos/shared';

import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { prazoEmPalavras } from '@/lib/cockpit';

import { BOTAO, BOTAO_PRIMARIO, CARTAO, Carregando, Chip, Erro, ErroDaAcao, FOCO, INPUT, Rotulo, useCarregar } from '../_ui';
import type { AbaDoPainel } from './estado';
import { ehAba } from './estado';
import { TarefasDoLead } from './TarefasDoLead';

const ROTULO_DA_ORIGEM: Record<OrigemDoPasso, string> = {
  proxima_acao: 'próxima ação',
  portao: 'portão da etapa',
  decisao: 'decisão',
  automacao: 'automação',
  fato: 'pendência',
};

/** O formulário de "marcar como feito" / "fazer à mão": o texto já vem pronto, a pessoa ajusta se quiser. */
function MarcarFeito({ passo, rotulo, aoGravar, aoCancelar }: { passo: PassoSugerido; rotulo: string; aoGravar: (texto: string) => Promise<void>; aoCancelar: () => void }) {
  const [texto, setTexto] = useState(`${rotulo}: ${passo.titulo}`);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  return (
    <form
      data-testid={`pendencia-feito-form-${passo.chave}`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!texto.trim() || ocupado) return;
        setOcupado(true);
        setErro(null);
        try {
          await aoGravar(texto.trim());
        } catch (er) {
          setErro(er);
          setOcupado(false);
        }
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.nativeEvent.isComposing) return;
        e.preventDefault();
        e.stopPropagation();
        aoCancelar();
      }}
      className="mt-2 flex flex-wrap items-end gap-1.5 rounded border border-border bg-surface-2 p-2"
    >
      <label className="min-w-0 flex-1">
        <span className="sr-only">o que foi feito</span>
        <input autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={1000} className={INPUT} data-testid={`pendencia-feito-texto-${passo.chave}`} />
      </label>
      <button type="submit" disabled={ocupado || !texto.trim()} className={BOTAO_PRIMARIO}>gravar no fio</button>
      <button type="button" onClick={aoCancelar} className={BOTAO}>cancelar</button>
      <p className="w-full text-[11px] text-dim">Vira uma nota no fio do lead (e no Histórico). Enter grava, Esc desfaz.</p>
      {erro ? <div className="w-full"><ErroDaAcao erro={erro} /></div> : null}
    </form>
  );
}

function Passo({ passo, irParaAba, aoMarcar }: { passo: PassoSugerido; irParaAba: (aba: AbaDoPainel, campo?: string | null) => void; aoMarcar: (passo: PassoSugerido, texto: string) => Promise<void> }) {
  const { can } = useAuth();
  const pode = can('leads.editar');
  const [marcando, setMarcando] = useState<'feito' | 'a mão' | null>(null);
  const acao = passo.acao;
  return (
    <li data-testid={`pendencia-passo-${passo.chave}`} className={`py-2.5 ${passo.vencido ? 'border-l-2 border-warn pl-2.5' : ''}`}>
      <div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="break-words text-[13.5px] font-medium leading-snug">{passo.titulo}</p>
          {passo.detalhe && <p className="mt-0.5 break-words text-[12px] text-muted">{passo.detalhe}</p>}
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-dim">
            <Chip tom={passo.origem === 'automacao' ? 'alerta' : 'neutro'}>{ROTULO_DA_ORIGEM[passo.origem]}</Chip>
            {passo.quando && <span className={passo.vencido ? 'text-warn' : ''}>{prazoEmPalavras(passo.quando)}</span>}
            {!passo.quando && passo.vencido && passo.origem !== 'automacao' && <span className="text-warn">vencido</span>}
          </p>
        </div>
        <span className="flex shrink-0 flex-wrap gap-1.5">
          {acao?.tipo === 'aba' && ehAba(acao.aba) && (
            <button type="button" data-testid={`pendencia-fazer-${passo.chave}`} onClick={() => irParaAba(acao.aba as AbaDoPainel, acao.campo ?? null)} className={BOTAO}>
              fazer
            </button>
          )}
          {acao?.tipo === 'link' && (
            <Link href={acao.href} data-testid={`pendencia-fazer-${passo.chave}`} className={BOTAO}>
              fazer
            </Link>
          )}
          {pode && passo.podeFazerAMao && (
            <button type="button" data-testid={`pendencia-a-mao-${passo.chave}`} onClick={() => setMarcando('a mão')} className={BOTAO}>
              fazer à mão
            </button>
          )}
          {pode && passo.podeSubirDocumento && (
            <button type="button" data-testid={`pendencia-documento-${passo.chave}`} onClick={() => irParaAba('dinheiro')} className={BOTAO} title="o anexo do contrato fica na aba Dinheiro">
              subir documento
            </button>
          )}
          {pode && (
            <button type="button" data-testid={`pendencia-feito-${passo.chave}`} onClick={() => setMarcando('feito')} className={`${BOTAO} text-muted`}>
              marcar como feito
            </button>
          )}
        </span>
      </div>
      {marcando && (
        <MarcarFeito
          passo={passo}
          rotulo={marcando === 'a mão' ? 'feito à mão' : 'feito'}
          aoGravar={async (texto) => {
            await aoMarcar(passo, texto);
            setMarcando(null);
          }}
          aoCancelar={() => setMarcando(null)}
        />
      )}
    </li>
  );
}

export function AbaPendencias({
  leadId,
  ficha: f,
  extra,
  aoMudar,
  irParaAba,
}: {
  leadId: string;
  ficha: FichaDoLead | null;
  extra: FichaGeralExtra | null;
  aoMudar: () => Promise<void>;
  irParaAba: (aba: AbaDoPainel, campo?: string | null) => boolean | void;
}) {
  const { token } = useAuth();
  const id = encodeURIComponent(leadId);
  const pend = useCarregar<PendenciasDoLead>(`/comercial/lead/${id}/pendencias`, 60_000);
  const vazios = f ? camposVazios(f, extra) : [];
  const passos = Array.isArray(pend.dados?.passos) ? pend.dados!.passos : [];

  const marcar = async (passo: PassoSugerido, texto: string) => {
    await apiPost(`/comercial/lead/${id}/fio/nota`, { texto, feito: passo.chave }, token);
    await pend.recarregar();
    await aoMudar();
  };

  return (
    <div className="space-y-4" data-testid="painel-pendencias">
      <section className={CARTAO} aria-label="falta preencher" data-testid="pendencias-preencher">
        <Rotulo>falta preencher{vazios.length ? ` · ${vazios.length}` : ''}</Rotulo>
        {!f ? (
          <Carregando linhas={1} altura="h-6" />
        ) : vazios.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-dim">A ficha geral está completa.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {vazios.map((c) => (
              <li key={c.chave}>
                <button
                  type="button"
                  data-testid={`pendencia-campo-${c.chave}`}
                  onClick={() => irParaAba('geral', c.chave)}
                  className={`rounded border border-dashed border-border px-2 py-1 text-[12.5px] text-muted hover:border-brand hover:text-text max-md:min-h-[44px] ${FOCO}`}
                >
                  {c.rotulo}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={CARTAO} aria-label="próximos passos" data-testid="pendencias-passos">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Rotulo>próximos passos{passos.length ? ` · ${passos.length}` : ''}</Rotulo>
          {pend.dados && pend.dados.feitos > 0 && (
            <span className="text-[11px] text-dim" data-testid="pendencias-feitos">{pend.dados.feitos} {pend.dados.feitos === 1 ? 'marcado como feito' : 'marcados como feitos'} (no Histórico)</span>
          )}
        </div>
        <Erro erro={pend.erro} aoTentar={() => void pend.recarregar()} />
        {!pend.dados && !pend.erro && <div className="mt-2"><Carregando linhas={2} altura="h-10" /></div>}
        {pend.dados && passos.length === 0 && <p className="mt-2 text-[12.5px] text-dim">Nada pendente: os fatos seguem sozinhos.</p>}
        {passos.length > 0 && (
          <ul className="mt-1 divide-y divide-border">
            {passos.map((p) => <Passo key={p.chave} passo={p} irParaAba={(aba, campo) => void irParaAba(aba, campo)} aoMarcar={marcar} />)}
          </ul>
        )}
      </section>

      <TarefasDoLead leadId={leadId} />
    </div>
  );
}
