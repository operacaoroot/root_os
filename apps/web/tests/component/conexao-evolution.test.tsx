import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * O CARTÃO "WHATSAPP (EVOLUTION)" EM INTEGRAÇÕES (Rodada de produção 1, 21/10/2026, P8).
 *
 * O que ele promete: o selo é o estado da instância (conectada, QR pendente,
 * erro); a chave digitada vai para o cofre e some da tela; o QR aparece como
 * imagem quando a instância pede e some quando ela abre; a URL do webhook está
 * à vista sem segredo nenhum; quem não administra só lê. E o WhatsApp da tela
 * é só a Evolution. Chaves e instâncias daqui são inventadas.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
    apiPut: (...a: unknown[]) => apiPut(...a),
  };
});

let PERMISSOES = ['dashboard.ver', 'admin.usuarios'];
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u-eu', name: 'Rodrigo', email: 'r@x.com', roles: [], permissions: PERMISSOES },
    can: (p: string) => PERMISSOES.includes(p),
  }),
}));
vi.mock('@/app/conexoes/CatalogoDeclarativo', () => ({ CatalogoDeclarativo: () => null }));
vi.mock('@/app/conexoes/ConexaoGranola', () => ({ ConexaoGranola: () => null }));

// eslint-disable-next-line import/first
import { ConexaoEvolution } from '@/app/conexoes/ConexaoEvolution';
// eslint-disable-next-line import/first
import IntegracoesPage from '@/app/conexoes/page';

const CHAVE_DIGITADA = 'chave-inventada-que-nao-pode-voltar-0001';
const QR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function conexao(over: Record<string, unknown> = {}) {
  return {
    origem: 'nenhuma',
    url: null,
    instancia: null,
    chaveGuardada: false,
    chaveRevogadaEm: null,
    chaveAtualizadaEm: null,
    caminhoDoWebhook: '/api/approvals/canal/whatsapp/org-1',
    cabecalhoDoSegredo: 'x-canal-segredo',
    entradaLigada: true,
    provedorDoComercial: 'simulado',
    desligado: false,
    ...over,
  };
}
const agora = () => new Date().toISOString();

let estado = conexao();
let instancia: Record<string, unknown> = { estado: 'nao_configurada', mensagem: 'Evolution não configurada nesta empresa.', verificadoEm: agora() };

beforeEach(() => {
  vi.clearAllMocks();
  PERMISSOES = ['dashboard.ver', 'admin.usuarios'];
  estado = conexao();
  instancia = { estado: 'nao_configurada', mensagem: 'Evolution não configurada nesta empresa.', verificadoEm: agora() };
  apiGet.mockImplementation(async (rota: string) => {
    if (rota === '/integrations/evolution/conexao') return estado;
    if (rota === '/integrations/evolution/estado') return instancia;
    throw new Error(`rota inesperada ${rota}`);
  });
});

const cartao = () => screen.getByRole('region', { name: 'WhatsApp (Evolution)' });

describe('o cartão da Evolution', () => {
  it('mostra a URL do webhook e o cabeçalho, sem segredo, e avisa quando a entrada está fechada', async () => {
    estado = conexao({ entradaLigada: false });
    render(<ConexaoEvolution token="tok" gerenciar />);
    const url = await screen.findByTestId('url-do-webhook-evolution');
    expect(url.textContent).toBe(`${window.location.origin}/api/approvals/canal/whatsapp/org-1`);
    expect(within(cartao()).getAllByText(/x-canal-segredo/).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByTestId('selo-evolution').textContent).toBe('não configurada'));
    expect(within(cartao()).getByText(/A entrada está fechada/)).toBeInTheDocument();
    expect(within(cartao()).getByText(/simulado \(nada sai do sistema\)/)).toBeInTheDocument();
  });

  it('salva endereço, instância e chave no cofre; a chave some do formulário e não volta', async () => {
    apiPut.mockImplementation(async () => conexao({ origem: 'cofre', url: 'https://evolution.exemplo.com', instancia: 'root-comercial', chaveGuardada: true, chaveAtualizadaEm: agora() }));
    render(<ConexaoEvolution token="tok" gerenciar />);
    await screen.findByTestId('url-do-webhook-evolution');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Endereço da Evolution'), 'https://evolution.exemplo.com');
    await user.type(screen.getByLabelText('Nome da instância'), 'root-comercial');
    await user.type(screen.getByLabelText('Chave da API (apikey)'), CHAVE_DIGITADA);
    await user.click(screen.getByRole('button', { name: 'Salvar no cofre' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    expect(apiPut).toHaveBeenCalledWith('/integrations/evolution/credencial', { url: 'https://evolution.exemplo.com', instancia: 'root-comercial', chave: CHAVE_DIGITADA }, 'tok');
    expect(await screen.findByText('Guardado no cofre da empresa.')).toBeInTheDocument();
    expect((screen.getByLabelText('Chave da API (apikey)') as HTMLInputElement).value).toBe('');
    expect(document.body.textContent).not.toContain(CHAVE_DIGITADA);
    expect(within(cartao()).getByText(/guardada no cofre/)).toBeInTheDocument();
  });

  it('instância desconectada: Gerar QR mostra a imagem; lido o QR, a instância abre e o QR some', async () => {
    estado = conexao({ origem: 'cofre', url: 'https://evolution.exemplo.com', instancia: 'root-comercial', chaveGuardada: true });
    instancia = { estado: 'close', mensagem: 'Instância desconectada: gere o QR para ligar o número.', verificadoEm: agora() };
    apiPost.mockImplementation(async (rota: string) => {
      if (rota === '/integrations/evolution/qr') return { estado: 'connecting', base64: QR, codigoDePareamento: 'WZYEH1YY', mensagem: 'Leia o QR com o WhatsApp do número.' };
      throw new Error(`rota inesperada ${rota}`);
    });
    render(<ConexaoEvolution token="tok" gerenciar />);
    await waitFor(() => expect(screen.getByTestId('selo-evolution').textContent).toBe('desconectada'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Gerar QR' }));
    const img = await screen.findByRole('img', { name: 'QR para ligar o número' });
    expect(img.getAttribute('src')).toBe(QR);
    expect(screen.getByText('WZYEH1YY')).toBeInTheDocument();
    expect(screen.getByTestId('selo-evolution').textContent).toBe('QR pendente');

    instancia = { estado: 'open', mensagem: 'Instância conectada.', verificadoEm: agora() };
    await user.click(screen.getByRole('button', { name: 'Já li o QR' }));
    await waitFor(() => expect(screen.getByTestId('selo-evolution').textContent).toBe('conectada'));
    expect(screen.queryByRole('img', { name: 'QR para ligar o número' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Gerar QR' })).toBeNull();
  });

  it('erro da Evolution aparece no selo, com a frase do servidor', async () => {
    estado = conexao({ origem: 'cofre', url: 'https://evolution.exemplo.com', instancia: 'root-comercial', chaveGuardada: true });
    instancia = { estado: 'erro', mensagem: 'A Evolution respondeu HTTP 401 em GET /instance/connectionState.', verificadoEm: agora() };
    render(<ConexaoEvolution token="tok" gerenciar />);
    await waitFor(() => expect(screen.getByTestId('selo-evolution').textContent).toBe('erro'));
    expect(within(cartao()).getByText(/HTTP 401/)).toBeInTheDocument();
  });

  it('quem não administra só lê: sem formulário, sem QR, sem revogar', async () => {
    estado = conexao({ origem: 'cofre', url: 'https://evolution.exemplo.com', instancia: 'root-comercial', chaveGuardada: true });
    instancia = { estado: 'close', mensagem: 'Instância desconectada.', verificadoEm: agora() };
    render(<ConexaoEvolution token="tok" gerenciar={false} />);
    await screen.findByTestId('url-do-webhook-evolution');
    expect(screen.queryByRole('button', { name: 'Salvar no cofre' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Gerar QR' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revogar' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Verificar' })).toBeInTheDocument();
  });
});

describe('a tela de Integrações', () => {
  it('mostra o cartão da Evolution, e todo cartão de WhatsApp da tela é da Evolution', async () => {
    render(<IntegracoesPage />);
    expect(await screen.findByRole('region', { name: 'WhatsApp (Evolution)' })).toBeInTheDocument();
    const deWhatsapp = screen.queryAllByRole('region').map((r) => r.getAttribute('aria-label') ?? '').filter((n) => /whatsapp/i.test(n));
    expect(deWhatsapp.every((n) => /evolution/i.test(n))).toBe(true);
  });
});
