import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import type { AvataresDaEmpresa, PainelDeTarefas, TarefaDoDia } from '@mktos/shared';

/*
 * O RESPONSÁVEL SÓ COM A IMAGEM (produção 22B, I6).
 *
 *  · a pilha: um avatar por responsável, sobrepostos, "+N" passando do teto,
 *    o nome no balão e no nome acessível; ninguém = o círculo tracejado com a
 *    frase da tela;
 *  · o cartão do Trabalho: o principal e os demais, com o e-mail e o
 *    "(inativo)" no balão, como o texto de antes;
 *  · a célula do Funil em lista: o mesmo balão próprio, agora com a foto;
 *  · sem permissão para a lista da empresa (ou resposta fora do formato), as
 *    iniciais, sem erro na tela.
 */

const apiGet = vi.fn();
const apiBlob = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiBlob: (...a: unknown[]) => apiBlob(...a),
  };
});

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ token: 'tok', ready: true, user: { id: 'u-a' }, can: () => true }),
}));

// eslint-disable-next-line import/first
import { PilhaDeAvatares } from '@/components/PilhaDeAvatares';
// eslint-disable-next-line import/first
import { AvataresDaTarefa } from '@/components/trabalho/ResponsavelDaTarefa';
// eslint-disable-next-line import/first
import { CelulaDoResponsavel } from '@/app/comercial/_funil/CelulaDoResponsavel';
// eslint-disable-next-line import/first
import { esquecerAvatares } from '@/lib/avatares';
// eslint-disable-next-line import/first
import { TarefasDoDia } from '@/components/tarefas/TarefasDoDia';

const AVATARES: AvataresDaEmpresa = {
  pessoas: [
    { id: 'u-a', nome: 'Ana Lima', fotoUrl: '/perfil/u-a/foto?v=1', aniversario: null },
    { id: 'u-b', nome: 'Bruno Melo', fotoUrl: null, aniversario: null },
  ],
} as AvataresDaEmpresa;

const PESSOAS = [
  { id: 'u-a', name: 'Ana Lima', email: 'ana@qa.local', isActive: true },
  { id: 'u-b', name: 'Bruno Melo', email: 'bruno@qa.local', isActive: false },
  { id: 'u-c', name: 'Clara Dias', email: 'clara@qa.local', isActive: true },
  { id: 'u-d', name: 'Davi Reis', email: 'davi@qa.local', isActive: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  esquecerAvatares();
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = vi.fn(() => 'blob:foto');
  apiBlob.mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));
  apiGet.mockImplementation(async (rota: string) => {
    if (rota === '/perfil/pessoas') return AVATARES;
    throw new Error(`rota inesperada ${rota}`);
  });
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('a pilha de avatares', () => {
  it('um avatar por pessoa, o nome no balão; a foto vem da lista da empresa pelo id', async () => {
    render(<PilhaDeAvatares pessoas={[{ id: 'u-a', nome: 'Ana Lima' }, { id: 'u-b', nome: 'Bruno Melo' }]} prefixo="Responsável" testId="pilha" />);
    const ana = screen.getByRole('img', { name: 'Responsável: Ana Lima' });
    expect(ana).toHaveAttribute('title', 'Responsável: Ana Lima');
    await waitFor(() => expect(ana).toHaveAttribute('data-com-foto', 'sim'));
    expect(screen.getByRole('img', { name: 'Responsável: Bruno Melo' })).toHaveTextContent('BM');
    // O nome não aparece como texto: só no balão.
    expect(screen.getByTestId('pilha')).not.toHaveTextContent('Ana Lima');
    expect(apiGet.mock.calls.filter((c) => c[0] === '/perfil/pessoas')).toHaveLength(1);
  });

  it('passando do teto, "+N" com os outros nomes no balão', () => {
    render(
      <PilhaDeAvatares
        pessoas={PESSOAS.map((p) => ({ id: p.id, nome: p.name }))}
        max={3}
        testId="pilha"
      />,
    );
    expect(screen.getAllByTestId('avatar-da-pessoa')).toHaveLength(2);
    const mais = screen.getByTestId('pilha-mais');
    expect(mais).toHaveTextContent('+2');
    expect(mais).toHaveAttribute('title', 'Também: Clara Dias, Davi Reis');
    expect(mais).toHaveAccessibleName('Mais 2: Clara Dias, Davi Reis');
  });

  it('ninguém: o círculo tracejado com a frase da tela', () => {
    render(<PilhaDeAvatares pessoas={[]} vazio="ninguém" testId="pilha" />);
    const vazio = screen.getByRole('img', { name: 'ninguém' });
    expect(vazio).toHaveAttribute('data-vazio', 'sim');
    expect(vazio).toHaveAttribute('title', 'ninguém');
  });

  it('sem permissão para a lista da empresa: as iniciais, sem erro e sem buscar foto', async () => {
    apiGet.mockImplementation(async () => {
      throw Object.assign(new Error('Sem permissão'), { status: 403 });
    });
    render(<PilhaDeAvatares pessoas={[{ id: 'u-a', nome: 'Ana Lima' }]} prefixo="Responsável" />);
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/perfil/pessoas', 'tok'));
    const ana = screen.getByRole('img', { name: 'Responsável: Ana Lima' });
    expect(ana).toHaveTextContent('AL');
    expect(ana).toHaveAttribute('data-com-foto', 'nao');
    expect(apiBlob).not.toHaveBeenCalled();
  });

  it('resposta fora do formato ou erro síncrono: as iniciais, sem derrubar a tela', async () => {
    apiGet.mockImplementation(() => {
      throw new Error('quebrou antes da promessa');
    });
    render(<PilhaDeAvatares pessoas={[{ id: 'u-a', nome: 'Ana Lima' }]} />);
    expect(screen.getByRole('img', { name: 'Ana Lima' })).toHaveTextContent('AL');
    esquecerAvatares();
    cleanup();
    apiGet.mockResolvedValue({ outra: 'coisa' });
    render(<PilhaDeAvatares pessoas={[{ id: 'u-a', nome: 'Ana Lima' }]} />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(screen.getByRole('img', { name: 'Ana Lima' })).toHaveAttribute('data-com-foto', 'nao');
  });
});

describe('o responsável no cartão e na linha do Trabalho', () => {
  const base = { assigneeUserId: null, assigneeUserName: null, assigneeUserEmail: null, assigneeUserIsActive: null, outrosResponsaveisIds: [] };

  it('o principal e os demais, com e-mail e "(inativo)" no balão', () => {
    render(
      <AvataresDaTarefa
        tarefa={{ ...base, assigneeUserId: 'u-a', assigneeUserName: 'Ana Lima', assigneeUserEmail: 'ana@qa.local', assigneeUserIsActive: true, outrosResponsaveisIds: ['u-b'] }}
        pessoas={PESSOAS}
        testId="resp"
      />,
    );
    const pilha = screen.getByTestId('resp');
    expect(within(pilha).getByRole('img', { name: 'Responsável: Ana Lima' })).toBeInTheDocument();
    expect(within(pilha).getByRole('img', { name: 'Responsável: Bruno Melo (inativo)' })).toHaveTextContent('BM');
  });

  it('sem pessoa e com vínculo que não resolve: as frases de antes, agora no balão', () => {
    const { rerender } = render(<AvataresDaTarefa tarefa={base} pessoas={PESSOAS} />);
    expect(screen.getByRole('img', { name: 'Sem vínculo de pessoa' })).toHaveAttribute('data-vazio', 'sim');
    rerender(<AvataresDaTarefa tarefa={{ ...base, assigneeUserId: 'u-x' }} pessoas={PESSOAS} />);
    expect(screen.getByRole('img', { name: 'Vínculo de pessoa indisponível' })).toBeInTheDocument();
  });
});

describe('a célula do responsável no Funil em lista', () => {
  it('mantém o balão e o nome acessível próprios, agora com a foto da conta', async () => {
    render(<CelulaDoResponsavel nome="Ana Lima" pessoaId="u-a" testId="celula" />);
    const celula = screen.getByRole('img', { name: 'Responsável: Ana Lima' });
    expect(celula).toHaveAttribute('tabindex', '0');
    expect(within(celula).getByRole('tooltip', { hidden: true })).toHaveTextContent('Ana Lima');
    const circulo = within(celula).getByTestId('avatar-da-pessoa');
    // O círculo é decorativo: nem um segundo nome ao leitor de tela nem um segundo balão nativo.
    expect(circulo).toHaveAttribute('aria-hidden', 'true');
    expect(circulo).not.toHaveAttribute('title');
    await waitFor(() => expect(circulo).toHaveAttribute('data-com-foto', 'sim'));
  });

  it('sem id (resposta antiga): as iniciais, como antes', () => {
    render(<CelulaDoResponsavel nome="Ana Paula Souza" />);
    expect(screen.getByRole('img', { name: 'Responsável: Ana Paula Souza' })).toHaveTextContent('AS');
    expect(apiGet).not.toHaveBeenCalled();
  });
});

describe('as tarefas de uma área (TarefasDoDia)', () => {
  const ana = { id: 'u-a', nome: 'Ana Lima' };
  const bruno = { id: 'u-b', nome: 'Bruno Melo' };
  const tarefa = (id: string, pessoas: { id: string; nome: string }[], responsavelTexto: string | null = null): TarefaDoDia => ({
    id, titulo: `Tarefa ${id}`, area: { id: 'a1', nome: 'Comercial', cor: '#000' }, cliente: null, pessoa: pessoas[0] ?? null, pessoas,
    responsavelTexto, prazo: null, situacao: 'sem_prazo', status: { nome: 'A fazer', cor: '#888', tipo: 'aberta' },
    lista: { id: 'l1', nome: 'Rotinas' }, externalUrl: null, descricao: null, recorrencia: null, ordem: 0, updatedAt: '2026-10-19T12:00:00Z',
  });
  const PAINEL: PainelDeTarefas = {
    hoje: '2026-10-19',
    areas: [{ id: 'a1', nome: 'Comercial', cor: '#000', ordem: 0 }],
    pessoas: [ana, bruno],
    clientes: [],
    resumo: [],
    tarefas: [tarefa('t1', [ana, bruno]), tarefa('t2', [], 'Fulano do ClickUp')],
  };

  beforeEach(() => {
    apiGet.mockImplementation(async (rota: string) => {
      if (rota === '/perfil/pessoas') return AVATARES;
      if (rota === '/trabalho/todas') return PAINEL;
      throw new Error(`rota inesperada ${rota}`);
    });
  });

  it('no quadro por pessoa: a coluna tem avatar e nome; os outros responsáveis vão como avatar no cartão', async () => {
    render(<TarefasDoDia />);
    const tambem = await screen.findByTestId('dia-tambem-t1');
    expect(within(tambem).getByRole('img', { name: 'Também responsável: Bruno Melo' })).toHaveTextContent('BM');
    expect(tambem).not.toHaveTextContent('Bruno');
    // O cabeçalho da coluna da pessoa: o nome é a informação, então fica, com o avatar.
    expect(screen.getAllByText('Ana Lima').length).toBeGreaterThan(0);
  });

  it('na lista: a célula mostra os avatares e diz os nomes ao leitor de tela; o texto sem conta vira iniciais', async () => {
    window.history.replaceState(null, '', '/?ver=lista');
    render(<TarefasDoDia />);
    const resumo = await screen.findByLabelText('Responsáveis: Ana Lima, Bruno Melo');
    expect(within(resumo).getByRole('img', { name: 'Ana Lima' })).toBeInTheDocument();
    expect(resumo).not.toHaveTextContent('Ana');
    const semConta = screen.getByLabelText('Responsáveis: Fulano do ClickUp (sem conta)');
    expect(within(semConta).getByRole('img', { name: 'Fulano do ClickUp (sem conta)' })).toHaveTextContent('FC');
  });
});
