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
  it('Propostas depende da confirmação da plataforma, não de permissões comuns', () => {
    expect(modulosDeNavegacao(permissoes).flatMap((area) => area.itens).some((i) => i.key === 'propostas')).toBe(false);
    const comercial = modulosDeNavegacao(permissoes, [], true).find((area) => area.key === 'comercial');
    expect(comercial?.itens.map((item) => item.key)).toEqual(['propostas']);
    expect(destinoDaRota('/propostas')).toBeUndefined();
    expect(areaDoDestino(destinoDaRota('/propostas', true)!)?.key).toBe('comercial');
  });
  // 19/10/2026: Dia a dia abre em Tarefas e termina em Operação (a implantação, com a
  // rodada semanal da ROOT dentro). /operacao segue viva, mas não é mais item de menu.
  it('Dia a dia abre em Tarefas e termina em Operação; a rodada da ROOT não vira item próprio', () => {
    for (const plataforma of [false, true]) {
      const dia = modulosDeNavegacao(permissoes, undefined, plataforma).find((area) => area.key === 'dia');
      expect(dia?.entrada?.key).toBe('tarefas-todas');
      expect(dia?.itens.at(-1)?.key).toBe('onboarding');
      expect(dia?.itens.some((item) => item.key === 'operacao' || item.key === 'caixa')).toBe(false);
    }
    expect(destinoDaRota('/operacao', true)).toBeUndefined();
    expect(areaDoDestino(destinoDaRota('/onboarding')!)?.key).toBe('dia');
  });
});
