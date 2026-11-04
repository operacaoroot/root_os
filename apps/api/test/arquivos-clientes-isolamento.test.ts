import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { AnexosDaTarefaService } from '../src/work/anexos/anexos.service';
import { WorkFilesService } from '../src/work/work-files.service';

function fixture() {
  let permitido = true;
  const tarefa = { id: 'tarefa-a', clienteId: 'cliente-a', cliente: { interno: false } };
  const conferir = vi.fn(async (_o: string, _u: string, id: string) => {
    if (!permitido || id !== tarefa.id) throw new Error('Tarefa não encontrada.');
    return { ...tarefa };
  });
  const anexo = { id: 'anexo', orgId: 'org', taskId: tarefa.id, chave: 'chave', nome: 'a.pdf', bytes: 3, tipoMime: 'application/pdf', criadoEm: new Date() };
  const db = {
    workTask: { findFirst: vi.fn(async () => tarefa) },
    workAnexo: { findMany: vi.fn(async () => [anexo]), findFirst: vi.fn(async () => anexo) },
    arquivoDoCliente: { findMany: vi.fn(async () => []) },
  };
  const svc = new AnexosDaTarefaService(db as any, {} as any, {} as any, undefined, { exigir: conferir } as any);
  const stream = Readable.from(Buffer.from('pdf'));
  const get = vi.fn(async () => ({ stream, size: 3 }));
  svc.usarArmazem({ get, put: vi.fn() });
  return { svc, conferir, tarefa, db, stream, get, revogar: () => { permitido = false; } };
}

describe('arquivos por carteira de clientes', () => {
  it('não lê metadados nem storage de tarefa fora da carteira', async () => {
    const f = fixture();
    await expect(f.svc.listarAutorizado('org', 'pessoa', 'tarefa-b')).rejects.toThrow('não encontrada');
    await expect(f.svc.baixarAutorizado('org', 'pessoa', 'tarefa-b', 'anexo')).rejects.toThrow('não encontrada');
    expect(f.db.workAnexo.findMany).not.toHaveBeenCalled();
    expect(f.get).not.toHaveBeenCalled();
  });
  it('lista somente cópias do mesmo cliente da tarefa', async () => {
    const f = fixture();
    expect(await f.svc.listarAutorizado('org', 'pessoa', 'tarefa-a')).toHaveLength(1);
    expect(f.db.arquivoDoCliente.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ partnerId: 'cliente-a' }) }));
    expect(f.conferir).toHaveBeenCalledTimes(2);
  });
  it('revogação durante abertura do arquivo encerra stream e impede entrega', async () => {
    const f = fixture();
    f.get.mockImplementationOnce(async () => { f.revogar(); return { stream: f.stream, size: 3 }; });
    await expect(f.svc.baixarAutorizado('org', 'pessoa', 'tarefa-a', 'anexo')).rejects.toThrow('não encontrada');
    expect(f.stream.destroyed).toBe(true);
  });
  it('mudança de cliente durante download impede entrega mesmo com carteira A+B', async () => {
    const f = fixture();
    f.get.mockImplementationOnce(async () => { f.tarefa.clienteId = 'cliente-b'; return { stream: f.stream, size: 3 }; });
    await expect(f.svc.baixarAutorizado('org', 'pessoa', 'tarefa-a', 'anexo')).rejects.toThrow();
    expect(f.stream.destroyed).toBe(true);
  });
  it('download autorizado conserva bytes e nome', async () => {
    const f = fixture();
    expect(await f.svc.baixarAutorizado('org', 'pessoa', 'tarefa-a', 'anexo')).toMatchObject({ nome: 'a.pdf', bytes: 3, stream: f.stream });
  });
  it('arquivo migrado conhecido não chega ao filesystem sem carteira', async () => {
    const exigir = vi.fn(async () => { throw new Error('Tarefa não encontrada.'); });
    const svc = new WorkFilesService({ workTask: { findFirst: vi.fn(async () => ({ id: 'tarefa-b' })) } } as any, { exigir } as any);
    const leitura = vi.spyOn(svc, 'read');
    await expect(svc.readAutorizado('org', 'pessoa', 'id-clickup', 'arquivo')).rejects.toThrow('não encontrada');
    expect(leitura).not.toHaveBeenCalled();
  });
});
