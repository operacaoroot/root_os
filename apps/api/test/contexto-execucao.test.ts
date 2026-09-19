import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConsoleLogger, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { defer, firstValueFrom } from 'rxjs';
import {
  PREFIXO_EXTERNO,
  SemTenantError,
  camposDeContexto,
  comContexto,
  contextoAtual,
  correlacaoAtual,
  correlacaoEhExterna,
  exigirTenant,
  marcarCorrelacaoExterna,
  novaCorrelacao,
  tenantAtual,
} from '../src/common/contexto-execucao';
import { ContextoInterceptor } from '../src/common/contexto.interceptor';
import { LoggerDeCorrelacao } from '../src/common/logger-correlacao';
import { EfeitosRegistry, type ContextoDoEfeito } from '../src/gateway/efeitos.registry';
import { SuspensaoInterceptor } from '../src/billing/suspensao.interceptor';

/*
 * O contexto de execução (RF-T-04, RNF-09) sem banco nenhum.
 *
 * É teste de unidade de propósito: o que está sob prova aqui é regra pura —
 * "sem tenant é erro", "a correlação atravessa", "o parâmetro vence o
 * ambiente". Nada disso precisa de Postgres, e amarrar ao banco só tornaria
 * lento o que hoje roda em milissegundos (09-PADRÕES §5). A prova de que a
 * coisa toda funciona ponta a ponta — proposta, aprovação, efeito, RASTRO —
 * está em `contexto-aprovacao.test.ts`, contra banco de verdade.
 */

describe('tenant: ausência é erro, nunca "todos" (RF-T-04)', () => {
  it('fora de qualquer contexto, pedir o tenant LANÇA', () => {
    expect(() => tenantAtual('teste')).toThrow(SemTenantError);
    expect(() => tenantAtual('teste')).toThrow(/nunca "todos"/);
  });

  it('contexto sem empresa resolvida não vira "todos" — continua lançando', () => {
    comContexto({ orgId: null, correlationId: 'c1' }, () => {
      expect(() => tenantAtual('rota pública')).toThrow(SemTenantError);
      // mas a correlação existe: é o que permite achar a falha no log
      expect(correlacaoAtual()).toBe('c1');
    });
  });

  it('empresa em branco conta como ausência', () => {
    for (const vazio of ['', '   ', '\t\n']) {
      expect(() => exigirTenant(vazio, 'teste')).toThrow(SemTenantError);
    }
    expect(() => exigirTenant(undefined, 'teste')).toThrow(SemTenantError);
    expect(() => exigirTenant(null, 'teste')).toThrow(SemTenantError);
  });

  it('empresa resolvida devolve o valor sem tocá-lo', () => {
    expect(exigirTenant('org-1', 'teste')).toBe('org-1');
    comContexto({ orgId: 'org-1', correlationId: 'c1' }, () => {
      expect(tenantAtual()).toBe('org-1');
    });
  });

  it('a mensagem diz ONDE faltou — sem isso, o erro é uma adivinhação', () => {
    expect(() => exigirTenant(null, 'AcoesService.executarAprovada')).toThrow(
      /AcoesService\.executarAprovada/,
    );
  });
});

describe('correlação: atravessa e não se mistura (RNF-09)', () => {
  it('sobrevive a await e a cadeia de chamadas', async () => {
    const dentro = await comContexto({ orgId: 'org-1', correlationId: 'sessao-9' }, async () => {
      await new Promise((r) => setTimeout(r, 1));
      const maisFundo = async () => correlacaoAtual();
      return maisFundo();
    });
    expect(dentro).toBe('sessao-9');
  });

  it('duas execuções simultâneas não trocam de contexto', async () => {
    const rodar = (org: string, cor: string) =>
      comContexto({ orgId: org, correlationId: cor }, async () => {
        await new Promise((r) => setTimeout(r, org === 'a' ? 5 : 1));
        return `${tenantAtual()}/${correlacaoAtual()}`;
      });

    const [a, b] = await Promise.all([rodar('a', 'cor-a'), rodar('b', 'cor-b')]);
    expect(a).toBe('a/cor-a');
    expect(b).toBe('b/cor-b');
  });

  it('o escopo fecha quando a função termina — nada vaza para fora', () => {
    comContexto({ orgId: 'org-1', correlationId: 'c1' }, () => undefined);
    expect(contextoAtual()).toBeUndefined();
  });

  it('identificador novo é único e aceita prefixo legível', () => {
    const a = novaCorrelacao('http');
    const b = novaCorrelacao('http');
    expect(a).not.toBe(b);
    expect(a.startsWith('http-')).toBe(true);
    expect(novaCorrelacao()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('procedência da correlação: o que veio de fora fica marcado', () => {
  it('o que nós cunhamos NUNCA parece vindo de fora', () => {
    // É a invariante inteira: se um identificador nosso pudesse começar com a
    // marca, ela deixaria de distinguir coisa nenhuma dentro do RASTRO.
    for (const cunhado of [novaCorrelacao(), novaCorrelacao('http'), novaCorrelacao('aprovacao')]) {
      expect(correlacaoEhExterna(cunhado)).toBe(false);
    }
  });

  it('o prefixo reservado é cobrado pelo código, não pela lembrança de quem lê', () => {
    expect(() => novaCorrelacao(PREFIXO_EXTERNO)).toThrow(/reservado/);
  });

  it('valor de fora entra marcado e continua reconhecível', () => {
    expect(marcarCorrelacaoExterna('trace-abc')).toBe('ext-trace-abc');
    expect(correlacaoEhExterna(marcarCorrelacaoExterna('trace-abc'))).toBe(true);
  });

  it('marcar não deduplica: quem manda "ext-…" não consegue escolher a string inteira', () => {
    // Deduplicar devolveria ao chamador o poder de ditar o que vem depois da
    // marca — e ele voltaria a poder forjar a correlação de outra ação.
    expect(marcarCorrelacaoExterna('ext-forjado')).toBe('ext-ext-forjado');
  });

  it('nada que veio de fora alcança a forma de um identificador nosso', () => {
    for (const tentativa of ['http-9f2c', 'aprovacao-123', 'sessao-42', '']) {
      expect(marcarCorrelacaoExterna(tentativa)).not.toBe(tentativa);
      expect(correlacaoEhExterna(marcarCorrelacaoExterna(tentativa))).toBe(true);
    }
  });

  it('sem correlação nenhuma, "é externa?" é não — e não explode', () => {
    expect(correlacaoEhExterna(null)).toBe(false);
    expect(correlacaoEhExterna(undefined)).toBe(false);
  });
});

describe('correlacaoPai: a jornada não se parte quando o identificador troca', () => {
  it('escopo de fora com OUTRA correlação vira o pai, sem ninguém repassá-lo', () => {
    // É a requisição HTTP abrindo uma sessão de agente: o identificador muda,
    // e o de origem precisa continuar na mesma linha de log.
    comContexto({ orgId: 'o', correlationId: 'http-1' }, () => {
      comContexto({ orgId: 'o', correlationId: 'sessao-9' }, () => {
        expect(contextoAtual()?.correlacaoPai).toBe('http-1');
      });
    });
  });

  it('escopo interno com a MESMA correlação preserva o pai', () => {
    // É a porta reabrindo o contexto em volta do efeito com o mesmo `ExecCtx`:
    // sem isto, o fundo da pilha — justamente onde o efeito loga — perderia a
    // ponta que liga a sessão à requisição.
    comContexto({ correlationId: 'http-1' }, () => {
      comContexto({ correlationId: 'sessao-9' }, () => {
        comContexto({ correlationId: 'sessao-9', origem: 'agente' }, () => {
          expect(contextoAtual()?.correlacaoPai).toBe('http-1');
        });
      });
    });
  });

  it('no topo não há pai — e isso não vira string vazia', () => {
    comContexto({ correlationId: 'cron-1' }, () => {
      expect(contextoAtual()?.correlacaoPai).toBeNull();
      expect(camposDeContexto().pai).toBeUndefined();
    });
  });

  it('pai informado à mão vence a dedução', () => {
    comContexto({ correlationId: 'http-1' }, () => {
      comContexto({ correlationId: 'sessao-9', correlacaoPai: 'tarefa-do-cron' }, () => {
        expect(contextoAtual()?.correlacaoPai).toBe('tarefa-do-cron');
      });
    });
  });

  it('a cadeia inteira do agente carrega as duas pontas na MESMA linha', () => {
    // requisição → sessão → porta → efeito, que é o caminho real
    comContexto({ orgId: 'org-1', correlationId: 'http-1' }, () => {
      comContexto({ orgId: 'org-1', correlationId: 'sessao-9', origem: 'agente' }, () => {
        comContexto({ orgId: 'org-1', correlationId: 'sessao-9', actorId: 'agente-x' }, () => {
          expect(camposDeContexto()).toEqual({
            cor: 'sessao-9',
            pai: 'http-1',
            org: 'org-1',
            ator: 'agente-x',
          });
        });
      });
    });
  });
});

describe('o efeito recebe ator e correlação, não só a empresa', () => {
  const capturar = () => {
    const visto: { args: unknown; orgId: string; ctx: ContextoDoEfeito }[] = [];
    const registro = new EfeitosRegistry();
    registro.registrar({
      'whatsapp.mensagem.enviar': async (args, orgId, ctx) => {
        visto.push({ args, orgId, ctx });
        return { enviado: true };
      },
    });
    return { registro, visto };
  };

  it('contexto completo chega inteiro ao efeito', async () => {
    const { registro, visto } = capturar();
    await registro.executar(
      'whatsapp.mensagem.enviar',
      { corpo: 'oi' },
      {
        orgId: 'org-1',
        actorType: ActorType.user,
        actorId: 'pedro',
        agentSlug: 'assistente',
        correlationId: 'sessao-9',
      },
    );
    expect(visto).toHaveLength(1);
    expect(visto[0].orgId).toBe('org-1');
    expect(visto[0].ctx).toMatchObject({
      orgId: 'org-1',
      actorType: ActorType.user,
      actorId: 'pedro',
      agentSlug: 'assistente',
      correlationId: 'sessao-9',
    });
  });

  it('quem passa só o orgId herda ator e correlação do contexto em volta', async () => {
    // É o caminho do laço do agente: `executar(cap, args, orgId)`. A porta abre
    // o contexto em volta do efeito, e o que falta vem de lá.
    const { registro, visto } = capturar();
    await comContexto(
      {
        orgId: 'org-1',
        actorType: ActorType.ai,
        actorId: 'agente-teste',
        agentSlug: 'assistente',
        correlationId: 'sessao-9',
      },
      () => registro.executar('whatsapp.mensagem.enviar', {}, 'org-1'),
    );
    expect(visto[0].ctx).toMatchObject({
      actorType: ActorType.ai,
      actorId: 'agente-teste',
      agentSlug: 'assistente',
      correlationId: 'sessao-9',
    });
  });

  it('o PARÂMETRO vence o ambiente — é o que faz a aprovação registrar quem aprovou', async () => {
    // A requisição de confirmação abre um contexto de HTTP com o usuário que
    // clicou; o efeito, porém, tem de sair no nome de quem APROVOU aquela ação
    // e amarrado à correlação da PROPOSTA. Se o ambiente vencesse, a linha do
    // RASTRO diria a história errada.
    const { registro, visto } = capturar();
    await comContexto(
      { orgId: 'org-1', actorType: ActorType.user, actorId: 'quem-clicou', correlationId: 'http-1' },
      () =>
        registro.executar(
          'whatsapp.mensagem.enviar',
          {},
          {
            orgId: 'org-1',
            actorType: ActorType.user,
            actorId: 'pedro',
            correlationId: 'sessao-da-proposta',
          },
        ),
    );
    expect(visto[0].ctx.actorId).toBe('pedro');
    expect(visto[0].ctx.correlationId).toBe('sessao-da-proposta');
  });

  it('a forma COMPLETA exige a empresa — não herda a do ambiente', async () => {
    // O risco que isto fecha: um chamador futuro monta o contexto inteiro e
    // esquece o `orgId`. Herdando, ele rodaria no tenant de quem por acaso
    // estivesse em volta — silenciosamente, e com o efeito já disparado.
    const { registro, visto } = capturar();
    await comContexto(
      { orgId: 'org-do-ambiente', actorId: 'pedro', correlationId: 'c1' },
      async () => {
        for (const faltando of [{}, { orgId: null }, { orgId: undefined }]) {
          await expect(
            registro.executar('whatsapp.mensagem.enviar', {}, faltando as unknown as ContextoDoEfeito),
          ).rejects.toThrow(SemTenantError);
        }
      },
    );
    expect(visto).toHaveLength(0);
  });

  it('terceiro parâmetro ausente também LANÇA, mesmo com empresa no ambiente', async () => {
    const { registro, visto } = capturar();
    await comContexto({ orgId: 'org-do-ambiente', correlationId: 'c1' }, async () => {
      for (const nada of [null, undefined]) {
        await expect(
          registro.executar('whatsapp.mensagem.enviar', {}, nada as unknown as string),
        ).rejects.toThrow(SemTenantError);
      }
    });
    expect(visto).toHaveLength(0);
  });

  it('a forma CURTA com empresa de verdade não mudou — é o caminho do laço do agente', async () => {
    const { registro, visto } = capturar();
    await comContexto({ orgId: 'org-do-ambiente', actorId: 'pedro', correlationId: 'c1' }, () =>
      registro.executar('whatsapp.mensagem.enviar', {}, 'org-1'),
    );
    // o parâmetro vence o ambiente também aqui
    expect(visto[0].orgId).toBe('org-1');
    expect(visto[0].ctx.actorId).toBe('pedro');
  });

  it('sem empresa resolvida o efeito NÃO é chamado', async () => {
    const { registro, visto } = capturar();
    await expect(registro.executar('whatsapp.mensagem.enviar', {}, '')).rejects.toThrow(
      SemTenantError,
    );
    await expect(
      registro.executar('whatsapp.mensagem.enviar', {}, { orgId: '  ' } as ContextoDoEfeito),
    ).rejects.toThrow(SemTenantError);
    expect(visto).toHaveLength(0);
  });

  it('o tenant é conferido ANTES de descobrir se a capacidade tem efeito', async () => {
    // Ordem importa: se a checagem de efeito viesse primeiro, uma chamada sem
    // empresa a uma capacidade sem efeito devolveria "não tem efeito ligado" e
    // esconderia o furo de tenancy.
    const registro = new EfeitosRegistry();
    await expect(registro.executar('capacidade.inexistente', {}, '')).rejects.toThrow(
      SemTenantError,
    );
    await expect(registro.executar('capacidade.inexistente', {}, 'org-1')).rejects.toThrow(
      /ainda não tem efeito ligado/,
    );
  });

  it('efeito de dois parâmetros continua válido — os dez de leitura não mudaram', async () => {
    const registro = new EfeitosRegistry();
    let orgVisto = '';
    registro.registrar({
      'numeros.painel.ler': async (_args, orgId) => {
        orgVisto = orgId;
        return { leadsHoje: 12 };
      },
    });
    const r = await registro.executar('numeros.painel.ler', {}, 'org-1');
    expect(orgVisto).toBe('org-1');
    expect(r).toEqual({ leadsHoje: 12 });
  });
});

describe('o interceptor abre o contexto de cada requisição', () => {
  const pedido = (req: Record<string, unknown>) => {
    const cabecalhos: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => (cabecalhos[k] = v) };
    const execCtx = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ExecutionContext;
    return { execCtx, cabecalhos, req };
  };

  const handler = (fn: () => unknown): CallHandler => ({ handle: () => defer(async () => fn()) });

  it('o handler roda DENTRO do contexto, com tenant, ator e correlação', async () => {
    const { execCtx, cabecalhos } = pedido({
      headers: {},
      user: { sub: 'u-1', orgId: 'org-1' },
    });
    const visto = await firstValueFrom(
      new ContextoInterceptor().intercept(
        execCtx,
        handler(() => contextoAtual()),
      ),
    );
    expect(visto).toMatchObject({
      orgId: 'org-1',
      actorType: ActorType.user,
      actorId: 'u-1',
      origem: 'http',
    });
    // a correlação volta no cabeçalho: sem isso, o erro está na tela e a causa
    // no log, e ninguém junta os dois
    expect(cabecalhos['x-correlation-id']).toBe((visto as { correlationId: string }).correlationId);
  });

  it('rota sem usuário NÃO ganha empresa de consolação', async () => {
    const { execCtx } = pedido({ headers: {} });
    const erro = await firstValueFrom(
      new ContextoInterceptor().intercept(
        execCtx,
        handler(() => {
          try {
            tenantAtual('rota pública');
            return null;
          } catch (e) {
            return (e as Error).name;
          }
        }),
      ),
    );
    expect(erro).toBe('SemTenantError');
  });

  it('guarda de dispositivo abre tenant e ator técnico para os gates globais', async () => {
    const { execCtx } = pedido({
      headers: {},
      connectorDevice: { id: 'device-1', orgId: 'org-device' },
    });
    const visto = await firstValueFrom(
      new ContextoInterceptor().intercept(
        execCtx,
        handler(() => contextoAtual()),
      ),
    );
    expect(visto).toMatchObject({
      orgId: 'org-device',
      actorType: ActorType.system,
      actorId: 'device-1',
      origem: 'http',
    });
  });

  it('suspensão composta bloqueia PAT e dispositivo, sem tratar nenhum como anônimo', async () => {
    const suspensao = new SuspensaoInterceptor({ async estadoDeAcesso() { return 'suspensa'; } } as never);
    for (const caso of [
      { path: '/api/agent/memoria/buscar', identidade: { user: { sub: 'pat-owner', orgId: 'org-pat' } } },
      { path: '/api/conector/pulso', identidade: { connectorDevice: { id: 'device-suspenso', orgId: 'org-device' } } },
    ]) {
      const { execCtx, req } = pedido({ headers: {}, originalUrl: caso.path, ...caso.identidade });
      await expect(firstValueFrom(new ContextoInterceptor().intercept(execCtx, {
        handle: () => suspensao.intercept(execCtx, handler(() => 'não deveria chegar')),
      }))).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'assinatura_suspensa' }),
      });
      expect(req).toBeTruthy();
    }
  });

  it('reaproveita a correlação que veio de fora — MARCADA como vinda de fora', async () => {
    const { execCtx, cabecalhos } = pedido({
      headers: { 'x-correlation-id': 'trace-abc.123' },
      user: { sub: 'u', orgId: 'o' },
    });
    const visto = (await firstValueFrom(
      new ContextoInterceptor().intercept(
        execCtx,
        handler(() => correlacaoAtual()),
      ),
    )) as string;
    // o fio com quem chamou continua de pé...
    expect(visto).toContain('trace-abc.123');
    // ...mas ninguém confunde o que ELE escolheu com o que NÓS cunhamos
    expect(correlacaoEhExterna(visto)).toBe(true);
    expect(visto).toBe('ext-trace-abc.123');
    // e a resposta devolve a mesma string que foi para o log
    expect(cabecalhos['x-correlation-id']).toBe(visto);
  });

  it('chamador anônimo não consegue forjar a correlação de outra ação', async () => {
    // O ataque que isto fecha: quem aprova escolhe a string que vai para o
    // campo `correlacaoDaConfirmacao` dos eventos `acao.executada`/`acao.falhou`
    // — RASTRO append-only. Mandando a correlação de OUTRA ação, ele plantaria
    // um vínculo falso que ninguém apaga depois. Marcado, o valor plantado
    // nunca coincide com um identificador nosso.
    const alvo = novaCorrelacao('http');
    const { execCtx } = pedido({ headers: { 'x-request-id': alvo } });
    const visto = (await firstValueFrom(
      new ContextoInterceptor().intercept(
        execCtx,
        handler(() => correlacaoAtual()),
      ),
    )) as string;
    expect(visto).not.toBe(alvo);
    expect(correlacaoEhExterna(visto)).toBe(true);
  });

  it('cabeçalho com injeção de log é DESCARTADO, não sanitizado pela metade', async () => {
    // Conteúdo externo nunca é instrução (02-CONSTRAINTS). Aqui ele iria parar
    // numa linha de log e num cabeçalho de resposta: quebra de linha, espaço e
    // texto longo ficam de fora, e o pedido ganha identificador próprio.
    for (const veneno of ['abc\nlevel=fatal', 'com espaço', 'x'.repeat(101), '']) {
      const { execCtx } = pedido({ headers: { 'x-correlation-id': veneno }, user: { sub: 'u', orgId: 'o' } });
      const visto = (await firstValueFrom(
        new ContextoInterceptor().intercept(
          execCtx,
          handler(() => correlacaoAtual()),
        ),
      )) as string;
      expect(visto).not.toBe(veneno);
      expect(visto.startsWith('http-')).toBe(true);
    }
  });

  it('fora de HTTP não inventa contexto nenhum', async () => {
    const execCtx = { getType: () => 'rpc' } as unknown as ExecutionContext;
    const visto = await firstValueFrom(
      new ContextoInterceptor().intercept(
        execCtx,
        handler(() => contextoAtual()),
      ),
    );
    expect(visto).toBeUndefined();
  });
});

describe('o log carrega a correlação (RNF-09)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('a linha sai marcada com correlação, empresa e ator', () => {
    const espiao = vi.spyOn(ConsoleLogger.prototype, 'log').mockImplementation(() => undefined);
    const logger = new LoggerDeCorrelacao();
    comContexto(
      { orgId: 'org-1', actorId: 'pedro', agentSlug: 'assistente', correlationId: 'sessao-9' },
      () => logger.log('whatsapp.mensagem.enviar executada', 'Acoes'),
    );
    expect(espiao).toHaveBeenCalledWith(
      '[cor:sessao-9 org:org-1 ator:pedro agente:assistente] whatsapp.mensagem.enviar executada',
      'Acoes',
    );
  });

  it('todos os níveis da escalada saem marcados, inclusive fatal', () => {
    const niveis = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;
    for (const nivel of niveis) {
      const espiao = vi
        .spyOn(ConsoleLogger.prototype, nivel)
        .mockImplementation(() => undefined);
      const logger = new LoggerDeCorrelacao();
      comContexto({ correlationId: 'c1' }, () => logger[nivel]('mensagem'));
      expect(espiao, `nível ${nivel} sem marca de correlação`).toHaveBeenCalledWith(
        '[cor:c1] mensagem',
      );
      espiao.mockRestore();
    }
  });

  it('fora de contexto, a mensagem sai limpa — sem marca vazia', () => {
    const espiao = vi.spyOn(ConsoleLogger.prototype, 'warn').mockImplementation(() => undefined);
    new LoggerDeCorrelacao().warn('porta em modo IMPOR', 'ToolGateway');
    expect(espiao).toHaveBeenCalledWith('porta em modo IMPOR', 'ToolGateway');
  });

  it('os campos saem como objeto; hoje o único consumidor os achata em prefixo', () => {
    // O objeto é montado campo a campo e testado assim. O `LoggerDeCorrelacao`
    // o transforma em `[cor:… org:…]` porque o destino do log é texto — trocar
    // isso por log em JSON é decisão de operação, não deste arquivo.
    comContexto({ orgId: 'org-1', correlationId: 'c1' }, () => {
      expect(camposDeContexto()).toEqual({ cor: 'c1', org: 'org-1' });
    });
    expect(camposDeContexto()).toEqual({});
  });

  it('a linha do efeito mostra sessão E requisição — é o que liga porta a efeito', () => {
    const espiao = vi.spyOn(ConsoleLogger.prototype, 'log').mockImplementation(() => undefined);
    const logger = new LoggerDeCorrelacao();
    comContexto({ orgId: 'org-1', correlationId: 'http-1' }, () => {
      comContexto({ orgId: 'org-1', correlationId: 'sessao-9', origem: 'agente' }, () => {
        logger.log('whatsapp.mensagem.enviar executada', 'Acoes');
      });
    });
    expect(espiao).toHaveBeenCalledWith(
      '[cor:sessao-9 pai:http-1 org:org-1] whatsapp.mensagem.enviar executada',
      'Acoes',
    );
  });
});
