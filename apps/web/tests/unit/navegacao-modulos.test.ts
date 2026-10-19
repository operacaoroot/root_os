import { describe, expect, it } from 'vitest';
import { NAV, navPorSecao, MODULOS } from '@mktos/shared';
import { areaDoDestino, destinoDaRota, modulosDeNavegacao } from '@/components/navegacao-modulos';

const permissoes = [...new Set(NAV.map((item) => item.permission))];
describe('projeção do NAV em módulos', () => {
  it('cada destino permitido permanece uma única vez, sem alterar URL, permissão ou módulo', () => {
    const original = navPorSecao(permissoes).flatMap((grupo) => grupo.itens);
    const projetado = modulosDeNavegacao(permissoes).flatMap((area) => area.itens);
    expect(projetado).toHaveLength(original.length);
    expect(new Set(projetado.map((item) => item.key)).size).toBe(original.length);
    for (const item of original) expect(projetado.find((novo) => novo.key === item.key)).toBe(item);
  });
  it('preserva filtros para cada permissão individual e cada módulo desligado', () => {
    for (const permissao of permissoes) {
      for (const desligado of MODULOS) {
        const ligados = MODULOS.filter((modulo) => modulo !== desligado);
        const original = navPorSecao([permissao], ligados).flatMap((grupo) => grupo.itens).map((i) => i.key).sort();
        const projetado = modulosDeNavegacao([permissao], ligados).flatMap((grupo) => grupo.itens).map((i) => i.key).sort();
        expect(projetado).toEqual(original);
      }
    }
  });
  it('links profundos e query de fonte preservam a área proprietária', () => {
    expect(areaDoDestino(destinoDaRota('/contexto?nota=1&versao=2')!)?.key).toBe('empresa');
    expect(destinoDaRota('/contexto/marca/')?.key).toBe('marca');
    expect(areaDoDestino(destinoDaRota('/painel/custo-ia')!)?.key).toBe('automacoes');
    expect(destinoDaRota('/leads/123')?.key).toBe('leads');
    expect(destinoDaRota('/contextual')).toBeUndefined();
  });
  // Versão final (19/10/2026): Propostas é item do NAV (Comercial, leads.ver) e lê as
  // propostas da sala da empresa da sessão; na plataforma ela não se repete.
  it('Propostas é item do Comercial com leads.ver, uma vez só, com ou sem plataforma', () => {
    for (const plataforma of [false, true]) {
      const comercial = modulosDeNavegacao(permissoes, undefined, plataforma).find((area) => area.key === 'comercial');
      expect(comercial?.itens.filter((item) => item.key === 'propostas')).toHaveLength(1);
      expect(comercial?.itens.find((item) => item.key === 'propostas')?.permission).toBe('leads.ver');
    }
    expect(modulosDeNavegacao(['dashboard.ver']).flatMap((area) => area.itens).some((i) => i.key === 'propostas')).toBe(false);
    expect(areaDoDestino(destinoDaRota('/propostas')!)?.key).toBe('comercial');
  });

  it('as áreas seguem a ordem das seções, com Contexto depois da IA', () => {
    expect(modulosDeNavegacao(permissoes).map((area) => area.key)).toEqual([
      'dia', 'trabalho', 'conteudo', 'comercial', 'financeiro', 'automacoes', 'empresa', 'resultados', 'configuracoes',
    ]);
  });

  it('Dia a dia abre na Visão geral e mostra Pendências; a rodada da ROOT não vira item próprio', () => {
    for (const plataforma of [false, true]) {
      const dia = modulosDeNavegacao(permissoes, undefined, plataforma).find((area) => area.key === 'dia');
      expect(dia?.entrada?.key).toBe('tarefas-todas');
      expect(dia?.entrada?.href).toBe('/dia-a-dia');
      expect(dia?.itens.map((item) => item.key)).toEqual(['tarefas-todas', 'caixa', 'atendimento', 'agenda', 'console']);
      expect(dia?.itens.some((item) => item.key === 'operacao')).toBe(false);
    }
    expect(destinoDaRota('/operacao', true)).toBeUndefined();
    expect(areaDoDestino(destinoDaRota('/onboarding')!)?.key).toBe('trabalho');
  });

  it('Comercial abre no Painel geral', () => {
    const comercial = modulosDeNavegacao(permissoes).find((area) => area.key === 'comercial');
    expect(comercial?.entrada?.key).toBe('comercial-painel');
    expect(comercial?.entrada?.href).toBe('/comercial');
  });
});
