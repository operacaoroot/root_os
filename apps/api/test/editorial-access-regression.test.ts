import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { HttpException } from '@nestjs/common';
import { EditorialService } from '../src/pauta/editorial.service';
import { MarketingPreparacaoService } from '../src/marketing-preparacao/marketing-preparacao.service';
import { WorkFilesService } from '../src/work/work-files.service';
import { AuditService } from '../src/audit/audit.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';
const URL=process.env.TEST_DATABASE_URL; exigirBancoDescartavel(URL??'', 'Regressões de acesso Editorial com fixture própria');
const uid=randomUUID, org=uid(), author=uid(), approver=uid();
const keys=['pauta.ver','pauta.editar','pauta.publicar','tarefas.ver','tarefas.editar','bio.editar','admin.usuarios'];
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function code(p:Promise<unknown>){try{await p;return 200;}catch(e){if(e instanceof HttpException)return e.getStatus();throw e;}}
describe.skipIf(!URL)('Editorial: acesso revogado durante leitura no Postgres',()=>{
 let db:PrismaClient,other:PrismaClient,files:WorkFilesService,audit:AuditService,svc:EditorialService,marketing:MarketingPreparacaoService;
 let root:string,roleAuthor:string,roleApprover:string,list:string,release:string,task:string,external:string,baseline:string;
 const bytes=Buffer.from('Arquivo descartável da revisão independente F05');
 async function reset(){
  for(const table of ['MarketingPreparation','MarketingAccountConfig','EditorialProduction','EditorialDecision']) await db.$executeRawUnsafe('DELETE FROM "'+table+'" WHERE "orgId"=$1',org);
  await db.$executeRaw`UPDATE "EditorialMaterial" SET "selectedVersionId"=NULL WHERE "orgId"=${org}`;
  for(const table of ['EditorialVersion','EditorialMaterial']) await db.$executeRawUnsafe('DELETE FROM "'+table+'" WHERE "orgId"=$1',org);
  await db.auditLog.deleteMany({where:{orgId:org}}); await db.bioConexao.deleteMany({where:{orgId:org}});
 }
 async function approved(){
  const made=await svc.criar(org,author,{requestId:uid(),taskId:task,releaseStatusId:release,title:'QA revisão independente',body:'Versão um exata da revisão',sourceRef:'fixture descartável própria',files:[{taskExternalId:external,fileId:'prova'}]});
  const v=(await db.$queryRaw<any[]>`SELECT * FROM "EditorialVersion" WHERE "id"=${made.versionId} AND "orgId"=${org}`)[0];
  const d=await svc.decidir(org,approver,{requestId:uid(),versionId:v.id,contentHash:v.contentHash,state:'approved',reason:'Revisão independente de exercício'});
  return {made,v,input:{requestId:uid(),taskId:task,versionId:v.id,decisionId:d.decisionId,contentHash:v.contentHash}};
 }
 async function delayedFile<T>(action:()=>Promise<T>,revoke:()=>Promise<unknown>){
  const real=files.read.bind(files); let reached!:()=>void,go!:()=>void;
  const gate=new Promise<void>(r=>reached=r),resume=new Promise<void>(r=>go=r);
  vi.spyOn(files,'read').mockImplementationOnce(async(...args)=>{const read=await real(...args); reached(); await resume; return read;});
  const running=action(); await gate; try{await revoke();}finally{go();}return running;
 }
 beforeAll(async()=>{
  db=new PrismaClient({datasources:{db:{url:URL}}});other=new PrismaClient({datasources:{db:{url:URL}}});
  const p=db as unknown as PrismaService;files=new WorkFilesService(p);audit=new AuditService(p);svc=new EditorialService(p,audit,files);marketing=new MarketingPreparacaoService(p,audit,svc);
  await db.org.create({data:{id:org,name:'QA revisão Comercial→Editorial',slug:'qa-review-f05-'+org}});
  const permissions=await db.permission.findMany({where:{key:{in:keys}}});expect(permissions).toHaveLength(keys.length);
  roleAuthor=(await db.role.create({data:{orgId:org,key:'analista',name:'QA autor próprio',permissions:{connect:permissions.map(p=>({id:p.id}))}}})).id;
  roleApprover=(await db.role.create({data:{orgId:org,key:'gestor_marketing',name:'QA aprovador próprio',permissions:{connect:permissions.map(p=>({id:p.id}))}}})).id;
  for(const id of [author,approver])await db.user.create({data:{id,orgId:org,name:'Pessoa descartável de revisão',email:id+'@qa.invalid',passwordHash:'sem-login',roles:{connect:{id:id===author?roleAuthor:roleApprover}}}});
  list=(await db.workList.create({data:{orgId:org,name:'QA lista de revisão'}})).id;release=(await db.workStatus.create({data:{orgId:org,listId:list,name:'QA liberação explícita'}})).id;
  external='qa-review-'+org;task=(await db.workTask.create({data:{orgId:org,listId:list,statusId:release,title:'QA cartão próprio da revisão',externalId:external}})).id;
  baseline=hash(await db.workTask.findUnique({where:{id:task}}));
  root=await mkdtemp(join(tmpdir(),'rootos-review-f05-'));process.env.WORK_FILES_ROOT=root;
 });
 beforeEach(async()=>{
  vi.restoreAllMocks();await reset();
  await db.user.updateMany({where:{id:{in:[author,approver]}},data:{isActive:true}});
  await db.user.update({where:{id:author},data:{roles:{set:[{id:roleAuthor}]}}});await db.user.update({where:{id:approver},data:{roles:{set:[{id:roleApprover}]}}});
  await writeFile(join(root,'prova.txt'),bytes);await writeFile(join(root,'attachments-index.json'),JSON.stringify({orgId:org,files:[{taskId:external,id:'prova',name:'prova.txt',path:'prova.txt',sha256:hashBytes(bytes),size:bytes.length}]}));
 });
 afterAll(async()=>{
  vi.restoreAllMocks();if(db){await reset();const ownCardAfter=hash(await db.workTask.findUnique({where:{id:task}}));await db.workTask.deleteMany({where:{orgId:org}});await db.workStatus.deleteMany({where:{orgId:org}});await db.workList.deleteMany({where:{orgId:org}});await db.user.deleteMany({where:{orgId:org}});await db.role.deleteMany({where:{orgId:org}});await db.org.delete({where:{id:org}});
  expect(ownCardAfter).toBe(baseline);expect(await db.org.count({where:{id:org}})).toBe(0);await db.$disconnect();}
  await other?.$disconnect();if(root)await rm(root,{recursive:true,force:true});delete process.env.WORK_FILES_ROOT;
 });
 it('revogação de alçada confirmada durante leitura impede nova produção',async()=>{
  const a=await approved();const result=await delayedFile(()=>code(svc.produzir(org,author,a.input)),()=>other.user.update({where:{id:approver},data:{roles:{set:[{id:roleAuthor}]}}}));const rows=await db.$queryRaw<any[]>`SELECT * FROM "EditorialProduction" WHERE "orgId"=${org}`;console.info(JSON.stringify({controle:'revogacao-no-io-producao',result,efeitos:rows.length}));expect(result).toBe(403);expect(rows).toHaveLength(0);
 });
 it('inativação da pessoa confirmada durante leitura impede nova produção',async()=>{
  const a=await approved();const result=await delayedFile(()=>code(svc.produzir(org,author,a.input)),()=>other.user.update({where:{id:author},data:{isActive:false}}));const rows=await db.$queryRaw<any[]>`SELECT * FROM "EditorialProduction" WHERE "orgId"=${org}`;console.info(JSON.stringify({controle:'revogacao-no-io-producao',result,efeitos:rows.length}));expect(result).toBe(403);expect(rows).toHaveLength(0);
 });
 it('revogação de alçada durante leitura também impede preparo do destino',async()=>{
  const a=await approved();const c=await db.bioConexao.create({data:{orgId:org,plataforma:'instagram',externalId:uid(),handle:'qa_revisao_f05',tokenCifrado:'fixture-sem-token',finalidade:'publicacao',status:'ok',escopos:'instagram_business_content_publish'}});
  const account=(await marketing.configurar(org,author,{requestId:uid(),connectionId:c.id,ownerId:author,operators:[]})).account;
  const input={...a.input,accountId:account.id,expectedAccountRevision:account.revision,scheduledAt:new Date(Date.now()+86400000).toISOString(),timezone:'America/Sao_Paulo'};
  const result=await delayedFile(()=>code(marketing.preparar(org,author,input)),()=>other.user.update({where:{id:approver},data:{roles:{set:[{id:roleAuthor}]}}}));const rows=await db.$queryRaw<any[]>`SELECT * FROM "MarketingPreparation" WHERE "orgId"=${org}`;console.info(JSON.stringify({controle:'revogacao-no-io-preparo',result,efeitos:rows.length}));expect(result).toBe(403);expect(rows).toHaveLength(0);
 });
 it('inativação durante leitura não registra material inicial',async()=>{
  const input={requestId:uid(),taskId:task,releaseStatusId:release,title:'QA criação concorrente',body:'Corpo próprio para revisão',sourceRef:'fixture própria',files:[{taskExternalId:external,fileId:'prova'}]};
  const result=await delayedFile(()=>code(svc.criar(org,author,input)),()=>other.user.update({where:{id:author},data:{isActive:false}}));
  const rows=await db.$queryRaw<any[]>`SELECT * FROM "EditorialMaterial" WHERE "orgId"=${org}`;console.info(JSON.stringify({controle:'inativacao-no-io-material',result,efeitos:rows.length}));expect(result).toBe(403);expect(rows).toHaveLength(0);
 });
 it('inativação durante leitura não seleciona nova versão',async()=>{
  const a=await approved();const input={requestId:uid(),expectedRevision:1,title:'QA versão recusada',body:'Novo corpo próprio',sourceRef:'fixture própria v2',files:[{taskExternalId:external,fileId:'prova'}]};
  const result=await delayedFile(()=>code(svc.prepararVersao(org,author,a.made.materialId,input)),()=>other.user.update({where:{id:author},data:{isActive:false}}));
  const rows=await db.$queryRaw<any[]>`SELECT * FROM "EditorialVersion" WHERE "orgId"=${org}`;const material=(await db.$queryRaw<any[]>`SELECT * FROM "EditorialMaterial" WHERE "id"=${a.made.materialId}`)[0];console.info(JSON.stringify({controle:'inativacao-no-io-version',result,versoes:rows.length,revision:material.revision}));expect(result).toBe(403);expect(rows).toHaveLength(1);expect(material.selectedVersionId).toBe(a.v.id);
 });
});
function hashBytes(bytes:Buffer){return createHash('sha256').update(bytes).digest('hex');}
