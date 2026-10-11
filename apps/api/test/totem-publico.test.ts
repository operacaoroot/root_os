import { describe, expect, it } from 'vitest';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import {
  TOTEM_EVENTOS_POR_LOTE,
  TotemAtivarSchema,
  TotemBatimentoSchema,
  TotemCatalogoSchema,
  TotemEventosQuiosqueSchema,
  totemLimparTermo,
} from '@mktos/shared';

import type { TotemLoteVigente } from '../src/totem/lote/lote-vigente';
import {
  campanhaDaLoja,
  etagCasa,
  montarCatalogo,
  type CampanhaDoCatalogo,
  type ConfigDoCatalogo,
  type DadosDoCatalogo,
  type ProdutoDoCatalogo,
} from '../src/totem/publico/catalogo';
import { linhasDeEventos } from '../src/totem/publico/eventos';
import { TotemPublicoController } from '../src/totem/publico/totem-publico.controller';
import { TOTEM_REATIVAR, type TotemPublicoService } from '../src/totem/publico/totem-publico.service';

/*
 * MÓDULO TOTEM — O QUIOSQUE (frente B, CONTRATO.md, seções 4, 6 e 7).
 *
 * Sem banco e sem Nest: o retrato do catálogo é função pura, o lote de eventos
 * também, e o controller é montado à mão com um serviço falso para conferir a
 * ordem das conferências e o 304. O caminho no banco está em
 * `totem-publico-banco.test.ts`.
 */

const AGORA = new Date('2026-10-11T15:00:00.000Z');
const dia = (n: number) => new Date(AGORA.getTime() + n * 86_400_000);

function produto(parcial: Partial<ProdutoDoCatalogo> & { id: string; nome: string }): ProdutoDoCatalogo {
  return {
    codigo: parcial.id.toUpperCase(),
    nomeBusca: parcial.nome.toLowerCase(),
    categoria: 'Castanhas',
    composicao: null,
    beneficios: null,
    alergenicos: null,
    porcaoG: 30,
    porcaoDescricao: '1 colher de sopa',
    nutricional: [{ nutriente: 'Valor energético', quantidade: 643, unidade: 'kcal', vd: 32 }],
    selos: ['vegano'],
    imagemUrl: null,
    fonteNutricional: 'TACO 4ª edição',
    precoCentavos: 8990,
    unidadePreco: 'kg',
    ativo: true,
    ...parcial,
  };
}

function lote(parcial: Partial<TotemLoteVigente> = {}): TotemLoteVigente {
  return {
    loteId: 'lote-1',
    codigo: 'L2026-10',
    fabricadoEm: dia(-5),
    validadeEm: dia(120),
    repostoEm: dia(-2),
    presumido: false,
    origem: 'producao_central',
    ...parcial,
  };
}

const CONFIG: ConfigDoCatalogo = {
  nomeExibicao: 'Senhor aGranel',
  corPrimaria: '#28371D',
  corFundo: '#F5F3EC',
  logoUrl: null,
  mensagemBoasVindas: 'Bem-vindo!',
  tempoOciosoSeg: 60,
  precoLigado: false,
  cadastroLigado: true,
};

function dados(parcial: Partial<DadosDoCatalogo> = {}): DadosDoCatalogo {
  return {
    loja: { id: 'loja-1', nome: 'Loja Centro', cidade: 'Vitória' },
    dispositivo: { id: 'disp-1', nome: 'Totem da entrada' },
    produtos: [
      produto({ id: 'p1', nome: 'Castanha-do-pará' }),
      produto({ id: 'p2', nome: 'Amêndoa', precoCentavos: 12000, unidadePreco: '100g' }),
      produto({ id: 'p3', nome: 'Aveia', precoCentavos: null, unidadePreco: null }),
    ],
    lotes: new Map([['p1', lote()]]),
    campanhas: [],
    ...parcial,
  };
}

describe('montarCatalogo — preço (CONTRATO.md, seção 4)', () => {
  it('com precoLigado=false, nenhum produto leva precoCentavos nem unidadePreco', () => {
    const c = montarCatalogo(dados(), { ...CONFIG, precoLigado: false }, AGORA);
    expect(c.produtos).toHaveLength(3);
    for (const p of c.produtos) {
      expect('precoCentavos' in p).toBe(false);
      expect('unidadePreco' in p).toBe(false);
    }
    const texto = JSON.stringify(c.produtos);
    expect(texto).not.toContain('precoCentavos');
    expect(texto).not.toContain('unidadePreco');
    expect(texto).not.toContain('8990');
  });

  it('sem configuração gravada, o padrão também esconde o preço', () => {
    const c = montarCatalogo(dados(), null, AGORA);
    expect(c.config.precoLigado).toBe(false);
    expect(c.config.cadastroLigado).toBe(false);
    expect(JSON.stringify(c)).not.toContain('precoCentavos');
  });

  it('com precoLigado=true, sai o preço de quem tem preço e unidade válidos', () => {
    const c = montarCatalogo(
      dados({
        produtos: [
          produto({ id: 'p1', nome: 'Castanha' }),
          produto({ id: 'p2', nome: 'Amêndoa', precoCentavos: 12000, unidadePreco: '100g' }),
          produto({ id: 'p3', nome: 'Aveia', precoCentavos: null, unidadePreco: null }),
          produto({ id: 'p4', nome: 'Chia', precoCentavos: 500, unidadePreco: 'litro' }),
        ],
      }),
      { ...CONFIG, precoLigado: true },
      AGORA,
    );
    const porId = new Map(c.produtos.map((p) => [p.id, p]));
    expect(porId.get('p1')).toMatchObject({ precoCentavos: 8990, unidadePreco: 'kg' });
    expect(porId.get('p2')).toMatchObject({ precoCentavos: 12000, unidadePreco: '100g' });
    expect('precoCentavos' in porId.get('p3')!).toBe(false);
    expect('precoCentavos' in porId.get('p4')!).toBe(false);
  });
});

describe('montarCatalogo — lote e validade', () => {
  it('lote presumido sai marcado, com a data da remessa em repostoEm', () => {
    const enviadaEm = new Date('2026-10-08T13:00:00.000Z');
    const c = montarCatalogo(
      dados({ lotes: new Map([['p1', lote({ presumido: true, repostoEm: enviadaEm })]]) }),
      CONFIG,
      AGORA,
    );
    const p1 = c.produtos.find((p) => p.id === 'p1')!;
    expect(p1.lote).toMatchObject({ presumido: true, repostoEm: enviadaEm.toISOString(), codigo: 'L2026-10' });
    expect(c.produtos.find((p) => p.id === 'p2')!.lote).toBeNull();
  });

  it('classifica a validade: vencido, atenção (até 15 dias) e ok', () => {
    const c = montarCatalogo(
      dados({
        produtos: [
          produto({ id: 'a', nome: 'A' }),
          produto({ id: 'b', nome: 'B' }),
          produto({ id: 'c', nome: 'C' }),
          produto({ id: 'd', nome: 'D' }),
          produto({ id: 'e', nome: 'E' }),
        ],
        lotes: new Map([
          ['a', lote({ validadeEm: dia(-1) })],
          ['b', lote({ validadeEm: dia(0) })],
          ['c', lote({ validadeEm: dia(15) })],
          ['d', lote({ validadeEm: dia(16) })],
          ['e', lote({ validadeEm: dia(120) })],
        ]),
      }),
      CONFIG,
      AGORA,
    );
    const situacao = Object.fromEntries(c.produtos.map((p) => [p.id, p.lote?.situacao]));
    expect(situacao).toEqual({ a: 'vencido', b: 'atencao', c: 'atencao', d: 'ok', e: 'ok' });
  });
});

describe('montarCatalogo — o resto do retrato', () => {
  it('deixa de fora produto inativo, selo desconhecido e nutriente malformado', () => {
    const c = montarCatalogo(
      dados({
        produtos: [
          produto({ id: 'p1', nome: 'Castanha', ativo: false }),
          produto({
            id: 'p2',
            nome: 'Amêndoa',
            selos: ['vegano', 'inventado', 'vegano', 'sem_lactose'],
            nutricional: [
              { nutriente: 'Proteínas', quantidade: 21, unidade: 'g', vd: 42 },
              { nutriente: 'Mistério', quantidade: -1, unidade: 'g', vd: null },
              'lixo',
            ],
          }),
          produto({ id: 'p3', nome: 'Aveia', nutricional: { nao: 'lista' } }),
        ],
      }),
      CONFIG,
      AGORA,
    );
    expect(c.produtos.map((p) => p.id)).toEqual(['p2', 'p3']);
    expect(c.produtos[0].selos).toEqual(['vegano', 'sem_lactose']);
    expect(c.produtos[0].nutricional).toEqual([{ nutriente: 'Proteínas', quantidade: 21, unidade: 'g', vd: 42 }]);
    expect(c.produtos[1].nutricional).toEqual([]);
  });

  it('ordena por nome em português e passa no schema que o quiosque confere', () => {
    const c = montarCatalogo(dados(), CONFIG, AGORA);
    expect(c.produtos.map((p) => p.nome)).toEqual(['Amêndoa', 'Aveia', 'Castanha-do-pará']);
    expect(TotemCatalogoSchema.safeParse(c).success).toBe(true);
  });

  it('cor fora de #RRGGBB vira null e o tempo ocioso tem piso', () => {
    const c = montarCatalogo(dados(), { ...CONFIG, corPrimaria: 'red;}', corFundo: '#fff', tempoOciosoSeg: 2 }, AGORA);
    expect(c.config.corPrimaria).toBeNull();
    expect(c.config.corFundo).toBeNull();
    expect(c.config.tempoOciosoSeg).toBe(15);
    expect(TotemCatalogoSchema.safeParse(c).success).toBe(true);
  });

  it('a versão não muda com o relógio e muda com o conteúdo', () => {
    const a = montarCatalogo(dados(), CONFIG, AGORA);
    const b = montarCatalogo(dados(), CONFIG, new Date(AGORA.getTime() + 60_000));
    expect(b.geradoEm).not.toBe(a.geradoEm);
    expect(b.versao).toBe(a.versao);
    const c = montarCatalogo(dados(), { ...CONFIG, mensagemBoasVindas: 'Olá' }, AGORA);
    expect(c.versao).not.toBe(a.versao);
  });

  it('não leva nada do controlador nem do encarregado', () => {
    const config = { ...CONFIG, controladorNome: 'Razão social', encarregadoContato: 'dpo@exemplo.invalid' };
    const texto = JSON.stringify(montarCatalogo(dados(), config, AGORA));
    expect(texto).not.toContain('Razão social');
    expect(texto).not.toContain('dpo@');
  });
});

describe('campanhaDaLoja', () => {
  const base: CampanhaDoCatalogo = {
    nome: 'Boas-vindas',
    chamada: 'Ganhe 10% na primeira compra',
    ativa: true,
    inicioEm: dia(-10),
    fimEm: null,
    lojaIds: [],
  };

  it('lista vazia vale para todas as lojas; lista preenchida só para as dela', () => {
    expect(campanhaDaLoja([base], 'loja-1', true, AGORA)).toEqual({ nome: base.nome, chamada: base.chamada });
    expect(campanhaDaLoja([{ ...base, lojaIds: ['loja-2'] }], 'loja-1', true, AGORA)).toBeNull();
    expect(campanhaDaLoja([{ ...base, lojaIds: ['loja-1'] }], 'loja-1', true, AGORA)).not.toBeNull();
  });

  it('ignora campanha encerrada, futura ou inativa, e some com o cadastro desligado', () => {
    expect(campanhaDaLoja([{ ...base, fimEm: dia(-1) }], 'loja-1', true, AGORA)).toBeNull();
    expect(campanhaDaLoja([{ ...base, inicioEm: dia(1) }], 'loja-1', true, AGORA)).toBeNull();
    expect(campanhaDaLoja([{ ...base, ativa: false }], 'loja-1', true, AGORA)).toBeNull();
    expect(campanhaDaLoja([base], 'loja-1', false, AGORA)).toBeNull();
  });

  it('com duas vigentes, fica a que começou por último', () => {
    const nova = { ...base, nome: 'Outubro', inicioEm: dia(-1) };
    expect(campanhaDaLoja([base, nova], 'loja-1', true, AGORA)?.nome).toBe('Outubro');
  });
});

describe('etagCasa', () => {
  it('casa a versão entre aspas, fraca, em lista e o asterisco', () => {
    expect(etagCasa('"abc"', 'abc')).toBe(true);
    expect(etagCasa('W/"abc"', 'abc')).toBe(true);
    expect(etagCasa('"x", "abc"', 'abc')).toBe(true);
    expect(etagCasa('*', 'abc')).toBe(true);
    expect(etagCasa('"abd"', 'abc')).toBe(false);
    expect(etagCasa(undefined, 'abc')).toBe(false);
    expect(etagCasa('', 'abc')).toBe(false);
  });
});

describe('totemLimparTermo — o que a busca pode guardar', () => {
  it('corta em 80 caracteres e colapsa espaços', () => {
    expect(totemLimparTermo('  castanha    do pará ')).toBe('castanha do pará');
    expect(totemLimparTermo('a'.repeat(200))).toHaveLength(80);
    expect(totemLimparTermo('')).toBeNull();
    expect(totemLimparTermo(null)).toBeNull();
  });

  it('descarta o que parece CPF, com ou sem pontuação', () => {
    expect(totemLimparTermo('123.456.789-09')).toBeNull();
    expect(totemLimparTermo('12345678909')).toBeNull();
    expect(totemLimparTermo('meu cpf 123 456 789 09')).toBeNull();
  });

  it('descarta o que parece telefone, com e sem DDD', () => {
    expect(totemLimparTermo('(27) 99876-5432')).toBeNull();
    expect(totemLimparTermo('27998765432')).toBeNull();
    expect(totemLimparTermo('3322-1100')).toBeNull();
    expect(totemLimparTermo('98765 4321')).toBeNull();
  });

  it('mantém termo com número pequeno', () => {
    expect(totemLimparTermo('aveia 500g')).toBe('aveia 500g');
    expect(totemLimparTermo('ômega 3')).toBe('ômega 3');
    expect(totemLimparTermo('EX012')).toBe('EX012');
  });
});

describe('schemas do quiosque', () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const evento = (n: number, extra: Record<string, unknown> = {}) => ({
    id: id(n),
    tipo: 'busca',
    termo: 'castanha',
    ocorridoEm: AGORA.toISOString(),
    ...extra,
  });

  it('o lote aceita até 200 eventos e recusa vazio ou maior', () => {
    expect(TotemEventosQuiosqueSchema.safeParse({ eventos: [evento(1)] }).success).toBe(true);
    const cheio = Array.from({ length: TOTEM_EVENTOS_POR_LOTE }, (_, i) => evento(i));
    expect(TotemEventosQuiosqueSchema.safeParse({ eventos: cheio }).success).toBe(true);
    expect(TotemEventosQuiosqueSchema.safeParse({ eventos: [...cheio, evento(999)] }).success).toBe(false);
    expect(TotemEventosQuiosqueSchema.safeParse({ eventos: [] }).success).toBe(false);
  });

  it('recusa tipo fora do contrato, id que não é UUID e data inválida', () => {
    expect(TotemEventosQuiosqueSchema.safeParse({ eventos: [evento(1, { tipo: 'clique' })] }).success).toBe(false);
    expect(TotemEventosQuiosqueSchema.safeParse({ eventos: [evento(1, { id: '42' })] }).success).toBe(false);
    expect(TotemEventosQuiosqueSchema.safeParse({ eventos: [evento(1, { ocorridoEm: 'ontem' })] }).success).toBe(
      false,
    );
  });

  it('aplica o filtro de termo no schema', () => {
    const r = TotemEventosQuiosqueSchema.parse({
      eventos: [evento(1, { termo: '123.456.789-09' }), evento(2, { termo: 'x'.repeat(300) }), evento(3, { termo: null })],
    });
    expect(r.eventos.map((e) => e.termo)).toEqual([null, 'x'.repeat(80), null]);
  });

  it('a ativação normaliza o código e o batimento exige a versão do app', () => {
    expect(TotemAtivarSchema.parse({ codigo: 'abcd-2345' }).codigo).toBe('ABCD2345');
    expect(TotemAtivarSchema.safeParse({ codigo: 'curto' }).success).toBe(false);
    expect(TotemBatimentoSchema.safeParse({ versaoApp: '1.0.0', catalogoVersao: 'abc' }).success).toBe(true);
    expect(TotemBatimentoSchema.safeParse({ versaoApp: '' }).success).toBe(false);
  });
});

describe('linhasDeEventos', () => {
  const aparelho = { orgId: 'org-1', lojaId: 'loja-1', dispositivoId: 'disp-1' };
  const base = {
    tipo: 'ver_produto' as const,
    termo: null,
    ocorridoEm: AGORA.toISOString(),
  };

  it('loja e aparelho vêm do token, id repetido entra uma vez e produto alheio vira null', () => {
    const linhas = linhasDeEventos(
      [
        { ...base, id: 'e1', produtoId: 'p-da-empresa' },
        { ...base, id: 'e1', produtoId: 'p-da-empresa' },
        { ...base, id: 'e2', produtoId: 'p-de-outra' },
      ],
      aparelho,
      new Set(['p-da-empresa']),
      AGORA,
    );
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toMatchObject({ ...aparelho, id: 'e1', produtoId: 'p-da-empresa' });
    expect(linhas[1].produtoId).toBeNull();
  });

  it('evento com relógio adiantado é gravado com a hora do servidor', () => {
    const [linha] = linhasDeEventos(
      [{ ...base, id: 'e1', produtoId: null, ocorridoEm: dia(2).toISOString() }],
      aparelho,
      new Set(),
      AGORA,
    );
    expect(linha.ocorridoEm.getTime()).toBe(AGORA.getTime());
  });
});

describe('TotemPublicoController — ordem das conferências', () => {
  const TOKEN = 'a'.repeat(43);
  const aparelho = { dispositivoId: 'disp-1', orgId: 'org-1', lojaId: 'loja-1' };

  function respostaFalsa() {
    const r = {
      status: 0,
      cabecalhos: {} as Record<string, string>,
      corpo: undefined as unknown,
      terminou: false,
      setHeader(k: string, v: string) {
        r.cabecalhos[k] = v;
      },
      statusCode(n: number) {
        r.status = n;
      },
    };
    const res = {
      setHeader: r.setHeader,
      status(n: number) {
        r.status = n;
        return res;
      },
      json(b: unknown) {
        r.corpo = b;
        r.terminou = true;
      },
      end() {
        r.terminou = true;
      },
    };
    return { r, res: res as never };
  }

  function servicoFalso(versao = 'v1') {
    const chamadas: string[] = [];
    const svc = {
      aparelhoDoToken: async (t: string) => {
        chamadas.push(`token:${t.length}`);
        if (t !== TOKEN) throw new UnauthorizedException(TOTEM_REATIVAR);
        return aparelho;
      },
      catalogo: async () => {
        chamadas.push('catalogo');
        return { versao, produtos: [] };
      },
      ativar: async () => {
        chamadas.push('ativar');
        throw new NotFoundException();
      },
    };
    return { svc: svc as unknown as TotemPublicoService, chamadas };
  }

  it('token fora do formato responde 401 sem chegar ao serviço', async () => {
    const { svc, chamadas } = servicoFalso();
    const c = new TotemPublicoController(svc);
    const { res } = respostaFalsa();
    await expect(c.catalogo(res, undefined, undefined, { ip: '10.0.0.1' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(c.catalogo(res, 'curto', undefined, { ip: '10.0.0.1' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(chamadas).toEqual([]);
  });

  it('manda o ETag e responde 304 quando o aparelho já tem a versão', async () => {
    const { svc } = servicoFalso('v9');
    const c = new TotemPublicoController(svc);
    const novo = respostaFalsa();
    await c.catalogo(novo.res, TOKEN, undefined, { ip: '10.0.0.1' });
    expect(novo.r.status).toBe(200);
    expect(novo.r.cabecalhos.ETag).toBe('"v9"');
    expect(novo.r.corpo).toMatchObject({ versao: 'v9' });

    const igual = respostaFalsa();
    await c.catalogo(igual.res, TOKEN, '"v9"', { ip: '10.0.0.1' });
    expect(igual.r.status).toBe(304);
    expect(igual.r.corpo).toBeUndefined();
    expect(igual.r.terminou).toBe(true);
  });

  it('a ativação recusa código fora do formato com 400 de validação, antes do serviço', async () => {
    const { svc, chamadas } = servicoFalso();
    const c = new TotemPublicoController(svc);
    await expect(c.ativar({ codigo: '!!' }, { ip: '10.0.0.2' })).rejects.toThrow();
    expect(chamadas).toEqual([]);
  });

  it('a ativação tem teto de 20 por hora por origem', async () => {
    const { svc } = servicoFalso();
    const c = new TotemPublicoController(svc);
    for (let i = 0; i < 20; i += 1) {
      await expect(c.ativar({ codigo: 'ABCD2345' }, { ip: '10.0.0.3' })).rejects.toBeInstanceOf(NotFoundException);
    }
    await expect(c.ativar({ codigo: 'ABCD2345' }, { ip: '10.0.0.3' })).rejects.toMatchObject({ status: 429 });
    await expect(c.ativar({ codigo: 'ABCD2345' }, { ip: '10.0.0.4' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
