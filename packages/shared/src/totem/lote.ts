import { z } from 'zod';

import {
  TotemStatusRemessaSchema,
  type TotemNutriente,
  type TotemOrigemLote,
  type TotemOrigemReposicao,
  type TotemSelo,
  type TotemSituacaoValidade,
  type TotemStatusRemessa,
  type TotemUnidadePreco,
} from './comum.js';

/*
 * Schemas e tipos de lote, remessa, reposição e etiqueta (`/api/totem-lotes`,
 * `/api/totem-etiqueta`, `/p/[codigo]`). Arquivo da frente C
 * (docs/totem/CONTRATO.md, seção 9). Nome exportado começa com `Totem` ou
 * `TOTEM_`: ver o cabeçalho de `comum.ts`.
 *
 * Fabricação e validade são DIAS, não instantes: trafegam como `AAAA-MM-DD` e
 * o banco guarda a meia-noite UTC daquele dia, que é o que
 * `totemSituacaoDaValidade` compara.
 */

// --- Datas de lote ---

const FUSO_DAS_LOJAS = 'America/Sao_Paulo';

function diaExiste(v: string): boolean {
  const [a, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d));
  return t.getUTCFullYear() === a && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export const TotemLoteDiaSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a data no formato AAAA-MM-DD.')
  .refine(diaExiste, 'Essa data não existe no calendário.');

/** O dia `AAAA-MM-DD` de uma data guardada como meia-noite UTC. */
export function totemLoteDiaIso(data: Date): string {
  return data.toISOString().slice(0, 10);
}

/** Meia-noite UTC do dia `AAAA-MM-DD`: a forma em que o banco guarda validade e fabricação. */
export function totemLoteDataDoDia(dia: string): Date {
  return new Date(`${dia}T00:00:00.000Z`);
}

/**
 * O dia de hoje nas lojas (Brasília), como meia-noite UTC. Às 22h de Brasília
 * o UTC já virou o dia; sem isto, um lote que vence hoje apareceria vencido
 * duas horas antes da meia-noite.
 */
export function totemLoteHoje(agora: Date = new Date()): Date {
  const dia = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_DAS_LOJAS,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);
  return totemLoteDataDoDia(dia);
}

/** Dias entre hoje e a validade; negativo quando já venceu. */
export function totemLoteDiasParaVencer(validadeEm: Date | string, hoje: Date = totemLoteHoje()): number {
  const validade = typeof validadeEm === 'string' ? new Date(validadeEm) : validadeEm;
  const dia = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((dia(validade) - dia(hoje)) / 86_400_000);
}

/** `DD/MM/AAAA` de um dia de lote (validade, fabricação). */
export function totemLoteDataBR(dia: Date | string): string {
  const iso = typeof dia === 'string' ? dia.slice(0, 10) : totemLoteDiaIso(dia);
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

/**
 * O texto da reposição que o totem e a página da etiqueta mostram. No caso
 * presumido (a remessa saiu do CD e a loja não confirmou) a data é a do envio,
 * e o texto não afirma que o produto foi para a prateleira.
 */
export function totemTextoDaReposicao(repostoEm: Date | string, presumido: boolean): string {
  const data = typeof repostoEm === 'string' ? new Date(repostoEm) : repostoEm;
  const formato = (opcoes: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO_DAS_LOJAS, ...opcoes }).format(data);
  if (presumido) return `Lote recebido em ${formato({ day: '2-digit', month: '2-digit' })}`;
  return `Reposto em ${formato({ day: '2-digit', month: '2-digit', year: 'numeric' })}`;
}

// --- Entradas do painel (`/api/totem-lotes`) ---

export const TotemLoteUuidSchema = z.string().uuid('Identificador inválido.');

export const TotemLoteCodigoSchema = z
  .string()
  .trim()
  .min(1, 'Informe o código do lote.')
  .max(40, 'O código do lote tem no máximo 40 caracteres.');

const Observacao = z.string().trim().max(500, 'A observação tem no máximo 500 caracteres.').nullish();

export const TotemLoteNovoSchema = z.object({
  produtoId: TotemLoteUuidSchema,
  codigo: TotemLoteCodigoSchema,
  fabricadoEm: TotemLoteDiaSchema.nullish(),
  /** Sem ela, a API calcula pela fabricação e pela validade padrão do produto. */
  validadeEm: TotemLoteDiaSchema.nullish(),
  observacao: Observacao,
});
export type TotemLoteNovo = z.infer<typeof TotemLoteNovoSchema>;

export const TotemLoteEdicaoSchema = z
  .object({
    codigo: TotemLoteCodigoSchema.optional(),
    fabricadoEm: TotemLoteDiaSchema.nullable().optional(),
    validadeEm: TotemLoteDiaSchema.optional(),
    observacao: Observacao,
  })
  .refine((o) => Object.values(o).some((v) => v !== undefined), 'Nada para alterar.');
export type TotemLoteEdicao = z.infer<typeof TotemLoteEdicaoSchema>;

export const TotemLotesFiltroSchema = z.object({ produtoId: TotemLoteUuidSchema });

export const TOTEM_UNIDADES_REMESSA = ['kg', 'un'] as const;

export const TotemRemessaItemNovoSchema = z.object({
  loteId: TotemLoteUuidSchema,
  quantidade: z.number().positive('A quantidade tem de ser maior que zero.').max(1_000_000).nullish(),
  unidade: z.enum(TOTEM_UNIDADES_REMESSA).nullish(),
});

export const TotemRemessaNovaSchema = z.object({
  lojaId: TotemLoteUuidSchema,
  observacao: Observacao,
  itens: z
    .array(TotemRemessaItemNovoSchema)
    .min(1, 'A remessa precisa de pelo menos um lote.')
    .max(500, 'A remessa tem no máximo 500 itens.')
    .refine((itens) => new Set(itens.map((i) => i.loteId)).size === itens.length, 'O mesmo lote aparece duas vezes.'),
});
export type TotemRemessaNova = z.infer<typeof TotemRemessaNovaSchema>;

export const TotemRemessasFiltroSchema = z.object({
  lojaId: TotemLoteUuidSchema.optional(),
  status: TotemStatusRemessaSchema.optional(),
});

/**
 * Confirmar o recebimento não diz que o produto foi para a prateleira. Com
 * `registrarReposicao`, a confirmação grava também a reposição de cada produto
 * da remessa; sem ela, uma reposição antiga continua valendo como lote vigente
 * (ver a ordem da seção 4 do contrato).
 */
export const TotemRemessaRecebimentoSchema = z.object({
  registrarReposicao: z.boolean().optional(),
});
export type TotemRemessaRecebimento = z.infer<typeof TotemRemessaRecebimentoSchema>;

export const TotemLoteManualSchema = z.object({
  codigo: TotemLoteCodigoSchema,
  fabricadoEm: TotemLoteDiaSchema.nullish(),
  validadeEm: TotemLoteDiaSchema.nullish(),
});

export const TotemReposicaoNovaSchema = z
  .object({
    lojaId: TotemLoteUuidSchema,
    produtoId: TotemLoteUuidSchema,
    loteId: TotemLoteUuidSchema.optional(),
    /** Lote que a loja recebeu fora da remessa do CD. Nasce com origem `manual_loja`. */
    loteManual: TotemLoteManualSchema.optional(),
  })
  .refine((o) => Number(Boolean(o.loteId)) + Number(Boolean(o.loteManual)) === 1, {
    message: 'Escolha um lote da lista ou informe um lote manual, um dos dois.',
    path: ['loteId'],
  });
export type TotemReposicaoNova = z.infer<typeof TotemReposicaoNovaSchema>;

export const TotemLotePorLojaFiltroSchema = z.object({ lojaId: TotemLoteUuidSchema.optional() });

export const TOTEM_MAXIMO_ETIQUETAS_POR_VEZ = 200;

export const TotemEtiquetasNovasSchema = z.object({
  lojaId: TotemLoteUuidSchema,
  produtoId: TotemLoteUuidSchema,
  /** Sem lote, a etiqueta é da gôndola: o QR mostra o lote vigente da loja. */
  loteId: TotemLoteUuidSchema.nullish(),
  quantidade: z
    .number()
    .int()
    .min(1, 'Gere pelo menos uma etiqueta.')
    .max(TOTEM_MAXIMO_ETIQUETAS_POR_VEZ, `Gere no máximo ${TOTEM_MAXIMO_ETIQUETAS_POR_VEZ} etiquetas por vez.`),
});
export type TotemEtiquetasNovas = z.infer<typeof TotemEtiquetasNovasSchema>;

const ListaDeIds = z
  .string()
  .max(TOTEM_MAXIMO_ETIQUETAS_POR_VEZ * 37)
  .transform((s) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  )
  .pipe(z.array(TotemLoteUuidSchema).max(TOTEM_MAXIMO_ETIQUETAS_POR_VEZ));

export const TotemEtiquetasFiltroSchema = z.object({
  lojaId: TotemLoteUuidSchema.optional(),
  produtoId: TotemLoteUuidSchema.optional(),
  /** Ids separados por vírgula: a página de impressão pede exatamente as escolhidas. */
  ids: ListaDeIds.optional(),
  revogadas: z.enum(['0', '1']).optional(),
});

export const TotemEtiquetasImpressasSchema = z.object({
  ids: z.array(TotemLoteUuidSchema).min(1).max(TOTEM_MAXIMO_ETIQUETAS_POR_VEZ),
});

// --- Respostas do painel ---

export interface TotemLojaDoLote {
  id: string;
  codigo: string;
  nome: string;
  ativa: boolean;
}

export interface TotemProdutoDoLote {
  id: string;
  codigo: string;
  nome: string;
  validadeDiasPadrao: number | null;
  ativo: boolean;
}

export interface TotemLoteDoPainel {
  id: string;
  produtoId: string;
  codigo: string;
  /** `AAAA-MM-DD`. */
  fabricadoEm: string | null;
  /** `AAAA-MM-DD`. */
  validadeEm: string;
  origem: TotemOrigemLote;
  lojaOrigemId: string | null;
  observacao: string | null;
  situacao: TotemSituacaoValidade;
}

export interface TotemItemDaRemessa {
  id: string;
  produtoId: string;
  produtoCodigo: string;
  produtoNome: string;
  loteId: string;
  loteCodigo: string;
  validadeEm: string;
  quantidade: number | null;
  unidade: string | null;
}

export interface TotemRemessaDoPainel {
  id: string;
  lojaId: string;
  lojaNome: string;
  status: TotemStatusRemessa;
  enviadaEm: string;
  recebidaEm: string | null;
  observacao: string | null;
  itens: TotemItemDaRemessa[];
}

export interface TotemReposicaoDoPainel {
  id: string;
  lojaId: string;
  lojaNome: string;
  produtoId: string;
  produtoCodigo: string;
  produtoNome: string;
  loteId: string;
  loteCodigo: string;
  validadeEm: string;
  repostoEm: string;
  origem: TotemOrigemReposicao;
}

export interface TotemProdutoPendente {
  produtoId: string;
  codigo: string;
  nome: string;
}

export interface TotemLotePendente extends TotemProdutoPendente {
  loteId: string;
  loteCodigo: string;
  validadeEm: string;
  presumido: boolean;
  /** Negativo quando já venceu. */
  dias: number;
}

export interface TotemPendenciasDaLoja {
  lojaId: string;
  lojaCodigo: string;
  lojaNome: string;
  semLote: TotemProdutoPendente[];
  vencidos: TotemLotePendente[];
  vencendo: TotemLotePendente[];
}

export interface TotemEtiquetaDoPainel {
  id: string;
  codigo: string;
  lojaId: string;
  lojaNome: string;
  produtoId: string;
  produtoCodigo: string;
  produtoNome: string;
  loteId: string | null;
  loteCodigo: string | null;
  validadeEm: string | null;
  impressaEm: string | null;
  revogadaEm: string | null;
  criadoEm: string;
}

// --- Resposta pública da etiqueta (`GET /api/totem-etiqueta/:codigo`) ---

export interface TotemProdutoDaEtiqueta {
  codigo: string;
  nome: string;
  categoria: string | null;
  composicao: string | null;
  beneficios: string | null;
  alergenicos: string | null;
  porcaoG: number | null;
  porcaoDescricao: string | null;
  nutricional: TotemNutriente[];
  selos: TotemSelo[];
  imagemUrl: string | null;
  fonteNutricional: string | null;
  /** Só existe com `precoLigado`; com a chave desligada a chave nem aparece. */
  precoCentavos?: number | null;
  unidadePreco?: TotemUnidadePreco | null;
}

export interface TotemLoteDaEtiqueta {
  codigo: string;
  /** `AAAA-MM-DD`. */
  fabricadoEm: string | null;
  /** `AAAA-MM-DD`. */
  validadeEm: string;
  /** Instante ISO; `null` quando a etiqueta fixa um lote que não é o vigente da loja. */
  repostoEm: string | null;
  presumido: boolean;
  situacao: TotemSituacaoValidade;
}

export interface TotemFichaDaEtiqueta {
  codigo: string;
  loja: { nome: string; cidade: string | null };
  produto: TotemProdutoDaEtiqueta;
  lote: TotemLoteDaEtiqueta | null;
  config: {
    nomeExibicao: string;
    corPrimaria: string;
    corFundo: string;
    logoUrl: string | null;
    cadastroLigado: boolean;
  };
  campanha: { chamada: string; descricaoBeneficio: string | null } | null;
}
