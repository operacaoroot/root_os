import { describe, it, expect } from 'vitest';
import {
  lerTituloDeReuniao,
  montarTituloDeReuniao,
  tituloNoPadrao,
  RESPONSAVEL_TODOS,
} from '@mktos/shared';

/*
 * O PADRÃO DE NOMENCLATURA DA AGENDA DA ROOT (combinado em 24/09/2026).
 *
 * Esta suíte é o contrato em forma executável. Ela existe porque o padrão vive
 * em três lugares ao mesmo tempo — a tela que monta, a API que grava e a leitura
 * que desmonta — e os três chamam as MESMAS duas funções. Se `montar` e `ler`
 * deixarem de ser inversas uma da outra, o calendário passa a mostrar cliente
 * onde há responsável, e ninguém repara até alguém abrir o convite errado.
 */

describe('montar o título', () => {
  it('reunião de cliente traz modalidade, cliente e quem atende', () => {
    expect(
      montarTituloDeReuniao({ tipo: 'cliente', modalidade: 'online', cliente: 'Andrade Peças', responsavel: 'Pedro' }),
    ).toBe('Reunião Online - Andrade Peças - Pedro');
    expect(
      montarTituloDeReuniao({ tipo: 'cliente', modalidade: 'presencial', cliente: 'Andrade Peças', responsavel: 'Rodrigo' }),
    ).toBe('Reunião Presencial - Andrade Peças - Rodrigo');
  });

  it('reunião interna não fala de modalidade — nem quando ela é declarada', () => {
    // A modalidade da interna existe (é ela que decide o Meet), mas não vai para
    // o título: foi o combinado, e é o que distingue as duas formas de longe.
    expect(montarTituloDeReuniao({ tipo: 'interna', modalidade: 'online', responsavel: 'Lucas' }))
      .toBe('Reunião Interna - Lucas');
    expect(montarTituloDeReuniao({ tipo: 'interna', responsavel: RESPONSAVEL_TODOS }))
      .toBe('Reunião Interna - Todos');
  });

  it('normaliza espaço sobrando em vez de gravá-lo na agenda', () => {
    expect(
      montarTituloDeReuniao({ tipo: 'cliente', modalidade: 'online', cliente: '  Andrade   Peças ', responsavel: ' Pedro ' }),
    ).toBe('Reunião Online - Andrade Peças - Pedro');
  });

  it('recusa o que o padrão exige e não veio, em vez de gravar título quebrado', () => {
    expect(() => montarTituloDeReuniao({ tipo: 'cliente', modalidade: 'online', cliente: '', responsavel: 'Pedro' }))
      .toThrow(/cliente/i);
    expect(() => montarTituloDeReuniao({ tipo: 'interna', responsavel: '  ' })).toThrow(/responsável/i);
    // "Interna" como nome de cliente produziria `Reunião Online - Interna - X`,
    // que a leitura entende como reunião de casa. Recusar é mais honesto.
    expect(() => montarTituloDeReuniao({ tipo: 'cliente', modalidade: 'online', cliente: 'interna', responsavel: 'Pedro' }))
      .toThrow(/não é nome de cliente/i);
  });
});

describe('ler o título de volta', () => {
  it('desmonta a forma canônica de cliente', () => {
    expect(lerTituloDeReuniao('Reunião Online - Andrade Peças - Pedro')).toEqual({
      tipo: 'cliente', modalidade: 'online', cliente: 'Andrade Peças', responsavel: 'Pedro',
    });
  });

  it('desmonta a forma canônica de interna', () => {
    expect(lerTituloDeReuniao('Reunião Interna - Lucas')).toEqual({ tipo: 'interna', responsavel: 'Lucas' });
    expect(lerTituloDeReuniao('Reunião Interna')).toEqual({ tipo: 'interna', responsavel: 'Todos' });
  });

  it('é tolerante com o que o Google já tem: travessão, acento e espaço', () => {
    expect(lerTituloDeReuniao('Reuniao  online – Andrade Peças — Pedro')).toEqual({
      tipo: 'cliente', modalidade: 'online', cliente: 'Andrade Peças', responsavel: 'Pedro',
    });
  });

  it('aceita a variante antiga sem responsável, sem inventar um', () => {
    expect(lerTituloDeReuniao('Reunião Presencial - Andrade Peças')).toEqual({
      tipo: 'cliente', modalidade: 'presencial', cliente: 'Andrade Peças', responsavel: '',
    });
  });

  it('aceita a interna que declarou modalidade', () => {
    expect(lerTituloDeReuniao('Reunião Online - Interna - Pedro')).toEqual({
      tipo: 'interna', modalidade: 'online', responsavel: 'Pedro',
    });
  });

  it('o que foge do padrão volta null — e a tela mostra isso, não um cliente inventado', () => {
    for (const fora of [
      'Almoço',
      'Reunião c/ Andrade',        // o jeito antigo, sem separador do padrão
      'Reunião de alinhamento - Pedro', // qualificador que não é modalidade nem Interna
      'Reunião - Andrade Peças',   // sem dizer se é cliente ou casa
      'Call Andrade Peças - Pedro',
      '',
      null,
      undefined,
    ]) {
      expect(lerTituloDeReuniao(fora), `"${fora}" não devia passar por reunião no padrão`).toBeNull();
      expect(tituloNoPadrao(fora)).toBe(false);
    }
  });
});

describe('montar e ler são inversas', () => {
  const casos = [
    { tipo: 'cliente', modalidade: 'online', cliente: 'Andrade Peças', responsavel: 'Pedro' },
    { tipo: 'cliente', modalidade: 'presencial', cliente: 'Hidrominas', responsavel: RESPONSAVEL_TODOS },
    { tipo: 'interna', responsavel: 'Rodrigo' },
    { tipo: 'interna', responsavel: RESPONSAVEL_TODOS },
  ] as const;

  it.each(casos)('ida e volta de %o', (caso) => {
    const titulo = montarTituloDeReuniao(caso);
    expect(tituloNoPadrao(titulo)).toBe(true);
    const lido = lerTituloDeReuniao(titulo)!;
    expect(lido.tipo).toBe(caso.tipo);
    expect(lido.responsavel).toBe(caso.responsavel);
    if (caso.tipo === 'cliente' && lido.tipo === 'cliente') {
      expect(lido.cliente).toBe(caso.cliente);
      expect(lido.modalidade).toBe(caso.modalidade);
    }
  });
});
