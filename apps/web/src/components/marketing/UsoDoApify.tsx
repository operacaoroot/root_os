'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * "Apify: US$ 0,12 de 5,00 este mês" (27/10/2026, pedido do Lucas: usar só os créditos
 * grátis). Com 90% ou mais, o OS não roda o Apify e a linha diz quando volta.
 */
interface Uso { usadoUsd: number; tetoUsd: number; voltaEm: string | null }
const usd = (n: number) => n.toFixed(2).replace('.', ',');

export function UsoDoApify() {
  const { token, ready } = useAuth();
  const [r, setR] = useState<{ uso: Uso | null; configurado: boolean } | null>(null);
  useEffect(() => {
    if (!ready || !token) return;
    apiGet<{ uso: Uso | null; configurado: boolean }>('/marketing/estudio/apify/uso', token).then(setR).catch(() => setR(null));
  }, [ready, token]);
  if (!r?.configurado) return null;
  if (!r.uso) return <p className="tiny muted">Apify: não consegui ler o uso do mês agora; Reels e perfis ficam parados até ler.</p>;
  const { usadoUsd, tetoUsd, voltaEm } = r.uso;
  const parado = usadoUsd >= tetoUsd * 0.9;
  const volta = voltaEm ? new Date(voltaEm).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '';
  return (
    <p className="tiny muted" title="Só os créditos grátis do mês: com 90% usados, o OS para de rodar o Apify.">
      Apify: US$ {usd(usadoUsd)} de {usd(tetoUsd)} este mês
      {parado ? ` · parado até ${volta || 'o próximo ciclo'}` : ''}
    </p>
  );
}
