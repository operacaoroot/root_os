'use client';

import { useParams } from 'next/navigation';
import { BancadaDoTrilho } from '@/components/onboarding/BancadaDoTrilho';

/*
 * A BANCADA DE UM TRILHO na rota antiga. Desde a rodada do trabalho (T1/T2,
 * 19/10/2026) a bancada também é a aba "Trilho" do pop-up da tarefa, no cartão
 * do cliente da implantação; esta rota continua viva para os links gravados
 * (descrição do card, convites, relógio).
 */
export default function TrilhoPage() {
  const { id } = useParams<{ id: string }>();
  return <BancadaDoTrilho id={id} />;
}
