import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * O CARTÃO "WHATSAPP (DIGISAC)" EM CONEXÕES (Interface 20/10, lane U6).
 *
 * O que ele promete: o selo é a sonda; a URL do webhook a cadastrar no DigiSac
 * está à vista (origem pública + caminho da empresa + o parâmetro do segredo,
 * SEM o segredo); o token digitado vai para o cofre e some da tela; listar
 * conexões preenche o id; revogar pede confirmação; quem não administra só lê.
 * Token e segredo daqui são inventados.
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

// eslint-disable-next-line import/first
import { ConexaoDigisac } from '@/app/conexoes/ConexaoDigisac';

const TOKEN_DIGITADO = 'token-inventado-que-nao-pode-voltar-0001';
const SEGREDO_DIGITADO = 'segredo-inventado-do-webhook-0123456789abcdef';

function conexao(over: Record<string, unknown> = {}) {
  return {
    origem: 'nenhuma',
    url: null,
    servicoId: null,
    tokenGuardado: false,
    tokenRevogadoEm: null,
    tokenAtualizadoEm: null,
    segredoDoWebhook: false,
    caminhoDoWebhook: '/api/comercial/webhooks/digisac/org-1',
    parametroDoSegredo: 'segredo',
    cabecalhoDoSegredo: 'x-digisac-segredo',
    desligado: false,
    ...over,
  };
}

const SAUDE_NAO = { estado: 'nao_configurado', mensagem: 'DigiSac não configurado nesta empresa.', verificadoEm: new Date().toISOString() };
const SAUDE_OK = { estado: 'conectado', mensagem: 'Conexão "WhatsApp Root" encontrada.', verificadoEm: new Date().toISOString() };

let estado = conexao();
let saude: Record<string, unknown> = SAUDE_NAO;

beforeEach(() => {
  vi.clearAllMocks();
  estado = conexao();
  saude = SAUDE_NAO;
  apiGet.mockImplementation(async (rota: string) => {
    if (rota === '/integrations/digisac/conexao') return estado;
    if (rota === '/integrations/digisac/saude') return saude;
    if (rota === '/integrations/digisac/servicos') {
      return { servicos: [{ id: 'svc-a', nome: 'WhatsApp Root', tipo: 'whatsapp', arquivado: false }] };
    }
    throw new Error(`rota inesperada ${rota}`);
  });
});

const cartao = () => screen.getByRole('region', { name: 'WhatsApp (DigiSac)' });

describe('o cartão do DigiSac', () => {
  it('mostra a URL do webhook com o parâmetro do segredo e sem segredo nenhum', async () => {
    render(<ConexaoDigisac token="tok" gerenciar />);
    const url = await screen.findByTestId('url-do-webhook-digisac');
    expect(url.textContent).toBe(`${window.location.origin}/api/comercial/webhooks/digisac/org-1?segredo=`);
    expect(within(cartao()).getByText('não configurado')).toBeInTheDocument();
    expect(within(cartao()).getByText(/x-digisac-segredo/)).toBeInTheDocument();
  });

  it('salvar manda o token ao cofre e o tira da tela; o selo passa a ser a sonda nova', async () => {
    const user = userEvent.setup();
    apiPut.mockImplementation(async () => {
      estado = conexao({ origem: 'cofre', url: 'https://suaconta.digisac.me', servicoId: 'svc-a', tokenGuardado: true, tokenAtualizadoEm: new Date().toISOString(), segredoDoWebhook: true });
      saude = SAUDE_OK;
      return estado;
    });
    render(<ConexaoDigisac token="tok" gerenciar />);
    await screen.findByTestId('url-do-webhook-digisac');

    await user.type(screen.getByLabelText('Endereço da conta'), 'https://suaconta.digisac.me');
    await user.type(screen.getByLabelText('Id da conexão de WhatsApp'), 'svc-a');
    await user.type(screen.getByLabelText(/Token de acesso/), TOKEN_DIGITADO);
    await user.type(screen.getByLabelText(/Segredo do webhook/), SEGREDO_DIGITADO);
    await user.click(screen.getByRole('button', { name: 'Salvar no cofre' }));

    await waitFor(() =>
      expect(apiPut).toHaveBeenCalledWith(
        '/integrations/digisac/credencial',
        { url: 'https://suaconta.digisac.me', servicoId: 'svc-a', token: TOKEN_DIGITADO, segredoDoWebhook: SEGREDO_DIGITADO },
        'tok',
      ),
    );
    expect(await screen.findByText('Guardado no cofre da empresa.')).toBeInTheDocument();
    expect((screen.getByLabelText(/Token de acesso/) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/Segredo do webhook/) as HTMLInputElement).value).toBe('');
    expect(document.body.innerHTML).not.toContain(TOKEN_DIGITADO);
    expect(document.body.innerHTML).not.toContain(SEGREDO_DIGITADO);
    await waitFor(() => expect(within(cartao()).getByText('conectado')).toBeInTheDocument());
    expect(within(cartao()).getByText(/guardado no cofre/)).toBeInTheDocument();
  });

  it('listar conexões preenche o id com "usar esta"', async () => {
    const user = userEvent.setup();
    estado = conexao({ origem: 'cofre', url: 'https://suaconta.digisac.me', servicoId: 'svc-velho', tokenGuardado: true });
    render(<ConexaoDigisac token="tok" gerenciar />);
    await user.click(await screen.findByRole('button', { name: 'Listar conexões' }));
    await user.click(await screen.findByRole('button', { name: 'usar esta' }));
    expect((screen.getByLabelText('Id da conexão de WhatsApp') as HTMLInputElement).value).toBe('svc-a');
  });

  it('revogar pede confirmação e vai à rota de revogação do contrato', async () => {
    const user = userEvent.setup();
    estado = conexao({ origem: 'cofre', url: 'https://suaconta.digisac.me', servicoId: 'svc-a', tokenGuardado: true });
    apiPost.mockResolvedValue({ tipo: 'revogado', segredos: ['token'], resumo: 'ok' });
    render(<ConexaoDigisac token="tok" gerenciar />);
    await user.click(await screen.findByRole('button', { name: 'Revogar' }));
    expect(apiPost).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'confirmar' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/integrations/digisac/revogacao', { motivo: 'Revogado no cartão do DigiSac' }, 'tok'));
  });

  it('quem não administra vê o estado e a URL, sem formulário nem revogar', async () => {
    estado = conexao({ origem: 'cofre', url: 'https://suaconta.digisac.me', servicoId: 'svc-a', tokenGuardado: true });
    render(<ConexaoDigisac token="tok" gerenciar={false} />);
    await screen.findByTestId('url-do-webhook-digisac');
    expect(screen.queryByLabelText(/Token de acesso/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revogar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar no cofre' })).not.toBeInTheDocument();
  });
});
