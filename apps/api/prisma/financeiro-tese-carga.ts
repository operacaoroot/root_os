/*
 * CARGA DA TESE DO FINANCEIRO (29/10/2026), aprovada pelo Lucas: cada real tem uma
 * origem, e o fluxo é calculado a partir dela.
 *
 *   - o que vamos receber vem do ACORDO, parcela a parcela, e cada parcela aponta
 *     para a sua cobrança no Asaas (o sync veste a parcela pela cobrança: nome,
 *     CNPJ, valor e vencimento). Parcela sem cobrança aparece como "a gerar";
 *   - o que vamos pagar vem das CONTAS FIXAS (contratos) e das avulsas;
 *   - nada fica lançado à mão em paralelo: o previsto manual que um acordo ou uma
 *     conta fixa passou a cobrir sai.
 *
 * Fontes: contratos em Root/10-clientes/<cliente>/02-contrato, o Asaas e o extrato.
 * Idempotente: rodar de novo não duplica nada; parcela que o Asaas já vestiu ou que
 * já foi paga não tem valor nem data trocados. Sem --aplicar só mostra o que faria.
 *
 * Uso: tsx prisma/financeiro-tese-carga.ts <orgId> [--aplicar]
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { materializarParcelas } from '../src/finance/parcelas.service';

const prisma = new PrismaClient();
const [orgId, flag] = process.argv.slice(2);
const APLICAR = flag === '--aplicar';
const dia = (s: string) => new Date(`${s}T00:00:00Z`);

type P = { valor: number; vence: string; paga?: string; nota?: string };
const mensais = (n: number, valor: number, primeira: string, ultimoValor = valor): P[] =>
  Array.from({ length: n }, (_, k) => {
    const [a, m, d] = primeira.split('-').map(Number);
    const v = new Date(Date.UTC(a, m - 1 + k, d)).toISOString().slice(0, 10);
    return { valor: k === n - 1 ? ultimoValor : valor, vence: v };
  });

interface Acordo {
  /** Acordo que já existe (id) ou que nasce agora (sem id, procurado pelo cliente). */
  id?: string;
  cliente: string; produto: string; valor: number; partnerId: string; apelidos: string | null;
  fechadoEm?: string; observacao?: string; cnpj?: string;
  parcelas: P[];
}

const ACORDOS: Acordo[] = [
  {
    // Contrato v5: R$ 56.000 = R$ 8.000 de entrada + 12 x R$ 4.000, a 1ª 30 dias depois da assinatura (27/10).
    cliente: 'Senhor aGranel', produto: 'Operação ROOT', valor: 56000, partnerId: '7fe7f957-5bb6-4ff8-8576-8096c6a21a10',
    apelidos: 'Felipe Fortes,SR A GRANEL', fechadoEm: '2026-10-27', cnpj: '35.751.273/0001-52',
    observacao: 'Contrato v5: R$ 8.000 de entrada + 12 x R$ 4.000 no boleto, dia 26 (parcelamento no Asaas).',
    parcelas: [{ valor: 8000, vence: '2026-10-29', paga: '2026-10-28' }, ...mensais(12, 4000, '2026-11-26')],
  },
  {
    // Contrato final: R$ 4.000 de entrada (21/10) + 5 x 1.333,33 + 1.333,35, todo dia 20.
    id: 'a4a3b64a-5308-4d8d-a80b-341f677a296a',
    cliente: 'Custeio', produto: 'Operação ROOT (upsell)', valor: 12000, partnerId: '263e3543-9149-43e1-821a-f7cec4224c0a',
    apelidos: 'upsell,CUSTEIO TECHNOLOGY', cnpj: '06.236.539/0001-20',
    parcelas: [{ valor: 4000, vence: '2026-10-20', paga: '2026-10-21' }, ...mensais(6, 1333.33, '2026-11-20', 1333.35)],
  },
  {
    // Imersão no cartão em 3x, juros por conta do cliente (3 x 1.024,67).
    id: '4c0d0925-2737-43bd-b66b-8d5368dfd935',
    cliente: 'Custeio (Lucas Moreira)', produto: 'Imersão ROOT', valor: 2997, partnerId: '263e3543-9149-43e1-821a-f7cec4224c0a',
    apelidos: 'Lucas Martins,Lucas Moreira',
    parcelas: [
      { valor: 1024.67, vence: '2026-09-02', paga: '2026-09-28' },
      { valor: 1024.67, vence: '2026-10-02', paga: '2026-10-29' },
      { valor: 1024.67, vence: '2026-11-02' },
    ],
  },
  {
    // Cartão em 10 x R$ 397, aprovado em 20/10; o Asaas repassa mês a mês.
    id: '8e808bfb-195b-4b2c-b329-94d1ae1496f7',
    cliente: 'Affari', produto: 'Imersão ROOT', valor: 3970, partnerId: '25e335f5-ca8a-4adc-9fb8-9ff5d8268838',
    apelidos: 'Affari,Antonio f junior',
    parcelas: mensais(10, 397, '2026-10-20'),
  },
  {
    // Contrato v2: R$ 5.000 de entrada (28/10) + R$ 5.000 na entrega; 10/12 é a data que o Lucas definiu.
    cliente: 'Papeleira Santa Rita', produto: 'Operação ROOT', valor: 10000, partnerId: '4cb564ea-c08b-47f5-8875-197299e1b661',
    apelidos: 'Bruno Bressan', fechadoEm: '2026-10-27', cnpj: '10.671.781/0001-08',
    observacao: 'Contrato v2: saldo em até 48h do encontro 4 (no máximo 30 dias do 1º encontro, 27/10). Data de 10/12 definida pelo Lucas. No Asaas o cliente é o Bruno (CPF).',
    parcelas: [{ valor: 5000, vence: '2026-10-29', paga: '2026-10-28' }, { valor: 5000, vence: '2026-12-10' }],
  },
  {
    // Contrato v3: R$ 4.500 = R$ 2.250 em até 48h da assinatura + R$ 2.250 em até 30 dias.
    cliente: 'Juma Consultoria Ambiental', produto: 'Imersão ROOT', valor: 4500, partnerId: '665c5a9d-911d-4c7a-b5b2-119346b12993',
    apelidos: 'Juma,Tarcilla',
    observacao: 'Contrato v3: 2 x R$ 2.250. Vencimento da parcela 2 PROVISÓRIO (30/11) até saber a data da assinatura.',
    parcelas: [{ valor: 2250, vence: '2026-11-02' }, { valor: 2250, vence: '2026-11-30', nota: 'PROVISÓRIO: 30 dias da assinatura, data a confirmar' }],
  },
  {
    // Quitado: R$ 6.000 em 11/09 + R$ 6.000 em 16/10 (o contrato previa 10/11).
    id: '4e47575a-d1aa-4be0-b12e-bb6c006ff3cc',
    cliente: 'ProMedical', produto: 'Operação ROOT', valor: 12000, partnerId: '13347e2c-34be-4f31-a88f-4ffe7e7ffd1e', apelidos: 'Promedical',
    parcelas: [{ valor: 6000, vence: '2026-09-11', paga: '2026-09-11' }, { valor: 6000, vence: '2026-11-10', paga: '2026-10-16' }],
  },
  {
    // Implantação quitada pelo extrato: R$ 3.501 em 07/07 e R$ 4.200 em 09/09 (confirmar a de 07/07).
    // A mensalidade de R$ 190 é conta fixa (contrato 34583b96), não parcela.
    id: 'c97abc97-57ee-4834-aeac-8880eb6a6650',
    cliente: 'Curral', produto: 'Sistema de gestão de contas (implantação)', valor: 7700, partnerId: '8d845fbf-91bc-44d4-9480-9f0bde82d266', apelidos: 'Meroto',
    parcelas: [
      { valor: 3501, vence: '2026-07-07', paga: '2026-07-07', nota: 'confirmar: no extrato veio como "Lucas Fernandes De Oliveira"' },
      { valor: 4200, vence: '2026-09-09', paga: '2026-09-09' },
    ],
  },
];

/** Previstos manuais que um acordo ou uma conta fixa passou a cobrir. */
const ABSORVIDOS = [
  { id: 'e59bca69-4a45-44d3-a19e-9e33eb05dcb5', motivo: 'Papeleira: virou a parcela 2/2 do acordo' },
  { id: 'c77fe5a1-2b1c-46a1-a4a6-c5cb9acc6a3e', motivo: 'Hostinger: virou conta fixa anual' },
];

const HOSTINGER = {
  descricao: 'Hostinger — VPS (plano anual)', valor: 599.88, diaVencimento: 15, periodicidade: 'anual',
  partnerId: '218928ac-2da5-43f3-989c-a850cc18c72d', accountId: '1fd67d05-69a7-47ee-8263-9457e3079640',
  chartAccountId: '99dd7855-ef0e-47a7-be25-ae0a5d0ff4d5', inicio: '2027-09-15',
};

const fala = (s: string) => console.log(`${APLICAR ? '' : '[simulação] '}${s}`);
const brl = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

async function main() {
  if (!orgId) throw new Error('uso: tsx prisma/financeiro-tese-carga.ts <orgId> [--aplicar]');

  for (const a of ACORDOS) {
    const soma = a.parcelas.reduce((s, p) => s + p.valor, 0);
    let acordo = a.id
      ? await prisma.acordoComercial.findFirst({ where: { id: a.id, orgId } })
      : await prisma.acordoComercial.findFirst({ where: { orgId, cliente: a.cliente } });
    if (a.id && !acordo) throw new Error(`Acordo ${a.cliente} (${a.id}) não existe nesta empresa.`);
    if (!acordo) {
      fala(`+ acordo ${a.cliente} — ${a.produto}, R$ ${brl(a.valor)}`);
      if (APLICAR) {
        acordo = await prisma.acordoComercial.create({
          data: {
            orgId, cliente: a.cliente, produto: a.produto, valor: new Prisma.Decimal(a.valor), tipo: 'pagante',
            apelidos: a.apelidos, observacao: a.observacao ?? null, partnerId: a.partnerId,
            fechadoEm: a.fechadoEm ? dia(a.fechadoEm) : null,
          },
        });
      }
    } else if (a.apelidos && acordo.apelidos !== a.apelidos) {
      fala(`~ acordo ${a.cliente}: apelidos "${acordo.apelidos ?? ''}" → "${a.apelidos}"`);
      if (APLICAR) await prisma.acordoComercial.update({ where: { id: acordo.id }, data: { apelidos: a.apelidos } });
    }
    if (a.cnpj) {
      const parceiro = await prisma.partner.findFirst({ where: { id: a.partnerId, orgId }, select: { cnpjCpf: true, razaoSocial: true } });
      if (!parceiro) throw new Error(`Parceiro ${a.partnerId} não existe.`);
      if (!parceiro.cnpjCpf) {
        fala(`~ cadastro ${parceiro.razaoSocial}: CNPJ ${a.cnpj}`);
        if (APLICAR) await prisma.partner.update({ where: { id: a.partnerId }, data: { cnpjCpf: a.cnpj } });
      }
    }
    const atuais = acordo ? await prisma.acordoParcela.findMany({ where: { acordoId: acordo.id } }) : [];
    for (const [i, p] of a.parcelas.entries()) {
      const numero = i + 1;
      const atual = atuais.find((x) => x.numero === numero);
      const rotulo = `${a.cliente} ${numero}/${a.parcelas.length}: R$ ${brl(p.valor)} vence ${p.vence}${p.paga ? `, paga ${p.paga}` : ''}${p.nota ? ` (${p.nota})` : ''}`;
      if (!atual) {
        fala(`  + parcela ${rotulo}`);
        if (APLICAR && acordo) {
          await prisma.acordoParcela.create({
            data: { orgId, acordoId: acordo.id, numero, valor: new Prisma.Decimal(p.valor), vencimento: dia(p.vence), pagaEm: p.paga ? dia(p.paga) : null },
          });
        }
      } else if (!atual.asaasPaymentId && !atual.recebimentoId && (Number(atual.valor) !== p.valor || atual.vencimento.toISOString().slice(0, 10) !== p.vence)) {
        fala(`  ~ parcela ${rotulo}`);
        if (APLICAR) await prisma.acordoParcela.update({ where: { id: atual.id }, data: { valor: new Prisma.Decimal(p.valor), vencimento: dia(p.vence) } });
      }
      if (atual && p.paga && !atual.pagaEm) {
        fala(`  ~ parcela ${a.cliente} ${numero}: paga em ${p.paga}`);
        if (APLICAR) await prisma.acordoParcela.update({ where: { id: atual.id }, data: { pagaEm: dia(p.paga) } });
      }
    }
    if (Math.abs(soma - a.valor) > 0.05) fala(`  ! ${a.cliente}: parcelas somam R$ ${brl(soma)}, o acordo é de R$ ${brl(a.valor)}`);
  }

  // Conta fixa anual da Hostinger.
  const h = await prisma.contract.findFirst({ where: { orgId, descricao: { startsWith: 'Hostinger' }, status: 'ativo' } });
  if (!h) {
    fala(`+ conta fixa ${HOSTINGER.descricao}: R$ ${brl(HOSTINGER.valor)} por ano, dia ${HOSTINGER.diaVencimento}, a partir de ${HOSTINGER.inicio}`);
    if (APLICAR) {
      await prisma.contract.create({
        data: {
          orgId, tipo: 'saida', descricao: HOSTINGER.descricao, valor: new Prisma.Decimal(HOSTINGER.valor),
          diaVencimento: HOSTINGER.diaVencimento, periodicidade: HOSTINGER.periodicidade, partnerId: HOSTINGER.partnerId,
          accountId: HOSTINGER.accountId, chartAccountId: HOSTINGER.chartAccountId,
          dataInicio: dia(HOSTINGER.inicio), proximoVencimento: dia(HOSTINGER.inicio),
        },
      });
    }
  }

  for (const x of ABSORVIDOS) {
    const t = await prisma.financeTransaction.findFirst({ where: { id: x.id, orgId, status: 'previsto', source: 'manual' }, select: { description: true, amount: true } });
    if (!t) continue;
    fala(`- previsto manual "${t.description}" (R$ ${brl(Number(t.amount))}): ${x.motivo}`);
    if (APLICAR) await prisma.financeTransaction.delete({ where: { id: x.id } });
  }

  if (APLICAR) {
    await materializarParcelas(prisma as never, orgId);
    fala('parcelas sem cobrança viraram previsto "a gerar"; o próximo sync do Asaas veste as que já têm cobrança.');
  }

  const sobra = await prisma.financeTransaction.findMany({
    where: { orgId, status: 'previsto', source: 'manual', contractId: null },
    select: { description: true, amount: true, dueDate: true, type: true },
  });
  console.log(`\nPrevistos manuais que continuam (avulsas): ${sobra.length}`);
  for (const s of sobra) console.log(`  ${s.type} ${s.dueDate?.toISOString().slice(0, 10)} R$ ${brl(Number(s.amount))} ${s.description}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
