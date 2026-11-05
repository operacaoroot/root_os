import { randomUUID } from 'node:crypto';
import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { PrismaService } from '../src/prisma/prisma.service';
import { comTenantNaSessao } from '../src/prisma/sessao-de-banco';
import { comContextoDePlataforma, comContextoDaEmpresaResolvida } from '../src/prisma/contexto-de-plataforma';
import { contextoAtual } from '../src/common/contexto-execucao';
import { FinanceService } from '../src/finance/finance.service';
import { RotinasScheduler } from '../src/routines/rotinas.scheduler';
import { TetoDeCustoIaService } from '../src/llm/teto-diario.service';
import { exigirParDeBancosDescartaveis } from './papel-restrito-banco';

const adminUrl=process.env.TEST_DATABASE_URL, appUrl=process.env.TENANT_DATABASE_URL;
it('a prova aceita somente o par de bancos descartáveis e papéis distintos',()=>{
  expect(()=>exigirParDeBancosDescartaveis('postgresql://mkt@localhost:5432/marketing_os_test','postgresql://mktos_app@127.0.0.1:5432/marketing_os_test')).not.toThrow();
  expect(()=>exigirParDeBancosDescartaveis('postgresql://mkt@localhost:5432/marketing_os_test','postgresql://mktos_app@127.0.0.1:5432/outro_test')).toThrow();
});

if(adminUrl && appUrl) describe('automações sob papel restrito e RLS real',()=>{
  let admin:PrismaClient, app:PrismaService, base:PrismaClient, scoped:PrismaService;
  const ids:string[]=[];
  beforeAll(async()=>{
    exigirParDeBancosDescartaveis(adminUrl!,appUrl!);
    admin=new PrismaClient({datasources:{db:{url:adminUrl}}});base=new PrismaClient({datasources:{db:{url:appUrl}}});
    app=comTenantNaSessao(base,{modo:'impor',avisar:()=>{}}) as PrismaService;
    for(let i=0;i<2;i++) {const o=await admin.org.create({data:{name:'QA RLS cron',slug:'qa-cron-'+randomUUID()}});ids.push(o.id);}
    await admin.rotina.create({data:{orgId:ids[0],slug:'qa',nome:'QA',tipo:'qa',cron:'* * * * *'}});
    await admin.pautaRotina.create({data:{orgId:ids[1],slug:'qa',nome:'QA',cron:'* * * * *'}});
    for(const id of ids) await admin.gastoDeIaNoDia.create({data:{orgId:id,dia:'2026-11-04',reservadoUsd:1}});
    scoped=new Proxy(app,{get(target,key,receiver){
      if(key==='org') return {findMany:()=>target.org.findMany({where:{id:{in:ids}},select:{id:true}})};
      return Reflect.get(target,key,receiver);
    }}) as PrismaService;
  });
  afterAll(async()=>{
    if(admin) {
      await admin.integrationHealth.deleteMany({where:{orgId:{in:ids}}});
      await admin.integrationAccount.deleteMany({where:{orgId:{in:ids}}});
      await admin.gastoDeIaNoDia.deleteMany({where:{orgId:{in:ids}}});
      await admin.rotina.deleteMany({where:{orgId:{in:ids}}});
      await admin.pautaRotina.deleteMany({where:{orgId:{in:ids}}});
      await admin.org.deleteMany({where:{id:{in:ids}}});
      await admin.$disconnect();
    }
    await base?.$disconnect();
  });
  it('sentinela lê ids e não abre tabelas de negócio',async()=>{
    const visiveis=await comContextoDePlataforma(()=>scoped.org.findMany({select:{id:true}}));
    expect(visiveis.map(x=>x.id).sort()).toEqual([...ids].sort());
    expect(await comContextoDePlataforma(()=>app.rotina.findMany({where:{orgId:{in:ids}}}))).toEqual([]);
    await expect(comContextoDaEmpresaResolvida(ids[0],()=>comContextoDaEmpresaResolvida(ids[1],async()=>1))).rejects.toThrow();
  });
  it('descobre rotina e pauta em duas empresas sem BYPASSRLS',async()=>{
    const svc=new RotinasScheduler(scoped,{} as never);
    expect(await (svc as any).empresasComRotina()).toEqual([...ids].sort());
  });
  it('saúde bancária é gravada no tenant da conexão',async()=>{
    const svc=new FinanceService(scoped,{} as never,{} as never,{} as never);
    await (svc as any).markHealth(ids[1],'asaas','Asaas','ok',null);
    const contas=await admin.integrationAccount.findMany({where:{orgId:{in:ids},key:'asaas'}});
    expect(contas).toHaveLength(1);expect(contas[0].orgId).toBe(ids[1]);
    expect((await admin.integrationHealth.findUniqueOrThrow({where:{accountId:contas[0].id}})).orgId).toBe(ids[1]);
  });
  it('limpa reservas das duas empresas no contexto correto',async()=>{
    const registrar=vi.fn(async({orgId}:{orgId:string})=>{expect(contextoAtual()?.orgId).toBe(orgId);});
    const svc=new TetoDeCustoIaService(scoped,{registrar} as never);
    expect(await svc.liberarReservasPresas('arranque')).toBe(2);
    expect(registrar).toHaveBeenCalledTimes(2);
    expect((await admin.gastoDeIaNoDia.findMany({where:{orgId:{in:ids}}})).every(x=>Number(x.reservadoUsd)===0)).toBe(true);
  });
});
