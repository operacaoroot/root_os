import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CriarAgente } from '@/app/agentes/CriarAgente';
import { ExecucaoLocal } from '@/app/agentes/ExecucaoLocal';
import { ErroDaApi } from '@/lib/api';
const apiGet = vi.fn(), apiPost = vi.fn();
vi.mock('@/lib/api', async () => ({ ...await vi.importActual<typeof import('@/lib/api')>('@/lib/api'), apiGet: (...args: unknown[]) => apiGet(...args), apiPost: (...args: unknown[]) => apiPost(...args) }));
const config = { pessoas: [{ id: 'pessoa', name: 'Pessoa QA' }], modelo: { disponivel: true, modelo: 'local-modelo', motivo: null }, procedimentoSuportado: 'Síntese local sem ferramentas externas' };
const fontes = { items: [{ id: 'nota', title: 'Fonte QA v2', chave: 'qa:nota', versao: 2, versoes: [{ id: 'versao2', title: 'Fonte QA v2', versao: 2, contentHash: 'b'.repeat(64) }, { id: 'versao1', title: 'Fonte QA v1', versao: 1, contentHash: 'a'.repeat(64) }] }], modelo: config.modelo };
const resultado = { id: 'execucao1', status: 'respondida', motivo: null, resposta: 'Texto efetivamente vindo do modelo local', modeloConfigurado: 'local-modelo', modeloUsado: 'local-modelo', fonte: { itemId: 'nota', versionId: 'versao1', title: 'Fonte QA v1', versao: 1, contentHash: 'a'.repeat(64) }, consumo: { tokensIn: 30, tokensOut: 20, custoExternoUsd: 0, custoMaquinaMedido: false } };
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); apiGet.mockImplementation(async (path: string) => path === '/agents/configuracao' ? config : path.includes('/execucoes/') ? resultado : fontes); apiPost.mockResolvedValue(resultado); });
async function preencher() {
  const u = userEvent.setup(); await u.click(screen.getByRole('button', { name: 'Abrir procedimento local' }));
  await u.selectOptions(await screen.findByLabelText('Fonte do procedimento'), 'nota'); await u.selectOptions(screen.getByLabelText('Versão da fonte'), 'versao1'); await u.type(screen.getByLabelText('Pedido para o agente'), 'Resuma para a operação'); return u;
}
describe('configuração e execução do agente local', () => {
  it('cria planejado com modelo observado e sem concessão de ferramentas externas', async () => {
    const created = vi.fn(); apiPost.mockResolvedValue({ slug: 'procedimento-qa' }); render(<CriarAgente token="tok" pessoaId="pessoa" aoCriar={created} aoFechar={() => {}} />); const u = userEvent.setup();
    await screen.findByText('Modelo local: local-modelo'); await u.type(screen.getByLabelText('Nome do agente'), 'Analista QA'); await u.type(screen.getByLabelText('Propósito'), 'Preparar resumo da operação'); await u.selectOptions(screen.getByLabelText('Responsável'), 'pessoa'); await u.click(screen.getByRole('button', { name: 'Salvar agente planejado' }));
    await waitFor(() => expect(created).toHaveBeenCalledWith('procedimento-qa')); const input = apiPost.mock.calls[0][1]; expect(input.modelo).toBe('local-modelo'); expect(input).not.toHaveProperty('estado'); expect(input).not.toHaveProperty('capacidades');
  });
  it('perda da resposta de criação conserva o requestId e corpo depois de remontar', async () => {
    apiPost.mockRejectedValueOnce(Error('Resposta interrompida')).mockResolvedValue({ slug: 'procedimento-qa' }); const props = { token: 'tok', pessoaId: 'pessoa', aoCriar: vi.fn(), aoFechar: () => {} }; const first = render(<CriarAgente {...props} />); const u = userEvent.setup();
    await screen.findByText('Modelo local: local-modelo'); await u.type(screen.getByLabelText('Nome do agente'), 'Analista QA'); await u.type(screen.getByLabelText('Propósito'), 'Preparar resumo da operação'); await u.selectOptions(screen.getByLabelText('Responsável'), 'pessoa'); await u.click(screen.getByRole('button', { name: 'Salvar agente planejado' })); await screen.findByText('Resposta interrompida'); const original = apiPost.mock.calls[0][1]; first.unmount();
    render(<CriarAgente {...props} />); await screen.findByText('Modelo local: local-modelo'); expect(screen.getByLabelText('Nome do agente')).toBeDisabled(); await u.click(screen.getByRole('button', { name: 'Conferir criação' })); await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2)); expect(apiPost.mock.calls[1][1]).toEqual(original);
  });
  it('envia versão histórica exata e reencontra a versão usada', async () => {
    render(<ExecucaoLocal slug="procedimento-qa" token="tok" pessoaId="pessoa" podeExecutar />); const u = await preencher(); await u.click(screen.getByRole('button', { name: 'Iniciar procedimento local' }));
    await screen.findByText(resultado.resposta); expect(apiPost.mock.calls[0][1]).toMatchObject({ itemId: 'nota', versionId: 'versao1', contentHash: 'a'.repeat(64), expectedItemVersion: 2 }); expect(screen.getByRole('link', { name: 'Abrir fonte usada · v1' })).toHaveAttribute('href', '/contexto?nota=nota&versao=versao1'); expect(screen.getByRole('button', { name: 'Iniciar procedimento local' })).toBeDisabled();
  });
  it('resposta perdida preserva pedido completo após remontar e atualização da fonte', async () => {
    apiPost.mockRejectedValueOnce(Error('Resposta interrompida')).mockResolvedValue(resultado); const props = { slug: 'procedimento-qa', token: 'tok', pessoaId: 'pessoa', podeExecutar: true }; const first = render(<ExecucaoLocal {...props} />); const u = await preencher(); await u.click(screen.getByRole('button', { name: 'Iniciar procedimento local' })); await screen.findByText('Resposta interrompida'); const original = apiPost.mock.calls[0][1]; first.unmount();
    apiGet.mockResolvedValue({ ...fontes, items: [{ ...fontes.items[0], versao: 3 }] }); render(<ExecucaoLocal {...props} />); await u.click(screen.getByRole('button', { name: 'Abrir procedimento local' })); await screen.findByText('Modelo disponível: local-modelo'); expect(screen.getByLabelText('Pedido para o agente')).toBeDisabled(); await u.click(screen.getByRole('button', { name: 'Conferir pedido anterior' })); await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2)); expect(apiPost.mock.calls[1][1]).toEqual(original);
  });
  it('modelo indisponível mostra recusa real e não anuncia resposta concluída', async () => {
    apiGet.mockResolvedValue({ ...fontes, modelo: { disponivel: false, modelo: null, motivo: 'Modelo local indisponível.' } }); apiPost.mockResolvedValue({ ...resultado, status: 'recusada', motivo: 'Modelo local indisponível.', resposta: null, modeloUsado: null, consumo: { tokensIn: null, tokensOut: null } });
    render(<ExecucaoLocal slug="procedimento-qa" token="tok" pessoaId="pessoa" podeExecutar />); const u = await preencher(); await u.click(screen.getByRole('button', { name: 'Iniciar procedimento local' })); await screen.findByText('Situação: recusada'); expect(screen.queryByText(resultado.resposta)).not.toBeInTheDocument(); expect(screen.getByText(/usado: nenhuma chamada concluída/)).toBeInTheDocument();
  });
  it('revogação atual elimina saída e metadados mostrados antes', async () => {
    render(<ExecucaoLocal slug="procedimento-qa" token="tok" pessoaId="pessoa" podeExecutar />); const u = await preencher(); await u.click(screen.getByRole('button', { name: 'Iniciar procedimento local' })); await screen.findByText(resultado.resposta); apiGet.mockRejectedValueOnce(new ErroDaApi('Fonte indisponível', 404)); await u.click(screen.getByRole('button', { name: 'Conferir execução e acesso' })); await screen.findByRole('alert'); expect(screen.queryByText(resultado.resposta)).not.toBeInTheDocument(); expect(screen.queryByRole('link', { name: /Abrir fonte usada/ })).not.toBeInTheDocument(); expect(screen.queryByRole('option', { name: 'Fonte QA v2' })).not.toBeInTheDocument();
  });
  it('usuário sem execução lê histórico próprio mas não recebe botão de disparo', async () => {
    render(<ExecucaoLocal slug="procedimento-qa" token="tok" pessoaId="pessoa" podeExecutar={false} />); const u = userEvent.setup(); await u.click(screen.getByRole('button', { name: 'Abrir procedimento local' })); await screen.findByText('Modelo disponível: local-modelo'); expect(screen.queryByRole('button', { name: 'Iniciar procedimento local' })).not.toBeInTheDocument();
  });
  it.each(['resposta', 'erro'])('atualização antiga após 409 descarta %s na troca de pessoa e preserva o pedido anterior', async (retorno) => {
    apiPost.mockRejectedValueOnce(new ErroDaApi('A fonte mudou', 409));
    const view = render(<ExecucaoLocal slug="procedimento-qa" token="tok-antigo" pessoaId="pessoa" podeExecutar />);
    const u = await preencher(); await u.click(screen.getByRole('button', { name: 'Iniciar procedimento local' })); await screen.findByText('A fonte mudou');
    const chave = 'rootos:execucao-agente:pessoa:procedimento-qa', preservado = localStorage.getItem(chave);
    let resolve!: (r: unknown) => void, reject!: (e: Error) => void;
    apiGet.mockImplementationOnce(() => new Promise((r, j) => { resolve = r; reject = j; })).mockResolvedValue({ ...fontes, items: [] });
    await u.click(screen.getByRole('button', { name: 'Atualizar fonte e preparar novo pedido' }));
    view.rerender(<ExecucaoLocal slug="procedimento-qa" token="tok-novo" pessoaId="outra-pessoa" podeExecutar />);
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(3));
    await act(async () => { if (retorno === 'resposta') resolve(fontes); else reject(Error('Erro privado da sessão anterior')); });
    expect(screen.queryByRole('option', { name: 'Fonte QA v2' })).not.toBeInTheDocument();
    expect(screen.queryByText('Erro privado da sessão anterior')).not.toBeInTheDocument();
    expect(localStorage.getItem(chave)).toBe(preservado); expect(preservado).not.toBeNull();
    expect(screen.getByLabelText('Pedido para o agente')).toHaveValue('');
  });
  it('401 de execução elimina conteúdo privado visível e preserva o pedido no perfil da pessoa', async () => {
    apiPost.mockRejectedValueOnce(new ErroDaApi('Sessão recusada', 401));
    render(<ExecucaoLocal slug="procedimento-qa" token="tok" pessoaId="pessoa" podeExecutar />);
    const u = await preencher(); await u.click(screen.getByRole('button', { name: 'Iniciar procedimento local' }));
    await screen.findByText('Sessão recusada');
    expect(screen.queryByRole('option', { name: 'Fonte QA v2' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Pedido para o agente')).toHaveValue('');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('rootos:execucao-agente:pessoa:procedimento-qa')!)).toMatchObject({ pedido: 'Resuma para a operação', versionId: 'versao1' });
  });
  it('409 pede atualizar fonte explicitamente e conserva o texto', async () => {
    apiPost.mockRejectedValueOnce(new ErroDaApi('A fonte mudou', 409)); render(<ExecucaoLocal slug="procedimento-qa" token="tok" pessoaId="pessoa" podeExecutar />); const u = await preencher(); await u.click(screen.getByRole('button', { name: 'Iniciar procedimento local' })); await screen.findByText('A fonte mudou'); expect(screen.getByLabelText('Pedido para o agente')).toHaveValue('Resuma para a operação'); await u.click(screen.getByRole('button', { name: 'Atualizar fonte e preparar novo pedido' })); await waitFor(() => expect(screen.getByLabelText('Pedido para o agente')).not.toBeDisabled()); expect(screen.getByLabelText('Pedido para o agente')).toHaveValue('Resuma para a operação');
  });
});
