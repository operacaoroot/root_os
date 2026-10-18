import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chaveDoPedido } from '@/app/contexto/RetratoDaFonte';
import { CriarAgente } from '@/app/agentes/CriarAgente';
const get = vi.fn(), post = vi.fn();
vi.mock('@/lib/api', async () => ({ ...await vi.importActual<typeof import('@/lib/api')>('@/lib/api'), apiGet: (...a: unknown[]) => get(...a), apiPost: (...a: unknown[]) => post(...a) }));
const escopo = { orgId: 'org-m05', userId: 'pessoa' };
const config = { escopo, pessoas: [{ id: 'pessoa', name: 'Responsável QA' }], modelo: { disponivel: true, modelo: 'modelo-qa', motivo: null }, procedimentoSuportado: 'Síntese local' };
const resultado = { id: 'agente', slug: 'procedimento-qa', repetido: true, escopo: { ...escopo, agentId: 'agente', agentSlug: 'procedimento-qa' } };
const props = { token: 'token-qa', pessoaId: 'pessoa', aoCriar: vi.fn(), aoFechar: vi.fn() };
beforeEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); get.mockImplementation(async (p: string) => p.includes('/pedidos/') ? resultado : config); post.mockRejectedValue(Error('Resposta perdida')); });
async function preencher() { await screen.findByText('Modelo local: modelo-qa'); fireEvent.change(screen.getByLabelText('Nome do agente'), { target: { value: 'NOME PRIVADO QA' } }); fireEvent.change(screen.getByLabelText('Propósito'), { target: { value: 'PROPÓSITO PRIVADO QA' } }); fireEvent.change(screen.getByLabelText('Responsável'), { target: { value: 'pessoa' } }); }
describe('criação identificada com API simulada', () => {
 it('não persiste nome, propósito ou procedimento privado', async () => { render(<CriarAgente {...props} />); await preencher(); fireEvent.click(screen.getByRole('button', { name: 'Salvar agente planejado' })); await screen.findByText('Resposta perdida'); const texto = Object.values(localStorage).join(' '); expect(texto).toContain(post.mock.calls[0][1].requestId); expect(texto).not.toContain('NOME PRIVADO QA'); expect(texto).not.toContain('PROPÓSITO PRIVADO QA'); expect(texto).not.toContain('Ler a versão escolhida'); });
 it('recarga confirma criação registrada por GET sem reconstruir POST', async () => { const first = render(<CriarAgente {...props} />); await preencher(); fireEvent.click(screen.getByRole('button', { name: 'Salvar agente planejado' })); await screen.findByText('Resposta perdida'); const id = post.mock.calls[0][1].requestId; first.unmount(); render(<CriarAgente {...props} />); await screen.findByRole('status'); expect(get).toHaveBeenCalledWith(`/agents/pedidos/${id}`, props.token); expect(post).toHaveBeenCalledTimes(1); expect(props.aoCriar).toHaveBeenCalledWith('procedimento-qa'); });

 it('migra somente UUID do pedido legado sem reconstruir configuração', async () => { localStorage.setItem('rootos:criar-agente:pessoa', JSON.stringify({ requestId: '11111111-1111-4111-8111-111111111111', nome: 'NOME LEGADO PRIVADO', missao: 'MISSÃO PRIVADA', procedimento: { passos: ['PASSO PRIVADO'] } })); render(<CriarAgente {...props} />); await screen.findByText('Criação confirmada no servidor.'); expect(post).not.toHaveBeenCalled(); expect(localStorage.getItem('rootos:criar-agente:pessoa')).toBeNull(); expect(Object.values(localStorage).join(' ')).not.toContain('PASSO PRIVADO'); });
 it('404 de criação perdida bloqueia outro agente e mantém identificador', async () => { localStorage.setItem('rootos:criar-agente:pessoa', JSON.stringify({ requestId: '11111111-1111-4111-8111-111111111111', nome: 'NOME LEGADO PRIVADO' })); get.mockImplementation(async (p: string) => { if (p.includes('/pedidos/')) throw Object.assign(Error('DETALHE PRIVADO'), { status: 404 }); return config; }); render(<CriarAgente {...props} />); await screen.findByRole('alert'); expect(screen.getByRole('status')).toHaveTextContent('Pedido sem confirmação'); expect(screen.queryByRole('button', { name: 'Salvar agente planejado' })).not.toBeInTheDocument(); expect(props.aoCriar).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled(); expect(Object.values(localStorage).join(' ')).toContain('11111111-1111-4111-8111-111111111111'); });
 it('recuperação de criação com outro ator não dispara callback', async () => { localStorage.setItem('rootos:criar-agente:pessoa', JSON.stringify({ requestId: '11111111-1111-4111-8111-111111111111' })); get.mockImplementation(async (p: string) => p.includes('/pedidos/') ? { ...resultado, escopo: { ...resultado.escopo, userId: 'outro' } } : config); render(<CriarAgente {...props} />); await screen.findByRole('alert'); expect(props.aoCriar).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled(); });


 it('falha de storage na migração da criação mantém pista e zero POST', async () => { const id = '11111111-1111-4111-8111-111111111111'; localStorage.setItem('rootos:criar-agente:pessoa', JSON.stringify({ requestId: id, nome: 'PRIVADO LEGADO' })); const grava = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('Quota'); }); try { get.mockImplementation(async (p: string) => { if (p.includes('/pedidos/')) throw Object.assign(Error('Sem confirmação'), { status: 404 }); return config; }); render(<CriarAgente {...props} />); await screen.findByRole('alert'); expect(get.mock.calls.every((c) => !c[0].includes('/pedidos/'))).toBe(true); expect(screen.getByRole('button', { name: 'Salvar agente planejado' })).toBeDisabled(); expect(post).not.toHaveBeenCalled(); expect(localStorage.getItem('rootos:criar-agente:pessoa')).toContain(id); } finally { grava.mockRestore(); } });

 it('pista secundária continua consultável quando promoção no storage falha', async () => {
   const id = '11111111-1111-4111-8111-111111111111'; localStorage.setItem(`${chaveDoPedido(escopo, 'criacao')}:legado`, JSON.stringify({ ...escopo, requestId: id, operation: 'criacao' })); const grava = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('Quota'); });
   try { get.mockImplementation(async (p: string) => { if (p.includes('/pedidos/')) throw Object.assign(Error('Sem confirmação'), { status: 404 }); return config; }); render(<CriarAgente {...props} />); await screen.findByRole('alert'); expect(get).toHaveBeenCalledWith(`/agents/pedidos/${id}`, props.token); expect(screen.getByRole('status')).toHaveTextContent('Pedido sem confirmação'); expect(post).not.toHaveBeenCalled(); } finally { grava.mockRestore(); }
 });


 it('leitura de storage recusada na criação mantém pista e zero POST', async () => {
   const chave = chaveDoPedido(escopo, 'criacao'); const id = '11111111-1111-4111-8111-111111111111'; localStorage.setItem(chave, JSON.stringify({ ...escopo, requestId: id, operation: 'criacao' })); const original = Storage.prototype.getItem;
   const leitura = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) { if (key === chave) throw Error('Leitura recusada'); return original.call(this, key); });
   try { render(<CriarAgente {...props} />); await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'Salvar agente planejado' })).toBeDisabled(); expect(post).not.toHaveBeenCalled(); expect(original.call(localStorage, chave)).toContain(id); } finally { leitura.mockRestore(); }
 });


 it.each([404, 503])('remontagem após falha total de gravação conserva pedido de criação com erro %s', async (status) => {
   const id = '11111111-1111-4111-8111-111111111111', antiga = 'rootos:criar-agente:pessoa';
   localStorage.setItem(antiga, JSON.stringify({ requestId: id, nome: 'PRIVADO LEGADO' }));
   const grava = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('Quota'); });
   get.mockImplementation(async (p: string) => { if (p.includes('/pedidos/')) throw Object.assign(Error('Sem confirmação'), { status }); return config; });
   const primeira = render(<CriarAgente {...props} />);
   try { await screen.findByRole('alert'); expect(post).not.toHaveBeenCalled(); expect(localStorage.getItem(antiga)).toContain(id); expect(grava.mock.calls.every((c) => !c[1].includes('PRIVADO LEGADO'))).toBe(true); }
   finally { primeira.unmount(); grava.mockRestore(); }
   get.mockClear(); render(<CriarAgente {...props} />);
   await waitFor(() => expect(get).toHaveBeenCalledWith(`/agents/pedidos/${id}`, props.token));
   await screen.findByRole('alert'); expect(screen.getByRole('status')).toHaveTextContent('Pedido sem confirmação');
   expect(screen.queryByRole('button', { name: 'Salvar agente planejado' })).not.toBeInTheDocument(); expect(post).not.toHaveBeenCalled(); expect(props.aoCriar).not.toHaveBeenCalled();
   expect(localStorage.getItem(antiga)).toBeNull(); expect(Object.values(localStorage).join(' ')).toContain(id); expect(Object.values(localStorage).join(' ')).not.toContain('PRIVADO LEGADO');
 });


 it('metadados no legado preservam criação na falha parcial e remontagem', async () => {
   const id = '11111111-1111-4111-8111-111111111111', antiga = 'rootos:criar-agente:pessoa', destino = chaveDoPedido(escopo, 'criacao');
   localStorage.setItem(antiga, JSON.stringify({ requestId: id, nome: 'PRIVADO LEGADO' })); const original = Storage.prototype.setItem;
   const grava = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) { if (key === destino) throw Error('Quota no destino'); original.call(this, key, value); });
   get.mockImplementation(async (p: string) => { if (p.includes('/pedidos/')) throw Object.assign(Error('Sem confirmação'), { status: 404 }); return config; });
   const primeira = render(<CriarAgente {...props} />);
   try {
     await screen.findByRole('alert'); expect(get.mock.calls.every((c) => !c[0].includes('/pedidos/'))).toBe(true); expect(screen.getByRole('button', { name: 'Salvar agente planejado' })).toBeDisabled();
     expect(JSON.parse(localStorage.getItem(antiga)!)).toEqual({ ...escopo, requestId: id, operation: 'criacao' }); expect(Object.values(localStorage).join(' ')).not.toContain('PRIVADO LEGADO'); expect(post).not.toHaveBeenCalled();
   } finally { primeira.unmount(); grava.mockRestore(); }
   get.mockClear(); render(<CriarAgente {...props} />);
   await waitFor(() => expect(get).toHaveBeenCalledWith(`/agents/pedidos/${id}`, props.token)); await screen.findByRole('alert');
   expect(screen.getByRole('status')).toHaveTextContent('Pedido sem confirmação'); expect(post).not.toHaveBeenCalled(); expect(localStorage.getItem(antiga)).toBeNull(); expect(localStorage.getItem(destino)).toContain(id);
 });

});
