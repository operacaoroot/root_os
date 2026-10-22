'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * A FICHA DE UM CLIENTE PELO ID DO CLIENTE (produção 22C, W3). A ficha do
 * Trabalho é por cartão; o link "Cliente: <nome>" da caixa de WhatsApp sabe só
 * o cliente. Esta página pergunta à API qual é o cartão dele e abre a ficha.
 */
export default function FichaPeloCliente() {
  const { id } = useParams<{ id: string }>();
  const { token, ready } = useAuth();
  const router = useRouter();
  const [estado, setEstado] = useState<'buscando' | 'sem-ficha' | 'erro'>('buscando');
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !token || !id) return;
    let vivo = true;
    apiGet<{ taskId: string | null }>(`/whatsapp/vinculos/cliente/${encodeURIComponent(id)}/ficha`, token)
      .then((r) => {
        if (!vivo) return;
        if (r.taskId) router.replace(`/comercial/ficha/${encodeURIComponent(r.taskId)}`);
        else setEstado('sem-ficha');
      })
      .catch((e: Error) => {
        if (!vivo) return;
        setErro(e.message);
        setEstado('erro');
      });
    return () => {
      vivo = false;
    };
  }, [id, ready, token, router]);

  return (
    <div className="com-tema space-y-3 p-4 text-text">
      {estado === 'buscando' && <p className="text-sm text-muted">Abrindo a ficha do cliente…</p>}
      {estado === 'sem-ficha' && (
        <p className="text-sm" data-testid="ficha-do-cliente-ausente">
          Este cliente ainda não tem ficha no Trabalho. <Link href="/clientes" className="text-brand underline">Ver os clientes</Link>
        </p>
      )}
      {estado === 'erro' && (
        <p role="alert" className="text-sm text-bad">
          {erro}
        </p>
      )}
    </div>
  );
}
