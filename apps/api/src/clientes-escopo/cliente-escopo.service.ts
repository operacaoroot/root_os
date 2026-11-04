import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
type Banco = Pick<Prisma.TransactionClient, 'user'|'partner'|'clienteAcessoPerfil'|'clienteAcessoVinculo'>;
export const AlterarAcessoClienteSchema = z.object({modo:z.enum(['ALL','SELECTED']),clienteIds:z.array(z.string().uuid()).max(500).default([])}).strict();
const negado = () => new ForbiddenException('Seu acesso não inclui este cliente ou esta área.');
const cadastroValido: Prisma.PartnerWhereInput = {ativo:true,principalId:null,OR:[{isCliente:true},{interno:true}]};
@Injectable()
export class ClienteEscopoService {
  constructor(private readonly prisma:PrismaService, private readonly audit:AuditService) {}

  async perfil(orgId:string,userId:string,db:Banco=this.prisma) {
    const user=await db.user.findFirst({where:{id:userId,orgId,isActive:true},select:{id:true}});
    if(!user) throw negado();
    const p=await db.clienteAcessoPerfil.findFirst({where:{orgId,userId},select:{modo:true}});
    if(!p || !['ALL','SELECTED'].includes(p.modo)) throw negado();
    return p;
  }
  async exigirAmplo(orgId:string,userId:string,db:Banco=this.prisma) {
    if((await this.perfil(orgId,userId,db)).modo!=='ALL') throw negado();
  }
  private async ids(orgId:string,userId:string,db:Banco) {
    const vinculos=await db.clienteAcessoVinculo.findMany({where:{orgId,userId,cliente:{orgId,...cadastroValido}},select:{clienteId:true}});
    return vinculos.map(v=>v.clienteId);
  }
  async exigirCliente(orgId:string,userId:string,clienteId:string|null,db:Banco=this.prisma) {
    const p=await this.perfil(orgId,userId,db);
    if(clienteId===null) {if(p.modo!=='ALL') throw negado();return null;}
    const cliente=await db.partner.findFirst({where:{id:clienteId,orgId,...cadastroValido}});
    if(!cliente || (p.modo!=='ALL' && !(await this.ids(orgId,userId,db)).includes(clienteId))) throw negado();
    return cliente;
  }
  async filtro(orgId:string,userId:string,clienteId?:string,db:Banco=this.prisma):Promise<{orgId:string;clienteId?:string|null|{in:string[]}}> {
    const p=await this.perfil(orgId,userId,db);
    if(clienteId==='sem') {if(p.modo!=='ALL') throw negado();return {orgId,clienteId:null};}
    if(clienteId!==undefined) {
      await this.exigirCliente(orgId,userId,clienteId,db);
      return {orgId,clienteId};
    }
    return p.modo==='ALL'?{orgId}:{orgId,clienteId:{in:await this.ids(orgId,userId,db)}};
  }
  async listar(orgId:string,userId:string,db:Banco=this.prisma) {
    const p=await this.perfil(orgId,userId,db);
    const clientes=await db.partner.findMany({where:{orgId,...cadastroValido,...(p.modo==='ALL'?{}:{id:{in:await this.ids(orgId,userId,db)}})},select:{id:true,razaoSocial:true,nomeFantasia:true,interno:true},orderBy:{razaoSocial:'asc'}});
    return {amplo:p.modo==='ALL',clientes:clientes.map(c=>({id:c.id,nome:c.nomeFantasia||c.razaoSocial,interno:c.interno}))};
  }
  private async exigirAdministrador(orgId:string,userId:string,db:Banco=this.prisma) {
    await this.exigirAmplo(orgId,userId,db);
    const u=await db.user.findFirst({where:{orgId,id:userId,isActive:true,roles:{some:{orgId,key:'admin_master'}}},select:{id:true}});
    if(!u) throw negado();
  }
  async pessoas(orgId:string,userId:string) {
    await this.exigirAdministrador(orgId,userId);
    return this.prisma.user.findMany({where:{orgId,isActive:true},select:{id:true,name:true,email:true,clienteAcessoPerfil:{select:{modo:true,vinculos:{select:{clienteId:true}}}}},orderBy:{name:'asc'}});
  }
  async configurar(orgId:string,atorId:string,userId:string,bruto:unknown) {
    const input=AlterarAcessoClienteSchema.parse(bruto);
    const clienteIds=[...new Set(input.clienteIds)];
    if(input.modo==='ALL' && clienteIds.length) throw new BadRequestException('Visão ampla não usa uma lista de clientes.');
    // Não retirar o único caminho administrativo na própria operação.
    if(atorId===userId) throw new BadRequestException('A própria carteira deve ser alterada por outro administrador.');
    return this.prisma.$transaction(async tx=>{
      // Serializa alterações de carteira da organização antes de reler o ator.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${orgId}, 219))::text`;
      await this.exigirAdministrador(orgId,atorId,tx);
      const alvo=await tx.user.findFirst({where:{orgId,id:userId,isActive:true},select:{id:true}});
      if(!alvo) throw new NotFoundException('Pessoa não encontrada.');
      const clientes=await tx.partner.findMany({where:{orgId,id:{in:clienteIds},...cadastroValido},select:{id:true}});
      if(clientes.length!==clienteIds.length) throw new BadRequestException('Cliente inválido para esta organização.');
      const anterior=await tx.clienteAcessoPerfil.findFirst({where:{orgId,userId},include:{vinculos:{select:{clienteId:true}}}});
      await tx.clienteAcessoPerfil.upsert({where:{userId_orgId:{userId,orgId}},create:{orgId,userId,modo:input.modo},update:{modo:input.modo}});
      await tx.clienteAcessoVinculo.deleteMany({where:{orgId,userId}});
      if(clienteIds.length) await tx.clienteAcessoVinculo.createMany({data:clienteIds.map(clienteId=>({orgId,userId,clienteId}))});
      await this.audit.log({orgId,actorId:atorId,action:'cliente.acesso.alterar',entityType:'user',entityId:userId,
        before:{modo:anterior?.modo??null,clienteIds:anterior?.vinculos.map(v=>v.clienteId)??[]},after:{modo:input.modo,clienteIds}},tx);
      return {userId,modo:input.modo,clienteIds};
    });
  }
}
