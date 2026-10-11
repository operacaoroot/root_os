import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  TotemGestaoLoja,
  TotemGestaoLojaCriar,
  TotemGestaoLojaEditar,
  TotemGestaoUsuario,
} from '@mktos/shared';

import { escopoDeLojas, exigirLojaNoEscopo, type UsuarioDoEscopo } from '../comum/escopo';
import { totemNaoEncontrado } from '../comum/modulo';
import { totemGestaoEhDuplicado } from './regras';

/*
 * Lojas e vínculos de usuário com loja. A lista respeita o escopo; criar,
 * editar e vincular exigem `totem.lojas` no controller e, para loja que já
 * existe, que ela esteja no escopo de quem pede.
 */

export type ClienteDasLojas = Pick<
  Prisma.TransactionClient,
  'totemLoja' | 'totemUsuarioLoja' | 'totemDispositivo' | 'user'
>;

const CAMPOS_DA_LOJA = {
  id: true,
  codigo: true,
  nome: true,
  cidade: true,
  endereco: true,
  ativa: true,
  exemplo: true,
  criadoEm: true,
} as const;

type LojaDoBanco = Prisma.TotemLojaGetPayload<{ select: typeof CAMPOS_DA_LOJA }>;

function lojaParaTela(l: LojaDoBanco, totens: number): TotemGestaoLoja {
  return {
    id: l.id,
    codigo: l.codigo,
    nome: l.nome,
    cidade: l.cidade,
    endereco: l.endereco,
    ativa: l.ativa,
    exemplo: l.exemplo,
    totens,
    criadoEm: l.criadoEm.toISOString(),
  };
}

async function totensPorLoja(tx: ClienteDasLojas, orgId: string, lojaIds: string[]): Promise<Map<string, number>> {
  if (lojaIds.length === 0) return new Map();
  const linhas = await tx.totemDispositivo.groupBy({
    by: ['lojaId'],
    where: { orgId, lojaId: { in: lojaIds }, revogadoEm: null },
    _count: { _all: true },
  });
  return new Map(linhas.map((l) => [l.lojaId, l._count._all]));
}

function conflitoDeCodigo(e: unknown, codigo: string | undefined): unknown {
  return totemGestaoEhDuplicado(e) ? new ConflictException(`Já existe uma loja com o código ${codigo ?? ''}.`.trim()) : e;
}

export async function totemGestaoListarLojas(
  tx: ClienteDasLojas,
  user: UsuarioDoEscopo,
  situacao: 'ativas' | 'todas',
): Promise<TotemGestaoLoja[]> {
  const escopo = await escopoDeLojas(tx, user);
  const lojas = await tx.totemLoja.findMany({
    where: {
      orgId: user.orgId,
      ...(escopo === 'todas' ? {} : { id: { in: escopo } }),
      ...(situacao === 'ativas' ? { ativa: true } : {}),
    },
    select: CAMPOS_DA_LOJA,
    orderBy: [{ ativa: 'desc' }, { nome: 'asc' }],
  });
  const totens = await totensPorLoja(
    tx,
    user.orgId,
    lojas.map((l) => l.id),
  );
  return lojas.map((l) => lojaParaTela(l, totens.get(l.id) ?? 0));
}

/**
 * Quem cria loja sem enxergar a rede inteira fica vinculado a ela; senão a loja
 * nasceria fora do escopo de quem acabou de criá-la.
 */
export async function totemGestaoCriarLoja(
  tx: ClienteDasLojas,
  user: UsuarioDoEscopo,
  dados: TotemGestaoLojaCriar,
): Promise<TotemGestaoLoja> {
  const escopo = await escopoDeLojas(tx, user);
  let loja: LojaDoBanco;
  try {
    loja = await tx.totemLoja.create({
      data: {
        orgId: user.orgId,
        codigo: dados.codigo,
        nome: dados.nome,
        cidade: dados.cidade ?? null,
        endereco: dados.endereco ?? null,
      },
      select: CAMPOS_DA_LOJA,
    });
  } catch (e) {
    throw conflitoDeCodigo(e, dados.codigo);
  }
  if (escopo !== 'todas') {
    await tx.totemUsuarioLoja.create({ data: { orgId: user.orgId, userId: user.sub, lojaId: loja.id } });
  }
  return lojaParaTela(loja, 0);
}

export async function totemGestaoEditarLoja(
  tx: ClienteDasLojas,
  user: UsuarioDoEscopo,
  lojaId: string,
  dados: TotemGestaoLojaEditar,
): Promise<TotemGestaoLoja> {
  await exigirLojaNoEscopo(tx, user, lojaId);
  let loja: LojaDoBanco;
  try {
    loja = await tx.totemLoja.update({
      where: { id: lojaId, orgId: user.orgId },
      data: {
        codigo: dados.codigo,
        nome: dados.nome,
        cidade: dados.cidade,
        endereco: dados.endereco,
        ativa: dados.ativa,
      },
      select: CAMPOS_DA_LOJA,
    });
  } catch (e) {
    throw conflitoDeCodigo(e, dados.codigo);
  }
  const totens = await totensPorLoja(tx, user.orgId, [loja.id]);
  return lojaParaTela(loja, totens.get(loja.id) ?? 0);
}

// --- Usuários e vínculos ---

const CAMPOS_DO_USUARIO = {
  id: true,
  name: true,
  email: true,
  isActive: true,
  roles: { select: { key: true, name: true, permissions: { select: { key: true } } } },
  totemLojas: { select: { lojaId: true } },
} as const;

type UsuarioDoBanco = Prisma.UserGetPayload<{ select: typeof CAMPOS_DO_USUARIO }>;

/** Vínculos fora do escopo de quem olha não aparecem: seria revelar a loja. */
function usuarioParaTela(u: UsuarioDoBanco, escopo: 'todas' | string[]): TotemGestaoUsuario {
  const permissoes = new Set(u.roles.flatMap((r) => r.permissions.map((p) => p.key)));
  const lojaIds = [...new Set(u.totemLojas.map((v) => v.lojaId))].filter(
    (id) => escopo === 'todas' || escopo.includes(id),
  );
  return {
    id: u.id,
    nome: u.name,
    email: u.email,
    ativo: u.isActive,
    papeis: u.roles.map((r) => ({ chave: r.key, nome: r.name })),
    acessoAoTotem: [...permissoes].some((p) => p.startsWith('totem.')),
    redeInteira: permissoes.has('totem.rede'),
    lojaIds,
  };
}

export async function totemGestaoListarUsuarios(
  tx: ClienteDasLojas,
  user: UsuarioDoEscopo,
): Promise<TotemGestaoUsuario[]> {
  const escopo = await escopoDeLojas(tx, user);
  const usuarios = await tx.user.findMany({
    where: { orgId: user.orgId },
    select: CAMPOS_DO_USUARIO,
    orderBy: { name: 'asc' },
  });
  return usuarios.map((u) => usuarioParaTela(u, escopo));
}

async function usuarioDaEmpresa(tx: ClienteDasLojas, orgId: string, userId: string): Promise<UsuarioDoBanco> {
  const alvo = await tx.user.findFirst({ where: { id: userId, orgId }, select: CAMPOS_DO_USUARIO });
  if (!alvo) throw totemNaoEncontrado();
  return alvo;
}

export async function totemGestaoVincularLoja(
  tx: ClienteDasLojas,
  user: UsuarioDoEscopo,
  userId: string,
  lojaId: string,
): Promise<TotemGestaoUsuario> {
  await exigirLojaNoEscopo(tx, user, lojaId);
  await usuarioDaEmpresa(tx, user.orgId, userId);
  try {
    await tx.totemUsuarioLoja.create({ data: { orgId: user.orgId, userId, lojaId } });
  } catch (e) {
    // Vincular duas vezes não é erro: o vínculo pedido já existe.
    if (!totemGestaoEhDuplicado(e)) throw e;
  }
  return usuarioParaTela(await usuarioDaEmpresa(tx, user.orgId, userId), await escopoDeLojas(tx, user));
}

export async function totemGestaoDesvincularLoja(
  tx: ClienteDasLojas,
  user: UsuarioDoEscopo,
  userId: string,
  lojaId: string,
): Promise<TotemGestaoUsuario> {
  await exigirLojaNoEscopo(tx, user, lojaId);
  await usuarioDaEmpresa(tx, user.orgId, userId);
  await tx.totemUsuarioLoja.deleteMany({ where: { orgId: user.orgId, userId, lojaId } });
  return usuarioParaTela(await usuarioDaEmpresa(tx, user.orgId, userId), await escopoDeLojas(tx, user));
}
