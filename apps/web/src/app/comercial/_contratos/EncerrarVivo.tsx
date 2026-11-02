'use client';

import { useState } from 'react';
import type { ContratoVivo } from '@mktos/shared';

import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

import { BOTAO, BOTAO_PRIMARIO, ErroDaAcao, INPUT, ROTULO } from '../_ui';
import { parcelasEmAberto } from './regras';

/*
 * ENCERRAR PELAS ROTAS DE ANTES (T8, 19/10/2026): "Concluir contrato" e "Desativar
 * contrato", com motivo. Continua valendo para o contrato vivo sem registro e para o
 * importado. Parcela em aberto avisa e a cobrança NÃO é cancelada (fica com a mesa).
 */
export function FormularioDeEncerrar({ contrato, situacao, aoCancelar, aoConcluir }: {
  contrato: Pick<ContratoVivo, 'leadId' | 'parcelas' | 'importados'>;
  situacao: 'concluido' | 'desativado';
  aoCancelar: () => void;
  aoConcluir: () => void;
}) {
  const { token } = useAuth();
  const [motivo, setMotivo] = useState('');
  const [ciente, setCiente] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  const emAberto = parcelasEmAberto(contrato);
  const pronto = motivo.trim().length >= 5 && (emAberto === 0 || ciente);
  const enviar = async () => {
    setEnviando(true); setErro(null);
    try {
      await apiPost(`/comercial/contratos/${contrato.leadId}/encerrar`, { situacao, motivo: motivo.trim(), ...(emAberto > 0 ? { cienteDasParcelas: ciente } : {}) }, token);
      aoConcluir();
    } catch (e) { setErro(e); } finally { setEnviando(false); }
  };
  return (
    <div className="w-full space-y-2" data-testid={`contrato-encerrar-${contrato.leadId}`}>
      <label className="block space-y-1">
        <span className={ROTULO}>{situacao === 'concluido' ? 'Por que o contrato terminou' : 'Por que o contrato foi desativado'}</span>
        <textarea autoFocus data-testid="contrato-motivo" className={`${INPUT} min-h-[64px]`} value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} />
      </label>
      {emAberto > 0 && (
        <div className="space-y-1 rounded border border-warn/50 bg-warn/10 p-2 text-[12px]" role="alert">
          <p>Há {emAberto} parcela(s) em aberto no Asaas. Encerrar o contrato NÃO cancela a cobrança: isso fica com a mesa.</p>
          <label className="flex items-center gap-2">
            <input type="checkbox" data-testid="contrato-ciente" checked={ciente} onChange={(e) => setCiente(e.target.checked)} />
            Vi as parcelas em aberto e sigo com o encerramento.
          </label>
        </div>
      )}
      <ErroDaAcao erro={erro} />
      <div className="flex gap-2">
        <button type="button" data-testid="contrato-confirmar" className={BOTAO_PRIMARIO} disabled={!pronto || enviando} onClick={() => void enviar()}>
          {situacao === 'concluido' ? 'Concluir contrato' : 'Desativar contrato'}
        </button>
        <button type="button" className={BOTAO} onClick={aoCancelar}>Cancelar</button>
      </div>
    </div>
  );
}
