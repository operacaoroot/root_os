import { describe, it, expect } from 'vitest';
import { NAV, NAV_DETALHE, SECOES, navPorSecao } from '@mktos/shared';

/*
 * Trava de regressão da migração do painel para a identidade ROOT OS.
 *
 * A migração renomeou rótulos (Painel→Console, Obsidian→Contexto,
 * WhatsApp→Atendimento, Auditoria→Rastro…), trocou ícones e agrupou o menu em
 * seções. O que NÃO podia mudar é o que está congelado aqui: as 27 rotas, a
 * permissão de cada uma e a fase. Se alguém afrouxar uma permissão ou sumir com
 * um módulo do menu, é aqui que quebra.
 */
const CONGELADO: [chave: string, href: string, permissao: string, fase: number][] = [
  ['dashboard', '/painel', 'dashboard.ver', 1],
  ['obsidian', '/obsidian', 'obsidian.ver', 2],
  ['documentos', '/documentos', 'drive.ver', 5],
  ['ia', '/ia', 'mcp.ver', 7],
  ['relatorios', '/relatorios', 'relatorios.ver', 2],
  ['trabalho', '/trabalho', 'tarefas.ver', 2],
  ['tarefas', '/tarefas', 'tarefas.ver', 3],
  ['automacoes', '/automacoes', 'automacoes.ver', 3],
  ['leads', '/leads', 'leads.ver', 2],
  ['funil', '/funil', 'dashboard.ver', 2],
  ['campanhas', '/campanhas', 'campanhas.ver', 2],
  ['pixels', '/pixels', 'dashboard.ver', 2],
  ['vendas', '/vendas', 'dashboard.ver', 2],
  ['conteudo', '/conteudo', 'dashboard.ver', 2],
  ['pauta', '/pauta', 'pauta.ver', 4],
  ['referencias', '/referencias', 'pauta.ver', 4],
  ['instagram', '/instagram', 'instagram.ver', 4],
  ['bio', '/bio', 'bio.ver', 4],
  ['metas', '/metas', 'dashboard.ver', 4],
  ['financeiro', '/financeiro', 'financeiro.ver', 2],
  ['whatsapp', '/whatsapp', 'whatsapp.enviar', 6],
  ['usuarios', '/usuarios', 'admin.usuarios', 1],
  ['auditoria', '/auditoria', 'auditoria.ver', 1],
  ['mcp', '/mcp', 'mcp.ver', 7],
  ['integracoes', '/integracoes', 'dashboard.ver', 2],
  ['google', '/google', 'dashboard.ver', 2],
  ['config', '/config', 'dashboard.ver', 1],
];

describe('NAV — nenhum módulo pode sumir do menu', () => {
  it('mantém as 27 rotas com a mesma permissão e a mesma fase', () => {
    const real = NAV.map((n) => [n.key, n.href, n.permission, n.phase]).sort();
    expect(real).toEqual([...CONGELADO].sort());
  });

  it('não repete chave nem rota', () => {
    expect(new Set(NAV.map((n) => n.key)).size).toBe(NAV.length);
    expect(new Set(NAV.map((n) => n.href)).size).toBe(NAV.length);
  });

  it('todo módulo tem rótulo, ícone e uma seção que existe', () => {
    const chaves = new Set(SECOES.map((s) => s.key));
    for (const n of NAV) {
      expect(n.label.trim(), n.key).not.toBe('');
      expect(n.icon.trim(), n.key).not.toBe('');
      expect(chaves.has(n.secao), `${n.key} aponta para seção inexistente`).toBe(true);
    }
  });

  it('as rotas de detalhe herdam a permissão do módulo pai', () => {
    for (const d of NAV_DETALHE) {
      const pai = NAV.find((n) => n.key === d.parentKey);
      expect(pai, d.href).toBeDefined();
      expect(d.permission).toBe(pai!.permission);
    }
  });
});

describe('navPorSecao — o agrupamento não pode virar um filtro', () => {
  it('com todas as permissões devolve exatamente os 27 módulos, sem repetir', () => {
    const todas = new Set(NAV.map((n) => n.permission));
    const itens = navPorSecao(todas).flatMap((g) => g.itens);
    expect(itens).toHaveLength(NAV.length);
    expect(new Set(itens.map((i) => i.key)).size).toBe(NAV.length);
  });

  it('preserva a ordem das seções e a ordem do NAV dentro de cada uma', () => {
    const todas = new Set(NAV.map((n) => n.permission));
    const grupos = navPorSecao(todas);
    const ordemSecoes = SECOES.map((s) => s.key).filter((k) => NAV.some((n) => n.secao === k));
    expect(grupos.map((g) => g.secao.key)).toEqual(ordemSecoes);
    expect(grupos.flatMap((g) => g.itens.map((i) => i.key))).toEqual(
      ordemSecoes.flatMap((k) => NAV.filter((n) => n.secao === k).map((n) => n.key)),
    );
  });

  it('sem permissão nenhuma não devolve seção nenhuma', () => {
    expect(navPorSecao(new Set())).toEqual([]);
  });

  it('mostra só o que a permissão libera e descarta a seção que ficaria vazia', () => {
    const grupos = navPorSecao(new Set(['leads.ver']));
    expect(grupos).toHaveLength(1);
    expect(grupos[0].secao.key).toBe('entra');
    expect(grupos[0].itens.map((i) => i.key)).toEqual(['leads']);
  });

  it('aceita array, e não só Set', () => {
    expect(navPorSecao(['admin.usuarios']).flatMap((g) => g.itens.map((i) => i.key))).toEqual([
      'usuarios',
    ]);
  });
});

describe('SECOES', () => {
  it('não tem seção órfã: toda seção declarada tem pelo menos um módulo', () => {
    for (const s of SECOES) {
      expect(NAV.some((n) => n.secao === s.key), `seção "${s.key}" sem módulo`).toBe(true);
    }
  });

  it('toda seção tem rótulo e dica — a dica vira o subtítulo de fallback na Topbar', () => {
    for (const s of SECOES) {
      expect(s.label.trim()).not.toBe('');
      expect(s.hint.trim()).not.toBe('');
    }
  });
});
