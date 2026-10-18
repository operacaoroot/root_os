import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chaveDoPedido } from '@/app/contexto/RetratoDaFonte';
import { ExecucaoLocal } from '@/app/agentes/ExecucaoLocal';
import { ErroDaApi } from '@/lib/api';
const get = vi.fn(), post = vi.fn();
vi.mock('@/lib/api', async () => ({ ...await vi.importActual<typeof import('@/lib/api')>('@/lib/api'), apiGet: (...a: unknown[]) => get(...a), apiPost: (...a: unknown[]) => post(...a) }));
const escopo = { orgId: 'org-m05', userId: 'pessoa', agentId: 'agente', agentSlug: 'procedimento-qa' };
const retrato = { itemId: 'nota', chave: 'qa:nota', colecao: 'manual_local', identidadeCanonica: { documentId: 'nota', origemDaIdentidade: 'item_existente' }, versao: { versionId: 'versao1', numero: 1, contentHash: 'a'.repeat(64) }, title: 'Fonte histórica QA', body: null, versaoAtual: 2, arquivada: false, registradaEm: '2026-10-08T13:00:00Z', atualizadaNaMemoriaEm: '2026-10-08T13:01:00Z', origem: { tipo: 'operador', referencia: 'QA' }, estado: { coleta: 'nao_verificada', indexacao: 'nao_verificada', projecao: 'nao_verificada', ultimoReciboId: null }, acesso: { modelo: 'local_por_pessoa', verificadoEm: '2026-10-08T13:02:00Z', novoUsoPermitido: true }, citacao: { chave: 'qa:nota', itemId: 'nota', versao: 1, versionId: 'versao1', contentHash: 'a'.repeat(64) } };
const caps = { modo: 'sintese_local_sem_ferramentas', capacidades: { lerVersao: true, sintetizarLocalmente: true, registrarResultado: true, ferramentasExternas: false, agendamento: false, cancelarInferencia: false }, agente: { id: 'agente', slug: 'procedimento-qa', estado: 'ativo', ativo: true, procedimentoVersao: 1 }, modelo: { disponivel: true, modelo: 'modelo-local-qa', motivo: null, provider: 'llama.cpp-local' }, novasExecucoesPermitidas: true, impedimento: null };
const fontes = { escopo, capacidadesExecutor: caps, modelo: caps.modelo, items: [{ id: 'nota', title: 'Atual QA', chave: 'qa:nota', versao: 2, versoes: [{ id: 'versao1', title: retrato.title, versao: 1, contentHash: 'a'.repeat(64), retratoFonte: retrato }] }] };
const resultado = { id: 'execucao', requestId: '11111111-1111-4111-8111-111111111111', status: 'respondida', motivo: null, pedido: 'PEDIDO PRIVADO QA', resposta: 'RESULTADO PRIVADO QA', modeloConfigurado: 'modelo-local-qa', modeloUsado: 'modelo-local-qa', escopo, capacidadesExecutor: caps, retratoFonte: { ...retrato, body: 'CORPO PRIVADO QA' }, fonte: { itemId: 'nota', versionId: 'versao1', title: retrato.title, versao: 1, contentHash: 'a'.repeat(64) }, consumo: { tokensIn: 30, tokensOut: 20, custoExternoUsd: 0, custoMaquinaMedido: false } };
const props = { slug: 'procedimento-qa', token: 'token-qa', pessoaId: 'pessoa', podeExecutar: true };
beforeEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); get.mockImplementation(async (p: string) => p.includes('/pedidos/') || p.includes('/execucoes/') ? resultado : fontes); post.mockImplementation(async (_p: string, input: { requestId: string }) => ({ ...resultado, requestId: input.requestId })); });
async function preencher() { fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' })); await screen.findByText('Modelo disponível: modelo-local-qa'); fireEvent.change(screen.getByLabelText('Fonte do procedimento'), { target: { value: 'nota' } }); fireEvent.change(screen.getByLabelText('Versão da fonte'), { target: { value: 'versao1' } }); fireEvent.change(screen.getByLabelText('Pedido para o agente'), { target: { value: 'PEDIDO PRIVADO QA' } }); }
describe('M05 interface do procedimento com API simulada', () => {
  it('não guarda pedido, título, corpo ou hash privado no navegador após resposta perdida', async () => { post.mockRejectedValue(Error('Resposta perdida')); render(<ExecucaoLocal {...props} />); await preencher(); fireEvent.click(screen.getByRole('button', { name: 'Iniciar procedimento local' })); await screen.findByText('Resposta perdida'); const valores = Object.values(localStorage).join(' '); expect(valores).not.toContain('PEDIDO PRIVADO QA'); expect(valores).not.toContain('Fonte histórica QA'); expect(valores).not.toContain('a'.repeat(64)); expect(valores).toContain(post.mock.calls[0][1].requestId); });
  it('após recarga encontra o pedido por GET sem repetir POST nem reconstruir payload', async () => { post.mockRejectedValue(Error('Resposta perdida')); const first = render(<ExecucaoLocal {...props} />); await preencher(); fireEvent.click(screen.getByRole('button', { name: 'Iniciar procedimento local' })); await screen.findByText('Resposta perdida'); const requestId = post.mock.calls[0][1].requestId; first.unmount(); get.mockImplementation(async (p: string) => p.includes('/pedidos/') ? { ...resultado, requestId } : fontes); render(<ExecucaoLocal {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' })); await screen.findByText('RESULTADO PRIVADO QA'); expect(get).toHaveBeenCalledWith(`/agents/procedimento-qa/procedimento/pedidos/${requestId}`, props.token); expect(post).toHaveBeenCalledTimes(1); });
  it('retorno de outra empresa não publica fontes', async () => { get.mockResolvedValue({ ...fontes, escopo: { ...escopo, userId: 'outra-pessoa' } }); render(<ExecucaoLocal {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' })); await screen.findByRole('alert'); expect(screen.queryByRole('option', { name: 'Atual QA' })).not.toBeInTheDocument(); });
  it('atualizar fontes não apaga um pedido incerto nem libera novo POST', async () => { post.mockRejectedValue(new ErroDaApi('Fonte mudou', 409)); render(<ExecucaoLocal {...props} />); await preencher(); fireEvent.click(screen.getByRole('button', { name: 'Iniciar procedimento local' })); await screen.findByText('Fonte mudou'); fireEvent.click(screen.getByRole('button', { name: /Atualizar fonte/ })); await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(1)); expect(screen.getByLabelText('Pedido para o agente')).toBeDisabled(); expect(post).toHaveBeenCalledTimes(1); });
  it.each([401, 403, 404])('recusa %s ao conferir resultado retira conteúdo e link', async (status) => { render(<ExecucaoLocal {...props} />); await preencher(); fireEvent.click(screen.getByRole('button', { name: 'Iniciar procedimento local' })); await screen.findByText('RESULTADO PRIVADO QA'); get.mockRejectedValue(Object.assign(Error('DETALHE PRIVADO DE ERRO'), { status })); fireEvent.click(screen.getByRole('button', { name: 'Conferir execução e acesso' })); await screen.findByRole('alert'); expect(screen.queryByText('RESULTADO PRIVADO QA')).not.toBeInTheDocument(); expect(screen.queryByRole('link', { name: /Abrir fonte usada/ })).not.toBeInTheDocument(); expect(screen.queryByText('DETALHE PRIVADO DE ERRO')).not.toBeInTheDocument(); });

  it('404 após recarga conserva só identificador e bloqueia novo pedido', async () => {
    post.mockRejectedValue(Error('Resposta perdida')); const first = render(<ExecucaoLocal {...props} />); await preencher(); fireEvent.click(screen.getByRole('button', { name: 'Iniciar procedimento local' })); await screen.findByText('Resposta perdida'); const id = post.mock.calls[0][1].requestId; first.unmount();
    get.mockImplementation(async (p: string) => { if (p.includes('/pedidos/')) throw new ErroDaApi('Sem confirmação privada', 404); return fontes; }); render(<ExecucaoLocal {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' })); await screen.findByRole('alert');
    expect(screen.getByRole('status')).toHaveTextContent('Pedido sem confirmação'); expect(screen.getByLabelText('Pedido para o agente')).toHaveValue(''); expect(screen.queryByRole('button', { name: 'Iniciar procedimento local' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Reenviar mesmo pedido' })).not.toBeInTheDocument(); expect(Object.values(localStorage).join(' ')).toContain(id); expect(post).toHaveBeenCalledTimes(1);
  });
  it('migra apenas requestId UUID de pedido legado e apaga o corpo privado', async () => {
    localStorage.setItem('rootos:execucao-agente:pessoa:procedimento-qa', JSON.stringify({ requestId: resultado.requestId, pedido: 'PEDIDO LEGADO PRIVADO', itemId: 'nota', versionId: 'versao1', contentHash: 'a'.repeat(64) })); render(<ExecucaoLocal {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' })); await screen.findByText('RESULTADO PRIVADO QA'); expect(post).not.toHaveBeenCalled(); expect(localStorage.getItem('rootos:execucao-agente:pessoa:procedimento-qa')).toBeNull(); expect(Object.values(localStorage).join(' ')).not.toContain('PEDIDO LEGADO PRIVADO'); expect(get).toHaveBeenCalledWith(`/agents/procedimento-qa/procedimento/pedidos/${resultado.requestId}`, props.token);
  });
  it('legado inválido não produz GET de pedido nem POST', async () => {
    localStorage.setItem('rootos:execucao-agente:pessoa:procedimento-qa', JSON.stringify({ requestId: 'invalido', pedido: 'PRIVADO LEGADO' })); render(<ExecucaoLocal {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' })); await screen.findByText('Modelo disponível: modelo-local-qa'); expect(get.mock.calls.every((c) => !c[0].includes('/pedidos/'))).toBe(true); expect(localStorage.getItem('rootos:execucao-agente:pessoa:procedimento-qa')).toBeNull(); expect(post).not.toHaveBeenCalled();
  });
  it('migra pista UUID de sessão confirmada e consulta GET existente sem inferência', async () => {
    const sessionId = '22222222-2222-4222-8222-222222222222'; localStorage.setItem('rootos:execucao-agente:pessoa:procedimento-qa:ultima', sessionId); get.mockImplementation(async (p: string) => p.includes('/execucoes/') ? { ...resultado, id: sessionId } : fontes); render(<ExecucaoLocal {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' })); await screen.findByText('RESULTADO PRIVADO QA'); expect(get).toHaveBeenCalledWith(`/agents/procedimento-qa/procedimento/execucoes/${sessionId}`, props.token); expect(post).not.toHaveBeenCalled(); expect(localStorage.getItem('rootos:execucao-agente:pessoa:procedimento-qa:ultima')).toBeNull();
  });
  it('pista de sessão sem confirmação não libera POST', async () => {
    const sessionId = '22222222-2222-4222-8222-222222222222'; localStorage.setItem('rootos:execucao-agente:pessoa:procedimento-qa:ultima', sessionId); get.mockImplementation(async (p: string) => { if (p.includes('/execucoes/')) throw new ErroDaApi('Não encontrado', 404); return fontes; }); render(<ExecucaoLocal {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' })); await screen.findByRole('alert'); expect(screen.getByRole('status')).toHaveTextContent('Execução anterior sem confirmação'); expect(screen.queryByRole('button', { name: 'Iniciar procedimento local' })).not.toBeInTheDocument(); expect(post).not.toHaveBeenCalled(); expect(Object.values(localStorage).join(' ')).toContain(sessionId);
  });
  it('empresa divergente na reconferência limpa retrato já exibido', async () => {
    render(<ExecucaoLocal {...props} />); await preencher(); get.mockResolvedValue({ ...fontes, escopo: { ...escopo, orgId: 'outra-empresa' } }); fireEvent.click(screen.getByRole('button', { name: 'Conferir fontes e acesso' })); await screen.findByRole('alert'); expect(screen.queryByRole('option', { name: 'Atual QA' })).not.toBeInTheDocument(); expect(screen.queryByRole('region', { name: 'Retrato da fonte selecionada' })).not.toBeInTheDocument();
  });
  it.each(['token', 'pessoaId', 'slug'])('resposta POST atrasada não aparece após trocar %s', async (campo) => {
    let resolver!: (v: unknown) => void; post.mockImplementation(() => new Promise((r) => { resolver = r; })); const tela = render(<ExecucaoLocal {...props} />); await preencher(); fireEvent.click(screen.getByRole('button', { name: 'Iniciar procedimento local' })); const id = post.mock.calls[0][1].requestId; tela.rerender(<ExecucaoLocal {...props} {...{ [campo]: campo === 'slug' ? 'procedimento-outro' : 'outra-identidade' }} />); await act(async () => resolver({ ...resultado, requestId: id })); expect(screen.queryByText('RESULTADO PRIVADO QA')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Abrir procedimento local' })).toBeEnabled();
  });
  it('agente pausado usa impedimento recebido e não oferece efeito', async () => {
    get.mockResolvedValue({ ...fontes, capacidadesExecutor: { ...caps, agente: { ...caps.agente, estado: 'pausado' }, novasExecucoesPermitidas: false, impedimento: 'Agente pausado.' } }); render(<ExecucaoLocal {...props} />); await preencher(); expect(screen.getByText('Estado do agente: pausado')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Iniciar procedimento local' })).toBeDisabled(); expect(post).not.toHaveBeenCalled();
  });
  it('citação adulterada na lista não publica fonte', async () => {
    get.mockResolvedValue({ ...fontes, items: [{ ...fontes.items[0], versoes: [{ ...fontes.items[0].versoes[0], retratoFonte: { ...retrato, citacao: { ...retrato.citacao, versionId: 'outra-versao' } } }] }] }); render(<ExecucaoLocal {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' })); await screen.findByRole('alert'); expect(screen.queryByRole('option', { name: 'Atual QA' })).not.toBeInTheDocument();
  });


  it('falha de storage na migração mantém UUID consultável e bloqueia novo efeito', async () => {
    const id = resultado.requestId; localStorage.setItem('rootos:execucao-agente:pessoa:procedimento-qa', JSON.stringify({ requestId: id, pedido: 'PRIVADO LEGADO' })); const grava = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('Quota'); });
    try { get.mockImplementation(async (p: string) => { if (p.includes('/pedidos/')) throw new ErroDaApi('Sem confirmação', 404); return fontes; }); render(<ExecucaoLocal {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' })); await screen.findByRole('alert'); expect(get.mock.calls.every((c) => !c[0].includes('/pedidos/'))).toBe(true); expect(screen.queryByRole('option', { name: 'Atual QA' })).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Iniciar procedimento local' })).toBeDisabled(); expect(post).not.toHaveBeenCalled(); expect(localStorage.getItem('rootos:execucao-agente:pessoa:procedimento-qa')).toContain(id); } finally { grava.mockRestore(); }
  });


  it('leitura de storage recusada não confunde pedido guardado com ausência', async () => {
    const chave = chaveDoPedido(escopo, 'procedimento'); localStorage.setItem(chave, JSON.stringify({ ...escopo, requestId: resultado.requestId, operation: 'procedimento' })); const original = Storage.prototype.getItem;
    const leitura = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) { if (key === chave) throw Error('Leitura recusada'); return original.call(this, key); });
    try { render(<ExecucaoLocal {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' })); await screen.findByRole('alert'); expect(screen.queryByRole('option', { name: 'Atual QA' })).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Iniciar procedimento local' })).toBeDisabled(); expect(post).not.toHaveBeenCalled(); expect(original.call(localStorage, chave)).toContain(resultado.requestId); } finally { leitura.mockRestore(); }
  });


  it.each([404, 503])('remontagem após falha total de gravação conserva pedido de procedimento com erro %s', async (status) => {
    const id = resultado.requestId, antiga = 'rootos:execucao-agente:pessoa:procedimento-qa';
    localStorage.setItem(antiga, JSON.stringify({ requestId: id, pedido: 'PRIVADO LEGADO' }));
    const grava = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('Quota'); });
    get.mockImplementation(async (p: string) => { if (p.includes('/pedidos/')) throw new ErroDaApi('Sem confirmação', status); return fontes; });
    const primeira = render(<ExecucaoLocal {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' }));
    try { await screen.findByRole('alert'); expect(post).not.toHaveBeenCalled(); expect(localStorage.getItem(antiga)).toContain(id); expect(grava.mock.calls.every((c) => !c[1].includes('PRIVADO LEGADO'))).toBe(true); }
    finally { primeira.unmount(); grava.mockRestore(); }
    get.mockClear(); render(<ExecucaoLocal {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith(`/agents/procedimento-qa/procedimento/pedidos/${id}`, props.token));
    await screen.findByRole('alert'); expect(screen.getByRole('status')).toHaveTextContent('Pedido sem confirmação');
    expect(screen.queryByRole('button', { name: 'Iniciar procedimento local' })).not.toBeInTheDocument(); expect(post).not.toHaveBeenCalled();
    expect(localStorage.getItem(antiga)).toBeNull(); expect(Object.values(localStorage).join(' ')).toContain(id); expect(Object.values(localStorage).join(' ')).not.toContain('PRIVADO LEGADO');
  });


  it('recusa do destino secundário mantém dois pedidos sem liberar a montagem', async () => {
    const outro = '55555555-5555-4555-8555-555555555555', chave = chaveDoPedido(escopo, 'procedimento'), antiga = 'rootos:execucao-agente:pessoa:procedimento-qa';
    localStorage.setItem(chave, JSON.stringify({ ...escopo, requestId: resultado.requestId, operation: 'procedimento' }));
    localStorage.setItem(antiga, JSON.stringify({ requestId: outro, pedido: 'PRIVADO LEGADO' })); const original = Storage.prototype.setItem;
    const grava = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) { if (key === `${chave}:legado`) throw Error('Quota no destino secundário'); original.call(this, key, value); });
    get.mockImplementation(async (p: string) => { if (p.endsWith(`/pedidos/${outro}`)) throw new ErroDaApi('Sem confirmação', 404); return p.includes('/pedidos/') ? resultado : fontes; });
    const primeira = render(<ExecucaoLocal {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' }));
    try {
      await screen.findByRole('alert'); expect(screen.queryByText('RESULTADO PRIVADO QA')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Iniciar procedimento local' })).toBeDisabled();
      expect(get.mock.calls.every((c) => !c[0].includes('/pedidos/'))).toBe(true); expect(localStorage.getItem(chave)).toContain(resultado.requestId); expect(localStorage.getItem(antiga)).toContain(outro); expect(Object.values(localStorage).join(' ')).not.toContain('PRIVADO LEGADO'); expect(post).not.toHaveBeenCalled();
    } finally { primeira.unmount(); grava.mockRestore(); }
    get.mockClear(); render(<ExecucaoLocal {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Abrir procedimento local' }));
    await screen.findByText('RESULTADO PRIVADO QA'); expect(get).toHaveBeenCalledWith(`/agents/procedimento-qa/procedimento/pedidos/${resultado.requestId}`, props.token);
    fireEvent.click(screen.getByRole('button', { name: 'Preparar novo pedido' })); fireEvent.click(screen.getByRole('button', { name: 'Conferir pedido anterior' }));
    await screen.findByRole('alert'); expect(get).toHaveBeenCalledWith(`/agents/procedimento-qa/procedimento/pedidos/${outro}`, props.token); expect(screen.getByRole('status')).toHaveTextContent('Pedido sem confirmação'); expect(post).not.toHaveBeenCalled(); expect(localStorage.getItem(antiga)).toBeNull(); expect(localStorage.getItem(chave)).toContain(outro);
  });

});
