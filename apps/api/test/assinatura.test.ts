import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import { of } from 'rxjs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CredencialEmprestada, contemAlgumSegredo } from '../src/cofre/segredo';
import { SegredoIndisponivelError } from '../src/cofre/cofre.service';
import { comContexto } from '../src/common/contexto-execucao';
import { EventLogService } from '../src/gateway/event-log.service';
import {
  CODIGO_ASSINATURA_SUSPENSA,
  LIBERADOS_NA_SUSPENSAO,
  acessoBloqueado,
  cabeConferencia,
  decidirTransicao,
  liberadoNaSuspensao,
  vencidaAlemDaCarencia,
  type CobrancaParaDecisao,
  type EstadoDeAssinatura,
} from '../src/billing/assinatura';
import {
  CobrancaAsaasService,
  SemCredencialDeCobranca,
  dataDoProvedor,
  emCentavos,
  estadoDaCobranca,
} from '../src/billing/cobranca-asaas.service';
import { AssinaturaService } from '../src/billing/assinatura.service';
import { SuspensaoInterceptor } from '../src/billing/suspensao.interceptor';
import { RotinasScheduler } from '../src/routines/rotinas.scheduler';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * ============================================================================
 * ASSINATURA, COBRANÇA E SUSPENSÃO — fatia 6.2 (RF-O-03)
 * ============================================================================
 *
 * O QUE ESTA SUÍTE PRECISA PROVAR, e o que separa a fatia feita da fingida:
 *
 *   1. QUE A SUSPENSÃO NÃO APAGA NADA. Não basta afirmar: a seção 5 conta as
 *      linhas de SEIS tabelas do tenant antes e depois de suspender, e depois de
 *      reativar — e as seis TÊM LINHA. A primeira escrita desta suíte contava
 *      seis e media quatro: `segredoDeConector` ficava em zero porque nada no
 *      arquivo criava credencial, e `cobrancaDeAssinatura` era neutralizada na
 *      própria comparação. Justamente a do cofre é a que precisava de controle,
 *      porque revogar credencial é uma das três suspensões destrutivas que esta
 *      fatia declara ter recusado.
 *
 *   2. QUE "NÃO SEI" NUNCA SUSPENDE, e que O ESPELHO VELHO NÃO DECIDE. Leitura
 *      incompleta, lista vazia, provedor fora do ar — três formas de ignorância,
 *      nenhuma muda acesso. E a quarta, que passou pela primeira revisão: uma
 *      cobrança vencida espelhada UMA vez decidia acesso para sempre, porque
 *      quem chamava a decisão entregava a ela o espelho inteiro em vez da leitura
 *      corrente. A seção 5 reproduz o defeito e prova que ele acabou.
 *
 *   3. QUE A REATIVAÇÃO À MÃO DURA. Conferir suspende, reativar ativa, conferir
 *      de novo suspendia — em um segundo, com o provedor ainda dizendo vencido.
 *      A seção 5 exercita o ciclo e o controle negativo (cobrança nova depois da
 *      marca volta a suspender).
 *
 *   4. QUE A CREDENCIAL NUNCA APARECE — inclusive NA REDE. A seção 4 usa
 *      `contemAlgumSegredo` para as três portas de serialização, e a seção 3 usa
 *      DOIS SERVIDORES DE VERDADE para o quarto caminho, que nenhuma varredura
 *      de objeto alcança: o redirecionamento entre origens, que reenvia o
 *      cabeçalho próprio do provedor para o destino.
 *
 *      `contemAlgumSegredo` É FERRAMENTA DE TESTE, NÃO DE PRODUÇÃO: para ser
 *      superconjunto das três portas ela EXECUTA código do objeto varrido
 *      (`toJSON`, `toString`, getters, o inspetor personalizado). Aponte-a para
 *      payload, nunca para serviço vivo. É por isso que ela é chamada aqui e em
 *      lugar nenhum de `src/billing/`.
 *
 *   5. QUE O GATE NÃO LIBERA FAMÍLIA INTEIRA. A seção 6 VARRE os `@Controller()`
 *      do código-fonte e exige que a lista de rotas alcançáveis por empresa
 *      suspensa seja exatamente a declarada. Rota nova numa família liberada
 *      reprova até alguém declará-la — foi assim que `tenants/onboarding`,
 *      `tenants/plataforma` e `tenants/suporte` nasceram liberadas em silêncio.
 *
 *   6. QUE ROTINA DE SUSPENSO NÃO RODA. A seção 7 exercita o tique do agendador:
 *      o gate de suspensão é interceptor de REQUISIÇÃO, e o tique não é
 *      requisição.
 *
 * AS SEÇÕES 1 A 4, 6, 7 E 8 NÃO PRECISAM DE BANCO e rodam em qualquer máquina.
 * A 5 precisa (`TEST_DATABASE_URL`) e se pula sozinha — ver o cabeçalho de
 * `banco-de-teste.ts` para montar o banco.
 */

const URL_DO_BANCO = process.env.TEST_DATABASE_URL;
if (URL_DO_BANCO) {
  exigirBancoDescartavel(URL_DO_BANCO, 'cria e apaga empresa, assinatura e cobrança');
}

/** Do tamanho de uma chave de gateway de verdade. A varredura recusa alvo curto. */
const CHAVE_DO_PROVEDOR = '$aact_hmlg_000MzkwODA2MWY2OGM3MWRlODVkZjRhYzY2NGRmMzdlMTQ=::';

function dias(n: number): number {
  return n * 86_400_000;
}

function cobranca(
  parcial: Partial<CobrancaParaDecisao> & { vencimento: Date },
): CobrancaParaDecisao {
  return {
    id: parcial.id ?? 'cob-1',
    referencia: parcial.referencia ?? 'pay_000001',
    status: parcial.status ?? 'aberta',
    vencimento: parcial.vencimento,
  };
}

// ===========================================================================
// 1. A DECISÃO — sem banco, sem rede, e com o controle negativo ao lado
// ===========================================================================

describe('a decisão de suspender exige PROVA, nunca ausência de prova', () => {
  const AGORA = new Date('2026-09-11T12:00:00.000Z');
  const ATIVA = {
    status: 'ativa' as EstadoDeAssinatura,
    diasDeCarencia: 7,
    perdoadasAte: null,
  };

  it('lista VAZIA com leitura completa NÃO suspende — e a versão ingênua suspenderia', () => {
    const leitura = { completa: true, cobrancas: [] as CobrancaParaDecisao[] };
    const t = decidirTransicao(ATIVA, leitura, AGORA);
    expect(t.muda).toBe(false);

    /*
     * O CONTROLE NEGATIVO, escrito e executado.
     *
     * Esta é a implementação que qualquer um escreveria em cinco minutos, e é a
     * que suspende a carteira inteira quando o provedor devolve lista vazia por
     * falha de autenticação. Se ela e a nossa concordassem aqui, o caso acima
     * não estaria provando nada.
     */
    const ingenua = (cobrancas: CobrancaParaDecisao[]) =>
      cobrancas.some((c) => c.status === 'paga') ? 'ativa' : 'suspensa';
    expect(ingenua([])).toBe('suspensa');
  });

  it('leitura INCOMPLETA não decide — nem para suspender, nem para liberar', () => {
    const vencidaVelha = cobranca({
      status: 'vencida',
      vencimento: new Date(AGORA.getTime() - dias(60)),
    });

    // Com a mesma cobrança, a leitura completa suspenderia.
    const completa = decidirTransicao(ATIVA, { completa: true, cobrancas: [vencidaVelha] }, AGORA);
    expect(completa).toMatchObject({ muda: true, para: 'suspensa' });

    // A incompleta não. A diferença é só o campo `completa`.
    const incompleta = decidirTransicao(
      ATIVA,
      { completa: false, cobrancas: [vencidaVelha] },
      AGORA,
    );
    expect(incompleta).toMatchObject({ muda: false, porque: 'leitura_incompleta' });

    // E não libera quem está suspenso, também: ignorância não abre porta.
    const suspensa = {
      status: 'suspensa' as EstadoDeAssinatura,
      diasDeCarencia: 7,
      perdoadasAte: null,
    };
    expect(decidirTransicao(suspensa, { completa: false, cobrancas: [] }, AGORA)).toMatchObject({
      muda: false,
      porque: 'leitura_incompleta',
    });
  });

  it('vencida DENTRO da carência vira inadimplente, não suspensa', () => {
    const t = decidirTransicao(
      ATIVA,
      {
        completa: true,
        cobrancas: [cobranca({ status: 'vencida', vencimento: new Date(AGORA.getTime() - dias(3)) })],
      },
      AGORA,
    );
    expect(t).toMatchObject({ muda: true, para: 'inadimplente' });
  });

  it('a fronteira da carência é o fim do último dia, não o começo', () => {
    const venceuHa7Dias = cobranca({
      status: 'vencida',
      vencimento: new Date(AGORA.getTime() - dias(7)),
    });
    // Exatamente 7 dias depois ainda NÃO passou (o limite é `>`, não `>=`).
    expect(vencidaAlemDaCarencia(venceuHa7Dias, 7, AGORA)).toBe(false);
    expect(vencidaAlemDaCarencia(venceuHa7Dias, 7, new Date(AGORA.getTime() + 1))).toBe(true);
  });

  it('cobrança ABERTA com a data no passado NÃO é vencida — quem decide é quem recebe', () => {
    const abertaVelha = cobranca({
      status: 'aberta',
      vencimento: new Date(AGORA.getTime() - dias(90)),
    });
    expect(vencidaAlemDaCarencia(abertaVelha, 0, AGORA)).toBe(false);
    expect(decidirTransicao(ATIVA, { completa: true, cobrancas: [abertaVelha] }, AGORA).muda).toBe(
      false,
    );
  });

  it('pagar reativa: sem vencida, a suspensa volta para ativa', () => {
    const suspensa = {
      status: 'suspensa' as EstadoDeAssinatura,
      diasDeCarencia: 7,
      perdoadasAte: null,
    };
    const t = decidirTransicao(
      suspensa,
      {
        completa: true,
        cobrancas: [cobranca({ status: 'paga', vencimento: new Date(AGORA.getTime() - dias(40)) })],
      },
      AGORA,
    );
    expect(t).toMatchObject({ muda: true, de: 'suspensa', para: 'ativa' });
  });

  it('cancelada é TERMINAL: conferência nenhuma a ressuscita', () => {
    const cancelada = {
      status: 'cancelada' as EstadoDeAssinatura,
      diasDeCarencia: 7,
      perdoadasAte: null,
    };
    expect(
      decidirTransicao(
        cancelada,
        {
          completa: true,
          cobrancas: [cobranca({ status: 'paga', vencimento: new Date(AGORA.getTime() - dias(1)) })],
        },
        AGORA,
      ),
    ).toMatchObject({ muda: false, porque: 'estado_terminal' });
  });

  it('rodar duas vezes não muda nada na segunda — a idempotência é da decisão', () => {
    const leitura = {
      completa: true,
      cobrancas: [cobranca({ status: 'vencida', vencimento: new Date(AGORA.getTime() - dias(60)) })],
    };
    const primeira = decidirTransicao(ATIVA, leitura, AGORA);
    expect(primeira).toMatchObject({ muda: true, para: 'suspensa' });

    const jaSuspensa = {
      status: 'suspensa' as EstadoDeAssinatura,
      diasDeCarencia: 7,
      perdoadasAte: null,
    };
    const segunda = decidirTransicao(jaSuspensa, leitura, AGORA);
    expect(segunda).toMatchObject({ muda: false, porque: 'sem_mudanca' });
  });

  it('a cobrança que sustenta a suspensão é a MAIS ANTIGA vencida', () => {
    const t = decidirTransicao(
      ATIVA,
      {
        completa: true,
        cobrancas: [
          cobranca({
            id: 'nova',
            referencia: 'pay_nova',
            status: 'vencida',
            vencimento: new Date(AGORA.getTime() - dias(20)),
          }),
          cobranca({
            id: 'velha',
            referencia: 'pay_velha',
            status: 'vencida',
            vencimento: new Date(AGORA.getTime() - dias(90)),
          }),
        ],
      },
      AGORA,
    );
    expect(t).toMatchObject({ muda: true, para: 'suspensa', cobrancaId: 'velha' });
  });
});

describe('a marca da reativação explícita', () => {
  const AGORA = new Date('2026-09-11T12:00:00.000Z');
  const REATIVADA_EM = new Date(AGORA.getTime() - dias(1));
  const vencidaVelha = cobranca({
    status: 'vencida',
    referencia: 'pay_velha',
    vencimento: new Date(AGORA.getTime() - dias(60)),
  });

  it('cobrança vencida ANTES da reativação não suspende mais', () => {
    const t = decidirTransicao(
      { status: 'ativa', diasDeCarencia: 7, perdoadasAte: REATIVADA_EM },
      { completa: true, cobrancas: [vencidaVelha] },
      AGORA,
    );
    expect(t).toMatchObject({ muda: false, porque: 'sem_mudanca' });
    expect(t.motivo).toMatch(/perdoada/);
  });

  it('CONTROLE NEGATIVO: a MESMA cobrança, sem a marca, suspende', () => {
    // A única diferença entre este caso e o de cima é `perdoadasAte`. Se os dois
    // dessem o mesmo resultado, a marca não estaria fazendo nada — e a versão
    // anterior desta fatia era exatamente esta, sem marca nenhuma.
    const t = decidirTransicao(
      { status: 'ativa', diasDeCarencia: 7, perdoadasAte: null },
      { completa: true, cobrancas: [vencidaVelha] },
      AGORA,
    );
    expect(t).toMatchObject({ muda: true, para: 'suspensa' });
  });

  it('o perdão NÃO é vitalício: a fatura que vence DEPOIS da marca suspende', () => {
    const depois = cobranca({
      status: 'vencida',
      referencia: 'pay_nova',
      // vence depois da reativação e já passou da carência
      vencimento: new Date(REATIVADA_EM.getTime() + 60_000),
    });
    const t = decidirTransicao(
      { status: 'ativa', diasDeCarencia: 0, perdoadasAte: REATIVADA_EM },
      { completa: true, cobrancas: [vencidaVelha, depois] },
      AGORA,
    );
    expect(t).toMatchObject({ muda: true, para: 'suspensa', cobrancaId: depois.id });
  });

  it('a marca não reativa ninguém sozinha: quem está suspenso volta para ativa por ela', () => {
    // Uma suspensa cujas cobranças vencidas foram todas perdoadas VOLTA — é o
    // desfecho certo, e é o que `reativar` faz por ato explícito. O que a marca
    // impede é a conferência seguinte desfazer isso.
    const t = decidirTransicao(
      { status: 'suspensa', diasDeCarencia: 7, perdoadasAte: REATIVADA_EM },
      { completa: true, cobrancas: [vencidaVelha] },
      AGORA,
    );
    expect(t).toMatchObject({ muda: true, de: 'suspensa', para: 'ativa' });
  });
});

describe('quem fica bloqueado, e o que ainda responde', () => {
  it('assinatura INEXISTENTE não bloqueia — senão a fatia trancaria a carteira ao subir', () => {
    expect(acessoBloqueado(null)).toBe(false);
    expect(acessoBloqueado(undefined)).toBe(false);
  });

  it('suspensa e cancelada bloqueiam; ativa e inadimplente, não', () => {
    expect(acessoBloqueado('suspensa')).toBe(true);
    expect(acessoBloqueado('cancelada')).toBe(true);
    expect(acessoBloqueado('ativa')).toBe(false);
    // Inadimplente ainda tem acesso: é a janela em que o aviso evita a suspensão.
    expect(acessoBloqueado('inadimplente')).toBe(false);
  });
});

describe('o teto de conferências', () => {
  const T0 = new Date('2026-09-11T12:00:00.000Z').getTime();

  it('deixa passar até o teto e recusa a seguinte', () => {
    let carimbos: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = cabeConferencia(carimbos, T0 + i);
      expect(r.cabe, `tentativa ${i + 1}`).toBe(true);
      carimbos = r.carimbos;
    }
    const estourou = cabeConferencia(carimbos, T0 + 12);
    expect(estourou.cabe).toBe(false);
    expect(estourou.liberaEm).toBeInstanceOf(Date);
    // Recusar não acrescenta carimbo: senão bater na porta empurraria a janela.
    expect(estourou.carimbos).toHaveLength(12);
  });

  it('a janela escorrega: uma hora depois, cabe de novo', () => {
    const cheios = Array.from({ length: 12 }, (_, i) => T0 + i);
    expect(cabeConferencia(cheios, T0 + 100).cabe).toBe(false);
    expect(cabeConferencia(cheios, T0 + 3_600_001).cabe).toBe(true);
  });
});

// ===========================================================================
// 2. A TRADUÇÃO DO PROVEDOR — o desconhecido não vira inadimplência
// ===========================================================================

describe('traduzir o que o provedor diz', () => {
  it('estado DESCONHECIDO vira "aberta", nunca "vencida"', () => {
    // Suspender por não saber ler a resposta é suspender por ignorância.
    expect(estadoDaCobranca('ALGO_QUE_AINDA_NAO_EXISTE')).toBe('aberta');
    expect(estadoDaCobranca(undefined)).toBe('aberta');
    expect(estadoDaCobranca(42)).toBe('aberta');
  });

  it('os estados conhecidos casam, e sem depender de caixa', () => {
    expect(estadoDaCobranca('OVERDUE')).toBe('vencida');
    expect(estadoDaCobranca('overdue')).toBe('vencida');
    expect(estadoDaCobranca('RECEIVED')).toBe('paga');
    expect(estadoDaCobranca('CONFIRMED')).toBe('paga');
    expect(estadoDaCobranca('PENDING')).toBe('aberta');
    expect(estadoDaCobranca('REFUNDED')).toBe('cancelada');
  });

  it('dinheiro entra em centavos inteiros, sem ponto flutuante', () => {
    expect(emCentavos(497)).toBe(49_700);
    expect(emCentavos(0.1 + 0.2)).toBe(30); // 0.30000000000000004 → 30
    expect(emCentavos('129.9')).toBe(12_990);
    expect(emCentavos('nada')).toBe(0);
    expect(emCentavos(-5)).toBe(0);
  });

  it('data ilegível vira nulo, e linha sem data é descartada pelo conector', () => {
    expect(dataDoProvedor('2026-09-11')).toBeInstanceOf(Date);
    expect(dataDoProvedor('11/09/2026')).toBeNull();
    expect(dataDoProvedor(null)).toBeNull();
  });
});

// ===========================================================================
// 3. O CONECTOR — o que ele faz quando o provedor responde errado
// ===========================================================================

/**
 * Um cofre de mentira que entrega uma `CredencialEmprestada` DE VERDADE.
 *
 * A classe emprestada é a do produto, não uma imitação: é ela que fecha as três
 * portas de serialização, e testar contra uma imitação provaria o que a imitação
 * escreveu. O que é de mentira aqui é só o banco.
 *
 * `revogarApos` existe para o caso do empréstimo por página: depois de N
 * empréstimos, o cofre passa a recusar — que é o que acontece de verdade quando
 * alguém revoga a credencial com uma paginação em curso.
 */
function cofreFalso(chave: string | null, opcoes: { revogarApos?: number } = {}) {
  const contagem = { emprestimos: 0 };
  return {
    contagem,
    async envolver<T>(
      entrada: { orgId: string; conector: string; nome: string },
      fn: (c: CredencialEmprestada) => Promise<T>,
    ): Promise<T> {
      contagem.emprestimos += 1;
      if (chave === null) throw new SegredoIndisponivelError(entrada.conector, entrada.nome, false);
      if (opcoes.revogarApos !== undefined && contagem.emprestimos > opcoes.revogarApos) {
        throw new SegredoIndisponivelError(entrada.conector, entrada.nome, true);
      }
      const cred = new CredencialEmprestada(
        {
          orgId: entrada.orgId,
          conector: entrada.conector,
          nome: entrada.nome,
          referencia: 'linha-de-teste',
          escopo: [],
          expiraEm: new Date(Date.now() + 60_000),
        },
        chave,
      );
      try {
        return await fn(cred);
      } finally {
        cred.devolver();
      }
    },
    async estado() {
      return { total: 0, items: [] as Array<Record<string, unknown>> };
    },
  };
}

function conectorCom(chave: string | null): CobrancaAsaasService {
  return new CobrancaAsaasService(cofreFalso(chave) as never);
}

/** Tudo que o Logger do Nest escreveu durante o caso. */
function capturarLog(): { linhas: unknown[]; parar: () => void } {
  const linhas: unknown[] = [];
  const engolir = (...args: unknown[]) => {
    linhas.push(...args);
  };
  const espioes = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) =>
    vi.spyOn(Logger.prototype, m).mockImplementation(engolir as never),
  );
  return { linhas, parar: () => espioes.forEach((e) => e.mockRestore()) };
}

describe('o conector de cobrança', () => {
  const fetchOriginal = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    vi.restoreAllMocks();
  });

  it('a chave vai por CABEÇALHO — nunca na URL', async () => {
    const chamadas: Array<{ url: string; headers: Record<string, string> }> = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      chamadas.push({ url: String(url), headers: (init.headers ?? {}) as Record<string, string> });
      return new Response(JSON.stringify({ data: [], hasMore: false }), { status: 200 });
    }) as never;

    await conectorCom(CHAVE_DO_PROVEDOR).cobrancasDaAssinatura('org-1', 'sub_123');

    expect(chamadas).toHaveLength(1);
    // A URL vai para log de proxy, mensagem de erro e pilha. A chave, não.
    expect(chamadas[0].url).not.toContain(CHAVE_DO_PROVEDOR);
    expect(contemAlgumSegredo(chamadas[0].url, [CHAVE_DO_PROVEDOR]).achou).toBe(false);
    expect(chamadas[0].headers.access_token).toBe(CHAVE_DO_PROVEDOR);
    // Chave de homologação escolhe o ambiente de homologação.
    expect(chamadas[0].url.startsWith('https://sandbox.asaas.com/')).toBe(true);
  });

  it('a requisição declara `redirect: manual` — seguir é o que vazaria a chave', async () => {
    let inicializacao: RequestInit | undefined;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      inicializacao = init;
      return new Response(JSON.stringify({ data: [], hasMore: false }), { status: 200 });
    }) as never;

    await conectorCom(CHAVE_DO_PROVEDOR).cobrancasDaAssinatura('org-1', 'sub_123');
    // O padrão do `fetch` é `follow`. Sem esta linha, a rede faz o resto sozinha.
    expect(inicializacao?.redirect).toBe('manual');
  });

  it('resposta 3xx vira leitura INCOMPLETA, e o destino não entra em lugar nenhum', async () => {
    globalThis.fetch = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://coletor.exemplo/roubado?t=' + CHAVE_DO_PROVEDOR },
      })) as never;

    const log = capturarLog();
    let r: Awaited<ReturnType<CobrancaAsaasService['cobrancasDaAssinatura']>>;
    try {
      r = await conectorCom(CHAVE_DO_PROVEDOR).cobrancasDaAssinatura('org-1', 'sub_123');
    } finally {
      log.parar();
    }

    expect(r.completa).toBe(false);
    expect(r.porqueIncompleta).toMatch(/redirecionamento/i);
    // Nem o destino (que aqui carrega a chave) nem a chave aparecem no log.
    expect(contemAlgumSegredo(log.linhas, [CHAVE_DO_PROVEDOR]).achou).toBe(false);
    expect(inspect(log.linhas, { depth: 8 })).not.toContain('coletor.exemplo');
  });

  it('provedor fora do ar vira leitura INCOMPLETA, não exceção e não suspensão', async () => {
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as never;

    const r = await conectorCom(CHAVE_DO_PROVEDOR).cobrancasDaAssinatura('org-1', 'sub_123');
    expect(r.completa).toBe(false);
    expect(r.cobrancas).toEqual([]);

    // E a decisão, sobre essa leitura, não muda nada.
    expect(
      decidirTransicao(
        { status: 'ativa', diasDeCarencia: 7, perdoadasAte: null },
        r,
        new Date(),
      ).muda,
    ).toBe(false);
  });

  it('HTTP 401 também é leitura incompleta — chave errada não suspende ninguém', async () => {
    globalThis.fetch = (async () =>
      new Response('{"errors":[{"description":"invalid token"}]}', { status: 401 })) as never;

    const r = await conectorCom(CHAVE_DO_PROVEDOR).cobrancasDaAssinatura('org-1', 'sub_123');
    expect(r.completa).toBe(false);
  });

  it('paginação interrompida pelo teto se ANUNCIA incompleta', async () => {
    // O provedor mente que sempre há mais. Sem o teto, laço infinito; sem o
    // `completa: false`, a leitura truncada passaria por inteira.
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [{ id: 'pay_x', status: 'RECEIVED', value: 1, dueDate: '2026-01-01' }],
          hasMore: true,
        }),
        { status: 200 },
      )) as never;

    const r = await conectorCom(CHAVE_DO_PROVEDOR).cobrancasDaAssinatura('org-1', 'sub_123');
    expect(r.completa).toBe(false);
    expect(r.porqueIncompleta).toMatch(/páginas/);
  });

  it('sem credencial guardada, LANÇA — porque é conserto de gente, não intermitência', async () => {
    globalThis.fetch = (async () => new Response('{}', { status: 200 })) as never;
    await expect(conectorCom(null).cobrancasDaAssinatura('org-1', 'sub_123')).rejects.toBeInstanceOf(
      SemCredencialDeCobranca,
    );
  });

  it('linha sem id ou sem vencimento é descartada, não adivinhada', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: 'pay_ok', status: 'OVERDUE', value: 497, dueDate: '2026-08-01' },
            { status: 'OVERDUE', value: 497, dueDate: '2026-08-01' }, // sem id
            { id: 'pay_sem_data', status: 'OVERDUE', value: 497 }, // sem vencimento
          ],
          hasMore: false,
        }),
        { status: 200 },
      )) as never;

    const r = await conectorCom(CHAVE_DO_PROVEDOR).cobrancasDaAssinatura('org-1', 'sub_123');
    expect(r.completa).toBe(true);
    expect(r.cobrancas.map((c) => c.referencia)).toEqual(['pay_ok']);
  });
});

describe('o empréstimo do cofre atravessa UMA chamada externa', () => {
  const fetchOriginal = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    vi.restoreAllMocks();
  });

  /** Um provedor com `paginas` páginas cheias e a última sem `hasMore`. */
  function provedorComPaginas(paginas: number) {
    let servidas = 0;
    globalThis.fetch = (async () => {
      servidas += 1;
      return new Response(
        JSON.stringify({
          data: [
            { id: `pay_${servidas}`, status: 'RECEIVED', value: 497, dueDate: '2026-08-01' },
          ],
          hasMore: servidas < paginas,
        }),
        { status: 200 },
      );
    }) as never;
    return () => servidas;
  }

  it('três páginas = TRÊS empréstimos, não um que dura as três', async () => {
    const servidas = provedorComPaginas(3);
    const cofre = cofreFalso(CHAVE_DO_PROVEDOR);
    const conector = new CobrancaAsaasService(cofre as never);

    const r = await conector.cobrancasDaAssinatura('org-1', 'sub_123');

    expect(r.completa).toBe(true);
    expect(servidas()).toBe(3);
    /*
     * O CONTROLE: a versão anterior envolvia o LAÇO INTEIRO num empréstimo só, e
     * este número seria 1 com qualquer quantidade de páginas. Um empréstimo por
     * página é o que o cofre declara por escrito em
     * `PrazoDeEmprestimoExcessivoError` — "empréstimo atravessa UMA chamada
     * externa" —, e é o que faz o prazo padrão de um minuto valer de verdade em
     * vez de o teto de cinco ser o limite efetivo.
     */
    expect(cofre.contagem.emprestimos).toBe(3);
  });

  it('REVOGAR no meio da paginação para a leitura — a cópia presa não sobrevive', async () => {
    /*
     * O defeito que isto fecha: revogar com empréstimo na rua limpa o objeto do
     * mapa de vivos, mas NÃO a cópia da chave que o fechamento já tem na mão.
     * Com o laço inteiro dentro de um empréstimo, a chave revogada continuava
     * sendo usada até a última página. Com um empréstimo por página, a revogação
     * atinge a página seguinte.
     */
    provedorComPaginas(5);
    const cofre = cofreFalso(CHAVE_DO_PROVEDOR, { revogarApos: 2 });
    const conector = new CobrancaAsaasService(cofre as never);

    await expect(conector.cobrancasDaAssinatura('org-1', 'sub_123')).rejects.toBeInstanceOf(
      SemCredencialDeCobranca,
    );
    // Parou na terceira tentativa de empréstimo, não na quinta página.
    expect(cofre.contagem.emprestimos).toBe(3);
  });
});

describe('o redirecionamento entre origens NÃO leva a chave junto', () => {
  /*
   * ESTE CASO USA REDE DE VERDADE, e é o único jeito de provar o que ele prova.
   *
   * O vazamento aqui não é de serialização — `contemAlgumSegredo` varre objetos,
   * e não há objeto errado em lugar nenhum. Ele é de REDE: `fetch` sem `redirect`
   * declarado segue o 3xx, e a especificação só remove, ao atravessar origens, os
   * cabeçalhos de autorização que ela CONHECE (`Authorization`, `Cookie`,
   * `Proxy-Authorization`). `access_token` é cabeçalho próprio do Asaas —
   * sobrevive e é reenviado inteiro para o destino.
   *
   * Dois servidores em 127.0.0.1: o primeiro responde 302 para o segundo, o
   * segundo anota o que recebeu. O `fetch` do processo é substituído por um
   * repassador que só troca o HOST da URL e preserva o `init` inteiro — então
   * quem faz a requisição é o código de produção, com as opções de produção.
   */
  // `bind` porque o `fetch` do Node é chamado aqui de forma destacada (o
  // repassador abaixo o invoca por referência), e função de plataforma sem `this`
  // é o tipo de detalhe que só aparece em tempo de execução.
  const fetchOriginal = globalThis.fetch.bind(globalThis);
  let origem: Server;
  let destino: Server;
  let recebidoNoDestino: Array<Record<string, unknown>> = [];
  let portaOrigem = 0;
  let portaDestino = 0;

  beforeAll(async () => {
    destino = createServer((req, res) => {
      recebidoNoDestino.push({ ...req.headers });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"data":[],"hasMore":false}');
    });
    await new Promise<void>((r) => destino.listen(0, '127.0.0.1', () => r()));
    portaDestino = (destino.address() as { port: number }).port;

    origem = createServer((req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${portaDestino}/roubado` });
      res.end();
    });
    await new Promise<void>((r) => origem.listen(0, '127.0.0.1', () => r()));
    portaOrigem = (origem.address() as { port: number }).port;
  });

  afterAll(async () => {
    globalThis.fetch = fetchOriginal;
    await new Promise<void>((r) => destino.close(() => r()));
    await new Promise<void>((r) => origem.close(() => r()));
  });

  beforeEach(() => {
    recebidoNoDestino = [];
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    vi.restoreAllMocks();
  });

  /** Troca só o host: o resto da requisição é a de produção. */
  function apontarParaOrigemLocal() {
    globalThis.fetch = ((url: string | URL, init?: RequestInit) =>
      fetchOriginal(
        String(url).replace(/^https:\/\/[^/]+/, `http://127.0.0.1:${portaOrigem}`),
        init,
      )) as never;
  }

  it('CONTROLE NEGATIVO: seguindo o redirecionamento, a chave CHEGA no destino', async () => {
    // Sem este caso, "a chave não chegou" seria indistinguível de "os servidores
    // não conversaram". Aqui a mesma requisição, com o padrão do `fetch`
    // (`redirect: follow`), entrega a chave na outra origem.
    const r = await fetchOriginal(`http://127.0.0.1:${portaOrigem}/payments`, {
      headers: { access_token: CHAVE_DO_PROVEDOR, 'Content-Type': 'application/json' },
    });
    await r.json();

    expect(recebidoNoDestino).toHaveLength(1);
    expect(recebidoNoDestino[0].access_token).toBe(CHAVE_DO_PROVEDOR);
  });

  it('o conector de produção recusa o redirecionamento, e nada chega no destino', async () => {
    apontarParaOrigemLocal();
    const log = capturarLog();
    let r: Awaited<ReturnType<CobrancaAsaasService['cobrancasDaAssinatura']>>;
    try {
      r = await conectorCom(CHAVE_DO_PROVEDOR).cobrancasDaAssinatura('org-1', 'sub_123');
    } finally {
      log.parar();
    }

    // O segundo servidor NÃO foi tocado: nenhuma requisição, nenhum cabeçalho.
    expect(recebidoNoDestino).toEqual([]);
    // E a anomalia vira "não sei", que não muda acesso de ninguém.
    expect(r.completa).toBe(false);
    expect(
      decidirTransicao(
        { status: 'ativa', diasDeCarencia: 7, perdoadasAte: null },
        r,
        new Date(),
      ).muda,
    ).toBe(false);
    expect(contemAlgumSegredo(log.linhas, [CHAVE_DO_PROVEDOR]).achou).toBe(false);
  });
});

// ===========================================================================
// 4. A CREDENCIAL NUNCA APARECE — e a varredura prova que sabe enxergar
// ===========================================================================

describe('a credencial de cobrança não aparece em log, em retorno nem em erro', () => {
  const fetchOriginal = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    vi.restoreAllMocks();
  });

  it('CONTROLE NEGATIVO: a varredura acusa quando o segredo ESTÁ lá', () => {
    /*
     * Sem este caso, "nada encontrado" nos outros seria indistinguível de "a
     * varredura não olhou". Os três caminhos abaixo são os que a versão anterior
     * de `contemAlgumSegredo` deixava passar, e são exatamente os que um efeito
     * mal escrito produziria.
     */
    const noErro = new Error(`falhou com access_token=${CHAVE_DO_PROVEDOR}`);
    expect(contemAlgumSegredo(noErro, [CHAVE_DO_PROVEDOR]).achou).toBe(true);

    const emBase64 = { corpo: Buffer.from(CHAVE_DO_PROVEDOR, 'utf8').toString('base64') };
    expect(contemAlgumSegredo(emBase64, [CHAVE_DO_PROVEDOR]).achou).toBe(true);

    const comToJson = {
      toJSON: () => ({ headers: { access_token: CHAVE_DO_PROVEDOR } }),
      visivel: 'nada aqui',
    };
    expect(contemAlgumSegredo(comToJson, [CHAVE_DO_PROVEDOR]).achou).toBe(true);
  });

  it('o provedor ECOANDO a chave no corpo do erro não a traz para dentro', async () => {
    /*
     * O caso real: um gateway que devolve a requisição no corpo do erro. Se o
     * conector colasse o corpo na mensagem, a chave atravessaria para o log, para
     * o RASTRO e — pelo caminho de `paraModelo`, que manda a mensagem do erro
     * para dentro da conversa — para o contexto do modelo.
     */
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ erro: 'token invalido', enviado: { access_token: CHAVE_DO_PROVEDOR } }),
        { status: 400 },
      )) as never;

    const log = capturarLog();
    let resultado: unknown;
    try {
      resultado = await conectorCom(CHAVE_DO_PROVEDOR).cobrancasDaAssinatura('org-1', 'sub_123');
    } finally {
      log.parar();
    }

    for (const [onde, alvo] of [
      ['retorno', resultado],
      ['log', log.linhas],
      ['retorno serializado', JSON.stringify(resultado)],
      ['retorno inspecionado', inspect(resultado, { depth: 8 })],
      ['log inspecionado', inspect(log.linhas, { depth: 8 })],
    ] as const) {
      const achado = contemAlgumSegredo(alvo, [CHAVE_DO_PROVEDOR]);
      expect(achado.achou, `${onde}: ${achado.achou ? achado.onde : ''}`).toBe(false);
    }
    expect(log.linhas.length).toBeGreaterThan(0); // houve log — só não com a chave
  });

  it('a exceção do fetch é DESCARTADA: nem a mensagem dela, nem a pilha, entram', async () => {
    /*
     * `fetch` de um cliente HTTP que embrulhasse a requisição no erro traria a
     * chave em `cause`, em `message` e na PILHA — e `Object.entries(new Error())`
     * devolve `[]`, então quem só olha os campos jura que está limpo.
     */
    globalThis.fetch = (async () => {
      const e = new Error(`request failed: header access_token=${CHAVE_DO_PROVEDOR}`);
      (e as Error & { cause?: unknown }).cause = { headers: { access_token: CHAVE_DO_PROVEDOR } };
      throw e;
    }) as never;

    const log = capturarLog();
    let resultado: unknown;
    try {
      resultado = await conectorCom(CHAVE_DO_PROVEDOR).cobrancasDaAssinatura('org-1', 'sub_123');
    } finally {
      log.parar();
    }

    expect(contemAlgumSegredo(resultado, [CHAVE_DO_PROVEDOR]).achou).toBe(false);
    expect(contemAlgumSegredo(log.linhas, [CHAVE_DO_PROVEDOR]).achou).toBe(false);
  });

  it('a leitura bem-sucedida não carrega nada que tenha encostado na chave', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [{ id: 'pay_1', status: 'RECEIVED', value: 497, dueDate: '2026-09-01' }],
          hasMore: false,
        }),
        { status: 200 },
      )) as never;

    const r = await conectorCom(CHAVE_DO_PROVEDOR).cobrancasDaAssinatura('org-1', 'sub_123');
    expect(r.completa).toBe(true);
    expect(contemAlgumSegredo(r, [CHAVE_DO_PROVEDOR]).achou).toBe(false);
    // E nem o objeto emprestado sobreviveu ao fechamento: a leitura é dado puro.
    expect(JSON.stringify(r)).not.toContain('credencial');
  });

  it('o objeto emprestado se recusa a serializar, nas TRÊS portas', () => {
    const cred = new CredencialEmprestada(
      {
        orgId: 'org-1',
        conector: CobrancaAsaasService.CONECTOR,
        nome: CobrancaAsaasService.NOME_DA_CHAVE,
        referencia: 'linha',
        escopo: [],
        expiraEm: new Date(Date.now() + 30_000),
      },
      CHAVE_DO_PROVEDOR,
    );
    try {
      expect(JSON.stringify(cred)).not.toContain(CHAVE_DO_PROVEDOR);
      expect(String(cred)).not.toContain(CHAVE_DO_PROVEDOR);
      expect(inspect(cred)).not.toContain(CHAVE_DO_PROVEDOR);
      expect(contemAlgumSegredo(cred, [CHAVE_DO_PROVEDOR]).achou).toBe(false);
    } finally {
      cred.devolver();
    }
  });
});

// ===========================================================================
// 5. SUSPENDER NÃO APAGA — contado, não afirmado (precisa de banco)
// ===========================================================================

/*
 * As tabelas do tenant que a suíte conta antes e depois. Não é uma amostra
 * simpática: são as que um "limpar ao suspender" mal escrito atingiria primeiro
 * — o conteúdo do cliente, o trabalho dele, o que ele conectou e o que o sistema
 * sabe sobre ele.
 *
 * AS SEIS TÊM LINHA, e isso é a correção de um teatro: na primeira escrita,
 * `segredoDeConector` ficava em zero antes e depois porque nada no arquivo criava
 * credencial, e `cobrancaDeAssinatura` era neutralizada na comparação. Contavam-se
 * seis e mediam-se quatro — e a que ficava de fora era justamente a que precisa de
 * controle, porque REVOGAR CREDENCIAL é uma das três suspensões destrutivas que
 * esta fatia diz ter recusado. `piso` é o número mínimo de linhas que a empresa de
 * teste tem em cada tabela: uma contagem que comece em zero não distingue
 * "ninguém apagou" de "não havia o que apagar".
 */
const TABELAS_DO_TENANT = [
  'lead',
  'task',
  'contentItem',
  'knowledgeNote',
  'segredoDeConector',
  'cobrancaDeAssinatura',
] as const;

describe.skipIf(!URL_DO_BANCO)('suspender não apaga nada, e reativar devolve tudo', () => {
  let prisma: PrismaClient;
  let servico: AssinaturaService;
  const ORG = `org-assinatura-${Math.random().toString(36).slice(2, 10)}`;

  /** O provedor, controlado pelo caso: cada teste diz o que ele responde. */
  let resposta: { completa: boolean; cobrancas: Array<Record<string, unknown>> } = {
    completa: true,
    cobrancas: [],
  };
  const provedorFalso = {
    async cobrancasDaAssinatura() {
      return { ...resposta, porqueIncompleta: resposta.completa ? null : 'teste' };
    },
  };

  function naEmpresa<T>(fn: () => Promise<T>): Promise<T> {
    return comContexto(
      { orgId: ORG, actorType: 'user', actorId: 'operador-teste', correlationId: 'teste-6-2', origem: 'script' },
      fn,
    );
  }

  async function contar(): Promise<Record<string, number>> {
    const saida: Record<string, number> = {};
    for (const tabela of TABELAS_DO_TENANT) {
      const delegate = (prisma as unknown as Record<string, { count: (a: unknown) => Promise<number> }>)[
        tabela
      ];
      saida[tabela] = await delegate.count({ where: { orgId: ORG } });
    }
    return saida;
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL_DO_BANCO } } });
    await prisma.$connect();
    await prisma.org.upsert({
      where: { id: ORG },
      create: { id: ORG, name: 'Empresa da assinatura', slug: ORG, modulos: ['leads', 'conteudo'] },
      update: {},
    });
    // Dado de cliente, para ser contado depois. Pouco de cada, de várias formas.
    await prisma.lead.create({ data: { orgId: ORG, name: 'Cliente que pagou' } });
    await prisma.task.create({
      data: { orgId: ORG, tool: 'interno', title: 'Tarefa que não pode sumir' },
    });
    await prisma.contentItem.create({
      data: { orgId: ORG, externalId: 'peca-1', title: 'Peça publicada', status: 'publicado' },
    });
    await prisma.knowledgeNote.create({
      data: {
        orgId: ORG,
        path: `${ORG}/nota.md`,
        title: 'Nota',
        content: 'conteúdo que não pode sumir',
        fileTime: new Date(),
      },
    });
    /*
     * A CREDENCIAL NO COFRE — a sexta tabela, e a única cuja contagem é uma
     * afirmação de segurança. `valorCifrado` é texto qualquer: o teste não decifra
     * nada, ele conta LINHA. O que importa é que exista uma linha para ser
     * destruída, para que "nenhuma sumiu" queira dizer alguma coisa.
     */
    await prisma.segredoDeConector.create({
      data: {
        orgId: ORG,
        conector: CobrancaAsaasService.CONECTOR,
        nome: CobrancaAsaasService.NOME_DA_CHAVE,
        valorCifrado: 'criptograma-de-teste-nao-decifravel',
        chaveId: 'teste',
        origem: 'teste',
      },
    });

  });

  afterAll(async () => {
    /*
     * Limpeza cirúrgica, só desta empresa. O `EventLog` é append-only por RULE
     * do banco e fica — por isso o id da empresa é aleatório a cada rodada, para
     * a linha deixada não colidir com nada.
     */
    await prisma.cobrancaDeAssinatura.deleteMany({ where: { orgId: ORG } });
    await prisma.assinatura.deleteMany({ where: { orgId: ORG } });
    await prisma.lead.deleteMany({ where: { orgId: ORG } });
    await prisma.task.deleteMany({ where: { orgId: ORG } });
    await prisma.contentItem.deleteMany({ where: { orgId: ORG } });
    await prisma.knowledgeNote.deleteMany({ where: { orgId: ORG } });
    await prisma.segredoDeConector.deleteMany({ where: { orgId: ORG } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    /*
     * SERVIÇO NOVO A CADA CASO, e não um só para o arquivo inteiro.
     *
     * O TETO DE CONFERÊNCIAS é memória do processo, guardada NO SERVIÇO (ver
     * `AssinaturaService.exigirTeto`). Com uma instância compartilhada, os casos
     * anteriores gastariam as doze conferências da janela e os últimos do arquivo
     * reprovariam com 429 — um teste que passa sozinho e reprova acompanhado.
     * Construir aqui isola a contagem por caso, que é o que se quer medir.
     */
    servico = new AssinaturaService(
      prisma as unknown as PrismaService,
      provedorFalso as never,
      cofreFalso(CHAVE_DO_PROVEDOR) as never,
      new EventLogService(prisma as never),
    );
    await prisma.cobrancaDeAssinatura.deleteMany({ where: { orgId: ORG } });
    await prisma.assinatura.deleteMany({ where: { orgId: ORG } });
    await naEmpresa(() =>
      servico.definir(ORG, {
        plano: 'root-os',
        valorCentavos: 49_700,
        diasDeCarencia: 7,
        provedorAssinaturaId: 'sub_123',
      }),
    );
    resposta = { completa: true, cobrancas: [] };
  });

  it('as SEIS tabelas contadas têm linha — senão a contagem não mede nada', async () => {
    /*
     * O CONTROLE DA PRÓPRIA CONTAGEM. Uma tabela que vale zero antes e zero
     * depois passa em qualquer teste de "nada sumiu", inclusive num sistema que
     * apaga tudo. Este caso existe para que a contagem dos outros signifique o
     * que diz.
     */
    resposta = {
      completa: true,
      cobrancas: [
        {
          id: 'pay_semente',
          referencia: 'pay_semente',
          status: 'paga',
          vencimento: new Date(Date.now() - dias(10)),
          valorCentavos: 49_700,
          pagoEm: new Date(),
        },
      ],
    };
    await naEmpresa(() => servico.conferir(ORG));

    const n = await contar();
    for (const tabela of TABELAS_DO_TENANT) {
      expect(n[tabela], `${tabela} não tem linha: a contagem dela não prova nada`).toBeGreaterThan(0);
    }
  });

  it('sem assinatura, o acesso é livre — e é isso que impede a fatia de trancar a carteira', async () => {
    await prisma.assinatura.deleteMany({ where: { orgId: ORG } });
    const estado = await naEmpresa(() => servico.estadoDeAcesso(ORG));
    expect(estado).toBeNull();
    expect(acessoBloqueado(estado)).toBe(false);
  });

  it('o CHECK do banco recusa grafia errada — o controle do "estado ilegível"', async () => {
    /*
     * `estadoDeAcesso` FALHA ABERTA num estado que não sabe ler: libera e grita.
     * A escolha é declarada, e ela só é segura porque o CHECK impede o estado
     * ilegível de existir. Sem este caso, o CHECK podia sumir num rebase e
     * "suspenso grafado errado vira acesso total" aconteceria em silêncio — que é
     * literalmente o cenário escrito no comentário da migração.
     *
     * O `$executeRawUnsafe` é de propósito: o Prisma não deixa escrever valor
     * fora do tipo por caminho normal, e o que se quer exercitar é o BANCO.
     */
    const assinatura = await prisma.assinatura.findUniqueOrThrow({ where: { orgId: ORG } });
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "Assinatura" SET "status" = 'Suspensa' WHERE "id" = $1`, assinatura.id),
    ).rejects.toThrow();

    // E o valor certo passa — senão o caso acima estaria provando só que o UPDATE
    // não funciona.
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "Assinatura" SET "status" = 'suspensa' WHERE "id" = $1`, assinatura.id),
    ).resolves.toBe(1);
    expect(await naEmpresa(() => servico.estadoDeAcesso(ORG))).toBe('suspensa');
  });

  it('o ciclo inteiro: inadimplente → suspensa → paga → ativa, sem perder UMA linha', async () => {
    const antes = await contar();

    // --- vencida dentro da carência: avisa, não bloqueia -------------------
    resposta = {
      completa: true,
      cobrancas: [
        {
          id: 'pay_1',
          referencia: 'pay_1',
          status: 'vencida',
          vencimento: new Date(Date.now() - dias(2)),
          valorCentavos: 49_700,
          pagoEm: null,
        },
      ],
    };
    const aviso = await naEmpresa(() => servico.conferir(ORG));
    expect(aviso.para).toBe('inadimplente');
    expect(acessoBloqueado(await naEmpresa(() => servico.estadoDeAcesso(ORG)))).toBe(false);

    // --- passou da carência: suspende --------------------------------------
    resposta.cobrancas[0].vencimento = new Date(Date.now() - dias(30));
    const suspensao = await naEmpresa(() => servico.conferir(ORG));
    expect(suspensao.para).toBe('suspensa');

    const durante = await contar();
    /*
     * A cobrança espelhada é a ÚNICA linha nova, e ela é conferida de frente em
     * vez de neutralizada na comparação: `+1` exatamente, e as outras cinco
     * idênticas. A versão anterior deste caso copiava o valor de `antes` por cima
     * de `durante` — o que fazia a tabela passar no teste sem ser olhada.
     */
    expect(durante.cobrancaDeAssinatura).toBe(antes.cobrancaDeAssinatura + 1);
    for (const tabela of TABELAS_DO_TENANT.filter((t) => t !== 'cobrancaDeAssinatura')) {
      expect(durante[tabela], tabela).toBe(antes[tabela]);
    }
    expect(acessoBloqueado(await naEmpresa(() => servico.estadoDeAcesso(ORG)))).toBe(true);

    const retratoSuspenso = await naEmpresa(() => servico.retrato(ORG));
    expect(retratoSuspenso.bloqueado).toBe(true);
    expect(retratoSuspenso.suspensaEm).not.toBeNull();
    expect(retratoSuspenso.motivoDaSuspensao).toMatch(/carência/);
    // A credencial continua no cofre: suspender não revoga nada. (A contagem é do
    // BANCO, e não do retrato: o cofre de mentira desta suíte não lista nada.)
    expect(
      await prisma.segredoDeConector.count({ where: { orgId: ORG, revogadoEm: null } }),
    ).toBe(1);

    // --- pagou: reativa, e nada voltou diferente ---------------------------
    resposta.cobrancas[0].status = 'paga';
    resposta.cobrancas[0].pagoEm = new Date();
    const volta = await naEmpresa(() => servico.conferir(ORG));
    expect(volta.para).toBe('ativa');

    const depois = await contar();
    expect(depois).toEqual(durante);
    expect(acessoBloqueado(await naEmpresa(() => servico.estadoDeAcesso(ORG)))).toBe(false);

    const retratoAtivo = await naEmpresa(() => servico.retrato(ORG));
    expect(retratoAtivo.bloqueado).toBe(false);
    // A prova de que houve suspensão NÃO é apagada pela reativação.
    expect(retratoAtivo.suspensaEm).toBe(retratoSuspenso.suspensaEm);
    expect(retratoAtivo.reativadaEm).not.toBeNull();
    // Reativação AUTOMÁTICA não perdoa nada: não havia o que perdoar.
    expect(retratoAtivo.perdoadasAte).toBeNull();
  });

  it('leitura completa e VAZIA não suspende, mesmo com espelho velho de cobrança vencida', async () => {
    /*
     * ============================================================================
     * A REGRESSÃO DO DEFEITO GRAVE — reproduzida antes de ser corrigida
     * ============================================================================
     *
     * A função pura sempre esteve certa. Quem a chamava é que passava TODAS as
     * linhas do banco em vez das que a leitura corrente confirmou — e como o
     * espelho nunca apaga, uma cobrança vencida espelhada uma vez decidia acesso
     * para sempre.
     *
     * O roteiro abaixo é o do revisor, palavra por palavra: espelha uma vencida,
     * o provedor para de mencioná-la e devolve LISTA VAZIA com leitura COMPLETA —
     * o cenário que o cabeçalho de `assinatura.ts` declara impossível. Antes da
     * correção, o desfecho aqui era `suspensa`.
     */
    const agora = new Date();
    resposta = {
      completa: true,
      cobrancas: [
        {
          id: 'pay_x',
          referencia: 'pay_x',
          status: 'vencida',
          vencimento: new Date(agora.getTime() - dias(3)),
          valorCentavos: 49_700,
          pagoEm: null,
        },
      ],
    };
    expect((await naEmpresa(() => servico.conferir(ORG, agora))).para).toBe('inadimplente');

    resposta = { completa: true, cobrancas: [] };
    const depois = new Date(agora.getTime() + dias(10));
    const r = await naEmpresa(() => servico.conferir(ORG, depois));

    // Não suspendeu. E voltou para ativa, porque a leitura corrente não tem nada.
    expect(r.para).toBe('ativa');
    expect(acessoBloqueado(await naEmpresa(() => servico.estadoDeAcesso(ORG)))).toBe(false);

    // E o ESPELHO CONTINUA LÁ: o histórico do cliente não foi apagado para isso
    // funcionar. Ele só deixou de decidir sozinho.
    expect(await prisma.cobrancaDeAssinatura.count({ where: { orgId: ORG } })).toBe(1);
  });

  it('reativar à mão SOBREVIVE à conferência seguinte, com o provedor ainda dizendo vencido', async () => {
    /*
     * O segundo defeito grave, também reproduzido pelo revisor: conferir suspende,
     * reativar ativa, conferir um segundo depois suspende de novo. `reativar` é a
     * saída declarada para pagamento por fora — e nesse caso o provedor NUNCA vai
     * concordar, porque o dinheiro não passou por ele.
     */
    const agora = new Date();
    resposta = {
      completa: true,
      cobrancas: [
        {
          id: 'pay_y',
          referencia: 'pay_y',
          status: 'vencida',
          vencimento: new Date(agora.getTime() - dias(30)),
          valorCentavos: 49_700,
          pagoEm: null,
        },
      ],
    };
    expect((await naEmpresa(() => servico.conferir(ORG, agora))).para).toBe('suspensa');

    const antes = await contar();
    const reativado = await naEmpresa(() =>
      servico.reativar(ORG, 'pagou por PIX direto', 'usuario-1', agora),
    );
    expect(reativado.status).toBe('ativa');
    expect(reativado.perdoadasAte).not.toBeNull();

    // O provedor continua dizendo OVERDUE. A conferência NÃO desfaz a decisão.
    const r = await naEmpresa(() => servico.conferir(ORG, new Date(agora.getTime() + 1000)));
    expect(r.para).toBeNull();
    expect(acessoBloqueado(await naEmpresa(() => servico.estadoDeAcesso(ORG)))).toBe(false);
    // Nenhuma linha foi criada nem destruída para isso.
    expect(await contar()).toEqual(antes);
  });

  it('CONTROLE NEGATIVO: uma cobrança que vence DEPOIS da reativação volta a suspender', async () => {
    // Se o perdão fosse uma bandeira em vez de um instante, este caso passaria
    // com a conta ativa — e a empresa nunca mais seria suspensa por nada.
    const agora = new Date();
    resposta = {
      completa: true,
      cobrancas: [
        {
          id: 'pay_velha',
          referencia: 'pay_velha',
          status: 'vencida',
          vencimento: new Date(agora.getTime() - dias(30)),
          valorCentavos: 49_700,
          pagoEm: null,
        },
      ],
    };
    expect((await naEmpresa(() => servico.conferir(ORG, agora))).para).toBe('suspensa');
    await naEmpresa(() => servico.reativar(ORG, 'acordo comercial', 'usuario-1', agora));

    // Um mês depois, uma fatura NOVA vence e passa da carência.
    const umMesDepois = new Date(agora.getTime() + dias(40));
    resposta.cobrancas.push({
      id: 'pay_nova',
      referencia: 'pay_nova',
      status: 'vencida',
      vencimento: new Date(agora.getTime() + dias(20)),
      valorCentavos: 49_700,
      pagoEm: null,
    });
    const r = await naEmpresa(() => servico.conferir(ORG, umMesDepois));
    expect(r.para).toBe('suspensa');
    expect(r.motivo).toMatch(/pay_nova/);
  });

  it('conferir DUAS VEZES não move nada na segunda', async () => {
    resposta = {
      completa: true,
      cobrancas: [
        {
          id: 'pay_2',
          referencia: 'pay_2',
          status: 'vencida',
          vencimento: new Date(Date.now() - dias(30)),
          valorCentavos: 49_700,
          pagoEm: null,
        },
      ],
    };

    const primeira = await naEmpresa(() => servico.conferir(ORG));
    expect(primeira.para).toBe('suspensa');
    const carimbo = (await prisma.assinatura.findUniqueOrThrow({ where: { orgId: ORG } })).suspensaEm;

    const segunda = await naEmpresa(() => servico.conferir(ORG));
    expect(segunda.para).toBeNull();

    const depois = await prisma.assinatura.findUniqueOrThrow({ where: { orgId: ORG } });
    expect(depois.suspensaEm?.toISOString()).toBe(carimbo?.toISOString());
    // E o espelho não duplicou a cobrança: o índice único fez o seu trabalho.
    expect(await prisma.cobrancaDeAssinatura.count({ where: { orgId: ORG } })).toBe(1);
  });

  it('leitura INCOMPLETA não suspende, e não move o carimbo de "conferida"', async () => {
    resposta = {
      completa: false,
      cobrancas: [
        {
          id: 'pay_3',
          referencia: 'pay_3',
          status: 'vencida',
          vencimento: new Date(Date.now() - dias(90)),
          valorCentavos: 49_700,
          pagoEm: null,
        },
      ],
    };

    const r = await naEmpresa(() => servico.conferir(ORG));
    expect(r.para).toBeNull();
    expect(r.leituraCompleta).toBe(false);
    expect(r.porque).toBe('provedor_indisponivel');

    const linha = await prisma.assinatura.findUniqueOrThrow({ where: { orgId: ORG } });
    expect(linha.status).toBe('ativa');
    // `conferidaEm` significa "a última vez que soubemos", não "que tentamos".
    expect(linha.conferidaEm).toBeNull();
    // Mas o que veio FOI espelhado: upsert nunca apaga, e o dado é verdadeiro.
    expect(await prisma.cobrancaDeAssinatura.count({ where: { orgId: ORG } })).toBe(1);
  });

  it('a causa de não ter conferido chega em CÓDIGO, não em frase', async () => {
    // A tela traduzia toda leitura incompleta como "falha de comunicação", e
    // estas duas causas são hoje cem por cento dos casos da carteira.
    await prisma.assinatura.deleteMany({ where: { orgId: ORG } });
    expect((await naEmpresa(() => servico.conferir(ORG))).porque).toBe('sem_assinatura');

    await naEmpresa(() => servico.definir(ORG, { plano: 'root-os', valorCentavos: 49_700 }));
    expect((await naEmpresa(() => servico.conferir(ORG))).porque).toBe('sem_endereco_no_provedor');
  });

  it('o espelho NÃO apaga cobrança que sumiu da resposta do provedor', async () => {
    resposta = {
      completa: true,
      cobrancas: [
        {
          id: 'pay_a',
          referencia: 'pay_a',
          status: 'paga',
          vencimento: new Date(Date.now() - dias(60)),
          valorCentavos: 49_700,
          pagoEm: new Date(),
        },
      ],
    };
    await naEmpresa(() => servico.conferir(ORG));
    expect(await prisma.cobrancaDeAssinatura.count({ where: { orgId: ORG } })).toBe(1);

    // O provedor "esquece" a cobrança antiga. O histórico do cliente fica.
    resposta = { completa: true, cobrancas: [] };
    await naEmpresa(() => servico.conferir(ORG));
    expect(await prisma.cobrancaDeAssinatura.count({ where: { orgId: ORG } })).toBe(1);
  });

  it('reativar à mão devolve o acesso e registra quem mandou', async () => {
    await naEmpresa(() => servico.suspender(ORG, 'teste de suspensão manual', 'usuario-1'));
    expect(acessoBloqueado(await naEmpresa(() => servico.estadoDeAcesso(ORG)))).toBe(true);

    const antes = await contar();
    const retrato = await naEmpresa(() => servico.reativar(ORG, 'pagou por PIX direto', 'usuario-1'));
    expect(retrato.bloqueado).toBe(false);
    expect(retrato.status).toBe('ativa');
    expect(await contar()).toEqual(antes);

    // Reativar de novo é silencioso e não registra mudança que não houve.
    const denovo = await naEmpresa(() => servico.reativar(ORG, 'de novo', 'usuario-1'));
    expect(denovo.status).toBe('ativa');
  });

  it('o teto recusa a conferência número treze da hora, e não muda acesso nenhum', async () => {
    // Conferir dispara chamada externa com a credencial do cliente. Sem teto, um
    // laço vira martelo no provedor com a chave dele.
    const estado = await naEmpresa(() => servico.estadoDeAcesso(ORG));
    for (let i = 0; i < 12; i++) await naEmpresa(() => servico.conferir(ORG));
    await expect(naEmpresa(() => servico.conferir(ORG))).rejects.toMatchObject({ status: 429 });
    expect(await naEmpresa(() => servico.estadoDeAcesso(ORG))).toBe(estado);
  });

  it('o RASTRO da suspensão diz o motivo, o custo — e não carrega credencial nenhuma', async () => {
    resposta = {
      completa: true,
      cobrancas: [
        {
          id: 'pay_4',
          referencia: 'pay_4',
          status: 'vencida',
          vencimento: new Date(Date.now() - dias(45)),
          valorCentavos: 49_700,
          pagoEm: null,
        },
      ],
    };
    await naEmpresa(() => servico.conferir(ORG));

    /*
     * A ÚLTIMA linha, e não "a única": o `EventLog` é append-only por RULE do
     * banco, então os casos anteriores deste mesmo arquivo deixaram as linhas
     * deles para trás. Esperar exatamente uma seria um teste que passa sozinho e
     * reprova acompanhado — e a ordem em que o vitest roda os casos não é
     * contrato de ninguém.
     */
    const eventos = await prisma.eventLog.findMany({
      where: { orgId: ORG, tipo: 'assinatura.suspensa' },
      orderBy: { seq: 'desc' },
      take: 1,
    });
    expect(eventos).toHaveLength(1);
    expect(eventos[0].nivel).toBe('R4');
    const payload = eventos[0].payload as Record<string, unknown>;
    // R4 cobra os três: motivo, estado anterior e estado novo.
    expect(payload.motivo).toMatch(/pay_4/);
    expect(payload.estadoAnterior).toMatchObject({ status: 'ativa' });
    expect(payload.estadoNovo).toMatchObject({ status: 'suspensa' });
    /*
     * `custo` é palavra da política em R4 e FALTAVA — a linha saía incompleta e o
     * registrador gritava no log a cada suspensão. O que continua ausente tem
     * dono declarado e não é desta linha (`agente`, `ferramenta`, `hashConteudo`,
     * e `aprovador`/`aprovadoEm` na transição automática).
     */
    expect(payload.custo).toBeTruthy();
    const rastro = payload.rastro as { faltando?: string[] } | undefined;
    expect(rastro?.faltando ?? []).not.toContain('custo');
    expect(contemAlgumSegredo(eventos[0], [CHAVE_DO_PROVEDOR]).achou).toBe(false);
  });

  it('o retrato mostrado na tela nunca carrega a chave', async () => {
    const retrato = await naEmpresa(() => servico.retrato(ORG));
    expect(contemAlgumSegredo(retrato, [CHAVE_DO_PROVEDOR]).achou).toBe(false);
    expect(contemAlgumSegredo(JSON.stringify(retrato), [CHAVE_DO_PROVEDOR]).achou).toBe(false);
  });
});

// ===========================================================================
// 6. O GATE — o suspenso vê a tela de suspensão, e nada mais
// ===========================================================================

describe('o gate de suspensão', () => {
  /** Um contexto de execução de mentira, com o caminho que o Express veria. */
  function requisicao(caminho: string, orgId: string | null) {
    return {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ originalUrl: caminho, user: orgId ? { orgId } : undefined }),
      }),
    } as never;
  }

  function gateCom(status: EstadoDeAssinatura | null): SuspensaoInterceptor {
    return new SuspensaoInterceptor({ async estadoDeAcesso() {
      return status;
    } } as never);
  }

  /**
   * O handler devolve um observable DE VERDADE (`of`), e não uma imitação: o
   * gate compõe com `mergeMap`, e um objeto que só finge ter `subscribe` faz o
   * rxjs lançar — o que apareceria como "recusou" em todo caso, inclusive nos
   * que deveriam passar. Foi exatamente o que aconteceu na primeira escrita
   * desta suíte, e o caso de controle negativo abaixo foi quem acusou.
   */
  async function passou(gate: SuspensaoInterceptor, caminho: string, orgId: string | null) {
    const proximo = { handle: () => of('passou') };
    return await new Promise<{ passou: boolean; erro: unknown }>((resolve) => {
      gate.intercept(requisicao(caminho, orgId), proximo as never).subscribe({
        next: () => resolve({ passou: true, erro: null }),
        error: (e: unknown) => resolve({ passou: false, erro: e }),
      });
    });
  }

  it('empresa SUSPENSA é recusada nas rotas do produto, com código próprio', async () => {
    const gate = gateCom('suspensa');
    const r = await passou(gate, '/api/leads', 'org-1');
    expect(r.passou).toBe(false);
    const corpo = (r.erro as { getResponse: () => Record<string, unknown> }).getResponse();
    expect(corpo.error).toBe(CODIGO_ASSINATURA_SUSPENSA);
    // A mensagem diz, com todas as letras, que nada foi apagado.
    expect(String(corpo.message)).toMatch(/Nada foi apagado/);
  });

  it('e continua alcançando entrar, saber e pagar', async () => {
    const gate = gateCom('suspensa');
    for (const caminho of [
      '/api/auth/me',
      '/api/tenants/modulos',
      '/api/assinatura',
      '/api/assinatura/conferir',
      '/api/health',
      '/api/config',
    ]) {
      expect((await passou(gate, caminho, 'org-1')).passou, caminho).toBe(true);
    }
  });

  it('NÃO libera a família `tenants` inteira — só o caminho de que o web precisa', async () => {
    /*
     * O defeito que isto fecha: `tenants` estava na lista de PREFIXOS liberados
     * por causa de `GET /tenants/modulos`, e três controllers novos da mesma onda
     * nasceram alcançáveis por empresa suspensa sem ninguém decidir isso.
     */
    const gate = gateCom('suspensa');
    expect((await passou(gate, '/api/tenants/modulos', 'org-1')).passou).toBe(true);
    for (const caminho of [
      '/api/tenants/provisionar',
      '/api/tenants/onboarding/cadastro',
      '/api/tenants/onboarding/estado',
      '/api/tenants/plataforma/resumo',
      '/api/tenants/plataforma/empresas',
      '/api/tenants/suporte',
    ]) {
      expect((await passou(gate, caminho, 'org-1')).passou, caminho).toBe(false);
    }
    // E nem sub-rota inventada abaixo do caminho exato passa.
    expect((await passou(gate, '/api/tenants/modulos/tudo', 'org-1')).passou).toBe(false);
  });

  it('CONTROLE NEGATIVO: sem o bloqueio, a mesma requisição passaria', async () => {
    // A única diferença entre este caso e o primeiro é o estado da assinatura.
    // Se `/api/leads` passasse nos dois, o gate não estaria fazendo nada.
    expect((await passou(gateCom('ativa'), '/api/leads', 'org-1')).passou).toBe(true);
    expect((await passou(gateCom(null), '/api/leads', 'org-1')).passou).toBe(true);
    expect((await passou(gateCom('inadimplente'), '/api/leads', 'org-1')).passou).toBe(true);
    expect((await passou(gateCom('suspensa'), '/api/leads', 'org-1')).passou).toBe(false);
  });

  it('não se contorna com caixa alta nem com escape de URL', async () => {
    const gate = gateCom('suspensa');
    // O Express casa rota sem diferenciar caixa: `/api/LEADS` entra no mesmo
    // controller. Um gate que compare a grafia crua deixaria passar com um shift.
    expect((await passou(gate, '/api/LEADS', 'org-1')).passou).toBe(false);
    expect((await passou(gate, '/api/%6Ceads', 'org-1')).passou).toBe(false);
    // E a query não confunde o segmento.
    expect((await passou(gate, '/api/leads?status=novo', 'org-1')).passou).toBe(false);
    // Do outro lado: `/api/ASSINATURA` continua liberado nas duas grafias.
    expect((await passou(gate, '/api/ASSINATURA', 'org-1')).passou).toBe(true);
    // Mas um caminho que só case DECODIFICADO com o liberado não passa por cima
    // do gate por acidente: as duas leituras precisam concordar.
    expect((await passou(gate, '/api/%74enants/plataforma', 'org-1')).passou).toBe(false);
  });

  it('requisição sem empresa passa: a página pública do cliente não sai do ar', async () => {
    // Derrubar a bio de um cliente por causa de uma fatura seria apagar a
    // presença dele na internet — destruição de valor, não cobrança.
    expect((await passou(gateCom('suspensa'), '/api/bio/public/page/fulano', null)).passou).toBe(true);
  });

  it('falha ao ler o estado LIBERA, em vez de trancar a carteira', async () => {
    const gate = new SuspensaoInterceptor({
      async estadoDeAcesso() {
        throw new Error('banco fora');
      },
    } as never);
    const log = capturarLog();
    try {
      expect((await passou(gate, '/api/leads', 'org-1')).passou).toBe(true);
    } finally {
      log.parar();
    }
    expect(log.linhas.some((l) => String(l).includes('LIBERADO'))).toBe(true);
  });
});

// ===========================================================================
// 6b. O INVENTÁRIO — rota nova numa família liberada não nasce em silêncio
// ===========================================================================

/** Sobe até apps/api. Vitest roda com cwd lá, mas a CI pode invocar de fora. */
function acharRaizDaApi(): string {
  const marco = path.join('prisma', 'schema.prisma');
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, marco))) return dir;
    if (existsSync(path.join(dir, 'apps', 'api', marco))) return path.join(dir, 'apps', 'api');
    const pai = path.dirname(dir);
    if (pai === dir) break;
    dir = pai;
  }
  throw new Error(`Não encontrei apps/api/prisma/schema.prisma a partir de "${process.cwd()}".`);
}

const RAIZ_DA_API = acharRaizDaApi();

function arquivosDeControlador(dir: string, achados: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entrada.name);
    if (entrada.isDirectory()) arquivosDeControlador(p, achados);
    else if (entrada.name.endsWith('.controller.ts')) achados.push(p);
  }
  return achados;
}

const DECORADOR_DE_CONTROLLER = /@Controller\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)?\s*\)/;
const DECORADOR_DE_ROTA =
  /@(Get|Post|Put|Patch|Delete|All|Head|Options)\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)?\s*\)/g;

/**
 * Todas as rotas HTTP da API, lidas dos decoradores.
 *
 * Mesma técnica de `modulos-por-tenant.test.ts`, e pelo mesmo motivo: a lista
 * escrita à mão envelhece na primeira rota nova, e o acidente que interessa aqui
 * é justamente o da rota nova.
 */
function rotasDaApi(): { caminho: string; metodo: string; arquivo: string }[] {
  const rotas: { caminho: string; metodo: string; arquivo: string }[] = [];
  for (const arquivo of arquivosDeControlador(path.join(RAIZ_DA_API, 'src'))) {
    const texto = readFileSync(arquivo, 'utf8');
    const m = DECORADOR_DE_CONTROLLER.exec(texto);
    const base = (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').replace(/^\/+|\/+$/g, '');
    DECORADOR_DE_ROTA.lastIndex = 0;
    let r: RegExpExecArray | null;
    while ((r = DECORADOR_DE_ROTA.exec(texto)) !== null) {
      const sub = (r[2] ?? r[3] ?? r[4] ?? '').replace(/^\/+|\/+$/g, '');
      rotas.push({
        caminho: '/' + ['api', base, sub].filter((p) => p !== '').join('/'),
        metodo: r[1],
        arquivo: path.relative(RAIZ_DA_API, arquivo),
      });
    }
  }
  return rotas;
}

/**
 * TODA rota que uma empresa suspensa alcança hoje. Declarada, uma a uma.
 *
 * NÃO EDITE ESTA LISTA SEM DECIDIR. Ela é o único lugar do sistema em que
 * aparece, escrito, o que um cliente bloqueado por falta de pagamento consegue
 * fazer. Rota nova dentro de `auth`, `config`, `health` ou `assinatura` reprova
 * este caso até alguém acrescentá-la aqui de propósito — que é exatamente o que
 * não aconteceu quando `tenants` liberava a família inteira e três controllers
 * novos entraram por baixo.
 */
const ROTAS_ALCANCADAS_POR_SUSPENSO = [
  'Get /api/assinatura',
  'Get /api/auth/google/callback',
  'Get /api/auth/google/disponivel',
  'Get /api/auth/google/start',
  'Get /api/auth/me',
  'Get /api/config',
  'Get /api/health',
  'Get /api/health/versao',
  'Get /api/tenants/modulos',
  'Post /api/assinatura/conferir',
  'Post /api/assinatura/reativar',
  'Post /api/assinatura/suspender',
  'Post /api/auth/login',
  'Post /api/auth/reautenticar',
  'Post /api/config/password',
  'Put /api/assinatura',
  'Put /api/assinatura/credencial',
].sort();

describe('o inventário do que um suspenso alcança', () => {
  const ROTAS = rotasDaApi();

  it('acha as rotas (piso de quantidade: varredura vazia passaria em tudo)', () => {
    // Sem este piso, um regex quebrado devolveria zero rotas e o caso abaixo
    // passaria com a lista vazia — verde em silêncio, que é como catraca morre.
    expect(ROTAS.length).toBeGreaterThan(150);
  });

  it('é exatamente o declarado — rota nova em família liberada reprova aqui', () => {
    const liberadas = ROTAS.filter((r) => liberadoNaSuspensao(r.caminho))
      .map((r) => `${r.metodo} ${r.caminho}`)
      .sort();
    expect(liberadas).toEqual(ROTAS_ALCANCADAS_POR_SUSPENSO);
  });

  it('a maioria esmagadora das rotas NÃO é alcançada — o controle da própria lista', () => {
    // Se `liberadoNaSuspensao` passasse a devolver `true` para tudo, o caso acima
    // reprovaria — mas este diz, em número, o tamanho do que está sendo barrado.
    const liberadas = ROTAS.filter((r) => liberadoNaSuspensao(r.caminho)).length;
    expect(liberadas).toBeLessThan(ROTAS.length / 10);
  });

  it('cada entrada da lista de liberados diz POR QUE, e família é escolha explícita', () => {
    for (const l of LIBERADOS_NA_SUSPENSAO) {
      expect(l.porque.trim(), l.caminho).not.toBe('');
      expect(typeof l.familia, l.caminho).toBe('boolean');
    }
    // `tenants/modulos` é caminho exato. Se alguém o promover a família, o
    // console da plataforma volta a ser alcançável por empresa suspensa.
    const tenants = LIBERADOS_NA_SUSPENSAO.find((l) => l.caminho === 'tenants/modulos');
    expect(tenants?.familia).toBe(false);
  });
});

// ===========================================================================
// 7. AS ROTINAS — o tique não é requisição, e o gate não alcança o tique
// ===========================================================================

describe('empresa suspensa não dispara rotina', () => {
  const ORG = 'org-com-rotina';

  /** Uma rotina que bate em qualquer minuto e está num estado que dispara. */
  const ROTINA = {
    id: 'rot-1',
    orgId: ORG,
    slug: 'coleta',
    // NÃO é `pauta.rodada`: aquele tipo é pulado quando `PAUTA_CRON=off` está no
    // ambiente, e o caso passaria verde pelo motivo errado numa máquina que a
    // tenha no `.env`.
    tipo: 'indexar.vault',
    cron: '* * * * *',
    tz: 'America/Sao_Paulo',
    ativo: true,
    estado: 'rodando',
    reservadoAte: new Date(0),
  };

  function agendadorCom(status: EstadoDeAssinatura | null) {
    const executadas: string[] = [];
    const prisma = {
      rotina: {
        async findMany(args: { select?: unknown; where?: unknown }) {
          return args?.select ? [{ orgId: ORG }] : [ROTINA];
        },
      },
      pautaRotina: {
        async findMany() {
          return [];
        },
      },
    };
    const rotinas = {
      async reconciliarPauta() {
        return { criadas: 0, atualizadas: 0, orfas: 0, problemas: [] };
      },
      async executar(r: { slug: string }) {
        executadas.push(r.slug);
        return { status: 'ok', resumo: '' };
      },
    };
    const assinaturas = {
      async estadoDeAcesso() {
        return status;
      },
    };
    return {
      executadas,
      agendador: new RotinasScheduler(
        prisma as never,
        rotinas as never,
        assinaturas as never,
      ),
    };
  }

  it('A DÉCIMA TRAVA: o agendador RECUSA SUBIR sem o serviço de assinatura', () => {
    /*
     * A dependência é `@Optional()` no construtor porque esta suíte e a de
     * rotinas montam o agendador à mão. Conveniência de teste que não é travada
     * no arranque vira falha aberta em produção — e esta, em particular, é a
     * mais silenciosa das dez: sem o serviço, o tique volta a disparar a rotina
     * de TODA empresa, inclusive a que a plataforma acabou de suspender por
     * falta de pagamento. Nada no log diria que o gate de suspensão deixou de
     * alcançar o relógio; só a fatura de modelo no fim do mês.
     *
     * A asserção existia no código desde a fatia 6.2 e NENHUM caso a exercia —
     * ela era um comentário com `throw` dentro. Trava que nunca foi vista
     * disparar é trava que ninguém sabe se está armada: basta o import sumir do
     * `RoutinesModule` para o `@Optional()` absorver a falta em silêncio, e é
     * exatamente esse o cenário que este caso reproduz.
     */
    const semAssinaturas = new RotinasScheduler({} as never, {} as never, undefined);
    expect(() => semAssinaturas.onModuleInit()).toThrow(/AssinaturaService/);

    // E o outro lado: com o serviço, sobe. Sem esta linha, a asserção acima
    // passaria até com um construtor que lança sempre.
    const { agendador } = agendadorCom('ativa');
    expect(() => agendador.onModuleInit()).not.toThrow();
  });

  it('CONTROLE NEGATIVO: com a assinatura em dia, a rotina dispara', async () => {
    // Sem este caso, "não disparou" seria indistinguível de "o tique não funciona
    // neste arranjo de mentira".
    const { agendador, executadas } = agendadorCom('ativa');
    const log = capturarLog();
    try {
      await agendador.tick(new Date());
    } finally {
      log.parar();
    }
    expect(executadas).toEqual(['coleta']);
  });

  it('sem assinatura nenhuma a rotina também dispara — ausência nunca bloqueia', async () => {
    const { agendador, executadas } = agendadorCom(null);
    const log = capturarLog();
    try {
      await agendador.tick(new Date());
    } finally {
      log.parar();
    }
    expect(executadas).toEqual(['coleta']);
  });

  it('SUSPENSA: nenhuma rotina dispara, e o log diz por quê uma vez só', async () => {
    const { agendador, executadas } = agendadorCom('suspensa');
    const log = capturarLog();
    try {
      await agendador.tick(new Date('2026-09-11T12:00:00.000Z'));
      await agendador.tick(new Date('2026-09-11T12:01:00.000Z'));
    } finally {
      log.parar();
    }
    expect(executadas).toEqual([]);
    const avisos = log.linhas.filter((l) => String(l).includes('nenhuma rotina dela dispara'));
    expect(avisos).toHaveLength(1);
  });

  it('CANCELADA também não dispara', async () => {
    const { agendador, executadas } = agendadorCom('cancelada');
    const log = capturarLog();
    try {
      await agendador.tick(new Date());
    } finally {
      log.parar();
    }
    expect(executadas).toEqual([]);
  });

  it('falhar ao ler o estado DEIXA a rotina rodar — o relógio não para por um soluço', async () => {
    const executadas: string[] = [];
    const agendador = new RotinasScheduler(
      {
        rotina: {
          async findMany(args: { select?: unknown }) {
            return args?.select ? [{ orgId: ORG }] : [ROTINA];
          },
        },
        pautaRotina: { async findMany() { return []; } },
      } as never,
      {
        async reconciliarPauta() {
          return { criadas: 0, atualizadas: 0, orfas: 0, problemas: [] };
        },
        async executar(r: { slug: string }) {
          executadas.push(r.slug);
          return null;
        },
      } as never,
      {
        async estadoDeAcesso() {
          throw new Error('banco fora');
        },
      } as never,
    );

    const log = capturarLog();
    try {
      await agendador.tick(new Date());
    } finally {
      log.parar();
    }
    expect(executadas).toEqual(['coleta']);
    expect(log.linhas.some((l) => String(l).includes('RODAM assim mesmo'))).toBe(true);
  });
});

// ===========================================================================
// 8. O CONTRATO DAS ROTAS — lido do código-fonte, não da memória de ninguém
// ===========================================================================

describe('as rotas que mudam estado exigem permissão', () => {
  const FONTE = readFileSync(
    path.join(RAIZ_DA_API, 'src', 'billing', 'assinatura.controller.ts'),
    'utf8',
  );

  /** O bloco de decoradores que antecede um método de rota. */
  function decoradoresDe(rota: string): string {
    const i = FONTE.indexOf(rota);
    expect(i, `não achei "${rota}" no controller`).toBeGreaterThan(-1);
    // Do decorador de rota até a próxima chave de abertura de método.
    return FONTE.slice(i, FONTE.indexOf('{', FONTE.indexOf('async', i)));
  }

  it('conferir EXIGE `admin.usuarios` — sem isso qualquer usuário desfaz a reativação', () => {
    /*
     * O defeito: `POST /assinatura/conferir` não exigia permissão nenhuma, e é o
     * botão "já paguei" que a tela de suspensão oferece. Qualquer usuário
     * autenticado desfazia com um clique a reativação que um administrador tinha
     * acabado de fazer — porque a conferência aplica o que o PROVEDOR diz, e o
     * provedor discorda justamente nos casos em que `reativar` existe.
     */
    const bloco = decoradoresDe("@Post('conferir')");
    expect(bloco).toContain('@UseGuards(PermissionsGuard)');
    expect(bloco).toContain("@RequirePermissions('admin.usuarios')");
  });

  it('todas as que mudam estado exigem a mesma permissão', () => {
    for (const rota of [
      '@Put()',
      "@Put('credencial')",
      "@Post('reativar')",
      "@Post('suspender')",
      "@Post('conferir')",
    ]) {
      expect(decoradoresDe(rota), rota).toContain("@RequirePermissions('admin.usuarios')");
    }
  });

  it('CONTROLE NEGATIVO: a rota de LEITURA continua sem permissão, de propósito', () => {
    // Se este caso também exigisse permissão, o teste acima não estaria medindo
    // nada — bastaria a string aparecer uma vez no arquivo. E a leitura precisa
    // continuar aberta: é ela que a casca usa para mandar o suspenso à tela.
    const bloco = decoradoresDe('@Get()');
    expect(bloco).not.toContain('@RequirePermissions');
  });
});
