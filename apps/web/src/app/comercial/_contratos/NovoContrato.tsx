'use client';

/*
 * "+ CONTRATO" NO QUADRO (Contratos, F2, 02/11/2026): os clientes em contrato ou fechados sem registro são os cartões
 * fantasmas, e o seletor mostra só eles. Criar é `POST /comercial/contratos/registro`; depois a aba Contrato do lead abre
 * em Emitir. Lead fora dessa lista ganha contrato pelo painel dele, na mesma aba.
 */
import { useState } from 'react';
import { MODALIDADES_DE_CONTRATO, ROTULO_DA_MODALIDADE, type ContratoNoQuadro, type ModalidadeDeContrato } from '@mktos/shared';

import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

import { BOTAO, BOTAO_PRIMARIO, ErroDaAcao, INPUT, ROTULO } from '../_ui';
import { CAMINHO_DO_REGISTRO } from './regras';

export function NovoContrato({ itens, aoCriar }: { itens: readonly ContratoNoQuadro[]; aoCriar: (leadId: string) => void | Promise<void> }) {
  const { token } = useAuth();
  const [aberto, setAberto] = useState(false);
  const [leadId, setLeadId] = useState('');
  const [modalidade, setModalidade] = useState<ModalidadeDeContrato>('implantacao');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  const fantasmas = itens.filter((c) => c.fantasma);

  const criar = async () => {
    setOcupado(true);
    setErro(null);
    try {
      await apiPost(CAMINHO_DO_REGISTRO, { leadId, modalidade }, token);
      setAberto(false);
      setLeadId('');
      await aoCriar(leadId);
    } catch (e) {
      setErro(e);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="relative">
      <button type="button" data-testid="contratos-novo" aria-expanded={aberto} className={BOTAO} onClick={() => setAberto((a) => !a)}>+ contrato</button>
      {aberto && (
        <div data-testid="contratos-novo-bloco" className="absolute right-0 z-20 mt-1 w-[20rem] max-w-[calc(100vw-2rem)] space-y-2 rounded border border-border-strong bg-surface p-3 shadow-lg">
          {fantasmas.length === 0 ? (
            <p className="text-[12.5px] text-muted" data-testid="contratos-novo-vazio">Todo cliente em contrato ou fechado já tem contrato. Para outro lead, abra o painel dele na aba Contrato.</p>
          ) : (
            <>
              <label className="flex flex-col gap-1">
                <span className={ROTULO}>Cliente sem contrato</span>
                <select data-testid="contratos-novo-lead" className={`${INPUT} max-md:min-h-[44px]`} value={leadId} onChange={(e) => setLeadId(e.target.value)}>
                  <option value="">Escolher</option>
                  {fantasmas.map((c) => <option key={c.leadId} value={c.leadId}>{c.cliente}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className={ROTULO}>Modalidade</span>
                <select data-testid="contratos-novo-modalidade" className={`${INPUT} max-md:min-h-[44px]`} value={modalidade} onChange={(e) => setModalidade(e.target.value as ModalidadeDeContrato)}>
                  {MODALIDADES_DE_CONTRATO.map((m) => <option key={m} value={m}>{ROTULO_DA_MODALIDADE[m]}</option>)}
                </select>
              </label>
              <button type="button" data-testid="contratos-novo-criar" className={BOTAO_PRIMARIO} disabled={!leadId || ocupado} onClick={() => void criar()}>{ocupado ? 'Criando…' : 'Criar e abrir'}</button>
            </>
          )}
          <ErroDaAcao erro={erro} />
        </div>
      )}
    </div>
  );
}
