import type { Prisma, PrismaClient } from '@prisma/client';

import { comContexto, novaCorrelacao } from '../common/contexto-execucao';

/*
 * O PRAZO DO TEXTO GUARDADO NUMA PENDÊNCIA (Produção 22, M4).
 *
 * A triagem do WhatsApp (CO-16) abre pendência com o texto da mensagem em
 * `dados.texto` (e um trecho no `contexto`) para a pessoa decidir. É texto de
 * terceiro, que não precisa ficar no banco para sempre. A régua é a da MD9:
 * 14 dias. A pendência fica (o que foi decidido, por quem, quando); só o texto
 * sai.
 *
 * Quem apaga é o expurgo que já existe (`scripts/expurgar-rastro.ts`), que roda
 * com a conexão dona das tabelas, uma vez por dia. Cada empresa é limpa dentro
 * do contexto dela. Rodar duas vezes não apaga nada a mais.
 */

export const DIAS_DE_RETENCAO_DO_TEXTO = 14;

/** O instante em que o texto guardado agora vence. */
export function prazoDoTexto(agora: Date = new Date()): Date {
  return new Date(agora.getTime() + DIAS_DE_RETENCAO_DO_TEXTO * 24 * 60 * 60 * 1000);
}

/** `dados` sem o texto (o resto fica, com a marca de quando o texto saiu). */
export function dadosSemTexto(dados: unknown, agora: Date): Prisma.InputJsonValue | null {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return null;
  const { texto: _texto, ...resto } = dados as Record<string, unknown>;
  return { ...resto, textoApagadoEm: agora.toISOString() } as Prisma.InputJsonValue;
}

/**
 * O contexto sem o trecho da mensagem. A triagem escreve `“trecho”. A triagem
 * achou …`; a busca é gulosa até a ÚLTIMA frase do sistema, então um trecho que
 * imite a frase não sobrevive.
 */
export function contextoSemTrecho(contexto: string): string {
  const semTrecho = String(contexto ?? '').replace(/^“[\s\S]*”\. (?=A triagem achou)/, '');
  return semTrecho === contexto ? contexto : `(texto apagado depois de ${DIAS_DE_RETENCAO_DO_TEXTO} dias) ${semTrecho}`;
}

export interface ResultadoDoExpurgoDoTexto {
  empresas: number;
  pendencias: number;
}

type Banco = Pick<PrismaClient, 'pendencia' | '$queryRaw'>;

/** Apaga o texto vencido das pendências. `simular` só conta. */
export async function expurgarTextoVencido(
  prisma: Banco,
  agora: Date = new Date(),
  opcoes: { simular?: boolean } = {},
): Promise<ResultadoDoExpurgoDoTexto> {
  // A descoberta roda sem empresa: só a conexão dona, que atravessa o isolamento, enxerga todas.
  const empresas = await prisma.$queryRaw<{ orgId: string; quantas: bigint }[]>`
    SELECT "orgId", count(*) AS quantas
      FROM "Pendencia"
     WHERE "textoExpiraEm" IS NOT NULL AND "textoExpiraEm" <= ${agora}
     GROUP BY "orgId"
     ORDER BY "orgId"`;
  if (opcoes.simular) {
    return { empresas: empresas.length, pendencias: empresas.reduce((s, e) => s + Number(e.quantas), 0) };
  }
  let pendencias = 0;
  for (const { orgId } of empresas) {
    pendencias += await comContexto(
      { orgId, actorType: 'system', actorId: null, correlationId: novaCorrelacao('expurgo'), origem: 'cron' },
      async () => {
        const vencidas = await prisma.pendencia.findMany({
          where: { orgId, textoExpiraEm: { not: null, lte: agora } },
          select: { id: true, dados: true, contexto: true },
        });
        let limpas = 0;
        for (const p of vencidas) {
          const r = await prisma.pendencia.updateMany({
            where: { id: p.id, orgId, textoExpiraEm: { not: null, lte: agora } },
            data: {
              dados: dadosSemTexto(p.dados, agora) ?? undefined,
              contexto: contextoSemTrecho(p.contexto),
              textoExpiraEm: null,
            },
          });
          limpas += r.count;
        }
        return limpas;
      },
    );
  }
  return { empresas: empresas.length, pendencias };
}
