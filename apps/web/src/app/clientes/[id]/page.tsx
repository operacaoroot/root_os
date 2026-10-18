'use client';

import { useParams } from 'next/navigation';
import { FichaDoCliente } from '@/components/ficha/FichaDoCliente';

/** A ficha do cliente em página inteira (onboarding e sucesso do cliente). */
export default function FichaDoClientePagina() {
  const { id } = useParams<{ id: string }>();
  return <FichaDoCliente taskId={id} rotulo="Cliente" voltar={{ href: '/clientes', texto: 'Clientes' }} />;
}
