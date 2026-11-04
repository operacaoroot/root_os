import { describe, expect, it, vi } from 'vitest';
import { ArquivistaService } from '../src/clientes/arquivista/arquivista.service';
import type { ArquivoDoCliente } from '@prisma/client';

const linha = { id:'arquivo', orgId:'org', partnerId:'cliente', atorId:'proponente', approvalId:null,
  subpasta:'06-financeiro', nome:'nota.pdf', chave:'chave', sha256:'a'.repeat(64), bytes:1,
  tipoMime:'application/pdf', origem:'teste', estado:'classificar_a_mao' } as ArquivoDoCliente;

function montar(ativo:boolean) {
  const executar=vi.fn(async()=>({status:'aguardando_aprovacao',approvalId:'aprovacao'}));
  const prisma={
    user:{findFirst:vi.fn(async()=>ativo?{id:'proponente'}:null)},
    partner:{findFirst:vi.fn(async()=>({pastaDriveId:'pasta',interno:false}))},
    approval:{findFirst:vi.fn(async()=>null)},
    arquivoDoCliente:{findFirst:vi.fn(async()=>linha),findFirstOrThrow:vi.fn(async()=>({...linha,estado:'na_fila'})),update:vi.fn(async()=>({...linha,estado:'na_fila'})),updateMany:vi.fn(async()=>({count:1}))},
  };
  const escopo={exigirPessoa:vi.fn(async()=>{if(!ativo) throw new Error('pessoa inativa');}),exigir:vi.fn()};
  const service=new ArquivistaService(prisma as never,{executar} as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,escopo as never);
  return {service,executar};
}

describe('identidade original do arquivo',()=>{
  it('não converte pessoa inexistente ou inativa em ator system ao propor envio',async()=>{
    const {service,executar}=montar(false);
    await service['proporEnvio'](linha,'proponente').catch(()=>undefined);
    expect(executar).not.toHaveBeenCalled();
  });
  it('classificação manual mantém o proponente original em vez de substituí-lo por quem respondeu',async()=>{
    const {service,executar}=montar(true);
    await service['aoClassificarAMao']({orgId:'org',pendenciaId:'p',tipo:'classificacao',escolha:'06-financeiro',usuarioId:'classificador',refTipo:'ArquivoDoCliente',refId:'arquivo',dados:null});
    expect(executar).toHaveBeenCalledWith(expect.objectContaining({actorId:'proponente',actorType:'user'}));
  });
});

describe('efeito aprovado e carteira atual',()=>{
  it('recusa carteira revogada antes de qualquer leitura do Drive',async()=>{
    const {service}=montar(true);
    const conferir=vi.fn(async()=>{throw new Error('carteira revogada');});
    Object.assign(service, { efeitoClienteEscopo:{exigir:conferir} });
    await expect(service.efeitoEnviar({clienteId:'cliente',subpasta:'06-financeiro',nome:'nota.pdf',chave:'chave',sha256:'a'.repeat(64)},'org',{orgId:'org',approvalId:'aprovacao',actorId:'aprovador'})).rejects.toThrow();
    expect(conferir).toHaveBeenCalled();
  });
});

import { EfeitoClienteEscopoService } from '../src/clientes-escopo/efeito-cliente-escopo.service';
import { canonicalHash } from '../src/approvals/approvals.service';
import { ActorType, ApprovalState } from '@prisma/client';

describe('vínculo persistido de aprovação com efeito',()=>{
  function cenario() {
    const args={clienteId:'cliente',nome:'Cliente',origem:'manual'};
    const ap={id:'ap',orgId:'org',status:ApprovalState.consumida,capabilityId:'drive.pasta.criar',resourceType:'cliente',resourceId:'cliente',toolCallId:'tool',aprovadoPorId:'aprovador',propostoPorId:'proponente',propostoPorTipo:ActorType.user as ActorType,contentHash:canonicalHash('cliente',args,[])};
    const chamada={approvalId:'ap',actorType:ActorType.user as ActorType,actorId:'proponente',args};
    const prisma={approval:{findFirst:vi.fn(async()=>ap)},toolCall:{findFirst:vi.fn(async()=>chamada)},user:{findFirst:vi.fn(async()=>({id:'pessoa'}))}};
    const escopo={exigirAmplo:vi.fn(async(_org:string,_id:string)=>{}),exigirCliente:vi.fn(async()=>{})};
    const policy={resolverCapacidade:vi.fn(()=>({hashKeys:[]}))};
    const svc=new EfeitoClienteEscopoService(prisma as never,escopo as never,{} as never,policy as never);
    const pedido={orgId:'org',clienteId:'cliente',capabilityId:'drive.pasta.criar' as const,resourceType:'cliente' as const,resourceId:'cliente',args,ctx:{orgId:'org',approvalId:'ap',actorType:ActorType.user,actorId:'aprovador'}};
    return {svc,pedido,ap,chamada,escopo,policy};
  }
  it('autoriza somente proponente e aprovador atuais e conteúdo correspondente',async()=>{
    const c=cenario(); await c.svc.exigir(c.pedido);
    expect(c.escopo.exigirAmplo).toHaveBeenCalledWith('org','proponente');
    expect(c.escopo.exigirAmplo).toHaveBeenCalledWith('org','aprovador');
  });
  it('revogação da carteira interrompe efeito mesmo após aprovação',async()=>{
    const c=cenario();c.escopo.exigirAmplo.mockImplementation(async(_org:string,id:string)=>{if(id==='proponente')throw new Error('revogado');});
    await expect(c.svc.exigir(c.pedido)).rejects.toThrow('revogado');
  });
  it('recusa conteúdo alterado, aprovador diferente e proponente divergente',async()=>{
    const c=cenario(); await expect(c.svc.exigir({...c.pedido,args:{...c.pedido.args,nome:'alterado'}})).rejects.toThrow();
    await expect(c.svc.exigir({...c.pedido,ctx:{...c.pedido.ctx,actorId:'outro'}})).rejects.toThrow();
    c.chamada.actorId='outro';await expect(c.svc.exigir(c.pedido)).rejects.toThrow();
  });
  it('recusa origem system que não corresponde ao produtor conhecido',async()=>{
    const c=cenario(); c.ap.propostoPorTipo=ActorType.system;c.ap.propostoPorId='desconhecido';c.chamada.actorType=ActorType.system;c.chamada.actorId='desconhecido';
    await expect(c.svc.exigir(c.pedido)).rejects.toThrow();
  });
  it('recusa o slug de sistema conhecido quando não há cadeia persistida de origem',async()=>{
    const c=cenario();
    c.ap.propostoPorTipo=ActorType.system;c.ap.propostoPorId='criador-da-pasta-do-cliente';
    c.chamada.actorType=ActorType.system;c.chamada.actorId='criador-da-pasta-do-cliente';
    await expect(c.svc.exigir(c.pedido)).rejects.toThrow();
  });
});

describe('revogação durante o storage',()=>{
  it('não envia conteúdo ao modelo após revogação durante put',async()=>{
    let ativo=true;
    const complete=vi.fn(async()=>({text:'resposta'}));
    const prisma={partner:{findFirst:vi.fn(async()=>({id:'cliente',isCliente:true,interno:false,pastaDriveId:'pasta'}))},arquivoDoCliente:{findFirst:vi.fn(async()=>null)}};
    const escopo={exigirPessoa:vi.fn(async()=>{if(!ativo)throw new Error('revogado');})};
    const svc=new ArquivistaService(prisma as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,{complete} as never,escopo as never);
    svc.usarArmazem({put:vi.fn(async()=>{ativo=false;}),get:vi.fn() as never});
    await svc.arquivar({orgId:'org',partnerId:'cliente',atorId:'proponente',origem:'manual',nomeOriginal:'x.txt',tipoMime:'text/plain',conteudo:{buffer:Buffer.from('texto privado')},texto:'texto privado'});
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('cadeia persistida do arquivo recebido',()=>{
  it('recusa origem inválida antes do storage, modelo e idempotência',async()=>{
    const put=vi.fn(), complete=vi.fn(), buscar=vi.fn();
    const prisma={partner:{findFirst:vi.fn(async()=>({id:'cliente',isCliente:true,interno:false,pastaDriveId:'pasta'}))},arquivoDoCliente:{findFirst:buscar}};
    const escopo={exigirOrigemRecebida:vi.fn(async()=>{throw new Error('origem inválida');}),exigirPessoa:vi.fn()};
    const svc=new ArquivistaService(prisma as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,{complete} as never,escopo as never);
    svc.usarArmazem({put,get:vi.fn() as never});
    const r=await svc.arquivar({orgId:'org',partnerId:'cliente',leadId:'lead',origem:'manual',origemRecebidaId:'recibo',nomeOriginal:'x.txt',tipoMime:'text/plain',conteudo:{buffer:Buffer.from('texto')}});
    expect(r.estado).toBe('erro'); expect(put).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled(); expect(buscar).not.toHaveBeenCalled();
  });
  it('não aceita substituir o originador humano da prova pelo aprovador',async()=>{
    const buscar=vi.fn();
    const prisma={partner:{findFirst:vi.fn(async()=>({id:'cliente',isCliente:true,interno:false,pastaDriveId:'pasta'}))},arquivoDoCliente:{findFirst:buscar}};
    const escopo={exigirOrigemRecebida:vi.fn(async()=>({atorId:'original'})),exigirPessoa:vi.fn()};
    const svc=new ArquivistaService(prisma as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,escopo as never);
    const r=await svc.arquivar({orgId:'org',partnerId:'cliente',leadId:'lead',origem:'manual',origemRecebidaId:'recibo',atorId:'aprovador',nomeOriginal:'x.txt',tipoMime:'text/plain',conteudo:{buffer:Buffer.from('texto')}});
    expect(r.estado).toBe('erro'); expect(buscar).not.toHaveBeenCalled();
  });
});

describe('revalidação entre leituras e alteração concorrente',()=>{
  it('não envia segunda leitura ao modelo após revogação na primeira',async()=>{
    let ativo=true;
    const complete=vi.fn(async()=>{ativo=false;return {text:'inconclusivo'};});
    const svc=new ArquivistaService({} as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,{complete} as never,{} as never);
    await expect(svc['classificar']('org',{nomeOriginal:'x.txt',tipoMime:'text/plain',origem:'manual',texto:'privado'},async()=>{if(!ativo)throw new Error('revogado');})).rejects.toThrow('revogado');
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it('retry não sobrescreve o dono atualizado enquanto prepara o arquivo',async()=>{
    const antiga={...linha,estado:'erro',leadId:null,refTipo:null,refId:null,atualizadoEm:new Date('2026-01-01Z')};
    const updateMany=vi.fn(async()=>({count:0}));
    const prisma={partner:{findFirst:vi.fn(async()=>({id:'cliente',isCliente:true,interno:false,pastaDriveId:'pasta'}))},arquivoDoCliente:{findFirst:vi.fn(async()=>antiga),updateMany}};
    const escopo={exigirPessoa:vi.fn(async()=>{})};
    const svc=new ArquivistaService(prisma as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,escopo as never);
    svc.usarArmazem({put:vi.fn(async()=>{}),get:vi.fn() as never});
    const r=await svc.arquivar({orgId:'org',partnerId:'cliente',atorId:'proponente',origem:'manual',nomeOriginal:'x.txt',tipoMime:'text/plain',conteudo:{buffer:Buffer.from('texto')},subpasta:'06-financeiro'});
    expect(r.estado).toBe('erro');
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({orgId:'org',id:'arquivo',atorId:'proponente',partnerId:'cliente',atualizadoEm:antiga.atualizadoEm})}));
  });
});
