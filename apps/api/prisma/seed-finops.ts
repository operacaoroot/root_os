// Seed FINOPS (enxerto FinOps5.0) — idempotente e NÃO-destrutivo.
// Cria o template do DRE (linhas + fórmulas, "Motor Vortex") e importa o
// Plano de Contas FullBPO (hierárquico), ligando cada folha à sua linha DRE.
// Rodar após a migration add_finops:  pnpm --filter @mktos/api db:seed:finops
import { PrismaClient } from '@prisma/client';
import { TEMPLATE_FULLBPO } from './data/plano-contas-fullbpo';

const prisma = new PrismaClient();

// Template DRE gerencial (porte do dre_linhas + calcular_dre do FinOps5.0).
// tipo: origem (soma lançamentos) | grupo/calculado (fórmula) | indicador (%).
type L = { codigo: string; nome: string; operador: string; tipo: string; ordem: number; formula?: string; visivel?: boolean };
const DRE: L[] = [
  { codigo: 'FB', nome: 'Faturamento Bruto', operador: '(+)', tipo: 'origem', ordem: 10 },
  { codigo: 'ISV', nome: 'Impostos sobre Vendas', operador: '(-)', tipo: 'origem', ordem: 20 },
  { codigo: 'DEV', nome: 'Devoluções', operador: '(-)', tipo: 'origem', ordem: 21 },
  { codigo: 'DESC', nome: 'Descontos Concedidos', operador: '(-)', tipo: 'origem', ordem: 22 },
  { codigo: 'FRV', nome: 'Frete sobre Vendas', operador: '(-)', tipo: 'origem', ordem: 23 },
  { codigo: 'CPV', nome: 'Comissões sobre Vendas', operador: '(-)', tipo: 'origem', ordem: 24 },
  { codigo: 'DED', nome: 'Deduções da Receita', operador: '(=)', tipo: 'grupo', ordem: 25, formula: 'ISV + DEV + DESC + FRV + CPV' },
  { codigo: 'FL', nome: 'Faturamento Líquido', operador: '(=)', tipo: 'calculado', ordem: 30, formula: 'FB - DED' },
  // Custos diretos
  { codigo: 'CD_GER', nome: 'Custos Gerais', operador: '(-)', tipo: 'origem', ordem: 40 },
  { codigo: 'CD_SRV', nome: 'Compra de Serviços', operador: '(-)', tipo: 'origem', ordem: 41 },
  { codigo: 'CD_SW', nome: 'Software', operador: '(-)', tipo: 'origem', ordem: 42 },
  { codigo: 'CD_NI', nome: 'Despesa a Identificar', operador: '(-)', tipo: 'origem', ordem: 43 },
  { codigo: 'CD_CLI', nome: 'Refeição com Cliente', operador: '(-)', tipo: 'origem', ordem: 44 },
  { codigo: 'CD_ADM', nome: 'Outras Despesas ADM Operacional', operador: '(-)', tipo: 'origem', ordem: 45 },
  { codigo: 'COI', nome: 'Custos Operacionais Indiretos', operador: '(-)', tipo: 'origem', ordem: 46 },
  { codigo: 'CD', nome: 'Custos Diretos', operador: '(=)', tipo: 'grupo', ordem: 48, formula: 'CD_GER + CD_SRV + CD_SW + CD_NI + CD_CLI + CD_ADM + COI' },
  { codigo: 'MC', nome: 'Margem de Contribuição', operador: '(=)', tipo: 'calculado', ordem: 50, formula: 'FL - CD' },
  { codigo: 'MC_PCT', nome: 'Margem de Contribuição %', operador: '( )', tipo: 'indicador', ordem: 51, formula: 'MC / FL * 100' },
  // Custo com pessoal
  { codigo: 'CP_SAL', nome: 'Salários e Encargos', operador: '(-)', tipo: 'origem', ordem: 60 },
  { codigo: 'CP_13', nome: '13º Salário', operador: '(-)', tipo: 'origem', ordem: 61 },
  { codigo: 'CP_AM', nome: 'Assistência Médica', operador: '(-)', tipo: 'origem', ordem: 62 },
  { codigo: 'CP_VT', nome: 'Vale Transporte', operador: '(-)', tipo: 'origem', ordem: 63 },
  { codigo: 'CP_VR', nome: 'Vale Refeição', operador: '(-)', tipo: 'origem', ordem: 64 },
  { codigo: 'CP_AC', nome: 'Ajuda de Custo', operador: '(-)', tipo: 'origem', ordem: 65 },
  { codigo: 'CP_PJ', nome: 'Prestadores de Serviço (PJ)', operador: '(-)', tipo: 'origem', ordem: 66 },
  { codigo: 'CP_COM', nome: 'Comissões PJ', operador: '(-)', tipo: 'origem', ordem: 67 },
  { codigo: 'CP', nome: 'Custo com Pessoal', operador: '(=)', tipo: 'grupo', ordem: 68, formula: 'CP_SAL + CP_13 + CP_AM + CP_VT + CP_VR + CP_AC + CP_PJ + CP_COM' },
  // Despesas operacionais
  { codigo: 'DO_ADM', nome: 'Despesas Administrativas', operador: '(-)', tipo: 'origem', ordem: 70 },
  { codigo: 'DO_PES', nome: 'Despesas com Pessoal ADM', operador: '(-)', tipo: 'origem', ordem: 71 },
  { codigo: 'DO_MKT', nome: 'Marketing e Vendas', operador: '(-)', tipo: 'origem', ordem: 72 },
  { codigo: 'DO_OUT', nome: 'Outras Despesas Operacionais', operador: '(-)', tipo: 'origem', ordem: 73 },
  { codigo: 'DO_DEV', nome: 'Recuperação de Despesas', operador: '(-)', tipo: 'origem', ordem: 74 },
  { codigo: 'DO', nome: 'Despesas Operacionais', operador: '(=)', tipo: 'grupo', ordem: 75, formula: 'DO_ADM + DO_PES + DO_MKT + DO_OUT + DO_DEV' },
  { codigo: 'EBITDA', nome: 'Resultado Operacional (EBITDA)', operador: '(=)', tipo: 'calculado', ordem: 80, formula: 'MC - CP - DO' },
  { codigo: 'EBITDA_PCT', nome: 'Margem EBITDA %', operador: '( )', tipo: 'indicador', ordem: 81, formula: 'EBITDA / FL * 100' },
  // Resultado financeiro
  { codigo: 'RFP', nome: 'Receitas Financeiras', operador: '(+)', tipo: 'origem', ordem: 90 },
  { codigo: 'RI', nome: 'Receitas de Investimentos', operador: '(+)', tipo: 'origem', ordem: 91 },
  { codigo: 'RFN', nome: 'Despesas Financeiras', operador: '(-)', tipo: 'origem', ordem: 92 },
  { codigo: 'RF', nome: 'Resultado Financeiro', operador: '(+/-)', tipo: 'calculado', ordem: 95, formula: 'RFP + RI - RFN' },
  { codigo: 'LL', nome: 'Lucro Líquido', operador: '(=)', tipo: 'calculado', ordem: 100, formula: 'EBITDA + RF' },
  { codigo: 'LL_PCT', nome: 'Margem Líquida %', operador: '( )', tipo: 'indicador', ordem: 101, formula: 'LL / FL * 100' },
  // Abaixo da linha (informativo — não entra no LL)
  { codigo: 'DL', nome: 'Distribuição de Lucro / Pró-labore', operador: '(-)', tipo: 'origem', ordem: 110 },
  { codigo: 'INV', nome: 'Investimentos (CAPEX)', operador: '( )', tipo: 'origem', ordem: 120 },
];

async function main() {
  const org = await prisma.org.findUnique({ where: { slug: 'root' } });
  if (!org) throw new Error('Org "root" não encontrada — rode o seed principal antes.');

  // 1) Template DRE
  for (const l of DRE) {
    await prisma.dreLine.upsert({
      where: { orgId_codigo: { orgId: org.id, codigo: l.codigo } },
      update: { nome: l.nome, operador: l.operador, tipo: l.tipo, formula: l.formula ?? null, ordem: l.ordem, visivel: l.visivel ?? true },
      create: { orgId: org.id, codigo: l.codigo, nome: l.nome, operador: l.operador, tipo: l.tipo, formula: l.formula ?? null, ordem: l.ordem, visivel: l.visivel ?? true },
    });
  }
  const dreByCode = new Map((await prisma.dreLine.findMany({ where: { orgId: org.id } })).map((d) => [d.codigo, d.id]));

  // 2) Plano de Contas FullBPO (hierárquico) — pais antes dos filhos
  const entries = [...TEMPLATE_FULLBPO].sort((a, b) => a.nivel - b.nivel || a.codigo.localeCompare(b.codigo));
  const idByCodigo = new Map<string, string>();
  let count = 0;
  for (const e of entries) {
    const parentCodigo = e.codigo.includes('.') ? e.codigo.split('.').slice(0, -1).join('.') : null;
    const parentId = parentCodigo ? idByCodigo.get(parentCodigo) ?? null : null;
    const dreLineId = e.dre_linha_codigo ? dreByCode.get(e.dre_linha_codigo) ?? null : null;
    const acc = await prisma.chartAccount.upsert({
      where: { orgId_codigo: { orgId: org.id, codigo: e.codigo } },
      update: { nome: e.nome, tipo: e.tipo, nivel: e.nivel, permiteLancamento: e.permite_lancamento, parentId, dreLineId },
      create: { orgId: org.id, codigo: e.codigo, nome: e.nome, tipo: e.tipo, nivel: e.nivel, permiteLancamento: e.permite_lancamento, parentId, dreLineId },
    });
    idByCodigo.set(e.codigo, acc.id);
    count++;
  }

  console.log(`✔ Seed FinOps: ${DRE.length} linhas de DRE + ${count} contas do plano importadas.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
