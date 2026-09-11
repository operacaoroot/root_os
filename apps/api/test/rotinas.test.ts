import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AgentEstado } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { contextoAtual } from '../src/common/contexto-execucao';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ExecutoresDeRotinaRegistry } from '../src/routines/executores.registry';
import { RotinasService } from '../src/routines/rotinas.service';
import { RotinasScheduler } from '../src/routines/rotinas.scheduler';
import { PautaSchedulerService } from '../src/pauta/scheduler.service';
import { gatilhoDaPautaDePe } from '../src/pauta/rotina.service';
import {
  agendadorDeRotinasDePe,
  anunciarAgendadorDeRotinas,
  esquecerAgendadorDeRotinas,
} from '../src/routines/sinal-do-agendador';
import {
  ARRENDAMENTO_MS,
  ESTADOS_QUE_DISPARAM,
  TIPO_PAUTA_RODADA,
  estadoDispara,
  type EstadoDoAgendador,
} from '../src/routines/rotina.tipos';
import {
  RESERVA_LIVRE,
  auditoriaFalsa,
  pautaRotinaFalsa,
  prismaDeRotinas,
  rotinaFalsa,
  type EstadoDoBancoFalso,
  type RotinaFalsa,
} from './prisma-de-rotinas';

/*
 * ROTINAS POR EMPRESA, COM ESTADO EXPLÍCITO — fatia 5.1 (RF-N-04).
 *
 * O QUE ESTA SUÍTE PRECISA PROVAR, e que separa a fatia feita da fingida:
 *
 *   1. o agendador ABRE O CONTEXTO DA EMPRESA antes de tocar em qualquer coisa,
 *      uma empresa de cada vez — é disso que dependem o isolamento por linha e o
 *      teto de custo de IA por empresa e por dia;
 *   2. o ESTADO é levado a sério: `planejado` e `pausado` não disparam,
 *      `rodando` e `aprendendo` disparam;
 *   3. toda passagem vira HISTÓRICO, os contadores são projeção dele, e a
 *      correlação gravada é a MESMA que o executor carregou;
 *   4. uma empresa que falha não derruba a varredura das outras — e, dentro da
 *      empresa, uma rotina que falha não derruba as outras;
 *   5. o mesmo minuto não dispara duas vezes, nem por tique atrasado nem por
 *      duas instâncias do agendador; e morrer no meio NÃO perde a ocorrência;
 *   6. a ROTINA DA PAUTA migrou: ela nasce do espelho de `PautaRotina`, roda
 *      pelo executor novo e devolve o carimbo à linha de origem;
 *   7. `PAUTA_CRON=off` não desliga mais nada além das rotinas da pauta;
 *   8. rotina apontando para executor que ninguém inscreveu não some em silêncio;
 *   9. NADA FICA MUDO: colisão de nome, origem removida e descoberta cega
 *      chegam à tela, e a troca de dono do agendamento derruba o arranque.
 *
 * RODA SEM BANCO, de propósito: o que está sob teste é ordem, contexto e
 * contabilidade — nenhum deles precisa de PostgreSQL, e todos precisam rodar na
 * máquina de quem não tem `TEST_DATABASE_URL`. Quem prova o isolamento por linha
 * de verdade é `tenant-isolation.test.ts`, contra banco e com o papel restrito.
 */

const ORG_A = 'org-rotinas-a';
const ORG_B = 'org-rotinas-b';

/** Sexta-feira, 11/09/2026, 10:00 em São Paulo (13:00 UTC). */
const AGORA = new Date('2026-09-11T13:00:00Z');
/** Minuto seguinte, para uma segunda batida que não caia no mesmo minuto. */
const DEPOIS = new Date(AGORA.getTime() + 60_000);

/** O valor de "livre" das colunas de reserva. Ver `prisma-de-rotinas.ts`. */
const livre = RESERVA_LIVRE;

function bancoVazio(): EstadoDoBancoFalso {
  return { rotinas: [], pautaRotinas: [], execucoes: [] };
}

/**
 * `rotinaFalsa` com a reserva escrita em duas palavras.
 *
 * Os DEFAULTs das duas colunas moram no dublê desde a correção da onda 9 — como
 * os dois índices únicos —, então aqui sobra só o açúcar de dizer "esta nasce
 * reservada até tal hora", que é o que metade dos casos precisa.
 */
function rotina(
  p: Partial<RotinaFalsa> & { id: string; orgId: string },
  reserva: { em?: Date; ate?: Date } = {},
): RotinaFalsa {
  return rotinaFalsa({
    ...p,
    ...(reserva.em ? { reservadoEm: reserva.em } : {}),
    ...(reserva.ate ? { reservadoAte: reserva.ate } : {}),
  });
}

interface Montagem {
  estado: EstadoDoBancoFalso;
  prisma: PrismaService;
  registro: ExecutoresDeRotinaRegistry;
  servico: RotinasService;
  agendador: RotinasScheduler;
  auditoria: ReturnType<typeof auditoriaFalsa>;
}

/**
 * Monta o agendador sobre o dublê.
 *
 * As duas coisas que esta função remendava — os DEFAULTs das colunas de reserva
 * e os DOIS ÍNDICES ÚNICOS de `Rotina` — mudaram para dentro do próprio dublê na
 * onda 9, que é onde elas valem para toda suíte que o usa. Remendo por suíte é
 * como duas suítes passam a testar bancos diferentes achando que testam o mesmo.
 */
function montar(estado: EstadoDoBancoFalso): Montagem {
  const prisma = prismaDeRotinas(estado);
  const registro = new ExecutoresDeRotinaRegistry();
  const auditoria = auditoriaFalsa();
  const servico = new RotinasService(prisma, auditoria.servico, registro);
  const agendador = new RotinasScheduler(prisma, servico);
  return { estado, prisma, registro, servico, agendador, auditoria };
}

/** O estado de agendador que a tela recebe quando tudo está de pé. */
const AGENDADOR_DE_PE: EstadoDoAgendador = {
  ativo: true,
  pautaDesligada: false,
  descobertaCega: false,
};

// Silencia os `Logger` do Nest: estas suítes exercitam caminhos de aviso de
// propósito, e o barulho esconderia a falha de verdade no meio do relatório.
const silencio = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {}, verbose: () => {} };
let ambienteAntes: { rotinas?: string; pauta?: string };

beforeEach(() => {
  Logger.overrideLogger(silencio);
  ambienteAntes = { rotinas: process.env.ROTINAS_CRON, pauta: process.env.PAUTA_CRON };
  delete process.env.ROTINAS_CRON;
  delete process.env.PAUTA_CRON;
  esquecerAgendadorDeRotinas();
});

afterEach(() => {
  if (ambienteAntes.rotinas === undefined) delete process.env.ROTINAS_CRON;
  else process.env.ROTINAS_CRON = ambienteAntes.rotinas;
  if (ambienteAntes.pauta === undefined) delete process.env.PAUTA_CRON;
  else process.env.PAUTA_CRON = ambienteAntes.pauta;
  esquecerAgendadorDeRotinas();
});

// ---------------------------------------------------------------------------
// 1. O REGISTRO DE EXECUTORES
// ---------------------------------------------------------------------------

describe('registro de executores', () => {
  it('inscrever o mesmo tipo duas vezes LANÇA', () => {
    const r = new ExecutoresDeRotinaRegistry();
    r.registrar({ 'x.y': async () => ({ status: 'ok', resumo: '' }) }, 'primeiro');
    expect(() =>
      r.registrar({ 'x.y': async () => ({ status: 'ok', resumo: '' }) }, 'segundo'),
    ).toThrow(/inscrito duas vezes/);
  });

  it('a mensagem diz QUEM inscreveu antes — sem isso o erro não localiza nada', () => {
    const r = new ExecutoresDeRotinaRegistry();
    r.registrar({ 'x.y': async () => ({ status: 'ok', resumo: '' }) }, 'ExecutorDePauta');
    expect(() => r.registrar({ 'x.y': async () => ({ status: 'ok', resumo: '' }) }, 'Outro')).toThrow(
      /"ExecutorDePauta".*"Outro"/s,
    );
    expect(r.donoDe('x.y')).toBe('ExecutorDePauta');
  });

  it('executar tipo não inscrito LANÇA em vez de devolver "pulada"', async () => {
    const r = new ExecutoresDeRotinaRegistry();
    await expect(
      r.executar('nao.existe', {
        orgId: ORG_A,
        rotinaId: 'r',
        slug: 'orfa',
        config: {},
        refExterna: null,
        origem: 'cron',
        correlationId: 'c',
        agora: AGORA,
      }),
    ).rejects.toThrow(/ninguém inscreveu/);
  });
});

// ---------------------------------------------------------------------------
// 2. O ESTADO EXPLÍCITO
// ---------------------------------------------------------------------------

describe('estado explícito', () => {
  it('só rodando e aprendendo disparam', () => {
    expect([...ESTADOS_QUE_DISPARAM]).toEqual([AgentEstado.rodando, AgentEstado.aprendendo]);
    expect(estadoDispara(AgentEstado.planejado)).toBe(false);
    expect(estadoDispara(AgentEstado.pausado)).toBe(false);
  });

  it('rotina planejada NÃO roda, mesmo com cron batendo e interruptor ligado', async () => {
    const estado = bancoVazio();
    estado.rotinas.push(
      rotina({ id: 'r-plan', orgId: ORG_A, tipo: 't', estado: AgentEstado.planejado }),
      rotina({ id: 'r-pausada', orgId: ORG_A, tipo: 't', estado: AgentEstado.pausado }),
      rotina({ id: 'r-aprendendo', orgId: ORG_A, tipo: 't', estado: AgentEstado.aprendendo }),
    );
    const m = montar(estado);
    const rodou: string[] = [];
    m.registro.registrar(
      { t: async (ctx) => { rodou.push(ctx.rotinaId); return { status: 'ok', resumo: 'feito' }; } },
      'teste',
    );

    await m.agendador.tick(AGORA);

    expect(rodou).toEqual(['r-aprendendo']);
  });

  it('interruptor desligado não roda nem em estado rodando — são duas perguntas', async () => {
    const estado = bancoVazio();
    estado.rotinas.push(
      rotina({ id: 'r1', orgId: ORG_A, tipo: 't', ativo: false, estado: AgentEstado.rodando }),
    );
    const m = montar(estado);
    let rodou = 0;
    m.registro.registrar({ t: async () => { rodou += 1; return { status: 'ok', resumo: '' }; } }, 'teste');

    await m.agendador.tick(AGORA);

    expect(rodou).toBe(0);
  });

  it('numa rotina MANUAL, mudar o estado não mexe no interruptor, e vice-versa', async () => {
    const estado = bancoVazio();
    estado.rotinas.push(
      rotina({ id: 'r1', orgId: ORG_A, tipo: 't', ativo: true, estado: AgentEstado.planejado }),
    );
    const m = montar(estado);

    await m.servico.definirEstado(ORG_A, 'r1', AgentEstado.rodando, 'pedro');
    expect(estado.rotinas[0].estado).toBe(AgentEstado.rodando);
    expect(estado.rotinas[0].ativo).toBe(true);

    await m.servico.definirAtivo(ORG_A, 'r1', false, 'pedro');
    expect(estado.rotinas[0].ativo).toBe(false);
    expect(estado.rotinas[0].estado).toBe(AgentEstado.rodando);

    const acoes = m.auditoria.linhas.map((l) => l.action);
    expect(acoes).toEqual(['rotina.estado_alterado', 'rotina.ativo_alterado']);
  });

  it('NO ESPELHO DA PAUTA, o estado declarado DESCE para a rotina de origem', async () => {
    /*
     * O defeito: declarar `pausado` aqui parava o disparo e deixava a tela de
     * Pauta anunciando a rotina como ativa — a tela antiga mentindo, com a nova
     * mostrando a verdade, e ninguém sabendo qual das duas olhar. O interruptor
     * já descia; o estado, não.
     */
    const estado = bancoVazio();
    estado.pautaRotinas.push(pautaRotinaFalsa({ id: 'pr-1', orgId: ORG_A, slug: 'ia', nome: 'IA' }));
    const m = montar(estado);
    await m.servico.reconciliarPauta(ORG_A);
    const id = estado.rotinas[0].id;

    await m.servico.definirEstado(ORG_A, id, AgentEstado.pausado, 'pedro');
    expect(estado.pautaRotinas[0].ativo).toBe(false);
    expect(estado.rotinas[0].ativo).toBe(false);
    expect(estado.rotinas[0].proximaExecucaoEm).toBeNull();

    // E o caminho de volta existe: declarar que voltou a rodar religa a origem.
    await m.servico.definirEstado(ORG_A, id, AgentEstado.rodando, 'pedro');
    expect(estado.pautaRotinas[0].ativo).toBe(true);
    expect(estado.rotinas[0].ativo).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. A VARREDURA EMPRESA POR EMPRESA — o coração da fatia
// ---------------------------------------------------------------------------

describe('varredura empresa por empresa', () => {
  it('o executor roda DENTRO do contexto da empresa, com origem cron', async () => {
    /*
     * É a propriedade da qual dependem três coisas ao mesmo tempo: o isolamento
     * por linha (a empresa do contexto vira `app.org_id`), o teto de custo de IA
     * por empresa e por dia, e a correlação do RASTRO. O teste olha o que o teto
     * olha: o que `contextoAtual()` devolve lá dentro.
     */
    const estado = bancoVazio();
    estado.rotinas.push(
      rotina({ id: 'r-a', orgId: ORG_A, tipo: 't' }),
      rotina({ id: 'r-b', orgId: ORG_B, tipo: 't' }),
    );
    const m = montar(estado);
    const vistos: Array<{ rotina: string; orgId?: string | null; origem?: string }> = [];
    m.registro.registrar(
      {
        t: async (ctx) => {
          const c = contextoAtual();
          vistos.push({ rotina: ctx.rotinaId, orgId: c?.orgId, origem: c?.origem });
          return { status: 'ok', resumo: 'feito' };
        },
      },
      'teste',
    );

    await m.agendador.tick(AGORA);

    expect(vistos.map((v) => v.rotina)).toEqual(['r-a', 'r-b']);
    expect(vistos[0].orgId).toBe(ORG_A);
    expect(vistos[1].orgId).toBe(ORG_B);
    for (const v of vistos) expect(v.origem).toBe('cron');
    // Uma empresa por vez: nada de contexto de plataforma, nada de empresa em
    // branco. Ausência de empresa é erro, nunca "todas" (RF-T-04).
    expect(new Set(vistos.map((v) => v.orgId)).size).toBe(2);
  });

  it('a CORRELAÇÃO do histórico é a MESMA que o executor carrega, e o tique é o pai', async () => {
    /*
     * O fio estava partido: a linha de histórico guardava um identificador
     * cunhado só para ela, e o que ia para o RASTRO era o do tique — que, ainda
     * por cima, era o mesmo para todas as rotinas daquela empresa naquele
     * minuto. Nem por empresa o fio separava. Com o contexto aninhado, a
     * correlação da passagem é uma só, e a do tique vira `correlacaoPai`.
     */
    const estado = bancoVazio();
    estado.rotinas.push(
      rotina({ id: 'r1', orgId: ORG_A, tipo: 't' }),
      rotina({ id: 'r2', orgId: ORG_A, tipo: 't' }),
    );
    const m = montar(estado);
    const dentro: Array<{ correlacao?: string; pai?: string | null }> = [];
    m.registro.registrar(
      {
        t: async () => {
          const c = contextoAtual();
          dentro.push({ correlacao: c?.correlationId, pai: c?.correlacaoPai });
          return { status: 'ok', resumo: 'feito' };
        },
      },
      'teste',
    );

    await m.agendador.tick(AGORA);

    expect(estado.execucoes).toHaveLength(2);
    for (const [i, e] of estado.execucoes.entries()) {
      expect(e.correlationId).toMatch(/^rotina-/);
      expect(dentro[i].correlacao).toBe(e.correlationId);
      expect(dentro[i].pai).toMatch(/^tique-/);
    }
    // Duas rotinas, duas correlações. A do tique é a mesma; a da passagem, não.
    expect(new Set(estado.execucoes.map((e) => e.correlationId)).size).toBe(2);
    expect(new Set(dentro.map((d) => d.pai)).size).toBe(1);
  });

  it('uma empresa que falha não impede a varredura das outras', async () => {
    const estado = bancoVazio();
    estado.rotinas.push(
      rotina({ id: 'r-a', orgId: ORG_A, tipo: 't' }),
      rotina({ id: 'r-b', orgId: ORG_B, tipo: 't' }),
    );
    const m = montar(estado);
    m.registro.registrar(
      {
        t: async (ctx) => {
          if (ctx.orgId === ORG_A) throw new Error('provedor fora do ar');
          return { status: 'ok', resumo: 'feito' };
        },
      },
      'teste',
    );

    await m.agendador.tick(AGORA);

    const porRotina = Object.fromEntries(estado.execucoes.map((e) => [e.rotinaId, e.status]));
    expect(porRotina).toEqual({ 'r-a': 'erro', 'r-b': 'ok' });
    expect(estado.rotinas.find((r) => r.id === 'r-a')?.falhas).toBe(1);
    expect(estado.rotinas.find((r) => r.id === 'r-b')?.falhas).toBe(0);
  });

  it('uma rotina que falha FORA do executor não derruba as outras da MESMA empresa', async () => {
    /*
     * A promessa era "empresa que falha não derruba as outras", e só o executor
     * estava protegido. Gravar o histórico e fechar a passagem são duas escritas
     * que podem falhar sozinhas, e a exceção subia até a varredura: as rotinas
     * SEGUINTES daquela empresa não rodavam naquele minuto — sem nada nas
     * linhas delas dizendo por quê.
     */
    const estado = bancoVazio();
    estado.rotinas.push(
      rotina({ id: 'r1', orgId: ORG_A, tipo: 't', nome: 'primeira' }),
      rotina({ id: 'r2', orgId: ORG_A, tipo: 't', nome: 'segunda' }),
    );
    const m = montar(estado);
    const execucoes = m.prisma.rotinaExecucao as unknown as Record<string, unknown>;
    const criarOriginal = (execucoes.create as (a: unknown) => Promise<unknown>).bind(execucoes);
    execucoes.create = async (args: { data: { rotinaId: string } }) => {
      if (args.data.rotinaId === 'r1') throw new Error('banco recusou a escrita do histórico');
      return criarOriginal(args);
    };

    const rodou: string[] = [];
    m.registro.registrar(
      { t: async (ctx) => { rodou.push(ctx.rotinaId); return { status: 'ok', resumo: 'feito' }; } },
      'teste',
    );

    await m.agendador.tick(AGORA);

    expect(rodou).toEqual(['r1', 'r2']);
    expect(estado.execucoes.map((e) => e.rotinaId)).toEqual(['r2']);
    // A que perdeu o histórico ainda assim contou a execução: o número sem a
    // linha é perda visível, e a linha de log diz qual foi.
    expect(estado.rotinas.find((r) => r.id === 'r1')?.execucoes).toBe(1);
  });

  it('cron que não bate não dispara — e cron inválido também não derruba o tique', async () => {
    const estado = bancoVazio();
    estado.rotinas.push(
      rotina({ id: 'r-fora', orgId: ORG_A, tipo: 't', cron: '0 3 * * *' }),
      rotina({ id: 'r-quebrada', orgId: ORG_A, tipo: 't', cron: 'todo dia' }),
      rotina({ id: 'r-agora', orgId: ORG_A, tipo: 't', cron: '0 10 * * *' }),
    );
    const m = montar(estado);
    const rodou: string[] = [];
    m.registro.registrar(
      { t: async (ctx) => { rodou.push(ctx.rotinaId); return { status: 'ok', resumo: '' }; } },
      'teste',
    );

    // 10:00 em São Paulo. `r-agora` bate; `r-fora` não; `r-quebrada` nem é lida.
    await m.agendador.tick(AGORA);

    expect(rodou).toEqual(['r-agora']);
  });
});

// ---------------------------------------------------------------------------
// 4. HISTÓRICO E CONTADORES
// ---------------------------------------------------------------------------

describe('histórico de execução', () => {
  it('execução bem-sucedida vira linha, conta e calcula a próxima', async () => {
    const estado = bancoVazio();
    estado.rotinas.push(rotina({ id: 'r1', orgId: ORG_A, tipo: 't', cron: '0 10 * * *' }));
    const m = montar(estado);
    m.registro.registrar({ t: async () => ({ status: 'ok', resumo: 'rodada abc' }) }, 'teste');

    await m.agendador.tick(AGORA);

    expect(estado.execucoes).toHaveLength(1);
    const e = estado.execucoes[0];
    expect(e.status).toBe('ok');
    expect(e.origem).toBe('cron');
    expect(e.resumo).toBe('rodada abc');
    expect(e.erro).toBeNull();
    expect(e.correlationId).toMatch(/^rotina-/);
    expect(e.duracaoMs).toBeGreaterThanOrEqual(0);

    const r = estado.rotinas[0];
    expect(r.execucoes).toBe(1);
    expect(r.falhas).toBe(0);
    expect(r.ultimoStatus).toBe('ok: rodada abc');
    expect(r.ultimaExecucaoEm?.toISOString()).toBe(AGORA.toISOString());
    // 10:00 de hoje já passou neste instante; a próxima é amanhã, 10:00 em SP.
    expect(r.proximaExecucaoEm?.toISOString()).toBe('2026-09-12T13:00:00.000Z');
  });

  it('falha vira linha de erro, conta em falhas e guarda o motivo', async () => {
    const estado = bancoVazio();
    estado.rotinas.push(rotina({ id: 'r1', orgId: ORG_A, tipo: 't' }));
    const m = montar(estado);
    m.registro.registrar({ t: async () => { throw new Error('sem crédito no provedor'); } }, 'teste');

    await m.agendador.tick(AGORA);

    expect(estado.execucoes[0].status).toBe('erro');
    expect(estado.execucoes[0].erro).toBe('sem crédito no provedor');
    expect(estado.execucoes[0].resumo).toBeNull();
    expect(estado.rotinas[0].falhas).toBe(1);
    expect(estado.rotinas[0].execucoes).toBe(1);
    expect(estado.rotinas[0].ultimoStatus).toContain('erro:');
  });

  it('"pulada" NÃO vira histórico, NÃO mexe em contador e NÃO carimba a última execução', async () => {
    /*
     * O executor que acorda e descobre que não havia o que fazer é o caso comum
     * de uma rotina que checa de minuto em minuto. Registrar isso encheria o
     * diário de bordo de nada.
     *
     * E `ultimaExecucaoEm` é a parte que a revisão pegou: enquanto a reserva do
     * minuto morava naquele campo, ela o carimbava ANTES do executor, e o
     * carimbo ficava. A tela da rotina que só pula dizia "última execução há um
     * minuto, zero execuções" para sempre — exatamente a rotina para a qual
     * `pulada` existe.
     */
    const estado = bancoVazio();
    estado.rotinas.push(rotina({ id: 'r1', orgId: ORG_A, tipo: 't' }));
    const m = montar(estado);
    m.registro.registrar({ t: async () => ({ status: 'pulada', resumo: 'nada a fazer' }) }, 'teste');

    await m.agendador.tick(AGORA);

    expect(estado.execucoes).toHaveLength(0);
    expect(estado.rotinas[0].execucoes).toBe(0);
    expect(estado.rotinas[0].falhas).toBe(0);
    expect(estado.rotinas[0].ultimaExecucaoEm).toBeNull();
    expect(estado.rotinas[0].ultimoStatus).toBeNull();
    // A próxima ocorrência é recalculada mesmo assim: ela não depende de ter
    // acontecido alguma coisa.
    expect(estado.rotinas[0].proximaExecucaoEm).not.toBeNull();
  });

  it('rotina sem executor inscrito falha COM MOTIVO em vez de sumir em silêncio', async () => {
    const estado = bancoVazio();
    estado.rotinas.push(rotina({ id: 'r1', orgId: ORG_A, tipo: 'fantasma' }));
    const m = montar(estado);

    await m.agendador.tick(AGORA);

    expect(estado.execucoes[0].status).toBe('erro');
    expect(estado.execucoes[0].erro).toContain('ninguém inscreveu');
    expect(estado.rotinas[0].falhas).toBe(1);
  });

  it('a tela recebe estado e histórico reais, com horas devolvidas só quando declaradas', async () => {
    const estado = bancoVazio();
    estado.rotinas.push(
      rotina({ id: 'r1', orgId: ORG_A, tipo: 't', nome: 'Com base', minutosPorExecucao: 12 }),
      rotina({ id: 'r2', orgId: ORG_A, tipo: 't', nome: 'Sem base' }),
    );
    const m = montar(estado);
    m.registro.registrar({ t: async () => ({ status: 'ok', resumo: 'ok' }) }, 'teste');

    await m.agendador.tick(AGORA);
    const lista = await m.servico.listar(ORG_A, AGENDADOR_DE_PE);

    const comBase = lista.items.find((i) => i.id === 'r1');
    const semBase = lista.items.find((i) => i.id === 'r2');
    expect(comBase?.minutosDevolvidos).toBe(12);
    expect(semBase?.minutosPorExecucao).toBeNull();
    expect(semBase?.minutosDevolvidos).toBeNull();
    expect(lista.items.every((i) => i.temExecutor)).toBe(true);
    expect(lista.execucoes).toHaveLength(2);
    expect(lista.agendadorAtivo).toBe(true);
    expect(lista.descobertaCega).toBe(false);
    expect(lista.avisos).toEqual([]);

    const historico = await m.servico.historico(ORG_A, 'r1');
    expect(historico).toHaveLength(1);
    expect(historico[0].rotinaId).toBe('r1');
  });
});

// ---------------------------------------------------------------------------
// 5. A RESERVA: UMA VEZ POR MINUTO, E COM PRAZO
// ---------------------------------------------------------------------------

describe('reserva com prazo', () => {
  it('tique repetido no mesmo minuto não dispara de novo', async () => {
    const estado = bancoVazio();
    estado.rotinas.push(rotina({ id: 'r1', orgId: ORG_A, tipo: 't' }));
    const m = montar(estado);
    let rodou = 0;
    m.registro.registrar({ t: async () => { rodou += 1; return { status: 'ok', resumo: '' }; } }, 'teste');

    await m.agendador.tick(AGORA);
    await m.agendador.tick(new Date(AGORA.getTime() + 30_000)); // mesmo minuto

    expect(rodou).toBe(1);
  });

  it('DUAS instâncias do agendador no mesmo minuto disparam UMA vez', async () => {
    /*
     * A trava não pode viver na memória do processo: com duas réplicas da API,
     * cada uma teria a sua e as duas gastariam modelo. Quem decide é o banco, no
     * `UPDATE` condicional da reserva — e este caso existe porque o agendador
     * antigo deixou isto anotado como pendência de advisory lock.
     */
    const estado = bancoVazio();
    estado.rotinas.push(rotina({ id: 'r1', orgId: ORG_A, tipo: 't' }));
    const a = montar(estado);
    const b = montar(estado);
    let rodou = 0;
    const executor = { t: async () => { rodou += 1; return { status: 'ok' as const, resumo: '' }; } };
    a.registro.registrar(executor, 'a');
    b.registro.registrar(executor, 'b');

    await a.agendador.tick(AGORA);
    await b.agendador.tick(AGORA);

    expect(rodou).toBe(1);
    expect(estado.execucoes).toHaveLength(1);
  });

  it('morrer entre reservar e executar NÃO perde a ocorrência: o tique retoma', async () => {
    /*
     * O defeito: a reserva era um carimbo, e carimbo não vence. Um deploy no meio
     * da rodada diária fazia a ocorrência sumir em silêncio e ninguém a retomava
     * — o prejuízo era o dia inteiro, porque o cron só bateria de novo amanhã.
     *
     * A linha abaixo é o retrato de um processo morto: arrendamento tomado
     * (`reservadoAte` diferente da época), vencido, e nunca devolvido. O cron
     * NÃO bate agora, de propósito: é a retomada que tem de acontecer.
     */
    const estado = bancoVazio();
    estado.rotinas.push(
      rotina(
        { id: 'r1', orgId: ORG_A, tipo: 't', cron: '0 3 * * *' },
        { em: new Date(AGORA.getTime() - 3600_000), ate: new Date(AGORA.getTime() - 60_000) },
      ),
    );
    const m = montar(estado);
    let rodou = 0;
    m.registro.registrar({ t: async () => { rodou += 1; return { status: 'ok', resumo: 'refeita' }; } }, 'teste');

    await m.agendador.tick(AGORA);

    expect(rodou).toBe(1);
    expect(estado.execucoes[0].status).toBe('ok');
    // Devolvida: o arrendamento volta a ser a época, e não fica pendurado.
    expect((estado.rotinas[0] as unknown as { reservadoAte: Date }).reservadoAte.getTime()).toBe(0);
  });

  it('execução EM CURSO não é retomada por engano', async () => {
    const estado = bancoVazio();
    estado.rotinas.push(
      rotina(
        { id: 'r1', orgId: ORG_A, tipo: 't' },
        { em: new Date(AGORA.getTime() - 3600_000), ate: new Date(AGORA.getTime() + ARRENDAMENTO_MS) },
      ),
    );
    const m = montar(estado);
    let rodou = 0;
    m.registro.registrar({ t: async () => { rodou += 1; return { status: 'ok', resumo: '' }; } }, 'teste');

    await m.agendador.tick(AGORA);

    expect(rodou).toBe(0);
  });

  it('rodar na mão NÃO consome o minuto — a execução agendada acontece do mesmo jeito', async () => {
    /*
     * O defeito: o clique gravava `ultimaExecucaoEm`, e a reserva do tique lia
     * daquele mesmo campo. Clicar em "rodar agora" cancelava, em silêncio, a
     * execução que estava para acontecer no mesmo minuto. Hoje o minuto tem
     * coluna própria e só o tique o carimba.
     */
    const estado = bancoVazio();
    estado.rotinas.push(rotina({ id: 'r1', orgId: ORG_A, tipo: 't' }));
    const m = montar(estado);
    let rodou = 0;
    m.registro.registrar({ t: async () => { rodou += 1; return { status: 'ok', resumo: 'ok' }; } }, 'teste');

    await m.servico.rodarAgora(ORG_A, 'r1', 'pedro');
    await m.agendador.tick(AGORA);

    expect(rodou).toBe(2);
    expect(estado.execucoes.map((e) => e.origem)).toEqual(['manual', 'cron']);
    expect(m.auditoria.linhas.map((l) => l.action)).toContain('rotina.rodada_manual');
  });

  it('rodar na mão o que já está rodando é RECUSADO, e não devolve desfecho falso', async () => {
    const estado = bancoVazio();
    estado.rotinas.push(
      rotina(
        { id: 'r1', orgId: ORG_A, tipo: 't' },
        { ate: new Date(Date.now() + ARRENDAMENTO_MS) },
      ),
    );
    const m = montar(estado);
    m.registro.registrar({ t: async () => ({ status: 'ok', resumo: '' }) }, 'teste');

    await expect(m.servico.rodarAgora(ORG_A, 'r1', 'pedro')).rejects.toThrow(/já está em execução/);
    expect(estado.execucoes).toHaveLength(0);
  });

  it('rodar na mão uma rotina sem executor é recusado na porta, não no meio', async () => {
    const estado = bancoVazio();
    estado.rotinas.push(rotina({ id: 'r1', orgId: ORG_A, tipo: 'fantasma' }));
    const m = montar(estado);
    await expect(m.servico.rodarAgora(ORG_A, 'r1', 'pedro')).rejects.toThrow(/não está inscrito/);
    expect(estado.execucoes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. A ROTINA DA PAUTA MIGROU
// ---------------------------------------------------------------------------

describe('a rotina da pauta pelo mecanismo novo', () => {
  it('a PautaRotina vira Rotina espelho, com estado vindo do interruptor', async () => {
    const estado = bancoVazio();
    estado.pautaRotinas.push(
      pautaRotinaFalsa({ id: 'pr-1', orgId: ORG_A, slug: 'noticias-ia', nome: 'Notícias de IA', config: { horas: 48 } }),
      pautaRotinaFalsa({ id: 'pr-2', orgId: ORG_A, slug: 'pausada', nome: 'Pausada', ativo: false }),
    );
    const m = montar(estado);
    m.registro.registrar({ [TIPO_PAUTA_RODADA]: async () => ({ status: 'ok', resumo: 'rodada' }) }, 'teste');

    await m.servico.reconciliarPauta(ORG_A);

    const espelhos = estado.rotinas;
    expect(espelhos).toHaveLength(2);
    const viva = espelhos.find((r) => r.refExterna === 'pr-1');
    expect(viva?.slug).toBe('pauta-noticias-ia');
    expect(viva?.tipo).toBe(TIPO_PAUTA_RODADA);
    expect(viva?.origem).toBe('pauta');
    expect(viva?.agenteSlug).toBe('editor-de-pauta');
    expect(viva?.estado).toBe(AgentEstado.rodando);
    expect(viva?.config).toEqual({ horas: 48 });

    const parada = espelhos.find((r) => r.refExterna === 'pr-2');
    expect(parada?.estado).toBe(AgentEstado.pausado);
    // Rotina que não dispara não anuncia horário: a tela não promete o que não
    // vai acontecer.
    expect(parada?.proximaExecucaoEm).toBeNull();
  });

  it('a reconciliação traz edição da tela de Pauta e NÃO desfaz decisão de gente', async () => {
    const estado = bancoVazio();
    estado.pautaRotinas.push(pautaRotinaFalsa({ id: 'pr-1', orgId: ORG_A, slug: 'ia', nome: 'IA' }));
    const m = montar(estado);

    await m.servico.reconciliarPauta(ORG_A);
    // Uma pessoa declara que isto está em observação e vale 20 minutos de gente.
    await m.servico.definirEstado(ORG_A, estado.rotinas[0].id, AgentEstado.aprendendo, 'pedro');
    await m.servico.definirLinhaDeBase(ORG_A, estado.rotinas[0].id, 20, 'pedro');

    // E a tela de Pauta muda o cron e o nome.
    estado.pautaRotinas[0].cron = '0 7 * * 1,3,5';
    estado.pautaRotinas[0].nome = 'IA, 3x por semana';
    const r = await m.servico.reconciliarPauta(ORG_A);

    expect(r.criadas).toBe(0);
    expect(r.atualizadas).toBe(1);
    expect(r.orfas).toBe(0);
    expect(estado.rotinas[0].cron).toBe('0 7 * * 1,3,5');
    expect(estado.rotinas[0].nome).toBe('IA, 3x por semana');
    expect(estado.rotinas[0].estado).toBe(AgentEstado.aprendendo);
    expect(estado.rotinas[0].minutosPorExecucao).toBe(20);
  });

  it('renomear o SLUG na tela de Pauta é percebido — a comparação olha o nome', async () => {
    /*
     * O gatilho auxiliar não olhava o slug: o `update` até escrevia o nome novo,
     * mas só era chamado quando outra coisa mudava junto. Renomear e mais nada
     * deixava o espelho com o nome velho para sempre.
     */
    const estado = bancoVazio();
    estado.pautaRotinas.push(pautaRotinaFalsa({ id: 'pr-1', orgId: ORG_A, slug: 'ia', nome: 'IA' }));
    const m = montar(estado);
    await m.servico.reconciliarPauta(ORG_A);
    expect(estado.rotinas[0].slug).toBe('pauta-ia');

    estado.pautaRotinas[0].slug = 'inteligencia-artificial';
    const r = await m.servico.reconciliarPauta(ORG_A);

    expect(r.atualizadas).toBe(1);
    expect(estado.rotinas[0].slug).toBe('pauta-inteligencia-artificial');
  });

  it('rotina de origem removida é PAUSADA, não apagada — e SOLTA O NOME', async () => {
    const estado = bancoVazio();
    estado.pautaRotinas.push(pautaRotinaFalsa({ id: 'pr-1', orgId: ORG_A, slug: 'ia', nome: 'IA' }));
    const m = montar(estado);
    await m.servico.reconciliarPauta(ORG_A);

    estado.pautaRotinas.length = 0;
    const r = await m.servico.reconciliarPauta(ORG_A);

    expect(r.orfas).toBe(1);
    expect(estado.rotinas).toHaveLength(1);
    expect(estado.rotinas[0].ativo).toBe(false);
    expect(estado.rotinas[0].estado).toBe(AgentEstado.pausado);
    expect(estado.rotinas[0].ultimoStatus).toContain('removida');
    expect(estado.rotinas[0].proximaExecucaoEm).toBeNull();
    // O nome bonito ficou livre para quem vier depois.
    expect(estado.rotinas[0].slug).not.toBe('pauta-ia');
    expect(estado.rotinas[0].slug).toContain('--sem-origem-');

    // E marcar de novo não empilha sufixo nem conta órfã duas vezes.
    const outra = await m.servico.reconciliarPauta(ORG_A);
    expect(outra.orfas).toBe(0);
    expect(estado.rotinas[0].slug.match(/--sem-origem-/g)).toHaveLength(1);
  });

  it('APAGAR E RECRIAR a mesma rotina na tela de Pauta: a nova dispara', async () => {
    /*
     * ESTE É O DEFEITO GRAVE QUE DERRUBOU A FATIA.
     *
     * A sequência inteira, como um cliente a faria: a rotina existe e espelha;
     * alguém a apaga na tela de Pauta; a reconciliação marca a órfã MANTENDO o
     * nome; a pessoa recria com o mesmo nome. Daí em diante toda reconciliação
     * tentava criar, colidia com o índice único `(orgId, slug)`, e o tratamento
     * de erro engolia com um aviso no log: a rotina nova NUNCA disparava, a tela
     * de Pauta mostrava ativa, a de Rotinas mostrava a velha pausada, e ninguém
     * via erro nenhum. Era regressão direta contra o agendador anterior, que lia
     * a origem direto e teria rodado.
     */
    const estado = bancoVazio();
    estado.pautaRotinas.push(pautaRotinaFalsa({ id: 'pr-1', orgId: ORG_A, slug: 'ia', nome: 'IA' }));
    const m = montar(estado);
    const rodou: string[] = [];
    m.registro.registrar(
      { [TIPO_PAUTA_RODADA]: async (ctx) => { rodou.push(`${ctx.slug}:${ctx.refExterna}`); return { status: 'ok', resumo: 'rodada' }; } },
      'teste',
    );

    await m.agendador.tick(AGORA);
    expect(rodou).toHaveLength(1);

    // Apagada e recriada com o MESMO nome — id novo, que é o que o banco faz.
    estado.pautaRotinas.length = 0;
    estado.pautaRotinas.push(pautaRotinaFalsa({ id: 'pr-2', orgId: ORG_A, slug: 'ia', nome: 'IA' }));

    await m.agendador.tick(DEPOIS);

    const nova = estado.rotinas.find((r) => r.refExterna === 'pr-2');
    expect(nova, 'o espelho da rotina recriada tem de existir').toBeTruthy();
    expect(nova?.slug).toBe('pauta-ia');
    expect(nova?.ativo).toBe(true);
    expect(rodou).toEqual(['pauta-ia:pr-1', 'pauta-ia:pr-2']);
    // A velha continua lá, com o histórico dela, pausada e sem o nome.
    const velha = estado.rotinas.find((r) => r.refExterna === 'pr-1');
    expect(velha?.ativo).toBe(false);
    expect(velha?.slug).toContain('--sem-origem-');
  });

  it('colisão que sobra vira AVISO NA TELA e nome único — nunca um warn e silêncio', async () => {
    /*
     * O nome bonito está ocupado por uma rotina MANUAL, que a reconciliação não
     * pode mexer. Duas coisas têm de acontecer: o espelho nasce assim mesmo (com
     * nome único derivado do id da origem) e a tela FICA SABENDO.
     */
    const estado = bancoVazio();
    estado.rotinas.push(rotina({ id: 'r-manual', orgId: ORG_A, slug: 'pauta-ia', tipo: 't' }));
    estado.pautaRotinas.push(pautaRotinaFalsa({ id: 'pr-abcdef12', orgId: ORG_A, slug: 'ia', nome: 'IA' }));
    const m = montar(estado);

    const r = await m.servico.reconciliarPauta(ORG_A);

    expect(r.criadas).toBe(1);
    const espelho = estado.rotinas.find((x) => x.refExterna === 'pr-abcdef12');
    expect(espelho?.slug).toBe('pauta-ia-pr-abcde');
    expect(r.problemas).toHaveLength(1);

    const lista = await m.servico.listar(ORG_A, AGENDADOR_DE_PE);
    expect(lista.avisos).toHaveLength(1);
    expect(lista.avisos[0]).toContain('pauta-ia');

    // E não fica tentando o nome bonito a cada minuto: na batida seguinte, nada
    // muda e nada é reescrito.
    const segunda = await m.servico.reconciliarPauta(ORG_A);
    expect(segunda.atualizadas).toBe(0);
    expect(espelho?.slug).toBe('pauta-ia-pr-abcde');
  });

  it('o tique reconcilia e dispara a rotina da pauta na mesma batida', async () => {
    const estado = bancoVazio();
    estado.pautaRotinas.push(pautaRotinaFalsa({ id: 'pr-1', orgId: ORG_A, slug: 'ia', nome: 'IA' }));
    const m = montar(estado);
    const vistos: string[] = [];
    m.registro.registrar(
      {
        [TIPO_PAUTA_RODADA]: async (ctx) => {
          vistos.push(`${ctx.orgId}:${ctx.refExterna}`);
          return { status: 'ok', resumo: 'rodada abc' };
        },
      },
      'teste',
    );

    await m.agendador.tick(AGORA);

    expect(vistos).toEqual([`${ORG_A}:pr-1`]);
    expect(estado.execucoes).toHaveLength(1);
    expect(estado.rotinas[0].execucoes).toBe(1);
  });

  it('pausar pela tela de Rotinas pausa a PautaRotina de origem', async () => {
    /*
     * Sem isto, a próxima reconciliação traria `ativo: true` de volta e a pausa
     * duraria menos de um minuto — desfeita em silêncio por uma varredura.
     */
    const estado = bancoVazio();
    estado.pautaRotinas.push(pautaRotinaFalsa({ id: 'pr-1', orgId: ORG_A, slug: 'ia', nome: 'IA' }));
    const m = montar(estado);
    await m.servico.reconciliarPauta(ORG_A);

    await m.servico.definirAtivo(ORG_A, estado.rotinas[0].id, false, 'pedro');
    await m.servico.reconciliarPauta(ORG_A);

    expect(estado.pautaRotinas[0].ativo).toBe(false);
    expect(estado.rotinas[0].ativo).toBe(false);
  });

  it('religar um espelho SEM ORIGEM é recusado na porta', async () => {
    /*
     * Religar uma órfã fazia `refExterna` virar ponteiro pendurado: o executor
     * manda esse id para a rodada, que o grava como chave estrangeira, e a
     * rotina passava a falhar por integridade a cada passagem — histórico cheio
     * de erro de banco, sem nunca produzir nada.
     */
    const estado = bancoVazio();
    estado.pautaRotinas.push(pautaRotinaFalsa({ id: 'pr-1', orgId: ORG_A, slug: 'ia', nome: 'IA' }));
    const m = montar(estado);
    await m.servico.reconciliarPauta(ORG_A);
    estado.pautaRotinas.length = 0;
    await m.servico.reconciliarPauta(ORG_A);
    const id = estado.rotinas[0].id;

    await expect(m.servico.definirAtivo(ORG_A, id, true, 'pedro')).rejects.toThrow(/removida na tela de Pauta/);
    await expect(
      m.servico.definirEstado(ORG_A, id, AgentEstado.rodando, 'pedro'),
    ).rejects.toThrow(/removida na tela de Pauta/);
    expect(estado.rotinas[0].ativo).toBe(false);
  });

  it('execução que termina DEPOIS da marcação de órfã não ressuscita o horário', async () => {
    /*
     * A corrida: a passagem começa, a origem some, a reconciliação marca a
     * órfã, e só então a passagem termina e escreve `ultimoStatus` e
     * `proximaExecucaoEm`. O aviso de origem removida sumia e a rotina ficava
     * pausada, sem origem, anunciando próxima execução — e não se consertava
     * sozinha, porque a varredura seguinte só olhava rotina ativa.
     */
    const estado = bancoVazio();
    estado.pautaRotinas.push(pautaRotinaFalsa({ id: 'pr-1', orgId: ORG_A, slug: 'ia', nome: 'IA' }));
    const m = montar(estado);
    await m.servico.reconciliarPauta(ORG_A);
    const espelho = estado.rotinas[0];

    m.registro.registrar(
      {
        [TIPO_PAUTA_RODADA]: async () => {
          // No meio da execução a origem é apagada e a reconciliação passa.
          estado.pautaRotinas.length = 0;
          await m.servico.reconciliarPauta(ORG_A);
          return { status: 'ok', resumo: 'rodada abc' };
        },
      },
      'teste',
    );

    await m.servico.executar(espelho as never, 'cron', AGORA);

    // A passagem aconteceu e está no histórico — nada some.
    expect(estado.execucoes).toHaveLength(1);
    // Mas a rotina não volta a prometer horário, porque ela não dispara mais.
    expect(estado.rotinas[0].proximaExecucaoEm).toBeNull();

    // E o aviso de origem removida VOLTA sozinho na batida seguinte.
    const r = await m.servico.reconciliarPauta(ORG_A);
    expect(r.orfas).toBe(1);
    expect(estado.rotinas[0].ultimoStatus).toContain('removida');
  });
});

// ---------------------------------------------------------------------------
// 7. `PAUTA_CRON` PERDEU O EFEITO COLATERAL
// ---------------------------------------------------------------------------

describe('PAUTA_CRON como apelido de compatibilidade', () => {
  it('off pula SÓ as rotinas da pauta — o resto continua rodando', async () => {
    process.env.PAUTA_CRON = 'off';
    const estado = bancoVazio();
    estado.rotinas.push(
      rotina({ id: 'r-pauta', orgId: ORG_A, tipo: TIPO_PAUTA_RODADA }),
      rotina({ id: 'r-outra', orgId: ORG_A, tipo: 'outra' }),
    );
    const m = montar(estado);
    const rodou: string[] = [];
    const executor = async (ctx: { rotinaId: string }) => {
      rodou.push(ctx.rotinaId);
      return { status: 'ok' as const, resumo: '' };
    };
    m.registro.registrar({ [TIPO_PAUTA_RODADA]: executor, outra: executor }, 'teste');

    await m.agendador.tick(AGORA);

    expect(rodou).toEqual(['r-outra']);
    expect(m.agendador.pautaDesligadaPorVariavel).toBe(true);
    expect(m.agendador.tiqueAtivo).toBe(true);
  });

  it('sem a variável, a rotina da pauta roda como qualquer outra', async () => {
    const estado = bancoVazio();
    estado.rotinas.push(rotina({ id: 'r-pauta', orgId: ORG_A, tipo: TIPO_PAUTA_RODADA }));
    const m = montar(estado);
    const rodou: string[] = [];
    m.registro.registrar(
      { [TIPO_PAUTA_RODADA]: async (ctx) => { rodou.push(ctx.rotinaId); return { status: 'ok', resumo: '' }; } },
      'teste',
    );

    await m.agendador.tick(AGORA);

    expect(rodou).toEqual(['r-pauta']);
    expect(m.agendador.pautaDesligadaPorVariavel).toBe(false);
  });

  it('ROTINAS_CRON=off é o interruptor do agendador inteiro', () => {
    process.env.ROTINAS_CRON = 'off';
    const m = montar(bancoVazio());
    expect(m.agendador.tiqueAtivo).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. A DESCOBERTA CEGA CHEGA À TELA
// ---------------------------------------------------------------------------

describe('descoberta cega', () => {
  it('quando a policy esconde tudo, a tela DIZ — em vez de ficar verde', async () => {
    /*
     * Sob um papel que não atravessa o isolamento por linha, a consulta que
     * descobre quais empresas varrer volta vazia e calada. Nenhuma rotina
     * dispara, em empresa nenhuma — e a tela mostrava tudo em ordem, com o único
     * sinal escondido num aviso de log que ninguém lê. A limitação continua
     * sendo a mesma de antes desta fatia; o que mudou é que agora ela é
     * ANUNCIADA, e o raio ficou maior (antes só a pauta parava).
     */
    const estado = bancoVazio();
    estado.rotinas.push(rotina({ id: 'r1', orgId: ORG_A, tipo: 't' }));
    const m = montar(estado);
    (m.prisma as unknown as { $queryRaw: unknown }).$queryRaw = async () => [
      { atravessa: false, papel: 'mktos_app', forcado: true },
    ];

    const d = await m.agendador.diagnostico();
    expect(d.descobertaCega).toBe(true);

    const lista = await m.servico.listar(ORG_A, d);
    expect(lista.descobertaCega).toBe(true);
  });

  it('conexão que atravessa o isolamento não acusa nada', async () => {
    const m = montar(bancoVazio());
    const d = await m.agendador.diagnostico();
    expect(d.descobertaCega).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9. A TROCA DE DONO NÃO PODE ACONTECER EM SILÊNCIO
// ---------------------------------------------------------------------------

describe('o que sobrou do agendador da pauta', () => {
  it('não tem mais relógio: nenhum método de tique', () => {
    const shim = new PautaSchedulerService(null as never, null as never);
    expect((shim as unknown as Record<string, unknown>).tick).toBeUndefined();
    expect(typeof shim.onApplicationBootstrap).toBe('function');
  });

  it('DERRUBA O ARRANQUE quando o agendador de rotinas não está de pé', () => {
    /*
     * O modo de falhar que este caso existe para impedir: o dono antigo sai, o
     * novo não é registrado em `app.module.ts`, e a rotina da pauta para de
     * disparar sem erro, sem log e sem tela mudando de cor.
     *
     * A primeira versão escrevia um `log.error` e deixava a API subir — o que é
     * a mesma coisa que não existir, porque quem não lê o arranque não nota.
     * Lançar é o que a casa faz em outros sete pontos de montagem, e pelo mesmo
     * motivo: montagem errada tem de doer no boot.
     */
    expect(agendadorDeRotinasDePe()).toBe(false);
    expect(() =>
      new PautaSchedulerService(null as never, null as never).onApplicationBootstrap(),
    ).toThrow(/RoutinesModule/);
  });

  it('fica quieto quando o agendador de rotinas se anunciou', () => {
    anunciarAgendadorDeRotinas();
    expect(() =>
      new PautaSchedulerService(null as never, null as never).onApplicationBootstrap(),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 9b. A TELA ANTIGA NÃO PODE MENTIR SOBRE O GATILHO
// ---------------------------------------------------------------------------

/*
 * `PautaRotinaList.cronAtivo` é o que a tela de Pauta usa para dizer "o gatilho
 * está de pé". Ela lia SÓ `PAUTA_CRON`, e isso passou a mentir quando o relógio
 * mudou de dono: com `ROTINAS_CRON=off` e a antiga no padrão, a tela dizia
 * "ativo" e nada disparava. É a pior forma de mentir — manda quem lê procurar o
 * defeito em outro lugar.
 *
 * São TRÊS condições, e a terceira não é variável: o módulo de rotinas precisa
 * estar montado neste processo. Hoje a API nem sobe sem ele, mas a resposta tem
 * de continuar verdadeira se a trava um dia mudar.
 */
describe('o gatilho que a tela de Pauta anuncia', () => {
  it('mente para ninguém: só é verdade com o agendador de pé e as DUAS variáveis ligadas', () => {
    // Sem o módulo montado: não há tique, venha o que vier no ambiente.
    expect(gatilhoDaPautaDePe()).toBe(false);

    anunciarAgendadorDeRotinas();
    expect(gatilhoDaPautaDePe()).toBe(true);

    // O interruptor NOVO — o que de fato desliga o agendador inteiro. Era este
    // o caso em que a tela dizia "ativo" com o relógio parado.
    process.env.ROTINAS_CRON = 'off';
    expect(gatilhoDaPautaDePe()).toBe(false);
    delete process.env.ROTINAS_CRON;

    // O apelido de compatibilidade: não para o agendador, mas para as rotinas
    // DE PAUTA — que é exatamente o que esta tela anuncia.
    process.env.PAUTA_CRON = 'off';
    expect(gatilhoDaPautaDePe()).toBe(false);
    delete process.env.PAUTA_CRON;

    expect(gatilhoDaPautaDePe()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. A CATRACA DA CÓPIA — o contrato da tela
// ---------------------------------------------------------------------------

describe('o contrato da tela de rotinas', () => {
  /*
   * `apps/web/src/app/rotinas/tipos.ts` é uma CÓPIA declarada dos tipos de
   * `src/routines/rotina.tipos.ts`: o pacote compartilhado não é desta fatia, e
   * criar a dependência só por causa de dois `interface` custaria mais do que a
   * duplicação (é a mesma escolha que `lib/api.ts` já fez para o código de
   * recusa de conector desligado).
   *
   * O que torna a cópia aceitável é ISTO: se as duas divergirem, a suíte fica
   * vermelha. Campo acrescentado de um lado só vira `undefined` na tela — o tipo
   * de defeito que não aparece em teste de tela nenhum porque, em TypeScript,
   * ninguém reclama de um campo que o outro lado nunca mandou.
   */
  const RAIZ_DO_REPO = resolve(join(__dirname, '..'), '..', '..');
  const ler = (rel: string): string => readFileSync(join(RAIZ_DO_REPO, rel), 'utf8');

  /** Os nomes dos campos de uma `interface`, na ordem em que aparecem. */
  function campos(fonte: string, nome: string): string[] {
    const inicio = fonte.indexOf(`export interface ${nome} {`);
    expect(inicio, `interface ${nome} não encontrada`).toBeGreaterThanOrEqual(0);
    const corpo = fonte.slice(inicio, fonte.indexOf('\n}', inicio));
    return [...corpo.matchAll(/^\s{2}(\w+)[?]?:/gm)].map((m) => m[1]);
  }

  const daApi = ler('apps/api/src/routines/rotina.tipos.ts');
  const daTela = ler('apps/web/src/app/rotinas/tipos.ts');

  it('RotinaResumo tem os MESMOS campos dos dois lados', () => {
    expect(campos(daTela, 'RotinaResumo')).toEqual(campos(daApi, 'RotinaResumo'));
  });

  it('ExecucaoResumo tem os MESMOS campos dos dois lados', () => {
    expect(campos(daTela, 'ExecucaoResumo')).toEqual(campos(daApi, 'ExecucaoResumo'));
  });

  it('RotinasList tem os MESMOS campos dos dois lados', () => {
    expect(campos(daTela, 'RotinasList')).toEqual(campos(daApi, 'RotinasList'));
  });

  it('a tela oferece exatamente os quatro estados do enum do banco', () => {
    const oferecidos = [...daTela.matchAll(/valor: '(\w+)'/g)].map((m) => m[1]);
    expect(new Set(oferecidos)).toEqual(new Set(Object.values(AgentEstado)));
  });
});
