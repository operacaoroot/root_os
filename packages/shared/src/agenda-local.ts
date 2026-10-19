// PROPOSTA TIPADA PARA REVISÃO. Somente evidência; não é SDK instalado.
// Imports relativos correspondem aos arquivos reais/shared e ao módulo irmão proposto.
// Referências imutáveis: manifesto-proposta-01.json. Não importar de index.ts.
import { z } from 'zod';
import {
  ProcedimentoLocalPedidoSchema, ProcedimentoLocalPainelSchema, ProcedimentoLocalExecucaoSchema,
} from './procedimento-local';
import {
  AgentEstadoHumanoEscopoSchema, AgentEstadoHumanoBaseSchema, AgentEstadoHumanoMarcaSchema,
} from './agent-estado-humano';

const id = z.string().uuid();
const positivo = z.number().int().positive().safe();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const iso = z.string().datetime();
const estadoAgenda = z.enum(['pausada', 'habilitada_manual', 'encerrada']);
const escopo = AgentEstadoHumanoEscopoSchema;
const fontePedido = ProcedimentoLocalPedidoSchema.omit({ requestId: true });

export const AgendaLocalListaConsultaSchema = z.object({ cursorId: id.optional() }).strict();
export type AgendaLocalListaConsulta = z.infer<typeof AgendaLocalListaConsultaSchema>;

function limitado<T extends z.ZodTypeAny>(schema: T): z.ZodEffects<T, z.output<T>, z.input<T>> {
  return schema.superRefine((v, ctx) => {
    if (new TextEncoder().encode(JSON.stringify(v)).byteLength > 65_536)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'O documento tem no máximo 64 KiB.' });
  });
}

// GET declarativo /agents/:slug/agendas-locais/configuracao, antes de :agendaId.
// CONFIGURAR completo antes/depois; somente pessoas ativas da mesma empresa.
// Não chama modelo.estado, FS ou provedor; modelo escolhido vem do painel do agente.
export const AgendaLocalConfiguracaoSchema = z.object({
  escopo, pessoas: z.array(z.object({ id, name: z.string() }).strict()),
}).strict().superRefine((v, ctx) => {
  const ids = new Set<string>();
  v.pessoas.forEach((p, n) => {
    if (ids.has(p.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pessoas', n, 'id'], message: 'A pessoa está repetida.' });
    ids.add(p.id);
  });
});
export type AgendaLocalConfiguracao = z.infer<typeof AgendaLocalConfiguracaoSchema>;

const configuracao = z.object({
  nome: z.string().trim().min(1).max(120), previstoPara: iso.nullable(), responsavelId: id,
  modeloConfiguradoEsperado: z.string().min(1).max(200).nullable(), pedido: fontePedido,
}).strict();
export const AgendaLocalCriarSchema = limitado(z.object({ requestId: id, configuracao }).strict());
export type AgendaLocalCriar = z.infer<typeof AgendaLocalCriarSchema>;
export const AgendaLocalEditarSchema = limitado(z.object({ requestId: id, expectedAgendaVersion: positivo, configuracao }).strict());
export type AgendaLocalEditar = z.infer<typeof AgendaLocalEditarSchema>;
export const AgendaLocalEstadoSchema = limitado(z.object({
  requestId: id, expectedAgendaVersion: positivo, estado: estadoAgenda,
  motivo: z.string().trim().max(500).nullable(),
}).strict());
export type AgendaLocalEstado = z.infer<typeof AgendaLocalEstadoSchema>;
export const AgendaLocalDispararSchema = limitado(z.object({
  requestId: id, expectedAgendaVersion: positivo, expectedSopVersion: positivo,
}).strict());
export type AgendaLocalDisparar = z.infer<typeof AgendaLocalDispararSchema>;

const sopSnapshot = z.object({
  id, versao: positivo, proposito: z.string().max(400), gatilho: z.string().max(400),
  passos: z.array(z.string().max(600)).max(30), definicaoDePronto: z.string().max(400),
  observacoes: z.string().nullable(), atualizadoPor: id.nullable(), atualizadoEm: iso,
}).strict();
const fonteSnapshot = z.object({
  itemId: id, versionId: id, versao: positivo, contentHash: hash, expectedItemVersion: positivo,
  chave: z.string(), sourceType: z.string(), sourceRef: z.string().nullable(), title: z.string(),
}).strict();
const snapshotConfiguracao = z.object({
  schemaVersion: z.literal(1), orgId: id, agentId: id, agendaId: id,
  nome: z.string().min(1).max(120), previstoPara: iso.nullable(), responsavelId: id,
  modeloConfigurado: z.string().min(1).max(200).nullable(), pedido: fontePedido,
  procedimento: sopSnapshot, fonte: fonteSnapshot, ferramenta: z.literal('contexto.memoria.buscar'),
  automatico: z.literal(false),
}).strict();
export const AgendaLocalRevisaoSchema = z.object({
  agendaId: id, revisionId: id, numero: positivo, estado: estadoAgenda, snapshotHash: hash,
  configuracao: snapshotConfiguracao, motivo: z.string().nullable(), criadaEm: iso,
}).strict();
export type AgendaLocalRevisao = z.infer<typeof AgendaLocalRevisaoSchema>;

const evento = z.object({ id, seq: z.string().regex(/^[1-9][0-9]*$/), hash, tipo: z.string(), ocorreuEm: iso }).strict();
const comum = {
  schemaVersion: z.literal(1), escopo, requestId: id, operationId: id, confirmadoEm: iso,
  auditIds: z.array(id).min(1).max(500), eventSnapshot: z.array(evento).min(1).max(500),
};
const configuracaoRecibo = z.object({
  ...comum, tipo: z.enum(['agenda_criar', 'agenda_editar', 'agenda_estado']), revisao: AgendaLocalRevisaoSchema,
  anterior: z.object({ revisionId: id, numero: positivo, estado: estadoAgenda }).strict().nullable(),
}).strict();
const criarRecibo = configuracaoRecibo.extend({ tipo: z.literal('agenda_criar') }).strict();
const editarRecibo = configuracaoRecibo.extend({ tipo: z.literal('agenda_editar') }).strict();
const estadoRecibo = configuracaoRecibo.extend({ tipo: z.literal('agenda_estado') }).strict();
const disparoRecibo = z.object({
  ...comum, tipo: z.literal('agenda_disparar'), agendaId: id, revisionId: id, agendaVersion: positivo,
  snapshotHash: hash, dispatchId: id, sessionId: id, entradaConfirmada: ProcedimentoLocalPedidoSchema,
  estadoNoCompromisso: z.literal('rodando'),
}).strict();
const agenteRecibo = z.object({
  ...comum, tipo: z.literal('agente_estado'), marcaAnterior: hash, marcaNova: hash,
  anterior: AgentEstadoHumanoMarcaSchema, posterior: AgentEstadoHumanoMarcaSchema,
  tarefasSoltas: z.array(z.object({ id, titulo: z.string(), desde: iso.nullable() }).strict()).max(500),
}).strict();
export const AgendaLocalReciboSchema = limitado(z.discriminatedUnion('tipo', [
  criarRecibo, editarRecibo, estadoRecibo, disparoRecibo, agenteRecibo,
]));
export type AgendaLocalRecibo = z.infer<typeof AgendaLocalReciboSchema>;

const disponibilidade = z.object({
  verificadaEm: iso, agente: AgentEstadoHumanoBaseSchema,
  agenda: z.object({ revisionId: id, numero: positivo, estado: estadoAgenda }).strict().nullable(),
  fonte: z.object({ legivel: z.literal(true), arquivada: z.boolean(), novoUsoPermitido: z.boolean(), versaoAtual: positivo }).strict().nullable(),
  modelo: ProcedimentoLocalPainelSchema.shape.modelo.nullable(), automatico: z.literal(false),
}).strict();

// O limite também vale para o recibo dentro de cada recuperação.
// Não limitar a recuperação inteira a 64 KiB: body/resposta histórica não são cortados.
const confirmadoConfiguracao = z.object({
  estado: z.literal('confirmado'), escopo, requestId: id,
  tipo: z.enum(['agenda_criar', 'agenda_editar', 'agenda_estado']),
  recibo: z.union([limitado(criarRecibo), limitado(editarRecibo), limitado(estadoRecibo)]),
  disponibilidadeAtual: disponibilidade,
}).strict();
const confirmadoDisparo = z.object({
  estado: z.literal('confirmado'), escopo, requestId: id, tipo: z.literal('agenda_disparar'),
  recibo: limitado(disparoRecibo), execucao: ProcedimentoLocalExecucaoSchema, disponibilidadeAtual: disponibilidade,
}).strict();
const confirmadoAgente = z.object({
  estado: z.literal('confirmado'), escopo, requestId: id, tipo: z.literal('agente_estado'),
  recibo: limitado(agenteRecibo), disponibilidadeAtual: disponibilidade,
}).strict();
const negativa = z.object({
  estado: z.literal('ausencia_conferida'), escopo, requestId: id, observadoEm: iso,
  cancelaPedido: z.literal(false), conservaRequestId: z.literal(true),
}).strict();
const recuperacao = z.union([confirmadoConfiguracao, confirmadoDisparo, confirmadoAgente, negativa]);
export const AgendaLocalRecuperacaoSchema = recuperacao.superRefine((r, ctx) => {
  if (r.estado !== 'confirmado') return;
  const c = r.recibo;
  const mesmoEscopo = (s: z.infer<typeof escopo>) => s.orgId === r.escopo.orgId && s.actorId === r.escopo.actorId
    && s.agentId === r.escopo.agentId && s.agentSlug === r.escopo.agentSlug;
  if (r.tipo !== c.tipo || r.requestId !== c.requestId || !mesmoEscopo(c.escopo))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Confira a causa e o escopo do recibo.' });
  if ('revisao' in c) {
    const v = c.revisao, cfg = v.configuracao;
    if (v.agendaId !== cfg.agendaId || cfg.orgId !== r.escopo.orgId || cfg.agentId !== r.escopo.agentId
      || cfg.pedido.itemId !== cfg.fonte.itemId || cfg.pedido.versionId !== cfg.fonte.versionId
      || cfg.pedido.contentHash !== cfg.fonte.contentHash || cfg.pedido.expectedItemVersion !== cfg.fonte.expectedItemVersion
      || cfg.pedido.expectedSopVersion !== cfg.procedimento.versao)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Confira a revisão, a fonte e o procedimento.' });
    if (c.tipo === 'agenda_criar' ? c.anterior !== null || v.numero !== 1 || v.estado !== 'pausada'
      : !c.anterior || c.anterior.numero + 1 !== v.numero || c.anterior.revisionId === v.revisionId)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Confira a revisão anterior.' });
    if (c.tipo === 'agenda_editar' && v.estado !== 'pausada')
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A revisão editada começa pausada.' });
  }
  if (r.tipo === 'agenda_disparar' && c.tipo === 'agenda_disparar') {
    const e = r.execucao, i = e.entradaConfirmada.input;
    if (c.sessionId !== e.id || r.requestId !== e.requestId || r.requestId !== c.entradaConfirmada.requestId
      || r.requestId !== i.requestId || e.pessoaId !== r.escopo.actorId
      || e.escopo.orgId !== r.escopo.orgId || e.escopo.userId !== r.escopo.actorId
      || e.escopo.agentId !== r.escopo.agentId || e.escopo.agentSlug !== r.escopo.agentSlug
      || e.entradaConfirmada.contrato !== 2 || (e.entradaConfirmada.contrato === 2
        && e.procedimento.versao !== e.entradaConfirmada.input.expectedSopVersion)
      || c.entradaConfirmada.pedido !== i.pedido || c.entradaConfirmada.itemId !== i.itemId
      || c.entradaConfirmada.versionId !== i.versionId || c.entradaConfirmada.contentHash !== i.contentHash
      || c.entradaConfirmada.expectedItemVersion !== i.expectedItemVersion
      || (e.entradaConfirmada.contrato === 2 && c.entradaConfirmada.expectedSopVersion !== e.entradaConfirmada.input.expectedSopVersion))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Confira o disparo e sua execução.' });
  }
  if (c.tipo === 'agente_estado' && (!mesmoEscopo(c.anterior.escopo) || !mesmoEscopo(c.posterior.escopo)
    || c.marcaAnterior !== c.anterior.marca || c.marcaNova !== c.posterior.marca))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Confira as marcas do estado do agente.' });
});
export type AgendaLocalRecuperacao = z.infer<typeof AgendaLocalRecuperacaoSchema>;
export const AgendaLocalRecuperacaoConsultaSchema = z.object({
  tipoEsperado: z.enum(['agenda_criar', 'agenda_editar', 'agenda_estado', 'agenda_disparar', 'agente_estado']),
}).strict();
export type AgendaLocalRecuperacaoConsulta = z.infer<typeof AgendaLocalRecuperacaoConsultaSchema>;

export const AgendaLocalPainelSchema = limitado(z.object({
  escopo, agendaId: id, revisao: AgendaLocalRevisaoSchema,
  painelLocal: ProcedimentoLocalPainelSchema, automatico: z.literal(false),
  ultimoDisparo: z.object({
    requestId: id, dispatchId: id, sessionId: id,
    status: ProcedimentoLocalExecucaoSchema.shape.status, encerradaEm: iso.nullable(),
  }).strict().nullable(), disponibilidadeAtual: disponibilidade,
}).strict());
export type AgendaLocalPainel = z.infer<typeof AgendaLocalPainelSchema>;
export const AgendaLocalListaSchema = z.object({
  escopo, items: z.array(AgendaLocalPainelSchema).max(50), proximoId: id.nullable(), automatico: z.literal(false),
}).strict();
export type AgendaLocalLista = z.infer<typeof AgendaLocalListaSchema>;

// Os vínculos acima verificam forma/referências disponíveis, sem acesso a banco.
// Produtor e consumidor ainda precisam vincular request/query/rota/base escolhida,
// snapshotHash/marca/fingerprint reais, ACL atual e configuração da revisão consumida.
// Apenas o produtor confere causa/namespace/lock, ausência real e efeitos na mesma TX.
// Arrays até 500 e recibo/painel de 64 KiB exigem recusa integral antes do compromisso.
// Nenhum corte, grant, autoPOST, cancelamento inferido ou relógio é autorizado aqui.
