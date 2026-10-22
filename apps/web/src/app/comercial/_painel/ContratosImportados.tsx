'use client';

import { useRef, useState } from 'react';
import {
  AVISO_DO_CONTRATO_IMPORTADO,
  tamanhoLegivel,
  type ContratoImportadoNaTela,
  type ResultadoDoContratoImportado,
} from '@mktos/shared';

import { apiBlob, apiUpload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dataDoDia, reaisOuAusente } from '@/lib/cockpit';

import { BOTAO, ErroDaAcao } from '../_ui';
import { ParcelasDoImportado } from './ParcelasDoImportado';

/*
 * OS CONTRATOS QUE VIERAM DO CRM ANTIGO (rodada de produção 1, 21/10/2026).
 *
 * O importador traz cada subtarefa de "Contratos dos clientes" como um contrato vivo
 * do cliente, sem o PDF assinado e sem parcela.
 *
 * Produção 22 (M2, 22/10/2026): o PDF entra daqui mesmo ("Anexar o PDF", o mesmo
 * armazém e o mesmo fato do "Registrar cliente já fechado"), e o aviso some quando o
 * contrato tem o PDF; a tela mostra nome, tamanho e data. No painel do lead, o bloco
 * "Parcelas" deixa a mesa lançar parcelas e vencimentos e ligar a régua. No cartão de
 * Contratos vivos (`compacto`), só o resumo das parcelas.
 */
export function ContratosImportados({ itens, leadId, compacto = false, aoMudar }: {
  itens: readonly ContratoImportadoNaTela[] | undefined;
  leadId?: string;
  compacto?: boolean;
  aoMudar?: () => void | Promise<void>;
}) {
  const { can } = useAuth();
  if (!itens?.length) return null;
  const podeEditar = !!leadId && can('leads.editar');
  const faltaPdf = itens.some((c) => c.semDocumento);
  return (
    <div className="mt-1 min-w-0" data-testid="contratos-importados">
      {faltaPdf ? (
        <p className="text-[12px] font-medium text-warn" data-testid="contratos-importados-aviso">{AVISO_DO_CONTRATO_IMPORTADO}</p>
      ) : (
        <p className="text-[12px] font-medium text-muted">Contrato importado do CRM antigo</p>
      )}
      <ul className="mt-0.5 space-y-2 text-[12px] text-muted">
        {itens.map((c) => (
          <li key={c.origem || c.titulo} className="min-w-0 space-y-1" data-testid="contrato-importado" data-origem={c.origem}>
            <p className="truncate" title={c.titulo}>
              {c.titulo} · {c.produtoRotulo ?? 'produto ausente'} · {reaisOuAusente(c.valorCentavos)} · {c.fechadoEm ? `fechado em ${dataDoDia(c.fechadoEm)}` : 'sem data de fechamento'}
            </p>
            <AnexoDoImportado leadId={leadId} contrato={c} podeEditar={podeEditar} aoMudar={aoMudar} />
            {compacto ? (
              <ResumoDasParcelas contrato={c} />
            ) : leadId ? (
              <ParcelasDoImportado leadId={leadId} contrato={c} podeEditar={podeEditar} aoMudar={aoMudar} />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** O PDF do contrato importado: o que está anexado (nome, tamanho, data) e o botão de anexar. */
function AnexoDoImportado({ leadId, contrato: c, podeEditar, aoMudar }: {
  leadId?: string;
  contrato: ContratoImportadoNaTela;
  podeEditar: boolean;
  aoMudar?: () => void | Promise<void>;
}) {
  const { token } = useAuth();
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const caminho = leadId ? `/comercial/contratos/${encodeURIComponent(leadId)}/importados/anexo?origem=${encodeURIComponent(c.origem)}` : null;

  async function enviar(arquivo: File | undefined) {
    if (!arquivo || !caminho) return;
    setErro(null); setAviso(null);
    if (arquivo.type && arquivo.type !== 'application/pdf') {
      setErro(new Error('O contrato assinado precisa ser um PDF.'));
      return;
    }
    setEnviando(true);
    try {
      const r = await apiUpload<ResultadoDoContratoImportado>(caminho, arquivo, token);
      setAviso(r.novo ? (r.versao > 1 ? `PDF anexado como versão ${r.versao}. O anterior fica no histórico.` : 'PDF anexado.') : 'Este PDF já estava anexado: nada mudou.');
      await aoMudar?.();
    } catch (e) {
      setErro(e);
    } finally {
      setEnviando(false);
      if (entrada.current) entrada.current.value = '';
    }
  }

  async function baixar() {
    if (!caminho || !c.anexo) return;
    setErro(null);
    try {
      const blob = await apiBlob(caminho, token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = c.anexo.nome;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setErro(e);
    }
  }

  return (
    <div className="relative z-10 min-w-0 space-y-1">
      {c.anexo ? (
        <p className="min-w-0 break-words text-[12px] text-text" data-testid="contrato-importado-anexo">
          PDF anexado · <span className="break-all">{c.anexo.nome}</span> · {tamanhoLegivel(c.anexo.bytes)} · {dataDoDia(c.anexo.em.slice(0, 10))}
          {c.anexo.versao > 1 ? ` · versão ${c.anexo.versao}` : ''}
          {c.anexo.por ? ` · por ${c.anexo.por}` : ''}
          {leadId && (
            <>
              {' · '}
              <button type="button" className="underline decoration-dotted hover:text-brand" data-testid="contrato-importado-baixar" onClick={() => void baixar()}>baixar</button>
            </>
          )}
        </p>
      ) : (
        <p className="text-[12px] text-warn" data-testid="contrato-importado-sem-pdf">Sem o PDF assinado.</p>
      )}
      {podeEditar && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={entrada}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            data-testid="contrato-importado-anexo-input"
            onChange={(e) => void enviar(e.target.files?.[0])}
          />
          <button type="button" className={BOTAO} data-testid="contrato-importado-anexar" disabled={enviando} onClick={() => entrada.current?.click()}>
            {enviando ? 'Enviando…' : c.anexo ? 'Anexar outro PDF' : 'Anexar o PDF'}
          </button>
          <span className="text-[11.5px] text-dim">PDF de até 10 MB</span>
        </div>
      )}
      {aviso && <p className="text-[11.5px] text-good" role="status">{aviso}</p>}
      <ErroDaAcao erro={erro} />
    </div>
  );
}

/** No cartão de Contratos vivos: só o resumo; o lançamento mora no painel do lead. */
function ResumoDasParcelas({ contrato: c }: { contrato: ContratoImportadoNaTela }) {
  const p = c.parcelasManuais;
  return (
    <p className="text-[11.5px] text-dim" data-testid="contrato-importado-resumo-parcelas">
      {p ? `${p.linhas.length} parcela${p.linhas.length === 1 ? '' : 's'} lançada${p.linhas.length === 1 ? '' : 's'} · soma ${reaisOuAusente(p.somaCentavos)}` : 'Parcelas a lançar no painel do lead'}
      {'. '}
      {c.regua?.ligada ? 'Régua de cobrança ligada.' : 'Régua de cobrança desligada. Nenhum aviso de cobrança sai deste contrato.'}
    </p>
  );
}
