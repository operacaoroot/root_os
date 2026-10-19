import { z } from 'zod';
import {
  PAUTA_AUTOMACOES, PAUTA_DIAS_DA_SEMANA, PAUTA_FORMATOS_DA_SEMANA,
  PautaChaveDaVozSchema, PautaMesSchema, PautaMarcaSalvarSchema,
  PautaPilaresSalvarSchema, PautaVozSalvarSchema, PautaEstrategiaSalvarSchema,
  PautaRelatorioSalvarSchema, PautaGradeSalvarSchema, PautaAutomacaoSalvarSchema,
} from './schemas.js';

const positivo = z.number().int().positive().safe();
const uuid = z.string().uuid();
const iso = z.string().datetime();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const kind = z.enum(['regra', 'definicao', 'dicionario', 'decisao', 'fato', 'nota']);
const origem = z.object({
  tipo: z.enum(['vault', 'upload', 'promocao', 'operador', 'conector']),
  referencia: z.string().nullable(),
}).strict();

export const PautaEscopoHumanoSchema = z.object({ orgId: uuid, actorId: uuid }).strict();
export type PautaEscopoHumano = z.infer<typeof PautaEscopoHumanoSchema>;
export const PautaAutoridadeHumanaSchema = z.object({
  ler: z.literal(true), editar: z.boolean(), verificadaEm: iso,
}).strict();
const baseAusente = {
  estado: z.literal('ausente'), tipo: z.literal('nota_memoria'), chave: z.string().min(1),
  itemId: z.null(), kind: z.null(), arquivada: z.null(), origem: z.null(),
};
const baseExistente = {
  estado: z.literal('existente'), tipo: z.literal('nota_memoria'), chave: z.string().min(1),
  itemId: uuid, kind, arquivada: z.boolean(), origem,
};
export const PautaBaseHumanaSchema = z.discriminatedUnion('estado', [
  z.object(baseAusente).strict(), z.object(baseExistente).strict(),
]);
export type PautaBaseHumana = z.infer<typeof PautaBaseHumanaSchema>;
export const PautaDestinoFisicoSchema = z.discriminatedUnion('estado', [
  z.object({ ...baseAusente, versao: z.null(), conteudo: z.null() }).strict(),
  z.object({ ...baseExistente, versao: positivo, conteudo: z.object({
    titulo: z.string(), corpo: z.string(),
  }).strict() }).strict(),
]);
export type PautaDestinoFisico = z.infer<typeof PautaDestinoFisicoSchema>;
const baseShape = {
  escopoEsperado: PautaEscopoHumanoSchema,
  baseEsperada: PautaBaseHumanaSchema,
  versaoEsperada: positivo.nullable(),
  reativar: z.boolean(),
};
const baseObject = z.object(baseShape).strict();
function conferirBase(entrada: z.infer<typeof baseObject>, ctx: z.RefinementCtx): void {
  if (entrada.baseEsperada.estado === 'ausente') {
    if (entrada.versaoEsperada !== null) ctx.addIssue({ code: z.ZodIssueCode.custom,
      path: ['versaoEsperada'], message: 'Uma nota ausente exige versão nula.' });
    if (entrada.reativar) ctx.addIssue({ code: z.ZodIssueCode.custom,
      path: ['reativar'], message: 'Uma nota ausente não pode ser reativada.' });
  } else {
    if (entrada.versaoEsperada === null) ctx.addIssue({ code: z.ZodIssueCode.custom,
      path: ['versaoEsperada'], message: 'Informe a versão esperada da nota.' });
    if (!entrada.baseEsperada.arquivada && entrada.reativar) ctx.addIssue({ code: z.ZodIssueCode.custom,
      path: ['reativar'], message: 'Esta nota já está ativa.' });
  }
}
export const PautaEscritaHumanaBaseSchema = baseObject.superRefine(conferirBase);
export type PautaEscritaHumanaBase = z.infer<typeof PautaEscritaHumanaBaseSchema>;
export const PautaMarcaSalvarHumanoSchema = z.object({
  ...baseShape, perfil: PautaMarcaSalvarSchema.shape.perfil,
}).strict().superRefine(conferirBase);
export type PautaMarcaSalvarHumanoInput = z.infer<typeof PautaMarcaSalvarHumanoSchema>;
export const PautaPilaresSalvarHumanoSchema = z.object({
  ...baseShape, pilares: PautaPilaresSalvarSchema.shape.pilares,
}).strict().superRefine(conferirBase);
export type PautaPilaresSalvarHumanoInput = z.infer<typeof PautaPilaresSalvarHumanoSchema>;
export const PautaVozSalvarHumanoSchema = z.object({
  ...baseShape, perfil: PautaVozSalvarSchema.shape.perfil,
  motivo: PautaVozSalvarSchema.shape.motivo, chaveVozEsperada: PautaChaveDaVozSchema,
}).strict().superRefine(conferirBase);
export type PautaVozSalvarHumanoInput = z.infer<typeof PautaVozSalvarHumanoSchema>;
export const PautaEstrategiaSalvarHumanoSchema = z.object({
  ...baseShape, documento: PautaEstrategiaSalvarSchema.shape.documento, mesEsperado: PautaMesSchema,
}).strict().superRefine(conferirBase);
export type PautaEstrategiaSalvarHumanoInput = z.infer<typeof PautaEstrategiaSalvarHumanoSchema>;
export const PautaRelatorioSalvarHumanoSchema = z.object({
  ...baseShape, documento: PautaRelatorioSalvarSchema.shape.documento, mesEsperado: PautaMesSchema,
}).strict().superRefine(conferirBase);
export type PautaRelatorioSalvarHumanoInput = z.infer<typeof PautaRelatorioSalvarHumanoSchema>;
export const PautaGradeSalvarHumanoSchema = z.object({
  ...baseShape, texto: PautaGradeSalvarSchema.shape.texto,
}).strict().superRefine(conferirBase);
export type PautaGradeSalvarHumanoInput = z.infer<typeof PautaGradeSalvarHumanoSchema>;
export const PautaVozChaveHumanaSchema = z.object({
  ...baseShape, chave: PautaChaveDaVozSchema, chaveEfetivaEsperada: PautaChaveDaVozSchema,
}).strict().superRefine(conferirBase);
export type PautaVozChaveHumanaInput = z.infer<typeof PautaVozChaveHumanaSchema>;
export const PautaAutomacaoSalvarHumanoSchema = z.object({
  ...baseShape, qualEsperado: z.enum(PAUTA_AUTOMACOES),
  ligada: PautaAutomacaoSalvarSchema.shape.ligada,
  motivo: PautaAutomacaoSalvarSchema.shape.motivo,
}).strict().superRefine(conferirBase);
export type PautaAutomacaoSalvarHumanoInput = z.infer<typeof PautaAutomacaoSalvarHumanoSchema>;

export const PautaTetoDaRespostaHumanaDaCarga = 4_000;
export function normalizarRespostaHumanaDaCarga(resposta: string): string {
  return resposta.replace(/\r\n/g, '\n').trim();
}
export const OnboardingRespostaHumanaSchema = z.object({
  ...baseShape, tema: z.string().trim().min(1).max(60),
  resposta: z.string().min(1).max(20_000).superRefine((texto, ctx) => {
    const tamanho = Array.from(normalizarRespostaHumanaDaCarga(texto)).length;
    if (tamanho === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Escreva a resposta antes de salvar.' });
    if (tamanho > PautaTetoDaRespostaHumanaDaCarga) ctx.addIssue({ code: z.ZodIssueCode.custom,
      message: 'A resposta tem no máximo 4.000 pontos de código. Encurte o texto antes de salvar.' });
  }),
}).strict().superRefine(conferirBase);
export type OnboardingRespostaHumanaInput = z.infer<typeof OnboardingRespostaHumanaSchema>;

const secao = z.object({ titulo: z.string(), hash }).strict();
const vinculo = z.object({
  versaoDestino: positivo, fonteContextItemId: uuid, fonteChave: z.string(),
  fonteVersao: positivo, fonteHash: hash, secoesUsadas: z.array(secao), atual: z.boolean(),
}).strict();
const marcaPainel = z.object({
  perfil: z.string().nullable(), perfilVersao: positivo.nullable(), perfilAtualizadoEm: iso.nullable(),
  pilaresTexto: z.string(), pilaresVersao: positivo.nullable(),
  pilares: z.array(z.object({ nome: z.string(), chave: z.string(), cor: z.string(), descricao: z.string() }).strict()),
  avisos: z.array(z.string()), bloco: z.string(),
  projecoes: z.object({ perfil: vinculo.nullable(), pilares: vinculo.nullable() }).strict(),
}).strict();
const vozPainel = z.object({
  chave: PautaChaveDaVozSchema, origemDaChave: z.enum(['empresa', 'padrao']),
  perfil: z.object({
    id: uuid, corpo: z.string(), versao: positivo, procedencia: z.string(), sourceType: z.string(),
    sourceRef: z.string().nullable(), atualizadoEm: iso, arquivado: z.boolean(),
  }).strict().nullable(),
  historico: z.array(z.object({ versao: positivo, mudanca: z.string(), procedencia: z.string(),
    motivo: z.string().nullable(), criadoEm: iso }).strict()),
  regrasDaMarca: z.array(z.string()),
  episodios: z.array(z.object({ id: uuid, apelido: z.string(), titulo: z.string(), caracteres: z.number().int().nonnegative() }).strict()),
  iaConfigurada: z.boolean(),
}).strict();
const documentoPainel = {
  mes: PautaMesSchema, documento: z.string(), versao: positivo.nullable(), atualizadoEm: iso.nullable(),
  origem: z.string().nullable(), meses: z.array(PautaMesSchema), avisos: z.array(z.string()), iaConfigurada: z.boolean(),
};
const gradePainel = z.object({
  grade: z.object({ slots: z.array(z.object({
    formato: z.enum(PAUTA_FORMATOS_DA_SEMANA), dia: z.enum(PAUTA_DIAS_DA_SEMANA),
    hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  }).strict()), feriados: z.array(z.string()) }).strict(),
  texto: z.string(), origem: z.enum(['empresa', 'padrao']), versao: positivo.nullable(), avisos: z.array(z.string()),
}).strict();
const envelope = { contrato: z.literal(1), escopo: PautaEscopoHumanoSchema,
  autoridade: PautaAutoridadeHumanaSchema, observadoEm: iso };
export const PautaMarcaHumanoPainelSchema = z.object({
  ...envelope, painel: marcaPainel,
  destinos: z.object({ perfil: PautaDestinoFisicoSchema, pilares: PautaDestinoFisicoSchema }).strict(),
  origemEfetiva: z.discriminatedUnion('tipo', [
    z.object({ tipo: z.literal('legado'), brandbook: z.null() }).strict(),
    z.object({ tipo: z.literal('brandbook'), brandbook: z.object({ id: uuid, versao: positivo, draftHash: hash }).strict() }).strict(),
  ]),
}).strict();
export type PautaMarcaHumanoPainel = z.infer<typeof PautaMarcaHumanoPainelSchema>;
export const PautaVozHumanoPainelSchema = z.object({
  ...envelope, painel: vozPainel,
  destinos: z.object({ perfil: PautaDestinoFisicoSchema, configuracao: PautaDestinoFisicoSchema }).strict(),
  configuracao: z.object({ chaveEfetiva: PautaChaveDaVozSchema, origemEfetiva: z.enum(['empresa', 'padrao']) }).strict(),
}).strict();
export type PautaVozHumanoPainel = z.infer<typeof PautaVozHumanoPainelSchema>;
export const PautaEstrategiaHumanoPainelSchema = z.object({
  ...envelope, mes: PautaMesSchema, painel: z.object(documentoPainel).strict(),
  destinos: z.object({ documento: PautaDestinoFisicoSchema }).strict(),
}).strict();
export type PautaEstrategiaHumanoPainel = z.infer<typeof PautaEstrategiaHumanoPainelSchema>;
export const PautaRelatorioHumanoPainelSchema = z.object({
  ...envelope, mes: PautaMesSchema,
  painel: z.object({ ...documentoPainel, publicadas: z.number().int().nonnegative() }).strict(),
  destinos: z.object({ documento: PautaDestinoFisicoSchema }).strict(),
}).strict();
export type PautaRelatorioHumanoPainel = z.infer<typeof PautaRelatorioHumanoPainelSchema>;
export const PautaGradeHumanoPainelSchema = z.object({
  ...envelope, painel: gradePainel, destinos: z.object({ grade: PautaDestinoFisicoSchema }).strict(),
}).strict();
export type PautaGradeHumanoPainel = z.infer<typeof PautaGradeHumanoPainelSchema>;
export const PautaAutomacaoHumanoPainelSchema = z.object({
  ...envelope, qual: z.enum(PAUTA_AUTOMACOES), destino: PautaDestinoFisicoSchema,
  operacao: z.object({ ligada: z.boolean(), origem: z.enum(['nota', 'padrao']),
    rotina: z.object({ existe: z.boolean(), dispara: z.boolean(), nome: z.string().nullable(), calada: z.string().nullable() }).strict().nullable(),
    podeLigar: z.boolean(), impedimentos: z.array(z.string()),
  }).strict(),
}).strict();
export type PautaAutomacaoHumanoPainel = z.infer<typeof PautaAutomacaoHumanoPainelSchema>;
export const OnboardingTemaHumanoPainelSchema = z.object({
  ...envelope, tema: z.string(), rotulo: z.object({ titulo: z.string(), pergunta: z.string() }).strict(),
  destino: PautaDestinoFisicoSchema,
  usoNaCarga: z.object({ contaComoRespondido: z.boolean(), precisaAprofundar: z.boolean() }).strict(),
}).strict();
export type OnboardingTemaHumanoPainel = z.infer<typeof OnboardingTemaHumanoPainelSchema>;
const edicao = z.object({ itemId: uuid, versionId: uuid, versao: positivo }).strict();
export const PautaEscritaHumanaResultadoSchema = z.object({
  escopo: PautaEscopoHumanoSchema,
  acao: z.enum(['salvar_perfil_marca', 'salvar_pilares', 'salvar_voz', 'salvar_estrategia', 'salvar_relatorio', 'salvar_grade', 'mudar_interruptor', 'mudar_chave_voz', 'responder_tema']),
  baseAplicada: z.object({ baseEsperada: PautaBaseHumanaSchema, versaoEsperada: positivo.nullable() }).strict(),
  edicao, reativacao: z.discriminatedUnion('solicitada', [
    z.object({ solicitada: z.literal(false), estado: z.literal('nao_solicitada'), versao: z.null(), versionId: z.null() }).strict(),
    z.object({ solicitada: z.literal(true), estado: z.literal('concluida'), versao: positivo, versionId: uuid }).strict(),
  ]),
  resultado: z.literal('concluido'), atomicidade: z.literal('commit_unico'),
  destinoFinal: z.object({ ...baseExistente, versao: positivo, conteudo: z.object({ titulo: z.string(), corpo: z.string() }).strict() }).strict(),
  registroMudanca: z.enum(['nao_conferido', 'registrado', 'falhou']),
}).strict();
export type PautaEscritaHumanaResultado = z.infer<typeof PautaEscritaHumanaResultadoSchema>;
export const OnboardingRespostaHumanaResultadoSchema = z.object({
  resultado: PautaEscritaHumanaResultadoSchema, tema: z.string(), estado: z.null(),
  espelho: z.enum(['nao_conferido', 'concluido', 'falhou']),
}).strict();
export type OnboardingRespostaHumanaResultado = z.infer<typeof OnboardingRespostaHumanaResultadoSchema>;
