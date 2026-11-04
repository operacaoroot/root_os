import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClienteEscopoService } from '../clientes-escopo/cliente-escopo.service';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import { contratosCoerentes } from './comercial-carteira';

type Consulta = { clienteId?: string; page: number; limit: number; q?: string };
type Carteira = { amplo: boolean; clientes: { id:string; nome:string; interno:boolean }[] };
const assinatura = (c: Carteira) => JSON.stringify([c.amplo, c.clientes.map(x => x.id).sort()]);

@Injectable()
export class ComercialCarteiraService {
  constructor(private readonly prisma: PrismaService, private readonly escopo: ClienteEscopoService) {}

  private async ler<T>(orgId:string, ator:string, clienteId:string|undefined, fn:(db:Prisma.TransactionClient, ids:string[])=>Promise<T>):Promise<T> {
    if (!orgId || !ator) throw new ForbiddenException('Acesso insuficiente.');
    const { resposta, carteira } = await this.prisma.$transaction(async db => {
      const carteira = await this.escopo.listar(orgId, ator, db);
      if (clienteId) await this.escopo.exigirCliente(orgId, ator, clienteId, db);
      const ids = clienteId ? [clienteId] : carteira.clientes.map(c => c.id);
      return { carteira: assinatura(carteira), resposta: await fn(db, ids) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    await exigirAcessoAtual(this.prisma, orgId, ator, ['leads.ver']);
    const verificada = await this.prisma.$transaction(async db => {
      const atual = await this.escopo.listar(orgId, ator, db);
      if (carteira !== assinatura(atual)) throw new ForbiddenException('A carteira mudou. Atualize a tela.');
      if (clienteId) await this.escopo.exigirCliente(orgId, ator, clienteId, db);
      return fn(db, clienteId ? [clienteId] : atual.clientes.map(c => c.id));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    await exigirAcessoAtual(this.prisma, orgId, ator, ['leads.ver']);
    if (carteira !== assinatura(await this.escopo.listar(orgId, ator))) throw new ForbiddenException('A carteira mudou. Atualize a tela.');
    if (JSON.stringify(resposta) !== JSON.stringify(verificada)) throw new ConflictException('Os dados mudaram. Atualize a tela.');
    return resposta;
  }

  async leads(orgId:string, ator:string, consulta:Consulta) {
    return this.ler(orgId, ator, consulta.clienteId, async (db, ids) => {
      if (!ids.length) return {items:[],total:0,page:consulta.page,limit:consulta.limit,etapas:[]};
      const where:Prisma.ComercialFichaWhereInput = { orgId, partnerId:{in:ids}, lead:{orgId}, ...(consulta.q ? {OR:[{empresa:{contains:consulta.q,mode:'insensitive'}},{lead:{name:{contains:consulta.q,mode:'insensitive'}}}]} : {}) };
      const [total, etapas, rows] = await Promise.all([
        db.comercialFicha.count({where}),
        db.comercialFicha.groupBy({by:['etapa'],where,_count:{_all:true}}),
        db.comercialFicha.findMany({where,select:{leadId:true,partnerId:true,empresa:true,etapa:true,produto:true,valorCentavos:true,etapaDesde:true,lead:{select:{name:true}}},orderBy:[{etapaDesde:'desc'},{leadId:'asc'}],skip:(consulta.page-1)*consulta.limit,take:consulta.limit}),
      ]);
      return {items:rows.map(f=>({leadId:f.leadId,clienteId:f.partnerId,nome:f.lead.name,empresa:f.empresa,etapa:f.etapa,produto:f.produto,valorCentavos:f.valorCentavos,etapaDesde:f.etapaDesde.toISOString()})),total,page:consulta.page,limit:consulta.limit,etapas:etapas.map(e=>({etapa:e.etapa,total:e._count._all})).sort((a,b)=>a.etapa.localeCompare(b.etapa))};
    });
  }

  async lead(orgId:string, ator:string, id:string, clienteId?:string) {
    return this.ler(orgId, ator, clienteId, async (db, ids) => {
      if (!ids.length) throw new NotFoundException('Lead não encontrado.');
      const f = await db.comercialFicha.findFirst({where:{orgId,leadId:id,partnerId:{in:ids},lead:{orgId}},select:{leadId:true,partnerId:true,empresa:true,etapa:true,produto:true,valorCentavos:true,etapaDesde:true,lead:{select:{name:true,email:true,phone:true}}}});
      if (!f) throw new NotFoundException('Lead não encontrado.');
      return {leadId:f.leadId,clienteId:f.partnerId,nome:f.lead.name,empresa:f.empresa,etapa:f.etapa,produto:f.produto,valorCentavos:f.valorCentavos,etapaDesde:f.etapaDesde.toISOString(),email:f.lead.email,telefone:f.lead.phone};
    });
  }

  private async contratosValidos(db:Prisma.TransactionClient, orgId:string, ids:string[]) {
    if (!ids.length) return [];
    const [fichas, rows] = await Promise.all([
      db.comercialFicha.findMany({where:{orgId,partnerId:{in:ids},lead:{orgId}},select:{leadId:true,partnerId:true,empresa:true,lead:{select:{name:true}}}}),
      db.comercialContrato.findMany({where:{orgId,partnerId:{in:ids}},select:{id:true,orgId:true,leadId:true,partnerId:true,paiId:true,tipo:true,modalidade:true,estado:true,numero:true,valorCentavos:true,vigenciaInicio:true,vigenciaFim:true,criadoEm:true,documentoId:true,minutaId:true,documento:{select:{orgId:true,leadId:true}},minuta:{select:{orgId:true,leadId:true}}},orderBy:[{criadoEm:'desc'},{id:'asc'}]}),
    ]);
    const porLead = new Map(fichas.map(f=>[f.leadId,f]));
    const validos = new Set(contratosCoerentes(rows,new Map(fichas.map(f=>[f.leadId,f.partnerId]))));
    return rows.filter(r=>validos.has(r.id)).map(r=>({id:r.id,leadId:r.leadId,clienteId:r.partnerId,paiId:r.paiId,tipo:r.tipo,modalidade:r.modalidade,estado:r.estado,numero:r.numero,valorCentavos:r.valorCentavos,vigenciaInicio:r.vigenciaInicio?.toISOString()??null,vigenciaFim:r.vigenciaFim?.toISOString()??null,criadoEm:r.criadoEm.toISOString(),nome:porLead.get(r.leadId)!.lead.name,empresa:porLead.get(r.leadId)!.empresa}));
  }

  async contratos(orgId:string, ator:string, consulta:Consulta) {
    return this.ler(orgId, ator, consulta.clienteId, async (db, ids) => {
      const todos = await this.contratosValidos(db, orgId, ids);
      const q = consulta.q?.toLocaleLowerCase('pt-BR');
      const rows = q ? todos.filter(r=>[r.nome,r.empresa,r.numero].some(v=>v?.toLocaleLowerCase('pt-BR').includes(q))) : todos;
      const estados = [...new Set(rows.map(r=>r.estado))].map(estado=>({estado,total:rows.filter(r=>r.estado===estado).length}));
      return {items:rows.slice((consulta.page-1)*consulta.limit,consulta.page*consulta.limit),total:rows.length,page:consulta.page,limit:consulta.limit,estados};
    });
  }

  async contrato(orgId:string, ator:string, id:string, clienteId?:string) {
    return this.ler(orgId, ator, clienteId, async (db, ids) => {
      const row = (await this.contratosValidos(db, orgId, ids)).find(r=>r.id===id);
      if (!row) throw new NotFoundException('Contrato não encontrado.');
      return row;
    });
  }
}

export function parseConsultaCarteira(raw:Record<string,unknown>): Consulta {
  for (const k of Object.keys(raw)) if (!['clienteId','page','limit','q'].includes(k)) throw new BadRequestException('Filtro desconhecido.');
  const texto = (v:unknown) => { if (v !== undefined && typeof v !== 'string') throw new BadRequestException('Filtro inválido.'); return v as string|undefined; };
  const clienteId=texto(raw.clienteId), q=texto(raw.q)?.trim();
  if (clienteId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clienteId)) throw new BadRequestException('Cliente inválido.');
  if (q && q.length>120) throw new BadRequestException('Busca muito longa.');
  const numero=(v:unknown, padrao:number, max:number)=>{const s=texto(v);if(s===undefined)return padrao;if(!/^[1-9]\d*$/.test(s)||Number(s)>max)throw new BadRequestException('Paginação inválida.');return Number(s);};
  return {clienteId:clienteId||undefined,q:q||undefined,page:numero(raw.page,1,100000),limit:numero(raw.limit,30,100)};
}
