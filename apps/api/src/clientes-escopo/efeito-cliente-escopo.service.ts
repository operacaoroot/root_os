import { ForbiddenException, Injectable } from '@nestjs/common';
import { ActorType, ApprovalState } from '@prisma/client';
import { canonicalHash } from '../approvals/approvals.service';
import { argsRedigidos } from '../approvals/vinculo-de-conteudo';
import type { ContextoDoEfeito } from '../gateway/efeitos.registry';
import { PolicyService } from '../policy/policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClienteEscopoService } from './cliente-escopo.service';
import { TarefaEscopoService } from './tarefa-escopo.service';

const negar = () => new ForbiddenException('A autorização original deste efeito não está mais válida.');
const sistemas = { 'drive.arquivo.enviar':'arquivista-do-cliente', 'drive.pasta.criar':'criador-da-pasta-do-cliente' } as const;
type Capacidade = keyof typeof sistemas;
export interface PedidoEfeitoCliente {
  orgId:string; clienteId:string; capabilityId:Capacidade; resourceType:'cliente'|'arquivo-do-cliente'; resourceId:string;
  args:Record<string,unknown>; ctx:ContextoDoEfeito;
  arquivo?:{atorId:string|null;refTipo:string|null;refId:string|null};
}

@Injectable()
export class EfeitoClienteEscopoService {
  constructor(private readonly prisma:PrismaService, private readonly escopo:ClienteEscopoService, private readonly tarefas:TarefaEscopoService, private readonly policy:PolicyService) {}

  async exigirPessoa(orgId:string, pessoaId:string, clienteId:string|null, permissoes:string[]) {
    await this.escopo.exigirAmplo(orgId,pessoaId);
    await this.escopo.exigirCliente(orgId,pessoaId,clienteId);
    const pessoa=await this.prisma.user.findFirst({where:{id:pessoaId,orgId,isActive:true,roles:{some:{orgId,permissions:{some:{key:{in:permissoes}}}}}},select:{id:true}});
    if(!pessoa) throw negar();
  }

  async exigir(p:PedidoEfeitoCliente) { return this.exigirInterno(p, ApprovalState.consumida); }

  async exigirAntesDaAprovacao(orgId:string, capabilityId:string, approvalId:string, args:Record<string,unknown>) {
    if (capabilityId!=='drive.arquivo.enviar' && capabilityId!=='drive.pasta.criar') throw negar();
    const ap=await this.prisma.approval.findFirst({where:{id:approvalId,orgId,status:ApprovalState.confirmada,capabilityId}});
    if (!ap || !ap.aprovadoPorId || typeof args.clienteId!=='string') throw negar();
    const arquivo = capabilityId==='drive.arquivo.enviar'
      ? await this.prisma.arquivoDoCliente.findFirst({where:{id:ap.resourceId,orgId,partnerId:args.clienteId,approvalId},select:{atorId:true,refTipo:true,refId:true}})
      : undefined;
    if (capabilityId==='drive.arquivo.enviar' && !arquivo) throw negar();
    return this.exigirInterno({orgId,clienteId:args.clienteId,capabilityId,resourceType:capabilityId==='drive.arquivo.enviar'?'arquivo-do-cliente':'cliente',resourceId:capabilityId==='drive.arquivo.enviar'?ap.resourceId:args.clienteId,args,ctx:{orgId,approvalId,actorType:ActorType.user,actorId:ap.aprovadoPorId},...(arquivo?{arquivo}:{})},ApprovalState.confirmada);
  }

  private async exigirInterno(p:PedidoEfeitoCliente, estado:ApprovalState) {
    if ((p.capabilityId==='drive.arquivo.enviar' && (p.resourceType!=='arquivo-do-cliente' || !p.arquivo)) || (p.capabilityId==='drive.pasta.criar' && (p.resourceType!=='cliente' || p.resourceId!==p.clienteId))) throw negar();
    if (!p.ctx.approvalId || p.ctx.orgId!==p.orgId || !p.ctx.actorId || p.ctx.actorType!==ActorType.user) throw negar();
    const ap=await this.prisma.approval.findFirst({where:{id:p.ctx.approvalId,orgId:p.orgId,status:estado,capabilityId:p.capabilityId,resourceType:p.resourceType,resourceId:p.resourceId}});
    if(!ap || ap.aprovadoPorId!==p.ctx.actorId || !ap.toolCallId) throw negar();
    if(p.arquivo) {
      const atual=await this.prisma.arquivoDoCliente.findFirst({where:{id:p.resourceId,orgId:p.orgId,partnerId:p.clienteId,approvalId:p.ctx.approvalId},select:{atorId:true,refTipo:true,refId:true,chave:true,sha256:true,nome:true,subpasta:true,bytes:true,tipoMime:true,origem:true}});
      if(!atual || atual.chave!==p.args.chave || atual.sha256!==p.args.sha256 || atual.nome!==p.args.nome || atual.subpasta!==p.args.subpasta || atual.bytes!==p.args.bytes || atual.tipoMime!==p.args.tipoMime || atual.origem!==p.args.origem || atual.atorId!==p.arquivo.atorId || atual.refTipo!==p.arquivo.refTipo || atual.refId!==p.arquivo.refId) throw negar();
    }
    const chamada=await this.prisma.toolCall.findFirst({where:{id:ap.toolCallId,orgId:p.orgId,capabilityId:p.capabilityId}});
    const cap=this.policy.resolverCapacidade(p.orgId,p.capabilityId);
    if(!chamada || !cap || chamada.actorType!==ap.propostoPorTipo || chamada.actorId!==ap.propostoPorId || argsRedigidos(chamada.args)) throw negar();
    const hashKeys=(cap as unknown as {hashKeys?:string[]}).hashKeys ?? [];
    const argsGravados=chamada.args;
    if(!argsGravados || typeof argsGravados!=='object' || Array.isArray(argsGravados)) throw negar();
    try {
      if(canonicalHash(p.resourceType,argsGravados as Record<string,unknown>,hashKeys)!==ap.contentHash || canonicalHash(p.resourceType,p.args,hashKeys)!==ap.contentHash || p.args.clienteId!==p.clienteId) throw negar();
    } catch { throw negar(); }
    await this.exigirPessoa(p.orgId,p.ctx.actorId,p.clienteId,['aprovacoes.decidir']);
    if(ap.propostoPorTipo===ActorType.user) {
      if(p.arquivo && p.arquivo.atorId!==ap.propostoPorId) throw negar();
      await this.exigirPessoa(p.orgId,ap.propostoPorId,p.clienteId,p.arquivo?.refTipo==='WorkAnexo'?['tarefas.editar']:['tarefas.editar','leads.editar']);
    } else if(ap.propostoPorTipo!==ActorType.system || ap.propostoPorId!==sistemas[p.capabilityId] || (p.arquivo && p.arquivo.atorId!==null)) throw negar();
    if(p.arquivo?.refTipo==='WorkAnexo') {
      if(!p.arquivo.refId || ap.propostoPorTipo!==ActorType.user) throw negar();
      await this.exigirOrigemAnexo(p.orgId,ap.propostoPorId,p.clienteId,p.arquivo.refId,{chave:p.args.chave,sha256:p.args.sha256,bytes:p.args.bytes});
    }
    return {proponenteId:ap.propostoPorId,proponenteTipo:ap.propostoPorTipo};
  }
  async exigirOrigemAnexo(orgId:string,pessoaId:string,clienteId:string,anexoId:string,conteudo?:{chave:unknown;sha256:unknown;bytes:unknown}) {
    const anexo=await this.prisma.workAnexo.findFirst({where:{orgId,id:anexoId},select:{taskId:true,chave:true,sha256:true,bytes:true}});
    if(!anexo || (conteudo && (anexo.chave!==conteudo.chave || anexo.sha256!==conteudo.sha256 || anexo.bytes!==conteudo.bytes))) throw negar();
    const t=await this.tarefas.exigir(orgId,pessoaId,anexo.taskId);
    if(t.clienteId!==clienteId) throw negar();
    const vistos=new Set([t.id]); let pai=t.parentId;
    while(pai) { if(vistos.has(pai)||vistos.size>=100) throw negar(); vistos.add(pai);
      const atual=await this.prisma.workTask.findFirst({where:{orgId,id:pai},select:{clienteId:true,parentId:true}});
      if(!atual || atual.clienteId!==clienteId) throw negar(); pai=atual.parentId;
    }
  }

}
