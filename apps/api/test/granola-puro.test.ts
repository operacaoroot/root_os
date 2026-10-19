import { describe, expect, it } from 'vitest';
import { caminhoDoGranola, casarCliente, normalizar, senhaConfere, type CardParaCasar } from '../src/ficha/granola.service';

/*
 * A regra que decide em que card cai a reunião do Granola. Pura: sem banco.
 * Os cards imitam o CRM da ROOT de 19/10/2026.
 */
const cards: CardParaCasar[] = [
  { id: 'agranel', titulo: 'Senhor aGranel (Felipe Fortes)', email: 'felipe@senhoragranel.com.br', site: null, empresa: 'Senhor aGranel', contato: 'Felipe Fortes' },
  { id: 'maisq', titulo: 'Mais Q Contabilidade (Danilo Lourenço)', email: null, site: 'https://www.maisq.com.br', empresa: 'Mais Q Contabilidade', contato: 'Danilo Lourenço' },
  { id: 'promedical', titulo: 'ProMedical (Alexandre Tostes)', email: null, site: null, empresa: 'Promedical Equipamentos Médicos', contato: 'Alexandre Tostes' },
  { id: 'custeio', titulo: 'Custeio (Lucas Martins da Costa Moreira)', email: 'lucas@gmail.com', site: null, empresa: 'Custeio', contato: 'Lucas Martins da Costa Moreira' },
];

const reuniao = (o: Record<string, unknown>) => normalizar({ transcript: 'x'.repeat(80), ...o } as never, new Date('2026-10-19T15:00:00Z'));

describe('Granola: normalizar o corpo do Zap', () => {
  it('aceita os nomes do Granola e os nossos', () => {
    const r = normalizar({
      title: 'Reunião com Danilo', transcript: 'fala fala', my_notes: 'pontos', attendees: ['Danilo <danilo@maisq.com.br>', 'Lucas <lucas@ferpin.com.br>'],
      share_link: 'https://notes.granola.ai/d/abc', start_time: '2026-10-19T13:00:00-03:00',
    } as never);
    expect(r.titulo).toBe('Reunião com Danilo');
    expect(r.transcricao).toContain('NOTAS\npontos');
    expect(r.transcricao).toContain('TRANSCRIÇÃO\nfala fala');
    expect(r.emails).toEqual(['danilo@maisq.com.br', 'lucas@ferpin.com.br']);
    expect(r.link).toBe('https://notes.granola.ai/d/abc');
    expect(r.em.toISOString()).toBe('2026-10-19T16:00:00.000Z');
  });

  it('participantes em texto também viram e-mails', () => {
    expect(reuniao({ participantes: 'Felipe (felipe@senhoragranel.com.br); Pedro' }).emails).toEqual(['felipe@senhoragranel.com.br']);
  });
});

describe('Granola: achar o cliente', () => {
  it('e-mail igual ao do card ganha', () => {
    expect(casarCliente(reuniao({ title: 'Call', attendees: 'felipe@senhoragranel.com.br' }), cards)).toMatchObject({ card: { id: 'agranel' }, porque: 'email' });
  });

  it('domínio do participante igual ao do site do card', () => {
    expect(casarCliente(reuniao({ title: 'Alinhamento', attendees: 'sheila@maisq.com.br' }), cards)).toMatchObject({ card: { id: 'maisq' }, porque: 'dominio' });
  });

  it('e-mail pessoal não casa por domínio (gmail é de todo mundo)', () => {
    expect(casarCliente(reuniao({ title: 'Conversa', attendees: 'outra.pessoa@gmail.com' }), cards)).toBeNull();
  });

  it('nome da empresa ou do contato no título', () => {
    expect(casarCliente(reuniao({ title: 'Retomada ProMedical - entregas' }), cards)).toMatchObject({ card: { id: 'promedical' }, porque: 'nome' });
    expect(casarCliente(reuniao({ title: 'Kickoff', attendees: 'Alexandre Tostes' }), cards)).toMatchObject({ card: { id: 'promedical' }, porque: 'nome' });
  });

  it('sem pista nenhuma, sem cliente (vai para a caixa)', () => {
    expect(casarCliente(reuniao({ title: 'Reunião interna da Root', attendees: 'pedro@operacaoroot.com' }), cards)).toBeNull();
  });
});

describe('Granola: a senha do Zap', () => {
  it('só a senha exata entra (sem senha guardada, nada entra)', () => {
    expect(senhaConfere('abc123', 'abc123')).toBe(true);
    expect(senhaConfere('abc123', ' abc123 ')).toBe(true);
    expect(senhaConfere('abc123', 'abc124')).toBe(false);
    expect(senhaConfere('abc123', 'abc12')).toBe(false);
    expect(senhaConfere('abc123', undefined)).toBe(false);
    expect(senhaConfere('', '')).toBe(false);
  });

  it('o endereço do Zap é por empresa', () => {
    expect(caminhoDoGranola('63cdd80e-0435-488d-98b5-c2653d235e50')).toBe('/api/trabalho/granola/63cdd80e-0435-488d-98b5-c2653d235e50');
  });
});
