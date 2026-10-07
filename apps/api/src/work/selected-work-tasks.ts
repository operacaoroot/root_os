import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { JwtUser } from '../auth/current-user.decorator';
import { parseWorkTaskQuery, type WorkTaskQuery } from './work-task-query';
import type { WorkService } from './work.service';

/** A seleção explícita não estabelece migração ou corte da origem. */
export function selectedWorkTasks(user: JwtUser, raw: Record<string, unknown>): WorkTaskQuery | undefined {
  if (!['listId', 'listIds', 'listExternalIds'].some((key) => raw[key] !== undefined)) return undefined;
  if (!user.permissions.includes('tarefas.ver')) throw new ForbiddenException('Permissão insuficiente');
  const query = parseWorkTaskQuery(raw);
  // Work ignora listId vazio; aqui isso ampliaria indevidamente a seleção explícita.
  if (query.listId !== undefined && !query.listId.trim()) throw new BadRequestException('listId não pode ser vazio');
  return query;
}

/** Percorre todas as páginas para o agregado, preservando os filtros de Trabalho. */
export async function selectedTaskSnapshot(work: WorkService, orgId: string, query: WorkTaskQuery) {
  const first = await work.tarefas(orgId, { ...query, page: 1, limit: 500 });
  const items = [...first.items];
  for (let page = 2; items.length < first.total; page++) {
    const next = await work.tarefas(orgId, { ...query, page, limit: 500 });
    if (!next.items.length || next.total !== first.total) throw new ConflictException('Tarefas alteradas durante a leitura; tente novamente');
    items.push(...next.items);
  }
  if (items.length !== first.total || new Set(items.map((t) => t.id)).size !== items.length) {
    throw new ConflictException('Tarefas alteradas durante a leitura; tente novamente');
  }
  return { ...first, items };
}
