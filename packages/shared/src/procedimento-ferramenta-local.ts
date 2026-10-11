// Proposta documental V3 repin a897. Não instalada, compilada ou executada.
// IDs Session/Step/SOP gerados pelo servidor são reais; scanners não inventam ToolGateway calls.
import { z } from 'zod';

const id = z.string().uuid().transform((s) => s.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const numero = z.number().int().positive().safe();
const data = z.string().datetime();
const capacidade = z.literal('contexto.memoria.buscar');
const modo = z.literal('literal_versao_escolhida_v1');
function unicodeIntegro(s: string) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const seguinte = s.charCodeAt(++i);
      if (!(seguinte >= 0xdc00 && seguinte <= 0xdfff)) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
function limitada<T extends z.ZodTypeAny>(s: T): z.ZodEffects<T, z.output<T>, z.input<T>> {
  return s.superRefine((v, ctx) => {
    if (new TextEncoder().encode(JSON.stringify(v)).byteLength > 65536)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'O registro ultrapassa o limite de 64 KiB.' });
  });
}
const consulta = z.string().refine(unicodeIntegro, 'A consulta contém Unicode inválido.')
  .refine((s) => !/[\u0000\r\n]/u.test(s), 'A consulta deve ocupar uma linha sem NUL.')
  .refine((s) => Array.from(s).length >= 2 && Array.from(s).length <= 200, 'Use de 2 a 200 pontos de código na consulta.');
const escopo = z.object({ orgId: id, actorId: id, agentId: id, agentSlug: z.string().min(1).max(200) }).strict();
export const ProcedimentoFerramentaLocalPerfilSchema = z.object({
  schemaVersion: z.literal(1), capacidade, modo, consulta: z.literal('pedido.q'),
  limit: z.number().int().min(1).max(10), maxFonteBytes: z.literal(262144), maxTrechoPontos: z.literal(300),
}).strict();
export type ProcedimentoFerramentaLocalPerfil = z.infer<typeof ProcedimentoFerramentaLocalPerfilSchema>;
// A ordem faz parte do texto canônico V3. Não alterar os pedidos V1/V2.
export const ProcedimentoFerramentaLocalPedidoSchema = limitada(z.object({
  requestId: id, pedido: z.string().min(1).max(2000).refine(unicodeIntegro), q: consulta,
  limit: z.number().int().min(1).max(10), itemId: id, versionId: id, contentHash: hash,
  expectedItemVersion: numero, expectedSopVersion: numero, expectedToolConfigHash: hash,
}).strict());
export type ProcedimentoFerramentaLocalPedido = z.infer<typeof ProcedimentoFerramentaLocalPedidoSchema>;
const snapshotSop = z.object({
  id, versao: numero, proposito: z.string(), gatilho: z.string(), passos: z.array(z.string()),
  definicaoDePronto: z.string(), observacoes: z.string().nullable(),
  ferramentaLocal: ProcedimentoFerramentaLocalPerfilSchema, configHash: hash,
}).strict();
const fonteEscolhida = z.object({
  itemId: id, versionId: id, versao: numero, contentHash: hash, chave: z.string(),
  sourceType: z.string(), sourceRef: z.string().nullable(), title: z.string(),
  colecao: z.enum(['vault_canonica', 'manual_local']),
}).strict();
export const ProcedimentoFerramentaLocalConfiguracaoSchema = limitada(z.object({
  expectedSopVersion: numero, expectedConfigHash: hash.nullable(),
  config: ProcedimentoFerramentaLocalPerfilSchema.nullable(),
}).strict());
export type ProcedimentoFerramentaLocalConfiguracao = z.infer<typeof ProcedimentoFerramentaLocalConfiguracaoSchema>;
export const ProcedimentoFerramentaLocalConfiguracaoResultadoSchema = limitada(z.object({
  escopo, sopId: id, versao: numero, config: ProcedimentoFerramentaLocalPerfilSchema.nullable(),
  configHash: hash.nullable(), auditId: id, comprometidaEm: data, reciboCausal: z.literal(false),
}).strict());
export type ProcedimentoFerramentaLocalConfiguracaoResultado = z.infer<typeof ProcedimentoFerramentaLocalConfiguracaoResultadoSchema>;
export const ProcedimentoFerramentaLocalPainelSchema = limitada(z.object({
  escopo, autoridade: z.object({ ler: z.literal(true), executar: z.boolean(), configurar: z.boolean(), verificadaEm: data }).strict(),
  agente: z.object({ estado: z.enum(['planejado', 'ativo', 'pausado', 'encerrado']), ativo: z.boolean(),
    responsavelDisponivel: z.boolean(), capacidades: z.array(z.string()), modeloConfigurado: z.string().nullable() }).strict(),
  sop: z.object({ id, versao: numero, config: ProcedimentoFerramentaLocalPerfilSchema.nullable(), configHash: hash.nullable() }).strict().nullable(),
  executor: z.object({ capacidade, modo, modeloChamado: z.literal(false), agendamento: z.literal(false),
    fonte: z.literal('uma_versao_persistida_escolhida'), maxFonteBytes: z.literal(262144) }).strict(),
  inicioLocal: z.object({ permitido: z.boolean(), impedimentosLocais: z.array(z.string()) }).strict(),
}).strict());
export type ProcedimentoFerramentaLocalPainel = z.infer<typeof ProcedimentoFerramentaLocalPainelSchema>;
export const ProcedimentoFerramentaLocalResultadoSchema = limitada(z.object({
  modo, itemId: id, versionId: id, versao: numero, contentHash: hash, q: consulta,
  limit: z.number().int().min(1).max(10), totalLinhasComCorrespondencia: z.number().int().nonnegative().safe(),
  parcial: z.boolean(), observadaEm: data,
  correspondencias: z.array(z.object({ linha: numero, trecho: z.string().refine(unicodeIntegro)
    .refine((s) => Array.from(s).length <= 300), corteInicio: z.boolean(), corteFim: z.boolean() }).strict()).max(10),
}).strict());
export type ProcedimentoFerramentaLocalResultado = z.infer<typeof ProcedimentoFerramentaLocalResultadoSchema>;
const consumoModelo = z.object({ origem: z.literal('nenhuma_chamada_de_modelo'), provider: z.null(), modeloUsado: z.null(),
  tokensIn: z.null(), tokensOut: z.null(), custoExternoUsd: z.literal(0), custoMaquinaMedido: z.literal(false) }).strict();
const comum = {
  schemaVersion: z.literal(1), tipo: z.literal('procedimento_ferramenta_local'), entradaContrato: z.literal(3),
  id, escopo, requestId: id, sessionId: id, entrada: ProcedimentoFerramentaLocalPedidoSchema,
  inputFingerprint: hash, inputCanonico: z.string(), sop: snapshotSop, fonteEscolhida,
  passoPedidoId: id, passoFinalId: id, auditIds: z.array(id).min(1), consumoModelo,
  criadaEm: data, encerradaEm: data,
};
export const ProcedimentoFerramentaLocalReciboSchema = limitada(z.discriminatedUnion('status', [
  z.object({ ...comum, status: z.literal('executada'), ferramentaChamada: z.literal(true), motivoCode: z.null(),
    fonteConsumida: fonteEscolhida, resultado: ProcedimentoFerramentaLocalResultadoSchema, resultHash: hash }).strict(),
  z.object({ ...comum, status: z.literal('recusada'), ferramentaChamada: z.literal(false),
    motivoCode: z.enum(['agente_nao_ativo', 'responsavel_indisponivel', 'capacidade_nao_declarada']),
    fonteConsumida: z.null(), resultado: z.null(), resultHash: z.null() }).strict(),
]));
export type ProcedimentoFerramentaLocalRecibo = z.infer<typeof ProcedimentoFerramentaLocalReciboSchema>;
const disponibilidadeAtual = z.object({
  sopVersaoAtual: numero.nullable(), configHashAtual: hash.nullable(), estadoAgenteAtual: z.enum(['planejado', 'ativo', 'pausado', 'encerrado']),
  fonte: z.object({ versaoAtual: numero, arquivada: z.boolean(), novoUsoPermitido: z.boolean(), chaveAtual: z.string() }).strict(),
  verificadaEm: data,
}).strict();
export const ProcedimentoFerramentaLocalRecuperacaoSchema = limitada(z.discriminatedUnion('estado', [
  z.object({ estado: z.literal('confirmado'), escopo, requestId: id, recibo: ProcedimentoFerramentaLocalReciboSchema, disponibilidadeAtual }).strict(),
  z.object({ estado: z.literal('ausencia_conferida'), escopo, requestId: id, mantemId: z.literal(true), cancelaPostTardio: z.literal(false) }).strict(),
]));
export type ProcedimentoFerramentaLocalRecuperacao = z.infer<typeof ProcedimentoFerramentaLocalRecuperacaoSchema>;
// Só organiza campos validados. SHA256 será calculado no backend, sobre este UTF8 exato.
export function textoCanonicoDaFerramentaLocal(scope: z.infer<typeof escopo>, input: ProcedimentoFerramentaLocalPedido): string {
  return JSON.stringify({ contrato: 3, orgId: scope.orgId, actorId: scope.actorId, agentId: scope.agentId,
    slug: scope.agentSlug, capacidade: 'contexto.memoria.buscar', modo: 'literal_versao_escolhida_v1',
    input: { requestId: input.requestId, pedido: input.pedido, q: input.q, limit: input.limit,
      itemId: input.itemId, versionId: input.versionId, contentHash: input.contentHash,
      expectedItemVersion: input.expectedItemVersion, expectedSopVersion: input.expectedSopVersion,
      expectedToolConfigHash: input.expectedToolConfigHash } });
}
