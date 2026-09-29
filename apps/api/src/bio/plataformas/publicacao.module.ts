import { Module } from '@nestjs/common';
import { GRAPH_DE_PUBLICACAO, type GraphDePublicacao } from '../../pauta/graph-de-publicacao';
import { GRAPH_DE_COMENTARIOS, type GraphDeComentarios } from '../../pauta/graph-de-comentarios';
import { GRAPH_DE_MENSAGENS, type GraphDeMensagens } from '../../pauta/graph-de-mensagens';
import { GRAPH_DE_INSIGHTS, type GraphDeInsights } from '../../pauta/graph-de-insights';
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

// MK5: os números da conta e de cada post, para o snapshot mensal.
const insights: GraphDeInsights = {
  seguidores: instagram.seguidores,
  numerosDo: instagram.insightsDaMidia,
};

@Module({
  providers: [
    { provide: GRAPH_DE_PUBLICACAO, useValue: graph },
    { provide: GRAPH_DE_COMENTARIOS, useValue: comentarios },
    { provide: GRAPH_DE_MENSAGENS, useValue: mensagens },
    { provide: GRAPH_DE_INSIGHTS, useValue: insights },
  ],
  exports: [GRAPH_DE_PUBLICACAO, GRAPH_DE_COMENTARIOS, GRAPH_DE_MENSAGENS, GRAPH_DE_INSIGHTS],
})
export class GraphDePublicacaoModule {}
