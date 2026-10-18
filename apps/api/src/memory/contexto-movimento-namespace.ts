import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { contextoAtual } from '../common/contexto-execucao';
import { exigirAcessoAtual } from './acesso-memoria';

type Leitura = Pick<Prisma.TransactionClient, '$queryRawUnsafe'>;
export class MovimentoPendenteError extends ConflictException {
  constructor() { super({ code: 'contexto_movimento_pendente', message: 'Existe um movimento de fonte pendente nesta coleção.' }); }
}
export async function consultaMovimentoPendente(db: Leitura, orgId: string, itemId: string): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<Array<{ pendente: boolean }>>(`SELECT EXISTS (
    SELECT 1 FROM "ContextMovementIntent" i JOIN "ContextItem" c ON c."orgId"=i."orgId" AND c.id=$2
    WHERE i."orgId"=$1 AND i.estado='pendente' AND (i."itemId"=c.id OR
      (i."collectionId"='vault:root-base' AND (c."sourceType"::text='vault' OR c.chave LIKE 'vault:%')))
  ) AS pendente`, orgId, itemId);
  if (rows.length !== 1 || typeof rows[0].pendente !== 'boolean') throw new ConflictException('A pendência da fonte não pôde ser conferida.');
  return rows[0].pendente;
}
export async function exigirNovoUsoSemMovimentoPendente(db: Leitura, orgId: string, itemId: string): Promise<void> {
  if (await consultaMovimentoPendente(db, orgId, itemId)) throw new MovimentoPendenteError();
}
export async function colecaoComMovimentoPendente(db: Leitura, orgId: string): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<Array<{ pendente: boolean }>>(`SELECT EXISTS (
    SELECT 1 FROM "ContextMovementIntent" WHERE "orgId"=$1 AND "collectionId"='vault:root-base' AND estado='pendente'
  ) AS pendente`, orgId);
  if (rows.length !== 1 || typeof rows[0].pendente !== 'boolean') throw new ConflictException('A pendência da coleção não pôde ser conferida.');
  return rows[0].pendente;
}
export async function exigirColecaoSemMovimentoPendente(db: Leitura, orgId: string): Promise<void> {
  if (await colecaoComMovimentoPendente(db, orgId)) throw new MovimentoPendenteError();
}
export async function travarAutoridadeDoMovimento(tx: Prisma.TransactionClient, orgId: string, actorId: string, escrita: boolean): Promise<Set<string>> {
  const ctx = contextoAtual();
  if (!ctx || ctx.actorType !== 'user' || ctx.orgId !== orgId || ctx.actorId !== actorId) throw new ForbiddenException('Acesso insuficiente.');
  const orgs = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Org" WHERE id=${orgId} AND "isActive" FOR SHARE`;
  const pessoas = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "User" WHERE id=${actorId} AND "orgId"=${orgId} AND "isActive" ORDER BY id FOR SHARE`;
  if (orgs.length !== 1 || pessoas.length !== 1) throw new ForbiddenException('Acesso insuficiente.');
  const vinculos = await tx.$queryRaw<Array<{ roleId: string }>>`SELECT ur."A" AS "roleId" FROM "_UserRoles" ur JOIN "Role" r ON r.id=ur."A"
    WHERE ur."B"=${actorId} AND r."orgId"=${orgId} ORDER BY ur."A",ur."B" FOR SHARE OF ur`;
  const roleIds = [...new Set(vinculos.map((v) => v.roleId))].sort();
  if (!roleIds.length) throw new ForbiddenException('Acesso insuficiente.');
  const roles = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Role" WHERE "orgId"=${orgId} AND id IN (${Prisma.join(roleIds)}) ORDER BY id FOR SHARE`;
  if (roles.length !== roleIds.length) throw new ForbiddenException('Acesso insuficiente.');
  const concessoes = await tx.$queryRaw<Array<{ permissionId: string }>>`SELECT rp."A" AS "permissionId" FROM "_RolePermissions" rp
    WHERE rp."B" IN (${Prisma.join(roleIds)}) ORDER BY rp."B",rp."A" FOR SHARE OF rp`;
  const permissionIds = [...new Set(concessoes.map((c) => c.permissionId))].sort();
  if (!permissionIds.length) throw new ForbiddenException('Acesso insuficiente.');
  const permissoes = await tx.$queryRaw<Array<{ id: string; key: string }>>`SELECT id,key FROM "Permission" WHERE id IN (${Prisma.join(permissionIds)}) ORDER BY id FOR SHARE`;
  const keys = new Set(permissoes.map((p) => p.key));
  const exigidas = escrita ? ['obsidian.ver', 'obsidian.editar'] : ['obsidian.ver'];
  if (permissoes.length !== permissionIds.length || !exigidas.every((p) => keys.has(p))) throw new ForbiddenException('Acesso insuficiente.');
  await exigirAcessoAtual(tx, orgId, actorId, exigidas);
  return keys;
}
