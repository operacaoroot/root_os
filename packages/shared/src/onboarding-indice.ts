import { z } from 'zod';
const Id=z.string().uuid();
const Positivo=z.number().int().positive().safe();
const N=z.number().int().nonnegative().safe();
const Iso=z.string().datetime();
export const IndiceEscopoHumanoSchema=z.object({orgId:Id,userId:Id}).strict();
export const EspelhoOnboardingFonteSchema=z.object({
 tipo:z.literal('onboarding'),orgId:Id,itemId:Id,versionId:Id,versao:Positivo,
 chave:z.string().min(1),sourceType:z.enum(['operador','promocao']),
 sourceRef:z.string().nullable(),contentHash:z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type EspelhoOnboardingFonte=z.infer<typeof EspelhoOnboardingFonteSchema>;
export const ContagemIndiceOnboardingSchema=z.discriminatedUnion('estado',[
 z.object({estado:z.literal('conferida'),escopo:IndiceEscopoHumanoSchema,
  total:N,comVetor:N,observadoEm:Iso}).strict(),
 z.object({estado:z.literal('nao_conferida'),total:z.null(),comVetor:z.null(),
  motivo:z.enum(['solicitante_nao_identificado','autoridade_nao_conferida']),observadoEm:Iso}).strict(),
]).superRefine((r,c)=>{
 if(r.estado==='conferida'&&r.comVetor>r.total)
  c.addIssue({code:z.ZodIssueCode.custom,message:'A contagem de vetores não pode superar o total elegível.'});
});
// A observação associa a fonte aplicada ao índice físico conferido.
export const EspelhoOnboardingObservacaoSchema=z.object({
 estado:z.enum(['concluido','nao_conferido','falhou']),
 fonte:EspelhoOnboardingFonteSchema.nullable(),
 indice:z.object({id:Id,path:z.string().min(1),indexedAt:Iso}).strict().nullable(),
 observadoEm:Iso,
}).strict().superRefine((r,c)=>{
 if(r.estado==='concluido'&&(!r.fonte||!r.indice))
  c.addIssue({code:z.ZodIssueCode.custom,message:'Informe fonte e índice realmente aplicados.'});
});
// Sem pedido/ledger causal. GET atual não confirma PUT perdido.

export type IndiceEscopoHumano = z.infer<typeof IndiceEscopoHumanoSchema>;
export type ContagemIndiceOnboarding = z.infer<typeof ContagemIndiceOnboardingSchema>;
export type EspelhoOnboardingObservacao = z.infer<typeof EspelhoOnboardingObservacaoSchema>;
