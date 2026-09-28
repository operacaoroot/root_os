import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import {
  ActorType,
  EstadoDeAgente,
  AgentTipo,
  PrismaClient,
  RiskLevel,
  SessionCanal,
  SessionStatus,
} from '@prisma/client';
import { EventLogService } from '../src/gateway/event-log.service';
import { AgentRuntime } from '../src/agents/agent-runtime.service';
import { AgentsController } from '../src/agents/agents.controller';
import { SessionService } from '../src/agents/session.service';
import { ContextBuilder } from '../src/agents/context-builder.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { PolicyService } from '../src/policy/policy.service';
import { ProcedenciaExterna, SinaisService } from '../src/policy/sinais.service';
import { ApprovalsService } from '../src/approvals/approvals.service';
import { LotesService } from '../src/approvals/lotes.service';
import { AuditService } from '../src/audit/audit.service';
import { ToolGateway, type ExecCtx } from '../src/gateway/tool-gateway.service';
import {
  TetoDeCustoIaService,
  TetoDiarioEstouradoError,
  TetoIlegivelError,
} from '../src/llm/teto-diario.service';
import { ProviderComTeto } from '../src/llm/provider-com-teto';
import {
  CARACTERES_POR_TOKEN_ESTRUTURADO,
  CARACTERES_POR_TOKEN_TEXTO,
  caracteresDaConversa,
  estimarCustoDaResposta,
  estimarCustoUsd,
  estimarTokensDeEntrada,
  tamanhoDeTexto,
  tamanhoEstruturado,
} from '../src/llm/estimativa';
import type {
  ChamadaParaTeto,
  LlmProvider,
  LlmStepInput,
  LlmStepOutput,
  LlmToolSpec,
  LlmTurn,
} from '../src/llm/llm.provider';
import { comContexto, contextoAtual } from '../src/common/contexto-execucao';
import { LlmModule } from '../src/llm/llm.module';
import { ExecutoresDeRotinaRegistry } from '../src/routines/executores.registry';
import { ExecutorDePauta } from '../src/routines/executores/pauta.executor';
import { RotinasScheduler } from '../src/routines/rotinas.scheduler';
import { RotinasService } from '../src/routines/rotinas.service';
import type { RodadaService } from '../src/pauta/rodada.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  auditoriaFalsa,
  pautaRotinaFalsa,
  prismaDeRotinas,
  type EstadoDoBancoFalso,
} from './prisma-de-rotinas';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * TETO DE CUSTO DE IA POR EMPRESA E POR DIA — fatia 3.6 (RF-G-05, RNF-05).
 *
 * O QUE ESTA SUÍTE PRECISA PROVAR, e que separa a fatia feita da fingida:
 *
 *   1. empresa no teto tem a próxima execução RECUSADA, com motivo legível;
 *   2. a recusa vira EVENTO no RASTRO, como qualquer outra;
 *   3. empresa abaixo do teto executa normalmente;
 *   4. O CORTE ACONTECE ANTES DA CHAMADA AO MODELO — e é por isso que o
 *      provider desta suíte é um ESPIÃO que conta quantas vezes foi chamado.
 *      Um teto que corta depois passaria em 1, 2 e 3 e falharia aqui.
 *
 * E, desde a correção de 11/09/2026, o que o cerco deixava passar:
 *
 *   5. tráfego inteiramente de modelo SEM PREÇO não passa para sempre;
 *   6. `complete()` não grava o teto do pedido como se fosse gasto;
 *   7. reserva de processo morto tem coletor e saída;
 *   8. trocar o fuso no meio do dia não renova o orçamento;
 *   9. sem empresa na sessão do banco, o teto LANÇA em vez de se desligar calado;
 *  10. token de aprovação que ninguém confere não pula o teto.
 *
 * Precisa de TEST_DATABASE_URL com as migrations aplicadas:
 *   docker exec mktos-shadow psql -U mkt -d postgres -c 'CREATE DATABASE marketing_os_test'
 *   DATABASE_URL='postgresql://mkt:shadow@localhost:55432/marketing_os_test' \
 *     pnpm --filter @mktos/api db:deploy
 *   TEST_DATABASE_URL='...marketing_os_test' pnpm --filter @mktos/api test
 *
 * Os casos de `estimativa.ts` (no fim do arquivo) NÃO precisam de banco e rodam
 * sempre — é a conta que sustenta o "antes", e ela não pode depender de
 * infraestrutura para ser verificada.
 */
const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (empresas, tetos e livro-caixa de IA)');

const ORG_A = 'org-teto-ia-a';
const ORG_B = 'org-teto-ia-b';

/** 12/09/2026 às 02:00 UTC — que em São Paulo ainda é 11/09 às 23:00. */
const AGORA = new Date('2026-09-12T02:00:00Z');
const DIA_SP = '2026-09-11';
const DIA_UTC = '2026-09-12';

/**
 * Toda chamada ao teto roda DENTRO do contexto de execução da empresa.
 *
 * Não é cerimônia de teste: é a mesma exigência que o serviço passou a cobrar
 * em produção. A empresa do contexto é a que viaja para a sessão do banco
 * (`prisma/sessao-de-banco.ts`), e sem ela a consulta do teto devolveria vazio
 * sob o papel restrito — que é o "teto se desligando em silêncio" que a correção
 * fechou. Ver o caso "sem empresa na sessão".
 */
function naEmpresa<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  return comContexto(
    {
      orgId,
      actorType: ActorType.ai,
      actorId: 'agente-teste',
      correlationId: 'teste-teto',
      origem: 'script',
    },
    fn,
  );
}

/**
 * O provider de mentira que conta chamadas.
 *
 * Não é um `vi.fn()` de propósito: ele implementa `LlmProvider` de verdade,
 * inclusive `tetoDeSaida`, que é de onde o envelope tira o número da reserva. Um
 * dublê que não tivesse o método esconderia justamente o acoplamento que a
 * fatia criou.
 */
class ModeloEspiao implements LlmProvider {
  readonly name = 'espiao';
  readonly model: string = 'claude-opus-5';
  readonly configured = true;
  readonly supportsTools = true;

  chamadas = 0;
  /** Quando ligado, `step()` estoura — para provar que a reserva é devolvida. */
  falhar = false;
  /** O texto que `complete()` devolve. O tamanho dele é o que a liquidação usa. */
  resposta = 'resposta';

  constructor(private readonly custoReal = 0.01) {}

  async complete(): Promise<string> {
    this.chamadas += 1;
    if (this.falhar) throw new Error('rede caiu');
    return this.resposta;
  }

  async step(_input: LlmStepInput): Promise<LlmStepOutput> {
    this.chamadas += 1;
    if (this.falhar) throw new Error('rede caiu');
    return {
      text: 'ok',
      toolCalls: [],
      stopReason: 'end_turn',
      usage: {
        inputTokens: 1000,
        outputTokens: 200,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        custoUsd: this.custoReal,
        custoEstimado: true,
        modeloServido: 'claude-opus-5',
      },
      raw: [],
    };
  }

  tetoDeSaida(chamada: ChamadaParaTeto): number {
    if (chamada.tipo === 'completa') return 1000;
    return chamada.maxTokens ?? 2000;
  }
}

const passo = (texto = 'oi'): LlmStepInput => ({
  system: 'sistema',
  turns: [{ role: 'user', text: texto }] as LlmTurn[],
});

/** A estimativa de um passo desta suíte — o número com que os tetos são calibrados. */
const ESTIMATIVA_DO_PASSO = estimarCustoUsd('claude-opus-5', {
  entrada: caracteresDaConversa('sistema', [{ role: 'user', text: 'oi' }]),
  tokensSaida: 2000,
});

describe.skipIf(!URL)('teto de custo de IA por empresa e por dia', () => {
  let prisma: PrismaClient;
  let teto: TetoDeCustoIaService;
  let eventos: EventLogService;

  const dia = (orgId: string, d = DIA_SP) =>
    prisma.gastoDeIaNoDia.findUnique({ where: { orgId_dia: { orgId, dia: d } } });

  /** Define (ou redefine) o teto de uma empresa e zera o livro-caixa dela. */
  async function configurar(
    orgId: string,
    p: { tetoUsd: number; ativo?: boolean; fuso?: string },
  ): Promise<void> {
    await prisma.gastoDeIaNoDia.deleteMany({ where: { orgId } });
    await prisma.tetoDeCustoIa.upsert({
      where: { orgId },
      create: {
        orgId,
        tetoDiarioUsd: p.tetoUsd,
        ativo: p.ativo ?? true,
        fusoHorario: p.fuso ?? 'America/Sao_Paulo',
      },
      update: {
        tetoDiarioUsd: p.tetoUsd,
        ativo: p.ativo ?? true,
        fusoHorario: p.fuso ?? 'America/Sao_Paulo',
      },
    });
  }

  /** Põe a empresa EXATAMENTE no teto, sem passar por chamada nenhuma. */
  async function encostarNoTeto(orgId: string, valor: number, d = DIA_SP): Promise<void> {
    await prisma.gastoDeIaNoDia.upsert({
      where: { orgId_dia: { orgId, dia: d } },
      create: { orgId, dia: d, gastoUsd: valor, chamadas: 5 },
      update: { gastoUsd: valor, chamadas: 5 },
    });
  }

  /** Carimba os tempos de uma linha — `@updatedAt` não deixa fazer isso pelo cliente. */
  async function carimbar(
    orgId: string,
    d: string,
    t: { criadoEm: Date; atualizadoEm: Date },
  ): Promise<void> {
    await prisma.$executeRaw`
      UPDATE "GastoDeIaNoDia"
         SET "criadoEm" = ${t.criadoEm}, "atualizadoEm" = ${t.atualizadoEm}
       WHERE "orgId" = ${orgId} AND "dia" = ${d}`;
  }

  beforeAll(async () => {
    // Relógio preso: "por dia" só se mede com o dia parado, e a virada de fuso
    // é justamente um dos casos.
    vi.setSystemTime(AGORA);
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    for (const [id, slug] of [
      [ORG_A, 'teto-ia-a'],
      [ORG_B, 'teto-ia-b'],
    ]) {
      await prisma.org.upsert({
        where: { id },
        create: { id, name: `Empresa ${slug}`, slug },
        update: {},
      });
    }
    eventos = new EventLogService(prisma as unknown as PrismaService);
    teto = new TetoDeCustoIaService(prisma as unknown as PrismaService, eventos);
  });

  afterAll(async () => {
    vi.useRealTimers();
    // As empresas ficam: o RASTRO é append-only e as linhas de evento as
    // seguram por chave estrangeira. Apagar RASTRO é o que 02-CONSTRAINTS
    // proíbe, e um teste não é exceção.
    await prisma.gastoDeIaNoDia.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await prisma.tetoDeCustoIa.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    vi.setSystemTime(AGORA);
  });

  // -------------------------------------------------------------------------
  // 1. O caminho normal
  // -------------------------------------------------------------------------

  it('empresa SEM teto configurado passa e não escreve livro-caixa nenhum', async () => {
    await prisma.gastoDeIaNoDia.deleteMany({ where: { orgId: ORG_A } });
    await prisma.tetoDeCustoIa.deleteMany({ where: { orgId: ORG_A } });

    const espiao = new ModeloEspiao();
    const provider = new ProviderComTeto(espiao, teto);
    await naEmpresa(ORG_A, () => provider.step({ ...passo(), orgId: ORG_A }));

    expect(espiao.chamadas).toBe(1);
    expect(await dia(ORG_A)).toBeNull();
  });

  it('empresa ABAIXO do teto executa normalmente, e o custo REAL entra no dia', async () => {
    await configurar(ORG_A, { tetoUsd: 5 });
    const espiao = new ModeloEspiao(0.0123);
    const provider = new ProviderComTeto(espiao, teto);

    await naEmpresa(ORG_A, () => provider.step({ ...passo(), orgId: ORG_A }));

    expect(espiao.chamadas).toBe(1);
    const linha = await dia(ORG_A);
    // É o número do provedor que entra — não a estimativa, que era maior.
    expect(Number(linha?.gastoUsd)).toBeCloseTo(0.0123, 6);
    expect(Number(linha?.gastoEstimadoUsd)).toBe(0);
    // A reserva foi DEVOLVIDA: reserva pendurada é empresa cortada por gasto
    // que não existiu.
    expect(Number(linha?.reservadoUsd)).toBe(0);
    expect(linha?.chamadas).toBe(1);
    expect(linha?.cortes).toBe(0);
  });

  it('a estimativa reservada é MAIOR que o custo real — é ela que permite cortar antes', () => {
    expect(ESTIMATIVA_DO_PASSO.medivel).toBe(true);
    expect(ESTIMATIVA_DO_PASSO.usd).toBeGreaterThan(0.0123);
  });

  // -------------------------------------------------------------------------
  // 2. O corte — e o que ele prova
  // -------------------------------------------------------------------------

  it('empresa NO teto tem a próxima execução recusada, e O MODELO NÃO É CHAMADO', async () => {
    await configurar(ORG_A, { tetoUsd: 1 });
    await encostarNoTeto(ORG_A, 1);

    const espiao = new ModeloEspiao();
    const provider = new ProviderComTeto(espiao, teto);

    await expect(
      naEmpresa(ORG_A, () => provider.step({ ...passo(), orgId: ORG_A })),
    ).rejects.toBeInstanceOf(TetoDiarioEstouradoError);

    /*
     * ESTE É O CASO QUE SEPARA "CORTAR ANTES" DE "CORTAR DEPOIS".
     *
     * Um teto que só olhasse o gasto já liquidado e barrasse na volta passaria
     * em todos os outros casos deste arquivo e falharia exatamente aqui: o
     * contador do espião estaria em 1.
     */
    expect(espiao.chamadas).toBe(0);
  });

  it('o motivo da recusa é legível em português, com o dia e os valores', async () => {
    await configurar(ORG_A, { tetoUsd: 2 });
    await encostarNoTeto(ORG_A, 2.5);

    const provider = new ProviderComTeto(new ModeloEspiao(), teto);
    const erro = await naEmpresa(ORG_A, () =>
      provider
        .step({ ...passo(), orgId: ORG_A })
        .then(() => null)
        .catch((e: unknown) => e as TetoDiarioEstouradoError),
    );

    expect(erro).toBeInstanceOf(TetoDiarioEstouradoError);
    expect(erro?.motivo).toContain('Teto de custo de IA do dia 11/09/2026');
    expect(erro?.motivo).toContain('US$ 2,5000');
    expect(erro?.motivo).toContain('US$ 2,0000');
    // Diz o que fazer, não só o que aconteceu.
    expect(erro?.motivo).toContain('virada do dia');
    // E NÃO manda mexer em tela que não existe: a de Controle não tem esse campo.
    expect(erro?.motivo).not.toContain('em Controle');
    expect(erro?.detalhe.tetoUsd).toBe(2);
    expect(erro?.detalhe.dia).toBe(DIA_SP);
    expect(erro?.detalhe.causa).toBe('dia_no_teto');
  });

  it('o corte vira evento no RASTRO e é contado no livro-caixa', async () => {
    await configurar(ORG_B, { tetoUsd: 1 });
    await encostarNoTeto(ORG_B, 1);
    const antes = await prisma.eventLog.count({
      where: { orgId: ORG_B, tipo: 'ia.recusada_por_teto' },
    });

    const provider = new ProviderComTeto(new ModeloEspiao(), teto);
    await naEmpresa(ORG_B, () => provider.step({ ...passo(), orgId: ORG_B }).catch(() => null));

    const evento = await prisma.eventLog.findFirst({
      where: { orgId: ORG_B, tipo: 'ia.recusada_por_teto' },
      orderBy: { seq: 'desc' },
    });
    expect(
      await prisma.eventLog.count({ where: { orgId: ORG_B, tipo: 'ia.recusada_por_teto' } }),
    ).toBe(antes + 1);

    const p = evento?.payload as Record<string, unknown>;
    expect(p.causa).toBe('dia_no_teto');
    expect(p.dia).toBe(DIA_SP);
    expect(p.tetoUsd).toBe(1);
    expect(String(p.motivo)).toContain('Teto de custo de IA do dia');
    // O evento entra na cadeia encadeada como qualquer outro.
    expect(evento?.hash).toBeTruthy();

    expect((await dia(ORG_B))?.cortes).toBe(1);
  });

  it('uma empresa no teto não afeta a outra', async () => {
    await configurar(ORG_A, { tetoUsd: 1 });
    await encostarNoTeto(ORG_A, 1);
    await configurar(ORG_B, { tetoUsd: 10 });

    const espiao = new ModeloEspiao();
    const provider = new ProviderComTeto(espiao, teto);

    await expect(
      naEmpresa(ORG_A, () => provider.step({ ...passo(), orgId: ORG_A })),
    ).rejects.toBeInstanceOf(TetoDiarioEstouradoError);
    await naEmpresa(ORG_B, () => provider.step({ ...passo(), orgId: ORG_B }));

    expect(espiao.chamadas).toBe(1);
    expect(Number((await dia(ORG_B))?.gastoUsd)).toBeGreaterThan(0);
  });

  it('o CORTE é contado mesmo quando a linha do dia ainda nem existia', async () => {
    /*
     * As recusas que acontecem ANTES de qualquer reserva — teto zerado, modelo
     * sem preço, chamada maior que o dia inteiro — são justamente as que
     * interessam a quem for calibrar o valor. Até 11/09/2026 o contador delas
     * ficava em zero: o UPDATE do corte não achava linha nenhuma para somar.
     */
    await configurar(ORG_A, { tetoUsd: 0.000001 });
    expect(await dia(ORG_A)).toBeNull();

    const espiao = new ModeloEspiao();
    const provider = new ProviderComTeto(espiao, teto);
    const erro = await naEmpresa(ORG_A, () =>
      provider
        .step({ ...passo(), orgId: ORG_A })
        .then(() => null)
        .catch((e: unknown) => e as TetoDiarioEstouradoError),
    );

    expect(espiao.chamadas).toBe(0);
    expect(erro?.motivo).toContain('acima do teto');

    const linha = await dia(ORG_A);
    expect(linha?.cortes).toBe(1);
    // A linha nasce só para contar o corte: não inventa gasto nem chamada.
    expect(Number(linha?.gastoUsd)).toBe(0);
    expect(linha?.chamadas).toBe(0);
  });

  it('teto zerado recusa tudo, com motivo próprio — inclusive na leitura da porta', async () => {
    await configurar(ORG_A, { tetoUsd: 0 });

    const espiao = new ModeloEspiao();
    const provider = new ProviderComTeto(espiao, teto);
    const erro = await naEmpresa(ORG_A, () =>
      provider
        .step({ ...passo(), orgId: ORG_A })
        .then(() => null)
        .catch((e: unknown) => e as TetoDiarioEstouradoError),
    );

    expect(espiao.chamadas).toBe(0);
    expect(erro?.motivo).toContain('US$ 0,0000 por dia');

    /*
     * E a leitura que a PORTA usa dizia outra coisa: "teto do dia atingido:
     * US$ 0,00 de US$ 0,00 já comprometidos" — descrevendo como consumo o que é
     * uma empresa desligada. Mesma causa, mesmo texto.
     */
    const motivo = await naEmpresa(ORG_A, () => teto.motivoDeCorte(ORG_A));
    expect(motivo).toContain('US$ 0,0000 por dia');
    expect(motivo).not.toContain('atingido');
  });

  // -------------------------------------------------------------------------
  // 3. A reserva
  // -------------------------------------------------------------------------

  it('chamada que FALHA devolve a reserva e não grava gasto', async () => {
    await configurar(ORG_A, { tetoUsd: 5 });
    const espiao = new ModeloEspiao();
    espiao.falhar = true;
    const provider = new ProviderComTeto(espiao, teto);

    await expect(
      naEmpresa(ORG_A, () => provider.step({ ...passo(), orgId: ORG_A })),
    ).rejects.toThrow('rede caiu');

    const linha = await dia(ORG_A);
    expect(Number(linha?.reservadoUsd)).toBe(0);
    expect(Number(linha?.gastoUsd)).toBe(0);
    // A tentativa fica contada: ela consumiu vaga no teto enquanto esteve em voo.
    expect(linha?.chamadas).toBe(1);
  });

  it('a reserva segura a chamada CONCORRENTE: com uma em voo, a segunda não cabe', async () => {
    /*
     * A PROVA DE QUE A RESERVA EXISTE, e não só a soma do já gasto.
     *
     * Sem reserva, a segunda chamada leria o livro-caixa com a primeira ainda em
     * voo — logo, com gasto ZERO — acharia que cabe, e as duas gastariam o teto
     * inteiro cada uma. Com reserva, a segunda enxerga o que a primeira
     * comprometeu, porque a soma acontece numa instrução só.
     *
     * O modelo desta suíte é instantâneo, então "ao mesmo tempo" não acontece
     * por acaso: aqui ele SEGURA a resposta até o teste mandar soltar, que é a
     * única forma de haver de fato uma chamada em voo quando a segunda chega.
     *
     * O teto é apertado de propósito: cabe UMA estimativa, não duas. E o coletor
     * de reserva presa não pode estragar isto: a reserva da primeira está VIVA, e
     * é por isso que ele conta o que este processo tem em voo antes de soltar
     * qualquer coisa.
     */
    await configurar(ORG_A, { tetoUsd: ESTIMATIVA_DO_PASSO.usd * 1.5 });

    let avisarQueEntrou!: () => void;
    let soltar!: () => void;
    const entrou = new Promise<void>((r) => (avisarQueEntrou = r));
    const represa = new Promise<void>((r) => (soltar = r));

    class ModeloQueSegura extends ModeloEspiao {
      async step(input: LlmStepInput): Promise<LlmStepOutput> {
        avisarQueEntrou();
        await represa;
        return super.step(input);
      }
    }

    const espiao = new ModeloQueSegura(0.001);
    const provider = new ProviderComTeto(espiao, teto);

    const primeira = naEmpresa(ORG_A, () => provider.step({ ...passo(), orgId: ORG_A }));
    await entrou; // a reserva da primeira já está gravada; a resposta, não

    const segunda = naEmpresa(ORG_A, () => provider.step({ ...passo(), orgId: ORG_A }));
    await expect(segunda).rejects.toBeInstanceOf(TetoDiarioEstouradoError);
    expect(espiao.chamadas).toBe(0); // `super.step` ainda não rodou: está represado

    soltar();
    await primeira;
    expect(espiao.chamadas).toBe(1);

    // E, liquidada a primeira pelo custo REAL (bem menor que a estimativa), o
    // saldo volta e a terceira chamada passa. A reserva aperta enquanto a
    // chamada está em voo, e só enquanto.
    const terceira = new ProviderComTeto(new ModeloEspiao(0.001), teto);
    await naEmpresa(ORG_A, () => terceira.step({ ...passo(), orgId: ORG_A }));
  });

  it('reserva de processo morto é SOLTA na recusa, e a chamada seguinte passa', async () => {
    /*
     * A SAÍDA QUE NÃO EXISTIA.
     *
     * Reserva só fica pendurada de um jeito: o processo morrer entre reservar e
     * liquidar. E isso não é exceção — todo deploy recria o container. Sem
     * coletor, poucas chamadas mortas travavam a empresa até a virada do dia, e
     * a única saída era mexer no banco à mão.
     */
    await configurar(ORG_A, { tetoUsd: 1 });
    await prisma.gastoDeIaNoDia.create({
      data: { orgId: ORG_A, dia: DIA_SP, gastoUsd: 0.3, reservadoUsd: 0.7, chamadas: 3 },
    });
    // Parada há muito tempo: nada vivo mexe numa linha e some por meia hora.
    await carimbar(ORG_A, DIA_SP, {
      criadoEm: new Date(AGORA.getTime() - 6 * 3600_000),
      atualizadoEm: new Date(AGORA.getTime() - 3600_000),
    });

    const espiao = new ModeloEspiao(0.01);
    const provider = new ProviderComTeto(espiao, teto);
    // 0,30 + 0,70 já é o teto inteiro: com a reserva presa de pé, nada cabe.
    // Sem ela, sobram 0,70 — e a estimativa de um passo cabe com folga.
    expect(0.3 + 0.7 + ESTIMATIVA_DO_PASSO.usd).toBeGreaterThan(1);
    expect(0.3 + ESTIMATIVA_DO_PASSO.usd).toBeLessThan(1);

    await naEmpresa(ORG_A, () => provider.step({ ...passo(), orgId: ORG_A }));

    expect(espiao.chamadas).toBe(1);
    const linha = await dia(ORG_A);
    expect(Number(linha?.reservadoUsd)).toBe(0);
    expect(Number(linha?.gastoUsd)).toBeCloseTo(0.31, 6);
    // A soltura fica registrada: reserva que some sem explicação é dinheiro que
    // ninguém sabe se aconteceu.
    const evento = await prisma.eventLog.findFirst({
      where: { orgId: ORG_A, tipo: 'ia.reserva_liberada' },
      orderBy: { seq: 'desc' },
    });
    expect((evento?.payload as Record<string, unknown>)?.motivo).toBe('recusa');
  });

  it('a varredura de ARRANQUE solta reserva vencida, sem presumir que outra instância morreu', async () => {
    await configurar(ORG_A, { tetoUsd: 5 });
    await prisma.gastoDeIaNoDia.create({
      data: { orgId: ORG_A, dia: DIA_SP, reservadoUsd: 3.5 },
    });

    await carimbar(ORG_A, DIA_SP, {
      criadoEm: new Date(AGORA.getTime() - 3600_000),
      atualizadoEm: new Date(AGORA.getTime() - 3600_000),
    });
    const liberado = await teto.liberarReservasPresas('arranque');

    expect(liberado).toBeGreaterThanOrEqual(3.5);
    expect(Number((await dia(ORG_A))?.reservadoUsd)).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 4. O dia de quem
  // -------------------------------------------------------------------------

  it('o dia é o da EMPRESA, não o do servidor', () => {
    // 02:00 UTC do dia 12 é 23:00 do dia 11 em São Paulo. Se o teto usasse o
    // relógio do container (UTC), o dia viraria às 21h de Brasília — no meio do
    // expediente — e o cliente veria o corte em hora que não é meia-noite dele.
    expect(teto.diaDaEmpresa('America/Sao_Paulo')).toBe(DIA_SP);
    expect(teto.diaDaEmpresa('UTC')).toBe(DIA_UTC);
    expect(teto.diaDaEmpresa('Asia/Tokyo')).toBe(DIA_UTC);
  });

  it('a linha do livro-caixa nasce no dia da empresa', async () => {
    await configurar(ORG_A, { tetoUsd: 5, fuso: 'America/Sao_Paulo' });
    await naEmpresa(ORG_A, () =>
      new ProviderComTeto(new ModeloEspiao(), teto).step({ ...passo(), orgId: ORG_A }),
    );

    expect(await dia(ORG_A, DIA_SP)).not.toBeNull();
    expect(await dia(ORG_A, DIA_UTC)).toBeNull();
  });

  it('a mesma empresa em UTC fecha o dia na outra data', async () => {
    await configurar(ORG_B, { tetoUsd: 5, fuso: 'UTC' });
    await naEmpresa(ORG_B, () =>
      new ProviderComTeto(new ModeloEspiao(), teto).step({ ...passo(), orgId: ORG_B }),
    );

    expect(await dia(ORG_B, DIA_UTC)).not.toBeNull();
    expect(await dia(ORG_B, DIA_SP)).toBeNull();
  });

  it('fuso inválido não derruba a chamada: cai no padrão brasileiro', async () => {
    await configurar(ORG_A, { tetoUsd: 5, fuso: 'Marte/Olympus' });
    const espiao = new ModeloEspiao();
    await naEmpresa(ORG_A, () =>
      new ProviderComTeto(espiao, teto).step({ ...passo(), orgId: ORG_A }),
    );

    expect(espiao.chamadas).toBe(1);
    expect(await dia(ORG_A, DIA_SP)).not.toBeNull();
  });

  it('TROCAR O FUSO no meio do dia NÃO renova o orçamento', async () => {
    /*
     * O rótulo do dia sai do fuso, e o fuso é configuração. Sem o arrasto,
     * trocar `America/Sao_Paulo` por `UTC` às 23h abria linha nova com saldo
     * zero — um teto que se contorna editando um campo de texto.
     *
     * O que distingue isto da virada normal do dia é o instante em que a linha
     * antiga se mexeu: aqui ela foi tocada DEPOIS do começo do dia novo (e fora
     * da tolerância de uma hora), o que só acontece quando os dois "dias" estão
     * valendo ao mesmo tempo.
     */
    await configurar(ORG_A, { tetoUsd: 1, fuso: 'America/Sao_Paulo' });
    await prisma.gastoDeIaNoDia.create({
      data: { orgId: ORG_A, dia: DIA_SP, gastoUsd: 0.95, chamadas: 9 },
    });
    await carimbar(ORG_A, DIA_SP, {
      criadoEm: new Date('2026-09-11T12:00:00Z'),
      atualizadoEm: new Date('2026-09-12T01:55:00Z'), // 22h55 em São Paulo
    });

    // A troca. O dia passa a ser 12 (UTC), e a linha do dia 12 não existe.
    await prisma.tetoDeCustoIa.update({ where: { orgId: ORG_A }, data: { fusoHorario: 'UTC' } });
    expect(await dia(ORG_A, DIA_UTC)).toBeNull();

    const espiao = new ModeloEspiao();
    await expect(
      naEmpresa(ORG_A, () => new ProviderComTeto(espiao, teto).step({ ...passo(), orgId: ORG_A })),
    ).rejects.toBeInstanceOf(TetoDiarioEstouradoError);
    expect(espiao.chamadas).toBe(0);

    const c = await naEmpresa(ORG_A, () => teto.consumo(ORG_A));
    expect(c?.dia).toBe(DIA_UTC);
    expect(c?.arrastoUsd).toBeCloseTo(0.95, 6);
  });

  it('a virada NORMAL do dia continua renovando o orçamento', async () => {
    /*
     * O outro lado do arrasto, que é o que o torna utilizável: a linha de ontem
     * foi criada ontem e a última mexida dela foi a liquidação de uma chamada
     * que atravessou a meia-noite. Isso é o normal, e não pode fazer o gasto de
     * ontem contar hoje — senão o teto nunca mais liberaria ninguém.
     */
    await configurar(ORG_B, { tetoUsd: 1, fuso: 'UTC' });
    await prisma.gastoDeIaNoDia.create({
      data: { orgId: ORG_B, dia: DIA_SP, gastoUsd: 0.99, chamadas: 9 },
    });
    await carimbar(ORG_B, DIA_SP, {
      criadoEm: new Date('2026-09-11T09:00:00Z'),
      atualizadoEm: new Date('2026-09-12T00:00:20Z'), // 20s depois da virada
    });

    const espiao = new ModeloEspiao(0.01);
    await naEmpresa(ORG_B, () =>
      new ProviderComTeto(espiao, teto).step({ ...passo(), orgId: ORG_B }),
    );

    expect(espiao.chamadas).toBe(1);
    const c = await naEmpresa(ORG_B, () => teto.consumo(ORG_B));
    expect(c?.arrastoUsd).toBe(0);
    expect(c?.dia).toBe(DIA_UTC);
  });

  // -------------------------------------------------------------------------
  // 5. Teto desligado, e o custo que não dá para medir
  // -------------------------------------------------------------------------

  it('teto DESLIGADO conta o gasto e não corta — é o modo de calibrar antes de impor', async () => {
    await configurar(ORG_A, { tetoUsd: 0.0001, ativo: false });
    await encostarNoTeto(ORG_A, 99);

    const espiao = new ModeloEspiao(0.02);
    await naEmpresa(ORG_A, () =>
      new ProviderComTeto(espiao, teto).step({ ...passo(), orgId: ORG_A }),
    );

    expect(espiao.chamadas).toBe(1);
    const linha = await dia(ORG_A);
    expect(Number(linha?.gastoUsd)).toBeCloseTo(99.02, 6);
    expect(linha?.cortes).toBe(0);
  });

  it('tráfego INTEIRAMENTE de modelo sem preço NÃO passa para sempre: com teto valendo, é recusado', async () => {
    /*
     * O FURO QUE A SEGUNDA CONDIÇÃO NÃO FECHAVA.
     *
     * Chamada de modelo sem preço não soma nada. Enquanto a soma estiver abaixo
     * do teto, ela passa — e como ela mesma nunca soma, a soma nunca sobe. Uma
     * empresa cujo tráfego seja TODO de modelo fora da tabela passava para
     * sempre, e esse é o estado do provider `openrouter`, cujo modelo padrão não
     * casa com `preco.ts`. A prova antiga escrevia o gasto à mão ANTES de medir:
     * provava a segunda condição, não a afirmação.
     *
     * Aqui não se escreve nada: o livro-caixa começa e termina zerado, e é isso
     * que torna o caso honesto.
     */
    await configurar(ORG_A, { tetoUsd: 10 });

    class SemPreco extends ModeloEspiao {
      readonly model: string = 'modelo-que-ninguem-precificou';
    }

    const espiao = new SemPreco();
    const provider = new ProviderComTeto(espiao, teto);

    for (let i = 0; i < 3; i++) {
      const erro = await naEmpresa(ORG_A, () =>
        provider
          .step({ ...passo(), orgId: ORG_A })
          .then(() => null)
          .catch((e: unknown) => e as TetoDiarioEstouradoError),
      );
      expect(erro).toBeInstanceOf(TetoDiarioEstouradoError);
      expect(erro?.detalhe.causa).toBe('modelo_sem_preco');
      expect(erro?.motivo).toContain('não está na tabela de preço');
    }

    expect(espiao.chamadas).toBe(0);
    const linha = await dia(ORG_A);
    expect(Number(linha?.gastoUsd)).toBe(0);
    expect(linha?.cortes).toBe(3);
  });

  it('modelo sem preço com teto DESLIGADO passa, e conta UMA vez como não medido', async () => {
    /*
     * O contador contava a mesma chamada duas vezes — uma na reserva, outra na
     * liquidação —, e a asserção antiga escondia isso aceitando "pelo menos um".
     */
    await configurar(ORG_A, { tetoUsd: 5, ativo: false });

    class SemPreco extends ModeloEspiao {
      readonly model: string = 'modelo-que-ninguem-precificou';
      async step(): Promise<LlmStepOutput> {
        this.chamadas += 1;
        return {
          text: 'ok',
          toolCalls: [],
          stopReason: 'end_turn',
          usage: {
            inputTokens: 10,
            outputTokens: 10,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            custoUsd: 0,
            // é o que `preco.ts` devolve para modelo fora da tabela
            custoEstimado: false,
            modeloServido: 'modelo-que-ninguem-precificou',
          },
          raw: [],
        };
      }
    }

    const espiao = new SemPreco();
    await naEmpresa(ORG_A, () =>
      new ProviderComTeto(espiao, teto).step({ ...passo(), orgId: ORG_A }),
    );

    const linha = await dia(ORG_A);
    expect(espiao.chamadas).toBe(1);
    expect(linha?.chamadas).toBe(1);
    // Nada foi medido: não entra R$ 0,00 disfarçado de custo.
    expect(Number(linha?.gastoUsd)).toBe(0);
    expect(linha?.chamadasSemPreco).toBe(1);
  });

  it('pedido com preço que VOLTA sem preço (fallback) é liquidado pela estimativa, não por zero', async () => {
    /*
     * `modeloServido` pode não ser o pedido. Liquidar em zero daria a chamada de
     * graça e abriria a mesma porta pelo outro lado.
     */
    await configurar(ORG_A, { tetoUsd: 5 });

    class CaiNoFallback extends ModeloEspiao {
      async step(): Promise<LlmStepOutput> {
        this.chamadas += 1;
        return {
          text: 'ok',
          toolCalls: [],
          stopReason: 'end_turn',
          usage: {
            inputTokens: 10,
            outputTokens: 10,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            custoUsd: 0,
            custoEstimado: false,
            modeloServido: 'outro-modelo-sem-preco',
          },
          raw: [],
        };
      }
    }

    await naEmpresa(ORG_A, () =>
      new ProviderComTeto(new CaiNoFallback(), teto).step({ ...passo(), orgId: ORG_A }),
    );

    const linha = await dia(ORG_A);
    expect(Number(linha?.gastoUsd)).toBe(0);
    expect(Number(linha?.gastoEstimadoUsd)).toBeCloseTo(ESTIMATIVA_DO_PASSO.usd, 6);
    expect(linha?.chamadasSemPreco).toBe(1);
  });

  it('complete() liquida pelo TAMANHO DA RESPOSTA, não pelo teto de saída do pedido', async () => {
    /*
     * O DEFEITO QUE ISTO CONSERTA: a liquidação gravava a RESERVA, feita com o
     * `max_tokens` do pedido — cerca de sete vezes o custo típico de uma
     * resposta de texto. Em coluna própria, sim, mas dentro da soma que decide o
     * corte: a empresa era cortada com uma fração do orçamento que de fato
     * gastou, e o livro-caixa mostrava um número que não era gasto.
     */
    await configurar(ORG_A, { tetoUsd: 5 });
    const espiao = new ModeloEspiao();
    espiao.resposta = 'uma resposta curta, como as que o resumo diário devolve.';

    await naEmpresa(ORG_A, () =>
      new ProviderComTeto(espiao, teto).complete({
        system: 'sistema',
        user: 'resuma isto',
        orgId: ORG_A,
      }),
    );

    const linha = await dia(ORG_A);
    const reservaDoPedido = estimarCustoUsd('claude-opus-5', {
      entrada: tamanhoDeTexto('sistema', 'resuma isto'),
      tokensSaida: 1000,
    });
    const observado = estimarCustoDaResposta('claude-opus-5', {
      entrada: tamanhoDeTexto('sistema', 'resuma isto'),
      resposta: espiao.resposta,
    });

    expect(espiao.chamadas).toBe(1);
    // `complete()` devolve texto e não uso: não há custo real para gravar, e o
    // número estimado fica em coluna própria.
    expect(Number(linha?.gastoUsd)).toBe(0);
    expect(Number(linha?.gastoEstimadoUsd)).toBeCloseTo(observado.usd, 6);
    expect(Number(linha?.reservadoUsd)).toBe(0);
    // O que foi gravado é MUITO menor que a reserva — é esse o conserto.
    expect(observado.usd).toBeLessThan(reservaDoPedido.usd / 5);
  });

  // -------------------------------------------------------------------------
  // 6. A leitura que a porta usa, e a sessão do banco
  // -------------------------------------------------------------------------

  it('motivoDeCorte devolve null para quem pode gastar e o motivo para quem não pode', async () => {
    await configurar(ORG_A, { tetoUsd: 10 });
    expect(await naEmpresa(ORG_A, () => teto.motivoDeCorte(ORG_A))).toBeNull();

    await encostarNoTeto(ORG_A, 10);
    expect(await naEmpresa(ORG_A, () => teto.motivoDeCorte(ORG_A))).toContain(
      'Teto de custo de IA do dia',
    );

    // Empresa sem teto configurado nunca é cortada.
    await prisma.tetoDeCustoIa.deleteMany({ where: { orgId: ORG_A } });
    expect(await naEmpresa(ORG_A, () => teto.motivoDeCorte(ORG_A))).toBeNull();
  });

  it('consumo() mostra o restante do dia, com medido e estimado separados', async () => {
    await configurar(ORG_A, { tetoUsd: 4 });
    await prisma.gastoDeIaNoDia.create({
      data: { orgId: ORG_A, dia: DIA_SP, gastoUsd: 1, gastoEstimadoUsd: 0.5, reservadoUsd: 0.25 },
    });

    const c = await naEmpresa(ORG_A, () => teto.consumo(ORG_A));
    expect(c?.tetoUsd).toBe(4);
    expect(c?.gastoUsd).toBe(1);
    expect(c?.gastoEstimadoUsd).toBe(0.5);
    expect(c?.reservadoUsd).toBe(0.25);
    expect(c?.comprometidoUsd).toBe(1.75);
    expect(c?.restanteUsd).toBe(2.25);
    expect(c?.dia).toBe(DIA_SP);
  });

  it('SEM empresa na sessão do banco, o teto LANÇA em vez de se dar por inexistente', async () => {
    /*
     * "Não tem teto" e "não consegui ler o teto" devolvem a mesma coisa do banco
     * — nada — e significam o oposto. Sob o papel restrito, a consulta feita sem
     * a empresa na sessão não erra: devolve vazio, calada. Entender esse vazio
     * como "empresa sem teto" desligaria o controle de gasto em silêncio, que é
     * o pior desfecho possível para um controle.
     */
    await prisma.tetoDeCustoIa.deleteMany({ where: { orgId: ORG_B } });

    // Dentro do contexto: o vazio é resposta de verdade, e a chamada segue.
    await expect(
      naEmpresa(ORG_B, () =>
        teto.reservar({
          orgId: ORG_B,
          modelo: 'claude-opus-5',
          entrada: tamanhoDeTexto('oi'),
          tokensSaida: 10,
        }),
      ),
    ).resolves.toBeNull();

    // Fora dele: não dá para saber, e não saber não vira permissão.
    await expect(
      teto.reservar({
        orgId: ORG_B,
        modelo: 'claude-opus-5',
        entrada: tamanhoDeTexto('oi'),
        tokensSaida: 10,
      }),
    ).rejects.toBeInstanceOf(TetoIlegivelError);
  });
});

// ---------------------------------------------------------------------------
// A PORTA — depois do teto, a empresa também para de disparar AÇÃO por agente
// ---------------------------------------------------------------------------

describe.skipIf(!URL)('a porta, depois do teto estourado', () => {
  let prisma: PrismaClient;
  let teto: TetoDeCustoIaService;
  let porta: ToolGateway;
  let policy: PolicyService;
  let approvals: ApprovalsService;
  let p: PrismaService;

  const ctx = (extra: Partial<ExecCtx> = {}): ExecCtx => ({
    orgId: ORG_A,
    actorType: ActorType.ai,
    actorId: 'agente-teto',
    agentSlug: 'assistente',
    correlationId: 'sess-teto',
    ...extra,
  });

  /** Põe a empresa no teto — é o estado em que todos os casos daqui começam. */
  async function noTeto(): Promise<void> {
    await prisma.tetoDeCustoIa.upsert({
      where: { orgId: ORG_A },
      create: { orgId: ORG_A, tetoDiarioUsd: 1 },
      update: { tetoDiarioUsd: 1, ativo: true, fusoHorario: 'America/Sao_Paulo' },
    });
    await prisma.gastoDeIaNoDia.upsert({
      where: { orgId_dia: { orgId: ORG_A, dia: DIA_SP } },
      create: { orgId: ORG_A, dia: DIA_SP, gastoUsd: 1 },
      update: { gastoUsd: 1, reservadoUsd: 0 },
    });
  }

  beforeAll(async () => {
    vi.setSystemTime(AGORA);
    process.env.GATEWAY_MODO = 'impor';
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    await prisma.org.upsert({
      where: { id: ORG_A },
      create: { id: ORG_A, name: 'Empresa teto-ia-a', slug: 'teto-ia-a' },
      update: {},
    });

    p = prisma as unknown as PrismaService;
    policy = new PolicyService(p);
    await policy.onModuleInit();
    teto = new TetoDeCustoIaService(p, new EventLogService(p));
    approvals = new ApprovalsService(p, new AuditService(p));
    // O oitavo argumento (o registro de efeitos) entrou na asserção de arranque
    // na correção da fatia 3.3 — ver `onModuleInit`. Esta suíte não exercita
    // efeito nenhum, mas a porta que ela monta tem de ser a que SOBE.
    porta = new ToolGateway(
      p,
      policy,
      new SinaisService(p, policy),
      approvals,
      new EventLogService(p),
      teto,
      undefined,
      new EfeitosRegistry(),
      new LotesService(p, policy, new AuditService(p)),
    );
  });

  afterAll(async () => {
    vi.useRealTimers();
    await prisma.gastoDeIaNoDia.deleteMany({ where: { orgId: ORG_A } });
    await prisma.tetoDeCustoIa.deleteMany({ where: { orgId: ORG_A } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    vi.setSystemTime(AGORA);
  });

  it('a porta RECUSA SUBIR sem o teto injetado', () => {
    /*
     * A dependência é `@Optional()` no construtor porque quatro suítes montam a
     * porta à mão — mas conveniência de teste não pode virar falha aberta em
     * produção, e sem esta asserção a porta subiria deixando passar toda ação de
     * agente de uma empresa com o orçamento estourado, em silêncio.
     */
    const semTeto = new ToolGateway(
      p,
      policy,
      new SinaisService(p, policy),
      approvals,
      new EventLogService(p),
    );
    expect(() => semTeto.onModuleInit()).toThrow(/TetoDeCustoIaService/);
    expect(() => porta.onModuleInit()).not.toThrow();

    /*
     * O SEGUNDO FREIO DA MESMA ASSERÇÃO (correção da fatia 3.3). Sem o registro
     * de efeitos a porta não falha aberta — mas `temEfeito` responde `false`
     * para tudo, e a fila de aprovação passa a afirmar que capacidades com
     * efeito ligado "não têm efeito ligado nesta versão". Uma frase falsa numa
     * tela manda quem opera procurar defeito onde não há.
     */
    const semEfeitos = new ToolGateway(
      p,
      policy,
      new SinaisService(p, policy),
      approvals,
      new EventLogService(p),
      teto,
    );
    expect(() => semEfeitos.onModuleInit()).toThrow(/EfeitosRegistry/);

    // O TERCEIRO (MD7): sem o serviço de lotes, todo item de lote seria
    // recusado e a semana assinada nunca publicaria — o arranque recusa.
    const semLotes = new ToolGateway(p, policy, new SinaisService(p, policy), approvals, new EventLogService(p), teto, undefined, new EfeitosRegistry());
    expect(() => semLotes.onModuleInit()).toThrow(/LotesService/);
  });

  it('recusa a próxima ação do agente com motivo legível, e o efeito não roda', async () => {
    await noTeto();

    let rodou = false;
    const r = await porta.executar(
      { capabilityId: 'numeros.painel.ler', args: {}, ctx: ctx() },
      async () => {
        rodou = true;
        return 'nunca';
      },
    );

    expect(r.status).toBe('recusado');
    expect(rodou).toBe(false);
    if (r.status === 'recusado') expect(r.motivo).toContain('Teto de custo de IA do dia');

    // Recusa da porta é recusa registrada — mesma forma das outras duas.
    const evento = await prisma.eventLog.findFirst({
      where: { orgId: ORG_A, tipo: 'tool.recusado', toolCallId: r.toolCallId },
    });
    const payload = evento?.payload as Record<string, unknown>;
    expect(payload?.causa).toBe('teto_de_custo');
  });

  it('TOKEN DE APROVAÇÃO QUALQUER não pula o teto quando ninguém o confere', async () => {
    /*
     * O DESVIO QUE EXISTIA.
     *
     * A guarda testava `!req.approvalToken` — "veio texto no campo?" — muito
     * antes de o token ser validado. Para capacidade que NÃO exige aprovação, o
     * bloco que consome o token nem roda: bastava mandar uma string qualquer
     * para pular o teto, hoje e sempre, sem nunca ser conferida. Agora a segunda
     * metade da conferência acontece DEPOIS do consumo, onde já se sabe se houve
     * gente no caminho.
     */
    await noTeto();

    let rodou = false;
    const r = await porta.executar(
      {
        capabilityId: 'numeros.painel.ler',
        args: {},
        ctx: ctx(),
        approvalToken: 'token-que-ninguem-emitiu',
      },
      async () => {
        rodou = true;
        return 'nunca';
      },
    );

    expect(r.status).toBe('recusado');
    expect(rodou).toBe(false);
    if (r.status === 'recusado') expect(r.motivo).toContain('Teto de custo de IA do dia');

    // A recusa fecha o ToolCall que JÁ existia — não abre um segundo par,
    // senão o relatório de calibragem contaria a mesma tentativa duas vezes.
    const chamadas = await prisma.toolCall.findMany({
      where: { orgId: ORG_A, correlationId: 'sess-teto', capabilityId: 'numeros.painel.ler' },
      orderBy: { criadoEm: 'desc' },
      take: 1,
      select: { id: true, status: true, erro: true },
    });
    expect(chamadas[0]?.id).toBe(r.toolCallId);
    expect(chamadas[0]?.status).toBe('recusado');
  });

  it('token de aprovação DE VERDADE passa por cima do teto: quem decidiu foi gente', async () => {
    /*
     * O outro lado. Uma ação que uma pessoa aprovou não pode ser barrada por
     * orçamento de modelo — recusá-la aqui transformaria o teto de IA num
     * cancelamento de decisão humana.
     */
    await noTeto();

    const cap = 'whatsapp.mensagem.enviar';
    const args = { corpo: 'mensagem aprovada por gente' };
    const decisao = policy.simular(ORG_A, cap);
    const hashKeys =
      (policy.resolverCapacidade(ORG_A, cap) as unknown as { hashKeys?: string[] })?.hashKeys ?? [];
    const { approvalId, token } = await approvals.propor({
      orgId: ORG_A,
      propostoPorId: 'pedro',
      propostoPorTipo: ActorType.user,
      capabilityId: cap,
      resourceType: cap,
      resourceId: '-',
      args,
      hashKeys,
      decisao,
    });
    /*
     * A confirmação humana é escrita à mão porque o assunto DESTE caso é o teto,
     * não a máquina de aprovação: montar usuário, papel, alçada e
     * reautenticação só para chegar ao mesmo estado é a suíte
     * `alcada-reautenticacao.test.ts`, e ela já faz isso.
     */
    await prisma.approval.update({
      where: { id: approvalId },
      data: { status: 'confirmada', aprovadoPorId: 'pedro', aprovadoEm: new Date() },
    });

    let rodou = false;
    const r = await porta.executar({ capabilityId: cap, args, ctx: ctx(), approvalToken: token }, async () => {
      rodou = true;
      return { enviado: true };
    });

    expect(r.status).toBe('executado');
    expect(rodou).toBe(true);
  });

  it('capacidade que EXIGE aprovação com token inválido é recusada pela APROVAÇÃO, não pelo teto', async () => {
    /*
     * A ordem importa: quem governa o caminho do token é a máquina de aprovação.
     * O teto só volta a falar quando ninguém aprovou nada — e é isso que o caso
     * acima e este, juntos, delimitam.
     */
    await noTeto();

    const r = await porta.executar(
      {
        capabilityId: 'whatsapp.mensagem.enviar',
        args: { corpo: 'oi' },
        ctx: ctx(),
        approvalToken: 'token-que-ninguem-emitiu',
      },
      async () => 'nunca',
    );

    expect(r.status).toBe('recusado');
    if (r.status === 'recusado') {
      expect(r.motivo).toContain('Token de aprovação inválido');
      expect(r.motivo).not.toContain('Teto de custo');
    }
  });

  it('ator HUMANO não é barrado pelo teto de IA: o teto é do modelo, não das pessoas', async () => {
    // `ActorType.user` é como o enum do Prisma chama a pessoa (não existe
    // `human`): escrever o nome errado aqui faria o caso passar por engano, com
    // `undefined` nunca batendo com `ActorType.ai`.
    await noTeto();

    let rodou = false;
    const r = await porta.executar(
      {
        capabilityId: 'numeros.painel.ler',
        args: {},
        ctx: ctx({ actorType: ActorType.user, actorId: 'pedro', agentSlug: null }),
      },
      async () => {
        rodou = true;
        return 'ok';
      },
    );

    expect(r.status).toBe('executado');
    expect(rodou).toBe(true);
  });

  it('empresa sem teto configurado: a porta se comporta exatamente como antes', async () => {
    await prisma.tetoDeCustoIa.deleteMany({ where: { orgId: ORG_A } });

    let rodou = false;
    const r = await porta.executar(
      { capabilityId: 'numeros.painel.ler', args: {}, ctx: ctx() },
      async () => {
        rodou = true;
        return 'ok';
      },
    );

    expect(r.status).toBe('executado');
    expect(rodou).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// O LAÇO DO AGENTE — o erro não pode escapar, e a sessão não pode ficar solta
// ---------------------------------------------------------------------------

describe.skipIf(!URL)('o laço do agente, quando o teto estoura no meio', () => {
  let prisma: PrismaClient;
  let runtime: AgentRuntime;
  let sessoes: SessionService;
  let espiao: ModeloEspiao;

  const ORG = ORG_B;

  /*
   * `procedencia` FAZ PARTE DO CONTRATO de `montar` desde 11/09/2026: é a marca de
   * mão única que o runtime passa ao `ExecCtx` e que acende `fonte_nao_confiavel`.
   * Um duplo que a omita derruba o laço de propósito — ver `AgentRuntime.absorver`.
   */
  const contexto = {
    montar: async () => ({ blocos: '', fontes: [], procedencia: new ProcedenciaExterna() }),
  } as unknown as ContextBuilder;

  beforeAll(async () => {
    vi.setSystemTime(AGORA);
    process.env.GATEWAY_MODO = 'impor';
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    await prisma.org.upsert({
      where: { id: ORG },
      create: { id: ORG, name: 'Empresa teto-ia-b', slug: 'teto-ia-b' },
      update: {},
    });
    await prisma.agent.upsert({
      where: { orgId_slug: { orgId: ORG, slug: 'assistente-teto' } },
      create: {
        orgId: ORG,
        slug: 'assistente-teto',
        nome: 'Assistente',
        iniciais: 'AT',
        missao: 'responder com fonte',
        tipo: AgentTipo.llm,
        estado: EstadoDeAgente.ativo,
        autonomiaAte: RiskLevel.R1,
        capacidades: ['numeros.painel.ler'],
      },
      update: { estado: EstadoDeAgente.ativo, ativo: true },
    });

    const p = prisma as unknown as PrismaService;
    const policy = new PolicyService(p);
    await policy.onModuleInit();
    const eventos = new EventLogService(p);
    const teto = new TetoDeCustoIaService(p, eventos);
    const gateway = new ToolGateway(
      p,
      policy,
      new SinaisService(p, policy),
      new ApprovalsService(p, new AuditService(p)),
      eventos,
      teto,
    );
    sessoes = new SessionService(p);
    espiao = new ModeloEspiao();
    runtime = new AgentRuntime(
      new ProviderComTeto(espiao, teto),
      p,
      policy,
      gateway,
      contexto,
      sessoes,
      new EfeitosRegistry(),
    );

    await prisma.tetoDeCustoIa.upsert({
      where: { orgId: ORG },
      create: { orgId: ORG, tetoDiarioUsd: 1 },
      update: { tetoDiarioUsd: 1, ativo: true, fusoHorario: 'America/Sao_Paulo' },
    });
    await prisma.gastoDeIaNoDia.upsert({
      where: { orgId_dia: { orgId: ORG, dia: DIA_SP } },
      create: { orgId: ORG, dia: DIA_SP, gastoUsd: 1 },
      update: { gastoUsd: 1, reservadoUsd: 0 },
    });
  });

  afterAll(async () => {
    vi.useRealTimers();
    await prisma.sessionStep.deleteMany({ where: { orgId: ORG } });
    await prisma.session.deleteMany({ where: { orgId: ORG } });
    await prisma.agent.deleteMany({ where: { orgId: ORG, slug: 'assistente-teto' } });
    await prisma.gastoDeIaNoDia.deleteMany({ where: { orgId: ORG } });
    await prisma.tetoDeCustoIa.deleteMany({ where: { orgId: ORG } });
    await prisma.$disconnect();
  });

  it('a sessão fecha como RECUSADA com o motivo, em vez de ficar pendurada', async () => {
    /*
     * O DEFEITO QUE ISTO CONSERTA.
     *
     * A exceção do teto subia do laço sem que ninguém a pegasse. A sessão já
     * tinha sido aberta e o pedido já estava gravado: ela ficava sem situação e
     * sem motivo, para sempre. Pela rota principal o operador via "erro interno
     * do servidor" — sem o motivo —, e só a rota de fluxo contínuo relatava a
     * mensagem. O critério da fatia pede as duas coisas: recusa com motivo
     * legível, e a execução interrompida com o motivo registrado.
     */
    const eventos: string[] = [];
    const resumo = await runtime.executar({
      orgId: ORG,
      agentSlug: 'assistente-teto',
      canal: SessionCanal.web,
      pedido: 'quanto entrou hoje?',
      solicitanteRotulo: 'Pedro',
      onEvento: (e) => eventos.push(e.t),
    });

    expect(espiao.chamadas).toBe(0); // o corte é ANTES da chamada, também aqui
    expect(resumo.status).toBe(SessionStatus.recusada);
    expect(resumo.recusaDeTeto?.motivo).toContain('Teto de custo de IA do dia');
    expect(resumo.motivo).toContain('Teto de custo de IA do dia');

    // A sessão no banco fecha junto — é ela que a tela e a auditoria leem.
    const sessao = await prisma.session.findUnique({ where: { id: resumo.sessionId } });
    expect(sessao?.status).toBe(SessionStatus.recusada);
    expect(sessao?.motivo).toContain('Teto de custo de IA do dia');

    // O fluxo contínuo continua relatando: erro e fim, nesta ordem.
    expect(eventos).toContain('erro');
    expect(eventos).toContain('fim');
  });

  it('a rota principal responde 429 com o motivo — não 500 genérico', async () => {
    /*
     * Sessão encerrada não basta: pela rota principal o operador continuava sem
     * saber o que aconteceu. 429 porque a semântica é a cota do período que
     * acabou e volta na virada do dia.
     */
    const controlador = new AgentsController(
      {} as never,
      runtime,
      sessoes as unknown as SessionService,
    );
    const erro = await controlador
      .executar(
        { orgId: ORG, sub: 'pedro', name: 'Pedro' } as never,
        'assistente-teto',
        { pedido: 'quanto entrou hoje?' },
      )
      .then(() => null)
      .catch((e: unknown) => e as HttpException);

    expect(erro).toBeInstanceOf(HttpException);
    expect(erro?.getStatus()).toBe(429);
    const corpo = erro?.getResponse() as Record<string, unknown>;
    expect(String(corpo.message)).toContain('Teto de custo de IA do dia');
    expect(corpo.error).toBe('teto_de_custo_de_ia');
    expect(corpo.sessionId).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// O ALCANCE — a chamada que NÃO nasce de requisição, e a porta lateral fechada
// ---------------------------------------------------------------------------

describe('o alcance do teto', () => {
  it('a ROTINA AGENDADA da pauta chama o modelo dentro do contexto da empresa', async () => {
    /*
     * A ENTRADA QUE MOTIVOU O DESENHO, e que o teto não alcançava.
     *
     * Das chamadas de modelo do produto, as de requisição herdam a empresa do
     * interceptor e a do agente abre contexto explícito. A ÚNICA que não nasce
     * de requisição é a do agendador — que é justamente o gasto que roda de
     * madrugada, sem ninguém olhando. Sem empresa, nada era reservado, nada era
     * contado, e o aviso saía uma vez por processo.
     *
     * O AGENDADOR MUDOU DE DONO NA FATIA 5.1 (rotinas por empresa), e este caso
     * mudou com ele: quem abre o contexto agora é `RotinasScheduler`, e a rotina
     * da pauta é uma rotina como as outras. A PROPRIEDADE SOB TESTE É A MESMA, e
     * é por isso que o caso continua aqui em vez de virar só um caso da suíte de
     * rotinas — é esta suíte que responde por "nada chama modelo sem empresa".
     *
     * O teste olha o que o teto olha: o que `contextoAtual()` devolve lá dentro.
     */
    const vistos: Array<{ onde: string; orgId?: string | null; origem?: string }> = [];
    const estado: EstadoDoBancoFalso = {
      rotinas: [],
      pautaRotinas: [
        pautaRotinaFalsa({ id: 'r1', orgId: ORG_A, slug: 'diaria', nome: 'Diária' }),
      ],
      execucoes: [],
    };
    const prismaFalso = prismaDeRotinas(estado);

    const anotar = (onde: string) => {
      const c = contextoAtual();
      vistos.push({ onde, orgId: c?.orgId, origem: c?.origem });
    };
    const rodadas = {
      coletarFeeds: async () => {
        anotar('coletarFeeds');
        return { novas: 0, fontes: 0 };
      },
      gerar: async () => {
        anotar('gerar');
        return { id: 'rodada-de-teste' };
      },
    } as unknown as RodadaService;

    const registro = new ExecutoresDeRotinaRegistry();
    // O executor de VERDADE, e não um dublê: é ele quem chama `gerar()`, e o que
    // está sob teste é o contexto em que essa chamada acontece.
    new ExecutorDePauta(prismaFalso, rodadas, registro).onModuleInit();
    const servico = new RotinasService(prismaFalso, auditoriaFalsa().servico, registro);
    const agendador = new RotinasScheduler(prismaFalso, servico);

    await agendador.tick();

    expect(vistos.map((v) => v.onde)).toEqual(['coletarFeeds', 'gerar']);
    for (const v of vistos) {
      expect(v.orgId).toBe(ORG_A);
      expect(v.origem).toBe('cron');
    }
    // E a passagem virou histórico: sem isso, "rodou dentro do contexto" seria
    // verdade sem ninguém conseguir conferir depois.
    expect(estado.execucoes.map((e) => e.status)).toEqual(['ok']);
  });

  it('o LlmModule NÃO exporta mais o provider da OpenAI cru', () => {
    /*
     * Ele era exportado por um módulo GLOBAL, com a justificativa de que quem o
     * injetasse estaria gerando embedding. A justificativa não conferia: ninguém
     * o injeta, e os dois pontos de vetorização falam com `/embeddings` por
     * `fetch` próprio. O que a exportação de fato oferecia era um caminho até
     * `complete()` e `step()` POR FORA do envelope do teto, aberto a qualquer
     * serviço da aplicação.
     */
    const exportados = (Reflect.getMetadata('exports', LlmModule) ?? []) as unknown[];
    const nomes = exportados.map((e) => (typeof e === 'function' ? e.name : String(e)));
    expect(nomes).not.toContain('OpenAiProvider');
    expect(nomes).toContain('TetoDeCustoIaService');
  });
});

// ---------------------------------------------------------------------------
// A CONTA QUE SUSTENTA O "ANTES" — sem banco, roda sempre
// ---------------------------------------------------------------------------

describe('estimativa de custo', () => {
  const prosa = (n: number) => tamanhoDeTexto('a'.repeat(n));

  it('a razão de texto é conservadora para prosa latina — e NÃO é limite superior', () => {
    /*
     * Português e inglês dão ~3,5 a 4 caracteres por token; usar 3 superestima o
     * número de tokens, que é o lado seguro. Só que isso vale para PROSA LATINA:
     * o arquivo, o comentário e este teste diziam "limite superior", e não era.
     * Os dois casos abaixo mostram por quê — e é por isso que o número passou a
     * ser chamado pelo que é.
     */
    expect(CARACTERES_POR_TOKEN_TEXTO).toBeLessThan(3.5);
    expect(estimarTokensDeEntrada(prosa(300))).toBe(100);
    expect(estimarTokensDeEntrada(prosa(301))).toBe(101); // arredonda para cima
    expect(estimarTokensDeEntrada(prosa(0))).toBe(0);
  });

  it('conteúdo ESTRUTURADO custa mais tokens por caractere que prosa', () => {
    // `{"a":1,"b":[2,3]}` vira quase um token por símbolo. Cobrá-lo à razão de
    // prosa subestimava justamente o bloco que mais aparece numa conversa com
    // ferramentas.
    const json = tamanhoEstruturado({ nome: 'x', valores: [1, 2, 3], ativo: true });
    const mesmoTamanho = prosa(json.estruturado);
    expect(CARACTERES_POR_TOKEN_ESTRUTURADO).toBeLessThan(CARACTERES_POR_TOKEN_TEXTO);
    expect(estimarTokensDeEntrada(json)).toBeGreaterThan(estimarTokensDeEntrada(mesmoTamanho));
  });

  it('alfabeto NÃO LATINO custa perto de um token por caractere', () => {
    // Em japonês a razão fica perto de 1: cobrar 1/3 de token por caractere
    // subestimava em três vezes.
    const japones = tamanhoDeTexto('日'.repeat(300));
    expect(estimarTokensDeEntrada(japones)).toBeGreaterThan(estimarTokensDeEntrada(prosa(300)) * 2);
    expect(estimarTokensDeEntrada(japones)).toBeGreaterThanOrEqual(290);
  });

  it('OS ESQUEMAS DAS FERRAMENTAS entram na conta', () => {
    /*
     * Eles sobem INTEIROS a cada passo — é a definição de todas as capacidades
     * que o agente declarou — e num agente com catálogo grande são o maior bloco
     * fixo da chamada, maior que o próprio pedido. Ficavam de fora.
     */
    const turns: LlmTurn[] = [{ role: 'user', text: 'oi' }];
    const ferramentas: LlmToolSpec[] = Array.from({ length: 8 }, (_, i) => ({
      name: `ferramenta_${i}`,
      description: 'faz uma coisa e devolve outra',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'o identificador do recurso' },
          janela: { type: 'number', description: 'em dias' },
        },
      },
    }));

    const sem = caracteresDaConversa('sistema', turns);
    const com = caracteresDaConversa('sistema', turns, ferramentas);

    expect(com.estruturado).toBeGreaterThan(sem.estruturado);
    expect(estimarTokensDeEntrada(com)).toBeGreaterThan(estimarTokensDeEntrada(sem) * 5);
  });

  it('cobra a saída pelo max_tokens declarado — o limite que o próprio pedido impõe', () => {
    const e = estimarCustoUsd('claude-opus-5', { entrada: prosa(0), tokensSaida: 1_000_000 });
    // 1M de tokens de saída em opus = US$ 25,00 na tabela de preco.ts
    expect(e.usd).toBeCloseTo(25, 6);
    expect(e.tokensSaida).toBe(1_000_000);
  });

  it('cobra a entrada pelo preço CHEIO, sem supor acerto de cache', () => {
    const e = estimarCustoUsd('claude-opus-5', {
      entrada: prosa(3_000_000), // = 1M de tokens na razão de prosa
      tokensSaida: 0,
    });
    // US$ 5,00/Mtok de entrada. Supor cache (10x mais barato) seria supor um
    // acerto que só se confirma depois da chamada.
    expect(e.usd).toBeCloseTo(5, 6);
  });

  it('a liquidação por resposta observada fica MUITO abaixo da reserva por max_tokens', () => {
    const entrada = tamanhoDeTexto('sistema', 'resuma o dia');
    const reserva = estimarCustoUsd('claude-opus-5', { entrada, tokensSaida: 1000 });
    const observado = estimarCustoDaResposta('claude-opus-5', {
      entrada,
      resposta: 'Resumo curto do dia, com dois números e uma recomendação.',
    });
    expect(observado.usd).toBeLessThan(reserva.usd / 5);
    expect(observado.usd).toBeGreaterThan(0);
  });

  it('modelo fora da tabela não vira custo zero: vira NÃO MEDÍVEL', () => {
    const e = estimarCustoUsd('modelo-que-ninguem-precificou', {
      entrada: prosa(1_000_000),
      tokensSaida: 50_000,
    });
    expect(e.medivel).toBe(false);
    expect(e.usd).toBe(0);
    // Os tokens continuam contados: o que falta é PREÇO, não tamanho.
    expect(e.tokensEntrada).toBeGreaterThan(0);
  });

  it('casa modelo com data no nome, como preco.ts', () => {
    const comData = estimarCustoUsd('claude-opus-5-20260101', { entrada: prosa(300), tokensSaida: 100 });
    const semData = estimarCustoUsd('claude-opus-5', { entrada: prosa(300), tokensSaida: 100 });
    expect(comData.usd).toBe(semData.usd);
    expect(comData.medivel).toBe(true);
  });

  it('mede a conversa inteira, blocos crus inclusive — é neles que o pensamento volta', () => {
    const turns: LlmTurn[] = [
      { role: 'user', text: 'a'.repeat(10) },
      { role: 'assistant', text: 'b'.repeat(5), raw: [{ type: 'thinking', thinking: 'c'.repeat(50) }] },
      { role: 'tool', results: [{ id: 't1', content: 'd'.repeat(20) }] },
    ];
    const n = caracteresDaConversa('s'.repeat(7), turns);

    // system + user + texto do assistente + o JSON do bloco cru + resultado
    expect(n.texto + n.estruturado).toBeGreaterThan(7 + 10 + 5 + 50 + 20);
  });

  it('bloco cru com ciclo não derruba a estimativa', () => {
    const ciclico: Record<string, unknown> = { a: 1 };
    ciclico.eu = ciclico;
    const n = caracteresDaConversa('', [{ role: 'assistant', text: 'x', raw: ciclico }]);
    expect(n.texto).toBe(1);
    expect(n.estruturado).toBe(0);
  });
});
