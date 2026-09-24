import { Module } from '@nestjs/common';
import { GRAPH_DE_PUBLICACAO, type GraphDePublicacao } from '../../pauta/graph-de-publicacao';
import * as instagram from './instagram';

/*
 * A fiação do cliente de publicação da Graph (MD6). Só declara o provider: as
 * funções são as do conector, sem nada no meio. Ver `pauta/graph-de-publicacao.ts`.
 */
const graph: GraphDePublicacao = {
  limiteDePublicacao: instagram.limiteDePublicacao,
  criarContainer: instagram.criarContainer,
  statusDoContainer: instagram.statusDoContainer,
  publicarContainer: instagram.publicarContainer,
  permalinkDe: instagram.permalinkDe,
  midiasRecentes: instagram.midiasRecentes,
};

@Module({
  providers: [{ provide: GRAPH_DE_PUBLICACAO, useValue: graph }],
  exports: [GRAPH_DE_PUBLICACAO],
})
export class GraphDePublicacaoModule {}
