import { describe, expect, it } from 'vitest';
import { financeiroCoerente, parcelaCoerente } from '../src/finance/finance-carteira';

describe('vínculos dos registros financeiros', () => {
  const contratos = new Map([
    ['ca',{orgId:'o',partnerId:'A',tipo:'entrada',comercialContratoId:null}],
    ['cb',{orgId:'o',partnerId:'B',tipo:'entrada',comercialContratoId:null}],
    ['fornecedor',{orgId:'o',partnerId:'A',tipo:'saida',comercialContratoId:null}],
    ['comercial-invalido',{orgId:'o',partnerId:'A',tipo:'entrada',comercialContratoId:'x'}],
    ['comercial-valido',{orgId:'o',partnerId:'A',tipo:'entrada',comercialContratoId:'ok'}],
  ]);
  it('admite apenas o cliente do título, contrato de entrada coerente e vínculo comercial válido', () => {
    const validos = new Map([['ok','A'],['outro','B']]);
    expect(financeiroCoerente({orgId:'o',partnerId:'A',contractId:null},contratos,validos)).toBe(false);
    expect(financeiroCoerente({orgId:'o',partnerId:'A',contractId:'ca'},contratos,validos)).toBe(true);
    for(const id of ['cb','fornecedor','comercial-invalido','ausente']) expect(financeiroCoerente({orgId:'o',partnerId:'A',contractId:id},contratos,validos)).toBe(false);
    expect(financeiroCoerente({orgId:'o',partnerId:'A',contractId:'comercial-valido'},contratos,validos)).toBe(true);
    expect(financeiroCoerente({orgId:'o',partnerId:null,contractId:null},contratos,validos)).toBe(false);
  });
  it('rejeita parcela cujo recebimento aponta para outra carteira ou despesa', () => {
    expect(parcelaCoerente('o','A',null,null)).toBe(true);
    expect(parcelaCoerente('o','A','t',{orgId:'o',partnerId:'A',type:'entrada'})).toBe(true);
    expect(parcelaCoerente('o','A','t',{orgId:'o',partnerId:'B',type:'entrada'})).toBe(false);
    expect(parcelaCoerente('o','A','t',{orgId:'o',partnerId:'A',type:'saida'})).toBe(false);
    expect(parcelaCoerente('o','A','t',null)).toBe(false);
    expect(parcelaCoerente('o','A','t',{orgId:'o',partnerId:'A',type:'entrada'},'contrato-1','contrato-2')).toBe(false);
    expect(parcelaCoerente('o','A','t',{orgId:'o',partnerId:'A',type:'entrada'},'contrato-1','contrato-1')).toBe(true);
  });
});

import { FinanceCarteiraController } from '../src/finance/finance-carteira.controller';
import { vi } from 'vitest';
describe('portas de leitura financeira', () => {
  it('não permite acesso sem ator', () => {
    const svc:any={recebiveis:vi.fn(),recebivel:vi.fn(),acordos:vi.fn(),acordo:vi.fn()};
    const ctl=new FinanceCarteiraController(svc), u:any={orgId:'org'};
    expect(()=>ctl.recebiveis(u,{})).toThrow(); expect(()=>ctl.recebivel(u,'id',{})).toThrow();
    expect(()=>ctl.acordos(u,{})).toThrow(); expect(()=>ctl.acordo(u,'id',{})).toThrow();
  });
});

import { FinanceCarteiraService } from '../src/finance/finance-carteira.service';
import { Prisma } from '@prisma/client';
describe('totais de recebíveis por carteira', () => {
  it('não muda a contagem ou soma de A quando B ou nulo recebem lançamentos', async () => {
    const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
    const base=(id:string,partnerId:string|null,contractId:string|null,amount:string)=>({id,orgId:'org',partnerId,contractId,type:'entrada',description:id,amount:new Prisma.Decimal(amount),status:'previsto',date:new Date('2026-01-01Z'),dueDate:null,paidAt:null});
    const linhas=[base('A',a,'contratoA','10.50')];
    const tx:any={comercialFicha:{findMany:vi.fn().mockResolvedValue([])},comercialContrato:{findMany:vi.fn().mockResolvedValue([])},contract:{findMany:vi.fn().mockResolvedValue([{id:'contratoA',orgId:'org',partnerId:a,tipo:'entrada',comercialContratoId:null}])},financeTransaction:{findMany:vi.fn(async(args:any)=>linhas.filter(r=>args.where.partnerId.in.includes(r.partnerId)))}};
    const db:any={...tx,user:{findFirst:vi.fn().mockResolvedValue({roles:[{permissions:[{key:'financeiro.ver'}]}]})},$transaction:vi.fn(async(fn:any)=>fn(tx))};
    const scope:any={listar:vi.fn().mockResolvedValue({amplo:false,clientes:[{id:a,nome:'A',interno:false}]})};
    const svc=new FinanceCarteiraService(db,scope);
    const antes=await svc.recebiveis('org','user',{page:1,limit:30});
    linhas.push(base('B',b,'contratoB','999.99'),base('sem',null,null,'123.45'));
    const depois=await svc.recebiveis('org','user',{page:1,limit:30});
    expect(depois).toEqual(antes);
    expect(depois.total).toBe(1);
    expect(depois.estados[0]).toEqual({status:'previsto',quantidade:1,valor:'10.50'});
  });
});
