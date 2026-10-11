import { z } from 'zod';

// Proposta A6: a conferência das referências pertence ao produtor autorizado.
// Os IDs históricos são String; este contrato não lhes impõe UUID novo.
const id = z.string().min(1);
const inteiro = z.number().finite().int().safe();
const contagem = inteiro.nonnegative();
const custo = z.number().finite();
const data = z.string().datetime({ offset: true });
const canal = z.enum(['web', 'telegram', 'whatsapp', 'rotina', 'terminal', 'mcp']);
const status = z.enum(['rodando', 'respondida', 'executada', 'retida', 'recusada', 'falhou']);
const nivel = z.enum(['R0', 'R1', 'R2', 'R3', 'R4', 'R5']).nullable();
const decisao = z.enum(['executado', 'aguardando_aprovacao', 'recusado', 'erro']).nullable();
const vazio = z.tuple([]);
const pedidoGenerico = z.literal('Procedimento local de síntese de fonte');
const respostaGenerica = z.literal('Resultado disponível no procedimento local.');

export const SessaoHistoricaConsultaSchema = z.object({
  canal: canal.optional(),
  agente: z.string().min(1).optional(),
  limit: z.string().regex(/^[0-9]{1,10}$/).optional(),
}).strict().transform((v) => ({
  canal: v.canal ?? null,
  agente: v.agente ?? null,
  limite: v.limit === undefined ? 50 : Math.max(1, Math.min(200, Number(v.limit))),
}));

export const SessaoHistoricaConsultaNormalizadaSchema = z.object({
  canal: canal.nullable(), agente: z.string().min(1).nullable(),
  limite: inteiro.min(1).max(200),
}).strict();

const escopo = z.object({ orgId: id, actorId: id }).strict();
const agente = z.object({ slug: z.string(), nome: z.string(), iniciais: z.string() }).strict().nullable();
const conteudo = z.discriminatedUnion('estado', [
  z.object({ estado: z.literal('generico_local'), motivo: z.null(), corpoDaFonteDivulgado: z.literal(false) }).strict(),
  z.object({ estado: z.literal('nao_conferido'), motivo: z.enum(['origem_historica_insuficiente', 'registro_inconsistente']),
    corpoDaFonteDivulgado: z.literal(false) }).strict(),
]);
const vinculos = z.discriminatedUnion('estado', [
  z.object({ estado: z.literal('conferidos'), motivo: z.null() }).strict(),
  z.object({ estado: z.literal('parciais'), motivo: z.literal('referencia_nao_conferida') }).strict(),
]);

const ferramenta = z.object({
  capacidade: id.nullable(), args: z.null(), resultado: z.null(), nivel, decisao,
  duracaoMs: inteiro, vinculo: z.enum(['conferido', 'nao_conferido']),
}).strict().superRefine((v, ctx) => {
  if (v.vinculo === 'conferido' && v.capacidade === null)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['capacidade'], message: 'Referência conferida exige capacidade vinculada.' });
  if (v.vinculo === 'nao_conferido' && (v.capacidade !== null || v.nivel !== null || v.decisao !== null))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Referência não conferida omite a metadata dependente.' });
});
const decisaoMetadata = z.object({
  capacidade: id.nullable(), nivel, decisao, motivo: z.null(), gatilhos: vazio,
  approvalId: id.nullable(),
}).strict().superRefine((v, ctx) => {
  if (v.capacidade === null && (v.nivel !== null || v.decisao !== null || v.approvalId !== null))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Referência ausente omite a metadata dependente.' });
});

const metadata = {
  id, agente, canal, solicitante: z.string(), status, nivelMax: nivel,
  passos: inteiro, custoUsd: custo, custoEstimado: z.boolean(), duracaoMs: inteiro,
  semProcedencia: z.boolean(), criadaEm: data, conteudo, vinculos,
};
const item = z.object({ ...metadata, pedido: pedidoGenerico.nullable() }).strict()
  .superRefine((v, ctx) => {
    if ((v.conteudo.estado === 'generico_local') !== (v.pedido !== null))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pedido'], message: 'Pedido e diagnóstico histórico divergem.' });
    if (v.agente === null && v.vinculos.estado !== 'parciais')
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['vinculos'], message: 'Referência do agente não conferida.' });
  });

export const SessaoHistoricaListaSchema = z.object({
  schemaVersion: z.literal(1), escopo, consulta: SessaoHistoricaConsultaNormalizadaSchema,
  items: z.array(item).max(200), total: contagem,
  kpis: z.object({ sessoes: contagem, custoUsd: custo, custoParcial: z.boolean(), semProcedencia: contagem }).strict(),
}).strict().superRefine((v, ctx) => {
  if (v.items.length > v.consulta.limite || v.items.length > v.total || v.kpis.sessoes !== v.total)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'População, limite e totais da consulta divergem.' });
  if (v.kpis.semProcedencia > v.kpis.sessoes)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['kpis', 'semProcedencia'], message: 'Contagem excede a população da consulta.' });
  if (new Set(v.items.map((s) => s.id)).size !== v.items.length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'Sessão repetida na mesma consulta.' });
});

export const SessaoHistoricaTracoSchema = z.object({
  schemaVersion: z.literal(1), escopo, id, agente, canal, solicitante: z.string(), status,
  custoUsd: custo, custoEstimado: z.boolean(), duracaoMs: inteiro, criadaEm: data, conteudo, vinculos,
  blocos: z.object({
    pedido: pedidoGenerico.nullable(),
    contexto: z.object({ fontes: vazio, texto: z.null() }).strict(),
    ferramentas: z.array(ferramenta),
    regua: z.object({ nivelMax: nivel, motivo: z.null(), decisoes: z.array(decisaoMetadata) }).strict(),
    resposta: z.object({ texto: respostaGenerica.nullable(), semProcedencia: z.boolean(), fontes: vazio }).strict(),
    registro: z.object({ correlationId: id, toolCalls: z.array(id), passos: contagem }).strict(),
  }).strict(),
}).strict().superRefine((v, ctx) => {
  if ((v.conteudo.estado === 'generico_local') !== (v.blocos.pedido !== null))
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['blocos', 'pedido'], message: 'Pedido e diagnóstico histórico divergem.' });
  if (v.conteudo.estado === 'nao_conferido' && v.blocos.resposta.texto !== null)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['blocos', 'resposta', 'texto'], message: 'Conteúdo histórico não conferido permanece omitido.' });
  if (v.blocos.registro.correlationId !== v.id)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['blocos', 'registro', 'correlationId'], message: 'Registro não corresponde à sessão.' });
  if (new Set(v.blocos.registro.toolCalls).size !== v.blocos.registro.toolCalls.length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['blocos', 'registro', 'toolCalls'], message: 'Referência repetida.' });
  if ((v.agente === null || v.blocos.ferramentas.some((f) => f.vinculo === 'nao_conferido')) && v.vinculos.estado !== 'parciais')
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['vinculos'], message: 'Referência não conferida exige diagnóstico parcial.' });
});

export type SessaoHistoricaConsulta = z.infer<typeof SessaoHistoricaConsultaSchema>;
export type SessaoHistoricaLista = z.infer<typeof SessaoHistoricaListaSchema>;
export type SessaoHistoricaTraco = z.infer<typeof SessaoHistoricaTracoSchema>;
