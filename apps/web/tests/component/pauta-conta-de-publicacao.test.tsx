import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * MD5 — o cartão "Conta de publicação" no topo da aba Semana: o @ por onde o OS
 * vai publicar, os escopos concedidos, conectar ou reconectar pela Meta, e o
 * aviso com que o callback devolve para cá.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
    apiPut: vi.fn(),
    apiBlob: vi.fn(),
  };
});

let permissoes = ['pauta.ver', 'pauta.editar', 'pauta.publicar', 'bio.editar'];
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u1', name: 'Pedro', email: 'p@x.com', roles: [], permissions: permissoes },
    can: (p: string) => permissoes.includes(p),
  }),
}));

// eslint-disable-next-line import/first
import { ContaDePublicacao } from '@/app/pauta/ContaDePublicacao';
// eslint-disable-next-line import/first
import PautaPage from '@/app/pauta/page';
// eslint-disable-next-line import/first
import { AbaConexoes } from '@/app/bio/AbaConexoes';

const ESCOPOS = ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_comments'];

function conta(over: Record<string, unknown> = {}, conexao: Record<string, unknown> | null = {}) {
  return {
    credencialConfigurada: true,
    escoposPedidos: ESCOPOS,
    conexao:
      conexao === null
        ? null
        : {
            id: 'c1', handle: 'root.os', escopos: ESCOPOS, podePublicar: true, podeComentarios: true, status: 'ok',
            expiraEm: '2026-11-23T15:00:00.000Z', ultimoErro: null, conectadaEm: '2026-09-24T15:00:00.000Z', atualizadaEm: '2026-09-24T15:00:00.000Z',
            ...conexao,
          },
    source: { tool: 'banco-interno', generatedAt: '2026-09-24T15:00:00.000Z' },
    ...over,
  };
}

const cartao = () => screen.getByRole('region', { name: 'Conta de publicação' });

beforeEach(() => {
  vi.clearAllMocks();
  permissoes = ['pauta.ver', 'pauta.editar', 'pauta.publicar', 'bio.editar'];
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('o cartão da conta de publicação', () => {
  it('sem conta: "não conectada", a frase do App Review e Conectar, que leva à URL da Meta', async () => {
    apiGet.mockResolvedValue(conta({}, null));
    apiPost.mockResolvedValue({ url: 'https://www.instagram.com/oauth/authorize?state=abc' });
    const navegar = vi.fn();
    render(<ContaDePublicacao token="tok" podeConectar aviso={null} onErro={vi.fn()} navegar={navegar} />);
    expect(await within(cartao()).findByText('não conectada')).toBeInTheDocument();
    expect(cartao()).toHaveTextContent('Publicar na conta da própria Root não passa por App Review; a conta precisa ter papel no app.');
    expect(apiGet).toHaveBeenCalledWith('/pauta/instagram/conexao', 'tok');
    await userEvent.click(within(cartao()).getByRole('button', { name: 'Conectar' }));
    expect(apiPost).toHaveBeenCalledWith('/pauta/instagram/conectar', {}, 'tok');
    await waitFor(() => expect(navegar).toHaveBeenCalledWith('https://www.instagram.com/oauth/authorize?state=abc'));
  });

  it('com conta: o @, os escopos, a validade no relógio de São Paulo e Reconectar', async () => {
    apiGet.mockResolvedValue(conta());
    render(<ContaDePublicacao token="tok" podeConectar aviso={null} onErro={vi.fn()} />);
    expect(await within(cartao()).findByText('@root.os')).toBeInTheDocument();
    expect(cartao()).toHaveTextContent('token vale até 23/11/2026');
    expect(within(cartao()).getByText('conectada')).toBeInTheDocument();
    const escopos = within(within(cartao()).getByRole('list', { name: 'Escopos concedidos' })).getAllByRole('listitem');
    expect(escopos.map((e) => e.textContent)).toEqual(ESCOPOS);
    expect(within(cartao()).getByRole('button', { name: 'Reconectar' })).toBeEnabled();
  });

  it('conta que não publica aparece como "sem publicar"; sem credencial o botão fica travado com o motivo', async () => {
    apiGet.mockResolvedValue(conta({ credencialConfigurada: false }, { podePublicar: false, escopos: ['instagram_business_basic'] }));
    render(<ContaDePublicacao token="tok" podeConectar aviso={null} onErro={vi.fn()} />);
    expect(await within(cartao()).findByText('sem publicar')).toBeInTheDocument();
    expect(cartao()).toHaveTextContent('Falta a credencial do app do Instagram');
    expect(within(cartao()).getByRole('button', { name: 'Reconectar' })).toBeDisabled();
  });

  it('sem as duas permissões não há botão; a recusa da API vai para a caixa de erro', async () => {
    apiGet.mockResolvedValue(conta({}, null));
    const { rerender } = render(<ContaDePublicacao token="tok" podeConectar={false} aviso={null} onErro={vi.fn()} />);
    await within(cartao()).findByText('não conectada');
    expect(within(cartao()).queryByRole('button')).toBeNull();

    const onErro = vi.fn();
    apiPost.mockRejectedValue(new Error('Permissão insuficiente'));
    rerender(<ContaDePublicacao token="tok" podeConectar aviso={null} onErro={onErro} />);
    await userEvent.click(within(cartao()).getByRole('button', { name: 'Conectar' }));
    await waitFor(() => expect(onErro).toHaveBeenLastCalledWith('Permissão insuficiente'));
    expect(within(cartao()).getByRole('button', { name: 'Conectar' })).toBeEnabled();
  });

  it('o aviso da volta: publicar não concedido explica o que conferir', async () => {
    apiGet.mockResolvedValue(conta({}, null));
    render(<ContaDePublicacao token="tok" podeConectar aviso="publicacao_sem_escopo" onErro={vi.fn()} />);
    expect(within(cartao()).getByRole('status')).toHaveTextContent('A Meta não concedeu publicar');
    expect(within(cartao()).getByRole('status')).toHaveTextContent('Instagram Tester');
  });

  it('a volta do OAuth abre a aba Semana com o aviso e limpa o endereço', async () => {
    permissoes = ['pauta.ver', 'pauta.publicar', 'bio.editar'];
    window.history.replaceState(null, '', '/pauta?aba=semana&conexao=ok');
    apiGet.mockImplementation(async (path: string) =>
      path === '/pauta/instagram/conexao' ? conta() : path.startsWith('/pauta/agenda')
        ? { de: '2026-09-21', ate: '2026-09-27', hoje: '2026-09-24', fuso: 'America/Sao_Paulo', dias: [], paraDistribuir: [] }
        : { items: [] },
    );
    render(<PautaPage />);
    expect(await screen.findByRole('region', { name: 'Conta de publicação' })).toBeInTheDocument();
    expect(within(cartao()).getByRole('status')).toHaveTextContent('Conta de publicação conectada.');
    expect(window.location.search).toBe('');
  });

  it('na bio, a lixeira da conta de publicação só aparece para quem tem pauta.publicar', async () => {
    const linha = (id: string, handle: string, finalidade: 'bio' | 'publicacao') => ({
      id, plataforma: 'instagram', handle, externalId: `x-${id}`, status: 'ok', expiraEm: null, escopos: null,
      finalidade, ultimoErro: null, conectadaEm: '2026-09-24T15:00:00.000Z', _count: { contas: 0 },
    });
    apiGet.mockResolvedValue({ items: [linha('p', 'root.os', 'publicacao'), linha('b', 'criador', 'bio')] });
    const props = { token: 'tok', editavel: true, admin: false, aviso: null, onErro: vi.fn() };
    const { rerender } = render(<AbaConexoes {...props} podePublicar={false} />);
    expect(await screen.findByText('@root.os')).toBeInTheDocument();
    expect(screen.getAllByTitle('Desconectar')).toHaveLength(1);
    rerender(<AbaConexoes {...props} podePublicar />);
    expect(screen.getAllByTitle('Desconectar')).toHaveLength(2);
  });
});
