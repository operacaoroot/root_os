import type { Prisma } from '@prisma/client';
import { TOTEM_CPF_ANONIMIZADO, TOTEM_MESES_ATE_ANONIMIZAR } from '@mktos/shared';

import { hashSorteado } from './cpf';

/*
 * REVOGAÇÃO E ANONIMIZAÇÃO (a política, seções "Por quanto tempo" e "Seus
 * direitos"), sem Nest, com o client do Prisma por parâmetro.
 *
 * Anonimizar não apaga a linha: os cupons e os consentimentos apontam para ela
 * (`onDelete: Restrict`) e o histórico fecha a conta das campanhas. O que some
 * é o que leva à pessoa: celular, nome, o CPF mascarado e o HMAC do CPF, que é
 * trocado por um valor sorteado. Um cadastro novo com o mesmo CPF vira outro
 * cliente, sem ligação com este.
 */

type Tx = Prisma.TransactionClient;
type ClienteDaAnonimizacao = Pick<Tx, 'totemCliente' | 'totemConsentimento'>;

/** `false` quando o cliente não existe na empresa. Repetir em quem já foi anonimizado não muda nada. */
export async function anonimizarCliente(
  tx: ClienteDaAnonimizacao,
  orgId: string,
  clienteId: string,
  agora: Date = new Date(),
): Promise<boolean> {
  const cliente = await tx.totemCliente.findFirst({
    where: { id: clienteId, orgId },
    select: { id: true, anonimizadoEm: true },
  });
  if (!cliente) return false;
  if (cliente.anonimizadoEm) return true;
  await tx.totemConsentimento.updateMany({
    where: { orgId, clienteId, revogadoEm: null },
    data: { revogadoEm: agora },
  });
  await tx.totemCliente.update({
    where: { id: clienteId },
    data: {
      cpfHash: hashSorteado(),
      cpfMascarado: TOTEM_CPF_ANONIMIZADO,
      telefone: '',
      nome: null,
      aceitaCampanhas: false,
      anonimizadoEm: agora,
    },
  });
  return true;
}

/**
 * Tira só a permissão de mandar campanhas. O consentimento que tinha
 * `campanhas` é revogado e um novo, só com `cupom`, entra no lugar com a mesma
 * data de aceite: o aceite do cupom continua sendo o daquele dia.
 */
export async function revogarCampanhas(
  tx: ClienteDaAnonimizacao,
  orgId: string,
  clienteId: string,
  agora: Date = new Date(),
): Promise<void> {
  const comCampanhas = await tx.totemConsentimento.findMany({
    where: { orgId, clienteId, revogadoEm: null, finalidades: { has: 'campanhas' } },
  });
  for (const c of comCampanhas) {
    await tx.totemConsentimento.update({ where: { id: c.id }, data: { revogadoEm: agora } });
    const restantes = c.finalidades.filter((f) => f !== 'campanhas');
    if (restantes.length > 0) {
      await tx.totemConsentimento.create({
        data: {
          orgId,
          clienteId,
          politicaVersao: c.politicaVersao,
          finalidades: restantes,
          canal: c.canal,
          lojaId: c.lojaId,
          dispositivoId: c.dispositivoId,
          aceitoEm: c.aceitoEm,
        },
      });
    }
  }
  await tx.totemCliente.update({ where: { id: clienteId }, data: { aceitaCampanhas: false } });
}

/** A data antes da qual o cadastro conta como sem uso. */
export function limiteDeInatividade(agora: Date, meses: number = TOTEM_MESES_ATE_ANONIMIZAR): Date {
  const limite = new Date(agora.getTime());
  limite.setUTCMonth(limite.getUTCMonth() - meses);
  return limite;
}

/**
 * Sem uso: nenhuma alteração no cadastro, nenhum cupom emitido ou usado e
 * nenhum aceite desde o limite.
 */
export function filtroDeInativos(orgId: string, limite: Date): Prisma.TotemClienteWhereInput {
  return {
    orgId,
    anonimizadoEm: null,
    atualizadoEm: { lt: limite },
    cupons: { none: { OR: [{ emitidoEm: { gte: limite } }, { usadoEm: { gte: limite } }] } },
    consentimentos: { none: { aceitoEm: { gte: limite } } },
  };
}

const LOTE_DE_ANONIMIZACAO = 500;

export async function anonimizarInativos(
  tx: ClienteDaAnonimizacao,
  orgId: string,
  agora: Date = new Date(),
): Promise<{ anonimizados: number; limite: Date }> {
  const limite = limiteDeInatividade(agora);
  const alvos = await tx.totemCliente.findMany({
    where: filtroDeInativos(orgId, limite),
    select: { id: true },
    take: LOTE_DE_ANONIMIZACAO,
  });
  for (const a of alvos) await anonimizarCliente(tx, orgId, a.id, agora);
  return { anonimizados: alvos.length, limite };
}
