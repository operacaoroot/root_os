import { z } from 'zod';

/*
 * AS PENDÊNCIAS (rodada dos agentes, 21/10/2026): a decisão que um agente ou
 * uma rotina deixa para uma pessoa, fora do funil do comercial (o arquivista
 * sem subpasta certa, o cobrador de tarefas, a triagem do WhatsApp com
 * confiança baixa, o vigia da agenda sem proposta segura). A tabela é
 * `Pendencia`; a caixa lê. Ver `apps/api/src/pendencias/`.
 */

export const OpcaoDaPendenciaSchema = z.object({
  chave: z.string().min(1).max(80),
  rotulo: z.string().min(1).max(200),
});
export type OpcaoDaPendencia = z.infer<typeof OpcaoDaPendenciaSchema>;

export const EstadoDaPendenciaSchema = z.enum(['aberta', 'resolvida', 'descartada']);
export type EstadoDaPendencia = z.infer<typeof EstadoDaPendenciaSchema>;

export const PendenciaSchema = z.object({
  id: z.string(),
  funcao: z.string(),
  tipo: z.string(),
  titulo: z.string(),
  contexto: z.string(),
  opcoes: z.array(OpcaoDaPendenciaSchema),
  paraUsuarioId: z.string().nullable(),
  refTipo: z.string().nullable(),
  refId: z.string().nullable(),
  estado: EstadoDaPendenciaSchema,
  escolha: z.string().nullable(),
  decididaPor: z.string().nullable(),
  decididaEm: z.string().nullable(),
  criadaEm: z.string(),
});
export type Pendencia = z.infer<typeof PendenciaSchema>;

export const PendenciasQuerySchema = z.object({
  estado: EstadoDaPendenciaSchema.optional(),
  /** `minhas` = as da pessoa e as sem destinatário; `todas` = da empresa. */
  de: z.enum(['minhas', 'todas']).optional(),
});

export const ResponderPendenciaSchema = z.object({
  escolha: z.string().min(1).max(80),
  /** Texto livre quando a opção pede (ex.: o nome do cliente que faltou). */
  complemento: z.string().max(500).optional(),
});
export type ResponderPendencia = z.infer<typeof ResponderPendenciaSchema>;
