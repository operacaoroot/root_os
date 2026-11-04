import { redirect } from 'next/navigation';

/*
 * Etapa 9b (#7, pedido do Lucas em 04/11/2026): as ideias moravam em três lugares (Ideias › Base,
 * Produção › Banco de ideias e a coluna Banco do Quadro). A base é uma só, o Banco de ideias: toda
 * ideia aprovada na triagem vira um post em "Banco de ideias", com o comentário de quem aprovou. A
 * coluna do Quadro é o mesmo Banco, filtrado pela etapa. Quem chega pelo link antigo da Base vai para lá.
 * Nenhum card foi apagado: a aprovação continua gravada em Ideias de conteúdo.
 */
export default function BaseDasIdeiasPage() {
  redirect('/marketing/banco');
}
