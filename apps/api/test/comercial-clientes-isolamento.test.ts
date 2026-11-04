import { describe, expect, it } from 'vitest';
import { contratosCoerentes } from '../src/comercial/comercial-carteira';

describe('contratos na carteira', () => {
  it('exclui cliente diferente da ficha, órfãos, ciclos e filhos de outro lead ou cliente', () => {
    const fichas = new Map([['leadA','A'], ['leadB','B'], ['leadOutroA','A']]);
    const rows = [
      {id:'a', leadId:'leadA',partnerId:'A',paiId:null},
      {id:'filho', leadId:'leadA',partnerId:'A',paiId:'a'},
      {id:'b', leadId:'leadB',partnerId:'B',paiId:null},
      {id:'divergente', leadId:'leadA',partnerId:'B',paiId:null},
      {id:'pai-errado', leadId:'leadA',partnerId:'A',paiId:'b'},
      {id:'outro-lead', leadId:'leadOutroA',partnerId:'A',paiId:'a'},
      {id:'orfa', leadId:'leadA',partnerId:'A',paiId:'ausente'},
      {id:'null', leadId:'leadA',partnerId:null,paiId:null},
      {id:'ciclo1', leadId:'leadA',partnerId:'A',paiId:'ciclo2'},
      {id:'ciclo2', leadId:'leadA',partnerId:'A',paiId:'ciclo1'},
    ];
    expect(contratosCoerentes(rows,fichas)).toEqual(['a','filho','b']);
  });
});

import { ComercialCarteiraController } from '../src/comercial/comercial-carteira.controller';
import { ComercialCarteiraService } from '../src/comercial/comercial-carteira.service';
import { vi } from 'vitest';

describe('porta de leitura comercial da carteira', () => {
  it('recusa ator ausente nas quatro rotas', () => {
    const svc:any={leads:vi.fn(),lead:vi.fn(),contratos:vi.fn(),contrato:vi.fn()};
    const ctl=new ComercialCarteiraController(svc);
    const u:any={orgId:'o'};
    expect(()=>ctl.leads(u,{})).toThrow();
    expect(()=>ctl.lead(u,'id',{})).toThrow();
    expect(()=>ctl.contratos(u,{})).toThrow();
    expect(()=>ctl.contrato(u,'id',{})).toThrow();
    expect(svc.leads).not.toHaveBeenCalled();
  });
  it('restringe a lista à carteira antes de contar e paginar', async () => {
    const a='11111111-1111-4111-8111-111111111111';
    const fichas:any={count:vi.fn().mockResolvedValue(0),groupBy:vi.fn().mockResolvedValue([]),findMany:vi.fn().mockResolvedValue([])};
    const tx:any={comercialFicha:fichas};
    const db:any={$transaction:vi.fn(async (fn:any)=>fn(tx)),user:{findFirst:vi.fn().mockResolvedValue({roles:[{permissions:[{key:'leads.ver'}]}]})}};
    const escopo:any={listar:vi.fn().mockResolvedValue({amplo:false,clientes:[{id:a,nome:'A',interno:false}]})};
    const svc=new ComercialCarteiraService(db,escopo);
    const result=await svc.leads('org','user',{page:1,limit:30});
    expect(result.total).toBe(0);
    expect(fichas.count.mock.calls[0][0].where.partnerId).toEqual({in:[a]});
    expect(fichas.findMany.mock.calls[0][0].where.partnerId).toEqual({in:[a]});
    expect(fichas.findMany.mock.calls[0][0].take).toBe(30);
  });
});

describe('revogação e reclassificação durante leitura', () => {
  it('recusa o snapshot caso uma ficha saia da carteira antes da resposta', async () => {
    const a='11111111-1111-4111-8111-111111111111';
    const ficha={leadId:'lead',partnerId:a,empresa:'A',etapa:'novo_lead',produto:null,valorCentavos:null,etapaDesde:new Date('2026-01-01Z'),lead:{name:'Nome A'}};
    const fichas:any={count:vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),groupBy:vi.fn().mockResolvedValue([]),findMany:vi.fn().mockResolvedValueOnce([ficha]).mockResolvedValueOnce([])};
    const tx:any={comercialFicha:fichas};
    const db:any={...tx,$transaction:vi.fn(async (fn:any)=>fn(tx)),user:{findFirst:vi.fn().mockResolvedValue({roles:[{permissions:[{key:'leads.ver'}]}]})}};
    const escopo:any={listar:vi.fn().mockResolvedValue({amplo:false,clientes:[{id:a,nome:'A',interno:false}]})};
    const svc=new ComercialCarteiraService(db,escopo);
    await expect(svc.leads('org','user',{page:1,limit:30})).rejects.toThrow();
  });
});

describe('relações documentais e perfil na leitura', () => {
  it('exclui contrato e descendentes se documento ou minuta apontam para outro lead', () => {
    const fichas=new Map([['leadA','A']]);
    const rows=[
      {id:'bom',orgId:'org',leadId:'leadA',partnerId:'A',paiId:null,documentoId:'d',documento:{orgId:'org',leadId:'leadA'}},
      {id:'ruim',orgId:'org',leadId:'leadA',partnerId:'A',paiId:null,minutaId:'m',minuta:{orgId:'org',leadId:'leadB'}},
      {id:'desc',orgId:'org',leadId:'leadA',partnerId:'A',paiId:'ruim'},
      {id:'estranho',orgId:'org',leadId:'leadA',partnerId:'A',paiId:null,documentoId:'d2',documento:{orgId:'outra',leadId:'leadA'}},
      {id:'ausente',orgId:'org',leadId:'leadA',partnerId:'A',paiId:null,minutaId:'m2',minuta:null},
    ];
    expect(contratosCoerentes(rows,fichas)).toEqual(['bom']);
  });
  it('nega resultado quando carteira muda durante snapshot', async () => {
    const a='11111111-1111-4111-8111-111111111111';
    const tx:any={comercialFicha:{count:vi.fn().mockResolvedValue(0),groupBy:vi.fn().mockResolvedValue([]),findMany:vi.fn().mockResolvedValue([])}};
    const db:any={...tx,user:{findFirst:vi.fn().mockResolvedValue({roles:[{permissions:[{key:'leads.ver'}]}]})},$transaction:vi.fn(async (fn:any)=>fn(tx))};
    const escopo:any={listar:vi.fn().mockResolvedValueOnce({amplo:false,clientes:[{id:a,nome:'A',interno:false}]}).mockResolvedValue({amplo:false,clientes:[]})};
    const svc=new ComercialCarteiraService(db,escopo);
    await expect(svc.leads('org','user',{page:1,limit:30})).rejects.toThrow();
  });
});
