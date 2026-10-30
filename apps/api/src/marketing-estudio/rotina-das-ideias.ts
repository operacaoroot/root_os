import { AgentEstado, Prisma } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';
import { LIVRE } from '../routines/rotina.tipos';
import { proximaOcorrencia } from '../pauta/cron';

/*
 * A rotina "IA das ideias" (30/10/2026): todo dia às 23h, uma hora depois da coleta da
 * pauta, a IA lê o que chegou e monta os cards de Ideias de conteúdo. Fica fora do
 * serviço do fluxo para a Triagem saber se ela está ligada sem depender dele.
 */
export const TIPO_DA_IA_DAS_IDEIAS = 'marketing.ideias.montar';
export const SLUG_DA_IA_DAS_IDEIAS = 'marketing-ideias-ia';
export const CRON_DA_IA_DAS_IDEIAS = '0 23 * * *';
const FUSO = 'America/Sao_Paulo';

/** Cria a rotina se ainda não existe (ligada) e diz se está ligada. A que existe não é tocada. */
export async function garantirRotinaDasIdeias(prisma: PrismaService, orgId: string): Promise<boolean> {
  const slug = SLUG_DA_IA_DAS_IDEIAS;
  const existe = await prisma.rotina.findUnique({ where: { orgId_slug: { orgId, slug } }, select: { ativo: true } });
  if (existe) return existe.ativo;
  try {
    await prisma.rotina.create({
      data: {
        orgId, slug, nome: 'Ideias de conteúdo: a IA lê o que a coleta trouxe e monta os cards',
        tipo: TIPO_DA_IA_DAS_IDEIAS, config: {} as Prisma.InputJsonValue,
        cron: CRON_DA_IA_DAS_IDEIAS, tz: FUSO, ativo: true, estado: AgentEstado.rodando,
        origem: 'manual', refExterna: null,
        reservadoEm: LIVRE, reservadoAte: LIVRE,
        proximaExecucaoEm: proximaOcorrencia(CRON_DA_IA_DAS_IDEIAS, FUSO, new Date()),
      },
    });
  } catch (e) {
    // Duas telas abriram juntas: a outra criou.
    if ((e as { code?: string }).code !== 'P2002') throw e;
  }
  return true;
}
