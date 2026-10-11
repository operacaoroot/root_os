/**
 * Rotas públicas resolvem tenant — fatia 1.4, RF-T-04
 * ===================================================
 *
 * O QUE ESTA SUÍTE PROVA
 * Quatro superfícies chegam à API sem token nenhum — a página pública da bio, o
 * rastreio dela, o redirecionamento de link e a ingestão do pixel (por onde
 * também passa o resgate da Root Central). Nenhuma delas tem empresa no token,
 * porque não há token. Todas elas LEEM E ESCREVEM em tabela de tenant.
 *
 * A suíte roda a sessão de banco em `TENANT_MODO=impor`, que é o modo em que
 * consulta sem empresa resolvida LANÇA (ver `src/prisma/sessao-de-banco.ts`) —
 * o mesmo modo em que a aplicação vai rodar quando o isolamento por linha
 * ligar. Nele, qualquer consulta que escape do contexto derruba o caso em vez de
 * passar com um aviso.
 *
 * E ela não confia só no "não lançou": um gancho registra a EMPRESA e o
 * MODELO.OPERAÇÃO de cada consulta feita durante a rota.
 *
 * POR QUE MODELO E OPERAÇÃO, E NÃO SÓ A EMPRESA — o conserto de um furo da
 * própria suíte. A primeira versão tinha um `empresasDepoisDaResolucao()` que
 * FILTRAVA fora tudo o que rodasse sob a sentinela, e depois conferia o que
 * sobrava. Consulta cruzada feita sob a sentinela — que é exatamente o estado em
 * que o banco enxerga todas as empresas — ficava invisível para o teste. Agora a
 * regra é a oposta e é cobrada em TODO caso: o conjunto de consultas feitas sob
 * a sentinela tem de ser EXATAMENTE as resoluções declaradas em
 * `src/common/tenant-publico.ts`. Qualquer outra coisa ali dentro reprova.
 *
 * A SEÇÃO DE RLS DE VERDADE (opcional, `RLS_NO_TESTE=1`)
 * O final do arquivo LIGA `ROW LEVEL SECURITY` de verdade nas tabelas que estas
 * rotas tocam, com as policies que a fatia 1.5 vai escrever, roda as mesmas
 * rotas e confere que (a) elas continuam funcionando, (b) dentro do tenant A o
 * banco recusa a linha do tenant B e (c) SOB A SENTINELA NÃO SE ESCREVE — nem
 * link de outro, nem rascunho de outro, nem a lista de módulos de outro. Desliga
 * tudo no fim.
 *
 * Ela é OPCIONAL de propósito. `ENABLE ROW LEVEL SECURITY` vale para o banco
 * inteiro, não para esta conexão, e o vitest roda os arquivos em paralelo:
 * ligada por padrão, ela derrubaria `porta.test.ts` e `contexto-aprovacao.test.ts`,
 * que usam o MESMO banco ao mesmo tempo e não resolvem tenant. Rode sozinha, e
 * NO BANCO SEPARADO — `marketing_os_test_rls`, não o `marketing_os_test` da
 * suíte padrão (inventário em `test/banco-de-teste.ts`):
 *
 *   TEST_DATABASE_URL='postgresql://mkt:shadow@localhost:55432/marketing_os_test_rls' \
 *     TENANT_DATABASE_URL='postgresql://mktos_app:<senha>@localhost:55432/marketing_os_test_rls' \
 *     RLS_NO_TESTE=1 pnpm --filter @mktos/api exec vitest run test/rotas-publicas-tenant.test.ts
 *
 * Na CI ela roda no job `isolamento`, que é o único com o papel restrito de pé
 * — e lá o passo NÃO tem `continue-on-error`: vermelho ali é regressão.
 *
 * AVISO: a suíte ESCREVE no banco. Nunca aponte para produção — a trava de
 * `banco-de-teste.ts` recusa banco que não se anuncie descartável.
 */

import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { pageIdDoAvatar } from '../src/bio/avatar';
import { BioChallengeService } from '../src/bio/bio-challenge.service';
import { BioPublicController } from '../src/bio/bio-public.controller';
import { BioService } from '../src/bio/bio.service';
import { BioTrackingService } from '../src/bio/bio-tracking.service';
import {
  SemTenantError,
  comContexto,
  contextoAtual,
  novaCorrelacao,
} from '../src/common/contexto-execucao';
import {
  MemoriaDeResolucao,
  ORG_RESOLUCAO_PUBLICA,
  comTenantPublico,
  ehResolucaoPublica,
} from '../src/common/tenant-publico';
import { EventsController } from '../src/events/events.controller';
import { EventsService } from '../src/events/events.service';
import {
  ORG_LEGADA_DO_PIXEL,
  PixelTenantService,
  chaveDoPixel,
} from '../src/events/pixel-tenant.service';
import { GUC_TENANT, comTenantNaSessao } from '../src/prisma/sessao-de-banco';
import { exigirBancoDescartavel } from './banco-de-teste';
import { MidiaPublicaService } from '../src/pauta/midia-publica.service';
import { assinar as assinarMidia } from '../src/pauta/midia-publica';
import { ModulosService } from '../src/tenants/modulos.service';

// ---------------------------------------------------------------------------
// Parte pura — roda sempre, sem banco
// ---------------------------------------------------------------------------

describe('a chave do pixel sai do corpo antes da query', () => {
  it('corpo ganha da query: query string vaza em log de acesso e proxy', () => {
    expect(chaveDoPixel({ pixel_key: 'do-corpo' }, 'da-query')).toEqual({
      tipo: 'chave',
      valor: 'do-corpo',
    });
  });

  it('sem corpo, a query serve — é o caminho do sendBeacon, que não manda cabeçalho', () => {
    expect(chaveDoPixel({}, 'da-query')).toEqual({ tipo: 'chave', valor: 'da-query' });
  });

  it('corpo que não é objeto não derruba nada', () => {
    expect(chaveDoPixel('nao sou objeto', 'da-query')).toEqual({
      tipo: 'chave',
      valor: 'da-query',
    });
    expect(chaveDoPixel(null)).toEqual({ tipo: 'ausente' });
    expect(chaveDoPixel(undefined)).toEqual({ tipo: 'ausente' });
  });

  it('ausência é ausência — e é ela, e só ela, que cai na empresa padrão', () => {
    expect(chaveDoPixel({})).toEqual({ tipo: 'ausente' });
    expect(chaveDoPixel({}, undefined)).toEqual({ tipo: 'ausente' });
  });

  /*
   * O FURO QUE ESTES CASOS FECHAM: `pixel_key` com tipo errado e `?k=` repetido
   * viravam "não veio chave" e caíam na EMPRESA PADRÃO — o oposto do que o
   * próprio comentário do serviço promete. Chave presente e inutilizável é
   * RECUSA, e recusa com o mesmo desfecho de qualquer outra.
   */
  describe('chave presente e inutilizável é recusa, nunca empresa padrão', () => {
    it('número', () => {
      expect(chaveDoPixel({ pixel_key: 12345 })).toEqual({ tipo: 'inutilizavel', motivo: 'tipo' });
    });

    it('lista — é o que o Express entrega em ?k=a&k=b', () => {
      expect(chaveDoPixel({}, ['a', 'b'])).toEqual({ tipo: 'inutilizavel', motivo: 'tipo' });
      expect(chaveDoPixel({ pixel_key: ['a'] })).toEqual({ tipo: 'inutilizavel', motivo: 'tipo' });
    });

    it('objeto, booleano e nulo', () => {
      expect(chaveDoPixel({ pixel_key: { a: 1 } })).toEqual({ tipo: 'inutilizavel', motivo: 'tipo' });
      expect(chaveDoPixel({ pixel_key: true })).toEqual({ tipo: 'inutilizavel', motivo: 'tipo' });
      expect(chaveDoPixel({ pixel_key: null })).toEqual({ tipo: 'inutilizavel', motivo: 'tipo' });
    });

    it('string vazia ou só espaço', () => {
      expect(chaveDoPixel({ pixel_key: '' })).toEqual({ tipo: 'inutilizavel', motivo: 'vazia' });
      expect(chaveDoPixel({ pixel_key: '   ' })).toEqual({ tipo: 'inutilizavel', motivo: 'vazia' });
      expect(chaveDoPixel({}, '')).toEqual({ tipo: 'inutilizavel', motivo: 'vazia' });
    });

    it('lixo no corpo NÃO passa a vez para a query', () => {
      // senão bastaria mandar `pixel_key: 0` junto de `?k=` para escolher a fonte
      expect(chaveDoPixel({ pixel_key: 0 }, 'da-query')).toEqual({
        tipo: 'inutilizavel',
        motivo: 'tipo',
      });
    });
  });
});

describe('o avatar diz de que página ele é', () => {
  it('lê o uuid da página no nome que o upload gera', () => {
    const id = '3f2a9c11-0b4d-4e8a-9f21-77bb0c1d2e33';
    expect(pageIdDoAvatar(`${id}-a1b2c3d4e5f6.png`)).toBe(id);
    expect(pageIdDoAvatar(`${id}-a1b2c3d4e5f6.webp`)).toBe(id);
  });

  it('nome fora da convenção devolve null — e continua sendo servido, sem empresa', () => {
    expect(pageIdDoAvatar('foto.png')).toBeNull();
    expect(pageIdDoAvatar('nao-e-uuid-a1b2c3.png')).toBeNull();
    // o hash tem de ser hexadecimal: o que vem depois do uuid não é qualquer coisa
    expect(pageIdDoAvatar('3f2a9c11-0b4d-4e8a-9f21-77bb0c1d2e33-zzzz.png')).toBeNull();
  });
});

describe('a sentinela da resolução pública', () => {
  it('não pode ser publicada como empresa de verdade', async () => {
    await expect(comTenantPublico(ORG_RESOLUCAO_PUBLICA, async () => 1)).rejects.toThrow(
      /sentinela/i,
    );
  });

  it('empresa vazia continua sendo erro, nunca "todos"', async () => {
    await expect(comTenantPublico('', async () => 1)).rejects.toBeInstanceOf(SemTenantError);
    await expect(comTenantPublico('   ', async () => 1)).rejects.toBeInstanceOf(SemTenantError);
  });

  it('publica a empresa e PRESERVA a correlação do pedido — a jornada não se parte', async () => {
    const correlacao = novaCorrelacao('http');
    await comContexto({ orgId: null, correlationId: correlacao }, async () => {
      await comTenantPublico('org-x', async () => {
        expect(contextoAtual()?.orgId).toBe('org-x');
        expect(contextoAtual()?.correlationId).toBe(correlacao);
      });
      expect(contextoAtual()?.orgId).toBeNull();
    });
  });

  it('fora de requisição nenhuma, cunha correlação própria em vez de rodar sem', async () => {
    await comTenantPublico('org-x', async () => {
      expect(contextoAtual()?.correlationId).toMatch(/^publico-/);
    });
  });

  /*
   * O INVÓLUCRO NÃO SAI DO MÓDULO. Enquanto ele era exportado, a sentinela ficava
   * a um import de distância de qualquer arquivo — e com ela duas coisas que o
   * revisor mediu: promessa solta criada lá dentro segura a sentinela pela vida
   * inteira dela, e o invólucro REABRIA a sentinela mesmo já dentro de um tenant
   * resolvido. Este caso é a catraca: o dia em que alguém exportar de novo, ele
   * reprova antes de o furo chegar à revisão.
   */
  it('o invólucro da sentinela NÃO é exportado — só as resoluções', async () => {
    const mod = await import('../src/common/tenant-publico');
    const exportado = Object.keys(mod);
    expect(exportado).not.toContain('resolvendoTenant');
    expect(exportado).not.toContain('sobASentinela');
    expect(exportado.filter((k) => k.startsWith('resolver')).sort()).toEqual([
      'resolverOrgDaChave',
      'resolverOrgDoSlugInterno',
      // O totem (11/10/2026): o aparelho pelo hash do código de ativação.
      'resolverTenantDaAtivacao',
      // O totem: a etiqueta do QR pelo código impresso.
      'resolverTenantDaEtiqueta',
      'resolverTenantDaPage',
      // O link público do onboarding (23/09/2026): acha a empresa pelo hash do token.
      'resolverTenantDoConvite',
      'resolverTenantDoHandle',
      'resolverTenantDoLink',
      // O totem: o aparelho pelo hash do token.
      'resolverTenantDoTotem',
    ]);
  });
});

describe('a memória curta das resoluções', () => {
  it('lembra a resposta positiva e a negativa, com validades diferentes', () => {
    const m = new MemoriaDeResolucao<string>({
      validadeMs: 1000,
      validadeNegativaMs: 100,
      teto: 10,
    });
    m.guardar('sim', 'org-1', 0);
    m.guardar('nao', null, 0);

    expect(m.lembrar('sim', 500)).toEqual({ lembrada: true, valor: 'org-1' });
    // a negativa já venceu aos 500ms; a positiva não
    expect(m.lembrar('nao', 500)).toEqual({ lembrada: false });
    expect(m.lembrar('sim', 2000)).toEqual({ lembrada: false });
  });

  it('esvazia ao encher — chave vem de fora, e cache sem teto é memória sem fim', () => {
    const m = new MemoriaDeResolucao<string>({ validadeMs: 1000, validadeNegativaMs: 1000, teto: 3 });
    for (let i = 0; i < 3; i++) m.guardar(`k${i}`, null, 0);
    expect(m.tamanho).toBe(3);
    m.guardar('k3', null, 0);
    expect(m.tamanho).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Parte com banco
// ---------------------------------------------------------------------------

const URL_BANCO = process.env.TEST_DATABASE_URL ?? '';
if (URL_BANCO) exigirBancoDescartavel(URL_BANCO, 'ESCREVE nele');

/*
 * O `beforeAll` da seção de RLS semeia duas empresas E cria quatro policies em
 * onze tabelas — dezenas de idas ao banco, DDL inclusive. Os 10s padrão do
 * vitest estouram quando a máquina está ocupada, e o sintoma é cruel: os casos
 * aparecem como PULADOS e o arquivo reprova por "Hook timed out", como se a
 * seção não existisse. Medido: a mesma rodada leva 8s ociosa e 15s sob carga.
 */
vi.setConfig({ hookTimeout: 120_000, testTimeout: 30_000 });

const MARCA = `pub14${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toLowerCase();

/** Uma consulta vista pelo gancho: de que empresa ela saiu, e o que ela era. */
interface ConsultaVista {
  org: string | null;
  onde: string;
}

let vistos: ConsultaVista[] = [];

/**
 * As ÚNICAS consultas que podem rodar sob a sentinela. É a lista de
 * `src/common/tenant-publico.ts`, escrita aqui como cobrança.
 */
const RESOLUCOES = new Set([
  'Org.findUnique',
  'BioPage.findUnique',
  'BioLink.findUnique',
]);

/** A declaração da empresa na sessão (`set_config`) é encanamento, não consulta. */
const DECLARACAO = 'set_config';

/**
 * Um cliente que registra toda consulta ANTES de o gancho da sessão de banco
 * envolvê-la, para o registro enxergar o mesmo contexto que o `SET LOCAL` vai
 * enxergar.
 */
function clienteObservado(url: string): PrismaClient {
  const cru = new PrismaClient({ datasourceUrl: url });
  const observado = cru.$extends({
    query: {
      async $allOperations({ model, operation, args, query }) {
        const ehDeclaracao =
          !model && Array.isArray(args) && String(args[0] ?? '').includes('set_config');
        vistos.push({
          org: contextoAtual()?.orgId ?? null,
          onde: ehDeclaracao ? DECLARACAO : model ? `${model}.${operation}` : operation,
        });
        return query(args);
      },
    },
  });
  return comTenantNaSessao(observado as unknown as PrismaClient, { modo: 'impor' });
}

describe.skipIf(!URL_BANCO)('as quatro rotas públicas, com a sessão em modo impor', () => {
  let admin: PrismaClient;
  let prisma: PrismaClient;

  let bio: BioService;
  let publico: BioPublicController;
  let eventos: EventsController;
  let pixelTenants: PixelTenantService;

  const ids = {
    orgA: '',
    orgB: '',
    orgPadrao: '',
    pageA: '',
    pageB: '',
    rascunhoA: '',
    linkB: '',
  };
  const handleA = `hpa${MARCA}`;
  const handleB = `hpb${MARCA}`;
  const handleRascunho = `hpr${MARCA}`;
  const slugA = `orga-${MARCA}`;
  const rid = `rid_${MARCA}`;
  /** A empresa padrão já existia neste banco? Se sim, não é nossa para apagar. */
  let padraoEraNossa = false;

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: URL_BANCO });
    await admin.$connect();
    prisma = clienteObservado(URL_BANCO);

    // --- semente (pelo cliente ADMIN, fora de contexto nenhum) ---
    const orgA = await admin.org.create({
      data: { name: `A ${MARCA}`, slug: slugA, modulos: ['bio', 'pixels'] },
    });
    const orgB = await admin.org.create({
      data: { name: `B ${MARCA}`, slug: `orgb-${MARCA}`, modulos: ['bio', 'pixels'] },
    });
    ids.orgA = orgA.id;
    ids.orgB = orgB.id;

    // A empresa padrão do pixel é a que recebe evento sem chave. Ela existe em
    // qualquer base semeada; aqui criamos se faltar, e só apagamos o que criamos.
    const existente = await admin.org.findUnique({ where: { slug: ORG_LEGADA_DO_PIXEL } });
    if (existente) {
      ids.orgPadrao = existente.id;
    } else {
      padraoEraNossa = true;
      const nova = await admin.org.create({
        data: { name: 'padrão do pixel', slug: ORG_LEGADA_DO_PIXEL, modulos: [] },
      });
      ids.orgPadrao = nova.id;
    }

    const pageA = await admin.bioPage.create({
      data: { orgId: orgA.id, handle: handleA, titulo: 'Página A', publicada: true },
    });
    const pageB = await admin.bioPage.create({
      data: { orgId: orgB.id, handle: handleB, titulo: 'Página B', publicada: true },
    });
    const rascunho = await admin.bioPage.create({
      data: { orgId: orgA.id, handle: handleRascunho, titulo: 'Rascunho A', publicada: false },
    });
    ids.pageA = pageA.id;
    ids.pageB = pageB.id;
    ids.rascunhoA = rascunho.id;

    const link = await admin.bioLink.create({
      data: {
        orgId: orgB.id,
        pageId: pageB.id,
        ordem: 1,
        tipo: 'url',
        rotulo: 'Site',
        destino: 'https://exemplo.test/b',
      },
    });
    ids.linkB = link.id;

    // O desafio da página B existe para o caminho REAL de `estadoPublico` rodar:
    // ele consulta quatro tabelas de tenant de dentro da página pública, e
    // substituí-lo por um duble faria a suíte medir o duble.
    const desafio = await admin.bioChallenge.create({
      data: {
        orgId: orgB.id,
        pageId: pageB.id,
        titulo: 'Desafio B',
        inicio: new Date(Date.now() - 86_400_000),
        fim: new Date(Date.now() + 86_400_000 * 9),
        metaPosts: 10,
        exibir: true,
      },
    });
    await admin.bioChallengeAccount.create({
      data: {
        orgId: orgB.id,
        challengeId: desafio.id,
        plataforma: 'instagram',
        handle: 'conta_b',
        modo: 'manual',
      },
    });

    // --- as classes, montadas à mão: injeção do Nest não roda sob vitest ---
    const auditStub = { log: async () => undefined };
    bio = new BioService(
      prisma as never,
      auditStub as never,
      new BioChallengeService(prisma as never, auditStub as never) as never,
      {} as never,
    );
    const tracking = new BioTrackingService(prisma as never);
    const storageStub = {
      get: async () => ({
        stream: { pipe: (r: unknown) => r },
        contentType: 'image/png',
        size: 3,
      }),
    };
    publico = new BioPublicController(bio, tracking, storageStub as never);

    pixelTenants = new PixelTenantService(prisma as never);
    eventos = new EventsController(prisma as never, new EventsService(prisma as never), pixelTenants);
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.bioEvent.deleteMany({ where: { orgId: { in: [ids.orgA, ids.orgB] } } });
    await admin.bioVisit.deleteMany({ where: { orgId: { in: [ids.orgA, ids.orgB] } } });
    await admin.bioVisitor.deleteMany({ where: { id: rid } });
    await admin.bioChallengeSnapshot.deleteMany({ where: { orgId: { in: [ids.orgA, ids.orgB] } } });
    await admin.bioChallengePost.deleteMany({ where: { orgId: { in: [ids.orgA, ids.orgB] } } });
    await admin.bioChallengeAccount.deleteMany({ where: { orgId: { in: [ids.orgA, ids.orgB] } } });
    await admin.bioChallenge.deleteMany({ where: { orgId: { in: [ids.orgA, ids.orgB] } } });
    await admin.bioLink.deleteMany({ where: { orgId: { in: [ids.orgA, ids.orgB] } } });
    await admin.bioPage.deleteMany({ where: { orgId: { in: [ids.orgA, ids.orgB] } } });
    // Duas origens de PixelEvent, e as duas precisam sair antes da Org: o do
    // pixel carrega o `event_id` marcado, e o ESPELHO que o rastreio da bio
    // grava nasce com um uuid sorteado — só o orgId o identifica.
    await admin.pixelEvent.deleteMany({
      where: {
        OR: [{ orgId: { in: [ids.orgA, ids.orgB] } }, { eventId: { startsWith: MARCA } }],
      },
    });
    await admin.org.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } });
    if (padraoEraNossa) await admin.org.deleteMany({ where: { id: ids.orgPadrao } });
    await admin.$disconnect();
    await (prisma as PrismaClient).$disconnect();
  });

  beforeEach(() => {
    vistos = [];
    pixelTenants.esquecer();
  });

  /*
   * A CATRACA DA SENTINELA, cobrada depois de CADA caso: o que rodou sob ela tem
   * de ser resolução, e nada mais. É o que faltava na primeira versão desta
   * suíte — lá, consulta cruzada sob a sentinela era filtrada fora da conferência.
   */
  afterEach(() => {
    const forasteiras = vistos
      .filter((v) => ehResolucaoPublica(v.org) && v.onde !== DECLARACAO)
      .map((v) => v.onde)
      .filter((onde) => !RESOLUCOES.has(onde));
    expect(forasteiras).toEqual([]);
  });

  /** Roda como o `ContextoInterceptor` roda numa requisição anônima: sem empresa. */
  function comoVisitante<T>(fn: () => Promise<T>): Promise<T> {
    return comContexto({ orgId: null, correlationId: novaCorrelacao('http'), origem: 'http' }, fn);
  }

  /** As consultas de verdade — sem o `set_config` que declara a empresa. */
  function consultas(): ConsultaVista[] {
    return vistos.filter((v) => v.onde !== DECLARACAO);
  }

  /** O que rodou sob a sentinela, em ordem. */
  function sobASentinela(): string[] {
    return consultas()
      .filter((v) => ehResolucaoPublica(v.org))
      .map((v) => v.onde);
  }

  /** As empresas das consultas que NÃO são resolução. */
  function empresasDoPedido(): Set<string | null> {
    return new Set(consultas().filter((v) => !ehResolucaoPublica(v.org)).map((v) => v.org));
  }

  function resFalso() {
    const estado = { cabecalhos: new Map<string, unknown>(), destino: '', status: 0 };
    const res = {
      setHeader: (k: string, v: unknown) => estado.cabecalhos.set(k, v),
      removeHeader: (k: string) => estado.cabecalhos.delete(k),
      redirect: (a: number | string, b?: string) => {
        estado.status = typeof a === 'number' ? a : 302;
        estado.destino = typeof a === 'number' ? (b ?? '') : a;
        return res;
      },
    };
    return { res, estado };
  }

  /*
   * O registro é assíncrono e solto de propósito; esperamos a linha aparecer.
   *
   * A espera é generosa porque o gargalo não é o código: cada consulta sob o
   * gancho da sessão vira `BEGIN; set_config; consulta; COMMIT`, e sob carga (a
   * máquina roda outras suítes ao mesmo tempo) 4s davam falso vermelho.
   */
  async function esperarEvento(nome: string, ateMs = 15_000) {
    const limite = Date.now() + ateMs;
    for (;;) {
      const achado = await admin.bioEvent.findFirst({ where: { nome, visitorId: rid } });
      if (achado) return achado;
      if (Date.now() > limite) throw new Error(`evento "${nome}" não apareceu em ${ateMs}ms`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  // -------------------------------------------------------------------------

  it('página pública: resolve a empresa do handle e lê o resto DENTRO dela', async () => {
    const page = await comoVisitante(() => publico.page(handleB));

    expect(page.handle).toBe(handleB);
    // uma resolução, e SÓ uma, sob a sentinela
    expect(sobASentinela()).toEqual(['BioPage.findUnique']);
    // e o resto do pedido inteiro — inclusive o desafio, que é serviço de verdade
    expect(empresasDoPedido()).toEqual(new Set([ids.orgB]));
    expect(consultas().some((c) => c.onde.startsWith('BioChallenge'))).toBe(true);
    expect(page.desafio?.titulo).toBe('Desafio B');
  });

  it('página pública: handle de A e handle de B não se cruzam', async () => {
    await comoVisitante(() => publico.page(handleA));
    expect(sobASentinela()).toEqual(['BioPage.findUnique']);
    expect(empresasDoPedido()).toEqual(new Set([ids.orgA]));
  });

  it('handle inexistente: 404 sem abrir contexto de empresa nenhuma', async () => {
    await expect(comoVisitante(() => publico.page(`nao-existe-${MARCA}`))).rejects.toThrow(
      /não encontrada/,
    );
    expect(sobASentinela()).toEqual(['BioPage.findUnique']);
    expect(empresasDoPedido().size).toBe(0);
  });

  it('rascunho responde igual a inexistente — e também não abre contexto', async () => {
    await expect(comoVisitante(() => publico.page(handleRascunho))).rejects.toThrow(
      /não encontrada/,
    );
    expect(sobASentinela()).toEqual(['BioPage.findUnique']);
    expect(empresasDoPedido().size).toBe(0);
  });

  it('rastreio do pageview grava na empresa do handle, não em nenhuma outra', async () => {
    const r = await comoVisitante(() =>
      publico.track({ handle: handleB, rid, url: `/${handleB}` }),
    );
    expect(r).toEqual({ ok: true });

    const evento = await esperarEvento('pageview');
    expect(evento.orgId).toBe(ids.orgB);
    expect(evento.pageId).toBe(ids.pageB);

    const espelho = await admin.pixelEvent.findUnique({ where: { eventId: evento.eventId } });
    expect(espelho?.orgId).toBe(ids.orgB);

    expect(sobASentinela()).toEqual(['BioPage.findUnique']);
    expect(empresasDoPedido()).toEqual(new Set([ids.orgB]));
  });

  it('rastreio de handle despublicado não grava nada', async () => {
    const r = await comoVisitante(() => publico.track({ handle: handleRascunho, rid }));
    expect(r).toEqual({ ok: false, reason: 'page' });
    expect(sobASentinela()).toEqual(['BioPage.findUnique']);
    expect(empresasDoPedido().size).toBe(0);
  });

  it('redirecionamento de link: resolve pelo próprio link e conta o clique na empresa dele', async () => {
    const { res, estado } = resFalso();
    const req = {
      headers: { cookie: `rid=${rid}`, 'user-agent': 'teste' },
      originalUrl: `/api/bio/r/${ids.linkB}`,
    };

    await comoVisitante(() => publico.redirect(ids.linkB, req as never, res as never));

    expect(estado.status).toBe(302);
    expect(estado.destino).toBe('https://exemplo.test/b');

    const clique = await esperarEvento('link_click');
    expect(clique.orgId).toBe(ids.orgB);
    expect(clique.linkId).toBe(ids.linkB);

    // inclusive o registro que roda SOLTO, depois de a resposta ter saído
    expect(sobASentinela()).toEqual(['BioLink.findUnique']);
    expect(empresasDoPedido()).toEqual(new Set([ids.orgB]));
  });

  it('link inexistente volta para a home da bio sem consultar empresa nenhuma', async () => {
    const { res, estado } = resFalso();
    await comoVisitante(() =>
      publico.redirect(`${MARCA}-nao-existe`, { headers: {} } as never, res as never),
    );
    expect(estado.destino).toMatch(/\/b$/);
    expect(sobASentinela()).toEqual(['BioLink.findUnique']);
    expect(empresasDoPedido().size).toBe(0);
  });

  it('avatar: o nome do arquivo resolve a empresa da página', async () => {
    const { res } = resFalso();
    await comoVisitante(() => publico.avatar(`${ids.pageB}-a1b2c3d4e5f6.png`, res as never));
    expect(sobASentinela()).toEqual(['BioPage.findUnique']);
    // (a entrega em si não consulta banco: o arquivo vem do MinIO)
    expect(empresasDoPedido().size).toBe(0);
  });

  it('avatar fora da convenção continua servindo, e sem ir ao banco', async () => {
    const { res, estado } = resFalso();
    await comoVisitante(() => publico.avatar('foto-antiga.png', res as never));
    expect(consultas()).toEqual([]);
    expect(estado.cabecalhos.get('Cache-Control')).toMatch(/immutable/);
    // o cabeçalho de correlação NÃO pode ficar num objeto cacheado por um ano
    expect(estado.cabecalhos.has('x-correlation-id')).toBe(false);
  });

  it('avatar DENTRO da convenção que não resolve vai ao banco UMA vez, não uma por pedido', async () => {
    // O furo: esta rota não tocava no banco antes da fatia. Com a resolução, um
    // nome inventado que casa com `<uuid>-<hex>.png` virava consulta por
    // requisição, anônima e sem teto de taxa. A memória curta fecha a torneira.
    // uuid bem formado (o nome PRECISA casar com a convenção) e que não existe
    const inventado = '3f2a9c11-0b4d-4e8a-9f21-77bb0c1d2e33-a1b2c3d4e5f6.png';
    const { res } = resFalso();
    await comoVisitante(() => publico.avatar(inventado, res as never));
    await comoVisitante(() => publico.avatar(inventado, res as never));
    await comoVisitante(() => publico.avatar(inventado, res as never));

    expect(sobASentinela()).toEqual(['BioPage.findUnique']);
  });

  it('resolução chamada de DENTRO de um tenant não sai dele nem por um instante', async () => {
    // A segunda consequência de exportar o invólucro: ele reabria a sentinela
    // mesmo com empresa resolvida, e qualquer caminho autenticado que chamasse
    // uma resolução escapava do próprio tenant enquanto ela durasse.
    await comTenantPublico(ids.orgA, () => bio.tenantDoHandle(handleA));
    expect(sobASentinela()).toEqual([]);
    expect(empresasDoPedido()).toEqual(new Set([ids.orgA]));
  });

  // ---- pixel --------------------------------------------------------------

  function evento(nome: string, extra: Record<string, unknown> = {}) {
    return {
      event_name: nome,
      event_id: `${MARCA}-${Math.random().toString(36).slice(2)}`,
      session_id: `s-${MARCA}`,
      anonymous_id: `a-${MARCA}`,
      ...extra,
    };
  }

  /** A resposta é a MESMA para todo desfecho: quem confere o desfecho é o banco. */
  const RESPOSTA = { ok: true };

  it('pixel com a chave da empresa (o id) grava nela', async () => {
    const corpo = evento('page_view', { pixel_key: ids.orgB });
    expect(await comoVisitante(() => eventos.track(corpo))).toEqual(RESPOSTA);

    const gravado = await admin.pixelEvent.findUnique({ where: { eventId: corpo.event_id } });
    expect(gravado?.orgId).toBe(ids.orgB);
    expect(sobASentinela()).toEqual(['Org.findUnique']);
    expect(empresasDoPedido()).toEqual(new Set([ids.orgB]));
  });

  it('o SLUG não é chave: com ele ninguém escreve na empresa de outro', async () => {
    /*
     * O furo que este caso fecha, medido pelo revisor: enquanto o slug valia como
     * chave, bastava conhecê-lo — e slug é adivinhável — para gravar evento na
     * conta de um cliente, com nome, endereço, campanha, data e VALOR escolhidos
     * por quem mandou. `value` vira receita no painel e no funil.
     */
    const corpo = evento('purchase', { pixel_key: slugA, value: 999999 });
    expect(await comoVisitante(() => eventos.track(corpo))).toEqual(RESPOSTA);

    expect(await admin.pixelEvent.findUnique({ where: { eventId: corpo.event_id } })).toBeNull();
    // nem chegou ao banco: o formato é conferido antes
    expect(consultas()).toEqual([]);
    expect(pixelTenants.contadores().formato).toBe(1);
  });

  it('chave desconhecida NÃO cai na empresa padrão — o evento é recusado', async () => {
    const corpo = evento('purchase', {
      pixel_key: '11111111-2222-4333-8444-555555555555',
      value: 99,
    });
    expect(await comoVisitante(() => eventos.track(corpo))).toEqual(RESPOSTA);
    expect(await admin.pixelEvent.findUnique({ where: { eventId: corpo.event_id } })).toBeNull();
    expect(pixelTenants.contadores().desconhecida).toBe(1);
  });

  it('a rota anônima NÃO é oráculo: chave que existe e chave que não existe respondem igual', async () => {
    // Duas respostas distinguíveis deixariam varrer chaves até uma responder
    // diferente — e cada acerto já é uma escrita na conta de outro.
    const existe = await comoVisitante(() => eventos.track(evento('page_view', { pixel_key: ids.orgB })));
    const naoExiste = await comoVisitante(() =>
      eventos.track(evento('page_view', { pixel_key: '11111111-2222-4333-8444-555555555555' })),
    );
    const lixo = await comoVisitante(() => eventos.track(evento('page_view', { pixel_key: 42 })));
    expect(existe).toEqual(RESPOSTA);
    expect(naoExiste).toEqual(existe);
    expect(lixo).toEqual(existe);
  });

  it('chave com formato inválido é recusada sem tocar no banco', async () => {
    const corpo = evento('page_view', { pixel_key: '../root' });
    expect(await comoVisitante(() => eventos.track(corpo))).toEqual(RESPOSTA);
    expect(consultas()).toEqual([]);
    expect(await admin.pixelEvent.findUnique({ where: { eventId: corpo.event_id } })).toBeNull();
  });

  it('chave presente e inutilizável (lista, número) não cai na empresa padrão', async () => {
    const naQuery = evento('page_view');
    // `?k=a&k=b`: o Express entrega lista
    expect(await comoVisitante(() => eventos.track(naQuery, ['a', 'b']))).toEqual(RESPOSTA);
    expect(await admin.pixelEvent.findUnique({ where: { eventId: naQuery.event_id } })).toBeNull();

    const noCorpo = evento('page_view', { pixel_key: 42 });
    expect(await comoVisitante(() => eventos.track(noCorpo))).toEqual(RESPOSTA);
    expect(await admin.pixelEvent.findUnique({ where: { eventId: noCorpo.event_id } })).toBeNull();

    expect(pixelTenants.contadores().inutilizavel).toBe(2);
    expect(consultas()).toEqual([]);
  });

  it('pixel sem chave (instalação antiga) cai na empresa padrão, e isso é contável', async () => {
    const corpo = evento('page_view');
    expect(await comoVisitante(() => eventos.track(corpo))).toEqual(RESPOSTA);

    const gravado = await admin.pixelEvent.findUnique({ where: { eventId: corpo.event_id } });
    expect(gravado?.orgId).toBe(ids.orgPadrao);
    expect(sobASentinela()).toEqual(['Org.findUnique']);
  });

  it('nenhuma das rotas deixou escapar consulta sem empresa', async () => {
    // Em `impor` uma consulta sem empresa LANÇA, então este caso é a rede: ele
    // prova que os casos acima passaram por resolução, e não por acaso.
    await comoVisitante(() => publico.page(handleB));
    await comoVisitante(() => eventos.track(evento('page_view', { pixel_key: ids.orgA })));
    expect(consultas()).not.toHaveLength(0);
    expect(consultas().every((v) => typeof v.org === 'string' && v.org.trim() !== '')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MD4: a mídia pública da peça — a quinta superfície sem login
// ---------------------------------------------------------------------------

/*
 * `GET /api/midia-publica/:token` não resolve a empresa por consulta: ela vem
 * do token ASSINADO. Por isso esta rota não usa a sentinela nenhuma vez, e o
 * que ela lê já roda dentro da empresa do token. Token que não confere não
 * chega ao banco — nem para resolver.
 */
describe.skipIf(!URL_BANCO)('a mídia pública da peça (MD4), com a sessão em modo impor', () => {
  let admin: PrismaClient;
  let prisma: PrismaClient;
  let midia: MidiaPublicaService;
  const segredo = `seg-${MARCA}`.padEnd(40, 'x');
  const ids = { orgA: '', orgB: '', rodadaA: '', pecaA: '' };
  const chave = `pauta/pecas/md4-${MARCA}/corte-${'a'.repeat(64)}.mp4`;

  beforeAll(async () => {
    process.env.PAUTA_MIDIA_PUBLICA_SEGREDO = segredo;
    admin = new PrismaClient({ datasourceUrl: URL_BANCO });
    prisma = clienteObservado(URL_BANCO);
    const orgA = await admin.org.create({ data: { name: `MA ${MARCA}`, slug: `md4a-${MARCA}`, modulos: ['pauta'] } });
    const orgB = await admin.org.create({ data: { name: `MB ${MARCA}`, slug: `md4b-${MARCA}`, modulos: ['pauta'] } });
    ids.orgA = orgA.id;
    ids.orgB = orgB.id;
    const rodada = await admin.pautaRodada.create({
      data: { orgId: orgA.id, titulo: 'Semana MD4', janelaIni: new Date(), janelaFim: new Date(), status: 'curada' },
    });
    ids.rodadaA = rodada.id;
    const peca = await admin.pautaPeca.create({
      data: {
        orgId: orgA.id,
        rodadaId: rodada.id,
        canal: 'instagram',
        formato: 'corte',
        status: 'aprovada',
        titulo: 'Corte',
        corpo: 'legenda',
        meta: { episodioId: 'e-md4', itemId: 'i1', formato: 'corte', imagens: [], video: { arquivo: null, duracaoSeg: 60, largura: 1080, altura: 1920, bytes: 3, chave, sha256: 'a'.repeat(64) } },
      },
    });
    ids.pecaA = peca.id;
    const storageStub = { get: async () => ({ stream: { pipe: (r: unknown) => r }, contentType: 'video/mp4', size: 3 }) };
    midia = new MidiaPublicaService(prisma as never, { log: async () => undefined } as never, storageStub as never, new ModulosService(prisma as never));
  });

  afterAll(async () => {
    delete process.env.PAUTA_MIDIA_PUBLICA_SEGREDO;
    if (!admin) return;
    await admin.pautaPeca.deleteMany({ where: { orgId: { in: [ids.orgA, ids.orgB] } } });
    await admin.pautaRodada.deleteMany({ where: { orgId: { in: [ids.orgA, ids.orgB] } } });
    await admin.org.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } });
    await admin.$disconnect();
    await (prisma as PrismaClient).$disconnect();
  });

  beforeEach(() => {
    vistos = [];
  });

  const visitante = <T>(fn: () => Promise<T>) => comContexto({ orgId: null, correlationId: novaCorrelacao('http'), origem: 'http' }, fn);
  const token = (o: { org?: string; peca?: string; chave?: string; exp?: number } = {}) =>
    assinarMidia({ orgId: o.org ?? ids.orgA, pecaId: o.peca ?? ids.pecaA, chave: o.chave ?? chave, exp: o.exp ?? Math.floor(Date.now() / 1000) + 600 }, segredo);
  const consultas = () => vistos.filter((v) => v.onde !== 'set_config');

  it('token válido: lê DENTRO da empresa do token, sem nenhuma consulta sob a sentinela', async () => {
    const arquivo = await visitante(() => midia.abrir(token()));
    expect(arquivo).toMatchObject({ contentType: 'video/mp4', size: 3 });
    expect(consultas().length).toBeGreaterThan(0);
    expect(consultas().filter((v) => ehResolucaoPublica(v.org))).toEqual([]);
    expect(new Set(consultas().map((v) => v.org))).toEqual(new Set([ids.orgA]));
    expect(consultas().map((v) => v.onde)).toContain('PautaPeca.findFirst');
  });

  it('token adulterado ou vencido: nenhuma consulta, nem de resolução', async () => {
    const [payload, mac] = token().split('.');
    const trocado = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), o: ids.orgB })).toString('base64url')}.${mac}`;
    expect(await visitante(() => midia.abrir(trocado))).toBeNull();
    const vencido = assinarMidia({ orgId: ids.orgA, pecaId: ids.pecaA, chave, exp: 1_000_010 }, segredo, 1_000_000);
    expect(await visitante(() => midia.abrir(vencido))).toBeNull();
    expect(consultas()).toEqual([]);
  });

  it('assinado para a empresa B com a peça de A: dentro de B a peça não existe', async () => {
    expect(await visitante(() => midia.abrir(token({ org: ids.orgB })))).toBeNull();
    expect(new Set(consultas().map((v) => v.org))).toEqual(new Set([ids.orgB]));
  });
});

// ---------------------------------------------------------------------------
// Isolamento por linha LIGADO DE VERDADE — opcional, ver o cabeçalho
// ---------------------------------------------------------------------------

/**
 * A conexão da APLICAÇÃO — o papel restrito, que é quem a policy alcança.
 *
 * Não dá para testar RLS pela conexão de sempre: o dono do banco descartável é
 * SUPERUSUÁRIO, e o Postgres ignora policy para superusuário mesmo com `FORCE`
 * (medido: a linha do outro tenant voltava inteira). Com o papel restrito o
 * teste vale; sem ele a seção se pula em vez de passar por engano.
 *
 *   docker exec mktos-shadow psql -U mkt -d marketing_os_test_rls \
 *     -c "ALTER ROLE mktos_app WITH LOGIN PASSWORD '<senha de teste>'"
 *   TENANT_DATABASE_URL='postgresql://mktos_app:<senha>@localhost:55432/marketing_os_test_rls'
 *
 * O papel `mktos_app` é criado pela migration `20260911020000_papel_de_aplicacao`
 * como NOLOGIN (senha é segredo de operação, não entra no repositório); o
 * `ALTER ROLE` acima é o que lhe dá uma senha LOCAL e descartável.
 */
const URL_TENANT = process.env.TENANT_DATABASE_URL ?? '';

const COM_RLS = URL_BANCO !== '' && URL_TENANT !== '' && process.env.RLS_NO_TESTE === '1';

/**
 * Registra a seção de RLS SÓ quando ela pode rodar — e por `if`, não por
 * `describe.skipIf`.
 *
 * A diferença não é estética, e custou uma CI vermelha na estabilização da onda
 * 4 (11/09/2026): `describe.skipIf(true)` COLETA os casos e os marca como
 * pulados, e a trava de cobertura do `.github/workflows/ci.yml` reprova a suíte
 * com qualquer caso pulado — de propósito, porque "pulado" quase sempre é
 * `TEST_DATABASE_URL` que não chegou e uma suíte inteira que não testou nada. No
 * job `qualidade` o `RLS_NO_TESTE` nunca está ligado (ele NÃO PODE estar: esta
 * seção liga `ROW LEVEL SECURITY` no banco inteiro, e o vitest roda os arquivos
 * em paralelo contra o mesmo banco — ver o cabeçalho). Os 15 casos daqui
 * apareceriam como pulados em toda execução e a trava reprovaria para sempre.
 *
 * Com `if`, a seção simplesmente não existe quando o interruptor está desligado:
 * nada pulado, nada a desculpar. Quem garante que ela não vire código morto é o
 * passo "Rotas públicas com o isolamento por linha LIGADO" do job `isolamento`,
 * que a roda com o interruptor ligado e reprova se ela não rodar.
 */
function descreverSeHouverRls(titulo: string, corpo: () => void): void {
  if (COM_RLS) describe(titulo, corpo);
}

/**
 * As tabelas que as rotas públicas tocam, e o que cada uma libera.
 *
 * DUAS POLICIES, NÃO UMA — é o conserto do furo que reprovou a primeira versão
 * desta fatia. Lá havia uma policy por tabela, sem `FOR`, sem `WITH CHECK`: no
 * Postgres isso é `FOR ALL`, e numa policy `FOR ALL` sem `WITH CHECK` **a
 * cláusula de leitura é reusada como verificação de escrita**. Com a sentinela
 * dentro dessa cláusula, qualquer código que rodasse sob ela podia LER as três
 * tabelas inteiras e ainda ESCREVER: trocar o destino do link de outra empresa,
 * publicar o rascunho alheio, apagar link, inserir página com empresa de outro e
 * — o pior — mudar `Org.modulos`, que é o gate de módulos inteiro (RF-T-06).
 * Medido no Postgres descartável, e reproduzido pelos casos "sob a sentinela…"
 * mais abaixo.
 *
 * Agora: LEITURA com a cláusula da sentinela (e só nas três da resolução);
 * ESCRITA com `WITH CHECK` explícito, amarrada à empresa da sessão e SEM a
 * sentinela.
 *
 * O QUE A LEITURA SOB A SENTINELA AINDA PERMITE — declarado, não escondido:
 * a tabela INTEIRA, todas as colunas. `USING` filtra linha, não coluna, e as
 * resoluções precisam alcançar qualquer linha (rascunho inclusive). O que contém
 * isso não é a policy: é o invólucro da sentinela não ser exportado, de modo que
 * SÓ as três resoluções rodam ali — cobrado caso a caso pela catraca da suíte
 * acima. A alternativa mais apertada (funções `SECURITY DEFINER` devolvendo só o
 * `orgId`, e nenhum acesso de tabela para a sentinela) está descrita em
 * `src/common/tenant-publico.ts` e é DDL — trabalho da migration da fatia 1.5.
 */
interface TabelaComPolicy {
  tabela: string;
  /** Coluna que carrega a empresa. `null` = modelo global (ver `modelos-globais.ts`). */
  coluna: string | null;
  /** A sentinela pode LER esta tabela? Só as três da resolução podem. */
  sentinelaLe?: boolean;
  /** A aplicação pode APAGAR linha aqui? */
  apagavel?: boolean;
}

const TABELAS: TabelaComPolicy[] = [
  /*
   * `Org` escreve só a PRÓPRIA linha, e não se apaga. Duas consequências que a
   * fatia 1.5 herda e precisa decidir em voz alta:
   *  · CRIAR empresa deixa de funcionar pelo papel da aplicação (a linha nova
   *    nunca é a empresa da sessão). Provisionamento é operação de dono/admin —
   *    que é onde ele já mora (`src/scripts/provisionar-tenant.ts`).
   *  · a empresa continua podendo atualizar a PRÓPRIA linha, `modulos` inclusive.
   *    Policy de linha não distingue coluna; quem tem de distinguir "ligar módulo"
   *    de "renomear a empresa" é a rota, não o banco.
   */
  { tabela: 'Org', coluna: 'id', sentinelaLe: true },
  { tabela: 'BioPage', coluna: 'orgId', sentinelaLe: true, apagavel: true },
  { tabela: 'BioLink', coluna: 'orgId', sentinelaLe: true, apagavel: true },
  { tabela: 'BioChallenge', coluna: 'orgId', apagavel: true },
  { tabela: 'BioChallengeAccount', coluna: 'orgId', apagavel: true },
  { tabela: 'BioChallengePost', coluna: 'orgId', apagavel: true },
  { tabela: 'BioChallengeSnapshot', coluna: 'orgId', apagavel: true },
  { tabela: 'PixelEvent', coluna: 'orgId', apagavel: true },
  { tabela: 'BioVisit', coluna: 'orgId', apagavel: true },
  { tabela: 'BioEvent', coluna: 'orgId', apagavel: true },
  /*
   * `BioVisitor` é GLOBAL por desenho (`common/modelos-globais.ts`): o mesmo
   * navegador visita páginas de empresas diferentes, e escopá-lo mataria a
   * deduplicação. Ele FICAVA DE FORA do rascunho — e é escrito pelo rastreio
   * público, então sem policy ele seria a tabela por onde o `impor` passaria em
   * branco. A regra possível para uma tabela global é: qualquer empresa
   * RESOLVIDA lê e escreve; a sentinela e a sessão sem empresa, não. Sem DELETE:
   * nenhum caminho da aplicação apaga visitante, e uma tabela global apagável
   * por qualquer tenant é um botão de estrago geral.
   */
  { tabela: 'BioVisitor', coluna: null },
];

const PREFIXO_DA_POLICY = 'fatia_1_4_teste';
const ATUAL = `current_setting('${GUC_TENANT}', true)`;
/** "A sessão tem empresa de verdade" — nem vazia, nem a sentinela. */
const RESOLVIDA = `${ATUAL} <> '' AND ${ATUAL} <> '${ORG_RESOLUCAO_PUBLICA}'`;

function leituraDe(t: TabelaComPolicy): string {
  if (!t.coluna) return RESOLVIDA;
  const daEmpresa = `"${t.coluna}" = ${ATUAL}`;
  return t.sentinelaLe ? `${daEmpresa} OR ${ATUAL} = '${ORG_RESOLUCAO_PUBLICA}'` : daEmpresa;
}

function escritaDe(t: TabelaComPolicy): string {
  return t.coluna ? `"${t.coluna}" = ${ATUAL} AND ${RESOLVIDA}` : RESOLVIDA;
}

function sqlDasPolicies(t: TabelaComPolicy): string[] {
  const leitura = leituraDe(t);
  const escrita = escritaDe(t);
  const sql = [
    `CREATE POLICY ${PREFIXO_DA_POLICY}_leitura ON "${t.tabela}" FOR SELECT USING (${leitura})`,
    `CREATE POLICY ${PREFIXO_DA_POLICY}_insercao ON "${t.tabela}" FOR INSERT WITH CHECK (${escrita})`,
    `CREATE POLICY ${PREFIXO_DA_POLICY}_alteracao ON "${t.tabela}" FOR UPDATE USING (${escrita}) WITH CHECK (${escrita})`,
  ];
  if (t.apagavel) {
    sql.push(`CREATE POLICY ${PREFIXO_DA_POLICY}_exclusao ON "${t.tabela}" FOR DELETE USING (${escrita})`);
  }
  return sql;
}

const SUFIXOS = ['leitura', 'insercao', 'alteracao', 'exclusao'];

descreverSeHouverRls('com isolamento por linha ligado no banco', () => {
  let admin: PrismaClient;
  let prisma: PrismaClient;
  let publico: BioPublicController;
  let eventos: EventsController;

  const marca = `rls${MARCA}`;
  const handle = `hrls${MARCA}`;
  const rid = `rid_${marca}`;
  const ids = { orgA: '', orgB: '', pageA: '', pageB: '', rascunhoB: '', linkA: '', linkB: '' };

  async function desligar() {
    for (const { tabela } of TABELAS) {
      // O nome antigo (uma policy só) também sai: banco que rodou a versão
      // anterior desta suíte pode ter ficado com ele pendurado.
      await admin.$executeRawUnsafe(`DROP POLICY IF EXISTS ${PREFIXO_DA_POLICY} ON "${tabela}"`);
      for (const s of SUFIXOS) {
        await admin.$executeRawUnsafe(
          `DROP POLICY IF EXISTS ${PREFIXO_DA_POLICY}_${s} ON "${tabela}"`,
        );
      }
      await admin.$executeRawUnsafe(`ALTER TABLE "${tabela}" NO FORCE ROW LEVEL SECURITY`);
      await admin.$executeRawUnsafe(`ALTER TABLE "${tabela}" DISABLE ROW LEVEL SECURITY`);
    }
  }

  /**
   * DEVOLVE O BANCO AO ESTADO DA MIGRATION — e é isto que `desligar()` sozinho
   * não fazia.
   *
   * Desde a fatia 1.5 o isolamento vem LIGADO do `prisma migrate deploy`, nas 72
   * tabelas, com as policies `tenant_%`. Esta seção precisa desligar as 11
   * tabelas dela para montar policies próprias (com outro nome), e o `desligar()`
   * do `afterAll` as deixava DESLIGADAS: o banco terminava a rodada em 61 de 72.
   *
   * Na integração contínua isso é inofensivo — o passo roda por último e o banco
   * é descartado. Num banco de desenvolvimento é perigoso pelo motivo exato que
   * torna policy de linha difícil de auditar: nada quebra. As 11 tabelas ficam
   * abertas, a suíte seguinte passa, e a próxima pessoa a medir isolamento
   * naquele banco mede um banco meio desligado sem saber.
   *
   * `app_rls_ligar()` existe desde a migration e religa exatamente o que tem
   * policy `tenant_%` — então ele nunca liga o que a migration não ligou, e
   * tabela nova entra sozinha. Tolerante a banco antigo (sem a função) de
   * propósito: limpeza que derruba o `afterAll` esconde o resultado da suíte.
   */
  async function religarOIsolamentoDaMigration() {
    try {
      await admin.$executeRawUnsafe(`SELECT app_rls_ligar()`);
    } catch (e) {
      console.warn(
        '[rotas-publicas] não deu para religar o isolamento da migration ' +
          `(app_rls_ligar): ${(e as Error).message}. ` +
          'O banco pode ter ficado com as 11 tabelas desta seção SEM isolamento.',
      );
    }
  }

  /**
   * Roda `fn` no estado em que a sentinela vale — é o papel do adversário: o
   * código que, de um jeito ou de outro, consegue executar sob ela.
   *
   * `async () => await fn()` e não `fn`: a promessa do Prisma é PREGUIÇOSA, e
   * devolvê-la faz a consulta começar depois de o escopo ter fechado — a mesma
   * armadilha documentada em `src/common/tenant-publico.ts`. Sem o `await` aqui,
   * estes casos passariam por `SemTenantError` em vez de passarem pela policy, e
   * o teste ficaria verde sem nunca ter chegado ao banco.
   */
  function sobASentinela<T>(fn: () => PromiseLike<T>): Promise<T> {
    return comContexto(
      { orgId: ORG_RESOLUCAO_PUBLICA, correlationId: novaCorrelacao('teste'), origem: 'http' },
      async () => await fn(),
    );
  }

  function comoVisitante<T>(fn: () => Promise<T>): Promise<T> {
    return comContexto({ orgId: null, correlationId: novaCorrelacao('http'), origem: 'http' }, fn);
  }

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: URL_BANCO });
    await admin.$connect();
    // Auto-cura: se uma rodada anterior morreu no meio, o banco pode ter ficado
    // com a policy ligada — e aí TODA suíte que usa este banco fica vermelha por
    // causa de um restinho, não de um defeito.
    await desligar();

    const a = await admin.org.create({
      data: { name: `rlsA ${marca}`, slug: `rlsa-${marca}`, modulos: ['bio'] },
    });
    const b = await admin.org.create({
      data: { name: `rlsB ${marca}`, slug: `rlsb-${marca}`, modulos: ['bio', 'pixels'] },
    });
    ids.orgA = a.id;
    ids.orgB = b.id;

    const pa = await admin.bioPage.create({
      data: { orgId: a.id, handle, titulo: 'A', publicada: true },
    });
    const pb = await admin.bioPage.create({
      data: { orgId: b.id, handle: `${handle}b`, titulo: 'B', publicada: true },
    });
    const rb = await admin.bioPage.create({
      data: { orgId: b.id, handle: `${handle}rascunho`, titulo: 'Rascunho de B', publicada: false },
    });
    ids.pageA = pa.id;
    ids.pageB = pb.id;
    ids.rascunhoB = rb.id;

    const la = await admin.bioLink.create({
      data: { orgId: a.id, pageId: pa.id, ordem: 1, tipo: 'url', rotulo: 'x', destino: 'https://a.test' },
    });
    const lb = await admin.bioLink.create({
      data: { orgId: b.id, pageId: pb.id, ordem: 1, tipo: 'url', rotulo: 'y', destino: 'https://b.test' },
    });
    ids.linkA = la.id;
    ids.linkB = lb.id;

    for (const t of TABELAS) {
      await admin.$executeRawUnsafe(`ALTER TABLE "${t.tabela}" ENABLE ROW LEVEL SECURITY`);
      // FORCE porque a suíte conecta como DONA das tabelas, e o Postgres ignora
      // policy para o dono sem isto — é a pegadinha que faz RLS "funcionar" em
      // teste e não funcionar em lugar nenhum.
      await admin.$executeRawUnsafe(`ALTER TABLE "${t.tabela}" FORCE ROW LEVEL SECURITY`);
      for (const sql of sqlDasPolicies(t)) await admin.$executeRawUnsafe(sql);
    }

    prisma = comTenantNaSessao(new PrismaClient({ datasourceUrl: URL_TENANT }), { modo: 'impor' });
    const auditStub = { log: async () => undefined };
    const bio = new BioService(
      prisma as never,
      auditStub as never,
      new BioChallengeService(prisma as never, auditStub as never) as never,
      {} as never,
    );
    publico = new BioPublicController(
      bio,
      new BioTrackingService(prisma as never),
      { get: async () => ({ stream: { pipe: (r: unknown) => r }, contentType: 'image/png', size: 3 }) } as never,
    );
    eventos = new EventsController(
      prisma as never,
      new EventsService(prisma as never),
      new PixelTenantService(prisma as never),
    );
  });

  afterAll(async () => {
    if (!admin) return;
    await desligar();
    await admin.bioEvent.deleteMany({ where: { orgId: { in: [ids.orgA, ids.orgB] } } });
    await admin.bioVisit.deleteMany({ where: { orgId: { in: [ids.orgA, ids.orgB] } } });
    await admin.bioVisitor.deleteMany({ where: { id: rid } });
    await admin.pixelEvent.deleteMany({
      where: { OR: [{ orgId: { in: [ids.orgA, ids.orgB] } }, { eventId: { startsWith: marca } }] },
    });
    await admin.bioLink.deleteMany({ where: { orgId: { in: [ids.orgA, ids.orgB] } } });
    await admin.bioPage.deleteMany({ where: { orgId: { in: [ids.orgA, ids.orgB] } } });
    await admin.org.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } });

    // DEPOIS da limpeza, nunca antes: esta conexão é a DONA das tabelas e não
    // declara empresa nenhuma. Com FORCE religado, os `deleteMany` acima
    // alcançariam ZERO linha — e a sujeira ficaria no banco em silêncio, que é
    // o defeito de sempre da policy de linha.
    await religarOIsolamentoDaMigration();

    await admin.$disconnect();
    await (prisma as PrismaClient).$disconnect();
  });

  // ---- as rotas continuam funcionando -------------------------------------

  it('a página pública continua respondendo', async () => {
    const page = await comoVisitante(() => publico.page(handle));
    expect(page.handle).toBe(handle);
  });

  it('o redirecionamento continua redirecionando', async () => {
    const estado = { destino: '', status: 0 };
    const res = {
      setHeader: () => undefined,
      removeHeader: () => undefined,
      redirect: (a: number | string, b?: string) => {
        estado.status = typeof a === 'number' ? a : 302;
        estado.destino = typeof a === 'number' ? (b ?? '') : a;
        return res;
      },
    };
    const req = {
      headers: { cookie: `rid=${rid}`, 'user-agent': 'teste' },
      originalUrl: `/api/bio/r/${ids.linkA}`,
    };
    await comoVisitante(() => publico.redirect(ids.linkA, req as never, res as never));
    expect(estado.destino).toBe('https://a.test');

    // E o clique é GRAVADO com a policy ligada: `WITH CHECK` aprova a linha
    // porque o `orgId` dela é o mesmo `app.org_id` da sessão. Sem o contexto
    // publicado, este INSERT seria recusado pelo banco.
    const limite = Date.now() + 15_000;
    let clique = null as { orgId: string } | null;
    while (!clique && Date.now() < limite) {
      clique = await admin.bioEvent.findFirst({ where: { nome: 'link_click', orgId: ids.orgA } });
      if (!clique) await new Promise((r) => setTimeout(r, 50));
    }
    expect(clique?.orgId).toBe(ids.orgA);
  });

  it('o rastreio da bio grava a TRILHA INTEIRA com a policy ligada', async () => {
    /*
     * Faltava na primeira versão, e é a rota que mais escreve: `public/track`
     * toca `BioVisitor` (tabela GLOBAL), `BioVisit`, `BioEvent` e o espelho em
     * `PixelEvent`. Três `WITH CHECK` e uma policy de tabela global de uma vez.
     */
    const r = await comoVisitante(() => publico.track({ handle, rid, url: `/${handle}` }));
    expect(r).toEqual({ ok: true });

    const limite = Date.now() + 15_000;
    let evento = null as { orgId: string; eventId: string; pageId: string } | null;
    while (!evento && Date.now() < limite) {
      evento = await admin.bioEvent.findFirst({ where: { nome: 'pageview', visitorId: rid } });
      if (!evento) await new Promise((r2) => setTimeout(r2, 50));
    }
    expect(evento?.orgId).toBe(ids.orgA);
    expect(evento?.pageId).toBe(ids.pageA);
    expect(await admin.bioVisitor.findUnique({ where: { id: rid } })).not.toBeNull();
    const espelho = await admin.pixelEvent.findUnique({ where: { eventId: evento!.eventId } });
    expect(espelho?.orgId).toBe(ids.orgA);
  });

  it('o avatar continua sendo servido, com a empresa resolvida', async () => {
    const entregue = { tipo: '' };
    const res = {
      setHeader: (k: string, v: unknown) => {
        if (k === 'Content-Type') entregue.tipo = String(v);
      },
      removeHeader: () => undefined,
      redirect: () => res,
    };
    await comoVisitante(() => publico.avatar(`${ids.pageA}-a1b2c3d4e5f6.png`, res as never));
    expect(entregue.tipo).toBe('image/png');
  });

  it('o pixel continua gravando, e na empresa da chave', async () => {
    const corpo = {
      event_name: 'page_view',
      event_id: `${marca}-um`,
      session_id: 's',
      anonymous_id: 'a',
      pixel_key: ids.orgB,
    };
    expect(await comoVisitante(() => eventos.track(corpo))).toEqual({ ok: true });
    // a leitura de conferência é do ADMIN, que a policy não alcança fora do teste
    const gravado = await admin.pixelEvent.findUnique({ where: { eventId: corpo.event_id } });
    expect(gravado?.orgId).toBe(ids.orgB);
  });

  // ---- e o banco recusa ---------------------------------------------------

  it('e o banco — não o TypeScript — recusa a linha do outro tenant', async () => {
    const daOutra = await comTenantPublico(ids.orgA, () =>
      prisma.bioPage.findUnique({ where: { handle: `${handle}b` } }),
    );
    expect(daOutra).toBeNull();

    const minha = await comTenantPublico(ids.orgA, () =>
      prisma.bioPage.findUnique({ where: { handle } }),
    );
    expect(minha?.id).toBe(ids.pageA);
  });

  it('dentro de um tenant, escrever na empresa do outro é recusado pelo banco', async () => {
    const alterou = await comTenantPublico(ids.orgA, () =>
      prisma.$executeRawUnsafe(
        `UPDATE "BioLink" SET destino = 'https://sequestrado.test' WHERE id = $1`,
        ids.linkB,
      ),
    );
    expect(alterou).toBe(0);
  });

  it('sob a sentinela a resolução ENXERGA — é o contrato com a fatia 1.5', async () => {
    const solta = await sobASentinela(() => prisma.bioPage.findMany({ where: { handle } }));
    expect(solta).toHaveLength(1);

    // e uma empresa qualquer não enxerga nada
    const nada = await comTenantPublico('00000000-0000-4000-8000-000000000000', () =>
      prisma.bioPage.findMany({ where: { handle } }),
    );
    expect(nada).toHaveLength(0);
  });

  it('sob a sentinela a leitura é da TABELA INTEIRA — declarado, e é por isso que ela não é exportada', async () => {
    // Não é o comportamento desejável; é o que policy de LINHA consegue dar. A
    // contenção é não haver como rodar código arbitrário aqui dentro (ver o
    // cabeçalho de `src/common/tenant-publico.ts`).
    const todas = await sobASentinela(() =>
      prisma.bioPage.findMany({ where: { orgId: { in: [ids.orgA, ids.orgB] } } }),
    );
    expect(todas.length).toBe(3);
    expect(todas.some((p) => p.id === ids.rascunhoB)).toBe(true);
  });

  describe('sob a sentinela NÃO se escreve — o furo que reprovou a primeira versão', () => {
    it('não troca o destino do link de outra empresa', async () => {
      const alterou = await sobASentinela(() =>
        prisma.$executeRawUnsafe(
          `UPDATE "BioLink" SET destino = 'https://atacante.test' WHERE id = $1`,
          ids.linkB,
        ),
      );
      expect(alterou).toBe(0);
      const link = await admin.bioLink.findUnique({ where: { id: ids.linkB } });
      expect(link?.destino).toBe('https://b.test');
    });

    it('não publica o rascunho alheio', async () => {
      const alterou = await sobASentinela(() =>
        prisma.$executeRawUnsafe(`UPDATE "BioPage" SET publicada = true WHERE id = $1`, ids.rascunhoB),
      );
      expect(alterou).toBe(0);
      const page = await admin.bioPage.findUnique({ where: { id: ids.rascunhoB } });
      expect(page?.publicada).toBe(false);
    });

    it('não insere página com a empresa de outro', async () => {
      await expect(
        sobASentinela(() =>
          prisma.$executeRawUnsafe(
            `INSERT INTO "BioPage" (id, "orgId", handle, titulo, publicada, "atualizadaEm")
               VALUES ($1, $2, $3, 'intrusa', true, now())`,
            `intrusa-${marca}`,
            ids.orgB,
            `intrusa-${marca}`,
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
      expect(await admin.bioPage.findUnique({ where: { id: `intrusa-${marca}` } })).toBeNull();
    });

    it('não apaga link de outra empresa', async () => {
      const apagou = await sobASentinela(() =>
        prisma.$executeRawUnsafe(`DELETE FROM "BioLink" WHERE id = $1`, ids.linkB),
      );
      expect(apagou).toBe(0);
      expect(await admin.bioLink.findUnique({ where: { id: ids.linkB } })).not.toBeNull();
    });

    it('NÃO MUDA A LISTA DE MÓDULOS de outra empresa — a sentinela não desfaz o gate', async () => {
      const alterou = await sobASentinela(() =>
        prisma.$executeRawUnsafe(
          `UPDATE "Org" SET modulos = ARRAY['bio','pixels','financeiro'] WHERE id = $1`,
          ids.orgA,
        ),
      );
      expect(alterou).toBe(0);
      const org = await admin.org.findUnique({ where: { id: ids.orgA } });
      expect(org?.modulos).toEqual(['bio']);
    });
  });

  it('a tabela GLOBAL de visitantes exige empresa resolvida — sentinela não escreve nela', async () => {
    await expect(
      sobASentinela(() =>
        prisma.$executeRawUnsafe(`INSERT INTO "BioVisitor" (id) VALUES ($1)`, `intruso-${marca}`),
      ),
    ).rejects.toThrow(/row-level security/i);

    // e dentro de uma empresa resolvida, escreve — que é como o rastreio grava
    const inseriu = await comTenantPublico(ids.orgA, () =>
      prisma.$executeRawUnsafe(`INSERT INTO "BioVisitor" (id) VALUES ($1)`, `visitante-${marca}`),
    );
    expect(inseriu).toBe(1);
    await admin.bioVisitor.deleteMany({ where: { id: `visitante-${marca}` } });
  });
});
