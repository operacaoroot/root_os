import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CriarAgente } from '@/app/agentes/CriarAgente';
import { ExecucaoLocal } from '@/app/agentes/ExecucaoLocal';
import { ErroDaApi } from '@/lib/api';
const apiGet = vi.fn(), apiPost = vi.fn();
vi.mock('@/lib/api', async () => ({ ...await vi.importActual<typeof import('@/lib/api')>('@/lib/api'), apiGet: (...args: unknown[]) => apiGet(...args), apiPost: (...args: unknown[]) => apiPost(...args) }));
const escopoBase = { orgId: 'org-qa', userId: 'pessoa' };
const escopo = { ...escopoBase, agentId: 'agente', agentSlug: 'procedimento-qa' };
const criado = { id: 'agente', slug: 'procedimento-qa', escopo };
const config = { escopo: escopoBase, pessoas: [{ id: 'pessoa', name: 'Pessoa QA' }], modelo: { disponivel: true, modelo: 'local-modelo', motivo: null }, procedimentoSuportado: 'Síntese local sem ferramentas externas' };
const caps = { modo: 'sintese_local_sem_ferramentas', capacidades: { lerVersao: true, sintetizarLocalmente: true, registrarResultado: true, ferramentasExternas: false, agendamento: false, cancelarInferencia: false }, agente: { id: 'agente', slug: 'procedimento-qa', estado: 'ativo', ativo: true, procedimentoVersao: 1 }, modelo: { ...config.modelo, provider: 'llama.cpp-local' }, novasExecucoesPermitidas: true, impedimento: null };
function retrato(id: string, title: string, versao: number, contentHash: string, body: string | null = null) { return { itemId: 'nota', chave: 'qa:nota', colecao: 'manual_local', identidadeCanonica: { documentId: 'nota', origemDaIdentidade: 'item_existente' }, versao: { versionId: id, numero: versao, contentHash }, title, body, versaoAtual: 2, arquivada: false, registradaEm: '2026-10-08T13:00:00Z', atualizadaNaMemoriaEm: null, origem: { tipo: 'operador', referencia: null }, estado: { coleta: 'nao_verificada', indexacao: 'nao_verificada', projecao: 'nao_verificada', ultimoReciboId: null }, acesso: { modelo: 'local_por_pessoa', verificadoEm: '2026-10-08T13:00:00Z', novoUsoPermitido: true }, citacao: { chave: 'qa:nota', itemId: 'nota', versao, versionId: id, contentHash } }; }
const fontes = { escopo, capacidadesExecutor: caps, items: [{ id: 'nota', title: 'Fonte QA v2', chave: 'qa:nota', versao: 2, versoes: [{ id: 'versao2', title: 'Fonte QA v2', versao: 2, contentHash: 'b'.repeat(64), retratoFonte: retrato('versao2', 'Fonte QA v2', 2, 'b'.repeat(64)) }, { id: 'versao1', title: 'Fonte QA v1', versao: 1, contentHash: 'a'.repeat(64), retratoFonte: retrato('versao1', 'Fonte QA v1', 1, 'a'.repeat(64)) }] }], modelo: config.modelo };
const resultado = { escopo, capacidadesExecutor: caps, retratoFonte: retrato('versao1', 'Fonte QA v1', 1, 'a'.repeat(64), 'Fonte QA'), requestId: '11111111-1111-4111-8111-111111111111', id: 'execucao1', status: 'respondida', motivo: null, resposta: 'Texto efetivamente vindo do modelo local', modeloConfigurado: 'local-modelo', modeloUsado: 'local-modelo', fonte: { itemId: 'nota', versionId: 'versao1', title: 'Fonte QA v1', versao: 1, contentHash: 'a'.repeat(64) }, consumo: { tokensIn: 30, tokensOut: 20, custoExternoUsd: 0, custoMaquinaMedido: false } };
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); apiGet.mockImplementation(async (path: string) => path === '/agents/configuracao' ? config : path.startsWith('/agents/pedidos/') ? { ...criado, repetido: true } : path.includes('/execucoes/') || path.includes('/pedidos/') ? resultado : fontes); apiPost.mockImplementation(async (_p, input) => ({ ...resultado, requestId: input.requestId })); });
async function preencher() {
  const u = userEvent.setup(); await u.click(screen.getByRole('button', { name: 'Abrir procedimento local' }));
  await u.selectOptions(await screen.findByLabelText('Fonte do procedimento'), 'nota'); await u.selectOptions(screen.getByLabelText('Versão da fonte'), 'versao1'); await u.type(screen.getByLabelText('Pedido para o agente'), 'Resuma para a operação'); return u;
}
describe('configuração e execução do agente local', () => {
  it('cria planejado com modelo observado e sem concessão de ferramentas externas', async () => {
    const created = vi.fn(); apiPost.mockResolvedValue(criado); render(<CriarAgente token="tok" pessoaId="pessoa" aoCriar={created} aoFechar={() => {}} />); const u = userEvent.setup();
    await screen.findByText('Modelo local: local-modelo'); await u.type(screen.getByLabelText('Nome do agente'), 'Analista QA'); await u.type(screen.getByLabelText('Propósito'), 'Preparar resumo da operação'); await u.selectOptions(screen.getByLabelText('Responsável'), 'pessoa'); await u.click(screen.getByRole('button', { name: 'Salvar agente planejado' }));
    await waitFor(() => expect(created).toHaveBeenCalledWith('procedimento-qa')); const input = apiPost.mock.calls[0][1]; expect(input.modelo).toBe('local-modelo'); expect(input).not.toHaveProperty('estado'); expect(input).not.toHaveProperty('capacidades');
  });
  it('perda da resposta de criação conserva identificador e consulta registro depois de remontar', async () => {
    apiPost.mockRejectedValueOnce(Error('Resposta interrompida')); const props = { token: 'tok', pessoaId: 'pessoa', aoCriar: vi.fn(), aoFechar: () => {} }; const first = render(<CriarAgente {...props} />); const u = userEvent.setup();
    await screen.findByText('Modelo local: local-modelo'); await u.type(screen.getByLabelText('Nome do agente'), 'Analista QA'); await u.type(screen.getByLabelText('Propósito'), 'Preparar resumo da operação'); await u.selectOptions(screen.getByLabelText('Responsável'), 'pessoa'); await u.click(screen.getByRole('button', { name: 'Salvar agente planejado' })); await screen.findByText('Resposta interrompida'); const original = apiPost.mock.calls[0][1]; first.unmount();
    render(<CriarAgente {...props} />); await screen.findByText('Criação confirmada no servidor.'); expect(props.aoCriar).toHaveBeenCalledWith(criado.slug); expect(apiGet).toHaveBeenCalledWith(`/agents/pedidos/${original.requestId}`, 'tok'); expect(apiPost).toHaveBeenCalledTimes(1);
  });
  it('envia versão histórica exata e reencontra a versão usada', async () => {
    render(<ExecucaoLocal slug="procedimento-qa" token="tok" pessoaId="pessoa" podeExecutar />); const u = await preencher(); await u.click(screen.getByRole('button', { name: 'Iniciar procedimento local' }));
    await screen.findByText(resultado.resposta); expect(apiPost.mock.calls[0][1]).toMatchObject({ itemId: 'nota', versionId: 'versao1', contentHash: 'a'.repeat(64), expectedItemVersion: 2 }); expect(screen.getByRole('link', { name: 'Abrir fonte usada · v1' })).toHaveAttribute('href', '/contexto?nota=nota&versao=versao1'); expect(screen.getByRole('button', { name: 'Iniciar procedimento local' })).toBeDisabled();
  });
  it('resposta perdida conserva identificador após recarga e atualização, sem substituir versão usada', async () => {
    apiPost.mockRejectedValueOnce(Error('Resposta interrompida')); const props = { slug: 'procedimento-qa', token: 'tok', pessoaId: 'pessoa', podeExecutar: true }; const first = render(<ExecucaoLocal {...props} />); const u = await preencher(); await u.click(screen.getByRole('button', { name: 'Iniciar procedimento local' })); await screen.findByText('Resposta interrompida'); const original = apiPost.mock.calls[0][1]; first.unmount();
    apiGet.mockImplementation(async (p: string) => p.includes('/pedidos/') ? { ...resultado, requestId: original.requestId } : { ...fontes, items: [{ ...fontes.items[0], versao: 3 }] }); render(<ExecucaoLocal {...props} />); await u.click(screen.getByRole('button', { name: 'Abrir procedimento local' })); await screen.findByText(resultado.resposta); expect(apiPost).toHaveBeenCalledTimes(1); expect(screen.getByRole('link', { name: 'Abrir fonte usada · v1' })).toHaveAttribute('href', '/contexto?nota=nota&versao=versao1');
  });
  it('modelo indisponível mostra impedimento do servidor e não envia pedido', async () => {
    apiGet.mockResolvedValue({ ...fontes, capacidadesExecutor: { ...caps, modelo: { ...caps.modelo, disponivel: false, motivo: 'Modelo local indisponível.' }, novasExecucoesPermitidas: false, impedimento: 'Modelo local indisponível.' } });
    render(<ExecucaoLocal slug="procedimento-qa" token="tok" pessoaId="pessoa" podeExecutar />); const u = await preencher(); expect(screen.getByRole('button', { name: 'Iniciar procedimento local' })).toBeDisabled(); expect(apiPost).not.toHaveBeenCalled(); expect(screen.queryByText(resultado.resposta)).not.toBeInTheDocument();
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
    const chave = Object.keys(localStorage).find((k) => k.startsWith('rootos:m05:'))!, preservado = localStorage.getItem(chave);
    let resolve!: (r: unknown) => void, reject!: (e: Error) => void;
    apiGet.mockImplementationOnce(() => new Promise((r, j) => { resolve = r; reject = j; })).mockResolvedValue({ ...fontes, items: [] });
    await u.click(screen.getByRole('button', { name: 'Atualizar fonte e conferir pedido' }));
    view.rerender(<ExecucaoLocal slug="procedimento-qa" token="tok-novo" pessoaId="outra-pessoa" podeExecutar />);
    await u.click(screen.getByRole('button', { name: 'Abrir procedimento local' }));
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
    await screen.findByText('Procedimento não disponível para esta conta.');
    expect(screen.queryByRole('option', { name: 'Fonte QA v2' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Pedido para o agente')).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('Pedido sem confirmação');
    const salvo = Object.values(localStorage).join(' '); expect(salvo).toContain(apiPost.mock.calls[0][1].requestId); expect(salvo).not.toContain('Resuma para a operação');
  });
  it('409 pede atualizar fonte explicitamente e conserva o texto', async () => {
    apiPost.mockRejectedValueOnce(new ErroDaApi('A fonte mudou', 409)); render(<ExecucaoLocal slug="procedimento-qa" token="tok" pessoaId="pessoa" podeExecutar />); const u = await preencher(); await u.click(screen.getByRole('button', { name: 'Iniciar procedimento local' })); await screen.findByText('A fonte mudou'); expect(screen.getByLabelText('Pedido para o agente')).toHaveValue('Resuma para a operação'); await u.click(screen.getByRole('button', { name: 'Atualizar fonte e conferir pedido' })); await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2)); expect(screen.getByLabelText('Pedido para o agente')).toBeDisabled(); expect(screen.getByLabelText('Pedido para o agente')).toHaveValue('Resuma para a operação');
  });
});
