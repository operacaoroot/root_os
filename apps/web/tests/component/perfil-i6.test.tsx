import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AvataresDaEmpresa, PerfilDaPessoa } from '@mktos/shared';

/*
 * O PERFIL, O AVATAR E O ANIVERSÁRIO (produção 22B, I6).
 *
 *  · o avatar: a foto (pela rota autenticada, como blob) ou as iniciais, com o
 *    nome acessível; acha a foto pela lista da empresa quando só tem o id;
 *  · o perfil: salvar manda só o que mudou e a versão lida; a foto é reduzida
 *    na tela antes de enviar e SVG nem sai; quem não pode editar não vê campo;
 *    quem administra gente escolhe outra pessoa;
 *  · o aniversário de hoje aparece no Dia a dia, só dia e mês.
 */

const apiGet = vi.fn();
const apiPut = vi.fn();
const apiUpload = vi.fn();
const apiDelete = vi.fn();
const apiBlob = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPut: (...a: unknown[]) => apiPut(...a),
    apiUpload: (...a: unknown[]) => apiUpload(...a),
    apiDelete: (...a: unknown[]) => apiDelete(...a),
    apiBlob: (...a: unknown[]) => apiBlob(...a),
  };
});

let PERMISSOES = ['dashboard.ver'];
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ token: 'tok', ready: true, user: { id: 'u-eu' }, can: (p: string) => PERMISSOES.includes(p) }),
}));

const reduzirFoto = vi.fn();
vi.mock('@/lib/reduzir-foto', async () => {
  const real = await vi.importActual<typeof import('@/lib/reduzir-foto')>('@/lib/reduzir-foto');
  return { ...real, reduzirFoto: (...a: unknown[]) => reduzirFoto(...a) };
});

// eslint-disable-next-line import/first
import PerfilPage from '@/app/perfil/page';
// eslint-disable-next-line import/first
import { AvatarDaPessoa } from '@/components/AvatarDaPessoa';
// eslint-disable-next-line import/first
import { AniversariosDoDia } from '@/components/AniversariosDoDia';
// eslint-disable-next-line import/first
import { esquecerAvatares } from '@/lib/avatares';
// eslint-disable-next-line import/first
import { recorteQuadrado, recusaDoArquivo } from '@/lib/reduzir-foto';

function perfil(over: Partial<PerfilDaPessoa> = {}): PerfilDaPessoa {
  return {
    id: 'u-eu',
    nome: 'Alice Exemplo',
    email: 'alice@root.local',
    apelido: null,
    cargo: 'Sócia',
    cidade: null,
    fuso: 'America/Sao_Paulo',
    aniversario: '03-12',
    dataNascimento: '1990-03-12',
    telefone: null,
    nomeNoVault: null,
    foto: null,
    whatsapp: { cadastrado: false, final: null, numero: null },
    vault: { disponivel: true, frase: null, socios: ['Alice', 'Bruno'], sugestao: 'Alice' },
    podeEditar: true,
    proprio: true,
    atualizadoEm: '2026-10-22T10:00:00.000Z',
    ...over,
  };
}

const AVATARES: AvataresDaEmpresa = {
  pessoas: [
    { id: 'u-eu', nome: 'Alice Exemplo', fotoUrl: '/perfil/u-eu/foto?v=aaa', aniversario: '03-12', cargo: 'Sócia' },
    { id: 'u-b', nome: 'Bruno Exemplo', fotoUrl: null, aniversario: '07-01', cargo: null },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  esquecerAvatares();
  PERMISSOES = ['dashboard.ver'];
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = vi.fn(() => 'blob:foto');
  apiBlob.mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));
  apiGet.mockImplementation(async (rota: string) => {
    if (rota === '/perfil') return perfil();
    if (rota === '/perfil/pessoas') return AVATARES;
    if (rota === '/perfil/u-b') return perfil({ id: 'u-b', nome: 'Bruno Exemplo', proprio: false, dataNascimento: '1985-07-01', aniversario: '07-01' });
    throw new Error(`rota inesperada ${rota}`);
  });
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('o avatar', () => {
  it('sem foto: as iniciais no círculo, com o nome acessível e no balão', () => {
    render(<AvatarDaPessoa nome="Clara Modelo" fotoUrl={null} />);
    const a = screen.getByRole('img', { name: 'Clara Modelo' });
    expect(a).toHaveTextContent('CM');
    expect(a).toHaveAttribute('title', 'Clara Modelo');
    expect(apiBlob).not.toHaveBeenCalled();
  });

  it('com foto: busca pela rota autenticada e desenha num img, sem executar nada', async () => {
    render(<AvatarDaPessoa nome="Alice Exemplo" fotoUrl="/perfil/u-eu/foto?v=bbb" />);
    const a = screen.getByRole('img', { name: 'Alice Exemplo' });
    await waitFor(() => expect(a).toHaveAttribute('data-com-foto', 'sim'));
    expect(apiBlob).toHaveBeenCalledWith('/perfil/u-eu/foto?v=bbb', 'tok');
    expect(a.querySelector('img')).toHaveAttribute('src', 'blob:foto');
  });

  it('só com o id da pessoa: acha a foto na lista da empresa (uma leitura para todos os avatares)', async () => {
    render(
      <>
        <AvatarDaPessoa nome="Alice Exemplo" pessoaId="u-eu" />
        <AvatarDaPessoa nome="Bruno Exemplo" pessoaId="u-b" />
      </>,
    );
    await waitFor(() => expect(screen.getByRole('img', { name: 'Alice Exemplo' })).toHaveAttribute('data-com-foto', 'sim'));
    expect(screen.getByRole('img', { name: 'Bruno Exemplo' })).toHaveTextContent('BE');
    expect(apiGet.mock.calls.filter((c) => c[0] === '/perfil/pessoas')).toHaveLength(1);
  });

  it('com o nome escrito ao lado, o círculo não repete o nome ao leitor de tela', () => {
    render(<AvatarDaPessoa nome="Bruno Exemplo" fotoUrl={null} mostrarNome />);
    expect(screen.queryByRole('img', { name: 'Bruno Exemplo' })).toBeNull();
    expect(screen.getByText('Bruno Exemplo')).toBeInTheDocument();
  });
});

describe('o perfil', () => {
  it('salvar manda só o que mudou, com a versão lida', async () => {
    apiPut.mockResolvedValue(perfil({ cargo: 'Sócia fundadora', atualizadoEm: '2026-10-22T11:00:00.000Z' }));
    render(<PerfilPage />);
    const cargo = await screen.findByLabelText('Cargo ou função');
    await userEvent.clear(cargo);
    await userEvent.type(cargo, 'Sócia fundadora');
    await userEvent.click(screen.getByRole('button', { name: 'salvar' }));
    expect(apiPut).toHaveBeenCalledWith('/perfil/u-eu', { esperado: '2026-10-22T10:00:00.000Z', cargo: 'Sócia fundadora' }, 'tok');
    expect(await screen.findByRole('status')).toHaveTextContent('Perfil salvo.');
  });

  it('a sugestão do nome no vault preenche o campo; o 409 da API aparece', async () => {
    apiPut.mockRejectedValue(new Error('O perfil mudou desde que você abriu (outra aba ou outra pessoa). Recarregue e salve de novo.'));
    render(<PerfilPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'usar a sugestão: Alice' }));
    expect(screen.getByLabelText('Nome no vault da Root')).toHaveValue('Alice');
    await userEvent.click(screen.getByRole('button', { name: 'salvar' }));
    expect(apiPut).toHaveBeenCalledWith('/perfil/u-eu', { esperado: '2026-10-22T10:00:00.000Z', nomeNoVault: 'Alice' }, 'tok');
    expect(await screen.findByRole('alert')).toHaveTextContent('Recarregue');
  });

  it('a foto é reduzida na tela antes de enviar', async () => {
    const reduzida = new File(['jpg'], 'foto.jpg', { type: 'image/jpeg' });
    reduzirFoto.mockResolvedValue(reduzida);
    apiUpload.mockResolvedValue(perfil({ foto: { url: '/perfil/u-eu/foto?v=ccc', tipo: 'jpeg', largura: 256, altura: 256, bytes: 3, enviadaEm: '2026-10-22T11:00:00.000Z' } }));
    render(<PerfilPage />);
    const entrada = await screen.findByLabelText('Escolher foto');
    const original = new File([new Uint8Array(1000)], 'retrato.png', { type: 'image/png' });
    await userEvent.upload(entrada, original);
    await waitFor(() => expect(apiUpload).toHaveBeenCalledWith('/perfil/u-eu/foto', reduzida, 'tok'));
    expect(reduzirFoto).toHaveBeenCalledWith(original);
    expect(await screen.findByRole('status')).toHaveTextContent('Foto trocada.');
  });

  it('SVG não sai da tela', async () => {
    render(<PerfilPage />);
    const entrada = await screen.findByLabelText('Escolher foto');
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'x.svg', { type: 'image/svg+xml' });
    await userEvent.upload(entrada, svg, { applyAccept: false });
    expect(await screen.findByRole('alert')).toHaveTextContent('SVG não serve');
    expect(apiUpload).not.toHaveBeenCalled();
    expect(reduzirFoto).not.toHaveBeenCalled();
  });

  it('quem não pode editar só lê: sem campo de foto nem botão de salvar', async () => {
    apiGet.mockImplementation(async (rota: string) => {
      if (rota === '/perfil') return perfil({ podeEditar: false, proprio: false });
      return AVATARES;
    });
    render(<PerfilPage />);
    await screen.findByText('Alice Exemplo');
    expect(screen.queryByLabelText('Escolher foto')).toBeNull();
    expect(screen.queryByRole('button', { name: 'salvar' })).toBeNull();
    expect(screen.getByLabelText('Cargo ou função')).toBeDisabled();
  });

  it('quem administra gente escolhe outra pessoa e abre o perfil dela', async () => {
    PERMISSOES = ['dashboard.ver', 'admin.usuarios'];
    render(<PerfilPage />);
    const seletor = await screen.findByLabelText('Editar o perfil de');
    await userEvent.selectOptions(seletor, 'u-b');
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/perfil/u-b', 'tok'));
    expect(await screen.findByText('Bruno Exemplo', { selector: 'h2' })).toBeInTheDocument();
    expect(window.location.search).toBe('?pessoa=u-b');
  });

  it('o WhatsApp vai à rota da Equipe (a mesma identidade do canal)', async () => {
    apiPut.mockResolvedValue({});
    render(<PerfilPage />);
    const campo = await screen.findByLabelText('Novo WhatsApp');
    await userEvent.type(campo, '32 99999-0001');
    await userEvent.click(within(screen.getByRole('region', { name: 'WhatsApp' })).getByRole('button', { name: 'salvar número' }));
    expect(apiPut).toHaveBeenCalledWith('/organograma/pessoas/u-eu/whatsapp', { numero: '32 99999-0001' }, 'tok');
  });
});

describe('o aniversário no Dia a dia', () => {
  it('aparece quem faz aniversário hoje (dia e mês de São Paulo); sem ninguém, o bloco some', async () => {
    const { unmount } = render(<AniversariosDoDia agora={new Date('2026-03-12T15:00:00Z')} />);
    const bloco = await screen.findByTestId('aniversarios-do-dia');
    expect(bloco).toHaveTextContent('Alice Exemplo');
    expect(bloco).toHaveTextContent('12 de março');
    expect(bloco).not.toHaveTextContent('Bruno');
    expect(bloco).not.toHaveTextContent('1990');
    unmount();
    render(<AniversariosDoDia agora={new Date('2026-05-05T15:00:00Z')} />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(screen.queryByTestId('aniversarios-do-dia')).toBeNull();
  });
});

describe('a redução da foto (parte pura)', () => {
  it('recorta o quadrado do centro', () => {
    expect(recorteQuadrado(400, 300)).toEqual({ sx: 50, sy: 0, lado: 300 });
    expect(recorteQuadrado(300, 500)).toEqual({ sx: 0, sy: 100, lado: 300 });
  });

  it('recusa SVG, tipo fora da lista e mais de 2 MB antes de abrir', () => {
    expect(recusaDoArquivo({ type: 'image/svg+xml', size: 10, name: 'a.svg' })).toMatch(/SVG/);
    expect(recusaDoArquivo({ type: 'image/gif', size: 10, name: 'a.gif' })).toBe('Envie JPG, PNG ou WebP.');
    expect(recusaDoArquivo({ type: 'image/png', size: 3 * 1024 * 1024, name: 'a.png' })).toBe('A foto passa de 2 MB.');
    expect(recusaDoArquivo({ type: 'image/webp', size: 10, name: 'a.webp' })).toBeNull();
  });
});
