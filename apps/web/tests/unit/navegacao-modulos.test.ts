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
  it('Operação da Root depende da confirmação da plataforma e mora em Dia a dia sem tomar a entrada', () => {
    expect(modulosDeNavegacao(permissoes).flatMap((area) => area.itens).some((i) => i.key === 'operacao')).toBe(false);
    const semPlataforma = modulosDeNavegacao(permissoes).find((area) => area.key === 'dia');
    expect(semPlataforma?.itens.some((item) => item.key === 'operacao')).toBe(false);
    const dia = modulosDeNavegacao(permissoes, undefined, true).find((area) => area.key === 'dia');
    expect(dia?.entrada?.key).toBe('caixa');
    expect(dia?.itens.at(-1)?.key).toBe('operacao');
    expect(destinoDaRota('/operacao')).toBeUndefined();
    expect(areaDoDestino(destinoDaRota('/operacao?rodada=2026-10-14', true)!)?.key).toBe('dia');
  });
});
