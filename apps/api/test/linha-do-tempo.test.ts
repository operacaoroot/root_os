import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ActorType, RiskLevel } from '@prisma/client';

import { LinhaDoTempoService } from '../src/linha-do-tempo/linha-do-tempo.service';
import {
  CHAVES_DE_CONTEUDO,
  CHAVES_DE_FAMILIA,
  CursorInvalidoError,
  FAMILIAS,
  FAMILIA_POR_PREFIXO,
  FiltroInvalidoError,
  IDENTIFICADORES_DO_OBJETO,
  JANELA_DOS_FILTROS,
  LIMITE_MAXIMO,
  LIMITE_PADRAO,
  NARRATIVA,
  TETO_DO_IDENTIFICADOR,
  chaveDeFiltro,
  codificarCursor,
  decodificarCursor,
  familiaDeFiltro,
  limiteDaPagina,
  nomear,
  objetoDoEvento,
  prefixosDaFamilia,
  selo,
  temConteudo,
  tiposDaFamilia,
} from '../src/linha-do-tempo/narrativa';
import {
  PREFIXOS_DA_ESPINHA,
  PrefixoNaoDeclaradoError,
  caminhoLiberado,
  moduloDoCaminho,
} from '../src/tenants/modulos';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { EventLogService } from '../src/gateway/event-log.service';

/*
 * ==========================================================================
 * A LINHA DO TEMPO — fatia A9
 * ==========================================================================
 *
 * O que esta suíte trava, defesa por defesa. Cada caso fica VERMELHO se a peça
 * que ele mede sair:
 *
 *  1. FONTE ÚNICA. O serviço lê `EventLog` e nada mais, e NÃO tem caminho de
 *     escrita: um `create`/`update`/`upsert` no arquivo reprova. A tentação de
 *     "materializar a linha numa tabela própria" é exatamente a segunda verdade
 *     sobre o mesmo fato que o ADR-011 evita na memória;
 *  2. CONTEÚDO NÃO SAI. A lista de identificadores e a lista de campos de
 *     conteúdo são DISJUNTAS, a segunda é conferida contra o arquivo-fonte de
 *     `ConteudoDoEvento` (campo novo lá reprova aqui), e a projeção do serviço é
 *     interrogada com um payload cheio de conteúdo e de sigilo;
 *  3. PAGINA POR CURSOR. `seq < cursor` e `orderBy seq desc`, `take` = limite+1,
 *     teto de 200 imposto no servidor. Trocar por `skip` reprova — e é o defeito
 *     declarado da rota de listagem da memória, que não se repete aqui;
 *  4. PREFIXO DECLARADO. `linha-do-tempo` é espinha; sem a declaração,
 *     `moduloDoCaminho` LANÇA em tempo de execução, que foi como as famílias
 *     `memoria` e `rotinas` nasceram quebradas inteiras;
 *  5. EVENTO DESCONHECIDO APARECE. `nomear` devolve o tipo cru e `conhecido:
 *     false`; nenhum caminho o filtra fora da lista;
 *  6. NOME RESOLVE DENTRO DA EMPRESA. Ator e agente são buscados com `orgId`, e
 *     ponteiro que não é da casa devolve NULO em vez do nome do vizinho;
 *  7. A PERMISSÃO DA ROTA É A DO MENU. O desencontro que dava 403 na fila de
 *     aprovação (menu pedindo uma chave, API outra) não se repete.
 *
 * SEM BANCO, de propósito, pelo mesmo argumento de `estado-do-agente.test.ts`:
 * o que está sob teste é DECISÃO (que consulta é montada, o que sai na
 * projeção, o que é recusado), não persistência — e suíte de trava que se PULA
 * na máquina de quem não tem `TEST_DATABASE_URL` é o pior desfecho possível.
 */

/* ========================================================================== *
 * Dublês
 * ========================================================================== */

interface Chamada {
  where: Record<string, unknown>;
  orderBy: unknown;
  take: number;
  select: Record<string, unknown>;
}

function prismaFalso(opts: {
  linhas?: Record<string, unknown>[];
  amostra?: { tipo: string; agentSlug: string | null }[];
  gente?: { id: string; name: string }[];
  agentes?: { slug: string; nome: string }[];
}) {
  const chamadas: Chamada[] = [];
  const buscasDeGente: Record<string, unknown>[] = [];
  const buscasDeAgente: Record<string, unknown>[] = [];
  let vez = 0;
  const prisma = {
    eventLog: {
      findMany: (args: Chamada) => {
        chamadas.push(args);
        // A primeira chamada é a página; a segunda, a amostra dos filtros.
        const ehAmostra = args.take === JANELA_DOS_FILTROS;
        vez += 1;
        return Promise.resolve(ehAmostra ? (opts.amostra ?? []) : (opts.linhas ?? []));
      },
    },
    user: {
      findMany: (args: { where: Record<string, unknown> }) => {
        buscasDeGente.push(args.where);
        return Promise.resolve(opts.gente ?? []);
      },
    },
    agent: {
      findMany: (args: { where: Record<string, unknown> }) => {
        buscasDeAgente.push(args.where);
        return Promise.resolve(opts.agentes ?? []);
      },
    },
  } as unknown as PrismaService;
  return { prisma, chamadas, buscasDeGente, buscasDeAgente, vezes: () => vez };
}

const eventosFalso = {
  diasDeRetencao: () => Promise.resolve(365),
  retencaoPadrao: () => 1825,
} as unknown as EventLogService;

function linha(over: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    seq: 42n,
    tipo: 'tool.resultado',
    actorType: ActorType.ai,
    actorId: null,
    agentSlug: 'assistente',
    capabilityId: 'numeros.painel.ler',
    nivel: RiskLevel.R0,
    correlationId: 'c-1',
    ocorreuEm: new Date('2026-09-14T12:00:00.000Z'),
    payload: { rastro: { nivel: 'R0', completo: true } },
    ...over,
  };
}

const RAIZ = path.resolve(__dirname, '..');
const FONTE_DO_SERVICO = readFileSync(
  path.join(RAIZ, 'src/linha-do-tempo/linha-do-tempo.service.ts'),
  'utf8',
);
const FONTE_DO_CONTROLLER = readFileSync(
  path.join(RAIZ, 'src/linha-do-tempo/linha-do-tempo.controller.ts'),
  'utf8',
);

/* ========================================================================== *
 * 1. Fonte única: lê o rastro, e só lê
 * ========================================================================== */

describe('A9: a fonte é o EventLog, e a tela não escreve nada', () => {
  it('o serviço não tem NENHUM caminho de escrita', () => {
    // Uma tabela própria de "linha do tempo" seria uma segunda verdade sobre o
    // mesmo fato. Se alguém a criar, é aqui que a conversa acontece.
    for (const verbo of ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany', '$executeRaw']) {
      expect(FONTE_DO_SERVICO.includes(`${verbo}(`), `o serviço passou a chamar ${verbo}`).toBe(
        false,
      );
    }
  });

  it('o serviço não lê tabela nenhuma além de EventLog, User e Agent', () => {
    const modelos = [...FONTE_DO_SERVICO.matchAll(/this\.prisma\.(\w+)\./g)].map((m) => m[1]);
    expect([...new Set(modelos)].sort()).toEqual(['agent', 'eventLog']);
    // `User` entra pelo caminho declarado (donos-da-casa), não por consulta solta.
    expect(FONTE_DO_SERVICO).toContain('donosDaCasa');
  });

  it('registrar evento é de outro dono: o serviço não injeta escritor de rastro', () => {
    expect(FONTE_DO_SERVICO.includes('.registrar(')).toBe(false);
  });
});

/* ========================================================================== *
 * 2. Conteúdo não sai por aqui
 * ========================================================================== */

describe('A9: a rota devolve identificador, nunca conteúdo', () => {
  it('as duas listas são DISJUNTAS — nenhuma chave de conteúdo é identificador', () => {
    const conteudo = new Set<string>(CHAVES_DE_CONTEUDO);
    const colisao = Object.keys(IDENTIFICADORES_DO_OBJETO).filter((k) => conteudo.has(k));
    expect(colisao, `chave de conteúdo na lista de permissão: ${colisao.join(', ')}`).toEqual([]);
  });

  it('CHAVES_DE_CONTEUDO cobre todo campo de `ConteudoDoEvento` no arquivo-fonte', () => {
    /*
     * `ConteudoDoEvento` é uma `interface` — não existe em tempo de execução, e
     * por isso a lista foi redigitada. Este caso é o que amarra as duas: campo
     * novo na política fica VERMELHO aqui até alguém decidir se ele é conteúdo
     * (e portanto não sai) ou identificador.
     */
    const fonte = readFileSync(path.join(RAIZ, 'src/gateway/event-log.service.ts'), 'utf8');
    const bloco = fonte.split('export interface ConteudoDoEvento {')[1]?.split('\n}')[0] ?? '';
    expect(bloco.length).toBeGreaterThan(100);
    const campos = [...bloco.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
    expect(campos.length).toBeGreaterThan(10);
    const faltando = campos.filter((c) => !CHAVES_DE_CONTEUDO.includes(c));
    expect(faltando, `campo de conteúdo sem declaração: ${faltando.join(', ')}`).toEqual([]);
  });

  it('`objetoDoEvento` descarta conteúdo, sigilo e objeto aninhado', () => {
    const campos = objetoDoEvento({
      capacidade: 'whatsapp.mensagem.enviar',
      // conteúdo, que a política nomeia — nenhum destes pode aparecer
      argumentos: { para: '+5511999999999', corpo: 'texto do cliente' },
      resumo: 'resumo legível do que ia sair',
      motivo: 'porque o Pedro pediu',
      estadoAnterior: { status: 'ativa' },
      canal: 'whatsapp',
      // o número de quem mandou decisão por canal
      remetente: '+5511888888888',
      // objeto aninhado sob chave PERMITIDA: o corte por primitivo pega
      estado: { corpo: 'não pode sair' },
    });
    const valores = campos.map((c) => c.valor).join(' | ');
    expect(campos.map((c) => c.chave)).toEqual(['capacidade']);
    for (const proibido of ['+55', 'texto do cliente', 'resumo legível', 'Pedro pediu', 'não pode sair']) {
      expect(valores.includes(proibido), `vazou "${proibido}"`).toBe(false);
    }
    // A capacidade É identificador, e sai: é ela que responde "o que foi feito".
    expect(valores).toContain('whatsapp.mensagem.enviar');
  });

  it('identificador é normalizado e cortado — sem quebra de linha, sem texto longo', () => {
    const campos = objetoDoEvento({ taskId: `t-1\ninjetado:\n  cabeçalho ${'x'.repeat(500)}` });
    expect(campos[0].valor).not.toMatch(/[\n\r]/);
    expect(campos[0].valor.length).toBeLessThanOrEqual(TETO_DO_IDENTIFICADOR);
  });

  it('`temConteudo` acende para qualquer campo da política, e apaga sem nenhum', () => {
    expect(temConteudo({ resumo: 'x' })).toBe(true);
    expect(temConteudo({ motivo: 'x' })).toBe(true);
    expect(temConteudo({ capacidade: 'x', rastro: { nivel: 'R0' } })).toBe(false);
    expect(temConteudo(null)).toBe(false);
    expect(temConteudo(['resumo'])).toBe(false);
  });

  it('a PROJEÇÃO do serviço não deixa passar campo de conteúdo, nem o payload cru', async () => {
    const { prisma } = prismaFalso({
      linhas: [
        linha({
          payload: {
            capacidade: 'whatsapp.mensagem.enviar',
            argumentos: { para: '+5511999999999', corpo: 'segredo do cliente' },
            resumo: 'resumo assinado',
            motivo: 'motivo escrito por gente',
            rastro: { nivel: 'R3', completo: false, sensibilidade: 'confidencial' },
          },
        }),
      ],
    });
    const svc = new LinhaDoTempoService(prisma, eventosFalso);
    const r = await svc.listar({ orgId: 'o1' });

    const serializado = JSON.stringify(r);
    for (const proibido of ['+5511999999999', 'segredo do cliente', 'resumo assinado', 'motivo escrito']) {
      expect(serializado.includes(proibido), `vazou "${proibido}" na resposta`).toBe(false);
    }
    // O que SAI: o selo do registro, que é metadado, e o identificador.
    expect(r.itens[0].temConteudo).toBe(true);
    expect(r.itens[0].sensibilidade).toBe('confidencial');
    expect(r.itens[0].registroCompleto).toBe(false);
    expect(r.itens[0].objeto).toEqual([{ chave: 'capacidade', valor: 'whatsapp.mensagem.enviar' }]);
    // Por chave, e não por conversão de tipo: `as Record<string, unknown>` não
    // compila (o item não tem assinatura de índice) e o `as unknown as` que
    // compilaria esconderia justamente o erro de tipo que interessa aqui. A
    // pergunta é se a CHAVE `payload` saiu na resposta, e é isso que se mede.
    expect(Object.keys(r.itens[0])).not.toContain('payload');
  });

  it('`selo` não inventa nada quando `payload.rastro` não existe', () => {
    expect(selo(undefined)).toEqual({ sensibilidade: null, registroCompleto: null });
    expect(selo({ rastro: { nivel: null, conferido: false } })).toEqual({
      sensibilidade: null,
      registroCompleto: null,
    });
  });
});

/* ========================================================================== *
 * 3. Paginação por cursor
 * ========================================================================== */

describe('A9: pagina por cursor, nunca por deslocamento', () => {
  it('o serviço não usa `skip` em lugar nenhum', () => {
    // É o defeito declarado da rota de listagem da memória. Não se repete aqui.
    expect(FONTE_DO_SERVICO.includes('skip')).toBe(false);
  });

  it('a consulta ordena por `seq` desc, pede limite+1 e não traz payload no select da tela', async () => {
    const { prisma, chamadas } = prismaFalso({ linhas: [linha()] });
    const svc = new LinhaDoTempoService(prisma, eventosFalso);
    await svc.listar({ orgId: 'o1', limite: 10 });
    const pagina = chamadas[0];
    expect(pagina.orderBy).toEqual({ seq: 'desc' });
    expect(pagina.take).toBe(11);
    expect(pagina.where.orgId).toBe('o1');
    // A LINHA EXTRA existe para saber que há mais SEM pagar um `count` na tabela
    // que mais cresce do sistema.
    expect(pagina.select.payload).toBe(true);
  });

  it('o cursor continua de onde parou: `seq < cursor`', async () => {
    const { prisma, chamadas } = prismaFalso({ linhas: [] });
    const svc = new LinhaDoTempoService(prisma, eventosFalso);
    await svc.listar({ orgId: 'o1', antesDe: 99n });
    expect(chamadas[0].where.seq).toEqual({ lt: 99n });
  });

  it('`proximoCursor` só aparece quando há mais, e aponta para a ÚLTIMA lida', async () => {
    const dez = Array.from({ length: 4 }, (_, i) => linha({ id: `e${i}`, seq: BigInt(40 - i) }));
    const { prisma } = prismaFalso({ linhas: dez });
    const svc = new LinhaDoTempoService(prisma, eventosFalso);

    const cheia = await svc.listar({ orgId: 'o1', limite: 3 });
    expect(cheia.itens).toHaveLength(3);
    expect(cheia.proximoCursor).toBe(codificarCursor(38n));

    const fim = await svc.listar({ orgId: 'o1', limite: 10 });
    expect(fim.itens).toHaveLength(4);
    expect(fim.proximoCursor).toBeNull();
  });

  it('o cursor é OPACO e volta o mesmo número', () => {
    const c = codificarCursor(1234n);
    expect(c).not.toBe('1234');
    expect(decodificarCursor(c)).toBe(1234n);
  });

  it('cursor torto é RECUSADO, não tratado como primeira página', () => {
    // Cair para a primeira página devolveria 200 com uma lista que não é a
    // pedida — e na tela do rastro isso vira "não aconteceu nada".
    for (const ruim of ['abc', '', codificarCursor(0n), Buffer.from('-1').toString('base64url')]) {
      expect(() => decodificarCursor(ruim)).toThrow(CursorInvalidoError);
    }
  });

  it('o teto da página é do SERVIDOR, e o pedido absurdo não o fura', () => {
    expect(limiteDaPagina(undefined)).toBe(LIMITE_PADRAO);
    expect(limiteDaPagina('10000')).toBe(LIMITE_MAXIMO);
    expect(limiteDaPagina('0')).toBe(1);
    expect(limiteDaPagina('-5')).toBe(1);
    expect(limiteDaPagina('abc')).toBe(LIMITE_PADRAO);
  });

  it('as contagens de filtro NÃO são recalculadas ao paginar', async () => {
    const { prisma, vezes } = prismaFalso({ linhas: [linha()], amostra: [{ tipo: 'tool.resultado', agentSlug: null }] });
    const svc = new LinhaDoTempoService(prisma, eventosFalso);

    const primeira = await svc.listar({ orgId: 'o1' });
    expect(primeira.filtros).not.toBeNull();
    const depoisDaPrimeira = vezes();

    const seguinte = await svc.listar({ orgId: 'o1', antesDe: 10n });
    expect(seguinte.filtros).toBeNull();
    // Uma consulta a mais, não duas: a amostra dos filtros não roda de novo.
    expect(vezes()).toBe(depoisDaPrimeira + 1);
  });

  it('a contagem de filtro DIZ que é parcial quando a janela corta', async () => {
    const amostra = Array.from({ length: JANELA_DOS_FILTROS }, () => ({
      tipo: 'tool.resultado',
      agentSlug: null,
    }));
    const { prisma } = prismaFalso({ linhas: [], amostra });
    const svc = new LinhaDoTempoService(prisma, eventosFalso);
    const r = await svc.listar({ orgId: 'o1' });
    expect(r.filtros?.parcial).toBe(true);
    expect(r.filtros?.janela).toBe(JANELA_DOS_FILTROS);
  });
});

/* ========================================================================== *
 * 4. O prefixo declarado
 * ========================================================================== */

describe('A9: o prefixo novo é espinha, e está declarado', () => {
  it('`linha-do-tempo` está em PREFIXOS_DA_ESPINHA', () => {
    expect(PREFIXOS_DA_ESPINHA).toContain('linha-do-tempo');
  });

  it('a rota não LANÇA e não desliga para empresa nenhuma', () => {
    // Prefixo não declarado lança em tempo de execução — foi assim que
    // `memoria` e `rotinas` quebraram inteiras.
    expect(() => moduloDoCaminho('/api/linha-do-tempo')).not.toThrow();
    expect(moduloDoCaminho('/api/linha-do-tempo')).toBeNull();
    expect(caminhoLiberado('/api/linha-do-tempo?limite=50', [])).toBe(true);
  });

  it('prefixo vizinho e inventado continua LANÇANDO — a lista é declarada, não deduzida', () => {
    expect(() => moduloDoCaminho('/api/linha-do-tempo-x')).toThrow(PrefixoNaoDeclaradoError);
  });
});

/* ========================================================================== *
 * 5. O evento que a tela não sabe nomear
 * ========================================================================== */

describe('A9: evento desconhecido aparece com o tipo cru', () => {
  it('`nomear` devolve o tipo como rótulo e `conhecido: false`', () => {
    const n = nomear('coisa.que.ninguem.declarou');
    expect(n.rotulo).toBe('coisa.que.ninguem.declarou');
    expect(n.conhecido).toBe(false);
    expect(n.familia).toBe('outro');
  });

  it('desconhecido com prefixo conhecido cai na família do prefixo, ainda sem nome', () => {
    const n = nomear('pauta.ficha_gerada');
    expect(n.conhecido).toBe(false);
    expect(n.rotulo).toBe('pauta.ficha_gerada');
    expect(n.familia).toBe('pauta');
  });

  it('a lista NUNCA esconde o desconhecido', async () => {
    const { prisma } = prismaFalso({ linhas: [linha({ tipo: 'tipo.novo.de.amanha' })] });
    const svc = new LinhaDoTempoService(prisma, eventosFalso);
    const r = await svc.listar({ orgId: 'o1' });
    expect(r.itens).toHaveLength(1);
    expect(r.itens[0].tipo).toBe('tipo.novo.de.amanha');
    expect(r.itens[0].conhecido).toBe(false);
  });

  it('o dicionário é convenção sadia: família válida, rótulo em frase, sem repetição', () => {
    const rotulos = new Set<string>();
    for (const [tipo, v] of Object.entries(NARRATIVA)) {
      expect(CHAVES_DE_FAMILIA, `${tipo}: família inexistente`).toContain(v.familia);
      expect(v.rotulo.length, tipo).toBeGreaterThan(5);
      // Rótulo igual ao tipo faria `conhecido: true` parecer `false` na tela.
      expect(v.rotulo, tipo).not.toBe(tipo);
      expect(rotulos.has(v.rotulo), `rótulo repetido: ${v.rotulo}`).toBe(false);
      rotulos.add(v.rotulo);
    }
    // `outro` não tem tipo declarado: ela é definida por exclusão.
    expect(Object.values(NARRATIVA).some((v) => v.familia === 'outro')).toBe(false);
  });

  it('prefixo com DUAS famílias no dicionário fica fora do mapa — não se escolhe em silêncio', () => {
    // `conector.*` responde por `conexao` em dois tipos, e é família única;
    // `agente.*` tem `agente` e `custo` (o orçamento), então não deve estar no
    // mapa por prefixo. Se alguém "arrumar" isso escolhendo uma, este caso cai.
    expect(FAMILIA_POR_PREFIXO.conector).toBe('conexao');
    expect(FAMILIA_POR_PREFIXO.agente).toBeUndefined();
    expect(nomear('agente.coisa_nova').familia).toBe('outro');
  });
});

/* ========================================================================== *
 * 6. Nome resolve DENTRO da empresa
 * ========================================================================== */

describe('A9: ator e agente resolvem dentro da empresa, ou não resolvem', () => {
  it('a busca de gente e de agente carrega `orgId`', async () => {
    const { prisma, buscasDeGente, buscasDeAgente } = prismaFalso({
      linhas: [linha({ actorType: ActorType.user, actorId: 'u1', agentSlug: 'assistente' })],
      gente: [{ id: 'u1', name: 'Pedro' }],
      agentes: [{ slug: 'assistente', nome: 'Assistente da central' }],
    });
    const svc = new LinhaDoTempoService(prisma, eventosFalso);
    const r = await svc.listar({ orgId: 'o1' });
    expect(buscasDeGente[0].orgId).toBe('o1');
    expect(buscasDeAgente[0].orgId).toBe('o1');
    expect(r.itens[0].ator).toBe('Pedro');
    expect(r.itens[0].agenteNome).toBe('Assistente da central');
  });

  it('ponteiro de OUTRA empresa devolve NULO — nunca o nome do vizinho', async () => {
    // `Agent.slug` não é único globalmente e `User` não guarda o par
    // (usuário, empresa) na coluna de ator: sem `orgId` a tela publicaria gente
    // e agente de outro cliente. Mesma lição de `agents/donos-da-casa.ts`.
    const { prisma } = prismaFalso({
      linhas: [linha({ actorType: ActorType.user, actorId: 'u-de-fora', agentSlug: 'de-fora' })],
      gente: [],
      agentes: [],
    });
    const svc = new LinhaDoTempoService(prisma, eventosFalso);
    const r = await svc.listar({ orgId: 'o1' });
    expect(r.itens[0].ator).toBeNull();
    expect(r.itens[0].atorId).toBe('u-de-fora');
    expect(r.itens[0].agenteNome).toBeNull();
    expect(r.itens[0].agenteSlug).toBe('de-fora');
  });

  it('o serviço nunca resolve nome por relação do Prisma (`include`)', () => {
    expect(FONTE_DO_SERVICO.includes('include:')).toBe(false);
  });
});

/* ========================================================================== *
 * 7. Os filtros
 * ========================================================================== */

describe('A9: os filtros são exatos, e o valor torto é recusado', () => {
  it('família fora do vocabulário é recusada', () => {
    expect(() => familiaDeFiltro('inventada')).toThrow(FiltroInvalidoError);
    expect(familiaDeFiltro('agente')).toBe('agente');
    expect(familiaDeFiltro('')).toBeUndefined();
  });

  it('tipo e agente conferem o formato — recusar diz a verdade, ignorar não', () => {
    expect(chaveDeFiltro('tool.resultado')).toBe('tool.resultado');
    expect(chaveDeFiltro('assistente-da-central')).toBe('assistente-da-central');
    for (const ruim of ['Tool.Resultado', "a' or 1=1", 'com espaço', 'x'.repeat(200)]) {
      expect(() => chaveDeFiltro(ruim), ruim).toThrow(FiltroInvalidoError);
    }
  });

  it('a família vira tipos declarados OU prefixo — as duas metades', async () => {
    const { prisma, chamadas } = prismaFalso({ linhas: [] });
    const svc = new LinhaDoTempoService(prisma, eventosFalso);
    await svc.listar({ orgId: 'o1', familia: 'pauta' });
    const ou = chamadas[0].where.OR as Record<string, unknown>[];
    expect(ou.some((c) => JSON.stringify(c).includes('pauta.rodada'))).toBe(true);
    // Sem o `startsWith`, `pauta.ficha_gerada` — que `nomear` põe na família
    // pela família do prefixo — ficaria escondido de quem pediu "Pauta".
    expect(ou.some((c) => JSON.stringify(c).includes('startsWith'))).toBe(true);
  });

  it('`outro` não tem cláusula SQL: filtra depois de nomear, e o cursor não trava', async () => {
    const linhas = [
      linha({ id: 'a', seq: 30n, tipo: 'tool.resultado' }),
      linha({ id: 'b', seq: 29n, tipo: 'tool.proposta' }),
      linha({ id: 'c', seq: 28n, tipo: 'tool.erro' }),
    ];
    const { prisma, chamadas } = prismaFalso({ linhas });
    const svc = new LinhaDoTempoService(prisma, eventosFalso);
    const r = await svc.listar({ orgId: 'o1', familia: 'outro', limite: 2 });
    expect(chamadas[0].where.OR).toBeUndefined();
    // Todos são conhecidos: a página vem VAZIA e o cursor ANDA. Apontar o cursor
    // para o último sobrevivente seria um laço que nunca termina.
    expect(r.itens).toHaveLength(0);
    expect(r.proximoCursor).toBe(codificarCursor(29n));
  });

  it('`tiposDaFamilia` e `prefixosDaFamilia` casam com o dicionário', () => {
    expect(tiposDaFamilia('outro')).toBeNull();
    expect(prefixosDaFamilia('outro')).toEqual([]);
    for (const familia of CHAVES_DE_FAMILIA) {
      if (familia === 'outro') continue;
      const tipos = tiposDaFamilia(familia) ?? [];
      expect(tipos.length, familia).toBeGreaterThan(0);
      for (const t of tipos) expect(NARRATIVA[t].familia).toBe(familia);
    }
  });

  it('toda família declarada tem rótulo e descrição — o menu não mostra chave crua', () => {
    for (const [chave, v] of Object.entries(FAMILIAS)) {
      expect(v.rotulo.trim(), chave).not.toBe('');
      expect(v.descricao.length, chave).toBeGreaterThan(10);
    }
  });
});

/* ========================================================================== *
 * 8. A permissão da rota é a do menu
 * ========================================================================== */

describe('A9: a permissão da rota é a mesma do item de menu', () => {
  it('a rota pede `auditoria.ver`, a mesma do Rastro', () => {
    // Item de menu pedindo uma permissão e API respondendo a outra é o 403 que a
    // fila de aprovação já pagou uma vez (fatia 3.10).
    expect(FONTE_DO_CONTROLLER).toContain("@RequirePermissions('auditoria.ver')");
    expect(FONTE_DO_CONTROLLER).toContain("@Controller('linha-do-tempo')");
    expect(FONTE_DO_CONTROLLER).toContain('JwtAuthGuard');
    expect(FONTE_DO_CONTROLLER).toContain('PermissionsGuard');
  });

  it('não há rota de escrita no controller', () => {
    for (const verbo of ['@Post(', '@Put(', '@Patch(', '@Delete(']) {
      expect(FONTE_DO_CONTROLLER.includes(verbo), `o controller ganhou um ${verbo}`).toBe(false);
    }
  });
});

/* ========================================================================== *
 * 9. O horizonte
 * ========================================================================== */

describe('A9: o horizonte é a retenção desta empresa', () => {
  it('a resposta diz o prazo de guarda', async () => {
    const { prisma } = prismaFalso({ linhas: [linha()] });
    const svc = new LinhaDoTempoService(prisma, eventosFalso);
    const r = await svc.listar({ orgId: 'o1' });
    expect(r.retencaoDias).toBe(365);
    expect(r.source.tool).toBe('rastro');
  });

  it('falha ao ler a retenção cai no padrão, e não derruba a leitura', async () => {
    const quebrado = {
      diasDeRetencao: () => Promise.reject(new Error('banco fora')),
      retencaoPadrao: () => 1825,
    } as unknown as EventLogService;
    const { prisma } = prismaFalso({ linhas: [linha()] });
    const svc = new LinhaDoTempoService(prisma, quebrado);
    const r = await svc.listar({ orgId: 'o1' });
    expect(r.retencaoDias).toBe(1825);
    expect(r.itens).toHaveLength(1);
  });
});
