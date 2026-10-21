'use client';

/*
 * A MINUTA DO CONTRATO DA ROOT E O LAUDO (rodada dos agentes, 21/10/2026, CO-13 e CO-14).
 *
 * "Gerar minuta" pede à API a minuta sobre o modelo de contrato da Root (o
 * arquivo do Drive que a nota `comercial.contrato.modelo` nomeia), a partir da
 * proposta aceita e da ficha. A tela mostra o texto com o que o sistema inseriu
 * e o que falta, cada um com a sua cor (`trechosDaMinuta`, a mesma regra da
 * API), e o laudo do revisor ao lado, ranqueado por gravidade. É RASCUNHO: nada
 * vai ao cliente daqui, e o revisor não reescreve a minuta.
 *
 * Sem o modelo cadastrado, a API recusa com "[a decidir] O modelo de contrato da
 * Root ainda não foi cadastrado", e a tela mostra essa frase.
 */
import { useState } from 'react';
import { ROTULO_DA_GRAVIDADE, trechosDaMinuta, type LaudoDoContrato, type MinutaDoContratoNaTela } from '@mktos/shared';

import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { quandoCurtoSP } from '@/lib/cockpit';

import { BOTAO, BOTAO_PRIMARIO, Carregando, Chip, Erro, ErroDaAcao, Rotulo, useCarregar } from '../_ui';

const TOM_DA_GRAVIDADE = { critica: 'ruim', alta: 'alerta', media: 'info', baixa: 'neutro' } as const;

export function TextoDaMinuta({ conteudo }: { conteudo: string }) {
  return (
    <div className="max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded border border-border bg-bg p-3 text-[12.5px] leading-relaxed" aria-label="texto da minuta">
      {trechosDaMinuta(conteudo).map((t, i) =>
        t.tipo === 'texto' ? (
          <span key={i}>{t.texto}</span>
        ) : t.tipo === 'inserido' ? (
          <mark key={i} data-marca="inserido" title="inserido pelo sistema: confira" className="rounded bg-warn/20 px-0.5 text-text">
            {t.texto}
          </mark>
        ) : (
          <mark key={i} data-marca="lacuna" title="lacuna: falta o dado" className="rounded bg-bad/15 px-0.5 font-semibold text-bad">
            [{t.texto}]
          </mark>
        ),
      )}
    </div>
  );
}

export function LaudoDaMinuta({ laudo }: { laudo: LaudoDoContrato }) {
  return (
    <div className="space-y-2" aria-label="laudo da minuta">
      <p className="text-[12px] text-muted">
        Laudo de {quandoCurtoSP(laudo.geradoEm)} · regras{laudo.porModelo ? ' e modelo' : ' (o modelo não foi ouvido)'} · {laudo.apontamentos.length} apontamento(s)
      </p>
      {laudo.apontamentos.length === 0 ? (
        <p className="text-[12.5px] text-good">Nenhum defeito apontado.</p>
      ) : (
        <ol className="space-y-1.5">
          {laudo.apontamentos.map((a, i) => (
            <li key={i} className="text-[12.5px]">
              <span className="mr-1.5 inline-block">
                <Chip tom={TOM_DA_GRAVIDADE[a.gravidade]}>{ROTULO_DA_GRAVIDADE[a.gravidade]}</Chip>
              </span>
              <span className="font-semibold">{a.titulo}</span>
              {a.origem === 'modelo' && <span className="ml-1 text-[11px] text-dim">(modelo)</span>}
              {a.detalhe && <span className="block text-muted">{a.detalhe}</span>}
              {a.trecho && <span className="block font-os-mono text-[11.5px] text-dim">“{a.trecho}”</span>}
            </li>
          ))}
        </ol>
      )}
      {laudo.avisos.length > 0 && (
        <ul className="text-[11.5px] text-dim">
          {laudo.avisos.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MinutaDoContrato({ leadId, temAceite }: { leadId: string; temAceite: boolean }) {
  const { token, can } = useAuth();
  const caminho = `/comercial/lead/${encodeURIComponent(leadId)}/minuta`;
  const minuta = useCarregar<MinutaDoContratoNaTela | null>(caminho);
  const [ocupado, setOcupado] = useState<'gerar' | 'revisar' | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [avisos, setAvisos] = useState<string[]>([]);

  async function gerar() {
    setOcupado('gerar');
    setErro(null);
    try {
      const r = await apiPost<MinutaDoContratoNaTela>(caminho, {}, token);
      setAvisos(r.avisos ?? []);
      await minuta.recarregar();
    } catch (e) {
      setErro(e);
    } finally {
      setOcupado(null);
    }
  }
  async function revisar() {
    setOcupado('revisar');
    setErro(null);
    try {
      await apiPost<LaudoDoContrato>(`${caminho}/revisar`, {}, token);
      await minuta.recarregar();
    } catch (e) {
      setErro(e);
    } finally {
      setOcupado(null);
    }
  }

  // Só é minuta o que tem o texto e a lista de lacunas (resposta de outro formato não quebra o painel).
  const bruta = minuta.dados;
  const m = bruta && typeof bruta.conteudo === 'string' && Array.isArray(bruta.lacunas) ? bruta : null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Rotulo>minuta do contrato da Root</Rotulo>
        {m && <Chip tom={m.lacunas.length ? 'alerta' : 'bom'}>{m.lacunas.length ? `${m.lacunas.length} lacuna(s)` : 'sem lacuna'}</Chip>}
        {m && <span className="ml-auto text-[11px] text-dim">rascunho · {m.origem === 'modelo' ? 'redigida pelo construtor' : 'preenchida pelo sistema'} · {quandoCurtoSP(m.geradaEm)}</span>}
      </div>
      <Erro erro={minuta.erro} aoTentar={() => void minuta.recarregar()} />
      {minuta.carregando && !m && !minuta.erro && <Carregando linhas={2} altura="h-6" />}
      {!m && !minuta.carregando && (
        <p className="text-[12.5px] text-muted">
          {temAceite
            ? 'A minuta sai do modelo de contrato da Root (no Drive), com os dados da proposta aceita e da ficha. O que faltar fica marcado como lacuna.'
            : 'A minuta parte da proposta aceita: ela aparece aqui depois do aceite.'}
        </p>
      )}
      {m && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <TextoDaMinuta conteudo={m.conteudo} />
          {m.laudo && Array.isArray(m.laudo.apontamentos) ? <LaudoDaMinuta laudo={m.laudo} /> :<p className="text-[12.5px] text-muted">A minuta ainda não foi revisada.</p>}
        </div>
      )}
      {avisos.length > 0 && (
        <ul className="text-[11.5px] text-dim" aria-label="avisos da minuta">
          {avisos.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}
      {can('leads.editar') && temAceite && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BOTAO_PRIMARIO} disabled={ocupado !== null} onClick={() => void gerar()}>
            {ocupado === 'gerar' ? 'Redigindo…' : m ? 'Gerar minuta de novo' : 'Gerar minuta do contrato'}
          </button>
          {m && (
            <button type="button" className={BOTAO} disabled={ocupado !== null} onClick={() => void revisar()}>
              {ocupado === 'revisar' ? 'Revisando…' : 'Revisar de novo'}
            </button>
          )}
        </div>
      )}
      <ErroDaAcao erro={erro} />
      <p className="text-[11.5px] text-dim">Rascunho para o sócio: nada sai para o cliente daqui. A cópia vai para 02-contrato da pasta do cliente.</p>
    </>
  );
}
