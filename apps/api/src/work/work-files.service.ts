import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';

interface FileEntry { taskId: string; id: string; name: string; path: string; sha256: string; size: number }

/** Private migrated files: a native task and the manifest must both belong to the caller's org. */
@Injectable()
export class WorkFilesService {
  constructor(private readonly prisma: PrismaService) {}

  async read(orgId: string, taskId: string, fileId: string) {
    if (![taskId, fileId].every((v) => /^[a-zA-Z0-9._-]+$/.test(v))) throw new NotFoundException();
    const task = await this.prisma.workTask.findFirst({ where: { orgId, externalId: taskId }, select: { id: true } });
    if (!task) throw new NotFoundException();
    try {
      const root = await realpath(process.env.WORK_FILES_ROOT || '/vault/90-OS/migrations/marketing-20260929');
      const index = JSON.parse(await readFile(resolve(root, 'attachments-index.json'), 'utf8')) as { orgId: string; files: FileEntry[] };
      if (index.orgId !== orgId || !Array.isArray(index.files)) throw new Error('manifest');
      const file = index.files.find((f) => f.taskId === taskId && f.id === fileId);
      if (!file || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size > 50 * 1024 * 1024) throw new Error('entry');
      const path = resolve(root, file.path);
      const actual = await realpath(path);
      const rel = relative(root, actual);
      if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('path');
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.size) throw new Error('size');
      const bytes = await readFile(path);
      if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('hash');
      return { bytes, name: file.name.replace(/[\r\n\\/]/g, '_') };
    } catch {
      throw new NotFoundException('Arquivo indisponível. A cópia preservada precisa ser conferida.');
    }
  }
}
