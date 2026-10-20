import { BadRequestException } from '@nestjs/common';

export interface WorkTaskQuery {
  listId?: string;
  listIds?: string[];
  listExternalIds?: string[];
  statusId?: string;
  assignee?: string;
  assigneeUserId?: string;
  semResponsavel?: boolean;
  tagId?: string;
  q?: string;
  opcao?: string;
  /** T4: o id do cliente, ou `sem` para as tarefas antigas sem cliente. */
  cliente?: string;
  arquivadas?: boolean;
  /** "Todas as tarefas" (versão final): só tarefas de verdade, de todas as listas, sem card repetido. */
  todas?: boolean;
  /**
   * O SEGMENTO de "Todas as tarefas" (rodada da interface U3, 20/10/2026): o id de
   * uma pasta (as subpastas entram junto) ou `sem-pasta` para as listas soltas.
   * Só vale com `todas=1`; pasta de outra empresa ou que não existe não traz nada.
   */
  segmentoId?: string;
  dueFrom?: Date;
  dueTo?: Date;
  page?: number;
  limit?: number;
}

function texto(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new BadRequestException(`${key} deve ser texto único`);
  return value;
}

function ids(raw: Record<string, unknown>, key: string): string[] | undefined {
  const value = texto(raw, key);
  if (value === undefined) return undefined;
  const parts = value.split(',').map((part) => part.trim());
  if (parts.length > 50 || parts.some((part) => !/^[\w-]{1,80}$/.test(part))) {
    throw new BadRequestException(`${key} deve conter de 1 a 50 IDs válidos`);
  }
  return [...new Set(parts)];
}

function inteiro(raw: Record<string, unknown>, key: string, fallback: number, max: number): number {
  const value = texto(raw, key);
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) throw new BadRequestException(`${key} deve ser inteiro positivo`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > max) throw new BadRequestException(`${key} excede o limite`);
  return number;
}

function instante(raw: Record<string, unknown>, key: string): Date | undefined {
  const value = texto(raw, key);
  if (value === undefined) return undefined;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) {
    throw new BadRequestException(`${key} exige data e hora ISO com fuso`);
  }
  const [, year, month, day, hour, minute, second] = parts.map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() + 1 !== month || calendar.getUTCDate() !== day ||
    hour > 23 || minute > 59 || second > 59) throw new BadRequestException(`${key} inválido`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${key} inválido`);
  return date;
}

function cliente(raw: Record<string, unknown>): string | undefined {
  const value = texto(raw, 'cliente');
  if (value === undefined || value === '') return undefined;
  if (value !== 'sem' && !/^[0-9a-f-]{36}$/i.test(value)) throw new BadRequestException('cliente deve ser um id ou "sem"');
  return value;
}

export const SEGMENTO_SEM_PASTA = 'sem-pasta';

function segmento(raw: Record<string, unknown>, todas: boolean): string | undefined {
  const value = texto(raw, 'segmentoId');
  if (value === undefined || value === '') return undefined;
  if (!todas) throw new BadRequestException('segmentoId só vale com todas=1');
  if (value !== SEGMENTO_SEM_PASTA && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestException('segmentoId deve ser o id de uma pasta ou "sem-pasta"');
  }
  return value;
}

/** A pasta e todas as que estão dentro dela, em qualquer nível. Pasta que não está na lista: vazio. */
export function pastaComSubpastas(pastas: readonly { id: string; parentId: string | null }[], raiz: string): Set<string> {
  if (!pastas.some((p) => p.id === raiz)) return new Set();
  const dentro = new Set([raiz]);
  for (let mudou = true; mudou;) {
    mudou = false;
    for (const p of pastas) {
      if (p.parentId && dentro.has(p.parentId) && !dentro.has(p.id)) { dentro.add(p.id); mudou = true; }
    }
  }
  return dentro;
}

export function parseWorkTaskQuery(raw: Record<string, unknown>): WorkTaskQuery {
  const listId = texto(raw, 'listId');
  const listIds = ids(raw, 'listIds');
  const listExternalIds = ids(raw, 'listExternalIds');
  if ([listId, listIds, listExternalIds].filter((value) => value !== undefined).length > 1) {
    throw new BadRequestException('Use somente um filtro de lista por consulta');
  }
  const assignee = texto(raw, 'assignee');
  const assigneeUserId = texto(raw, 'assigneeUserId');
  if (assigneeUserId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assigneeUserId)) {
    throw new BadRequestException('assigneeUserId deve ser UUID');
  }
  const semResponsavelRaw = texto(raw, 'semResponsavel');
  if (semResponsavelRaw !== undefined && semResponsavelRaw !== '1') {
    throw new BadRequestException('semResponsavel deve ser 1');
  }
  const semResponsavel = semResponsavelRaw === '1';
  if ([assignee, assigneeUserId, semResponsavel ? true : undefined].filter((v) => v !== undefined).length > 1) {
    throw new BadRequestException('Use somente um filtro de responsável por consulta');
  }
  const dueFrom = instante(raw, 'dueFrom');
  const dueTo = instante(raw, 'dueTo');
  if (dueFrom && dueTo && dueFrom >= dueTo) {
    throw new BadRequestException('dueTo deve ser posterior a dueFrom');
  }
  const page = inteiro(raw, 'page', 1, 100_000);
  const limit = inteiro(raw, 'limit', 500, 500);
  if ((page - 1) * limit > 10_000_000) throw new BadRequestException('Página fora do limite');
  return {
    listId, listIds, listExternalIds,
    statusId: texto(raw, 'statusId'), assignee, assigneeUserId, semResponsavel,
    tagId: texto(raw, 'tagId'), q: texto(raw, 'q'), opcao: texto(raw, 'opcao'), cliente: cliente(raw),
    arquivadas: raw.arquivadas === '1' || raw.arquivadas === 'true',
    todas: raw.todas === '1',
    segmentoId: segmento(raw, raw.todas === '1'),
    dueFrom, dueTo, page, limit,
  };
}
