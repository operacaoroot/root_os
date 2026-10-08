import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chaveDoPedido } from '@/app/contexto/RetratoDaFonte';
import { NotaAberta } from '@/app/contexto/NotaAberta';
const get = vi.fn(), post = vi.fn();
let userId = 'pessoa', token = 'token-qa';
vi.mock('@/lib/api', () => ({ apiGet: (...a: unknown[]) => get(...a), apiPost: (...a: unknown[]) => post(...a) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token, user: { id: userId }, ready: true, can: () => true }) }));
const itemId = '11111111-1111-4111-8111-111111111111', versionId = '22222222-2222-4222-8222-222222222222', listId = '33333333-3333-4333-8333-333333333333';
const escopo = { orgId: 'org-m05', userId: 'pessoa' };
const retrato = { itemId, chave: 'qa:fonte', colecao: 'manual_local', identidadeCanonica: { documentId: itemId, origemDaIdentidade: 'item_existente' }, versao: { versionId, numero: 1, contentHash: 'a'.repeat(64) }, title: 'TÍTULO PRIVADO QA', body: 'CORPO PRIVADO QA', versaoAtual: 1, arquivada: false, registradaEm: '2026-10-08T13:00:00Z', atualizadaNaMemoriaEm: '2026-10-08T13:01:00Z', origem: { tipo: 'operador', referencia: 'QA' }, estado: { coleta: 'nao_verificada', indexacao: 'nao_verificada', projecao: 'nao_verificada', ultimoReciboId: null }, acesso: { modelo: 'local_por_pessoa', verificadoEm: '2026-10-08T13:02:00Z', novoUsoPermitido: true }, citacao: { chave: 'qa:fonte', itemId, versao: 1, versionId, contentHash: 'a'.repeat(64) } };
const nota = { id: itemId, chave: retrato.chave, title: retrato.title, body: retrato.body, kind: 'nota', procedencia: 'operador:QA', sourceType: 'operador', sourceRef: 'QA', versao: 1, contentHash: 'a'.repeat(64), atualizadoEm: retrato.registradaEm, arquivadoEm: null, escopo, retratoFonte: retrato };
const versao = { id: versionId, title: nota.title, body: nota.body, kind: 'nota', versao: 1, contentHash: nota.contentHash, procedencia: nota.procedencia, mudanca: 'criacao', criadoEm: retrato.registradaEm, autorTipo: 'user', escopo, retratoFonte: retrato };
const resultado = { taskId: '44444444-4444-4444-8444-444444444444', listId, replayed: true, escopo, fonte: { id: 'elo', itemId, versionId, title: nota.title, body: nota.body, chave: nota.chave, versao: 1, contentHash: nota.contentHash, versaoAtual: 1, arquivada: false, retratoFonte: retrato } };
function servir(p: string) { if (p.includes('/tarefas/pedidos/')) return Promise.resolve(resultado); if (p.endsWith('/versoes')) return Promise.resolve([versao]); if (p === '/trabalho/estrutura') return Promise.resolve({ folders: [], listasSoltas: [{ id: listId, name: 'Lista QA' }], pessoas: [] }); return Promise.resolve(nota); }
beforeEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); userId = 'pessoa'; token = 'token-qa'; get.mockImplementation(servir); post.mockResolvedValue(resultado); });
async function preencher() { await screen.findByText('CORPO PRIVADO QA'); fireEvent.click(screen.getByRole('button', { name: 'Criar tarefa usando esta versão' })); await screen.findByRole('option', { name: 'Lista QA' }); fireEvent.change(screen.getByLabelText('Título da nova tarefa'), { target: { value: 'PEDIDO PRIVADO QA' } }); fireEvent.change(screen.getByLabelText('Lista de destino'), { target: { value: listId } }); }
describe('M05 interface de fonte com API simulada', () => {
  it('não persiste o payload privado da criação de tarefa', async () => { post.mockRejectedValue(Error('Resposta perdida')); render(<NotaAberta notaId={itemId} />); await preencher(); fireEvent.click(screen.getByRole('button', { name: 'Criar tarefa' })); await screen.findByRole('alert'); const storage = Object.values(localStorage).join(' '); expect(storage).not.toContain('PEDIDO PRIVADO QA'); expect(storage).not.toContain('a'.repeat(64)); expect(storage).toContain(post.mock.calls[0][1].requestId); });
  it('recupera tarefa confirmada por GET depois de remontar sem POST', async () => { post.mockRejectedValue(Error('Resposta perdida')); const first = render(<NotaAberta notaId={itemId} />); await preencher(); fireEvent.click(screen.getByRole('button', { name: 'Criar tarefa' })); await screen.findByRole('alert'); const requestId = post.mock.calls[0][1].requestId; first.unmount(); render(<NotaAberta notaId={itemId} />); await screen.findByRole('link', { name: 'Abrir tarefa criada' }); expect(get).toHaveBeenCalledWith(`/memoria/${itemId}/tarefas/pedidos/${requestId}`, token); expect(post).toHaveBeenCalledTimes(1); });
  it.each([401, 403, 404])('recusa %s no POST tira fonte e erro privado do DOM', async (status) => { post.mockRejectedValue(Object.assign(Error('DETALHE PRIVADO DE ERRO'), { status })); render(<NotaAberta notaId={itemId} />); await preencher(); fireEvent.click(screen.getByRole('button', { name: 'Criar tarefa' })); await screen.findByRole('alert'); expect(screen.queryByText('CORPO PRIVADO QA')).not.toBeInTheDocument(); expect(screen.queryByText('TÍTULO PRIVADO QA')).not.toBeInTheDocument(); expect(screen.queryByText('DETALHE PRIVADO DE ERRO')).not.toBeInTheDocument(); });
  it('mudança de pessoa sem troca de token limpa corpo enquanto nova leitura espera', async () => { const tela = render(<NotaAberta notaId={itemId} />); await screen.findByText('CORPO PRIVADO QA'); userId = 'outra-pessoa'; get.mockImplementation(() => new Promise(() => {})); tela.rerender(<NotaAberta notaId={itemId} />); expect(screen.queryByText('CORPO PRIVADO QA')).not.toBeInTheDocument(); });
  it('não aceita escopo de outra pessoa para a fonte', async () => { get.mockImplementation(async (p: string) => p.endsWith('/versoes') ? [versao] : ({ ...nota, escopo: { ...escopo, userId: 'outro' } })); render(<NotaAberta notaId={itemId} />); await screen.findByRole('alert'); expect(screen.queryByText('CORPO PRIVADO QA')).not.toBeInTheDocument(); });

  it('404 de recuperação mantém pista e retira privados sem novo POST', async () => {
    post.mockRejectedValue(Error('Resposta perdida')); const first = render(<NotaAberta notaId={itemId} />); await preencher(); fireEvent.click(screen.getByRole('button', { name: 'Criar tarefa' })); await screen.findByRole('alert'); const id = post.mock.calls[0][1].requestId; first.unmount(); get.mockImplementation((p: string) => p.includes('/tarefas/pedidos/') ? Promise.reject(Object.assign(Error('DETALHE PRIVADO'), { status: 404 })) : servir(p)); render(<NotaAberta notaId={itemId} />); await screen.findByRole('alert'); expect(screen.getByRole('status')).toHaveTextContent('Pedido sem confirmação'); expect(screen.queryByText('CORPO PRIVADO QA')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Criar tarefa' })).not.toBeInTheDocument(); expect(Object.values(localStorage).join(' ')).toContain(id); expect(post).toHaveBeenCalledTimes(1);
  });
  it('pedido legado conserva só UUID e encontra tarefa original', async () => {
    const id = '55555555-5555-4555-8555-555555555555'; localStorage.setItem(`root_contexto_pedido:pessoa:${itemId}`, JSON.stringify({ requestId: id, assinatura: 'CONTEÚDO PRIVADO', pedido: { title: 'TÍTULO LEGADO PRIVADO' } })); render(<NotaAberta notaId={itemId} />); await screen.findByRole('link', { name: 'Abrir tarefa criada' }); expect(get).toHaveBeenCalledWith(`/memoria/${itemId}/tarefas/pedidos/${id}`, token); expect(post).not.toHaveBeenCalled(); expect(Object.values(localStorage).join(' ')).not.toContain('CONTEÚDO PRIVADO');
  });
  it('histórico de outra empresa não publica corpo mesmo com nota permitida', async () => {
    get.mockImplementation((p: string) => p.endsWith('/versoes') ? Promise.resolve([{ ...versao, escopo: { ...escopo, orgId: 'outra-org' } }]) : servir(p)); render(<NotaAberta notaId={itemId} />); await screen.findByRole('alert'); expect(screen.queryByText('CORPO PRIVADO QA')).not.toBeInTheDocument();
  });
  it('corpo do retrato divergente da versão não é exibido', async () => {
    get.mockImplementation((p: string) => p.endsWith('/versoes') ? Promise.resolve([{ ...versao, retratoFonte: { ...retrato, body: 'OUTRO CORPO' } }]) : servir(p)); render(<NotaAberta notaId={itemId} />); await screen.findByRole('alert'); expect(screen.queryByText('CORPO PRIVADO QA')).not.toBeInTheDocument(); expect(screen.queryByText('OUTRO CORPO')).not.toBeInTheDocument();
  });
  it('resposta de recuperação com outra empresa não anuncia tarefa criada', async () => {
    localStorage.setItem(`root_contexto_pedido:pessoa:${itemId}`, JSON.stringify({ requestId: '55555555-5555-4555-8555-555555555555' })); get.mockImplementation((p: string) => p.includes('/tarefas/pedidos/') ? Promise.resolve({ ...resultado, escopo: { ...escopo, orgId: 'outra-empresa' } }) : servir(p)); render(<NotaAberta notaId={itemId} />); await screen.findByRole('alert'); expect(screen.queryByRole('link', { name: 'Abrir tarefa criada' })).not.toBeInTheDocument(); expect(screen.queryByText('CORPO PRIVADO QA')).not.toBeInTheDocument(); expect(post).not.toHaveBeenCalled();
  });
  it('POST tardio da pessoa anterior não publica tarefa nem resultado', async () => {
    let resolver!: (v: unknown) => void; post.mockImplementation(() => new Promise((r) => { resolver = r; })); const tela = render(<NotaAberta notaId={itemId} />); await preencher(); fireEvent.click(screen.getByRole('button', { name: 'Criar tarefa' })); userId = 'outra-pessoa'; get.mockImplementation(() => new Promise(() => {})); tela.rerender(<NotaAberta notaId={itemId} />); await act(async () => resolver(resultado)); expect(screen.queryByRole('link', { name: 'Abrir tarefa criada' })).not.toBeInTheDocument(); expect(screen.queryByText('CORPO PRIVADO QA')).not.toBeInTheDocument();
  });


  it('falha de storage na migração da tarefa mantém pista e zero POST', async () => {
    const id = '55555555-5555-4555-8555-555555555555'; localStorage.setItem(`root_contexto_pedido:pessoa:${itemId}`, JSON.stringify({ requestId: id, pedido: { title: 'PRIVADO LEGADO' } })); const grava = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('Quota'); });
    try { get.mockImplementation((p: string) => p.includes('/tarefas/pedidos/') ? Promise.reject(Object.assign(Error('Sem confirmação'), { status: 404 })) : servir(p)); render(<NotaAberta notaId={itemId} />); await screen.findByRole('alert'); expect(get.mock.calls.every((c) => !c[0].includes('/tarefas/pedidos/'))).toBe(true); expect(screen.queryByText('CORPO PRIVADO QA')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Criar tarefa usando esta versão' })).not.toBeInTheDocument(); expect(post).not.toHaveBeenCalled(); expect(localStorage.getItem(`root_contexto_pedido:pessoa:${itemId}`)).toContain(id); } finally { grava.mockRestore(); }
  });


  it('leitura de storage recusada na tarefa bloqueia criação e conserva pista', async () => {
    const chave = chaveDoPedido(escopo, 'tarefa', itemId); const id = '55555555-5555-4555-8555-555555555555'; localStorage.setItem(chave, JSON.stringify({ ...escopo, requestId: id, operation: 'tarefa', itemId })); const original = Storage.prototype.getItem;
    const leitura = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) { if (key === chave) throw Error('Leitura recusada'); return original.call(this, key); });
    try { render(<NotaAberta notaId={itemId} />); await screen.findByRole('alert'); expect(screen.queryByRole('button', { name: 'Criar tarefa usando esta versão' })).not.toBeInTheDocument(); expect(screen.queryByText('CORPO PRIVADO QA')).not.toBeInTheDocument(); expect(post).not.toHaveBeenCalled(); expect(original.call(localStorage, chave)).toContain(id); } finally { leitura.mockRestore(); }
  });


  it.each([404, 503])('remontagem após falha total de gravação conserva pedido de tarefa com erro %s', async (status) => {
    const id = '55555555-5555-4555-8555-555555555555', antiga = `root_contexto_pedido:pessoa:${itemId}`;
    localStorage.setItem(antiga, JSON.stringify({ requestId: id, pedido: { title: 'PRIVADO LEGADO' } }));
    const grava = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('Quota'); });
    get.mockImplementation((p: string) => p.includes('/tarefas/pedidos/') ? Promise.reject(Object.assign(Error('Sem confirmação'), { status })) : servir(p));
    const primeira = render(<NotaAberta notaId={itemId} />);
    try { await screen.findByRole('alert'); expect(post).not.toHaveBeenCalled(); expect(localStorage.getItem(antiga)).toContain(id); expect(grava.mock.calls.every((c) => !c[1].includes('PRIVADO LEGADO'))).toBe(true); }
    finally { primeira.unmount(); grava.mockRestore(); }
    get.mockClear(); render(<NotaAberta notaId={itemId} />);
    await waitFor(() => expect(get).toHaveBeenCalledWith(`/memoria/${itemId}/tarefas/pedidos/${id}`, token));
    await screen.findByRole('alert'); expect(screen.getByRole('status')).toHaveTextContent('Pedido sem confirmação');
    expect(screen.queryByRole('button', { name: 'Criar tarefa' })).not.toBeInTheDocument(); expect(post).not.toHaveBeenCalled();
    expect(localStorage.getItem(antiga)).toBeNull(); expect(Object.values(localStorage).join(' ')).toContain(id); expect(Object.values(localStorage).join(' ')).not.toContain('PRIVADO LEGADO');
  });

});
