'use client';

import type { ReactNode } from 'react';
import { ClienteEscopo } from '@/components/clientes/ClienteEscopo';
import { useAuth } from '@/lib/auth';
import { FinanceiroDaCarteira } from './FinanceiroDaCarteira';

export default function LayoutFinanceiro({ children }: { children: ReactNode }) {
  const { can } = useAuth();
  return (
    <ClienteEscopo restrito={(clientes, token) => can('financeiro.ver')
      ? <FinanceiroDaCarteira clientes={clientes} token={token} />
      : <p className="text-sm text-muted">Seu acesso atual não permite abrir o Financeiro.</p>}>
      {children}
    </ClienteEscopo>
  );
}
