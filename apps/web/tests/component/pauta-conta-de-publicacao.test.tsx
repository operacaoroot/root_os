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
const apiDelete = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
    apiDelete: (...a: unknown[]) => apiDelete(...a),
    apiPut: vi.fn(),
    apiBlob: vi.fn(),
  };
});

const credencial = (over: Record<string, unknown> = {}) => ({
  plataforma: 'instagram', configurada: true, origem: 'perfil', appIdParcial: 'app123…',
  atualizadaEm: '2026-09-30T12:00:00.000Z', temGlobal: true, temDoPerfil: true, ...over,
});

function prepararBio(estado = credencial()) {
  apiGet.mockImplementation(async (path: string) =>
    path === '/bio/credentials'
      ? { items: [estado], total: 1 }
      : { items: [], total: 0 },
  );
}

const bioProps = (over: Record<string, unknown> = {}) => ({
  token: 'tok', editavel: true, podePublicar: false, admin: true, aviso: null,
  onErro: vi.fn(), ...over,
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
    await waitFor(() => expect(screen.getAllByTitle('Desconectar')).toHaveLength(2));
  });
});

describe('credenciais de apps na Bio', () => {
  beforeEach(() => {
    prepararBio();
    apiPost.mockResolvedValue({ ok: true });
    apiDelete.mockResolvedValue({ ok: true });
  });

  it('mostra a precedência e salva o app da empresa como escolha inicial', async () => {
    render(<AbaConexoes {...bioProps()} />);
    const linha = await screen.findByRole('group', { name: 'Credencial instagram' });
    expect(linha).toHaveTextContent('App desta empresa cadastrado.');
    expect(linha).toHaveTextContent('O app compartilhado só é considerado quando não há app da empresa');
    await userEvent.click(within(linha).getByRole('button', { name: 'configurar app' }));
    expect(within(linha).getByRole('combobox', { name: 'Onde salvar o app' })).toHaveValue('empresa');
    await userEvent.type(within(linha).getByRole('textbox', { name: 'App ID' }), 'id-teste');
    await userEvent.type(within(linha).getByLabelText('App secret'), 'segredo-falso');
    await userEvent.click(within(linha).getByRole('button', { name: 'Salvar app desta empresa' }));
    expect(apiPost).toHaveBeenCalledWith('/bio/credentials/instagram', {
      appId: 'id-teste', segredo: 'segredo-falso', global: false,
    }, 'tok');
    expect(await screen.findByRole('status')).toHaveTextContent('Cadastro do app instagram desta empresa salvo');
    expect(screen.getByRole('status')).toHaveTextContent('Faça o login na plataforma');
  });

  it('mantém o app compartilhado como escolha separada e avisa que não substitui o da empresa', async () => {
    render(<AbaConexoes {...bioProps()} />);
    const linha = await screen.findByRole('group', { name: 'Credencial instagram' });
    await userEvent.click(within(linha).getByRole('button', { name: 'configurar app' }));
    await userEvent.selectOptions(within(linha).getByRole('combobox', { name: 'Onde salvar o app' }), 'global');
    expect(linha).toHaveTextContent('O app desta empresa continuará cadastrado');
    await userEvent.type(within(linha).getByRole('textbox', { name: 'App ID' }), 'global-teste');
    await userEvent.type(within(linha).getByLabelText('App secret'), 'segredo-falso');
    await userEvent.click(within(linha).getByRole('button', { name: 'Salvar app compartilhado' }));
    expect(apiPost).toHaveBeenCalledWith('/bio/credentials/instagram', {
      appId: 'global-teste', segredo: 'segredo-falso', global: true,
    }, 'tok');
  });

  it('confirma a remoção do app compartilhado antes da chamada', async () => {
    render(<AbaConexoes {...bioProps()} />);
    const linha = await screen.findByRole('group', { name: 'Credencial instagram' });
    expect(within(linha).queryByRole('button', { name: 'remover app da empresa' })).toBeNull();
    await userEvent.click(within(linha).getByRole('button', { name: 'remover app compartilhado' }));
    expect(apiDelete).not.toHaveBeenCalled();
    await userEvent.click(within(linha).getByRole('button', { name: 'Cancelar' }));
    expect(apiDelete).not.toHaveBeenCalled();
    await userEvent.click(within(linha).getByRole('button', { name: 'remover app compartilhado' }));
    await userEvent.click(within(linha).getByRole('button', { name: 'Confirmar remoção do compartilhado' }));
    expect(apiDelete).toHaveBeenCalledWith('/bio/credentials/instagram?global=true', 'tok');
  });

  it('espera a resposta, e uma falha mantém o rascunho sem mensagem de sucesso', async () => {
    let rejeitar!: (erro: Error) => void;
    apiPost.mockReturnValue(new Promise((_resolve, reject) => { rejeitar = reject; }));
    const onErro = vi.fn();
    render(<AbaConexoes {...bioProps({ onErro })} />);
    const linha = await screen.findByRole('group', { name: 'Credencial instagram' });
    await userEvent.click(within(linha).getByRole('button', { name: 'configurar app' }));
    await userEvent.type(within(linha).getByRole('textbox', { name: 'App ID' }), 'rascunho');
    await userEvent.type(within(linha).getByLabelText('App secret'), 'segredo-falso');
    await userEvent.click(within(linha).getByRole('button', { name: 'Salvar app desta empresa' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(within(linha).getByRole('button', { name: 'Salvando…' })).toBeDisabled();
    rejeitar(new Error('Falhou ao salvar'));
    await waitFor(() => expect(onErro).toHaveBeenCalledWith('Falhou ao salvar'));
    expect(within(linha).getByRole('textbox', { name: 'App ID' })).toHaveValue('rascunho');
    expect(within(linha).getByLabelText('App secret')).toHaveValue('segredo-falso');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('descarta o POST da sessão anterior e não mostra editor sem permissão', async () => {
    let concluir!: (valor: unknown) => void;
    apiPost.mockReturnValue(new Promise((resolve) => { concluir = resolve; }));
    apiGet.mockImplementation(async (path: string, token: string) =>
      path === '/bio/credentials'
        ? { items: [credencial({ appIdParcial: token === 'nova' ? 'novo12…' : 'antigo…' })] }
        : { items: [] },
    );
    const onErro = vi.fn();
    const props = bioProps({ token: 'antiga', onErro });
    const { rerender } = render(<AbaConexoes {...props} />);
    const linha = await screen.findByRole('group', { name: 'Credencial instagram' });
    await userEvent.click(within(linha).getByRole('button', { name: 'configurar app' }));
    await userEvent.type(within(linha).getByRole('textbox', { name: 'App ID' }), 'id-antigo');
    await userEvent.type(within(linha).getByLabelText('App secret'), 'segredo-falso');
    await userEvent.click(within(linha).getByRole('button', { name: 'Salvar app desta empresa' }));
    rerender(<AbaConexoes {...props} token="nova" />);
    expect(await screen.findByText('novo12…')).toBeInTheDocument();
    concluir({ ok: true });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/bio/credentials', 'nova'));
    expect(screen.queryByRole('status')).toBeNull();
    expect(onErro).not.toHaveBeenCalled();
    rerender(<AbaConexoes {...props} token="nova" admin={false} />);
    expect(screen.queryByRole('group', { name: 'Credencial instagram' })).toBeNull();
  });
});
