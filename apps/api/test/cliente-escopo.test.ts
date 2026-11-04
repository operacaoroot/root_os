import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { ClienteEscopoService } from '../src/clientes-escopo/cliente-escopo.service';
import { ClienteEscopoInterceptor } from '../src/clientes-escopo/cliente-escopo.interceptor';
import { EscopoClienteAdaptado, ESCOPO_CLIENTE_ADAPTADO } from '../src/clientes-escopo/cliente-escopo.decorator';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
const org = 'o1', user = 'u1';
function montar(modo: string | null = 'SELECTED') {
  const state = { modo, ativo: true, ids: ['a'], admin: false };
  const db: any = {
    user: { findFirst: vi.fn(async ({where}: any) => where.id === user && where.orgId === org && state.ativo ? {id:user, roles: state.admin ? [{key:'admin_master',orgId:org}] : []} : null) },
    clienteAcessoPerfil: { findFirst: vi.fn(async ({where}:any) => where.orgId === org && where.userId === user && state.modo ? {modo:state.modo} : null) },
    clienteAcessoVinculo: { findMany: vi.fn(async () => state.ids.map(clienteId=>({clienteId}))) },
    partner: { findFirst: vi.fn(async ({where}:any) => ['a','b','interno'].includes(where.id) && where.orgId === org ? {id:where.id,orgId:org,ativo:true,principalId:null,isCliente:true,interno:where.id==='interno',razaoSocial:where.id} : null),
      findMany: vi.fn(async ({where}:any) => ['a','b','interno'].filter(id=>!where.id?.in || where.id.in.includes(id)).map(id=>({id,razaoSocial:id,interno:id==='interno'}))) },
  };
  return {state,db,svc:new ClienteEscopoService(db, {log:vi.fn()} as any)};
}
describe('escopo por cliente: contrato de autorização',()=>{
  it('não usa o papel de plataforma como carteira implícita',async()=>{
    const {svc,state}=montar(null);state.admin=true;
    await expect(svc.filtro(org,user)).rejects.toThrow();
  });
  it('limita a lista aos vínculos e relê revogação na mesma sessão',async()=>{
    const {svc,state}=montar();
    expect(await svc.filtro(org,user)).toEqual({orgId:org,clienteId:{in:['a']}});
    await expect(svc.exigirCliente(org,user,'b')).rejects.toThrow();
    state.ids=[];
    expect(await svc.filtro(org,user)).toEqual({orgId:org,clienteId:{in:[]}});
    await expect(svc.exigirCliente(org,user,'a')).rejects.toThrow();
  });
  it('recusa outro org, usuário desativado e cliente desconhecido',async()=>{
    const {svc,state}=montar('ALL');
    await expect(svc.filtro('o2',user)).rejects.toThrow();
    await expect(svc.exigirCliente(org,user,'externo')).rejects.toThrow();
    state.ativo=false; await expect(svc.filtro(org,user)).rejects.toThrow();
  });
  it('separa legado, interno e visão ampla explicitamente',async()=>{
    const {svc,state}=montar();
    await expect(svc.filtro(org,user,'sem')).rejects.toThrow();
    await expect(svc.exigirCliente(org,user,null)).rejects.toThrow();
    await expect(svc.exigirCliente(org,user,'interno')).rejects.toThrow();
    state.modo='ALL';
    expect(await svc.filtro(org,user,'sem')).toEqual({orgId:org,clienteId:null});
    expect(await svc.filtro(org,user)).toEqual({orgId:org});
    expect((await svc.exigirCliente(org,user,'interno'))?.id).toBe('interno');
  });
  it('lista somente clientes permitidos para seleção',async()=>{
    const {svc}=montar();
    expect(await svc.listar(org,user)).toEqual({amplo:false,clientes:[{id:'a',nome:'a',interno:false}]});
  });
});
describe('contenção de módulos ainda não adaptados',()=>{
  function contexto(handler:Function, usuario:any={orgId:org,sub:user}) {return {getType:()=> 'http',getHandler:()=>handler,switchToHttp:()=>({getRequest:()=>({user:usuario})})} as any;}
  it('bloqueia auditoria/agentes/rotas futuras antes do handler para SELECTED',async()=>{
    const {svc}=montar(); const interceptor=new ClienteEscopoInterceptor(new Reflector(),svc);
    const next={handle:vi.fn(()=>of('segredo'))};
    await expect(firstValueFrom(interceptor.intercept(contexto(function audit(){}),next))).rejects.toThrow();
    expect(next.handle).not.toHaveBeenCalled();
  });
  it('permite apenas método adaptado e recusa marcação apenas na classe',async()=>{
    const {svc}=montar();const interceptor=new ClienteEscopoInterceptor(new Reflector(),svc);
    function adapted(){} Reflect.defineMetadata(ESCOPO_CLIENTE_ADAPTADO,true,adapted);
    expect(await firstValueFrom(interceptor.intercept(contexto(adapted),{handle:()=>of('ok')}))).toBe('ok');
  });
  it('mantém rotas públicas sem transformá-las em acesso autenticado',async()=>{
    const {svc}=montar();const interceptor=new ClienteEscopoInterceptor(new Reflector(),svc);
    expect(await firstValueFrom(interceptor.intercept(contexto(function receber(){},null),{handle:()=>of('recibo')}))).toBe('recibo');
  });
});
