import { afterEach, describe, expect, it, vi } from 'vitest';
import { comContexto, contextoAtual } from '../src/common/contexto-execucao';
import { ORG_PLATAFORMA } from '../src/prisma/contexto-de-plataforma';
import { FinanceService } from '../src/finance/finance.service';
import { BioBridgeService } from '../src/bio/bio-bridge.service';
import { RotinasScheduler } from '../src/routines/rotinas.scheduler';
import { TetoDeCustoIaService } from '../src/llm/teto-diario.service';

vi.mock('../src/routines/rotinas-da-casa',()=>({
  TIPO_CASA_CONCILIACAO:'casa.conciliacao',TIPO_CASA_METAS:'casa.metas',
  inscreverTarefaDaCasa:vi.fn(),registrarPassagemDeFundo:vi.fn(async(_p:unknown,_r:unknown,fn:()=>Promise<unknown>)=>fn()),
}));
const orgs=()=>[{id:'empresa-a'},{id:'empresa-b'}];
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});

describe('descoberta sem leitura de negócio pela plataforma',()=>{
  it('financeiro descobre somente Org na sentinela e lê cada conexão no seu tenant',async()=>{
    vi.useFakeTimers();
    const findOrg=vi.fn(async()=>{expect(contextoAtual()?.orgId).toBe(ORG_PLATAFORMA);return orgs();});
    const conns=vi.fn(async()=>{const org=contextoAtual()?.orgId;expect(['empresa-a','empresa-b']).toContain(org);return [{id:'conexao-'+org,provider:'pluggy',orgId:org}];});
    const prisma={org:{findMany:findOrg},bankConnection:{findMany:conns}};
    const svc=new FinanceService(prisma as never,{} as never,{configured:true} as never,{configured:false} as never);
    const sync=vi.spyOn(svc,'syncBankConnection').mockImplementation(async(org)=>{expect(contextoAtual()?.orgId).toBe(org);return {accounts:0,transactions:0};});
    svc.onModuleInit();await vi.advanceTimersByTimeAsync(30_000);
    expect(findOrg).toHaveBeenCalled();expect(sync.mock.calls.map(c=>c[0]).sort()).toEqual(['empresa-a','empresa-b']);
  });
  it('saúde financeira grava na empresa da conexão, não na root',async()=>{
    const account=vi.fn(async({where}:any)=>{expect(contextoAtual()?.orgId).toBe('empresa-b');expect(where.orgId).toBe('empresa-b');return {id:'conta',connectedAt:null};});
    const prisma={org:{findFirst:vi.fn(async()=>({id:'root'}))},integrationAccount:{findFirst:account,update:vi.fn(async()=>({id:'conta'}))},integrationHealth:{upsert:vi.fn(async()=>({}))}};
    const svc=new FinanceService(prisma as never,{} as never,{} as never,{} as never);
    await (svc as any).markHealth('empresa-b','asaas','Asaas','ok',null);
    expect(account).toHaveBeenCalled();expect(prisma.org.findFirst).not.toHaveBeenCalled();
  });
  it('ponte Bio enumera Org sob sentinela e processa cada empresa isolada',async()=>{
    vi.useFakeTimers();
    const findOrg=vi.fn(async()=>{expect(contextoAtual()?.orgId).toBe(ORG_PLATAFORMA);return orgs();});
    const svc=new BioBridgeService({org:{findMany:findOrg}} as never);
    const backfill=vi.spyOn(svc,'backfill').mockImplementation(async(org)=>{expect(contextoAtual()?.orgId).toBe(org);return {semanas:0,cliques:0};});
    svc.onModuleInit();await vi.advanceTimersByTimeAsync(40_000);
    expect(findOrg).toHaveBeenCalled();expect(backfill.mock.calls.map(c=>c[0]).sort()).toEqual(['empresa-a','empresa-b']);
  });
  it('descoberta de rotinas percorre as tabelas sob cada empresa',async()=>{
    const org=vi.fn(async()=>{expect(contextoAtual()?.orgId).toBe(ORG_PLATAFORMA);return orgs();});
    const descobrir=vi.fn(async()=>{const id=contextoAtual()?.orgId;expect(['empresa-a','empresa-b']).toContain(id);return id==='empresa-a'?[{orgId:id}]:[];});
    const svc=new RotinasScheduler({org:{findMany:org},rotina:{findMany:descobrir},pautaRotina:{findMany:descobrir}} as never,{} as never);
    expect(await (svc as any).empresasComRotina()).toEqual(['empresa-a']);
    expect(descobrir).toHaveBeenCalledTimes(4);
  });
  it('coletor de reservas descobre linhas apenas dentro da empresa',async()=>{
    const org=vi.fn(async()=>{expect(contextoAtual()?.orgId).toBe(ORG_PLATAFORMA);return orgs();});
    const query=vi.fn(async()=>{const id=contextoAtual()?.orgId;expect(['empresa-a','empresa-b']).toContain(id);return [{orgId:id,dia:'2026-11-04'}];});
    const svc=new TetoDeCustoIaService({org:{findMany:org},$queryRaw:query} as never,{} as never);
    const liberar=vi.spyOn(svc as any,'liberarPresasDaLinha').mockImplementation(async(...args:unknown[])=>{expect(contextoAtual()?.orgId).toBe(args[0]);return 1;});
    expect(await svc.liberarReservasPresas('varredura')).toBe(2);
    expect(liberar).toHaveBeenCalledTimes(2);
  });
  it('falha na descoberta de uma empresa não esconde a outra e sinaliza resultado parcial',async()=>{
    const org=vi.fn(async()=>orgs());
    const descobrir=vi.fn(async()=>{if(contextoAtual()?.orgId==='empresa-a')throw new Error('falha A');return [{orgId:'empresa-b'}];});
    const svc=new RotinasScheduler({org:{findMany:org},rotina:{findMany:descobrir},pautaRotina:{findMany:descobrir}} as never,{} as never);
    const varrer=vi.spyOn(svc as any,'varrerEmpresa').mockResolvedValue(undefined);
    await svc.tick(new Date('2026-11-04T12:00:00Z'));
    expect(varrer).toHaveBeenCalledOnce();expect(varrer.mock.calls[0][0]).toBe('empresa-b');
    expect((await svc.diagnostico()).descobertaCega).toBe(true);
  });
  it('falha ao ler reservas de uma empresa não impede liberar a outra',async()=>{
    const query=vi.fn(async()=>{if(contextoAtual()?.orgId==='empresa-a')throw new Error('falha A');return [{orgId:'empresa-b',dia:'2026-11-04'}];});
    const svc=new TetoDeCustoIaService({org:{findMany:vi.fn(async()=>orgs())},$queryRaw:query} as never,{} as never);
    const liberar=vi.spyOn(svc as any,'liberarPresasDaLinha').mockResolvedValue(1);
    expect(await svc.liberarReservasPresas('arranque')).toBe(1);
    expect(liberar).toHaveBeenCalledOnce();expect(liberar.mock.calls[0][0]).toBe('empresa-b');
  });
  it('cron financeiro não combina ator system com usuário herdado',async()=>{
    vi.useFakeTimers();
    const prisma={org:{findMany:vi.fn(async()=>[{id:'empresa-a'}])},bankConnection:{findMany:vi.fn(async()=>[{id:'x',provider:'pluggy'}])}};
    const svc=new FinanceService(prisma as never,{} as never,{configured:true} as never,{configured:false} as never);
    const vistos:unknown[]=[];
    const sync=vi.spyOn(svc,'syncBankConnection').mockImplementation(async()=>{vistos.push({...contextoAtual()});return {accounts:0,transactions:0};});
    await comContexto({orgId:'empresa-a',actorType:'user',actorId:'humano',origem:'http',correlationId:'pedido'},async()=>{svc.onModuleInit();await vi.advanceTimersByTimeAsync(30_000);});
    expect(sync).toHaveBeenCalledOnce();expect(vistos[0]).toMatchObject({orgId:'empresa-a',actorType:'system',actorId:null});
  });
  it('cron da ponte Bio não herda o id do usuário ao declarar system',async()=>{
    vi.useFakeTimers();
    const svc=new BioBridgeService({org:{findMany:vi.fn(async()=>[{id:'empresa-a'}])}} as never);
    const vistos:unknown[]=[];
    const backfill=vi.spyOn(svc,'backfill').mockImplementation(async()=>{vistos.push({...contextoAtual()});return {semanas:0,cliques:0};});
    await comContexto({orgId:'empresa-a',actorType:'user',actorId:'humano',origem:'http',correlationId:'pedido'},async()=>{svc.onModuleInit();await vi.advanceTimersByTimeAsync(40_000);});
    expect(backfill).toHaveBeenCalledOnce();expect(vistos[0]).toMatchObject({orgId:'empresa-a',actorType:'system',actorId:null});
  });
});
