import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { comQuery, destinoDaAbaRodada, destinoDoSimulador } from '@/lib/rotas-movidas';

/* As rotas que mudaram de lugar na rodada da interface (20/10/2026, U1) não perdem a query. */

const ler = (...p: string[]) => readFileSync(join(__dirname, '..', '..', 'src', ...p), 'utf8');

describe('rotas movidas', () => {
  it('/comercial/simulador vai para /whatsapp com a mesma query', () => {
    expect(destinoDoSimulador({})).toBe('/whatsapp');
    expect(destinoDoSimulador({ conversa: 'lead-1' })).toBe('/whatsapp?conversa=lead-1');
    expect(destinoDoSimulador({ conversa: 'lead-1', lead: 'lead-1', aba: 'resumo' })).toBe('/whatsapp?conversa=lead-1&lead=lead-1&aba=resumo');
    expect(destinoDoSimulador({ x: ['1', '2'], vazio: undefined })).toBe('/whatsapp?x=1&x=2');
  });

  it('a aba antiga da rodada vai para o Comercial, sem a aba e com o resto', () => {
    expect(destinoDaAbaRodada({ aba: 'rodada', rodada: '2026-10-19' })).toBe('/comercial/rodada?rodada=2026-10-19');
    expect(destinoDaAbaRodada({ aba: 'outra' })).toBeNull();
  });

  it('comQuery codifica o que precisa', () => {
    expect(comQuery('/a', { q: 'a b&c' })).toBe('/a?q=a+b%26c');
  });

  it('as páginas usam os destinos: o simulador redireciona e a Implantação manda a aba antiga para o Comercial', () => {
    expect(ler('app', 'comercial', 'simulador', 'page.tsx')).toMatch(/redirect\(destinoDoSimulador\(/);
    expect(ler('app', 'trabalho', 'implantacao', 'page.tsx')).toMatch(/destinoDaAbaRodada\(/);
    const implantacao = ler('app', 'trabalho', 'implantacao', 'page.tsx');
    expect(implantacao).not.toMatch(/role="tablist"/);
    expect(implantacao).toMatch(/<TrabalhoView modo="implantacao" \/>/);
  });

  it('a área WhatsApp: título sem "simulador" e o texto de apoio do que a tela é hoje', () => {
    const pagina = ler('app', 'whatsapp', 'page.tsx');
    expect(pagina).toContain('O celular do lead e o da mesa, no provedor configurado.');
    expect(pagina).not.toMatch(/export default function Simulador/);
    // A rodada da semana no Comercial é a tela de /operacao, com a mesma trava.
    expect(ler('app', 'comercial', 'rodada', 'page.tsx')).toMatch(/import Operacao from '\.\.\/\.\.\/operacao\/page'/);
  });
});
