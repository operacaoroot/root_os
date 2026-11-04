import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { ClientesController } from '../src/clientes/clientes.controller';
describe('pastas visíveis por cliente',()=>{
  function fixture() {
    let ids=['A'];
    const rows=[{id:'A',razaoSocial:'Cliente A'},{id:'B',razaoSocial:'Cliente B'}];
    const db={
      partner:{findMany:vi.fn(async({where}:any)=>rows.filter(r=>!where.id||where.id.in.includes(r.id)))},
      approval:{findMany:vi.fn(async()=>[])},arquivoDoCliente:{groupBy:vi.fn(async()=>[])},
    };
    const escopo={filtro:vi.fn(async()=>({orgId:'org',clienteId:{in:ids}}))};
    return {controller:new ClientesController({} as any,db as any,escopo as any),db,revogar:()=>{ids=[];}};
  }
  const user={orgId:'org',sub:'pessoa',permissions:['tarefas.ver']} as any;
  it('filtra cadastro e contagem de arquivos pela carteira',async()=>{
    const f=fixture();expect((await f.controller.pastasDosClientes(user)).map(x=>x.id)).toEqual(['A']);
    expect(f.db.arquivoDoCliente.groupBy).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({partnerId:{in:['A']}})}));
  });
  it('revogação tira pastas na próxima chamada sem nova sessão',async()=>{
    const f=fixture();await f.controller.pastasDosClientes(user);f.revogar();
    expect(await f.controller.pastasDosClientes(user)).toEqual([]);
  });
});
