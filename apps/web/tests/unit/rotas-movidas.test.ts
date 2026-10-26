import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { comQuery, destinoDaAbaRodada, destinoDeTodas, destinoDoSimulador } from '@/lib/rotas-movidas';

/* As rotas que mudaram de lugar na rodada da interface (20/10/2026, U1) não perdem a query. */

const ler = (...p: string[]) => readFileSync(join(__dirname, '..', '..', 'src', ...p), 'utf8');

describe('rotas movidas', () => {
  // Produção 22C (W2): /whatsapp virou a caixa; os celulares moram em /whatsapp/simulador.
  it('/comercial/simulador vai para /whatsapp/simulador com a mesma query', () => {
    expect(destinoDoSimulador({})).toBe('/whatsapp/simulador');
    expect(destinoDoSimulador({ conversa: 'lead-1' })).toBe('/whatsapp/simulador?conversa=lead-1');
    expect(destinoDoSimulador({ conversa: 'lead-1', lead: 'lead-1', aba: 'resumo' })).toBe('/whatsapp/simulador?conversa=lead-1&lead=lead-1&aba=resumo');
    expect(destinoDoSimulador({ x: ['1', '2'], vazio: undefined })).toBe('/whatsapp/simulador?x=1&x=2');
  });

  // 20/10/2026 (noite, pedido do Rodrigo): o Todas é o chip de Tarefas.
  it('/trabalho/todas vai para o chip Todas de /trabalho, com a mesma query', () => {
    expect(destinoDeTodas({})).toBe('/trabalho?pasta=todas');
    expect(destinoDeTodas({ segmento: 'X', visao: 'lista' })).toBe('/trabalho?pasta=todas&segmento=X&visao=lista');
    // `pasta` é sempre todas, e `lista` (uma lista só) contradiz Todas.
    expect(destinoDeTodas({ pasta: 'p1', lista: 'l1', segmento: 'X' })).toBe('/trabalho?pasta=todas&segmento=X');
    expect(ler('app', 'trabalho', 'todas', 'page.tsx')).toMatch(/redirect\(destinoDeTodas\(/);
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

  it('a área WhatsApp: a caixa em /whatsapp e os celulares, inteiros, em /whatsapp/simulador', () => {
    const pagina = ler('app', 'whatsapp', 'simulador', 'page.tsx');
    expect(pagina).toContain('O celular do lead e o da mesa, no provedor configurado.');
    expect(pagina).not.toMatch(/export default function Simulador/);
    expect(ler('app', 'whatsapp', 'page.tsx')).toMatch(/<CaixaDoWhatsapp \/>/);
    // Layout 26/10: a rodada da semana no Comercial deixou de ser a tela de /operacao (a nota
    // escrita à mão); os números vêm da API que conta no banco.
    const rodada = ler('app', 'comercial', 'rodada', 'page.tsx');
    expect(rodada).not.toMatch(/import Operacao from/);
    expect(rodada).toMatch(/\/comercial\/rodada-da-semana/);
  });
});
