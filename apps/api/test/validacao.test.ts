import { describe, it, expect } from 'vitest';
import { validarArgs, mensagemDeErro } from '../src/gateway/validacao';

/*
 * A regressão de 01/09/2026: o modelo propôs `{message: "..."}` numa
 * capacidade que espera `corpo`. A régua reteve certo, uma pessoa aprovou, e
 * só então o efeito morreu — queimando a aprovação por um erro de nome de
 * campo. A recusa tem que vir na porta, com o motivo.
 */
const ZAP = {
  type: 'object',
  additionalProperties: false,
  required: ['corpo'],
  properties: {
    titulo: { type: 'string', description: 'linha de título' },
    corpo: { type: 'string', minLength: 1, description: 'o texto que vai para o grupo' },
  },
};

describe('validação de argumentos na porta', () => {
  it('o caso que quebrou: campo inventado é recusado E o certo é apontado', () => {
    const erros = validarArgs(ZAP, { message: 'texto do resumo' });
    expect(erros.length).toBeGreaterThan(0);
    const msg = mensagemDeErro(erros);
    expect(msg).toContain('message');
    // o modelo precisa saber qual é o nome certo para conseguir corrigir
    expect(msg).toContain('titulo, corpo');
    expect(msg).toContain('corpo obrigatório');
  });

  it('argumento certo passa', () => {
    expect(validarArgs(ZAP, { titulo: 'Resumo', corpo: 'o texto' })).toEqual([]);
  });

  it('campo opcional pode faltar', () => {
    expect(validarArgs(ZAP, { corpo: 'só o texto' })).toEqual([]);
  });

  it('string vazia NÃO satisfaz obrigatório — foi o sintoma no efeito', () => {
    expect(validarArgs(ZAP, { corpo: '   ' })).toHaveLength(1);
  });

  it('tipo errado é recusado com o que veio', () => {
    const e = validarArgs(ZAP, { corpo: 123 });
    expect(mensagemDeErro(e)).toContain('esperava string, veio number');
  });

  it('enum recusa valor fora da lista e mostra a lista', () => {
    const schema = {
      type: 'object',
      properties: { status: { type: 'string', enum: ['novo', 'ganho'] } },
    };
    expect(mensagemDeErro(validarArgs(schema, { status: 'inventado' }))).toContain('novo, ganho');
    expect(validarArgs(schema, { status: 'ganho' })).toEqual([]);
  });

  it('inteiro aceita inteiro e recusa fracionário', () => {
    const schema = { type: 'object', properties: { limit: { type: 'integer' } } };
    expect(validarArgs(schema, { limit: 5 })).toEqual([]);
    expect(validarArgs(schema, { limit: 5.5 })).toHaveLength(1);
  });

  it('SEM schema é permissivo — as dez leituras que funcionam hoje não param', () => {
    // capacidade sem schema é problema do catálogo, não motivo para recusar
    expect(validarArgs(undefined, { qualquer: 'coisa' })).toEqual([]);
    expect(validarArgs(null, { qualquer: 'coisa' })).toEqual([]);
    expect(validarArgs({ type: 'object' }, { qualquer: 'coisa' })).toEqual([]);
  });

  it('additionalProperties ausente não recusa campo extra', () => {
    const frouxo = { type: 'object', properties: { a: { type: 'string' } } };
    expect(validarArgs(frouxo, { a: 'x', extra: 1 })).toEqual([]);
  });
});

/*
 * MD6: a lista de mídias de `instagram.post.publicar` prende a aprovação ao
 * arquivo exato. A forma errada tem de parar na porta, antes da fila — no
 * efeito ela já teria queimado a aprovação de alguém.
 */
describe('validação de lista na porta (MD6)', () => {
  const MIDIAS = {
    type: 'object',
    additionalProperties: false,
    required: ['midias'],
    properties: {
      midias: {
        type: 'array',
        minItems: 1,
        maxItems: 2,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['chave', 'sha256'],
          properties: { chave: { type: 'string', minLength: 1 }, sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' } },
        },
      },
    },
  };
  const ok = { chave: 'a.jpg', sha256: 'a'.repeat(64) };

  it('a lista certa passa', () => {
    expect(validarArgs(MIDIAS, { midias: [ok, ok] })).toEqual([]);
  });

  it('vazia, longa demais, item fora da forma, campo a mais ou sha fora do padrão: cada um aponta o item', () => {
    expect(mensagemDeErro(validarArgs(MIDIAS, { midias: [] }))).toContain('midias precisa de ao menos 1');
    expect(mensagemDeErro(validarArgs(MIDIAS, { midias: [ok, ok, ok] }))).toContain('aceita até 2');
    expect(mensagemDeErro(validarArgs(MIDIAS, { midias: ['a.jpg'] }))).toContain('midias[0] esperava object');
    expect(mensagemDeErro(validarArgs(MIDIAS, { midias: [{ ...ok, extra: 1 }] }))).toContain('midias[0].extra não existe');
    expect(mensagemDeErro(validarArgs(MIDIAS, { midias: [ok, { chave: 'b.jpg', sha256: 'curto' }] }))).toContain('midias[1].sha256 fora do formato');
    expect(mensagemDeErro(validarArgs(MIDIAS, { midias: [{ sha256: 'a'.repeat(64) }] }))).toContain('midias[0].chave obrigatório');
  });
});
