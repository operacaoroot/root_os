import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import politicaRoot from '@mktos/policy/politica-root.json';
import {
  EventLogService,
  RETENCAO_PERENE,
  TIPOS_PERENES,
  TIPO_EXPURGO,
  VIRADA_DA_CADEIA,
  canonizar,
  sigiloso,
} from '../src/gateway/event-log.service';
import type { PrismaService } from '../src/prisma/prisma.service';

/*
 * O RASTRO REGISTRA O QUE CADA NÍVEL EXIGE — RF-R-03 e RF-R-04.
 *
 * Sem banco de propósito: o que esta suíte mede é a REGRA (quais campos cada
 * degrau pede, o que acontece com conteúdo sensível, o que entra na cadeia de
 * hash), e regra não precisa de Postgres para ser medida. O que precisa de banco
 * — retenção por empresa e expurgo — está em `rastro-retencao.test.ts`, que se
 * pula sozinho sem `TEST_DATABASE_URL`.
 *
 * A LISTA DE CAMPOS NÃO ESTÁ ESCRITA AQUI. Ela é lida de `politica-root.json`,
 * que é cópia byte a byte do anexo normativo. Um teste que repetisse a lista à
 * mão passaria a medir a cópia dele mesmo: mudaria a política, o serviço
 * deixaria de cumprir e a suíte continuaria verde.
 */

const NIVEIS = politicaRoot.niveis as Record<string, { rastro: string[] }>;

/** O que o serviço TENTOU gravar. É isto que cada caso inspeciona. */
interface LinhaGravada {
  orgId: string;
  seq: bigint;
  tipo: string;
  nivel: string | null;
  payload: Record<string, unknown>;
  contentHash: string | null;
  hash: string;
  prevHash: string | null;
  retencaoAte: Date;
  ocorreuEm: Date;
}

/** O que `$queryRaw` vai devolver — o teste escolhe caso a caso. */
type RespostaCrua = unknown[] | (() => unknown[]);

/**
 * O dobrê do Prisma.
 *
 * `findMany` HONRA `where.tipo`, `orderBy` e `take` porque `verificar()` passou
 * a depender disso: ela busca as faixas de expurgo numa consulta PRÓPRIA,
 * filtrada por tipo e sem o `take` da janela. Um dobrê que devolvesse tudo em
 * qualquer chamada esconderia exatamente o defeito que a correção conserta.
 */
function prismaDeMentira(cru: RespostaCrua = []): {
  prisma: PrismaService;
  linhas: LinhaGravada[];
} {
  const linhas: LinhaGravada[] = [];
  const eventLog = {
    findFirst: async () => (linhas.length ? linhas[linhas.length - 1] : null),
    findMany: async (args?: {
      where?: { tipo?: string };
      take?: number;
      orderBy?: { seq?: 'asc' | 'desc' };
    }) => {
      let saida = [...linhas];
      if (args?.where?.tipo) saida = saida.filter((l) => l.tipo === args.where!.tipo);
      saida.sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0));
      if (args?.orderBy?.seq === 'desc') saida.reverse();
      if (args?.take != null) saida = saida.slice(0, args.take);
      return saida;
    },
    create: async ({ data }: { data: LinhaGravada }) => {
      linhas.push(data);
      return { id: `evt-${linhas.length}`, seq: data.seq, hash: data.hash };
    },
  };
  const cliente = {
    eventLog,
    rastroRetencao: { findUnique: async () => null },
    $queryRaw: async () => (typeof cru === 'function' ? cru() : cru),
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ eventLog, $executeRaw: async () => 0 }),
  };
  return { prisma: cliente as unknown as PrismaService, linhas };
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * A linha inteira em texto, `seq` (BigInt) incluída.
 *
 * É com ela que se pergunta "o segredo está em ALGUM canto do registro?" — e a
 * pergunta só vale se nada da linha ficar de fora da serialização.
 */
const tudoDaLinha = (l: LinhaGravada) =>
  JSON.stringify(l, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));

describe('o rastro registra o que cada nível exige', () => {
  let servico: EventLogService;
  let linhas: LinhaGravada[];

  beforeEach(() => {
    const m = prismaDeMentira();
    servico = new EventLogService(m.prisma);
    linhas = m.linhas;
    servico.esquecerAvisos();
  });

  it('a lista de campos vem da POLÍTICA, não deste arquivo nem do serviço', () => {
    for (const nivel of ['R0', 'R1', 'R2', 'R3', 'R4', 'R5'] as const) {
      expect(servico.camposExigidos(nivel)).toEqual(NIVEIS[nivel].rastro);
    }
    // Sem nível não há exigência: linha que não classifica ação não é conferida.
    expect(servico.camposExigidos(null)).toEqual([]);
  });

  it('um evento R3 traz resumo, aprovador, quando, canal e o retorno da entrega', async () => {
    await servico.registrar({
      orgId: 'org-a',
      tipo: 'tool.resultado',
      nivel: 'R3',
      actorType: 'ai',
      actorId: 'agente-1',
      agentSlug: 'publicador',
      capabilityId: 'whatsapp.mensagem.enviar',
      contentHash: sha256('texto exato aprovado'),
      conteudo: {
        argumentos: { para: '120363@g.us' },
        fontes: [{ tipo: 'pauta', id: 'peca-9' }],
        resumo: 'aviso de fechamento para o grupo de estratégia',
        aprovador: { id: 'pedro', alcada: 'responsavel' },
        aprovadoEm: new Date('2026-09-11T12:00:00.000Z'),
        canal: 'whatsapp',
        entrega: { ok: true, idExterno: 'wamid.ABC', status: 'entregue' },
        custo: { centavos: 12, modelo: 'claude-opus-5' },
      },
    });

    const p = linhas[0].payload;
    expect(p.resumo).toBe('aviso de fechamento para o grupo de estratégia');
    expect(p.aprovador).toEqual({ id: 'pedro', alcada: 'responsavel' });
    expect(p.aprovadoEm).toBe('2026-09-11T12:00:00.000Z');
    expect(p.canal).toBe('whatsapp');
    expect(p.entrega).toEqual({ ok: true, idExterno: 'wamid.ABC', status: 'entregue' });

    const rastro = p.rastro as { exigidos: string[]; faltando: string[]; completo: boolean };
    expect(rastro.exigidos).toEqual(NIVEIS.R3.rastro);
    expect(rastro.faltando).toEqual([]);
    expect(rastro.completo).toBe(true);
  });

  it('um evento R0 traz pergunta, fontes e custo', async () => {
    await servico.registrar({
      orgId: 'org-a',
      tipo: 'tool.resultado',
      nivel: 'R0',
      actorType: 'ai',
      actorId: 'agente-1',
      agentSlug: 'analista',
      capabilityId: 'memoria.buscar',
      conteudo: {
        pergunta: 'qual foi o faturamento de agosto?',
        fontes: [{ tipo: 'memoria', id: 'nota-4' }, { tipo: 'espelho', id: 'omie' }],
        custo: { centavos: 3, tokensIn: 900, tokensOut: 120 },
      },
    });

    const p = linhas[0].payload;
    expect(p.pergunta).toBe('qual foi o faturamento de agosto?');
    expect(p.fontes).toHaveLength(2);
    expect(p.custo).toMatchObject({ centavos: 3 });
    expect((p.rastro as { completo: boolean }).completo).toBe(true);
  });

  it('a lacuna fica GRAVADA na linha, e a linha é gravada assim mesmo', async () => {
    // Ação sem registro é pior do que registro incompleto (02-CONSTRAINTS): a
    // conferência avisa e declara, nunca recusa.
    await servico.registrar({
      orgId: 'org-a',
      tipo: 'tool.resultado',
      nivel: 'R3',
      actorType: 'ai',
      agentSlug: 'publicador',
      capabilityId: 'whatsapp.mensagem.enviar',
      conteudo: { argumentos: { para: 'x' }, fontes: [], canal: 'whatsapp' },
    });

    expect(linhas).toHaveLength(1);
    const rastro = linhas[0].payload.rastro as { faltando: string[]; completo: boolean };
    expect(rastro.completo).toBe(false);
    expect(rastro.faltando).toContain('aprovador');
    expect(rastro.faltando).toContain('aprovadoEm');
    expect(rastro.faltando).toContain('entrega');
    expect(rastro.faltando).toContain('hashConteudo');
    expect(rastro.faltando).toContain('custo');
    // o que FOI entregue não aparece na lista
    expect(rastro.faltando).not.toContain('canal');
    expect(rastro.faltando).not.toContain('ferramenta');
  });

  it('`ator` e `agente` saem das colunas, não do conteúdo', async () => {
    await servico.registrar({
      orgId: 'org-a',
      tipo: 'consulta',
      nivel: 'R0',
      actorType: 'ai',
      // sem actorId, sem agentSlug, sem capabilityId
      conteudo: { fontes: [], custo: { centavos: 0 } },
    });
    const rastro = linhas[0].payload.rastro as { faltando: string[] };
    expect(rastro.faltando).toEqual(expect.arrayContaining(['ator', 'agente', 'ferramenta']));
  });
});

describe('conteúdo sensível nunca vai cru para o registro', () => {
  let servico: EventLogService;
  let linhas: LinhaGravada[];
  const SEGREDO = 'saldo em conta: R$ 1.234.567,89 — conta 4455-0 do cliente Fulano';

  beforeEach(() => {
    const m = prismaDeMentira();
    servico = new EventLogService(m.prisma);
    linhas = m.linhas;
  });

  it('capacidade confidencial: o cru some da linha INTEIRA, sobra resumo e referência', async () => {
    await servico.registrar({
      orgId: 'org-a',
      tipo: 'tool.resultado',
      nivel: 'R3',
      actorType: 'ai',
      agentSlug: 'financeiro',
      capabilityId: 'financeiro.extrato.ler',
      toolCallId: 'tc-77',
      sensibilidade: 'confidencial',
      conteudo: {
        argumentos: { texto: SEGREDO },
        resultado: SEGREDO,
        resumo: 'extrato de agosto lido',
        fontes: [{ tipo: 'omie' }],
        custo: { centavos: 4 },
        aprovador: { id: 'pedro' },
        aprovadoEm: new Date('2026-09-11T12:00:00.000Z'),
        canal: 'painel',
        entrega: { ok: true },
      },
    });

    // A asserção que importa: o texto não está em canto NENHUM da linha.
    const linhaInteira = tudoDaLinha(linhas[0]);
    expect(linhaInteira).not.toContain(SEGREDO);
    expect(linhaInteira).not.toContain('4455-0');

    const p = linhas[0].payload as Record<string, Record<string, unknown>>;
    expect(p.resultado.sigiloso).toBe(true);
    expect(p.resultado.algoritmo).toBe('sha256');
    expect(p.resultado.resumoCriptografico).toBe(sha256(SEGREDO));
    expect(p.resultado.referencia).toBe('toolCall:tc-77');
    expect(p.argumentos.chaves).toEqual(['texto']);

    // O RESUMO sobrevive ao confidencial: é ele o substituto seguro do cru, e é
    // ele que o R3 exige ("o resumo do conteúdo aprovado").
    expect(p.resumo).toBe('extrato de agosto lido');

    // METADADO não é cifrado: quem audita precisa saber QUE alguém aprovou, por
    // qual canal e a que custo, mesmo sem poder ler o texto.
    expect(p.aprovador).toEqual({ id: 'pedro' });
    expect(p.canal).toBe('painel');
    expect(p.custo).toEqual({ centavos: 4 });

    // O `hashConteudo` que o R3 exige nasce da própria redação, e o campo que
    // o origina é escolhido por ORDEM FIXA (`argumentos` na frente) — não pela
    // ordem em que quem chamou digitou as chaves.
    expect(linhas[0].contentHash).toBe(sha256(JSON.stringify({ texto: SEGREDO })));
    expect((p.rastro as unknown as { completo: boolean }).completo).toBe(true);
  });

  it('`restrita` leva junto o resumo; `confidencial` não', async () => {
    await servico.registrar({
      orgId: 'org-a',
      tipo: 'tool.resultado',
      nivel: 'R4',
      actorType: 'ai',
      agentSlug: 'financeiro',
      capabilityId: 'acesso.conceder',
      sensibilidade: 'restrita',
      conteudo: { resultado: SEGREDO, resumo: SEGREDO },
    });
    const p = linhas[0].payload as Record<string, Record<string, unknown>>;
    expect(tudoDaLinha(linhas[0])).not.toContain(SEGREDO);
    expect(p.resumo.sigiloso).toBe(true);
  });

  it('um campo marcado como sigiloso some mesmo numa ação interna, em qualquer profundidade', async () => {
    await servico.registrar({
      orgId: 'org-a',
      tipo: 'tool.proposta',
      nivel: 'R2',
      actorType: 'ai',
      agentSlug: 'atendimento',
      capabilityId: 'crm.lead.criar',
      sensibilidade: 'interna',
      conteudo: {
        argumentos: {
          lead: { nome: 'Fulano', documento: sigiloso('123.456.789-00', 'cpf') },
        },
        fontes: [],
        resultado: { ok: true },
        desfazer: 'crm.lead.apagar',
        custo: { centavos: 1 },
      },
    });

    const linhaInteira = tudoDaLinha(linhas[0]);
    expect(linhaInteira).not.toContain('123.456.789-00');
    const args = linhas[0].payload.argumentos as { lead: { nome: string; documento: Record<string, unknown> } };
    // o que NÃO foi marcado continua legível — a marca é por campo, não por ação
    expect(args.lead.nome).toBe('Fulano');
    expect(args.lead.documento.rotulo).toBe('cpf');
    expect(args.lead.documento.resumoCriptografico).toBe(sha256('123.456.789-00'));
    expect((linhas[0].payload.rastro as unknown as { completo: boolean }).completo).toBe(true);
  });

  it('sigiloso no payload solto do chamador também é redigido', async () => {
    await servico.registrar({
      orgId: 'org-a',
      tipo: 'aprovacao.invalida',
      actorType: 'ai',
      payload: { motivo: 'token queimado', token: sigiloso('tok_abcdef') } as never,
    });
    expect(tudoDaLinha(linhas[0])).not.toContain('tok_abcdef');
    expect(linhas[0].payload.motivo).toBe('token queimado');
  });
});

describe('a cadeia cobre o que está aninhado', () => {
  it('canonizar ordena em TODOS os níveis — a lista branca do JSON.stringify não ordenava nada', () => {
    expect(canonizar({ b: { y: 2, x: 1 }, a: 'z' })).toBe('{"a":"z","b":{"x":1,"y":2}}');
    expect(canonizar({ a: 'z', b: { x: 1, y: 2 } })).toBe(canonizar({ b: { y: 2, x: 1 }, a: 'z' }));

    // A fórmula antiga, para o registro: ela APAGAVA o que estava aninhado.
    const p = { a: 'z', b: { x: 1, y: 2 } };
    expect(JSON.stringify(p, Object.keys(p).sort())).toBe('{"a":"z","b":{}}');
  });

  it('mudar um campo aninhado muda o hash gravado', async () => {
    async function hashDe(aprovador: string): Promise<string> {
      const m = prismaDeMentira();
      const s = new EventLogService(m.prisma);
      await s.registrar({
        orgId: 'org-a',
        tipo: 'tool.resultado',
        nivel: 'R3',
        actorType: 'ai',
        agentSlug: 'publicador',
        capabilityId: 'whatsapp.mensagem.enviar',
        conteudo: { aprovador: { id: aprovador } },
      });
      // `ocorreuEm` entra no hash, então o teste iguala o instante das duas
      // linhas antes de comparar — o que se mede aqui é o payload, não o relógio.
      m.linhas[0].ocorreuEm = new Date(0);
      return recalcular(m.linhas[0]);
    }
    expect(await hashDe('pedro')).not.toBe(await hashDe('lucas'));
  });
});

describe('o evento do expurgo é perene', () => {
  it('`rastro.expurgo` nasce com retenção no ano 9999 — o expurgo seguinte não o alcança', async () => {
    const m = prismaDeMentira();
    const s = new EventLogService(m.prisma);
    await s.registrar({ orgId: 'org-a', tipo: TIPO_EXPURGO, actorType: 'system' });
    await s.registrar({ orgId: 'org-a', tipo: 'tool.resultado', actorType: 'ai' });

    expect(m.linhas[0].retencaoAte).toEqual(RETENCAO_PERENE);
    expect(m.linhas[1].retencaoAte.getTime()).toBeLessThan(RETENCAO_PERENE.getTime());
    // o padrão herdado da política, não um número escrito aqui
    const dias = (politicaRoot.retencao as { rastroDias: number }).rastroDias;
    expect(s.retencaoPadrao()).toBe(dias);
  });

  it('o tipo do evento é UMA constante — o mesmo texto decide quatro coisas', () => {
    // O literal repetido em quatro lugares (aqui, na busca de faixas, na policy
    // e no DELETE da função) reabilita, em silêncio, apagar o registro do
    // expurgo se um deles divergir. Os dois do banco são cobrados contra esta
    // mesma constante em `rastro-retencao.test.ts`.
    expect(TIPO_EXPURGO).toBe('rastro.expurgo');
    expect(TIPOS_PERENES.has(TIPO_EXPURGO)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A CONFERÊNCIA DA CADEIA — o que ela precisa PEGAR
// ---------------------------------------------------------------------------

/** Escreve `quantos` eventos encadeados e devolve o serviço e o armazém. */
async function cadeiaDe(quantos: number, cru: RespostaCrua = []) {
  const m = prismaDeMentira(cru);
  const s = new EventLogService(m.prisma);
  for (let i = 1; i <= quantos; i++) {
    await s.registrar({ orgId: 'org-a', tipo: `evento.${i}`, actorType: 'system' });
  }
  return { servico: s, linhas: m.linhas };
}

describe('a verificação da cadeia cobra o COMEÇO, não o primeiro que apareceu', () => {
  it('truncar a cabeça do rastro REPROVA quando nada explica', async () => {
    const { servico, linhas } = await cadeiaDe(4);
    // O expurgo por retenção corta justamente daqui: o vencido é o mais velho.
    linhas.splice(0, 2);

    const r = await servico.verificar('org-a');
    expect(
      r.ok,
      '\nA CABEÇA DO RASTRO SUMIU E A CONFERÊNCIA PASSOU.\n' +
        '  A versão anterior começava em `linhas[0].seq` — o primeiro que aparecesse —, então a\n' +
        '  PRIMEIRA iteração nunca podia divergir e truncar o começo ficava invisível.\n',
    ).toBe(false);
    expect(r.quebrouEm?.seq).toBe('3');
    expect(r.quebrouEm?.motivo).toMatch(/começa em 3/);
    expect(r.quebrouEm?.motivo).toMatch(/1–2/);
  });

  it('e ACEITA quando um evento de expurgo assume a faixa', async () => {
    const { servico, linhas } = await cadeiaDe(4);
    linhas.splice(0, 2);
    await servico.registrar({
      orgId: 'org-a',
      tipo: TIPO_EXPURGO,
      actorType: 'system',
      conteudo: { resultado: { seqDe: '1', seqAte: '2' } },
    });

    const r = await servico.verificar('org-a');
    expect(r.ok).toBe(true);
    expect(r.lacunasExplicadas).toEqual([{ de: '1', ate: '2' }]);
  });

  it('faixa que cobre só PARTE do buraco não vale', async () => {
    const { servico, linhas } = await cadeiaDe(4);
    linhas.splice(0, 2);
    await servico.registrar({
      orgId: 'org-a',
      tipo: TIPO_EXPURGO,
      actorType: 'system',
      conteudo: { resultado: { seqDe: '1', seqAte: '1' } },
    });
    expect((await servico.verificar('org-a')).ok).toBe(false);
  });
});

describe('as faixas de expurgo são buscadas FORA da janela conferida', () => {
  it('um expurgo explicado por evento além do limite continua explicado', async () => {
    const { servico, linhas } = await cadeiaDe(4);
    linhas.splice(0, 2);
    await servico.registrar({
      orgId: 'org-a',
      tipo: TIPO_EXPURGO,
      actorType: 'system',
      conteudo: { resultado: { seqDe: '1', seqAte: '2' } },
    });

    /*
     * `limite: 2` deixa a janela com as linhas 3 e 4; o evento que explica o
     * buraco está em 5, FORA dela. É a forma pequena do caso real: o evento do
     * expurgo é sempre escrito DEPOIS do buraco, logo com `seq` maior, e numa
     * empresa com mais eventos do que a janela ele nunca entrava na conta —
     * então o mecanismo inteiro não funcionava para buraco nenhum, e retenção
     * cumprida virava acusação de adulteração.
     */
    const r = await servico.verificar('org-a', 2);
    expect(
      r.ok,
      '\nA FAIXA DO EXPURGO DEIXOU DE SER ENCONTRADA FORA DA JANELA.\n' +
        '  Ela tem de sair de consulta própria (filtrada por tipo, sem o `take` da janela).\n',
    ).toBe(true);
    expect(r.verificados).toBe(2);
    expect(r.lacunasExplicadas).toEqual([{ de: '1', ate: '2' }]);
  });
});

describe('a fórmula antiga da cadeia só vale antes da virada', () => {
  const PAYLOAD = { a: 'z', b: { x: 1, y: 2 } };

  /** Uma linha hasheada pela fórmula ANTIGA (lista branca de chaves). */
  function linhaV1(seq: number, prevHash: string | null, ocorreuEm: Date): LinhaGravada {
    const antigo = JSON.stringify(PAYLOAD, Object.keys(PAYLOAD).sort());
    const corpo = [
      prevHash ?? '',
      'org-a',
      String(seq),
      'tool.resultado',
      '',
      '',
      ocorreuEm.toISOString(),
      antigo,
    ].join('|');
    return {
      orgId: 'org-a',
      seq: BigInt(seq),
      tipo: 'tool.resultado',
      nivel: null,
      payload: PAYLOAD,
      contentHash: null,
      prevHash,
      hash: sha256(corpo),
      retencaoAte: new Date('2030-01-01T00:00:00.000Z'),
      ocorreuEm,
    };
  }

  it('o caso é real: as duas fórmulas divergem neste payload', () => {
    expect(JSON.stringify(PAYLOAD, Object.keys(PAYLOAD).sort())).not.toBe(canonizar(PAYLOAD));
  });

  it('linha ANTERIOR à virada fecha pela fórmula velha, e a conferência diz qual foi', async () => {
    const m = prismaDeMentira();
    const s = new EventLogService(m.prisma);
    m.linhas.push(linhaV1(1, null, new Date(VIRADA_DA_CADEIA.getTime() - 86_400_000)));

    const r = await s.verificar('org-a');
    expect(r.ok).toBe(true);
    expect(r.porFormula).toEqual({ v1: 1, v2: 0 });
  });

  it('linha ESCRITA DEPOIS da virada que só fecha pela fórmula velha é FALHA', async () => {
    const m = prismaDeMentira();
    const s = new EventLogService(m.prisma);
    m.linhas.push(linhaV1(1, null, new Date(VIRADA_DA_CADEIA.getTime() + 3_600_000)));

    const r = await s.verificar('org-a');
    expect(
      r.ok,
      '\nUMA LINHA NOVA ESCRITA PELA FÓRMULA FRACA PASSOU COMO VÁLIDA.\n' +
        '  Não é sobre forjar (a corrente é resumo puro, sem chave). É sobre COBERTURA: o miolo\n' +
        '  daquela linha — tudo o que está aninhado no payload — fica fora da cadeia para sempre.\n',
    ).toBe(false);
    expect(r.quebrouEm?.motivo).toMatch(/fórmula ANTIGA/);
  });
});

describe('a lacuna gravada vira número que alguém lê', () => {
  it('`verificar` devolve a contagem de eventos incompletos POR NÍVEL', async () => {
    const { servico } = await cadeiaDe(1, [
      { nivel: 'R3', quantos: 7n },
      { nivel: null, quantos: 2n },
    ]);
    const r = await servico.verificar('org-a');
    // bigint do Postgres vira número; linha sem nível ganha um rótulo em vez de
    // sumir — "não classificada" também é dívida.
    expect(r.incompletosPorNivel).toEqual({ R3: 7, 'sem-nivel': 2 });
  });

  it('se a contagem falhar, a verificação da cadeia continua valendo', async () => {
    const { servico } = await cadeiaDe(2, () => {
      throw new Error('coluna payload não existe neste banco');
    });
    const r = await servico.verificar('org-a');
    expect(r.ok).toBe(true);
    expect(r.incompletosPorNivel).toEqual({});
  });
});

/** Recalcula o hash de uma linha do jeito que o serviço calcula. */
function recalcular(l: LinhaGravada): string {
  return createHash('sha256')
    .update(
      [
        l.prevHash ?? '',
        l.orgId,
        l.seq.toString(),
        l.tipo,
        'whatsapp.mensagem.enviar',
        l.contentHash ?? '',
        l.ocorreuEm.toISOString(),
        canonizar(l.payload),
      ].join('|'),
    )
    .digest('hex');
}
