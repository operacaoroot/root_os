// SUPLEMENTO NOMINAL04b: orçamento antes do compromisso e histórico limitado; 04/DDL03b intactos.
import { z } from 'zod';
const Id = z.string().uuid().transform((v) => v.toLowerCase());
const Sha = z.string().regex(/^[a-f0-9]{64}$/);
const Git = z.string().regex(/^[a-f0-9]{40}$/);
const Positivo = z.number().int().positive();
const Geracao = z.string().regex(/^[1-9][0-9]*$/);
const Motivo = z.string().min(1).max(1000);
const Caminho = z.object({ caminhoUtf8: z.string().min(1).max(1000), caminhoBytesHex: z.string().regex(/^(?:[a-f0-9]{2}){1,4096}$/) }).strict().superRefine((p,ctx) => {
  const bytes = new TextEncoder().encode(p.caminhoUtf8);
  const hex = [...bytes].map((v) => v.toString(16).padStart(2,'0')).join('');
  const decoded = new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if (decoded!==p.caminhoUtf8 || hex!==p.caminhoBytesHex || bytes.length>4096 || p.caminhoUtf8.startsWith('/')
    || p.caminhoUtf8.includes('\0') || p.caminhoUtf8.split('/').some((v) => !v || v==='.' || v==='..'))
    ctx.addIssue({code:z.ZodIssueCode.custom,message:'Informe um caminho relativo elegível com os bytes UTF8 exatos.'});
});
function limitada<T extends z.ZodTypeAny>(schema:T): z.ZodEffects<T,z.output<T>,z.input<T>> {
  return schema.superRefine((v,ctx) => {
    if (new TextEncoder().encode(JSON.stringify(v)).byteLength>65536)
      ctx.addIssue({code:z.ZodIssueCode.custom,message:'O documento excede 64 KiB.'});
  });
}
const Escopo = z.object({orgId:Id,actorId:Id}).strict();
const MarcaCatalogo = z.object({repositorioId:Sha,head:Git,indiceHash:Sha,indiceModificadoEm:z.number().finite().nonnegative()}).strict();
const Referencia = z.object({versionId:Id,versao:Positivo,contentHash:Sha}).strict();
const Origem = z.object({chave:z.string().min(7).max(1400),sourceRef:z.string().min(1).max(1000),caminho:Caminho}).strict();
const ProvaMembro = z.object({id:Id,chave:z.string().min(7).max(1400),caminho:Caminho,blobGit:Git,hashArquivo:Sha,contentHash:Sha,metadataHash:Sha}).strict();
const Selecao = z.object({id:Id,colecaoId:z.string().min(1).max(400),geracao:Geracao,membershipDigest:Sha,marca:MarcaCatalogo,membro:ProvaMembro}).strict();
export const MovimentoExplicitoPreviaSchema = limitada(z.object({
  itemId:Id,expectedItemVersion:Positivo,selectedVersionId:Id,selectedContentHash:Sha,
  oldSelectionId:Id,oldMemberId:Id,destino:Caminho,motivo:Motivo,
}).strict());
export type MovimentoExplicitoPrevia = z.infer<typeof MovimentoExplicitoPreviaSchema>;
export const MovimentoExplicitoPreviaResultadoSchema = limitada(z.object({
  escopo:Escopo,itemId:Id,colecaoId:z.string().min(1).max(400),
  atual:Referencia.extend({chave:z.string(),sourceType:z.literal('vault'),sourceRef:z.string()}).strict(),
  escolhida:Referencia,oldSelection:Selecao,origem:Origem,destino:Origem,payload:MovimentoExplicitoPreviaSchema,marcaServer:Sha,
}).strict());
export type MovimentoExplicitoPreviaResultado = z.infer<typeof MovimentoExplicitoPreviaResultadoSchema>;
export const MovimentoExplicitoIntencaoSchema = limitada(z.object({requestId:Id,marcaServer:Sha,payload:MovimentoExplicitoPreviaSchema}).strict());
export type MovimentoExplicitoIntencao = z.infer<typeof MovimentoExplicitoIntencaoSchema>;
const PedidoPendente = z.object({requestId:Id,expectedIntentRevision:z.literal(1),intentMark:Sha}).strict();
export const MovimentoExplicitoCapturarSchema = limitada(PedidoPendente);
export type MovimentoExplicitoCaptura = z.infer<typeof MovimentoExplicitoCapturarSchema>;
const ProvaCandidata = Selecao.extend({candidateId:Id,captureMarkHash:Sha}).strict();
export const MovimentoExplicitoConfirmarSchema = limitada(PedidoPendente.extend({newSelection:ProvaCandidata,aprovacao:z.literal(true)}).strict());
export type MovimentoExplicitoConfirmar = z.infer<typeof MovimentoExplicitoConfirmarSchema>;
export const MovimentoExplicitoCancelarPreviaSchema = limitada(PedidoPendente.extend({currentItemVersion:Positivo,motivo:Motivo}).strict());
export const MovimentoExplicitoCancelarSchema = limitada(PedidoPendente.extend({currentItemVersion:Positivo,marcaCancelamento:Sha,cancelSelection:ProvaCandidata,motivo:Motivo}).strict());
export type MovimentoExplicitoCancelar = z.infer<typeof MovimentoExplicitoCancelarSchema>;
const Disponibilidade = z.object({itemId:Id,versao:Positivo,chaveAtual:z.string(),arquivada:z.boolean(),movimentoPendente:z.boolean(),novoUsoPermitido:z.boolean()}).strict();
const Evento = z.object({id:Id,seq:Geracao,hash:Sha,tipo:z.literal('memoria.item.alterado')}).strict();
const IdentidadeRecibo = z.object({schemaVersion:z.literal(1),id:Id,orgId:Id,actorId:Id,itemId:Id,intentId:Id,requestId:Id,
  criadoEm:z.string().datetime(),origem:Origem,destino:Origem,escolhida:Referencia,anterior:Referencia,
  oldSelection:Selecao,candidate:ProvaCandidata,auditIds:z.array(Id).min(1).max(32),receiptHash:Sha}).strict();
const ReciboConfirmado = IdentidadeRecibo.extend({tipo:z.literal('confirmado'),nova:Referencia,aliasId:Id,eventSnapshot:Evento}).strict();
const ReciboCancelado = IdentidadeRecibo.extend({tipo:z.literal('cancelado'),currentItemVersion:Positivo,retorno:Referencia,motivo:Motivo,marcaCancelamento:Sha}).strict();
export const MovimentoExplicitoReciboSchema = limitada(z.discriminatedUnion('tipo',[ReciboConfirmado,ReciboCancelado]));
export type MovimentoExplicitoRecibo = z.infer<typeof MovimentoExplicitoReciboSchema>;
const Candidata = z.object({id:Id,purpose:z.enum(['movimento','retorno']),prova:ProvaCandidata,atual:z.boolean(),capturadaEm:z.string().datetime()}).strict();
const IntencaoPublica = z.object({id:Id,requestId:Id,itemId:Id,revision:z.literal(1),intentMark:Sha,previa:MovimentoExplicitoPreviaResultadoSchema,criadaEm:z.string().datetime()}).strict();
export const MovimentoExplicitoResultadoSchema = limitada(z.discriminatedUnion('estado',[
 z.object({estado:z.literal('pendente_de_captura_verificada'),escopo:Escopo,intencao:IntencaoPublica,candidatos:z.array(Candidata).max(2),historicoDeCandidatos:z.object({modo:z.literal('ultimo_por_proposito'),total:z.string().regex(/^(?:0|[1-9][0-9]*)$/),parcial:z.boolean()}).strict(),disponibilidadeAtual:Disponibilidade,replayed:z.boolean()}).strict(),
 z.object({estado:z.literal('confirmado'),escopo:Escopo,recibo:ReciboConfirmado,disponibilidadeAtual:Disponibilidade,replayed:z.boolean()}).strict(),
 z.object({estado:z.literal('cancelado'),escopo:Escopo,recibo:ReciboCancelado,disponibilidadeAtual:Disponibilidade,replayed:z.boolean()}).strict(),
 z.object({estado:z.literal('ausencia_conferida'),escopo:Escopo,requestId:Id}).strict(),
]));
export type MovimentoExplicitoResultado = z.infer<typeof MovimentoExplicitoResultadoSchema>;
export const MovimentoExplicitoCancelamentoPreviaResultadoSchema = limitada(z.object({escopo:Escopo,intentId:Id,requestId:Id,currentItemVersion:Positivo,
 intentMark:Sha,marcaCancelamento:Sha,cancelSelection:ProvaCandidata,origemRestaurada:z.literal(true),destinoAusente:z.literal(true),motivo:Motivo}).strict());
export const AliasDoContextoSchema = limitada(z.object({escopo:Escopo,aliasId:Id,intentId:Id,itemId:Id,collectionId:z.string().min(1).max(400),
 chaveConsultada:z.string(),chaveCanonicaAtual:z.string(),disponibilidadeAtual:Disponibilidade}).strict());
export type AliasDoContexto = z.infer<typeof AliasDoContextoSchema>;

// Consulta restrita à instância do mesmo item; org/actor são resolvidos no servidor.
export const AliasDoContextoConsultaSchema = z.object({itemId:Id,chave:z.string().min(7).max(1400)}).strict();
export type AliasDoContextoConsulta = z.infer<typeof AliasDoContextoConsultaSchema>;
export type MovimentoExplicitoCancelarPrevia = z.infer<typeof MovimentoExplicitoCancelarPreviaSchema>;
export type MovimentoExplicitoCancelamentoPreviaResultado = z.infer<typeof MovimentoExplicitoCancelamentoPreviaResultadoSchema>;
export type MovimentoExplicitoCapturar = MovimentoExplicitoCaptura;
