import 'reflect-metadata';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {ClienteEscopoService} from '../src/clientes-escopo/cliente-escopo.service';
import {classificarDeposito} from '../src/clientes-escopo/classificar-deposito';
import {AuditService} from '../src/audit/audit.service';
const url=process.env.COFRE_TEST_DATABASE_URL;
if(url && new URL(url).pathname!=='/cofre_test') throw new Error('Somente banco cofre_test descartável.');
(url?describe:describe.skip)('carteira e classificação em Postgres',()=>{
 let db:PrismaClient,svc:ClienteEscopoService,audit:AuditService;
 const orgId=randomUUID(),other=randomUUID(),atorId=randomUUID(),alvoId=randomUUID(),clienteId=randomUUID();
 beforeAll(async()=>{
  db=new PrismaClient({datasourceUrl:url});audit=new AuditService(db as any);svc=new ClienteEscopoService(db as any,audit);
  await db.org.createMany({data:[{id:orgId,name:'QA carteira',slug:orgId},{id:other,name:'QA fora',slug:other}]});
  await db.partner.create({data:{id:clienteId,orgId,razaoSocial:'Cliente QA',isCliente:true}});
  await db.user.create({data:{id:atorId,orgId,name:'Admin QA',email:atorId+'@test.invalid',passwordHash:'INVALIDO',roles:{create:{orgId,key:'admin_master',name:'Admin'}}}});
  await db.user.create({data:{id:alvoId,orgId,name:'Operador QA',email:alvoId+'@test.invalid',passwordHash:'INVALIDO'}});
  await db.clienteAcessoPerfil.create({data:{orgId,userId:atorId,modo:'ALL'}});
 });
 afterAll(async()=>{await db?.$disconnect();});
 it('novo usuário não herda acesso; concessão e revogação valem sem nova sessão',async()=>{
  await expect(svc.filtro(orgId,alvoId)).rejects.toThrow();
  await svc.configurar(orgId,atorId,alvoId,{modo:'SELECTED',clienteIds:[clienteId]});
  await expect(svc.exigirCliente(orgId,alvoId,clienteId)).resolves.toMatchObject({id:clienteId});
  await svc.configurar(orgId,atorId,alvoId,{modo:'SELECTED',clienteIds:[]});
  await expect(svc.exigirCliente(orgId,alvoId,clienteId)).rejects.toThrow();
  expect(await db.auditLog.count({where:{orgId,action:'cliente.acesso.alterar',entityId:alvoId}})).toBe(2);
 });
 it('recusa autoalteração, ator restrito e concessão cruzada sem efeitos',async()=>{
  await expect(svc.configurar(orgId,atorId,atorId,{modo:'SELECTED',clienteIds:[]})).rejects.toThrow();
  await expect(svc.configurar(orgId,alvoId,atorId,{modo:'ALL',clienteIds:[]})).rejects.toThrow();
  const externo=await db.partner.create({data:{orgId:other,razaoSocial:'Outro org',isCliente:true}});
  await expect(svc.configurar(orgId,atorId,alvoId,{modo:'SELECTED',clienteIds:[externo.id]})).rejects.toThrow();
  expect(await db.clienteAcessoVinculo.count({where:{orgId,userId:alvoId}})).toBe(0);
  await expect(db.clienteAcessoVinculo.create({data:{orgId,userId:alvoId,clienteId:externo.id}})).rejects.toThrow();
 });
 it('classifica pelo recibo sem reemitir link nem alterar ciphertext, TTL ou itens sem relação',async()=>{
  const id=randomUUID(),itemId=randomUUID(),outroItem=randomUUID();
  const tokenHash=createHash('sha256').update(randomUUID()).digest('hex'),expiraEm=new Date(Date.now()+86400000);
  await db.cofreDeposito.create({data:{id,orgId,cliente:'Nome legado',criadoPor:atorId,tokenHash,expiraEm,recebidos:1}});
  for(const x of [itemId,outroItem]) await db.cofreItem.create({data:{id:x,orgId,tipo:'senha',titulo:'Nome legado igual',segredoCifrado:'CIPHERTEXT_SINTETICO',criadoPor:x===itemId?'deposito:'+id:atorId}});
  await db.cofreDepositoRecibo.create({data:{orgId,depositoId:id,envioId:randomUUID(),itemId}});
  const input={orgId,atorId,depositoId:id,clienteId};
  await classificarDeposito(db as any,svc,audit,input);
  const depois=await db.cofreDeposito.findUniqueOrThrow({where:{id}});
  expect(depois).toMatchObject({id,tokenHash,expiraEm,recebidos:1,clienteId,cliente:'Nome legado'});
  expect(await db.cofreItem.findUniqueOrThrow({where:{id:itemId}})).toMatchObject({clienteId,segredoCifrado:'CIPHERTEXT_SINTETICO'});
  expect((await db.cofreItem.findUniqueOrThrow({where:{id:outroItem}})).clienteId).toBe(null);
  await classificarDeposito(db as any,svc,audit,input);
  expect(await db.cofreDepositoRecibo.count({where:{depositoId:id}})).toBe(1);
 });
});
