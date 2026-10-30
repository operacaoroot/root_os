import { describe, expect, it } from 'vitest';
import { feriadosDoAno, lerCompromisso, montarTituloDeCompromisso, sociosDoResponsavel } from '@mktos/shared';

/*
 * A GRAMÁTICA NOVA DA AGENDA V2 (29/10/2026): Fechado, Fora, Pessoal e o
 * feriado pelo nome exato. Leitura tolerante, escrita estrita; `montar` e `ler`
 * são inversas. A de reunião continua travada em `agenda-padrao.test.ts`.
 */

const FERIADOS = feriadosDoAno(2026).map((f) => f.nome);

describe('Fechado', () => {
  it('lê o bloqueio de um sócio', () => {
    expect(lerCompromisso('Fechado Rodrigo')).toMatchObject({ tipo: 'fechado', responsaveis: ['Rodrigo'] });
  });

  it('tolera caixa, acento e espaço', () => {
    expect(lerCompromisso('  fechado   rodrigo ')).toMatchObject({ tipo: 'fechado', responsaveis: ['Rodrigo'] });
  });

  it('Fechado de quem não é sócio não é Fechado', () => {
    expect(lerCompromisso('Fechado Fulano').tipo).toBe('outro');
  });

  it('escreve só de uma pessoa', () => {
    expect(montarTituloDeCompromisso({ tipo: 'bloqueio', responsaveis: ['Lucas'] })).toBe('Fechado Lucas');
    expect(() => montarTituloDeCompromisso({ tipo: 'bloqueio', responsaveis: ['Lucas', 'Pedro'] })).toThrow();
  });
});

describe('Fora', () => {
  it('lê o motivo', () => {
    expect(lerCompromisso('Pedro Fora - viagem')).toMatchObject({ tipo: 'fora', responsaveis: ['Pedro'], motivo: 'viagem' });
  });

  it('aceita travessão na leitura', () => {
    expect(lerCompromisso('Pedro Fora – férias')).toMatchObject({ tipo: 'fora', motivo: 'férias' });
  });

  it('sem motivo ainda lê (tolerante), com motivo nulo', () => {
    expect(lerCompromisso('Lucas Fora')).toMatchObject({ tipo: 'fora', responsaveis: ['Lucas'], motivo: null });
  });

  it('escrever exige o motivo', () => {
    expect(() => montarTituloDeCompromisso({ tipo: 'fora', responsaveis: ['Pedro'] })).toThrow(/motivo/);
    expect(montarTituloDeCompromisso({ tipo: 'fora', responsaveis: ['Pedro'], motivo: '  curso  ' })).toBe('Pedro Fora - curso');
  });

  it('montar e ler são inversas', () => {
    const t = montarTituloDeCompromisso({ tipo: 'fora', responsaveis: ['Rodrigo'], motivo: 'viagem a São Paulo' });
    expect(lerCompromisso(t)).toMatchObject({ tipo: 'fora', responsaveis: ['Rodrigo'], motivo: 'viagem a São Paulo' });
  });
});

describe('Pessoal', () => {
  it('lê por palavra inteira', () => {
    expect(lerCompromisso('Pessoal - Lucas')).toMatchObject({ tipo: 'pessoal', responsaveis: ['Lucas'] });
  });

  it('"Pessoalmente" não é Pessoal', () => {
    expect(lerCompromisso('Pessoalmente - Lucas').tipo).toBe('outro');
  });

  it('escreve de uma pessoa só e volta igual', () => {
    const t = montarTituloDeCompromisso({ tipo: 'pessoal', responsaveis: ['Pedro'] });
    expect(t).toBe('Pessoal - Pedro');
    expect(lerCompromisso(t)).toMatchObject({ tipo: 'pessoal', responsaveis: ['Pedro'] });
    expect(() => montarTituloDeCompromisso({ tipo: 'pessoal', responsaveis: ['Pedro', 'Lucas'] })).toThrow();
  });
});

describe('feriado', () => {
  it('só pelo nome exato de um feriado conhecido', () => {
    expect(lerCompromisso('Finados', FERIADOS)).toMatchObject({ tipo: 'feriado', feriado: 'Finados' });
  });

  it('nunca por sufixo nem por pedaço', () => {
    expect(lerCompromisso('Reunião pós-Finados', FERIADOS).tipo).toBe('outro');
    expect(lerCompromisso('Véspera de Finados', FERIADOS).tipo).toBe('outro');
  });

  it('sem a lista de feriados, nenhum título vira feriado', () => {
    expect(lerCompromisso('Finados').tipo).toBe('outro');
  });
});

describe('o resto continua com a gramática de reunião', () => {
  it('cliente e interna', () => {
    expect(lerCompromisso('Reunião Online - Fictícia Peças - Rodrigo')).toMatchObject({
      tipo: 'cliente', modalidade: 'online', cliente: 'Fictícia Peças', responsaveis: ['Rodrigo'],
    });
    expect(lerCompromisso('Reunião Interna - Todos')).toMatchObject({ tipo: 'interna', responsaveis: ['Rodrigo', 'Lucas', 'Pedro'] });
  });

  it('montar a interna dos três escreve Todos', () => {
    expect(montarTituloDeCompromisso({ tipo: 'interna', responsaveis: ['Pedro', 'Rodrigo', 'Lucas'] })).toBe('Reunião Interna - Todos');
  });

  it('sem sócio, montar recusa', () => {
    expect(() => montarTituloDeCompromisso({ tipo: 'interna', responsaveis: ['Fulano'] })).toThrow();
  });

  it('título vazio é outro', () => {
    expect(lerCompromisso(null).tipo).toBe('outro');
    expect(sociosDoResponsavel('Todos')).toEqual(['Rodrigo', 'Lucas', 'Pedro']);
  });
});
