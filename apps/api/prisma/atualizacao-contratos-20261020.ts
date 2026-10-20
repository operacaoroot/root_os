/*
 * Atualiza no financeiro de UMA empresa os contratos de clientes que o Lucas
 * passou em 20/10/2026 (entrada e parcelas de cada um).
 *
 * Grava do mesmo jeito que o Custeio já está: o cliente no Partner; a entrada
 * (e o que mais vier avulso, como o pagamento na entrega) como previsto solto;
 * as parcelas num contrato mensal com os previstos já gerados, cada um com o id
 * de `idDoLancamentoDeContrato` (o "gerar" da tela cai no mesmo lançamento e não
 * duplica); e o acordo da Análise com o total.
 *
 * Só mexe em previsto. O que já entrou (realizado ou conciliado) fica como está
 * e aparece no relatório para conferir à mão.
 *
 * Idempotente: rodar de novo não muda nada. Sem --aplicar só mostra o que faria.
 * Uso: tsx prisma/atualizacao-contratos-20261020.ts <orgId> [--aplicar]
 */
import { createHash } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const [orgId, flag] = process.argv.slice(2);
const APLICAR = flag === '--aplicar';

interface Atualizacao {
  /** Razão social do Partner (quando é novo) e cliente do acordo. */
  cliente: string;
  /** Trecho do nome que acha o cliente que já existe (razão social ou fantasia). */
  busca: string;
  /** Começo das descrições dos lançamentos e do contrato. */
  rotulo: string;
  /** Produto do acordo da Análise. */
  produto: string;
  /** Soma de tudo, para pegar erro de digitação. */
  totalCentavos: number;
  avulsos: Array<{ nome: string; vence: string; centavos: number }>;
  parcelas: { primeira: string; quantas: number; centavos: number; ultimaCentavos: number } | null;
  /** Nota dos previstos avulsos. */
  nota: string;
  /** Observação do acordo. */
  observacao: string;
  /** Nulo mantém o que o acordo já tem. */
  apelidos: string | null;
  /** Descrição de previsto antigo que as parcelas novas substituem (sai, se ainda for previsto). */
  substitui?: string[];
}

const ATUALIZACOES: Atualizacao[] = [
  {
    // era R$ 6.000 em 20/10 + 6 x R$ 1.000; o total não muda
    cliente: 'Custeio',
    busca: 'custeio',
    rotulo: 'Custeio — Operação ROOT (upsell)',
    produto: 'Operação ROOT (upsell)',
    totalCentavos: 1_200_000,
    avulsos: [{ nome: 'entrada', vence: '2026-10-20', centavos: 400_000 }],
    parcelas: { primeira: '2026-11-20', quantas: 6, centavos: 133_333, ultimaCentavos: 133_335 },
    nota: 'Upsell de R$ 12.000: entrada de R$ 4.000 + 5 x R$ 1.333,33 e a última de R$ 1.333,35.',
    observacao: 'R$ 4.000 em 20/10 + 5 x R$ 1.333,33 + R$ 1.333,35 (20/11 a 20/04)',
    apelidos: null,
  },
  {
    // a cobrança estava "a gerar" (R$ 3.970 em 31/10); Antônio pagou em 20/10 no cartão.
    // O repasse do cartão é um por mês: se vier pelo Asaas, o asaas-depois-do-csv casa
    // cada parcela do sync com a daqui (mesmo valor, vencimento perto).
    cliente: 'Affari',
    busca: 'affari',
    rotulo: 'Affari — Imersão ROOT',
    produto: 'Imersão ROOT',
    totalCentavos: 397_000,
    avulsos: [],
    parcelas: { primeira: '2026-11-20', quantas: 10, centavos: 39_700, ultimaCentavos: 39_700 },
    nota: '',
    observacao: 'pago em 20/10 no cartão, 10 x R$ 397,00 sem juros',
    apelidos: null,
    substitui: ['Affari — Imersão ROOT (cobrança a gerar)'],
  },
];

const reais = (centavos: number) => new Prisma.Decimal((centavos / 100).toFixed(2));
const brl = (v: number | Prisma.Decimal) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\s/g, ' ');
const dia = (s: string) => new Date(`${s}T00:00:00.000Z`);
const br = (d: string | Date) => (typeof d === 'string' ? d : d.toISOString().slice(0, 10)).split('-').reverse().join('/');

/** Soma meses a um dia AAAA-MM-DD; o dia que não existe no mês cai no último (como em src/comercial/fechado-fora.ts). */
function somarMeses(d: string, meses: number): string {
  const [a, m, dd] = d.split('-').map(Number);
  const total = a * 12 + (m - 1) + meses;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(dd, ultimo)).padStart(2, '0')}`;
}

/** O mesmo id de `idDoLancamentoDeContrato` (src/finance/apr.service.ts). */
function idDoLancamento(contractId: string, vencimento: Date): string {
  const bytes = createHash('sha256')
    .update(`${orgId}\0lancamento-de-contrato\0${contractId}\0${vencimento.toISOString()}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const igual = (x: unknown, y: unknown) =>
  x instanceof Prisma.Decimal ? x.eq(y as Prisma.Decimal) : x instanceof Date ? x.getTime() === (y as Date).getTime() : x === y;

/** Cliente, previstos avulsos e contrato das parcelas. */
async function lancamentos(a: Atualizacao, contaId: string, receitaId: string, diz: (t: string) => void) {
  const p = a.parcelas;

  // 1. cliente: o que já existe com o nome; mais de um, pára antes de escrever qualquer coisa
  const candidatos = await prisma.partner.findMany({
    where: {
      orgId, isCliente: true,
      OR: [{ razaoSocial: { contains: a.busca, mode: 'insensitive' } }, { nomeFantasia: { contains: a.busca, mode: 'insensitive' } }],
    },
  });
  if (candidatos.length > 1) throw new Error(`${a.cliente}: ${candidatos.length} clientes com "${a.busca}" (${candidatos.map((c) => c.razaoSocial).join('; ')}): escolha um antes de rodar`);
  let cliente = candidatos[0] ?? null;
  if (!cliente) {
    diz('cliente novo no Financeiro');
    if (APLICAR) cliente = await prisma.partner.create({ data: { orgId, isCliente: true, razaoSocial: a.cliente } });
  }
  const partnerId = cliente?.id ?? null; // na simulação, o cliente novo ainda não tem id

  // cobrança em aberto no Asaas vira previsto `pay_` pelo sync: o previsto à mão ficaria em dobro
  const doAsaas = await prisma.financeTransaction.findMany({
    where: {
      orgId, type: 'entrada', status: 'previsto', externalId: { startsWith: 'pay_' },
      OR: [...(partnerId ? [{ partnerId }] : []), { counterparty: { contains: a.busca, mode: 'insensitive' } }],
    },
  });
  for (const t of doAsaas) diz(`atenção: cobrança do Asaas em aberto, ${brl(t.amount)} em ${br(t.dueDate ?? t.date)} (asaas-depois-do-csv casa com o previsto à mão)`);

  // previsto antigo que o cronograma novo substitui: só sai o que ainda é previsto lançado à mão
  for (const description of a.substitui ?? []) {
    const velhos = partnerId
      ? await prisma.financeTransaction.findMany({ where: { orgId, partnerId, type: 'entrada', description, contractId: null } })
      : [];
    for (const v of velhos) {
      if (v.status !== 'previsto' || v.source !== 'manual' || v.reconciledAt) {
        diz(`atenção: "${description}" (${brl(v.amount)}) já é ${v.status}: não mexo, confira`);
        continue;
      }
      diz(`sai o previsto antigo "${description}", ${brl(v.amount)} em ${br(v.dueDate ?? v.date)}`);
      if (APLICAR) await prisma.financeTransaction.delete({ where: { id: v.id } });
    }
  }

  // 2. avulsos (entrada, entrega)
  for (const v of a.avulsos) {
    const description = `${a.rotulo}: ${v.nome}`;
    const venc = dia(v.vence);
    const ja = partnerId ? await prisma.financeTransaction.findFirst({ where: { orgId, partnerId, contractId: null, type: 'entrada', description } }) : null;
    if (!ja) {
      diz(`${v.nome} ${brl(v.centavos / 100)} em ${br(v.vence)} (novo previsto)`);
      if (APLICAR) {
        await prisma.financeTransaction.create({
          data: {
            orgId, accountId: contaId, chartAccountId: receitaId, partnerId, type: 'entrada', status: 'previsto',
            description, amount: reais(v.centavos), date: venc, dueDate: venc, counterparty: a.cliente, notes: a.nota, source: 'manual',
          },
        });
      }
      continue;
    }
    if (ja.status !== 'previsto') {
      if (!ja.amount.eq(reais(v.centavos))) diz(`atenção: ${v.nome} já entrou (${ja.status}) com ${brl(ja.amount)}, não ${brl(v.centavos / 100)}: não mexo, confira`);
      continue;
    }
    const data: Prisma.FinanceTransactionUpdateInput = {};
    const mudou: string[] = [];
    if (!ja.amount.eq(reais(v.centavos))) { data.amount = reais(v.centavos); mudou.push(`${brl(ja.amount)} → ${brl(v.centavos / 100)}`); }
    if (!ja.dueDate || !igual(ja.dueDate, venc)) { data.date = venc; data.dueDate = venc; mudou.push(`vence ${br(v.vence)}`); }
    if (ja.notes !== a.nota) { data.notes = a.nota; mudou.push('nota'); }
    if (!mudou.length) continue;
    diz(`${v.nome}: ${mudou.join(', ')}`);
    if (APLICAR) await prisma.financeTransaction.update({ where: { id: ja.id }, data });
  }

  // 3. parcelas: contrato mensal e os previstos gerados
  if (!p) return;
  const vencimentos = Array.from({ length: p.quantas }, (_, i) => somarMeses(p.primeira, i));
  const ultimo = vencimentos[vencimentos.length - 1];
  const descricao = `${a.rotulo}: parcelas`;
  const aUltima = p.ultimaCentavos !== p.centavos ? ` (a última de ${brl(p.ultimaCentavos / 100)})` : '';
  const campos = {
    valor: reais(p.centavos),
    diaVencimento: Number(p.primeira.slice(8, 10)),
    periodicidade: 'mensal',
    dataInicio: dia(vencimentos[0]),
    dataFim: dia(ultimo),
    // todos os vencimentos já saem gerados abaixo
    proximoVencimento: dia(somarMeses(ultimo, 1)),
  };
  let contrato = partnerId ? await prisma.contract.findFirst({ where: { orgId, partnerId, tipo: 'entrada', descricao } }) : null;
  if (!contrato) {
    diz(`contrato novo: ${p.quantas} x ${brl(p.centavos / 100)}${aUltima}, de ${br(vencimentos[0])} a ${br(ultimo)}`);
    if (APLICAR) {
      contrato = await prisma.contract.create({
        data: { orgId, tipo: 'entrada', partnerId, descricao, accountId: contaId, chartAccountId: receitaId, ...campos },
      });
    }
  } else {
    const atual = contrato;
    const muda = (Object.keys(campos) as Array<keyof typeof campos>).filter((k) => !igual(atual[k], campos[k]));
    if (muda.length) {
      diz(`contrato: ${muda.join(', ')} (${p.quantas} x ${brl(p.centavos / 100)}${aUltima})`);
      if (APLICAR) contrato = await prisma.contract.update({ where: { id: atual.id }, data: campos });
    }
  }

  for (const [i, v] of vencimentos.entries()) {
    const centavos = i === p.quantas - 1 ? p.ultimaCentavos : p.centavos;
    const venc = dia(v);
    const qual = `parcela ${i + 1}/${p.quantas} em ${br(v)}`;
    const ja = contrato ? await prisma.financeTransaction.findFirst({ where: { orgId, contractId: contrato.id, dueDate: venc } }) : null;
    if (!ja) {
      diz(`${qual}: ${brl(centavos / 100)} (novo previsto)`);
      if (APLICAR && contrato) {
        await prisma.financeTransaction.create({
          data: {
            id: idDoLancamento(contrato.id, venc), orgId, accountId: contaId, chartAccountId: receitaId, partnerId, contractId: contrato.id,
            type: 'entrada', status: 'previsto', description: `${descricao} (contrato)`,
            amount: reais(centavos), date: venc, dueDate: venc, source: 'manual', approvalStatus: 'nao_requer',
          },
        });
      }
    } else if (ja.amount.eq(reais(centavos))) {
      continue;
    } else if (ja.status !== 'previsto') {
      diz(`atenção: ${qual} já entrou (${ja.status}) com ${brl(ja.amount)}: não mexo, confira`);
    } else {
      diz(`${qual}: ${brl(ja.amount)} → ${brl(centavos / 100)}`);
      if (APLICAR) await prisma.financeTransaction.update({ where: { id: ja.id }, data: { amount: reais(centavos) } });
    }
  }

  if (contrato) {
    const sobra = await prisma.financeTransaction.findMany({ where: { orgId, contractId: contrato.id, dueDate: { notIn: vencimentos.map(dia) } } });
    for (const s of sobra) diz(`atenção: lançamento do contrato em ${br(s.dueDate ?? s.date)} (${brl(s.amount)}, ${s.status}) fora das datas novas: confira à mão`);
  }
}

async function main() {
  if (!orgId) throw new Error('uso: tsx prisma/atualizacao-contratos-20261020.ts <orgId> [--aplicar]');
  const log: string[] = [];
  const conta = await prisma.financeAccount.findFirst({ where: { orgId, provider: 'asaas' } });
  if (!conta) throw new Error('empresa sem conta Asaas');
  const receita = await prisma.chartAccount.findFirst({ where: { orgId, codigo: '1.1.02' } });
  if (!receita) throw new Error('empresa sem a conta 1.1.02 Serviços Prestados');

  for (const a of ATUALIZACOES) {
    const diz = (t: string) => log.push(`${a.cliente}: ${t}`);
    const p = a.parcelas;
    const soma = a.avulsos.reduce((s, v) => s + v.centavos, 0) + (p ? p.centavos * (p.quantas - 1) + p.ultimaCentavos : 0);
    if (soma !== a.totalCentavos) throw new Error(`${a.cliente}: as partes somam ${brl(soma / 100)}, o total é ${brl(a.totalCentavos / 100)}`);

    await lancamentos(a, conta.id, receita.id, diz);

    // acordo da Análise: pelo cliente (o produto pode mudar); com dois acordos, o do mesmo produto
    const acordos = await prisma.acordoComercial.findMany({ where: { orgId, cliente: a.cliente } });
    const doProduto = acordos.filter((x) => x.produto === a.produto);
    if (acordos.length > 1 && doProduto.length !== 1) throw new Error(`${a.cliente}: ${acordos.length} acordos e nenhum só com o produto "${a.produto}"`);
    const acordo = acordos.length > 1 ? doProduto[0] : acordos[0];
    if (!acordo) {
      diz(`acordo novo: ${a.produto}, ${brl(a.totalCentavos / 100)} (pagante)`);
      if (APLICAR) {
        await prisma.acordoComercial.create({
          data: { orgId, cliente: a.cliente, produto: a.produto, valor: reais(a.totalCentavos), tipo: 'pagante', observacao: a.observacao, apelidos: a.apelidos },
        });
      }
    } else {
      const data: Prisma.AcordoComercialUpdateInput = {};
      if (acordo.produto !== a.produto) data.produto = a.produto;
      if (!acordo.valor.eq(reais(a.totalCentavos))) data.valor = reais(a.totalCentavos);
      if (acordo.observacao !== a.observacao) data.observacao = a.observacao;
      if (a.apelidos !== null && acordo.apelidos !== a.apelidos) data.apelidos = a.apelidos;
      if (Object.keys(data).length) {
        diz(`acordo: ${Object.keys(data).join(', ')}`);
        if (APLICAR) await prisma.acordoComercial.update({ where: { id: acordo.id }, data });
      }
    }
  }

  console.log(log.length ? log.join('\n') : 'nada a mudar');
  console.log(APLICAR ? `aplicado: ${log.length} linha(s)` : `simulação: ${log.length} linha(s) (rode com --aplicar)`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
