'use client';

import { useAuth } from '@/lib/auth';
// Rodada dos agentes (21/10/2026, A6): todo conector num cartão só (`CartaoDeConexao`). O conteúdo próprio
// da Evolution (Produção 21, P8) e do Granola entra como filho do cartão deles, dentro do catálogo.
import { CatalogoDeConexoes } from './CatalogoDeConexoes';

export default function IntegracoesPage() {
  const { token, user, ready, can } = useAuth();
  if (!ready) return <p className="text-sm text-muted">Carregando sessão…</p>;
  if (!token || !user) return <p className="text-sm text-muted">Entre para consultar Conexões.</p>;
  if (!can('dashboard.ver')) {
    return <p className="text-sm text-muted">Sem permissão para consultar Conexões.</p>;
  }
  return (
    <div className="space-y-5">
      <a href="/marketing/preparacao" className="text-sm text-brand underline">Dono e operadores das contas de Marketing</a>
      <CatalogoDeConexoes key={`${user.id}-${token}`} token={token} pessoaId={user.id} podeGerenciar={can('admin.usuarios')} />
    </div>
  );
}
