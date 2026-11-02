'use client';

/*
 * A LISTA DE CONTRATOS E O LOTE (fase F4, 02/11/2026). A mesma base do quadro, em
 * `?visao=lista`. Marcar e agir: conferir, encerrar (com motivo) e reabrir pela rota
 * `POST /comercial/contratos/lote`, que responde item a item. O recusado fica marcado e
 * aparece com o motivo. O cartão fantasma não tem contrato: não entra no lote.
 */
import { useState } from 'react';
import { ContratoLoteSchema, ROTULO_DA_ETAPA_DO_QUADRO, ROTULO_DA_MODALIDADE, type ContratoLoteInput, type ContratoNoQuadro, type ResultadoDoLote } from '@mktos/shared';

import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { reaisOuAusente } from '@/lib/cockpit';

import { BOTAO, BOTAO_PRIMARIO, Chip, ErroDaAcao, FOCO, INPUT, ROTULO } from '../_ui';
import { LinkDoLead } from '../_painel/provedor';
import { FaixaRetida } from './acao';
import { CAMINHO_DO_LOTE, dataCompleta, foiParaAprovacoes } from './regras';

export type RespostaDoLote = ResultadoDoLote | { status: 'aguardando_aprovacao' };

/** Confere o pedido na tela antes de ir à API: a frase é da casa, não a do esquema. */
export async function enviarLote(corpo: ContratoLoteInput, token: string | null | undefined): Promise<RespostaDoLote> {
  const conferido = ContratoLoteSchema.safeParse(corpo);
  if (!conferido.success) {
    const ids = conferido.error.issues.some((i) => i.path[0] === 'ids');
    throw new Error(ids ? 'O lote aceita de 1 a 100 contratos por vez.' : 'Escreva o motivo (de 5 a 500 caracteres).');
  }
  return apiPost<RespostaDoLote>(CAMINHO_DO_LOTE, conferido.data, token);
}

/** O que voltou do lote: quantos valeram e cada recusado com o motivo da API. */
export function ResultadoDoLoteNaTela({ resposta, itens }: { resposta: RespostaDoLote; itens: readonly ContratoNoQuadro[] }) {
  if (foiParaAprovacoes(resposta)) return <FaixaRetida testId="lote-retido" />;
  const r = resposta as ResultadoDoLote;
  const nome = (id: string) => itens.find((c) => c.id === id)?.cliente ?? id;
  return (
    <div role="status" data-testid="lote-resultado" className="space-y-1 rounded border border-border bg-surface-2 px-3 py-2 text-[12.5px]">
      <p>{r.ok.length === 1 ? '1 contrato feito.' : `${r.ok.length} contratos feitos.`} {r.recusados.length === 1 ? '1 recusado.' : `${r.recusados.length} recusados.`}</p>
      {r.recusados.length > 0 && (
        <ul className="list-disc pl-5" data-testid="lote-recusados">
          {r.recusados.map((x) => <li key={x.id}><strong>{nome(x.id)}</strong>: {x.motivo}</li>)}
        </ul>
      )}
    </div>
  );
}

export function ListaDeContratos({ itens, podeAgir, aoMudar }: {
  itens: readonly ContratoNoQuadro[];
  podeAgir: boolean;
  aoMudar: () => void | Promise<void>;
}) {
  const { token } = useAuth();
  const [marcadas, setMarcadas] = useState<ReadonlySet<string>>(new Set());
  const [confirmando, setConfirmando] = useState<'encerrar' | 'reabrir' | null>(null);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  const [resposta, setResposta] = useState<RespostaDoLote | null>(null);

  // Só conta o que está na tela: filtro que esconde a linha tira ela do lote.
  const visiveis = new Set(itens.map((c) => c.id));
  const ids = [...marcadas].filter((id) => visiveis.has(id));
  const alternar = (id: string) => setMarcadas((m) => {
    const nova = new Set(m);
    if (nova.has(id)) nova.delete(id);
    else nova.add(id);
    return nova;
  });

  async function agir(acao: ContratoLoteInput['acao']) {
    setOcupado(true);
    setErro(null);
    setResposta(null);
    try {
      const r = await enviarLote({ acao, ids, ...(acao === 'encerrar' || motivo.trim() ? { motivo: motivo.trim() } : {}) }, token);
      setResposta(r);
      if (!foiParaAprovacoes(r)) {
        const feitos = new Set((r as ResultadoDoLote).ok);
        setMarcadas((m) => new Set([...m].filter((id) => !feitos.has(id))));
      }
      setConfirmando(null);
      setMotivo('');
      await aoMudar();
    } catch (e) {
      setErro(e);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded border border-border" data-testid="contratos-tabela">
        <table className="w-full min-w-[820px] text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-border bg-surface-2">
              <th scope="col" className="w-10 px-3 py-2"><span className="sr-only">Marcar</span></th>
              {['Cliente', 'Etapa', 'Modalidade', 'Valor', 'Documento', 'Vigência', 'Sócio'].map((t) => (
                <th key={t} scope="col" className={`px-3 py-2 font-normal ${ROTULO}`}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {itens.map((c) => (
              <tr key={c.id} data-testid={`contrato-linha-${c.id}`} className={`border-b border-border last:border-0 ${marcadas.has(c.id) ? 'bg-brand/5' : ''}`}>
                <td className="px-3 py-1.5">
                  {podeAgir && (
                    <input
                      type="checkbox"
                      data-testid={`contrato-marcar-${c.id}`}
                      aria-label={c.fantasma ? `${c.cliente}: sem contrato, não entra no lote` : `Marcar ${c.cliente}`}
                      disabled={c.fantasma}
                      checked={marcadas.has(c.id)}
                      onChange={() => alternar(c.id)}
                      className={`h-4 w-4 max-md:h-6 max-md:w-6 ${FOCO}`}
                    />
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <LinkDoLead leadId={c.leadId} aba="contrato" title={c.cliente} className={`font-semibold hover:text-brand max-md:inline-flex max-md:min-h-[44px] max-md:items-center ${FOCO}`}>{c.cliente}</LinkDoLead>
                </td>
                <td className="px-3 py-1.5"><Chip tom={c.fantasma ? 'alerta' : 'neutro'}>{ROTULO_DA_ETAPA_DO_QUADRO[c.etapa]}</Chip></td>
                <td className="px-3 py-1.5 text-muted">{c.modalidade ? ROTULO_DA_MODALIDADE[c.modalidade] : 'a definir'}</td>
                <td className="px-3 py-1.5 font-os-mono tabular-nums">{c.valorCentavos == null ? 'sem valor' : reaisOuAusente(c.valorCentavos)}</td>
                <td className={`px-3 py-1.5 ${c.fantasma ? 'text-dim' : c.temPdf ? 'text-muted' : 'text-warn'}`}>
                  {c.fantasma ? 'nenhum' : c.temPdf ? (c.importado ? 'importado, com PDF' : 'com PDF') : (c.importado ? 'importado, sem PDF' : 'sem PDF')}
                </td>
                <td className="px-3 py-1.5 text-dim">{c.vigenciaFim ? `até ${dataCompleta(c.vigenciaFim)}` : c.fantasma ? 'não se aplica' : 'não lançada'}</td>
                <td className="px-3 py-1.5 text-muted">{c.dono ?? 'sem dono'}</td>
              </tr>
            ))}
            {itens.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-4 text-center text-[12.5px] text-dim">Nenhum contrato com esta busca e estes filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {resposta && <ResultadoDoLoteNaTela resposta={resposta} itens={itens} />}

      {podeAgir && ids.length > 0 && (
        <div role="region" aria-label="Ações em lote" data-testid="contratos-lote" className="sticky bottom-2 z-10 space-y-2 rounded border border-border-strong bg-surface p-3 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="text-[13px]">{ids.length === 1 ? '1 contrato marcado' : `${ids.length} contratos marcados`}</strong>
            <div className="flex flex-wrap gap-2">
              <button type="button" data-testid="lote-conferir" className={BOTAO} disabled={ocupado} onClick={() => void agir('conferir')}>Conferir assinatura</button>
              <button type="button" data-testid="lote-encerrar" className={BOTAO} disabled={ocupado} onClick={() => setConfirmando('encerrar')}>Encerrar</button>
              <button type="button" data-testid="lote-reabrir" className={BOTAO} disabled={ocupado} onClick={() => setConfirmando('reabrir')}>Reabrir</button>
              <button type="button" data-testid="lote-limpar" className={BOTAO} onClick={() => { setMarcadas(new Set()); setConfirmando(null); }}>Limpar</button>
            </div>
          </div>
          {confirmando && (
            <div className="space-y-2" data-testid="lote-confirmacao">
              <label className="block space-y-1">
                <span className={ROTULO}>{confirmando === 'encerrar' ? 'Por que estes contratos terminam' : 'Por que reabrir (opcional)'}</span>
                <textarea autoFocus data-testid="lote-motivo" className={`${INPUT} min-h-[56px]`} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
              </label>
              {confirmando === 'encerrar' && <p className="text-[12px] text-warn">Encerrar não cancela cobrança nenhuma: parcela em aberto fica com a mesa. O contrato que não puder encerrar aqui volta recusado, com o motivo.</p>}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="lote-confirmar"
                  className={BOTAO_PRIMARIO}
                  disabled={ocupado || (confirmando === 'encerrar' && motivo.trim().length < 5)}
                  onClick={() => void agir(confirmando)}
                >
                  {confirmando === 'encerrar' ? `Encerrar ${ids.length}` : `Reabrir ${ids.length}`}
                </button>
                <button type="button" className={BOTAO} onClick={() => setConfirmando(null)}>Voltar</button>
              </div>
            </div>
          )}
          <ErroDaAcao erro={erro} />
        </div>
      )}
    </div>
  );
}
