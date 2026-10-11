import { describe, it, expect } from 'vitest';
import { HttpException, NotFoundException } from '@nestjs/common';
import { TOTEM_ALFABETO_CROCKFORD, TOTEM_TETOS_POR_HORA, TotemTokenSchema } from '@mktos/shared';

import { escopoDeLojas, exigirLojaNoEscopo, type UsuarioDoEscopo } from '../src/totem/comum/escopo';
import { exigirModuloTotem, TOTEM_NAO_ENCONTRADO } from '../src/totem/comum/modulo';
import { gerarCodigo, gerarToken, hashToken } from '../src/totem/comum/segredos';
import { conferirTeto, TetoPorOrigem, tetoDoTotem } from '../src/totem/comum/teto';

/*
 * MÓDULO TOTEM — AS PEÇAS COMUNS (CONTRATO.md, seções 4, 6 e 8).
 *
 * Tudo aqui é função pura ou recebe o client por parâmetro, então roda sem
 * banco e sem Nest. O client falso responde só às consultas que cada função
 * faz e guarda o `where`, para o teste conferir que a empresa entrou no filtro.
 */

type Vinculo = { orgId: string; userId: string; lojaId: string };

function clienteFalso(vinculos: Vinculo[], lojas: { id: string; orgId: string }[]) {
  const consultas: unknown[] = [];
  const cliente = {
    totemUsuarioLoja: {
      findMany: async (args: { where: { orgId: string; userId: string } }) => {
        consultas.push(args.where);
        return vinculos
          .filter((v) => v.orgId === args.where.orgId && v.userId === args.where.userId)
          .map((v) => ({ lojaId: v.lojaId }));
      },
    },
    totemLoja: {
      findFirst: async (args: { where: { id: string; orgId: string } }) => {
        consultas.push(args.where);
        return lojas.find((l) => l.id === args.where.id && l.orgId === args.where.orgId) ?? null;
      },
    },
  };
  return { cliente: cliente as unknown as Parameters<typeof exigirLojaNoEscopo>[0], consultas };
}

const gerente: UsuarioDoEscopo = { sub: 'u1', orgId: 'org-a', permissions: ['totem.ver', 'totem.reposicao'] };
const dono: UsuarioDoEscopo = { sub: 'u2', orgId: 'org-a', permissions: ['totem.ver', 'totem.rede'] };

describe('escopoDeLojas', () => {
  it('quem tem totem.rede vê todas as lojas sem consulta', async () => {
    const { cliente, consultas } = clienteFalso([], []);
    expect(await escopoDeLojas(cliente, dono)).toBe('todas');
    expect(consultas).toHaveLength(0);
  });

  it('os demais veem só as lojas vinculadas, sem repetição e só da própria empresa', async () => {
    const { cliente, consultas } = clienteFalso(
      [
        { orgId: 'org-a', userId: 'u1', lojaId: 'l1' },
        { orgId: 'org-a', userId: 'u1', lojaId: 'l2' },
        { orgId: 'org-a', userId: 'u1', lojaId: 'l1' },
        { orgId: 'org-b', userId: 'u1', lojaId: 'l9' },
        { orgId: 'org-a', userId: 'u3', lojaId: 'l3' },
      ],
      [],
    );
    expect(await escopoDeLojas(cliente, gerente)).toEqual(['l1', 'l2']);
    expect(consultas).toEqual([{ orgId: 'org-a', userId: 'u1' }]);
  });

  it('sem vínculo, a lista é vazia', async () => {
    const { cliente } = clienteFalso([], []);
    expect(await escopoDeLojas(cliente, gerente)).toEqual([]);
  });
});

describe('exigirLojaNoEscopo', () => {
  const vinculos = [{ orgId: 'org-a', userId: 'u1', lojaId: 'l1' }];
  const lojas = [
    { id: 'l1', orgId: 'org-a' },
    { id: 'l2', orgId: 'org-a' },
    { id: 'lx', orgId: 'org-b' },
  ];

  it('passa quando a loja está no escopo e existe na empresa', async () => {
    const { cliente } = clienteFalso(vinculos, lojas);
    await expect(exigirLojaNoEscopo(cliente, gerente, 'l1')).resolves.toBeUndefined();
  });

  it('responde 404, e não 403, quando a loja está fora do escopo', async () => {
    const { cliente } = clienteFalso(vinculos, lojas);
    const erro = await exigirLojaNoEscopo(cliente, gerente, 'l2').catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(NotFoundException);
    expect((erro as NotFoundException).message).toBe(TOTEM_NAO_ENCONTRADO);
  });

  it('responde 404 para loja de outra empresa mesmo com totem.rede', async () => {
    const { cliente } = clienteFalso(vinculos, lojas);
    await expect(exigirLojaNoEscopo(cliente, dono, 'lx')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('responde 404 quando a loja vinculada não existe mais', async () => {
    const { cliente } = clienteFalso([{ orgId: 'org-a', userId: 'u1', lojaId: 'sumiu' }], lojas);
    await expect(exigirLojaNoEscopo(cliente, gerente, 'sumiu')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('exigirModuloTotem', () => {
  function org(dados: { modulos: string[]; isActive: boolean } | null) {
    return {
      org: { findUnique: async () => dados },
    } as unknown as Parameters<typeof exigirModuloTotem>[0];
  }

  it('passa quando a empresa está ativa e tem o módulo', async () => {
    await expect(exigirModuloTotem(org({ modulos: ['trabalho', 'totem'], isActive: true }), 'o')).resolves.toBeUndefined();
  });

  it.each([
    ['a empresa não existe', null],
    ['a empresa está inativa', { modulos: ['totem'], isActive: false }],
    ['a empresa não contratou o totem', { modulos: ['trabalho'], isActive: true }],
  ])('responde a mesma 404 quando %s', async (_caso, dados) => {
    const erro = await exigirModuloTotem(org(dados), 'o').catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(NotFoundException);
    expect((erro as NotFoundException).message).toBe(TOTEM_NAO_ENCONTRADO);
  });
});

describe('segredos', () => {
  it('gerarCodigo usa só o alfabeto de Crockford e respeita o tamanho', () => {
    for (const n of [1, 8, 10, 64]) {
      const codigo = gerarCodigo(n);
      expect(codigo).toHaveLength(n);
      for (const ch of codigo) expect(TOTEM_ALFABETO_CROCKFORD).toContain(ch);
    }
  });

  it('gerarCodigo recusa tamanho fora de 1 a 64', () => {
    for (const n of [0, -1, 65, 2.5, Number.NaN]) expect(() => gerarCodigo(n)).toThrow(RangeError);
  });

  it('gerarCodigo não repete em sorteios seguidos', () => {
    const vistos = new Set(Array.from({ length: 200 }, () => gerarCodigo(10)));
    expect(vistos.size).toBe(200);
  });

  it('gerarToken tem 43 caracteres base64url e passa no schema do cabeçalho', () => {
    const token = gerarToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(TotemTokenSchema.safeParse(token).success).toBe(true);
    expect(gerarToken()).not.toBe(token);
  });

  it('hashToken é SHA-256 em hex e determinístico', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('ABC')).not.toBe(hashToken('abc'));
  });
});

describe('teto por origem', () => {
  it('deixa passar até o teto e barra a tentativa seguinte na mesma hora', () => {
    const teto = new TetoPorOrigem(3);
    const t0 = 1_000_000;
    expect([1, 2, 3].map((i) => teto.registrar('1.2.3.4', t0 + i))).toEqual([true, true, true]);
    expect(teto.registrar('1.2.3.4', t0 + 4)).toBe(false);
    expect(teto.registrar('5.6.7.8', t0 + 5)).toBe(true);
  });

  it('a janela vence depois de uma hora', () => {
    const teto = new TetoPorOrigem(1);
    expect(teto.registrar('ip', 0)).toBe(true);
    expect(teto.registrar('ip', 10)).toBe(false);
    expect(teto.registrar('ip', 3_600_000)).toBe(true);
  });

  it('origem desconhecida divide um balde só', () => {
    const teto = new TetoPorOrigem(1);
    expect(teto.registrar(undefined, 0)).toBe(true);
    expect(teto.registrar(null, 1)).toBe(false);
  });

  it('tetoDoTotem usa o limite do contrato', () => {
    expect(tetoDoTotem('ativacao').tetoPorHora).toBe(TOTEM_TETOS_POR_HORA.ativacao);
    expect(tetoDoTotem('etiqueta').tetoPorHora).toBe(600);
    expect(tetoDoTotem('catalogo').tetoPorHora).toBe(1200);
  });

  it('conferirTeto responde 429 quando passou do teto', () => {
    const teto = new TetoPorOrigem(1);
    conferirTeto(teto, 'ip');
    const erro = (() => {
      try {
        conferirTeto(teto, 'ip');
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(erro).toBeInstanceOf(HttpException);
    expect((erro as HttpException).getStatus()).toBe(429);
  });
});
