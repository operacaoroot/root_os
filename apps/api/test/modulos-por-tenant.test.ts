/**
 * MÓDULOS HABILITÁVEIS POR EMPRESA — RF-T-06
 * ==========================================
 *
 * `bio`, `pauta`, `financeiro`, `leads` e o resto são produto INTERNO da ROOT.
 * Um tenant cliente não pode ver nem a navegação do que não contratou.
 *
 * A fatia tem DOIS critérios, e o segundo é o que se esquece:
 *
 *   1. tenant com módulo desligado recebe 404 na rota e não vê o item no menu;
 *   2. NENHUMA ROTA FICA INALCANÇÁVEL POR ENGANO.
 *
 * Provar (1) é fácil: um caso com um módulo desligado. Provar (2) exige
 * percorrer o sistema inteiro, porque o acidente que ela descreve é silencioso —
 * um prefixo a mais na tabela de rotas transforma uma tela viva em 404 para todo
 * mundo, e ninguém descobre até um cliente reclamar. Por isso este arquivo
 * VARRE o código-fonte atrás dos `@Controller()` e exercita a decisão do gate
 * contra TODAS as rotas encontradas (198 na escrita desta suíte), em vez de
 * conferir uma lista escrita à mão que envelheceria na primeira rota nova.
 *
 * POR QUE NÃO SOBE A APLICAÇÃO
 * Nada que dependa de injeção do Nest funciona sob vitest (o esbuild não emite
 * `emitDecoratorMetadata`). E não faria falta: a decisão do gate mora numa
 * função pura (`src/tenants/modulos.ts`), justamente para poder ser interrogada
 * 198 vezes sem subir servidor. O que o interceptor acrescenta em cima dela — o
 * 404, a liberação da rota pública, o cache — está descrito no arquivo dele e o
 * que precisa de banco está na última seção daqui.
 *
 * COMO RODAR A PARTE DE BANCO (opcional; sem ela a seção se pula sozinha):
 *   TEST_DATABASE_URL='postgresql://mkt:shadow@localhost:55432/marketing_os_test' \
 *     npx vitest run test/modulos-por-tenant.test.ts
 *
 * O BANCO É O MESMO DAS OUTRAS — `marketing_os_test` (inventário em
 * `test/banco-de-teste.ts`). O pedido de banco PRÓPRIO que estava aqui não
 * correspondia à realidade: a CI e o `pnpm test` rodam os 13 arquivos em
 * paralelo num banco só. Esta suíte cria e apaga empresas, e é por isso que ela
 * limpa pelos ids que criou — não por ter banco reservado.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  NotFoundException,
  UnauthorizedException,
  type CallHandler,
  type ExecutionContext,
} from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';

import {
  MODULO_POR_PREFIXO,
  PREFIXOS_DA_ESPINHA,
  PREFIXOS_POR_MODULO,
  PrefixoNaoDeclaradoError,
  caminhoLiberado,
  moduloDoCaminho,
  modulosConhecidos,
  segmentoDaApi,
} from '../src/tenants/modulos';
import { ModulosService } from '../src/tenants/modulos.service';
import { ModulosInterceptor } from '../src/tenants/modulos.interceptor';
import { ModulosController } from '../src/tenants/modulos.controller';
import type { JwtUser } from '../src/auth/current-user.decorator';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * A navegação vem do ARQUIVO-FONTE, não de `@mktos/shared`.
 *
 * O pacote resolve para `dist/`, que é artefato de build ignorado pelo git: uma
 * suíte que o consulte está validando o último `pnpm build` de alguém, não o
 * código que vai ser commitado. Aqui o `.ts` é lido direto — o único import de
 * `nav.ts` é `import type`, que o esbuild apaga, então não há cadeia a resolver.
 */
import {
  MODULOS,
  NAV,
  ROTAS_ABSORVIDAS,
  SECOES,
  moduloDaRotaDoWeb,
  navPorSecao,
  type NavItem,
} from '../../../packages/shared/src/nav';

// ---------------------------------------------------------------------------
// Inventário de rotas — lido do código-fonte
// ---------------------------------------------------------------------------

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

const RAIZ = acharRaizDaApi();

function arquivosDeControlador(dir: string, achados: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entrada.name);
    if (entrada.isDirectory()) arquivosDeControlador(p, achados);
    else if (entrada.name.endsWith('.controller.ts')) achados.push(p);
  }
  return achados;
}

interface RotaDaApi {
  /** Caminho completo, como o Express o veria: `/api/bio/paginas`. */
  caminho: string;
  metodo: string;
  arquivo: string;
}

const DECORADOR_DE_CONTROLLER = /@Controller\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)?\s*\)/;
const DECORADOR_DE_ROTA =
  /@(Get|Post|Put|Patch|Delete|All|Head|Options)\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)?\s*\)/g;

/**
 * Todas as rotas HTTP da API, lidas dos decoradores.
 *
 * Regex e não AST de propósito: a forma dos decoradores aqui é uniforme
 * (literal de string ou vazio, nunca expressão calculada) e uma dependência
 * nova para analisar TypeScript é decisão humana (02-CONSTRAINTS). Se um dia
 * alguém escrever `@Controller(PREFIXO)`, o prefixo sai como vazio e a rota cai
 * na raiz — que é o caso de `agents` e `users` hoje, e está coberto.
 */
function rotasDaApi(): RotaDaApi[] {
  const rotas: RotaDaApi[] = [];
  for (const arquivo of arquivosDeControlador(path.join(RAIZ, 'src'))) {
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
        arquivo: path.relative(RAIZ, arquivo),
      });
    }
  }
  return rotas;
}

const ROTAS = rotasDaApi();

/** O primeiro segmento depois de `/api` — o prefixo que o gate consulta. */
function prefixoDe(caminho: string): string {
  return segmentoDaApi(caminho)?.cru ?? '';
}

const PREFIXOS_ENCONTRADOS = [...new Set(ROTAS.map((r) => prefixoDe(r.caminho)))].sort();
const TODOS_LIGADOS = new Set<string>(MODULOS);

// ---------------------------------------------------------------------------
// 1. O inventário existe e é plausível
// ---------------------------------------------------------------------------

describe('inventário de rotas da API', () => {
  it('acha as rotas (piso de quantidade: varredura vazia passaria em tudo)', () => {
    // Sem este piso, um regex quebrado devolveria zero rotas e TODOS os casos
    // abaixo passariam vazios — verde em silêncio, que é como catraca morre.
    expect(ROTAS.length).toBeGreaterThan(150);
    expect(PREFIXOS_ENCONTRADOS.length).toBeGreaterThan(20);
  });

  it('toda rota tem prefixo não vazio', () => {
    const sem = ROTAS.filter((r) => prefixoDe(r.caminho) === '');
    expect(sem.map((r) => `${r.metodo} ${r.caminho} (${r.arquivo})`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Todo prefixo está DECLARADO — de um lado ou do outro
// ---------------------------------------------------------------------------

describe('nenhuma rota fica sem declaração', () => {
  it('todo prefixo do código está em MODULO_POR_PREFIXO ou em PREFIXOS_DA_ESPINHA', () => {
    const naoDeclarados: string[] = [];
    for (const prefixo of PREFIXOS_ENCONTRADOS) {
      try {
        moduloDoCaminho(`/api/${prefixo}/x`);
      } catch (e) {
        if (e instanceof PrefixoNaoDeclaradoError) naoDeclarados.push(prefixo);
        else throw e;
      }
    }
    // Falhou aqui? Um controller novo entrou. Decida, por escrito, em
    // src/tenants/modulos.ts: é espinha do OS ou é módulo de domínio?
    expect(naoDeclarados).toEqual([]);
  });

  it('nenhum prefixo declarado é fantasma — todos existem no código', () => {
    const declarados = [...Object.keys(MODULO_POR_PREFIXO), ...PREFIXOS_DA_ESPINHA];
    const encontrados = new Set(PREFIXOS_ENCONTRADOS);
    // Prefixo declarado que não existe mais é gate apontando para o vazio: se
    // alguém recriar aquele controller com outro sentido, ele nasce gateado
    // pelo módulo errado.
    expect(declarados.filter((p) => !encontrados.has(p))).toEqual([]);
  });

  it('um prefixo nunca é módulo E espinha ao mesmo tempo', () => {
    const dosDois = Object.keys(MODULO_POR_PREFIXO).filter((p) =>
      (PREFIXOS_DA_ESPINHA as readonly string[]).includes(p),
    );
    expect(dosDois).toEqual([]);
  });

  it('todo módulo governa pelo menos um prefixo de rota', () => {
    // Módulo sem rota é item de menu que esconde sem a API recusar: fachada.
    const semRota = MODULOS.filter((m) => PREFIXOS_POR_MODULO[m].length === 0);
    expect(semRota).toEqual([]);
  });

  it('todo prefixo mapeado aponta para um módulo que existe em MODULOS', () => {
    const forasteiros = Object.entries(MODULO_POR_PREFIXO)
      .filter(([, m]) => !(MODULOS as readonly string[]).includes(m))
      .map(([p, m]) => `${p} -> ${m}`);
    expect(forasteiros).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. O tenant da ROOT (tudo ligado) alcança 100% das rotas
// ---------------------------------------------------------------------------

describe('tenant com tudo habilitado', () => {
  it('alcança TODAS as rotas da API — nenhuma fica inalcançável', () => {
    const bloqueadas = ROTAS.filter((r) => !caminhoLiberado(r.caminho, TODOS_LIGADOS)).map(
      (r) => `${r.metodo} ${r.caminho}`,
    );
    expect(bloqueadas).toEqual([]);
  });

  it('vê o menu inteiro: filtrar por todos os módulos é igual a não filtrar', () => {
    const perms = NAV.map((n) => n.permission);
    const comFiltro = navPorSecao(perms, MODULOS);
    const semFiltro = navPorSecao(perms);
    expect(chaves(comFiltro)).toEqual(chaves(semFiltro));
    expect(chaves(comFiltro).length).toBe(NAV.length);
  });
});

// ---------------------------------------------------------------------------
// 4. O tenant recém-nascido (nenhum módulo) continua com a espinha inteira
// ---------------------------------------------------------------------------

describe('tenant novo, sem módulo nenhum', () => {
  const NENHUM = new Set<string>();

  it('a espinha do OS continua toda alcançável', () => {
    const daEspinha = ROTAS.filter((r) =>
      (PREFIXOS_DA_ESPINHA as readonly string[]).includes(prefixoDe(r.caminho)),
    );
    expect(daEspinha.length).toBeGreaterThan(20);
    const bloqueadas = daEspinha.filter((r) => !caminhoLiberado(r.caminho, NENHUM));
    expect(bloqueadas.map((r) => r.caminho)).toEqual([]);
  });

  it('a rota que responde "quais módulos eu tenho" NÃO é bloqueável', () => {
    // Se ela fosse gateada, um tenant sem módulos não conseguiria nem descobrir
    // que não tem módulos — o web ficaria em "não sei" para sempre.
    expect(moduloDoCaminho('/api/tenants/modulos')).toBeNull();
    expect(caminhoLiberado('/api/tenants/modulos', NENHUM)).toBe(true);
  });

  it('toda rota de módulo é recusada', () => {
    const deModulo = ROTAS.filter((r) => MODULO_POR_PREFIXO[prefixoDe(r.caminho)] !== undefined);
    const liberadas = deModulo.filter((r) => caminhoLiberado(r.caminho, NENHUM));
    expect(liberadas.map((r) => r.caminho)).toEqual([]);
  });

  it('o menu sobra só com a espinha, e nenhuma seção do OS some', () => {
    const perms = NAV.map((n) => n.permission);
    const grupos = navPorSecao(perms, []);
    const itens = grupos.flatMap((g) => g.itens);
    expect(itens.every((n) => n.modulo === undefined)).toBe(true);
    // As quatro seções do tipo 'os' mais 'A conta' continuam de pé.
    const secoesOs = SECOES.filter((s) => s.tipo === 'os').map((s) => s.key);
    expect(grupos.map((g) => g.secao.key)).toEqual(secoesOs);
  });
});

// ---------------------------------------------------------------------------
// 5. O bloqueio é CIRÚRGICO — desligar um módulo não derruba o vizinho
// ---------------------------------------------------------------------------

describe('desligar um módulo de cada vez', () => {
  for (const modulo of MODULOS) {
    describe(`sem "${modulo}"`, () => {
      const ligados = new Set<string>(MODULOS.filter((m) => m !== modulo));
      const meusPrefixos = new Set(PREFIXOS_POR_MODULO[modulo]);

      it('bloqueia pelo menos uma rota (senão esconder no menu é fachada)', () => {
        const bloqueadas = ROTAS.filter((r) => !caminhoLiberado(r.caminho, ligados));
        expect(bloqueadas.length).toBeGreaterThan(0);
      });

      it('bloqueia EXATAMENTE as rotas dos prefixos dele', () => {
        const esperadas = ROTAS.filter((r) => meusPrefixos.has(prefixoDe(r.caminho)))
          .map((r) => r.caminho)
          .sort();
        const bloqueadas = ROTAS.filter((r) => !caminhoLiberado(r.caminho, ligados))
          .map((r) => r.caminho)
          .sort();
        expect(bloqueadas).toEqual(esperadas);
      });

      it('esconde EXATAMENTE os itens de menu dele', () => {
        const perms = NAV.map((n) => n.permission);
        const antes = new Set(chaves(navPorSecao(perms, MODULOS)));
        const depois = new Set(chaves(navPorSecao(perms, [...ligados])));
        const sumiram = [...antes].filter((k) => !depois.has(k)).sort();
        const esperados = NAV.filter((n) => n.modulo === modulo)
          .map((n) => n.key)
          .sort();
        expect(sumiram).toEqual(esperados);
      });

      it('a espinha do OS não se mexe', () => {
        const perms = NAV.map((n) => n.permission);
        const daEspinha = (itens: NavItem[]) => itens.filter((n) => !n.modulo).map((n) => n.key);
        expect(daEspinha(navPorSecao(perms, [...ligados]).flatMap((g) => g.itens))).toEqual(
          daEspinha(NAV),
        );
      });
    });
  }
});

// ---------------------------------------------------------------------------
// 6. O menu e a API falam do mesmo conjunto
// ---------------------------------------------------------------------------

describe('menu e API concordam', () => {
  it('todo módulo do catálogo aparece em pelo menos um item do menu', () => {
    const noMenu = new Set(NAV.map((n) => n.modulo).filter(Boolean));
    expect(MODULOS.filter((m) => !noMenu.has(m))).toEqual([]);
  });

  it('todo módulo citado no menu existe no catálogo', () => {
    const citados = [...new Set(NAV.map((n) => n.modulo).filter(Boolean))] as string[];
    expect(citados.filter((m) => !(MODULOS as readonly string[]).includes(m))).toEqual([]);
  });

  it('cada item de menu resolve para o próprio módulo pelo href', () => {
    const erradas = NAV.filter((n) => moduloDaRotaDoWeb(n.href) !== (n.modulo ?? null)).map(
      (n) => `${n.href}: esperava ${n.modulo ?? 'espinha'}, veio ${moduloDaRotaDoWeb(n.href)}`,
    );
    expect(erradas).toEqual([]);
  });

  it('página que saiu do menu e continua viva NÃO é bloqueada', () => {
    /*
     * `/vendas` (manual do pixel + demo) e `/google` (destino do callback
     * OAuth) estão em ROTAS_ABSORVIDAS: sumiram do menu e seguem no ar. Como
     * não estão no NAV, não têm módulo declarado e nunca são bloqueadas.
     * É a decisão registrada, não um esquecimento: bloquear uma delas por
     * parentesco ("`/vendas` cheira a pixels") seria adivinhar, e adivinhar
     * errado aqui derruba o callback do Google — que é espinha.
     */
    for (const { href } of ROTAS_ABSORVIDAS) {
      expect(moduloDaRotaDoWeb(href), `${href} não pode nascer bloqueada`).toBeNull();
    }
  });

  it('subrota herda o módulo do pai, e rota desconhecida não é bloqueada', () => {
    expect(moduloDaRotaDoWeb('/leads/abc-123')).toBe('leads');
    expect(moduloDaRotaDoWeb('/campanhas/9/insights')).toBe('campanhas');
    expect(moduloDaRotaDoWeb('/painel')).toBeNull();
    // O placeholder de app/[...slug]/page.tsx e qualquer tela nova: nunca
    // nascem mortas por causa do gate.
    expect(moduloDaRotaDoWeb('/tela-que-ainda-nao-existe')).toBeNull();
    expect(moduloDaRotaDoWeb('/')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. O reconhecimento do caminho não se deixa enganar
// ---------------------------------------------------------------------------

describe('reconhecimento do prefixo', () => {
  it('ignora caixa — o Express casa rota sem diferenciar maiúscula', () => {
    expect(moduloDoCaminho('/api/BIO/paginas')).toBe('bio');
    expect(moduloDoCaminho('/api/Finance/contas')).toBe('financeiro');
  });

  it('ignora query, fragmento e barra sobrando', () => {
    expect(moduloDoCaminho('/api/events/summary?days=7')).toBe('pixels');
    expect(moduloDoCaminho('//api//goals//panel/')).toBe('metas');
    expect(moduloDoCaminho('/api/pauta#x')).toBe('pauta');
  });

  it('enxerga o prefixo percent-encodado', () => {
    expect(moduloDoCaminho('/api/%62io/paginas')).toBe('bio');
  });

  it('caminho sem segmento não é de módulo nenhum', () => {
    expect(segmentoDaApi('/api')).toBeNull();
    expect(moduloDoCaminho('/api')).toBeNull();
    expect(moduloDoCaminho('/')).toBeNull();
  });

  it('prefixo desconhecido LANÇA em vez de adivinhar', () => {
    expect(() => moduloDoCaminho('/api/inventado/x')).toThrow(PrefixoNaoDeclaradoError);
  });
});

// ---------------------------------------------------------------------------
// 8. Lixo gravado no banco não vira permissão
// ---------------------------------------------------------------------------

describe('valores desconhecidos', () => {
  it('são descartados, e na ordem canônica', () => {
    expect(modulosConhecidos(['xyz', 'bio', 'leads', 'xyz'])).toEqual(['leads', 'bio']);
  });

  it('não liberam rota nenhuma', () => {
    expect(caminhoLiberado('/api/bio/paginas', ['xyz', 'admin', '*'])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9. O interceptor — o 404, a rota pública e o prefixo não declarado
// ---------------------------------------------------------------------------

/**
 * Um `ExecutionContext` de mentira, com o mínimo que o interceptor consulta.
 *
 * Subir o Nest de verdade não é opção aqui (o esbuild não emite
 * `emitDecoratorMetadata`, então injeção não funciona sob vitest — ver o
 * cabeçalho). O que sobra é instanciar a classe à mão, que é exatamente o que
 * `contexto-aprovacao.test.ts` faz com a porta e os serviços de política.
 */
function contextoFalso(caminho: string, usuario: unknown, tipo = 'http') {
  const req = { originalUrl: caminho, user: usuario };
  return {
    getType: () => tipo,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
}

const SEGUIU = 'o handler rodou';
const proximo: CallHandler = { handle: () => of(SEGUIU) };

/** Um `ModulosService` de mentira: devolve o conjunto pedido, sem banco. */
function servicoFalso(modulos: string[]): ModulosService {
  return {
    modulosDaOrg: async () => new Set(modulos),
    ferramentaAtivaDaOrg: async () => false,
    ferramentasDaOrg: async () => [],
    esquecer: () => undefined,
  } as unknown as ModulosService;
}

describe('o gate de módulos (interceptor)', () => {
  const ORG = 'org-qualquer';

  /** Requisição com usuário de sessão normal (ou anônima, com `orgId` nulo). */
  async function passou(caminho: string, modulos: string[], orgId: string | null = ORG) {
    return comUsuario(caminho, modulos, orgId === null ? undefined : { orgId });
  }

  /** Requisição com um `req.user` arbitrário — é o que o `JwtAuthGuard` deixa. */
  async function comUsuario(caminho: string, modulos: string[], usuario: unknown) {
    const gate = new ModulosInterceptor(servicoFalso(modulos));
    return firstValueFrom(gate.intercept(contextoFalso(caminho, usuario), proximo));
  }

  /** O erro que a rota devolveu, ou `null` se ela passou. */
  async function recusa(promessa: Promise<unknown>): Promise<any> {
    return promessa.then(
      () => null,
      (e) => e,
    );
  }

  it('deixa passar rota de módulo LIGADO', async () => {
    await expect(passou('/api/bio/paginas', [...MODULOS])).resolves.toBe(SEGUIU);
  });

  it('responde 404 em rota de módulo DESLIGADO', async () => {
    const erro = await recusa(passou('/api/bio/paginas', ['leads']));
    expect(erro).toBeInstanceOf(NotFoundException);
    // 404 e não 403: para quem não contratou, o módulo tem de ser
    // indistinguível de rota inexistente — e a mensagem não nomeia o módulo.
    expect(erro.getStatus()).toBe(404);
    expect(JSON.stringify(erro.getResponse())).not.toContain('bio');
  });

  it('deixa passar a espinha do OS mesmo sem módulo nenhum', async () => {
    await expect(passou('/api/dashboard/summary', [])).resolves.toBe(SEGUIU);
    await expect(passou('/api/tenants/modulos', [])).resolves.toBe(SEGUIU);
  });

  it('deixa passar rota PÚBLICA de módulo desligado — sem tenant não há decisão', async () => {
    // O pixel, a página pública da bio e o callback OAuth chegam sem usuário.
    // Recusar seria recusar para todo mundo, inclusive para quem contratou.
    await expect(passou('/api/events/track', [], null)).resolves.toBe(SEGUIU);
    await expect(passou('/api/bio/p/fulano', [], null)).resolves.toBe(SEGUIU);
    await expect(passou('/api/conectar/instagram/callback', [], null)).resolves.toBe(SEGUIU);
  });

  it('a mídia pública da peça (MD4) é do módulo pauta: anônima passa (quem confere é o serviço); com sessão, sem pauta, 404', async () => {
    expect(moduloDoCaminho('/api/midia-publica/abc.def')).toBe('pauta');
    await expect(passou('/api/midia-publica/abc.def', [], null)).resolves.toBe(SEGUIU);
    await expect(passou('/api/midia-publica/abc.def', ['pauta'])).resolves.toBe(SEGUIU);
    const erro = await recusa(passou('/api/midia-publica/abc.def', ['bio']));
    expect(erro).toBeInstanceOf(NotFoundException);
  });

  it('o YouTube (MD10) é do módulo pauta: as rotas do Mac somem sem ele, e o retorno do OAuth é público', async () => {
    for (const c of [
      '/api/pauta/episodios/e1/youtube',
      '/api/pauta/episodios/e1/youtube/sessao',
      '/api/pauta/episodios/e1/youtube/concluido',
      '/api/pauta/youtube/pendentes',
      '/api/pauta/youtube/conectar',
      '/api/youtube/callback',
    ]) {
      expect(moduloDoCaminho(c)).toBe('pauta');
    }
    await expect(passou('/api/pauta/episodios/e1/youtube/sessao', ['pauta'])).resolves.toBe(SEGUIU);
    const erro = await recusa(passou('/api/pauta/episodios/e1/youtube/sessao', ['bio']));
    expect(erro).toBeInstanceOf(NotFoundException);
    // Autenticado numa empresa sem o módulo: o callback também some.
    expect(await recusa(passou('/api/youtube/callback', ['bio']))).toBeInstanceOf(NotFoundException);
    // Anônimo (o navegador voltando do Google): passa, e quem confere é o `state` assinado.
    await expect(passou('/api/youtube/callback', [], null)).resolves.toBe(SEGUIU);
  });

  it('publicar no Instagram pelo OS (MD6) é do módulo pauta: sem ele, a rota some', async () => {
    for (const c of ['/api/pauta/pecas/p1/publicar-instagram', '/api/pauta/pecas/p1/publicacao', '/api/pauta/pecas/p1/publicacao/manual']) {
      expect(moduloDoCaminho(c)).toBe('pauta');
    }
    await expect(passou('/api/pauta/pecas/p1/publicacao', ['pauta'])).resolves.toBe(SEGUIU);
    const erro = await recusa(passou('/api/pauta/pecas/p1/publicar-instagram', ['bio']));
    expect(erro).toBeInstanceOf(NotFoundException);
  });

  it('a conta de publicação (MD5) é do módulo pauta; o retorno dela é o callback público da bio', async () => {
    expect(moduloDoCaminho('/api/pauta/instagram/conectar')).toBe('pauta');
    expect(moduloDoCaminho('/api/pauta/instagram/conexao')).toBe('pauta');
    await expect(passou('/api/pauta/instagram/conexao', ['pauta'])).resolves.toBe(SEGUIU);
    const erro = await recusa(passou('/api/pauta/instagram/conectar', ['bio']));
    expect(erro).toBeInstanceOf(NotFoundException);
    await expect(passou('/api/conectar/instagram/callback', [], null)).resolves.toBe(SEGUIU);
  });

  /*
   * O CONTRÁRIO DA ROTA PÚBLICA: usuário presente e empresa ausente.
   *
   * As duas chegam aqui como "orgId nulo" e são opostas. Tratar as duas como
   * pública — que era a primeira versão deste gate — fazia QUALQUER token
   * assinado sem `orgId` atravessar TODO prefixo de módulo (são 14 prefixos
   * para 11 módulos, em `MODULO_POR_PREFIXO`). E esse
   * token existe: `GoogleLoginService.authUrl()` assina `{purpose:
   * 'google-login'}` com o MESMO `JwtService` da sessão (sem `sub`, sem
   * `orgId`, 10 min) e o publica no `state` da URL devolvida por
   * `GET /api/auth/google/start`, que é anônima; o `JwtAuthGuard` só confere a
   * assinatura, não o propósito. O que segurava a porta era o
   * `PermissionsGuard`, ou seja, a contenção era acidental — dependia de cada
   * rota de módulo declarar permissão.
   */
  it('RECUSA usuário autenticado sem empresa — inclusive o token de propósito do login', async () => {
    const erro = await recusa(
      comUsuario('/api/bio/paginas', [...MODULOS], { purpose: 'google-login', iat: 1, exp: 2 }),
    );
    expect(erro, 'token sem orgId não pode atravessar rota de módulo').toBeInstanceOf(
      NotFoundException,
    );
    expect(erro.getStatus()).toBe(404);
  });

  it('empresa EM BRANCO é ausência — 404, e nunca erro interno cru', async () => {
    // `'   '` é verdadeiro para a linguagem: sem `trim`, escorregaria até o
    // `ModulosService`, que LANÇA `SemTenantError` — não-HTTP, que o Nest
    // devolve como 500 com o interno no corpo.
    for (const orgId of ['', '   ', '\t\n', 42, null, {}]) {
      const erro = await recusa(comUsuario('/api/bio/paginas', [...MODULOS], { orgId }));
      expect(erro, `orgId ${JSON.stringify(orgId)} devia dar 404`).toBeInstanceOf(
        NotFoundException,
      );
    }
  });

  it('a espinha continua passando mesmo com token sem empresa', async () => {
    // De propósito: este gate decide ESCOPO DE PRODUTO, não autenticação.
    // Quem responde por token de propósito virando sessão é o módulo de auth —
    // está em PERGUNTAS do relatório da fatia, e não se conserta aqui.
    await expect(
      comUsuario('/api/dashboard/summary', [...MODULOS], { purpose: 'google-login' }),
    ).resolves.toBe(SEGUIU);
  });

  it('prefixo não declarado LIBERA (e grita) em vez de derrubar a rota', async () => {
    await expect(passou('/api/prefixo-inventado/x', [])).resolves.toBe(SEGUIU);
  });

  it('a rota "quais módulos eu tenho" devolve 401, e não 500, sem empresa', async () => {
    /*
     * `tenants` é ESPINHA: o gate não passa por lá de propósito (um tenant sem
     * módulo nenhum precisa continuar descobrindo que não tem nada). Sem um
     * guarda no próprio controller, o `ModulosService` lança `SemTenantError`,
     * que não é exceção HTTP — e o Nest devolve 500. Medido com a API de pé.
     */
    const ctrl = new ModulosController(servicoFalso([...MODULOS]));
    for (const orgId of [undefined, '', '   ']) {
      const erro = await recusa(ctrl.meus({ orgId } as unknown as JwtUser));
      expect(erro, `orgId ${JSON.stringify(orgId)} devia dar 401`).toBeInstanceOf(
        UnauthorizedException,
      );
      expect(erro.getStatus()).toBe(401);
    }
  });

  it('com empresa, ela responde os módulos e o catálogo inteiro', async () => {
    const ctrl = new ModulosController(servicoFalso(['bio', 'leads']));
    const r = await ctrl.meus({ orgId: ORG } as unknown as JwtUser);
    expect(r.modulos).toEqual(['leads', 'bio']); // ordem canônica de MODULOS
    expect(r.catalogo).toEqual(MODULOS);
  });

  it('não se mete em chamada que não é HTTP', async () => {
    const gate = new ModulosInterceptor(servicoFalso([]));
    await expect(
      firstValueFrom(gate.intercept(contextoFalso('/api/bio', { orgId: ORG }, 'rpc'), proximo)),
    ).resolves.toBe(SEGUIU);
  });
});

// ---------------------------------------------------------------------------
// 10. O schema e a migration dizem a mesma coisa que o código
// ---------------------------------------------------------------------------

const PASTA_DA_MIGRATION = '20260911013000_modulos_habilitados_por_org';

describe('schema e migration', () => {
  const schema = readFileSync(path.join(RAIZ, 'prisma', 'schema.prisma'), 'utf8');
  const bloco = /^model\s+Org\s*\{([\s\S]*?)^\}/m.exec(schema)?.[1] ?? '';

  it('Org tem a coluna de módulos, como lista de texto e com default vazio', () => {
    const linha = bloco.split('\n').find((l) => l.trim().startsWith('modulos '));
    expect(linha, 'campo `modulos` não existe no model Org').toBeTruthy();
    expect(linha).toMatch(/String\[\]/);
    // Vazio é "só a espinha". Default diferente mudaria o que um tenant novo
    // enxerga sem ninguém decidir isso.
    expect(linha).toMatch(/@default\(\[\]\)/);
  });

  const sqlPath = path.join(RAIZ, 'prisma', 'migrations', PASTA_DA_MIGRATION, 'migration.sql');

  it('a migration existe e cria a coluna NOT NULL', () => {
    expect(existsSync(sqlPath)).toBe(true);
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toMatch(/ADD COLUMN "modulos" TEXT\[\] NOT NULL/);
  });

  /*
   * Módulos que nasceram DEPOIS desta migration. O backfill deu a quem já
   * existia o que essa empresa via em 11/09/2026; módulo novo não entra nele
   * (migration aplicada não se edita, e ligar o módulo novo em toda empresa
   * antiga seria decisão comercial tomada por SQL). Quem o recebe é o
   * provisionamento. A lista só cresce, e cada entrada tem de existir em MODULOS.
   */
  const NASCIDOS_DEPOIS_DO_BACKFILL: readonly string[] = ['totem'];

  it('o backfill da migration é EXATAMENTE o catálogo de MODULOS daquela data', () => {
    // SQL não importa TypeScript: a lista aparece lá uma segunda vez, e esta é
    // a única defesa honesta contra ela divergir. Acrescentou módulo no
    // nav.ts? Ou ele estava no backfill, ou entra em NASCIDOS_DEPOIS_DO_BACKFILL.
    const sql = readFileSync(sqlPath, 'utf8');
    const array = /UPDATE "Org"[\s\S]*?ARRAY\[([\s\S]*?)\]::TEXT\[\]/.exec(sql)?.[1];
    expect(array, 'não achei o UPDATE de backfill na migration').toBeTruthy();
    const doSql = [...array!.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const daquelaData = MODULOS.filter((m) => !NASCIDOS_DEPOIS_DO_BACKFILL.includes(m));
    expect([...doSql].sort()).toEqual([...daquelaData].sort());
    expect(doSql.length).toBe(daquelaData.length);
    expect(NASCIDOS_DEPOIS_DO_BACKFILL.filter((m) => !(MODULOS as readonly string[]).includes(m))).toEqual([]);
  });

  it('a cronologia das migrations é única e a nossa é a mais nova das duas conhecidas', () => {
    const pastas = readdirSync(path.join(RAIZ, 'prisma', 'migrations'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    const carimbos = pastas.map((p) => p.slice(0, 14));
    // Duas migrations com o mesmo carimbo tornam a ordem de aplicação
    // indefinida entre bancos — e `prisma migrate deploy` roda no `command` do
    // container: ordem errada derruba a API, não uma tela.
    expect(new Set(carimbos).size).toBe(carimbos.length);
    expect(pastas).toContain(PASTA_DA_MIGRATION);
    expect(PASTA_DA_MIGRATION > '20260910120000_orgid_em_todo_filho').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. Contra banco de verdade — a coluna, o serviço e o cache
// ---------------------------------------------------------------------------

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'CRIA E APAGA empresas');

const ORG_COMPLETA = 'org-teste-modulos-completa';
const ORG_PARCIAL = 'org-teste-modulos-parcial';
const ORG_NOVA = 'org-teste-modulos-nova';

describe.skipIf(!URL)('Org.modulos contra o banco', () => {
  let prisma: PrismaClient;
  let servico: ModulosService;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    await prisma.org.deleteMany({
      where: { id: { in: [ORG_COMPLETA, ORG_PARCIAL, ORG_NOVA] } },
    });
    await prisma.org.createMany({
      data: [
        { id: ORG_COMPLETA, name: 'ROOT de teste', slug: ORG_COMPLETA, modulos: [...MODULOS] },
        {
          id: ORG_PARCIAL,
          name: 'Cliente de teste',
          slug: ORG_PARCIAL,
          // Lixo de propósito: o serviço tem de descartar, não engasgar.
          modulos: ['leads', 'campanhas', 'modulo-que-nao-existe'],
        },
        // Sem informar `modulos`: é o tenant recém-provisionado.
        { id: ORG_NOVA, name: 'Nova de teste', slug: ORG_NOVA },
      ],
    });
    servico = new ModulosService(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.org.deleteMany({
      where: { id: { in: [ORG_COMPLETA, ORG_PARCIAL, ORG_NOVA] } },
    });
    await prisma.$disconnect();
  });

  it('empresa nova nasce sem módulo nenhum — vazio é "só a espinha"', async () => {
    const nova = await prisma.org.findUniqueOrThrow({ where: { id: ORG_NOVA } });
    expect(nova.modulos).toEqual([]);
    expect(await servico.modulosDaOrg(ORG_NOVA)).toEqual(new Set());
  });

  it('a lista grava e volta inteira', async () => {
    const completa = await prisma.org.findUniqueOrThrow({ where: { id: ORG_COMPLETA } });
    expect([...completa.modulos].sort()).toEqual([...MODULOS].sort());
    expect(await servico.modulosDaOrg(ORG_COMPLETA)).toEqual(new Set(MODULOS));
  });

  /**
   * Deixa a ORG_PARCIAL num estado conhecido e derruba o cache dela.
   *
   * Cada caso que depende dessa empresa chama isto primeiro. Antes, três casos
   * seguidos reescreviam `modulos` e só passavam na ordem em que estão escritos
   * — reordenar a suíte (ou rodar um caso isolado com `-t`) deixava tudo
   * vermelho sem uma linha de produção ter mudado, que é o pior tipo de teste:
   * o que mede a ordem do arquivo em vez do comportamento do código.
   */
  async function estadoDaParcial(modulos: string[]) {
    await prisma.org.update({ where: { id: ORG_PARCIAL }, data: { modulos } });
    servico.esquecer(ORG_PARCIAL);
  }

  it('valor desconhecido gravado é descartado pelo serviço', async () => {
    await estadoDaParcial(['leads', 'campanhas', 'modulo-que-nao-existe']);
    expect(await servico.modulosDaOrg(ORG_PARCIAL)).toEqual(new Set(['leads', 'campanhas']));
  });

  it('sem tenant resolvido, LANÇA — ausência de empresa é erro, nunca "todos"', async () => {
    await expect(servico.modulosDaOrg('')).rejects.toThrow(/tenant não resolvido/);
    await expect(servico.modulosDaOrg(undefined as unknown as string)).rejects.toThrow(
      /tenant não resolvido/,
    );
  });

  it('empresa inexistente devolve conjunto vazio, não erro', async () => {
    expect(await servico.modulosDaOrg('org-que-nao-existe')).toEqual(new Set());
  });

  it('o cache responde sem reler o banco, e `esquecer` o derruba', async () => {
    await estadoDaParcial(['leads', 'campanhas']);
    const antes = await servico.modulosDaOrg(ORG_PARCIAL);
    expect(antes).toEqual(new Set(['leads', 'campanhas']));
    await prisma.org.update({ where: { id: ORG_PARCIAL }, data: { modulos: ['bio'] } });
    // Ainda o valor velho: é o cache fazendo o que existe para fazer.
    expect(await servico.modulosDaOrg(ORG_PARCIAL)).toEqual(antes);
    servico.esquecer(ORG_PARCIAL);
    expect(await servico.modulosDaOrg(ORG_PARCIAL)).toEqual(new Set(['bio']));
  });

  it('o conjunto devolvido é cópia — mexer nele não corrompe o cache', async () => {
    await estadoDaParcial(['leads', 'campanhas']);
    const meu = (await servico.modulosDaOrg(ORG_PARCIAL)) as Set<string>;
    // Um chamador distraído acrescentando módulo ao que recebeu. Se o serviço
    // devolvesse a referência do cache, `bio` valeria para aquela empresa
    // inteira pelos próximos 30s, em processo e sem rastro no banco.
    meu.add('bio');
    expect(await servico.modulosDaOrg(ORG_PARCIAL)).toEqual(new Set(['leads', 'campanhas']));
  });

  it('o gate decide certo para cada uma das empresas, rota por rota', async () => {
    const completa = await servico.modulosDaOrg(ORG_COMPLETA);
    const bloqueadasNaRoot = ROTAS.filter((r) => !caminhoLiberado(r.caminho, completa));
    expect(bloqueadasNaRoot.map((r) => r.caminho)).toEqual([]);

    await estadoDaParcial(MODULOS.filter((m) => m !== 'bio'));
    const semBio = await servico.modulosDaOrg(ORG_PARCIAL);
    const bloqueadas = ROTAS.filter((r) => !caminhoLiberado(r.caminho, semBio)).map(
      (r) => prefixoDe(r.caminho),
    );
    expect([...new Set(bloqueadas)].sort()).toEqual(['bio', 'conectar']);
  });

  it('nenhuma empresa REAL do banco tem módulo desconhecido gravado', async () => {
    /*
     * As três empresas desta suíte são laboratório — a ORG_PARCIAL nasce suja
     * de propósito — e ficam de fora. O que este caso guarda é o dado real: o
     * backfill da migration e o que o seed grava. Antes ele só passava porque
     * um caso anterior tinha, por acaso, reescrito a ORG_PARCIAL; reordenar a
     * suíte o deixava vermelho sem nenhuma mudança de produção.
     */
    const todas = await prisma.org.findMany({
      where: { id: { notIn: [ORG_COMPLETA, ORG_PARCIAL, ORG_NOVA] } },
      select: { slug: true, modulos: true },
    });
    const sujas = todas
      .filter((o) => o.modulos.some((m) => !(MODULOS as readonly string[]).includes(m)))
      .map((o) => o.slug);
    expect(sujas).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 11. O provisionamento — a empresa da ROOT não pode nascer sem módulo
// ---------------------------------------------------------------------------

/*
 * A migration preenche quem JÁ EXISTIA. Numa instalação nova ela roda com a
 * tabela vazia e não preenche ninguém: quem cria a empresa da ROOT é o
 * `prisma/seed.ts`, e enquanto não houver tela de provisionamento é lá que o
 * escopo de produto dela é decidido.
 *
 * Sem esta seção a falha é SILENCIOSA nos dois sentidos: o banco novo nasce com
 * `Org.modulos` vazio — os 14 prefixos de módulo devolvendo 404, todo item
 * fora do menu — e a suíte continua verde, porque nenhum caso exercita a
 * empresa semeada por requisição. É exatamente o acidente que a fatia existe
 * para impedir.
 *
 * Leitura estática: o que dá para cobrar sem rodar o seed é que o upsert grava
 * a lista na CRIAÇÃO — e SÓ nela. Desde a etapa P1-b do plano de produto
 * (17/09/2026) o seed é idempotente e de preservação exata: empresa que existe
 * fica como está, inclusive com a lista vazia, que é decisão válida (só a
 * espinha do OS). O "reseed como conserto" que este bloco afirmava deixou de
 * existir; quem decide módulos de uma empresa existente é o provisionamento
 * (`POST /tenants/provisionar`, `scripts/provisionar-tenant.ts`), que recebe
 * `modulos` por escrito. A prova por execução, com fixtures, está em
 * `test/seed-sem-destruicao.test.ts`.
 */
describe('o seed provisiona a empresa da ROOT com módulos', () => {
  const seed = readFileSync(path.join(RAIZ, 'prisma', 'seed.ts'), 'utf8');
  const upsert = /prisma\.org\.upsert\(\{([\s\S]*?)\}\);/.exec(seed)?.[1];

  it('importa MODULOS da fonte única em vez de redigitar a lista', () => {
    expect(seed).toMatch(/import\s*\{[^}]*\bMODULOS\b[^}]*\}\s*from\s*'@mktos\/shared'/);
  });

  it('o upsert da Org existe e grava módulos na CRIAÇÃO', () => {
    expect(upsert, 'não achei `prisma.org.upsert` em prisma/seed.ts').toBeTruthy();
    const create = /\bcreate:\s*\{([^}]*)\}/.exec(upsert!)?.[1] ?? '';
    // Sem isto o banco NOVO nasce com a ROOT sem módulo nenhum.
    expect(create, '`create` do upsert da Org não grava `modulos`').toMatch(/\bmodulos\b/);
  });

  it('e NÃO na atualização — empresa que existe fica como está (P1-b)', () => {
    const update = /\bupdate:\s*\{([^}]*)\}/.exec(upsert!)?.[1] ?? '';
    // Religar todos os módulos a cada rodada desfazia o que a empresa desligou.
    expect(update.trim(), '`update` do upsert da Org voltou a gravar `modulos`').toBe('');
  });

  it('o valor gravado vem de MODULOS, não de uma lista escrita à mão', () => {
    expect(seed).toMatch(/const\s+modulos\s*=\s*\[\s*\.\.\.\s*MODULOS\s*\]/);
  });
});

// ---------------------------------------------------------------------------

function chaves(grupos: { itens: NavItem[] }[]): string[] {
  return grupos.flatMap((g) => g.itens).map((n) => n.key);
}
