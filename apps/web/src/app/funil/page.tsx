'use client';

import { VisoesDaLista } from '@/components/ficha/VisoesDaLista';

/*
 * FUNIL DE VENDAS: as etapas comerciais do CRM (um card por lead/cliente) em Quadro, Lista e
 * Calendário. Arrastar muda a etapa (ou a data, no calendário); clicar abre a
 * ficha do lead em janela, sem sair do funil.
 */
export default function FunilPage() {
  return (
    <div className="com-tema text-text">
      <VisoesDaLista chave="crm-root-lista" item="lead" rotuloAbertos="Leads" rotuloDoValor="No funil" novo="+ Novo lead" fases={['comercial']} etapasExtras={['Negócio fechado']} />
    </div>
  );
}
