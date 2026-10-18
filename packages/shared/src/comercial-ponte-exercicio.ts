import { z } from 'zod';
import { ehValorMonetarioCanonico } from './valor-monetario';

const uuid = z.string().uuid().transform(v => v.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const texto = (n: number) => z.string().trim().min(1).max(n);
const data = z.string().datetime({ offset: true }).transform(v => new Date(v).toISOString());
export const PonteOrigemSchema = z.object({ leadId: uuid, aceiteId: uuid, propostaId: uuid,
  propostaVersao: z.number().int().positive(), documentoHash: hash, condicoesHash: hash }).strict();
export const PonteConfiguracaoSchema = z.object({ listId: uuid, statusId: uuid, title: texto(300), assigneeUserId: uuid.nullable() }).strict();
export const PonteProjetoPedidoSchema = z.object({ requestId: uuid, aceiteId: uuid, propostaId: uuid,
  expectedPropostaVersion: z.number().int().positive(), documentoHash: hash, condicoesHash: hash,
  listId: uuid, statusId: uuid, title: texto(300), assigneeUserId: uuid.nullable() }).strict();
export const PonteObrigacaoPedidoSchema = z.object({ requestId: uuid, aceiteId: uuid, propostaId: uuid,
  expectedPropostaVersion: z.number().int().positive(), documentoHash: hash, condicoesHash: hash,
  partnerId: uuid, accountId: uuid, chartAccountId: uuid, projetoFinanceiroId: uuid.nullable(), departamentoId: uuid.nullable(),
  descricao: texto(500), valorCanonico: z.string().refine(v => ehValorMonetarioCanonico(v) && !v.includes(' -') && !/ 0\.00$/.test(v), 'Informe o valor positivo como BRL 1500.00.'),
  competencia: data, vencimento: data, confirmacaoExercicio: z.literal(true) }).strict();
export const PonteDecisaoPedidoSchema = z.object({ requestId: uuid, versionId: uuid, contentHash: hash,
  expectedUpdatedAt: data, aprovar: z.boolean(), motivo: texto(2000) }).strict();
export const PonteSnapshotSchema = z.object({ schemaVersion: z.literal(1), modo: z.literal('exercicio'),
  origem: PonteOrigemSchema, projectId: uuid, taskId: uuid, transactionId: uuid,
  condicoes: z.object({ tipo: z.literal('entrada'), descricao: texto(500), valorCanonico: z.string(), currency: z.string().regex(/^[A-Z]{3}$/),
    competencia: data, vencimento: data, accountId: uuid, partnerId: uuid, chartAccountId: uuid,
    projetoFinanceiroId: uuid.nullable(), departamentoId: uuid.nullable(), contractId: z.null(), temRateio: z.literal(false) }).strict() }).strict();
export type PonteOrigem = z.infer<typeof PonteOrigemSchema>;
export type PonteConfiguracao = z.infer<typeof PonteConfiguracaoSchema>;
export type PonteSnapshot = z.infer<typeof PonteSnapshotSchema>;
export type PonteProjetoPedido = z.infer<typeof PonteProjetoPedidoSchema>;
export type PonteObrigacaoPedido = z.infer<typeof PonteObrigacaoPedidoSchema>;
export type PonteDecisaoPedido = z.infer<typeof PonteDecisaoPedidoSchema>;
export interface PonteProjetoDto { id: string; taskId: string; origem: PonteOrigem; configuracaoOriginal: PonteConfiguracao;
  atual: { title: string; listId: string; statusId: string; assigneeUserId: string | null; archived: boolean }; criadaEm: string }
export interface PonteObrigacaoDto { id: string; transactionId: string; versionId: string; contentHash: string; expectedUpdatedAt: string;
  snapshot: PonteSnapshot; status: 'previsto'; approvalStatus: 'aguardando'|'aprovado'|'rejeitado'; paidAt: null; reconciledAt: null;
  decisao: { id: string; atorId: string; aprovar: boolean; motivo: string; alcada: 'responsavel'|'titular'; decididaEm: string } | null;
  canDecide: boolean; impedimento: string | null }
export interface PonteResposta { modo: 'exercicio'; requestId: string; replayed: boolean; escopo: { orgId: string; userId: string };
  projeto: PonteProjetoDto | null; obrigacao: PonteObrigacaoDto | null; financeiro: { situacao: 'pendente'|'registrado'|'restrito'; pendencias: string[] };
  capacidades: { podeCriarProjeto: boolean; podeRegistrarObrigacao: boolean; podeDecidir: boolean };
  efeitos: { tarefaCriada: boolean; projetoCriado: boolean; obrigacaoCriada: boolean; decisaoRegistrada: boolean;
    pagamentoExecutado: false; cobrancaExecutada: false; conciliacaoExecutada: false } }
export interface PonteCatalogos { modo:'exercicio'; escopo:{orgId:string;userId:string};
  listas: {id:string;nome:string;etapas:{id:string;nome:string}[]}[]; responsaveis:{id:string;nome:string}[];
  financeiro: null | {contas:{id:string;nome:string;currency:string}[]; contrapartes:{id:string;nome:string}[];
    classificacoes:{id:string;nome:string;codigo:string}[]; projetos:{id:string;nome:string}[];departamentos:{id:string;nome:string}[]} }

export interface PontePayableRef { exercicioComercial: boolean; exercicioComercialHref: string | null }
