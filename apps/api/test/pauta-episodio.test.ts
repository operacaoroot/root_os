import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  PAUTA_EPISODIO_STATUS,
  PautaEpisodioAtualizarSchema,
  PautaEpisodioCriarSchema,
  PautaEpisodioStatusSchema,
  apelidoDoEpisodio,
  transicaoDoEpisodio,
  vizinhosDoEpisodio,
  type PautaEpisodioStatus,
} from '@mktos/shared';

import {
  detalheDoEpisodio,
  itensMantidos,
  lerTranscricao,
  proximoNumero,
  resumoDoEpisodio,
  semPai,
  tituloPadrao,
} from '../src/pauta/episodio';
import { EpisodioService } from '../src/pauta/episodio.service';
import { RotinaService } from '../src/pauta/rotina.service';
import { AuditService } from '../src/audit/audit.service';
import { comContexto } from '../src/common/contexto-execucao';
import { comTenantNaSessao } from '../src/prisma/sessao-de-banco';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * O EPISÓDIO VIRA ENTIDADE DO OS — MC7.
 *
 * Quatro camadas:
 *   1. a parte pura: quem anda para onde (um passo à frente ou um atrás), o
 *      número seguinte, o título padrão, os itens mantidos da rodada e a
 *      leitura dos campos JSON;
 *   2. os contratos: o enum do Prisma espelhado no shared, a tabela 1:1 com a
 *      rodada e numerada por empresa, e os esquemas que a rota usa;
 *   3. o `EpisodioService` DE VERDADE com um prisma de mentira: só rodada
 *      curada vira episódio, a segunda tentativa na mesma rodada é 409, o
 *      número sai sob o cadeado da empresa, e o status só anda por transição
 *      válida, com escrita condicionada; a rodada com episódio não se apaga;
 *   4. com banco: criações SIMULTÂNEAS numeram sem colidir, a mesma rodada
 *      disputada por duas abas vira um episódio só, e cada empresa conta do 1.
 */

const ORG = '7c0f0a8e-4444-4a5a-9c1e-00000000mc07';
const PESSOA = 'b1d2c3e4-0000-4000-8000-000000000007';
const RODADA = '3f1e2d3c-0000-4000-8000-0000000000a1';

// ---------------------------------------------------------------------------
// 1. A parte pura
// ---------------------------------------------------------------------------

describe('episódio: quem anda para onde', () => {
  it('a ordem é a do trabalho, do roteiro ao concluído', () => {
    expect(PAUTA_EPISODIO_STATUS).toEqual(['roteiro', 'gravacao', 'edicao', 'pacote', 'derivacao', 'agendado', 'concluido']);
  });

  it('um passo à frente é permitido em toda etapa menos a última', () => {
    for (let i = 0; i < PAUTA_EPISODIO_STATUS.length - 1; i++) {
      expect(transicaoDoEpisodio(PAUTA_EPISODIO_STATUS[i], PAUTA_EPISODIO_STATUS[i + 1])).toEqual({ ok: true, sentido: 'avancar' });
    }
  });

  it('um passo atrás é permitido para refazer, inclusive saindo do concluído', () => {
    for (let i = 1; i < PAUTA_EPISODIO_STATUS.length; i++) {
      expect(transicaoDoEpisodio(PAUTA_EPISODIO_STATUS[i], PAUTA_EPISODIO_STATUS[i - 1])).toEqual({ ok: true, sentido: 'voltar' });
    }
  });

  it('pular etapa, para frente ou para trás, é recusado — nas 49 combinações só as vizinhas passam', () => {
    let validas = 0;
    for (const de of PAUTA_EPISODIO_STATUS) {
      for (const para of PAUTA_EPISODIO_STATUS) {
        const distancia = Math.abs(PAUTA_EPISODIO_STATUS.indexOf(de) - PAUTA_EPISODIO_STATUS.indexOf(para));
        const t = transicaoDoEpisodio(de, para);
        expect(t.ok, `${de} → ${para}`).toBe(distancia === 1);
        if (t.ok) validas++;
      }
    }
    expect(validas).toBe(12);
  });

  it('o erro diz para onde dá para ir, com o nome da etapa', () => {
    const t = transicaoDoEpisodio('roteiro', 'pacote');
    expect(t).toEqual({ ok: false, erro: expect.stringContaining('só vai para Gravação') });
    const meio = transicaoDoEpisodio('edicao', 'concluido');
    expect(meio.ok === false && meio.erro).toContain('Pacote ou Gravação');
  });

  it('ficar onde está não é transição', () => {
    expect(transicaoDoEpisodio('edicao', 'edicao')).toEqual({ ok: false, erro: 'O episódio já está em Edição.' });
  });

  it('status desconhecido, de qualquer lado, é recusado sem lançar', () => {
    expect(transicaoDoEpisodio('coleta' as PautaEpisodioStatus, 'roteiro').ok).toBe(false);
    expect(transicaoDoEpisodio('roteiro', 'curadoria' as PautaEpisodioStatus).ok).toBe(false);
  });

  it('os vizinhos: o roteiro não volta, o concluído não avança', () => {
    expect(vizinhosDoEpisodio('roteiro')).toEqual({ avancar: 'gravacao', voltar: null });
    expect(vizinhosDoEpisodio('pacote')).toEqual({ avancar: 'derivacao', voltar: 'edicao' });
    expect(vizinhosDoEpisodio('concluido')).toEqual({ avancar: null, voltar: 'agendado' });
  });
});

describe('episódio: número, apelido e título', () => {
  it('o primeiro é 1 e o próximo é o maior mais um', () => {
    expect(proximoNumero(null)).toBe(1);
    expect(proximoNumero(undefined)).toBe(1);
    expect(proximoNumero(0)).toBe(1);
    expect(proximoNumero(7)).toBe(8);
  });

  it('o apelido tem dois dígitos no mínimo — é o nome no Mac e na página de links', () => {
    expect(apelidoDoEpisodio(3)).toBe('ep-03');
    expect(apelidoDoEpisodio(12)).toBe('ep-12');
    expect(apelidoDoEpisodio(104)).toBe('ep-104');
  });

  it('sem título pedido, herda o da rodada sem repetir o apelido, no teto de 160', () => {
    expect(tituloPadrao(4, '  Semana   39 ')).toBe('Semana 39');
    expect(tituloPadrao(4, '')).toBe('Episódio 4');
    expect(tituloPadrao(1, 'x'.repeat(300))).toHaveLength(160);
  });
});

describe('episódio: o que vem da rodada e dos campos JSON', () => {
  it('os itens mantidos saem sem a marca da tela de curadoria, e lixo fica de fora', () => {
    const itens = [
      { id: 'c1', titulo: 'Link do grupo', url: 'https://a.exemplo', origem: 'W', marcado: true, sugerido: true },
      { titulo: 'Da IA, modo antigo', url: 'https://b.exemplo' },
      null,
      'texto solto',
      { url: 'sem título' },
    ];
    const r = itensMantidos(itens);
    expect(r).toEqual([
      { id: 'c1', titulo: 'Link do grupo', url: 'https://a.exemplo', origem: 'W', sugerido: true },
      { titulo: 'Da IA, modo antigo', url: 'https://b.exemplo' },
    ]);
    expect(itensMantidos({})).toEqual([]);
  });

  it('o item de caixa de entrada chega sem o link privado — a página pública nunca o terá para publicar', () => {
    const r = itensMantidos([
      { id: 'n1', titulo: 'Da newsletter', url: 'https://mail.google.com/mail/u/0/#inbox/abc', semLinkPublico: true },
      { id: 'n2', titulo: 'Público', url: 'https://c.exemplo', semLinkPublico: false },
    ]);
    expect(r[0]).toEqual({ id: 'n1', titulo: 'Da newsletter', url: '', semLinkPublico: true });
    expect(r[1].url).toBe('https://c.exemplo');
  });

  it('semPai reconhece só a recusa de chave estrangeira (P2003)', () => {
    expect(semPai(new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 'x' }))).toBe(true);
    expect(semPai(new Prisma.PrismaClientKnownRequestError('único', { code: 'P2002', clientVersion: 'x' }))).toBe(false);
    expect(semPai(new Error('P2003'))).toBe(false);
  });

  it('a transcrição só aceita segmentos {inicio, fim, texto}', () => {
    expect(
      lerTranscricao([{ inicio: 0, fim: 2.5, texto: 'abre com impacto' }, { inicio: '3', fim: 4, texto: 'x' }, { texto: 'y' }]),
    ).toEqual([{ inicio: 0, fim: 2.5, texto: 'abre com impacto' }]);
    expect(lerTranscricao('não é lista')).toEqual([]);
  });

  it('o detalhe leva os vizinhos do status e os itens; o resumo, só a conta', () => {
    const linha = {
      id: 'e1', numero: 2, titulo: 'Semana', status: 'roteiro' as const, rodadaId: RODADA,
      criadoEm: new Date('2026-09-23T10:00:00Z'), atualizadoEm: new Date('2026-09-23T11:00:00Z'),
      rodada: { titulo: 'Semana', itens: [{ titulo: 'a', url: 'u' }, { titulo: 'b', url: 'v' }], janelaIni: new Date('2026-09-16T00:00:00Z'), janelaFim: new Date('2026-09-23T00:00:00Z') },
      roteiro: '', descricao: '', midia: [], transcricao: null, transcricaoTexto: '', titulos: {}, thumbs: ['t1'],
      bioPageId: null, criadoPor: PESSOA,
    };
    expect(resumoDoEpisodio(linha)).toMatchObject({ apelido: 'ep-02', itens: 2, rodadaTitulo: 'Semana' });
    const d = detalheDoEpisodio(linha);
    // Desde o MC11 títulos e thumbs têm forma: o que não a tem fica de fora.
    expect(d).toMatchObject({ avancar: 'gravacao', voltar: null, midia: {}, transcricao: [], titulos: [], thumbs: [] });
    expect(d.itens).toHaveLength(2);
    expect(d.janelaIni).toBe('2026-09-16T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// 2. Os contratos
// ---------------------------------------------------------------------------

describe('episódio: contratos', () => {
  const schema = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf8');

  it('o enum do Prisma é o espelho exato do shared, na mesma ordem', () => {
    const bloco = schema.match(/enum PautaEpisodioStatus \{([\s\S]*?)\}/)?.[1] ?? '';
    const valores = bloco
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, '').trim())
      .filter(Boolean);
    expect(valores).toEqual([...PAUTA_EPISODIO_STATUS]);
  });

  it('a tabela é 1:1 com a rodada, numerada por empresa, e apagar a rodada não leva o episódio', () => {
    const modelo = schema.match(/model PautaEpisodio \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(modelo).toMatch(/rodadaId\s+String\s+@unique/);
    expect(modelo).toContain('@@unique([orgId, numero])');
    expect(modelo).toMatch(/onDelete: Restrict/);
    expect(modelo).toMatch(/orgId String @default\(""\)/);
  });

  it('criar exige o id da rodada e aceita título aparado de até 160', () => {
    expect(PautaEpisodioCriarSchema.parse({ rodadaId: RODADA })).toEqual({ rodadaId: RODADA });
    expect(PautaEpisodioCriarSchema.parse({ rodadaId: RODADA, titulo: '  Ep da IA  ' }).titulo).toBe('Ep da IA');
    expect(PautaEpisodioCriarSchema.safeParse({}).success).toBe(false);
    expect(PautaEpisodioCriarSchema.safeParse({ rodadaId: 'rodada-9' }).success).toBe(false);
    expect(PautaEpisodioCriarSchema.safeParse({ rodadaId: RODADA, titulo: 'x'.repeat(161) }).success).toBe(false);
  });

  it('o título não fica vazio e o status só aceita as sete etapas', () => {
    expect(PautaEpisodioAtualizarSchema.safeParse({ titulo: '   ' }).success).toBe(false);
    expect(PautaEpisodioStatusSchema.parse({ para: 'edicao' })).toEqual({ para: 'edicao' });
    expect(PautaEpisodioStatusSchema.safeParse({ para: 'curadoria' }).success).toBe(false);
    expect(PautaEpisodioStatusSchema.safeParse({}).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. O serviço com um prisma de mentira
// ---------------------------------------------------------------------------

type Rodada = { id: string; orgId: string; status: string; titulo: string; itens: unknown; janelaIni: Date; janelaFim: Date };
type Episodio = {
  id: string; orgId: string; rodadaId: string; numero: number; titulo: string; status: PautaEpisodioStatus;
  roteiro: string; descricao: string; midia: unknown; transcricao: unknown; transcricaoTexto: string;
  titulos: unknown; thumbs: unknown; bioPageId: string | null; criadoPor: string | null; criadoEm: Date; atualizadoEm: Date;
};

function servico(opts: { rodadas?: Rodada[]; episodios?: Episodio[]; falhaNoCreate?: unknown; falhaNoDelete?: unknown } = {}) {
  const agora = new Date('2026-09-23T12:00:00Z');
  const rodadas = opts.rodadas ?? [
    { id: RODADA, orgId: ORG, status: 'curada', titulo: 'Semana 39', itens: [{ id: 'c1', titulo: 'A', url: 'https://a' }], janelaIni: agora, janelaFim: agora },
  ];
  const episodios: Episodio[] = opts.episodios ?? [];
  const auditoria: Array<Record<string, unknown>> = [];
  const cadeados: string[] = [];
  const condicionais: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const listagens: Array<Record<string, unknown>> = [];

  const comRodada = (e: Episodio) => ({ ...e, rodada: rodadas.find((r) => r.id === e.rodadaId)! });

  const pautaEpisodio = {
    aggregate: async ({ where }: { where: { orgId: string } }) => {
      const nums = episodios.filter((e) => e.orgId === where.orgId).map((e) => e.numero);
      return { _max: { numero: nums.length ? Math.max(...nums) : null } };
    },
    create: async ({ data }: { data: Partial<Episodio> }) => {
      if (opts.falhaNoCreate) throw opts.falhaNoCreate;
      const novo = {
        id: `ep-id-${episodios.length + 1}`, status: 'roteiro', roteiro: '', descricao: '', midia: {}, transcricao: [],
        transcricaoTexto: '', titulos: [], thumbs: [], bioPageId: null, criadoPor: null, criadoEm: agora, atualizadoEm: agora,
        ...data,
      } as Episodio;
      episodios.push(novo);
      return { id: novo.id, numero: novo.numero, titulo: novo.titulo };
    },
    findFirst: async ({ where }: { where: { id: string; orgId: string } }) => {
      const e = episodios.find((x) => x.id === where.id && x.orgId === where.orgId);
      return e ? comRodada(e) : null;
    },
    // Devolve na ordem de inserção: a ordem da lista é a do `orderBy` que o
    // serviço pede, e o teste confere o pedido.
    findMany: async (args: { where: { orgId: string } }) => {
      listagens.push(args);
      return episodios.filter((e) => e.orgId === args.where.orgId).map(comRodada);
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      condicionais.push({ where, data });
      const alvo = episodios.filter((e) => Object.entries(where).every(([k, v]) => (e as Record<string, unknown>)[k] === v));
      for (const e of alvo) Object.assign(e, data);
      return { count: alvo.length };
    },
  };
  const pautaRodada = {
    findFirst: async ({ where }: { where: { id: string; orgId: string } }) => {
      const r = rodadas.find((x) => x.id === where.id && x.orgId === where.orgId);
      if (!r) return null;
      const ep = episodios.find((e) => e.rodadaId === r.id);
      return { ...r, episodio: ep ? { numero: ep.numero } : null };
    },
    delete: async () => {
      if (opts.falhaNoDelete) throw opts.falhaNoDelete;
      return {};
    },
  };
  const tx = {
    $executeRaw: async (partes: TemplateStringsArray, ...valores: unknown[]) => {
      cadeados.push(`${partes.join('?')} ${valores.join(',')}`);
      return 1;
    },
    pautaRodada,
    pautaEpisodio,
  };
  const prisma = {
    ...tx,
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditoria.push(data);
        return data;
      },
    },
  } as unknown as PrismaService;

  return {
    episodios: new EpisodioService(prisma, new AuditService(prisma)),
    rotinas: new RotinaService(prisma, new AuditService(prisma), {} as never),
    lista: episodios,
    auditoria,
    cadeados,
    condicionais,
    listagens,
  };
}

function episodio(over: Partial<Episodio> = {}): Episodio {
  const agora = new Date('2026-09-23T12:00:00Z');
  return {
    id: 'e1', orgId: ORG, rodadaId: RODADA, numero: 1, titulo: 'Semana 39', status: 'roteiro',
    roteiro: '', descricao: '', midia: {}, transcricao: [], transcricaoTexto: '', titulos: [], thumbs: [],
    bioPageId: null, criadoPor: PESSOA, criadoEm: agora, atualizadoEm: agora, ...over,
  };
}

describe('episódio: nasce da rodada curada', () => {
  it('a rodada curada vira o episódio 1, em roteiro, com o título herdado, sob o cadeado da empresa, e audita', async () => {
    const s = servico();
    const d = await s.episodios.criar(ORG, PESSOA, { rodadaId: RODADA });
    expect(d).toMatchObject({ numero: 1, apelido: 'ep-01', titulo: 'Semana 39', status: 'roteiro', avancar: 'gravacao', voltar: null });
    expect(d.itens).toEqual([{ id: 'c1', titulo: 'A', url: 'https://a' }]);
    expect(s.lista[0]).toMatchObject({ orgId: ORG, rodadaId: RODADA, criadoPor: PESSOA });
    expect(s.cadeados).toHaveLength(1);
    expect(s.cadeados[0]).toContain('pg_advisory_xact_lock');
    expect(s.cadeados[0]).toContain(`pauta-episodio:${ORG}`);
    expect(s.auditoria.at(-1)).toMatchObject({ action: 'pauta.episodio_criado', orgId: ORG, after: { numero: 1, rodadaId: RODADA } });
  });

  it('o número é o maior da empresa mais um — o de outra empresa não conta', async () => {
    const agora = new Date();
    const outra = '11111111-2222-4333-8444-555555555555';
    const s = servico({
      rodadas: [{ id: RODADA, orgId: ORG, status: 'curada', titulo: 'S', itens: [], janelaIni: agora, janelaFim: agora }],
      episodios: [
        episodio({ id: 'x', rodadaId: 'r-velha', numero: 6 }),
        episodio({ id: 'y', orgId: outra, rodadaId: 'r-outra', numero: 41 }),
      ],
    });
    const d = await s.episodios.criar(ORG, PESSOA, { rodadaId: RODADA, titulo: 'Especial IA' });
    expect(d.numero).toBe(7);
    expect(d.titulo).toBe('Especial IA');
  });

  it('rodada que já tem episódio é 409 e nada é criado', async () => {
    const s = servico({ episodios: [episodio({ numero: 3 })] });
    await expect(s.episodios.criar(ORG, PESSOA, { rodadaId: RODADA })).rejects.toThrow(ConflictException);
    await expect(s.episodios.criar(ORG, PESSOA, { rodadaId: RODADA })).rejects.toThrow(/ep-03/);
    expect(s.lista).toHaveLength(1);
    expect(s.auditoria).toHaveLength(0);
  });

  it('rodada aguardando curadoria é 400, dizendo que falta confirmar', async () => {
    const agora = new Date();
    const s = servico({ rodadas: [{ id: RODADA, orgId: ORG, status: 'aguardando_curadoria', titulo: 'S', itens: [], janelaIni: agora, janelaFim: agora }] });
    await expect(s.episodios.criar(ORG, PESSOA, { rodadaId: RODADA })).rejects.toThrow(/confirme os itens/);
    expect(s.lista).toHaveLength(0);
  });

  it.each(['coletando', 'falhou', 'aprovada', 'publicada'])('rodada em "%s" não vira episódio (400)', async (status) => {
    const agora = new Date();
    const s = servico({ rodadas: [{ id: RODADA, orgId: ORG, status, titulo: 'S', itens: [], janelaIni: agora, janelaFim: agora }] });
    await expect(s.episodios.criar(ORG, PESSOA, { rodadaId: RODADA })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rodada de outra empresa é 404, igual a rodada que não existe', async () => {
    const s = servico();
    await expect(s.episodios.criar('outra-org', PESSOA, { rodadaId: RODADA })).rejects.toBeInstanceOf(NotFoundException);
    expect(s.lista).toHaveLength(0);
  });

  it('a segunda tranca: o índice único da rodada vira 409, e o do número também, com o pedido de tentar de novo', async () => {
    const naRodada = new Prisma.PrismaClientKnownRequestError('únicos', { code: 'P2002', clientVersion: 'x', meta: { target: ['rodadaId'] } });
    await expect(servico({ falhaNoCreate: naRodada }).episodios.criar(ORG, PESSOA, { rodadaId: RODADA })).rejects.toThrow('Esta rodada já virou episódio.');
    const noNumero = new Prisma.PrismaClientKnownRequestError('únicos', { code: 'P2002', clientVersion: 'x', meta: { target: ['orgId', 'numero'] } });
    await expect(servico({ falhaNoCreate: noNumero }).episodios.criar(ORG, PESSOA, { rodadaId: RODADA })).rejects.toThrow(/tente de novo/);
  });

  it('a rodada apagada entre a leitura e o insert (o gatilho recusa, P2003) é 404, não 500', async () => {
    const fk = new Prisma.PrismaClientKnownRequestError('orgId não derivável', { code: 'P2003', clientVersion: 'x' });
    await expect(servico({ falhaNoCreate: fk }).episodios.criar(ORG, PESSOA, { rodadaId: RODADA })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('outro erro do banco sobe como veio', async () => {
    await expect(servico({ falhaNoCreate: new Error('conexão caiu') }).episodios.criar(ORG, PESSOA, { rodadaId: RODADA })).rejects.toThrow('conexão caiu');
  });
});

describe('episódio: anda de status só por transição válida', () => {
  it('avança um passo, com a escrita condicionada ao status lido, e audita o sentido', async () => {
    const s = servico({ episodios: [episodio()] });
    const d = await s.episodios.mudarStatus(ORG, 'e1', PESSOA, 'gravacao');
    expect(d).toMatchObject({ status: 'gravacao', avancar: 'edicao', voltar: 'roteiro' });
    expect(s.condicionais[0].where).toEqual({ id: 'e1', orgId: ORG, status: 'roteiro' });
    expect(s.auditoria.at(-1)).toMatchObject({ action: 'pauta.episodio_status', before: { status: 'roteiro' }, after: { status: 'gravacao', sentido: 'avancar' } });
  });

  it('volta um passo para refazer', async () => {
    const s = servico({ episodios: [episodio({ status: 'pacote' })] });
    const d = await s.episodios.mudarStatus(ORG, 'e1', PESSOA, 'edicao');
    expect(d.status).toBe('edicao');
    expect(s.auditoria.at(-1)).toMatchObject({ after: { sentido: 'voltar' } });
  });

  it('pular etapa é 400 e nada é gravado', async () => {
    const s = servico({ episodios: [episodio()] });
    await expect(s.episodios.mudarStatus(ORG, 'e1', PESSOA, 'concluido')).rejects.toBeInstanceOf(BadRequestException);
    expect(s.condicionais).toHaveLength(0);
    expect(s.lista[0].status).toBe('roteiro');
  });

  it('se outra aba moveu antes, a escrita não acha a linha e é 409', async () => {
    const s = servico({ episodios: [episodio()] });
    const original = s.lista[0];
    // A outra aba grava entre a leitura e a escrita desta.
    const lerAntes = s.episodios.mudarStatus.bind(s.episodios);
    const promessa = lerAntes(ORG, 'e1', PESSOA, 'gravacao');
    original.status = 'gravacao';
    await expect(promessa).rejects.toBeInstanceOf(ConflictException);
  });

  it('episódio de outra empresa é 404', async () => {
    const s = servico({ episodios: [episodio()] });
    await expect(s.episodios.mudarStatus('outra-org', 'e1', PESSOA, 'gravacao')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('episódio: título, lista e detalhe', () => {
  it('trocar o título grava aparado e audita antes e depois', async () => {
    const s = servico({ episodios: [episodio()] });
    const d = await s.episodios.atualizarTitulo(ORG, 'e1', PESSOA, '  Ep. especial  ');
    expect(d.titulo).toBe('Ep. especial');
    expect(s.condicionais[0].where).toEqual({ id: 'e1', orgId: ORG });
    expect(s.auditoria.at(-1)).toMatchObject({ action: 'pauta.episodio_titulo', before: { titulo: 'Semana 39' }, after: { titulo: 'Ep. especial' } });
  });

  it('a lista pede do mais novo para o mais velho, no teto de 100, só da empresa, com a conta de itens', async () => {
    const s = servico({
      episodios: [episodio({ id: 'b', numero: 2, rodadaId: RODADA }), episodio({ id: 'a', numero: 1 }), episodio({ id: 'c', orgId: 'outra', numero: 9 })],
    });
    const l = await s.episodios.listar(ORG);
    expect(s.listagens[0]).toMatchObject({ where: { orgId: ORG }, orderBy: { numero: 'desc' }, take: 100 });
    expect(l.items.map((i) => i.numero)).toEqual([2, 1]);
    expect(l.items[0]).toMatchObject({ apelido: 'ep-02', itens: 1, rodadaTitulo: 'Semana 39' });
  });

  it('detalhe de episódio inexistente é 404', async () => {
    await expect(servico().episodios.obter(ORG, 'nada')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a rodada que virou episódio não se apaga: 409 antes de tocar no banco', async () => {
    const s = servico({ episodios: [episodio({ numero: 5 })] });
    await expect(s.rotinas.removerRodada(ORG, RODADA, PESSOA)).rejects.toThrow(/ep-05/);
    await expect(s.rotinas.removerRodada(ORG, RODADA, PESSOA)).rejects.toBeInstanceOf(ConflictException);
  });

  it('o episódio que nasce entre a conferência e o delete (RESTRICT, P2003) é 409, não 500', async () => {
    const fk = new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 'x' });
    const s = servico({ falhaNoDelete: fk });
    await expect(s.rotinas.removerRodada(ORG, RODADA, PESSOA)).rejects.toBeInstanceOf(ConflictException);
    expect(s.auditoria).toHaveLength(0);
    await expect(servico({ falhaNoDelete: new Error('conexão caiu') }).rotinas.removerRodada(ORG, RODADA, PESSOA)).rejects.toThrow('conexão caiu');
  });

  it('a rodada sem episódio segue se apagando como antes', async () => {
    const s = servico();
    await expect(s.rotinas.removerRodada(ORG, RODADA, PESSOA)).resolves.toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// 4. Com banco: a corrida de verdade
// ---------------------------------------------------------------------------

const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'ESCREVE nele (duas empresas, rodadas e episódios)');

const MARCA = `ep${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

describe.skipIf(!URL)('episódio com banco: numera sem colidir', () => {
  let admin: PrismaClient;
  let cru: PrismaClient;
  let episodios: EpisodioService;
  const orgs: string[] = [];

  const na = <T>(orgId: string, fn: () => Promise<T>) =>
    comContexto({ orgId, actorType: 'user', actorId: null, correlationId: `teste-${MARCA}`, origem: 'http' }, fn);

  async function rodadasCuradas(orgId: string, n: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const r = await admin.pautaRodada.create({
        data: { orgId, status: 'curada', titulo: `Semana ${i} ${MARCA}`, janelaIni: new Date(), janelaFim: new Date(), itens: [{ titulo: `item ${i}`, url: 'https://x' }] },
      });
      ids.push(r.id);
    }
    return ids;
  }

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: URL } } });
    cru = new PrismaClient({ datasourceUrl: URL });
    // O cliente como a aplicação o monta: a sessão declara a empresa em toda
    // transação — é por ele que o cadeado precisa passar inteiro.
    const app = comTenantNaSessao(cru, { modo: 'impor' }) as unknown as PrismaService;
    episodios = new EpisodioService(app, new AuditService(app));
    for (const rotulo of ['a', 'b']) {
      const o = await admin.org.create({ data: { name: `Episódios ${rotulo} ${MARCA}`, slug: `ep-${rotulo}-${MARCA}`, modulos: ['pauta'] } });
      orgs.push(o.id);
    }
  }, 60_000);

  afterAll(async () => {
    for (const orgId of orgs) {
      await admin.pautaEpisodio.deleteMany({ where: { orgId } });
      await admin.pautaRodada.deleteMany({ where: { orgId } });
      await admin.auditLog.deleteMany({ where: { orgId } });
      await admin.org.deleteMany({ where: { id: orgId } });
    }
    await admin.$disconnect();
    await cru.$disconnect();
  });

  it('seis criações simultâneas na mesma empresa saem 1 a 6, sem buraco e sem repetição', async () => {
    const [orgA] = orgs;
    const ids = await rodadasCuradas(orgA, 6);
    const feitos = await Promise.all(ids.map((rodadaId) => na(orgA, () => episodios.criar(orgA, 'pessoa', { rodadaId }))));
    expect(feitos.map((e) => e.numero).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(feitos.map((e) => e.rodadaId)).size).toBe(6);
  }, 60_000);

  it('a mesma rodada disputada por duas abas vira UM episódio; a outra recebe 409', async () => {
    const [orgA] = orgs;
    const [rodadaId] = await rodadasCuradas(orgA, 1);
    const r = await Promise.allSettled([
      na(orgA, () => episodios.criar(orgA, 'pessoa', { rodadaId })),
      na(orgA, () => episodios.criar(orgA, 'pessoa', { rodadaId })),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const recusa = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(recusa.reason).toBeInstanceOf(ConflictException);
    expect(await admin.pautaEpisodio.count({ where: { rodadaId } })).toBe(1);
  }, 60_000);

  it('cada empresa conta do 1, e o episódio anda pelo banco só por transição válida', async () => {
    const [, orgB] = orgs;
    const [rodadaId] = await rodadasCuradas(orgB, 1);
    const e = await na(orgB, () => episodios.criar(orgB, 'pessoa', { rodadaId }));
    expect(e.numero).toBe(1);
    const andou = await na(orgB, () => episodios.mudarStatus(orgB, e.id, 'pessoa', 'gravacao'));
    expect(andou.status).toBe('gravacao');
    await expect(na(orgB, () => episodios.mudarStatus(orgB, e.id, 'pessoa', 'derivacao'))).rejects.toBeInstanceOf(BadRequestException);
    expect((await admin.pautaEpisodio.findUnique({ where: { id: e.id } }))?.status).toBe('gravacao');
  }, 60_000);

  it('o banco recusa apagar a rodada que virou episódio (RESTRICT), mesmo por fora da API', async () => {
    const [orgA] = orgs;
    const e = await admin.pautaEpisodio.findFirst({ where: { orgId: orgA }, select: { rodadaId: true } });
    const erro = await admin.pautaRodada.delete({ where: { id: e!.rodadaId } }).catch((x: unknown) => x);
    expect(semPai(erro)).toBe(true);
  });

  it('episódio pendurado em rodada que não existe: o gatilho recusa com P2003, o que a API traduz', async () => {
    const erro = await admin.pautaEpisodio
      .create({ data: { rodadaId: `nao-existe-${MARCA}`, numero: 9_999, titulo: 'x' } })
      .catch((x: unknown) => x);
    expect(semPai(erro)).toBe(true);
  });
});
