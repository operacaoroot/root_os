import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { ClienteEscopoService } from '../src/clientes-escopo/cliente-escopo.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { PermissionsGuard } from '../src/auth/permissions.guard';
import { ComercialCarteiraController } from '../src/comercial/comercial-carteira.controller';
import { ComercialCarteiraService } from '../src/comercial/comercial-carteira.service';
import { FinanceCarteiraController } from '../src/finance/finance-carteira.controller';
import { FinanceCarteiraService } from '../src/finance/finance-carteira.service';
import { ComercialController } from '../src/comercial/comercial.controller';
import { FichaService } from '../src/comercial/ficha.service';
import { ConfigComercialService } from '../src/comercial/config.service';
import { ContratosController } from '../src/comercial/contratos/contratos.controller';
import { ContratosService } from '../src/comercial/contratos/contratos.service';
import { EmissaoDoContratoService } from '../src/comercial/contratos/emissao.service';
import { ClienteEscopoInterceptor } from '../src/clientes-escopo/cliente-escopo.interceptor';

const url=process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL é obrigatório para a prova de carteiras.');
{
  const u=new URL(url);
  const loopback=['127.0.0.1','localhost'].includes(u.hostname);
  const bancoCI=(u.port==='5432'||u.port==='') && u.pathname==='/marketing_os_test';
  const cloneQA=u.port==='55582' && /^\/rootos_.*(?:write|test|dev|local)/.test(u.pathname);
  const bancoDoLote=u.port==='55439' && u.pathname==='/comercial_finance_test';
  const bancoLote7=u.port==='55585' && u.pathname==='/rootos_lote7_test';
  if(!loopback||!(bancoCI||cloneQA||bancoDoLote||bancoLote7)) throw new Error('Somente bancos locais de teste de carteiras.');
}
describe('carteiras comercial e financeira: HTTP e PostgreSQL isolados',()=>{
  let db:PrismaClient, app:INestApplication, jwt:JwtService, base:string, token:string;
  let orgId:string, outraOrgId:string, actorId:string, vazioId:string, semPerfilId:string, roleId:string, a:string,b:string, interno:string, leadInterno:string, leadA:string,leadB:string,leadNull:string, contratoA:string,contratoB:string, acordoA:string, reciboA:string, reciboB:string;
  let trocarAntesDaSegunda:(()=>Promise<void>)|null=null;
  beforeAll(async()=>{
    db=new PrismaClient({datasources:{db:{url:url!}}});
    const org=await db.org.create({data:{name:'QA carteira',slug:'qa-carteira-'+randomUUID()}});orgId=org.id;
    const outra=await db.org.create({data:{name:'QA vizinha',slug:'qa-vizinha-'+randomUUID()}});outraOrgId=outra.id;
    const perms=await Promise.all(['leads.ver','financeiro.ver'].map(key=>db.permission.upsert({where:{key},update:{},create:{key}})));
    const role=await db.role.create({data:{orgId,key:'qa_carteira',name:'QA',permissions:{connect:perms.map(p=>({id:p.id}))}}});
    roleId=role.id;
    actorId=(await db.user.create({data:{orgId,name:'QA',email:randomUUID()+'@qa.invalid',passwordHash:'x',roles:{connect:{id:role.id}}}})).id;
    await db.clienteAcessoPerfil.create({data:{orgId,userId:actorId,modo:'SELECTED'}});
    vazioId=(await db.user.create({data:{orgId,name:'QA vazio',email:randomUUID()+'@qa.invalid',passwordHash:'x',roles:{connect:{id:role.id}}}})).id;
    semPerfilId=(await db.user.create({data:{orgId,name:'QA sem perfil',email:randomUUID()+'@qa.invalid',passwordHash:'x',roles:{connect:{id:role.id}}}})).id;
    await db.clienteAcessoPerfil.create({data:{orgId,userId:vazioId,modo:'SELECTED'}});
    a=(await db.partner.create({data:{orgId,isCliente:true,razaoSocial:'Cliente A'}})).id;
    b=(await db.partner.create({data:{orgId,isCliente:true,razaoSocial:'Cliente B'}})).id;
    interno=(await db.partner.create({data:{orgId,isCliente:true,interno:true,razaoSocial:'Cliente interno'}})).id;
    await db.partner.create({data:{orgId:outra.id,isCliente:true,razaoSocial:'Vizinha'}});
    await db.clienteAcessoVinculo.create({data:{orgId,userId:actorId,clienteId:a}});
    const criarLead=async(nome:string,partnerId:string|null)=>{const l=await db.lead.create({data:{orgId,name:nome}});await db.comercialFicha.create({data:{orgId,leadId:l.id,partnerId,empresa:nome}});return l.id;};
    leadA=await criarLead('Lead A',a);leadB=await criarLead('SEGREDO B',b);leadNull=await criarLead('SEM CLIENTE',null);leadInterno=await criarLead('Lead interno',interno);
    const estrangeiro=await db.lead.create({data:{orgId:outra.id,name:'OUTRA ORGANIZACAO'}});
    await db.comercialFicha.create({data:{orgId:outra.id,leadId:estrangeiro.id,partnerId:null}});
    contratoA=(await db.comercialContrato.create({data:{orgId,leadId:leadA,partnerId:a,tipo:'contrato',valorCentavos:10000}})).id;
    contratoB=(await db.comercialContrato.create({data:{orgId,leadId:leadB,partnerId:b,tipo:'contrato',valorCentavos:999900}})).id;
    await db.comercialContrato.create({data:{orgId,leadId:leadA,partnerId:b,tipo:'contrato'}});
    await db.comercialContrato.create({data:{orgId,leadId:leadA,partnerId:a,tipo:'aditivo',paiId:contratoB}});
    const conta=await db.financeAccount.create({data:{orgId,name:'CONTA PRIVADA',openingBalance:987654}});
    const contratoFin=async(partnerId:string)=>db.contract.create({data:{orgId,tipo:'entrada',partnerId,descricao:'Contrato QA',valor:100,dataInicio:new Date('2026-01-01Z'),proximoVencimento:new Date('2026-02-01Z')}});
    const finA=await contratoFin(a),finB=await contratoFin(b);
    const lancamento=async(partnerId:string|null,contractId:string|null,description:string,amount:number)=>db.financeTransaction.create({data:{orgId,accountId:conta.id,partnerId,contractId,description,amount,type:'entrada',status:'previsto',date:new Date('2026-01-01Z')}});
    reciboA=(await lancamento(a,finA.id,'Recebível A',10.5)).id;
    reciboB=(await lancamento(b,finB.id,'SEGREDO B',9000)).id;
    await lancamento(null,null,'SEM CLIENTE',6000);
    await lancamento(a,finB.id,'CONTRATO DIVERGENTE',4000);
    acordoA=(await db.acordoComercial.create({data:{orgId,partnerId:a,cliente:'A',produto:'Serviço A',tipo:'pagante',valor:100}})).id;
    await db.acordoParcela.create({data:{orgId,acordoId:acordoA,numero:1,valor:100,vencimento:new Date('2026-02-01Z'),recebimentoId:reciboA}});
    await db.acordoComercial.create({data:{orgId,partnerId:b,cliente:'B',produto:'SEGREDO B',tipo:'pagante',valor:9000}});
    const p=db as unknown as PrismaService;
    const escopo=new ClienteEscopoService(p,new AuditService(p));
    const proxy=new Proxy(db,{get(t,k){if(k==='$transaction')return async(fn:any,opcoes:any)=>{const resultado=await (t.$transaction as any)(fn,opcoes);if(trocarAntesDaSegunda){const f=trocarAntesDaSegunda;trocarAntesDaSegunda=null;await f();}return resultado;};const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v;}}) as unknown as PrismaService;
    const comercial=new ComercialCarteiraService(proxy,escopo),finance=new FinanceCarteiraService(proxy,escopo);
    Reflect.defineMetadata('design:paramtypes',[ComercialCarteiraService],ComercialCarteiraController);
    Reflect.defineMetadata('design:paramtypes',[FinanceCarteiraService],FinanceCarteiraController);
    Reflect.defineMetadata('design:paramtypes',[FichaService],ComercialController);
    const fichasReais=new FichaService(p,{} as any,new ConfigComercialService(p));
    jwt=new JwtService({secret:randomUUID()+randomUUID(),signOptions:{expiresIn:'15m'}});
    const reflector=new Reflector();
    const module=await Test.createTestingModule({controllers:[ComercialCarteiraController,FinanceCarteiraController,ComercialController],providers:[{provide:FichaService,useValue:fichasReais},{provide:ComercialCarteiraService,useValue:comercial},{provide:FinanceCarteiraService,useValue:finance}]}).overrideGuard(JwtAuthGuard).useValue(new JwtAuthGuard(jwt,p,escopo)).overrideGuard(PermissionsGuard).useValue(new PermissionsGuard(reflector)).compile();
    app=module.createNestApplication({logger:['error']});await app.listen(0,'127.0.0.1');base=await app.getUrl();
    token=await jwt.signAsync({typ:'sessao',sub:actorId,orgId,permissions:['leads.ver','financeiro.ver'],email:'qa@invalid',name:'QA',roles:['qa_carteira']});
  },60000);
  afterAll(async()=>{
    if(app) await app.close();
    if(!db) return;
    try {
      const orgs=[orgId,outraOrgId].filter(Boolean);
      if(orgs.length) {
        const where={orgId:{in:orgs}};
        await db.acordoParcela.deleteMany({where});
        await db.acordoComercial.deleteMany({where});
        await db.financeTransaction.deleteMany({where});
        await db.contract.deleteMany({where});
        await db.financeAccount.deleteMany({where});
        await db.comercialContrato.deleteMany({where});
        await db.comercialFicha.deleteMany({where});
        await db.lead.deleteMany({where});
        await db.clienteAcessoVinculo.deleteMany({where});
        await db.clienteAcessoPerfil.deleteMany({where});
        await db.user.deleteMany({where});
        await db.role.deleteMany({where});
        await db.partner.deleteMany({where});
        await db.org.deleteMany({where:{id:{in:orgs}}});
      }
    } finally { await db.$disconnect(); }
  });
  async function get(path:string,bearer=token){const r=await fetch(base+path,{headers:{Authorization:'Bearer '+bearer}});return {status:r.status,body:await r.json() as any};}
  it('filtra leads, contagens, detalhe A/B/NULL e nunca cria ficha em GET',async()=>{
    const antes=await db.comercialFicha.count({where:{orgId}});
    const l=await get('/comercial/carteira/leads');expect(l.status).toBe(200);expect(l.body.total).toBe(1);expect(l.body.items[0].leadId).toBe(leadA);expect(JSON.stringify(l.body)).not.toContain('SEGREDO B');
    expect((await get('/comercial/carteira/leads/'+leadA+'?clienteId='+a)).status).toBe(200);
    expect((await get('/comercial/carteira/leads/'+leadB)).status).toBe(404);
    expect((await get('/comercial/carteira/leads/'+leadNull)).status).toBe(404);
    expect(await db.comercialFicha.count({where:{orgId}})).toBe(antes);
  });
  it('não inclui contratos com cliente/pai divergentes e recusa detalhe de B',async()=>{
    const l=await get('/comercial/carteira/contratos');expect(l.status).toBe(200);expect(l.body.items.map((x:any)=>x.id)).toEqual([contratoA]);
    expect((await get('/comercial/carteira/contratos/'+contratoA+'?clienteId='+a)).status).toBe(200);
    expect((await get('/comercial/carteira/contratos/'+contratoB)).status).toBe(404);
  });
  it('restringe recebíveis e totais a A sem saldo, conta ou nulos',async()=>{
    const l=await get('/finance/carteira/recebiveis');expect(l.status).toBe(200);expect(l.body.total).toBe(1);expect(l.body.items[0].id).toBe(reciboA);
    expect(l.body.estados.find((x:any)=>x.status==='previsto')).toEqual({status:'previsto',quantidade:1,valor:'10.50'});
    expect(JSON.stringify(l.body)).not.toMatch(/SEGREDO B|987654|CONTA PRIVADA|SEM CLIENTE|CONTRATO DIVERGENTE/);
    expect((await get('/finance/carteira/recebiveis/'+reciboA+'?clienteId='+a)).status).toBe(200);
    expect((await get('/finance/carteira/recebiveis/'+reciboB)).status).toBe(404);
    const listaAcordos=await get('/finance/carteira/acordos?clienteId='+a);expect(listaAcordos.status).toBe(200);expect(listaAcordos.body.total).toBe(1);
    const a1=await get('/finance/carteira/acordos/'+acordoA+'?clienteId='+a);expect(a1.status).toBe(200);expect(a1.body.parcelas).toHaveLength(1);
  });
  it('recusa reclassificação A para B após o snapshot e não retorna o detalhe anterior',async()=>{
    trocarAntesDaSegunda=async()=>{await db.comercialFicha.update({where:{leadId:leadA},data:{partnerId:b}});};
    try{const r=await get('/comercial/carteira/leads/'+leadA);expect([403,404,409]).toContain(r.status);expect(r.body).not.toHaveProperty('nome');}
    finally{await db.comercialFicha.update({where:{leadId:leadA},data:{partnerId:a}});}
  });
  it('A+B mantém ocultas as relações cruzadas e filtro A não agrega B',async()=>{
    await db.clienteAcessoVinculo.create({data:{orgId,userId:actorId,clienteId:b}});
    try {
      const leads=await get('/comercial/carteira/leads');expect(leads.status).toBe(200);expect(leads.body.total).toBe(2);
      const contratos=await get('/comercial/carteira/contratos');expect(contratos.status).toBe(200);expect(contratos.body.items.map((x:any)=>x.id).sort()).toEqual([contratoA,contratoB].sort());
      const fin=await get('/finance/carteira/recebiveis?clienteId='+a);expect(fin.status).toBe(200);expect(fin.body.total).toBe(1);expect(fin.body.estados[0].valor).toBe('10.50');
    } finally {await db.clienteAcessoVinculo.deleteMany({where:{orgId,userId:actorId,clienteId:b}});}
  });
  it('expõe cobertura incompleta sem dados de parcela com recebimento B',async()=>{
    const ruim=await db.acordoParcela.create({data:{orgId,acordoId:acordoA,numero:2,valor:100,vencimento:new Date('2026-03-01Z'),recebimentoId:reciboB}});
    try {const r=await get('/finance/carteira/acordos/'+acordoA);expect(r.status).toBe(200);expect(r.body.parcelasIncompletas).toBe(true);expect(r.body.parcelas).toHaveLength(1);expect(JSON.stringify(r.body)).not.toContain(reciboB);}
    finally {await db.acordoParcela.delete({where:{id:ruim.id}});}
  });
  it('recusa detalhe financeiro quando titular muda após leitura inicial',async()=>{
    let executou=false; trocarAntesDaSegunda=async()=>{executou=true;await db.financeTransaction.update({where:{id:reciboA},data:{partnerId:b}});};
    try{const r=await get('/finance/carteira/recebiveis/'+reciboA);expect(executou).toBe(true);expect([403,404,409]).toContain(r.status);expect(r.body).not.toHaveProperty('descricao');}
    finally{await db.financeTransaction.update({where:{id:reciboA},data:{partnerId:a}});}
  });
  it('usuário sem perfil é negado e SELECTED vazio não enxerga os registros',async()=>{
    const assinar=async(sub:string,org=orgId)=>jwt.signAsync({typ:'sessao',sub,orgId:org,permissions:['leads.ver','financeiro.ver'],email:'qa@invalid',name:'QA',roles:['qa_carteira']});
    const vazio=await assinar(vazioId), semPerfil=await assinar(semPerfilId), orgErrada=await assinar(actorId,outraOrgId);
    expect((await get('/comercial/carteira/leads',semPerfil)).status).toBe(403);
    expect([401,403]).toContain((await get('/finance/carteira/recebiveis',orgErrada)).status);
    expect((await get('/comercial/carteira/leads',vazio)).body.total).toBe(0);
    expect((await get('/finance/carteira/recebiveis/'+reciboA,vazio)).status).toBe(404);
  });
  it('interno exige vínculo explícito e concessão é lida no mesmo JWT',async()=>{
    expect((await get('/comercial/carteira/leads/'+leadInterno)).status).toBe(404);
    await db.clienteAcessoVinculo.create({data:{orgId,userId:actorId,clienteId:interno}});
    try{const r=await get('/comercial/carteira/leads/'+leadInterno+'?clienteId='+interno);expect(r.status).toBe(200);expect(r.body.clienteId).toBe(interno);}
    finally{await db.clienteAcessoVinculo.deleteMany({where:{orgId,userId:actorId,clienteId:interno}});}
  });
  it('rota comercial legada fica fechada a SELECTED e ALL conserva ficha sem cliente',async()=>{
    expect((await get('/comercial/lead/'+leadNull)).status).toBe(403);
    await db.clienteAcessoPerfil.update({where:{userId_orgId:{userId:actorId,orgId}},data:{modo:'ALL'}});
    try{const r=await get('/comercial/lead/'+leadNull);expect(r.status).toBe(200);expect(r.body.nome).toBe('SEM CLIENTE');}
    finally{await db.clienteAcessoPerfil.update({where:{userId_orgId:{userId:actorId,orgId}},data:{modo:'SELECTED'}});}
  });
  it('POST de emissão permanece bloqueado para SELECTED mesmo com vínculo e leads.editar',async()=>{
    const permission=await db.permission.upsert({where:{key:'leads.editar'},update:{},create:{key:'leads.editar'}});
    await db.role.update({where:{id:roleId},data:{permissions:{connect:{id:permission.id}}}});
    const p=db as unknown as PrismaService,escopo=new ClienteEscopoService(p,new AuditService(p)),reflector=new Reflector();
    const proporEnvio=vi.fn(async()=>({approvalId:'não-deve-existir'}));
    const module=await Test.createTestingModule({controllers:[ContratosController],providers:[{provide:ContratosService,useValue:{}},{provide:EmissaoDoContratoService,useValue:{proporEnvio}}]})
      .overrideGuard(JwtAuthGuard).useValue(new JwtAuthGuard(jwt,p,escopo)).overrideGuard(PermissionsGuard).useValue(new PermissionsGuard(reflector)).compile();
    const teste=module.createNestApplication({logger:['error']});
    teste.useGlobalInterceptors(new ClienteEscopoInterceptor(reflector,escopo));
    await teste.listen(0,'127.0.0.1');
    try {
      const bearer=await jwt.signAsync({typ:'sessao',sub:actorId,orgId,permissions:['leads.editar'],email:'qa@invalid',name:'QA',roles:['qa_carteira']});
      const r=await fetch(`${await teste.getUrl()}/comercial/contratos/registro/${contratoA}/enviar`,{method:'POST',headers:{Authorization:'Bearer '+bearer}});
      expect(r.status).toBe(403);expect(proporEnvio).not.toHaveBeenCalled();
    } finally {await teste.close();await db.role.update({where:{id:roleId},data:{permissions:{disconnect:{id:permission.id}}}});}
  });
  it('revogação de papel vale com o mesmo JWT para o financeiro',async()=>{
    const perm=await db.permission.findUniqueOrThrow({where:{key:'financeiro.ver'}});
    await db.role.update({where:{id:roleId},data:{permissions:{disconnect:{id:perm.id}}}});
    try{const r=await get('/finance/carteira/recebiveis');expect(r.status).toBe(403);expect(r.body).not.toHaveProperty('items');}
    finally{await db.role.update({where:{id:roleId},data:{permissions:{connect:{id:perm.id}}}});}
  });
  it('revoga acesso na próxima requisição com o mesmo JWT',async()=>{
    await db.clienteAcessoVinculo.deleteMany({where:{orgId,userId:actorId,clienteId:a}});
    try{const c=await get('/comercial/carteira/leads');expect(c.status).toBe(200);expect(c.body.total).toBe(0);const f=await get('/finance/carteira/recebiveis');expect(f.status).toBe(200);expect(f.body.total).toBe(0);}
    finally{await db.clienteAcessoVinculo.create({data:{orgId,userId:actorId,clienteId:a}});}
  });
});
