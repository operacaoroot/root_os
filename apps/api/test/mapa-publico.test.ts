/**
 * O MAPA PÚBLICO — nada aparece sem marca — fatia 6.5
 * ===================================================
 *
 * O QUE ESTA SUÍTE PROVA
 * A raiz de `os.operacaoroot.com` mostra dado real de um tenant para quem nunca
 * se cadastrou. A promessa que segura isso é uma só: **nada aparece na página
 * pública que não tenha sido marcado como público de forma explícita, por
 * registro**. Aqui essa promessa é medida — POR TENTATIVA, não por leitura de
 * código.
 *
 * AS TRÊS TENTATIVAS, e é delas que a suíte é feita:
 *
 *  1. UM RASCUNHO NO CAMINHO. Uma linha de `MapaPublicoItem` com `publicadoEm`
 *     nulo e um rótulo reconhecível, na MESMA empresa, no MESMO eixo, com a
 *     MESMA ordem das publicadas. Ela está em cima da consulta; o que a segura é
 *     o filtro. A rota é chamada e o rótulo não pode aparecer em lugar nenhum da
 *     resposta.
 *  2. A VOLTA COMPLETA. O mesmo registro é PUBLICADO e passa a aparecer;
 *     despublicado, some de novo. É isto que distingue "não vazou" de "o teste
 *     estava olhando para o lugar errado": o mesmo registro, sem mudar mais
 *     nada, aparece e desaparece com a marca.
 *  3. A EMPRESA VIZINHA. Uma segunda empresa com uma linha PUBLICADA. Ela é
 *     pública — só que de outra empresa — e não pode entrar no mapa da vitrine.
 *
 * O CONTROLE NEGATIVO, e por que ele é obrigatório (onda 11, §8)
 * Cada uma das três tem o par: a MESMA consulta sem a defesa. Sem o filtro de
 * `publicadoEm`, o rascunho volta; sem o filtro de `orgId`, a linha da vizinha
 * volta. Se os controles negativos passassem a vir vazios, a suíte estaria
 * verde por não achar nada, e é exatamente esse o teatro que a onda descreve
 * doze vezes.
 *
 * OS DOIS PAPÉIS, e por que os dois importam AQUI
 * Hoje a aplicação conecta como DONA das tabelas. Sob esse papel o isolamento
 * por linha é inerte, e uma página pública que dependesse da policy para não
 * vazar não estaria protegida hoje. Por isso:
 *
 *  · a seção principal roda com a conexão de sempre (`TEST_DATABASE_URL`, dona)
 *    e prova que o CÓDIGO segura — a policy não está ajudando;
 *  · a seção do papel restrito (`TENANT_DATABASE_URL`, opcional) roda a MESMA
 *    coisa com a policy valendo, e prova as duas metades que faltam: que ela não
 *    ajuda a vazar e que ela não QUEBRA a página (policy recorta em silêncio —
 *    uma vitrine vazia em produção não daria erro nenhum).
 *
 * COMO RODAR
 *   TEST_DATABASE_URL='postgresql://mkt:shadow@localhost:55432/marketing_os_test' \
 *     pnpm --filter @mktos/api exec vitest run test/mapa-publico.test.ts
 *
 *   # com o papel restrito (exige a migration aplicada e o papel com senha):
 *   TEST_DATABASE_URL='postgresql://mkt:shadow@localhost:55432/marketing_os_test_rls' \
 *   TENANT_DATABASE_URL='postgresql://mktos_app:<senha>@localhost:55432/marketing_os_test_rls' \
 *     pnpm --filter @mktos/api exec vitest run test/mapa-publico.test.ts
 *
 * A QUARTA TENTATIVA, que entrou depois da revisão: ENVENENAR A LEMBRANÇA.
 * `MapaPublicoService.mapa()` é exportado, e `sobASentinela` só abre a sentinela
 * quando não há empresa resolvida — então uma chamada feita de DENTRO de outra
 * empresa resolve a vitrine sob a policy daquela empresa, não acha, e produz
 * mapa vazio. A primeira versão do serviço GUARDAVA esse vazio, chaveado só pelo
 * slug, e o servia a todo visitante anônimo pelos trinta segundos seguintes: a
 * porta de entrada do produto anunciando que o mapa está fora do ar. A sequência
 * está medida duas vezes — contra um falso que implementa a policy de `Org`
 * letra por letra (roda sempre) e contra o banco com o papel restrito (roda
 * quando há `TENANT_DATABASE_URL`).
 *
 * AVISO: a suíte ESCREVE no banco (cria duas empresas e apaga as próprias
 * linhas). A trava de `banco-de-teste.ts` recusa banco que não se anuncie
 * descartável.
 */

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { comContexto, contextoAtual, novaCorrelacao } from '../src/common/contexto-execucao';
import { comTenantPublico, ehResolucaoPublica } from '../src/common/tenant-publico';
import { comTenantNaSessao } from '../src/prisma/sessao-de-banco';
import type { PrismaService } from '../src/prisma/prisma.service';
import { FONTES_DO_MAPA, fonteConhecida, lerFontes } from '../src/public-map/fontes';
import {
  EIXO_DO_NUCLEO,
  LinhaPublicada,
  PROJECAO,
  SOMENTE_PUBLICADOS,
  TETO_DE_NOS,
  ehCabecaDeEixo,
  mapaVazio,
  montarMapa,
} from '../src/public-map/mapa-publico';
import { MapaPublicoController } from '../src/public-map/mapa-publico.controller';
import {
  MapaPublicoService,
  SLUG_DA_VITRINE_PADRAO,
  slugDaVitrine,
} from '../src/public-map/mapa-publico.service';
import { exigirBancoDescartavel } from './banco-de-teste';

// ---------------------------------------------------------------------------
// Parte pura — roda sempre, sem banco
// ---------------------------------------------------------------------------

function linha(p: Partial<LinhaPublicada> & { eixo: string; chave: string }): LinhaPublicada {
  return {
    ordem: 0,
    rotulo: p.chave,
    detalhe: null,
    tom: 'muted',
    fonte: null,
    ...p,
  };
}

describe('a montagem do mapa', () => {
  it('o centro é a linha nucleo/nucleo, e nada mais entra nesse eixo', () => {
    const mapa = montarMapa(
      [
        linha({ eixo: EIXO_DO_NUCLEO, chave: EIXO_DO_NUCLEO, rotulo: 'ROOT' }),
        linha({ eixo: EIXO_DO_NUCLEO, chave: 'perdida', rotulo: 'ponto sem lugar' }),
      ],
      new Map(),
    );
    expect(mapa.nucleo?.rotulo).toBe('ROOT');
    expect(mapa.eixos).toEqual([]);
    expect(JSON.stringify(mapa)).not.toContain('ponto sem lugar');
  });

  it('a cabeça do eixo dá o nome e a posição, e não vira ponto', () => {
    const mapa = montarMapa(
      [
        linha({ eixo: 'regua', chave: 'regua', ordem: 3, rotulo: 'Régua' }),
        linha({ eixo: 'regua', chave: 'r3', ordem: 1, rotulo: 'R3+ pede gente' }),
        linha({ eixo: 'agentes', chave: 'agentes', ordem: 0, rotulo: 'Agentes' }),
        linha({ eixo: 'agentes', chave: 'a1', ordem: 1, rotulo: 'Em produção' }),
      ],
      new Map(),
    );
    expect(mapa.eixos.map((e) => e.chave)).toEqual(['agentes', 'regua']);
    expect(mapa.eixos.map((e) => e.rotulo)).toEqual(['Agentes', 'Régua']);
    expect(mapa.eixos.flatMap((e) => e.itens.map((i) => i.chave))).toEqual(['a1', 'r3']);
    expect(ehCabecaDeEixo({ eixo: 'regua', chave: 'regua' })).toBe(true);
  });

  it('eixo sem cabeça publicada continua aparecendo, com a chave como nome e no fim', () => {
    const mapa = montarMapa(
      [
        linha({ eixo: 'zz', chave: 'z1' }),
        linha({ eixo: 'agentes', chave: 'agentes', ordem: 0, rotulo: 'Agentes' }),
        linha({ eixo: 'agentes', chave: 'a1' }),
      ],
      new Map(),
    );
    expect(mapa.eixos.map((e) => e.chave)).toEqual(['agentes', 'zz']);
    expect(mapa.eixos[1].rotulo).toBe('zz');
  });

  it('a ordem é determinística: a mesma entrada desenha o mesmo mapa', () => {
    const entrada = [
      linha({ eixo: 'b', chave: 'b', ordem: 1, rotulo: 'B' }),
      linha({ eixo: 'a', chave: 'a', ordem: 1, rotulo: 'A' }),
      linha({ eixo: 'a', chave: 'a2', ordem: 5 }),
      linha({ eixo: 'a', chave: 'a1', ordem: 5 }),
    ];
    const um = montarMapa(entrada, new Map(), new Date(0));
    const outro = montarMapa(entrada, new Map(), new Date(0));
    // Duas montagens da MESMA entrada são byte a byte iguais: é isto que faz o
    // ponto não andar entre dois carregamentos da página.
    expect(JSON.stringify(um)).toBe(JSON.stringify(outro));
    // Empate de `ordem` entre eixos desempata pela chave.
    expect(um.eixos.map((e) => e.chave)).toEqual(['a', 'b']);
    // Dentro do eixo, o empate preserva a ordem que veio do banco — que é a de
    // `ORDENACAO` (eixo, ordem, chave), e não a ordem de chegada do array.
    expect(um.eixos[0].itens.map((i) => i.chave)).toEqual(['a2', 'a1']);
  });

  it('tom desconhecido cai em muted em vez de pintar de nada', () => {
    const mapa = montarMapa([linha({ eixo: 'a', chave: 'x', tom: 'roxo-neon' })], new Map());
    expect(mapa.eixos[0].itens[0].tom).toBe('muted');
  });

  it('o número só entra quando a linha pediu a fonte E ela foi lida', () => {
    const numeros = new Map([['agentes.rodando', 7]]);
    const mapa = montarMapa(
      [
        linha({ eixo: 'a', chave: 'com', fonte: 'agentes.rodando' }),
        linha({ eixo: 'a', chave: 'sem' }),
        linha({ eixo: 'a', chave: 'inexistente', fonte: 'nao.existe' }),
      ],
      numeros,
    );
    const porChave = new Map(mapa.eixos[0].itens.map((i) => [i.chave, i.numero]));
    expect(porChave.get('com')).toBe(7);
    expect(porChave.get('sem')).toBeNull();
    expect(porChave.get('inexistente')).toBeNull();
  });

  it('o teto corta pelo fim da MESMA ordem, nunca por amostragem', () => {
    const muitas = Array.from({ length: TETO_DE_NOS + 10 }, (_, i) =>
      linha({ eixo: 'a', chave: `n${String(i).padStart(3, '0')}`, ordem: i }),
    );
    const mapa = montarMapa(muitas, new Map());
    expect(mapa.eixos[0].itens).toHaveLength(TETO_DE_NOS);
    expect(mapa.eixos[0].itens[0].chave).toBe('n000');
  });

  it('lista vazia devolve mapa vazio — e mapa vazio não inventa nó', () => {
    expect(montarMapa([], new Map()).eixos).toEqual([]);
    expect(mapaVazio().nucleo).toBeNull();
  });
});

describe('o registro fechado de fontes', () => {
  it('toda chave do registro tem descrição e leitura', () => {
    for (const [chave, fonte] of Object.entries(FONTES_DO_MAPA)) {
      expect(fonte.descricao, chave).toBeTruthy();
      expect(typeof fonte.ler, chave).toBe('function');
    }
  });

  it('chave fora do registro nem chega a consultar', async () => {
    const prisma = { agent: { count: vi.fn() } } as unknown as PrismaClient;
    const numeros = await lerFontes(prisma, 'org', ['nao.existe', '__proto__', 'constructor']);
    expect(numeros.size).toBe(0);
    expect(fonteConhecida('nao.existe')).toBe(false);
    // `Object.hasOwn` e não `in`: `'constructor' in obj` é verdadeiro em
    // qualquer objeto, e isso faria uma chave inventada virar fonte.
    expect(fonteConhecida('constructor')).toBe(false);
  });

  it('fonte que estoura deixa o nó sem número e NÃO derruba a página', async () => {
    const prisma = {
      agent: { count: () => Promise.reject(new Error('banco caiu')) },
    } as unknown as PrismaClient;
    const avisos: string[] = [];
    const numeros = await lerFontes(prisma, 'org', ['agentes.rodando'], new Date(), (c) =>
      avisos.push(c),
    );
    expect(numeros.has('agentes.rodando')).toBe(false);
    expect(avisos).toEqual(['agentes.rodando']);
  });

  it('cada fonte devolve NÚMERO — nunca linha, nunca texto', async () => {
    const contar = vi.fn().mockResolvedValue(3);
    const prisma = {
      agent: { count: contar },
      rotina: { count: contar },
      contextItem: { count: contar },
      eventLog: { count: contar },
    } as unknown as PrismaClient;
    const numeros = await lerFontes(prisma, 'org-1', Object.keys(FONTES_DO_MAPA));
    expect(numeros.size).toBe(Object.keys(FONTES_DO_MAPA).length);
    for (const v of numeros.values()) expect(typeof v).toBe('number');
    // E toda consulta filtra a empresa à mão: com a aplicação conectando como
    // dona, uma contagem sem `where` somaria as empresas todas.
    for (const chamada of contar.mock.calls) {
      expect(chamada[0].where.orgId).toBe('org-1');
    }
  });
});

describe('a vitrine é uma, e não vem do pedido', () => {
  it('o slug padrão é constante do código', () => {
    expect(slugDaVitrine({} as NodeJS.ProcessEnv)).toBe(SLUG_DA_VITRINE_PADRAO);
    expect(slugDaVitrine({ MAPA_PUBLICO_ORG_SLUG: 'outra' } as NodeJS.ProcessEnv)).toBe('outra');
    expect(slugDaVitrine({ MAPA_PUBLICO_ORG_SLUG: '  ' } as NodeJS.ProcessEnv)).toBe(
      SLUG_DA_VITRINE_PADRAO,
    );
  });

  it('a rota não aceita parâmetro nenhum — nem de caminho, nem de query', async () => {
    const svc = { mapa: vi.fn().mockResolvedValue(mapaVazio()) };
    const ctrl = new MapaPublicoController(svc as unknown as MapaPublicoService);
    // O método do controller não declara argumento: não há por onde um `:slug`
    // entrar sem alguém mudar esta assinatura, e aí este caso reprova.
    expect(ctrl.mapa.length).toBe(0);
    await ctrl.mapa();
    expect(svc.mapa).toHaveBeenCalledWith();
  });

  it('a resposta NÃO é cacheável: o cabeçalho de correlação viaja nela', () => {
    /*
     * O `ContextoInterceptor` põe `x-correlation-id` em toda resposta, e o valor
     * pode ter vindo do próprio chamador — numa rota anônima. Guardada num cache
     * compartilhado, a resposta passa a servir a correlação de UM visitante a
     * todos os outros; foi o defeito que o avatar da bio pagou e consertou. Aqui
     * o cabeçalho de cache é `no-store`, e este caso fica vermelho no dia em que
     * alguém escrever `public` de novo sem derrubar a correlação antes.
     *
     * `'__headers__'` é `HEADERS_METADATA` do Nest, escrito à mão para não
     * depender de um caminho interno do pacote (`@nestjs/common/constants`).
     */
    const cabecalhos = Reflect.getMetadata('__headers__', MapaPublicoController.prototype.mapa) as
      | Array<{ name: string; value: string }>
      | undefined;
    const cache = cabecalhos?.find((h) => h.name.toLowerCase() === 'cache-control');
    expect(cache?.value).toBe('no-store');
    expect(cache?.value ?? '').not.toMatch(/public|max-age|s-maxage|stale-while-revalidate/);
  });
});

// ---------------------------------------------------------------------------
// A LEMBRANÇA — o veneno de trinta segundos, e a rajada
// ---------------------------------------------------------------------------

/** O que o falso viu: é com isto que se conta consulta. */
interface EspiaoDoBanco {
  resolucoes: number;
  listagens: number;
}

const ORG_DA_VITRINE = 'org-da-vitrine';
const ORG_DA_VIZINHA = 'org-da-vizinha';

/**
 * Um cliente falso que obedece à POLICY DE LEITURA de `Org`, letra por letra:
 *
 *   USING ( app_org_resolvida() AND "id" = app_org_atual()
 *           OR app_resolucao_publica() OR app_plataforma() )
 *
 * É o que torna este caso um controle de verdade e não uma simulação
 * conveniente: a empresa só é encontrada quando quem pergunta está sob a
 * sentinela da resolução pública OU já está DENTRO dela. De dentro de outra
 * empresa, a linha simplesmente não existe — exatamente o que o Postgres faz com
 * o papel restrito, e o que foi medido lá embaixo quando há `TENANT_DATABASE_URL`.
 */
function bancoQueObedeceAPolicy(
  slug: string,
  linhas: LinhaPublicada[],
  espiao: EspiaoDoBanco,
): PrismaService {
  const visivel = () => {
    const ambiente = contextoAtual()?.orgId ?? null;
    return ehResolucaoPublica(ambiente) || ambiente === ORG_DA_VITRINE;
  };

  return {
    org: {
      findUnique: async ({ where }: { where: { slug?: string } }) => {
        espiao.resolucoes += 1;
        if (where.slug !== slug || !visivel()) return null;
        return { id: ORG_DA_VITRINE };
      },
    },
    mapaPublicoItem: {
      findMany: async () => {
        espiao.listagens += 1;
        return linhas;
      },
    },
    agent: { count: async () => 1 },
    rotina: { count: async () => 0 },
    contextItem: { count: async () => 0 },
    eventLog: { count: async () => 0 },
  } as unknown as PrismaService;
}

const SLUG_FALSO = 'vitrine-falsa';
const LINHAS_DO_FALSO = [
  linha({ eixo: EIXO_DO_NUCLEO, chave: EIXO_DO_NUCLEO, rotulo: 'ROOT' }),
  linha({ eixo: 'agentes', chave: 'a1', rotulo: 'Em produção', fonte: 'agentes.rodando' }),
];

/** Roda `fn` como se fosse uma requisição autenticada de OUTRA empresa. */
function comoOutraEmpresa<T>(fn: () => Promise<T>): Promise<T> {
  return comContexto(
    { orgId: ORG_DA_VIZINHA, correlationId: novaCorrelacao('teste'), origem: 'http' },
    fn,
  );
}

describe('a lembrança do mapa', () => {
  it('TENTATIVA 4: uma chamada de dentro de outra empresa não envenena o visitante anônimo', async () => {
    const espiao: EspiaoDoBanco = { resolucoes: 0, listagens: 0 };
    const svc = new MapaPublicoService(
      bancoQueObedeceAPolicy(SLUG_FALSO, LINHAS_DO_FALSO, espiao),
    );
    const t0 = Date.now();

    // 1. O visitante anônimo vê o mapa.
    const antes = await svc.mapa(SLUG_FALSO, new Date(t0));
    expect(antes.nucleo?.rotulo).toBe('ROOT');

    /*
     * 2. A janela de lembrança vira (em produção é o relógio; aqui é explícito,
     *    porque o que importa é o estado FRIO no instante da chamada de dentro
     *    de outra empresa — era assim que o defeito entrava).
     */
    svc.esquecer();

    /*
     * 3. CONTROLE NEGATIVO: a chamada de dentro de outra empresa TEM de sair
     *    vazia. Se ela viesse cheia, o passo 4 estaria verde por não haver
     *    veneno nenhum para resistir — o teatro que a onda 11 descreve.
     */
    const deDentroDeOutra = await comoOutraEmpresa(() => svc.mapa(SLUG_FALSO, new Date(t0 + 1)));
    expect(deDentroDeOutra.nucleo).toBeNull();
    expect(deDentroDeOutra.eixos).toEqual([]);

    /*
     * 4. E o visitante seguinte, DENTRO da mesma janela de trinta segundos,
     *    continua vendo o mapa: o vazio não virou lembrança.
     */
    const depois = await svc.mapa(SLUG_FALSO, new Date(t0 + 2));
    expect(depois.nucleo?.rotulo).toBe('ROOT');
    expect(depois.eixos[0].itens[0].numero).toBe(1);
  });

  it('a lembrança é chaveada pela EMPRESA resolvida, não pelo slug', async () => {
    const espiao: EspiaoDoBanco = { resolucoes: 0, listagens: 0 };
    const svc = new MapaPublicoService(
      bancoQueObedeceAPolicy(SLUG_FALSO, LINHAS_DO_FALSO, espiao),
    );
    const t0 = Date.now();

    await svc.mapa(SLUG_FALSO, new Date(t0));
    // Slug que não existe não encontra a lembrança do outro: ele nem chega a
    // olhar para ela, porque a chave é a empresa que a resolução devolveu.
    const outro = await svc.mapa('slug-que-nao-existe', new Date(t0 + 1));
    expect(outro.nucleo).toBeNull();
    // E a vitrine continua lembrada: o slug desconhecido não derrubou nada.
    const listagensAntes = espiao.listagens;
    const devolta = await svc.mapa(SLUG_FALSO, new Date(t0 + 2));
    expect(devolta.nucleo?.rotulo).toBe('ROOT');
    expect(espiao.listagens).toBe(listagensAntes);
  });

  it('rajada com a memória fria vira UMA ida ao banco, não vinte', async () => {
    /*
     * Memória sozinha segura fila, não rajada: vinte pedidos SIMULTÂNEOS com a
     * memória fria faziam vinte vezes o mesmo trabalho, porque nenhum deles
     * tinha guardado nada ainda quando os outros começaram. O que segura isto é
     * a promessa compartilhada em voo (`UmaVezPorChave`).
     */
    const espiao: EspiaoDoBanco = { resolucoes: 0, listagens: 0 };
    const svc = new MapaPublicoService(
      bancoQueObedeceAPolicy(SLUG_FALSO, LINHAS_DO_FALSO, espiao),
    );
    const agora = new Date();

    const todos = await Promise.all(
      Array.from({ length: 20 }, () => svc.mapa(SLUG_FALSO, agora)),
    );

    expect(todos).toHaveLength(20);
    for (const m of todos) expect(m.nucleo?.rotulo).toBe('ROOT');
    expect(espiao.resolucoes).toBe(1);
    expect(espiao.listagens).toBe(1);
  });

  it('promessa em voo que estoura não fica pendurada envenenando quem chega depois', async () => {
    /*
     * O contrário do caso acima: se a chave não saísse do mapa de promessas no
     * `finally`, o primeiro erro viraria o erro de todo mundo para sempre.
     */
    let vezes = 0;
    const prisma = {
      org: {
        findUnique: async () => {
          vezes += 1;
          if (vezes === 1) throw new Error('banco caiu');
          return { id: ORG_DA_VITRINE };
        },
      },
      mapaPublicoItem: { findMany: async () => [] },
    } as unknown as PrismaService;
    const svc = new MapaPublicoService(prisma);

    await expect(svc.mapa(SLUG_FALSO)).rejects.toThrow('banco caiu');
    // A segunda chamada consulta de novo — e passa.
    expect((await svc.mapa(SLUG_FALSO)).eixos).toEqual([]);
    expect(vezes).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Com banco — a parte que prova por tentativa
// ---------------------------------------------------------------------------

const URL_BANCO = process.env.TEST_DATABASE_URL ?? '';
if (URL_BANCO) exigirBancoDescartavel(URL_BANCO, 'ESCREVE nele (cria duas empresas)');

const URL_RESTRITO = process.env.TENANT_DATABASE_URL ?? '';

vi.setConfig({ hookTimeout: 120_000, testTimeout: 30_000 });

const MARCA = `mp65${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toLowerCase();
const SLUG_VITRINE = `vitrine-${MARCA}`;
const SLUG_VIZINHA = `vizinha-${MARCA}`;

/** O texto que não pode existir na resposta. Único, para busca por substring. */
const SEGREDO_DO_RASCUNHO = `RASCUNHO-NAO-PUBLICADO-${MARCA}`;
const SEGREDO_DA_VIZINHA = `PUBLICADO-EM-OUTRA-EMPRESA-${MARCA}`;

interface Semeado {
  orgVitrine: string;
  orgVizinha: string;
  idDoRascunho: string;
}

/** O cliente da aplicação: sessão de banco em `impor`, como em produção amanhã. */
function clienteDaAplicacao(url: string): PrismaService {
  const cru = new PrismaClient({ datasourceUrl: url });
  return comTenantNaSessao(cru, { modo: 'impor' }) as unknown as PrismaService;
}

async function semear(admin: PrismaClient): Promise<Semeado> {
  const vitrine = await admin.org.create({
    data: { name: `Vitrine ${MARCA}`, slug: SLUG_VITRINE, modulos: [] },
  });
  const vizinha = await admin.org.create({
    data: { name: `Vizinha ${MARCA}`, slug: SLUG_VIZINHA, modulos: [] },
  });

  const agora = new Date();
  await admin.mapaPublicoItem.createMany({
    data: [
      {
        orgId: vitrine.id,
        eixo: 'nucleo',
        chave: 'nucleo',
        ordem: 0,
        rotulo: 'ROOT',
        detalhe: 'a operação que roda no próprio sistema',
        tom: 'brand',
        publicadoEm: agora,
        publicadoPor: 'teste',
      },
      {
        orgId: vitrine.id,
        eixo: 'agentes',
        chave: 'agentes',
        ordem: 0,
        rotulo: 'Agentes',
        tom: 'muted',
        publicadoEm: agora,
        publicadoPor: 'teste',
      },
      {
        orgId: vitrine.id,
        eixo: 'agentes',
        chave: 'agentes-rodando',
        ordem: 1,
        rotulo: 'Em produção',
        tom: 'good',
        fonte: 'agentes.rodando',
        publicadoEm: agora,
        publicadoPor: 'teste',
      },
      /*
       * O RASCUNHO. Mesma empresa, mesmo eixo, ordem no meio das publicadas: ele
       * está exatamente em cima da consulta. O que o segura é `publicadoEm`.
       */
      {
        orgId: vitrine.id,
        eixo: 'agentes',
        chave: 'rascunho',
        ordem: 2,
        rotulo: SEGREDO_DO_RASCUNHO,
        detalhe: SEGREDO_DO_RASCUNHO,
        tom: 'bad',
        publicadoEm: null,
      },
      /* A vizinha: PUBLICADA, e de outra empresa. */
      {
        orgId: vizinha.id,
        eixo: 'agentes',
        chave: 'da-vizinha',
        ordem: 0,
        rotulo: SEGREDO_DA_VIZINHA,
        tom: 'good',
        publicadoEm: agora,
        publicadoPor: 'teste',
      },
    ],
  });

  const rascunho = await admin.mapaPublicoItem.findFirstOrThrow({
    where: { orgId: vitrine.id, chave: 'rascunho' },
    select: { id: true },
  });

  return { orgVitrine: vitrine.id, orgVizinha: vizinha.id, idDoRascunho: rascunho.id };
}

async function limpar(admin: PrismaClient, ids: Semeado | null): Promise<void> {
  if (!ids) return;
  await admin.mapaPublicoItem.deleteMany({
    where: { orgId: { in: [ids.orgVitrine, ids.orgVizinha] } },
  });
  await admin.org.deleteMany({ where: { id: { in: [ids.orgVitrine, ids.orgVizinha] } } });
}

describe.skipIf(!URL_BANCO)('a rota pública, com a conexão DONA (isolamento inerte)', () => {
  let admin: PrismaClient;
  let app: PrismaService;
  let svc: MapaPublicoService;
  let ids: Semeado | null = null;

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: URL_BANCO });
    ids = await semear(admin);
    app = clienteDaAplicacao(URL_BANCO);
    svc = new MapaPublicoService(app);
  });

  afterAll(async () => {
    await limpar(admin, ids);
    await admin.$disconnect();
  });

  /** O mapa recém-montado — a memória curta do serviço não pode mascarar nada. */
  async function mapaAgora() {
    svc.esquecer();
    return svc.mapa(SLUG_VITRINE);
  }

  it('a página mostra o que foi publicado', async () => {
    const mapa = await mapaAgora();
    expect(mapa.nucleo?.rotulo).toBe('ROOT');
    expect(mapa.eixos.map((e) => e.chave)).toEqual(['agentes']);
    expect(mapa.eixos[0].itens.map((i) => i.chave)).toEqual(['agentes-rodando']);
    // A fonte foi lida de verdade: zero agentes nesta empresa é um número.
    expect(mapa.eixos[0].itens[0].numero).toBe(0);
  });

  it('TENTATIVA 1: o rascunho não aparece em lugar nenhum da resposta', async () => {
    const mapa = await mapaAgora();
    expect(JSON.stringify(mapa)).not.toContain(SEGREDO_DO_RASCUNHO);
  });

  it('CONTROLE NEGATIVO 1: sem o filtro de publicação, o rascunho VOLTA', async () => {
    /*
     * A MESMA consulta da rota, com `publicadoEm` fora do `where`. Se este caso
     * ficar verde por não achar o rascunho, o de cima estava provando nada — o
     * registro não estaria no caminho da consulta.
     */
    const semFiltro = await admin.mapaPublicoItem.findMany({
      where: { orgId: ids!.orgVitrine },
      select: PROJECAO,
    });
    expect(semFiltro.map((l) => l.rotulo)).toContain(SEGREDO_DO_RASCUNHO);

    const comFiltro = await admin.mapaPublicoItem.findMany({
      where: SOMENTE_PUBLICADOS(ids!.orgVitrine),
      select: PROJECAO,
    });
    expect(comFiltro.map((l) => l.rotulo)).not.toContain(SEGREDO_DO_RASCUNHO);
  });

  it('TENTATIVA 2: o MESMO registro aparece ao ser publicado e some ao ser despublicado', async () => {
    const antes = await mapaAgora();
    expect(JSON.stringify(antes)).not.toContain(SEGREDO_DO_RASCUNHO);

    await admin.mapaPublicoItem.update({
      where: { id: ids!.idDoRascunho },
      data: { publicadoEm: new Date(), publicadoPor: 'teste' },
    });
    const durante = await mapaAgora();
    expect(JSON.stringify(durante)).toContain(SEGREDO_DO_RASCUNHO);

    await admin.mapaPublicoItem.update({
      where: { id: ids!.idDoRascunho },
      data: { publicadoEm: null, publicadoPor: null },
    });
    const depois = await mapaAgora();
    expect(JSON.stringify(depois)).not.toContain(SEGREDO_DO_RASCUNHO);
  });

  it('TENTATIVA 3: linha publicada de OUTRA empresa não entra na vitrine', async () => {
    const mapa = await mapaAgora();
    expect(JSON.stringify(mapa)).not.toContain(SEGREDO_DA_VIZINHA);
  });

  it('CONTROLE NEGATIVO 3: sem o filtro de empresa, a linha da vizinha VOLTA', async () => {
    const semEmpresa = await admin.mapaPublicoItem.findMany({
      where: { publicadoEm: { not: null }, rotulo: { contains: MARCA } },
      select: PROJECAO,
    });
    expect(semEmpresa.map((l) => l.rotulo)).toContain(SEGREDO_DA_VIZINHA);
  });

  it('a resposta não carrega NADA da Org — nem nome, nem slug, nem id', async () => {
    const corpo = JSON.stringify(await mapaAgora());
    expect(corpo).not.toContain(`Vitrine ${MARCA}`);
    expect(corpo).not.toContain(SLUG_VITRINE);
    expect(corpo).not.toContain(ids!.orgVitrine);
  });

  it('vitrine inexistente devolve mapa vazio, não derruba a entrada do domínio', async () => {
    svc.esquecer();
    const mapa = await svc.mapa(`nao-existe-${MARCA}`);
    expect(mapa.nucleo).toBeNull();
    expect(mapa.eixos).toEqual([]);
  });

  it('a memória curta expira — publicar aparece sem reiniciar a API', async () => {
    const t0 = new Date();
    svc.esquecer();
    await svc.mapa(SLUG_VITRINE, t0);
    await admin.mapaPublicoItem.update({
      where: { id: ids!.idDoRascunho },
      data: { publicadoEm: new Date(), publicadoPor: 'teste' },
    });
    // Ainda dentro da validade: a resposta é a lembrada.
    const lembrado = await svc.mapa(SLUG_VITRINE, new Date(t0.getTime() + 1_000));
    expect(JSON.stringify(lembrado)).not.toContain(SEGREDO_DO_RASCUNHO);
    // Passada a validade, o banco manda de novo.
    const fresco = await svc.mapa(SLUG_VITRINE, new Date(t0.getTime() + 60_000));
    expect(JSON.stringify(fresco)).toContain(SEGREDO_DO_RASCUNHO);

    await admin.mapaPublicoItem.update({
      where: { id: ids!.idDoRascunho },
      data: { publicadoEm: null, publicadoPor: null },
    });
  });

  it('as QUATRO fontes rodam contra o esquema REAL — coluna renomeada fica vermelha AQUI', async () => {
    /*
     * Por que este caso precisa existir. Falha de fonte é ENGOLIDA de propósito
     * (`lerFontes` chama `aoFalhar` e o nó sai sem número, para que um `count`
     * quebrado não derrube a porta de entrada do domínio). O preço disso é que
     * uma consulta inválida — coluna renomeada, modelo removido, enum mudado —
     * não aparece em lugar nenhum: a página fica sem número e a suíte, verde.
     *
     * Os casos da parte pura rodam contra objeto falso: eles provam o CONTRATO
     * (número, nunca linha; `orgId` sempre no `where`), não que a consulta
     * exista no banco. Este roda as quatro contra o esquema de verdade e cobra
     * ZERO falhas — é o único lugar em que renomear uma coluna fica vermelho.
     */
    const falhas: string[] = [];
    const numeros = await comTenantPublico(ids!.orgVitrine, () =>
      lerFontes(app, ids!.orgVitrine, Object.keys(FONTES_DO_MAPA), new Date(), (chave, erro) =>
        falhas.push(`${chave}: ${String(erro)}`),
      ),
    );

    expect(falhas).toEqual([]);
    expect([...numeros.keys()].sort()).toEqual(Object.keys(FONTES_DO_MAPA).sort());
    for (const [chave, valor] of numeros) {
      expect(Number.isInteger(valor), chave).toBe(true);
      expect(valor, chave).toBeGreaterThanOrEqual(0);
    }
  });

  it('a consulta da rota roda DENTRO da empresa resolvida, e não sob a sentinela', async () => {
    /*
     * O gancho da sessão de banco está em `impor`: consulta sem empresa
     * resolvida LANÇA. Chamar a rota de dentro de um contexto já aberto e SEM
     * empresa é o jeito de provar que quem resolve é a rota, e não o chamador.
     */
    await comContexto(
      { orgId: null, correlationId: novaCorrelacao('teste'), origem: 'http' },
      async () => {
        svc.esquecer();
        const mapa = await svc.mapa(SLUG_VITRINE);
        expect(mapa.nucleo?.rotulo).toBe('ROOT');
      },
    );
  });
});

/*
 * A SEÇÃO DO PAPEL RESTRITO — a policy valendo de verdade.
 *
 * `describe.skipIf(true)` COLETA os casos e os marca como pulados, o que
 * atrapalha o piso de quantidade da CI; por isso a seção só EXISTE quando há
 * conexão restrita, exatamente como em `rotas-publicas-tenant.test.ts`.
 *
 * Ela NÃO liga nem desliga RLS: `MapaPublicoItem` nasce com `ENABLE` + `FORCE`
 * e as duas políticas na própria migration. O que muda aqui é o PAPEL de quem lê.
 */
function descreverSeHouverPapelRestrito(titulo: string, corpo: () => void): void {
  if (URL_BANCO && URL_RESTRITO) describe(titulo, corpo);
}

descreverSeHouverPapelRestrito(
  'a rota pública, com o papel RESTRITO (a policy de linha valendo)',
  () => {
    let admin: PrismaClient;
    let svc: MapaPublicoService;
    let ids: Semeado | null = null;

    beforeAll(async () => {
      admin = new PrismaClient({ datasourceUrl: URL_BANCO });
      ids = await semear(admin);
      svc = new MapaPublicoService(clienteDaAplicacao(URL_RESTRITO));
    });

    afterAll(async () => {
      await limpar(admin, ids);
      await admin.$disconnect();
    });

    it('a página CONTINUA de pé — policy que recorta demais seria uma vitrine vazia sem erro', async () => {
      svc.esquecer();
      const mapa = await svc.mapa(SLUG_VITRINE);
      expect(mapa.nucleo?.rotulo).toBe('ROOT');
      expect(mapa.eixos[0].itens.map((i) => i.chave)).toEqual(['agentes-rodando']);
    });

    it('o rascunho continua não aparecendo — e aqui quem o segura é o código, não a policy', async () => {
      svc.esquecer();
      expect(JSON.stringify(await svc.mapa(SLUG_VITRINE))).not.toContain(SEGREDO_DO_RASCUNHO);
    });

    it('a linha publicada da vizinha continua fora', async () => {
      svc.esquecer();
      expect(JSON.stringify(await svc.mapa(SLUG_VITRINE))).not.toContain(SEGREDO_DA_VIZINHA);
    });

    it('TENTATIVA 4: chamada de dentro de OUTRA empresa não envenena a lembrança do anônimo', async () => {
      /*
       * A sequência inteira, com a policy valendo de verdade — é ela que produz
       * o veneno. `sobASentinela` só abre a sentinela quando NÃO há empresa
       * resolvida; dentro do contexto da vizinha, a resolução da vitrine roda
       * sob a policy da vizinha e não acha. A primeira versão do serviço
       * guardava esse vazio chaveado pelo SLUG e o servia a todo visitante
       * anônimo pelos trinta segundos seguintes.
       */
      svc.esquecer();
      expect((await svc.mapa(SLUG_VITRINE)).nucleo?.rotulo).toBe('ROOT');

      // A janela vira: o que importa é o estado FRIO no instante da chamada de
      // dentro da outra empresa — era assim que o defeito entrava.
      svc.esquecer();

      /*
       * CONTROLE NEGATIVO: de dentro da vizinha o mapa TEM de sair vazio. Se
       * viesse cheio, a policy não estaria mordendo e o caso seguinte estaria
       * verde por não haver veneno nenhum para resistir.
       */
      const deDentroDaVizinha = await comContexto(
        { orgId: ids!.orgVizinha, correlationId: novaCorrelacao('teste'), origem: 'http' },
        () => svc.mapa(SLUG_VITRINE),
      );
      expect(deDentroDaVizinha.nucleo).toBeNull();
      expect(deDentroDaVizinha.eixos).toEqual([]);

      // E o visitante anônimo seguinte, dentro da mesma janela, vê o mapa.
      const depois = await svc.mapa(SLUG_VITRINE);
      expect(depois.nucleo?.rotulo).toBe('ROOT');
      expect(depois.eixos[0].itens.map((i) => i.chave)).toEqual(['agentes-rodando']);
    });

    it('a policy MORDE: fora do contexto da empresa, o papel restrito não lê linha nenhuma', async () => {
      /*
       * O controle negativo desta seção. Se este caso achasse linha, a policy
       * não estaria valendo para esta conexão — e os três casos acima estariam
       * verdes por outro motivo que não o que eles dizem provar.
       */
      const restrito = new PrismaClient({ datasourceUrl: URL_RESTRITO });
      try {
        const semEmpresa = await restrito.$queryRawUnsafe<Array<{ n: bigint }>>(
          'SELECT count(*)::bigint AS n FROM "MapaPublicoItem"',
        );
        expect(Number(semEmpresa[0].n)).toBe(0);

        const comEmpresa = await restrito.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, true)`, ids!.orgVitrine);
          return tx.$queryRawUnsafe<Array<{ n: bigint }>>(
            'SELECT count(*)::bigint AS n FROM "MapaPublicoItem"',
          );
        });
        // Quatro linhas da vitrine (três publicadas e o rascunho) e nenhuma da
        // vizinha: a policy recorta por empresa, e é o CÓDIGO que tira o rascunho.
        expect(Number(comEmpresa[0].n)).toBe(4);
      } finally {
        await restrito.$disconnect();
      }
    });

    it('a sentinela pública NÃO alcança esta tabela — ela só resolve endereço', async () => {
      const restrito = new PrismaClient({ datasourceUrl: URL_RESTRITO });
      try {
        const sobASentinela = await restrito.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `SELECT set_config('app.org_id', '__resolucao_publica__', true)`,
          );
          return tx.$queryRawUnsafe<Array<{ n: bigint }>>(
            'SELECT count(*)::bigint AS n FROM "MapaPublicoItem"',
          );
        });
        expect(Number(sobASentinela[0].n)).toBe(0);
      } finally {
        await restrito.$disconnect();
      }
    });
  },
);
