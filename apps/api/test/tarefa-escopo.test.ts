import { describe, it, expect, vi } from 'vitest';
import { TarefaEscopoService } from '../src/clientes-escopo/tarefa-escopo.service';
const rows = [
  { id:'a', orgId:'org', clienteId:'A', parentId:null },
  { id:'b', orgId:'org', clienteId:'B', parentId:null },
  { id:'filha', orgId:'org', clienteId:'A', parentId:'a' },
  { id:'cruzada', orgId:'org', clienteId:'A', parentId:'b' },
  { id:'ciclo', orgId:'org', clienteId:'A', parentId:'ciclo' },
  { id:'sem', orgId:'org', clienteId:null, parentId:null },
];
describe('autorização de tarefa e ancestrais', () => {
  function fixture() {
    let modo = 'SELECTED', clientes = ['A'];
    const findFirst = vi.fn(async ({where}:any) => rows.find(r => r.id===where.id && r.orgId===where.orgId) ?? null);
    const scope = { filtro: vi.fn(async (_o:string, u:string) => { if(!u) throw new Error('sem ator'); return modo==='ALL'?{orgId:'org'}:{orgId:'org',clienteId:{in:clientes}}; }) };
    const svc = new TarefaEscopoService({workTask:{findFirst}} as any, scope as any);
    return {svc,findFirst, revogar:()=>{clientes=[];}, amplo:()=>{modo='ALL';}, ambos:()=>{clientes=['A','B'];}};
  }
  it('permite pai e filha A; nega B/NULL e identidade incompleta', async()=>{
    const f=fixture();
    expect(await f.svc.exigir('org','u','filha')).toMatchObject({id:'filha'});
    for(const id of ['b','sem','inexistente']) await expect(f.svc.exigir('org','u',id)).rejects.toThrow();
    await expect(f.svc.exigir('org','','a')).rejects.toThrow();
  });
  it('nega hierarquia divergente mesmo com A+B e ciclos', async()=>{
    const f=fixture();f.ambos();
    for(const id of ['cruzada','ciclo']) await expect(f.svc.exigir('org','u',id)).rejects.toThrow();
  });
  it('revoga sem nova sessão e preserva legado para ALL',async()=>{
    const f=fixture();await f.svc.exigir('org','u','a');f.revogar();
    await expect(f.svc.exigir('org','u','a')).rejects.toThrow();
    f.amplo();expect(await f.svc.exigir('org','u','sem')).toMatchObject({id:'sem'});
  });
});
