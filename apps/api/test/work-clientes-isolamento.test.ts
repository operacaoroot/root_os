import { describe, expect, it } from 'vitest';
import { idsDeTarefasCoerentes } from '../src/work/work-clientes-isolamento';

describe('isolamento da hierarquia de trabalho', () => {
  it('inclui somente tarefas autorizadas com toda a cadeia no mesmo cliente', () => {
    const rows = [
      { id: 'a', parentId: null, clienteId: 'A' },
      { id: 'filho', parentId: 'a', clienteId: 'A' },
      { id: 'neto', parentId: 'filho', clienteId: 'A' },
      { id: 'b', parentId: null, clienteId: 'B' },
      { id: 'cruzada', parentId: 'b', clienteId: 'A' },
      { id: 'descendente', parentId: 'cruzada', clienteId: 'A' },
      { id: 'sem', parentId: null, clienteId: null },
      { id: 'orfa', parentId: 'ausente', clienteId: 'A' },
      { id: 'ciclo1', parentId: 'ciclo2', clienteId: 'A' },
      { id: 'ciclo2', parentId: 'ciclo1', clienteId: 'A' },
    ];
    expect(idsDeTarefasCoerentes(rows, new Set(['A']))).toEqual(['a', 'filho', 'neto']);
    expect(idsDeTarefasCoerentes(rows, new Set(['A', 'B']))).toEqual(['a', 'filho', 'neto', 'b']);
    expect(idsDeTarefasCoerentes(rows, new Set())).toEqual([]);
  });
});

import { vi } from 'vitest';
import { WorkService } from '../src/work/work.service';

describe('consultas de Trabalho por carteira', () => {
  it('filtra antes da paginação e da contagem, sem aceitar sobrescrita do cliente', async () => {
    const db: any = { workTask: {
      findMany: vi.fn().mockResolvedValueOnce([{id:'a',parentId:null,clienteId:'A'},{id:'b',parentId:null,clienteId:'B'}]).mockResolvedValueOnce([]),
      count: vi.fn().mockResolvedValue(0),
    }};
    db.$transaction = vi.fn(async (fn: any) => fn(db));
    const scope: any = { perfil: vi.fn().mockResolvedValue({modo:'SELECTED'}), filtro: vi.fn().mockResolvedValue({orgId:'org',clienteId:{in:['A']}}) };
    const svc = new WorkService(db, {} as any, {} as any, scope);
    await svc.tarefas('org', { listId:'list', q:'busca' }, 'user');
    expect(db.workTask.findMany.mock.calls[1][0].where.id).toEqual({in:['a']});
    expect(db.workTask.count.mock.calls[0][0].where.id).toEqual({in:['a']});
    expect(db.workTask.findMany.mock.calls[1][0].where.title).toEqual({contains:'busca',mode:'insensitive'});
  });
});

import { WorkController } from '../src/work/work.controller';
describe('identidade nas rotas adaptadas', () => {
  it('recusa requisições sem ator em qualquer rota de leitura liberada', () => {
    const svc: any = { clientes: vi.fn(), tarefas: vi.fn(), tarefa: vi.fn() };
    const controller = new WorkController(svc, {} as any, {} as any, {} as any);
    const semAtor = { orgId:'org' } as any;
    expect(() => controller.clientes(semAtor)).toThrow();
    expect(() => controller.tarefas(semAtor, {})).toThrow();
    expect(() => controller.tarefa(semAtor, 'a')).toThrow();
    expect(svc.clientes).not.toHaveBeenCalled();
    expect(svc.tarefas).not.toHaveBeenCalled();
    expect(svc.tarefa).not.toHaveBeenCalled();
  });
});

describe('revogação e filtros da carteira', () => {
  it('recarrega a carteira na chamada seguinte e não permite filtrar por outro cliente', async () => {
    const db: any = { workTask: {
      findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0),
    }};
    db.$transaction = vi.fn(async (fn: any) => fn(db));
    let liberado = true;
    const scope: any = {
      perfil: vi.fn().mockResolvedValue({modo:'SELECTED'}),
      filtro: vi.fn(async (_org: string, _user: string, cliente?: string) => {
        if (cliente && cliente !== 'A') throw new Error('negado');
        return {orgId:'org',clienteId:{in:liberado ? ['A'] : []}};
      }),
    };
    const svc = new WorkService(db, {} as any, {} as any, scope);
    await svc.tarefas('org', { listId:'list' }, 'user');
    liberado = false;
    await svc.tarefas('org', { listId:'list' }, 'user');
    expect(db.workTask.findMany.mock.calls[2][0].where.clienteId).toEqual({in:[]});
    await expect(svc.tarefas('org', { listId:'list', cliente:'B' }, 'user')).rejects.toThrow('negado');
  });
});

describe('fotografia coerente da carteira e tarefas', () => {
  it('executa listagem inteira no mesmo snapshot', async () => {
    const tx: any = { workTask: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) } };
    const db: any = { ...tx, $transaction: vi.fn(async (fn: any) => fn(tx)) };
    const scope: any = { perfil: vi.fn().mockResolvedValue({modo:'SELECTED'}), filtro: vi.fn().mockResolvedValue({orgId:'org',clienteId:{in:[]}}) };
    const svc = new WorkService(db, {} as any, {} as any, scope);
    await svc.tarefas('org', {listId:'l'}, 'user');
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({isolationLevel:'RepeatableRead'}));
    expect(scope.filtro.mock.calls[0][3]).toBe(tx);
  });
});

describe('comentário isolado', () => {
  it('nega gravação quando tarefa não pertence à carteira dentro da transação', async () => {
    const tx: any = { $queryRaw: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{id:'task'}]), workComment: {create:vi.fn()}, workTask:{findFirst:vi.fn().mockResolvedValue({id:'task',parentId:null,clienteId:'A'})}, user:{findFirst:vi.fn().mockResolvedValue({roles:[{permissions:[{key:'tarefas.editar'}]}]})} };
    const db: any = {$transaction:vi.fn(async (fn:any)=>fn(tx))};
    const taskScope: any = {exigir:vi.fn().mockRejectedValue(new Error('negado'))};
    const svc = new WorkService(db, {} as any, {} as any, {} as any, taskScope);
    await expect(svc.comentarHttp('org','user','task','oi')).rejects.toThrow('negado');
    expect(taskScope.exigir).toHaveBeenCalledWith('org','user','task',tx);
    expect(tx.workComment.create).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });
});

describe('escritas restritas da carteira', () => {
  it('recusa mudar cliente ou pai antes de qualquer edição', async () => {
    const db: any = { $transaction: vi.fn() };
    const scope: any = { perfil: vi.fn().mockResolvedValue({modo:'SELECTED'}) };
    const svc = new WorkService(db, {} as any, {} as any, scope, {} as any);
    await expect(svc.editarTarefaEscopadaHttp('org','user','task',{ expectedUpdatedAt:'2026-01-01T00:00:00.000Z', clienteId:'B' })).rejects.toThrow();
    await expect(svc.editarTarefaEscopadaHttp('org','user','task',{ expectedUpdatedAt:'2026-01-01T00:00:00.000Z', parentId:null })).rejects.toThrow();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('recusa relações ainda não adaptadas na criação', async () => {
    const db: any = { $transaction: vi.fn() };
    const scope: any = { perfil: vi.fn().mockResolvedValue({modo:'SELECTED'}) };
    const svc = new WorkService(db, {} as any, {} as any, scope, {} as any);
    await expect(svc.criarTarefaEscopadaHttp('org','user',{listId:'list',title:'t',leadId:'lead'})).rejects.toThrow();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe('gravações sob carteira', () => {
  it('não permite colocar subtarefa em cliente diferente do pai', async () => {
    const tx: any = {
      $queryRaw:vi.fn(),
      user:{findFirst:vi.fn().mockResolvedValue({roles:[{permissions:[{key:'tarefas.editar'}]}]})},
      workTask:{findFirst:vi.fn()
        .mockResolvedValueOnce({id:'referencia'})
        .mockResolvedValueOnce({id:'referencia'})
        .mockResolvedValueOnce({clienteId:'A',listId:'lista',excluidaEm:null}),create:vi.fn()},
    };
    const db:any={$transaction:vi.fn(async (fn:any)=>fn(tx))};
    const scope:any={perfil:vi.fn().mockResolvedValue({modo:'SELECTED'})};
    const taskScope:any={exigir:vi.fn().mockResolvedValue({id:'pai',clienteId:'A',parentId:null})};
    const svc=new WorkService(db,{} as any,{} as any,scope,taskScope);
    vi.spyOn(svc as any,'idsVisiveis').mockResolvedValue(['referencia','pai']);
    vi.spyOn(svc as any,'travarCadeia').mockResolvedValue(undefined);
    await expect(svc.criarTarefaEscopadaHttp('org','user',{listId:'lista',title:'t',parentId:'pai',clienteId:'B'})).rejects.toThrow(/cliente da tarefa pai/);
    expect(tx.workTask.create).not.toHaveBeenCalled();
  });
  it('não altera tarefa quando a versão já mudou', async () => {
    const tx:any={$queryRaw:vi.fn(),user:{findFirst:vi.fn().mockResolvedValue({roles:[{permissions:[{key:'tarefas.editar'}]}]})},workTask:{findFirst:vi.fn().mockResolvedValue({id:'t',updatedAt:new Date('2026-01-02T00:00:00Z'),excluidaEm:null}),updateMany:vi.fn()}};
    const db:any={$transaction:vi.fn(async (fn:any)=>fn(tx))};
    const scope:any={perfil:vi.fn().mockResolvedValue({modo:'SELECTED'})};
    const taskScope:any={exigir:vi.fn().mockResolvedValue({id:'t',clienteId:'A',parentId:null})};
    const svc=new WorkService(db,{} as any,{} as any,scope,taskScope);
    vi.spyOn(svc as any,'travarCadeia').mockResolvedValue(undefined);
    await expect(svc.editarTarefaEscopadaHttp('org','user','t',{expectedUpdatedAt:'2026-01-01T00:00:00.000Z',title:'novo'})).rejects.toThrow();
    expect(tx.workTask.updateMany).not.toHaveBeenCalled();
  });
});

import { capacidadesDaCarteira } from '../src/work/work-clientes-isolamento';
describe('capacidades do detalhe restrito', () => {
  it('considera permissão, tarefa viva e portas da lista', () => {
    const base={podeEditar:true,tarefaViva:true,listaVisivel:true,temStatus:true,comercial:false,implantacao:false};
    expect(capacidadesDaCarteira(base)).toEqual({podeCriar:true,podeCriarSubtarefa:true,podeEditar:true});
    expect(capacidadesDaCarteira({...base,implantacao:true})).toEqual({podeCriar:false,podeCriarSubtarefa:true,podeEditar:true});
    expect(capacidadesDaCarteira({...base,comercial:true})).toEqual({podeCriar:false,podeCriarSubtarefa:false,podeEditar:true});
    expect(capacidadesDaCarteira({...base,podeEditar:false})).toEqual({podeCriar:false,podeCriarSubtarefa:false,podeEditar:false});
  });
});

describe('cadeia na gravação de comentário', () => {
  it('não grava se a cadeia muda enquanto espera a trava', async () => {
    const tx:any={$queryRaw:vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{id:'t'}]),user:{findFirst:vi.fn().mockResolvedValue({roles:[{permissions:[{key:'tarefas.editar'}]}]})},workTask:{findFirst:vi.fn().mockResolvedValueOnce({id:'t',parentId:null,clienteId:'A'}).mockResolvedValueOnce({id:'t',parentId:null,clienteId:'B'})},workComment:{create:vi.fn()}};
    const db:any={$transaction:vi.fn(async (fn:any)=>fn(tx))};
    const svc=new WorkService(db,{} as any,{} as any,{} as any,{exigir:vi.fn()} as any);
    await expect(svc.comentarHttp('org','user','t','olá')).rejects.toThrow(/mudou/);
    expect(tx.workComment.create).not.toHaveBeenCalled();
  });
  it('grava e audita depois de autorizar e travar a cadeia', async () => {
    const no={id:'t',parentId:null,clienteId:'A'};
    const tx:any={$queryRaw:vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{id:'t'}]),user:{findFirst:vi.fn().mockResolvedValueOnce({roles:[{permissions:[{key:'tarefas.editar'}]}]}).mockResolvedValueOnce({name:'Pessoa'})},workTask:{findFirst:vi.fn().mockResolvedValueOnce(no).mockResolvedValueOnce(no).mockResolvedValueOnce({excluidaEm:null})},workComment:{create:vi.fn().mockResolvedValue({id:'c',createdAt:new Date('2026-01-01T00:00:00Z')})}};
    const db:any={$transaction:vi.fn(async (fn:any)=>fn(tx))};
    const audit:any={log:vi.fn()};
    const escopo:any={exigir:vi.fn()};
    const svc=new WorkService(db,audit,{} as any,{} as any,escopo);
    await expect(svc.comentarHttp('org','user','t','olá')).resolves.toEqual({id:'c',createdAt:'2026-01-01T00:00:00.000Z'});
    expect(escopo.exigir).toHaveBeenCalledTimes(2);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({action:'work.comment.create'}),tx);
  });
});
