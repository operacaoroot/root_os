'use client';

/*
 * OS DOCUMENTOS DO CONTRATO e o formulário de aditivo e distrato (`POST .../filhos`).
 * Aditivo e distrato não viram cartão próprio no quadro: aparecem aqui, ligados ao
 * contrato pai. Distrato com parcela em aberto pede a ciência: ele não cancela cobrança.
 */
import { useState } from 'react';
import { ContratoFilhoSchema, centavosDigitados, type ContratoFilhoInput, type ContratoNaFicha, type EstadoDoContrato, type TipoDeContrato } from '@mktos/shared';

import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { reaisOuAusente } from '@/lib/cockpit';

import { BOTAO, BOTAO_PRIMARIO, CARTAO, Carregando, Chip, Erro, ErroDaAcao, FOCO, INPUT, ROTULO, Rotulo, useCarregar } from '../_ui';
import { RetornoDaAcao, abrirPdfDaApi, useAcaoDoContrato } from './acao';
import { EmitirContrato } from './EmitirContrato';
import { AvisoDeParcelas, useParcelasDoLead } from './parcelas';
import { CAMINHO_DO_REGISTRO, dataCompleta, linkSeguro, pdfDaApi } from './regras';

const ROTULO_DO_TIPO: Record<TipoDeContrato, string> = { contrato: 'Contrato', aditivo: 'Aditivo', distrato: 'Distrato' };
const ROTULO_DO_ESTADO: Record<EstadoDoContrato, string> = {
  rascunho: 'minuta', a_emitir: 'a emitir', em_assinatura: 'em assinatura', assinado: 'assinado', ativo: 'ativo', encerrado: 'encerrado', cancelado: 'cancelado',
};

/** O aditivo ou o distrato em rascunho: a mesma emissão do contrato, sobre a ficha dele. */
function EmissaoDoFilho({ id, assinaturaConfigurada, podeEditar, aoMudar }: { id: string; assinaturaConfigurada: boolean; podeEditar: boolean; aoMudar: () => Promise<void> }) {
  const filho = useCarregar<ContratoNaFicha>(`${CAMINHO_DO_REGISTRO}/${encodeURIComponent(id)}`, 30_000);
  const recarregar = filho.recarregar;
  if (!filho.dados) return filho.erro ? <Erro erro={filho.erro} aoTentar={() => void recarregar()} /> : <Carregando linhas={2} altura="h-16" />;
  return <EmitirContrato c={filho.dados} passo="minuta" assinaturaConfigurada={assinaturaConfigurada} podeEditar={podeEditar} aoMudar={async () => { await Promise.all([recarregar(), aoMudar()]); }} />;
}

export function DocumentosDoContrato({ c, leadId, assinaturaConfigurada, podeEditar, aoMudar }: { c: ContratoNaFicha; leadId: string; assinaturaConfigurada: boolean; podeEditar: boolean; aoMudar: () => Promise<void> }) {
  const { token } = useAuth();
  const [novo, setNovo] = useState<'aditivo' | 'distrato' | null>(null);
  const [emitindo, setEmitindo] = useState<string | null>(null);
  const [erroDoPdf, setErroDoPdf] = useState<unknown>(null);
  const abrirPdf = async (caminho: string) => {
    setErroDoPdf(null);
    try {
      await abrirPdfDaApi(caminho, token);
    } catch (e) {
      setErroDoPdf(e);
    }
  };
  const vigente = c.estado === 'assinado' || c.estado === 'ativo';
  const pdf = linkSeguro(c.linkPdf);
  return (
    <section className={`${CARTAO} space-y-2`} aria-label="documentos deste contrato" data-testid="contrato-documentos">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Rotulo>documentos deste contrato</Rotulo>
        {podeEditar && (
          <div className="flex flex-wrap gap-2">
            <button type="button" data-testid="contrato-novo-aditivo" aria-expanded={novo === 'aditivo'} className={BOTAO} disabled={!vigente} title={vigente ? undefined : 'Só contrato assinado recebe aditivo.'} onClick={() => setNovo('aditivo')}>+ aditivo</button>
            <button type="button" data-testid="contrato-novo-distrato" aria-expanded={novo === 'distrato'} className={BOTAO} disabled={!vigente} title={vigente ? undefined : 'Só contrato assinado tem distrato.'} onClick={() => setNovo('distrato')}>+ distrato</button>
          </div>
        )}
      </div>
      {c.documentos.length === 0 ? (
        <p className="text-[12.5px] text-muted">Nenhum documento ainda.</p>
      ) : (
        <ul className="divide-y divide-border">
          {c.documentos.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 py-1.5 text-[12.5px]" data-testid={`documento-${d.id}`}>
              <span className="min-w-0 flex-1">
                <strong className="font-semibold">{d.titulo}</strong>
                <span className="text-dim"> · {ROTULO_DO_TIPO[d.tipo]}{d.numero ? ` nº ${d.numero}` : ''}{d.assinadoEm ? ` · assinado em ${dataCompleta(d.assinadoEm)}` : ''}</span>
              </span>
              <Chip>{ROTULO_DO_ESTADO[d.estado]}</Chip>
              <Chip tom={d.temPdf ? 'neutro' : 'alerta'}>{d.temPdf ? 'com PDF' : 'sem PDF'}</Chip>
              {d.id === c.id && pdf && !pdfDaApi(pdf) && <a href={pdf} target="_blank" rel="noreferrer" className={BOTAO}>Abrir</a>}
              {d.id === c.id && pdf && pdfDaApi(pdf) && <button type="button" data-testid="contrato-abrir-pdf" className={BOTAO} onClick={() => void abrirPdf(pdf)}>Abrir</button>}
              {d.tipo !== 'contrato' && d.estado === 'rascunho' && podeEditar && (
                <button type="button" data-testid={`documento-emitir-${d.id}`} aria-expanded={emitindo === d.id} className={BOTAO} onClick={() => setEmitindo(emitindo === d.id ? null : d.id)}>Emitir</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ErroDaAcao erro={erroDoPdf} />
      {emitindo && <EmissaoDoFilho key={emitindo} id={emitindo} assinaturaConfigurada={assinaturaConfigurada} podeEditar={podeEditar} aoMudar={aoMudar} />}
      {novo && (
        <FormularioDoFilho key={novo} c={c} leadId={leadId} tipoInicial={novo} aoFechar={() => setNovo(null)} aoMudar={aoMudar} />
      )}
      <p className="text-[11.5px] text-dim">Aditivo e distrato aparecem aqui, ligados a este contrato, e não viram cartão próprio no quadro.</p>
    </section>
  );
}

const CAMPOS_DO_ADITIVO = { valor: 'Valor', vigencia: 'Vigência', escopo: 'Escopo', signatarios: 'Signatários' } as const;
type CampoDoAditivo = keyof typeof CAMPOS_DO_ADITIVO;

function FormularioDoFilho({ c, leadId, tipoInicial, aoFechar, aoMudar }: {
  c: ContratoNaFicha;
  leadId: string;
  tipoInicial: 'aditivo' | 'distrato';
  aoFechar: () => void;
  aoMudar: () => Promise<void>;
}) {
  const { token } = useAuth();
  const acao = useAcaoDoContrato(aoMudar);
  const parcelas = useParcelasDoLead(leadId);
  const [tipo, setTipo] = useState(tipoInicial);
  const [campo, setCampo] = useState<CampoDoAditivo>('valor');
  const [novoValor, setNovoValor] = useState('');
  const [valeDe, setValeDe] = useState('');
  const [ultimaData, setUltimaData] = useState('');
  const [motivo, setMotivo] = useState('');
  const [ciente, setCiente] = useState(false);

  const hoje = campo === 'valor'
    ? (c.valorCentavos == null ? 'sem valor' : reaisOuAusente(c.valorCentavos))
    : campo === 'vigencia' ? (dataCompleta(c.vigenciaFim) || 'não lançada') : 'como está no contrato';

  const corpo = montarCorpo({ tipo, campo, novoValor, valeDe, ultimaData, motivo, ciente });
  const parcelasOk = tipo === 'aditivo' || parcelas.emAberto === 0 || ciente;
  const pronto = corpo !== null && ContratoFilhoSchema.safeParse(corpo).success && parcelasOk;

  const enviar = async () => {
    if (!corpo) return;
    const valeu = await acao.rodar('filho', () => apiPost(`${CAMINHO_DO_REGISTRO}/${encodeURIComponent(c.id)}/filhos`, corpo, token));
    if (valeu) aoFechar();
  };

  return (
    <div className="space-y-2 rounded border border-border bg-surface-2 p-3" data-testid="contrato-filho-form">
      <div role="group" aria-label="Tipo do documento" className="inline-flex overflow-hidden rounded border border-border">
        {(['aditivo', 'distrato'] as const).map((t) => (
          <button key={t} type="button" data-testid={`filho-tipo-${t}`} aria-pressed={tipo === t} onClick={() => setTipo(t)} className={`px-2.5 py-1.5 text-[12.5px] max-md:min-h-[44px] ${tipo === t ? 'bg-brand/10 text-brand' : 'text-muted hover:text-text'} ${FOCO}`}>
            {ROTULO_DO_TIPO[t]}
          </button>
        ))}
      </div>

      {tipo === 'aditivo' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className={ROTULO}>Campo alterado</span>
            <select data-testid="filho-campo" className={`${INPUT} max-md:min-h-[44px]`} value={campo} onChange={(e) => { setCampo(e.target.value as CampoDoAditivo); setNovoValor(''); }}>
              {(Object.keys(CAMPOS_DO_ADITIVO) as CampoDoAditivo[]).map((k) => <option key={k} value={k}>{CAMPOS_DO_ADITIVO[k]}</option>)}
            </select>
          </label>
          <p className="flex flex-col gap-1">
            <span className={ROTULO}>Hoje</span>
            <span className="font-os-mono text-[12.5px]" data-testid="filho-hoje">{hoje}</span>
          </p>
          <label className="flex flex-col gap-1">
            <span className={ROTULO}>Passa a ser</span>
            {campo === 'vigencia' ? (
              <input data-testid="filho-novo" type="date" className={`${INPUT} max-md:min-h-[44px]`} value={novoValor} onChange={(e) => setNovoValor(e.target.value)} />
            ) : (
              <input data-testid="filho-novo" className={`${INPUT} max-md:min-h-[44px] ${campo === 'valor' ? 'font-os-mono' : ''}`} maxLength={1000} placeholder={campo === 'valor' ? 'em reais: 4.200,00' : undefined} value={novoValor} onChange={(e) => setNovoValor(e.target.value)} />
            )}
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className={ROTULO}>Vale a partir de</span>
            <input data-testid="filho-vale-de" type="date" className={`${INPUT} max-md:min-h-[44px]`} value={valeDe} onChange={(e) => setValeDe(e.target.value)} />
          </label>
        </div>
      ) : (
        <label className="flex flex-col gap-1">
          <span className={ROTULO}>Última data de vigência</span>
          <input data-testid="filho-ultima-data" type="date" className={`${INPUT} max-md:min-h-[44px]`} value={ultimaData} onChange={(e) => setUltimaData(e.target.value)} />
        </label>
      )}

      <label className="block space-y-1">
        <span className={ROTULO}>{tipo === 'aditivo' ? 'Motivo' : 'Por que termina'}</span>
        <textarea data-testid="filho-motivo" className={`${INPUT} min-h-[64px]`} maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </label>

      {tipo === 'distrato' && <AvisoDeParcelas parcelas={parcelas} ciente={ciente} aoMudar={setCiente} frase="O distrato não cancela a cobrança: quem decide é a mesa." />}
      {tipo === 'aditivo' && <p className="text-[12px] text-muted">As cláusulas não citadas continuam valendo.</p>}

      <div className="flex flex-wrap gap-2">
        <button type="button" data-testid="filho-criar" className={BOTAO_PRIMARIO} disabled={!pronto || acao.ocupado !== null} onClick={() => void enviar()}>
          {tipo === 'aditivo' ? 'Criar aditivo' : 'Criar distrato'}
        </button>
        <button type="button" className={BOTAO} onClick={aoFechar}>Cancelar</button>
      </div>
      <RetornoDaAcao acao={acao} testId="filho-retido" />
    </div>
  );
}

/** O corpo de `POST .../filhos`. Nulo enquanto falta o essencial do formulário. */
function montarCorpo(f: { tipo: 'aditivo' | 'distrato'; campo: CampoDoAditivo; novoValor: string; valeDe: string; ultimaData: string; motivo: string; ciente: boolean }): ContratoFilhoInput | null {
  const motivo = f.motivo.trim();
  if (f.tipo === 'distrato') {
    // A API recusa distrato com parcela em aberto sem a ciência: ela vai no corpo, só quando a pessoa marcou.
    return f.ultimaData ? { tipo: 'distrato', motivo, vigenciaFim: f.ultimaData, ...(f.ciente ? { cienteDasParcelas: true } : {}) } : null;
  }
  const novo = f.novoValor.trim();
  if (!novo) return null;
  const aPartir = f.valeDe ? `, a partir de ${dataCompleta(f.valeDe)}` : '';
  if (f.campo === 'valor') {
    const centavos = centavosDigitados(novo);
    if (centavos == null) return null;
    return { tipo: 'aditivo', motivo, valorCentavos: centavos, mudancas: `Valor: ${reaisOuAusente(centavos)}${aPartir}` };
  }
  if (f.campo === 'vigencia') {
    return { tipo: 'aditivo', motivo, vigenciaFim: novo, mudancas: `Vigência até ${dataCompleta(novo)}${aPartir}` };
  }
  return { tipo: 'aditivo', motivo, mudancas: `${CAMPOS_DO_ADITIVO[f.campo]}: ${novo}${aPartir}` };
}
