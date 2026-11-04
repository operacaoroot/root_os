import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chaveDoPedido } from '@/app/contexto/RetratoDaFonte';
import { ExecucaoLocal } from '@/app/agentes/ExecucaoLocal';
import { ErroDaApi } from '@/lib/api';
import { NOTA_LOCAL, OUTRA_ORG_LOCAL, OUTRA_PESSOA_LOCAL, PESSOA_LOCAL, VERSAO_LOCAL_1, VERSAO_LOCAL_2,
  escopoLocal as escopo, execucaoDoPedido, execucaoLocal, fontesLocais, mensagensDaExecucaoLocal as mensagens,
  painelLocal, recuperarExecucao, versaoLocal } from '../fixtures/procedimento-local';
const get = vi.fn(), post = vi.fn();
vi.mock('@/lib/api', async () => ({ ...await vi.importActual<typeof import('@/lib/api')>('@/lib/api'), apiGet: (...a: unknown[]) => get(...a), apiPost: (...a: unknown[]) => post(...a) }));
const versao = versaoLocal(1, 'Fonte histórica QA');
const retrato = versao.retratoFonte;
const fontes = fontesLocais('Atual QA', versao);
const resultado = execucaoLocal(versao, 'PEDIDO PRIVADO QA', 'RESULTADO PRIVADO QA', 'CORPO PRIVADO QA');
const props = { slug: escopo.agentSlug, token: 'token-qa', pessoaId: PESSOA_LOCAL, podeExecutar: true };
const legado = `rootos:execucao-agente:${PESSOA_LOCAL}:${escopo.agentSlug}`;
beforeEach(() => {
  cleanup(); localStorage.clear(); vi.resetAllMocks();
  get.mockImplementation(async (path: string) => {
    if (path.includes('/pedidos/')) return recuperarExecucao(resultado, path.split('/').at(-1));
    if (path.includes('/execucoes/')) return resultado;
    if (path.endsWith('/painel')) return painelLocal;
    return fontes;
  });
  post.mockImplementation(async (_p: string, input: { requestId: string }) => execucaoDoPedido(resultado, input.requestId));
});
async function preencher() {
  fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' }));
  await screen.findByText(mensagens.modelo);
  fireEvent.change(screen.getByLabelText('Fonte do procedimento'), { target: { value: NOTA_LOCAL } });
  fireEvent.change(screen.getByLabelText('Versão da fonte'), { target: { value: VERSAO_LOCAL_1 } });
  fireEvent.change(screen.getByLabelText('Pedido para o agente'), { target: { value: 'PEDIDO PRIVADO QA' } });
}
describe('M05 interface do procedimento com API simulada', () => {
  it('não guarda pedido, título, corpo ou hash privado no navegador após resposta perdida', async () => { post.mockRejectedValue(Error('Resposta perdida')); render(<ExecucaoLocal {...props} />); await preencher(); fireEvent.click(screen.getByRole('button', { name: 'Iniciar procedimento local' })); await screen.findByText(mensagens.erroIncerto); const valores = Object.values(localStorage).join(' '); expect(valores).not.toContain('PEDIDO PRIVADO QA'); expect(valores).not.toContain('Fonte histórica QA'); expect(valores).not.toContain('a'.repeat(64)); expect(valores).toContain(post.mock.calls[0][1].requestId); });
  it('após recarga encontra o pedido por GET sem repetir POST nem reconstruir payload', async () => { post.mockRejectedValue(Error('Resposta perdida')); const first = render(<ExecucaoLocal {...props} />); await preencher(); fireEvent.click(screen.getByRole('button', { name: 'Iniciar procedimento local' })); await screen.findByText(mensagens.erroIncerto); const requestId = post.mock.calls[0][1].requestId; first.unmount(); get.mockImplementation(async (p: string) => p.includes('/pedidos/') ? recuperarExecucao(resultado, requestId) : fontes); render(<ExecucaoLocal {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' })); await screen.findByText('RESULTADO PRIVADO QA'); expect(get).toHaveBeenCalledWith(`/agents/procedimento-qa/procedimento/pedidos/${requestId}`, props.token); expect(post).toHaveBeenCalledTimes(1); });
  it('retorno de outra empresa não publica fontes', async () => { get.mockResolvedValue({ ...fontes, escopo: { ...escopo, userId: OUTRA_PESSOA_LOCAL } }); render(<ExecucaoLocal {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' })); await screen.findByRole('alert'); expect(screen.queryByRole('option', { name: 'Atual QA' })).not.toBeInTheDocument(); });
  it('atualizar fontes não apaga um pedido incerto nem libera novo POST', async () => { post.mockRejectedValue(new ErroDaApi('Fonte mudou', 409)); render(<ExecucaoLocal {...props} />); await preencher(); fireEvent.click(screen.getByRole('button', { name: 'Iniciar procedimento local' })); await screen.findByText(mensagens.conflito); fireEvent.click(screen.getByRole('button', { name: mensagens.conferirFontes })); await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(2)); expect(screen.getByLabelText('Pedido para o agente')).toBeDisabled(); expect(post).toHaveBeenCalledTimes(1); });
  it.each([401, 403, 404])('recusa %s ao conferir resultado retira conteúdo e link', async (status) => { render(<ExecucaoLocal {...props} />); await preencher(); fireEvent.click(screen.getByRole('button', { name: 'Iniciar procedimento local' })); await screen.findByText('RESULTADO PRIVADO QA'); get.mockRejectedValue(new ErroDaApi('DETALHE PRIVADO DE ERRO', status)); fireEvent.click(screen.getByRole('button', { name: 'Conferir execução e acesso' })); await screen.findByRole('alert'); expect(screen.queryByText('RESULTADO PRIVADO QA')).not.toBeInTheDocument(); expect(screen.queryByRole('link', { name: /Abrir fonte usada/ })).not.toBeInTheDocument(); expect(screen.queryByText('DETALHE PRIVADO DE ERRO')).not.toBeInTheDocument(); });

  it('404 após recarga conserva só identificador e bloqueia novo pedido', async () => {
    post.mockRejectedValue(Error('Resposta perdida')); const first = render(<ExecucaoLocal {...props} />); await preencher(); fireEvent.click(screen.getByRole('button', { name: 'Iniciar procedimento local' })); await screen.findByText(mensagens.erroIncerto); const id = post.mock.calls[0][1].requestId; first.unmount();
    get.mockImplementation(async (p: string) => { if (p.includes('/pedidos/')) throw new ErroDaApi('Sem confirmação privada', 404); return fontes; }); render(<ExecucaoLocal {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' })); await screen.findByRole('alert');
    expect(screen.getByRole('status')).toHaveTextContent(mensagens.pedidoPendente); expect(screen.getByLabelText('Pedido para o agente')).toHaveValue(''); expect(screen.queryByRole('button', { name: 'Iniciar procedimento local' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Confirmar e reenviar a entrada original' })).not.toBeInTheDocument(); expect(Object.values(localStorage).join(' ')).toContain(id); expect(post).toHaveBeenCalledTimes(1);
  });
  it('migra apenas requestId UUID de pedido legado e apaga o corpo privado', async () => {
    localStorage.setItem(legado, JSON.stringify({ requestId: resultado.requestId, pedido: 'PEDIDO LEGADO PRIVADO', itemId: NOTA_LOCAL, versionId: VERSAO_LOCAL_1, contentHash: 'a'.repeat(64) })); render(<ExecucaoLocal {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' })); await screen.findByText('RESULTADO PRIVADO QA'); expect(post).not.toHaveBeenCalled(); expect(localStorage.getItem(legado)).toBeNull(); expect(Object.values(localStorage).join(' ')).not.toContain('PEDIDO LEGADO PRIVADO'); expect(get).toHaveBeenCalledWith(`/agents/procedimento-qa/procedimento/pedidos/${resultado.requestId}`, props.token);
  });
  it('legado inválido bloqueia novo efeito e fica disponível para conferência', async () => {
    const original = JSON.stringify({ requestId: 'invalido', pedido: 'PRIVADO LEGADO' });
    localStorage.setItem(legado, original);
    render(<ExecucaoLocal {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível conferir os pedidos guardados.');
    expect(get.mock.calls.every((c) => !c[0].includes('/pedidos/'))).toBe(true);
    expect(localStorage.getItem(legado)).toBe(original);
    expect(screen.getByRole('button', { name: 'Iniciar procedimento local' })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });
  it('migra pista UUID de sessão confirmada e consulta GET existente sem inferência', async () => {
    const sessionId = '22222222-2222-4222-8222-222222222222'; localStorage.setItem(`${legado}:ultima`, sessionId); get.mockImplementation(async (p: string) => p.includes('/execucoes/') ? { ...resultado, id: sessionId } : fontes); render(<ExecucaoLocal {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' })); await screen.findByText('RESULTADO PRIVADO QA'); expect(get).toHaveBeenCalledWith(`/agents/procedimento-qa/procedimento/execucoes/${sessionId}`, props.token); expect(post).not.toHaveBeenCalled(); expect(localStorage.getItem(`${legado}:ultima`)).toBeNull();
  });
  it('pista de sessão sem confirmação não libera POST', async () => {
    const sessionId = '22222222-2222-4222-8222-222222222222'; localStorage.setItem(`${legado}:ultima`, sessionId); get.mockImplementation(async (p: string) => { if (p.includes('/execucoes/')) throw new ErroDaApi('Não encontrado', 404); return fontes; }); render(<ExecucaoLocal {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' })); await screen.findByRole('alert'); expect(screen.getByRole('status')).toHaveTextContent('Execução anterior sem confirmação'); expect(screen.queryByRole('button', { name: 'Iniciar procedimento local' })).not.toBeInTheDocument(); expect(post).not.toHaveBeenCalled(); expect(Object.values(localStorage).join(' ')).toContain(sessionId);
  });
  it('empresa divergente na reconferência limpa retrato já exibido', async () => {
    render(<ExecucaoLocal {...props} />); await preencher(); get.mockResolvedValue({ ...fontes, escopo: { ...escopo, orgId: OUTRA_ORG_LOCAL } }); fireEvent.click(screen.getByRole('button', { name: mensagens.conferirFontes })); await screen.findByRole('alert'); expect(screen.queryByRole('option', { name: 'Atual QA' })).not.toBeInTheDocument(); expect(screen.queryByRole('region', { name: 'Retrato da fonte selecionada' })).not.toBeInTheDocument();
  });
  it.each(['token', 'pessoaId', 'slug'])('resposta POST atrasada não aparece após trocar %s', async (campo) => {
    let resolver!: (v: unknown) => void; post.mockImplementation(() => new Promise((r) => { resolver = r; })); const tela = render(<ExecucaoLocal {...props} />); await preencher(); fireEvent.click(screen.getByRole('button', { name: 'Iniciar procedimento local' })); await waitFor(() => expect(post).toHaveBeenCalledTimes(1)); const id = post.mock.calls[0][1].requestId; tela.rerender(<ExecucaoLocal {...props} {...{ [campo]: campo === 'slug' ? 'procedimento-outro' : 'outra-identidade' }} />); await act(async () => resolver(execucaoDoPedido(resultado, id))); expect(screen.queryByText('RESULTADO PRIVADO QA')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Abrir procedimento local' })).toBeEnabled();
  });
  it('agente pausado usa impedimento recebido e não oferece efeito', async () => {
    get.mockResolvedValue({ ...fontes, painel: { ...painelLocal, agente: { ...painelLocal.agente, estado: 'pausado', ativo: false }, inicioLocal: { ...painelLocal.inicioLocal, permitido: false, impedimentosLocais: ['Agente pausado.'] } } }); render(<ExecucaoLocal {...props} />); await preencher(); expect(screen.getByText(/^Estado do agente: pausado/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Iniciar procedimento local' })).toBeDisabled(); expect(post).not.toHaveBeenCalled();
  });
  it('citação adulterada na lista não publica fonte', async () => {
    get.mockResolvedValue({ ...fontes, items: [{ ...fontes.items[0], versoes: [{ ...fontes.items[0].versoes[0], retratoFonte: { ...retrato, citacao: { ...retrato.citacao, versionId: VERSAO_LOCAL_2 } } }] }] }); render(<ExecucaoLocal {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' })); await screen.findByRole('alert'); expect(screen.queryByRole('option', { name: 'Atual QA' })).not.toBeInTheDocument();
  });


  it('falha de storage após recibo confirmado mantém UUID consultável e bloqueia novo efeito', async () => {
    const id = resultado.requestId;
    localStorage.setItem(legado, JSON.stringify({ requestId: id, pedido: 'PRIVADO LEGADO' }));
    const grava = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('Quota'); });
    try {
      render(<ExecucaoLocal {...props} />);
      fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível conferir os pedidos guardados.');
      expect(get).toHaveBeenCalledWith(`/agents/procedimento-qa/procedimento/pedidos/${id}`, props.token);
      expect(screen.queryByRole('option', { name: 'Atual QA' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Iniciar procedimento local' })).not.toBeInTheDocument();
      expect(post).not.toHaveBeenCalled();
      expect(localStorage.getItem(legado)).toContain(id);
      expect(grava.mock.calls.every((c) => !c[1].includes('PRIVADO LEGADO'))).toBe(true);
    } finally { grava.mockRestore(); }
  });

  it('leitura de storage recusada não confunde pedido guardado com ausência', async () => {
    const chave = chaveDoPedido(escopo, 'procedimento'); localStorage.setItem(chave, JSON.stringify({ ...escopo, requestId: resultado.requestId, operation: 'procedimento' })); const original = Storage.prototype.getItem;
    const leitura = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) { if (key === chave) throw Error('Leitura recusada'); return original.call(this, key); });
    try { render(<ExecucaoLocal {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' })); await screen.findByRole('alert'); expect(screen.queryByRole('option', { name: 'Atual QA' })).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Iniciar procedimento local' })).toBeDisabled(); expect(post).not.toHaveBeenCalled(); expect(original.call(localStorage, chave)).toContain(resultado.requestId); } finally { leitura.mockRestore(); }
  });


  it.each([404, 503])('remontagem após falha de gravação conserva pedido até receber confirmação (%s)', async (status) => {
    const id = resultado.requestId;
    const original = JSON.stringify({ requestId: id, pedido: 'PRIVADO LEGADO' });
    localStorage.setItem(legado, original);
    const grava = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('Quota'); });
    const primeira = render(<ExecucaoLocal {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' }));
    try {
      await screen.findByRole('alert');
      expect(post).not.toHaveBeenCalled();
      expect(localStorage.getItem(legado)).toBe(original);
      expect(grava.mock.calls.every((c) => !c[1].includes('PRIVADO LEGADO'))).toBe(true);
    } finally { primeira.unmount(); grava.mockRestore(); }

    get.mockClear().mockImplementation(async (p: string) => {
      if (p.includes('/pedidos/')) throw new ErroDaApi('Sem confirmação', status);
      return fontes;
    });
    render(<ExecucaoLocal {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' }));
    await screen.findByRole('alert');
    expect(get).toHaveBeenCalledWith(`/agents/procedimento-qa/procedimento/pedidos/${id}`, props.token);
    expect(screen.getByRole('status')).toHaveTextContent(mensagens.pedidoPendente);
    expect(screen.queryByRole('button', { name: 'Iniciar procedimento local' })).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    expect(localStorage.getItem(legado)).toBe(original);
    expect(localStorage.getItem(chaveDoPedido(escopo, 'procedimento'))).toBeNull();
  });

  it('recusa do pedido legado secundário preserva os dois pedidos e bloqueia novo envio', async () => {
    const outro = '55555555-5555-4555-8555-555555555555';
    const chave = chaveDoPedido(escopo, 'procedimento');
    const original = JSON.stringify({ ...escopo, requestId: resultado.requestId, operation: 'procedimento' });
    const originalLegado = JSON.stringify({ requestId: outro, pedido: 'PRIVADO LEGADO' });
    localStorage.setItem(chave, original);
    localStorage.setItem(legado, originalLegado);
    get.mockImplementation(async (p: string) => {
      if (p.endsWith(`/pedidos/${outro}`)) throw new ErroDaApi('Sem confirmação', 404);
      if (p.endsWith(`/pedidos/${resultado.requestId}`)) return recuperarExecucao(resultado);
      if (p.endsWith('/painel')) return painelLocal;
      return fontes;
    });
    render(<ExecucaoLocal {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' }));
    await screen.findByText('RESULTADO PRIVADO QA');
    expect(get).toHaveBeenCalledWith(`/agents/procedimento-qa/procedimento/pedidos/${resultado.requestId}`, props.token);
    fireEvent.click(screen.getByRole('button', { name: 'Preparar novo pedido' }));
    await screen.findByRole('alert');
    expect(get).toHaveBeenCalledWith(`/agents/procedimento-qa/procedimento/pedidos/${outro}`, props.token);
    expect(screen.getByRole('status')).toHaveTextContent(mensagens.pedidoPendente);
    expect(screen.queryByRole('button', { name: 'Iniciar procedimento local' })).not.toBeInTheDocument();
    expect(screen.queryByText('RESULTADO PRIVADO QA')).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    expect(localStorage.getItem(chave)).toBe(original);
    expect(localStorage.getItem(legado)).toBe(originalLegado);
  });
});
