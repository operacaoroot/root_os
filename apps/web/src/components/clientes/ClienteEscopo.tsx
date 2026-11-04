'use client';

import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { useConsultaPorEscopo } from '@/lib/consulta-por-escopo';

export type ClienteDaCarteira = { id: string; nome: string; interno: boolean };
type Carteira = { amplo: boolean; clientes: ClienteDaCarteira[] };
type Props = {
  children: ReactNode;
  restrito: (carteira: ClienteDaCarteira[], token: string) => ReactNode;
};

export function ClienteEscopo(props: Props) {
  const { token, ready, user } = useAuth();
  if (!ready) return <p className="text-muted">Carregando…</p>;
  if (!token || !user?.id) return <p className="text-muted">Entre para consultar esta área.</p>;
  return <Consulta key={JSON.stringify([user.id, token])} token={token} {...props} />;
}

function Consulta({ children, restrito, token }: Props & { token: string }) {
  const resultado = useConsultaPorEscopo<Carteira>('/clientes-escopo/me', token);
  if (!resultado) return <p role="status" className="text-sm text-muted">Carregando carteira de clientes…</p>;
  if (resultado.erro !== undefined) return <p role="alert" className="text-sm text-bad">{resultado.erro}</p>;
  const carteira = resultado.dados;
  if (carteira?.amplo === true) return children;
  if (carteira?.amplo === false && Array.isArray(carteira.clientes)) return restrito(carteira.clientes, token);
  return <p role="alert" className="text-sm text-bad">Não foi possível confirmar seu acesso aos clientes.</p>;
}
