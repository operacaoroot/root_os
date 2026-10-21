'use client';

import { useEffect, useState } from 'react';
import type { FaseDoCliente } from '@mktos/shared';
import { VisoesDaLista } from '@/components/ficha/VisoesDaLista';
import { PastasDosClientes } from '@/components/clientes/PastasDosClientes';

/*
 * CLIENTES: os mesmos cards do CRM (um por lead/cliente), nas etapas de depois
 * da venda. Onboarding vai de "Negócio fechado" a "Treinamento"; Sucesso do
 * cliente, de "Pós-entrega" a "Recorrente". Passar de um para o outro é mover
 * o card; nada é copiado.
 */
const ABAS: { fase: Exclude<FaseDoCliente, 'comercial'>; nome: string; valor: string }[] = [
  { fase: 'onboarding', nome: 'Onboarding', valor: 'Contratos em implantação' },
  { fase: 'sucesso', nome: 'Sucesso do cliente', valor: 'Contratos dos clientes' },
];

export default function ClientesPage() {
  const [aba, setAba] = useState<(typeof ABAS)[number]['fase']>('onboarding');

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('ver') === 'sucesso') setAba('sucesso');
  }, []);

  const trocar = (fase: (typeof ABAS)[number]['fase']) => {
    setAba(fase);
    const u = new URL(window.location.href);
    if (fase === 'sucesso') u.searchParams.set('ver', 'sucesso');
    else u.searchParams.delete('ver');
    u.searchParams.delete('visao');
    window.history.replaceState(window.history.state, '', u);
  };

  const atual = ABAS.find((a) => a.fase === aba)!;
  return (
    <div className="com-tema space-y-5 text-text">
      <div className="flex gap-1 border-b border-border">
        {ABAS.map((a) => (
          <button
            key={a.fase}
            onClick={() => trocar(a.fase)}
            className={`-mb-px border-b-2 px-3 py-2.5 text-[0.95rem] ${aba === a.fase ? 'border-brand font-medium text-text' : 'border-transparent text-muted hover:text-text'}`}
          >
            {a.nome}
          </button>
        ))}
      </div>
      <VisoesDaLista
        key={aba}
        chave="crm-root-lista"
        item="cliente"
        rotuloAbertos="Clientes"
        rotuloDoValor={atual.valor}
        novo="+ Novo cliente"
        fases={[aba]}
      />
      <PastasDosClientes />
    </div>
  );
}
