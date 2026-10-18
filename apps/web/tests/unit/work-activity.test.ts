import { describe, expect, it } from 'vitest';
import { resumirAtividade } from '../../src/lib/work-activity';

describe('atividade de mudança de etapa', () => {
  it('usa os nomes fotografados no evento, sem depender da etapa atual da tarefa', () => {
    expect(resumirAtividade({action: 'work.task.update', before: {status: 'Triagem antiga'}, after: {status: 'Execução antiga'}}))
      .toBe('Etapa: Triagem antiga → Execução antiga');
  });

  it.each([
    [null, {status: 'Execução'}],
    [{status: 'Triagem'}, null],
    [{}, {status: 'Execução'}],
    [{status: 123}, {status: 'Execução'}],
    [{status: '   '}, {status: 'Execução'}],
    [[], {status: 'Execução'}],
    [{status: 'Triagem'}, {status: 'Triagem'}],
  ])('preserva o evento quando não há duas etapas distintas demonstradas (%j, %j)', (before, after) => {
    expect(resumirAtividade({action: 'work.task.update', before, after})).toBe('work.task.update');
  });

  it('preserva eventos de outros contratos mesmo que tenham campos status', () => {
    expect(resumirAtividade({action: 'work.comment.create', before: {status: 'Triagem'}, after: {status: 'Execução'}}))
      .toBe('work.comment.create');
  });
});
