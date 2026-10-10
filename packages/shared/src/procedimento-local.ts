import { z } from 'zod';
import { ProntidaoModeloLocalSchema } from './prontidao-local';

const id = z.string().uuid();
const versao = z.number().int().positive();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const data = z.string().datetime();
const escopo = z.object({ orgId: id, userId: id, agentId: id, agentSlug: z.string().min(1).max(200) }).strict();

// A ordem preserva o fingerprint do pedido: a versão do SOP é o último campo.
export const ProcedimentoLocalPedidoSchema = z.object({
  requestId: id, pedido: z.string().trim().min(1).max(2000), itemId: id, versionId: id,
  contentHash: hash, expectedItemVersion: versao, expectedSopVersion: versao,
}).strict();
export type ProcedimentoLocalPedido = z.infer<typeof ProcedimentoLocalPedidoSchema>;

const snapshot = z.object({
  versao: z.number().int().nonnegative(), proposito: z.string().max(400),
  passos: z.array(z.string().max(600)).max(30), definicaoDePronto: z.string().max(400),
}).strict();
const procedimentoAtual = snapshot.extend({ versao }).nullable();
export const ProcedimentoLocalPainelSchema = z.object({
  escopo,
  autoridade: z.object({ ler: z.literal(true), iniciar: z.boolean(), editarSop: z.boolean(), verificadaEm: data }).strict(),
  agente: z.object({ estado: z.enum(['planejado', 'ativo', 'pausado', 'encerrado']), ativo: z.boolean(), responsavelDisponivel: z.boolean() }).strict(),
  procedimento: procedimentoAtual,
  modelo: z.object({ configurado: z.string().max(200).nullable(), declaracao: ProntidaoModeloLocalSchema }).strict(),
  executor: z.object({ modo: z.literal('sintese_local_sem_ferramentas'), ferramentasExternas: z.literal(false), agendamento: z.literal(false), cancelarInferencia: z.literal(false) }).strict(),
  inicioLocal: z.object({ permitido: z.boolean(), impedimentosLocais: z.array(z.string().max(1000)).max(10), verificacaoModelo: z.literal('somente_apos_pedido') }).strict(),
}).strict();
export type ProcedimentoLocalPainel = z.infer<typeof ProcedimentoLocalPainelSchema>;

const estadoFonte = z.enum(['nao_verificada', 'ok', 'parcial', 'falhou']);
const retratoFonte = z.object({
  itemId: id, chave: z.string(), colecao: z.enum(['vault_canonica', 'manual_local', 'drive_selecionado']),
  identidadeCanonica: z.object({ documentId: id, origemDaIdentidade: z.enum(['item_existente', 'vinculo_explicito']) }).strict(),
  versao: z.object({ versionId: id, numero: versao, contentHash: hash }).strict(),
  origem: z.object({ tipo: z.string(), referencia: z.string().nullable() }).strict(), title: z.string(), body: z.string().nullable(),
  versaoAtual: versao, arquivada: z.boolean(), registradaEm: data, atualizadaNaMemoriaEm: data.nullable(),
  citacao: z.object({ chave: z.string(), itemId: id, versao, versionId: id, contentHash: hash }).strict(),
  estado: z.object({ coleta: estadoFonte, indexacao: estadoFonte, projecao: estadoFonte, ultimoReciboId: z.string().nullable() }).strict(),
  acesso: z.object({ modelo: z.enum(['local_por_pessoa', 'externo_por_arquivo']), verificadoEm: data, novoUsoPermitido: z.boolean() }).strict(),
}).strict();
export const ProcedimentoLocalFontesSchema = z.object({
  escopo, painel: ProcedimentoLocalPainelSchema,
  items: z.array(z.object({ id, title: z.string(), chave: z.string(), versao,
    versoes: z.array(z.object({ id, title: z.string(), versao, contentHash: hash, sourceType: z.string(), sourceRef: z.string().nullable(), retratoFonte }).strict()),
  }).strict()).max(100),
}).strict();
export type ProcedimentoLocalFontes = z.infer<typeof ProcedimentoLocalFontesSchema>;

// V1 só descreve um registro histórico; não é contrato de envio.
const entradaHistoricaV1 = ProcedimentoLocalPedidoSchema.omit({ expectedSopVersion: true });
export const ProcedimentoLocalExecucaoSchema = z.object({
  escopo, id, requestId: id, pessoaId: id, pedido: z.string().max(2000),
  entradaConfirmada: z.discriminatedUnion('contrato', [
    z.object({ contrato: z.literal(1), input: entradaHistoricaV1 }).strict(),
    z.object({ contrato: z.literal(2), input: ProcedimentoLocalPedidoSchema }).strict(),
  ]),
  status: z.enum(['rodando', 'respondida', 'executada', 'retida', 'recusada', 'falhou']), motivo: z.string().nullable(),
  procedimento: snapshot, procedimentoAtual, painelAtual: ProcedimentoLocalPainelSchema,
  fonte: z.object({ itemId: id, versionId: id, contentHash: hash, versao, chave: z.string(), sourceType: z.string(), sourceRef: z.string().nullable(), title: z.string() }).strict(),
  retratoFonte, resposta: z.string().nullable(), modeloConfigurado: z.string().max(200).nullable(), modeloUsado: z.string().max(200).nullable(), provider: z.literal('llama.cpp-local'),
  consumo: z.object({ tokensIn: z.number().int().nonnegative().nullable(), tokensOut: z.number().int().nonnegative().nullable(),
    origem: z.enum(['resposta_do_servidor_local', 'nenhuma_chamada_concluida']), custoExternoUsd: z.literal(0), custoMaquinaMedido: z.literal(false) }).strict(),
  criadaEm: data, encerradaEm: data.nullable(),
}).strict();
export type ProcedimentoLocalExecucao = z.infer<typeof ProcedimentoLocalExecucaoSchema>;

// A negativa observa ausência sob lock; não cancela um POST atrasado do mesmo A.
export const ProcedimentoLocalRecuperacaoSchema = z.discriminatedUnion('estado', [
  z.object({ estado: z.literal('confirmado'), escopo, requestId: id, execucao: ProcedimentoLocalExecucaoSchema }).strict(),
  z.object({ estado: z.literal('ausencia_conferida'), escopo, requestId: id }).strict(),
]);
export type ProcedimentoLocalRecuperacao = z.infer<typeof ProcedimentoLocalRecuperacaoSchema>;
