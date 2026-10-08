import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrabAtividadeDto, TrabAtividadePagina } from '@mktos/shared';
const get = vi.fn();
vi.mock('@/lib/api', () => ({ apiGet: (...a: unknown[]) => get(...a) }));
import { AtividadeDaTarefa } from '@/components/trabalho/AtividadeDaTarefa';

const NOW = '2026-10-08T04:00:00.000Z';
const props = { taskId: 'qa-tarefa-a', userId: 'qa-pessoa-a', token: 'qa-sessao-a' };
const escopo = { orgId: 'qa-empresa-a', taskId: props.taskId, userId: props.userId };
const eventos: TrabAtividadeDto[] = Array.from({ length: 121 }, (_, i) => ({
  id: 'qa-evento-' + String(121 - i).padStart(4, '0'), action: 'work.task.update',
  actorType: 'user', actorName: 'Pessoa QA', createdAt: NOW,
  before: { status: 'Revisão QA', material: i === 120 ? 'CANARIO ANTIGO QA' : 'Material QA ' + i },
  after: { status: 'Concluído QA', material: 'Material preservado ' + i },
}));
const anchor = { createdAt: NOW, id: eventos[0].id };
function pagina(items: TrabAtividadeDto[], extra: Partial<TrabAtividadePagina> = {}): TrabAtividadePagina {
  return { escopo, consultadoEm: NOW, items, limit: 50, hasMore: false, nextCursor: null, anchor, ...extra };
}
const first = () => pagina(eventos.slice(0, 50), { hasMore: true, nextCursor: 'cursor-a' });
function pendente<T>() {
  let resolve!: (x: T) => void, reject!: (x: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
const ids = () => [...document.querySelectorAll('[data-work-activity-id]')].map((e) => e.getAttribute('data-work-activity-id'));
const loadMore = () => fireEvent.click(screen.getByRole('button', { name: 'Carregar atividades anteriores' }));
beforeEach(() => { get.mockReset(); get.mockResolvedValue(first()); });
afterEach(cleanup);

describe('M02: atividade paginada da tarefa, API simulada', () => {
  it('consulta121 registros com empate de data, canário antigo, três páginas e fim explícito', async () => {
    get.mockResolvedValueOnce(first())
      .mockResolvedValueOnce(pagina(eventos.slice(50, 100), { hasMore: true, nextCursor: 'cursor-b' }))
      .mockResolvedValueOnce(pagina(eventos.slice(100)));
    render(<AtividadeDaTarefa {...props} />);
    await screen.findByText('50 atividades carregadas.');
    expect(screen.queryByText('Fim desta consulta.')).not.toBeInTheDocument();
    loadMore(); await screen.findByText('100 atividades carregadas.');
    loadMore(); await screen.findByText('121 atividades carregadas.');
    expect(ids()).toEqual(eventos.map((a) => a.id));
    expect(new Set(ids()).size).toBe(121);
    expect(screen.getByText(/CANARIO ANTIGO QA/)).toBeInTheDocument();
    expect(screen.getByText('Fim desta consulta.')).toBeInTheDocument();
    expect(get.mock.calls.map(([p]) => p)).toEqual([
      '/trabalho/tarefas/qa-tarefa-a/atividade?limit=50',
      '/trabalho/tarefas/qa-tarefa-a/atividade?limit=50&cursor=cursor-a',
      '/trabalho/tarefas/qa-tarefa-a/atividade?limit=50&cursor=cursor-b',
    ]);
    expect(get.mock.calls.every(([, t]) => t === props.token)).toBe(true);
  });
  it('erro na segunda página mantém a primeira e repete o mesmo cursor', async () => {
    get.mockResolvedValueOnce(first()).mockRejectedValueOnce(new TypeError('Conexão QA interrompida.'))
      .mockResolvedValueOnce(pagina(eventos.slice(50, 100), { hasMore: true, nextCursor: 'cursor-b' }));
    render(<AtividadeDaTarefa {...props} />); await screen.findByText('50 atividades carregadas.');
    loadMore(); await screen.findByText('Conexão QA interrompida.');
    expect(ids()).toEqual(eventos.slice(0, 50).map((a) => a.id));
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByText('100 atividades carregadas.');
    expect(get.mock.calls[1]).toEqual(get.mock.calls[2]);
  });
  it('cliques repetidos durante a busca não abrem duas páginas', async () => {
    const late = pendente<TrabAtividadePagina>(); get.mockResolvedValueOnce(first()).mockReturnValueOnce(late.promise);
    render(<AtividadeDaTarefa {...props} />); await screen.findByText('50 atividades carregadas.');
    const more = screen.getByRole('button', { name: 'Carregar atividades anteriores' });
    fireEvent.click(more); fireEvent.click(more); expect(get).toHaveBeenCalledTimes(2);
    await act(async () => late.resolve(pagina(eventos.slice(50, 100), { hasMore: true, nextCursor: 'cursor-b' })));
    expect(ids()).toHaveLength(100);
  });
  it('antes/depois são consultáveis e texto da auditoria não executa HTML', async () => {
    get.mockResolvedValueOnce(pagina([{ ...eventos[0], actorType: 'service', actorName: null,
      before: '<img src=x onerror=alert(1)>', after: { status: 'Etapa registrada QA' } }]));
    render(<AtividadeDaTarefa {...props} />);
    await screen.findByText('1 atividade carregada.');
    fireEvent.click(screen.getByText('Antes e depois'));
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(screen.getByText(/Etapa registrada QA/)).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText(/service · work.task.update/)).toBeInTheDocument();
  });
  it('consulta vazia tem término e não inventa cursor', async () => {
    get.mockResolvedValueOnce(pagina([], { anchor: null })); render(<AtividadeDaTarefa {...props} />);
    await screen.findByText('Sem atividades nesta consulta.');
    expect(screen.queryByRole('button', { name: 'Carregar atividades anteriores' })).not.toBeInTheDocument();
  });
  it('atualizar recomeça sem cursor e troca a janela por uma âncora nova', async () => {
    const novo = { ...eventos[0], id: 'qa-evento-novo', createdAt: '2026-10-08T05:00:00.000Z' };
    get.mockResolvedValueOnce(first()).mockResolvedValueOnce(pagina([novo], { anchor: { id: novo.id, createdAt: novo.createdAt } }));
    render(<AtividadeDaTarefa {...props} />); await screen.findByText('50 atividades carregadas.');
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar atividade' }));
    await screen.findByText('1 atividade carregada.'); expect(ids()).toEqual([novo.id]);
    expect(get.mock.calls[0]).toEqual(get.mock.calls[1]);
  });
  it.each(['taskId', 'userId'] as const)('recusa escopo %s estrangeiro na primeira página', async (field) => {
    get.mockResolvedValueOnce(pagina(eventos.slice(0, 1), { escopo: { ...escopo, [field]: 'qa-estrangeiro' } }));
    render(<AtividadeDaTarefa {...props} />); await screen.findByText(/A resposta não corresponde/);
    expect(ids()).toEqual([]); expect(screen.queryByText('Fim desta consulta.')).toBeNull();
  });
  it.each(['orgId', 'taskId', 'userId'] as const)('retira páginas privadas se a próxima troca %s', async (field) => {
    get.mockResolvedValueOnce(first()).mockResolvedValueOnce(pagina(eventos.slice(50, 51), { escopo: { ...escopo, [field]: 'qa-estrangeiro' } }));
    render(<AtividadeDaTarefa {...props} />); await screen.findByText('50 atividades carregadas.');
    loadMore(); await screen.findByText(/A resposta não corresponde/); expect(ids()).toEqual([]);
  });
  it.each([401, 403, 404])('recusa%s na página seguinte retira as atividades privadas', async (status) => {
    get.mockResolvedValueOnce(first()).mockRejectedValueOnce(Object.assign(new Error('Acesso recusado QA.'), { status }));
    render(<AtividadeDaTarefa {...props} />); await screen.findByText('50 atividades carregadas.');
    loadMore(); await screen.findByText('Acesso recusado QA.'); expect(ids()).toEqual([]);
    expect(screen.queryByText('50 atividades carregadas.')).toBeNull();
  });
  it.each(['âncora', 'cursor', 'registro', 'limite'])('recusa página com %s incompatível sem duplicar nem afirmar fim', async (kind) => {
    const extra: Partial<TrabAtividadePagina> = kind === 'âncora' ? { anchor: { ...anchor, id: 'qa-outro' } }
      : kind === 'cursor' ? { hasMore: true, nextCursor: 'cursor-a' }
      : kind === 'registro' ? { items: [eventos[0]] } : { limit: 101 };
    get.mockResolvedValueOnce(first()).mockResolvedValueOnce(pagina(eventos.slice(50, 51), extra));
    render(<AtividadeDaTarefa {...props} />); await screen.findByText('50 atividades carregadas.');
    loadMore(); await screen.findByRole('button', { name: 'Tentar novamente' });
    expect(ids()).toHaveLength(50); expect(screen.queryByText('Fim desta consulta.')).toBeNull();
  });
  it.each(['tarefa', 'pessoa', 'token'])('GET antigo não reaparece depois de trocar %s', async (kind) => {
    const late = pendente<TrabAtividadePagina>(); const novo = { ...eventos[0], id: 'qa-novo' };
    const next = { ...props, ...(kind === 'tarefa' ? { taskId: 'qa-tarefa-b' } : kind === 'pessoa' ? { userId: 'qa-pessoa-b' } : { token: 'qa-sessao-b' }) };
    get.mockReturnValueOnce(late.promise).mockResolvedValueOnce(pagina([novo], { escopo: { ...escopo, taskId: next.taskId, userId: next.userId } }));
    const view = render(<AtividadeDaTarefa {...props} />); view.rerender(<AtividadeDaTarefa {...next} />);
    await screen.findByText('1 atividade carregada.'); await act(async () => late.resolve(first()));
    expect(ids()).toEqual([novo.id]);
  });
  it('erro e finally antigos não encerram a busca da nova pessoa', async () => {
    const old = pendente<TrabAtividadePagina>(), novo = pendente<TrabAtividadePagina>();
    get.mockResolvedValueOnce(first()).mockReturnValueOnce(old.promise).mockReturnValueOnce(novo.promise);
    const view = render(<AtividadeDaTarefa {...props} />); await screen.findByText('50 atividades carregadas.'); loadMore();
    const next = { ...props, userId: 'qa-pessoa-b', token: 'qa-sessao-b' }; view.rerender(<AtividadeDaTarefa {...next} />);
    await act(async () => old.reject(Object.assign(new Error('Erro antigo QA.'), { status: 403 })));
    expect(screen.queryByText('Erro antigo QA.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Atualizar atividade' })).toBeDisabled();
    await act(async () => novo.resolve(pagina([{ ...eventos[0], id: 'qa-novo' }], { escopo: { ...escopo, userId: next.userId } })));
    expect(ids()).toEqual(['qa-novo']);
  });
  it('cursor invalidado pela API conserva leitura e permite começar uma nova consulta sem cursor', async () => {
    const novo = { ...eventos[0], id: 'qa-depois-do-reinicio', createdAt: '2026-10-08T05:00:00.000Z' };
    get.mockResolvedValueOnce(first())
      .mockRejectedValueOnce(Object.assign(new Error('Atualize a consulta de atividades.'), { status: 400, codigo: 'work_activity_cursor_invalid' }))
      .mockResolvedValueOnce(pagina([novo], { anchor: { id: novo.id, createdAt: novo.createdAt } }));
    render(<AtividadeDaTarefa {...props} />); await screen.findByText('50 atividades carregadas.');
    loadMore(); await screen.findByText('Atualize a consulta de atividades.');
    expect(ids()).toHaveLength(50); expect(screen.queryByText('Fim desta consulta.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar atividade' }));
    await screen.findByText('1 atividade carregada.'); expect(ids()).toEqual([novo.id]);
    expect(get.mock.calls[2]).toEqual(get.mock.calls[0]);
  });
  it('reinício de efeito StrictMode não deixa a consulta presa em ocupado', async () => {
    get.mockResolvedValue(pagina([], { anchor: null })); render(<StrictMode><AtividadeDaTarefa {...props} /></StrictMode>);
    await screen.findByText('Sem atividades nesta consulta.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Atualizar atividade' })).toBeEnabled());
  });
});
