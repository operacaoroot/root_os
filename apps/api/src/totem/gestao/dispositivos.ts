import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { TotemGestaoCodigoAtivacao, TotemGestaoDispositivo, TotemGestaoDispositivoCriar } from '@mktos/shared';

import { escopoDeLojas, exigirLojaNoEscopo, type UsuarioDoEscopo } from '../comum/escopo';
import { totemNaoEncontrado } from '../comum/modulo';
import {
  totemGestaoEhDuplicado,
  totemGestaoEstadoDoDispositivo,
  totemGestaoExpiracaoPendente,
  totemGestaoNovoCodigoDeAtivacao,
} from './regras';

/*
 * Os totens de cada loja. O código de ativação sai em claro só na resposta de
 * criar e de gerar código novo; o banco guarda o SHA-256 e nenhuma listagem
 * devolve hash. Revogar apaga os dois hashes: o token do aparelho deixa de
 * achar o dispositivo e a próxima sincronização recebe 401.
 */

export type ClienteDosDispositivos = Pick<
  Prisma.TransactionClient,
  'totemDispositivo' | 'totemLoja' | 'totemUsuarioLoja'
>;

const CAMPOS_DO_DISPOSITIVO = {
  id: true,
  lojaId: true,
  nome: true,
  codigoAtivacaoHash: true,
  ativacaoExpiraEm: true,
  ativadoEm: true,
  revogadoEm: true,
  vistoEm: true,
  versaoApp: true,
  catalogoVersao: true,
  criadoEm: true,
  loja: { select: { nome: true } },
} as const;

type DispositivoDoBanco = Prisma.TotemDispositivoGetPayload<{ select: typeof CAMPOS_DO_DISPOSITIVO }>;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function totemGestaoDispositivoParaTela(d: DispositivoDoBanco, agora: Date): TotemGestaoDispositivo {
  return {
    id: d.id,
    lojaId: d.lojaId,
    lojaNome: d.loja.nome,
    nome: d.nome,
    estado: totemGestaoEstadoDoDispositivo(d, agora),
    ativadoEm: iso(d.ativadoEm),
    vistoEm: iso(d.vistoEm),
    revogadoEm: iso(d.revogadoEm),
    ativacaoExpiraEm: iso(totemGestaoExpiracaoPendente(d, agora)),
    versaoApp: d.versaoApp,
    catalogoVersao: d.catalogoVersao,
    criadoEm: d.criadoEm.toISOString(),
  };
}

/** O dispositivo da empresa, numa loja do escopo; qualquer outro caso é 404. */
async function dispositivoNoEscopo(
  tx: ClienteDosDispositivos,
  user: UsuarioDoEscopo,
  id: string,
): Promise<DispositivoDoBanco> {
  const d = await tx.totemDispositivo.findFirst({ where: { id, orgId: user.orgId }, select: CAMPOS_DO_DISPOSITIVO });
  if (!d) throw totemNaoEncontrado();
  await exigirLojaNoEscopo(tx, user, d.lojaId);
  return d;
}

export async function totemGestaoListarDispositivos(
  tx: ClienteDosDispositivos,
  user: UsuarioDoEscopo,
  lojaId: string | undefined,
  agora: Date,
): Promise<TotemGestaoDispositivo[]> {
  let filtro: Prisma.TotemDispositivoWhereInput;
  if (lojaId) {
    await exigirLojaNoEscopo(tx, user, lojaId);
    filtro = { lojaId };
  } else {
    const escopo = await escopoDeLojas(tx, user);
    filtro = escopo === 'todas' ? {} : { lojaId: { in: escopo } };
  }
  const lista = await tx.totemDispositivo.findMany({
    where: { orgId: user.orgId, ...filtro },
    select: CAMPOS_DO_DISPOSITIVO,
    orderBy: [{ revogadoEm: { sort: 'desc', nulls: 'first' } }, { nome: 'asc' }],
  });
  return lista.map((d) => totemGestaoDispositivoParaTela(d, agora));
}

/** Colisão de hash em 32^8 códigos é improvável, mas o índice é único: tenta de novo. */
const TENTATIVAS_DE_CODIGO = 3;

async function comCodigoNovo<T>(
  agora: Date,
  gravar: (hash: string, expiraEm: Date) => Promise<T>,
): Promise<{ resultado: T; codigo: string; expiraEm: Date }> {
  for (let tentativa = 1; ; tentativa += 1) {
    const novo = totemGestaoNovoCodigoDeAtivacao(agora);
    try {
      return { resultado: await gravar(novo.hash, novo.expiraEm), codigo: novo.codigo, expiraEm: novo.expiraEm };
    } catch (e) {
      if (!totemGestaoEhDuplicado(e) || tentativa >= TENTATIVAS_DE_CODIGO) throw e;
    }
  }
}

export async function totemGestaoCriarDispositivo(
  tx: ClienteDosDispositivos,
  user: UsuarioDoEscopo,
  dados: TotemGestaoDispositivoCriar,
  agora: Date,
): Promise<TotemGestaoCodigoAtivacao> {
  await exigirLojaNoEscopo(tx, user, dados.lojaId);
  const loja = await tx.totemLoja.findFirst({ where: { id: dados.lojaId, orgId: user.orgId }, select: { ativa: true } });
  if (!loja) throw totemNaoEncontrado();
  if (!loja.ativa) throw new ConflictException('A loja está desativada. Reative a loja antes de cadastrar um totem nela.');

  const { resultado, codigo, expiraEm } = await comCodigoNovo(agora, (hash, expira) =>
    tx.totemDispositivo.create({
      data: {
        orgId: user.orgId,
        lojaId: dados.lojaId,
        nome: dados.nome,
        codigoAtivacaoHash: hash,
        ativacaoExpiraEm: expira,
      },
      select: CAMPOS_DO_DISPOSITIVO,
    }),
  );
  return { dispositivo: totemGestaoDispositivoParaTela(resultado, agora), codigo, expiraEm: expiraEm.toISOString() };
}

/**
 * Código novo para um totem que perdeu o dele, que deixou vencer, ou que vai
 * trocar de aparelho. O aparelho que já estava ativado continua funcionando até
 * o código novo ser usado.
 */
export async function totemGestaoNovoCodigo(
  tx: ClienteDosDispositivos,
  user: UsuarioDoEscopo,
  id: string,
  agora: Date,
): Promise<TotemGestaoCodigoAtivacao> {
  const atual = await dispositivoNoEscopo(tx, user, id);
  if (atual.revogadoEm) {
    throw new ConflictException('Este totem foi revogado. Cadastre um totem novo para ativar outro aparelho.');
  }
  const { resultado, codigo, expiraEm } = await comCodigoNovo(agora, (hash, expira) =>
    tx.totemDispositivo.update({
      where: { id, orgId: user.orgId },
      data: { codigoAtivacaoHash: hash, ativacaoExpiraEm: expira },
      select: CAMPOS_DO_DISPOSITIVO,
    }),
  );
  return { dispositivo: totemGestaoDispositivoParaTela(resultado, agora), codigo, expiraEm: expiraEm.toISOString() };
}

export async function totemGestaoRenomearDispositivo(
  tx: ClienteDosDispositivos,
  user: UsuarioDoEscopo,
  id: string,
  nome: string,
  agora: Date,
): Promise<TotemGestaoDispositivo> {
  await dispositivoNoEscopo(tx, user, id);
  const d = await tx.totemDispositivo.update({
    where: { id, orgId: user.orgId },
    data: { nome },
    select: CAMPOS_DO_DISPOSITIVO,
  });
  return totemGestaoDispositivoParaTela(d, agora);
}

export async function totemGestaoRevogarDispositivo(
  tx: ClienteDosDispositivos,
  user: UsuarioDoEscopo,
  id: string,
  agora: Date,
): Promise<TotemGestaoDispositivo> {
  const atual = await dispositivoNoEscopo(tx, user, id);
  if (atual.revogadoEm) return totemGestaoDispositivoParaTela(atual, agora);
  const d = await tx.totemDispositivo.update({
    where: { id, orgId: user.orgId },
    data: { revogadoEm: agora, tokenHash: null, codigoAtivacaoHash: null, ativacaoExpiraEm: null },
    select: CAMPOS_DO_DISPOSITIVO,
  });
  return totemGestaoDispositivoParaTela(d, agora);
}
