'use client';

/*
 * A FAIXA DE AÇÃO DA FICHA: o que dá para fazer com o contrato no estado em que ele
 * está. Em assinatura: conferir, reenviar, cancelar o envio com motivo. Vigente:
 * encerrar com motivo e ciência das parcelas. Encerrado: reabrir (cancelado não reabre:
 * a API recusa). Antes do envio: cancelar; o que falta está em "Emitir". Nada aqui marca assinado: quem assina é o cliente, e o estado só muda pelo que
 * a ZapSign responde.
 */
import { useState } from 'react';
import type { ContratoNaFicha, ResultadoDaConferencia } from '@mktos/shared';

import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { horaSP } from '@/lib/cockpit';

import { BOTAO, BOTAO_PRIMARIO, CARTAO, INPUT, ROTULO } from '../_ui';
import { RetornoDaAcao, useAcaoDoContrato } from './acao';
import { AvisoDeParcelas, useParcelasDoLead } from './parcelas';
import { CAMINHO_DO_REGISTRO, dataCompleta, type PassoDoContrato } from './regras';

export function FaixaDeAcao({ c, leadId, passo, assinaturaConfigurada, podeEditar, aoMudar }: {
  c: ContratoNaFicha;
  leadId: string;
  passo: PassoDoContrato | null;
  assinaturaConfigurada: boolean;
  podeEditar: boolean;
  aoMudar: () => Promise<void>;
}) {
  const { token } = useAuth();
  const acao = useAcaoDoContrato(aoMudar);
  const [aberto, setAberto] = useState<'encerrar' | 'cancelar' | 'reabrir' | null>(passo === 'encerrar' || passo === 'reabrir' ? passo : null);
  const [motivo, setMotivo] = useState('');
  const [ciente, setCiente] = useState(false);
  const parcelas = useParcelasDoLead(leadId);

  const base = `${CAMINHO_DO_REGISTRO}/${encodeURIComponent(c.id)}`;
  const vigente = c.estado === 'assinado' || c.estado === 'ativo';
  const terminou = c.estado === 'encerrado' || c.estado === 'cancelado';
  const podeReabrir = c.estado === 'encerrado';
  const antesDoEnvio = c.estado === 'a_emitir' || c.estado === 'rascunho';
  const motivoOk = motivo.trim().length >= 5;
  // Reabrir: o motivo é opcional na API; escrito, tem de ter ao menos 5 letras.
  const motivoDaReaberturaOk = !motivo.trim() || motivoOk;
  const parcelasOk = parcelas.emAberto === 0 || ciente;

  const fechar = () => { setAberto(null); setMotivo(''); setCiente(false); };
  const comMotivo = async (chave: 'encerrar' | 'cancelar' | 'reabrir', corpo: Record<string, unknown>, frase: string) => {
    const valeu = await acao.rodar(chave, () => apiPost(`${base}/${chave}`, corpo, token), frase);
    if (valeu) fechar();
  };

  return (
    <section className={`${CARTAO} space-y-2 ${c.estado === 'em_assinatura' ? 'border-warn/50' : ''}`} aria-label="o que fazer com o contrato" data-testid="contrato-faixa">
      {c.estado === 'em_assinatura' && <TextoDaAssinatura c={c} />}
      {antesDoEnvio && <p className="text-[13px]" data-testid="contrato-antes-do-envio"><strong>Ainda não foi para assinatura.</strong> <span className="text-muted">O que falta está em Emitir, logo abaixo.</span></p>}
      {vigente && <p className="text-[13px]"><strong>Contrato vigente.</strong> <span className="text-muted">{c.vigenciaFim ? `Vigência até ${dataCompleta(c.vigenciaFim)}.` : 'Vigência não lançada.'}</span></p>}
      {terminou && (
        <p className="text-[13px]" data-testid="contrato-fim">
          <strong>{c.estado === 'cancelado' ? 'Contrato cancelado.' : 'Contrato encerrado.'}</strong>{' '}
          <span className="text-muted">{c.motivoDoFim ?? 'Motivo não registrado.'}</span>
        </p>
      )}

      {podeEditar && (
        <div className="flex flex-wrap gap-2">
          {c.estado === 'em_assinatura' && (
            <>
              <button
                type="button"
                data-testid="contrato-conferir"
                className={BOTAO_PRIMARIO}
                disabled={acao.ocupado !== null || !assinaturaConfigurada}
                onClick={() => void acao.rodar<ResultadoDaConferencia>('conferir', () => apiPost(`${base}/conferir`, {}, token), (r) => r.frase)}
              >
                {acao.ocupado === 'conferir' ? 'Conferindo…' : 'Conferir assinatura'}
              </button>
              <button
                type="button"
                data-testid="contrato-reenviar"
                className={BOTAO}
                disabled={acao.ocupado !== null || !assinaturaConfigurada}
                onClick={() => void acao.rodar('reenviar', () => apiPost(`${base}/reenviar`, {}, token), 'Reenvio registrado.')}
              >
                Reenviar
              </button>
              <button type="button" data-testid="contrato-cancelar" className={BOTAO} disabled={acao.ocupado !== null} onClick={() => setAberto('cancelar')}>Cancelar envio</button>
            </>
          )}
          {vigente && <button type="button" data-testid="contrato-encerrar" className={BOTAO} disabled={acao.ocupado !== null} onClick={() => setAberto('encerrar')}>Encerrar</button>}
          {antesDoEnvio && <button type="button" data-testid="contrato-cancelar" className={BOTAO} disabled={acao.ocupado !== null} onClick={() => setAberto('cancelar')}>Cancelar contrato</button>}
          {podeReabrir && <button type="button" data-testid="contrato-reabrir" className={BOTAO} disabled={acao.ocupado !== null} onClick={() => setAberto('reabrir')}>Reabrir</button>}
        </div>
      )}

      {podeEditar && aberto === 'cancelar' && (c.estado === 'em_assinatura' || antesDoEnvio) && (
        <FormularioDeMotivo rotulo={antesDoEnvio ? 'Por que cancelar o contrato' : 'Por que cancelar o envio'} motivo={motivo} aoMudar={setMotivo} aoVoltar={fechar}>
          <button type="button" data-testid="contrato-cancelar-confirmar" className={BOTAO_PRIMARIO} disabled={!motivoOk || acao.ocupado !== null} onClick={() => void comMotivo('cancelar', { motivo: motivo.trim() }, 'Contrato cancelado.')}>{antesDoEnvio ? 'Cancelar contrato' : 'Cancelar envio'}</button>
        </FormularioDeMotivo>
      )}
      {podeEditar && aberto === 'encerrar' && vigente && (
        <FormularioDeMotivo rotulo="Por que o contrato termina" motivo={motivo} aoMudar={setMotivo} aoVoltar={fechar}>
          <AvisoDeParcelas parcelas={parcelas} ciente={ciente} aoMudar={setCiente} frase="Encerrar não cancela a cobrança: quem decide é a mesa." />
          <button
            type="button"
            data-testid="contrato-encerrar-confirmar"
            className={BOTAO_PRIMARIO}
            disabled={!motivoOk || !parcelasOk || acao.ocupado !== null}
            onClick={() => void comMotivo('encerrar', { motivo: motivo.trim(), ...(ciente ? { cienteDasParcelas: true } : {}) }, 'Contrato encerrado.')}
          >
            Encerrar contrato
          </button>
        </FormularioDeMotivo>
      )}
      {podeEditar && aberto === 'reabrir' && podeReabrir && (
        <FormularioDeMotivo rotulo="Por que reabrir (opcional)" motivo={motivo} aoMudar={setMotivo} aoVoltar={fechar}>
          <button type="button" data-testid="contrato-reabrir-confirmar" className={BOTAO_PRIMARIO} disabled={!motivoDaReaberturaOk || acao.ocupado !== null} onClick={() => void comMotivo('reabrir', motivo.trim() ? { motivo: motivo.trim() } : {}, 'Contrato reaberto.')}>Reabrir contrato</button>
        </FormularioDeMotivo>
      )}
      <RetornoDaAcao acao={acao} />
    </section>
  );
}

function TextoDaAssinatura({ c }: { c: ContratoNaFicha }) {
  const falta = c.signatarios.filter((s) => !s.assinadoEm).length;
  return (
    <p className="text-[13px]" data-testid="contrato-faltam">
      <strong>{falta === 0 ? 'Todos assinaram: falta a ZapSign confirmar.' : falta === 1 ? 'Falta 1 assinatura.' : `Faltam ${falta} assinaturas.`}</strong>{' '}
      <span className="text-muted">{c.ultimaConferenciaEm ? `Última conferência na ZapSign em ${dataCompleta(c.ultimaConferenciaEm)} às ${horaSP(c.ultimaConferenciaEm)}.` : 'Ainda sem conferência na ZapSign.'}</span>
    </p>
  );
}

function FormularioDeMotivo({ rotulo, motivo, aoMudar, aoVoltar, children }: {
  rotulo: string;
  motivo: string;
  aoMudar: (m: string) => void;
  aoVoltar: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2" data-testid="contrato-motivo-bloco">
      <label className="block space-y-1">
        <span className={ROTULO}>{rotulo}</span>
        <textarea autoFocus data-testid="contrato-motivo" className={`${INPUT} min-h-[64px]`} maxLength={500} value={motivo} onChange={(e) => aoMudar(e.target.value)} />
      </label>
      <div className="flex flex-wrap items-start gap-2">
        {children}
        <button type="button" className={BOTAO} onClick={aoVoltar}>Voltar</button>
      </div>
    </div>
  );
}
