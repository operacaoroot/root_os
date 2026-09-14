import { describe, expect, it } from 'vitest';
import type { LinhaDoTempoItem } from '@mktos/shared';
import {
  agruparPorDia,
  atorLegivel,
  chaveDoDia,
  rotuloDoDia,
} from '@/app/linha-do-tempo/dias';

/*
 * ==========================================================================
 * O AGRUPAMENTO POR DIA DA LINHA DO TEMPO — fatia A9
 * ==========================================================================
 *
 * O que esta suíte trava:
 *
 *  1. O DIA É O LOCAL, NÃO O UTC. A API roda em UTC no container; agrupar por
 *     `toISOString().slice(0,10)` faria um evento das 21h de Brasília aparecer
 *     sob o cabeçalho do dia seguinte, e o cabeçalho de dia é o que separa esta
 *     tela de `/rastro`;
 *  2. A ORDEM RECEBIDA É PRESERVADA. Ela é a da cadeia de hash (`seq` desc), e
 *     reordenar aqui seria discordar da ordem em que os fatos foram gravados;
 *  3. "HOJE" E "ONTEM" VÊM DE UM RELÓGIO PASSADO POR PARÂMETRO. Relógio
 *     implícito é o motivo pelo qual a suíte de Conexões está vermelha nesta
 *     árvore: um fixture com data fixa que envelheceu;
 *  4. O ATOR TEM TRÊS CASOS, e o terceiro é o que costuma virar mentira —
 *     `atorTipo: 'user'` com id e sem nome quer dizer "não é gente desta
 *     empresa", e a tela diz isso em vez de inventar nome.
 */

function item(over: Partial<LinhaDoTempoItem> = {}): LinhaDoTempoItem {
  return {
    id: 'e1',
    seq: '1',
    tipo: 'tool.resultado',
    rotulo: 'Ferramenta executada',
    familia: 'ferramenta',
    conhecido: true,
    ocorreuEm: '2026-09-14T12:00:00.000Z',
    atorTipo: 'ai',
    atorId: null,
    ator: null,
    agenteSlug: 'assistente',
    agenteNome: 'Assistente da central',
    capacidade: 'numeros.painel.ler',
    nivel: 'R0',
    correlacao: null,
    objeto: [],
    sensibilidade: null,
    registroCompleto: true,
    temConteudo: false,
    ...over,
  };
}

describe('A9: o dia é o do navegador, nunca o UTC', () => {
  it('`chaveDoDia` usa o fuso local — 21h de Brasília não vira o dia seguinte', () => {
    // Construído com os componentes locais de propósito: o teste não pode
    // depender do fuso da máquina para afirmar que o código não depende dele.
    const noite = new Date(2026, 8, 14, 21, 30, 0);
    expect(chaveDoDia(noite)).toBe('2026-09-14');
    // O contraste é o defeito que este caso impede.
    const comoSeFosseUtc = noite.toISOString().slice(0, 10);
    if (noite.getTimezoneOffset() > 0) expect(comoSeFosseUtc).not.toBe('2026-09-14');
  });

  it('zero-padding no mês e no dia — a chave é comparável como texto', () => {
    expect(chaveDoDia(new Date(2026, 0, 3))).toBe('2026-01-03');
  });

  it('"hoje" e "ontem" vêm do relógio PASSADO, não de `new Date()` por dentro', () => {
    const agora = new Date(2026, 8, 14, 10, 0, 0);
    expect(rotuloDoDia('2026-09-14', agora)).toBe('hoje');
    expect(rotuloDoDia('2026-09-13', agora)).toBe('ontem');
    expect(rotuloDoDia('2026-09-12', agora)).toContain('12/09/2026');
  });

  it('a virada do mês não quebra o "ontem"', () => {
    const primeiroDeOutubro = new Date(2026, 9, 1, 8, 0, 0);
    expect(rotuloDoDia('2026-09-30', primeiroDeOutubro)).toBe('ontem');
  });
});

describe('A9: o agrupamento preserva a ordem da cadeia', () => {
  it('agrupa por dia sem reordenar nada', () => {
    const agora = new Date(2026, 8, 14, 23, 0, 0);
    const dias = agruparPorDia(
      [
        item({ id: 'a', ocorreuEm: new Date(2026, 8, 14, 15, 0).toISOString() }),
        item({ id: 'b', ocorreuEm: new Date(2026, 8, 14, 9, 0).toISOString() }),
        item({ id: 'c', ocorreuEm: new Date(2026, 8, 13, 22, 0).toISOString() }),
      ],
      agora,
    );
    expect(dias.map((d) => d.rotulo)).toEqual(['hoje', 'ontem']);
    expect(dias[0].itens.map((i) => i.id)).toEqual(['a', 'b']);
    expect(dias[1].itens.map((i) => i.id)).toEqual(['c']);
  });

  it('dia repetido depois de um intervalo NÃO vira dois cabeçalhos', () => {
    const agora = new Date(2026, 8, 14, 23, 0, 0);
    const dias = agruparPorDia(
      [
        item({ id: 'a', ocorreuEm: new Date(2026, 8, 14, 15, 0).toISOString() }),
        item({ id: 'b', ocorreuEm: new Date(2026, 8, 13, 15, 0).toISOString() }),
        item({ id: 'c', ocorreuEm: new Date(2026, 8, 14, 1, 0).toISOString() }),
      ],
      agora,
    );
    expect(dias).toHaveLength(2);
    expect(dias[0].itens.map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('lista vazia dá lista vazia, sem cabeçalho de dia nenhum', () => {
    expect(agruparPorDia([], new Date())).toEqual([]);
  });
});

describe('A9: o ator tem três casos, e o terceiro não mente', () => {
  it('pessoa desta empresa aparece pelo nome', () => {
    expect(atorLegivel(item({ atorTipo: 'user', atorId: 'u1', ator: 'Pedro' }))).toBe('Pedro');
  });

  it('ponteiro que não resolve DIZ que é de fora — não inventa nome nem cala', () => {
    // Mesma regra de `agents/donos-da-casa.ts`: `Agent.slug` e o id do ator não
    // guardam a empresa, então nome resolvido sem `orgId` seria o do vizinho.
    expect(atorLegivel(item({ atorTipo: 'user', atorId: 'u-de-fora', ator: null }))).toBe(
      'alguém de fora desta empresa',
    );
  });

  it('IA aparece com o nome do agente, e cai no slug quando o nome não resolve', () => {
    expect(atorLegivel(item({ atorTipo: 'ai' }))).toBe('agente Assistente da central');
    expect(atorLegivel(item({ atorTipo: 'ai', agenteNome: null }))).toBe('agente assistente');
    expect(atorLegivel(item({ atorTipo: 'ai', agenteNome: null, agenteSlug: null }))).toBe('a IA');
  });

  it('sistema é o sistema, com ou sem agente', () => {
    expect(atorLegivel(item({ atorTipo: 'system', agenteSlug: null, agenteNome: null }))).toBe(
      'o sistema',
    );
    expect(atorLegivel(item({ atorTipo: 'system' }))).toBe('o sistema (Assistente da central)');
  });
});
