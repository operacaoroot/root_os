import { createHash } from 'node:crypto';

import {
  TOTEM_TEMPO_OCIOSO_PADRAO_SEG,
  TotemNutrienteSchema,
  TotemSeloSchema,
  TotemUnidadePrecoSchema,
  totemSituacaoDaValidade,
  type TotemCatalogo,
  type TotemCatalogoConfig,
  type TotemCatalogoLote,
  type TotemCatalogoProduto,
  type TotemNutriente,
  type TotemSelo,
} from '@mktos/shared';

import type { TotemLoteVigente } from '../lote/lote-vigente';

/*
 * O RETRATO DO CATÁLOGO QUE O QUIOSQUE GUARDA (CONTRATO.md, seções 4 e 7).
 *
 * Função pura: o serviço lê o banco e entrega as linhas; aqui se decide o que
 * sai. É o único lugar que olha `precoLigado`, e o teste cobra que, com a
 * chave desligada, nenhum produto leva `precoCentavos` nem `unidadePreco`.
 *
 * `versao` é o hash do retrato sem `geradoEm`: dois pedidos sem mudança no
 * banco dão a mesma versão, e ela vira o ETag que poupa a loja de baixar o
 * catálogo inteiro a cada 5 minutos.
 */

export interface ProdutoDoCatalogo {
  id: string;
  codigo: string;
  nome: string;
  nomeBusca: string;
  categoria: string | null;
  composicao: string | null;
  beneficios: string | null;
  alergenicos: string | null;
  porcaoG: number | null;
  porcaoDescricao: string | null;
  nutricional: unknown;
  selos: readonly string[];
  imagemUrl: string | null;
  fonteNutricional: string | null;
  precoCentavos: number | null;
  unidadePreco: string | null;
  ativo: boolean;
}

export interface CampanhaDoCatalogo {
  nome: string;
  chamada: string;
  ativa: boolean;
  inicioEm: Date;
  fimEm: Date | null;
  /** Vazio = todas as lojas. */
  lojaIds: readonly string[];
}

export interface DadosDoCatalogo {
  loja: { id: string; nome: string; cidade: string | null };
  dispositivo: { id: string; nome: string };
  produtos: readonly ProdutoDoCatalogo[];
  lotes: ReadonlyMap<string, TotemLoteVigente>;
  campanhas: readonly CampanhaDoCatalogo[];
}

export interface ConfigDoCatalogo {
  nomeExibicao: string;
  corPrimaria: string | null;
  corFundo: string | null;
  logoUrl: string | null;
  mensagemBoasVindas: string | null;
  tempoOciosoSeg: number;
  precoLigado: boolean;
  cadastroLigado: boolean;
}

/**
 * Empresa sem `TotemConfig` ainda (o painel cria na primeira edição). Cadastro
 * desligado porque sem configuração não há controlador para a política.
 */
export const CONFIG_PADRAO_DO_CATALOGO: ConfigDoCatalogo = {
  nomeExibicao: 'Totem de consulta',
  corPrimaria: null,
  corFundo: null,
  logoUrl: null,
  mensagemBoasVindas: null,
  tempoOciosoSeg: TOTEM_TEMPO_OCIOSO_PADRAO_SEG,
  precoLigado: false,
  cadastroLigado: false,
};

const COR = /^#[0-9A-Fa-f]{6}$/;
const TEMPO_OCIOSO_MINIMO_SEG = 15;

function configPublica(c: ConfigDoCatalogo): TotemCatalogoConfig {
  const tempo = Number.isInteger(c.tempoOciosoSeg) ? c.tempoOciosoSeg : TOTEM_TEMPO_OCIOSO_PADRAO_SEG;
  return {
    nomeExibicao: c.nomeExibicao,
    corPrimaria: c.corPrimaria && COR.test(c.corPrimaria) ? c.corPrimaria : null,
    corFundo: c.corFundo && COR.test(c.corFundo) ? c.corFundo : null,
    logoUrl: c.logoUrl,
    mensagemBoasVindas: c.mensagemBoasVindas,
    tempoOciosoSeg: Math.max(TEMPO_OCIOSO_MINIMO_SEG, tempo),
    precoLigado: c.precoLigado,
    cadastroLigado: c.cadastroLigado,
  };
}

/** A ficha gravada passa pelo schema item a item; o que não passa fica de fora. */
function nutricionalValido(bruto: unknown): TotemNutriente[] {
  if (!Array.isArray(bruto)) return [];
  const itens: TotemNutriente[] = [];
  for (const item of bruto) {
    const r = TotemNutrienteSchema.safeParse(item);
    if (r.success) itens.push(r.data);
  }
  return itens;
}

function selosValidos(selos: readonly string[]): TotemSelo[] {
  const validos: TotemSelo[] = [];
  for (const s of selos) {
    const r = TotemSeloSchema.safeParse(s);
    if (r.success && !validos.includes(r.data)) validos.push(r.data);
  }
  return validos;
}

function loteDoCatalogo(lote: TotemLoteVigente | undefined, agora: Date): TotemCatalogoLote | null {
  if (!lote) return null;
  return {
    codigo: lote.codigo,
    fabricadoEm: lote.fabricadoEm ? lote.fabricadoEm.toISOString() : null,
    validadeEm: lote.validadeEm.toISOString(),
    repostoEm: lote.repostoEm.toISOString(),
    presumido: lote.presumido,
    situacao: totemSituacaoDaValidade(lote.validadeEm, agora),
  };
}

function produtoDoCatalogo(
  p: ProdutoDoCatalogo,
  lote: TotemLoteVigente | undefined,
  precoLigado: boolean,
  agora: Date,
): TotemCatalogoProduto {
  const produto: TotemCatalogoProduto = {
    id: p.id,
    codigo: p.codigo,
    nome: p.nome,
    nomeBusca: p.nomeBusca,
    categoria: p.categoria,
    composicao: p.composicao,
    beneficios: p.beneficios,
    alergenicos: p.alergenicos,
    porcaoG: p.porcaoG != null && Number.isFinite(p.porcaoG) && p.porcaoG >= 0 ? p.porcaoG : null,
    porcaoDescricao: p.porcaoDescricao,
    nutricional: nutricionalValido(p.nutricional),
    selos: selosValidos(p.selos),
    imagemUrl: p.imagemUrl,
    fonteNutricional: p.fonteNutricional,
    lote: loteDoCatalogo(lote, agora),
  };
  if (precoLigado) {
    const unidade = TotemUnidadePrecoSchema.safeParse(p.unidadePreco);
    if (p.precoCentavos != null && Number.isInteger(p.precoCentavos) && p.precoCentavos >= 0 && unidade.success) {
      produto.precoCentavos = p.precoCentavos;
      produto.unidadePreco = unidade.data;
    }
  }
  return produto;
}

/**
 * A campanha que a loja mostra agora: ativa, já começada, sem fim ou com fim
 * no futuro, e com a loja na lista (lista vazia vale para todas). Havendo
 * mais de uma, a que começou por último. Sem cadastro ligado não há onde
 * resgatar o cupom, então a chamada não aparece.
 */
export function campanhaDaLoja(
  campanhas: readonly CampanhaDoCatalogo[],
  lojaId: string,
  cadastroLigado: boolean,
  agora: Date,
): { nome: string; chamada: string } | null {
  if (!cadastroLigado) return null;
  const vigentes = campanhas
    .filter(
      (c) =>
        c.ativa &&
        c.inicioEm.getTime() <= agora.getTime() &&
        (c.fimEm === null || c.fimEm.getTime() > agora.getTime()) &&
        (c.lojaIds.length === 0 || c.lojaIds.includes(lojaId)),
    )
    .sort((a, b) => b.inicioEm.getTime() - a.inicioEm.getTime());
  const c = vigentes[0];
  return c ? { nome: c.nome, chamada: c.chamada } : null;
}

export function montarCatalogo(
  dados: DadosDoCatalogo,
  config: ConfigDoCatalogo | null,
  agora: Date,
): TotemCatalogo {
  const cfg = configPublica(config ?? CONFIG_PADRAO_DO_CATALOGO);
  const produtos = dados.produtos
    .filter((p) => p.ativo)
    .map((p) => produtoDoCatalogo(p, dados.lotes.get(p.id), cfg.precoLigado, agora))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.codigo.localeCompare(b.codigo));

  const corpo = {
    loja: { id: dados.loja.id, nome: dados.loja.nome, cidade: dados.loja.cidade },
    dispositivo: { id: dados.dispositivo.id, nome: dados.dispositivo.nome },
    config: cfg,
    campanha: campanhaDaLoja(dados.campanhas, dados.loja.id, cfg.cadastroLigado, agora),
    produtos,
  };
  const versao = createHash('sha256').update(JSON.stringify(corpo), 'utf8').digest('hex').slice(0, 32);
  return { versao, geradoEm: agora.toISOString(), ...corpo };
}

/**
 * `If-None-Match` casa com a versão? Aceita a lista separada por vírgula, o
 * prefixo fraco `W/` e o `*`, como o RFC 9110 (seção 13.1.2).
 */
export function etagCasa(ifNoneMatch: string | undefined, versao: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch
    .split(',')
    .map((v) => v.trim())
    .some((v) => v === '*' || v.replace(/^W\//, '').replace(/^"|"$/g, '') === versao);
}
