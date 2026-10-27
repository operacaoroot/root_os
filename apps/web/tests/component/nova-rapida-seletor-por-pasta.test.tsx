import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...real, apiGet: vi.fn(async () => []), apiPost: vi.fn() };
});
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ token: 'tok', ready: true, user: { id: 'u-eu', name: 'Lucas', email: 'l@x.com', roles: [], permissions: [] }, can: () => true }),
}));

// eslint-disable-next-line import/first
import { NovaTarefaRapida } from '@/components/trabalho/NovaTarefaRapida';
// eslint-disable-next-line import/first
import type { TrabListaDto } from '@mktos/shared';

/*
 * Layout 27/10 (Lucas: "as pastas que aparecem aqui são diferentes das que aparecem em
 * Tarefas"): o seletor de lista da nova tarefa rápida agrupa pela pasta da árvore, na
 * ordem dela, e deixa de fora as listas do Arquivo do ClickUp.
 */

const lista = (id: string, name: string, extra: Partial<TrabListaDto> = {}): TrabListaDto =>
  ({ id, name, order: 0, externalId: null, total: 0, spaceId: null, statuses: [], fields: [], ...extra });

describe('nova tarefa rápida: o seletor de lista com as pastas do Trabalho', () => {
  it('agrupa por pasta (Pai › Filha), na ordem da árvore, sem as do Arquivo do ClickUp', () => {
    const onboarding = lista('l-onb', 'Onboarding');
    const operacao = lista('l-ops', 'Operação');
    const adm = lista('l-adm', 'Administrativo');
    const copy = lista('l-copy', 'Copy', { arquivoDoClickUp: true });
    const comercial = lista('l-com', 'Tarefas do comercial', { externalId: 'comercial:tarefas' });
    render(
      <NovaTarefaRapida
        listas={[adm, onboarding, operacao, copy, comercial]}
        pastas={[
          { id: 'p-com', name: 'Comercial', parentId: null, lists: [] },
          { id: 'p-ops', name: 'Operação', parentId: null, lists: [operacao] },
          { id: 'p-cli', name: 'Clientes', parentId: 'p-ops', lists: [onboarding] },
          { id: 'p-adm', name: 'Administrativo', parentId: null, lists: [adm] },
          { id: 'p-arq', name: 'Arquivo do ClickUp', parentId: null, lists: [copy] },
        ]}
        pessoas={[]}
        token="tok"
        onDone={() => {}}
        onErro={() => {}}
        testid="nova"
      />,
    );
    const sel = screen.getByTestId('nova-lista');
    const grupos = [...sel.querySelectorAll('optgroup')].map((g) => [g.label, [...g.querySelectorAll('option')].map((o) => o.textContent)]);
    expect(grupos).toEqual([
      ['Comercial', ['Tarefas do comercial']],
      ['Operação', ['Operação']],
      ['Operação › Clientes', ['Onboarding']],
      ['Administrativo', ['Administrativo']],
    ]);
    expect(sel.textContent).not.toContain('Copy');
  });
});
