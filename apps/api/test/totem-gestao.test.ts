import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  TOTEM_ALFABETO_CROCKFORD,
  TOTEM_GESTAO_AVISO_PRECO_DESLIGADO,
  TotemGestaoConfigSchema,
  TotemGestaoEventosQuerySchema,
  TotemGestaoLojaCriarSchema,
  TotemGestaoProdutoCriarSchema,
  TotemGestaoProdutoEditarSchema,
  TotemGestaoProdutosQuerySchema,
  totemNormalizarCodigo,
} from '@mktos/shared';

import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { PermissionsGuard } from '../src/auth/permissions.guard';
import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import { hashToken } from '../src/totem/comum/segredos';
import type { TotemLoteVigente } from '../src/totem/lote/lote-vigente';
import { totemGestaoPeriodoDosEventos } from '../src/totem/gestao/eventos';
import {
  totemGestaoAvisoDePreco,
  totemGestaoDadosDoProduto,
  totemGestaoDiaEmSaoPaulo,
  totemGestaoEstadoDoDispositivo,
  totemGestaoExpiracaoPendente,
  totemGestaoHojeParaValidade,
  totemGestaoNovoCodigoDeAtivacao,
  totemGestaoPalavrasDaBusca,
  totemGestaoProblemaDePreco,
  totemGestaoProdutoParaTela,
} from '../src/totem/gestao/regras';
import {
  totemGestaoMontarResumo,
  totemGestaoTopTermos,
  type TotemGestaoEntradaDoResumo,
} from '../src/totem/gestao/resumo';
import { TotemGestaoDispositivosController } from '../src/totem/gestao/totem-gestao-dispositivos.controller';
import { TotemGestaoLojasController } from '../src/totem/gestao/totem-gestao-lojas.controller';
import { TotemGestaoProdutosController } from '../src/totem/gestao/totem-gestao-produtos.controller';
import { TotemGestaoController } from '../src/totem/gestao/totem-gestao.controller';

/*
 * O PAINEL DO TOTEM (frente A) — as regras sem banco e sem Nest.
 *
 * O escopo de lojas e o hash no banco de verdade estão em
 * `totem-gestao-banco.test.ts`; aqui ficam as contas que decidem o que a tela
 * mostra: estado do totem, código de ativação, `nomeBusca`, aviso de preço e a
 * montagem do resumo.
 */

const AGORA = new Date('2026-10-11T15:00:00.000Z'); // 12h em São Paulo

describe('nomeBusca e dados do produto', () => {
  it('nomeBusca acompanha o nome sem acento, sem caixa e sem pontuação', () => {
    const d = totemGestaoDadosDoProduto({ nome: 'Castanha-do-Pará  Torrada' });
    expect(d.nome).toBe('Castanha-do-Pará  Torrada');
    expect(d.nomeBusca).toBe('castanha do para torrada');
  });

  it('sem nome na edição, nomeBusca não é tocado e campo ausente não vira null', () => {
    const d = totemGestaoDadosDoProduto({ precoCentavos: 1290, unidadePreco: 'kg' });
    expect(d).toEqual({ precoCentavos: 1290, unidadePreco: 'kg' });
    expect('nomeBusca' in d).toBe(false);
  });

  it('null explícito passa, para apagar o campo', () => {
    expect(totemGestaoDadosDoProduto({ precoCentavos: null })).toEqual({ precoCentavos: null });
  });

  it('a busca separa as palavras normalizadas, sem repetir', () => {
    expect(totemGestaoPalavrasDaBusca('  Pará castanha PARA ')).toEqual(['para', 'castanha']);
    expect(totemGestaoPalavrasDaBusca('')).toEqual([]);
    expect(totemGestaoPalavrasDaBusca(undefined)).toEqual([]);
    expect(totemGestaoPalavrasDaBusca('!!!')).toEqual([]);
  });

  it('preço sem unidade é recusado; preço com unidade ou sem preço passa', () => {
    expect(totemGestaoProblemaDePreco(1290, null)).toMatch(/unidade/);
    expect(totemGestaoProblemaDePreco(1290, 'kg')).toBeNull();
    expect(totemGestaoProblemaDePreco(null, null)).toBeNull();
    expect(totemGestaoProblemaDePreco(0, '100g')).toBeNull();
  });

  it('o produto do banco vira o da tela com Decimal em número e ficha inválida em lista vazia', () => {
    const tela = totemGestaoProdutoParaTela({
      id: 'p1',
      codigo: 'C1',
      codigoDirector: null,
      nome: 'Aveia',
      nomeBusca: 'aveia',
      categoria: null,
      composicao: null,
      beneficios: null,
      alergenicos: null,
      porcaoG: 30,
      porcaoDescricao: null,
      nutricional: { lixo: true },
      selos: ['vegano', 'selo-que-nao-existe'],
      validadeDiasPadrao: null,
      precoCentavos: null,
      unidadePreco: 'litro',
      imagemUrl: null,
      ativo: true,
      exemplo: false,
      fonteNutricional: null,
      atualizadoEm: AGORA,
    });
    expect(tela.porcaoG).toBe(30);
    expect(tela.nutricional).toEqual([]);
    expect(tela.selos).toEqual(['vegano']);
    expect(tela.unidadePreco).toBeNull();
  });
});

describe('aviso de preço', () => {
  it('com o preço desligado, a resposta leva o aviso; ligado, não', () => {
    expect(totemGestaoAvisoDePreco(false)).toEqual({ precoLigado: false, avisoPreco: TOTEM_GESTAO_AVISO_PRECO_DESLIGADO });
    expect(totemGestaoAvisoDePreco(true)).toEqual({ precoLigado: true, avisoPreco: null });
    expect(TOTEM_GESTAO_AVISO_PRECO_DESLIGADO).toMatch(/não aparece no totem/);
  });
});

describe('estado do totem', () => {
  const base = { ativadoEm: null, revogadoEm: null, vistoEm: null, codigoAtivacaoHash: null, ativacaoExpiraEm: null };
  const minutos = (n: number) => new Date(AGORA.getTime() + n * 60_000);

  it('ligado se foi visto há menos de 10 minutos; sem sinal a partir daí', () => {
    const ativado = { ...base, ativadoEm: minutos(-600) };
    expect(totemGestaoEstadoDoDispositivo({ ...ativado, vistoEm: minutos(-9) }, AGORA)).toBe('online');
    expect(totemGestaoEstadoDoDispositivo({ ...ativado, vistoEm: minutos(-10) }, AGORA)).toBe('offline');
    expect(totemGestaoEstadoDoDispositivo(ativado, AGORA)).toBe('offline');
  });

  it('revogado vence qualquer outro estado', () => {
    expect(
      totemGestaoEstadoDoDispositivo({ ...base, ativadoEm: minutos(-60), vistoEm: minutos(-1), revogadoEm: minutos(-1) }, AGORA),
    ).toBe('revogado');
  });

  it('código pendente aguarda até vencer; depois aparece como vencido e some da expiração', () => {
    const pendente = { ...base, codigoAtivacaoHash: 'h', ativacaoExpiraEm: minutos(30) };
    expect(totemGestaoEstadoDoDispositivo(pendente, AGORA)).toBe('aguardando_ativacao');
    expect(totemGestaoExpiracaoPendente(pendente, AGORA)).toEqual(minutos(30));
    expect(totemGestaoEstadoDoDispositivo(pendente, minutos(30))).toBe('codigo_expirado');
    expect(totemGestaoExpiracaoPendente(pendente, minutos(31))).toBeNull();
  });

  it('totem ativado com código novo pendente continua ligado', () => {
    const d = { ...base, ativadoEm: minutos(-60), vistoEm: minutos(-2), codigoAtivacaoHash: 'h', ativacaoExpiraEm: minutos(20) };
    expect(totemGestaoEstadoDoDispositivo(d, AGORA)).toBe('online');
    expect(totemGestaoExpiracaoPendente(d, AGORA)).toEqual(minutos(20));
  });
});

describe('código de ativação', () => {
  it('8 caracteres Crockford, hash do código normalizado e validade de 30 minutos', () => {
    const novo = totemGestaoNovoCodigoDeAtivacao(AGORA);
    expect(novo.codigo).toHaveLength(8);
    for (const c of novo.codigo) expect(TOTEM_ALFABETO_CROCKFORD).toContain(c);
    expect(novo.hash).toBe(hashToken(totemNormalizarCodigo(novo.codigo)));
    expect(novo.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(novo.hash).not.toContain(novo.codigo);
    expect(novo.expiraEm.getTime() - AGORA.getTime()).toBe(30 * 60_000);
  });

  it('o que a pessoa digita no totem, em minúsculas e com hífen, cai no mesmo hash', () => {
    const novo = totemGestaoNovoCodigoDeAtivacao(AGORA);
    const digitado = `${novo.codigo.slice(0, 4).toLowerCase()}-${novo.codigo.slice(4).toLowerCase()}`;
    expect(hashToken(totemNormalizarCodigo(digitado))).toBe(novo.hash);
  });

  it('dois códigos seguidos não se repetem', () => {
    const vistos = new Set(Array.from({ length: 50 }, () => totemGestaoNovoCodigoDeAtivacao(AGORA).codigo));
    expect(vistos.size).toBe(50);
  });
});

describe('dia em São Paulo', () => {
  it('às 22h de São Paulo ainda é hoje lá, embora já seja amanhã em UTC', () => {
    const noite = new Date('2026-10-12T01:00:00.000Z');
    expect(totemGestaoDiaEmSaoPaulo(noite)).toBe('2026-10-11');
    expect(totemGestaoHojeParaValidade(noite).toISOString()).toBe('2026-10-11T00:00:00.000Z');
  });

  it('o período de eventos inclui o dia final inteiro, no fuso de São Paulo', () => {
    expect(totemGestaoPeriodoDosEventos('2026-10-01', '2026-10-03')).toEqual({
      gte: new Date('2026-10-01T03:00:00.000Z'),
      lt: new Date('2026-10-04T03:00:00.000Z'),
    });
    expect(totemGestaoPeriodoDosEventos(undefined, undefined)).toBeUndefined();
  });
});

describe('montagem do resumo', () => {
  const lojas = [
    { id: 'l1', codigo: 'L1', nome: 'Centro', ativa: true },
    { id: 'l2', codigo: 'L2', nome: 'Bairro', ativa: true },
  ];
  const produtos = [
    { id: 'p1', nome: 'Aveia' },
    { id: 'p2', nome: 'Castanha' },
    { id: 'p3', nome: 'Granola' },
  ];
  const lote = (codigo: string, validade: string, presumido = false): TotemLoteVigente => ({
    loteId: `lote-${codigo}`,
    codigo,
    fabricadoEm: null,
    validadeEm: new Date(`${validade}T00:00:00.000Z`),
    repostoEm: AGORA,
    presumido,
    origem: 'producao_central',
  });
  const entrada = (extra: Partial<TotemGestaoEntradaDoResumo> = {}): TotemGestaoEntradaDoResumo => ({
    agora: AGORA,
    redeInteira: true,
    lojaFiltrada: null,
    lojasDoEscopo: lojas,
    lojas,
    dispositivos: [],
    buscasHoje: [],
    buscas7Dias: [],
    cadastrosHoje: [],
    termosSemResultado: [],
    produtos,
    lotes: new Map(),
    ...extra,
  });

  it('com o mapa de lotes vazio (o stub de hoje), todo produto ativo conta como sem lote e nada quebra', () => {
    const r = totemGestaoMontarResumo(entrada());
    expect(r.total.produtosSemLote).toBe(6);
    expect(r.total.lotesVencidos).toBe(0);
    expect(r.total.lotesAVencer).toBe(0);
    expect(r.porLoja.map((l) => l.indicadores.produtosSemLote)).toEqual([3, 3]);
    expect(r.produtosSemLote[0]).toEqual({ lojaId: 'l1', lojaNome: 'Centro', produtoId: 'p1', produtoNome: 'Aveia' });
  });

  it('separa vencido, a vencer em até 15 dias e ok, e soma a rede', () => {
    const r = totemGestaoMontarResumo(
      entrada({
        lotes: new Map([
          [
            'l1',
            new Map([
              ['p1', lote('A', '2026-10-10')],
              ['p2', lote('B', '2026-10-26', true)],
              ['p3', lote('C', '2026-10-27')],
            ]),
          ],
          ['l2', new Map([['p1', lote('D', '2026-10-11')]])],
        ]),
      }),
    );
    const l1 = r.porLoja.find((l) => l.lojaId === 'l1')!.indicadores;
    expect(l1.lotesVencidos).toBe(1);
    expect(l1.lotesAVencer).toBe(1);
    expect(l1.produtosSemLote).toBe(0);
    const l2 = r.porLoja.find((l) => l.lojaId === 'l2')!.indicadores;
    expect(l2.lotesAVencer).toBe(1);
    expect(l2.produtosSemLote).toBe(2);
    expect(r.total).toMatchObject({ lotesVencidos: 1, lotesAVencer: 2, produtosSemLote: 2 });
    expect(r.lotesVencidos.map((a) => a.loteCodigo)).toEqual(['A']);
    expect(r.lotesAVencer.map((a) => [a.loteCodigo, a.validadeEm, a.presumido])).toEqual([
      ['D', '2026-10-11', false],
      ['B', '2026-10-26', true],
    ]);
  });

  it('conta totens por estado, guarda a última sincronização e ignora a de totem revogado', () => {
    const r = totemGestaoMontarResumo(
      entrada({
        dispositivos: [
          { lojaId: 'l1', ativadoEm: AGORA, revogadoEm: null, vistoEm: new Date(AGORA.getTime() - 60_000), codigoAtivacaoHash: null, ativacaoExpiraEm: null },
          { lojaId: 'l1', ativadoEm: AGORA, revogadoEm: null, vistoEm: new Date(AGORA.getTime() - 3_600_000), codigoAtivacaoHash: null, ativacaoExpiraEm: null },
          { lojaId: 'l2', ativadoEm: null, revogadoEm: null, vistoEm: null, codigoAtivacaoHash: 'h', ativacaoExpiraEm: new Date(AGORA.getTime() + 60_000) },
          { lojaId: 'l2', ativadoEm: AGORA, revogadoEm: AGORA, vistoEm: AGORA, codigoAtivacaoHash: null, ativacaoExpiraEm: null },
        ],
      }),
    );
    expect(r.porLoja[0]!.indicadores).toMatchObject({ totensOnline: 1, totensOffline: 1, totensAguardando: 0 });
    expect(r.porLoja[0]!.indicadores.ultimaSincronizacao).toBe(new Date(AGORA.getTime() - 60_000).toISOString());
    expect(r.porLoja[1]!.indicadores).toMatchObject({ totensOnline: 0, totensOffline: 0, totensAguardando: 1, ultimaSincronizacao: null });
    expect(r.total).toMatchObject({ totensOnline: 1, totensOffline: 1, totensAguardando: 1 });
  });

  it('buscas e cadastros entram por loja; linha sem loja não soma em loja nenhuma', () => {
    const r = totemGestaoMontarResumo(
      entrada({
        buscasHoje: [
          { lojaId: 'l1', quantidade: 4 },
          { lojaId: null, quantidade: 99 },
        ],
        buscas7Dias: [
          { lojaId: 'l1', quantidade: 10 },
          { lojaId: 'l2', quantidade: 5 },
        ],
        cadastrosHoje: [{ lojaId: 'l2', quantidade: 2 }],
      }),
    );
    expect(r.porLoja.map((l) => [l.indicadores.buscasHoje, l.indicadores.buscas7Dias, l.indicadores.cadastrosHoje])).toEqual([
      [4, 10, 0],
      [0, 5, 2],
    ]);
    expect(r.total).toMatchObject({ buscasHoje: 4, buscas7Dias: 15, cadastrosHoje: 2 });
  });

  it('os termos sem resultado se juntam pela forma normalizada e saem os 10 mais buscados', () => {
    const termos = [
      { termo: 'Açaí', vezes: 3 },
      { termo: 'acai', vezes: 2 },
      { termo: null, vezes: 50 },
      { termo: '   ', vezes: 40 },
      ...Array.from({ length: 12 }, (_, i) => ({ termo: `termo ${String(i).padStart(2, '0')}`, vezes: 1 })),
    ];
    const top = totemGestaoTopTermos(termos);
    expect(top).toHaveLength(10);
    expect(top[0]).toEqual({ termo: 'acai', vezes: 5 });
    expect(top[1]).toEqual({ termo: 'termo 00', vezes: 1 });
  });

  it('o filtro por loja aparece no resumo e as lojas do escopo vão para o seletor', () => {
    const r = totemGestaoMontarResumo(entrada({ redeInteira: false, lojaFiltrada: 'l2', lojas: [lojas[1]!] }));
    expect(r.lojaFiltrada).toBe('l2');
    expect(r.redeInteira).toBe(false);
    expect(r.porLoja.map((l) => l.lojaId)).toEqual(['l2']);
    expect(r.lojasDoEscopo.map((l) => l.id)).toEqual(['l1', 'l2']);
  });
});

describe('validação das entradas', () => {
  it('código de loja vira maiúsculo e recusa espaço', () => {
    expect(TotemGestaoLojaCriarSchema.parse({ codigo: 'cb-01', nome: 'Campo Bom' }).codigo).toBe('CB-01');
    expect(TotemGestaoLojaCriarSchema.safeParse({ codigo: 'cb 01', nome: 'Campo Bom' }).success).toBe(false);
  });

  it('produto recusa preço negativo ou quebrado e edição vazia', () => {
    const base = { codigo: 'A1', nome: 'Aveia' };
    expect(TotemGestaoProdutoCriarSchema.safeParse({ ...base, precoCentavos: -1 }).success).toBe(false);
    expect(TotemGestaoProdutoCriarSchema.safeParse({ ...base, precoCentavos: 12.5 }).success).toBe(false);
    expect(TotemGestaoProdutoEditarSchema.safeParse({}).success).toBe(false);
  });

  it('a paginação de produtos tem teto', () => {
    expect(TotemGestaoProdutosQuerySchema.safeParse({ porPagina: '500' }).success).toBe(false);
    expect(TotemGestaoProdutosQuerySchema.parse({ pagina: '2' })).toMatchObject({ pagina: 2, porPagina: 25 });
  });

  it('eventos recusam período invertido', () => {
    expect(TotemGestaoEventosQuerySchema.safeParse({ de: '2026-10-05', ate: '2026-10-01' }).success).toBe(false);
  });

  it('configuração recusa cor fora de #RRGGBB, logo sem https e tempo ocioso fora da faixa', () => {
    const ok = {
      nomeExibicao: 'Sr. aGranel',
      corPrimaria: '#28371d',
      corFundo: '#F5F3EC',
      precoLigado: false,
      cadastroLigado: true,
      tempoOciosoSeg: 60,
      controladorNome: 'Sr. aGranel Ltda',
    };
    expect(TotemGestaoConfigSchema.parse(ok).corPrimaria).toBe('#28371D');
    expect(TotemGestaoConfigSchema.safeParse({ ...ok, corFundo: 'verde' }).success).toBe(false);
    expect(TotemGestaoConfigSchema.safeParse({ ...ok, logoUrl: 'http://x.com/a.png' }).success).toBe(false);
    expect(TotemGestaoConfigSchema.safeParse({ ...ok, tempoOciosoSeg: 5 }).success).toBe(false);
  });
});

describe('guardas e permissões das rotas', () => {
  const permissao = (c: { prototype: object }, metodo: string) =>
    Reflect.getMetadata(PERMISSIONS_KEY, (c.prototype as Record<string, unknown>)[metodo] as object);

  it('todo controller do painel exige JWT e permissão', () => {
    for (const c of [
      TotemGestaoController,
      TotemGestaoLojasController,
      TotemGestaoDispositivosController,
      TotemGestaoProdutosController,
    ]) {
      expect(Reflect.getMetadata('path', c)).toBe('totem-gestao');
      expect(Reflect.getMetadata(GUARDS_METADATA, c)).toEqual([JwtAuthGuard, PermissionsGuard]);
    }
  });

  it('ler pede totem.ver; mexer em loja, vínculo e configuração pede totem.lojas', () => {
    expect(permissao(TotemGestaoController, 'resumo')).toEqual(['totem.ver']);
    expect(permissao(TotemGestaoController, 'eventos')).toEqual(['totem.ver']);
    expect(permissao(TotemGestaoLojasController, 'lojas')).toEqual(['totem.ver']);
    for (const m of ['criarLoja', 'editarLoja', 'usuarios', 'vincular', 'desvincular']) {
      expect(permissao(TotemGestaoLojasController, m), m).toEqual(['totem.lojas']);
    }
    expect(permissao(TotemGestaoProdutosController, 'configuracao')).toEqual(['totem.ver']);
    expect(permissao(TotemGestaoProdutosController, 'salvarConfiguracao')).toEqual(['totem.lojas']);
  });

  it('totens pedem totem.dispositivos; escrever produto pede totem.produtos', () => {
    for (const m of ['dispositivos', 'criar', 'novoCodigo', 'renomear', 'revogar']) {
      expect(permissao(TotemGestaoDispositivosController, m), m).toEqual(['totem.dispositivos']);
    }
    expect(permissao(TotemGestaoProdutosController, 'produtos')).toEqual(['totem.ver']);
    expect(permissao(TotemGestaoProdutosController, 'produto')).toEqual(['totem.ver']);
    expect(permissao(TotemGestaoProdutosController, 'criarProduto')).toEqual(['totem.produtos']);
    expect(permissao(TotemGestaoProdutosController, 'editarProduto')).toEqual(['totem.produtos']);
  });
});
