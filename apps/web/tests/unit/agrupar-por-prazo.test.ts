import { describe, expect, it } from 'vitest';
import {
  AGRUPAMENTO_PADRAO_DAS_TAREFAS, VISTA_PADRAO_DE_MINHAS_TAREFAS, VistaMinhasTarefasSchema,
  agruparTarefas, grupoPorPrazo, gruposPorPrazoDaSemana,
} from '@mktos/shared';

/*
 * Layout 26/10 (Lucas): o "Por prazo" no estilo do ClickUp, por dia de São Paulo, com a
 * semana de segunda a domingo. "Hoje" fixo: quarta, 28/10/2026, meio-dia em São Paulo.
 */
const AGORA = new Date('2026-10-28T15:00:00.000Z');
const dia = (d: string) => `${d}T15:00:00.000Z`;
const t = (titulo: string, prazo: string | null, statusTipo = 'open') => ({
  titulo, status: 'A fazer', statusTipo, lista: 'Rotina', cliente: null, prioridade: 'normal', prazo: prazo ? dia(prazo) : null, criadaEm: '',
});

describe('Layout 26/10: os grupos "Por prazo"', () => {
  it('cada tarefa no seu grupo: atrasada, hoje, amanhã, os dias da semana pelo nome, próxima semana, mais tarde, sem prazo, concluída', () => {
    expect(grupoPorPrazo(dia('2026-10-27'), 'open', AGORA)).toBe('atrasadas');
    expect(grupoPorPrazo(dia('2026-10-28'), 'open', AGORA)).toBe('hoje');
    // Às 23h30 de hoje em São Paulo o UTC já é amanhã, e continua sendo hoje.
    expect(grupoPorPrazo('2026-10-29T02:30:00.000Z', 'open', AGORA)).toBe('hoje');
    expect(grupoPorPrazo(dia('2026-10-29'), 'open', AGORA)).toBe('amanha');
    expect(grupoPorPrazo(dia('2026-10-30'), 'open', AGORA)).toBe('semana-5');
    expect(grupoPorPrazo(dia('2026-11-01'), 'open', AGORA)).toBe('semana-0');
    expect(grupoPorPrazo(dia('2026-11-02'), 'open', AGORA)).toBe('proxima-semana');
    expect(grupoPorPrazo(dia('2026-11-08'), 'open', AGORA)).toBe('proxima-semana');
    expect(grupoPorPrazo(dia('2026-11-09'), 'open', AGORA)).toBe('mais-tarde');
    expect(grupoPorPrazo(null, 'open', AGORA)).toBe('sem-prazo');
    expect(grupoPorPrazo(dia('2026-10-20'), 'closed', AGORA)).toBe('concluidas');
  });

  it('os rótulos e o dia que a tarefa nova recebe em cada grupo', () => {
    const g = gruposPorPrazoDaSemana(AGORA);
    expect(g.map((x) => x.rotulo)).toEqual([
      'Atrasadas', 'Hoje', 'Amanhã', 'sexta-feira', 'sábado', 'domingo', 'Próxima semana', 'Mais tarde', 'Sem prazo', 'Concluídas',
    ]);
    expect(Object.fromEntries(g.map((x) => [x.chave, x.dia]))).toMatchObject({
      atrasadas: null, hoje: '2026-10-28', amanha: '2026-10-29', 'semana-5': '2026-10-30', 'semana-0': '2026-11-01',
      'proxima-semana': '2026-11-02', 'mais-tarde': '2026-11-09', 'sem-prazo': null, concluidas: null,
    });
    // No domingo não há "Amanhã" nesta semana: segunda já é a próxima semana.
    expect(gruposPorPrazoDaSemana(new Date('2026-11-01T15:00:00.000Z')).map((x) => x.chave)).toEqual(['atrasadas', 'hoje', 'proxima-semana', 'mais-tarde', 'sem-prazo', 'concluidas']);
  });

  it('agrupa na ordem, some o grupo vazio (menos Hoje) e mantém a ordem de dentro', () => {
    const grupos = agruparTarefas([
      t('Sem data', null), t('Sexta B', '2026-10-30'), t('Atrasada', '2026-10-01'), t('Sexta A', '2026-10-30'), t('Feita', '2026-10-28', 'closed'),
    ], 'datas', AGORA);
    expect(grupos.map((g) => [g.rotulo, g.itens.map((x) => x.titulo)])).toEqual([
      ['Atrasadas', ['Atrasada']], ['Hoje', []], ['sexta-feira', ['Sexta B', 'Sexta A']], ['Sem prazo', ['Sem data']], ['Concluídas', ['Feita']],
    ]);
    expect(grupos.find((g) => g.chave === 'semana-5')?.dia).toBe('2026-10-30');
  });

  it('"Por prazo" é o padrão das listas de tarefa; o responsável da vista aceita uma pessoa, e as vistas antigas seguem valendo', () => {
    expect(AGRUPAMENTO_PADRAO_DAS_TAREFAS).toBe('datas');
    expect(VISTA_PADRAO_DE_MINHAS_TAREFAS.agrupamento).toBe('datas');
    const comPessoa = { ...VISTA_PADRAO_DE_MINHAS_TAREFAS, filtros: { ...VISTA_PADRAO_DE_MINHAS_TAREFAS.filtros, responsavel: '11111111-1111-4111-8111-111111111111' } };
    expect(VistaMinhasTarefasSchema.safeParse(comPessoa).success).toBe(true);
    expect(VistaMinhasTarefasSchema.safeParse({ ...VISTA_PADRAO_DE_MINHAS_TAREFAS, agrupamento: 'nenhum', filtros: { ...comPessoa.filtros, responsavel: 'qualquer' } }).success).toBe(true);
    expect(VistaMinhasTarefasSchema.safeParse({ ...comPessoa, filtros: { ...comPessoa.filtros, responsavel: 'Pedro' } }).success).toBe(false);
  });

  it('"Por responsável" junta pelo nome, com "Sem responsável" no fim', () => {
    const grupos = agruparTarefas([
      { ...t('Uma', null), responsavel: 'Pedro' }, { ...t('Duas', null), responsavel: null }, { ...t('Três', null), responsavel: 'Ana' },
    ], 'responsavel', AGORA);
    expect(grupos.map((g) => g.rotulo)).toEqual(['Ana', 'Pedro', 'Sem responsável']);
  });
});
