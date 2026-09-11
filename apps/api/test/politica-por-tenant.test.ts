/**
 * A POLÍTICA DE CADA EMPRESA — RF-P-04 e RF-P-06
 * ==============================================
 *
 * Três coisas são provadas aqui, e são exatamente as três do critério da fatia:
 *
 *   1. a empresa sobrescreve UMA capacidade e continua herdando TODAS as
 *      outras — e a sobrescrita de uma não vaza para a outra empresa;
 *   2. rebaixar nível sem responsável identificado é RECUSADO, e não grava
 *      nada; subir nível passa sozinho;
 *   3. o histórico responde quem mudou o quê e quando, sem recalcular contra a
 *      base de hoje.
 *
 * A quarta, que não está no enunciado e é a que mais dói: a política da empresa
 * SOBREVIVE A UM RESTART. Até 11/09/2026 não sobrevivia — `onModuleInit`
 * carregava só a base, a empresa caía no índice de chave '' e voltava calada a
 * decidir pela política da ROOT, com a versão dela gravada, ativa e ignorada.
 * O caso "um serviço recém-subido" é o que prende esse conserto.
 *
 * A quinta veio de uma revisão adversarial, e é a mais grave: A REFERÊNCIA DA
 * TRAVA. Ela comparava a política resolvida com a base herdada, nunca com o que
 * estava valendo PARA AQUELA EMPRESA — então toda redução em relação à versão
 * anterior da própria empresa entrava sem responsável e sem motivo, desde que
 * continuasse igual ou acima da base. Três ataques ficam presos aqui: o delta
 * VAZIO que devolve R4 para R2, o teto diário que volta de 20 para 200, e a
 * queda de R4 para R3 que o histórico registrava com direção "sobe". Junto
 * deles, os dois campos que SÃO trava de execução e saíam como "igual": o
 * esquema de argumentos (trocá-lo desliga a validação da porta) e a ferramenta
 * (acrescentá-la expõe ao modelo uma capacidade que nenhum agente alcançava).
 *
 * A metade PURA (o diff, a direção de cada mudança, a trava) está em
 * `packages/policy/test/sobrescrita.test.ts` e não precisa de banco.
 *
 * COMO RODAR (sem TEST_DATABASE_URL a seção de banco se pula sozinha):
 *   TEST_DATABASE_URL='postgresql://mkt:shadow@localhost:55432/marketing_os_test' \
 *     npx vitest run test/politica-por-tenant.test.ts
 *
 * O banco é `marketing_os_test`, o único da suíte padrão — inventário dos
 * bancos do container em `test/banco-de-teste.ts`.
 *
 * POR QUE ELA NÃO ESCREVE NA BASE (orgId NULO)
 * A base é o documento que TODAS as outras empresas do banco herdam, e o que
 * toda outra suíte carrega no boot do PolicyService dela. Na CI os arquivos de
 * teste rodam em paralelo contra o MESMO banco (`marketing_os_test`), então
 * mexer nela — ainda que por um instante, com restauração no `finally` — é
 * fazer outra suíte decidir com uma régua que ninguém escreveu, de vez em
 * quando, de um jeito que não se reproduz. Tudo o que esta suíte escreve é
 * escopado em ORG_A e ORG_B. A única exceção é criar a base quando ela NÃO
 * existe (banco recém-migrado, sem `db:seed:politica`), e nesse caso ela mesma
 * apaga no fim.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  lerDelta,
  lerPolitica,
  resolverPolitica,
  type CapacidadeCatalogo,
  type DiffDePolitica,
  type Politica,
} from '@mktos/policy';
import politicaRoot from '@mktos/policy/politica-root.json';
import politicaMktos from '@mktos/policy/politica-marketing-os.json';

import { PolicyService } from '../src/policy/policy.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * O CONSERTO HERDADO DA FATIA 2.2 — não precisa de banco, por isso vem antes.
 *
 * `seed-politica.ts` barrava o catálogo só por `verificarCatalogo()`, que
 * confere se o nível declarado é o que a régua calcula do efeito. A fatia 2.2
 * criou a irmã `verificarReversibilidade()`, que reprova a capacidade que se
 * diz automaticamente reversível apontando um desfazer que o catálogo não sabe
 * dar — e essa passa limpa pela primeira. Rodar só uma no seed deixava o teste
 * do pacote verde e o BANCO errado, que é o pior par possível: a régua que vale
 * em produção sai da PolicyVersion, não do JSON que o teste lê.
 *
 * É uma leitura do fonte e não uma execução porque o seed é um script com
 * `process.exit()` e `PrismaClient` no topo — importá-lo aqui abriria conexão e
 * derrubaria o processo do vitest. O que se quer prender é barato de prender:
 * que a chamada não suma de novo.
 */
describe('o seed da política barra o catálogo pelas DUAS verificações', () => {
  const fonte = readFileSync(path.join(__dirname, '..', 'prisma', 'seed-politica.ts'), 'utf8');

  it('importa e chama verificarCatalogo e verificarReversibilidade', () => {
    for (const nome of ['verificarCatalogo', 'verificarReversibilidade']) {
      expect(fonte, `${nome} não é importada no seed`).toMatch(
        new RegExp(`^\\s*${nome},\\s*$`, 'm'),
      );
      expect(fonte, `${nome} não é chamada no seed`).toContain(`${nome}(doc)`);
    }
  });

  it('recusa a rodada inteira quando qualquer das duas acusa', () => {
    // uma lista só, um `if`, um process.exit — e não duas travas que podem
    // divergir no dia em que alguém mexer numa e esquecer a outra
    expect(fonte).toMatch(/const problemas = \[[\s\S]*?\];/);
    expect(fonte).toContain('catálogo diverge da régua — nada foi semeado');
  });

  /*
   * ACRESCENTAR CAPACIDADE NÃO É REBAIXAR — e uma assinatura não compra a
   * outra. Enquanto havia uma variável só, pôr uma capacidade nova no catálogo
   * derrubava o seed sob o rótulo de rebaixamento, e assinar para acrescentar
   * liberava qualquer rebaixamento que estivesse no mesmo arquivo.
   */
  it('tem assinatura PRÓPRIA para capacidade nova, separada da de rebaixamento', () => {
    for (const variavel of [
      'POLITICA_REBAIXAMENTO_AUTOR',
      'POLITICA_REBAIXAMENTO_MOTIVO',
      'POLITICA_CAPACIDADE_NOVA_AUTOR',
      'POLITICA_CAPACIDADE_NOVA_MOTIVO',
    ]) {
      expect(fonte, `${variavel} não aparece no seed`).toContain(variavel);
    }
    // a checagem é por ITEM, contra a assinatura da categoria dele
    expect(fonte).toContain('semAssinatura');
    expect(fonte).toContain('categoriaDe');
  });
});

const URL_DO_BANCO = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(
  URL_DO_BANCO ?? '',
  'cria e apaga empresas, versões de política e (quando não existe) a base',
);

const ORG_A = 'org-politica-a';
const ORG_B = 'org-politica-b';

/** A base empacotada — o mesmo chão que o serviço usa quando o banco não tem. */
const BASE_EMPACOTADA: Politica = resolverPolitica(
  lerPolitica(politicaRoot, 'politica-root.json'),
  lerDelta(politicaMktos, 'politica-marketing-os.json'),
);

const cabecalho = {
  versao: '1.0.0',
  atualizadoEm: '2026-09-11',
  origem: 'suíte de teste',
  descricao: 'sobrescrita da empresa, para teste',
  estende: 'politica-marketing-os.json',
};

const delta = (capacidades: unknown[], limitesPadrao?: Record<string, unknown>) => ({
  ...cabecalho,
  capacidades,
  ...(limitesPadrao ? { limitesPadrao } : {}),
});

/** A capacidade como ela está na base, com os campos trocados. */
function daBase(id: string, troca: Record<string, unknown>): CapacidadeCatalogo {
  const c = BASE_EMPACOTADA.capacidades.find((x) => x.id === id);
  if (!c) throw new Error(`${id} não existe na base`);
  return { ...(JSON.parse(JSON.stringify(c)) as CapacidadeCatalogo), ...troca };
}

/** Sobe `operacao.tarefa.alterar` de R2 para R4: sensibilidade restrita. */
const SOBE_TAREFA = delta([
  daBase('operacao.tarefa.alterar', {
    nivel: 'R4',
    descricao: 'tarefa é dado restrito nesta empresa',
    efeito: {
      ...BASE_EMPACOTADA.capacidades.find((c) => c.id === 'operacao.tarefa.alterar')!.efeito,
      sensibilidade: 'restrita',
    },
  }),
]);

/**
 * Desce `clickup.tarefa.alterar` de R3 para R2 — um rebaixamento LEGÍTIMO, que
 * é o caso difícil: a empresa afirma que, na operação dela, mover etapa é
 * desfeito pelo próprio OS (chamar de novo com a etapa anterior). Ela declara a
 * reversibilidade automática e o desfazer, o catálogo fecha, e o que sobra para
 * segurar a mudança é só a assinatura do RF-P-06.
 *
 * Deliberadamente não é `whatsapp.mensagem.enviar`: aquele não tem desenviar, e
 * cairia na trava de reversibilidade antes de chegar na do responsável — ver o
 * caso "não dá para comprar desconto de degrau com promessa vazia".
 */
const DESCE_ETAPA = delta([
  daBase('clickup.tarefa.alterar', {
    nivel: 'R2',
    desfazer: 'clickup.tarefa.alterar',
    efeito: {
      ...BASE_EMPACOTADA.capacidades.find((c) => c.id === 'clickup.tarefa.alterar')!.efeito,
      reversibilidade: 'automatica',
    },
  }),
]);

const ASSINATURA = {
  autorId: 'usuario-responsavel-1',
  motivo: 'ata da reunião de 11/09/2026: piloto de envio sem aprovação',
};

/** Delta que não declara capacidade nenhuma: a empresa volta a herdar tudo. */
const VAZIO = delta([]);

describe.skipIf(!URL_DO_BANCO)('política por empresa, contra o banco', () => {
  let prisma: PrismaClient;
  let servico: PolicyService;
  /** A base foi criada por esta suíte? Só nesse caso ela some no fim. */
  let baseCriadaAqui = false;

  const novoServico = async () => {
    const s = new PolicyService(prisma as unknown as PrismaService);
    await s.onModuleInit();
    return s;
  };

  const limparVersoesDasEmpresas = () =>
    prisma.policyVersion.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL_DO_BANCO } } });
    await prisma.$connect();

    await limparVersoesDasEmpresas();
    await prisma.org.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
    await prisma.org.createMany({
      data: [
        { id: ORG_A, name: 'Empresa A', slug: ORG_A },
        { id: ORG_B, name: 'Empresa B', slug: ORG_B },
      ],
    });

    // A base é pré-requisito: sem ela o serviço cai na empacotada e o diff
    // sairia contra um documento que não é o que está gravado.
    const base = await prisma.policyVersion.findFirst({ where: { orgId: null, ativaAte: null } });
    if (!base) {
      await prisma.policyVersion.create({
        data: {
          orgId: null,
          versao: 1,
          documento: BASE_EMPACOTADA as unknown as object,
          motivo: 'base semeada pela suíte de política por empresa',
        },
      });
      baseCriadaAqui = true;
    }
  });

  beforeEach(async () => {
    await limparVersoesDasEmpresas();
    servico = await novoServico();
  });

  afterAll(async () => {
    if (!prisma) return;
    await limparVersoesDasEmpresas();
    await prisma.org.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
    if (baseCriadaAqui) {
      await prisma.policyVersion.deleteMany({
        where: { orgId: null, motivo: 'base semeada pela suíte de política por empresa' },
      });
    }
    await prisma.$disconnect();
  });

  /* ---------------------------------------------------------------- RF-P-04 */

  describe('herda tudo, sobrescreve só o que declarou', () => {
    it('a empresa que sobrescreve uma capacidade continua herdando as outras', async () => {
      const r = await servico.sobrescrever({ orgId: ORG_A, delta: SOBE_TAREFA });

      expect(r.criada).toBe(true);
      expect(r.versao).toBe(1);
      expect(r.diffDaBase.capacidades.map((c) => c.id)).toEqual(['operacao.tarefa.alterar']);
      expect(r.diffDaBase.capacidades[0]).toMatchObject({ de: 'R2', para: 'R4', direcao: 'sobe' });
      // primeira versão: não há anterior contra o que medir
      expect(r.diffDaVersaoAnterior).toBeNull();

      // a que ela mexeu
      expect(servico.resolverCapacidade(ORG_A, 'operacao.tarefa.alterar')?.nivel).toBe('R4');
      // e TODAS as outras, idênticas à base — inclusive as que só existem na ROOT
      const base = servico.baseHerdada();
      expect(servico.capacidades(ORG_A)).toHaveLength(base.capacidades.length);
      for (const c of base.capacidades) {
        if (c.id === 'operacao.tarefa.alterar') continue;
        expect(servico.resolverCapacidade(ORG_A, c.id), `${c.id} deixou de ser herdada`).toEqual(c);
      }
      expect(servico.resolverCapacidade(ORG_A, 'nfe.emitir')?.nivel).toBe('R5');
      expect(servico.limites(ORG_A)).toEqual(base.limitesPadrao);
    });

    it('a sobrescrita de uma empresa não alcança a outra', async () => {
      await servico.sobrescrever({ orgId: ORG_A, delta: SOBE_TAREFA });

      expect(servico.resolverCapacidade(ORG_B, 'operacao.tarefa.alterar')?.nivel).toBe('R2');
      expect(servico.capacidades(ORG_B)).toEqual(servico.baseHerdada().capacidades);
      expect(await prisma.policyVersion.count({ where: { orgId: ORG_B } })).toBe(0);
    });

    it('sobrescrever de novo com o mesmo delta não abre versão nova', async () => {
      await servico.sobrescrever({ orgId: ORG_A, delta: SOBE_TAREFA });
      const repetida = await servico.sobrescrever({ orgId: ORG_A, delta: SOBE_TAREFA });

      expect(repetida.criada).toBe(false);
      expect(await prisma.policyVersion.count({ where: { orgId: ORG_A } })).toBe(1);
      expect(servico.resolverCapacidade(ORG_A, 'operacao.tarefa.alterar')?.nivel).toBe('R4');
    });

    /*
     * A IDEMPOTÊNCIA E O CAMPO OPCIONAL AUSENTE.
     *
     * `{ desfazer: undefined }` é o que sai de um objeto montado por spread
     * quando o campo opcional não se aplica — e um script em processo (o caso
     * citado no comentário da trava de idempotência) manda exatamente isso. O
     * Postgres DESCARTA a chave ao gravar; enquanto o cálculo canônico contasse
     * chave presente com valor indefinido, o documento em memória NUNCA batia
     * com o que voltava do banco: três chamadas idênticas abriam três versões,
     * e uma quarta depois do restart abria a quarta.
     */
    /*
     * POR QUE O `argsSchema` SAIU DAQUI (onda 7, 11/09/2026).
     *
     * Este caso declarava `argsSchema: undefined` em `clickup.tarefa.alterar`
     * porque, na época, a base NÃO tinha esquema para essa capacidade — a chave
     * indefinida era mesmo uma chave ausente, e a asserção media só a
     * canonização. A fatia 3.3 deu esquema de argumentos àquela capacidade; com
     * isso, `{ ...daBase(...), argsSchema: undefined }` deixou de ser "chave que
     * a base não tem" e passou a ser **apagar o esquema da base** — que é
     * afrouxamento de verdade (a porta para de validar argumento) e a trava do
     * RF-P-06 passou a recusar, com razão.
     *
     * O conserto é do TESTE, não do código: a chave indefinida que ainda prova o
     * que este caso quer provar é uma que a base realmente não tem. Ficam
     * `desfazer` (a base não declara) e uma capacidade SEM esquema
     * (`financeiro.lancamento.criar`), para que continuem sendo duas.
     */
    it('delta com campo opcional ausente não abre versão nova a cada chamada', async () => {
      const comChaveIndefinida = delta([
        daBase('clickup.tarefa.alterar', {
          descricao: 'move etapa — texto próprio desta empresa',
          // chave que a base NÃO tem, declarada com valor indefinido
          desfazer: undefined,
        }),
        daBase('financeiro.lancamento.criar', {
          descricao: 'lançamento — texto próprio desta empresa',
          // idem: a base não declara esquema para esta capacidade
          argsSchema: undefined,
        }),
      ]);

      const primeira = await servico.sobrescrever({ orgId: ORG_A, delta: comChaveIndefinida });
      expect(primeira.criada).toBe(true);

      for (const n of [2, 3]) {
        const r = await servico.sobrescrever({ orgId: ORG_A, delta: comChaveIndefinida });
        expect(r.criada, `chamada ${n} abriu versão`).toBe(false);
      }
      expect(await prisma.policyVersion.count({ where: { orgId: ORG_A } })).toBe(1);

      // e depois de um restart, lendo o documento DE VOLTA do banco
      const depoisDoRestart = await novoServico();
      const quarta = await depoisDoRestart.sobrescrever({
        orgId: ORG_A,
        delta: comChaveIndefinida,
      });
      expect(quarta.criada).toBe(false);
      expect(await prisma.policyVersion.count({ where: { orgId: ORG_A } })).toBe(1);
    });

    /*
     * O critério que só aparece no restart. Ver o cabeçalho deste arquivo: a
     * versão ficava gravada, ativa, e o serviço recém-subido não a lia.
     */
    it('um serviço recém-subido carrega a política da empresa, não a base', async () => {
      await servico.sobrescrever({ orgId: ORG_A, delta: SOBE_TAREFA });

      const outro = await novoServico();
      expect(outro.resolverCapacidade(ORG_A, 'operacao.tarefa.alterar')?.nivel).toBe('R4');
      expect(outro.resolverCapacidade(ORG_B, 'operacao.tarefa.alterar')?.nivel).toBe('R2');
      // e o simulador da tela da Régua decide pela política DELA
      expect(outro.simular(ORG_A, 'operacao.tarefa.alterar').nivel).toBe('R4');
      expect(outro.simular(ORG_B, 'operacao.tarefa.alterar').nivel).toBe('R2');
    });
  });

  /* ---------------------------------------------------------------- RF-P-06 */

  describe('rebaixar nível nunca é automático', () => {
    it('recusa o rebaixamento sem responsável identificado e não grava nada', async () => {
      await expect(
        servico.sobrescrever({ orgId: ORG_A, delta: DESCE_ETAPA, motivo: ASSINATURA.motivo }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(await prisma.policyVersion.count({ where: { orgId: ORG_A } })).toBe(0);
      expect(servico.resolverCapacidade(ORG_A, 'clickup.tarefa.alterar')?.nivel).toBe('R3');
    });

    it('recusa também sem motivo escrito, e a mensagem diz o que afrouxou', async () => {
      const erro = await servico
        .sobrescrever({ orgId: ORG_A, delta: DESCE_ETAPA, autorId: ASSINATURA.autorId })
        .catch((e: Error) => e);

      expect(erro).toBeInstanceOf(ForbiddenException);
      expect((erro as Error).message).toContain('RF-P-06');
      expect((erro as Error).message).toContain('clickup.tarefa.alterar: R3 → R2');
    });

    it('com responsável e motivo escritos, o rebaixamento é aplicado', async () => {
      const r = await servico.sobrescrever({
        orgId: ORG_A,
        delta: DESCE_ETAPA,
        ...ASSINATURA,
      });

      expect(r.criada).toBe(true);
      expect(servico.resolverCapacidade(ORG_A, 'clickup.tarefa.alterar')?.nivel).toBe('R2');

      const gravada = await prisma.policyVersion.findFirstOrThrow({
        where: { orgId: ORG_A, ativaAte: null },
      });
      expect(gravada.autorId).toBe(ASSINATURA.autorId);
      expect(gravada.motivo).toBe(ASSINATURA.motivo);
    });

    /*
     * O rebaixamento que nem assinado passa: o que segura uma escrita externa
     * em R2 é a volta AUTOMÁTICA, e não existe desenviar de WhatsApp. A empresa
     * pode declarar `reversibilidade: automatica` no papel — a trava de
     * reversibilidade da fatia 2.2 cobra o desfazer, e ele não existe.
     *
     * É a diferença entre as duas recusas desta suíte: esta é 400 (o documento
     * não fecha), a de cima é 403 (o documento fecha, falta quem assine).
     */
    it('não dá para comprar desconto de degrau com promessa vazia', async () => {
      const promessaVazia = delta([
        daBase('whatsapp.mensagem.enviar', {
          nivel: 'R2',
          efeito: {
            escreveForaDoOS: true,
            produzArtefato: false,
            reversibilidade: 'automatica',
            exposicaoExterna: false,
            impactoFinanceiro: 'nenhum',
            sensibilidade: 'interna',
            destruicao: false,
            obrigacaoLegal: false,
          },
        }),
      ]);
      const erro = await servico
        .sobrescrever({ orgId: ORG_A, delta: promessaVazia, ...ASSINATURA })
        .catch((e: Error) => e);

      expect(erro).toBeInstanceOf(BadRequestException);
      expect((erro as Error).message).toContain('sem-desfazer');
      expect(servico.resolverCapacidade(ORG_A, 'whatsapp.mensagem.enviar')?.nivel).toBe('R3');
    });

    it('subir nível não exige responsável nenhum', async () => {
      const r = await servico.sobrescrever({ orgId: ORG_A, delta: SOBE_TAREFA });
      expect(r.criada).toBe(true);
      const gravada = await prisma.policyVersion.findFirstOrThrow({ where: { orgId: ORG_A } });
      expect(gravada.autorId).toBeNull();
    });

    /*
     * O desvio óbvio: em vez de rebaixar a capacidade que existe, a empresa
     * declara OUTRO id em R0 e chama por ele. Capacidade sem classificação vale
     * R5 — declarar uma nova é sempre afrouxar.
     */
    it('capacidade nova também exige assinatura, mesmo entrando em R0', async () => {
      const nova = delta([
        {
          id: 'atalho.mensagem.enviar',
          descricao: 'o desvio que a trava tem de pegar',
          nivel: 'R0',
          efeito: {
            escreveForaDoOS: false,
            produzArtefato: false,
            reversibilidade: 'automatica',
            exposicaoExterna: false,
            impactoFinanceiro: 'nenhum',
            sensibilidade: 'interna',
            destruicao: false,
            obrigacaoLegal: false,
          },
        },
      ]);
      await expect(servico.sobrescrever({ orgId: ORG_A, delta: nova })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        servico.sobrescrever({ orgId: ORG_A, delta: nova, ...ASSINATURA }),
      ).resolves.toMatchObject({ criada: true });
    });

    it('afrouxar um limite cai na mesma trava', async () => {
      const solto = delta([], { porDia: 100000 });
      await expect(servico.sobrescrever({ orgId: ORG_A, delta: solto })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      // apertar passa sozinho
      await expect(
        servico.sobrescrever({ orgId: ORG_A, delta: delta([], { porDia: 20 }) }),
      ).resolves.toMatchObject({ criada: true });
      expect(servico.limites(ORG_A).porDia).toBe(20);
    });
  });

  /* ------------------------------------------- a REFERÊNCIA da trava ------- */

  /*
   * O furo que uma revisão adversarial provou três vezes contra este banco.
   *
   * A trava comparava a política resolvida com a BASE HERDADA, nunca com o que
   * estava valendo PARA AQUELA EMPRESA. Enquanto o resultado continuasse igual
   * ou acima da base, toda redução em relação à versão anterior da própria
   * empresa passava sem responsável e sem motivo — e com o diff gravado
   * afirmando que nada mudou, porque contra a base realmente não mudou.
   */
  describe('a trava mede contra o que estava valendo para a empresa', () => {
    it('delta VAZIO não devolve R4 para R2 sem assinatura', async () => {
      await servico.sobrescrever({ orgId: ORG_A, delta: SOBE_TAREFA });
      expect(servico.resolverCapacidade(ORG_A, 'operacao.tarefa.alterar')?.nivel).toBe('R4');

      const erro = await servico
        .sobrescrever({ orgId: ORG_A, delta: VAZIO })
        .catch((e: Error) => e);

      expect(erro).toBeInstanceOf(ForbiddenException);
      expect((erro as Error).message).toContain('operacao.tarefa.alterar: R4 → R2');
      // nada gravado, nada mudado: continua valendo a v1
      expect(await prisma.policyVersion.count({ where: { orgId: ORG_A } })).toBe(1);
      expect(servico.resolverCapacidade(ORG_A, 'operacao.tarefa.alterar')?.nivel).toBe('R4');

      // e com assinatura a devolução é legítima — o requisito não proíbe, cobra responsável
      const r = await servico.sobrescrever({ orgId: ORG_A, delta: VAZIO, ...ASSINATURA });
      expect(r.criada).toBe(true);
      expect(servico.resolverCapacidade(ORG_A, 'operacao.tarefa.alterar')?.nivel).toBe('R2');
      const v2 = await prisma.policyVersion.findFirstOrThrow({
        where: { orgId: ORG_A, ativaAte: null },
      });
      expect(v2.autorId).toBe(ASSINATURA.autorId);
    });

    it('teto diário não volta de 20 para 200 sem assinatura', async () => {
      await servico.sobrescrever({ orgId: ORG_A, delta: delta([], { porDia: 20 }) });
      expect(servico.limites(ORG_A).porDia).toBe(20);

      const erro = await servico.sobrescrever({ orgId: ORG_A, delta: VAZIO }).catch((e: Error) => e);
      expect(erro).toBeInstanceOf(ForbiddenException);
      expect((erro as Error).message).toContain('limite porDia: 20 → 200');
      expect(servico.limites(ORG_A).porDia).toBe(20);
    });

    /*
     * A terceira: o diff gravado MENTIA sobre a direção. Uma queda de R4 para
     * R3 saía como "sobe" porque a base é R2. As duas leituras são verdadeiras
     * — cada uma responde a uma pergunta — e é por isso que as duas ficam
     * gravadas, em colunas com o nome da referência.
     */
    it('queda de R4 para R3 fica registrada como "desce", e não como "sobe"', async () => {
      await servico.sobrescrever({ orgId: ORG_A, delta: SOBE_TAREFA });
      const caiParaR3 = delta([
        daBase('operacao.tarefa.alterar', {
          nivel: 'R3',
          efeito: {
            ...BASE_EMPACOTADA.capacidades.find((c) => c.id === 'operacao.tarefa.alterar')!.efeito,
            reversibilidade: 'manual',
          },
          desfazer: undefined,
        }),
      ]);

      await expect(
        servico.sobrescrever({ orgId: ORG_A, delta: caiParaR3 }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      const r = await servico.sobrescrever({ orgId: ORG_A, delta: caiParaR3, ...ASSINATURA });
      expect(r.diffDaVersaoAnterior!.capacidades[0]).toMatchObject({
        id: 'operacao.tarefa.alterar',
        de: 'R4',
        para: 'R3',
        direcao: 'desce',
      });
      // contra a BASE ela sobe mesmo — R2 → R3 — e é outra pergunta
      expect(r.diffDaBase.capacidades[0]).toMatchObject({ de: 'R2', para: 'R3', direcao: 'sobe' });

      const [atual] = await servico.historico(ORG_A);
      const daVersao = atual.diffDaVersaoAnterior as unknown as DiffDePolitica;
      expect(daVersao.capacidades[0].direcao).toBe('desce');
      expect((atual.diffDaBase as unknown as DiffDePolitica).capacidades[0].direcao).toBe('sobe');
    });
  });

  /* --------------------------------- travas de execução sem mexer no nível - */

  /*
   * Campos da capacidade que SÃO trava de execução. Saíam como "igual" porque
   * só o nível e os limites tinham direção — e o nível não desce em nenhum dos
   * dois casos abaixo.
   */
  describe('desligar trava de execução exige assinatura, mesmo com o nível parado', () => {
    it('trocar o esquema de argumentos por um que aceita tudo é recusado', async () => {
      // `validarArgs` devolve lista vazia quando o schema não declara
      // `properties`: trocar por `{type:'object'}` DESLIGA a validação da porta.
      const semValidacao = delta([
        daBase('operacao.tarefa.listar', { argsSchema: { type: 'object' } }),
      ]);

      const erro = await servico
        .sobrescrever({ orgId: ORG_A, delta: semValidacao })
        .catch((e: Error) => e);
      expect(erro).toBeInstanceOf(ForbiddenException);
      expect((erro as Error).message).toContain('argsSchema');
      expect(await prisma.policyVersion.count({ where: { orgId: ORG_A } })).toBe(0);

      const r = await servico.sobrescrever({
        orgId: ORG_A,
        delta: semValidacao,
        ...ASSINATURA,
      });
      expect(r.diffDaBase.capacidades[0].travas.argsSchema?.direcao).toBe('afrouxa');
    });

    it('acrescentar ferramenta a capacidade que nenhum agente alcançava é recusado', async () => {
      // Doze capacidades da base não têm ferramenta: estão declaradas e fora do
      // alcance de qualquer agente, porque `tool-adapter.ts` filtra por ela.
      expect(servico.resolverCapacidade(ORG_A, 'espelho.consultar')).toBeTruthy();
      const comFerramenta = delta([
        daBase('espelho.consultar', { ferramenta: 'espelho_ler' }),
      ]);

      const erro = await servico
        .sobrescrever({ orgId: ORG_A, delta: comFerramenta })
        .catch((e: Error) => e);
      expect(erro).toBeInstanceOf(ForbiddenException);
      expect((erro as Error).message).toContain('espelho.consultar');
      expect((erro as Error).message).toContain('ferramenta');

      await expect(
        servico.sobrescrever({ orgId: ORG_A, delta: comFerramenta, ...ASSINATURA }),
      ).resolves.toMatchObject({ criada: true });
    });
  });

  /* ------------------------------------------------- catálogo que não fecha */

  describe('a sobrescrita passa pelas mesmas duas travas do catálogo', () => {
    it('recusa nível declarado que não bate com o efeito', async () => {
      const mentiroso = delta([daBase('email.enviar', { nivel: 'R5' })]);
      const erro = await servico
        .sobrescrever({ orgId: ORG_A, delta: mentiroso, ...ASSINATURA })
        .catch((e: Error) => e);
      expect(erro).toBeInstanceOf(BadRequestException);
      expect((erro as Error).message).toContain('email.enviar');
      expect(await prisma.policyVersion.count({ where: { orgId: ORG_A } })).toBe(0);
    });

    it('recusa desfazer pendurado — a trava que a fatia 2.2 criou', async () => {
      const pendurado = delta([
        daBase('crm.lead.alterar', { desfazer: 'crm.lead.desarquivar.que.nao.existe' }),
      ]);
      const erro = await servico
        .sobrescrever({ orgId: ORG_A, delta: pendurado, ...ASSINATURA })
        .catch((e: Error) => e);
      expect(erro).toBeInstanceOf(BadRequestException);
      expect((erro as Error).message).toContain('desfazer-inexistente');
    });

    it('recusa delta malformado antes de tocar no banco', async () => {
      await expect(
        servico.sobrescrever({ orgId: ORG_A, delta: { nao: 'é um delta' } }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(await prisma.policyVersion.count({ where: { orgId: ORG_A } })).toBe(0);
    });

    it('recusa sobrescrita sem empresa resolvida — ausência de tenant é erro', async () => {
      await expect(servico.sobrescrever({ orgId: '', delta: SOBE_TAREFA })).rejects.toThrow(
        /tenant não resolvido/,
      );
    });
  });

  /* ------------------------------------------------------------- histórico */

  describe('o histórico diz quem mudou o quê e quando', () => {
    it('cada sobrescrita fecha a anterior e guarda autor, motivo e diff', async () => {
      await servico.sobrescrever({ orgId: ORG_A, delta: SOBE_TAREFA });
      await servico.sobrescrever({
        orgId: ORG_A,
        delta: delta([...SOBE_TAREFA.capacidades, ...DESCE_ETAPA.capacidades]),
        ...ASSINATURA,
      });

      const historico = await servico.historico(ORG_A);
      expect(historico.map((h) => h.versao)).toEqual([2, 1]);

      const [atual, primeira] = historico;
      expect(atual.ativaAte).toBeNull();
      expect(primeira.ativaAte).toBeInstanceOf(Date);
      expect(primeira.ativaAte!.getTime()).toBeLessThanOrEqual(atual.ativaDe.getTime());

      // quem
      expect(primeira.autorId).toBeNull();
      expect(atual.autorId).toBe(ASSINATURA.autorId);
      expect(atual.motivo).toBe(ASSINATURA.motivo);

      /*
       * O quê, nas DUAS referências — e é por isso que são duas colunas.
       *
       * `diffDaBase` lista as DUAS capacidades que o delta declara: ele é
       * contra a BASE HERDADA, o ponto de comparação estável para "o que esta
       * empresa tem de diferente da ROOT".
       *
       * `diffDaVersaoAnterior` lista só a que mudou DESDE A V1, que é a
       * pergunta "o que esta pessoa fez neste dia". Uma coluna só chamada
       * `diff` fazia três escritores gravarem referências diferentes nela.
       */
      const daBase = atual.diffDaBase as unknown as DiffDePolitica;
      expect(daBase.capacidades.map((c) => c.id).sort()).toEqual([
        'clickup.tarefa.alterar',
        'operacao.tarefa.alterar',
      ]);
      expect(daBase.capacidades.find((c) => c.id === 'clickup.tarefa.alterar')).toMatchObject({
        de: 'R3',
        para: 'R2',
        direcao: 'desce',
      });

      const daAnterior = atual.diffDaVersaoAnterior as unknown as DiffDePolitica;
      expect(daAnterior.capacidades.map((c) => c.id)).toEqual(['clickup.tarefa.alterar']);
      // a primeira versão não tem anterior contra o que medir
      expect(primeira.diffDaVersaoAnterior).toBeNull();
    });

    /*
     * O diff é GRAVADO por versão, não derivado na leitura: cada linha continua
     * descrevendo o que AQUELA mudança fez, mesmo depois de a empresa ter sido
     * revista. Uma leitura que recalculasse contra o estado de hoje responderia
     * "a v1 não mudou nada" — e a pergunta do histórico é o que a pessoa fez
     * naquele dia, não o que sobrou da comparação de agora.
     *
     * Esta suíte NÃO mexe na PolicyVersion de orgId nulo para provar isso. Na
     * CI os arquivos de teste rodam em paralelo contra o MESMO banco, e a base
     * é o documento que todas as outras suítes carregam no boot do serviço
     * delas: mudá-la, ainda que por um instante e com restauração no `finally`,
     * é fazer outra suíte decidir com uma régua que ninguém escreveu.
     */
    it('cada versão guarda o próprio diff, e ele não é recalculado depois', async () => {
      const primeira = await servico.sobrescrever({ orgId: ORG_A, delta: SOBE_TAREFA });
      await servico.sobrescrever({
        orgId: ORG_A,
        delta: delta([...SOBE_TAREFA.capacidades, ...DESCE_ETAPA.capacidades]),
        ...ASSINATURA,
      });

      const [v2, v1] = await servico.historico(ORG_A);

      // a v1 continua dizendo o que a v1 fez, e não "nada mudou desde então"
      expect(v1.diffDaBase).toEqual(primeira.diffDaBase as unknown);
      expect((v1.diffDaBase as unknown as DiffDePolitica).capacidades.map((c) => c.id)).toEqual([
        'operacao.tarefa.alterar',
      ]);
      // e a v2 tem o diff DELA, diferente do da v1
      expect((v2.diffDaBase as unknown as DiffDePolitica).capacidades).toHaveLength(2);
      expect(v2.diffDaBase).not.toEqual(v1.diffDaBase);
    });

    it('empresa que nunca sobrescreveu tem histórico vazio e herda a base', async () => {
      expect(await servico.historico(ORG_B)).toEqual([]);
      expect(servico.capacidades(ORG_B)).toEqual(servico.baseHerdada().capacidades);
    });
  });
});
