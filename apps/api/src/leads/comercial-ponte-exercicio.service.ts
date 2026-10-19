import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PonteProjetoPedidoSchema, PonteObrigacaoPedidoSchema, PonteDecisaoPedidoSchema, PonteConfiguracaoSchema,
  PonteSnapshotSchema, type PonteOrigem, type PonteSnapshot, type PonteConfiguracao, type PonteResposta,
  type PonteProjetoDto, type PonteObrigacaoDto, type PonteCatalogos } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ModulosService } from '../tenants/modulos.service';
import { comContexto } from '../common/contexto-execucao';
import { alcadaDe, atendeAlcada, temPapelDeMaquina } from '../approvals/alcada';
import { travarFinanceiro, travarLancamentoFinanceiro } from '../finance/financeiro-exercicio.service';
import { hashComercial, idComercial, lerOrigemComercialPonte, conferirAdocaoEntregaPonte, conferirEntradaComercialPonte } from './comercial-exercicio.service';

type Db = Prisma.TransactionClient;
type Ator = {orgId:string;sub:string};
type Acao = 'projeto'|'obrigacao'|'decisao';
const DOMINIO = 'comercial-ponte-exercicio-v1';
const CP = ['leads.ver','leads.editar','tarefas.ver','tarefas.editar'];
const CO = [...CP,'financeiro.ver','financeiro.editar'];
const CD = ['financeiro.ver','financeiro.editar'];
const LR = ['leads.ver','tarefas.ver'];
const json = (v:unknown) => v as Prisma.InputJsonValue;
function conflito(code:string,message:string):never {throw new ConflictException({code,message});}
function integra():never {return conflito('ponte_registro_inconsistente','O vínculo do exercício está inconsistente.');}
const reciboSchema=z.object({contrato:z.literal(DOMINIO),orgId:z.string(),actorId:z.string(),action:z.enum(['projeto','obrigacao','decisao']),
  entityId:z.string().uuid(),requestId:z.string().uuid(),input:z.unknown(),businessFingerprint:z.string().regex(/^[a-f0-9]{64}$/),
  projectId:z.string().uuid(),obligationId:z.string().uuid().nullable(),decisionId:z.string().uuid().nullable()}).strict();
export function fingerprintNegocioPonte(orgId:string, action:Acao, entityId:string, input:Record<string,unknown>) {
  const {requestId:_,...config}=input;
  return hashComercial({dominio:DOMINIO,orgId,action,entityId,config});
}
export function dinheiroPonte(valor:string) {
  const m=/^([A-Z]{3}) (\d+)\.(\d{2})$/.exec(valor);
  if(!m) conflito('ponte_valor_invalido','Use o valor positivo com moeda e duas casas decimais.');
  const amount=new Prisma.Decimal(m[2]+'.'+m[3]);
  if(!amount.greaterThan(0)||amount.greaterThan('999999999999.99')) conflito('ponte_valor_invalido','O valor excede o limite do lançamento ou não é positivo.');
  return {currency:m[1],amount};
}
const semEfeitos=()=>({tarefaCriada:false,projetoCriado:false,obrigacaoCriada:false,decisaoRegistrada:false,
  pagamentoExecutado:false as const,cobrancaExecutada:false as const,conciliacaoExecutada:false as const});

@Injectable()
export class ComercialPonteExercicioService {
  constructor(private readonly prisma:PrismaService,private readonly audit:AuditService,private readonly modulos:ModulosService){}
  private async ambiente(a:Ator, financeiro=false) {
    if(process.env.ROOTOS_QA_PREVIEW!=='1') throw new NotFoundException('Ponte de exercício não disponível.');
    const ms=await this.modulos.modulosDaOrg(a.orgId);
    if(!ms.has('leads')||!ms.has('trabalho')||financeiro&&!ms.has('financeiro')) throw new NotFoundException('Ponte de exercício não disponível.');
  }
  private async pessoa(db:Db,a:Ator,permissoes:string[],decisor=false) {
    // Última consulta de autorização: atividade da pessoa/empresa, papéis e permissões no mesmo snapshot.
    const u=await db.user.findFirst({where:{id:a.sub,orgId:a.orgId,isActive:true,org:{isActive:true}},
      select:{roles:{where:{orgId:a.orgId},select:{key:true,permissions:{select:{key:true}}}}}});
    const keys=u?.roles.map(r=>r.key)??[], ps=new Set(u?.roles.flatMap(r=>r.permissions.map(p=>p.key))??[]);
    const alcada=alcadaDe(keys);
    if(!u||permissoes.some(p=>!ps.has(p))||temPapelDeMaquina(keys)||decisor&&!atendeAlcada('responsavel',alcada))
      throw new ForbiddenException('O exercício exige acesso atual de uma pessoa com a alçada pertinente.');
    return {ps,alcada};
  }
  private async tx(a:Ator,permissoes:string[],fin:boolean,decisor:boolean,fn:(db:Db)=>Promise<PonteResposta>) {
    await this.ambiente(a,fin);
    return comContexto({orgId:a.orgId,actorId:a.sub,actorType:'user',correlationId:randomUUID(),origem:'http'},()=>this.prisma.$transaction(async db=>{
      await this.pessoa(db,a,permissoes,decisor);
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`comercial-exercicio:${a.orgId}`}))`;
      if(fin) await travarFinanceiro(db,a.orgId);
      const result=await fn(db);
      const final=await this.pessoa(db,a,permissoes,decisor);
      if(decisor && result.efeitos.decisaoRegistrada && result.obrigacao?.decisao?.alcada!==final.alcada)
        throw new ForbiddenException('A alçada mudou antes de confirmar a decisão.');
      if(result && typeof result==='object' && 'capacidades' in result) {
        const response=result;
        if(!final.ps.has('financeiro.ver')){response.obrigacao=null;response.financeiro={situacao:'restrito',pendencias:[]};response.capacidades.podeDecidir=false;}
        if(!final.ps.has('leads.ver')||!final.ps.has('tarefas.ver'))response.projeto=null;
        if(response.obrigacao)response.obrigacao.canDecide=!response.obrigacao.decisao&&!response.obrigacao.impedimento&&final.ps.has('financeiro.editar')&&atendeAlcada('responsavel',final.alcada);
        response.capacidades.podeDecidir=!!response.obrigacao?.canDecide;
        response.capacidades.podeCriarProjeto=CP.every(x=>final.ps.has(x));
        response.capacidades.podeRegistrarObrigacao=CO.every(x=>final.ps.has(x))&&!response.obrigacao;
      }
      return result;
    },{timeout:30000,maxWait:10000}));
  }
  private async origem(db:Db,a:Ator,leadId:string,propostaId:string,aceiteId:string,historica=false) {
    await db.$queryRaw`SELECT "id" FROM "Lead" WHERE "id"=${leadId} AND "orgId"=${a.orgId} FOR SHARE`;
    await db.$queryRaw`SELECT "id" FROM "LeadEvent" WHERE "leadId"=${leadId} AND "orgId"=${a.orgId} AND "type" LIKE 'comercial_qa_%' ORDER BY "id" FOR SHARE`;
    const lead=await db.lead.findFirst({where:{id:leadId,orgId:a.orgId},select:{id:true}});
    if(!lead) throw new NotFoundException('Oportunidade de exercício não encontrada.');
    const es=await db.leadEvent.findMany({where:{orgId:a.orgId,leadId,type:{startsWith:'comercial_qa_'}},orderBy:[{occurredAt:'asc'},{id:'asc'}]});
    return lerOrigemComercialPonte(es,a.orgId,leadId,propostaId,aceiteId,historica);
  }
  private origemProjeto(p:{leadId:string;aceiteId:string;propostaId:string;propostaVersao:number;documentoHash:string;condicoesHash:string}):PonteOrigem {
    return {leadId:p.leadId,aceiteId:p.aceiteId,propostaId:p.propostaId,propostaVersao:p.propostaVersao,documentoHash:p.documentoHash,condicoesHash:p.condicoesHash};
  }
  private async projeto(db:Db,a:Ator,id:string):Promise<PonteProjetoDto> {
    const p=await db.commercialExerciseProject.findFirst({where:{id,orgId:a.orgId}});
    if(!p) throw new NotFoundException('Projeto de exercício não encontrado.');
    const config=PonteConfiguracaoSchema.safeParse(p.configuration); if(!config.success) integra();
    const o=await this.origem(db,a,p.leadId,p.propostaId,p.aceiteId,true);
    if(hashComercial(o.origem)!==hashComercial(this.origemProjeto(p))||p.id!==idComercial([a.orgId,DOMINIO,'projeto',p.aceiteId])) integra();
    const t=await db.workTask.findFirst({where:{id:p.taskId,orgId:a.orgId},select:{title:true,listId:true,statusId:true,assigneeUserId:true,archived:true}});
    if(!t||p.taskId!==idComercial([a.orgId,'comercial-exercicio-v1','entrega',p.aceiteId])) integra();
    const {leadId:_,propostaVersao:__,...refs}=o.origem;
    const exact=fingerprintNegocioPonte(a.orgId,'projeto',p.leadId,{...refs,expectedPropostaVersion:o.origem.propostaVersao,...config.data});
    if(p.creationFingerprint!==exact) integra();
    return {id:p.id,taskId:p.taskId,origem:o.origem,configuracaoOriginal:config.data,atual:t,criadaEm:p.createdAt.toISOString()};
  }
  private async catalogoCondicoes(db:Db,a:Ator,c:PonteSnapshot['condicoes'],lock=false) {
    if(lock) {
      await db.$queryRaw`SELECT "id" FROM "FinanceAccount" WHERE "id"=${c.accountId} AND "orgId"=${a.orgId} FOR SHARE`;
      await db.$queryRaw`SELECT "id" FROM "Partner" WHERE "id"=${c.partnerId} AND "orgId"=${a.orgId} FOR SHARE`;
      await db.$queryRaw`SELECT "id" FROM "ChartAccount" WHERE "id"=${c.chartAccountId} AND "orgId"=${a.orgId} FOR SHARE`;
      if(c.projetoFinanceiroId) await db.$queryRaw`SELECT "id" FROM "Projeto" WHERE "id"=${c.projetoFinanceiroId} AND "orgId"=${a.orgId} FOR SHARE`;
      if(c.departamentoId) await db.$queryRaw`SELECT "id" FROM "Departamento" WHERE "id"=${c.departamentoId} AND "orgId"=${a.orgId} FOR SHARE`;
    }
    const [conta,partner,ch,proj,dep]=await Promise.all([
      db.financeAccount.findFirst({where:{id:c.accountId,orgId:a.orgId,isActive:true,provider:'manual'}}),
      db.partner.findFirst({where:{id:c.partnerId,orgId:a.orgId,ativo:true}}),
      db.chartAccount.findFirst({where:{id:c.chartAccountId,orgId:a.orgId,ativo:true,permiteLancamento:true}}),
      c.projetoFinanceiroId?db.projeto.findFirst({where:{id:c.projetoFinanceiroId,orgId:a.orgId,ativo:true}}):null,
      c.departamentoId?db.departamento.findFirst({where:{id:c.departamentoId,orgId:a.orgId,ativo:true}}):null]);
    if(!conta||!partner||!ch||conta.currency!==c.currency||c.projetoFinanceiroId&&!proj||c.departamentoId&&!dep)
      conflito('ponte_catalogo_alterado','Confira contraparte, conta, classificação, moeda e dimensões atuais.');
  }
  private async obrigacao(db:Db,a:Ator,projectId:string):Promise<PonteObrigacaoDto|null> {
    const o=await db.commercialExerciseObligation.findFirst({where:{orgId:a.orgId,projectId}}); if(!o)return null;
    const v=PonteSnapshotSchema.safeParse(o.snapshot);if(!v.success||hashComercial(v.data)!==o.contentHash||v.data.projectId!==projectId||v.data.transactionId!==o.transactionId)integra();
    if(o.id!==idComercial([a.orgId,DOMINIO,'obrigacao',projectId])||o.transactionId!==idComercial([a.orgId,DOMINIO,'lancamento',projectId])||o.versionId!==idComercial([a.orgId,DOMINIO,'versao',projectId]))integra();
    const snapshot=v.data,p=await db.commercialExerciseProject.findFirst({where:{id:projectId,orgId:a.orgId}});
    if(!p||hashComercial(snapshot.origem)!==hashComercial(this.origemProjeto(p))||snapshot.taskId!==p.taskId)integra();
    const source=await this.origem(db,a,p.leadId,p.propostaId,p.aceiteId,true);
    if(hashComercial(source.origem)!==hashComercial(snapshot.origem)||source.valorCanonico!==snapshot.condicoes.valorCanonico||dinheiroPonte(snapshot.condicoes.valorCanonico).currency!==snapshot.condicoes.currency)integra();
    const t=await db.financeTransaction.findFirst({where:{id:o.transactionId,orgId:a.orgId}});
    const d=await db.commercialExerciseDecision.findFirst({where:{orgId:a.orgId,obligationId:o.id}});
    if(!t||t.status!=='previsto'||t.paidAt||t.reconciledAt||t.contractId||t.externalId||t.source!=='manual'||t.temRateio)integra();
    const c=snapshot.condicoes, money=dinheiroPonte(c.valorCanonico);
    const original={aceiteId:snapshot.origem.aceiteId,propostaId:snapshot.origem.propostaId,expectedPropostaVersion:snapshot.origem.propostaVersao,documentoHash:snapshot.origem.documentoHash,condicoesHash:snapshot.origem.condicoesHash,
      partnerId:c.partnerId,accountId:c.accountId,chartAccountId:c.chartAccountId,projetoFinanceiroId:c.projetoFinanceiroId,departamentoId:c.departamentoId,descricao:c.descricao,valorCanonico:c.valorCanonico,competencia:c.competencia,vencimento:c.vencimento,confirmacaoExercicio:true};
    if(o.creationFingerprint!==fingerprintNegocioPonte(a.orgId,'obrigacao',projectId,original))integra();
    let mudou=t.type!==c.tipo||t.description!==c.descricao||!t.amount.eq(money.amount)||t.accountId!==c.accountId||t.partnerId!==c.partnerId||t.chartAccountId!==c.chartAccountId||
      t.date.toISOString()!==c.competencia||t.dueDate?.toISOString()!==c.vencimento||t.projetoId!==c.projetoFinanceiroId||t.departamentoId!==c.departamentoId||
      await db.transactionSplit.count({where:{orgId:a.orgId,transactionId:t.id}})>0;
    try{await this.catalogoCondicoes(db,a,c);}catch(e){if(e instanceof ConflictException)mudou=true;else throw e;}
    if(d) {
      if(d.versionId!==o.versionId||d.contentHash!==o.contentHash||t.approvalStatus!==(d.aprovar?'aprovado':'rejeitado')||t.approvedById!==d.actorId||t.approvedAt?.toISOString()!==d.createdAt.toISOString())integra();
      const r=await db.commercialExerciseRequest.findFirst({where:{orgId:a.orgId,requestId:d.requestId}});
      if(!r||r.action!=='decisao'||r.fingerprint!==d.fingerprint||r.actorId!==d.actorId)integra();
      const receipt=this.lerRecibo(r),input=PonteDecisaoPedidoSchema.parse(receipt.input);
      if(receipt.obligationId!==o.id||receipt.decisionId!==d.id||input.versionId!==d.versionId||input.contentHash!==d.contentHash||input.expectedUpdatedAt!==d.expectedUpdatedAt.toISOString()||input.aprovar!==d.aprovar||input.motivo!==d.motivo||hashComercial(d.response)!==hashComercial({id:d.id,requestId:d.requestId,aprovar:d.aprovar}))integra();
    }else if(t.approvalStatus!=='aguardando'||t.approvedById||t.approvedAt)integra();
    return {id:o.id,transactionId:t.id,versionId:o.versionId,contentHash:o.contentHash,expectedUpdatedAt:t.updatedAt.toISOString(),snapshot,
      status:'previsto',approvalStatus:t.approvalStatus as PonteObrigacaoDto['approvalStatus'],paidAt:null,reconciledAt:null,
      decisao:d?{id:d.id,atorId:d.actorId,aprovar:d.aprovar,motivo:d.motivo,alcada:d.alcada as 'responsavel'|'titular',decididaEm:d.createdAt.toISOString()}:null,
      canDecide:false,impedimento:d?'Esta obrigação já tem uma decisão confirmada.':mudou?'As condições atuais divergem do registro.':null};
  }
  private lerRecibo(r:{orgId:string;actorId:string;action:string;entityId:string;requestId:string;fingerprint:string;response:unknown}) {
    const v=reciboSchema.safeParse(r.response);if(!v.success)integra();const p=v.data;
    if(p.orgId!==r.orgId||p.actorId!==r.actorId||p.action!==r.action||p.entityId!==r.entityId||p.requestId!==r.requestId||p.projectId!==r.entityId||
      hashComercial({dominio:DOMINIO,orgId:r.orgId,actorId:r.actorId,action:r.action,entityId:r.entityId,input:p.input})!==r.fingerprint)integra();
    const schema=p.action==='projeto'?PonteProjetoPedidoSchema:p.action==='obrigacao'?PonteObrigacaoPedidoSchema:PonteDecisaoPedidoSchema;
    const parsed=schema.safeParse(p.input);if(!parsed.success||parsed.data.requestId!==r.requestId)integra();
    return p;
  }
  private async replay(db:Db,a:Ator,action:Acao,entityId:string,input:{requestId:string}) {
    const fp=hashComercial({dominio:DOMINIO,orgId:a.orgId,actorId:a.sub,action,entityId,input});
    const prior=await db.commercialExerciseRequest.findFirst({where:{orgId:a.orgId,requestId:input.requestId}});
    if(prior) {this.lerRecibo(prior);if(prior.actorId!==a.sub||prior.action!==action||prior.entityId!==entityId||prior.fingerprint!==fp)
      conflito('ponte_pedido_conflito','Este pedido já foi usado por outra pessoa ou com outro conteúdo.');}
    return {fp,prior};
  }
  private async registrar(db:Db,a:Ator,action:Acao,projectId:string,input:{requestId:string},fp:string,businessFingerprint:string,obligationId:string|null,decisionId:string|null) {
    await db.commercialExerciseRequest.create({data:{id:idComercial([a.orgId,DOMINIO,'pedido',input.requestId]),orgId:a.orgId,requestId:input.requestId,actorId:a.sub,action,entityId:projectId,fingerprint:fp,
      response:json({contrato:DOMINIO,orgId:a.orgId,actorId:a.sub,action,entityId:projectId,requestId:input.requestId,input,businessFingerprint,projectId,obligationId,decisionId})}});
  }
  private async resposta(db:Db,a:Ator,projectId:string,requestId:string,replayed:boolean,required:string[],effects=semEfeitos(),financeOnly=false):Promise<PonteResposta> {
    const p=await db.commercialExerciseProject.findFirst({where:{id:projectId,orgId:a.orgId}});if(!p)integra();
    const inicial=await this.pessoa(db,a,required);
    const proj=!financeOnly||inicial.ps.has('leads.ver')&&inicial.ps.has('tarefas.ver')?await this.projeto(db,a,projectId):null;
    const ob=inicial.ps.has('financeiro.ver')?await this.obrigacao(db,a,projectId):null;
    const pessoa=await this.pessoa(db,a,required);
    const visibleOb=pessoa.ps.has('financeiro.ver')?ob:null;
    if(visibleOb)visibleOb.canDecide=!visibleOb.decisao&&!visibleOb.impedimento&&pessoa.ps.has('financeiro.editar')&&atendeAlcada('responsavel',pessoa.alcada);
    return {modo:'exercicio',requestId,replayed,escopo:{orgId:a.orgId,userId:a.sub},
      projeto:pessoa.ps.has('leads.ver')&&pessoa.ps.has('tarefas.ver')?proj:null,obrigacao:visibleOb,
      financeiro:{situacao:visibleOb?'registrado':pessoa.ps.has('financeiro.ver')?'pendente':'restrito',pendencias:visibleOb?[]:['Identificar contraparte, conta, classificação, moeda, competência e vencimento.']},
      capacidades:{podeCriarProjeto:CP.every(x=>pessoa.ps.has(x)),podeRegistrarObrigacao:CO.every(x=>pessoa.ps.has(x))&&!visibleOb,podeDecidir:!!visibleOb?.canDecide},efeitos:effects};
  }
  async criarProjeto(a:Ator,leadId:string,body:unknown) {
    const input=PonteProjetoPedidoSchema.parse(body),id=idComercial([a.orgId,DOMINIO,'projeto',input.aceiteId]);
    return this.tx(a,CP,false,false,async db=>{
      const {fp,prior}=await this.replay(db,a,'projeto',id,input);
      if(prior){const p=await db.commercialExerciseProject.findFirst({where:{id,orgId:a.orgId,leadId}});if(!p)throw new NotFoundException('Pedido não encontrado nesta oportunidade.');return this.resposta(db,a,id,input.requestId,true,CP);}
      const business=fingerprintNegocioPonte(a.orgId,'projeto',leadId,input);
      const existing=await db.commercialExerciseProject.findFirst({where:{orgId:a.orgId,aceiteId:input.aceiteId}});
      if(existing){if(existing.leadId!==leadId||existing.creationFingerprint!==business)conflito('ponte_projeto_conflito','Este aceite já possui projeto com outra configuração.');
        await this.projeto(db,a,existing.id);await this.registrar(db,a,'projeto',existing.id,input,fp,business,null,null);return this.resposta(db,a,existing.id,input.requestId,true,CP);}
      const o=await this.origem(db,a,leadId,input.propostaId,input.aceiteId);
      if(o.origem.propostaVersao!==input.expectedPropostaVersion||o.origem.documentoHash!==input.documentoHash||o.origem.condicoesHash!==input.condicoesHash)conflito('ponte_acordo_alterado','A proposta ou as condições mudaram.');
      const config:PonteConfiguracao={listId:input.listId,statusId:input.statusId,title:input.title,assigneeUserId:input.assigneeUserId};
      await db.$queryRaw`SELECT "id" FROM "WorkList" WHERE "id"=${config.listId} AND "orgId"=${a.orgId} FOR SHARE`;
      await db.$queryRaw`SELECT "id" FROM "WorkStatus" WHERE "id"=${config.statusId} AND "orgId"=${a.orgId} FOR SHARE`;
      if(!await db.workList.findFirst({where:{id:config.listId,orgId:a.orgId}})||!await db.workStatus.findFirst({where:{id:config.statusId,listId:config.listId,orgId:a.orgId}})||
        config.assigneeUserId&&!await db.user.findFirst({where:{id:config.assigneeUserId,orgId:a.orgId,isActive:true}}))throw new NotFoundException('Lista, etapa ou responsável não disponíveis.');
      const taskId=idComercial([a.orgId,'comercial-exercicio-v1','entrega',input.aceiteId]);
      const legacy=await db.leadEvent.findMany({where:{orgId:a.orgId,leadId,type:'comercial_qa_entrega'}});
      const adopt=conferirAdocaoEntregaPonte(legacy,a.orgId,leadId,o.origem,config);
      const task=await db.workTask.findFirst({where:{id:taskId,orgId:a.orgId}});
      if(adopt&&!task||!adopt&&task)integra();
      if(!adopt)await db.workTask.create({data:{id:taskId,orgId:a.orgId,...config,description:`Projeto de exercício QA. Origem /leads/${leadId}. Aceite QA ${input.aceiteId}.`}});
      await db.commercialExerciseProject.create({data:{id,orgId:a.orgId,...o.origem,taskId,configuration:json(config),creationFingerprint:business,createdById:a.sub}});
      await this.registrar(db,a,'projeto',id,input,fp,business,null,null);
      await this.audit.log({orgId:a.orgId,actorId:a.sub,action:'comercial.ponte.projeto',entityType:'commercial_exercise_project',entityId:id,after:{modo:'exercicio',taskId,requestId:input.requestId,adotada:adopt}},db);
      const effects=semEfeitos();effects.projetoCriado=true;effects.tarefaCriada=!adopt;return this.resposta(db,a,id,input.requestId,false,CP,effects);
    });
  }
  async registrarObrigacao(a:Ator,leadId:string,projectId:string,body:unknown) {
    const input=PonteObrigacaoPedidoSchema.parse(body);
    return this.tx(a,CO,true,false,async db=>{
      const {fp,prior}=await this.replay(db,a,'obrigacao',projectId,input);const p=await this.projeto(db,a,projectId);
      if(p.origem.leadId!==leadId)throw new NotFoundException('Projeto não encontrado nesta oportunidade.');
      if(prior)return this.resposta(db,a,projectId,input.requestId,true,CO);
      const business=fingerprintNegocioPonte(a.orgId,'obrigacao',projectId,input);
      const existing=await db.commercialExerciseObligation.findFirst({where:{orgId:a.orgId,projectId}});
      if(existing){if(existing.creationFingerprint!==business)conflito('ponte_obrigacao_conflito','Este projeto já possui obrigação com outra configuração.');
        await this.obrigacao(db,a,projectId);await this.registrar(db,a,'obrigacao',projectId,input,fp,business,existing.id,null);return this.resposta(db,a,projectId,input.requestId,true,CO);}
      const o=await this.origem(db,a,leadId,input.propostaId,input.aceiteId);
      if(hashComercial(o.origem)!==hashComercial(p.origem)||input.expectedPropostaVersion!==o.origem.propostaVersao||input.documentoHash!==o.origem.documentoHash||input.condicoesHash!==o.origem.condicoesHash||input.valorCanonico!==o.valorCanonico)
        conflito('ponte_acordo_alterado','A origem ou o valor integral da proposta divergem.');
      const money=dinheiroPonte(input.valorCanonico),id=idComercial([a.orgId,DOMINIO,'obrigacao',projectId]),transactionId=idComercial([a.orgId,DOMINIO,'lancamento',projectId]);
      const condicoes:PonteSnapshot['condicoes']={tipo:'entrada',descricao:input.descricao,valorCanonico:input.valorCanonico,currency:money.currency,
        competencia:input.competencia,vencimento:input.vencimento,accountId:input.accountId,partnerId:input.partnerId,chartAccountId:input.chartAccountId,
        projetoFinanceiroId:input.projetoFinanceiroId,departamentoId:input.departamentoId,contractId:null,temRateio:false};
      await this.catalogoCondicoes(db,a,condicoes,true);
      const snapshot:PonteSnapshot={schemaVersion:1,modo:'exercicio',origem:o.origem,projectId,taskId:p.taskId,transactionId,condicoes};
      await db.financeTransaction.create({data:{id:transactionId,orgId:a.orgId,accountId:input.accountId,partnerId:input.partnerId,chartAccountId:input.chartAccountId,
        projetoId:input.projetoFinanceiroId,departamentoId:input.departamentoId,type:'entrada',description:input.descricao,amount:money.amount,date:new Date(input.competencia),dueDate:new Date(input.vencimento),
        status:'previsto',approvalStatus:'aguardando',source:'manual',contractId:null,externalId:null,temRateio:false,paidAt:null,reconciledAt:null}});
      await db.commercialExerciseObligation.create({data:{id,orgId:a.orgId,projectId,transactionId,versionId:idComercial([a.orgId,DOMINIO,'versao',projectId]),contentHash:hashComercial(snapshot),snapshot:json(snapshot),creationFingerprint:business,createdById:a.sub}});
      await this.registrar(db,a,'obrigacao',projectId,input,fp,business,id,null);
      await this.audit.log({orgId:a.orgId,actorId:a.sub,action:'comercial.ponte.obrigacao',entityType:'commercial_exercise_obligation',entityId:id,after:{modo:'exercicio',transactionId,projectId,requestId:input.requestId}},db);
      const effects=semEfeitos();effects.obrigacaoCriada=true;return this.resposta(db,a,projectId,input.requestId,false,CO,effects);
    });
  }
  async decidir(a:Ator,transactionId:string,body:unknown) {
    const input=PonteDecisaoPedidoSchema.parse(body);
    return this.tx(a,CD,true,true,async db=>{
      const o=await db.commercialExerciseObligation.findFirst({where:{orgId:a.orgId,transactionId}});if(!o)throw new NotFoundException('Obrigação comercial de exercício não encontrada.');
      const {fp,prior}=await this.replay(db,a,'decisao',o.projectId,input);
      if(prior)return this.resposta(db,a,o.projectId,input.requestId,true,CD,semEfeitos(),true);
      await travarLancamentoFinanceiro(db,a.orgId,transactionId);
      const det=await this.obrigacao(db,a,o.projectId);if(!det)integra();
      if(det.decisao)conflito('ponte_ja_decidida','Esta obrigação já tem uma decisão confirmada.');
      if(det.impedimento||input.versionId!==det.versionId||input.contentHash!==det.contentHash||input.expectedUpdatedAt!==det.expectedUpdatedAt)conflito('ponte_obrigacao_alterada','A obrigação mudou. Reabra o detalhe antes de decidir.');
      await this.catalogoCondicoes(db,a,det.snapshot.condicoes,true);
      const pessoa=await this.pessoa(db,a,CD,true),now=new Date(),id=idComercial([a.orgId,DOMINIO,'decisao',o.id]);
      const changed=await db.financeTransaction.updateMany({where:{id:transactionId,orgId:a.orgId,updatedAt:new Date(input.expectedUpdatedAt),status:'previsto',approvalStatus:'aguardando',paidAt:null,reconciledAt:null},data:{approvalStatus:input.aprovar?'aprovado':'rejeitado',approvedById:a.sub,approvedAt:now}});
      if(changed.count!==1)conflito('ponte_obrigacao_alterada','A obrigação mudou durante a decisão.');
      const business=fingerprintNegocioPonte(a.orgId,'decisao',o.projectId,input);
      await this.registrar(db,a,'decisao',o.projectId,input,fp,business,o.id,id);
      await db.commercialExerciseDecision.create({data:{id,orgId:a.orgId,obligationId:o.id,requestId:input.requestId,actorId:a.sub,fingerprint:fp,versionId:o.versionId,contentHash:o.contentHash,
        expectedUpdatedAt:new Date(input.expectedUpdatedAt),aprovar:input.aprovar,motivo:input.motivo,alcada:pessoa.alcada!,response:json({id,requestId:input.requestId,aprovar:input.aprovar}),createdAt:now}});
      await this.audit.log({orgId:a.orgId,actorId:a.sub,action:'comercial.ponte.decisao',entityType:'commercial_exercise_obligation',entityId:o.id,after:{modo:'exercicio',decisionId:id,requestId:input.requestId,aprovar:input.aprovar}},db);
      const effects=semEfeitos();effects.decisaoRegistrada=true;const result=await this.resposta(db,a,o.projectId,input.requestId,false,CD,effects,true);
      const final=await this.pessoa(db,a,CD,true);if(final.alcada!==pessoa.alcada)throw new ForbiddenException('A alçada mudou durante a decisão.');return result;
    });
  }
  async detalheFinanceiro(a:Ator,transactionId:string) {
    await this.ambiente(a,true);return comContexto({orgId:a.orgId,actorId:a.sub,actorType:'user',correlationId:randomUUID(),origem:'http'},()=>this.prisma.$transaction(async db=>{
      await this.pessoa(db,a,['financeiro.ver']);const o=await db.commercialExerciseObligation.findFirst({where:{orgId:a.orgId,transactionId}});
      if(!o)throw new NotFoundException('Obrigação comercial de exercício não encontrada.');return this.resposta(db,a,o.projectId,randomUUID(),false,['financeiro.ver'],semEfeitos(),true);
    }));
  }
  async ler(a:Ator,leadId:string) {
    await this.ambiente(a);return comContexto({orgId:a.orgId,actorId:a.sub,actorType:'user',correlationId:randomUUID(),origem:'http'},()=>this.prisma.$transaction(async db=>{
      await this.pessoa(db,a,LR);const ps=await db.commercialExerciseProject.findMany({where:{orgId:a.orgId,leadId},orderBy:{createdAt:'asc'},take:2});
      if(ps.length>1)conflito('ponte_acordos_multiplos','Há mais de um projeto de exercício. Abra a origem específica.');
      if(!ps.length){if(!await db.lead.findFirst({where:{id:leadId,orgId:a.orgId}}))throw new NotFoundException('Oportunidade não encontrada.');const entradas=await db.leadEvent.findMany({where:{orgId:a.orgId,leadId,type:'comercial_qa_entrada'}});conferirEntradaComercialPonte(entradas,a.orgId,leadId);const pessoa=await this.pessoa(db,a,LR);
        return {modo:'exercicio' as const,requestId:randomUUID(),replayed:false,escopo:{orgId:a.orgId,userId:a.sub},projeto:null,obrigacao:null,financeiro:{situacao:'pendente' as const,pendencias:['Abrir projeto de exercício a partir de aceite QA.']},capacidades:{podeCriarProjeto:CP.every(x=>pessoa.ps.has(x)),podeRegistrarObrigacao:false,podeDecidir:false},efeitos:semEfeitos()};}
      return this.resposta(db,a,ps[0].id,randomUUID(),false,LR);
    }));
  }
  async porPedido(a:Ator,requestId:string,destino:{leadId?:string;transactionId?:string}) {
    await this.ambiente(a,!!destino.transactionId);const required=destino.transactionId?['financeiro.ver']:LR;
    return comContexto({orgId:a.orgId,actorId:a.sub,actorType:'user',correlationId:randomUUID(),origem:'http'},()=>this.prisma.$transaction(async db=>{
      await this.pessoa(db,a,required);const r=await db.commercialExerciseRequest.findFirst({where:{orgId:a.orgId,requestId,actorId:a.sub}});
      if(!r)throw new NotFoundException('Pedido de exercício não encontrado.');const receipt=this.lerRecibo(r);
      const p=await db.commercialExerciseProject.findFirst({where:{id:r.entityId,orgId:a.orgId}});if(!p)integra();
      if(destino.leadId&&(p.leadId!==destino.leadId||r.action==='decisao'))throw new NotFoundException('Pedido não encontrado nesta oportunidade.');
      if(destino.transactionId){const o=await db.commercialExerciseObligation.findFirst({where:{orgId:a.orgId,projectId:p.id,transactionId:destino.transactionId}});
        if(!o||receipt.obligationId!==o.id||r.action!=='decisao')throw new NotFoundException('Pedido não encontrado nesta obrigação.');}
      if(receipt.obligationId){const o=await db.commercialExerciseObligation.findFirst({where:{orgId:a.orgId,projectId:p.id,id:receipt.obligationId}});if(!o)integra();}
      if(receipt.decisionId&&!await db.commercialExerciseDecision.findFirst({where:{id:receipt.decisionId,orgId:a.orgId,requestId}}))integra();
      return this.resposta(db,a,p.id,requestId,true,required,semEfeitos(),!!destino.transactionId);
    }));
  }
  async catalogos(a:Ator,leadId:string):Promise<PonteCatalogos> {
    await this.ambiente(a);return comContexto({orgId:a.orgId,actorId:a.sub,actorType:'user',correlationId:randomUUID(),origem:'http'},()=>this.prisma.$transaction(async db=>{
      const initial=await this.pessoa(db,a,LR);
      const entradas=await db.leadEvent.findMany({where:{orgId:a.orgId,leadId,type:'comercial_qa_entrada'}});conferirEntradaComercialPonte(entradas,a.orgId,leadId);
      const listas=await db.workList.findMany({where:{orgId:a.orgId},select:{id:true,name:true,statuses:{where:{orgId:a.orgId},select:{id:true,name:true}}},orderBy:{name:'asc'},take:200});
      const users=await db.user.findMany({where:{orgId:a.orgId,isActive:true},select:{id:true,name:true},orderBy:{name:'asc'},take:200});
      let financeiro:PonteCatalogos['financeiro']=null;
      if(initial.ps.has('financeiro.ver')){const [cs,ps,ch,pr,dep]=await Promise.all([
        db.financeAccount.findMany({where:{orgId:a.orgId,isActive:true,provider:'manual'},select:{id:true,name:true,currency:true},take:200}),
        db.partner.findMany({where:{orgId:a.orgId,ativo:true},select:{id:true,razaoSocial:true},take:200}),
        db.chartAccount.findMany({where:{orgId:a.orgId,ativo:true,permiteLancamento:true},select:{id:true,nome:true,codigo:true},take:200}),
        db.projeto.findMany({where:{orgId:a.orgId,ativo:true},select:{id:true,nome:true},take:200}),db.departamento.findMany({where:{orgId:a.orgId,ativo:true},select:{id:true,nome:true},take:200})]);
        financeiro={contas:cs.map(c=>({id:c.id,nome:c.name,currency:c.currency})),contrapartes:ps.map(p=>({id:p.id,nome:p.razaoSocial})),classificacoes:ch,projetos:pr,departamentos:dep};}
      const final=await this.pessoa(db,a,LR);return {modo:'exercicio',escopo:{orgId:a.orgId,userId:a.sub},listas:listas.map(l=>({id:l.id,nome:l.name,etapas:l.statuses.map(s=>({id:s.id,nome:s.name}))})),responsaveis:users.map(u=>({id:u.id,nome:u.name})),financeiro:final.ps.has('financeiro.ver')?financeiro:null};
    }));
  }
}
