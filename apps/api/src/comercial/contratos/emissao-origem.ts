import { TABELA_DE_PRECO, type ComercialProduto } from '@mktos/shared';
import type { PrismaService } from '../../prisma/prisma.service';
import { hashDoContrato, montarContrato } from '../contrato-modelo';
import type { AceiteDoLead } from '../dinheiro.service';
import { aceiteDaDeclaracao } from '../fechado-fora';
import type { FormaDeCobranca } from '../portas/cobranca.port';
import { montarPdfDoRegistro, rootsSemAlcada } from './documento-do-registro';

type Banco = Pick<PrismaService, 'comercialContrato'|'comercialDocumento'|'comercialFicha'|'leadEvent'|'user'>;
type P = Record<string, unknown>;
const invalidar = () => new Error('A origem ou o conteúdo da emissão mudou: nada foi enviado.');

/** Relê a origem da emissão. Não concede autorização nem inicia efeito externo. */
export async function exigirOrigemDaEmissao(db:Banco, orgId:string, args:P, approvalId?:string):Promise<void> {
  const leadId=typeof args.leadId==='string'?args.leadId:'';
  if(!leadId || !Object.prototype.hasOwnProperty.call(args,'clienteId') || !(typeof args.clienteId==='string' || args.clienteId===null) || typeof args.hash!=='string' || !args.hash || typeof args.signatarioEmail!=='string') throw invalidar();
  const ficha=await db.comercialFicha.findFirst({where:{orgId,leadId},select:{partnerId:true}});
  if(!ficha || ficha.partnerId!==args.clienteId) throw invalidar();
  const [aceita,dados]=await Promise.all([
    db.leadEvent.findFirst({where:{orgId,leadId,type:'proposta.aceita'},orderBy:{occurredAt:'desc'}}),
    db.leadEvent.findFirst({where:{orgId,leadId,type:'aceite.dados'},orderBy:{occurredAt:'desc'}}),
  ]);
  let aceite:AceiteDoLead|null=null;
  if(aceita && dados) {
    const a=(aceita.payload??{}) as P, d=(dados.payload??{}) as P;
    const produto=String(a.produto??'') as ComercialProduto;
    if(produto in TABELA_DE_PRECO) aceite={versao:Number(a.versao??0),produto,valorCentavos:Number(a.valorCentavos??0),parcelas:Number(a.parcelas??1),forma:String(a.forma??'') as FormaDeCobranca,hash:String(a.hash??''),em:aceita.occurredAt,dados:{cnpj:String(d.cnpj??''),razaoSocial:String(d.razaoSocial??''),endereco:String(d.endereco??''),quemAssina:String(d.quemAssina??''),email:String(d.email??'')}};
  }
  if(!aceite && typeof args.contratoId==='string' && args.contratoId) {
    const evento=await db.leadEvent.findFirst({where:{orgId,leadId,type:'aceite.declarado'},orderBy:{occurredAt:'desc'},select:{payload:true,occurredAt:true}});
    aceite=evento?aceiteDaDeclaracao(evento.payload,evento.occurredAt):null;
  }
  if(!aceite || aceite.versao!==args.versao) throw invalidar();
  if(typeof args.contratoId==='string' && args.contratoId) {
    const c=await db.comercialContrato.findFirst({where:{id:args.contratoId,orgId,leadId},include:{signatarios:{orderBy:{ordem:'asc'}}}});
    if(!c || c.partnerId!==args.clienteId || (!['rascunho','a_emitir'].includes(c.estado) && !c.documentoId)) throw invalidar();
    if(c.documentoId) {
      const documento=await db.comercialDocumento.findFirst({where:{id:c.documentoId,orgId,leadId,estado:{not:'cancelado'}},select:{hashConteudo:true}});
      if(!documento || documento.hashConteudo!==args.hash) throw invalidar();
    }
    if(c.paiId) {
      const pai=await db.comercialContrato.findFirst({where:{id:c.paiId,orgId,leadId,estado:{not:'cancelado'}},select:{id:true,partnerId:true}});
      if(!pai || pai.partnerId!==args.clienteId) throw invalidar();
    }
    const cliente=c.signatarios.filter(s=>s.papel==='cliente'), root=c.signatarios.filter(s=>s.papel==='root');
    if(!cliente.length || !root.length || cliente[0]!.email.toLowerCase()!==args.signatarioEmail.toLowerCase()) throw invalidar();
    const lista=c.signatarios.map(s=>({papel:s.papel as 'cliente'|'root',nome:s.nome,email:s.email,ordem:s.ordem}));
    if((await rootsSemAlcada(db,orgId,lista)).length) throw invalidar();
    const montado=await montarPdfDoRegistro(db,orgId,c.id,aceite);
    if(montado.pdf.hash!==args.hash) throw invalidar();
  } else {
    if(args.contratoId!==undefined && args.contratoId!==null) throw invalidar();
    if(aceite.dados.email.toLowerCase()!==args.signatarioEmail.toLowerCase()) throw invalidar();
    const markdown=montarContrato({...aceite.dados,produto:aceite.produto,valorCentavos:aceite.valorCentavos,parcelas:aceite.parcelas,forma:aceite.forma,propostaVersao:aceite.versao,propostaHash:aceite.hash,aceitoEm:aceite.em});
    if(hashDoContrato(markdown)!==args.hash) throw invalidar();
    const registros=await db.comercialContrato.findMany({where:{orgId,leadId,tipo:'contrato',estado:{not:'cancelado'}},select:{id:true,partnerId:true,documentoId:true}});
    if(registros.length) {
      if(!approvalId || registros.length!==1 || registros[0]!.partnerId!==args.clienteId || !registros[0]!.documentoId) throw invalidar();
      const documento=await db.comercialDocumento.findFirst({where:{id:registros[0]!.documentoId,orgId,leadId,estado:{not:'cancelado'},hashConteudo:args.hash,origemApprovalId:approvalId},select:{id:true}});
      if(!documento) throw invalidar();
    }
  }
}
