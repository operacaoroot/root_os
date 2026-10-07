import { z } from 'zod';

/*
 * A ENTRADA DE LEAD (ROOT-48, contrato C-01) — o que a tela, a API e o teste
 * entendem do mesmo pedido.
 *
 * A entrada é idempotente e por ORIGEM: o mesmo `{tipo, ref}` é sempre o mesmo
 * lead. O pedido não leva etapa nem próxima ação — essas duas continuam na
 * rota com `x-approval-token`, e nenhuma entrada grava `Lead.status` (C-01,
 * "Estado").
 *
 * Os campos copiados para o Lead saem de uma lista fechada (o `.strict()` abaixo
 * recusa o resto). Da fila de comentários da Pauta, o Lead leva só o que o
 * operador mandou ou escolheu: a palavra, o post e a data vão para o EVENTO de
 * entrada; o @ vai para o nome SOMENTE quando `incluirUsuario` vem ligado — o
 * clique humano que estende o prazo de retenção da MD9 (E6). O HMAC da pessoa
 * e o id do comentário na Meta nunca saem da Pauta.
 */

export const LEAD_ORIGEM_TIPOS = ['clickup', 'pauta-comentario', 'pixel', 'manual'] as const;
export const LeadOrigemTipoSchema = z.enum(LEAD_ORIGEM_TIPOS);
export type LeadOrigemTipo = z.infer<typeof LeadOrigemTipoSchema>;

/** Tipos de origem que moram na Pauta: exigem `pauta.ver` e o módulo `pauta`, além de `leads.editar`. */
export const LEAD_ORIGENS_DA_PAUTA: readonly LeadOrigemTipo[] = ['pauta-comentario'];

const texto = (max: number) => z.string().trim().min(1).max(max);

export const LeadOrigemSchema = z
  .object({
    tipo: LeadOrigemTipoSchema,
    /**
     * `clickup`: o id da tarefa; `pauta-comentario`: o `ComentarioComPalavra.id`
     * (nunca o id do comentário na Meta nem o @); `pixel`: o `anonymousId`;
     * `manual`: a chave do pedido, gerada pela tela.
     */
    ref: texto(200),
  })
  .strict();
export type LeadOrigem = z.infer<typeof LeadOrigemSchema>;

export const LeadEntradaSchema = z
  .object({
    origem: LeadOrigemSchema,
    nome: texto(200).optional(),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    telefone: texto(40).optional(),
    campaignId: texto(64).optional(),
    sourceKey: texto(80).optional(),
    ownerId: texto(64).optional(),
    utmSource: texto(200).optional(),
    utmMedium: texto(200).optional(),
    utmCampaign: texto(200).optional(),
    utmContent: texto(200).optional(),
    utmTerm: texto(200).optional(),
    landingPage: texto(2000).optional(),
    /** Só `pauta-comentario`: leva o @ de quem comentou para o nome do lead. É o clique humano da MD9. */
    incluirUsuario: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const daPauta = LEAD_ORIGENS_DA_PAUTA.includes(v.origem.tipo);
    if (v.incluirUsuario !== undefined && v.origem.tipo !== 'pauta-comentario') {
      ctx.addIssue({ code: 'custom', path: ['incluirUsuario'], message: 'incluirUsuario só vale para a origem pauta-comentario' });
    }
    if (v.incluirUsuario && v.nome !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['nome'], message: 'Use nome ou incluirUsuario, não os dois' });
    }
    // O Lead exige nome. Pauta e pixel têm um nome neutro de reserva; as outras origens precisam trazer.
    if (v.nome === undefined && !daPauta && v.origem.tipo !== 'pixel') {
      ctx.addIssue({ code: 'custom', path: ['nome'], message: 'Informe o nome do lead' });
    }
  });
export type LeadEntradaInput = z.infer<typeof LeadEntradaSchema>;

/** Campos que a entrada compara com o lead já existente (o que "mudou" entre dois pedidos da mesma origem). */
export const LEAD_CAMPOS_DA_ENTRADA = [
  'name',
  'email',
  'phone',
  'campaignId',
  'sourceId',
  'ownerId',
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'utmContent',
  'utmTerm',
  'landingPage',
] as const;
export type LeadCampoDaEntrada = (typeof LEAD_CAMPOS_DA_ENTRADA)[number];

export type LeadDiferencaDaEntrada = Partial<Record<LeadCampoDaEntrada, { atual: string | null; recebido: string }>>;

export interface LeadEntradaResposta {
  id: string;
  /** Este pedido criou o lead. */
  criado: boolean;
  /** O mesmo pedido já tinha sido gravado: nada mudou, nenhum evento novo. */
  replayed: boolean;
  /** Mesma origem, conteúdo diferente: o que chegou e o lead preservou. Nulo quando não há diferença. */
  diferenca: LeadDiferencaDaEntrada | null;
  eventoId: string;
}

export const LeadTrocaDeDonoSchema = z
  .object({
    ownerId: texto(64).nullable(),
    motivo: texto(280).optional(),
  })
  .strict();
export type LeadTrocaDeDonoInput = z.infer<typeof LeadTrocaDeDonoSchema>;
