'use client';

import { useAuth } from '@/lib/auth';
import { CatalogoDeclarativo } from './CatalogoDeclarativo';
import { ConexaoGranola } from './ConexaoGranola';
import { ConexaoDigisac } from './ConexaoDigisac';

export default function IntegracoesPage() {
  const { token, user, ready, can } = useAuth();
  if (!ready) return <p className="text-sm text-muted">Carregando sessão…</p>;
  if (!token || !user) return <p className="text-sm text-muted">Entre para consultar Conexões.</p>;
  if (!can('dashboard.ver')) {
    return <p className="text-sm text-muted">Sem permissão para consultar Conexões.</p>;
  }
  return (
    <div className="space-y-5">
      <ConexaoGranola key={`granola-${user.id}`} token={token} gerenciar={can('admin.usuarios')} />
      <ConexaoDigisac key={`digisac-${user.id}`} token={token} gerenciar={can('admin.usuarios')} />
      <CatalogoDeclarativo
        key={JSON.stringify([user.id, token])}
        token={token}
        pessoaId={user.id}
        podeSincronizarTarefas={can('tarefas.editar')}
      />
    </div>
  );
}
