import { describe, expect, it } from 'vitest';
import { interpretarFrase } from '@mktos/shared';

/*
 * O ATALHO POR FRASE (agenda v2, 29/10/2026, lane G3): a frase preenche SÓ o que
 * disse, sem IA. Hoje = quinta, 29/10/2026. Clientes fictícios.
 */

const HOJE = '2026-10-29'; // quinta
const CLIENTES = ['Fictícia Peças', 'Papelaria Santa Modelo', 'Exemplaria', 'Santa Clara Móveis', 'Fictus'];
const ler = (frase: string) => interpretarFrase(frase, { hoje: HOJE, clientes: CLIENTES });

describe('a frase do desenho', () => {
  it('"online com ficticia sexta 15h 1h rodrigo" preenche tudo', () => {
    expect(ler('online com ficticia sexta 15h 1h rodrigo')).toEqual({
      tipo: 'cliente',
      modalidade: 'online',
      cliente: 'Fictícia Peças',
      responsaveis: ['Rodrigo'],
      dia: '2026-10-30',
      hora: '15:00',
      duracaoMin: 60,
    });
  });

  it('"Fictícia online sexta 15h com Rodrigo 1h" dá o mesmo, em outra ordem', () => {
    expect(ler('Fictícia online sexta 15h com Rodrigo 1h')).toEqual(ler('online com ficticia sexta 15h 1h rodrigo'));
  });
});

describe('a hora e a duração', () => {
  it('"14h 30 min" é 14:00 por 30 minutos', () => {
    expect(ler('14h 30 min')).toEqual({ hora: '14:00', duracaoMin: 30 });
  });
  it('"14h30" é 14:30, sem duração', () => {
    expect(ler('14h30')).toEqual({ hora: '14:30' });
  });
  it('"14:30" é 14:30', () => {
    expect(ler('14:30')).toEqual({ hora: '14:30' });
  });
  it('"14h 30" (sem unidade) é 14:30', () => {
    expect(ler('14h 30')).toEqual({ hora: '14:30' });
  });
  it('"9h30" é hora; "1h30" depois dela é uma hora e meia', () => {
    expect(ler('amanhã 9h30 1h30')).toEqual({ dia: '2026-10-30', hora: '09:30', duracaoMin: 90 });
  });
  it('"1h" sozinho é duração, não 1 da manhã', () => {
    expect(ler('1h')).toEqual({ duracaoMin: 60 });
  });
  it('"1h30" sozinho é duração', () => {
    expect(ler('1h30')).toEqual({ duracaoMin: 90 });
  });
  it('"45 min", "45min" e "45 minutos" são 45 minutos', () => {
    expect(ler('45 min')).toEqual({ duracaoMin: 45 });
    expect(ler('45min')).toEqual({ duracaoMin: 45 });
    expect(ler('45 minutos')).toEqual({ duracaoMin: 45 });
  });
  it('"2 horas", "1 hora e meia", "meia hora"', () => {
    expect(ler('2 horas')).toEqual({ duracaoMin: 120 });
    expect(ler('1 hora e meia')).toEqual({ duracaoMin: 90 });
    expect(ler('meia hora')).toEqual({ duracaoMin: 30 });
  });
  it('"às 9" é 9:00 (o "às" diz que é hora)', () => {
    expect(ler('às 9')).toEqual({ hora: '09:00' });
    expect(ler('as 5h')).toEqual({ hora: '05:00' });
  });
  it('"das 14h às 15h30" é 14:00 por 90 minutos', () => {
    expect(ler('das 14h às 15h30')).toEqual({ hora: '14:00', duracaoMin: 90 });
  });
  it('"meio-dia" é 12:00', () => {
    expect(ler('meio-dia')).toEqual({ hora: '12:00' });
  });
  it('a primeira hora vale; a segunda sem "às" vira duração', () => {
    expect(ler('15h 2h')).toEqual({ hora: '15:00', duracaoMin: 120 });
  });
  it('"por 1h" é duração', () => {
    expect(ler('por 1h')).toEqual({ duracaoMin: 60 });
  });
  it('"09h" é 9:00', () => {
    expect(ler('09h')).toEqual({ hora: '09:00' });
  });
  it('duração absurda não entra', () => {
    expect(ler('2 min')).toEqual({});
  });
});

describe('o dia', () => {
  it('hoje, amanhã e depois de amanhã', () => {
    expect(ler('hoje').dia).toBe('2026-10-29');
    expect(ler('amanhã').dia).toBe('2026-10-30');
    expect(ler('amanha').dia).toBe('2026-10-30');
    expect(ler('depois de amanhã').dia).toBe('2026-10-31');
  });
  it('dia da semana é o próximo DEPOIS de hoje', () => {
    expect(ler('sexta').dia).toBe('2026-10-30');
    expect(ler('segunda').dia).toBe('2026-11-02');
    expect(ler('seg').dia).toBe('2026-11-02');
    expect(ler('terça').dia).toBe('2026-11-03');
    expect(ler('terca-feira').dia).toBe('2026-11-03');
    expect(ler('quarta').dia).toBe('2026-11-04');
    expect(ler('sábado').dia).toBe('2026-10-31');
    expect(ler('domingo').dia).toBe('2026-11-01');
    // dita numa quinta, "quinta" é a da semana que vem
    expect(ler('quinta').dia).toBe('2026-11-05');
  });
  it('"próxima sexta" e "sexta que vem" não deixam sobra', () => {
    expect(ler('próxima sexta')).toEqual({ dia: '2026-10-30' });
    expect(ler('sexta que vem')).toEqual({ dia: '2026-10-30' });
  });
  it('dd/mm e dd/mm/aaaa; data que já passou vai para o ano que vem', () => {
    expect(ler('16/11').dia).toBe('2026-11-16');
    expect(ler('16/11/2027').dia).toBe('2027-11-16');
    expect(ler('10/01').dia).toBe('2027-01-10');
    expect(ler('31/02').dia).toBeUndefined();
  });
  it('"dia 12" é deste mês, ou do próximo se já passou', () => {
    expect(ler('dia 30').dia).toBe('2026-10-30');
    expect(ler('dia 12').dia).toBe('2026-11-12');
  });
  it('sem `hoje` válido, nenhum dia', () => {
    expect(interpretarFrase('amanhã 9h', { hoje: 'ontem' })).toEqual({ hora: '09:00' });
  });
});

describe('modalidade, tipo e sócios', () => {
  it('online e presencial', () => {
    expect(ler('online').modalidade).toBe('online');
    expect(ler('presencial').modalidade).toBe('presencial');
    expect(ler('no meet').modalidade).toBe('online');
  });
  it('os sócios pelo nome, sem acento nem caixa', () => {
    expect(ler('com Rodrigo e Lucas').responsaveis).toEqual(['Rodrigo', 'Lucas']);
    expect(ler('PEDRO').responsaveis).toEqual(['Pedro']);
  });
  it('"todos" são os três', () => {
    expect(ler('interna todos').responsaveis).toEqual(['Rodrigo', 'Lucas', 'Pedro']);
    expect(ler('interna todos').tipo).toBe('interna');
  });
  it('bloqueio e pessoal', () => {
    expect(ler('bloqueio rodrigo amanhã 14h').tipo).toBe('bloqueio');
    expect(ler('pessoal lucas').tipo).toBe('pessoal');
  });
  it('Fora com motivo', () => {
    expect(ler('Pedro fora viagem a São Paulo sexta')).toEqual({
      tipo: 'fora',
      responsaveis: ['Pedro'],
      dia: '2026-10-30',
      motivo: 'viagem a São Paulo',
    });
    expect(ler('lucas fora - curso').motivo).toBe('curso');
  });
  it('Fora sem motivo não inventa um', () => {
    expect(ler('pedro fora').motivo).toBeUndefined();
  });
});

describe('o cliente', () => {
  it('pelo nome inteiro, com acento ou sem', () => {
    expect(ler('papelaria santa modelo').cliente).toBe('Papelaria Santa Modelo');
    expect(ler('ficticia pecas').cliente).toBe('Fictícia Peças');
  });
  it('por uma palavra que só um cliente tem', () => {
    expect(ler('exemplaria presencial').cliente).toBe('Exemplaria');
    expect(ler('fictus').cliente).toBe('Fictus');
  });
  it('palavra de dois clientes não escolhe nenhum', () => {
    expect(ler('santa amanhã').cliente).toBeUndefined();
  });
  it('cliente desconhecido não é inventado', () => {
    expect(ler('online com fulano sexta').cliente).toBeUndefined();
    expect(ler('online com fulano sexta').tipo).toBeUndefined();
  });
  it('sem lista de clientes, nenhum cliente', () => {
    expect(interpretarFrase('ficticia sexta', { hoje: HOJE })).toEqual({ dia: '2026-10-30' });
  });
  it('cliente reconhecido marca o tipo cliente, mas o tipo dito vence', () => {
    expect(ler('ficticia').tipo).toBe('cliente');
    expect(ler('interna ficticia').tipo).toBe('interna');
  });
});

describe('o que a frase NÃO disse', () => {
  it('frase vazia não preenche nada', () => {
    expect(ler('')).toEqual({});
    expect(ler('   ')).toEqual({});
  });
  it('só a hora: nada de dia, tipo ou duração', () => {
    expect(ler('15h')).toEqual({ hora: '15:00' });
  });
  it('palavras soltas são ignoradas', () => {
    expect(ler('marcar algo com alguém')).toEqual({});
  });
});
