import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkFilesService } from '../src/work/work-files.service';
import type { PrismaService } from '../src/prisma/prisma.service';

const dirs: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'work-files-')); dirs.push(root);
  vi.stubEnv('WORK_FILES_ROOT', root);
  const bytes = Buffer.from('pacote aprovado v1');
  await mkdir(join(root, 'files'));
  await writeFile(join(root, 'files', 'material.html'), bytes);
  const entry = { taskId: 'root-001', id: 'material.html', name: 'Ficha de gravação.html', path: 'files/material.html', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  await writeFile(join(root, 'attachments-index.json'), JSON.stringify({ orgId: 'root', files: [entry] }));
  const findFirst = vi.fn(async ({ where }: { where: { orgId: string } }) => where.orgId === 'root' ? { id: 'native' } : null);
  return { root, bytes, entry, service: new WorkFilesService({ workTask: { findFirst } } as unknown as PrismaService), findFirst };
}
describe('anexos privados do trabalho', () => {
  it('entrega os bytes conferidos somente para a tarefa da organização', async () => {
    const f = await fixture();
    expect((await f.service.read('root', 'root-001', 'material.html')).bytes).toEqual(f.bytes);
    expect(f.findFirst).toHaveBeenCalledWith({ where: { orgId: 'root', externalId: 'root-001' }, select: { id: true } });
    await expect(f.service.read('outra', 'root-001', 'material.html')).rejects.toThrow();
    await expect(f.service.read('root', 'root-001', 'inexistente')).rejects.toThrow();
  });
  it('recusa arquivo adulterado mesmo com tamanho igual', async () => {
    const f = await fixture(); await writeFile(join(f.root, 'files/material.html'), Buffer.alloc(f.bytes.length));
    await expect(f.service.read('root', 'root-001', 'material.html')).rejects.toThrow();
  });
  it('recusa travessia de diretório e manifesto de outra empresa', async () => {
    const f = await fixture();
    await expect(f.service.read('root', '../root-001', 'material.html')).rejects.toThrow();
    await writeFile(join(f.root, 'attachments-index.json'), JSON.stringify({ orgId: 'outra', files: [f.entry] }));
    await expect(f.service.read('root', 'root-001', 'material.html')).rejects.toThrow();
    await writeFile(join(f.root, 'attachments-index.json'), JSON.stringify({ orgId: 'root', files: [{ ...f.entry, path: '../outside.html' }] }));
    await expect(f.service.read('root', 'root-001', 'material.html')).rejects.toThrow();
  });
});
