'use client';

import { useState, type ReactNode } from 'react';
import type { ClienteDaCarteira } from './ClienteEscopo';

export const CAMPO_DA_CARTEIRA = 'min-h-11 rounded-root border border-border bg-surface px-3 py-2 text-sm';
export const BOTAO_DA_CARTEIRA = 'min-h-11 rounded-root border border-border px-3 py-2 text-sm hover:bg-surface-2 disabled:opacity-50';

export function SelecaoDaCarteira({ clientes, rotulo, children }: {
  clientes: ClienteDaCarteira[];
  rotulo: string;
  children: (cliente: ClienteDaCarteira) => ReactNode;
}) {
  const [selecionado, setSelecionado] = useState(() => typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('clienteId'));
  const cliente = clientes.find((item) => item.id === selecionado) ?? clientes[0];

  if (!cliente) return <p className="text-sm text-muted">Nenhum cliente disponível.</p>;

  return (
    <div className="space-y-4">
      <label className="block max-w-sm text-sm">
        <span className="mb-1 block text-muted">{rotulo}</span>
        <select value={cliente.id} onChange={(e) => setSelecionado(e.target.value)} className={`w-full ${CAMPO_DA_CARTEIRA}`}>
          {clientes.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
        </select>
      </label>
      {children(cliente)}
    </div>
  );
}
