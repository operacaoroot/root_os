import { Prisma } from '@prisma/client';
import {
  TOTEM_GESTAO_AVISO_PRECO_DESLIGADO,
  TOTEM_GESTAO_MINUTOS_ONLINE,
  TOTEM_MINUTOS_VALIDADE_ATIVACAO,
  TOTEM_POLITICA_VERSAO,
  TOTEM_SELOS,
  TOTEM_TAMANHO_CODIGO_ATIVACAO,
  TOTEM_TEMPO_OCIOSO_PADRAO_SEG,
  TotemNutricionalSchema,
  normalizarBusca,
  totemNormalizarCodigo,
  type TotemGestaoAvisoDePreco,
  type TotemGestaoConfig,
  type TotemGestaoEstadoDispositivo,
  type TotemGestaoProduto,
  type TotemGestaoProdutoCriar,
  type TotemSelo,
  type TotemUnidadePreco,
} from '@mktos/shared';

import { gerarCodigo, hashToken } from '../comum/segredos';

/*
 * As regras do painel que não dependem de banco nem de Nest: estado do totem,
 * código de ativação, dados do produto, aviso de preço e o dia em São Paulo.
 * Os testes chamam daqui direto.
 */

// --- Dia em São Paulo ---

const FORMATO_DIA_SP = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const UM_DIA_MS = 86_400_000;

/** O dia civil de São Paulo em que o instante cai, `AAAA-MM-DD`. */
export function totemGestaoDiaEmSaoPaulo(instante: Date): string {
  return FORMATO_DIA_SP.format(instante);
}

/**
 * Meia-noite daquele dia em São Paulo. O Brasil não tem horário de verão desde
 * 2019, então o deslocamento é sempre -03:00.
 */
export function totemGestaoInicioDoDia(dia: string): Date {
  return new Date(`${dia}T00:00:00-03:00`);
}

export function totemGestaoSomarDias(instante: Date, dias: number): Date {
  return new Date(instante.getTime() + dias * UM_DIA_MS);
}

/**
 * O "hoje" que `totemSituacaoDaValidade` espera: ela compara pelo dia UTC, e o
 * dia que vale para a loja é o de São Paulo. Às 22h de lá já é amanhã em UTC, e
 * um lote que vence hoje sairia como vencido.
 */
export function totemGestaoHojeParaValidade(agora: Date): Date {
  return new Date(`${totemGestaoDiaEmSaoPaulo(agora)}T00:00:00Z`);
}

// --- Dispositivo ---

export interface TotemGestaoDispositivoParaEstado {
  ativadoEm: Date | null;
  revogadoEm: Date | null;
  vistoEm: Date | null;
  codigoAtivacaoHash: string | null;
  ativacaoExpiraEm: Date | null;
}

export function totemGestaoEstadoDoDispositivo(
  d: TotemGestaoDispositivoParaEstado,
  agora: Date,
): TotemGestaoEstadoDispositivo {
  if (d.revogadoEm) return 'revogado';
  if (d.ativadoEm) {
    const recente = d.vistoEm && agora.getTime() - d.vistoEm.getTime() < TOTEM_GESTAO_MINUTOS_ONLINE * 60_000;
    return recente ? 'online' : 'offline';
  }
  if (d.codigoAtivacaoHash && d.ativacaoExpiraEm && d.ativacaoExpiraEm.getTime() > agora.getTime()) {
    return 'aguardando_ativacao';
  }
  return 'codigo_expirado';
}

/** Código pendente e ainda válido; um código vencido não interessa a ninguém. */
export function totemGestaoExpiracaoPendente(d: TotemGestaoDispositivoParaEstado, agora: Date): Date | null {
  if (d.revogadoEm || !d.codigoAtivacaoHash || !d.ativacaoExpiraEm) return null;
  return d.ativacaoExpiraEm.getTime() > agora.getTime() ? d.ativacaoExpiraEm : null;
}

export interface TotemGestaoNovoCodigo {
  /** Vai para a tela uma única vez. */
  codigo: string;
  /** Vai para `codigoAtivacaoHash`. */
  hash: string;
  expiraEm: Date;
}

/**
 * O hash é do código já normalizado, que é o mesmo que a ativação calcula a
 * partir do que a pessoa digita no totem.
 */
export function totemGestaoNovoCodigoDeAtivacao(agora: Date): TotemGestaoNovoCodigo {
  const codigo = gerarCodigo(TOTEM_TAMANHO_CODIGO_ATIVACAO);
  return {
    codigo,
    hash: hashToken(totemNormalizarCodigo(codigo)),
    expiraEm: new Date(agora.getTime() + TOTEM_MINUTOS_VALIDADE_ATIVACAO * 60_000),
  };
}

// --- Produto ---

export function totemGestaoAvisoDePreco(precoLigado: boolean): TotemGestaoAvisoDePreco {
  return { precoLigado, avisoPreco: precoLigado ? null : TOTEM_GESTAO_AVISO_PRECO_DESLIGADO };
}

/** Preço sem unidade não se lê no totem ("R$ 12,90" de quê?). */
export function totemGestaoProblemaDePreco(
  precoCentavos: number | null | undefined,
  unidadePreco: string | null | undefined,
): string | null {
  if (precoCentavos != null && !unidadePreco) return 'Informe a unidade do preço (kg, 100 g ou unidade).';
  return null;
}

/** Os campos de `TotemProduto` que o painel grava, com valor simples. */
export interface TotemGestaoDadosDoProduto {
  codigo?: string;
  codigoDirector?: string | null;
  nome?: string;
  nomeBusca?: string;
  categoria?: string | null;
  composicao?: string | null;
  beneficios?: string | null;
  sugestoes?: string | null;
  alergenicos?: string | null;
  porcaoG?: number | null;
  porcaoDescricao?: string | null;
  nutricional?: Prisma.InputJsonValue;
  selos?: string[];
  validadeDiasPadrao?: number | null;
  precoCentavos?: number | null;
  unidadePreco?: string | null;
  imagemUrl?: string | null;
  fonteNutricional?: string | null;
  ativo?: boolean;
}

/**
 * Converte a entrada validada em dados do Prisma, só com os campos presentes.
 * Toda vez que o nome muda, `nomeBusca` muda junto: é por ele que o painel e o
 * totem procuram.
 */
export function totemGestaoDadosDoProduto(entrada: Partial<TotemGestaoProdutoCriar>): TotemGestaoDadosDoProduto {
  const dados: TotemGestaoDadosDoProduto = {};
  const copiar = [
    'codigo',
    'codigoDirector',
    'categoria',
    'composicao',
    'beneficios',
    'sugestoes',
    'alergenicos',
    'porcaoG',
    'porcaoDescricao',
    'validadeDiasPadrao',
    'precoCentavos',
    'unidadePreco',
    'imagemUrl',
    'fonteNutricional',
    'ativo',
  ] as const;
  for (const campo of copiar) {
    if (entrada[campo] !== undefined) (dados as Record<string, unknown>)[campo] = entrada[campo];
  }
  if (entrada.nome !== undefined) {
    dados.nome = entrada.nome;
    dados.nomeBusca = normalizarBusca(entrada.nome);
  }
  if (entrada.nutricional !== undefined) dados.nutricional = entrada.nutricional;
  if (entrada.selos !== undefined) dados.selos = entrada.selos;
  return dados;
}

export interface TotemGestaoProdutoDoBanco {
  id: string;
  codigo: string;
  codigoDirector: string | null;
  nome: string;
  nomeBusca: string;
  categoria: string | null;
  composicao: string | null;
  beneficios: string | null;
  sugestoes: string | null;
  alergenicos: string | null;
  porcaoG: Prisma.Decimal | number | null;
  porcaoDescricao: string | null;
  nutricional: Prisma.JsonValue;
  selos: string[];
  validadeDiasPadrao: number | null;
  precoCentavos: number | null;
  unidadePreco: string | null;
  imagemUrl: string | null;
  ativo: boolean;
  exemplo: boolean;
  fonteNutricional: string | null;
  atualizadoEm: Date;
}

const SELOS = new Set<string>(TOTEM_SELOS);
const UNIDADES = new Set<string>(['kg', '100g', 'un']);

export function totemGestaoProdutoParaTela(p: TotemGestaoProdutoDoBanco): TotemGestaoProduto {
  const ficha = TotemNutricionalSchema.safeParse(p.nutricional);
  return {
    id: p.id,
    codigo: p.codigo,
    codigoDirector: p.codigoDirector,
    nome: p.nome,
    nomeBusca: p.nomeBusca,
    categoria: p.categoria,
    composicao: p.composicao,
    beneficios: p.beneficios,
    sugestoes: p.sugestoes,
    alergenicos: p.alergenicos,
    porcaoG: p.porcaoG == null ? null : Number(p.porcaoG),
    porcaoDescricao: p.porcaoDescricao,
    nutricional: ficha.success ? ficha.data : [],
    selos: p.selos.filter((s): s is TotemSelo => SELOS.has(s)),
    validadeDiasPadrao: p.validadeDiasPadrao,
    precoCentavos: p.precoCentavos,
    unidadePreco: p.unidadePreco && UNIDADES.has(p.unidadePreco) ? (p.unidadePreco as TotemUnidadePreco) : null,
    imagemUrl: p.imagemUrl,
    ativo: p.ativo,
    exemplo: p.exemplo,
    fonteNutricional: p.fonteNutricional,
    atualizadoEm: p.atualizadoEm.toISOString(),
  };
}

/**
 * Cada palavra do que foi digitado precisa aparecer no `nomeBusca`, em qualquer
 * ordem: "para castanha" acha "castanha do para".
 */
export function totemGestaoPalavrasDaBusca(busca: string | undefined): string[] {
  if (!busca) return [];
  return [...new Set(normalizarBusca(busca).split(' ').filter(Boolean))];
}

// --- Configuração ---

/** O que a tela mostra antes de alguém salvar a configuração pela primeira vez. */
export function totemGestaoConfigPadrao(): TotemGestaoConfig {
  return {
    existe: false,
    nomeExibicao: '',
    corPrimaria: '#28371D',
    corFundo: '#F5F3EC',
    logoUrl: null,
    precoLigado: false,
    // Sem controlador definido o cadastro não tem a quem atribuir o dado pessoal.
    cadastroLigado: false,
    tempoOciosoSeg: TOTEM_TEMPO_OCIOSO_PADRAO_SEG,
    controladorNome: '',
    controladorDocumento: null,
    controladorEndereco: null,
    encarregadoNome: null,
    encarregadoContato: null,
    politicaVersao: TOTEM_POLITICA_VERSAO,
    mensagemBoasVindas: null,
    alergenicosPadrao: null,
    atualizadoEm: null,
  };
}

// --- Erros do Prisma ---

/** Violação de unicidade (`P2002`), sem depender da classe do erro. */
export function totemGestaoEhDuplicado(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === 'P2002';
}
