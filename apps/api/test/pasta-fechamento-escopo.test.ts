import { describe, expect, it, vi } from 'vitest';
import { ActorType, ApprovalState } from '@prisma/client';
import { canonicalHash } from '../src/approvals/approvals.service';
import { EfeitoClienteEscopoService } from '../src/clientes-escopo/efeito-cliente-escopo.service';

function cenario() {
  const args={leadId:'lead',chave:'fech-lead-v2',propostaHash:'hash'};
  const ap={id:'r4',toolCallId:'chamada',nivelExigido:'R4',propostoPorTipo:ActorType.user as ActorType,propostoPorId:'original',aprovadoPorId:'aprovador',resourceId:args.chave,contentHash:canonicalHash('comercial.fechamento',args,[])};
  const chamada={approvalId:'r4',actorType:ActorType.user as ActorType,actorId:'original',args};
  const ficha={partnerId:'cliente',propostaVersao:2,propostaHash:'hash'};
  const prisma={approval:{findFirst:vi.fn(async({where}:any)=>where.id ? ap : null)},toolCall:{findFirst:vi.fn(async()=>chamada)},comercialFechamento:{findFirst:vi.fn(async()=>({chave:args.chave,versao:2}))},comercialFicha:{findFirst:vi.fn(async()=>ficha)},leadEvent:{findFirst:vi.fn(async()=>({payload:{hash:'hash',versao:2}}))},user:{findFirst:vi.fn(async()=>({id:'pessoa'}))}};
  const escopo={exigirAmplo:vi.fn(async(_org:string,_id:string)=>{}),exigirCliente:vi.fn(async()=>{})};
  const svc=new EfeitoClienteEscopoService(prisma as never,escopo as never,{} as never,{resolverCapacidade:()=>({hashKeys:[]})} as never);
  return {svc,ap,chamada,ficha,escopo,prisma};
}

describe('cadeia da pasta criada pelo fechamento',()=>{
  it('recupera o originador humano, não o aprovador',async()=>{
    const c=cenario();
    await expect(c.svc.exigirFechamento('org','cliente','lead','r4','fechamento')).resolves.toEqual({atorId:'original'});
    expect(c.escopo.exigirAmplo).toHaveBeenCalledWith('org','original');
    expect(c.escopo.exigirAmplo).toHaveBeenCalledWith('org','aprovador');
  });
  it('recusa conteúdo divergente e revogação do originador',async()=>{
    const c=cenario(); c.ficha.propostaHash='alterado';
    await expect(c.svc.exigirFechamento('org','cliente','lead','r4','fechamento')).rejects.toThrow();
    c.ficha.propostaHash='hash'; c.escopo.exigirAmplo.mockImplementation(async(_org:string,id:string)=>{if(id==='original')throw new Error('revogado');});
    await expect(c.svc.exigirFechamento('org','cliente','lead','r4','fechamento')).rejects.toThrow('revogado');
  });
  it('recusa R4 de sistema quando há origem humana conflitante na mesma chave',async()=>{
    const c=cenario(); c.ap.propostoPorTipo=ActorType.system;c.ap.propostoPorId='comercial';c.chamada.actorType=ActorType.system;c.chamada.actorId='comercial';
    c.prisma.approval.findFirst.mockImplementation(async({where}:any)=>where.id ? c.ap : {id:'humano'} as never);
    await expect(c.svc.exigirFechamento('org','cliente','lead','r4','fechamento')).rejects.toThrow();
  });
});
