import { describe, expect, it } from 'vitest';
import { NAV, navPorSecao, MODULOS } from '@mktos/shared';
import { ITENS_DA_ROOT, areaDoDestino, destinoDaRota, modulosDeNavegacao } from '@/components/navegacao-modulos';

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

  it('as áreas seguem a ordem das seções, com o WhatsApp depois do Comercial e o Contexto depois da IA', () => {
    expect(modulosDeNavegacao(permissoes).map((area) => area.key)).toEqual([
      'dia', 'trabalho', 'conteudo', 'comercial', 'whatsapp', 'financeiro', 'automacoes', 'empresa', 'resultados', 'configuracoes',
    ]);
  });

  // Rodada da interface (20/10/2026, U1, item 4): o Painel geral sai do Dia a dia.
  it('Dia a dia abre na Visão geral: Visão geral · Pendências · Aprovações · Agenda, sem o Painel geral', () => {
    for (const plataforma of [false, true]) {
      const dia = modulosDeNavegacao(permissoes, undefined, plataforma).find((area) => area.key === 'dia');
      expect(dia?.entrada?.key).toBe('tarefas-todas');
      expect(dia?.entrada?.href).toBe('/dia-a-dia');
      expect(dia?.itens.map((item) => item.key)).toEqual(['tarefas-todas', 'caixa', 'atendimento', 'agenda']);
      expect(dia?.itens.some((item) => item.key === 'operacao')).toBe(false);
    }
    // /painel segue com dono (o item oculto), na área Dia a dia; /painel/custo-ia é da IA.
    expect(destinoDaRota('/painel')?.key).toBe('console');
    expect(areaDoDestino(destinoDaRota('/painel')!)?.key).toBe('dia');
    expect(destinoDaRota('/operacao', true)).toBeUndefined();
    expect(areaDoDestino(destinoDaRota('/onboarding')!)?.key).toBe('trabalho');
  });

  // 20/10/2026 (noite, pedido do Rodrigo): o Todas é o chip de Tarefas, e o item sai do menu.
  // `/trabalho/todas` segue com dono (o item oculto), como `/painel` e `/comercial/simulador`.
  // Leva 5, L3 (27/10/2026): a Implantação saiu do menu (oculta, a rota segue viva); ficam Tarefas e Atas.
  it('Trabalho: Tarefas · Atas, e /trabalho/todas segue com dono', () => {
    const trabalho = modulosDeNavegacao(permissoes).find((area) => area.key === 'trabalho');
    expect(trabalho?.entrada?.key).toBe('trabalho');
    expect(trabalho?.itens.map((item) => item.label)).toEqual(['Tarefas', 'Atas']);
    // A rota mais longa vence: a rota antiga de Todas não se confunde com /trabalho.
    expect(destinoDaRota('/trabalho/todas')?.key).toBe('trabalho-todas');
    expect(destinoDaRota('/trabalho/todas?segmento=f1&pasta=todas')?.key).toBe('trabalho-todas');
    expect(destinoDaRota('/trabalho?pasta=todas')?.key).toBe('trabalho');
    expect(areaDoDestino(destinoDaRota('/trabalho/todas')!)?.key).toBe('trabalho');
  });

  it('WhatsApp é área própria, com um item, e /comercial/simulador continua dono da rota antiga', () => {
    const whatsapp = modulosDeNavegacao(permissoes).find((area) => area.key === 'whatsapp');
    expect(whatsapp).toMatchObject({ label: 'WhatsApp', icon: 'MessageCircle' });
    expect(whatsapp?.itens.map((item) => item.key)).toEqual(['whatsapp']);
    expect(whatsapp?.entrada?.href).toBe('/whatsapp');
    expect(areaDoDestino(destinoDaRota('/whatsapp?conversa=abc')!)?.key).toBe('whatsapp');
    const comercial = modulosDeNavegacao(permissoes).find((area) => area.key === 'comercial');
    expect(comercial?.itens.some((item) => item.key === 'comercial-simulador')).toBe(false);
    expect(destinoDaRota('/comercial/simulador')?.key).toBe('comercial-simulador');
    // Sem leads.ver, sem a área; sem o módulo leads, também.
    expect(modulosDeNavegacao(['dashboard.ver']).some((area) => area.key === 'whatsapp')).toBe(false);
    expect(modulosDeNavegacao(permissoes, ['trabalho']).some((area) => area.key === 'whatsapp')).toBe(false);
  });

  /*
   * Rodada da interface (20/10/2026, U1, item 10): a Rodada da semana mora no Comercial,
   * depois dos Contratos vivos, e só a sessão da plataforma a vê. Permissão comum não a
   * mostra: quem decide é `ehPlataforma` (a API de plataforma), como era na Implantação.
   */
  it('a Rodada da semana fica no Comercial, depois dos Contratos vivos, só para a plataforma', () => {
    const daPlataforma = modulosDeNavegacao(permissoes, undefined, true).find((area) => area.key === 'comercial');
    expect(daPlataforma?.itens.map((item) => item.label)).toEqual([
      'Painel geral', 'Funil de vendas', 'Propostas', 'Lista de leads', 'Contratos vivos',
      'Rodada da semana', 'Torre das automações', 'Relatório da semana',
    ]);
    expect(daPlataforma?.itens.find((item) => item.key === 'comercial-rodada')?.href).toBe('/comercial/rodada');
    expect(daPlataforma?.entrada?.key).toBe('comercial-painel');
    const deCliente = modulosDeNavegacao(permissoes, undefined, false).find((area) => area.key === 'comercial');
    expect(deCliente?.itens.some((item) => item.key === 'comercial-rodada')).toBe(false);
    // Nem com todas as permissões do NAV, nem só com a de plataforma sem módulo leads.
    expect(modulosDeNavegacao(permissoes, ['trabalho'], true).flatMap((a) => a.itens).some((i) => i.key === 'comercial-rodada')).toBe(false);
    expect(ITENS_DA_ROOT.map((item) => item.key)).toEqual(['comercial-rodada', 'frota']);
    expect(NAV.some((item) => item.key === 'comercial-rodada' || item.href === '/comercial/rodada')).toBe(false);
    // A rota: na plataforma é a Rodada; fora dela cai no Comercial pelo prefixo, sem item próprio.
    expect(destinoDaRota('/comercial/rodada', true)?.key).toBe('comercial-rodada');
    expect(destinoDaRota('/comercial/rodada', false)?.key).toBe('comercial-painel');
    expect(areaDoDestino(destinoDaRota('/comercial/rodada', true)!)?.key).toBe('comercial');
  });

  it('a Frota é área própria, só para a plataforma, depois da IA (27/10/2026)', () => {
    const semPlataforma = modulosDeNavegacao(permissoes).map((area) => area.key);
    expect(semPlataforma).not.toContain('frota');
    const comPlataforma = modulosDeNavegacao(permissoes, undefined, true);
    const frota = comPlataforma.find((area) => area.key === 'frota');
    expect(frota?.itens.map((item) => item.key)).toEqual(['frota']);
    expect(frota?.entrada?.href).toBe('/frota');
    const chaves = comPlataforma.map((area) => area.key);
    expect(chaves.indexOf('frota')).toBe(chaves.indexOf('automacoes') + 1);
  });

  it('Comercial abre no Painel geral', () => {
    const comercial = modulosDeNavegacao(permissoes).find((area) => area.key === 'comercial');
    expect(comercial?.entrada?.key).toBe('comercial-painel');
    expect(comercial?.entrada?.href).toBe('/comercial');
  });
});
