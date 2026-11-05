import { describe, expect, it, vi } from 'vitest';
import { DinheiroService } from '../src/comercial/dinheiro.service';

describe('assinatura vinculada ao documento',()=>{
  for(const caso of ['documento de outro lead','id externo diferente','documento cancelado'] as const) it(`recusa ${caso} sem escrita ou fato`,async()=>{
    const documento={id:'doc',orgId:'org',leadId:caso==='documento de outro lead'?'outro':'lead',provedor:'zapsign',externoId:caso==='id externo diferente'?'outro':'externo',estado:caso==='documento cancelado'?'cancelado':'enviado'};
    const updateMany=vi.fn(async()=>({count:1})),registrar=vi.fn(async()=>({novo:true}));
    const prisma={comercialDocumento:{findFirst:vi.fn(async()=>documento),updateMany}};
    const svc=new DinheiroService(prisma as never,{registrar} as never,{} as never,{} as never,{} as never,{} as never,{provedor:'zapsign'} as never);
    await expect(svc.aplicarAssinatura('org','lead','doc',{externoId:'externo',assinados:[{papel:'cliente'}],todosAssinaram:true} as never)).rejects.toThrow();
    expect(updateMany).not.toHaveBeenCalled();expect(registrar).not.toHaveBeenCalled();
  });
});
