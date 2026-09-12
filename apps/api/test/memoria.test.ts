import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ActorType, ContextKind, ContextSource, PrismaClient } from '@prisma/client';

import { MemoriaService, VaultSuspeitaError } from '../src/memory/memoria.service';
import {
  chaveDaVault,
  exigirProcedencia,
  formaDoCorpo,
  hashDoCorpo,
  rotuloDeProcedencia,
  SEM_EVENTO,
} from '../src/memory/procedencia';
import {
  contarVetores,
  desfazerMigracao,
  migrarConhecimentoParaAMemoria,
} from '../src/memory/migrar-conhecimento';
import { comContexto } from '../src/common/contexto-execucao';
import { EventLogService } from '../src/gateway/event-log.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * ============================================================================
 * A MEMÓRIA — fatia 4.1+4.2 (RF-M-01, RF-M-06) · ver docs/adr/ADR-011-memoria.md
 * ============================================================================
 *
 * O QUE ESTA SUÍTE PRECISA PROVAR, e o que separa a fatia feita da fingida:
 *
 *   1. A CONTAGEM DE VETORES. A fatia diz "migra sem perder os vetores", e o
 *      critério é número, não leitura de código: conta antes, conta depois, e —
 *      mais forte do que a contagem — compara os vetores COLUNA A COLUNA. Um
 *      `INSERT` que recalculasse embedding passaria na contagem e falharia aqui,
 *      que é exatamente o defeito caro (custa dinheiro no fornecedor e produz
 *      números diferentes dos que já estão indexados).
 *
 *   2. QUE A PROJEÇÃO NÃO DIVERGE DA FONTE. É o modo de falha da decisão do
 *      ADR-011: `ContextItem.versao` tem de ser sempre o maior `versao` do
 *      histórico, e cada mudança tem de ter deixado um evento no RASTRO.
 *
 *   3. QUE O CORPO CRU NÃO VAZA PARA O RASTRO. O registro carrega resumo, hash e
 *      a referência para a versão; uma nota pode ter quilobytes e o RASTRO não é
 *      uma segunda cópia do banco.
 *
 *   4. QUE TODA NOTA CARREGA PROCEDÊNCIA (RF-M-02) — e que a falta LANÇA na
 *      entrada, que é o único lugar onde ainda dá para recusar.
 *
 *   5. QUE A REINDEXAÇÃO NÃO VERSIONA À TOA. A vault é relida a cada 30 min;
 *      sem a comparação de hash, a memória ganharia 48 versões por nota por dia
 *      e o histórico de decisões viraria ruído.
 *
 * A PRIMEIRA SEÇÃO RODA SEM BANCO (funções puras). O resto se pula sozinho sem
 * `TEST_DATABASE_URL`, como `porta.test.ts`.
 *
 * COMO RODAR contra o Postgres descartável:
 *   TEST_DATABASE_URL='postgresql://mkt:shadow@localhost:55432/marketing_os_test' \
 *     pnpm --filter @mktos/api test -- test/memoria.test.ts
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (empresas, notas de contexto e rastro)');

const MARCA = `mem_${randomUUID().slice(0, 8)}`;
const ORG_A = `org-memoria-a-${MARCA}`;
const ORG_B = `org-memoria-b-${MARCA}`;

function naEmpresa<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  return comContexto(
    {
      orgId,
      actorType: ActorType.user,
      actorId: 'operador-teste',
      correlationId: `teste-memoria-${MARCA}`,
      origem: 'script',
    },
    fn,
  );
}

/** Um vetor determinístico e normalizado, para o KNN ser previsível. */
function vetor(semente: number): number[] {
  const v: number[] = [];
  for (let i = 0; i < 1536; i++) v.push(Math.sin(semente * 7.13 + i * 0.001));
  return v;
}

// ===========================================================================
// 1. Sem banco: as funções que a produção e o comando de migração compartilham
// ===========================================================================

describe('procedência e corte — as funções que os dois lados usam', () => {
  it('o rótulo é EXATAMENTE o que o montador de contexto já usa para a vault', () => {
    /*
     * A CATRACA DO RÓTULO. `context-builder.service.ts` monta
     * `origem: \`vault:${path}\`` para as notas da base de conhecimento. No dia
     * em que a memória alimentar o contexto, os dois lados têm de dizer a MESMA
     * coisa sobre a MESMA nota — duas procedências para um insumo só é a forma
     * mais silenciosa de RF-M-02 deixar de valer.
     */
    expect(rotuloDeProcedencia(ContextSource.vault, 'Root/20-empresa/regras.md')).toBe(
      'vault:Root/20-empresa/regras.md',
    );
    expect(chaveDaVault('Root/20-empresa/regras.md')).toBe('vault:Root/20-empresa/regras.md');
    // Sem referência sobra o tipo, que já é mais do que "de algum lugar".
    expect(rotuloDeProcedencia(ContextSource.upload, null)).toBe('upload');
    expect(rotuloDeProcedencia(ContextSource.promocao, '  ')).toBe('promocao');
  });

  it('procedência ausente ou inventada LANÇA — a recusa é na entrada', () => {
    expect(() => exigirProcedencia(undefined, 'teste')).toThrow(/sem procedência/);
    expect(() => exigirProcedencia('' as never, 'teste')).toThrow(/sem procedência/);
    expect(() => exigirProcedencia('telepatia' as never, 'teste')).toThrow(/sem procedência/);
    expect(exigirProcedencia(ContextSource.vault, 'teste')).toBe(ContextSource.vault);
  });

  it('o hash ignora fim de linha e espaço nas pontas — senão a nota versiona sozinha', () => {
    /*
     * Um `\r\n` que virou `\n` na viagem entre sistemas operacionais não é
     * mudança de conteúdo. Tratá-lo como mudança faria toda nota ganhar versão
     * nova a cada reindexação em uma máquina diferente.
     */
    expect(hashDoCorpo('linha um\r\nlinha dois')).toBe(hashDoCorpo('linha um\nlinha dois'));
    expect(hashDoCorpo('  texto  ')).toBe(hashDoCorpo('texto'));
    expect(hashDoCorpo('texto')).not.toBe(hashDoCorpo('outro texto'));
  });

  it('a FORMA do corpo não carrega nenhuma letra do corpo', () => {
    /*
     * A versão anterior desta fatia mandava um EXCERTO de 280 letras para o
     * RASTRO — ou seja, corpo curto (a maioria das regras da casa) entrava
     * inteiro. O RASTRO é lido com `auditoria.ver` e a memória com
     * `obsidian.ver`: são públicos diferentes, e conteúdo do cliente não
     * atravessa essa fronteira sem alguém decidir que atravessa.
     */
    const corpo = 'O desconto máximo para a Padaria do Zé é de 7%.';
    const forma = formaDoCorpo(corpo, hashDoCorpo(corpo));
    for (const palavra of ['desconto', 'Padaria', 'Zé', '7%']) {
      expect(forma, `"${palavra}" vazou para a forma`).not.toContain(palavra);
    }
    // O que ela carrega: tamanho e hash — o bastante para provar QUE mudou.
    expect(forma).toContain(`${Array.from(corpo).length} caractere(s)`);
    expect(forma).toContain(`sha256:${hashDoCorpo(corpo).slice(0, 12)}`);
  });

  it('a contagem da forma é em PONTO DE CÓDIGO, não em unidade de 16 bits', () => {
    // Emoji e ideograma são UM caractere para quem lê e dois para o `.length`
    // do JavaScript. Um número que diz 4 para um texto de 2 letras não ajuda.
    const corpo = '🚀漢';
    expect(corpo.length).toBe(3); // o que o `.length` ingênuo diria
    expect(formaDoCorpo(corpo, hashDoCorpo(corpo))).toContain('2 caractere(s)');
  });

  it('os dois motivos de "sem evento" são valores DIFERENTES', () => {
    /*
     * Enquanto eram o mesmo (nulo e nada mais), a versão trazida pela migração
     * do acervo ficava idêntica à versão cujo registro de evento FALHOU — e
     * depois de migrar o acervo o histórico exibia centenas de linhas com cara
     * de erro. Sinal com dois significados não é sinal.
     */
    expect(SEM_EVENTO.migracao).not.toBe(SEM_EVENTO.falha);
  });
});

// ===========================================================================
// 2. Com banco
// ===========================================================================

describe.skipIf(!URL)('a memória versiona, guarda procedência e registra no rastro', () => {
  let prisma: PrismaClient;
  let memoria: MemoriaService;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    for (const [id, slug] of [
      [ORG_A, `memoria-a-${MARCA}`],
      [ORG_B, `memoria-b-${MARCA}`],
    ] as const) {
      await prisma.org.upsert({ where: { id }, create: { id, name: `Empresa ${slug}`, slug }, update: {} });
    }
    memoria = new MemoriaService(
      prisma as unknown as PrismaService,
      new EventLogService(prisma as never),
    );
  });

  afterAll(async () => {
    await limpar(prisma);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.contextItem.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await prisma.knowledgeNote.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
  });

  const criar = (orgId: string, extras: Partial<Parameters<MemoriaService['criar']>[1]> = {}) =>
    naEmpresa(orgId, () =>
      memoria.criar(orgId, {
        chave: 'regras/desconto',
        kind: ContextKind.regra,
        title: 'Desconto máximo',
        body: 'O desconto máximo é de 7%.',
        sourceType: ContextSource.operador,
        sourceRef: 'reunião de 10/09',
        ...extras,
      } as never),
    );

  it('criar deixa a nota na versão 1, com procedência e evento no rastro', async () => {
    const nota = await criar(ORG_A);

    expect(nota.versao).toBe(1);
    expect(nota.procedencia).toBe('operador:reunião de 10/09');
    expect(nota.contentHash).toBe(hashDoCorpo('O desconto máximo é de 7%.'));
    expect(nota.arquivadoEm).toBeNull();

    const historico = await naEmpresa(ORG_A, () => memoria.historico(ORG_A, nota.id));
    expect(historico).toHaveLength(1);
    expect(historico[0].mudanca).toBe('criacao');
    expect(historico[0].body).toBe('O desconto máximo é de 7%.');
    // O ELO COM O RASTRO: é ele que prova que a versão não foi escrita por fora.
    expect(historico[0].eventoId).toBeTruthy();
    expect(historico[0].eventoSeq).toBeTruthy();

    const evento = await prisma.eventLog.findFirstOrThrow({
      where: {
        orgId: ORG_A,
        tipo: 'memoria.item.criado',
        payload: { path: ['itemId'], equals: nota.id },
      },
    });
    const payload = evento.payload as Record<string, unknown>;
    expect(payload.itemId).toBe(nota.id);
    expect(payload.fontes).toEqual(['operador:reunião de 10/09']);
    expect(payload.referencia).toBe(`ContextItemVersion:${historico[0].id}`);
    /*
     * O `contentHash` DA LINHA é o da versão, e é ele que torna a conferência de
     * integridade possível: ele entra no hash da cadeia, então esconder uma
     * edição da versão exigiria mexer também no evento — o que quebra a cadeia.
     */
    expect(evento.contentHash).toBe(nota.contentHash);
    // O corpo não entra: o que entra é a FORMA.
    expect(payload.body).toBeUndefined();
    expect(String(payload.resumo)).toContain('criacao · versão 1');
    expect(String(payload.resumo)).toContain(`sha256:${nota.contentHash.slice(0, 12)}`);
  });

  it('o CORPO e o TÍTULO não entram no rastro — nos quatro verbos, curto ou longo', async () => {
    /*
     * A versão anterior mandava um excerto de 280 letras, então corpo CURTO
     * entrava inteiro, junto com o título e a chave. As três coisas são texto
     * escolhido pelo cliente — e a chave costuma carregar o nome de um cliente
     * DELE. O RASTRO é lido com `auditoria.ver`; a memória, com `obsidian.ver`.
     */
    const CURTO = 'desconto máximo 7% para a Padaria do Zé';
    const LONGO = `${'a regra secreta da casa '.repeat(40)}fim`;
    const nota = await criar(ORG_A, {
      chave: 'clientes/padaria-do-ze/regras',
      title: 'Padaria do Zé — desconto',
      body: CURTO,
    });
    await naEmpresa(ORG_A, () => memoria.alterar(ORG_A, nota.id, { body: LONGO }));
    await naEmpresa(ORG_A, () => memoria.arquivar(ORG_A, nota.id, 'a regra saiu'));
    await naEmpresa(ORG_A, () => memoria.restaurar(ORG_A, nota.id, 'voltou'));

    /*
     * O FILTRO POR `itemId` NÃO É ZELO: `EventLog` é append-only por regra do
     * banco (02-CONSTRAINTS), então o `beforeEach` desta suíte não o limpa e os
     * eventos dos casos anteriores continuam na mesma empresa. Contar sem
     * filtrar mediria a suíte, não a nota.
     */
    const eventos = await prisma.eventLog.findMany({
      where: {
        orgId: ORG_A,
        tipo: { startsWith: 'memoria.item.' },
        payload: { path: ['itemId'], equals: nota.id },
      },
    });
    expect(eventos).toHaveLength(4);
    for (const e of eventos) {
      const cru = JSON.stringify(e.payload);
      expect(cru, `${e.tipo} vazou o corpo curto`).not.toContain('Padaria do Zé — desconto');
      expect(cru, `${e.tipo} vazou o corpo curto`).not.toContain(CURTO);
      expect(cru, `${e.tipo} vazou o corpo longo`).not.toContain('a regra secreta da casa');
      // A chave vai SIGILOSA — é ela que carrega o nome do cliente.
      expect(cru, `${e.tipo} vazou a chave`).not.toContain('padaria-do-ze');
      const p = e.payload as Record<string, Record<string, unknown>>;
      expect(p.argumentos.chave).toMatchObject({ sigiloso: true, algoritmo: 'sha256' });
      expect(p.estadoNovo.title).toMatchObject({ sigiloso: true });
    }
  });

  it('nota sem procedência é recusada — RF-M-02 se cobra na entrada', async () => {
    await expect(criar(ORG_A, { sourceType: undefined as never })).rejects.toThrow(
      /sem procedência/,
    );
    expect(await prisma.contextItem.count({ where: { orgId: ORG_A } })).toBe(0);
  });

  it('chave repetida é conflito: a memória versiona, não duplica', async () => {
    await criar(ORG_A);
    await expect(criar(ORG_A)).rejects.toThrow(/Já existe nota com a chave/);
    expect(await prisma.contextItem.count({ where: { orgId: ORG_A } })).toBe(1);
  });

  it('alterar sobe a versão e o histórico guarda o corpo ANTIGO', async () => {
    const nota = await criar(ORG_A);
    const depois = await naEmpresa(ORG_A, () =>
      memoria.alterar(ORG_A, nota.id, {
        body: 'O desconto máximo é de 12%.',
        motivo: 'decisão da reunião de 11/09',
      }),
    );

    expect(depois.versao).toBe(2);
    expect(depois.body).toBe('O desconto máximo é de 12%.');

    const historico = await naEmpresa(ORG_A, () => memoria.historico(ORG_A, nota.id));
    expect(historico.map((v) => v.versao)).toEqual([2, 1]);
    expect(historico[1].body).toBe('O desconto máximo é de 7%.');
    expect(historico[0].motivo).toBe('decisão da reunião de 11/09');

    // O EVENTO CARREGA O ANTES E O DEPOIS, que é o que a régua pede em R4.
    const evento = await prisma.eventLog.findFirstOrThrow({
      where: {
        orgId: ORG_A,
        tipo: 'memoria.item.alterado',
        payload: { path: ['itemId'], equals: nota.id },
      },
    });
    const payload = evento.payload as Record<string, Record<string, unknown>>;
    expect(payload.estadoAnterior.versao).toBe(1);
    expect(payload.estadoNovo.versao).toBe(2);
    expect(payload.estadoAnterior.contentHash).not.toBe(payload.estadoNovo.contentHash);
  });

  it('a PROJEÇÃO não diverge da fonte: versao do item = maior versão do histórico', async () => {
    /*
     * O modo de falha da decisão do ADR-011. Se estas duas divergirem, a tela
     * mostra uma versão e o histórico outra, e não há como saber qual é a nota.
     *
     * ESTE CASO, SOZINHO, NÃO PROVA QUASE NADA — e a revisão adversarial mostrou
     * por quê: ele continuava VERDE enquanto duas alterações concorrentes
     * perdiam a do meio, porque a versão da projeção seguia sendo a maior do
     * histórico justamente enquanto a história mentia. Quem cobra a corrida é
     * "duas conexões, duas alterações" mais abaixo; este aqui cobre a sequência
     * dos quatro verbos em série, que é outra coisa.
     */
    const nota = await criar(ORG_A);
    await naEmpresa(ORG_A, () => memoria.alterar(ORG_A, nota.id, { title: 'Desconto' }));
    await naEmpresa(ORG_A, () => memoria.arquivar(ORG_A, nota.id, 'regra revogada'));
    await naEmpresa(ORG_A, () => memoria.restaurar(ORG_A, nota.id, 'voltou a valer'));

    const atual = await naEmpresa(ORG_A, () => memoria.obter(ORG_A, nota.id));
    const historico = await naEmpresa(ORG_A, () => memoria.historico(ORG_A, nota.id));
    expect(atual?.versao).toBe(4);
    expect(Math.max(...historico.map((v) => v.versao))).toBe(atual?.versao);
    // Sem buraco na sequência: o cadeado da empresa é o que garante isso.
    expect(historico.map((v) => v.versao).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(historico.map((v) => v.mudanca)).toEqual([
      'restauracao',
      'arquivamento',
      'alteracao',
      'criacao',
    ]);
    // E TODA mudança deixou evento.
    expect(historico.every((v) => v.eventoId)).toBe(true);
  });

  it('arquivar tira da listagem e da busca, e NÃO apaga o histórico', async () => {
    const nota = await criar(ORG_A);
    await naEmpresa(ORG_A, () => memoria.arquivar(ORG_A, nota.id, 'a regra mudou'));

    const listaPadrao = await naEmpresa(ORG_A, () => memoria.listar(ORG_A));
    expect(listaPadrao.itens.map((n) => n.id)).not.toContain(nota.id);

    const comArquivadas = await naEmpresa(ORG_A, () =>
      memoria.listar(ORG_A, { incluirArquivadas: true }),
    );
    expect(comArquivadas.itens.map((n) => n.id)).toContain(nota.id);

    const busca = await naEmpresa(ORG_A, () => memoria.buscar(ORG_A, 'desconto'));
    expect(busca.itens.map((n) => n.id)).not.toContain(nota.id);

    // O histórico continua inteiro: arquivar não é apagar (ADR-011).
    const historico = await naEmpresa(ORG_A, () => memoria.historico(ORG_A, nota.id));
    expect(historico.length).toBe(2);
    expect(historico[1].body).toBe('O desconto máximo é de 7%.');
  });

  it('RF-M-06: a resposta promovida nasce com a procedência da promoção', async () => {
    const nota = await naEmpresa(ORG_A, () =>
      memoria.promover(ORG_A, {
        chave: 'decisoes/canal-de-entrada',
        kind: ContextKind.decisao,
        title: 'Canal de entrada',
        body: 'A entrada é pelo WhatsApp, e o e-mail vira registro.',
        sessionId: 'sessao-123',
      }),
    );
    expect(nota.sourceType).toBe(ContextSource.promocao);
    expect(nota.procedencia).toBe('promocao:sessao-123');
    /*
     * A PROCEDÊNCIA IMPORTA MAIS AQUI do que em qualquer outra origem: o texto
     * foi produzido por um modelo, e quem ler a nota daqui a um ano precisa
     * saber disso sem ter de deduzir pelo estilo.
     */
    const historico = await naEmpresa(ORG_A, () => memoria.historico(ORG_A, nota.id));
    expect(historico[0].procedencia).toBe('promocao:sessao-123');
  });

  it('a busca textual não atravessa empresa', async () => {
    await criar(ORG_A, { body: 'segredo da empresa A: desconto de 7%' });
    await criar(ORG_B, { body: 'segredo da empresa B: desconto de 23%' });

    const deA = await naEmpresa(ORG_A, () => memoria.buscar(ORG_A, 'segredo'));
    expect(deA.modo).toBe('textual');
    expect(deA.itens).toHaveLength(1);
    expect(deA.itens[0].body).toContain('empresa A');
  });

  it('a busca SEMÂNTICA filtra empresa NA CONSULTA — o KNN não pesca o vizinho', async () => {
    /*
     * ADR-003: o filtro de empresa vai na consulta, não numa camada acima dela.
     * Esta suíte roda com a conexão DONA (sem RLS neste banco), então o que ela
     * mede é a PRIMEIRA tranca — que é justamente a que some quando alguém
     * "simplifica" a consulta confiando na policy.
     */
    const deA = await criar(ORG_A, { chave: 'regras/a', body: 'regra da casa A' });
    const deB = await criar(ORG_B, { chave: 'regras/b', body: 'regra da casa B' });
    // O vetor de B é o MAIS PRÓXIMO da consulta: sem filtro, ele viria em 1º.
    await memoria.gravarVetor(ORG_A, deA.id, vetor(10));
    await memoria.gravarVetor(ORG_B, deB.id, vetor(1));

    const achados = await naEmpresa(ORG_A, () => memoria.buscar(ORG_A, 'regra', 10, vetor(1)));
    expect(achados.modo).toBe('semantica');
    expect(achados.itens.map((n) => n.id)).toEqual([deA.id]);
  });

  it('vetor que o banco RECUSA não impede o evento de existir', async () => {
    /*
     * O defeito que este caso fecha: a gravação do vetor vinha ANTES do
     * registro do evento. Uma falha ali — vetor com dimensão errada, cota do
     * fornecedor, pgvector reclamando — subia de `criar` e o evento NUNCA era
     * escrito. Na volta seguinte da vault o hash batia, a nota contava como
     * inalterada, e a mudança ficava para sempre fora do rastro.
     *
     * A assimetria que decide a ordem: vetor perdido volta na próxima passada
     * (`semVetor` o encontra); evento perdido não volta nunca.
     */
    const nota = await criar(ORG_A, {
      chave: 'vetor/torto',
      embedding: [1, 2, 3], // a coluna é vector(1536): o Postgres recusa
    });

    expect(nota.temVetor).toBe(false);
    const historico = await naEmpresa(ORG_A, () => memoria.historico(ORG_A, nota.id));
    expect(historico[0].eventoId, 'a falha do vetor levou o evento junto').toBeTruthy();
    // E ela entra na fila de vetorização, em vez de ficar perdida.
    const pendentes = await naEmpresa(ORG_A, () => memoria.semVetor(ORG_A));
    expect(pendentes.map((n) => n.id)).toContain(nota.id);
  });

  it('sem vetor a busca CAI para textual em vez de ficar indisponível (RF-M-03)', async () => {
    await criar(ORG_A, { body: 'a régua de cobrança começa em D+3' });
    const achados = await naEmpresa(ORG_A, () => memoria.buscar(ORG_A, 'cobrança', 10, null));
    expect(achados.modo).toBe('textual');
    expect(achados.itens).toHaveLength(1);
  });
});

// ===========================================================================
// 2b. A CORRIDA — duas conexões, e o defeito que reprovou a fatia
// ===========================================================================

describe.skipIf(!URL)('duas alterações concorrentes não perdem a do meio', () => {
  /*
   * O DEFEITO, como ele era: `alterar` lia o estado corrente FORA da transação,
   * montava os dados a partir daquela leitura e só então pegava o cadeado — que
   * protegia apenas a NUMERAÇÃO. Duas alterações simultâneas liam a versão 1, a
   * primeira gravava a 2, e a segunda gravava a 3 COM OS DADOS DA 1. A nota
   * terminava na versão 3 com o título da versão 1, a mudança do meio sumia sem
   * nenhum evento dizendo que sumiu, e — o que transforma isto de defeito de
   * concorrência em defeito de PROVA — os dois eventos declaravam
   * `estadoAnterior` na MESMA versão 1. A cadeia mentia.
   *
   * Medido na revisão: 12 corridas, 12 perdas em 12.
   *
   * DUAS CONEXÕES DE VERDADE, e não duas chamadas na mesma: com um `PrismaClient`
   * só, as duas transações disputariam o pool do mesmo cliente e o `Promise.all`
   * poderia serializá-las por acaso — provando nada. Cada lado aqui tem o seu
   * cliente, como dois containers da API têm.
   *
   * É REPRODUZÍVEL EM PRODUÇÃO: a rotina de reindexação (cron) e o botão de
   * sincronizar chamam o mesmo caminho que a edição na tela.
   */
  let prismaA: PrismaClient;
  let prismaB: PrismaClient;
  let memoriaA: MemoriaService;
  let memoriaB: MemoriaService;

  beforeAll(async () => {
    prismaA = new PrismaClient({ datasources: { db: { url: URL } } });
    prismaB = new PrismaClient({ datasources: { db: { url: URL } } });
    await Promise.all([prismaA.$connect(), prismaB.$connect()]);
    await prismaA.org.upsert({
      where: { id: ORG_A },
      create: { id: ORG_A, name: 'Empresa corrida', slug: `memoria-a-${MARCA}` },
      update: {},
    });
    memoriaA = new MemoriaService(
      prismaA as unknown as PrismaService,
      new EventLogService(prismaA as never),
    );
    memoriaB = new MemoriaService(
      prismaB as unknown as PrismaService,
      new EventLogService(prismaB as never),
    );
  });

  afterAll(async () => {
    await prismaA.contextItem.deleteMany({ where: { orgId: ORG_A } });
    await Promise.all([prismaA.$disconnect(), prismaB.$disconnect()]);
  });

  it('nenhuma das duas escritas some, e os eventos encadeiam 1→2→3', async () => {
    const nota = await naEmpresa(ORG_A, () =>
      memoriaA.criar(ORG_A, {
        chave: `corrida/${MARCA}`,
        title: 'título zero',
        body: 'corpo zero',
        sourceType: ContextSource.operador,
        sourceRef: 'suite',
      }),
    );

    /*
     * OS DOIS LADOS MEXEM EM CAMPOS DIFERENTES, e isso é o coração do caso.
     * Se os dois mandassem título E corpo, o valor do lado que escrevesse por
     * último venceria de qualquer jeito — inclusive com a leitura fora do
     * cadeado —, e o caso passaria sem medir nada. É preciso que cada lado
     * DEIXE UM CAMPO DE FORA: o campo omitido é copiado do estado lido, e é aí
     * que a leitura velha apaga a escrita do outro.
     */
    const [ladoA, ladoB] = await Promise.allSettled([
      naEmpresa(ORG_A, () => memoriaA.alterar(ORG_A, nota.id, { title: 'título A', motivo: 'A' })),
      naEmpresa(ORG_A, () => memoriaB.alterar(ORG_A, nota.id, { body: 'corpo B', motivo: 'B' })),
    ]);
    expect(ladoA.status, 'o lado A falhou').toBe('fulfilled');
    expect(ladoB.status, 'o lado B falhou').toBe('fulfilled');

    const historico = await naEmpresa(ORG_A, () => memoriaA.historico(ORG_A, nota.id));
    expect(historico.map((v) => v.versao)).toEqual([3, 2, 1]);

    /*
     * NENHUMA DAS DUAS SOME. Quem chegou primeiro é do escalonador e não
     * interessa; o que interessa é o estado FINAL ter as duas mudanças. Com a
     * leitura fora do cadeado, a nota terminava na versão 3 com o título da
     * versão 1 (ou com o corpo da versão 1), e a mudança do meio sumia sem
     * nenhum evento dizendo que sumiu.
     */
    const corrente = await naEmpresa(ORG_A, () => memoriaA.obter(ORG_A, nota.id));
    expect(corrente?.versao).toBe(3);
    expect(corrente?.title, 'a alteração do título se perdeu').toBe('título A');
    expect(corrente?.body, 'a alteração do corpo se perdeu').toBe('corpo B');

    // E a versão 2 guarda o estado intermediário de verdade: uma das duas
    // mudanças aplicada, a outra ainda não.
    const v2 = historico.find((v) => v.versao === 2)!;
    expect([v2.title, v2.body]).toContain(
      v2.title === 'título A' ? 'corpo zero' : 'título zero',
    );

    /*
     * E A CADEIA NÃO MENTE. Os dois eventos de alteração declaram partir de
     * versões DIFERENTES — 1 e 2 —, porque o segundo leu o estado que o primeiro
     * deixou. Era exatamente aqui que o defeito ficava visível: antes, os dois
     * diziam `estadoAnterior.versao = 1`.
     */
    const eventos = await prismaA.eventLog.findMany({
      // Por `itemId`: `EventLog` é append-only e guarda o que os outros casos
      // desta suíte escreveram na mesma empresa.
      where: {
        orgId: ORG_A,
        tipo: 'memoria.item.alterado',
        payload: { path: ['itemId'], equals: nota.id },
      },
      orderBy: { seq: 'asc' },
    });
    expect(eventos).toHaveLength(2);
    const partiuDe = eventos
      .map((e) => (e.payload as Record<string, Record<string, unknown>>).estadoAnterior.versao)
      .sort();
    expect(partiuDe, 'os dois eventos declararam a MESMA versão anterior').toEqual([1, 2]);
    const chegouEm = eventos
      .map((e) => (e.payload as Record<string, Record<string, unknown>>).estadoNovo.versao)
      .sort();
    expect(chegouEm).toEqual([2, 3]);
  }, 30_000);

  it('duas criações com a MESMA chave devolvem a recusa amigável, não o erro cru', async () => {
    /*
     * A conferência de chave repetida morava FORA da transação: as duas passavam
     * por ela e a segunda estourava no índice único, subindo
     * `PrismaClientKnownRequestError` ("Unique constraint failed") — um 500 para
     * quem só digitou uma chave que já existia. Agora a conferência é dentro do
     * cadeado, e a violação do índice é traduzida como segunda tranca.
     */
    const chave = `disputada/${MARCA}`;
    const entrada = {
      chave,
      title: 'mesma chave',
      body: 'corpo',
      sourceType: ContextSource.operador,
      sourceRef: 'suite',
    };
    const [a, b] = await Promise.allSettled([
      naEmpresa(ORG_A, () => memoriaA.criar(ORG_A, entrada)),
      naEmpresa(ORG_A, () => memoriaB.criar(ORG_A, entrada)),
    ]);

    const recusas = [a, b].filter((r) => r.status === 'rejected');
    expect(recusas).toHaveLength(1);
    const erro = (recusas[0] as PromiseRejectedResult).reason as Error & { status?: number };
    expect(erro.message).toMatch(/Já existe nota com a chave/);
    expect(erro.status, 'subiu erro cru do Prisma em vez da recusa').toBe(409);

    expect(await prismaA.contextItem.count({ where: { orgId: ORG_A, chave } })).toBe(1);
  }, 30_000);
});

// ===========================================================================
// 3. A migração do acervo — a contagem de vetores é o critério de aceite
// ===========================================================================

describe.skipIf(!URL)('migrar o acervo da vault sem perder os vetores', () => {
  let prisma: PrismaClient;
  let memoria: MemoriaService;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    for (const [id, slug] of [
      [ORG_A, `memoria-a-${MARCA}`],
      [ORG_B, `memoria-b-${MARCA}`],
    ] as const) {
      await prisma.org.upsert({ where: { id }, create: { id, name: `Empresa ${slug}`, slug }, update: {} });
    }
    memoria = new MemoriaService(
      prisma as unknown as PrismaService,
      new EventLogService(prisma as never),
    );
  });

  afterAll(async () => {
    await limpar(prisma);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.contextItem.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await prisma.knowledgeNote.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
  });

  /** Semeia o acervo antigo: notas com e sem vetor, nas duas empresas. */
  async function semearAcervo(): Promise<void> {
    let semente = 0;
    for (const [orgId, quantas, comVetor] of [
      [ORG_A, 6, 4],
      [ORG_B, 3, 3],
    ] as const) {
      for (let i = 0; i < quantas; i++) {
        const nota = await prisma.knowledgeNote.create({
          data: {
            orgId,
            path: `${MARCA}/nota-${i}.md`,
            folder: MARCA,
            title: `Nota ${i} de ${orgId}`,
            tags: ['acervo'],
            content: `Corpo da nota ${i} da empresa ${orgId}. Com emoji 🚀 e ideograma 漢.`,
            links: [],
            wordCount: 12,
            fileTime: new Date(),
          },
        });
        if (i < comVetor) {
          await prisma.$executeRawUnsafe(
            'UPDATE "KnowledgeNote" SET embedding = $1::vector WHERE id = $2',
            `[${vetor(++semente).join(',')}]`,
            nota.id,
          );
        }
      }
    }
  }

  it('a contagem de vetores antes é igual à de depois — e eles são os MESMOS', async () => {
    await semearAcervo();

    const antesA = await contarVetores(prisma, ORG_A);
    const antesB = await contarVetores(prisma, ORG_B);
    expect(antesA.origem).toBe(4);
    expect(antesB.origem).toBe(3);
    expect(antesA.destino + antesB.destino).toBe(0);

    for (const orgId of [ORG_A, ORG_B]) {
      const r = await migrarConhecimentoParaAMemoria(prisma, { orgId, actorId: 'suite' });
      expect(r.simulado).toBe(false);
      expect(r.depois.destino).toBe(r.antes.origem);
    }

    const depoisA = await contarVetores(prisma, ORG_A);
    const depoisB = await contarVetores(prisma, ORG_B);
    expect(depoisA.destino).toBe(antesA.origem);
    expect(depoisB.destino).toBe(antesB.origem);

    /*
     * MAIS FORTE DO QUE A CONTAGEM: os vetores são IDÊNTICOS, coluna a coluna.
     * Uma migração que recalculasse embedding passaria na contagem e falharia
     * aqui — e é justamente ela que custa dinheiro no fornecedor e devolve
     * números diferentes dos que já estavam indexados.
     */
    const comparacao = await prisma.$queryRawUnsafe<Array<{ pares: bigint; identicos: bigint }>>(
      `SELECT count(*)::bigint AS pares,
              count(*) FILTER (WHERE kn.embedding::text = ci.embedding::text)::bigint AS identicos
         FROM "KnowledgeNote" kn
         JOIN "ContextItem" ci
           ON ci."orgId" = kn."orgId" AND ci.chave = 'vault:' || kn.path
        WHERE kn.embedding IS NOT NULL AND kn."orgId" IN ($1, $2)`,
      ORG_A,
      ORG_B,
    );
    expect(Number(comparacao[0].pares)).toBe(7);
    expect(Number(comparacao[0].identicos)).toBe(7);
  });

  it('toda nota migrada carrega procedência e nasce com a versão 1', async () => {
    await semearAcervo();
    await migrarConhecimentoParaAMemoria(prisma, { orgId: ORG_A, actorId: 'suite' });

    const itens = await prisma.contextItem.findMany({ where: { orgId: ORG_A } });
    expect(itens).toHaveLength(6);
    for (const item of itens) {
      expect(item.sourceType).toBe(ContextSource.vault);
      expect(item.sourceRef).toBeTruthy();
      expect(item.chave.startsWith('vault:')).toBe(true);
      expect(item.versao).toBe(1);
    }
    const versoes = await prisma.contextItemVersion.findMany({ where: { orgId: ORG_A } });
    expect(versoes).toHaveLength(6);
    expect(versoes.every((v) => v.mudanca === 'criacao')).toBe(true);
    expect(versoes.every((v) => (v.motivo ?? '').includes('migração do acervo'))).toBe(true);
  });

  it('migrar duas vezes não duplica nem versiona de novo', async () => {
    await semearAcervo();
    await migrarConhecimentoParaAMemoria(prisma, { orgId: ORG_A, actorId: 'suite' });
    const segunda = await migrarConhecimentoParaAMemoria(prisma, { orgId: ORG_A, actorId: 'suite' });

    expect(segunda.copiadas).toBe(0);
    expect(segunda.jaEstavam).toBe(6);
    expect(await prisma.contextItem.count({ where: { orgId: ORG_A } })).toBe(6);
    expect(await prisma.contextItemVersion.count({ where: { orgId: ORG_A } })).toBe(6);
  });

  it('PERDA DE VETOR aborta e DESFAZ a transação inteira', async () => {
    /*
     * O caso que dá sentido à conferência: uma nota do acervo cuja chave JÁ
     * existe na memória sem vetor. `ON CONFLICT DO NOTHING` deixaria o destino
     * com um vetor a menos, e a contagem final é o que pega.
     *
     * Uma migração parcial que passasse por acaso seria pior do que nenhuma: o
     * acervo ficaria metade aqui, metade lá, e ninguém saberia qual metade.
     */
    await semearAcervo();
    const bloqueada = await prisma.knowledgeNote.findFirstOrThrow({
      where: { orgId: ORG_A, path: `${MARCA}/nota-0.md` },
    });
    await naEmpresa(ORG_A, () =>
      memoria.criar(ORG_A, {
        chave: chaveDaVault(bloqueada.path),
        title: 'já estava aqui, sem vetor',
        body: 'corpo diferente',
        sourceType: ContextSource.operador,
      }),
    );
    const antes = await prisma.contextItem.count({ where: { orgId: ORG_A } });

    await expect(
      migrarConhecimentoParaAMemoria(prisma, { orgId: ORG_A, actorId: 'suite' }),
    ).rejects.toThrow(/PERDA DE VETOR/);

    // NADA foi gravado: a transação inteira voltou atrás.
    expect(await prisma.contextItem.count({ where: { orgId: ORG_A } })).toBe(antes);
    expect(await contarVetores(prisma, ORG_A).then((c) => c.destino)).toBe(0);
  });

  it('desfazer apaga o que veio da vault e NÃO encosta no resto', async () => {
    await semearAcervo();
    await migrarConhecimentoParaAMemoria(prisma, { orgId: ORG_A, actorId: 'suite' });
    const daTela = await naEmpresa(ORG_A, () =>
      memoria.criar(ORG_A, {
        chave: 'digitada/na-tela',
        title: 'digitada na tela',
        body: 'não veio da vault',
        sourceType: ContextSource.operador,
      }),
    );

    const r = await desfazerMigracao(prisma, { orgId: ORG_A });
    expect(r.apagados).toBe(6);
    expect(r.preservados).toBe(0);

    const sobrou = await prisma.contextItem.findMany({ where: { orgId: ORG_A } });
    expect(sobrou.map((n) => n.id)).toEqual([daTela.id]);
    // A ORIGEM NUNCA FOI TOCADA — desfazer é grátis, e os vetores continuam lá.
    expect(await contarVetores(prisma, ORG_A).then((c) => c.origem)).toBe(4);
  });

  it('desfazer PRESERVA a nota migrada que a operação tocou depois', async () => {
    /*
     * O CRITÉRIO ANTIGO era só "origem `vault` e chave com o prefixo" — e isso
     * NÃO é "o que a migração trouxe". Nota da vault editada depois (na tela ou
     * pela reindexação) caía nele, e apagá-la levava o HISTÓRICO junto pela
     * cascata, contra a regra do próprio ADR-011: não se apaga, arquiva-se.
     * Pior: o evento daquela edição ficava apontando para uma linha de versão
     * que deixou de existir.
     */
    await semearAcervo();
    await migrarConhecimentoParaAMemoria(prisma, { orgId: ORG_A, actorId: 'suite' });

    const tocada = await naEmpresa(ORG_A, () =>
      memoria.porChave(ORG_A, chaveDaVault(`${MARCA}/nota-0.md`)),
    );
    await naEmpresa(ORG_A, () =>
      memoria.alterar(ORG_A, tocada!.id, { body: 'corrigido na tela', motivo: 'revisão' }),
    );

    const simulacao = await desfazerMigracao(prisma, { orgId: ORG_A, simular: true });
    expect(simulacao.apagados).toBe(5);
    expect(simulacao.preservados).toBe(1);

    const r = await desfazerMigracao(prisma, { orgId: ORG_A });
    expect(r.apagados).toBe(5);
    expect(r.preservados).toBe(1);

    const sobrou = await prisma.contextItem.findMany({ where: { orgId: ORG_A } });
    expect(sobrou.map((n) => n.id)).toEqual([tocada!.id]);
    // E o histórico dela ficou INTEIRO — inclusive a versão 1, da migração.
    const historico = await naEmpresa(ORG_A, () => memoria.historico(ORG_A, tocada!.id));
    expect(historico.map((v) => v.versao)).toEqual([2, 1]);
    expect(historico[1].semEventoPorque).toBe(SEM_EVENTO.migracao);
    expect(historico[0].eventoId).toBeTruthy();
  });

  it('a reindexação NÃO versiona à toa, e o arquivo que some ARQUIVA a nota', async () => {
    /*
     * A vault é relida a cada 30 minutos. Sem a comparação de hash, a memória
     * ganharia 48 versões por nota por dia e o histórico de decisões viraria
     * ruído onde não dá para achar nada.
     */
    const doDisco = [
      { caminho: `${MARCA}/a.md`, title: 'A', body: 'corpo A', tags: ['x'] },
      { caminho: `${MARCA}/b.md`, title: 'B', body: 'corpo B', tags: [] },
    ];
    const primeira = await naEmpresa(ORG_A, () => memoria.projetarDaVault(ORG_A, doDisco));
    expect(primeira).toMatchObject({ criadas: 2, alteradas: 0, arquivadas: 0 });

    const segunda = await naEmpresa(ORG_A, () => memoria.projetarDaVault(ORG_A, doDisco));
    expect(segunda).toMatchObject({ criadas: 0, alteradas: 0, inalteradas: 2, arquivadas: 0 });
    expect(await prisma.contextItemVersion.count({ where: { orgId: ORG_A } })).toBe(2);

    // O arquivo mudou: aí sim versiona.
    doDisco[0].body = 'corpo A, corrigido';
    const terceira = await naEmpresa(ORG_A, () => memoria.projetarDaVault(ORG_A, doDisco));
    expect(terceira).toMatchObject({ alteradas: 1, inalteradas: 1 });

    // O arquivo sumiu: ARQUIVA, não apaga — o histórico da decisão fica.
    const quarta = await naEmpresa(ORG_A, () => memoria.projetarDaVault(ORG_A, [doDisco[1]]));
    expect(quarta.arquivadas).toBe(1);
    const arquivada = await naEmpresa(ORG_A, () =>
      memoria.porChave(ORG_A, chaveDaVault(`${MARCA}/a.md`)),
    );
    expect(arquivada?.arquivadoEm).toBeTruthy();
    expect(arquivada?.body).toBe('corpo A, corrigido');

    // E o arquivo que volta RESTAURA a mesma nota, com o histórico inteiro.
    const quinta = await naEmpresa(ORG_A, () => memoria.projetarDaVault(ORG_A, doDisco));
    expect(quinta.criadas).toBe(0);
    const voltou = await naEmpresa(ORG_A, () =>
      memoria.porChave(ORG_A, chaveDaVault(`${MARCA}/a.md`)),
    );
    expect(voltou?.arquivadoEm).toBeNull();
    const historico = await naEmpresa(ORG_A, () => memoria.historico(ORG_A, voltou!.id));
    expect(historico.map((v) => v.mudanca)).toEqual([
      'restauracao',
      'arquivamento',
      'alteracao',
      'criacao',
    ]);
  });

  it('a nota digitada na tela NÃO é arquivada porque sumiu da vault', async () => {
    const daTela = await naEmpresa(ORG_A, () =>
      memoria.criar(ORG_A, {
        chave: 'digitada/na-tela',
        title: 'digitada na tela',
        body: 'não veio da vault',
        sourceType: ContextSource.operador,
      }),
    );
    await naEmpresa(ORG_A, () => memoria.projetarDaVault(ORG_A, []));
    const ainda = await naEmpresa(ORG_A, () => memoria.obter(ORG_A, daTela.id));
    expect(ainda?.arquivadoEm).toBeNull();
  });
});

// ===========================================================================
// 4. A CONFERÊNCIA ENTRE VERSÃO E EVENTO — o terceiro argumento do ADR-011
// ===========================================================================

describe.skipIf(!URL)('a integridade da memória é conferível, não declarada', () => {
  let prisma: PrismaClient;
  let memoria: MemoriaService;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    await prisma.org.upsert({
      where: { id: ORG_A },
      create: { id: ORG_A, name: 'Empresa integridade', slug: `memoria-a-${MARCA}` },
      update: {},
    });
    memoria = new MemoriaService(
      prisma as unknown as PrismaService,
      new EventLogService(prisma as never),
    );
  });

  afterAll(async () => {
    await limpar(prisma);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.contextItem.deleteMany({ where: { orgId: ORG_A } });
  });

  const umaNota = (chave: string) =>
    naEmpresa(ORG_A, () =>
      memoria.criar(ORG_A, {
        chave,
        title: 'Regra',
        body: 'o desconto máximo é de 7%',
        sourceType: ContextSource.operador,
        sourceRef: 'suite',
      }),
    );

  it('memória intacta fecha: toda versão tem elo e todo hash bate', async () => {
    const nota = await umaNota(`integra/${MARCA}`);
    await naEmpresa(ORG_A, () => memoria.alterar(ORG_A, nota.id, { body: 'agora é 12%' }));

    const r = await naEmpresa(ORG_A, () => memoria.conferirElos(ORG_A));
    expect(r.ok).toBe(true);
    expect(r.versoes).toBe(2);
    expect(r.comElo).toBe(2);
    expect(r.divergentes).toEqual([]);
    expect(r.semElo).toEqual([]);
  });

  it('EDITAR A VERSÃO DIRETO NO BANCO é acusado — é o argumento do ADR virando código', async () => {
    /*
     * O ADR-011 recusou "documento com histórico" alegando, entre outras coisas,
     * que aquele desenho não é à prova de adulteração. Enquanto NADA comparasse
     * a versão com o evento, o desenho escolhido não era melhor nisso — e era
     * exatamente essa a situação na primeira versão desta fatia.
     *
     * Aqui o adulterador faz o trabalho COMPLETO: troca o corpo E o
     * `contentHash` da linha de versão, que é o que alguém esperto faria para
     * não deixar inconsistência interna. O que o entrega é o `contentHash` do
     * EVENTO, que está dentro da cadeia de hash do RASTRO: para esconder, ele
     * teria de mexer também no evento, e aí `GET /audit/verificar` acusa.
     */
    const nota = await umaNota(`adulterada/${MARCA}`);
    const [v1] = await naEmpresa(ORG_A, () => memoria.historico(ORG_A, nota.id));

    const mentira = 'o desconto máximo é de 90%';
    await prisma.$executeRawUnsafe(
      'UPDATE "ContextItemVersion" SET body = $1, "contentHash" = $2 WHERE id = $3',
      mentira,
      hashDoCorpo(mentira),
      v1.id,
    );

    const r = await naEmpresa(ORG_A, () => memoria.conferirElos(ORG_A));
    expect(r.ok).toBe(false);
    expect(r.divergentes).toHaveLength(1);
    expect(r.divergentes[0].versaoId).toBe(v1.id);
    expect(r.divergentes[0].motivo).toContain('não é o que o evento carimbou');
  });

  it('editar SÓ o corpo, deixando o hash antigo, também é acusado', async () => {
    const nota = await umaNota(`meio-editada/${MARCA}`);
    const [v1] = await naEmpresa(ORG_A, () => memoria.historico(ORG_A, nota.id));
    await prisma.$executeRawUnsafe(
      'UPDATE "ContextItemVersion" SET body = $1 WHERE id = $2',
      'outra coisa',
      v1.id,
    );

    const r = await naEmpresa(ORG_A, () => memoria.conferirElos(ORG_A));
    expect(r.ok).toBe(false);
    expect(r.divergentes[0].motivo).toContain('não corresponde ao contentHash da própria versão');
  });

  it('EXPURGADO e ADULTERADO não se confundem — é para isso que a chave estrangeira existe', async () => {
    /*
     * Sem a chave estrangeira, o expurgo por retenção deixava `eventoId`
     * apontando para linha que não existe mais: um identificador que não
     * resolve, indistinguível de prova apagada. Com `ON DELETE SET NULL`, o id é
     * limpo e a `eventoSeq` FICA — e é a sequência sobrevivente que diz "houve
     * evento aqui".
     *
     * O DELETE aqui repete o que `app_rastro_expurgar` faz: desliga a RULE de
     * append-only (exige ser DONO da tabela), apaga, religa. Chamar a função de
     * verdade exigiria um evento já VENCIDO, e ela trava o corte em `now()`.
     */
    const nota = await umaNota(`expurgada/${MARCA}`);
    const [v1] = await naEmpresa(ORG_A, () => memoria.historico(ORG_A, nota.id));
    expect(v1.eventoId).toBeTruthy();

    try {
      await prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete');
      await prisma.$executeRawUnsafe('DELETE FROM "EventLog" WHERE id = $1', v1.eventoId);
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete');
    }

    const depois = await prisma.contextItemVersion.findUniqueOrThrow({ where: { id: v1.id } });
    expect(depois.eventoId, 'a chave estrangeira não limpou o id').toBeNull();
    expect(depois.eventoSeq, 'a sequência sumiu junto — perdeu-se a prova de que houve').not.toBeNull();

    const r = await naEmpresa(ORG_A, () => memoria.conferirElos(ORG_A));
    expect(r.semElo).toHaveLength(1);
    expect(r.semElo[0].diagnostico).toBe('expurgado');
    // Expurgo é normal: não reprova a conferência.
    expect(r.ok).toBe(true);
  });

  it('a versão da MIGRAÇÃO não é lida como falha de rastro', async () => {
    await prisma.knowledgeNote.create({
      data: {
        orgId: ORG_A,
        path: `${MARCA}/migrada.md`,
        folder: MARCA,
        title: 'Migrada',
        tags: [],
        content: 'veio do acervo',
        links: [],
        wordCount: 3,
        fileTime: new Date(),
      },
    });
    await migrarConhecimentoParaAMemoria(prisma, { orgId: ORG_A, actorId: 'suite' });

    const versoes = await prisma.contextItemVersion.findMany({ where: { orgId: ORG_A } });
    expect(versoes).toHaveLength(1);
    expect(versoes[0].semEventoPorque).toBe(SEM_EVENTO.migracao);

    const r = await naEmpresa(ORG_A, () => memoria.conferirElos(ORG_A));
    expect(r.semElo[0].diagnostico).toBe('migracao');
    expect(r.porDiagnostico.falha_ao_registrar ?? 0).toBe(0);
    expect(r.porDiagnostico.sem_explicacao ?? 0).toBe(0);
    expect(r.ok).toBe(true);
    await prisma.knowledgeNote.deleteMany({ where: { orgId: ORG_A } });
  });

  it('versão inserida POR FORA é a única que fica sem explicação', async () => {
    const nota = await umaNota(`por-fora/${MARCA}`);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ContextItemVersion"
         (id, "orgId", "itemId", versao, mudanca, kind, title, body, "sourceType", "contentHash",
          "autorTipo", "criadoEm")
       VALUES (gen_random_uuid(), $1, $2, 99, 'alteracao', 'nota', 'inventada', $3, 'operador',
               $4, 'user', now())`,
      ORG_A,
      nota.id,
      'texto que ninguém escreveu pela aplicação',
      hashDoCorpo('texto que ninguém escreveu pela aplicação'),
    );

    const r = await naEmpresa(ORG_A, () => memoria.conferirElos(ORG_A));
    expect(r.ok).toBe(false);
    expect(r.porDiagnostico.sem_explicacao).toBe(1);
  });
});

// ===========================================================================
// 5. A GUARDA DA VAULT — o que impede uma pasta vazia de arquivar a memória
// ===========================================================================

describe.skipIf(!URL)('vault vazia ou montada no lugar errado não arquiva a memória', () => {
  let prisma: PrismaClient;
  let memoria: MemoriaService;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    await prisma.org.upsert({
      where: { id: ORG_A },
      create: { id: ORG_A, name: 'Empresa vault', slug: `memoria-a-${MARCA}` },
      update: {},
    });
    memoria = new MemoriaService(
      prisma as unknown as PrismaService,
      new EventLogService(prisma as never),
    );
  });

  afterAll(async () => {
    await limpar(prisma);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.contextItem.deleteMany({ where: { orgId: ORG_A } });
  });

  /** `n` arquivos "no disco", com corpos estáveis. */
  const disco = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      caminho: `${MARCA}/n-${i}.md`,
      title: `Nota ${i}`,
      body: `corpo ${i}`,
      tags: [] as string[],
    }));

  it('lista VAZIA com notas vivas RECUSA a volta inteira, sem arquivar nada', async () => {
    /*
     * O caso real, e não hipotético: a conferência do conector só exige que o
     * CAMINHO exista, e o `OBSIDIAN_VAULT_HOST` da VPS aponta para uma pasta que
     * a documentação do projeto diz não ser a vault de verdade. Antes desta
     * fatia o estrago era um índice descartável; agora seria o histórico, que
     * não vence nunca — uma versão e um evento por nota, e outro par quando a
     * pasta voltasse.
     */
    await naEmpresa(ORG_A, () => memoria.projetarDaVault(ORG_A, disco(8)));
    const antes = await prisma.contextItemVersion.count({ where: { orgId: ORG_A } });

    await expect(naEmpresa(ORG_A, () => memoria.projetarDaVault(ORG_A, []))).rejects.toThrow(
      VaultSuspeitaError,
    );

    const vivas = await prisma.contextItem.count({
      where: { orgId: ORG_A, arquivadoEm: null },
    });
    expect(vivas).toBe(8);
    expect(await prisma.contextItemVersion.count({ where: { orgId: ORG_A } })).toBe(antes);
  });

  it('arquivamento em MASSA é recusado, e as criações do mesmo ciclo continuam valendo', async () => {
    await naEmpresa(ORG_A, () => memoria.projetarDaVault(ORG_A, disco(20)));

    // Sobraram 3 dos 20 arquivos, e chegou 1 novo: some com 17 (85%).
    const sobrou = [
      ...disco(20).slice(0, 3),
      { caminho: `${MARCA}/nova.md`, title: 'Nova', body: 'corpo novo', tags: [] as string[] },
    ];
    const r = await naEmpresa(ORG_A, () => memoria.projetarDaVault(ORG_A, sobrou));

    expect(r.arquivadas).toBe(0);
    expect(r.arquivamentoRecusado).toBe(17);
    expect(r.criadas).toBe(1);
    const arquivadas = await prisma.contextItem.count({
      where: { orgId: ORG_A, arquivadoEm: { not: null } },
    });
    expect(arquivadas).toBe(0);
  });

  it('remoção PEQUENA passa: a guarda não impede a operação normal', async () => {
    await naEmpresa(ORG_A, () => memoria.projetarDaVault(ORG_A, disco(20)));
    const r = await naEmpresa(ORG_A, () => memoria.projetarDaVault(ORG_A, disco(18)));
    expect(r.arquivadas).toBe(2);
    expect(r.arquivamentoRecusado).toBe(0);
  });

  it('uma nota ruim não derruba a volta: as outras entram e a falha é contada', async () => {
    /*
     * Antes, a projeção inteira abortava na primeira nota problemática — e as
     * notas depois dela no laço ficavam sem versionamento sem que nada dissesse
     * quais. O caso é real: `ObsidianService.parse` deriva o título do primeiro
     * `#` do arquivo, e um `.md` que começa com um cabeçalho vazio produz título
     * em branco, que a memória recusa (nota sem título não sustenta resposta).
     */
    const comProblema = [
      ...disco(2),
      { caminho: `${MARCA}/sem-titulo.md`, title: '   ', body: 'corpo órfão', tags: [] as string[] },
      ...disco(3).slice(2),
    ];
    const r = await naEmpresa(ORG_A, () => memoria.projetarDaVault(ORG_A, comProblema));

    expect(r.falhas).toBe(1);
    // AS DE DEPOIS ENTRARAM: é isso que o `try` por nota compra.
    expect(r.criadas).toBe(3);
    const total = await prisma.contextItem.count({ where: { orgId: ORG_A } });
    expect(total).toBe(3);
  });
});

// ===========================================================================
// 6. O MÓDULO NO GRAFO — a meia-correção que faria a rota sumir em silêncio
// ===========================================================================

describe('o controlador da memória está pendurado no grafo de módulos', () => {
  /*
   * O RISCO REAL NÃO É A ARESTA INVERTIDA. `ObsidianModule` importar
   * `MemoryModule` é estranho de ler, mas inofensivo: o Nest resolve módulo por
   * identidade e o controlador é registrado globalmente venha o módulo de onde
   * vier.
   *
   * A MEIA-CORREÇÃO PERIGOSA É A OUTRA: alguém tira a importação daqui — porque
   * "a projeção mudou de lugar" ou porque "essa dependência é feia" — e esquece
   * de pôr `MemoryModule` no `AppModule`. O módulo cai do grafo INTEIRO, todas
   * as rotas `/memoria` somem, e NADA acusa: compila, sobe, e a tela recebe 404.
   *
   * Este caso é de TEXTO, de propósito: o teste que de fato instancia o injetor
   * é o de arranque compilado (`pnpm --filter @mktos/api smoke`), porque nada
   * que dependa de injeção do Nest roda sob `vitest` (o esbuild não emite
   * `emitDecoratorMetadata`). Um caso de arranque afirmando que
   * `MemoriaController` está registrado está pedido em FORA DO ESCOPO no
   * relatório da fatia — `scripts/smoke-boot.mjs` não pertence a ela.
   */
  const RAIZ = join(__dirname, '..');
  const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');

  it('alguém no caminho até o AppModule importa MemoryModule', () => {
    const app = ler('src/app.module.ts');
    const obsidian = ler('src/obsidian/obsidian.module.ts');

    const direto = /MemoryModule/.test(app);
    const pelaVault = /MemoryModule/.test(obsidian) && /ObsidianModule/.test(app);

    expect(
      direto || pelaVault,
      '\nO MÓDULO DA MEMÓRIA SAIU DO GRAFO.\n' +
        '  Ninguém no caminho até o AppModule importa MemoryModule: nem o próprio AppModule,\n' +
        '  nem o ObsidianModule (que é quem o segura hoje).\n' +
        '  Consequência: todas as rotas /memoria somem em silêncio — compila, sobe, e a tela\n' +
        '  recebe 404. Ponha MemoryModule no `imports` do AppModule.\n',
    ).toBe(true);
  });

  it('o módulo da memória declara o controlador', () => {
    const modulo = ler('src/memory/memoria.module.ts');
    expect(modulo).toContain('controllers: [MemoriaController]');
    expect(modulo).toContain('exports: [MemoriaService]');
  });
});

/**
 * Limpeza cirúrgica: só o que esta suíte criou.
 *
 * `EventLog` fica: ele é append-only por regra do banco e por constraint do
 * produto (02-CONSTRAINTS proíbe apagar evento do RASTRO). As linhas ficam
 * marcadas pela empresa desta rodada, que é descartável.
 */
async function limpar(prisma: PrismaClient): Promise<void> {
  const orgs = { in: [ORG_A, ORG_B] };
  await prisma.contextItem.deleteMany({ where: { orgId: orgs } });
  await prisma.knowledgeNote.deleteMany({ where: { orgId: orgs } });
}
