import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClienteEscopoService } from '../clientes-escopo/cliente-escopo.service';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import { contratosCoerentes } from '../comercial/comercial-carteira';
import { financeiroCoerente, parcelaCoerente } from './finance-carteira';
import { parseConsultaCarteira } from '../comercial/comercial-carteira.service';

type Consulta = ReturnType<typeof parseConsultaCarteira>;
type Carteira = {amplo:boolean;clientes:{id:string;nome:string;interno:boolean}[]};
const assinatura=(c:Carteira)=>JSON.stringify([c.amplo,c.clientes.map(x=>x.id).sort()]);

@Injectable()
export class FinanceCarteiraService {
  constructor(private readonly prisma:PrismaService,private readonly escopo:ClienteEscopoService) {}
  private async ler<T>(orgId:string,ator:string,clienteId:string|undefined,fn:(db:Prisma.TransactionClient,ids:string[])=>Promise<T>):Promise<T> {
    if(!orgId||!ator) throw new ForbiddenException('Acesso insuficiente.');
    const consulta = async (db:Prisma.TransactionClient, esperada?:string) => {
      const carteira=await this.escopo.listar(orgId,ator,db);
      if(esperada && assinatura(carteira)!==esperada) throw new ForbiddenException('A carteira mudou. Atualize a tela.');
      if(clienteId) await this.escopo.exigirCliente(orgId,ator,clienteId,db);
      const ids=clienteId?[clienteId]:carteira.clientes.map(c=>c.id);
      return {carteira:assinatura(carteira),resposta:await fn(db,ids)};
    };
    const primeira=await this.prisma.$transaction(db=>consulta(db),{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
    await exigirAcessoAtual(this.prisma,orgId,ator,['financeiro.ver']);
    const segunda=await this.prisma.$transaction(db=>consulta(db,primeira.carteira),{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
    await exigirAcessoAtual(this.prisma,orgId,ator,['financeiro.ver']);
    if(primeira.carteira!==assinatura(await this.escopo.listar(orgId,ator))) throw new ForbiddenException('A carteira mudou. Atualize a tela.');
    if(JSON.stringify(primeira.resposta)!==JSON.stringify(segunda.resposta)) throw new ConflictException('Os dados mudaram. Atualize a tela.');
    return primeira.resposta;
  }

  private async referencias(db:Prisma.TransactionClient,orgId:string,ids:string[]) {
    const [fichas,comerciais,financeiros]=await Promise.all([
      db.comercialFicha.findMany({where:{orgId,partnerId:{in:ids},lead:{orgId}},select:{leadId:true,partnerId:true}}),
      db.comercialContrato.findMany({where:{orgId,partnerId:{in:ids}},select:{id:true,orgId:true,leadId:true,partnerId:true,paiId:true,documentoId:true,minutaId:true,documento:{select:{orgId:true,leadId:true}},minuta:{select:{orgId:true,leadId:true}}}}),
      db.contract.findMany({where:{orgId,partnerId:{in:ids}},select:{id:true,orgId:true,partnerId:true,tipo:true,comercialContratoId:true}}),
    ]);
    const validos=new Set(contratosCoerentes(comerciais,new Map(fichas.map(f=>[f.leadId,f.partnerId]))));
    const mapaComercial=new Map(comerciais.filter(c=>validos.has(c.id)).map(c=>[c.id,c.partnerId]));
    return {comerciais:mapaComercial,financeiros:new Map(financeiros.map(c=>[c.id,c]))};
  }

  private async titulos(db:Prisma.TransactionClient,orgId:string,ids:string[]) {
    if (!ids.length) return [];
    const [refs,rows]=await Promise.all([
      this.referencias(db,orgId,ids),
      db.financeTransaction.findMany({where:{orgId,type:'entrada',partnerId:{in:ids},contractId:{not:null}},select:{id:true,orgId:true,partnerId:true,contractId:true,type:true,description:true,amount:true,status:true,date:true,dueDate:true,paidAt:true},orderBy:[{date:'desc'},{id:'asc'}]}),
    ]);
    return rows.filter(r=>financeiroCoerente(r,refs.financeiros,refs.comerciais));
  }
  private dtoTitulo(r:Awaited<ReturnType<FinanceCarteiraService['titulos']>>[number]) {
    return {id:r.id,clienteId:r.partnerId,contratoId:r.contractId,descricao:r.description,valor:r.amount.toFixed(2),status:r.status,data:r.date.toISOString(),vencimento:r.dueDate?.toISOString()??null,recebidoEm:r.paidAt?.toISOString()??null};
  }
  async recebiveis(orgId:string,ator:string,c:Consulta) {
    return this.ler(orgId,ator,c.clienteId,async(db,ids)=>{
      const q=c.q?.toLocaleLowerCase('pt-BR');
      const linhas=(await this.titulos(db,orgId,ids)).filter(r=>!q||r.description.toLocaleLowerCase('pt-BR').includes(q));
      const estados=['previsto','realizado','conciliado'].map(status=>{
        const grupo=linhas.filter(r=>r.status===status);
        return {status,quantidade:grupo.length,valor:grupo.reduce((s,r)=>s.add(r.amount),new Prisma.Decimal(0)).toFixed(2)};
      });
      return {items:linhas.slice((c.page-1)*c.limit,c.page*c.limit).map(r=>this.dtoTitulo(r)),total:linhas.length,page:c.page,limit:c.limit,estados,periodo:null};
    });
  }
  async recebivel(orgId:string,ator:string,id:string,clienteId?:string) {
    return this.ler(orgId,ator,clienteId,async(db,ids)=>{
      const r=(await this.titulos(db,orgId,ids)).find(x=>x.id===id);
      if(!r) throw new NotFoundException('Recebível não encontrado.');
      return this.dtoTitulo(r);
    });
  }
  private async acordosValidos(db:Prisma.TransactionClient,orgId:string,ids:string[]) {
    if (!ids.length) return [];
    const [refs,rows]=await Promise.all([
      this.referencias(db,orgId,ids),
      db.acordoComercial.findMany({where:{orgId,partnerId:{in:ids}},select:{id:true,partnerId:true,produto:true,tipo:true,valor:true,fechadoEm:true,comercialContratoId:true,createdAt:true},orderBy:[{createdAt:'desc'},{id:'asc'}]}),
    ]);
    return rows.filter(a=>!!a.partnerId && (!a.comercialContratoId||refs.comerciais.get(a.comercialContratoId)===a.partnerId));
  }
  private dtoAcordo(a:Awaited<ReturnType<FinanceCarteiraService['acordosValidos']>>[number]) {
    return {id:a.id,clienteId:a.partnerId,produto:a.produto,tipo:a.tipo,valor:a.valor.toFixed(2),fechadoEm:a.fechadoEm?.toISOString()??null,contratoComercialId:a.comercialContratoId};
  }
  async acordos(orgId:string,ator:string,c:Consulta) {
    return this.ler(orgId,ator,c.clienteId,async(db,ids)=>{
      const q=c.q?.toLocaleLowerCase('pt-BR');
      const rows=(await this.acordosValidos(db,orgId,ids)).filter(a=>!q||a.produto.toLocaleLowerCase('pt-BR').includes(q));
      return {items:rows.slice((c.page-1)*c.limit,c.page*c.limit).map(a=>this.dtoAcordo(a)),total:rows.length,page:c.page,limit:c.limit,periodo:null};
    });
  }
  async acordo(orgId:string,ator:string,id:string,clienteId?:string) {
    return this.ler(orgId,ator,clienteId,async(db,ids)=>{
      const acordo=(await this.acordosValidos(db,orgId,ids)).find(a=>a.id===id);
      if(!acordo||!acordo.partnerId) throw new NotFoundException('Acordo não encontrado.');
      const parcelas=await db.acordoParcela.findMany({where:{orgId,acordoId:id},select:{id:true,numero:true,valor:true,vencimento:true,pagaEm:true,recebimentoId:true},orderBy:[{numero:'asc'},{id:'asc'}]});
      const recebimentoIds=parcelas.flatMap(p=>p.recebimentoId?[p.recebimentoId]:[]);
      const [refs,recebimentos]=await Promise.all([
        this.referencias(db,orgId,ids),
        db.financeTransaction.findMany({where:{orgId,id:{in:recebimentoIds}},select:{id:true,orgId:true,partnerId:true,type:true,contractId:true}}),
      ]);
      const porId=new Map(recebimentos.map(r=>[r.id,r]));
      const visiveis=parcelas.filter(p=>{
        const r=p.recebimentoId?porId.get(p.recebimentoId)??null:null;
        const contratoComercial = r?.contractId ? refs.financeiros.get(r.contractId)?.comercialContratoId ?? null : null;
        return parcelaCoerente(orgId,acordo.partnerId!,p.recebimentoId,r,acordo.comercialContratoId,contratoComercial) && (!r||financeiroCoerente(r,refs.financeiros,refs.comerciais));
      });
      return {...this.dtoAcordo(acordo),parcelasIncompletas:visiveis.length!==parcelas.length,parcelas:visiveis.map(p=>({id:p.id,numero:p.numero,valor:p.valor.toFixed(2),vencimento:p.vencimento.toISOString(),pagaEm:p.pagaEm?.toISOString()??null}))};
    });
  }
}
