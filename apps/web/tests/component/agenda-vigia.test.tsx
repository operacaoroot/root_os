import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ForaDoPadraoDaAgenda } from '@mktos/shared';

/*
 * O VIGIA DA AGENDA NA TELA `/agenda` (AG-01, rodada dos agentes, 21/10/2026):
 * o selo "N fora do padrão", a lista com a proposta de cada reunião, "Aprovar
 * aqui" pela mesma porta (e a tela dizendo que espera a segunda pessoa) e a
 * pendência respondida ali mesmo.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api')>('@/lib/api')),
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: (...args: unknown[]) => apiPost(...args),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ token: 'tok', ready: true, can: (p: string) => p === 'agenda.editar' || p === 'dashboard.ver' }),
}));
vi.mock('@/components/modulos', () => ({ useModulos: () => ({ modulos: [] }) }));

import AgendaPage from '@/app/agenda/page';

const VIGIA: ForaDoPadraoDaAgenda = {
  total: 2,
  ultimaPassagemEm: '2026-10-22T17:00:00.000Z',
  rotina: { ativa: true, estado: 'aprendendo', dispara: true },
  itens: [
    {
      eventoId: 'ev_modelo',
      tituloAtual: 'Call com o pessoal da Andrade',
      inicio: '2026-10-23T13:00:00.000Z',
      estado: 'proposta',
      problemas: ['o título não segue nenhuma das duas formas da casa'],
      tituloProposto: 'Reunião Online - Andrade Peças - Pedro',
      adicionarMeet: true,
      origem: 'modelo',
      aprovacao: null,
      pendencia: null,
      atualizadoEm: '2026-10-22T17:00:00.000Z',
    },
    {
      eventoId: 'ev_inventa',
      tituloAtual: 'Conversa importante',
      inicio: '2026-10-24T13:00:00.000Z',
      estado: 'pendencia',
      problemas: ['o título não segue nenhuma das duas formas da casa'],
      tituloProposto: null,
      adicionarMeet: false,
      origem: null,
      aprovacao: null,
      pendencia: {
        id: 'p1',
        opcoes: [
          { chave: 'o1', rotulo: 'Outro cliente · Pedro (online, com Meet; escreva o nome do cliente)', pedeNome: true },
          { chave: 'nao-e-reuniao', rotulo: 'Não é reunião' },
        ],
      },
      atualizadoEm: '2026-10-22T17:00:00.000Z',
    },
  ],
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-22T15:00:00.000Z'));
  apiGet.mockReset();
  apiPost.mockReset();
  apiGet.mockImplementation((path: string) => {
    if (path === '/agenda/fora-do-padrao') return Promise.resolve(VIGIA);
    return Promise.resolve([]);
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState({}, '', '/');
  delete (window as unknown as Record<string, unknown>).matchMedia;
});

describe('/agenda com o vigia', () => {
  it('mostra o selo "2 fora do padrão" e a lista com a proposta de cada uma', async () => {
    render(<AgendaPage />);
    await screen.findByText('2 fora do padrão');
    expect(apiGet).toHaveBeenCalledWith('/agenda/fora-do-padrao', 'tok');
    expect(screen.getByText('Call com o pessoal da Andrade')).toBeTruthy();
    expect(screen.getByText('Reunião Online - Andrade Peças - Pedro + Meet')).toBeTruthy();
    expect(screen.getByText(/O vigia não teve proposta segura: qual é o cliente\?/)).toBeTruthy();
  });

  it('"Aprovar aqui" vai à mesma porta e a tela diz que espera a OUTRA pessoa', async () => {
    apiPost.mockResolvedValue({ status: 'aguardando_aprovacao', approvalId: 'a1', precisaDeOutraPessoa: true, jaNaFila: false });
    render(<AgendaPage />);
    fireEvent.click(await screen.findByText('Aprovar aqui'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/agenda/padronizar/ev_modelo', {}, 'tok'));
    await screen.findByText(/espera a confirmação de OUTRA pessoa com alçada\. Nada mudou na agenda ainda\./);
    // A lista é relida depois do pedido.
    await waitFor(() => expect(apiGet.mock.calls.filter(([p]) => p === '/agenda/fora-do-padrao').length).toBeGreaterThanOrEqual(2));
  });

  it('a pendência se responde aqui: "outro cliente" leva o nome; "não é reunião" também vai à rota das pendências', async () => {
    apiPost.mockResolvedValue({ ok: true });
    render(<AgendaPage />);
    const campo = await screen.findByLabelText(/Outro cliente · Pedro/);
    fireEvent.change(campo, { target: { value: 'Fornecedor Novo' } });
    fireEvent.click(screen.getByTitle(/Outro cliente · Pedro/));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/pendencias/p1/responder', { escolha: 'o1', complemento: 'Fornecedor Novo' }, 'tok'));
    fireEvent.click(screen.getByText('Não é reunião'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/pendencias/p1/responder', { escolha: 'nao-e-reuniao' }, 'tok'));
  });

  it('sem nada fora do padrão: nem selo, nem lista', async () => {
    apiGet.mockImplementation((path: string) =>
      Promise.resolve(path === '/agenda/fora-do-padrao' ? { ...VIGIA, total: 0, itens: [] } : []),
    );
    render(<AgendaPage />);
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/agenda/fora-do-padrao', 'tok'));
    expect(screen.queryByText(/fora do padrão$/)).toBeNull();
    expect(document.getElementById('fora-do-padrao')).toBeNull();
  });
});
