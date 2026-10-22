import { z } from 'zod';

/*
 * A PROPOSTA É DO LEAD (rodada de produção 3, I5, 22/10/2026).
 *
 * Na tela Propostas a identidade da linha passa a ser o lead. A proposta da sala
 * já nasce de um lead; a do serviço de propostas (as antigas da ROOT, que moram
 * fora do OS) não tinha vínculo gravado e era casada pelo nome. Agora a pessoa
 * VINCULA a proposta a um lead da empresa ou CRIA o lead a partir dela, e o
 * vínculo fica gravado (`PropostaDoLead`, uma linha por proposta e empresa).
 *
 * A referência da proposta do serviço é `servico:<cliente>/<chave>`, com os
 * segmentos no formato que o serviço aceita. Vincular de novo ao mesmo lead não
 * muda nada; proposta já vinculada a outro lead é 409 com a frase.
 */

/** O segmento que o serviço de propostas aceita (o mesmo de `platform/propostas.service.ts`). */
export const SEGMENTO_DA_PROPOSTA = /^[A-Za-z0-9_-]{2,80}$/;
export const REF_DA_PROPOSTA_DO_SERVICO = /^servico:[A-Za-z0-9_-]{2,80}\/[A-Za-z0-9_-]{2,80}$/;

/** A referência gravada da proposta do serviço de propostas. */
export function refDaPropostaDoServico(cliente: string, chave: string): string | null {
  if (!SEGMENTO_DA_PROPOSTA.test(cliente) || !SEGMENTO_DA_PROPOSTA.test(chave)) return null;
  return `servico:${cliente}/${chave}`;
}

const Ref = z.string().trim().regex(REF_DA_PROPOSTA_DO_SERVICO, 'Proposta inválida.');

export const VincularPropostaSchema = z.object({
  proposta: Ref,
  leadId: z.string().trim().uuid('Lead inválido.'),
}).strict();
export type VincularPropostaInput = z.infer<typeof VincularPropostaSchema>;

export const CriarLeadDaPropostaSchema = z.object({
  proposta: Ref,
  nome: z.string().trim().min(1, 'Dê um nome ao lead.').max(200, 'O nome do lead tem até 200 caracteres.'),
}).strict();
export type CriarLeadDaPropostaInput = z.infer<typeof CriarLeadDaPropostaSchema>;

/** Como o vínculo nasceu: a pessoa escolheu um lead, ou criou o lead pela proposta. */
export type ComoNasceuOVinculo = 'vinculada' | 'criada';

export interface VinculoDaProposta {
  proposta: string;
  leadId: string;
  como: ComoNasceuOVinculo;
  em: string;
}

export interface VinculosDasPropostas {
  vinculos: VinculoDaProposta[];
}

export interface ResultadoDoVinculo {
  vinculo: VinculoDaProposta;
  /** Falso quando a proposta já estava vinculada a este lead (nada mudou). */
  mudou: boolean;
  /** Só no "Criar lead": o lead foi criado agora (falso quando já existia pela mesma proposta). */
  leadCriado?: boolean;
}

/** A frase do 409: a proposta já pertence a outro lead. */
export const PROPOSTA_JA_VINCULADA = 'Esta proposta já está vinculada a outro lead. Abra o lead dela para conferir.';
