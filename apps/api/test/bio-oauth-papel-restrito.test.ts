import 'reflect-metadata';
import { exigirParDeBancosDescartaveis } from './papel-restrito-banco';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BioOauthController } from '../src/bio/bio-oauth.controller';
import { comTenantNaSessao } from '../src/prisma/sessao-de-banco';
import { comContexto } from '../src/common/contexto-execucao';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { BioCredenciaisService } from '../src/bio/bio-credenciais.service';
import type { AuditService } from '../src/audit/audit.service';
import type { Response } from 'express';

const ownerUrl=process.env.TEST_DATABASE_URL, appUrl=process.env.TENANT_DATABASE_URL;
const na=<T>(orgId:string,fn:()=>Promise<T>)=>comContexto({orgId,actorType:'user',correlationId:'bio-rls-qa',origem:'http'},async()=>await fn());
if (ownerUrl && appUrl) describe('Bio OAuth sob papel restrito',()=>{
  let owner:PrismaClient,base:PrismaClient,raw:PrismaClient,app:PrismaService;
  const orgs=[randomUUID(),randomUUID()];
  const resolver=vi.fn(async()=>null);
  let controller:BioOauthController;
  async function estado(orgId=orgs[0]!,vencido=false){
    const valor=randomBytes(24).toString('hex');
    await owner.bioOauthState.create({data:{estado:valor,orgId,plataforma:'instagram',finalidade:'publicacao',expiraEm:new Date(Date.now()+(vencido?-60000:60000))}});
    return valor;
  }
  async function callback(state:string,error=''){
    const res={redirect:vi.fn((url:string)=>url)};
    await controller.callback('instagram','codigo-sintetico',state,error,res as unknown as Response);
    return res.redirect.mock.calls[0]?.[0];
  }
  beforeAll(async()=>{
    exigirParDeBancosDescartaveis(ownerUrl!,appUrl!);
    owner=new PrismaClient({datasourceUrl:ownerUrl});base=new PrismaClient({datasourceUrl:appUrl});
    app=comTenantNaSessao(base,{modo:'impor'}) as PrismaService;raw=new PrismaClient({datasourceUrl:appUrl});
    for(const id of orgs)await owner.org.create({data:{id,name:'Bio RLS QA',slug:`bio-rls-${id}`}});
    controller=new BioOauthController(app,{resolver} as unknown as BioCredenciaisService,{} as AuditService);
  });
  afterAll(async()=>{if(owner){await owner.bioOauthState.deleteMany({where:{orgId:{in:orgs}}});await owner.org.deleteMany({where:{id:{in:orgs}}});await owner.$disconnect();}await base?.$disconnect();await raw?.$disconnect();});
  it('callback público resolve somente a org do state e consome antes de ler credenciais',async()=>{
    const a=await estado(),b=await estado(orgs[1]);
    resolver.mockImplementationOnce(async()=>{expect(await owner.bioOauthState.findUnique({where:{estado:a}})).toBeNull();return null;});
    expect(await callback(a)).toContain('conexao=sem_credencial');
    expect(await owner.bioOauthState.findUnique({where:{estado:b}})).not.toBeNull();
  });
  it('dois callbacks concorrentes consomem uma única vez',async()=>{
    resolver.mockClear();const state=await estado();
    const resultados=await Promise.all([callback(state),callback(state)]);
    expect(resultados.some(x=>x?.includes('sem_credencial'))).toBe(true);
    expect(resultados.some(x=>x?.includes('expirado'))).toBe(true);
    expect(resolver).toHaveBeenCalledTimes(1);
  });
  it.each([false,true])('cancelamento/vencimento consome sem provedor: vencido=%s',async(vencido)=>{
    resolver.mockClear();const state=await estado(orgs[0],vencido);
    expect(await callback(state,vencido?'':'access_denied')).toContain(vencido?'expirado':'cancelado');
    expect(await owner.bioOauthState.findUnique({where:{estado:state}})).toBeNull();expect(resolver).not.toHaveBeenCalled();
  });
  it('tenant já resolvido A não pode resolver nem consumir state de B',async()=>{
    const state=await estado(orgs[1]);
    expect(await na(orgs[0]!,()=>callback(state))).toContain('expirado');
    expect(await owner.bioOauthState.findUnique({where:{estado:state}})).not.toBeNull();
  });
  it('resolver SQL não retorna segredo e recusa tenant divergente e sessão vazia',async()=>{
    const state=await estado(orgs[1]);
    const consulta=()=>app.$queryRaw<Array<{id:string;orgId:string}>>`SELECT * FROM public.app_resolver_bio_oauth(${state})`;
    expect(await na(orgs[0]!,consulta)).toEqual([]);
    const achado=await na('__resolucao_publica__',consulta);
    expect(achado).toHaveLength(1);expect(Object.keys(achado[0]!).sort()).toEqual(['id','orgId']);
    expect(await raw.$queryRaw`SELECT * FROM public.app_resolver_bio_oauth(${state})`).toEqual([]);
    expect(await na('__resolucao_publica__',()=>app.bioOauthState.findMany())).toEqual([]);
  });
});

// Também roda sem integração: prova que uma configuração perigosa é recusada.
it('recusa runtime e semeadura em bancos distintos',()=>{
  expect(()=>exigirParDeBancosDescartaveis('postgresql://mkt:qa@127.0.0.1:5432/marketing_os_test',
    'postgresql://mktos_app:qa@127.0.0.1:5432/rls_homolog_test')).toThrow(/mesmo banco/);
});
