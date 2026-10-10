import { z } from 'zod';
import { ehValorMonetarioCanonico } from './valor-monetario.js';

const id = z.string().min(1).max(200);
const uuid = z.string().uuid().transform(v => v.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const iso = z.string().datetime({ offset: true }).transform(v => new Date(v).toISOString());
const nome = z.string().max(4000);
const tipo = z.enum(['entrada', 'saida']);
const alcada = z.enum(['operador', 'responsavel', 'titular']).nullable();
const dinheiro = z.string().max(40).refine(v => ehValorMonetarioCanonico(v) &&
  !v.includes(' -') && !/ 0\.00$/.test(v), 'Valor monetário positivo canônico requerido.');
const dimensao = z.object({ id, nome, ativo: z.boolean() }).strict();
export const FinanceiroGeracaoCondicoesSchema = z.object({
  descricao: nome, tipo, valorCanonico: dinheiro, currency: z.string().regex(/^[A-Z]{3}$/),
  competencia: iso, vencimento: iso,
  conta: z.object({ id, nome, currency: z.string().regex(/^[A-Z]{3}$/), provider: z.literal('manual'), ativa: z.boolean() }).strict(),
  contrato: z.object({ id, descricao: nome, tipo, valorCanonico: dinheiro,
    diaVencimento: z.number().int().min(1).max(31),
    periodicidade: z.enum(['mensal', 'bimestral', 'trimestral', 'semestral', 'anual']),
    dataInicio: iso, dataFim: iso.nullable(), status: z.literal('ativo'),
  }).strict(),
  contraparte: z.object({ id, razaoSocial: nome, ativo: z.boolean() }).strict(),
  classificacao: z.object({ id, codigo: nome, nome, ativo: z.boolean(), permiteLancamento: z.boolean() }).strict(),
  projetoFinanceiro: dimensao.nullable(), departamento: dimensao.nullable(), temRateio: z.literal(false),
}).strict();
export type FinanceiroGeracaoCondicoes = z.infer<typeof FinanceiroGeracaoCondicoesSchema>;
export const FinanceiroGeracaoEntradaSchema = z.object({ contractId: id, vencimento: iso }).strict();
export type FinanceiroGeracaoEntrada = z.infer<typeof FinanceiroGeracaoEntradaSchema>;
export const FinanceiroGeracaoMarcaSchema = z.object({ updatedAt: iso, contentHash: hash }).strict();
export const FinanceiroGeracaoPedidoSchema = z.object({
  contractId: id, vencimento: iso, requestId: uuid, marcaOrigem: FinanceiroGeracaoMarcaSchema,
}).strict();
export type FinanceiroGeracaoPedido = z.infer<typeof FinanceiroGeracaoPedidoSchema>;
export const FinanceiroGeracaoPreviaSchema = z.object({
  modo: z.literal('exercicio'), orgId: id, actorId: id, contractId: id, vencimento: iso,
  transactionIdPrevisto: uuid, proximoVencimento: iso, marcaOrigem: FinanceiroGeracaoMarcaSchema,
  condicoes: FinanceiroGeracaoCondicoesSchema,
  alcadaDaDecisao: z.literal('responsavel'), alcadaNoPedido: alcada,
  status: z.literal('previsto'), approvalStatus: z.literal('aguardando'),
}).strict();
export type FinanceiroGeracaoPrevia = z.infer<typeof FinanceiroGeracaoPreviaSchema>;
export const FinanceiroGeracaoRespostaSchema = z.object({
  modo: z.literal('exercicio'), orgId: id, actorId: id, requestId: uuid, obligationId: uuid,
  contractId: id, vencimento: iso, transactionId: uuid, versionId: uuid, contentHash: hash,
  marcaOrigem: FinanceiroGeracaoMarcaSchema, proximoVencimento: iso, registradoEm: iso,
  condicoes: FinanceiroGeracaoCondicoesSchema,
  alcadaDaDecisao: z.literal('responsavel'), alcadaNoPedido: alcada,
  resultado: z.object({ status: z.literal('previsto'), approvalStatus: z.literal('aguardando'),
    paidAt: z.null(), reconciledAt: z.null(), pagamentoExecutado: z.literal(false),
    cobrancaExecutada: z.literal(false), conciliacaoExecutada: z.literal(false),
  }).strict(), replayed: z.boolean(),
}).strict();
export type FinanceiroGeracaoResposta = z.infer<typeof FinanceiroGeracaoRespostaSchema>;

export const FinanceiroGeracaoRecuperacaoSchema = z.discriminatedUnion('estado', [
  z.object({ estado: z.literal('confirmado'), orgId: id, actorId: id, requestId: uuid,
    recibo: FinanceiroGeracaoRespostaSchema,
  }).strict(),
  z.object({ estado: z.literal('ausencia_conferida'), orgId: id, actorId: id, requestId: uuid }).strict(),
]);
export type FinanceiroGeracaoRecuperacao = z.infer<typeof FinanceiroGeracaoRecuperacaoSchema>;
