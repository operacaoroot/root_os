import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { TotemCodigoEtiquetaSchema, totemLoteDataDoDia, totemLoteHoje, totemTextoDaReposicao } from '@mktos/shared';

import {
  configPadraoDaFicha,
  fichaDaEtiqueta,
  montarFichaDaEtiqueta,
  type EntradaDaFicha,
  type ProdutoDaFicha,
} from '../src/totem/etiqueta/ficha';
import { gerarEtiquetas, revogarEtiqueta } from '../src/totem/lote/etiquetas';
import { loteVigentePorProduto, type TotemLoteVigente } from '../src/totem/lote/lote-vigente';
import { validadeDoLoteNovo } from '../src/totem/lote/lotes';
import { classificarPendencias } from '../src/totem/lote/pendencias';
import { receberRemessa } from '../src/totem/lote/remessas';
import { registrarReposicao } from '../src/totem/lote/reposicoes';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * LOTE E ETIQUETA (frente C do totem).
 *
 *  1. As regras puras: a validade do lote novo, a classificação das
 *     pendências e a ficha pública, que só leva preço com `precoLigado`.
 *  2. No banco: o lote vigente nas três origens da seção 4 do contrato, o
 *     produto sem lote e duas lojas que não se misturam; a etiqueta revogada
 *     que responde 404; e o gerente de uma loja que não confirma a remessa da
 *     outra.
 *
 * O isolamento entre empresas das tabelas do totem está no registro de
 * `tenant-isolation.test.ts`; aqui as consultas rodam como dona do banco.
 */

const URL = process.env.TEST_DATABASE_URL;
const ORG = 'org-teste-totem-lote';
const SEM_MODULO = 'org-teste-totem-lote-sem-modulo';

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (lojas, produtos, lotes, remessas, reposições e etiquetas do totem)');

const dia = (iso: string) => totemLoteDataDoDia(iso);

/* ==========================================================================
 * 1. AS REGRAS — sem banco
 * ========================================================================== */

describe('lote: a validade do lote novo', () => {
  it('usa a validade informada', () => {
    expect(validadeDoLoteNovo({ validadeEm: '2026-12-31' }, null).toISOString()).toBe('2026-12-31T00:00:00.000Z');
  });

  it('calcula pela fabricação e pela validade padrão do produto', () => {
    expect(validadeDoLoteNovo({ fabricadoEm: '2026-10-01' }, 90).toISOString()).toBe('2026-12-30T00:00:00.000Z');
  });

  it('recusa lote sem validade e sem como calcular', () => {
    expect(() => validadeDoLoteNovo({}, 90)).toThrow(BadRequestException);
    expect(() => validadeDoLoteNovo({ fabricadoEm: '2026-10-01' }, null)).toThrow(/validade padrão/);
  });

  it('recusa validade anterior à fabricação', () => {
    expect(() => validadeDoLoteNovo({ fabricadoEm: '2026-10-10', validadeEm: '2026-10-01' }, null)).toThrow(
      'A validade não pode ser anterior à fabricação.',
    );
  });
});

describe('lote: o texto da reposição', () => {
  it('diz "recebido" quando a data é presumida pela remessa e "reposto" quando a loja confirmou', () => {
    const quando = new Date('2026-10-05T15:00:00.000Z');
    expect(totemTextoDaReposicao(quando, true)).toBe('Lote recebido em 05/10');
    expect(totemTextoDaReposicao(quando, false)).toBe('Reposto em 05/10/2026');
  });

  it('o dia de hoje é o de Brasília, mesmo quando em UTC já virou', () => {
    expect(totemLoteHoje(new Date('2026-10-12T02:00:00.000Z')).toISOString()).toBe('2026-10-11T00:00:00.000Z');
  });
});

describe('lote: as pendências da loja', () => {
  const hoje = dia('2026-10-11');
  const vigente = (loteId: string, validade: string, presumido = false): TotemLoteVigente => ({
    loteId,
    codigo: `L-${loteId}`,
    fabricadoEm: null,
    validadeEm: dia(validade),
    repostoEm: dia('2026-10-01'),
    presumido,
    origem: 'producao_central',
  });

  it('separa sem lote, vencidos e vencendo em até 15 dias, e deixa o resto de fora', () => {
    const produtos = [
      { id: 'a', codigo: 'A', nome: 'Aveia' },
      { id: 'b', codigo: 'B', nome: 'Castanha' },
      { id: 'c', codigo: 'C', nome: 'Damasco' },
      { id: 'd', codigo: 'D', nome: 'Granola' },
      { id: 'e', codigo: 'E', nome: 'Linhaça' },
    ];
    const vigentes = new Map([
      ['b', vigente('b', '2026-10-10')],
      ['c', vigente('c', '2026-10-26', true)],
      ['d', vigente('d', '2026-10-27')],
      ['e', vigente('e', '2026-10-11')],
    ]);
    const r = classificarPendencias(produtos, vigentes, hoje);
    expect(r.semLote.map((p) => p.codigo)).toEqual(['A']);
    expect(r.vencidos.map((p) => [p.codigo, p.dias])).toEqual([['B', -1]]);
    expect(r.vencendo.map((p) => [p.codigo, p.dias, p.presumido])).toEqual([
      ['E', 0, false],
      ['C', 15, true],
    ]);
  });
});

describe('etiqueta: a ficha pública', () => {
  const produto: ProdutoDaFicha = {
    codigo: 'GRA-001',
    nome: 'Granola tradicional',
    categoria: 'Cereais',
    composicao: 'Aveia, mel e castanhas.',
    beneficios: null,
    alergenicos: 'Contém castanhas.',
    porcaoG: new Prisma.Decimal('40'),
    porcaoDescricao: '4 colheres de sopa',
    nutricional: [{ nutriente: 'Valor energético', quantidade: 160, unidade: 'kcal', vd: 8 }],
    selos: ['sem_gluten', 'selo-que-nao-existe'],
    imagemUrl: null,
    fonteNutricional: null,
    precoCentavos: 4990,
    unidadePreco: 'kg',
    ativo: true,
  };
  const loteDaLoja = { id: 'lote-1', codigo: 'L2610', fabricadoEm: dia('2026-10-01'), validadeEm: dia('2026-10-20') };
  const vigente: TotemLoteVigente = {
    loteId: 'lote-1',
    codigo: 'L2610',
    fabricadoEm: dia('2026-10-01'),
    validadeEm: dia('2026-10-20'),
    repostoEm: new Date('2026-10-09T13:00:00.000Z'),
    presumido: false,
    origem: 'producao_central',
  };
  const entrada = (mudar: Partial<EntradaDaFicha> = {}): EntradaDaFicha => ({
    codigo: 'ABCDE12345',
    loja: { nome: 'Loja Centro', cidade: 'Campo Bom' },
    produto,
    lote: loteDaLoja,
    vigente,
    config: configPadraoDaFicha('Sr. aGranel'),
    campanha: { chamada: 'Ganhe 10% na primeira compra', descricaoBeneficio: '10% de desconto' },
    hoje: dia('2026-10-11'),
    ...mudar,
  });

  it('com o preço desligado, a resposta não tem preço nenhum', () => {
    const ficha = montarFichaDaEtiqueta(entrada());
    expect(ficha.produto).not.toHaveProperty('precoCentavos');
    expect(ficha.produto).not.toHaveProperty('unidadePreco');
    expect(JSON.stringify(ficha)).not.toMatch(/preco|4990/i);
  });

  it('com o preço ligado, leva o preço e a unidade', () => {
    const ficha = montarFichaDaEtiqueta(entrada({ config: { ...configPadraoDaFicha('Sr. aGranel'), precoLigado: true } }));
    expect(ficha.produto.precoCentavos).toBe(4990);
    expect(ficha.produto.unidadePreco).toBe('kg');
  });

  it('não vaza campo interno do produto e descarta selo desconhecido', () => {
    const ficha = montarFichaDaEtiqueta(entrada());
    expect(ficha.produto).not.toHaveProperty('ativo');
    expect(ficha.produto.selos).toEqual(['sem_gluten']);
    expect(ficha.produto.porcaoG).toBe(40);
    expect(ficha.config).not.toHaveProperty('precoLigado');
  });

  it('mostra o lote com a reposição e o estado da validade', () => {
    const ficha = montarFichaDaEtiqueta(entrada());
    expect(ficha.lote).toEqual({
      codigo: 'L2610',
      fabricadoEm: '2026-10-01',
      validadeEm: '2026-10-20',
      repostoEm: '2026-10-09T13:00:00.000Z',
      presumido: false,
      situacao: 'atencao',
    });
  });

  it('lote fixado na etiqueta que não é o vigente sai sem data de reposição', () => {
    const ficha = montarFichaDaEtiqueta(
      entrada({ lote: { id: 'lote-velho', codigo: 'L2609', fabricadoEm: null, validadeEm: dia('2026-10-10') } }),
    );
    expect(ficha.lote).toMatchObject({ codigo: 'L2609', repostoEm: null, presumido: false, situacao: 'vencido' });
  });

  it('sem cadastro ligado, não anuncia campanha', () => {
    expect(montarFichaDaEtiqueta(entrada()).campanha).toBeNull();
    const ligado = { ...configPadraoDaFicha('Sr. aGranel'), cadastroLigado: true };
    expect(montarFichaDaEtiqueta(entrada({ config: ligado })).campanha?.chamada).toBe('Ganhe 10% na primeira compra');
  });
});

/* ==========================================================================
 * 2. NO BANCO
 * ========================================================================== */

describe.skipIf(!URL)('lote e etiqueta no banco', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
  const ids = {
    gerente: 'usr-teste-totem-lote-gerente',
    rede: 'usr-teste-totem-lote-rede',
    loja1: '',
    loja2: '',
    p1: '',
    p2: '',
    p3: '',
    p4: '',
    p5: '',
  };
  const lotes: Record<string, string> = {};
  const gerente = () => ({
    sub: ids.gerente,
    orgId: ORG,
    permissions: ['totem.ver', 'totem.dispositivos', 'totem.reposicao', 'totem.etiquetas', 'totem.cupons'],
  });
  const rede = () => ({
    sub: ids.rede,
    orgId: ORG,
    permissions: ['totem.ver', 'totem.lotes', 'totem.reposicao', 'totem.etiquetas', 'totem.rede'],
  });

  async function limpar(): Promise<void> {
    const orgId = { in: [ORG, SEM_MODULO] };
    await prisma.totemEvento.deleteMany({ where: { orgId } });
    await prisma.totemEtiqueta.deleteMany({ where: { orgId } });
    await prisma.totemReposicao.deleteMany({ where: { orgId } });
    await prisma.totemRemessaItem.deleteMany({ where: { orgId } });
    await prisma.totemRemessa.deleteMany({ where: { orgId } });
    await prisma.totemLote.deleteMany({ where: { orgId } });
    await prisma.totemUsuarioLoja.deleteMany({ where: { orgId } });
    await prisma.totemConfig.deleteMany({ where: { orgId } });
    await prisma.totemProduto.deleteMany({ where: { orgId } });
    await prisma.totemLoja.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { orgId } });
    await prisma.org.deleteMany({ where: { id: orgId } });
  }

  async function lote(nome: string, produtoId: string, validade: string): Promise<string> {
    const l = await prisma.totemLote.create({
      data: { orgId: ORG, produtoId, codigo: nome, fabricadoEm: dia('2026-09-01'), validadeEm: dia(validade) },
    });
    lotes[nome] = l.id;
    return l.id;
  }

  async function remessa(
    lojaId: string,
    status: 'enviada' | 'recebida' | 'cancelada',
    enviadaEm: string,
    recebidaEm: string | null,
    itens: Array<[produtoId: string, loteId: string]>,
  ): Promise<string> {
    const r = await prisma.totemRemessa.create({
      data: {
        orgId: ORG,
        lojaId,
        status,
        enviadaEm: new Date(enviadaEm),
        recebidaEm: recebidaEm ? new Date(recebidaEm) : null,
        itens: { create: itens.map(([produtoId, loteId]) => ({ orgId: ORG, produtoId, loteId })) },
      },
    });
    return r.id;
  }

  beforeAll(async () => {
    await limpar();
    await prisma.org.create({ data: { id: ORG, name: 'Empresa do teste de lote', slug: ORG, modulos: ['totem'] } });
    await prisma.org.create({ data: { id: SEM_MODULO, name: 'Empresa sem totem', slug: SEM_MODULO, modulos: [] } });
    for (const [id, nome] of [[ids.gerente, 'Gerente da loja 1'], [ids.rede, 'Rede']] as const) {
      await prisma.user.create({ data: { id, orgId: ORG, name: nome, email: `${id}@teste.local`, passwordHash: 'x' } });
    }
    const loja1 = await prisma.totemLoja.create({ data: { orgId: ORG, codigo: 'L1', nome: 'Loja Centro', cidade: 'Campo Bom' } });
    const loja2 = await prisma.totemLoja.create({ data: { orgId: ORG, codigo: 'L2', nome: 'Loja Bairro' } });
    ids.loja1 = loja1.id;
    ids.loja2 = loja2.id;
    await prisma.totemUsuarioLoja.create({ data: { orgId: ORG, userId: ids.gerente, lojaId: loja1.id } });

    for (const n of [1, 2, 3, 4, 5] as const) {
      const p = await prisma.totemProduto.create({
        data: {
          orgId: ORG,
          codigo: `P${n}`,
          nome: `Produto ${n}`,
          nomeBusca: `produto ${n}`,
          precoCentavos: 1000 * n,
          unidadePreco: 'kg',
          validadeDiasPadrao: 90,
        },
      });
      ids[`p${n}`] = p.id;
    }

    // P1 na loja 1: duas reposições (a mais nova vence) e remessas mais novas que elas.
    await lote('P1-A', ids.p1, '2026-12-01');
    await lote('P1-B', ids.p1, '2026-11-01');
    await lote('P1-C', ids.p1, '2027-01-01');
    await prisma.totemReposicao.createMany({
      data: [
        { orgId: ORG, lojaId: ids.loja1, produtoId: ids.p1, loteId: lotes['P1-B'], repostoEm: new Date('2026-10-02T12:00:00Z'), origem: 'manual' },
        { orgId: ORG, lojaId: ids.loja1, produtoId: ids.p1, loteId: lotes['P1-A'], repostoEm: new Date('2026-10-03T12:00:00Z'), origem: 'remessa' },
      ],
    });
    await remessa(ids.loja1, 'recebida', '2026-10-04T08:00:00Z', '2026-10-05T09:00:00Z', [[ids.p1, lotes['P1-B']]]);
    await remessa(ids.loja1, 'enviada', '2026-10-06T08:00:00Z', null, [[ids.p1, lotes['P1-C']]]);

    // P2 na loja 1: uma recebida e uma enviada mais nova; a recebida vence.
    await lote('P2-D', ids.p2, '2026-11-15');
    await lote('P2-E', ids.p2, '2026-12-15');
    await remessa(ids.loja1, 'recebida', '2026-10-03T08:00:00Z', '2026-10-04T10:30:00Z', [[ids.p2, lotes['P2-D']]]);
    await remessa(ids.loja1, 'enviada', '2026-10-07T08:00:00Z', null, [[ids.p2, lotes['P2-E']]]);

    // P3 na loja 1: só a enviada, ainda não confirmada.
    await lote('P3-F', ids.p3, '2026-10-20');
    await remessa(ids.loja1, 'enviada', '2026-10-08T08:00:00Z', null, [[ids.p3, lotes['P3-F']]]);

    // P4: só uma remessa cancelada, que não conta.
    await lote('P4-H', ids.p4, '2026-11-30');
    await remessa(ids.loja1, 'cancelada', '2026-10-08T08:00:00Z', null, [[ids.p4, lotes['P4-H']]]);

    // Loja 2: o P1 dela é outro lote.
    await lote('P1-G', ids.p1, '2026-11-20');
    await prisma.totemReposicao.create({
      data: { orgId: ORG, lojaId: ids.loja2, produtoId: ids.p1, loteId: lotes['P1-G'], repostoEm: new Date('2026-10-01T12:00:00Z'), origem: 'manual' },
    });
  });

  afterAll(async () => {
    await limpar();
    await prisma.$disconnect();
  });

  describe('o lote vigente (seção 4 do contrato)', () => {
    it('reposição vence remessa, e entre reposições vence a mais nova', async () => {
      const v = (await loteVigentePorProduto(prisma, ids.loja1, [ids.p1])).get(ids.p1);
      expect(v).toMatchObject({
        loteId: lotes['P1-A'],
        codigo: 'P1-A',
        presumido: false,
        origem: 'producao_central',
      });
      expect(v?.repostoEm.toISOString()).toBe('2026-10-03T12:00:00.000Z');
      expect(v?.validadeEm.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    });

    it('sem reposição, a remessa recebida vence a enviada, com a data do recebimento', async () => {
      const v = (await loteVigentePorProduto(prisma, ids.loja1, [ids.p2])).get(ids.p2);
      expect(v).toMatchObject({ loteId: lotes['P2-D'], presumido: false });
      expect(v?.repostoEm.toISOString()).toBe('2026-10-04T10:30:00.000Z');
    });

    it('só com a remessa enviada, o lote é presumido e a data é a do envio', async () => {
      const v = (await loteVigentePorProduto(prisma, ids.loja1, [ids.p3])).get(ids.p3);
      expect(v).toMatchObject({ loteId: lotes['P3-F'], presumido: true });
      expect(v?.repostoEm.toISOString()).toBe('2026-10-08T08:00:00.000Z');
    });

    it('produto sem lote (ou só com remessa cancelada) fica fora do mapa', async () => {
      const mapa = await loteVigentePorProduto(prisma, ids.loja1, [ids.p4, ids.p5]);
      expect(mapa.size).toBe(0);
    });

    it('sem lista, devolve todo produto com lote na loja; lista vazia devolve nada', async () => {
      const todos = await loteVigentePorProduto(prisma, ids.loja1);
      expect([...todos.keys()].sort()).toEqual([ids.p1, ids.p2, ids.p3].sort());
      expect((await loteVigentePorProduto(prisma, ids.loja1, [])).size).toBe(0);
    });

    it('duas lojas não se misturam', async () => {
      const loja2 = await loteVigentePorProduto(prisma, ids.loja2);
      expect([...loja2.keys()]).toEqual([ids.p1]);
      expect(loja2.get(ids.p1)?.loteId).toBe(lotes['P1-G']);
      const loja1 = await loteVigentePorProduto(prisma, ids.loja1, [ids.p1]);
      expect(loja1.get(ids.p1)?.loteId).toBe(lotes['P1-A']);
    });
  });

  describe('a remessa no escopo da loja', () => {
    it('o gerente da loja 1 não confirma a remessa da loja 2, e ela continua enviada', async () => {
      await lote('P5-J', ids.p5, '2026-12-10');
      const daOutra = await remessa(ids.loja2, 'enviada', '2026-10-09T08:00:00Z', null, [[ids.p5, lotes['P5-J']]]);
      await expect(receberRemessa(prisma, gerente(), daOutra, {})).rejects.toBeInstanceOf(NotFoundException);
      const depois = await prisma.totemRemessa.findFirstOrThrow({ where: { id: daOutra, orgId: ORG } });
      expect(depois.status).toBe('enviada');
      expect(depois.recebidaEm).toBeNull();
    });

    it('o gerente confirma a da própria loja, e o recebimento com reposição passa a mandar no lote vigente', async () => {
      const daLoja = await remessa(ids.loja1, 'enviada', '2026-10-09T08:00:00Z', null, [[ids.p5, lotes['P5-J']]]);
      const agora = new Date('2026-10-10T14:00:00.000Z');
      const r = await receberRemessa(prisma, gerente(), daLoja, { registrarReposicao: true }, agora);
      expect(r.status).toBe('recebida');
      const v = (await loteVigentePorProduto(prisma, ids.loja1, [ids.p5])).get(ids.p5);
      expect(v).toMatchObject({ loteId: lotes['P5-J'], presumido: false });
      expect(v?.repostoEm.toISOString()).toBe(agora.toISOString());
      await expect(receberRemessa(prisma, gerente(), daLoja, {})).rejects.toThrow('Esta remessa já foi recebida.');
    });

    it('a reposição com lote manual da loja vira o lote vigente dela, com origem manual_loja', async () => {
      await registrarReposicao(
        prisma,
        rede(),
        { lojaId: ids.loja2, produtoId: ids.p2, loteManual: { codigo: 'MAN-01', validadeEm: '2026-11-11' } },
        new Date('2026-10-10T16:00:00.000Z'),
      );
      const v = (await loteVigentePorProduto(prisma, ids.loja2, [ids.p2])).get(ids.p2);
      expect(v).toMatchObject({ codigo: 'MAN-01', origem: 'manual_loja', presumido: false });
      const manual = await prisma.totemLote.findFirstOrThrow({ where: { orgId: ORG, codigo: 'MAN-01' } });
      expect(manual.lojaOrigemId).toBe(ids.loja2);
    });
  });

  describe('a etiqueta pública', () => {
    const agora = new Date('2026-10-11T15:00:00.000Z');

    it('gera códigos no formato da rota, e a ficha mostra o lote vigente sem preço', async () => {
      const geradas = await gerarEtiquetas(prisma, gerente(), { lojaId: ids.loja1, produtoId: ids.p1, quantidade: 3 });
      expect(geradas).toHaveLength(3);
      expect(new Set(geradas.map((e) => e.codigo)).size).toBe(3);
      for (const e of geradas) expect(TotemCodigoEtiquetaSchema.parse(e.codigo)).toBe(e.codigo);

      const ficha = await fichaDaEtiqueta(prisma, geradas[0].codigo, agora);
      expect(ficha.produto.nome).toBe('Produto 1');
      expect(ficha.produto).not.toHaveProperty('precoCentavos');
      expect(ficha.lote).toMatchObject({ codigo: 'P1-A', presumido: false, situacao: 'ok' });
      expect(ficha.config.nomeExibicao).toBe('Empresa do teste de lote');
      expect(ficha.loja).toEqual({ nome: 'Loja Centro', cidade: 'Campo Bom' });

      const abertos = await prisma.totemEvento.count({ where: { orgId: ORG, tipo: 'qr_aberto', produtoId: ids.p1 } });
      expect(abertos).toBe(1);
    });

    it('com o preço ligado na configuração, a ficha leva o preço', async () => {
      await prisma.totemConfig.create({
        data: {
          orgId: ORG,
          nomeExibicao: 'Sr. Teste',
          corPrimaria: '#28371D',
          corFundo: '#F5F3EC',
          precoLigado: true,
          cadastroLigado: false,
          controladorNome: 'Empresa do teste de lote',
          politicaVersao: '1',
        },
      });
      const [e] = await gerarEtiquetas(prisma, rede(), { lojaId: ids.loja2, produtoId: ids.p1, loteId: lotes['P1-G'], quantidade: 1 });
      const ficha = await fichaDaEtiqueta(prisma, e.codigo, agora);
      expect(ficha.produto.precoCentavos).toBe(1000);
      expect(ficha.config.nomeExibicao).toBe('Sr. Teste');
      expect(ficha.lote).toMatchObject({ codigo: 'P1-G', presumido: false });
      await prisma.totemConfig.update({ where: { orgId: ORG }, data: { precoLigado: false } });
      const semPreco = await fichaDaEtiqueta(prisma, e.codigo, agora);
      expect(semPreco.produto).not.toHaveProperty('precoCentavos');
    });

    it('etiqueta revogada responde 404 e não conta abertura', async () => {
      const [e] = await gerarEtiquetas(prisma, gerente(), { lojaId: ids.loja1, produtoId: ids.p3, quantidade: 1 });
      await fichaDaEtiqueta(prisma, e.codigo, agora);
      await revogarEtiqueta(prisma, gerente(), e.id, agora);
      const antes = await prisma.totemEvento.count({ where: { orgId: ORG, tipo: 'qr_aberto', produtoId: ids.p3 } });
      await expect(fichaDaEtiqueta(prisma, e.codigo, agora)).rejects.toBeInstanceOf(NotFoundException);
      const depois = await prisma.totemEvento.count({ where: { orgId: ORG, tipo: 'qr_aberto', produtoId: ids.p3 } });
      expect(depois).toBe(antes);
    });

    it('loja desativada fecha a ficha das etiquetas dela com a mesma 404', async () => {
      const [e] = await gerarEtiquetas(prisma, gerente(), { lojaId: ids.loja1, produtoId: ids.p3, quantidade: 1 });
      await fichaDaEtiqueta(prisma, e.codigo, agora);
      await prisma.totemLoja.update({ where: { id: ids.loja1 }, data: { ativa: false } });
      try {
        await expect(fichaDaEtiqueta(prisma, e.codigo, agora)).rejects.toBeInstanceOf(NotFoundException);
      } finally {
        await prisma.totemLoja.update({ where: { id: ids.loja1 }, data: { ativa: true } });
      }
      await expect(fichaDaEtiqueta(prisma, e.codigo, agora)).resolves.toBeTruthy();
    });

    it('código que não existe e empresa sem o módulo respondem a mesma 404', async () => {
      await expect(fichaDaEtiqueta(prisma, 'ZZZZZZZZZZ', agora)).rejects.toBeInstanceOf(NotFoundException);
      const loja = await prisma.totemLoja.create({ data: { orgId: SEM_MODULO, codigo: 'X', nome: 'Loja X' } });
      const produto = await prisma.totemProduto.create({
        data: { orgId: SEM_MODULO, codigo: 'X', nome: 'Produto X', nomeBusca: 'produto x' },
      });
      const etiqueta = await prisma.totemEtiqueta.create({
        data: { orgId: SEM_MODULO, lojaId: loja.id, produtoId: produto.id, codigo: 'SEMMODULO1' },
      });
      await expect(fichaDaEtiqueta(prisma, etiqueta.codigo, agora)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('o gerente não gera etiqueta para a loja de que não é gerente', async () => {
      await expect(
        gerarEtiquetas(prisma, gerente(), { lojaId: ids.loja2, produtoId: ids.p1, quantidade: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
