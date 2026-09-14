import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AgentTipo,
  EstadoDeAgente,
  PrismaClient,
  RiskLevel,
  SessionCanal,
  SessionStatus,
} from '@prisma/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AgentsService } from '../src/agents/agents.service';
import { AuditService } from '../src/audit/audit.service';
import { CheckoutDeTarefaService } from '../src/work/checkout-de-tarefa.service';
import { EventLogService } from '../src/gateway/event-log.service';
import {
  DESFECHO_BOM_DE_SESSAO,
  horasDoAgente,
  inicioDaJanela,
  janelaContada,
} from '../src/agents/horas-do-agente';
import {
  DIAS_DA_JANELA,
  JANELA_MS,
  horasDevolvidas,
  janelaDeLog,
  totalDaSemana,
} from '../../../packages/shared/src/horas-devolvidas';
import type { PrismaService } from '../src/prisma/prisma.service';

/* ==========================================================================
 * AS HORAS DEVOLVIDAS DE UM AGENTE — o conserto da mentira declarada
 * ==========================================================================
 *
 * A DÍVIDA, como o CLAUDE.md a registrava: "A tela de Agentes ainda mente sobre
 * o mesmo número: ela publica horas 'por semana' que são acumulado de vida
 * inteira, com as passagens que FALHARAM dentro, e mostra a fórmula na tela. As
 * duas telas agora publicam versões contraditórias do mesmo número."
 *
 * A conta errada era esta, na resposta do roster:
 *
 *     horasDevolvidas = minutosPorExecucao × Agent.execucoes / 60
 *
 * `Agent.execucoes` é contador de vida inteira e soma as passagens com ERRO.
 * `/rotinas` já contava certo — log real, só o que deu bom desfecho, janela de
 * sete dias. Esta fatia escolheu a conta de `/rotinas` como a verdade, moveu a
 * aritmética para `@mktos/shared` e ligou `/agentes` no log de passagens dele,
 * que é `Session`.
 *
 * O QUE ESTE ARQUIVO PROTEGE:
 *
 *  1. A ARITMÉTICA É UMA SÓ, e é a de `/rotinas`. O módulo compartilhado é o
 *     mesmo que a tela de rotinas usa (`apps/web/src/app/rotinas/horas.ts` virou
 *     adaptador dele).
 *  2. O SEMANAL NÃO SAI DO ACUMULADO. É o caso que fica vermelho se alguém
 *     publicar `execucoes` como "por semana" outra vez — por valor E por leitura
 *     do código que o produz.
 *  3. FALHA, RETENÇÃO E PASSAGEM FORA DA JANELA não devolvem tempo.
 *  4. AUSÊNCIA DE MEDIÇÃO NÃO É ZERO: sem linha de base declarada e sem log
 *     contado saem como estado próprio, e a tela mostra travessão.
 *
 * O módulo compartilhado é lido pelo CAMINHO, e não por `@mktos/shared`: o
 * pacote resolve para `dist/`, que é artefato de build, e um teste que dependa
 * de alguém ter rodado o build mede o build. É o mesmo padrão de
 * `test/modulos-por-tenant.test.ts` com `nav.ts`.
 * ========================================================================== */

const URL = process.env.TEST_DATABASE_URL;
const ORG = 'org-horas-do-agente';

// ---------------------------------------------------------------------------
// 1. A ARITMÉTICA — uma só, sem banco
// ---------------------------------------------------------------------------

describe('a conta das horas devolvidas, compartilhada entre /rotinas e /agentes', () => {
  const agora = new Date('2026-09-14T12:00:00-03:00').getTime();
  const hora = 3_600_000;
  const dia = 24 * hora;

  it('a janela é de sete dias — a constante que as duas telas anunciam', () => {
    expect(DIAS_DA_JANELA).toBe(7);
    expect(JANELA_MS).toBe(7 * dia);
  });

  it('sem linha de base declarada não há conta — e não há zero', () => {
    const m = horasDevolvidas(null, 40, {
      bemSucedidasNaJanela: 9,
      janelaCoberta: true,
      cobreDesde: null,
    });
    expect(m.estado).toBe('sem-linha-de-base');
    expect(m.minutosNaSemana).toBeNull();
    expect(m.minutosAcumulados).toBeNull();
  });

  it('sem log contado é `sem-historico`, e NÃO zero medido', () => {
    const m = horasDevolvidas(30, 4, null);
    expect(m.estado).toBe('sem-historico');
    expect(m.minutosNaSemana).toBeNull();
    // o acumulado continua existindo: ele não depende de log
    expect(m.minutosAcumulados).toBe(120);
  });

  it('O SEMANAL SAI DA JANELA, E O ACUMULADO DO CONTADOR — nunca trocados', () => {
    /*
     * ESTE É O CASO QUE MEDE A DÍVIDA. Cem passagens na vida, duas na semana:
     * a conta errada publicava 100 × 20 min; a certa publica 2 × 20 min. Os dois
     * números viajam, com nomes diferentes, e trocá-los derruba este caso.
     */
    const m = horasDevolvidas(20, 100, {
      bemSucedidasNaJanela: 2,
      janelaCoberta: true,
      cobreDesde: new Date(agora - 7 * dia).toISOString(),
    });
    expect(m.estado).toBe('medida');
    expect(m.minutosNaSemana).toBe(40);
    expect(m.minutosAcumulados).toBe(2000);
    expect(m.minutosNaSemana).not.toBe(m.minutosAcumulados);
  });

  it('semana sem nenhuma passagem é ZERO MEDIDO, e não ausência de medição', () => {
    const m = horasDevolvidas(45, 5, {
      bemSucedidasNaJanela: 0,
      janelaCoberta: true,
      cobreDesde: null,
    });
    expect(m.estado).toBe('medida');
    expect(m.minutosNaSemana).toBe(0);
  });

  it('o varredor do log conta só o bom desfecho, e só dentro dos sete dias', () => {
    const j = janelaDeLog(
      [
        { quandoIso: new Date(agora - hora).toISOString(), bomDesfecho: true },
        { quandoIso: new Date(agora - 2 * dia).toISOString(), bomDesfecho: true },
        { quandoIso: new Date(agora - 3 * hora).toISOString(), bomDesfecho: false },
        { quandoIso: new Date(agora - 8 * dia).toISOString(), bomDesfecho: true },
        { quandoIso: 'carimbo ilegível', bomDesfecho: true },
      ],
      agora,
      200,
    );
    expect(j.bemSucedidasNaJanela).toBe(2);
    expect(j.janelaCoberta).toBe(true);
  });

  it('log estourado no teto vira PISO, e a cobertura DIZ isso', () => {
    const cheio = Array.from({ length: 3 }, (_, i) => ({
      quandoIso: new Date(agora - (i + 1) * hora).toISOString(),
      bomDesfecho: true,
    }));
    const j = janelaDeLog(cheio, agora, 3);
    expect(j.bemSucedidasNaJanela).toBe(3);
    // um piso apresentado como total é a forma mais discreta de mentir num
    // número de venda
    expect(j.janelaCoberta).toBe(false);
  });

  it('a janela contada pelo BANCO é sempre coberta — não tem página para estourar', () => {
    const inicio = new Date(agora - JANELA_MS);
    const j = janelaContada(7, inicio);
    expect(j.bemSucedidasNaJanela).toBe(7);
    expect(j.janelaCoberta).toBe(true);
    expect(j.cobreDesde).toBe(inicio.toISOString());
  });

  it('o total declara o que ficou de fora, e VAZIO não é zero', () => {
    const medida = horasDevolvidas(30, 4, {
      bemSucedidasNaJanela: 2,
      janelaCoberta: true,
      cobreDesde: null,
    });
    const semBase = horasDevolvidas(null, 9, null);
    const semLog = horasDevolvidas(10, 2, null);

    const t = totalDaSemana([medida, semBase, semLog]);
    expect(t.minutos).toBe(60);
    expect(t.contadas).toBe(1);
    expect(t.semLinhaDeBase).toBe(1);
    expect(t.semHistorico).toBe(1);
    expect(t.vazio).toBe(false);

    expect(totalDaSemana([semBase]).vazio).toBe(true);
  });

  it('`inicioDaJanela` recua exatamente os sete dias', () => {
    const agoraDate = new Date(agora);
    expect(inicioDaJanela(agoraDate).getTime()).toBe(agora - JANELA_MS);
  });

  it('o desfecho que devolve tempo é lista FECHADA — retida e falhou ficam fora', () => {
    /*
     * Lista fechada de propósito: status novo em `SessionStatus` entra aqui por
     * decisão de alguém, e não por "não estava na lista de exclusão". `retida`
     * é o caso que mais tenta: o agente propôs, mas alguém ainda tem de
     * assinar, e até assinar nenhuma pessoa deixou de gastar os minutos dela.
     */
    expect([...DESFECHO_BOM_DE_SESSAO]).toEqual([
      SessionStatus.respondida,
      SessionStatus.executada,
    ]);
    for (const fora of [
      SessionStatus.rodando,
      SessionStatus.retida,
      SessionStatus.recusada,
      SessionStatus.falhou,
    ]) {
      expect(DESFECHO_BOM_DE_SESSAO as readonly SessionStatus[]).not.toContain(fora);
    }
  });

  it('a fórmula do agente é a MESMA função da conta compartilhada', () => {
    // `horasDoAgente` é adaptador: ele desconta as falhas do contador e delega.
    // Um segundo cálculo aqui dentro seria a segunda conta voltando.
    const janela = { bemSucedidasNaJanela: 3, janelaCoberta: true, cobreDesde: null };
    expect(horasDoAgente({ minutosPorExecucao: 15, execucoes: 80, falhas: 30 }, janela)).toEqual(
      horasDevolvidas(15, 50, janela),
    );
  });
});

// ---------------------------------------------------------------------------
// 2. A TRAVA DE CÓDIGO — a conta antiga não pode voltar por descuido
// ---------------------------------------------------------------------------

describe('a conta antiga não volta: acumulado publicado como semanal', () => {
  const fonte = readFileSync(
    path.join(__dirname, '..', 'src', 'agents', 'agents.service.ts'),
    'utf8',
  );

  it('o roster NÃO multiplica a linha de base pelo contador de vida inteira', () => {
    /*
     * A linha exata que existia aqui e mentia:
     *
     *     Number(((a.minutosPorExecucao * a.execucoes) / 60).toFixed(1))
     *
     * Ela reaparece com a mesma cara em qualquer reescrita descuidada — é a
     * conta "óbvia" quando se tem as duas colunas na mão e não se lembra de que
     * `execucoes` conta as falhas junto. Esta busca fica vermelha nesse dia.
     */
    const semComentario = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(semComentario).not.toMatch(/minutosPorExecucao\s*\*\s*a\.execucoes/);
    expect(semComentario).not.toMatch(/a\.execucoes\s*\*\s*a?\.?minutosPorExecucao/);
  });

  it('e o campo com o nome que não avisava nada saiu da resposta', () => {
    // `horasDevolvidas: number | null` no roster era o acumulado com as falhas
    // dentro. Quem lesse o nome continuaria publicando a mesma mentira.
    const semComentario = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(semComentario).not.toMatch(/horasDevolvidas:/);
  });
});

// ---------------------------------------------------------------------------
// 3. O ROSTER, CONTRA UM POSTGRES DE VERDADE
// ---------------------------------------------------------------------------

describe.skipIf(!URL)('o roster publica a semana medida, contra um Postgres de verdade', () => {
  let prisma: PrismaClient;
  let svc: AgentsService;
  let idDoAgente: string;

  /** Uma passagem do agente: uma sessão com desfecho e carimbo. */
  async function passagem(status: SessionStatus, quando: Date): Promise<void> {
    await prisma.session.create({
      data: {
        orgId: ORG,
        agentId: idDoAgente,
        canal: SessionCanal.web,
        solicitanteRotulo: 'teste',
        pedido: 'trabalhe',
        status,
        criadaEm: quando,
      },
    });
  }

  const agora = () => new Date('2026-09-14T12:00:00-03:00');
  const atras = (ms: number) => new Date(agora().getTime() - ms);

  beforeAll(async () => {
    vi.setSystemTime(agora());
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    const p = prisma as unknown as PrismaService;
    /*
     * O terceiro argumento é o CHECKOUT DE TAREFA (fatia A4): `definirEstado`
     * solta as tarefas do agente na mesma transação da mudança de estado, então
     * o serviço não monta mais sem ele. Esta suíte não pausa ninguém — ela mede
     * horas —, mas construir com um dublê aqui esconderia o dia em que a
     * soltura passasse a ser necessária e ninguém a injetasse.
     */
    svc = new AgentsService(
      p,
      new AuditService(p),
      new CheckoutDeTarefaService(p, new AuditService(p), new EventLogService(p)),
      new EventLogService(p),
    );

    await prisma.org.upsert({
      where: { id: ORG },
      create: { id: ORG, name: ORG, slug: ORG },
      update: {},
    });
    const a = await prisma.agent.upsert({
      where: { orgId_slug: { orgId: ORG, slug: 'analista' } },
      create: {
        orgId: ORG,
        slug: 'analista',
        nome: 'Analista',
        iniciais: 'AN',
        missao: 'medir horas devolvidas',
        tipo: AgentTipo.llm,
        estado: EstadoDeAgente.ativo,
        autonomiaAte: RiskLevel.R1,
        capacidades: [],
        /*
         * O ESTADO QUE A DÍVIDA PRODUZIA. Cem passagens na vida, cinquenta com
         * erro, vinte minutos de linha de base: a conta antiga publicava
         * 100 × 20 / 60 = 33,3 h "por semana".
         */
        minutosPorExecucao: 20,
        execucoes: 100,
        falhas: 50,
      },
      update: { minutosPorExecucao: 20, execucoes: 100, falhas: 50 },
    });
    idDoAgente = a.id;
  });

  afterAll(async () => {
    vi.useRealTimers();
    await prisma.session.deleteMany({ where: { orgId: ORG } });
    await prisma.agent.deleteMany({ where: { orgId: ORG } });
    await prisma.org.deleteMany({ where: { id: ORG } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.session.deleteMany({ where: { orgId: ORG } });
  });

  it('duas passagens boas na semana valem DUAS, e não as cem da vida inteira', async () => {
    await passagem(SessionStatus.respondida, atras(3_600_000));
    await passagem(SessionStatus.executada, atras(2 * 24 * 3_600_000));

    const r = await svc.roster(ORG);
    const a = r.items.find((x) => x.slug === 'analista')!;

    expect(a.horas.estado).toBe('medida');
    expect(a.horas.passagensNaSemana).toBe(2);
    expect(a.horas.naSemana).toBe(0.7); // 40 min
    expect(a.horas.diasDaJanela).toBe(DIAS_DA_JANELA);

    // CONTROLE NEGATIVO: o número que a tela publicava antes.
    expect(a.horas.naSemana).not.toBe(33.3);
    // o acumulado existe, com o nome dele, e desconta as falhas
    expect(a.horasAcumuladas).toBe(16.7); // 50 boas × 20 min
    expect(a.passagensBemSucedidas).toBe(50);

    // e o KPI da tela conta a MESMA coisa que o cartão de cada agente
    expect(r.kpis.horasSemana).toBe(0.7);
    expect(r.kpis.horasSemanaDe.agentesContados).toBe(1);
    expect(r.kpis.horasSemanaDe.diasDaJanela).toBe(DIAS_DA_JANELA);
  });

  it('falha, recusa e retenção na semana NÃO devolvem tempo', async () => {
    await passagem(SessionStatus.falhou, atras(3_600_000));
    await passagem(SessionStatus.recusada, atras(2 * 3_600_000));
    await passagem(SessionStatus.retida, atras(3 * 3_600_000));
    await passagem(SessionStatus.rodando, atras(4 * 3_600_000));

    const r = await svc.roster(ORG);
    const a = r.items.find((x) => x.slug === 'analista')!;

    expect(a.horas.passagensNaSemana).toBe(0);
    // zero MEDIDO: as passagens existem, e nenhuma devolveu tempo
    expect(a.horas.naSemana).toBe(0);
    expect(a.horas.estado).toBe('medida');
  });

  it('passagem boa mais velha que sete dias fica FORA da semana', async () => {
    await passagem(SessionStatus.respondida, atras(JANELA_MS + 3_600_000));

    const r = await svc.roster(ORG);
    const a = r.items.find((x) => x.slug === 'analista')!;
    expect(a.horas.passagensNaSemana).toBe(0);
    expect(a.horas.naSemana).toBe(0);
  });

  it('sem linha de base declarada, a tela recebe travessão e o motivo', async () => {
    await prisma.agent.updateMany({
      where: { orgId: ORG, slug: 'analista' },
      data: { minutosPorExecucao: 0 },
    });
    await passagem(SessionStatus.respondida, atras(3_600_000));

    const r = await svc.roster(ORG);
    const a = r.items.find((x) => x.slug === 'analista')!;
    expect(a.horas.estado).toBe('sem-linha-de-base');
    expect(a.horas.naSemana).toBeNull();
    expect(a.horasAcumuladas).toBeNull();
    expect(a.linhaDeBase).toBeNull();
    // nada medido: o KPI mostra travessão, não "0 h"
    expect(r.kpis.horasSemana).toBeNull();
    expect(r.kpis.horasSemanaDe.semLinhaDeBase).toBe(1);

    await prisma.agent.updateMany({
      where: { orgId: ORG, slug: 'analista' },
      data: { minutosPorExecucao: 20 },
    });
  });

  it('passagem de OUTRA empresa não entra nas horas desta', async () => {
    const outra = `${ORG}-vizinha`;
    await prisma.org.upsert({
      where: { id: outra },
      create: { id: outra, name: outra, slug: outra },
      update: {},
    });
    const agenteVizinho = await prisma.agent.upsert({
      where: { orgId_slug: { orgId: outra, slug: 'analista' } },
      create: {
        orgId: outra,
        slug: 'analista',
        nome: 'Analista',
        iniciais: 'AN',
        missao: 'trabalhar na vizinha',
        tipo: AgentTipo.llm,
        estado: EstadoDeAgente.ativo,
        capacidades: [],
        minutosPorExecucao: 20,
      },
      update: {},
    });
    await prisma.session.create({
      data: {
        orgId: outra,
        agentId: agenteVizinho.id,
        canal: SessionCanal.web,
        solicitanteRotulo: 'teste',
        pedido: 'trabalhe',
        status: SessionStatus.respondida,
        criadaEm: atras(3_600_000),
      },
    });

    try {
      const r = await svc.roster(ORG);
      const a = r.items.find((x) => x.slug === 'analista')!;
      expect(a.horas.passagensNaSemana).toBe(0);
    } finally {
      await prisma.session.deleteMany({ where: { orgId: outra } });
      await prisma.agent.deleteMany({ where: { orgId: outra } });
      await prisma.org.deleteMany({ where: { id: outra } });
    }
  });
});
