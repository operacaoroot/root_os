import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { moduloDaRotaDoWeb } from '@mktos/shared';
import { destinoDaProducao, destinoDepoisDoLogin, ENTRADA_DO_DIA_A_DIA } from '@/lib/destino-do-login';

/*
 * Revisão final, achado 2.1: o login só manda ao Dia a dia quem tem `tarefas.ver`
 * E o módulo `trabalho` contratado. Sem o módulo, ou sem saber os módulos, vale a
 * regra da produção (`lucas/tarefas`): Contexto, Marca ou o Painel geral.
 */
describe('para onde o login manda', () => {
  const comTarefas = ['tarefas.ver', 'obsidian.ver', 'dashboard.ver'];

  it('o Dia a dia é do módulo trabalho (é ele que a tela confere)', () => {
    expect(moduloDaRotaDoWeb(ENTRADA_DO_DIA_A_DIA)).toBe('trabalho');
  });

  it('tarefas.ver com o módulo trabalho contratado → Dia a dia', () => {
    expect(destinoDepoisDoLogin(comTarefas, ['trabalho', 'pauta'])).toBe('/dia-a-dia');
  });

  it('tarefas.ver SEM o módulo trabalho → a regra da produção, não "Módulo não contratado"', () => {
    expect(destinoDepoisDoLogin(comTarefas, ['pauta'])).toBe('/contexto');
    expect(destinoDepoisDoLogin(['tarefas.ver', 'pauta.ver'], [])).toBe('/contexto/marca');
    expect(destinoDepoisDoLogin(['tarefas.ver', 'dashboard.ver'], ['financeiro'])).toBe('/painel');
  });

  it('módulos desconhecidos (resposta falhou) → a regra da produção', () => {
    expect(destinoDepoisDoLogin(comTarefas, null)).toBe('/contexto');
  });

  it('sem tarefas.ver → a regra da produção, mesmo com o módulo', () => {
    expect(destinoDepoisDoLogin(['obsidian.ver'], ['trabalho'])).toBe('/contexto');
    expect(destinoDepoisDoLogin(['pauta.ver'], ['trabalho'])).toBe('/contexto/marca');
    expect(destinoDepoisDoLogin([], ['trabalho'])).toBe('/painel');
  });

  it('a regra da produção é a de lucas/tarefas', () => {
    expect(destinoDaProducao(['obsidian.ver', 'pauta.ver'])).toBe('/contexto');
    expect(destinoDaProducao(['pauta.ver'])).toBe('/contexto/marca');
    expect(destinoDaProducao([])).toBe('/painel');
  });

  it('a página de login usa a regra (não decide o destino por conta própria)', () => {
    const pagina = readFileSync(join(__dirname, '..', '..', 'src', 'app', 'login', 'page.tsx'), 'utf8');
    expect(pagina).toMatch(/destinoDepoisDoLogin\(/);
    expect(pagina).not.toMatch(/includes\('tarefas\.ver'\)\s*\?\s*'\/dia-a-dia'/);
  });
});
