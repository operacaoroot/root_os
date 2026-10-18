/*
 * Depois de ligar o Asaas numa empresa que já tinha o extrato lançado à mão
 * (CSV exportado do Asaas, externalId `fin_csv_<id>`).
 *
 * O sync do Asaas grava o extrato com o id da API (`fin_<id>`), que não é o
 * número que aparece no CSV. Sem este passo, cada movimento ficaria em dobro.
 *
 * Para cada lançamento do CSV, acha o do sync com o mesmo tipo, valor e dia,
 * passa para ele a classificação (plano de contas, rateio, parceiro,
 * favorecido, observação) e apaga o do CSV. Previstos lançados à mão que o
 * Asaas também trouxe como cobrança em aberto (`pay_<id>`, mesmo valor,
 * vencimento até 40 dias de distância) têm a classificação copiada e saem.
 *
 * Uso: tsx prisma/asaas-depois-do-csv.ts <orgId> [--aplicar]
 * Sem --aplicar só mostra o que faria.
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const [orgId, flag] = process.argv.slice(2);
const APLICAR = flag === '--aplicar';
const dia = (d: Date) => d.toISOString().slice(0, 10);
const DIA = 86400_000;

async function main() {
  if (!orgId) throw new Error('uso: tsx prisma/asaas-depois-do-csv.ts <orgId> [--aplicar]');
  const conta = await prisma.financeAccount.findFirst({ where: { orgId, provider: 'asaas' } });
  if (!conta) throw new Error('Empresa sem conta Asaas.');
  const todos = await prisma.financeTransaction.findMany({
    where: { orgId, accountId: conta.id },
    include: { splits: true },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });
  const csv = todos.filter((t) => t.externalId?.startsWith('fin_csv_'));
  const sync = todos.filter((t) => t.externalId?.startsWith('fin_') && !t.externalId.startsWith('fin_csv_'));
  if (!sync.length) {
    console.log(`Nenhum movimento do sync ainda (${csv.length} do CSV esperando). Conecte o Asaas e rode de novo.`);
    return;
  }
  const usados = new Set<string>();
  const pares: Array<[typeof csv[number], typeof sync[number]]> = [];
  const sobra: typeof csv = [];
  for (const c of csv) {
    const alvo = sync.find((s) => !usados.has(s.id) && s.type === c.type && s.amount.eq(c.amount) && dia(s.date) === dia(c.date));
    if (alvo) { usados.add(alvo.id); pares.push([c, alvo]); } else sobra.push(c);
  }

  // previstos manuais × cobranças em aberto do Asaas
  const abertosAsaas = todos.filter((t) => t.status === 'previsto' && t.externalId?.startsWith('pay_'));
  const manuais = await prisma.financeTransaction.findMany({
    where: { orgId, status: 'previsto', source: 'manual', type: 'entrada' },
    include: { splits: true },
  });
  const paresPrev: Array<[typeof manuais[number], typeof abertosAsaas[number]]> = [];
  const usadosPrev = new Set<string>();
  for (const a of abertosAsaas) {
    const venc = (a.dueDate ?? a.date).getTime();
    const cand = manuais
      .filter((m) => !usadosPrev.has(m.id) && m.amount.eq(a.amount) && Math.abs((m.dueDate ?? m.date).getTime() - venc) <= 40 * DIA)
      .sort((x, y) => Math.abs((x.dueDate ?? x.date).getTime() - venc) - Math.abs((y.dueDate ?? y.date).getTime() - venc))[0];
    if (cand) { usadosPrev.add(cand.id); paresPrev.push([cand, a]); }
  }

  console.log(`Extrato: ${pares.length} pares, ${sobra.length} do CSV sem par, ${sync.length - usados.size} do sync sem par.`);
  for (const c of sobra) console.log(`  sem par (fica): ${dia(c.date)} ${c.type} ${c.amount} ${c.description.slice(0, 60)}`);
  console.log(`A receber: ${paresPrev.length} previstos manuais casados com cobranças do Asaas.`);
  for (const [m, a] of paresPrev) console.log(`  ${m.description.slice(0, 50)} ${m.amount} → ${a.description.slice(0, 40)} venc. ${dia(a.dueDate ?? a.date)}`);
  if (!APLICAR) { console.log('Nada gravado (rode com --aplicar).'); return; }

  const copiar = async (de: { chartAccountId: string | null; partnerId: string | null; counterparty: string | null; notes: string | null; temRateio: boolean; splits: { chartAccountId: string | null; departamentoId: string | null; projetoId: string | null; valor: Prisma.Decimal }[] }, paraId: string) => {
    await prisma.financeTransaction.update({
      where: { id: paraId },
      data: {
        chartAccountId: de.chartAccountId, partnerId: de.partnerId, notes: de.notes, temRateio: de.temRateio,
        ...(de.counterparty ? { counterparty: de.counterparty } : {}),
        splits: { deleteMany: {}, create: de.splits.map((s) => ({ orgId, chartAccountId: s.chartAccountId, departamentoId: s.departamentoId, projetoId: s.projetoId, valor: s.valor })) },
      },
    });
  };
  // Um par por vez: se parar no meio, rodar de novo continua de onde parou.
  for (const [c, s] of pares) { await copiar(c, s.id); await prisma.financeTransaction.delete({ where: { id: c.id } }); }
  for (const [m, a] of paresPrev) { await copiar(m, a.id); await prisma.financeTransaction.delete({ where: { id: m.id } }); }
  console.log('Aplicado. Rode "sincronizar" no Asaas de novo para o saldo bater com o real.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
