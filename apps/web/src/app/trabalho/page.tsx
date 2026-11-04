'use client';

import { useAuth } from '@/lib/auth';
import { ClienteEscopo } from '@/components/clientes/ClienteEscopo';
import { TrabalhoDaCarteira } from '@/components/trabalho/TrabalhoDaCarteira';
import { TrabalhoView } from '@/components/trabalho/TrabalhoView';

export default function TrabalhoPage() {
  const { ready, token, can } = useAuth();
  if (!ready) return <p className="text-muted">Carregando…</p>;
  if (!token || !can('tarefas.ver')) return <p className="text-muted">Sem permissão para ver tarefas.</p>;
  return (
    <ClienteEscopo restrito={(clientes, token) => <TrabalhoDaCarteira clientes={clientes} token={token} />}>
      <TrabalhoView />
    </ClienteEscopo>
  );
}
