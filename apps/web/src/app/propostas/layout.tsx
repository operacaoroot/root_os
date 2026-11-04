'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ClienteEscopo } from '@/components/clientes/ClienteEscopo';

export default function LayoutDePropostas({ children }: { children: ReactNode }) {
  return (
    <ClienteEscopo restrito={() => (
      <section className="space-y-2 rounded-root border border-border bg-surface p-4 text-sm">
        <p>A área de Propostas requer acesso amplo. Leads e contratos da carteira estão no Comercial.</p>
        <Link href="/comercial" className="inline-flex min-h-11 items-center text-brand underline">Abrir Comercial</Link>
      </section>
    )}>
      {children}
    </ClienteEscopo>
  );
}
