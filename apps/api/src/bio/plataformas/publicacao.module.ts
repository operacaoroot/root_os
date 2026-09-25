import { Module } from '@nestjs/common';
import { GRAPH_DE_PUBLICACAO, type GraphDePublicacao } from '../../pauta/graph-de-publicacao';
import { GRAPH_DE_COMENTARIOS, type GraphDeComentarios } from '../../pauta/graph-de-comentarios';
import * as instagram from './instagram';

/*
 * A fiação dos clientes da Graph: o de publicação (MD6) e o de comentários
 * (MD9). Só declara os providers: as funções são as do conector, sem nada no
 * meio. Ver `pauta/graph-de-publicacao.ts` e `pauta/graph-de-comentarios.ts`.
 */
const graph: GraphDePublicacao = {
  limiteDePublicacao: instagram.limiteDePublicacao,
  criarContainer: instagram.criarContainer,
  statusDoContainer: instagram.statusDoContainer,
  publicarContainer: instagram.publicarContainer,
  permalinkDe: instagram.permalinkDe,
  midiasRecentes: instagram.midiasRecentes,
};

const comentarios: GraphDeComentarios = {
  comentariosDa: instagram.comentariosDa,
  midiasDesde: instagram.midiasDesde,
};

@Module({
  providers: [
    { provide: GRAPH_DE_PUBLICACAO, useValue: graph },
    { provide: GRAPH_DE_COMENTARIOS, useValue: comentarios },
  ],
  exports: [GRAPH_DE_PUBLICACAO, GRAPH_DE_COMENTARIOS],
})
export class GraphDePublicacaoModule {}
