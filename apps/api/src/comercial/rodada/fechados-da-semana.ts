import type { PrismaService } from '../../prisma/prisma.service';
import { fechouEm, type SemanaDaRodada } from './rodada-da-semana';

/*
 * A CONTA DA SEMANA, UMA SÓ (etapa 9, F-25, decisão do Lucas em 04/11/2026). A Rodada mostra estes
 * números e o Relatório comercial faz a análise em cima deles, com a mesma janela (segunda a domingo,
 * São Paulo) e a mesma regra:
 *   · entraram = leads com entrada na semana (com ou sem ficha);
 *   · fechados = o primeiro `cliente.ativo` de cada lead, se caiu na semana; sem o fato, a ficha em
 *     E9 na data do cliente ativo ou na entrada em E9.
 */
type Banco = Pick<PrismaService, 'lead' | 'leadEvent' | 'comercialFicha'>;

export async function fechadosDaSemana(prisma: Banco, orgId: string, s: Pick<SemanaDaRodada, 'inicio' | 'fim'>): Promise<Map<string, Date>> {
  const janela = { gte: s.inicio, lt: s.fim };
  const [ativos, fichas] = await Promise.all([
    prisma.leadEvent.findMany({ where: { orgId, occurredAt: janela, type: 'cliente.ativo' }, select: { leadId: true } }),
    prisma.comercialFicha.findMany({
      where: { orgId, etapa: 'fechado', OR: [{ clienteAtivoEm: janela }, { clienteAtivoEm: null, etapaDesde: janela }] },
      select: { leadId: true, etapa: true, clienteAtivoEm: true, etapaDesde: true },
    }),
  ]);
  const candidatos = [...new Set([...ativos.map((a) => a.leadId), ...fichas.map((f) => f.leadId)])];
  const primeiros = candidatos.length
    ? await prisma.leadEvent.groupBy({ by: ['leadId'], where: { orgId, leadId: { in: candidatos }, type: 'cliente.ativo' }, _min: { occurredAt: true } })
    : [];
  const primeiroAtivo = new Map(primeiros.map((p) => [p.leadId, p._min.occurredAt]));
  const fichaDe = new Map(fichas.map((f) => [f.leadId, f]));
  const quando = new Map<string, Date>();
  for (const id of candidatos) {
    const em = fechouEm(primeiroAtivo.get(id) ?? null, fichaDe.get(id) ?? null);
    if (em && em.getTime() >= s.inicio.getTime() && em.getTime() < s.fim.getTime()) quando.set(id, em);
  }
  return quando;
}

export function entraramNaSemana(prisma: Banco, orgId: string, s: Pick<SemanaDaRodada, 'inicio' | 'fim'>): Promise<number> {
  return prisma.lead.count({ where: { orgId, enteredAt: { gte: s.inicio, lt: s.fim } } });
}
