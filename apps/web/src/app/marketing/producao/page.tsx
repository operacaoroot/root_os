'use client';

import { TelaDaEtapa } from '@/components/maquina/TelaDaEtapa';

/* Marketing › DESIGN & GRAVAÇÃO: o que foi aprovado e precisa de arte ou de gravação. */
export default function DesignEGravacaoPage() {
  return (
    <TelaDaEtapa
      chave="producao"
      titulo="Design & Gravação"
      nota="Posts aprovados esperando arte ou gravação. Pronto manda para Agendar."
      etapa="producao"
      vazio="Nada em produção agora."
    />
  );
}
