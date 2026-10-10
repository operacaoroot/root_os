/** Metadados conferidos pelo integrador; esta consulta não relê a fonte externa. */
export interface CatalogoDeColecaoDto {
  itemId: string;
  capturaExternaAgora: false;
  movimentoDisponivel: false;
  selecaoVerificada: null | {
    id: string; colecaoId: string; geracao: string; verificadaEm: string;
    membershipDigest: string; atual: boolean;
    membro: { id: string; chave: string; itemId: string; versionId: string; versao: number; contentHash: string };
  };
  ultimaCaptura: null | { id: string; geracao: string; registradaEm: string; estado: 'classificado' | 'projetado' | 'falhou' };
}

/** Associação lida pela chave estrangeira da versão, sob acesso atual da pessoa. */
export interface CatalogoDaVersaoDto {
  notaId: string;
  versionId: string;
  associacao: { itemId: string; versao: number; contentHash: string; origem: 'context_item_version' };
  /** A seleção do catálogo pode apontar outra versão, mesmo quando ela é atual. */
  capturaCorrespondeAVersaoEscolhida: boolean;
  catalogo: CatalogoDeColecaoDto;
}
