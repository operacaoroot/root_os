'use client';

import { useParams } from 'next/navigation';
import { FichaDoCliente } from '@/components/ficha/FichaDoCliente';

/** A ficha do lead: a ficha do cliente com a volta para os negócios do comercial. */
export default function FichaDoLead() {
  const { id } = useParams<{ id: string }>();
  return <FichaDoCliente taskId={id} rotulo="Lead" voltar={{ href: '/comercial?ver=negocios', texto: 'Negócios' }} />;
}
