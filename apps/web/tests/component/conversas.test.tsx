import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * Dia a dia › Conversas — a tela, com a API simulada e dados sintéticos.
 * O que ela PRECISA dizer: caixa desligada é desligada; responder não sai no
 * clique (vai para Aprovações); aceita, entregue e lida são coisas diferentes;
 * duas falhas recentes avisam; quem só lê não ganha caixa de resposta.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();
const apiPatch = vi.fn();
const apiBlob = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
    apiPut: (...a: unknown[]) => apiPut(...a),
    apiPatch: (...a: unknown[]) => apiPatch(...a),
    apiBlob: (...a: unknown[]) => apiBlob(...a),
  };
});

let permissoes: string[] = [];
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u-eu', name: 'Lucas', email: 'l@x.com', roles: [], permissions: permissoes },
    can: (p: string) => permissoes.includes(p),
  }),
}));

// eslint-disable-next-line import/first
import ConversasPage from '@/app/conversas/page';

const agora = new Date().toISOString();
const conversa = {
  id: 'c1', nome: 'Cliente Sintético', grupo: false, telefoneFinal: '0001', cliente: null, responsavel: null,
  ultimaMensagemEm: agora, previa: 'preciso de ajuda', naoLidas: 2, encerrada: false, versao: 0,
};
const msg = (id: string, extra: Record<string, unknown>) => ({
  id, direcao: 'saida', tipo: 'texto', texto: id, remetenteNome: null, autor: 'Lucas', momento: agora,
  statusEnvio: null, erroEnvio: null, anexo: null, apagada: false, tarefaId: null, ...extra,
});

function rotas(estado: { ativo: boolean; whatsapp: boolean }, mensagens: unknown[] = []) {
  apiGet.mockImplementation(async (path: string) => {
    if (path === '/atendimento/estado') return estado;
    if (path === '/atendimento/apoio') return { pessoas: [{ id: 'u-eu', nome: 'Lucas' }], clientes: [], areas: [{ id: 'a1', nome: 'Operação' }] };
    if (path.startsWith('/atendimento/conversas?')) return { total: 1, pagina: 0, porPagina: 30, totalNaoLidas: 2, conversas: [conversa] };
    if (path.startsWith('/atendimento/conversas/c1/mensagens')) return { mensagens, temMais: false, antes: null };
    throw new Error(`rota inesperada ${path}`);
  });
  apiPost.mockImplementation(async (path: string) => {
    if (path.endsWith('/lida')) return { marcadas: 2 };
    if (path.endsWith('/responder')) return { mensagemId: 'nova', repetida: false, retida: { approvalId: 'ap1', mensagem: 'retida', fila: '/atendimento' } };
    throw new Error(`rota inesperada ${path}`);
  });
}

beforeEach(() => {
  for (const f of [apiGet, apiPost, apiPut, apiPatch, apiBlob]) f.mockReset();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe('Conversas — caixa desligada', () => {
  it('diz que está desligada e só quem configura vê o botão de ligar', async () => {
    permissoes = ['atendimento.ver', 'atendimento.configurar'];
    rotas({ ativo: false, whatsapp: true });
    apiPut.mockResolvedValue({ ativo: true, whatsapp: true });
    render(<ConversasPage />);
    expect(await screen.findByText('A caixa de conversas está desligada')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Ligar a caixa' }));
    expect(apiPut).toHaveBeenCalledWith('/atendimento/ajuste', { ativo: true }, 'tok');
  });

  it('quem não configura recebe o recado, não o botão', async () => {
    permissoes = ['atendimento.ver'];
    rotas({ ativo: false, whatsapp: true });
    render(<ConversasPage />);
    expect(await screen.findByText(/Peça a quem administra/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ligar a caixa' })).toBeNull();
  });
});

describe('Conversas — caixa ligada', () => {
  it('mostra quantas esperam leitura, abre a conversa e marca como lida', async () => {
    permissoes = ['atendimento.ver', 'atendimento.responder'];
    rotas({ ativo: true, whatsapp: true }, [msg('oi', { direcao: 'entrada', autor: null, remetenteNome: 'Cliente' })]);
    render(<ConversasPage />);
    expect(await screen.findByText(/mensagens esperando/)).toBeTruthy();
    await userEvent.click(screen.getByText('Cliente Sintético'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/atendimento/conversas/c1/lida', {}, 'tok'));
  });

  it('separa aceita, entregue e lida, e avisa quando duas respostas falharam agora há pouco', async () => {
    permissoes = ['atendimento.ver', 'atendimento.responder'];
    rotas({ ativo: true, whatsapp: true }, [
      msg('m-aceita', { statusEnvio: 'aceita' }),
      msg('m-entregue', { statusEnvio: 'entregue' }),
      msg('m-lida', { statusEnvio: 'lida' }),
      msg('m-esperando', { statusEnvio: 'aguardando_assinatura' }),
      msg('m-erro1', { statusEnvio: 'erro', erroEnvio: 'Evolution respondeu HTTP 500.' }),
      msg('m-erro2', { statusEnvio: 'erro', erroEnvio: 'Evolution respondeu HTTP 500.' }),
    ]);
    render(<ConversasPage />);
    await userEvent.click(await screen.findByText('Cliente Sintético'));
    expect(await screen.findByText(/aceita pelo WhatsApp/)).toBeTruthy();
    expect(screen.getAllByText('✓✓', { selector: 'span[aria-hidden]' })).toHaveLength(2);
    expect(screen.getAllByText('✓', { selector: 'span[aria-hidden]' })).toHaveLength(1);
    // Só a lida ganha o acento; entregue continua neutra.
    expect(screen.getByTitle('lida').className).toMatch(/text-brand/);
    expect(screen.getByTitle('entregue').className).not.toMatch(/text-brand/);
    expect(screen.getByText(/esperando assinatura/)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/duas falharam nos últimos 15 minutos/);
  });

  it('responder vai para Aprovações com um id gerado pela tela, e diz que nada saiu ainda', async () => {
    permissoes = ['atendimento.ver', 'atendimento.responder'];
    rotas({ ativo: true, whatsapp: true });
    render(<ConversasPage />);
    await userEvent.click(await screen.findByText('Cliente Sintético'));
    await userEvent.type(await screen.findByPlaceholderText(/vai para assinatura/), 'Olá, já vejo isso');
    await userEvent.click(screen.getByRole('button', { name: 'Pedir envio' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      '/atendimento/conversas/c1/responder',
      expect.objectContaining({ texto: 'Olá, já vejo isso', clienteMensagemId: expect.stringMatching(/^[0-9a-f-]{36}$/) }),
      'tok',
    ));
    expect(await screen.findByText(/sai quando outra pessoa assinar/)).toBeTruthy();
    expect(screen.getByText(/Nada foi enviado ainda/)).toBeTruthy();
  });

  it('quem só lê não ganha caixa de resposta nem "virar tarefa"', async () => {
    permissoes = ['atendimento.ver'];
    rotas({ ativo: true, whatsapp: true }, [msg('oi', { direcao: 'entrada' })]);
    render(<ConversasPage />);
    await userEvent.click(await screen.findByText('Cliente Sintético'));
    expect(await screen.findByText(/Você pode ler/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pedir envio' })).toBeNull();
    expect(screen.queryByText('virar tarefa')).toBeNull();
  });
});
