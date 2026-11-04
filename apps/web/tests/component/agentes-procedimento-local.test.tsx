import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CriarAgente } from '@/app/agentes/CriarAgente';
import { ExecucaoLocal } from '@/app/agentes/ExecucaoLocal';
import { ErroDaApi } from '@/lib/api';
import { AGENTE_LOCAL, MODELO_LOCAL, NOTA_LOCAL, ORG_LOCAL, OUTRA_PESSOA_LOCAL, PESSOA_LOCAL, VERSAO_LOCAL_1,
  escopoLocal, execucaoDoPedido, execucaoLocal, fontesLocais, mensagensDaExecucaoLocal as mensagens,
  painelLocal, recuperarExecucao, versaoLocal } from '../fixtures/procedimento-local';
const apiGet = vi.fn(), apiPost = vi.fn();
vi.mock('@/lib/api', async () => ({ ...await vi.importActual<typeof import('@/lib/api')>('@/lib/api'), apiGet: (...args: unknown[]) => apiGet(...args), apiPost: (...args: unknown[]) => apiPost(...args) }));
const escopoBase = { orgId: ORG_LOCAL, userId: PESSOA_LOCAL };
const criado = { id: AGENTE_LOCAL, slug: escopoLocal.agentSlug, escopo: escopoLocal };
const config = { escopo: escopoBase, pessoas: [{ id: PESSOA_LOCAL, name: 'Pessoa QA' }], modelo: { disponivel: true, modelo: MODELO_LOCAL, motivo: null }, procedimentoSuportado: 'Síntese local sem ferramentas externas' };
const historica = versaoLocal(1, 'Fonte QA v1');
const fontes = fontesLocais('Fonte QA v2', versaoLocal(2, 'Fonte QA v2'), historica);
const resultado = execucaoLocal(historica, 'Resuma para a operação', 'Texto efetivamente vindo do modelo local', 'Fonte QA');
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  apiGet.mockImplementation(async (path: string) => {
    if (path === '/agents/configuracao') return config;
    if (path.startsWith('/agents/pedidos/')) return { ...criado, repetido: true };
    if (path.includes('/execucoes/')) return resultado;
    if (path.includes('/pedidos/')) return recuperarExecucao(resultado, path.split('/').at(-1));
    if (path.endsWith('/painel')) return painelLocal;
    return fontes;
  });
  apiPost.mockImplementation(async (_p, input) => execucaoDoPedido(resultado, input.requestId));
});
async function preencher() {
  const u = userEvent.setup(); await u.click(screen.getByRole('button', { name: 'Abrir procedimento local' }));
  await u.selectOptions(await screen.findByLabelText('Fonte do procedimento'), NOTA_LOCAL); await u.selectOptions(screen.getByLabelText('Versão da fonte'), VERSAO_LOCAL_1); await u.type(screen.getByLabelText('Pedido para o agente'), 'Resuma para a operação'); return u;
}
describe('configuração e execução do agente local', () => {
  it('cria planejado com modelo observado e sem concessão de ferramentas externas', async () => {
    const created = vi.fn(); apiPost.mockResolvedValue(criado); render(<CriarAgente token="tok" pessoaId={PESSOA_LOCAL} aoCriar={created} aoFechar={() => {}} />); const u = userEvent.setup();
    await screen.findByText(`Modelo local: ${MODELO_LOCAL}`); await u.type(screen.getByLabelText('Nome do agente'), 'Analista QA'); await u.type(screen.getByLabelText('Propósito'), 'Preparar resumo da operação'); await u.selectOptions(screen.getByLabelText('Responsável'), PESSOA_LOCAL); await u.click(screen.getByRole('button', { name: 'Salvar agente planejado' }));
    await waitFor(() => expect(created).toHaveBeenCalledWith('procedimento-qa')); const input = apiPost.mock.calls[0][1]; expect(input.modelo).toBe(MODELO_LOCAL); expect(input).not.toHaveProperty('estado'); expect(input).not.toHaveProperty('capacidades');
  });
  it('perda da resposta de criação conserva identificador e consulta registro depois de remontar', async () => {
    apiPost.mockRejectedValueOnce(Error('Resposta interrompida')); const props = { token: 'tok', pessoaId: PESSOA_LOCAL, aoCriar: vi.fn(), aoFechar: () => {} }; const first = render(<CriarAgente {...props} />); const u = userEvent.setup();
    await screen.findByText(`Modelo local: ${MODELO_LOCAL}`); await u.type(screen.getByLabelText('Nome do agente'), 'Analista QA'); await u.type(screen.getByLabelText('Propósito'), 'Preparar resumo da operação'); await u.selectOptions(screen.getByLabelText('Responsável'), PESSOA_LOCAL); await u.click(screen.getByRole('button', { name: 'Salvar agente planejado' })); await screen.findByText('Resposta interrompida'); const original = apiPost.mock.calls[0][1]; first.unmount();
    render(<CriarAgente {...props} />); await screen.findByText('Criação confirmada no servidor.'); expect(props.aoCriar).toHaveBeenCalledWith(criado.slug); expect(apiGet).toHaveBeenCalledWith(`/agents/pedidos/${original.requestId}`, 'tok'); expect(apiPost).toHaveBeenCalledTimes(1);
  });
  it('envia versão histórica exata e reencontra a versão usada', async () => {
    render(<ExecucaoLocal slug="procedimento-qa" token="tok" pessoaId={PESSOA_LOCAL} podeExecutar />); const u = await preencher(); await u.click(screen.getByRole('button', { name: 'Iniciar procedimento local' }));
    await screen.findByText(resultado.resposta); expect(apiPost.mock.calls[0][1]).toMatchObject({ itemId: NOTA_LOCAL, versionId: VERSAO_LOCAL_1, contentHash: 'a'.repeat(64), expectedItemVersion: 2, expectedSopVersion: 1 }); expect(screen.getByRole('link', { name: 'Abrir fonte usada · v1' })).toHaveAttribute('href', `/contexto?nota=${NOTA_LOCAL}&versao=${VERSAO_LOCAL_1}`); expect(screen.getByRole('button', { name: 'Iniciar procedimento local' })).toBeDisabled();
  });
  it('resposta perdida conserva identificador após recarga e atualização, sem substituir versão usada', async () => {
    apiPost.mockRejectedValueOnce(Error('Resposta interrompida')); const props = { slug: 'procedimento-qa', token: 'tok', pessoaId: PESSOA_LOCAL, podeExecutar: true }; const first = render(<ExecucaoLocal {...props} />); const u = await preencher(); await u.click(screen.getByRole('button', { name: 'Iniciar procedimento local' })); await screen.findByText(mensagens.erroIncerto); const original = apiPost.mock.calls[0][1]; first.unmount();
    apiGet.mockImplementation(async (p: string) => p.includes('/pedidos/') ? recuperarExecucao(resultado, original.requestId) : { ...fontes, items: [{ ...fontes.items[0], versao: 3 }] }); render(<ExecucaoLocal {...props} />); await u.click(screen.getByRole('button', { name: 'Abrir procedimento local' })); await screen.findByText(resultado.resposta); expect(apiPost).toHaveBeenCalledTimes(1); expect(screen.getByRole('link', { name: 'Abrir fonte usada · v1' })).toHaveAttribute('href', `/contexto?nota=${NOTA_LOCAL}&versao=${VERSAO_LOCAL_1}`);
  });
  it('configuração inválida mostra impedimento do servidor e não envia pedido', async () => {
    apiGet.mockResolvedValue({ ...fontes, painel: { ...painelLocal,
      modelo: { configurado: null, declaracao: { ...painelLocal.modelo.declaracao, estado: 'configuracao_invalida' } },
      inicioLocal: { ...painelLocal.inicioLocal, permitido: false, impedimentosLocais: ['Configuração local inválida.'] },
    } });
    render(<ExecucaoLocal slug="procedimento-qa" token="tok" pessoaId={PESSOA_LOCAL} podeExecutar />); const u = await preencher(); expect(screen.getByRole('button', { name: 'Iniciar procedimento local' })).toBeDisabled(); expect(apiPost).not.toHaveBeenCalled(); expect(screen.queryByText(resultado.resposta)).not.toBeInTheDocument();
  });
  it('revogação atual elimina saída e metadados mostrados antes', async () => {
    render(<ExecucaoLocal slug="procedimento-qa" token="tok" pessoaId={PESSOA_LOCAL} podeExecutar />); const u = await preencher(); await u.click(screen.getByRole('button', { name: 'Iniciar procedimento local' })); await screen.findByText(resultado.resposta); apiGet.mockRejectedValueOnce(new ErroDaApi('Fonte indisponível', 404)); await u.click(screen.getByRole('button', { name: 'Conferir execução e acesso' })); await screen.findByRole('alert'); expect(screen.queryByText(resultado.resposta)).not.toBeInTheDocument(); expect(screen.queryByRole('link', { name: /Abrir fonte usada/ })).not.toBeInTheDocument(); expect(screen.queryByRole('option', { name: 'Fonte QA v2' })).not.toBeInTheDocument();
  });
  it('usuário sem execução lê histórico próprio mas não recebe botão de disparo', async () => {
    render(<ExecucaoLocal slug="procedimento-qa" token="tok" pessoaId={PESSOA_LOCAL} podeExecutar={false} />); const u = userEvent.setup(); await u.click(screen.getByRole('button', { name: 'Abrir procedimento local' })); await screen.findByText(mensagens.modelo); expect(screen.queryByRole('button', { name: 'Iniciar procedimento local' })).not.toBeInTheDocument();
  });
  it.each(['resposta', 'erro'])('atualização antiga após 409 descarta %s na troca de pessoa e preserva o pedido anterior', async (retorno) => {
    apiPost.mockRejectedValueOnce(new ErroDaApi('A fonte mudou', 409));
    const view = render(<ExecucaoLocal slug="procedimento-qa" token="tok-antigo" pessoaId={PESSOA_LOCAL} podeExecutar />);
    const u = await preencher(); await u.click(screen.getByRole('button', { name: 'Iniciar procedimento local' })); await screen.findByText(mensagens.conflito);
    const chave = Object.keys(localStorage).find((k) => k.startsWith('rootos:m05:'))!, preservado = localStorage.getItem(chave);
    let resolve!: (r: unknown) => void, reject!: (e: Error) => void;
    apiGet.mockImplementationOnce(() => new Promise((r, j) => { resolve = r; reject = j; })).mockResolvedValue({ ...fontes, escopo: { ...escopoLocal, userId: OUTRA_PESSOA_LOCAL },
      painel: { ...painelLocal, escopo: { ...escopoLocal, userId: OUTRA_PESSOA_LOCAL } }, items: [] });
    await u.click(screen.getByRole('button', { name: mensagens.conferirFontes }));
    view.rerender(<ExecucaoLocal slug="procedimento-qa" token="tok-novo" pessoaId={OUTRA_PESSOA_LOCAL} podeExecutar />);
    await u.click(screen.getByRole('button', { name: 'Abrir procedimento local' }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(4));
    await act(async () => { if (retorno === 'resposta') resolve(fontes); else reject(Error('Erro privado da sessão anterior')); });
    expect(screen.queryByRole('option', { name: 'Fonte QA v2' })).not.toBeInTheDocument();
    expect(screen.queryByText('Erro privado da sessão anterior')).not.toBeInTheDocument();
    expect(localStorage.getItem(chave)).toBe(preservado); expect(preservado).not.toBeNull();
    expect(screen.getByLabelText('Pedido para o agente')).toHaveValue('');
  });
  it('401 de execução elimina conteúdo privado visível e preserva o pedido no perfil da pessoa', async () => {
    apiPost.mockRejectedValueOnce(new ErroDaApi('Sessão recusada', 401));
    render(<ExecucaoLocal slug="procedimento-qa" token="tok" pessoaId={PESSOA_LOCAL} podeExecutar />);
    const u = await preencher(); await u.click(screen.getByRole('button', { name: 'Iniciar procedimento local' }));
    await screen.findByText('Procedimento não disponível para esta conta.');
    expect(screen.queryByRole('option', { name: 'Fonte QA v2' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Pedido para o agente')).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent(mensagens.pedidoPendente);
    const salvo = Object.values(localStorage).join(' '); expect(salvo).toContain(apiPost.mock.calls[0][1].requestId); expect(salvo).not.toContain('Resuma para a operação');
  });
  it('409 pede atualizar fonte explicitamente e conserva o texto', async () => {
    apiPost.mockRejectedValueOnce(new ErroDaApi('A fonte mudou', 409)); render(<ExecucaoLocal slug="procedimento-qa" token="tok" pessoaId={PESSOA_LOCAL} podeExecutar />); const u = await preencher(); await u.click(screen.getByRole('button', { name: 'Iniciar procedimento local' })); await screen.findByText(mensagens.conflito); expect(screen.getByLabelText('Pedido para o agente')).toHaveValue('Resuma para a operação'); await u.click(screen.getByRole('button', { name: mensagens.conferirFontes })); await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(3)); expect(screen.getByLabelText('Pedido para o agente')).toBeDisabled(); expect(screen.getByLabelText('Pedido para o agente')).toHaveValue('Resuma para a operação');
  });
});
