import {
  CADASTRO_DE_FUNCOES,
  pessoaDoDonoPadrao,
  pessoasDaEquipe,
  type ContaParaEquipe,
  type DonoDaFuncao,
  type DonoNaTela,
  type FuncaoDoCadastro,
  type ResultadoDaEquipe,
} from '@mktos/shared';

import type { PrismaService } from '../prisma/prisma.service';
import { donosDaCasa } from './donos-da-casa';

/*
 * O DONO EFETIVO DE CADA FUNÇÃO (rodada dos agentes, 21/10/2026, A7)
 *
 * Um lugar só, lido pela Equipe (`/organograma`) e pelo catálogo (`/agentes`),
 * para as duas telas nunca dizerem donos diferentes para a mesma função.
 *
 * A ORDEM: o BANCO vale por cima do PADRÃO do cadastro.
 *  · função com registro `Agent` (mesmo slug): o banco é `Agent.donoId`, que o
 *    laço do agente lê para o prompt;
 *  · função sem registro: o banco é `DonoDaFuncao` (tabela da Equipe);
 *  · o padrão é o `dono` do cadastro (`rodrigo` | `lucas` | `pedro`), casado
 *    com a pessoa da equipe pelo PRIMEIRO NOME (`pessoaDoDonoPadrao`).
 *
 * O PONTEIRO DO BANCO SÓ VALE SE FOR PESSOA DA EQUIPE. O `Agent.donoId` das
 * sementes antigas aponta muitas vezes para a conta do admin da instalação, que
 * não é gente da equipe: nesse caso vale o padrão, e a tela diz que havia um
 * ponteiro fora da equipe (`bancoForaDaEquipe`), em vez de mostrar como dono uma
 * conta que a própria Equipe esconde.
 *
 * O NOME NUNCA VEM DE RELAÇÃO DO PRISMA (`include: { dono }`): o `Agent.donoId`
 * passa por `donosDaCasa`, que só resolve gente desta empresa, e depois pela
 * regra da Equipe. A `DonoDaFuncao` já tem a FK composta com a empresa.
 */

export interface AgenteParaDono {
  slug: string;
  donoId: string | null;
}

export interface ContextoDaEquipe {
  org: { nome: string; slug: string };
  contas: ContaParaEquipe[];
  equipe: ResultadoDaEquipe;
  /** `funcaoId` → `userId` (ou `null`, voltou ao padrão). */
  trocas: Map<string, string | null>;
}

/** Lê as contas da empresa, a regra da Equipe e as trocas guardadas. */
export async function carregarEquipe(prisma: PrismaService, orgId: string): Promise<ContextoDaEquipe> {
  const [org, usuarios, trocas] = await Promise.all([
    prisma.org.findUnique({ where: { id: orgId }, select: { name: true, slug: true } }),
    prisma.user.findMany({
      where: { orgId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true, isActive: true, lastLoginAt: true, roles: { select: { key: true } } },
    }),
    prisma.donoDaFuncao.findMany({ where: { orgId }, select: { funcaoId: true, userId: true } }),
  ]);
  const contas: ContaParaEquipe[] = usuarios.map((u) => ({
    id: u.id,
    nome: u.name,
    email: u.email,
    ativo: u.isActive,
    papeis: u.roles.map((r) => r.key),
    ultimoAcesso: u.lastLoginAt?.toISOString() ?? null,
  }));
  const empresa = { nome: org?.name ?? '', slug: org?.slug ?? '' };
  return {
    org: empresa,
    contas,
    equipe: pessoasDaEquipe(contas, empresa),
    trocas: new Map(trocas.map((t) => [t.funcaoId, t.userId])),
  };
}

/** Os `Agent.donoId` desta empresa que são gente DESTA empresa (via `donosDaCasa`). */
export async function donosDosAgentes(
  prisma: PrismaService,
  orgId: string,
  agentes: readonly AgenteParaDono[],
): Promise<Map<string, string | null>> {
  const daCasa = await donosDaCasa(prisma, orgId, agentes.map((a) => a.donoId));
  return new Map(agentes.map((a) => [a.slug, a.donoId ? (daCasa.has(a.donoId) ? a.donoId : `fora:${a.donoId}`) : null]));
}

/**
 * O dono efetivo. `noBanco`: o id guardado (ou `fora:<id>` quando `donosDaCasa`
 * não o reconheceu como gente desta empresa), `null`/ausente sem ponteiro.
 */
export function donoEfetivo(
  padrao: DonoDaFuncao | null,
  noBanco: string | null | undefined,
  ctx: Pick<ContextoDaEquipe, 'equipe'>,
): DonoNaTela {
  const pessoas = ctx.equipe.pessoas;
  let bancoForaDaEquipe = false;
  if (noBanco) {
    const id = noBanco.startsWith('fora:') ? null : ctx.equipe.canonica.get(noBanco);
    const pessoa = id ? pessoas.find((p) => p.id === id) : undefined;
    if (pessoa) {
      return { efetivo: { id: pessoa.id, nome: pessoa.nome }, origem: 'banco', padrao, bancoForaDaEquipe: false };
    }
    bancoForaDaEquipe = true;
  }
  const doPadrao = padrao ? pessoaDoDonoPadrao(padrao, pessoas) : null;
  return {
    efetivo: doPadrao ? { id: doPadrao.id, nome: doPadrao.nome } : null,
    origem: doPadrao ? 'padrao' : null,
    padrao,
    bancoForaDaEquipe,
  };
}

/** O dono de uma função do cadastro, dado o que há no banco. */
export function donoDaFuncao(
  f: FuncaoDoCadastro,
  agentes: Map<string, string | null>,
  ctx: ContextoDaEquipe,
): { dono: DonoNaTela; guardadoEm: 'agente' | 'equipe' } {
  if (agentes.has(f.slug)) return { dono: donoEfetivo(f.dono, agentes.get(f.slug), ctx), guardadoEm: 'agente' };
  return { dono: donoEfetivo(f.dono, ctx.trocas.get(f.id), ctx), guardadoEm: 'equipe' };
}

/** As linhas do cadastro, para quem precisa da lista inteira. */
export const FUNCOES = CADASTRO_DE_FUNCOES;
