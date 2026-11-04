'use client';

import { ClienteEscopo } from '@/components/clientes/ClienteEscopo';
import { TrabalhoForaDaCarteira } from '@/components/trabalho/TrabalhoDaCarteira';
import { useAuth } from '@/lib/auth';
import { AtasView } from '@/components/trabalho/AtasView';

// O banco de atas do Trabalho (rodada do painel P3, 18/10/2026).
export default function AtasPage() {
  const { token, ready, can } = useAuth();
  if (!ready) return <p className="text-muted">Carregando…</p>;
  if (!token || !can('tarefas.ver')) return <p className="text-muted">Sem permissão para ver as atas.</p>;
  return (
    <ClienteEscopo restrito={() => <TrabalhoForaDaCarteira />}>
      <AtasView />
    </ClienteEscopo>
  );
}
