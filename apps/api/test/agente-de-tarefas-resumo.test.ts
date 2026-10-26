import { describe, expect, it } from 'vitest';
import type { TarefaDoDia } from '@mktos/shared';

import { montarResumo, turnoDe } from '../src/work/agente-de-tarefas/resumo-do-grupo';

const EQUIPE = [{ id: 'l', nome: 'Lucas Rezende' }, { id: 'r', nome: 'Rodrigo' }, { id: 'p', nome: 'Pedro Magnago' }];

function t(titulo: string, pessoa: string | null, prazo: string | null, situacao: TarefaDoDia['situacao'], feita = false): TarefaDoDia {
  const p = EQUIPE.find((x) => x.id === pessoa) ?? null;
  return {
    id: titulo, titulo, area: null, cliente: null, pessoa: p, pessoas: p ? [p] : [], responsavelTexto: null,
    prazo, situacao, status: { nome: feita ? 'Feito' : 'A fazer', cor: '#000', tipo: feita ? 'concluida' : 'aberta' },
    lista: { id: 'x', nome: 'x' }, externalUrl: null, descricao: null, recorrencia: null, ordem: 0, updatedAt: '2026-10-26T10:00:00Z',
  };
}

const QUADRO = [
  t('Revisar contrato Custeio', 'p', '2026-10-24', 'atrasada'),
  t('Gravar reels', 'l', '2026-10-27', 'hoje'),
  t('Proposta Affari', 'l', '2026-10-28', 'proximos_7'),
  t('Enviar NF', 'p', '2026-10-27', 'hoje', true),
  t('Ligar pro contador', null, '2026-10-27', 'hoje'),
];

describe('resumo do grupo', () => {
  it('07h e 18h em Brasília caem em manhã e noite', () => {
    expect(turnoDe(new Date('2026-10-27T10:00:00Z'))).toBe('manha');
    expect(turnoDe(new Date('2026-10-27T21:00:00Z'))).toBe('noite');
  });

  it('de manhã: primeiro o atraso, depois o de hoje; concluída e futura fora', () => {
    const m = montarResumo('manha', '2026-10-27', EQUIPE, QUADRO);
    expect(m).toContain('Bom dia! Começo do dia (27/10)');
    expect(m).toContain('*Lucas*\n_Para hoje (1):_\n• Gravar reels');
    expect(m).toContain('*Rodrigo* — nada em atraso nem para hoje ✅');
    expect(m).toContain('*Pedro*\n_Em atraso (1):_\n• Revisar contrato Custeio — venceu 24/10 ⚠️');
    expect(m).not.toContain('Enviar NF');
    expect(m).not.toContain('Proposta Affari');
    expect(m).toContain('Sem responsável, vencendo: 1');
  });

  it('à noite: o resumo do que não foi feito', () => {
    const n = montarResumo('noite', '2026-10-27', EQUIPE, QUADRO);
    expect(n).toContain('Fechamento do dia (27/10): 2 tarefas ficaram sem fazer');
    expect(n).toContain('*Pedro* — não foi feita 1 (0 de hoje, 1 já vinha atrasada)');
    expect(n).toContain('*Lucas* — não foi feita 1 (1 de hoje)');
    expect(n).toContain('Amanhã vencem mais 1.');
    expect(n).toContain('*Rodrigo* — tudo de hoje feito ✅');
  });

  it('com o número, o bloco começa com o @ da pessoa', () => {
    const m = montarResumo('manha', '2026-10-27', [{ ...EQUIPE[0], mencao: '553291486277' }], QUADRO);
    expect(m).toContain('@553291486277\n_Para hoje (1):_');
  });
});
