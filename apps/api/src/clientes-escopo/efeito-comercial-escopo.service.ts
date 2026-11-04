import { ForbiddenException, Injectable } from '@nestjs/common';
import { ActorType, ApprovalState, RiskLevel, type Prisma } from '@prisma/client';
import { lerAprovador } from '../auth/aprovador';
import { alcadaDe, atendeAlcada, temPapelDeMaquina } from '../approvals/alcada';
import { canonicalHash } from '../approvals/approvals.service';
import { argsRedigidos } from '../approvals/vinculo-de-conteudo';
import { exigirVersaoDaPublicacao } from '../comercial/sala-publicacao-origem';
import { exigirOrigemDaEmissao } from '../comercial/contratos/emissao-origem';
import { PolicyService } from '../policy/policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClienteEscopoService } from './cliente-escopo.service';

type Banco = Prisma.TransactionClient | PrismaService;
type Fase = 'confirmada' | 'consumida' | 'repedido';
const SALA = 'comercial.sala.publicar';
const CONTRATO = 'comercial.contrato.enviar';
const negar = () => new ForbiddenException('A origem ou a autorização deste pedido comercial mudou. Faça um novo pedido.');
const objeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Autoridade vem da aprovação persistida; clienteId nos argumentos é apenas seu snapshot assinado. */
@Injectable()
export class EfeitoComercialEscopoService {
  constructor(private readonly prisma: PrismaService, private readonly escopo: ClienteEscopoService, private readonly policy: PolicyService) {}

  async clienteDoLead(orgId: string, leadId: string, db: Banco = this.prisma): Promise<string | null> {
    if (!leadId || !orgId) throw negar();
    const lead = await db.lead.findFirst({where:{id:leadId,orgId},select:{id:true}});
    const ficha = await db.comercialFicha.findFirst({where:{orgId,leadId},select:{partnerId:true}});
    if (!lead || !ficha) throw negar();
    if (ficha.partnerId !== null) {
      const cliente = await db.partner.findFirst({where:{id:ficha.partnerId,orgId,ativo:true,principalId:null,OR:[{isCliente:true},{interno:true}]},select:{id:true}});
      if (!cliente) throw negar();
    }
    return ficha.partnerId;
  }

  // Fora do snapshot da transação: revogação durante PDF/storage deve valer no próximo efeito.
  async exigirPessoa(orgId: string, id: string, clienteId: string | null, permissao = 'leads.editar') {
    await this.escopo.exigirAmplo(orgId,id);
    await this.escopo.exigirCliente(orgId,id,clienteId);
    const pessoa = await this.prisma.user.findFirst({where:{id,orgId,isActive:true,roles:{some:{orgId,permissions:{some:{key:permissao}}}}},select:{id:true}});
    if (!pessoa) throw negar();
    const atual=await lerAprovador(this.prisma,id,orgId);
    if (!atual?.ativo || temPapelDeMaquina(atual.papeis)) throw negar();
    return atual.papeis;
  }

  async exigir(orgId: string, approvalId: string, capabilityId: string, args: Record<string,unknown>, op: {fase:Fase;atorExecucaoId?:string|null;tx?:Banco}) {
    if (![SALA,CONTRATO].includes(capabilityId) || !approvalId || !Object.hasOwn(args,'clienteId')
      || (args.clienteId !== null && (typeof args.clienteId !== 'string' || !args.clienteId))
      || !objeto(args.origemCliente) || args.origemCliente.versao!==1 || args.origemCliente.clienteId!==args.clienteId
      || typeof args.leadId !== 'string' || typeof args.hash !== 'string' || !/^[a-f0-9]{64}$/.test(args.hash)
      || !Number.isInteger(args.versao) || Number(args.versao)<1) throw negar();
    const db=op.tx ?? this.prisma;
    const resourceType=capabilityId===SALA?'comercial.sala':'comercial.contrato';
    const resourceId=capabilityId===SALA?`${args.leadId}:v${args.versao}`:`${args.contratoId || args.leadId}:${args.hash.slice(0,16)}`;
    const ap=await db.approval.findFirst({where:{id:approvalId,orgId,capabilityId}});
    const estado=op.fase==='repedido'?ApprovalState.expirada:op.fase==='consumida'?ApprovalState.consumida:ApprovalState.confirmada;
    if (!ap || ap.id!==approvalId || ap.orgId!==orgId || ap.capabilityId!==capabilityId || ap.status!==estado
      || ap.resourceType!==resourceType || ap.resourceId!==resourceId || !ap.toolCallId
      || (capabilityId===CONTRATO ? ap.nivelExigido!==RiskLevel.R4 : ![RiskLevel.R3,RiskLevel.R4].includes(ap.nivelExigido as 'R3'|'R4'))
      || (op.fase==='confirmada' && ap.expiraEm<=new Date())
      || (op.fase==='consumida' && !ap.consumidoEm)) throw negar();
    const tc=await db.toolCall.findFirst({where:{id:ap.toolCallId,orgId,capabilityId}});
    const cap=this.policy.resolverCapacidade(orgId,capabilityId);
    if (!tc || tc.id!==ap.toolCallId || tc.orgId!==orgId || tc.capabilityId!==capabilityId || tc.approvalId!==ap.id
      || tc.actorId!==ap.propostoPorId || tc.actorType!==ap.propostoPorTipo || !objeto(tc.args) || argsRedigidos(tc.args) || !cap) throw negar();
    const hashKeys=(cap as unknown as {hashKeys?:string[]}).hashKeys ?? [];
    const vinculantes=['leadId','versao','hash','clienteId','origemCliente',...(capabilityId===CONTRATO?['signatarioEmail',...(args.contratoId?['contratoId']:[])]:[])];
    if (hashKeys.length && vinculantes.some(k=>!hashKeys.includes(k))) throw negar();
    if (!objeto(tc.args.origemCliente) || tc.args.origemCliente.versao!==1 || tc.args.origemCliente.clienteId!==args.clienteId) throw negar();
    if (!Object.hasOwn(tc.args,'clienteId') || tc.args.clienteId!==args.clienteId || tc.args.leadId!==args.leadId
      || canonicalHash(resourceType,tc.args,hashKeys)!==ap.contentHash || canonicalHash(resourceType,args,hashKeys)!==ap.contentHash) throw negar();
    const clienteId=await this.clienteDoLead(orgId,args.leadId,db);
    if (clienteId!==args.clienteId) throw negar();
    if (op.fase!=='repedido') {
      if (!ap.aprovadoPorId || (op.atorExecucaoId!==undefined && ap.aprovadoPorId!==op.atorExecucaoId)) throw negar();
      const papeis=await this.exigirPessoa(orgId,ap.aprovadoPorId,clienteId,'aprovacoes.decidir');
      if (!atendeAlcada(ap.alcadaMinima,alcadaDe(papeis))) throw negar();
      if (ap.propostoPorTipo===ActorType.user && ap.propostoPorId===ap.aprovadoPorId) throw negar();
    }
    if (ap.propostoPorTipo===ActorType.user) await this.exigirPessoa(orgId,ap.propostoPorId,clienteId);
    else {
      if (capabilityId!==CONTRATO || ap.propostoPorTipo!==ActorType.system || ap.propostoPorId!=='comercial') throw negar();
      const conflito=await db.approval.findFirst({where:{orgId,capabilityId,resourceType,resourceId,NOT:{propostoPorTipo:ActorType.system,propostoPorId:'comercial'}},select:{id:true}});
      if(conflito) throw negar();
    }
    if(capabilityId===SALA) await exigirVersaoDaPublicacao(db,orgId,approvalId,args,op.fase==='consumida');
    else await exigirOrigemDaEmissao(db,orgId,args,op.fase==='consumida'?ap.id:undefined);
    // PDF e leituras do domínio podem ter aguardado I/O: conferir o estado atual, fora do snapshot.
    if (await this.clienteDoLead(orgId,args.leadId)!==clienteId) throw negar();
    if (op.fase!=='repedido') {
      const papeis=await this.exigirPessoa(orgId,ap.aprovadoPorId!,clienteId,'aprovacoes.decidir');
      if (!atendeAlcada(ap.alcadaMinima,alcadaDe(papeis))) throw negar();
    }
    if (ap.propostoPorTipo===ActorType.user) await this.exigirPessoa(orgId,ap.propostoPorId,clienteId);
    return {proponenteId:ap.propostoPorId,proponenteTipo:ap.propostoPorTipo,aprovadorId:ap.aprovadoPorId,clienteId};
  }
}
