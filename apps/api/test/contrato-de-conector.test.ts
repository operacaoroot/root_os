/**
 * O CONTRATO ÚNICO DE CONECTOR — RF-X-01, RF-X-02, RF-X-06 (fatia 5.4)
 * ====================================================================
 *
 * O que esta suíte cobra, na ordem em que a fatia pede:
 *
 *   1. ESTADO HONESTO. `conectado` só existe depois de uma TENTATIVA contra a
 *      dependência real. Verde declarado é rebaixado, com grito;
 *   2. SAÚDE É POR EMPRESA. O aplicativo ter credencial não deixa verde a
 *      empresa que nunca autorizou — a armadilha que já aconteceu nesta
 *      execução, encenada aqui contra o `GoogleService` de verdade;
 *   3. DEGRADAÇÃO. Derrubar um conector (estourando ou pendurando) marca SÓ ele
 *      em vermelho; os outros continuam respondendo e a tela não cai;
 *   4. DESLIGAR ≠ REVOGAR. Desligar é pausa e nem sequer SONDA (sondar sairia da
 *      casa); revogar queima e funciona mesmo com o conector desligado;
 *   5. CONECTOR NOVO NO CATÁLOGO SEM TOCAR NO NÚCLEO. Um conector fictício que
 *      mora só em `test/` aparece na tela — e a prova de que o núcleo não foi
 *      tocado é uma VARREDURA, não a palavra de quem escreveu.
 *
 * SEM BANCO E SEM NEST, de propósito e por necessidade: nada que dependa de
 * injeção funciona sob vitest (o esbuild não emite `emitDecoratorMetadata`). Os
 * serviços são construídos à mão, como em `conector-desligado.test.ts` — o que
 * se mede aqui é a decisão, não a fiação do módulo.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONNECTORS } from '@mktos/shared';

import {
  MOTIVO_DE_LATENCIA_INVALIDA,
  MOTIVO_DE_REBAIXAMENTO,
  VERBOS_DO_CONTRATO,
  carimbarMedicao,
  conectado,
  erroDeConector,
  frasedoErro,
  naoConfigurado,
  naoVerificado,
  normalizarSaude,
} from '../src/integrations/contrato-de-conector';
import {
  CONECTORES_DO_CONTRATO,
  ConectorForaDoContratoError,
  PRAZO_DA_CHAMADA_DE_SONDA_MS,
  RegistroDeConectores,
  TEMPO_LIMITE_DE_SONDA_MS,
  VALIDADE_DA_SONDA_MS,
} from '../src/integrations/conectores.registry';
import { revogacaoFoiSuperada } from '../src/integrations/revogacao-superada';
import { GoogleConexaoController } from '../src/google/google-conexao.controller';
import { ObsidianService } from '../src/obsidian/obsidian.service';
import {
  EvolutionService,
  PRAZO_DA_CONSULTA_DE_INSTANCIA_MS,
} from '../src/pauta/evolution.service';
import { SegredoIndisponivelError } from '../src/cofre/cofre.service';
import type { CofreService } from '../src/cofre/cofre.service';
import { NOMES_CONHECIDOS } from '../src/cofre/segredo';
import { CONECTOR_DO_GOOGLE } from '../src/cofre/migrar-credenciais';
import { comContexto, contextoAtual, novaCorrelacao } from '../src/common/contexto-execucao';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { ConectoresConfiguradosRegistry, CONECTORES_QUE_DEVEM_RESPONDER } from '../src/gateway/conectores-configurados.registry';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { GoogleService } from '../src/google/google.service';
import type { AuditService } from '../src/audit/audit.service';
import type { ConectoresService } from '../src/integrations/conectores.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  CHAVE_FICTICIA,
  conectorDeProcesso,
  conectorFicticio,
  conectorPendurado,
  conectorQuebrado,
  conectorQueRejeitaNaCara,
  conectorSaudavel,
} from './conector-ficticio';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';

const EMPRESA = 'org-um';
const OUTRA = 'org-dois';

/** Prazo curto para as sondas da suíte. Ver `RegistroDeConectores.sondar`. */
const PRAZO = 60;

// ---------------------------------------------------------------------------
// SEÇÃO 1 — os três estados, e o verde que não pode ser inventado
// ---------------------------------------------------------------------------

describe('contrato: estado honesto (RF-X-02)', () => {
  it('verde só nasce de tentativa, com latência medida', () => {
    const s = conectado(42, 'respondeu');
    expect(s.estado).toBe('conectado');
    expect(s.apuracao).toBe('tentativa');
    expect(s.latenciaMs).toBe(42);
  });

  it('"não configurado" é declaração, nunca verde, e SEMPRE diz o motivo', () => {
    const s = naoConfigurado('falta a credencial X no ambiente');
    expect(s.estado).toBe('nao_configurado');
    expect(s.apuracao).toBe('declaracao');
    expect(s.mensagem).toBe('falta a credencial X no ambiente');
  });

  it('erro carrega a mensagem REAL, e vira "tentativa" quando a sonda chegou a sair', () => {
    expect(erroDeConector('HTTP 401 do fornecedor', 15)).toMatchObject({
      estado: 'erro',
      mensagem: 'HTTP 401 do fornecedor',
      apuracao: 'tentativa',
      latenciaMs: 15,
    });
    // Sem latência: a falha foi local, antes de sair.
    expect(erroDeConector('credencial ilegível').apuracao).toBe('declaracao');
  });

  it('"não verificado" não é cor: nunca é conectado nem erro', () => {
    const s = naoVerificado('o conector está desligado para esta empresa');
    expect(s.estado).toBe('nao_verificado');
    expect(s.apuracao).toBe('nao_verificado');
    expect(s.latenciaMs).toBeNull();
  });

  /*
   * A CATRACA DA LUZ VERDE FALSA. Este é o defeito mais fácil de escrever por
   * acidente — e o que já fez a tela dizer "conectado" sobre empresa que nunca
   * autorizou nada. Rebaixar para ERRO (e não para cinza) é deliberado: cinza é
   * fácil de ignorar por meses, e isto é defeito de programação.
   */
  it('verde SEM tentativa é rebaixado para erro, com a explicação', () => {
    const mentira = normalizarSaude({
      estado: 'conectado',
      mensagem: 'confie em mim',
      apuracao: 'declaracao',
      verificadoEm: new Date().toISOString(),
      latenciaMs: null,
    });
    expect(mentira.estado).toBe('erro');
    expect(mentira.mensagem).toBe(MOTIVO_DE_REBAIXAMENTO);
  });

  it('verde COM tentativa passa intacto', () => {
    const bom = conectado(3, 'ok');
    expect(normalizarSaude(bom)).toEqual(bom);
  });

  it('a frase do erro sobrevive a qualquer coisa que seja lançada', () => {
    expect(frasedoErro(new Error('caiu'))).toBe('caiu');
    expect(frasedoErro('texto solto')).toBe('texto solto');
    // `String({})` daria "[object Object]", que é a forma mais eficiente de
    // esconder a causa de quem está diagnosticando.
    expect(frasedoErro({ codigo: 503 })).toContain('503');
  });
});

// ---------------------------------------------------------------------------
// SEÇÃO 2 — o registro: catraca de dono e trava de arranque
// ---------------------------------------------------------------------------

describe('registro do contrato: catracas', () => {
  it('os quatro verbos são exatamente estes', () => {
    expect([...VERBOS_DO_CONTRATO]).toEqual(['autorizar', 'sincronizar', 'saude', 'revogar']);
  });

  it('dois donos para a mesma chave LANÇA, nomeando os dois', () => {
    const reg = new RegistroDeConectores();
    reg.registrar(conectorSaudavel('x'), 'ServicoA');
    expect(() => reg.registrar(conectorSaudavel('x'), 'ServicoB')).toThrowError(
      /"ServicoA".*"ServicoB"|"ServicoB".*"ServicoA"/s,
    );
  });

  it('duas chaves reivindicando a MESMA linha do catálogo também LANÇA', () => {
    const reg = new RegistroDeConectores();
    reg.registrar({ ...conectorSaudavel('meta'), linhasDoCatalogo: ['instagram'] }, 'MetaService');
    expect(() =>
      reg.registrar({ ...conectorSaudavel('outro'), linhasDoCatalogo: ['instagram'] }, 'Outro'),
    ).toThrowError(/instagram/);
  });

  it('o arranque DERRUBA quando um conector cobrado não se inscreve', () => {
    const reg = new RegistroDeConectores();
    reg.registrar(conectorSaudavel('google'), 'GoogleService');
    expect(() => reg.onApplicationBootstrap()).toThrowError(/meta|obsidian|clickup|whatsapp/);
  });

  it('o arranque PASSA quando os cinco estão inscritos', () => {
    const reg = new RegistroDeConectores();
    for (const chave of CONECTORES_DO_CONTRATO) reg.registrar(conectorSaudavel(chave), 'x');
    expect(() => reg.onApplicationBootstrap()).not.toThrow();
    expect(reg.inscritos).toEqual([...CONECTORES_DO_CONTRATO].sort());
  });

  /*
   * A ARMADILHA Nº 3 DA FATIA, congelada. Se o conector fictício entrasse na
   * lista cobrada, ele passaria a ser obrigatório em produção — e o dia em que o
   * artefato de teste não fosse empacotado (que é todo dia, porque `test/` fica
   * fora do tsconfig de build) a API não subiria.
   */
  it('o conector fictício NÃO está em nenhuma lista cobrada no arranque', () => {
    expect(CONECTORES_DO_CONTRATO).not.toContain(CHAVE_FICTICIA);
    expect(CONECTORES_QUE_DEVEM_RESPONDER).not.toContain(CHAVE_FICTICIA);
  });

  it('chave fora do contrato é 400 com a lista do que existe, não 500', () => {
    const reg = new RegistroDeConectores();
    reg.registrar(conectorSaudavel('google'), 'GoogleService');
    expect(() => reg.exigir('nao-existe')).toThrowError(ConectorForaDoContratoError);
    try {
      reg.exigir('nao-existe');
    } catch (e) {
      expect((e as Error).message).toContain('google');
    }
  });

  it('a linha do catálogo encontra o dono da credencial que a cobre', () => {
    const reg = new RegistroDeConectores();
    const google = { ...conectorSaudavel('google'), linhasDoCatalogo: ['gmail', 'gcal', 'gdocs', 'drive'] };
    reg.registrar(google, 'GoogleService');
    expect(reg.donoDaLinha('gmail')?.chave).toBe('google');
    expect(reg.donoDaLinha('drive')?.chave).toBe('google');
    expect(reg.donoDaLinha('instagram')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SEÇÃO 3 — degradação: um conector fora do ar degrada SÓ o que depende dele
// ---------------------------------------------------------------------------

describe('registro do contrato: degradação isolada', () => {
  it('conector que ESTOURA vira erro com a mensagem real, e não derruba a sonda', async () => {
    const reg = new RegistroDeConectores();
    reg.registrar(conectorQuebrado('q'), 'Quebrado');
    const s = await reg.sondar({ orgId: EMPRESA, chave: 'q', prazoMs: PRAZO });
    expect(s.estado).toBe('erro');
    expect(s.mensagem).toContain('503');
    expect(s.mensagem).toContain('manutenção programada');
    // Houve tentativa: é o que distingue "tentei e falhou" de "nem tentei".
    expect(s.apuracao).toBe('tentativa');
  });

  it('conector PENDURADO vira erro de prazo em vez de segurar a tela', async () => {
    const reg = new RegistroDeConectores();
    reg.registrar(conectorPendurado('p'), 'Pendurado');
    const s = await reg.sondar({ orgId: EMPRESA, chave: 'p', prazoMs: PRAZO });
    expect(s.estado).toBe('erro');
    expect(s.mensagem).toContain('passou de');
  });

  it('um conector quebrado, um pendurado e um saudável: só os dois primeiros ficam vermelhos', async () => {
    const reg = new RegistroDeConectores();
    reg.registrar(conectorQuebrado('q'), 'Quebrado');
    reg.registrar(conectorPendurado('p'), 'Pendurado');
    reg.registrar(conectorSaudavel('s'), 'Saudavel');

    const r = await reg.sondarVarios([
      { orgId: EMPRESA, chave: 'q', prazoMs: PRAZO },
      { orgId: EMPRESA, chave: 'p', prazoMs: PRAZO },
      { orgId: EMPRESA, chave: 's', prazoMs: PRAZO },
    ]);

    expect(r.get('q')?.estado).toBe('erro');
    expect(r.get('p')?.estado).toBe('erro');
    expect(r.get('s')?.estado).toBe('conectado');
  });

  it('verde declarado por um conector é rebaixado pelo REGISTRO, não só pela função pura', async () => {
    const reg = new RegistroDeConectores();
    reg.registrar({ ...conectorFicticio({ sonda: 'verde-sem-sonda' }), chave: 'm' }, 'Mentiroso');
    const s = await reg.sondar({ orgId: EMPRESA, chave: 'm', prazoMs: PRAZO });
    expect(s.estado).toBe('erro');
    expect(s.mensagem).toBe(MOTIVO_DE_REBAIXAMENTO);
  });

  it('conector DESLIGADO não é sondado — nada sai da casa', async () => {
    const chamadas: Record<string, number> = {};
    const reg = new RegistroDeConectores();
    reg.registrar({ ...conectorFicticio({ chamadas }), chave: 'd' }, 'Desligado');

    const s = await reg.sondar({
      orgId: EMPRESA,
      chave: 'd',
      desligadoPorque: '"X" está desligado para esta empresa desde ontem.',
      prazoMs: PRAZO,
    });

    expect(s.estado).toBe('nao_verificado');
    expect(s.mensagem).toContain('Nada foi chamado');
    // A prova de que não saiu: o verbo nunca foi chamado.
    expect(chamadas.saude ?? 0).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SEÇÃO 4 — a saúde é POR EMPRESA (a armadilha nº 1), contra o Google de verdade
// ---------------------------------------------------------------------------

/**
 * Monta o `GoogleService` de verdade com um Prisma de mentira.
 *
 * É o conector real que interessa aqui: a armadilha que esta fatia tem de fechar
 * aconteceu NELE — a tela passou a exibir o Google como conectado em empresa que
 * nunca autorizou nada, porque a pergunta respondida era "o aplicativo tem
 * credencial", verdadeira em produção para todo mundo.
 */
function montarGoogle(conta: {
  accessToken?: string;
  refreshToken?: string | null;
  expiresAt?: Date;
  email?: string | null;
} | null) {
  const contrato = new RegistroDeConectores();
  const prisma = {
    googleAccount: {
      findUnique: async () =>
        conta
          ? {
              orgId: EMPRESA,
              email: conta.email ?? 'alguem@exemplo.com',
              accessToken: conta.accessToken ?? 'token-de-mentira',
              refreshToken: conta.refreshToken ?? null,
              tokenType: 'Bearer',
              scope: 'https://www.googleapis.com/auth/gmail.send',
              expiresAt: conta.expiresAt ?? new Date(Date.now() + 3600_000),
              connectedAt: new Date(),
            }
          : null,
      update: async () => ({}),
      deleteMany: async () => ({ count: 0 }),
    },
    integrationAccount: {
      findFirst: async () => null,
      create: async () => ({}),
      update: async () => ({}),
    },
  } as unknown as PrismaService;
  const audit = { log: async () => {} } as unknown as AuditService;

  const svc = new GoogleService(prisma, audit, new EfeitosRegistry(), contrato);
  svc.onModuleInit();
  return { contrato, svc };
}

describe('saúde é POR EMPRESA — a armadilha do Google', () => {
  const antes = { ...process.env };

  beforeEach(() => {
    // O aplicativo TEM credencial: é exatamente a condição em que o defeito
    // antigo pintava tudo de verde.
    process.env.GOOGLE_CLIENT_ID = 'id-de-mentira';
    process.env.GOOGLE_CLIENT_SECRET = 'segredo-de-mentira';
  });

  afterEach(() => {
    process.env = { ...antes };
    vi.unstubAllGlobals();
  });

  it('app configurado + empresa que NUNCA autorizou = não configurado, e NENHUMA chamada externa', async () => {
    const buscou = vi.fn();
    vi.stubGlobal('fetch', buscou);

    const { contrato } = montarGoogle(null);
    const s = await contrato.sondar({ orgId: EMPRESA, chave: 'google', prazoMs: 500 });

    expect(s.estado).toBe('nao_configurado');
    expect(s.estado).not.toBe('conectado');
    expect(s.mensagem).toContain('não autorizou');
    // Sem autorização não há o que sondar: nada saiu da casa.
    expect(buscou).not.toHaveBeenCalled();
  });

  it('empresa autorizada + fornecedor respondendo = verde, e o verde é de TENTATIVA', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ email: 'pedro@exemplo.com' }),
        text: async () => '',
      })),
    );

    const { contrato } = montarGoogle({ email: 'pedro@exemplo.com' });
    const s = await contrato.sondar({ orgId: EMPRESA, chave: 'google', prazoMs: 500 });

    expect(s.estado).toBe('conectado');
    expect(s.apuracao).toBe('tentativa');
    expect(s.mensagem).toContain('pedro@exemplo.com');
  });

  it('empresa autorizada + fornecedor recusando = vermelho com a mensagem REAL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({}),
        text: async () => '{"error":"invalid_credentials"}',
      })),
    );

    const { contrato } = montarGoogle({});
    const s = await contrato.sondar({ orgId: EMPRESA, chave: 'google', prazoMs: 500 });

    expect(s.estado).toBe('erro');
    expect(s.mensagem).toContain('401');
    // A mensagem real do fornecedor chega inteira até a tela.
    expect(s.mensagem).toContain('invalid_credentials');
    // E o conserto vai junto, em português.
    expect(s.mensagem).toContain('conectar de novo');
  });

  it('o Google declara as quatro superfícies e uma credencial só', async () => {
    const { contrato } = montarGoogle(null);
    const g = contrato.obter('google');
    expect(g?.escopoDaCredencial).toBe('empresa');
    expect([...(g?.linhasDoCatalogo ?? [])].sort()).toEqual(['drive', 'gcal', 'gdocs', 'gmail']);
  });
});

// ---------------------------------------------------------------------------
// SEÇÃO 5 — o catálogo: conector novo sem tocar no núcleo, e degradação na tela
// ---------------------------------------------------------------------------

interface Fakes {
  svc: IntegrationsService;
  contrato: RegistroDeConectores;
  desligados: Map<string, { motivo: string | null; desligadoPor: string | null; desligadoEm: Date }>;
  exigidos: string[];
}

function montarCatalogo(): Fakes {
  const contrato = new RegistroDeConectores();
  const desligados = new Map<
    string,
    { motivo: string | null; desligadoPor: string | null; desligadoEm: Date }
  >();
  const exigidos: string[] = [];

  const prisma = {
    integrationAccount: { findMany: async () => [] },
  } as unknown as PrismaService;
  const audit = { log: async () => {} } as unknown as AuditService;
  const conectores = {
    desligados: async () => desligados,
    exigirLigado: async (e: { conector?: string | null }) => {
      exigidos.push(e.conector ?? '');
      if (desligados.has(e.conector ?? '')) {
        throw new Error(`conector "${e.conector}" desligado`);
      }
    },
  } as unknown as ConectoresService;

  const svc = new IntegrationsService(
    prisma,
    audit,
    conectores,
    new ConectoresConfiguradosRegistry(),
    contrato,
  );
  return { svc, contrato, desligados, exigidos };
}

describe('catálogo de conexões: o contrato na tela', () => {
  it('conector fictício aparece no catálogo, com o rótulo e a categoria que ELE declara', async () => {
    const { svc, contrato } = montarCatalogo();
    contrato.registrar(conectorFicticio(), 'SuiteDoContrato');

    const cat = await svc.catalog(EMPRESA, { prazoDeSondaMs: PRAZO });
    const linha = cat.items.find((i) => i.key === CHAVE_FICTICIA);

    expect(linha, 'o conector fictício não apareceu no catálogo').toBeTruthy();
    expect(linha!.label).toBe('Conector fictício (suíte)');
    expect(linha!.category).toBe('teste');
    expect(linha!.saude?.estado).toBe('conectado');
    expect(linha!.contrato?.chave).toBe(CHAVE_FICTICIA);
    // Credencial por empresa ⇒ `authType` derivado é OAuth, e a tela oferece revogar.
    expect(linha!.authType).toBe('oauth2');
  });

  /*
   * A PROVA DE QUE O NÚCLEO NÃO FOI TOCADO — e ela é uma VARREDURA, não a
   * palavra de quem escreveu o teste. Se algum dia alguém "consertar" o
   * catálogo acrescentando a chave fictícia em `CONNECTORS`, ou um caso especial
   * em `integrations.service.ts`, esta asserção reprova e a promessa do RF-X-06
   * volta a ser verdadeira ou deixa de ser afirmada.
   */
  it('o núcleo não conhece o conector fictício', () => {
    expect(CONNECTORS.map((c) => c.key)).not.toContain(CHAVE_FICTICIA);

    const raiz = acharRaizDoRepo();
    const alvos = [
      path.join(raiz, 'apps', 'api', 'src'),
      path.join(raiz, 'packages', 'shared', 'src'),
      path.join(raiz, 'apps', 'web', 'src'),
    ];
    const citam = alvos
      .filter((d) => existsSync(d))
      .flatMap((d) => varrer(d))
      .filter((arquivo) => readFileSync(arquivo, 'utf8').includes(CHAVE_FICTICIA))
      .map((a) => path.relative(raiz, a));

    expect(
      citam,
      'O conector fictício vazou para o núcleo. A prova de "conector novo entra sem tocar no ' +
        'núcleo" deixa de valer no instante em que o núcleo precisa conhecê-lo.',
    ).toEqual([]);
  });

  it('derrubar um conector marca SÓ ele em vermelho; os outros continuam verdes', async () => {
    const { svc, contrato } = montarCatalogo();
    contrato.registrar(conectorSaudavel('bom'), 'Bom');
    contrato.registrar(conectorQuebrado('ruim'), 'Ruim');
    contrato.registrar(conectorPendurado('lento'), 'Lento');

    const cat = await svc.catalog(EMPRESA, { prazoDeSondaMs: PRAZO });
    const porChave = new Map(cat.items.map((i) => [i.key, i]));

    expect(porChave.get('bom')?.saude?.estado).toBe('conectado');
    expect(porChave.get('ruim')?.saude?.estado).toBe('erro');
    expect(porChave.get('lento')?.saude?.estado).toBe('erro');

    // E a tela inteira continua de pé: as dezesseis linhas do catálogo estático
    // vieram junto, sem nenhuma exceção ter escapado.
    for (const c of CONNECTORS) {
      expect(porChave.has(c.key), `a linha "${c.key}" sumiu do catálogo`).toBe(true);
    }
  });

  it('o status legado passa a vir da sonda, para os dois nunca se contradizerem', async () => {
    const { svc, contrato } = montarCatalogo();
    contrato.registrar(conectorSaudavel('bom'), 'Bom');
    contrato.registrar(conectorQuebrado('ruim'), 'Ruim');

    const cat = await svc.catalog(EMPRESA, { prazoDeSondaMs: PRAZO });
    const porChave = new Map(cat.items.map((i) => [i.key, i]));

    expect(porChave.get('bom')?.status).toBe('connected');
    expect(porChave.get('ruim')?.status).toBe('error');
    // E o erro da SONDA tem precedência sobre o último erro de sincronização.
    expect(porChave.get('ruim')?.lastError).toContain('503');
  });

  it('uma credencial, quatro linhas: a sonda roda UMA vez e o resultado se espalha', async () => {
    const { svc, contrato } = montarCatalogo();
    const chamadas: Record<string, number> = {};
    contrato.registrar(
      {
        ...conectorFicticio({ chamadas }),
        chave: 'google',
        linhasDoCatalogo: ['gmail', 'gcal', 'gdocs', 'drive'],
      },
      'GoogleDeMentira',
    );

    const cat = await svc.catalog(EMPRESA, { prazoDeSondaMs: PRAZO });
    const linhas = cat.items.filter((i) => ['gmail', 'gcal', 'gdocs', 'drive'].includes(i.key));

    expect(linhas).toHaveLength(4);
    for (const l of linhas) expect(l.saude?.estado).toBe('conectado');
    expect(chamadas.saude, 'sondou mais de uma vez a mesma credencial').toBe(1);
    // E cada linha sabe quem são as irmãs, para a tela poder dizer que o erro é o mesmo.
    expect(linhas.find((l) => l.key === 'gmail')!.contrato!.linhasIrmas.sort()).toEqual([
      'drive',
      'gcal',
      'gdocs',
    ]);
  });

  it('DESLIGAR uma superfície do grupo impede a sonda do grupo inteiro (falha fechado)', async () => {
    const { svc, contrato, desligados } = montarCatalogo();
    const chamadas: Record<string, number> = {};
    contrato.registrar(
      {
        ...conectorFicticio({ chamadas }),
        chave: 'google',
        linhasDoCatalogo: ['gmail', 'gcal', 'gdocs', 'drive'],
      },
      'GoogleDeMentira',
    );
    desligados.set('gmail', {
      motivo: 'suspeita de vazamento',
      desligadoPor: 'pedro',
      desligadoEm: new Date('2026-09-10T12:00:00Z'),
    });

    const cat = await svc.catalog(EMPRESA, { prazoDeSondaMs: PRAZO });
    const gmail = cat.items.find((i) => i.key === 'gmail')!;
    const drive = cat.items.find((i) => i.key === 'drive')!;

    // Nenhuma das quatro é sondada: as quatro compartilham o par de tokens.
    expect(chamadas.saude ?? 0).toBe(0);
    expect(gmail.saude?.estado).toBe('nao_verificado');
    expect(drive.saude?.estado).toBe('nao_verificado');
    expect(gmail.saude?.mensagem).toContain('suspeita de vazamento');
    // O desligamento continua sendo uma CAMADA por cima, não o status.
    expect(gmail.desligado).toBe(true);
    expect(drive.desligado).toBe(false);
  });

  it('`sondar: false` não inventa verde nenhum', async () => {
    const { svc, contrato } = montarCatalogo();
    contrato.registrar(conectorSaudavel('bom'), 'Bom');
    const cat = await svc.catalog(EMPRESA, { sondar: false });
    const bom = cat.items.find((i) => i.key === 'bom')!;
    expect(bom.saude?.estado).toBe('nao_verificado');
  });
});

// ---------------------------------------------------------------------------
// SEÇÃO 6 — desligar é pausa, revogar é queimar
// ---------------------------------------------------------------------------

describe('desligar ≠ revogar', () => {
  it('SINCRONIZAR pergunta ao interruptor antes de sair da casa', async () => {
    const { svc, contrato, exigidos } = montarCatalogo();
    contrato.registrar(conectorFicticio(), 'Ficticio');

    const r = await svc.sincronizar(EMPRESA, CHAVE_FICTICIA, 'pedro');
    expect(r).toMatchObject({ tipo: 'feito' });
    expect(exigidos).toContain(CHAVE_FICTICIA);
  });

  it('SINCRONIZAR de conector desligado é recusado antes de qualquer chamada', async () => {
    const { svc, contrato, desligados } = montarCatalogo();
    const chamadas: Record<string, number> = {};
    contrato.registrar(conectorFicticio({ chamadas }), 'Ficticio');
    desligados.set(CHAVE_FICTICIA, {
      motivo: 'incidente',
      desligadoPor: 'pedro',
      desligadoEm: new Date(),
    });

    await expect(svc.sincronizar(EMPRESA, CHAVE_FICTICIA, 'pedro')).rejects.toThrow(/desligado/);
    expect(chamadas.sincronizar ?? 0).toBe(0);
  });

  /*
   * REVOGAR FUNCIONA COM O CONECTOR DESLIGADO, e é deliberado: desligou por
   * suspeita de vazamento, confirmou, agora queima. Recusar aqui obrigaria a
   * RELIGAR o conector para poder queimar a credencial dele — a sequência mais
   * perigosa possível num incidente.
   */
  it('REVOGAR funciona mesmo com o conector desligado', async () => {
    const { svc, contrato, desligados } = montarCatalogo();
    contrato.registrar(conectorFicticio(), 'Ficticio');
    desligados.set(CHAVE_FICTICIA, {
      motivo: 'incidente',
      desligadoPor: 'pedro',
      desligadoEm: new Date(),
    });

    const r = await svc.revogar(EMPRESA, CHAVE_FICTICIA, 'pedro', 'token vazou');
    expect(r).toMatchObject({ tipo: 'revogado', segredos: ['access_token'] });
  });

  it('AUTORIZAR também não é trancado pelo desligamento — senão ele trancaria a porta por dentro', async () => {
    const { svc, contrato, desligados } = montarCatalogo();
    contrato.registrar(conectorFicticio(), 'Ficticio');
    desligados.set(CHAVE_FICTICIA, {
      motivo: 'incidente',
      desligadoPor: 'pedro',
      desligadoEm: new Date(),
    });

    const r = await svc.autorizar(EMPRESA, CHAVE_FICTICIA, 'pedro');
    expect(r).toMatchObject({ tipo: 'redirecionar' });
  });

  it('credencial de PROCESSO recusa revogar por empresa e aponta o desligamento', async () => {
    const { svc, contrato } = montarCatalogo();
    contrato.registrar(conectorDeProcesso('proc'), 'Processo');

    const r = await svc.revogar(EMPRESA, 'proc', 'pedro', null);
    expect(r.tipo).toBe('nao_se_aplica');
    expect(r.tipo === 'nao_se_aplica' && r.motivo).toContain('DESLIGUE');
  });

  it('a tela sabe de quem é a credencial, para não oferecer o botão errado', async () => {
    const { svc, contrato } = montarCatalogo();
    contrato.registrar(conectorDeProcesso('proc'), 'Processo');
    contrato.registrar(conectorFicticio(), 'Ficticio');

    const cat = await svc.catalog(EMPRESA, { prazoDeSondaMs: PRAZO });
    const porChave = new Map(cat.items.map((i) => [i.key, i]));
    expect(porChave.get('proc')?.contrato?.escopoDaCredencial).toBe('processo');
    expect(porChave.get(CHAVE_FICTICIA)?.contrato?.escopoDaCredencial).toBe('empresa');
  });

  it('a saúde é perguntada por empresa: outra empresa não herda o verde', async () => {
    const reg = new RegistroDeConectores();
    reg.registrar(conectorFicticio({ empresaAutorizada: EMPRESA }), 'Ficticio');

    const daCerta = await reg.sondar({ orgId: EMPRESA, chave: CHAVE_FICTICIA, prazoMs: PRAZO });
    const daOutra = await reg.sondar({ orgId: OUTRA, chave: CHAVE_FICTICIA, prazoMs: PRAZO });

    expect(daCerta.estado).toBe('conectado');
    expect(daOutra.estado).toBe('nao_configurado');
    expect(daOutra.mensagem).toContain(OUTRA);
  });
});


// ---------------------------------------------------------------------------
// SEÇÃO 7 — a MEDIÇÃO é de quem mede (e não de quem assina)
// ---------------------------------------------------------------------------

describe('verde é medição, não assinatura', () => {
  it('`conectado()` recusa latência que não é medição', () => {
    expect(() => conectado(Number.NaN)).toThrow(/latência MEDIDA/);
    expect(() => conectado(Number.POSITIVE_INFINITY)).toThrow(/latência MEDIDA/);
    expect(() => conectado(-1)).toThrow(/latência MEDIDA/);
    // Zero é medição legítima: uma sonda local pode responder dentro do mesmo
    // milissegundo, e recusá-la seria trocar uma mentira por outra.
    expect(conectado(0).estado).toBe('conectado');
  });

  it('verde que ASSINA tentativa sem número medido é rebaixado', () => {
    const forjado = {
      estado: 'conectado' as const,
      mensagem: 'sondei, juro',
      apuracao: 'tentativa' as const,
      verificadoEm: new Date().toISOString(),
      latenciaMs: null,
    };
    const r = normalizarSaude(forjado);
    expect(r.estado).toBe('erro');
    expect(r.mensagem).toBe(MOTIVO_DE_LATENCIA_INVALIDA);

    // E o mesmo vale para valor que nem número é — o caso que a revisão rodou.
    const texto = normalizarSaude({ ...forjado, latenciaMs: 'rapidíssimo' as unknown as number });
    expect(texto.estado).toBe('erro');
    expect(texto.mensagem).toBe(MOTIVO_DE_LATENCIA_INVALIDA);
  });

  it('o carimbo troca o número declarado pelo número medido', () => {
    const inventado = {
      estado: 'conectado' as const,
      mensagem: 'rapidíssimo',
      apuracao: 'tentativa' as const,
      verificadoEm: new Date().toISOString(),
      latenciaMs: 999_999,
    };
    expect(carimbarMedicao(inventado, 42).latenciaMs).toBe(42);
    // Sem tentativa não há o que carimbar: a ausência de latência ali é a
    // verdade, e é ela que a catraca usa para rebaixar.
    const declarado = { ...inventado, apuracao: 'declaracao' as const, latenciaMs: null };
    expect(carimbarMedicao(declarado, 42).latenciaMs).toBeNull();
  });

  it('o REGISTRO carimba: o número da tela é o que ele mediu, não o que o conector disse', async () => {
    const reg = new RegistroDeConectores();
    reg.registrar(
      { ...conectorFicticio({ sonda: 'verde-com-latencia-inventada', atrasoMs: 25 }), chave: 'inventor' },
      'Inventor',
    );

    const s = await reg.sondar({ orgId: EMPRESA, chave: 'inventor', prazoMs: 2_000 });

    /*
     * O verde PASSA — e tem de passar: o conector foi chamado de verdade e o
     * registro cronometrou a chamada. O que não sobrevive é o NÚMERO: ele
     * declarou 999999 ms e a tela mostra a medição real. É essa a diferença
     * entre exigir assinatura e exigir medição.
     */
    expect(s.estado).toBe('conectado');
    expect(s.latenciaMs).not.toBe(999_999);
    expect(s.latenciaMs).toBeGreaterThanOrEqual(20);
    expect(s.latenciaMs).toBeLessThan(2_000);
  });

  it('verde declarado como `declaracao` continua rebaixado, com o motivo antigo', async () => {
    const reg = new RegistroDeConectores();
    reg.registrar({ ...conectorFicticio({ sonda: 'verde-sem-sonda' }), chave: 'mentiroso' }, 'Mentiroso');
    const s = await reg.sondar({ orgId: EMPRESA, chave: 'mentiroso', prazoMs: PRAZO });
    expect(s.estado).toBe('erro');
    expect(s.mensagem).toBe(MOTIVO_DE_REBAIXAMENTO);
  });
});

// ---------------------------------------------------------------------------
// SEÇÃO 8 — degradação: nem uma sonda que REJEITA derruba a tela
// ---------------------------------------------------------------------------

describe('degradação: `allSettled`, não `all`', () => {
  it('uma sonda que rejeita marca só a linha dela; as outras respondem', async () => {
    const reg = new RegistroDeConectores();
    reg.registrar(conectorSaudavel('bom'), 'Bom');
    reg.registrar(conectorQueRejeitaNaCara('rejeita'), 'Rejeita');
    reg.registrar(conectorSaudavel('bom2'), 'Bom2');

    const mapa = await reg.sondarVarios([
      { orgId: EMPRESA, chave: 'bom', prazoMs: PRAZO },
      { orgId: EMPRESA, chave: 'rejeita', prazoMs: PRAZO },
      { orgId: EMPRESA, chave: 'bom2', prazoMs: PRAZO },
    ]);

    expect(mapa.size).toBe(3);
    expect(mapa.get('bom')?.estado).toBe('conectado');
    expect(mapa.get('bom2')?.estado).toBe('conectado');
    expect(mapa.get('rejeita')?.estado).toBe('erro');
    expect(mapa.get('rejeita')?.mensagem).toContain('estourei antes');
  });

  /*
   * O CASO DECISIVO, e ele precisa ser forçado à mão: `sondar` tem `try/catch`
   * interno, então nenhum conector de hoje a faz REJEITAR — nem o que estoura de
   * forma síncrona (o `throw` acontece dentro do `try`). É justamente esse o
   * argumento do cabeçalho da classe: contar com isso é pendurar a degradação
   * num detalhe de implementação de outra função. Aqui a rejeição é encenada
   * substituindo o método, que é a única forma honesta de exercitar `all` versus
   * `allSettled`.
   */
  it('se a PRÓPRIA sonda rejeitar, as outras linhas continuam vindo', async () => {
    const reg = new RegistroDeConectores();
    reg.registrar(conectorSaudavel('bom'), 'Bom');
    reg.registrar(conectorSaudavel('explode'), 'Explode');
    reg.registrar(conectorSaudavel('bom2'), 'Bom2');

    const original = reg.sondar.bind(reg);
    reg.sondar = ((e: Parameters<RegistroDeConectores['sondar']>[0]) =>
      e.chave === 'explode'
        ? Promise.reject(new Error('a sonda rejeitou antes de qualquer catch'))
        : original(e)) as RegistroDeConectores['sondar'];

    const mapa = await reg.sondarVarios([
      { orgId: EMPRESA, chave: 'bom', prazoMs: PRAZO },
      { orgId: EMPRESA, chave: 'explode', prazoMs: PRAZO },
      { orgId: EMPRESA, chave: 'bom2', prazoMs: PRAZO },
    ]);

    // Com `Promise.all`, esta chamada inteira teria rejeitado e a tela de
    // diagnóstico viraria um erro — escondendo qual conector caiu.
    expect(mapa.size).toBe(3);
    expect(mapa.get('bom')?.estado).toBe('conectado');
    expect(mapa.get('bom2')?.estado).toBe('conectado');
    expect(mapa.get('explode')?.estado).toBe('erro');
    expect(mapa.get('explode')?.mensagem).toContain('rejeitou antes');
  });

  it('e a tela inteira sobrevive a ela: o catálogo continua vindo completo', async () => {
    const { svc, contrato } = montarCatalogo();
    contrato.registrar(conectorSaudavel('bom'), 'Bom');
    contrato.registrar(conectorQueRejeitaNaCara('rejeita'), 'Rejeita');

    const cat = await svc.catalog(EMPRESA, { prazoDeSondaMs: PRAZO });
    const porChave = new Map(cat.items.map((i) => [i.key, i]));
    expect(porChave.get('bom')?.saude?.estado).toBe('conectado');
    expect(porChave.get('rejeita')?.saude?.estado).toBe('erro');
    for (const c of CONNECTORS) expect(porChave.has(c.key)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SEÇÃO 9 — a memória curta: barata, e com a idade à vista
// ---------------------------------------------------------------------------

describe('memória curta das sondas', () => {
  it('duas aberturas seguidas da tela pagam UMA chamada externa', async () => {
    const { svc, contrato } = montarCatalogo();
    const chamadas: Record<string, number> = {};
    contrato.registrar({ ...conectorFicticio({ chamadas }), chave: 'guardado' }, 'Guardado');

    const primeira = await svc.catalog(EMPRESA, { prazoDeSondaMs: PRAZO });
    const segunda = await svc.catalog(EMPRESA, { prazoDeSondaMs: PRAZO });

    expect(chamadas.saude).toBe(1);
    const a = primeira.items.find((i) => i.key === 'guardado')!.saude!;
    const b = segunda.items.find((i) => i.key === 'guardado')!.saude!;
    // A IDADE NÃO É ESCONDIDA: a segunda resposta carrega o MESMO horário de
    // apuração da primeira, e é ele que a tela imprime.
    expect(b.verificadoEm).toBe(a.verificadoEm);
  });

  it('a memória é POR EMPRESA — outra empresa não herda a sonda', async () => {
    const { svc, contrato } = montarCatalogo();
    const chamadas: Record<string, number> = {};
    contrato.registrar({ ...conectorFicticio({ chamadas }), chave: 'guardado' }, 'Guardado');

    await svc.catalog(EMPRESA, { prazoDeSondaMs: PRAZO });
    await svc.catalog(OUTRA, { prazoDeSondaMs: PRAZO });
    expect(chamadas.saude).toBe(2);
  });

  it('o que MUDA O ESTADO esquece a medição na hora', async () => {
    const { svc, contrato } = montarCatalogo();
    const chamadas: Record<string, number> = {};
    contrato.registrar(conectorFicticio({ chamadas }), 'Ficticio');

    await svc.catalog(EMPRESA, { prazoDeSondaMs: PRAZO });
    expect(chamadas.saude).toBe(1);

    // Revogar é o caso extremo: devolver o verde de antes seria mostrar um
    // estado que acabou de deixar de existir.
    await svc.revogar(EMPRESA, CHAVE_FICTICIA, 'pedro', 'token vazou');
    await svc.catalog(EMPRESA, { prazoDeSondaMs: PRAZO });
    expect(chamadas.saude).toBe(2);

    // E o desligamento, que mora fora do contrato, também esquece.
    svc.esquecerSonda(EMPRESA, CHAVE_FICTICIA);
    await svc.catalog(EMPRESA, { prazoDeSondaMs: PRAZO });
    expect(chamadas.saude).toBe(3);
  });

  it('`semMemoria` mede sempre — e a memória vale menos de um minuto', async () => {
    const reg = new RegistroDeConectores();
    const chamadas: Record<string, number> = {};
    reg.registrar({ ...conectorFicticio({ chamadas }), chave: 'g' }, 'G');

    await reg.sondar({ orgId: EMPRESA, chave: 'g', prazoMs: PRAZO });
    await reg.sondar({ orgId: EMPRESA, chave: 'g', prazoMs: PRAZO });
    expect(chamadas.saude).toBe(1);

    await reg.sondar({ orgId: EMPRESA, chave: 'g', prazoMs: PRAZO, semMemoria: true });
    expect(chamadas.saude).toBe(2);

    expect(VALIDADE_DA_SONDA_MS).toBeLessThanOrEqual(60_000);
  });
});

// ---------------------------------------------------------------------------
// SEÇÃO 10 — dispensar a sonda NÃO é desligar (a instrução certa)
// ---------------------------------------------------------------------------

describe('a frase de quem não foi sondado', () => {
  it('`sondar: false` não manda religar nada', async () => {
    const { svc, contrato } = montarCatalogo();
    contrato.registrar(conectorSaudavel('bom'), 'Bom');

    const cat = await svc.catalog(EMPRESA, { sondar: false });
    const bom = cat.items.find((i) => i.key === 'bom')!;

    expect(bom.saude?.estado).toBe('nao_verificado');
    expect(bom.saude?.mensagem).toContain('sondar=0');
    // A instrução do DESLIGAMENTO não pode aparecer aqui: ninguém desligou nada.
    expect(bom.saude?.mensagem ?? '').not.toMatch(/[Rr]eligue/);
  });

  it('e o desligado continua recebendo a frase do desligamento', async () => {
    const { svc, contrato, desligados } = montarCatalogo();
    contrato.registrar(conectorSaudavel('bom'), 'Bom');
    desligados.set('bom', {
      motivo: 'incidente',
      desligadoPor: 'pedro',
      desligadoEm: new Date('2026-09-10T12:00:00Z'),
    });

    const cat = await svc.catalog(EMPRESA, { prazoDeSondaMs: PRAZO });
    const bom = cat.items.find((i) => i.key === 'bom')!;
    expect(bom.saude?.estado).toBe('nao_verificado');
    expect(bom.saude?.mensagem).toMatch(/Religue/);
  });
});

// ---------------------------------------------------------------------------
// SEÇÃO 11 — o verbo único não é uma segunda porta para a permissão
// ---------------------------------------------------------------------------

describe('sincronizar exige a permissão que o conector declara', () => {
  const comPermissao = (p: string) => ({ ...conectorFicticio(), permissaoParaSincronizar: p });

  it('sem a permissão específica, recusa — mesmo com `admin.usuarios` na rota', async () => {
    const { svc, contrato } = montarCatalogo();
    contrato.registrar(comPermissao('tarefas.editar'), 'Ficticio');

    await expect(svc.sincronizar(EMPRESA, CHAVE_FICTICIA, 'pedro', [])).rejects.toThrow(
      /tarefas\.editar/,
    );
    await expect(
      svc.sincronizar(EMPRESA, CHAVE_FICTICIA, 'pedro', ['admin.usuarios']),
    ).rejects.toThrow(/tarefas\.editar/);
  });

  it('com a permissão, passa', async () => {
    const { svc, contrato } = montarCatalogo();
    contrato.registrar(comPermissao('tarefas.editar'), 'Ficticio');
    const r = await svc.sincronizar(EMPRESA, CHAVE_FICTICIA, 'pedro', [
      'admin.usuarios',
      'tarefas.editar',
    ]);
    expect(r.tipo).toBe('feito');
  });

  it('conector sem exigência declarada não ganha trava nova', async () => {
    const { svc, contrato } = montarCatalogo();
    contrato.registrar(conectorFicticio(), 'Ficticio');
    const r = await svc.sincronizar(EMPRESA, CHAVE_FICTICIA, 'pedro', []);
    expect(r.tipo).toBe('feito');
  });
});

// ---------------------------------------------------------------------------
// SEÇÃO 12 — o Obsidian: a pasta abre, mas a empresa tem índice?
// ---------------------------------------------------------------------------

function montarObsidian(vault: string | null, notas: number) {
  const antes = process.env.OBSIDIAN_VAULT_PATH;
  if (vault) process.env.OBSIDIAN_VAULT_PATH = vault;
  else delete process.env.OBSIDIAN_VAULT_PATH;

  const prisma = {
    knowledgeNote: { count: async () => notas },
    org: { findUnique: async () => null },
  } as unknown as PrismaService;

  const contrato = new RegistroDeConectores();
  const svc = new ObsidianService(prisma, new ConectoresConfiguradosRegistry(), contrato);
  /*
   * O DESCRITOR É PEGO À MÃO, sem `onModuleInit`, e a razão é concreta: o
   * `onModuleInit` do Obsidian agenda a reindexação (um `setTimeout` de 25 s e
   * um `setInterval`) quando há vault. Chamá-lo aqui deixaria temporizador vivo
   * depois do fim da suíte.
   */
  const descritor = (svc as unknown as { descritorDoContrato(): ConectorDoContratoDeTeste })
    .descritorDoContrato();
  contrato.registrar(descritor, 'ObsidianService');
  process.env.OBSIDIAN_VAULT_PATH = antes;
  return { contrato, descritor };
}

type ConectorDoContratoDeTeste = Parameters<RegistroDeConectores['registrar']>[0];

describe('Obsidian: verde só com índice desta empresa', () => {
  let vault: string;

  beforeEach(() => {
    vault = mkdtempSync(path.join(os.tmpdir(), 'vault-'));
    mkdirSync(path.join(vault, 'pasta'));
    writeFileSync(path.join(vault, 'nota.md'), '# nota');
  });

  afterEach(() => rmSync(vault, { recursive: true, force: true }));

  it('pasta legível + ZERO nota indexada = não configurado (não verde)', async () => {
    const { contrato } = montarObsidian(vault, 0);
    const s = await contrato.sondar({ orgId: EMPRESA, chave: 'obsidian', prazoMs: 2_000 });

    /*
     * Este era o parágrafo que contradizia o próprio código: ele argumentava que
     * responder "a pasta abre" seria verde verdadeiro sobre a pergunta errada —
     * e devolvia verde com zero nota, mudando só a mensagem.
     */
    expect(s.estado).toBe('nao_configurado');
    expect(s.estado).not.toBe('conectado');
    expect(s.mensagem).toMatch(/NENHUMA nota/);
    expect(s.mensagem).toMatch(/sincronizar/);
  });

  it('pasta legível + notas indexadas = verde, com a medição do registro', async () => {
    const { contrato } = montarObsidian(vault, 432);
    const s = await contrato.sondar({ orgId: EMPRESA, chave: 'obsidian', prazoMs: 2_000 });
    expect(s.estado).toBe('conectado');
    expect(s.apuracao).toBe('tentativa');
    expect(s.mensagem).toContain('432');
  });

  it('pasta que não abre = erro com a causa real', async () => {
    const sumida = path.join(vault, 'nao-existe');
    const { contrato } = montarObsidian(sumida, 10);
    const s = await contrato.sondar({ orgId: EMPRESA, chave: 'obsidian', prazoMs: 2_000 });
    expect(s.estado).toBe('erro');
    expect(s.mensagem).toContain(sumida);
  });

  it('sem vault apontada = não configurado, e a pergunta é do operador', async () => {
    const { contrato } = montarObsidian(null, 0);
    const s = await contrato.sondar({ orgId: EMPRESA, chave: 'obsidian', prazoMs: 2_000 });
    expect(s.estado).toBe('nao_configurado');
    expect(s.mensagem).toMatch(/ambiente da API/);
  });

  it('a sonda NÃO usa leitura síncrona de disco — ela travaria o relógio de fora', () => {
    /*
     * Catraca de código, não de comportamento, e de propósito: o defeito só
     * aparece com um ponto de montagem PENDURADO, que não dá para encenar numa
     * suíte. `readdirSync` bloqueia a thread principal, e o relógio de fora do
     * registro é um `setTimeout` — ele não dispara enquanto o laço está preso.
     * Uma pasta travada derrubaria a API inteira em vez da linha dela.
     */
    const fonte = readFileSync(
      path.join(acharRaizDoRepo(), 'apps', 'api', 'src', 'obsidian', 'obsidian.service.ts'),
      'utf8',
    );
    const inicio = fonte.indexOf('saude: async (ctx: ContextoDoVerbo)');
    const fim = fonte.indexOf('revogar: async ()', inicio);
    expect(inicio, 'não achei a sonda do Obsidian').toBeGreaterThan(0);
    const bloco = fonte.slice(inicio, fim);
    expect(bloco).not.toContain('readdirSync');
    expect(bloco).toContain('lerRaizDaVault');
    expect(fonte).toMatch(/await Promise\.race\(\[readdir\(this\.vault\)/);
  });

  it('o verbo sincronizar do Obsidian exige a permissão da rota antiga', () => {
    const { descritor } = montarObsidian(vault, 1);
    expect(descritor.permissaoParaSincronizar).toBe('obsidian.editar');
  });
});

// ---------------------------------------------------------------------------
// SEÇÃO 13 — os dois prazos da Evolution (e o portão da publicação)
// ---------------------------------------------------------------------------

describe('Evolution: o corte de dentro vence o de fora, e o portão fica como estava', () => {
  const antes = { ...process.env };

  beforeEach(() => {
    process.env.EVOLUTION_URL = 'https://evolution.invalido';
    process.env.EVOLUTION_API_KEY = 'chave-de-mentira';
    process.env.EVOLUTION_INSTANCIA = 'instancia-de-mentira';
  });

  afterEach(() => {
    process.env = { ...antes };
    vi.unstubAllGlobals();
  });

  function montarEvolution() {
    const contrato = new RegistroDeConectores();
    const svc = new EvolutionService(
      new EfeitosRegistry(),
      new ConectoresConfiguradosRegistry(),
      contrato,
    );
    svc.onModuleInit();
    return { contrato, svc };
  }

  it('o prazo da sonda é MENOR que o relógio de fora — senão a frase útil nunca chega', () => {
    expect(PRAZO_DA_CHAMADA_DE_SONDA_MS).toBeLessThan(TEMPO_LIMITE_DE_SONDA_MS);
  });

  /*
   * O PORTÃO DA PUBLICAÇÃO NO WHATSAPP É A ÚNICA ESCRITA EXTERNA VIVA DO PRODUTO
   * (R3) e ela chega ali JÁ APROVADA POR UMA PESSOA. Baixar o prazo dele faria
   * uma Evolution lenta REPROVAR publicação assinada — por isso ele continua com
   * os 10 s que sempre teve, e só a sonda usa o prazo curto.
   */
  it('o portão da publicação mantém o prazo antigo; só a sonda encurta', () => {
    expect(PRAZO_DA_CONSULTA_DE_INSTANCIA_MS).toBe(10_000);
    expect(PRAZO_DA_CONSULTA_DE_INSTANCIA_MS).toBeGreaterThan(PRAZO_DA_CHAMADA_DE_SONDA_MS);
  });

  it('`estado` respeita o prazo que recebe, e devolve o motivo real', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: { signal?: AbortSignal }) =>
          new Promise((_resolver, rejeitar) => {
            init.signal?.addEventListener('abort', () =>
              rejeitar(new Error('The operation was aborted due to timeout')),
            );
          }),
      ),
    );
    const { svc } = montarEvolution();
    const e = await svc.estado({ prazoMs: 30 });

    expect(e.configurada).toBe(true);
    expect(e.conectada).toBe(false);
    expect(e.motivo).toContain('Não deu para falar com a Evolution');
  });

  it('a sonda entrega a frase do conector, não a do relógio de fora', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ instance: { state: 'close' } }),
        text: async () => '',
      })),
    );
    const { contrato } = montarEvolution();
    const s = await contrato.sondar({ orgId: EMPRESA, chave: 'whatsapp', prazoMs: 2_000 });

    expect(s.estado).toBe('erro');
    expect(s.mensagem).toContain('close');
    expect(s.mensagem).toContain('reconecte o número');
    expect(s.mensagem ?? '').not.toMatch(/sem resposta/);
  });

  it('instância aberta = verde com medição', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ instance: { state: 'open' } }),
        text: async () => '',
      })),
    );
    const { contrato } = montarEvolution();
    const s = await contrato.sondar({ orgId: EMPRESA, chave: 'whatsapp', prazoMs: 2_000 });
    expect(s.estado).toBe('conectado');
    expect(s.apuracao).toBe('tentativa');
    expect(typeof s.latenciaMs).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// SEÇÃO 14 — O CICLO INTEIRO: autorizar → desconectar → reautorizar → usar
// ---------------------------------------------------------------------------

/**
 * Um cofre de mentira que COBRA O CONTEXTO como o de verdade cobra.
 *
 * É a peça que faz esta seção valer alguma coisa. O `CofreService` confere, na
 * PRIMEIRA LINHA de `guardar`, se a empresa do argumento é a mesma do contexto
 * de execução, e lança quando não é — ele falha fechado sob isolamento por
 * linha. Um dublê que aceitasse qualquer chamada passaria verde exatamente no
 * defeito que esta seção existe para pegar: a gravação silenciosa que nunca
 * acontecia no retorno do OAuth, porque rota pública não tem empresa no
 * contexto.
 */
class CofreDeMentira {
  readonly linhas = new Map<string, { valor: string; revogadoEm: Date | null }>();
  /** Liga para encenar "o cofre estava fora do ar na hora da reautorização". */
  falharAoGuardar = false;
  /** Toda tentativa de gravação, tenha dado certo ou não. */
  readonly tentativas: string[] = [];

  private exigirEmpresa(orgId: string, onde: string): void {
    const doContexto = contextoAtual()?.orgId ?? null;
    if (doContexto !== orgId) {
      throw new Error(
        `${onde}: a empresa do argumento (${orgId}) não é a da execução em curso ` +
          `(${doContexto ?? 'nenhuma'}). O cofre FALHA FECHADO.`,
      );
    }
  }

  async guardar(e: { orgId: string; conector: string; nome: string; valor: string }) {
    this.exigirEmpresa(e.orgId, 'CofreDeMentira.guardar');
    this.tentativas.push(`${e.conector}/${e.nome}`);
    if (this.falharAoGuardar) throw new Error('cofre fora do ar');
    // Regravar LIMPA a revogação — é o caminho normal de reautorizar, e é
    // exatamente ele que falhava calado.
    this.linhas.set(`${e.conector}/${e.nome}`, { valor: e.valor, revogadoEm: null });
    return { id: 'id-de-mentira', versao: 1 };
  }

  async envolver<T>(
    e: { orgId: string; conector: string; nome: string },
    uso: (c: { usar: <R>(f: (s: string) => R) => R }) => T | Promise<T>,
  ): Promise<T> {
    this.exigirEmpresa(e.orgId, 'CofreDeMentira.envolver');
    const l = this.linhas.get(`${e.conector}/${e.nome}`);
    if (!l || l.revogadoEm) {
      throw new SegredoIndisponivelError(e.conector, e.nome, !!l?.revogadoEm);
    }
    return uso({ usar: (f) => f(l.valor) });
  }

  async revogar(e: { orgId: string; conector: string }) {
    this.exigirEmpresa(e.orgId, 'CofreDeMentira.revogar');
    const revogados: string[] = [];
    for (const [k, v] of this.linhas) {
      if (!k.startsWith(`${e.conector}/`) || v.revogadoEm) continue;
      v.revogadoEm = new Date();
      revogados.push(k.split('/')[1]);
    }
    return { revogados, jaRevogados: [], preservados: [] };
  }

  async estado(orgId: string) {
    this.exigirEmpresa(orgId, 'CofreDeMentira.estado');
    return {
      items: [...this.linhas].map(([k, v]) => ({
        conector: k.split('/')[0],
        nome: k.split('/')[1],
        revogadoEm: v.revogadoEm ? v.revogadoEm.toISOString() : null,
      })),
    };
  }

  vivo(nome: string): string | null {
    const l = this.linhas.get(`${CONECTOR_DO_GOOGLE}/${nome}`);
    return l && !l.revogadoEm ? l.valor : null;
  }

  revogado(nome: string): boolean {
    return !!this.linhas.get(`${CONECTOR_DO_GOOGLE}/${nome}`)?.revogadoEm;
  }
}

/** O `@Res()` do Nest, reduzido ao que o callback usa. */
function respostaDeMentira() {
  const destinos: string[] = [];
  return { destinos, redirect: (url: string) => destinos.push(url) };
}

function montarCicloDoGoogle() {
  const cofre = new CofreDeMentira();
  const contrato = new RegistroDeConectores();
  const estado: { conta: Record<string, unknown> | null } = { conta: null };

  const prisma = {
    org: {
      findUnique: async ({ where }: { where: { id?: string } }) =>
        where.id === EMPRESA ? { id: EMPRESA } : null,
    },
    googleAccount: {
      findUnique: async () => estado.conta,
      upsert: async ({ create, update }: { create: object; update: object }) => {
        estado.conta = estado.conta
          ? { ...estado.conta, ...update }
          : { orgId: EMPRESA, connectedAt: new Date(), ...create };
        return estado.conta;
      },
      update: async ({ data }: { data: object }) => {
        estado.conta = { ...(estado.conta ?? {}), ...data };
        return estado.conta;
      },
      deleteMany: async () => {
        estado.conta = null;
        return { count: 1 };
      },
    },
    integrationAccount: {
      findFirst: async () => null,
      create: async () => ({}),
      update: async () => ({}),
    },
  } as unknown as PrismaService;

  const audit = { log: async () => {} } as unknown as AuditService;
  const svc = new GoogleService(
    prisma,
    audit,
    new EfeitosRegistry(),
    contrato,
    cofre as unknown as CofreService,
  );
  svc.onModuleInit();

  const login = {
    completeToRedirect: async () => 'nao-deveria-ser-chamado',
  } as unknown as ConstructorParameters<typeof GoogleConexaoController>[2];

  const ctrl = new GoogleConexaoController(svc, prisma, login, contrato);
  return { cofre, contrato, svc, ctrl, estado };
}

/** O que o Google responde: troca de código, renovação e a sonda do e-mail. */
function googleRespondendo(token: string, refresh?: string) {
  return vi.fn(async (url: string) => {
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: token,
          ...(refresh ? { refresh_token: refresh } : {}),
          expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/gmail.send',
          token_type: 'Bearer',
        }),
        text: async (): Promise<string> => '',
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ email: 'pedro@exemplo.com' }),
      text: async (): Promise<string> => '',
    };
  });
}

/** O contexto que uma rota AUTENTICADA teria — é o que o cofre exige. */
function comoUsuarioLogado<T>(fn: () => Promise<T>): Promise<T> {
  return comContexto(
    { orgId: EMPRESA, actorId: 'u-pedro', correlationId: novaCorrelacao('teste'), origem: 'http' },
    fn,
  );
}

describe('o ciclo inteiro da credencial (autorizar → desconectar → reautorizar → usar)', () => {
  const antes = { ...process.env };

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'id-de-mentira';
    process.env.GOOGLE_CLIENT_SECRET = 'segredo-de-mentira';
    process.env.WEB_ORIGIN = 'http://localhost:4000';
  });

  afterEach(() => {
    process.env = { ...antes };
    vi.unstubAllGlobals();
  });

  /*
   * O CASO QUE REPROVOU A FATIA. A cadeia era: rota pública não ganha empresa no
   * contexto → o cofre confere a empresa do contexto na primeira linha e lança →
   * a gravação é "tenta e segue" → o token ficava SÓ na coluna antiga. Somado à
   * revogação (que roda autenticada e funciona), desconectar e reconectar
   * matava o Google da empresa de forma permanente, com uma mensagem mandando
   * fazer o que não resolvia.
   */
  it('o retorno do OAuth guarda os DOIS tokens no cofre', async () => {
    vi.stubGlobal('fetch', googleRespondendo('acesso-1', 'renovacao-1'));
    const { cofre, ctrl } = montarCicloDoGoogle();
    const res = respostaDeMentira();

    await ctrl.callback('codigo-1', EMPRESA, { ip: '::1' }, res as never);

    expect(cofre.vivo(NOMES_CONHECIDOS.acesso)).toBe('acesso-1');
    expect(cofre.vivo(NOMES_CONHECIDOS.renovacao)).toBe('renovacao-1');
    expect(res.destinos[0]).toContain('/google');
  });

  it('desconectar → reautorizar → usar: o ciclo fecha, e a credencial volta a valer', async () => {
    vi.stubGlobal('fetch', googleRespondendo('acesso-1', 'renovacao-1'));
    const { cofre, contrato, svc, ctrl } = montarCicloDoGoogle();

    // 1. AUTORIZAR (rota pública, sem empresa no contexto — como em produção).
    await ctrl.callback('codigo-1', EMPRESA, { ip: '::1' }, respostaDeMentira() as never);
    expect(cofre.vivo(NOMES_CONHECIDOS.acesso)).toBe('acesso-1');

    // 2. DESCONECTAR (rota autenticada). Queima no cofre e apaga a linha.
    const r = await comoUsuarioLogado(() =>
      svc.disconnect(EMPRESA, { actorId: 'u-pedro', motivo: 'teste do ciclo' }),
    );
    expect(r.segredosRevogados.sort()).toEqual(
      [NOMES_CONHECIDOS.acesso, NOMES_CONHECIDOS.renovacao].sort(),
    );
    expect(cofre.revogado(NOMES_CONHECIDOS.acesso)).toBe(true);

    // O relógio precisa andar: a autorização nova tem de ser POSTERIOR à
    // revogação para a comparação de datas significar alguma coisa.
    await new Promise((r2) => setTimeout(r2, 5));

    // 3. REAUTORIZAR. Regravar no cofre LIMPA a marca de revogação.
    vi.stubGlobal('fetch', googleRespondendo('acesso-2', 'renovacao-2'));
    await ctrl.callback('codigo-2', EMPRESA, { ip: '::1' }, respostaDeMentira() as never);
    expect(cofre.revogado(NOMES_CONHECIDOS.acesso)).toBe(false);
    expect(cofre.vivo(NOMES_CONHECIDOS.acesso)).toBe('acesso-2');

    // 4. USAR. Antes do conserto, isto lançava "a credencial foi REVOGADA —
    // reautorize em Conexões", que era exatamente o que acabara de ser feito.
    const s = await comoUsuarioLogado(() =>
      contrato.sondar({ orgId: EMPRESA, chave: 'google', prazoMs: 2_000, semMemoria: true }),
    );
    expect(s.estado).toBe('conectado');
    expect(s.mensagem).toContain('pedro@exemplo.com');
  });

  /*
   * A SEGUNDA METADE DO CONSERTO: parar de engolir calado.
   *
   * Mesmo com o contexto aberto, a gravação no cofre segue sendo best-effort — e
   * tem de seguir, porque falhar ali não pode desfazer um OAuth que o Google já
   * aceitou. O que não pode é a falha virar armadilha permanente. Quando há
   * autorização POSTERIOR à revogação, a leitura para de tratar "revogado" como
   * terminal, usa a coluna e RECONCILIA o cofre.
   */
  it('se a gravação falhar na reautorização, a leitura não morre: reconcilia e segue', async () => {
    vi.stubGlobal('fetch', googleRespondendo('acesso-1', 'renovacao-1'));
    const { cofre, contrato, svc, ctrl } = montarCicloDoGoogle();

    await ctrl.callback('codigo-1', EMPRESA, { ip: '::1' }, respostaDeMentira() as never);
    await comoUsuarioLogado(() => svc.disconnect(EMPRESA, { actorId: 'u-pedro' }));
    await new Promise((r) => setTimeout(r, 5));

    // O cofre está fora do ar na hora da reautorização: a marca de revogação
    // FICA, e o token novo só entra na coluna.
    cofre.falharAoGuardar = true;
    vi.stubGlobal('fetch', googleRespondendo('acesso-2', 'renovacao-2'));
    await ctrl.callback('codigo-2', EMPRESA, { ip: '::1' }, respostaDeMentira() as never);
    expect(cofre.revogado(NOMES_CONHECIDOS.acesso)).toBe(true);

    // O cofre volta. A leitura seguinte tem de enxergar que a autorização é
    // POSTERIOR à revogação — e não mandar "reautorize" de novo.
    cofre.falharAoGuardar = false;
    const s = await comoUsuarioLogado(() =>
      contrato.sondar({ orgId: EMPRESA, chave: 'google', prazoMs: 2_000, semMemoria: true }),
    );

    expect(s.estado).toBe('conectado');
    // E reconciliou: a linha do cofre voltou a valer, com o token novo.
    expect(cofre.revogado(NOMES_CONHECIDOS.acesso)).toBe(false);
    expect(cofre.vivo(NOMES_CONHECIDOS.acesso)).toBe('acesso-2');
  });

  /*
   * O QUE NÃO PODE AFROUXAR: revogação sem autorização posterior continua
   * TERMINAL. É o caso do incidente — alguém queima a credencial pela linha de
   * comando e ninguém reautorizou. Cair para a coluna aqui seria não ter
   * revogado.
   */
  it('revogação SEM autorização posterior continua terminal', async () => {
    vi.stubGlobal('fetch', googleRespondendo('acesso-1', 'renovacao-1'));
    const { cofre, contrato, ctrl } = montarCicloDoGoogle();
    await ctrl.callback('codigo-1', EMPRESA, { ip: '::1' }, respostaDeMentira() as never);

    // Queima direto no cofre, SEM apagar a linha local (é o que o CLI faz).
    await new Promise((r) => setTimeout(r, 5));
    await comoUsuarioLogado(() => cofre.revogar({ orgId: EMPRESA, conector: CONECTOR_DO_GOOGLE }));

    const s = await comoUsuarioLogado(() =>
      contrato.sondar({ orgId: EMPRESA, chave: 'google', prazoMs: 2_000, semMemoria: true }),
    );
    expect(s.estado).toBe('erro');
    expect(s.mensagem).toContain('REVOGADA');
    // E a credencial da coluna NÃO foi usada para fingir que está tudo bem.
    expect(cofre.revogado(NOMES_CONHECIDOS.acesso)).toBe(true);
  });

  it('na dúvida, terminal: sem data de revogação a leitura não afrouxa', async () => {
    const semCofre = await revogacaoFoiSuperada(undefined, {
      orgId: EMPRESA,
      conector: CONECTOR_DO_GOOGLE,
      nome: NOMES_CONHECIDOS.acesso,
      autorizadaEm: new Date(),
    });
    expect(semCofre.superada).toBe(false);

    const semData = await revogacaoFoiSuperada(
      { estado: async () => ({ items: [] }) },
      {
        orgId: EMPRESA,
        conector: CONECTOR_DO_GOOGLE,
        nome: NOMES_CONHECIDOS.acesso,
        autorizadaEm: new Date(),
      },
    );
    expect(semData.superada).toBe(false);

    const cofreMudo = {
      estado: async () => {
        throw new Error('sem contexto');
      },
    };
    const mudo = await revogacaoFoiSuperada(cofreMudo, {
      orgId: EMPRESA,
      conector: CONECTOR_DO_GOOGLE,
      nome: NOMES_CONHECIDOS.acesso,
      autorizadaEm: new Date(),
    });
    expect(mudo.superada).toBe(false);
    expect(mudo.porque).toContain('sem contexto');
  });
});

// ---------------------------------------------------------------------------
// utilitários da varredura
// ---------------------------------------------------------------------------

/** A raiz do monorepo, achada por um marco em vez de caminho relativo ao cwd. */
function acharRaizDoRepo(): string {
  const marco = path.join('packages', 'policy', 'politica-marketing-os.json');
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, marco))) return dir;
    const pai = path.dirname(dir);
    if (pai === dir) break;
    dir = pai;
  }
  throw new Error(`não achei a raiz do repositório a partir de ${process.cwd()}`);
}

const IGNORADAS = new Set(['node_modules', 'dist', '.next', '.turbo']);

function varrer(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const completo = path.join(dir, entrada);
    if (statSync(completo).isDirectory()) {
      if (!IGNORADAS.has(entrada)) varrer(completo, acc);
      continue;
    }
    if (/\.(ts|tsx|json)$/.test(entrada)) acc.push(completo);
  }
  return acc;
}
