import { Module } from '@nestjs/common';
import { GRAPH_DE_PUBLICACAO, type GraphDePublicacao } from '../../pauta/graph-de-publicacao';
import { GRAPH_DE_COMENTARIOS, type GraphDeComentarios } from '../../pauta/graph-de-comentarios';
import { GRAPH_DE_MENSAGENS, type GraphDeMensagens } from '../../pauta/graph-de-mensagens';
import * as instagram from './instagram';

/*
 * A fiação dos clientes da Graph: o de publicação (MD6), o de comentários
 * (MD9) e o de mensagens (MD11). Só declara os providers: as funções são as do
 * conector, sem nada no meio. Ver `pauta/graph-de-publicacao.ts`,
 * `pauta/graph-de-comentarios.ts` e `pauta/graph-de-mensagens.ts`.
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

const mensagens: GraphDeMensagens = {
  responderEmPrivado: instagram.responderEmPrivado,
};

@Module({
  providers: [
    { provide: GRAPH_DE_PUBLICACAO, useValue: graph },
    { provide: GRAPH_DE_COMENTARIOS, useValue: comentarios },
    { provide: GRAPH_DE_MENSAGENS, useValue: mensagens },
  ],
  exports: [GRAPH_DE_PUBLICACAO, GRAPH_DE_COMENTARIOS, GRAPH_DE_MENSAGENS],
})
export class GraphDePublicacaoModule {}
