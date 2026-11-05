import 'reflect-metadata';
import { exigirParDeBancosDescartaveis } from './papel-restrito-banco';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionarTenant } from '../src/tenants/provisionar';
import { ProvisionamentoService } from '../src/tenants/provisionar.service';
import { ModulosService } from '../src/tenants/modulos.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { AuditService } from '../src/audit/audit.service';
import { comContexto, contextoAtual } from '../src/common/contexto-execucao';
import { comTenantNaSessao } from '../src/prisma/sessao-de-banco';
import type { PrismaService } from '../src/prisma/prisma.service';

const ownerUrl=process.env.TEST_DATABASE_URL,appUrl=process.env.TENANT_DATABASE_URL;
if (ownerUrl && appUrl) describe('provisionamento com conexão restrita',{timeout:30000},()=>{
  let owner:PrismaClient,base:PrismaClient,app:PrismaService,svc:ProvisionamentoService,rootId:string;
  const marca=randomUUID().slice(0,8),userId=randomUUID(),foreignId=randomUUID();
  const criadoSlug=`prov-rls-${marca}`;
  const na=<T>(orgId:string,fn:()=>Promise<T>)=>comContexto({orgId,actorId:userId,actorType:'user',origem:'http',correlationId:`qa-${marca}`},async()=>await fn());
  beforeAll(async()=>{
    exigirParDeBancosDescartaveis(ownerUrl!,appUrl!);
    owner=new PrismaClient({datasourceUrl:ownerUrl});base=new PrismaClient({datasourceUrl:appUrl});app=comTenantNaSessao(base,{modo:'impor'}) as PrismaService;
    const root=await owner.org.upsert({where:{slug:'root'},create:{slug:'root',name:'ROOT sintética QA'},update:{}});rootId=root.id;
    const perm=await owner.permission.upsert({where:{key:'admin.permissoes'},create:{key:'admin.permissoes'},update:{}});
    const role=await owner.role.create({data:{orgId:rootId,key:`qa_${marca}`,name:'Plataforma QA',permissions:{connect:{id:perm.id}}}});
    await owner.user.create({data:{id:userId,orgId:rootId,email:`plataforma-${marca}@example.invalid`,name:'QA',passwordHash:'inutilizavel',roles:{connect:{id:role.id}}}});
    await owner.org.create({data:{id:foreignId,slug:`fora-${marca}`,name:'Cliente QA'}});
    svc=new ProvisionamentoService(app,new EventLogService(app),new AuditService(app),new ModulosService(app));
  },60000);
  // O banco inteiro é descartável; o rastro append-only e a root compartilhada ficam para sua remoção final.
  afterAll(async()=>{await base?.$disconnect();await owner?.$disconnect();},60000);
  it('cria sob mktos_app e repetir slug não reconfigura nem concede outro administrador',async()=>{
    const e={slug:criadoSlug,modulos:['pauta' as const],admin:{email:`admin-${marca}@example.invalid`}};
    const a=await na(rootId,()=>svc.provisionar(e,{tipo:'user',id:userId,origem:'http'}));
    expect(a.criada).toBe(true);
    const b=await na(rootId,()=>svc.provisionar({...e,nome:'Não aplicar',modulos:[],admin:{email:`intruso-${marca}@example.invalid`}},{tipo:'user',id:userId,origem:'http'}));
    expect(b).toMatchObject({criada:false,orgId:a.orgId,modulos:['pauta']});
    expect(await owner.user.findUnique({where:{email:`intruso-${marca}@example.invalid`}})).toBeNull();
    expect(await owner.org.count({where:{slug:criadoSlug}})).toBe(1);
    expect(await na(rootId,async()=>{await svc.provisionar(e,{tipo:'user',id:userId,origem:'http'});return contextoAtual()?.orgId;})).toBe(rootId);
  });
  it('origem de cliente não pode abrir plataforma nem se declarar system',async()=>{
    for(const tipo of ['user','system'] as const){
      await expect(na(foreignId,()=>svc.provisionar({slug:`negado-${tipo}-${marca}`},{tipo,id:userId,origem:'http'}))).rejects.toThrow();
      expect(await owner.org.findUnique({where:{slug:`negado-${tipo}-${marca}`}})).toBeNull();
    }
  });
  it('reconfigurar por HTTP é recusado antes de modificar módulos',async()=>{
    await expect(na(rootId,()=>svc.provisionar({slug:criadoSlug,modo:'reconfigurar',modulos:[]},{tipo:'user',id:userId,origem:'http'}))).rejects.toThrow();
    expect((await owner.org.findUniqueOrThrow({where:{slug:criadoSlug}})).modulos).toEqual(['pauta']);
  });
  it('chamador não pode trocar origem HTTP por script para reconfigurar',async()=>{
    await expect(na(rootId,()=>svc.provisionar({slug:criadoSlug,modo:'reconfigurar',modulos:[]},
      {tipo:'user',id:userId,origem:'script'}))).rejects.toThrow();
    expect((await owner.org.findUniqueOrThrow({where:{slug:criadoSlug}})).modulos).toEqual(['pauta']);
  });
  it.each([null,'outro-id'])('identidade HTTP %s não aceita id de pessoa fornecido pelo chamador',async(actorId)=>{
    const slug=`ator-${actorId===null?'ausente':'divergente'}-${marca}`;
    await expect(comContexto({orgId:rootId,actorType:'user',actorId,origem:'http',correlationId:'qa-identidade'},
      ()=>svc.provisionar({slug},{tipo:'user',id:userId,origem:'http'}))).rejects.toThrow();
    expect(await owner.org.findUnique({where:{slug}})).toBeNull();
  });
  it('contexto de máquina não pode se declarar pessoa da plataforma',async()=>{
    const slug=`maquina-${marca}`;
    await expect(comContexto({orgId:rootId,actorType:'ai',actorId:userId,origem:'http',correlationId:'qa-maquina'},
      ()=>svc.provisionar({slug},{tipo:'user',id:userId,origem:'http'}))).rejects.toThrow();
    expect(await owner.org.findUnique({where:{slug}})).toBeNull();
  });
  it('bootstrap público e CLI continuam sem credencial dona',async()=>{
    const slug=`publico-${marca}`;
    const a=await svc.provisionar({slug,modulos:['pauta']},{tipo:'system',origem:'http'});
    expect(a.criada).toBe(true);
    const b=await svc.provisionar({slug,modo:'reconfigurar',modulos:['pauta','bio']},{tipo:'system',id:'terminal-qa',origem:'script'});
    expect(b).toMatchObject({orgId:a.orgId,criada:false,modulos:['pauta','bio']});
  });
  it('duas criações concorrentes do mesmo slug devolvem a mesma organização sob RLS',async()=>{
    const slug=`corrida-${marca}`;
    let liberar!:()=>void,leituras=0;
    const barreira=new Promise<void>(resolve=>{liberar=resolve;});
    const resolverOrg=async(slug:string)=>{
      const org=await na('__plataforma__',async()=>await app.org.findUnique({where:{slug},select:{id:true,name:true,modulos:true,isActive:true}}));
      if(++leituras<=2){if(leituras===2)liberar();await barreira;}
      return org;
    };
    const opcoes={resolverOrg,emContexto:na};
    const resultado=await Promise.all([
      provisionarTenant(app,{slug,modulos:['pauta']},opcoes),
      provisionarTenant(app,{slug,modulos:['bio']},opcoes),
    ]);
    expect(resultado[0]!.orgId).toBe(resultado[1]!.orgId);
    expect(resultado.filter(r=>r.criada)).toHaveLength(1);
    expect(resultado[0]!.modulos).toEqual(resultado[1]!.modulos);
    expect(await owner.org.count({where:{slug}})).toBe(1);
  });
  it('pessoa revogada não abre a consulta de plataforma',async()=>{
    await owner.user.update({where:{id:userId},data:{isActive:false}});
    try {await expect(na(rootId,()=>svc.provisionar({slug:`revogado-${marca}`},{tipo:'user',id:userId,origem:'http'}))).rejects.toThrow();}
    finally {await owner.user.update({where:{id:userId},data:{isActive:true}});}
    expect(await owner.org.findUnique({where:{slug:`revogado-${marca}`}})).toBeNull();
  });
  it('email pertencente a outra empresa reverte a criação inteira',async()=>{
    const email=`ocupado-${marca}@example.invalid`,slug=`rollback-${marca}`;
    await owner.user.create({data:{orgId:foreignId,email,name:'Pessoa QA',passwordHash:'inutilizavel'}});
    await expect(na(rootId,()=>svc.provisionar({slug,admin:{email}},{tipo:'user',id:userId,origem:'http'}))).rejects.toThrow();
    expect(await owner.org.findUnique({where:{slug}})).toBeNull();
    expect((await owner.user.findUniqueOrThrow({where:{email}})).orgId).toBe(foreignId);
  });

});

// Também roda sem integração: prova que uma configuração perigosa é recusada.
it('recusa runtime e semeadura em bancos distintos',()=>{
  expect(()=>exigirParDeBancosDescartaveis('postgresql://mkt:qa@127.0.0.1:5432/marketing_os_test',
    'postgresql://mktos_app:qa@127.0.0.1:5432/rls_homolog_test')).toThrow(/mesmo banco/);
});
