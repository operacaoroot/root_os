import { ForbiddenException } from '@nestjs/common';
import { AreaItemRascunhoSchema, ehConteudoDeItem, itemTemRascunho } from '@mktos/shared';
import type { Prisma } from '@prisma/client';

import { hashDoConteudo } from './eventos';

type Banco = Pick<Prisma.TransactionClient, 'salaVersao' | 'salaDoCliente'>;

export function salaAtivaDaPublicacao(db: Pick<Banco, 'salaDoCliente'>, orgId: string, leadId: string, agora = new Date()) {
  return db.salaDoCliente.findFirst({
    where: { orgId, leadId, revogadoEm: null, validoAte: { gt: agora } },
    select: { id: true },
  });
}

export function origemDaSalaConfere(origem: Prisma.JsonValue, clienteId: unknown): boolean {
  return (clienteId === null || typeof clienteId === 'string')
    && !!origem && typeof origem === 'object' && !Array.isArray(origem)
    && origem.versao === 1 && origem.clienteId === clienteId;
}

export async function exigirVersaoDaPublicacao(
  db: Banco,
  orgId: string,
  approvalId: string,
  args: Record<string, unknown>,
  aceitariaPublicada = false,
) {
  const negar = () => new ForbiddenException('A aprovação não corresponde à versão vigente da sala.');
  const { leadId, versao, hash } = args;
  if (!approvalId || typeof leadId !== 'string' || !leadId || typeof versao !== 'number'
    || !Number.isInteger(versao) || versao < 1 || typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) throw negar();

  const sala = await salaAtivaDaPublicacao(db, orgId, leadId);
  if (!sala) throw negar();
  const v = await db.salaVersao.findFirst({
    where: { orgId, leadId, numero: versao, approvalId, hash, estado: { in: aceitariaPublicada ? ['na_porta', 'publicada'] : ['na_porta'] } },
  });
  if (!v || !origemDaSalaConfere(v.origemCliente, args.clienteId) || hashDoConteudo(v.conteudo) !== hash) throw negar();
  if (v.item === null) {
    if (!v.conteudo || typeof v.conteudo !== 'object' || Array.isArray(v.conteudo)
      || 'item' in v.conteudo || !Array.isArray(v.conteudo.proximosPassos)) throw negar();
  } else {
    if (!ehConteudoDeItem(v.conteudo)) throw negar();
    const { item, ...escrito } = v.conteudo;
    if (item !== v.item || !itemTemRascunho(item) || !AreaItemRascunhoSchema.safeParse(escrito).success) throw negar();
  }
  return v;
}
