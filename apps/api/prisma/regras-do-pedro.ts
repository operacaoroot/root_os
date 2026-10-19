/*
 * Aplica no financeiro de UMA empresa a regra de custo × despesa do Pedro
 * (responsável pelo financeiro da ROOT, áudio de 19/10/2026):
 *
 *   - custo = operação (3.x); despesa = estrutura (4.x);
 *   - assinatura de IA = custo fixo (3.1.03 Software, fixo);
 *   - VPS = custo variável (conta nova 3.1.09 Infraestrutura, plano anual = 12 meses de uso);
 *   - tudo o que foi comprado para a sala = despesa, não investimento
 *     (conta nova 4.1.14 Estrutura da sala, eventual);
 *   - ferramenta administrativa (assinatura de contrato) = despesa fixa (4.1.15);
 *   - gasto pontual de pessoal ADM e marketing (alimentação, confraternização,
 *     uniforme, evento, presente) = despesa eventual; DAS do MEI = imposto fixo.
 *
 * Idempotente: rodar de novo não muda nada. Sem --aplicar só mostra o que faria.
 * Uso: tsx prisma/regras-do-pedro.ts <orgId> [--aplicar]
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const [orgId, flag] = process.argv.slice(2);
const APLICAR = flag === '--aplicar';

const NOVAS = [
  { codigo: '3.1.09', pai: '3.1', nome: 'Infraestrutura (servidor, VPS)', dre: 'CD_SW', natureza: 'variavel' },
  { codigo: '4.1.14', pai: '4.1', nome: 'Estrutura da sala (móveis, obra, equipamentos)', dre: 'DO_ADM', natureza: 'eventual' },
  { codigo: '4.1.15', pai: '4.1', nome: 'Ferramentas administrativas', dre: 'DO_ADM', natureza: 'fixo' },
];
const NATUREZA: Record<string, string> = {
  '3.1.03': 'fixo', // assinaturas de IA
  '4.1.01': 'fixo', '4.1.05': 'fixo', // aluguel, telefonia/internet
  '4.2.01': 'eventual', '4.3.01': 'eventual', // alimentação, confraternização, uniforme, evento, presente
  '2.1.08': 'fixo', // DAS do MEI
};

async function main() {
  if (!orgId) throw new Error('uso: tsx prisma/regras-do-pedro.ts <orgId> [--aplicar]');
  const log: string[] = [];
  const contas = async () => new Map((await prisma.chartAccount.findMany({ where: { orgId } })).map((c) => [c.codigo, c]));
  let porCodigo = await contas();
  if (!porCodigo.size) throw new Error('empresa sem plano de contas');

  // 1. contas novas
  for (const n of NOVAS) {
    if (porCodigo.has(n.codigo)) continue;
    log.push(`conta nova ${n.codigo} ${n.nome} (${n.natureza})`);
    if (!APLICAR) continue;
    const pai = porCodigo.get(n.pai);
    const dre = await prisma.dreLine.findFirst({ where: { orgId, codigo: n.dre } });
    await prisma.chartAccount.create({
      data: { orgId, codigo: n.codigo, nome: n.nome, tipo: 'despesa', nivel: 3, permiteLancamento: true, parentId: pai?.id ?? null, dreLineId: dre?.id ?? null, natureza: n.natureza, custoFixo: n.natureza === 'fixo' },
    });
  }
  if (APLICAR) porCodigo = await contas();
  const id = (c: string) => porCodigo.get(c)?.id ?? `<${c}>`;

  // 2. natureza das contas que a ROOT usa
  for (const [codigo, natureza] of Object.entries(NATUREZA)) {
    const c = porCodigo.get(codigo);
    if (!c || c.natureza === natureza) continue;
    log.push(`natureza ${codigo} ${c.nome}: ${c.natureza ?? 'automática'} → ${natureza}`);
    if (APLICAR) await prisma.chartAccount.update({ where: { id: c.id }, data: { natureza, custoFixo: natureza === 'fixo' } });
  }

  // 3. lançamentos
  const sala = id('4.1.14'), infra = id('3.1.09'), adm = id('4.1.15');
  const codigoDe = new Map([...porCodigo.values()].map((c) => [c.id, c.codigo]));
  const ehSala = (chart: string | null) => !!chart && (codigoDe.get(chart) ?? '').startsWith('5.');
  const txs = await prisma.financeTransaction.findMany({ where: { orgId }, include: { splits: true } });
  for (const t of txs) {
    const texto = `${t.description} ${t.counterparty ?? ''} ${t.notes ?? ''}`.toLowerCase();
    const data: Prisma.FinanceTransactionUpdateInput = {};
    let motivo = '';
    if (/dlocal|hostinger/.test(texto) && t.type === 'saida') {
      if (t.chartAccountId !== infra) { data.chartAccount = { connect: { id: infra } }; motivo = 'VPS → 3.1.09 custo variável'; }
      if (t.status !== 'previsto' && t.mesesDeUso !== 12) { data.mesesDeUso = 12; motivo += (motivo ? ', ' : '') + 'plano anual (12 meses)'; }
    } else if (/d4sign/.test(texto) && t.chartAccountId !== adm) {
      data.chartAccount = { connect: { id: adm } }; motivo = 'D4Sign → 4.1.15 despesa fixa';
    } else if (t.splits.length && t.splits.some((s) => ehSala(s.chartAccountId))) {
      // rateio com parte da sala: a parte 5.x e o material de escritório da mesma compra vão para a sala
      const novos = t.splits.map((s) => ({ ...s, chartAccountId: ehSala(s.chartAccountId) || codigoDe.get(s.chartAccountId ?? '') === '4.1.06' ? sala : s.chartAccountId }));
      log.push(`${t.date.toISOString().slice(0, 10)} ${Number(t.amount).toFixed(2)} rateio: parte da sala → 4.1.14`);
      if (APLICAR) {
        await prisma.transactionSplit.deleteMany({ where: { transactionId: t.id } });
        await prisma.transactionSplit.createMany({ data: novos.map((s) => ({ orgId, transactionId: t.id, chartAccountId: s.chartAccountId, departamentoId: s.departamentoId, projetoId: s.projetoId, valor: s.valor })) });
      }
    } else if (ehSala(t.chartAccountId) || (/letreiro|sala/.test(texto) && t.type === 'saida' && t.status === 'previsto' && (codigoDe.get(t.chartAccountId ?? '') ?? '').startsWith('5.'))) {
      data.chartAccount = { connect: { id: sala } }; motivo = 'sala → 4.1.14 despesa eventual (não investimento)';
    }
    if (motivo) {
      log.push(`${t.date.toISOString().slice(0, 10)} ${Number(t.amount).toFixed(2)} ${t.description.slice(0, 40)}: ${motivo}`);
      if (APLICAR) await prisma.financeTransaction.update({ where: { id: t.id }, data });
    }
  }

  // 4. contratos: D4Sign é ferramenta administrativa; a parcela gerada já foi movida acima
  for (const c of await prisma.contract.findMany({ where: { orgId } })) {
    if (/d4sign/i.test(c.descricao) && c.chartAccountId !== adm) {
      log.push(`contrato ${c.descricao.slice(0, 40)} → 4.1.15`);
      if (APLICAR) await prisma.contract.update({ where: { id: c.id }, data: { chartAccountId: adm } });
    }
  }

  console.log(log.length ? log.join('\n') : 'nada a mudar');
  console.log(APLICAR ? `aplicado: ${log.length} mudança(s)` : `simulação: ${log.length} mudança(s) (rode com --aplicar)`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
