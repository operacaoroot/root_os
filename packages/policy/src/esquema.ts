import { z } from 'zod';

/*
 * Esquema do documento de política. Existe para que um catálogo malformado
 * seja recusado ANTES de virar decisão — e não no meio de uma execução, com
 * `avaliar()` recebendo lixo e devolvendo R5 para tudo.
 *
 * Os tipos são os mesmos de escada.ts, que é cópia byte a byte do anexo
 * normativo. Se divergirem, o typecheck acusa: NivelSchema, EfeitoSchema e
 * CapacidadeSchema são conferidos contra os tipos importados no fim do arquivo.
 */

export const NivelSchema = z.enum(['R0', 'R1', 'R2', 'R3', 'R4', 'R5']);
export const AlcadaSchema = z.enum(['operador', 'responsavel', 'titular']);

export const SinalSchema = z.enum([
  'destinatario_novo',
  'fora_da_janela',
  'volume_atipico',
  'fonte_nao_confiavel',
  'erro_recente',
  'valor_acima_do_limite',
]);

export const EfeitoSchema = z.object({
  escreveForaDoOS: z.boolean(),
  produzArtefato: z.boolean(),
  reversibilidade: z.enum(['automatica', 'manual', 'nenhuma']),
  exposicaoExterna: z.boolean(),
  impactoFinanceiro: z.enum(['nenhum', 'obrigacao', 'movimento']),
  sensibilidade: z.enum(['publica', 'interna', 'confidencial', 'restrita']),
  destruicao: z.boolean(),
  obrigacaoLegal: z.boolean(),
  alcance: z.number().int().positive().optional(),
});

export const CapacidadeSchema = z.object({
  id: z.string().min(1),
  descricao: z.string().min(1),
  nivel: NivelSchema,
  efeito: EfeitoSchema,
  desfazer: z.string().optional(),
  /**
   * Nome da ferramenta como o modelo a enxerga. A API de tool-calling só aceita
   * [a-zA-Z0-9_-], então nunca é o id pontuado. Ausente = capacidade que existe
   * na política mas nenhum agente alcança.
   */
  ferramenta: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional(),
  /** `MÉTODO /caminho` da rota que implementa. Ausente = declarada e não implementada. */
  rota: z.string().optional(),
});

export const AprovacaoSchema = z.object({
  exigida: z.enum(['nunca', 'configuravel', 'sempre']),
  vinculo: z.enum(['nenhum', 'conteudo']),
  usoUnico: z.boolean(),
  validadeSegundos: z.number().int().nonnegative(),
  reautenticacao: z.boolean(),
  alcadaMinima: AlcadaSchema,
});

export const LimitesSchema = z.object({
  porExecucao: z.number().int().positive(),
  porHora: z.number().int().positive(),
  porDia: z.number().int().positive(),
  janelaHoraria: z.tuple([z.string(), z.string()]),
  tetoCustoCentavosPorExecucao: z.number().int().nonnegative(),
});

export const PoliticaSchema = z.object({
  versao: z.string(),
  atualizadoEm: z.string(),
  origem: z.string(),
  descricao: z.string(),
  niveis: z.record(
    NivelSchema,
    z.object({
      nome: z.string(),
      escreve: z.boolean(),
      bloqueado: z.boolean(),
      aprovacao: AprovacaoSchema,
      rastro: z.array(z.string()),
    }),
  ),
  gatilhos: z.record(z.string(), z.unknown()),
  escalonamento: z.object({
    regra: z.string(),
    sinais: z.array(z.object({ id: SinalSchema, descricao: z.string() })),
  }),
  invariantes: z.array(z.string()).min(1),
  limitesPadrao: LimitesSchema,
  retencao: z.record(z.string(), z.unknown()),
  capacidades: z.array(CapacidadeSchema).min(1),
});

export type Politica = z.infer<typeof PoliticaSchema>;

/*
 * Um DELTA não repete a política inteira: declara só o que é dele e herda o
 * resto. É o mesmo mecanismo em dois lugares — o catálogo deste repositório
 * é um delta sobre a base ROOT, e a política de cada empresa será um delta
 * sobre a base herdada. Repetir os níveis e os gatilhos em cada arquivo seria
 * garantir que um dia divergem.
 */
export const DeltaPoliticaSchema = z.object({
  versao: z.string(),
  atualizadoEm: z.string(),
  origem: z.string(),
  descricao: z.string(),
  estende: z.string(),
  limitesPadrao: LimitesSchema.partial().optional(),
  capacidades: z.array(CapacidadeSchema).default([]),
});

export type DeltaPolitica = z.infer<typeof DeltaPoliticaSchema>;

/**
 * Aplica o delta sobre a base. Capacidade com o mesmo id SOBRESCREVE a da base
 * — é como um cliente endurece (nunca afrouxa em silêncio: quem checa se o
 * nível desceu é o serviço, que exige motivo escrito e gera evento).
 */
export function resolverPolitica(base: Politica, delta: DeltaPolitica): Politica {
  const porId = new Map(base.capacidades.map((c) => [c.id, c]));
  for (const c of delta.capacidades) porId.set(c.id, c);
  return {
    ...base,
    versao: delta.versao,
    atualizadoEm: delta.atualizadoEm,
    origem: `${delta.origem} (estende ${delta.estende})`,
    descricao: delta.descricao,
    limitesPadrao: { ...base.limitesPadrao, ...(delta.limitesPadrao ?? {}) },
    capacidades: [...porId.values()],
  };
}

export function lerDelta(bruto: unknown, origem: string): DeltaPolitica {
  const r = DeltaPoliticaSchema.safeParse(bruto);
  if (r.success) return r.data;
  const erros = r.error.issues.map((i) => `  ${i.path.join('.') || '(raiz)'}: ${i.message}`);
  throw new Error(`delta de política inválido em ${origem}:\n${erros.join('\n')}`);
}

/** Lança com o caminho do campo quebrado — nunca devolve documento meio válido. */
export function lerPolitica(bruto: unknown, origem: string): Politica {
  const r = PoliticaSchema.safeParse(bruto);
  if (r.success) return r.data;
  const erros = r.error.issues.map((i) => `  ${i.path.join('.') || '(raiz)'}: ${i.message}`);
  throw new Error(`política inválida em ${origem}:\n${erros.join('\n')}`);
}
