import { z } from 'zod';

import {
  TOTEM_TERMO_MAXIMO,
  TotemCodigoAtivacaoSchema,
  TotemNutrienteSchema,
  TotemSeloSchema,
  TotemTipoEventoSchema,
  TotemUnidadePrecoSchema,
} from './comum.js';

/*
 * Schemas e tipos das rotas do quiosque (`/api/totem-publico`, `/totem`):
 * ativação, catálogo, eventos em lote e batimento. Arquivo da frente B
 * (docs/totem/CONTRATO.md, seção 9). Nome exportado começa com `Totem` ou
 * `TOTEM_`: ver o cabeçalho de `comum.ts`.
 */

// --- Ativação ---

export const TotemAtivarSchema = z.object({ codigo: TotemCodigoAtivacaoSchema });
export type TotemAtivarEntrada = z.input<typeof TotemAtivarSchema>;

export const TotemAtivacaoSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  dispositivo: z.object({ id: z.string().min(1), nome: z.string() }),
  loja: z.object({ id: z.string().min(1), nome: z.string() }),
});
export type TotemAtivacao = z.infer<typeof TotemAtivacaoSchema>;

// --- Catálogo ---

/*
 * O catálogo é o retrato que o aparelho guarda em IndexedDB e usa sem rede. O
 * schema vale dos dois lados: a API monta o objeto neste formato e o quiosque
 * confere a resposta antes de trocar o que tem guardado, para uma resposta
 * truncada nunca apagar um catálogo bom.
 *
 * Datas saem em ISO. `situacao` vem calculada no dia em que o retrato foi
 * gerado; o aparelho recalcula com `totemSituacaoDaValidade` no dia em que
 * mostra, porque pode passar dias sem rede.
 */

const dataIso = z.string().datetime({ offset: true });

export const TotemCatalogoLoteSchema = z.object({
  codigo: z.string(),
  fabricadoEm: dataIso.nullable(),
  validadeEm: dataIso,
  repostoEm: dataIso,
  /** `true` quando a loja ainda não confirmou a remessa: "lote recebido em DD/MM". */
  presumido: z.boolean(),
  situacao: z.enum(['vencido', 'atencao', 'ok']),
});
export type TotemCatalogoLote = z.infer<typeof TotemCatalogoLoteSchema>;

export const TotemCatalogoProdutoSchema = z.object({
  id: z.string().min(1),
  codigo: z.string(),
  nome: z.string(),
  nomeBusca: z.string(),
  categoria: z.string().nullable(),
  composicao: z.string().nullable(),
  beneficios: z.string().nullable(),
  alergenicos: z.string().nullable(),
  porcaoG: z.number().nonnegative().nullable(),
  porcaoDescricao: z.string().nullable(),
  nutricional: z.array(TotemNutrienteSchema),
  selos: z.array(TotemSeloSchema),
  imagemUrl: z.string().nullable(),
  fonteNutricional: z.string().nullable(),
  lote: TotemCatalogoLoteSchema.nullable(),
  /** Só existem com `precoLigado=true` e preço cadastrado (CONTRATO.md, seção 4). */
  precoCentavos: z.number().int().nonnegative().optional(),
  unidadePreco: TotemUnidadePrecoSchema.optional(),
});
export type TotemCatalogoProduto = z.infer<typeof TotemCatalogoProdutoSchema>;

/** O pedaço público de `TotemConfig`: nada do controlador nem do encarregado. */
export const TotemCatalogoConfigSchema = z.object({
  nomeExibicao: z.string(),
  /** `null` quando a cor gravada não é `#RRGGBB`; o quiosque usa a da marca. */
  corPrimaria: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable(),
  corFundo: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable(),
  logoUrl: z.string().nullable(),
  mensagemBoasVindas: z.string().nullable(),
  tempoOciosoSeg: z.number().int().positive(),
  precoLigado: z.boolean(),
  cadastroLigado: z.boolean(),
});
export type TotemCatalogoConfig = z.infer<typeof TotemCatalogoConfigSchema>;

export const TotemCatalogoSchema = z.object({
  /** Hash do conteúdo; é também o ETag da resposta. */
  versao: z.string().min(1).max(64),
  geradoEm: dataIso,
  loja: z.object({ id: z.string().min(1), nome: z.string(), cidade: z.string().nullable() }),
  dispositivo: z.object({ id: z.string().min(1), nome: z.string() }),
  config: TotemCatalogoConfigSchema,
  campanha: z.object({ nome: z.string(), chamada: z.string() }).nullable(),
  produtos: z.array(TotemCatalogoProdutoSchema),
});
export type TotemCatalogo = z.infer<typeof TotemCatalogoSchema>;

// --- Eventos ---

export const TOTEM_EVENTOS_POR_LOTE = 200;

/**
 * Dez dígitos ou mais no termo é CPF (11), celular ou fixo com DDD (10 ou 11)
 * digitado no campo errado; contar só os dígitos pega "123.456.789-09" e
 * "(11) 98765-4321" do mesmo jeito. O padrão de 8 ou 9 dígitos com ou sem
 * separador pega o telefone sem DDD.
 */
function pareceDadoPessoal(termo: string): boolean {
  if (termo.replace(/\D/g, '').length >= 10) return true;
  return /\d{4,5}[\s.-]?\d{4}/.test(termo);
}

/**
 * O termo como pode ser guardado: espaços colapsados, cortado em 80
 * caracteres, e `null` quando parece CPF ou telefone. A API aplica no schema e
 * o quiosque aplica antes de pôr o evento na fila local, para o dado nem
 * chegar a ficar no aparelho.
 */
export function totemLimparTermo(termo: string | null | undefined): string | null {
  if (termo == null) return null;
  const limpo = termo.replace(/\s+/g, ' ').trim();
  if (!limpo || pareceDadoPessoal(limpo)) return null;
  return limpo.slice(0, TOTEM_TERMO_MAXIMO).trim();
}

export const TotemEventoQuiosqueSchema = z.object({
  /** Gerado no aparelho: reenviar o mesmo lote não duplica nada. */
  id: z.string().uuid(),
  tipo: TotemTipoEventoSchema,
  produtoId: z.string().uuid().nullish(),
  termo: z.string().max(500).nullish().transform(totemLimparTermo),
  ocorridoEm: dataIso,
});
export type TotemEventoQuiosque = z.output<typeof TotemEventoQuiosqueSchema>;
export type TotemEventoQuiosqueEntrada = z.input<typeof TotemEventoQuiosqueSchema>;

export const TotemEventosQuiosqueSchema = z.object({
  eventos: z.array(TotemEventoQuiosqueSchema).min(1).max(TOTEM_EVENTOS_POR_LOTE),
});
export type TotemEventosQuiosqueEntrada = z.input<typeof TotemEventosQuiosqueSchema>;

// --- Batimento ---

export const TotemBatimentoSchema = z.object({
  versaoApp: z.string().trim().min(1).max(40),
  catalogoVersao: z.string().trim().min(1).max(64).nullish(),
});
export type TotemBatimentoEntrada = z.input<typeof TotemBatimentoSchema>;
