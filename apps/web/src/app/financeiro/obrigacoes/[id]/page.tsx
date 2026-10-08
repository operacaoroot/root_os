'use client';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useAuth } from '@/lib/auth';
import { ObrigacaoFinanceira } from '../ObrigacaoFinanceira';
import { PonteObrigacao } from '../PonteObrigacao';

export default function ObrigacaoFinanceiraPage() {
  return <Suspense fallback={<p>Carregando obrigação…</p>}><ObrigacaoDaRota /></Suspense>;
}

function ObrigacaoDaRota() {
  const { token, user, ready, can } = useAuth();
  const { id } = useParams<{ id: string }>();
  const origem = useSearchParams().get('origem');
  if (!ready) return <p>Carregando sessão…</p>;
  if (!token || !user) return <p>Entre na sua conta para abrir a obrigação.</p>;
  if (!can('financeiro.ver')) return <p>Seu acesso atual não permite abrir o Financeiro.</p>;
  return origem === 'comercial' ? <PonteObrigacao token={token} userId={user.id} transactionId={id} /> : <ObrigacaoFinanceira token={token} userId={user.id} transactionId={id} />;
}
