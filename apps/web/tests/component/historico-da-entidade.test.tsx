import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACOES_DO_MENU_DA_TAREFA, ROTULO_DA_ACAO_DA_TAREFA } from '@mktos/shared';

/*
 * O HISTÓRICO DA ENTIDADE E O ITEM "HISTÓRICO" DO MENU (leva 5, L2, 27/10/2026).
 *
 *  1. as funções puras: as chaves que mudaram entre o antes e o depois (antes → depois),
 *     o fallback para JSON quando um lado não é objeto, quem fez (nome, id curto, sistema);
 *  2. a janela lê `GET /audit?entidade=&tipo=&limit=100` e mostra do mais novo ao mais
 *     velho: quando, quem, a ação e as mudanças; sem `auditoria.ver` diz a frase, nunca erro;
 *  3. no menu da tarefa, "Histórico" é a nona ação e abre a janela com o tipo `work_task`;
 *     a janela sobrevive ao menu fechar.
 */

const get = vi.fn(), post = vi.fn(), patch = vi.fn(), del = vi.fn();
vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => get(...a), apiPost: (...a: unknown[]) => post(...a),
    apiPatch: (...a: unknown[]) => patch(...a), apiDelete: (...a: unknown[]) => del(...a), apiBlob: vi.fn(),
  };
});
let permissoes = ['tarefas.ver', 'tarefas.editar', 'auditoria.ver'];
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'eu', roles: ['analista'] }, can: (p: string) => permissoes.includes(p) }) }));

import { ErroDaApi } from '@/lib/api';
import {
  HistoricoDaEntidade, HISTORICO_VAZIO, SEM_PERMISSAO_PARA_O_HISTORICO, mudancasEntre, quemLegivel, valorLegivel,
} from '@/components/historico/HistoricoDaEntidade';
import HistoricoPadrao from '@/components/historico/HistoricoDaEntidade';
import { BotaoDoMenuDaTarefa, MenuDaTarefaProvider } from '@/components/trabalho/MenuDaTarefa';

const T = '11111111-1111-4111-8111-111111111111';
const linha = (id: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
  id, actorType: 'user', actorName: 'Lucas', action: 'work.task.update', entityType: 'work_task', entityId: T, ip: null, createdAt, ...extra,
});

beforeEach(() => {
  permissoes = ['tarefas.ver', 'tarefas.editar', 'auditoria.ver'];
  get.mockReset(); post.mockReset(); patch.mockReset(); del.mockReset();
  get.mockImplementation((rota: string) => {
    if (rota.startsWith('/audit?')) {
      return Promise.resolve({
        items: [
          linha('a1', '2026-10-27T10:00:00.000Z', { before: { title: 'Pagar boleto', priority: 'normal' }, after: { title: 'Pagar o boleto', priority: 'normal' } }),
          linha('a2', '2026-10-27T12:00:00.000Z', { actorType: 'system', actorName: 'system', action: 'work.task.restore', before: { archived: true }, after: { archived: false } }),
          linha('a0', '2026-10-26T09:00:00.000Z', { action: 'work.task.create', after: { title: 'Pagar boleto' } }),
        ],
        total: 3, source: { tool: 'banco-interno', generatedAt: '2026-10-27T12:00:00.000Z' },
      });
    }
    if (rota === `/trabalho/tarefas/${T}`) return Promise.resolve({ id: T, title: 'Pagar boleto', listId: 'l1', updatedAt: '2026-10-27T10:00:00.000Z', archived: false, excluidaEm: null, agenteId: null, parentId: null });
    if (rota === '/trabalho/estrutura') return Promise.resolve({ folders: [], listasSoltas: [] });
    if (rota.startsWith('/tenants/onboarding/trilhos?')) return Promise.resolve([]);
    return Promise.resolve(null);
  });
});
afterEach(cleanup);

describe('L2: as funções puras do histórico', () => {
  it('as chaves que mudaram, na ordem, com antes → depois; iguais ficam de fora', () => {
    expect(mudancasEntre({ a: 1, b: 'x', c: [1] }, { a: 1, b: 'y', d: true })).toEqual([
      { chave: 'b', antes: 'x', depois: 'y' },
      { chave: 'c', antes: [1], depois: undefined },
      { chave: 'd', antes: undefined, depois: true },
    ]);
    expect(mudancasEntre({ a: { x: 1 } }, { a: { x: 1 } })).toEqual([]);
  });
  it('um lado que não é objeto cai no JSON inteiro (nulo)', () => {
    expect(mudancasEntre(undefined, { a: 1 })).toBeNull();
    expect(mudancasEntre('texto', { a: 1 })).toBeNull();
    expect(mudancasEntre([1], [2])).toBeNull();
  });
  it('o valor legível e quem fez', () => {
    expect(valorLegivel(undefined)).toBe('(vazio)');
    expect(valorLegivel(null)).toBe('(nulo)');
    expect(valorLegivel('')).toBe('(texto vazio)');
    expect(valorLegivel({ a: 1 })).toBe('{"a":1}');
    expect(quemLegivel({ actorType: 'user', actorName: 'Lucas' })).toBe('Lucas');
    expect(quemLegivel({ actorType: 'user', actorName: '0a0a0a0a-0000-4000-8000-000000000001' })).toBe('0a0a0a0a');
    expect(quemLegivel({ actorType: 'user', actorName: null })).toBe('alguém (sem registro)');
    expect(quemLegivel({ actorType: 'system', actorName: 'system' })).toBe('sistema');
    expect(quemLegivel({ actorType: 'ai', actorName: 'editor' })).toBe('agente editor');
  });
  it('o export padrão é o mesmo componente (o contrato do Comercial)', () => {
    expect(HistoricoPadrao).toBe(HistoricoDaEntidade);
  });
});

describe('L2: a janela do histórico', () => {
  it('lê /audit com entidade, tipo e limite e mostra do mais novo ao mais velho, com as mudanças', async () => {
    const fechar = vi.fn();
    render(<HistoricoDaEntidade entityId={T} entityType="work_task" titulo="Pagar boleto" aberto onFechar={fechar} />);
    const janela = await screen.findByTestId('historico-da-entidade');
    expect(get).toHaveBeenCalledWith(`/audit?entidade=${T}&limit=100&tipo=work_task`, 'tok');
    const linhas = await within(janela).findAllByTestId(/^historico-linha-/);
    expect(linhas.map((l) => l.getAttribute('data-testid'))).toEqual(['historico-linha-a2', 'historico-linha-a1', 'historico-linha-a0']);
    // quem, a ação e a mudança chave a chave
    expect(within(linhas[0]).getByText('sistema')).toBeInTheDocument();
    expect(within(linhas[0]).getByText('work.task.restore')).toBeInTheDocument();
    expect(within(janela).getByTestId('historico-mudanca-a1-title')).toHaveTextContent('title: Pagar boleto → Pagar o boleto');
    expect(within(janela).queryByTestId('historico-mudanca-a1-priority')).toBeNull();
    // a criação só tem o depois: cai no JSON inteiro
    expect(within(linhas[2]).getByText('depois')).toBeInTheDocument();
    expect(within(linhas[2]).getByText('{"title":"Pagar boleto"}')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(fechar).toHaveBeenCalled();
  });

  it('sem auditoria.ver diz a frase, sem chamar a API; a recusa 403 da API diz a mesma frase', async () => {
    permissoes = ['tarefas.ver'];
    render(<HistoricoDaEntidade entityId={T} aberto onFechar={() => undefined} />);
    expect(await screen.findByTestId('historico-sem-permissao')).toHaveTextContent(SEM_PERMISSAO_PARA_O_HISTORICO);
    expect(get).not.toHaveBeenCalled();
    cleanup();
    permissoes = ['tarefas.ver', 'auditoria.ver'];
    get.mockImplementation(() => Promise.reject(new ErroDaApi('Forbidden', 403)));
    render(<HistoricoDaEntidade entityId={T} aberto onFechar={() => undefined} />);
    expect(await screen.findByTestId('historico-sem-permissao')).toHaveTextContent(SEM_PERMISSAO_PARA_O_HISTORICO);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sem linhas, diz que não há ação registrada; fechado, não desenha nada', async () => {
    get.mockImplementation(() => Promise.resolve({ items: [], total: 0, source: { tool: 'banco-interno', generatedAt: '' } }));
    const { unmount } = render(<HistoricoDaEntidade entityId={T} aberto onFechar={() => undefined} />);
    expect(await screen.findByTestId('historico-vazio')).toHaveTextContent(HISTORICO_VAZIO);
    unmount();
    render(<HistoricoDaEntidade entityId={T} aberto={false} onFechar={() => undefined} />);
    expect(screen.queryByTestId('historico-da-entidade')).toBeNull();
  });
});

describe('L2: "Histórico" no menu da tarefa', () => {
  it('é a nona ação; abre a janela com o tipo work_task e o menu fecha', async () => {
    render(
      <MenuDaTarefaProvider onMudou={() => undefined}>
        <BotaoDoMenuDaTarefa tarefa={{ id: T, title: 'Pagar boleto', listId: 'l1' }} />
      </MenuDaTarefaProvider>,
    );
    fireEvent.click(screen.getByTestId(`menu-da-tarefa-botao-${T}`));
    const menu = await screen.findByTestId('menu-da-tarefa');
    expect(within(menu).getAllByRole('menuitem').map((m) => m.firstChild?.textContent)).toEqual(ACOES_DO_MENU_DA_TAREFA.map((x) => ROTULO_DA_ACAO_DA_TAREFA[x]));
    const item = within(menu).getByTestId('menu-da-tarefa-historico');
    expect(item).not.toHaveAttribute('aria-disabled');
    fireEvent.click(item);
    const janela = await screen.findByTestId('historico-da-entidade');
    await waitFor(() => expect(screen.queryByTestId('menu-da-tarefa')).toBeNull());
    expect(get).toHaveBeenCalledWith(`/audit?entidade=${T}&limit=100&tipo=work_task`, 'tok');
    // O título da tarefa vai no subtítulo da janela (o texto também aparece nas mudanças: por isso pelo `title`).
    expect(within(janela).getByTitle('Pagar boleto')).toBeInTheDocument();
    fireEvent.click(within(janela).getByRole('button', { name: 'Fechar o histórico' }));
    await waitFor(() => expect(screen.queryByTestId('historico-da-entidade')).toBeNull());
  });

  it('sem tarefas.editar o Histórico continua habilitado (é só leitura)', async () => {
    permissoes = ['tarefas.ver', 'auditoria.ver'];
    render(
      <MenuDaTarefaProvider onMudou={() => undefined}>
        <BotaoDoMenuDaTarefa tarefa={{ id: T, title: 'Pagar boleto' }} />
      </MenuDaTarefaProvider>,
    );
    fireEvent.click(screen.getByTestId(`menu-da-tarefa-botao-${T}`));
    const menu = await screen.findByTestId('menu-da-tarefa');
    expect(within(menu).getByTestId('menu-da-tarefa-renomear')).toHaveAttribute('aria-disabled', 'true');
    expect(within(menu).getByTestId('menu-da-tarefa-historico')).not.toHaveAttribute('aria-disabled');
  });
});
