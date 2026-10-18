import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ehValorMonetarioCanonico } from '@mktos/shared';

const id = z.string().min(1);
const uuid = z.string().uuid().transform(v => v.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const iso = z.string().datetime({ offset: true }).transform(v => new Date(v).toISOString());
const tipo = z.enum(['entrada', 'saida']);
const moeda = z.string().regex(/^[A-Z]{3}$/);
const dinheiro = z.string().refine(v => ehValorMonetarioCanonico(v) &&
  !v.includes(' -') && !/ 0\.00$/.test(v), 'Valor monetário positivo canônico requerido.');
const conta = z.object({
  id, nome: z.string(), currency: moeda, provider: z.literal('manual'), ativa: z.boolean(),
}).strict();
const dimensao = z.object({ id, nome: z.string(), ativo: z.boolean() }).strict();
const origem = z.object({
  tipo: z.literal('contrato_recorrente_qa'), contractId: id, descricao: z.string(),
  vencimentoGerado: iso, comercial: z.null(),
}).strict();
const condicoes = z.object({
  descricao: z.string(), tipo, valorCanonico: dinheiro, currency: moeda,
  competencia: iso, vencimento: iso, conta,
  contrato: z.object({
    id, descricao: z.string(), tipo, valorCanonico: dinheiro,
    diaVencimento: z.number().int().min(1).max(31),
    periodicidade: z.enum(['mensal', 'bimestral', 'trimestral', 'semestral', 'anual']),
    dataInicio: iso, dataFim: iso.nullable(), status: z.enum(['ativo', 'pausado', 'encerrado']),
  }).strict(),
  contraparte: z.object({ id, razaoSocial: z.string(), ativo: z.boolean() }).strict(),
  classificacao: z.object({
    id, codigo: z.string(), nome: z.string(), ativo: z.boolean(), permiteLancamento: z.boolean(),
  }).strict(),
  projetoFinanceiro: dimensao.nullable(), departamento: dimensao.nullable(), temRateio: z.literal(false),
}).strict();
export const FinanceiroSnapshotSchema = z.object({
  schemaVersion: z.literal(1), modo: z.literal('exercicio'), orgId: id,
  transactionId: id, contractId: id, origem, condicoes,
}).strict().superRefine((v, ctx) => {
  const c = v.condicoes;
  if (v.contractId !== v.origem.contractId || v.contractId !== c.contrato.id ||
      v.origem.vencimentoGerado !== c.vencimento || c.currency !== c.conta.currency ||
      !c.valorCanonico.startsWith(c.currency + ' ') ||
      c.valorCanonico !== c.contrato.valorCanonico || c.tipo !== c.contrato.tipo) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Vínculos ou condições financeiras divergentes.' });
  }
});
export type FinanceiroSnapshot = z.infer<typeof FinanceiroSnapshotSchema>;
export const FinanceiroPedidoSchema = z.object({
  requestId: uuid, versionId: uuid, contentHash: hash, expectedUpdatedAt: iso,
  aprovar: z.boolean(), motivo: z.string().trim().min(1).max(2000),
}).strict();
export type FinanceiroPedido = z.infer<typeof FinanceiroPedidoSchema>;
export const FinanceiroDecisaoSchema = z.object({
  id: uuid, requestId: uuid, versionId: uuid, contentHash: hash,
  ator: z.object({ id, nome: z.string() }).strict(),
  decididoEm: iso, aprovar: z.boolean(), motivo: z.string().min(1).max(2000),
  alcadaExigida: z.literal('responsavel'), alcadaVerificada: z.enum(['responsavel', 'titular']),
}).strict();
export const FinanceiroResultadoSchema = z.object({
  status: z.literal('previsto'), approvalStatus: z.enum(['aprovado', 'rejeitado']),
  paidAt: z.null(), reconciledAt: z.null(),
  pagamentoExecutado: z.literal(false), cobrancaExecutada: z.literal(false), conciliacaoExecutada: z.literal(false),
}).strict();
export const FinanceiroRespostaSchema = z.object({
  modo: z.literal('exercicio'), orgId: id, transactionId: id, decisionId: uuid,
  versionId: uuid, contentHash: hash, decisao: FinanceiroDecisaoSchema,
  resultado: FinanceiroResultadoSchema, replayed: z.boolean(),
}).strict();
export type FinanceiroResposta = z.infer<typeof FinanceiroRespostaSchema>;
export type FinanceiroDecisao = z.infer<typeof FinanceiroDecisaoSchema>;
export interface FinanceiroDetalhe {
  modo: 'exercicio'; fonte: 'financeiro_local_qa'; orgId: string; consultadoEm: string;
  transactionId: string; versionId: string; contentHash: string; expectedUpdatedAt: string;
  valorCanonico: string; currency: string; tipo: 'entrada' | 'saida'; status: 'previsto';
  approvalStatus: 'aguardando' | 'aprovado' | 'rejeitado'; paidAt: null; reconciledAt: null;
  conta: FinanceiroSnapshot['condicoes']['conta']; origem: FinanceiroSnapshot['origem'];
  condicoes: FinanceiroSnapshot['condicoes']; decisao: FinanceiroDecisao | null; historico: FinanceiroDecisao[];
  canDecide: boolean; alcadaExigida: 'responsavel';
  alcadaAtual: 'operador' | 'responsavel' | 'titular' | null; impedimento: string | null;
}
export function jsonCanonicoFinanceiro(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(jsonCanonicoFinanceiro).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + jsonCanonicoFinanceiro(o[k])).join(',') + '}';
}
export const hashFinanceiro = (v: unknown) => createHash('sha256').update(jsonCanonicoFinanceiro(v)).digest('hex');
