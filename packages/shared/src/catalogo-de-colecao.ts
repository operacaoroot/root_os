/** Suplemento nominal04b; GET só lê o catálogo persistido, sem captura/FS/Git/embeddings. */
export interface CatalogoDeColecaoDto {
  escopo: { orgId: string; actorId: string };
  itemId: string;
  capturaExternaAgora: false;
  /** Elegibilidade persistida local; não substitui autoridade ou prévia física. */
  movimentoDisponivel: boolean;
  autoridadeDoMovimento: { registrarIntencao: boolean; verificadaEm: string };
  /** Bloqueio genérico da coleção; não revela IDs/caminhos/ator/quantidade de outra fonte. */
  colecaoBloqueadaPorMovimento: boolean;
  /** Detalhe somente de intenção ligada a ESTE item autorizado. */
  movimentoPendente: null | {
    intentId: string; itemId: string; colecaoId: string; revision: 1;
    iniciadaPorAtorAtual: boolean;
    /** IDs/marca para recuperar apenas a intenção do ator atual; outro ator recebe null. */
    requestId: string | null; intentMark: string | null; criadaEm: string;
  };
  /** Versão vigente por FK real; separada da versão escolhida no histórico. */
  atual: {
    versionId: string; versao: number; contentHash: string; chave: string;
    sourceType: string; sourceRef: string | null; arquivada: boolean;
  };
  selecaoVerificada: null | {
    id: string; colecaoId: string; geracao: string; verificadaEm: string;
    membershipDigest: string; atual: boolean;
    /** Somente JSON da marca persistida validada; não é uma leitura nova do repositório. */
    marcaPersistida: null | { repositorioId: string; head: string; indiceHash: string; indiceModificadoEm: number };
    membro: {
      id: string; chave: string; itemId: string; versionId: string; versao: number; contentHash: string;
      provaPersistida: null | { caminhoUtf8: string; caminhoBytesHex: string; blobGit: string; hashArquivo: string; metadataHash: string };
    };
  };
  ultimaCaptura: null | { id: string; geracao: string; registradaEm: string; estado: 'classificado' | 'projetado' | 'falhou' };
}

/** Associação da versão pelo FK da mesma empresa; nenhuma equivalência por hash. */
export interface CatalogoDaVersaoDto {
  notaId: string;
  versionId: string;
  associacao: { itemId: string; versao: number; contentHash: string; origem: 'context_item_version' };
  capturaCorrespondeAVersaoEscolhida: boolean;
  catalogo: CatalogoDeColecaoDto;
}
