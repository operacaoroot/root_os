import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { CofreDaEmpresaService } from '../src/cofre-da-empresa/cofre-da-empresa.service';
import { CofreDepositoService } from '../src/cofre-da-empresa/deposito.service';

const org = '11111111-1111-4111-8111-111111111111';
const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const scope = {
  filtro: vi.fn(async (_o: string, _u: string, id?: string) => {
    if (id && id !== a) throw new Error('sem acesso');
    return { orgId: org, clienteId: id || { in: [a] } };
  }),
  exigirCliente: vi.fn(async (_o: string, _u: string, id: string | null) => {
    if (id !== a) throw new Error('sem acesso');
    return { id: a, nomeFantasia: 'Cliente A', razaoSocial: 'Cliente A' };
  }),
  exigirAmplo: vi.fn(async () => { throw new Error('sem acesso'); }),
};
const casa = (row: any, where: any) => Object.entries(where).every(([k, v]: any) => k === 'AND' ? v.every((w: any) => casa(row, w)) : v && typeof v === 'object' && 'in' in v ? v.in.includes(row[k]) : row[k] === v);
function fixture() {
  const itens = [a, b, null].map((clienteId, n) => ({ id: `item${n}`, orgId: org, clienteId, tipo: 'senha', titulo: 'teste', updatedAt: new Date(), arquivoChave: 'chave' }));
  const links = [a, b, null].map((clienteId, n) => ({ id: `link${n}`, orgId: org, clienteId, revogadoEm: null }));
  const db: any = {
    cofreSessao: { findUnique: async () => ({ id: 's', orgId: org, userId: 'u', expiraEm: new Date(Date.now()+60000) }), update: async () => ({}) },
    cofreItem: { findMany: async ({where}: any) => itens.filter(x => casa(x, where)), findFirst: async ({where}: any) => itens.find(x => casa(x, where)), update: vi.fn(), delete: vi.fn(), create: vi.fn() },
    cofreDeposito: { findMany: async ({where}: any) => links.filter(x => casa(x, where)), updateMany: async ({where,data}: any) => { const found = links.filter(x => casa(x,where)); found.forEach(x => Object.assign(x,data)); return {count:found.length}; } },
    $transaction: async (fn: any) => fn(db),
  };
  const storage = { put: vi.fn(async (..._args: any[]) => {}), get: vi.fn(), remover: vi.fn(async (..._args: any[]) => {}) };
  return { itens, links, db, storage, cofre: new (CofreDaEmpresaService as any)(db, {log: vi.fn()}, storage, scope), deposito: new (CofreDepositoService as any)(db, {log: vi.fn()}, scope) };
}
describe('isolamento por cliente no cofre', () => {
  it('lista apenas A e não revela, altera, apaga ou acessa arquivos de B', async () => {
    const f = fixture();
    expect((await f.cofre.listar(org, 'u', 'token')).map((x: any) => x.id)).toEqual(['item0']);
    await expect(f.cofre.revelar(org, 'u', 'token', 'item1')).rejects.toThrow();
    await expect(f.cofre.alterar(org, 'u', 'token', 'item1', {titulo:'novo'})).rejects.toThrow();
    await expect(f.cofre.apagar(org, 'u', 'token', 'item1')).rejects.toThrow();
    await expect(f.cofre.guardarArquivo(org, 'u', 'token', 'item1', {nome:'x',tipo:'x',tamanhoDeclarado:1,corpo:Readable.from(['x'])})).rejects.toThrow();
    await expect(f.cofre.abrirArquivo(org, 'u', 'token', 'item1')).rejects.toThrow();
    expect(f.storage.put).not.toHaveBeenCalled(); expect(f.storage.get).not.toHaveBeenCalled();
  });
  it('impede criação em B e gestão de senhas por usuário restrito', async () => {
    const f = fixture();
    await expect(f.cofre.criar(org, 'u', 'token', {clienteId:b,tipo:'senha',titulo:'x'})).rejects.toThrow();
    await expect(f.cofre.pessoas(org, 'u', 'token')).rejects.toThrow();
    await expect(f.cofre.zerarSenhaDeOutro(org, 'u', 'token', 'outra')).rejects.toThrow();
    expect(f.db.cofreItem.create).not.toHaveBeenCalled();
  });
  it('mantém o cliente observado e o filtro autorizado no update e delete finais', async () => {
    const f = fixture();
    await f.cofre.alterar(org, 'u', 'token', 'item0', {titulo: 'novo'});
    await f.cofre.apagar(org, 'u', 'token', 'item0');
    for (const op of [f.db.cofreItem.update, f.db.cofreItem.delete]) {
      expect(op.mock.calls[0][0].where).toMatchObject({id:'item0', orgId:org, clienteId:{in:[a]}, AND:[{clienteId:a}]});
    }
  });
  it('remove objeto recém-gravado se escrita final perder a corrida', async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    const f = fixture();
    f.db.cofreItem.update.mockRejectedValueOnce(new Error('item mudou'));
    await expect(f.cofre.guardarArquivo(org, 'u', 'token', 'item0', {nome:'x',tipo:'x',tamanhoDeclarado:1,corpo:Readable.from([Buffer.from('x')])})).rejects.toThrow('item mudou');
    expect(f.storage.remover).toHaveBeenCalledWith(f.storage.put.mock.calls[0][0]);
    expect(f.storage.remover).not.toHaveBeenCalledWith('chave');
    expect(f.db.cofreItem.update.mock.calls[0][0].where).toMatchObject({id:'item0', orgId:org, clienteId:{in:[a]}, AND:[{clienteId:a}]});
  });
  it('não entrega download se item mudar de cliente durante a leitura', async () => {
    const f = fixture();
    async function* corpo() { f.itens[0].clienteId = b; yield Buffer.from('x'); }
    f.storage.get.mockResolvedValueOnce({stream: Readable.from(corpo())} as never);
    await expect(f.cofre.abrirArquivo(org, 'u', 'token', 'item0')).rejects.toThrow();
  });
  it('interrompe upload se item mudar de cliente durante a leitura', async () => {
    const f = fixture();
    async function* corpo() { f.itens[0].clienteId = b; yield Buffer.from('x'); }
    await expect(f.cofre.guardarArquivo(org, 'u', 'token', 'item0', {nome:'x',tipo:'x',tamanhoDeclarado:1,corpo:Readable.from(corpo())})).rejects.toThrow();
    expect(f.storage.put).not.toHaveBeenCalled();
    expect(f.db.cofreItem.update).not.toHaveBeenCalled();
  });
  it('não permite transferir item acessível para B ou classificar legado', async () => {
    const f = fixture();
    await expect(f.cofre.alterar(org, 'u', 'token', 'item0', {clienteId:b})).rejects.toThrow();
    await expect(f.cofre.alterar(org, 'u', 'token', 'item2', {clienteId:a})).rejects.toThrow();
    expect(f.db.cofreItem.update).not.toHaveBeenCalled();
  });
  it('lista e revoga somente depósitos acessíveis', async () => {
    const f = fixture();
    expect((await f.deposito.listar(org, 'u')).map((x: any) => x.id)).toEqual(['link0']);
    await f.deposito.revogar(org, 'u', 'link1');
    expect(f.links[1].revogadoEm).toBeNull();
    await f.deposito.revogar(org, 'u', 'link0');
    expect(f.links[0].revogadoEm).toBeInstanceOf(Date);
  });
});
