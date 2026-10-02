import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import type { ZodError } from 'zod';
import type { GerarContratoResposta } from '@mktos/shared';
import { AuditService } from '../src/audit/audit.service';
import { AprService, idDoLancamentoDeContrato } from '../src/finance/apr.service';
import { FinanceService } from '../src/finance/finance.service';
import { FinanceController } from '../src/finance/finance.controller';
import type { FinopsService } from '../src/finance/finops.service';
import type { ConciliacaoService } from '../src/finance/conciliacao.service';
import type { AsaasService } from '../src/finance/asaas.service';
import type { PluggyService } from '../src/finance/pluggy.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { comTenantNaSessao } from '../src/prisma/sessao-de-banco';
import { comContexto } from '../src/common/contexto-execucao';
import { ZodExceptionFilter } from '../src/common/zod-exception.filter';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * ==========================================================================
 * FINANCEIRO: GERAR LANÇAMENTO DE CONTRATO E REFERÊNCIAS ENTRE EMPRESAS
 * (ROOT-02, lacunas C1 e P2; ROOT-06, condição E28)
 * ==========================================================================
 *
 * C1. "Gerar" lê o contrato, cria o lançamento previsto do vencimento e avança
 * o vencimento. Duas chamadas pelo mesmo vencimento não podem criar dois
 * lançamentos dele, e uma falha no meio não pode deixar lançamento sem avanço,
 * avanço sem lançamento ou lançamento sem linha de auditoria.
 *
 * E28. O pedido diz qual vencimento quer, e o lançamento desse vencimento tem
 * id fixo. Repetir o pedido de um vencimento já gerado devolve o mesmo
 * lançamento com `replayed: true`, sem escrita nem auditoria nova: é a resposta
 * que se perdeu depois do commit, o segundo clique e a chamada que perdeu a
 * corrida. Vencimento que não é o próximo do contrato e não tem lançamento
 * recebe 409.
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
 * queda de conexão não é injetada: o próprio Postgres derruba a sessão que
 * está esperando uma trava.
 *
 * A seção do papel restrito (login sem BYPASSRLS, membro de `mktos_app`, no
 * mesmo banco) só existe com `TENANT_DATABASE_URL`:
 *
 *   TEST_DATABASE_URL='postgresql://<dono>@localhost:<porta>/<banco_test>' \
 *   TENANT_DATABASE_URL='postgresql://<login restrito>@localhost:<porta>/<banco_test>' \
 *     pnpm --filter @mktos/api exec vitest run test/finance-contrato-e-empresa.test.ts
 */

const URL = process.env.TEST_DATABASE_URL;
const URL_RESTRITA = process.env.TENANT_DATABASE_URL;
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

/** Quantas chamadas gravaram, quantas devolveram o lançamento já gravado, os ids devolvidos e as recusas. */
function desfecho(resultados: PromiseSettledResult<GerarContratoResposta>[]) {
  const respostas = resultados.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  return {
    gravaram: respostas.filter((r) => !r.replayed).length,
    repetiram: respostas.filter((r) => r.replayed).length,
    ids: [...new Set(respostas.map((r) => r.transactionId))],
    recusas: resultados.flatMap((r) => (r.status === 'rejected' ? [formaDoErro(r.reason)] : [])),
  };
}

/** A mesma conta de meses do serviço, em hora local. */
function maisMeses(iso: string, meses: number): string {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + meses);
  return d.toISOString();
}

/** A chamada da rota: o corpo leva o vencimento que quem chama viu na lista. */
function gerar(svc: AprService, contratoId: string, vencimento: string, orgId = CASA) {
  return svc.gerarContrato(orgId, contratoId, { vencimento }, EU);
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

const VENCIMENTO_NAO_E_O_PROXIMO = {
  status: 409,
  mensagem: 'O vencimento pedido não é o próximo deste contrato. Atualize a lista antes de gerar.',
};

class FalhaInjetada extends Error {}
const FALHA_INJETADA = { status: null, mensagem: 'FalhaInjetada' };

type Chamada = (args: unknown) => Promise<unknown>;
/** Devolve a substituta de `modelo.operacao`, ou nulo para deixar a original. */
type Troca = (modelo: string, operacao: string, original: Chamada) => Chamada | null;

/**
 * Um cliente do Prisma com algumas operações trocadas. Vale também para o
 * cliente que `$transaction` entrega ao corpo da transação, porque é ali que
 * a geração escreve.
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

// --------------------------------------------------------------------------
// Sem banco: o id do lançamento e a leitura do corpo na rota
// --------------------------------------------------------------------------
describe('o id do lançamento gerado de um vencimento', () => {
  it('é um UUID fixo por empresa, contrato e instante do vencimento', () => {
    const base = idDoLancamentoDeContrato('org-a', 'c-1', new Date(V0));
    expect({
      formato: /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(base),
      deNovo: idDoLancamentoDeContrato('org-a', 'c-1', new Date(V0)) === base,
      mesmoInstanteComFuso: idDoLancamentoDeContrato('org-a', 'c-1', new Date('2026-11-09T21:00:00-03:00')) === base,
      outraEmpresa: idDoLancamentoDeContrato('org-b', 'c-1', new Date(V0)) === base,
      outroContrato: idDoLancamentoDeContrato('org-a', 'c-2', new Date(V0)) === base,
      outroVencimento: idDoLancamentoDeContrato('org-a', 'c-1', new Date(V1)) === base,
    }).toEqual({
      formato: true, deNovo: true, mesmoInstanteComFuso: true, outraEmpresa: false, outroContrato: false, outroVencimento: false,
    });
  });

  it('não muda de construção: mudar o hash faria o replay de todo lançamento já gerado cair no 409', () => {
    // Valor calculado à parte com sha256("org-a\0lancamento-de-contrato\0c-1\0" + V0),
    // 16 bytes, versão 5 e variante RFC 4122.
    expect(idDoLancamentoDeContrato('org-a', 'c-1', new Date(V0))).toBe('01915205-78da-56fb-8535-b6d0fae1f2c3');
  });
});

describe('a rota de gerar lê o vencimento do corpo', () => {
  const usuario = { sub: EU, orgId: CASA } as never;

  function controller() {
    const chamadas: unknown[][] = [];
    const apr = {
      gerarContrato: async (...args: unknown[]) => {
        chamadas.push(args);
        return { ok: true };
      },
    } as unknown as AprService;
    const c = new FinanceController({} as FinanceService, {} as FinopsService, apr, {} as ConciliacaoService);
    return { c, chamadas };
  }

  /** O status e o corpo que o filtro global da API (`main.ts`) daria ao erro. */
  function respostaHttp(erro: unknown) {
    let status = 0;
    let corpo: unknown;
    const res = { status: (s: number) => ((status = s), { json: (b: unknown) => (corpo = b) }) };
    new ZodExceptionFilter().catch(erro as ZodError, { switchToHttp: () => ({ getResponse: () => res }) } as never);
    return { status, corpo };
  }

  it('sem corpo, sem vencimento ou com vencimento que não é data e hora: 400, e o serviço não é chamado', () => {
    const { c, chamadas } = controller();
    const corpos = [undefined, {}, { vencimento: '' }, { vencimento: '2026-11-10' }, { vencimento: 'amanhã' }, { vencimento: 20261110 }];
    const respostas = corpos.map((corpo) => {
      try {
        void c.gerarContrato(usuario, 'c-1', corpo);
        return 'aceito';
      } catch (e) {
        return respostaHttp(e).status;
      }
    });
    let semVencimento: unknown;
    try {
      void c.gerarContrato(usuario, 'c-1', {});
    } catch (e) {
      semVencimento = respostaHttp(e).corpo;
    }
    expect({ respostas, semVencimento, chamadas }).toEqual({
      respostas: Array(corpos.length).fill(400),
      semVencimento: { statusCode: 400, error: 'ValidationError', issues: [{ path: 'vencimento', message: 'Required' }] },
      chamadas: [],
    });
  });

  it('vencimento em ISO, com ou sem fuso, chega ao serviço como veio; campo a mais é descartado', async () => {
    const { c, chamadas } = controller();
    await c.gerarContrato(usuario, 'c-1', { vencimento: V0 });
    await c.gerarContrato(usuario, 'c-1', { vencimento: '2026-11-09T21:00:00-03:00', outro: 'x' });
    expect(chamadas).toEqual([
      [CASA, 'c-1', { vencimento: V0 }, EU],
      [CASA, 'c-1', { vencimento: '2026-11-09T21:00:00-03:00' }, EU],
    ]);
  });
});

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
  function comBarreiraNaLeitura(participantes: number, cliente: object = prisma) {
    let leram = 0;
    let soltar!: () => void;
    const todasLeram = new Promise<void>((r) => (soltar = r));
    const comBarreira = interceptado(cliente, (modelo, operacao, original) =>
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
    return { svc: aprSobre(comBarreira), leram: () => leram };
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
  // C1 e E28: geração concorrente pelo mesmo vencimento
  // ------------------------------------------------------------------------
  describe('chamadas concorrentes pelo mesmo vencimento', () => {
    it('duas chamadas: um lançamento, um avanço, uma linha de auditoria, e a outra recebe o mesmo lançamento', async () => {
      const id = await novoContrato();
      const barreira = comBarreiraNaLeitura(2);
      const resultados = await Promise.allSettled([gerar(barreira.svc, id, V0), gerar(barreira.svc, id, V0)]);
      expect({ leram: barreira.leram(), ...desfecho(resultados), ...(await estadoDo(id)) }).toEqual({
        leram: 2, gravaram: 1, repetiram: 1, ids: [idDoLancamentoDeContrato(CASA, id, new Date(V0))], recusas: [],
        vencimentos: [V0], proximoVencimento: V1, auditoria: 1,
      });
    });

    it('oito chamadas com barreira (critério 3): um lançamento, uma auditoria, e nenhum 409 para quem pediu o vencimento gravado', async () => {
      const id = await novoContrato();
      const barreira = comBarreiraNaLeitura(8);
      const resultados = await Promise.allSettled(Array.from({ length: 8 }, () => gerar(barreira.svc, id, V0)));
      expect({ leram: barreira.leram(), ...desfecho(resultados), ...(await estadoDo(id)) }).toEqual({
        leram: 8, gravaram: 1, repetiram: 7, ids: [idDoLancamentoDeContrato(CASA, id, new Date(V0))], recusas: [],
        vencimentos: [V0], proximoVencimento: V1, auditoria: 1,
      });
    });

    it('corrida livre, cinco rodadas de oito pelo vencimento lido antes de cada rodada: um lançamento por rodada e nenhum 409', async () => {
      const id = await novoContrato();
      const rodadas = [];
      for (let rodada = 0; rodada < 5; rodada++) {
        const { proximoVencimento } = await estadoDo(id);
        const r = desfecho(await Promise.allSettled(Array.from({ length: 8 }, () => gerar(apr, id, proximoVencimento))));
        rodadas.push({ gravaram: r.gravaram, repetiram: r.repetiram, ids: r.ids.length, recusas: r.recusas });
      }
      expect({ rodadas, ...(await estadoDo(id)) }).toEqual({
        rodadas: Array(5).fill({ gravaram: 1, repetiram: 7, ids: 1, recusas: [] }),
        vencimentos: Array.from({ length: 5 }, (_, i) => maisMeses(V0, i)),
        proximoVencimento: maisMeses(V0, 5),
        auditoria: 5,
      });
    }, 30_000);

    it('a vencedora falha depois de avançar: quem esperava a trava gera o vencimento, sem replay falso', async () => {
      // A primeira auditoria a ser gravada falha. Quem chega nela é quem
      // segura a linha do contrato; a outra chamada espera, vê o avanço
      // desfeito e grava ela mesma.
      const id = await novoContrato();
      let leram = 0;
      let soltar!: () => void;
      const todasLeram = new Promise<void>((r) => (soltar = r));
      let auditorias = 0;
      const cliente = interceptado(prisma, (modelo, operacao, original) => {
        if (modelo === 'contract' && operacao === 'findFirst') {
          return async (args) => {
            const lido = await original(args);
            leram += 1;
            if (leram >= 2) soltar();
            await todasLeram;
            return lido;
          };
        }
        if (modelo === 'auditLog' && operacao === 'create') {
          return (args) => (auditorias++ === 0 ? Promise.reject(new FalhaInjetada('auditoria da vencedora')) : original(args));
        }
        return null;
      });
      const svc = aprSobre(cliente);
      const resultados = await Promise.allSettled([gerar(svc, id, V0), gerar(svc, id, V0)]);
      expect({ leram, ...desfecho(resultados), ...(await estadoDo(id)) }).toEqual({
        leram: 2, gravaram: 1, repetiram: 0, ids: [idDoLancamentoDeContrato(CASA, id, new Date(V0))], recusas: [FALHA_INJETADA],
        vencimentos: [V0], proximoVencimento: V1, auditoria: 1,
      });
    });

    it('chave primária repetida no INSERT: o avanço é desfeito e a resposta é o lançamento que já está gravado', async () => {
      // Nenhum fluxo de hoje chega aqui sem passar pelo avanço condicional. O
      // teste grava o lançamento por fora, na hora do avanço, só para exercitar
      // o ramo do P2002.
      const id = await novoContrato();
      const transactionId = idDoLancamentoDeContrato(CASA, id, new Date(V0));
      const cliente = interceptado(prisma, (modelo, operacao, original) =>
        modelo === 'contract' && operacao === 'updateMany'
          ? async (args) => {
              const avancou = await original(args);
              await segurador.financeTransaction.create({
                data: {
                  id: transactionId, orgId: CASA, accountId: casa.conta, contractId: id, type: 'saida', status: 'previsto',
                  description: 'gravado por fora', amount: new Prisma.Decimal('1500.00'), date: new Date(V0), dueDate: new Date(V0),
                },
              });
              return avancou;
            }
          : null,
      );
      expect({ resposta: await gerar(aprSobre(cliente), id, V0), ...(await estadoDo(id)) }).toEqual({
        resposta: { ok: true, transactionId, proximoVencimento: V1, replayed: true },
        vencimentos: [V0], proximoVencimento: V0, auditoria: 0,
      });
    });
  });

  // ------------------------------------------------------------------------
  // E28: repetir o pedido de um vencimento
  // ------------------------------------------------------------------------
  describe('repetir o pedido de um vencimento (E28)', () => {
    it('resposta perdida depois do commit (critério 1): a repetição devolve o mesmo lançamento, sem escrita nem auditoria nova', async () => {
      const id = await novoContrato();
      const primeira = await gerar(apr, id, V0); // a resposta que o cliente não viu
      const depoisDoCommit = await estadoDo(id);
      const repeticao = await gerar(apr, id, V0);
      expect({ primeira, depoisDoCommit, repeticao, final: await estadoDo(id) }).toEqual({
        primeira: { ok: true, transactionId: idDoLancamentoDeContrato(CASA, id, new Date(V0)), proximoVencimento: V1, replayed: false },
        depoisDoCommit: { vencimentos: [V0], proximoVencimento: V1, auditoria: 1 },
        repeticao: { ...primeira, replayed: true },
        final: { vencimentos: [V0], proximoVencimento: V1, auditoria: 1 },
      });
    });

    it('duplo clique (critério 2): em sequência e com o segundo saindo antes de o primeiro voltar, um lançamento só', async () => {
      const emSequencia = await novoContrato();
      const a = await gerar(apr, emSequencia, V0);
      const b = await gerar(apr, emSequencia, V0);
      const sobrepostos = await novoContrato();
      const juntos = desfecho(await Promise.allSettled([gerar(apr, sobrepostos, V0), gerar(apr, sobrepostos, V0)]));
      expect({
        emSequencia: [a.replayed, b.replayed, a.transactionId === b.transactionId], estadoEmSequencia: await estadoDo(emSequencia),
        juntos: { gravaram: juntos.gravaram, repetiram: juntos.repetiram, ids: juntos.ids.length, recusas: juntos.recusas },
        estadoJuntos: await estadoDo(sobrepostos),
      }).toEqual({
        emSequencia: [false, true, true], estadoEmSequencia: { vencimentos: [V0], proximoVencimento: V1, auditoria: 1 },
        juntos: { gravaram: 1, repetiram: 1, ids: 1, recusas: [] },
        estadoJuntos: { vencimentos: [V0], proximoVencimento: V1, auditoria: 1 },
      });
    });

    it('vencimento pedido diferente do atual e sem lançamento (critério 4): 409 e nada gravado', async () => {
      const id = await novoContrato();
      const antes = await fotografia();
      expect({
        futuro: await erroDe(gerar(apr, id, V1)),
        passadoNuncaGerado: await erroDe(gerar(apr, id, maisMeses(V0, -1))),
        gravado: await fotografia(),
        estado: await estadoDo(id),
      }).toEqual({
        futuro: VENCIMENTO_NAO_E_O_PROXIMO,
        passadoNuncaGerado: VENCIMENTO_NAO_E_O_PROXIMO,
        gravado: antes,
        estado: { vencimentos: [], proximoVencimento: V0, auditoria: 0 },
      });
    });

    it('depois de gerar novembro e dezembro, pedir novembro (critério 5) devolve o lançamento de novembro, nunca janeiro', async () => {
      const id = await novoContrato();
      const novembro = await gerar(apr, id, V0);
      await gerar(apr, id, V1);
      const deNovo = await gerar(apr, id, V0);
      expect({ deNovo, estado: await estadoDo(id) }).toEqual({
        deNovo: { ...novembro, replayed: true },
        estado: { vencimentos: [V0, V1], proximoVencimento: V2, auditoria: 2 },
      });
    });

    it('replay depois de pausar o contrato (critério 6): replayed; o vencimento seguinte continua recusado', async () => {
      const id = await novoContrato();
      const primeira = await gerar(apr, id, V0);
      await prisma.contract.update({ where: { id }, data: { status: 'pausado' } });
      expect({
        repeticao: await gerar(apr, id, V0),
        seguinte: await erroDe(gerar(apr, id, V1)),
        estado: await estadoDo(id),
      }).toEqual({
        repeticao: { ...primeira, replayed: true },
        seguinte: { status: 400, mensagem: 'Contrato não está ativo' },
        estado: { vencimentos: [V0], proximoVencimento: V1, auditoria: 1 },
      });
    });

    it('pedido de outra empresa (critério 7): o 404 do contrato inexistente, sem o id do lançamento', async () => {
      const id = await novoContrato();
      const { transactionId } = await gerar(apr, id, V0);
      const antes = await fotografia();
      let respostaDaVizinha = '';
      const daVizinha = await erroDe(
        gerar(apr, id, V0, VIZINHA).catch((e: unknown) => {
          respostaDaVizinha = JSON.stringify(e instanceof HttpException ? e.getResponse() : e);
          throw e;
        }),
      );
      expect({
        daVizinha,
        revelaOLancamento: respostaDaVizinha.includes(transactionId),
        inexistente: await erroDe(gerar(apr, randomUUID(), V0)),
        gravado: await fotografia(),
      }).toEqual({ daVizinha: NAO_ENCONTRADO.contrato, revelaOLancamento: false, inexistente: NAO_ENCONTRADO.contrato, gravado: antes });
    });

    it('o mesmo instante escrito com fuso é o mesmo vencimento: devolve o lançamento gravado', async () => {
      const id = await novoContrato();
      const primeira = await gerar(apr, id, V0);
      expect({ comFuso: await gerar(apr, id, '2026-11-09T21:00:00-03:00'), estado: await estadoDo(id) }).toEqual({
        comFuso: { ...primeira, replayed: true },
        estado: { vencimentos: [V0], proximoVencimento: V1, auditoria: 1 },
      });
    });
  });

  describe('o fluxo válido continua igual', () => {
    it('em sequência, cada chamada gera o vencimento seguinte, com valor exato, datas e auditoria', async () => {
      const id = await novoContrato({ valor: new Prisma.Decimal('987654321.99') });
      const respostas = [];
      for (const v of [V0, V1, V2]) respostas.push(await gerar(apr, id, v));
      const lancamentos = await prisma.financeTransaction.findMany({ where: { contractId: id }, orderBy: { dueDate: 'asc' } });
      const auditoria = await prisma.auditLog.findMany({
        where: { action: 'finance.contract.generate', entityId: id }, orderBy: { createdAt: 'asc' },
      });
      expect({
        respostas,
        lancamentos: lancamentos.map((l) => ({
          id: l.id, orgId: l.orgId, accountId: l.accountId, chartAccountId: l.chartAccountId, partnerId: l.partnerId,
          type: l.type, status: l.status, description: l.description, amount: l.amount.toFixed(2),
          date: l.date.toISOString(), dueDate: l.dueDate?.toISOString(), source: l.source, approvalStatus: l.approvalStatus,
        })),
        auditoria: auditoria.map((a) => ({
          orgId: a.orgId, actorType: a.actorType, actorId: a.actorId, entityType: a.entityType, after: a.after,
        })),
        proximoVencimento: (await estadoDo(id)).proximoVencimento,
      }).toEqual({
        respostas: [V0, V1, V2].map((v, i) => ({
          ok: true, transactionId: idDoLancamentoDeContrato(CASA, id, new Date(v)), proximoVencimento: [V1, V2, V3][i], replayed: false,
        })),
        lancamentos: [V0, V1, V2].map((v) => ({
          id: idDoLancamentoDeContrato(CASA, id, new Date(v)),
          orgId: CASA, accountId: casa.conta, chartAccountId: casa.plano, partnerId: casa.parceiro,
          type: 'saida', status: 'previsto', description: 'Aluguel do escritório (contrato)', amount: '987654321.99',
          date: v, dueDate: v, source: 'manual', approvalStatus: 'aguardando',
        })),
        auditoria: [V0, V1, V2].map((v) => ({
          orgId: CASA, actorType: 'user', actorId: EU, entityType: 'contract',
          after: { transactionId: idDoLancamentoDeContrato(CASA, id, new Date(v)), vencimento: v },
        })),
        proximoVencimento: V3,
      });
    });

    it('contrato de receber trimestral abaixo do limite: não pede aprovação e avança três meses', async () => {
      const id = await novoContrato({ tipo: 'entrada', valor: new Prisma.Decimal('1234.56'), periodicidade: 'trimestral' });
      const resposta = await gerar(apr, id, V0);
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
        pausado: await erroDe(gerar(apr, pausado, V0)),
        semConta: await erroDe(gerar(apr, semConta, V0)),
        estados: [await estadoDo(pausado), await estadoDo(semConta)],
      }).toEqual({
        pausado: { status: 400, mensagem: 'Contrato não está ativo' },
        semConta: { status: 400, mensagem: 'Contrato sem conta bancária definida' },
        estados: Array(2).fill({ vencimentos: [], proximoVencimento: V0, auditoria: 0 }),
      });
    });
  });

  describe('o que continua fora desta garantia', () => {
    it('lançamento gerado antes do id fixo (id aleatório): repetir o vencimento dele dá 409, sem gravar', async () => {
      const id = await novoContrato({ proximoVencimento: new Date(V1) });
      await prisma.financeTransaction.create({
        data: {
          orgId: CASA, accountId: casa.conta, contractId: id, type: 'saida', status: 'previsto',
          description: 'Aluguel do escritório (contrato)', amount: new Prisma.Decimal('1500.00'), date: new Date(V0), dueDate: new Date(V0),
        },
      });
      const antes = await fotografia();
      expect({ erro: await erroDe(gerar(apr, id, V0)), gravado: await fotografia() }).toEqual({
        erro: VENCIMENTO_NAO_E_O_PROXIMO, gravado: antes,
      });
    });

    it('título apagado depois de gerado (a conciliação apaga o título): repetir o vencimento dá 409, sem gravar', async () => {
      const id = await novoContrato();
      const { transactionId } = await gerar(apr, id, V0);
      await prisma.financeTransaction.delete({ where: { id: transactionId } });
      const antes = await fotografia();
      expect({ erro: await erroDe(gerar(apr, id, V0)), gravado: await fotografia(), estado: await estadoDo(id) }).toEqual({
        erro: VENCIMENTO_NAO_E_O_PROXIMO, gravado: antes, estado: { vencimentos: [], proximoVencimento: V1, auditoria: 1 },
      });
    });
  });

  describe('falha no meio da geração (critério 8): nada fica pela metade, e repetir o vencimento grava uma vez', () => {
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
      const erro = await erroDe(gerar(falha.svc, id, V0));
      const depoisDaFalha = await estadoDo(id);
      const repetida = await gerar(apr, id, V0);
      const outraVez = await gerar(apr, id, V0);
      expect({
        disparou: falha.disparou(), erro, depoisDaFalha, repetida: repetida.replayed, outraVez: outraVez.replayed,
        depoisDeRepetir: await estadoDo(id),
      }).toEqual({
        disparou: 1,
        erro: FALHA_INJETADA,
        depoisDaFalha: { vencimentos: [], proximoVencimento: V0, auditoria: 0 },
        repetida: false,
        outraVez: true,
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
          const geracao = erroDe(gerar(aprSobre(vitima), id, V0));
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
        const repetida = await erroDe(gerar(apr, id, V0));
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
  // Critério 10: o mesmo caminho sob o papel restrito, com o proxy da aplicação
  // ------------------------------------------------------------------------
  /*
   * Entra por `if`, e não por `describe.skipIf`: o job `qualidade` da CI não
   * tem `TENANT_DATABASE_URL` e reprova a suíte com qualquer caso pulado (o
   * mesmo motivo de `rastro-retencao.test.ts`).
   */
  if (URL_RESTRITA) {
    describe('sob o papel restrito, com o proxy da aplicação (critério 10)', () => {
      let cru: PrismaClient;
      let app: PrismaClient;
      // `await` dentro do escopo: a PrismaPromise é preguiçosa e, devolvida crua, rodaria fora do contexto.
      const na = <T>(orgId: string, fn: () => Promise<T>) =>
        comContexto({ orgId, correlationId: randomUUID(), origem: 'http', actorType: 'user', actorId: EU }, async () => await fn());

      beforeAll(async () => {
        cru = new PrismaClient({ datasources: { db: { url: URL_RESTRITA } } });
        await cru.$connect();
        app = comTenantNaSessao(cru, { modo: 'impor', avisar: () => undefined });
      });

      afterAll(async () => {
        if (cru) await cru.$disconnect();
      });

      it('o login não atravessa a policy: sem empresa não vê contrato, com a casa vê só os da casa', async () => {
        const [papel] = await cru.$queryRaw<Array<{ superusuario: boolean; atravessa: boolean }>>`
          SELECT r.rolsuper AS superusuario, r.rolbypassrls AS atravessa FROM pg_roles r WHERE r.rolname = current_user`;
        expect({
          papel,
          semDeclarar: await cru.contract.count(),
          daCasa: await na(CASA, () => app.contract.count()),
          semContexto: await erroDe(app.contract.count()),
        }).toEqual({
          papel: { superusuario: false, atravessa: false },
          semDeclarar: 0,
          daCasa: await prisma.contract.count({ where: { orgId: CASA } }),
          semContexto: { status: null, mensagem: 'SemTenantError' },
        });
      });

      it('critério 1: resposta perdida e repetição devolvem o mesmo lançamento, sem escrita nova', async () => {
        const id = await novoContrato();
        const svc = aprSobre(app);
        const primeira = await na(CASA, () => gerar(svc, id, V0));
        const repeticao = await na(CASA, () => gerar(svc, id, V0));
        const lancamentos = await prisma.financeTransaction.findMany({ where: { contractId: id } });
        expect({ primeira, repeticao, orgs: lancamentos.map((l) => l.orgId), estado: await estadoDo(id) }).toEqual({
          primeira: { ok: true, transactionId: idDoLancamentoDeContrato(CASA, id, new Date(V0)), proximoVencimento: V1, replayed: false },
          repeticao: { ...primeira, replayed: true },
          orgs: [CASA],
          estado: { vencimentos: [V0], proximoVencimento: V1, auditoria: 1 },
        });
      });

      it('critério 3: oito chamadas concorrentes com barreira, um lançamento, uma auditoria e nenhum 409', async () => {
        const id = await novoContrato();
        const barreira = comBarreiraNaLeitura(8, app);
        const resultados = await Promise.allSettled(Array.from({ length: 8 }, () => na(CASA, () => gerar(barreira.svc, id, V0))));
        expect({ leram: barreira.leram(), ...desfecho(resultados), ...(await estadoDo(id)) }).toEqual({
          leram: 8, gravaram: 1, repetiram: 7, ids: [idDoLancamentoDeContrato(CASA, id, new Date(V0))], recusas: [],
          vencimentos: [V0], proximoVencimento: V1, auditoria: 1,
        });
      });
    });
  }

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
        const erro = await erroDe(gerar(apr, id, V0));
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
        daVizinha: await erroDe(gerar(apr, vizinha.contrato, V0)),
        inexistente: await erroDe(gerar(apr, randomUUID(), V0)),
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
