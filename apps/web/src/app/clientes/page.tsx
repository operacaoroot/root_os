'use client';

import { useEffect, useState } from 'react';
import { QuadroDeClientes } from '@/components/ficha/QuadroDeClientes';

/*
 * CLIENTES: depois do "Negócio fechado", o cliente passa ao onboarding e,
 * entregue, ao sucesso do cliente. Os dois quadros abrem a mesma ficha do lead,
 * e a ficha mostra a jornada inteira (comercial → onboarding → sucesso).
 */
const ABAS = [
  { chave: 'crm-root-onboarding', nome: 'Onboarding', valor: 'Contratos em implantação' },
  { chave: 'crm-root-sucesso', nome: 'Sucesso do cliente', valor: 'Receita recorrente (mês)' },
] as const;

export default function ClientesPage() {
  const [aba, setAba] = useState<(typeof ABAS)[number]['chave']>('crm-root-onboarding');

  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get('ver');
    if (v === 'sucesso') setAba('crm-root-sucesso');
  }, []);

  const trocar = (chave: (typeof ABAS)[number]['chave']) => {
    setAba(chave);
    const u = new URL(window.location.href);
    if (chave === 'crm-root-sucesso') u.searchParams.set('ver', 'sucesso');
    else u.searchParams.delete('ver');
    window.history.replaceState(null, '', u);
  };

  const atual = ABAS.find((a) => a.chave === aba)!;
  return (
    <div className="com-tema space-y-5 text-text">
      <div className="flex gap-1 border-b border-border">
        {ABAS.map((a) => (
          <button
            key={a.chave}
            onClick={() => trocar(a.chave)}
            className={`-mb-px border-b-2 px-3 py-2.5 text-[0.95rem] ${aba === a.chave ? 'border-brand font-medium text-text' : 'border-transparent text-muted hover:text-text'}`}
          >
            {a.nome}
          </button>
        ))}
      </div>
      <QuadroDeClientes key={aba} chave={aba} rotuloDoValor={atual.valor} />
    </div>
  );
}
