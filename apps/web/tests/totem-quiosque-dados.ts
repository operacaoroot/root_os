import { normalizarBusca, type TotemCatalogo, type TotemCatalogoProduto } from '@mktos/shared';

/* Produtos e catálogo de exemplo para as suítes do quiosque. */

let sequencia = 0;

export function produtoDeExemplo(campos: Partial<TotemCatalogoProduto> & { nome: string }): TotemCatalogoProduto {
  sequencia += 1;
  return {
    id: `00000000-0000-4000-8000-${String(sequencia).padStart(12, '0')}`,
    codigo: `P${sequencia}`,
    nomeBusca: normalizarBusca(campos.nome),
    categoria: null,
    composicao: null,
    beneficios: null,
    alergenicos: null,
    porcaoG: null,
    porcaoDescricao: null,
    nutricional: [],
    selos: [],
    imagemUrl: null,
    fonteNutricional: null,
    lote: null,
    ...campos,
  };
}

export function catalogoDeExemplo(campos: Partial<TotemCatalogo> = {}): TotemCatalogo {
  return {
    versao: 'v1',
    geradoEm: '2026-10-11T12:00:00.000Z',
    loja: { id: 'loja-1', nome: 'Loja Centro', cidade: 'Vitória' },
    dispositivo: { id: 'aparelho-1', nome: 'Totem da entrada' },
    config: {
      nomeExibicao: 'Senhor aGranel',
      corPrimaria: null,
      corFundo: null,
      logoUrl: null,
      mensagemBoasVindas: null,
      tempoOciosoSeg: 60,
      precoLigado: false,
      cadastroLigado: false,
    },
    campanha: null,
    produtos: [produtoDeExemplo({ nome: 'Castanha-do-pará', categoria: 'Castanhas' })],
    ...campos,
  };
}
