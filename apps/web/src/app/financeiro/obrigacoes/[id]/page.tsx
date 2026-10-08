'use client';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ObrigacaoFinanceira } from '../ObrigacaoFinanceira';

export default function ObrigacaoFinanceiraPage() {
  const { token, user, ready, can } = useAuth();
  const { id } = useParams<{ id: string }>();
  if (!ready) return <p>Carregando sessão…</p>;
  if (!token || !user) return <p>Entre na sua conta para abrir a obrigação.</p>;
  if (!can('financeiro.ver')) return <p>Seu acesso atual não permite abrir o Financeiro.</p>;
  return <ObrigacaoFinanceira token={token} userId={user.id} transactionId={id} />;
}
