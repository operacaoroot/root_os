'use client';

import { TelaDaEtapa } from '@/components/maquina/TelaDaEtapa';

/* Marketing › AGENDAR: posts prontos sem data, e os já agendados por ordem de data. */
export default function AgendarPage() {
  return (
    <TelaDaEtapa
      chave="agendar"
      titulo="Agendar"
      nota="Posts prontos. Escolha o dia; os dias livres da cadência aparecem primeiro."
      etapa="a_agendar"
      vazio="Nenhum post pronto esperando data."
      comAgendados
    />
  );
}
