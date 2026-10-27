'use client';

import { TelaDaEtapa } from '@/components/maquina/TelaDaEtapa';

/* Marketing › BANCO DE IDEIAS: os posts que ainda são ideia. Aprovar manda para Design & Gravação. */
export default function BancoDeIdeiasPage() {
  return (
    <TelaDaEtapa
      chave="banco"
      titulo="Banco de ideias"
      nota="O que a gente quer dizer, antes de virar post. Aprovar manda para Design & Gravação."
      etapa="ideia"
      vazio="O banco está vazio. Crie a primeira ideia em “+ Novo post”."
      comArquivo
    />
  );
}
