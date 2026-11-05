import { ForbiddenException, Injectable, Optional } from '@nestjs/common';
import { ActorType, ApprovalState } from '@prisma/client';
import { canonicalHash } from '../approvals/approvals.service';
import { argsRedigidos } from '../approvals/vinculo-de-conteudo';
import type { ContextoDoEfeito } from '../gateway/efeitos.registry';
import { PolicyService } from '../policy/policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClienteEscopoService } from './cliente-escopo.service';
import { TarefaEscopoService } from './tarefa-escopo.service';
import { OrigemArquivoClienteService } from './origem-arquivo-cliente.service';
import { aceiteDaDeclaracao } from '../comercial/fechado-fora';

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
  constructor(private readonly prisma:PrismaService, private readonly escopo:ClienteEscopoService, private readonly tarefas:TarefaEscopoService, private readonly policy:PolicyService, @Optional() private readonly origens?:OrigemArquivoClienteService) {}

  async exigirOrigemRecebida(orgId:string,id:string,esperado:{leadId:string|null;partnerId:string|null;origem:string;chave:string;sha256:string;bytes:number;tipoMime:string}) {
    if (!this.origens || !id) throw negar();
    return this.origens.exigir(orgId,id,esperado);
  }

  async exigirFechamento(orgId:string,clienteId:string,leadId:string,approvalId:string,origem:string) {
    if (!leadId || !approvalId || !['fechamento','fechado-fora'].includes(origem)) throw negar();
    const ap=await this.prisma.approval.findFirst({where:{id:approvalId,orgId,status:ApprovalState.consumida,capabilityId:'comercial.fechamento.executar',resourceType:'comercial.fechamento'}});
    if(!ap?.toolCallId || !ap.aprovadoPorId || ap.nivelExigido!=='R4') throw negar();
    const chamada=await this.prisma.toolCall.findFirst({where:{id:ap.toolCallId,orgId,capabilityId:'comercial.fechamento.executar'}});
    const args=chamada?.args;
    const cap=this.policy.resolverCapacidade(orgId,'comercial.fechamento.executar');
    if(!chamada || !cap || chamada.approvalId!==ap.id || chamada.actorType!==ap.propostoPorTipo || chamada.actorId!==ap.propostoPorId || !args || typeof args!=='object' || Array.isArray(args) || argsRedigidos(args)) throw negar();
    const a=args as Record<string,unknown>;
    const hashKeys=(cap as unknown as {hashKeys?:string[]}).hashKeys ?? [];
    if(a.leadId!==leadId || a.chave!==ap.resourceId || typeof a.propostaHash!=='string' || canonicalHash('comercial.fechamento',a,hashKeys)!==ap.contentHash) throw negar();
    const fechamento=await this.prisma.comercialFechamento.findFirst({where:{orgId,leadId,chave:ap.resourceId}});
    const ficha=await this.prisma.comercialFicha.findFirst({where:{orgId,leadId,partnerId:clienteId}});
    if(!fechamento || !ficha || fechamento.vetadoEm || fechamento.estado==='vetado' || fechamento.chave!==`fech-${leadId}-v${fechamento.versao}`) throw negar();
    if(origem==='fechado-fora') {
      const evento=await this.prisma.leadEvent.findFirst({where:{orgId,leadId,type:'aceite.declarado'},orderBy:{occurredAt:'desc'},select:{payload:true,occurredAt:true}});
      const aceite=evento && aceiteDaDeclaracao(evento.payload,evento.occurredAt);
      if(!aceite || aceite.hash!==a.propostaHash || aceite.versao!==fechamento.versao) throw negar();
    } else {
      const aceita=await this.prisma.leadEvent.findFirst({where:{orgId,leadId,type:'proposta.aceita'},orderBy:{occurredAt:'desc'},select:{payload:true}});
      const payload=aceita?.payload;
      if(!payload || typeof payload!=='object' || Array.isArray(payload) || (payload as Record<string,unknown>).hash!==a.propostaHash || Number((payload as Record<string,unknown>).versao)!==fechamento.versao || ficha.propostaHash!==a.propostaHash || ficha.propostaVersao!==fechamento.versao) throw negar();
    }
    await this.exigirPessoa(orgId,ap.aprovadoPorId,clienteId,['aprovacoes.decidir']);
    if(ap.propostoPorTipo===ActorType.user) {
      if(ap.propostoPorId===ap.aprovadoPorId) throw negar();
      await this.exigirPessoa(orgId,ap.propostoPorId,clienteId,['leads.editar']);
      return {atorId:ap.propostoPorId};
    }
    if(ap.propostoPorTipo!==ActorType.system || ap.propostoPorId!=='comercial' || origem==='fechado-fora') throw negar();
    const conflito=await this.prisma.approval.findFirst({where:{orgId,capabilityId:'comercial.fechamento.executar',resourceType:'comercial.fechamento',resourceId:ap.resourceId,NOT:{propostoPorTipo:ActorType.system,propostoPorId:'comercial'}}});
    if(conflito) throw negar();
    return {atorId:null};
  }

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
    if(!chamada || !cap || chamada.approvalId!==ap.id || chamada.actorType!==ap.propostoPorTipo || chamada.actorId!==ap.propostoPorId || argsRedigidos(chamada.args)) throw negar();
    const hashKeys=(cap as unknown as {hashKeys?:string[]}).hashKeys ?? [];
    const argsGravados=chamada.args;
    if(!argsGravados || typeof argsGravados!=='object' || Array.isArray(argsGravados)) throw negar();
    try {
      if(canonicalHash(p.resourceType,argsGravados as Record<string,unknown>,hashKeys)!==ap.contentHash || canonicalHash(p.resourceType,p.args,hashKeys)!==ap.contentHash || p.args.clienteId!==p.clienteId) throw negar();
    } catch { throw negar(); }
    await this.exigirPessoa(p.orgId,p.ctx.actorId,p.clienteId,['aprovacoes.decidir']);
    if(p.capabilityId==='drive.pasta.criar' && (p.args.origem==='fechamento' || p.args.origem==='fechado-fora')) {
      const origem=await this.exigirFechamento(p.orgId,p.clienteId,String(p.args.leadId??''),String(p.args.fechamentoApprovalId??''),String(p.args.origem));
      if ((origem.atorId && (ap.propostoPorTipo!==ActorType.user || ap.propostoPorId!==origem.atorId)) || (!origem.atorId && (ap.propostoPorTipo!==ActorType.system || ap.propostoPorId!==sistemas[p.capabilityId]))) throw negar();
    }
    if(p.arquivo?.refTipo==='OrigemArquivoCliente') {
      if(!p.arquivo.refId || p.args.origemRecebidaId!==p.arquivo.refId) throw negar();
      const atual=await this.prisma.arquivoDoCliente.findFirst({where:{id:p.resourceId,orgId:p.orgId},select:{leadId:true,partnerId:true,origem:true,chave:true,sha256:true,bytes:true,tipoMime:true}});
      if(!atual) throw negar();
      const origem=await this.exigirOrigemRecebida(p.orgId,p.arquivo.refId,atual);
      if(origem.atorId!==p.arquivo.atorId) throw negar();
    } else if(p.args.origemRecebidaId || (p.arquivo && ['sala','whatsapp','contrato-assinado'].includes(String(p.args.origem)))) throw negar();
    if(ap.propostoPorTipo===ActorType.user) {
      if(p.arquivo && p.arquivo.atorId!==ap.propostoPorId) throw negar();
      await this.exigirPessoa(p.orgId,ap.propostoPorId,p.clienteId,p.arquivo?.refTipo==='WorkAnexo'?['tarefas.editar']:['tarefas.editar','leads.editar']);
    } else if(ap.propostoPorTipo!==ActorType.system || ap.propostoPorId!==sistemas[p.capabilityId] || (p.arquivo && (p.arquivo.atorId!==null || p.arquivo.refTipo!=='OrigemArquivoCliente')) || (!p.arquivo && p.args.origem!=='fechamento')) throw negar();
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
