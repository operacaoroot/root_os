import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AuditService } from '../src/audit/audit.service';
import { AprService } from '../src/finance/apr.service';
import { FinanceService } from '../src/finance/finance.service';
import type { AsaasService } from '../src/finance/asaas.service';
import type { PluggyService } from '../src/finance/pluggy.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * ==========================================================================
 * FINANCEIRO: GERAR LANÇAMENTO DE CONTRATO E REFERÊNCIAS ENTRE EMPRESAS
 * (ROOT-02, lacunas C1 e P2)
 * ==========================================================================
 *
 * C1. "Gerar" lê o contrato, cria o lançamento previsto do vencimento lido e
 * avança o vencimento. Duas chamadas que leem o mesmo vencimento não podem
 * criar dois lançamentos dele, e uma falha no meio não pode deixar lançamento
 * sem avanço, avanço sem lançamento ou lançamento sem linha de auditoria.
 *
 * P2. Contrato e lançamento apontam conta bancária, plano de contas,
 * parceiro, contrato, departamento, projeto e o rateio. A chave estrangeira só
 * confere que o id existe em alguma empresa, e a conexão da API é dona das
 * tabelas, que o isolamento por linha não alcança. Id de outra empresa tem de
 * ser recusado antes de qualquer escrita, com o mesmo erro de um id que não
 * existe: um erro diferente contaria a quem pergunta que o id existe na
 * vizinha.
 *
 * A concorrência é real: chamadas em paralelo contra o Postgres, em conexões
 * diferentes da fila do Prisma. Duas coisas aqui são montagem de teste, e não
 * comportamento do serviço: a BARREIRA, que segura cada chamada logo depois de
 * ler o contrato até todas lerem (é o que torna a corrida reproduzível), e a
 * FALHA INJETADA, que faz uma operação do Prisma lançar no meio da geração. A
 * queda de conexão do último bloco não é injetada: o próprio Postgres derruba
 * a sessão que está esperando uma trava.
 */

const URL = process.env.TEST_DATABASE_URL;
const CASA = 'org-teste-financeiro-casa';
const VIZINHA = 'org-teste-financeiro-vizinha';
const EMPRESAS = [CASA, VIZINHA];
const EU = 'u-financeiro-casa';

exigirBancoDescartavel(
  URL ?? '',
  'ESCREVE nele (duas empresas, contas, contratos, lançamentos e auditoria) e derruba sessões que esperam trava dela',
);

// Vencimentos de novembro a fevereiro: nenhum fuso comum troca de horário de
// verão nesse intervalo, então a conta de meses do serviço (em hora local) cai
// sempre na meia-noite UTC do dia 10.
const V0 = '2026-11-10T00:00:00.000Z';
const V1 = '2026-12-10T00:00:00.000Z';
const V2 = '2027-01-10T00:00:00.000Z';
const V3 = '2027-02-10T00:00:00.000Z';

type Erro = { status: number | null; mensagem: string } | 'sem erro';

/** O erro numa forma comparável; erro que não é HTTP vira classe + código. */
function formaDoErro(e: unknown): Erro {
  if (e instanceof HttpException) return { status: e.getStatus(), mensagem: e.message };
  const codigo = (e as { code?: unknown }).code;
  return { status: null, mensagem: [(e as Error).constructor.name, codigo].filter(Boolean).join(' ') };
}

async function erroDe(chamada: Promise<unknown>): Promise<Erro> {
  try {
    await chamada;
    return 'sem erro';
  } catch (e) {
    return formaDoErro(e);
  }
}

function placar(resultados: PromiseSettledResult<unknown>[]) {
  return {
    sucessos: resultados.filter((r) => r.status === 'fulfilled').length,
    recusas: resultados.flatMap((r) => (r.status === 'rejected' ? [formaDoErro(r.reason)] : [])),
  };
}

/** A mesma conta de meses do serviço, em hora local. */
function maisMeses(iso: string, meses: number): string {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + meses);
  return d.toISOString();
}

const NAO_ENCONTRADO = {
  conta: { status: 404, mensagem: 'Conta não encontrada' },
  categoria: { status: 404, mensagem: 'Categoria não encontrada' },
  plano: { status: 404, mensagem: 'Conta do plano de contas não encontrada' },
  parceiro: { status: 404, mensagem: 'Parceiro (fornecedor/cliente) não encontrado' },
  contrato: { status: 404, mensagem: 'Contrato não encontrado' },
  departamento: { status: 404, mensagem: 'Departamento não encontrado' },
  projeto: { status: 404, mensagem: 'Projeto não encontrado' },
} as const;

const JA_GERADO = {
  status: 409,
  mensagem: 'Este vencimento do contrato já foi gerado por outra chamada. Atualize a lista antes de gerar o próximo.',
};

class FalhaInjetada extends Error {}
const FALHA_INJETADA = { status: null, mensagem: 'FalhaInjetada' };

type Chamada = (args: unknown) => Promise<unknown>;
/** Devolve a substituta de `modelo.operacao`, ou nulo para deixar a original. */
type Troca = (modelo: string, operacao: string, original: Chamada) => Chamada | null;

/**
 * Um cliente do Prisma com algumas operações trocadas. Vale também para o
 * cliente que `$transaction` entrega ao corpo da transação, porque é ali que
 * a geração corrigida escreve.
 */
function interceptado(cliente: object, troca: Troca): object {
  return new Proxy(cliente, {
    get(alvo, prop) {
      const valor: unknown = Reflect.get(alvo, prop);
      if (prop === '$transaction' && typeof valor === 'function') {
        return (arg: unknown, opcoes?: unknown) =>
          typeof arg === 'function'
            ? valor.call(alvo, (tx: object) => (arg as (c: object) => unknown)(interceptado(tx, troca)), opcoes)
            : valor.call(alvo, arg, opcoes);
      }
      if (typeof prop === 'string' && !prop.startsWith('$') && !prop.startsWith('_') && valor && typeof valor === 'object') {
        return new Proxy(valor, {
          get(delegado, operacao) {
            const fn: unknown = Reflect.get(delegado, operacao);
            if (typeof fn !== 'function' || typeof operacao !== 'string') return fn;
            const original: Chamada = (args) => fn.call(delegado, args) as Promise<unknown>;
            return troca(prop, operacao, original) ?? fn.bind(delegado);
          },
        });
      }
      return typeof valor === 'function' ? valor.bind(alvo) : valor;
    },
  });
}

describe.skipIf(!URL)('financeiro: gerar lançamento de contrato e referências entre empresas', () => {
  let prisma: PrismaClient;
  let segurador: PrismaClient;
  let apr: AprService;
  let fin: FinanceService;

  type Ids = Record<'conta' | 'categoria' | 'plano' | 'parceiro' | 'departamento' | 'projeto' | 'contrato', string>;
  let casa: Ids;
  let vizinha: Ids;

  const aprSobre = (cliente: object) => {
    const p = cliente as unknown as PrismaService;
    return new AprService(p, new AuditService(p));
  };

  /**
   * Segura cada `contract.findFirst` até `participantes` chamadas terem lido o
   * contrato. `leram` diz quantas passaram pela barreira, para o teste provar
   * que ela de fato segurou alguém.
   */
  function comBarreiraNaLeitura(participantes: number) {
    let leram = 0;
    let soltar!: () => void;
    const todasLeram = new Promise<void>((r) => (soltar = r));
    const cliente = interceptado(prisma, (modelo, operacao, original) =>
      modelo === 'contract' && operacao === 'findFirst'
        ? async (args) => {
            const lido = await original(args);
            leram += 1;
            if (leram >= participantes) soltar();
            await todasLeram;
            return lido;
          }
        : null,
    );
    return { svc: aprSobre(cliente), leram: () => leram };
  }

  /** Faz lançar a operação que `falhaAqui` apontar; `disparou` conta quantas vezes lançou. */
  function comFalha(falhaAqui: (modelo: string, operacao: string, args: unknown) => boolean) {
    let disparou = 0;
    const cliente = interceptado(prisma, (modelo, operacao, original) => (args) => {
      if (!falhaAqui(modelo, operacao, args)) return original(args);
      disparou += 1;
      return Promise.reject(new FalhaInjetada(`falha injetada em ${modelo}.${operacao}`));
    });
    return { svc: aprSobre(cliente), disparou: () => disparou };
  }

  async function limparTudo() {
    const orgId = { in: EMPRESAS };
    await prisma.financeTransaction.deleteMany({ where: { orgId } });
    await prisma.transactionSplit.deleteMany({ where: { orgId } });
    await prisma.contract.deleteMany({ where: { orgId } });
    await prisma.auditLog.deleteMany({ where: { orgId } });
    await prisma.partner.deleteMany({ where: { orgId } });
    await prisma.departamento.deleteMany({ where: { orgId } });
    await prisma.projeto.deleteMany({ where: { orgId } });
    await prisma.chartAccount.deleteMany({ where: { orgId } });
    await prisma.financeCategory.deleteMany({ where: { orgId } });
    await prisma.financeAccount.deleteMany({ where: { orgId } });
  }

  async function semear(orgId: string, rotulo: string): Promise<Ids> {
    const conta = await prisma.financeAccount.create({ data: { orgId, name: `Conta da ${rotulo}` } });
    const categoria = await prisma.financeCategory.create({ data: { orgId, name: `Categoria da ${rotulo}`, kind: 'despesa' } });
    const plano = await prisma.chartAccount.create({
      data: { orgId, codigo: '4.1.01', nome: `Despesa da ${rotulo}`, tipo: 'despesa', nivel: 3, permiteLancamento: true },
    });
    const parceiro = await prisma.partner.create({ data: { orgId, razaoSocial: `Fornecedor da ${rotulo}`, isFornecedor: true } });
    const departamento = await prisma.departamento.create({ data: { orgId, nome: `Departamento da ${rotulo}` } });
    const projeto = await prisma.projeto.create({ data: { orgId, nome: `Projeto da ${rotulo}` } });
    const contrato = await prisma.contract.create({
      data: {
        orgId, tipo: 'saida', descricao: `Contrato da ${rotulo}`, valor: new Prisma.Decimal('100.00'), diaVencimento: 10,
        accountId: conta.id, dataInicio: new Date(V0), proximoVencimento: new Date(V0),
      },
    });
    return {
      conta: conta.id, categoria: categoria.id, plano: plano.id, parceiro: parceiro.id,
      departamento: departamento.id, projeto: projeto.id, contrato: contrato.id,
    };
  }

  /** Contrato ativo da casa, gravado direto no banco, vencendo em V0. */
  async function novoContrato(dados: Partial<Prisma.ContractUncheckedCreateInput> = {}): Promise<string> {
    const c = await prisma.contract.create({
      data: {
        orgId: CASA, tipo: 'saida', descricao: 'Aluguel do escritório', valor: new Prisma.Decimal('1500.00'),
        diaVencimento: 10, periodicidade: 'mensal', accountId: casa.conta, chartAccountId: casa.plano,
        partnerId: casa.parceiro, dataInicio: new Date(V0), proximoVencimento: new Date(V0), ...dados,
      },
    });
    return c.id;
  }

  /** Vencimentos dos lançamentos do contrato, em ordem; o próximo vencimento; quantas linhas de auditoria a geração deixou. */
  async function estadoDo(contratoId: string) {
    const c = await prisma.contract.findUniqueOrThrow({ where: { id: contratoId } });
    const lancamentos = await prisma.financeTransaction.findMany({
      where: { contractId: contratoId }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    });
    return {
      vencimentos: lancamentos.map((l) => l.dueDate?.toISOString() ?? null),
      proximoVencimento: c.proximoVencimento.toISOString(),
      auditoria: await prisma.auditLog.count({ where: { action: 'finance.contract.generate', entityId: contratoId } }),
    };
  }

  /** Quantas linhas cada empresa tem em cada tabela que estes caminhos escrevem. */
  async function fotografia() {
    const daEmpresa = async (orgId: string) => ({
      contratos: await prisma.contract.count({ where: { orgId } }),
      lancamentos: await prisma.financeTransaction.count({ where: { orgId } }),
      rateios: await prisma.transactionSplit.count({ where: { orgId } }),
      auditoria: await prisma.auditLog.count({ where: { orgId } }),
    });
    return { casa: await daEmpresa(CASA), vizinha: await daEmpresa(VIZINHA) };
  }

  /** Nomes de cadastro da vizinha que aparecem nas leituras financeiras da casa. */
  async function nomesDaVizinhaLidosPelaCasa() {
    const nomes = [
      ...(await apr.listContracts(CASA)).items.map((c) => c.partnerName),
      ...(await apr.payables(CASA)).items.map((p) => p.partnerName),
      ...(await fin.listTransactions(CASA, {})).items.flatMap((t) => [t.accountName, t.partnerName, t.categoryName]),
    ];
    return nomes.filter((n): n is string => typeof n === 'string' && n.includes('vizinha'));
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    segurador = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    await segurador.$connect();
    apr = aprSobre(prisma);
    const p = prisma as unknown as PrismaService;
    // Pluggy e Asaas só servem à sincronização bancária, que esta suíte não chama.
    fin = new FinanceService(p, new AuditService(p), {} as PluggyService, {} as AsaasService);

    for (const orgId of EMPRESAS) {
      await prisma.org.upsert({ where: { id: orgId }, create: { id: orgId, name: orgId, slug: orgId }, update: {} });
    }
    await limparTudo();
    casa = await semear(CASA, 'casa');
    vizinha = await semear(VIZINHA, 'vizinha');
  });

  afterAll(async () => {
    if (prisma) {
      await limparTudo();
      await prisma.org.deleteMany({ where: { id: { in: EMPRESAS } } });
      await prisma.$disconnect();
    }
    if (segurador) await segurador.$disconnect();
  });

  // ------------------------------------------------------------------------
  // C1: geração concorrente
  // ------------------------------------------------------------------------
  describe('chamadas concorrentes que leram o mesmo vencimento', () => {
    it('duas chamadas: um lançamento, um avanço, uma linha de auditoria, e a outra ouve 409', async () => {
      const id = await novoContrato();
      const barreira = comBarreiraNaLeitura(2);
      const resultados = await Promise.allSettled([
        barreira.svc.gerarContrato(CASA, id, EU),
        barreira.svc.gerarContrato(CASA, id, EU),
      ]);
      expect({ leram: barreira.leram(), ...placar(resultados), ...(await estadoDo(id)) }).toEqual({
        leram: 2, sucessos: 1, recusas: [JA_GERADO], vencimentos: [V0], proximoVencimento: V1, auditoria: 1,
      });
    });

    it('oito chamadas: continua um lançamento só, e as sete outras ouvem 409', async () => {
      const id = await novoContrato();
      const barreira = comBarreiraNaLeitura(8);
      const resultados = await Promise.allSettled(Array.from({ length: 8 }, () => barreira.svc.gerarContrato(CASA, id, EU)));
      expect({ leram: barreira.leram(), ...placar(resultados), ...(await estadoDo(id)) }).toEqual({
        leram: 8, sucessos: 1, recusas: Array(7).fill(JA_GERADO), vencimentos: [V0], proximoVencimento: V1, auditoria: 1,
      });
    });

    it('quem ouviu 409 e repete gera o vencimento SEGUINTE: a rota não tem chave de idempotência', async () => {
      // É o limite da garantia, escrito como caso para ninguém tratar o 409
      // como "pode repetir à vontade".
      const id = await novoContrato();
      const barreira = comBarreiraNaLeitura(2);
      const disputa = placar(await Promise.allSettled([
        barreira.svc.gerarContrato(CASA, id, EU),
        barreira.svc.gerarContrato(CASA, id, EU),
      ]));
      const repeticao = await apr.gerarContrato(CASA, id, EU);
      expect({ disputa, repeticao: repeticao.proximoVencimento, estado: await estadoDo(id) }).toEqual({
        disputa: { sucessos: 1, recusas: [JA_GERADO] },
        repeticao: V2,
        estado: { vencimentos: [V0, V1], proximoVencimento: V2, auditoria: 2 },
      });
    });

    it('corrida livre, cinco rodadas de oito: nunca dois lançamentos no mesmo vencimento, e um avanço por lançamento', async () => {
      // Sem barreira, uma chamada que lê depois do commit da vencedora gera o
      // vencimento seguinte, e isso está certo. O que não pode é repetir data.
      const id = await novoContrato();
      let sucessos = 0;
      const recusas: Erro[] = [];
      for (let rodada = 0; rodada < 5; rodada++) {
        const p = placar(await Promise.allSettled(Array.from({ length: 8 }, () => apr.gerarContrato(CASA, id, EU))));
        sucessos += p.sucessos;
        recusas.push(...p.recusas);
      }
      expect({
        recusasQueNaoSao409: recusas.filter((e) => e === 'sem erro' || e.status !== 409),
        ...(await estadoDo(id)),
      }).toEqual({
        recusasQueNaoSao409: [],
        vencimentos: Array.from({ length: sucessos }, (_, i) => maisMeses(V0, i)),
        proximoVencimento: maisMeses(V0, sucessos),
        auditoria: sucessos,
      });
      expect(sucessos).toBeGreaterThanOrEqual(5);
    }, 30_000);
  });

  describe('o fluxo válido continua igual', () => {
    it('em sequência, cada chamada gera o vencimento seguinte, com valor exato, datas e auditoria', async () => {
      const id = await novoContrato({ valor: new Prisma.Decimal('987654321.99') });
      const respostas = [];
      for (let i = 0; i < 3; i++) respostas.push(await apr.gerarContrato(CASA, id, EU));
      const lancamentos = await prisma.financeTransaction.findMany({ where: { contractId: id }, orderBy: { dueDate: 'asc' } });
      const auditoria = await prisma.auditLog.findMany({
        where: { action: 'finance.contract.generate', entityId: id }, orderBy: { createdAt: 'asc' },
      });
      expect({
        respostas,
        lancamentos: lancamentos.map((l) => ({
          orgId: l.orgId, accountId: l.accountId, chartAccountId: l.chartAccountId, partnerId: l.partnerId,
          type: l.type, status: l.status, description: l.description, amount: l.amount.toFixed(2),
          date: l.date.toISOString(), dueDate: l.dueDate?.toISOString(), source: l.source, approvalStatus: l.approvalStatus,
        })),
        auditoria: auditoria.map((a) => ({
          orgId: a.orgId, actorType: a.actorType, actorId: a.actorId, entityType: a.entityType, after: a.after,
        })),
        proximoVencimento: (await estadoDo(id)).proximoVencimento,
      }).toEqual({
        respostas: lancamentos.map((l, i) => ({ ok: true, transactionId: l.id, proximoVencimento: [V1, V2, V3][i] })),
        lancamentos: [V0, V1, V2].map((v) => ({
          orgId: CASA, accountId: casa.conta, chartAccountId: casa.plano, partnerId: casa.parceiro,
          type: 'saida', status: 'previsto', description: 'Aluguel do escritório (contrato)', amount: '987654321.99',
          date: v, dueDate: v, source: 'manual', approvalStatus: 'aguardando',
        })),
        auditoria: lancamentos.map((l, i) => ({
          orgId: CASA, actorType: 'user', actorId: EU, entityType: 'contract',
          after: { transactionId: l.id, vencimento: [V0, V1, V2][i] },
        })),
        proximoVencimento: V3,
      });
    });

    it('contrato de receber trimestral abaixo do limite: não pede aprovação e avança três meses', async () => {
      const id = await novoContrato({ tipo: 'entrada', valor: new Prisma.Decimal('1234.56'), periodicidade: 'trimestral' });
      const resposta = await apr.gerarContrato(CASA, id, EU);
      const [l] = await prisma.financeTransaction.findMany({ where: { contractId: id } });
      expect({
        proximo: resposta.proximoVencimento, amount: l.amount.toFixed(2), type: l.type, approvalStatus: l.approvalStatus,
        estado: await estadoDo(id),
      }).toEqual({
        proximo: V3, amount: '1234.56', type: 'entrada', approvalStatus: 'nao_requer',
        estado: { vencimentos: [V0], proximoVencimento: V3, auditoria: 1 },
      });
    });

    it('contrato pausado ou sem conta bancária continua recusado sem gravar', async () => {
      const pausado = await novoContrato({ status: 'pausado' });
      const semConta = await novoContrato({ accountId: null });
      expect({
        pausado: await erroDe(apr.gerarContrato(CASA, pausado, EU)),
        semConta: await erroDe(apr.gerarContrato(CASA, semConta, EU)),
        estados: [await estadoDo(pausado), await estadoDo(semConta)],
      }).toEqual({
        pausado: { status: 400, mensagem: 'Contrato não está ativo' },
        semConta: { status: 400, mensagem: 'Contrato sem conta bancária definida' },
        estados: Array(2).fill({ vencimentos: [], proximoVencimento: V0, auditoria: 0 }),
      });
    });
  });

  describe('falha no meio da geração: nada fica pela metade, e repetir gera um lançamento só', () => {
    const PASSOS: Array<[string, (modelo: string, operacao: string, args: unknown) => boolean]> = [
      ['ao avançar o vencimento', (m, op) => m === 'contract' && (op === 'update' || op === 'updateMany')],
      ['ao gravar o lançamento', (m, op) => m === 'financeTransaction' && op === 'create'],
      [
        'ao gravar a auditoria',
        (m, op, args) => m === 'auditLog' && op === 'create'
          && (args as { data?: { action?: string } } | undefined)?.data?.action === 'finance.contract.generate',
      ],
    ];

    it.each(PASSOS)('falha %s', async (_, falhaAqui) => {
      const id = await novoContrato();
      const falha = comFalha(falhaAqui);
      const erro = await erroDe(falha.svc.gerarContrato(CASA, id, EU));
      const depoisDaFalha = await estadoDo(id);
      const repetida = await erroDe(apr.gerarContrato(CASA, id, EU));
      expect({ disparou: falha.disparou(), erro, depoisDaFalha, repetida, depoisDeRepetir: await estadoDo(id) }).toEqual({
        disparou: 1,
        erro: FALHA_INJETADA,
        depoisDaFalha: { vencimentos: [], proximoVencimento: V0, auditoria: 0 },
        repetida: 'sem erro',
        depoisDeRepetir: { vencimentos: [V0], proximoVencimento: V1, auditoria: 1 },
      });
    });
  });

  describe('conexão derrubada no meio da geração (pg_terminate_backend na sessão que espera a trava)', () => {
    /**
     * Abre uma transação no `segurador`, prende uma linha e roda `durante` com
     * o pid dessa sessão. A trava só sai quando `durante` termina.
     */
    async function comLinhaPresa<T>(trava: Prisma.Sql, durante: (pidQuePrende: number) => Promise<T>): Promise<T> {
      return segurador.$transaction(async (tx) => {
        const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        await tx.$queryRaw(trava);
        return durante(pid);
      }, { timeout: 30_000 });
    }

    /** Espera uma sessão ficar presa atrás de `pidQuePrende` e diz qual comando ela está rodando. */
    async function sessaoPresa(pidQuePrende: number) {
      for (let tentativa = 0; tentativa < 500; tentativa++) {
        const presas = await prisma.$queryRaw<Array<{ pid: number; comando: string }>>`
          SELECT pid, substring(query from '^[^ ]+ [^ ]+ [^ ]+') AS comando
            FROM pg_stat_activity WHERE ${pidQuePrende}::int = ANY(pg_blocking_pids(pid))`;
        if (presas.length === 1) return presas[0];
        if (presas.length > 1) throw new Error(`${presas.length} sessões presas atrás do pid ${pidQuePrende}; esperava uma`);
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`nenhuma sessão ficou esperando a trava do pid ${pidQuePrende}`);
    }

    /**
     * Se alguém já escreveu na linha do contrato sem terminar a transação.
     * FOR NO KEY UPDATE convive com a trava que a conferência de chave
     * estrangeira põe na linha e só bate com outra escrita nela.
     */
    async function contratoComEscritaPendente(id: string): Promise<boolean> {
      try {
        await prisma.$queryRaw`SELECT id FROM "Contract" WHERE id = ${id} FOR NO KEY UPDATE NOWAIT`;
        return false;
      } catch (e) {
        if (String((e as Error).message).includes('55P03')) return true;
        throw e;
      }
    }

    async function geracaoDerrubada(trava: (id: string) => Prisma.Sql, sondarContrato: boolean) {
      const id = await novoContrato();
      // A chamada derrubada usa um cliente só dela. O Prisma só descobre que a
      // conexão morreu na consulta seguinte que a pegar da fila, e essa
      // consulta não pode ser a do teste nem a da repetição.
      const vitima = new PrismaClient({ datasources: { db: { url: URL } } });
      try {
        const { erro, onde } = await comLinhaPresa(trava(id), async (pidQuePrende) => {
          const geracao = erroDe(aprSobre(vitima).gerarContrato(CASA, id, EU));
          const presa = await sessaoPresa(pidQuePrende);
          const ondeParou = {
            presaEm: presa.comando,
            ...(sondarContrato ? { avancoPendente: await contratoComEscritaPendente(id) } : {}),
          };
          await prisma.$queryRaw`SELECT pg_terminate_backend(${presa.pid}::int)`;
          return { erro: await geracao, onde: ondeParou };
        });
        console.info(`[queda] ${JSON.stringify({ ...onde, erro })}`);
        const depoisDaQueda = await estadoDo(id);
        const repetida = await erroDe(apr.gerarContrato(CASA, id, EU));
        return { onde, caiu: erro !== 'sem erro', depoisDaQueda, repetida, depoisDeRepetir: await estadoDo(id) };
      } finally {
        await vitima.$disconnect();
      }
    }

    const SEM_NADA_E_DEPOIS_UM = {
      caiu: true,
      depoisDaQueda: { vencimentos: [], proximoVencimento: V0, auditoria: 0 },
      repetida: 'sem erro',
      depoisDeRepetir: { vencimentos: [V0], proximoVencimento: V1, auditoria: 1 },
    };

    it('presa ao avançar o vencimento (linha do contrato travada): nada fica gravado', async () => {
      // FOR NO KEY UPDATE deixa passar a conferência da chave estrangeira do
      // lançamento e segura só a escrita no próprio contrato.
      const { onde, ...r } = await geracaoDerrubada(
        (id) => Prisma.sql`SELECT id FROM "Contract" WHERE id = ${id} FOR NO KEY UPDATE`,
        false,
      );
      expect({ ...onde, ...r }).toEqual({ presaEm: 'UPDATE "public"."Contract" SET', ...SEM_NADA_E_DEPOIS_UM });
    }, 30_000);

    it('presa ao gravar o lançamento, já depois de avançar (linha da empresa travada): o avanço é desfeito', async () => {
      // FOR UPDATE na empresa segura a conferência de chave estrangeira do
      // lançamento; o avanço do contrato não passa por ela. `avancoPendente`
      // confirma, antes da queda, que a sessão presa já tinha escrito no
      // contrato sem confirmar.
      const { onde, ...r } = await geracaoDerrubada(
        () => Prisma.sql`SELECT id FROM "Org" WHERE id = ${CASA} FOR UPDATE`,
        true,
      );
      expect({ ...onde, ...r }).toEqual({
        presaEm: 'INSERT INTO "public"."FinanceTransaction"', avancoPendente: true, ...SEM_NADA_E_DEPOIS_UM,
      });
    }, 30_000);
  });

  // ------------------------------------------------------------------------
  // P2: referências de outra empresa
  // ------------------------------------------------------------------------
  describe('criar contrato com referência de outra empresa', () => {
    const contratoValido = () => ({
      tipo: 'saida' as const, descricao: 'Contrato com referência', valor: 300, diaVencimento: 5,
      periodicidade: 'mensal' as const, partnerId: casa.parceiro, accountId: casa.conta, chartAccountId: casa.plano,
      dataInicio: '2026-11-01',
    });
    const CASOS: Array<[string, 'partnerId' | 'accountId' | 'chartAccountId', keyof Ids, keyof typeof NAO_ENCONTRADO]> = [
      ['parceiro', 'partnerId', 'parceiro', 'parceiro'],
      ['conta bancária', 'accountId', 'conta', 'conta'],
      ['plano de contas', 'chartAccountId', 'plano', 'plano'],
    ];

    it.each(CASOS)('%s da vizinha: o mesmo 404 do id inexistente, nada gravado, nada lido', async (_, campo, daVizinha, esperado) => {
      const antes = await fotografia();
      const lidoAntes = await nomesDaVizinhaLidosPelaCasa();
      try {
        const comVizinha = await erroDe(apr.createContract(CASA, { ...contratoValido(), [campo]: vizinha[daVizinha] }, EU));
        const comInexistente = await erroDe(apr.createContract(CASA, { ...contratoValido(), [campo]: randomUUID() }, EU));
        expect({
          comVizinha, comInexistente, gravado: await fotografia(), lidoPelaCasa: await nomesDaVizinhaLidosPelaCasa(),
        }).toEqual({
          comVizinha: NAO_ENCONTRADO[esperado], comInexistente: NAO_ENCONTRADO[esperado], gravado: antes, lidoPelaCasa: lidoAntes,
        });
      } finally {
        // Só tem o que apagar quando a recusa falta: não deixa um caso contaminar o seguinte.
        await prisma.contract.deleteMany({ where: { orgId: CASA, descricao: 'Contrato com referência' } });
      }
    });
  });

  describe('criar lançamento com referência de outra empresa', () => {
    const lancamentoValido = () => ({
      accountId: casa.conta, categoryId: casa.categoria, chartAccountId: casa.plano, partnerId: casa.parceiro,
      contractId: casa.contrato, departamentoId: casa.departamento, projetoId: casa.projeto,
      type: 'saida' as const, status: 'previsto' as const, description: 'Lançamento com referência', amount: 100, date: '2026-11-20',
      splits: [{ valor: 60, chartAccountId: casa.plano }, { valor: 40, departamentoId: casa.departamento, projetoId: casa.projeto }],
    });
    type Campo = 'accountId' | 'categoryId' | 'chartAccountId' | 'partnerId' | 'contractId' | 'departamentoId' | 'projetoId';
    const noCorpo = (campo: Campo, id: string) => ({ ...lancamentoValido(), [campo]: id });
    const noRateio = (campo: 'chartAccountId' | 'departamentoId' | 'projetoId', id: string) => {
      const corpo = lancamentoValido();
      return { ...corpo, splits: [corpo.splits[0], { ...corpo.splits[1], [campo]: id }] };
    };
    type Montagem = (id: string) => ReturnType<typeof lancamentoValido>;
    const CASOS: Array<[string, Montagem, keyof Ids, keyof typeof NAO_ENCONTRADO]> = [
      ['conta bancária', (id) => noCorpo('accountId', id), 'conta', 'conta'],
      ['categoria', (id) => noCorpo('categoryId', id), 'categoria', 'categoria'],
      ['plano de contas', (id) => noCorpo('chartAccountId', id), 'plano', 'plano'],
      ['parceiro', (id) => noCorpo('partnerId', id), 'parceiro', 'parceiro'],
      ['contrato', (id) => noCorpo('contractId', id), 'contrato', 'contrato'],
      ['departamento', (id) => noCorpo('departamentoId', id), 'departamento', 'departamento'],
      ['projeto', (id) => noCorpo('projetoId', id), 'projeto', 'projeto'],
      ['plano de contas no rateio', (id) => noRateio('chartAccountId', id), 'plano', 'plano'],
      ['departamento no rateio', (id) => noRateio('departamentoId', id), 'departamento', 'departamento'],
      ['projeto no rateio', (id) => noRateio('projetoId', id), 'projeto', 'projeto'],
    ];

    it.each(CASOS)('%s da vizinha: o mesmo 404 do id inexistente, e nada gravado', async (_, montar, daVizinha, esperado) => {
      const antes = await fotografia();
      const lidoAntes = await nomesDaVizinhaLidosPelaCasa();
      try {
        const comVizinha = await erroDe(fin.createTransaction(CASA, montar(vizinha[daVizinha]), EU));
        const comInexistente = await erroDe(fin.createTransaction(CASA, montar(randomUUID()), EU));
        expect({
          comVizinha, comInexistente, gravado: await fotografia(), lidoPelaCasa: await nomesDaVizinhaLidosPelaCasa(),
        }).toEqual({
          comVizinha: NAO_ENCONTRADO[esperado], comInexistente: NAO_ENCONTRADO[esperado], gravado: antes, lidoPelaCasa: lidoAntes,
        });
      } finally {
        await prisma.financeTransaction.deleteMany({ where: { orgId: CASA, description: 'Lançamento com referência' } });
      }
    });
  });

  describe('gerar a partir de contrato que já aponta para a vizinha (dado gravado antes da conferência)', () => {
    const CASOS: Array<[string, 'accountId' | 'partnerId' | 'chartAccountId', keyof Ids, keyof typeof NAO_ENCONTRADO]> = [
      ['conta bancária', 'accountId', 'conta', 'conta'],
      ['parceiro', 'partnerId', 'parceiro', 'parceiro'],
      ['plano de contas', 'chartAccountId', 'plano', 'plano'],
    ];

    it.each(CASOS)('%s da vizinha: recusa antes de gravar e a casa não lê o nome da vizinha', async (_, campo, daVizinha, esperado) => {
      const id = await novoContrato({ [campo]: vizinha[daVizinha] });
      const antes = await fotografia();
      // O contrato antigo já aparece na lista de contratos; o que a geração não
      // pode fazer é levar o nome da vizinha para lançamento e contas a pagar.
      const lidoAntes = await nomesDaVizinhaLidosPelaCasa();
      try {
        const erro = await erroDe(apr.gerarContrato(CASA, id, EU));
        expect({
          erro, gravado: await fotografia(), estado: await estadoDo(id), lidoPelaCasa: await nomesDaVizinhaLidosPelaCasa(),
        }).toEqual({
          erro: NAO_ENCONTRADO[esperado], gravado: antes,
          estado: { vencimentos: [], proximoVencimento: V0, auditoria: 0 }, lidoPelaCasa: lidoAntes,
        });
      } finally {
        await prisma.financeTransaction.deleteMany({ where: { contractId: id } });
        await prisma.contract.delete({ where: { id } });
      }
    });

    it('contrato da vizinha pelo id: o mesmo 404 do contrato inexistente', async () => {
      const antes = await fotografia();
      expect({
        daVizinha: await erroDe(apr.gerarContrato(CASA, vizinha.contrato, EU)),
        inexistente: await erroDe(apr.gerarContrato(CASA, randomUUID(), EU)),
        gravado: await fotografia(),
      }).toEqual({ daVizinha: NAO_ENCONTRADO.contrato, inexistente: NAO_ENCONTRADO.contrato, gravado: antes });
    });
  });

  describe('os mesmos vínculos dentro da empresa continuam valendo', () => {
    it('contrato e lançamento com rateio, tudo da casa, gravam como antes', async () => {
      const contrato = await apr.createContract(CASA, {
        tipo: 'saida', descricao: 'Consultoria', valor: 2500.5, diaVencimento: 31, periodicidade: 'mensal',
        partnerId: casa.parceiro, accountId: casa.conta, chartAccountId: casa.plano, dataInicio: '2026-11-15',
      }, EU);
      const inicio = new Date('2026-11-15');
      const prox = new Date(inicio.getFullYear(), inicio.getMonth(), 28);
      if (prox < inicio) prox.setMonth(prox.getMonth() + 1);

      const lancamento = await fin.createTransaction(CASA, {
        accountId: casa.conta, categoryId: casa.categoria, chartAccountId: casa.plano, partnerId: casa.parceiro,
        contractId: contrato.id, departamentoId: casa.departamento, projetoId: casa.projeto,
        type: 'saida', status: 'previsto', description: 'Rateado', amount: 100.1, date: '2026-11-20',
        splits: [
          { valor: 60.05, chartAccountId: casa.plano, departamentoId: casa.departamento },
          { valor: 40.05, projetoId: casa.projeto },
        ],
      }, EU);

      const c = await prisma.contract.findUniqueOrThrow({ where: { id: contrato.id } });
      const t = await prisma.financeTransaction.findUniqueOrThrow({ where: { id: lancamento.id }, include: { splits: true } });
      expect({
        contrato: {
          orgId: c.orgId, partnerId: c.partnerId, accountId: c.accountId, chartAccountId: c.chartAccountId,
          valor: c.valor.toFixed(2), diaVencimento: c.diaVencimento, proximoVencimento: c.proximoVencimento.toISOString(),
        },
        lancamento: {
          orgId: t.orgId, contractId: t.contractId, departamentoId: t.departamentoId, projetoId: t.projetoId,
          amount: t.amount.toFixed(2), temRateio: t.temRateio, approvalStatus: lancamento.approvalStatus,
          rateio: t.splits
            .map((s) => ({ orgId: s.orgId, chartAccountId: s.chartAccountId, departamentoId: s.departamentoId, projetoId: s.projetoId, valor: s.valor.toFixed(2) }))
            .sort((a, b) => a.valor.localeCompare(b.valor)),
        },
        auditoria: await prisma.auditLog.count({
          where: { orgId: CASA, OR: [{ entityId: contrato.id, action: 'finance.contract.create' }, { entityId: lancamento.id, action: 'finance.tx.create' }] },
        }),
        nomeDoParceiroNaLista: (await apr.listContracts(CASA)).items.find((i) => i.id === contrato.id)?.partnerName,
      }).toEqual({
        contrato: {
          orgId: CASA, partnerId: casa.parceiro, accountId: casa.conta, chartAccountId: casa.plano,
          valor: '2500.50', diaVencimento: 31, proximoVencimento: prox.toISOString(),
        },
        lancamento: {
          orgId: CASA, contractId: contrato.id, departamentoId: casa.departamento, projetoId: casa.projeto,
          amount: '100.10', temRateio: true, approvalStatus: 'nao_requer',
          rateio: [
            { orgId: CASA, chartAccountId: null, departamentoId: null, projetoId: casa.projeto, valor: '40.05' },
            { orgId: CASA, chartAccountId: casa.plano, departamentoId: casa.departamento, projetoId: null, valor: '60.05' },
          ],
        },
        auditoria: 2,
        nomeDoParceiroNaLista: 'Fornecedor da casa',
      });
    });
  });
});
