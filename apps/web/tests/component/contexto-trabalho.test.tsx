import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ContextoPage from '@/app/contexto/page';
import { NotaAberta } from '@/app/contexto/NotaAberta';
import { FontesDaTarefa } from '@/components/trabalho/FontesDaTarefa';

const get = vi.fn(); const post = vi.fn();
let token = 'qa-contexto-token';
let permissions = ['obsidian.ver', 'tarefas.ver', 'tarefas.editar'];
vi.mock('@/lib/api', () => ({ apiGet: (...a: unknown[]) => Promise.resolve(get(...a)).then((r) => dtosPara(a[0] as string, r)), apiPost: (...a: unknown[]) => Promise.resolve(post(...a)).then((r) => ({ ...r, escopo: escopoAtual(), fonte: fonteCompleta(r.fonte ?? fonte) })) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token, ready: true, user: { id: token === 'qa-contexto-token' ? 'qa-eu' : 'qa-outro', name: 'Pessoa QA' }, can: (p: string) => permissions.includes(p) }) }));

const itemId = '11111111-1111-4111-8111-111111111111';
const v1id = '22222222-2222-4222-8222-222222222222';
const v2id = '33333333-3333-4333-8333-333333333333';
const listId = '44444444-4444-4444-8444-444444444444';
const taskId = '55555555-5555-4555-8555-555555555555';
const data = '2026-10-07T19:00:00.000Z';
const nota = { id: itemId, chave: 'qa:fonte', title: 'Fonte QA atual', kind: 'nota', body: 'Corpo atual v2 QA', sourceType: 'operador', sourceRef: 'ensaio QA', procedencia: 'operador:ensaio QA', contentHash: 'b'.repeat(64), versao: 2, tags: [], validFrom: null, validUntil: null, confidence: 1, temVetor: false, arquivadoEm: null, criadoEm: data, atualizadoEm: data };
const versoes = [
  { id: v2id, title: nota.title, body: nota.body, kind: 'nota', versao: 2, contentHash: nota.contentHash, procedencia: nota.procedencia, sourceType: 'operador', sourceRef: 'ensaio QA', mudanca: 'alteracao', criadoEm: data, autorTipo: 'user', motivo: 'Atualização QA', eventoSeq: '2' },
  { id: v1id, title: 'Fonte QA anterior', body: 'Corpo consumido v1 QA <script>perigo()</script>', kind: 'nota', versao: 1, contentHash: 'a'.repeat(64), procedencia: 'operador:origem anterior QA', sourceType: 'operador', sourceRef: 'origem anterior QA', mudanca: 'criacao', criadoEm: data, autorTipo: 'user', motivo: 'Criação QA', eventoSeq: '1' },
];
const estrutura = { folders: [], listasSoltas: [{ id: listId, name: 'Lista destino QA' }], pessoas: [{ id: 'qa-eu', name: 'Pessoa QA', email: 'eu@qa.local', isActive: true }, { id: 'qa-homonimo', name: 'Pessoa QA', email: 'outra@qa.local', isActive: true }, { id: 'qa-inativo', name: 'Inativa QA', email: 'inativa@qa.local', isActive: false }] };
const fonte = { id: 'qa-vinculo', itemId, versionId: v1id, title: 'Fonte QA anterior', versao: 1, procedencia: 'operador:origem anterior QA', utilizadaEm: data, versaoAtual: 2, arquivada: false };
let atualParaDto = nota;
function escopoAtual() { return { orgId: 'org-qa', userId: token === 'qa-contexto-token' ? 'qa-eu' : 'qa-outro' }; }
function retrato(v: any, n: any = nota) { return { itemId, chave: n.chave, colecao: 'manual_local', identidadeCanonica: { documentId: itemId, origemDaIdentidade: 'item_existente' }, versao: { versionId: v.id, numero: v.versao, contentHash: v.contentHash }, title: v.title, body: v.body, versaoAtual: n.versao, arquivada: !!n.arquivadoEm, registradaEm: v.criadoEm ?? data, atualizadaNaMemoriaEm: n.atualizadoEm, origem: { tipo: 'operador', referencia: v.sourceRef ?? null }, estado: { coleta: 'nao_verificada', indexacao: 'nao_verificada', projecao: 'nao_verificada', ultimoReciboId: null }, acesso: { modelo: 'local_por_pessoa', verificadoEm: data, novoUsoPermitido: !n.arquivadoEm }, citacao: { chave: n.chave, itemId, versao: v.versao, versionId: v.id, contentHash: v.contentHash } }; }
function fonteCompleta(f: any) { const v = versoes.find((v) => v.id === f.versionId)!; return { ...v, ...f, chave: nota.chave, itemId, versionId: f.versionId, contentHash: v.contentHash, body: v.body, retratoFonte: retrato(v) }; }
function dtosPara(path: string, r: any) {
  if (path.includes('/tarefas/pedidos/')) return { ...r, escopo: escopoAtual(), fonte: fonteCompleta(r.fonte ?? fonte) };
  if (path === `/memoria/${itemId}`) { atualParaDto = r; return { ...r, escopo: escopoAtual(), retratoFonte: retrato({ ...r, id: versoes.find((v) => v.versao === r.versao)?.id ?? v2id }, r) }; }
  if (path.endsWith('/versoes')) return r.map((v: any) => ({ ...v, escopo: escopoAtual(), retratoFonte: retrato(v, atualParaDto) }));
  if (path.endsWith('/fontes')) return { ...r, escopo: escopoAtual(), fontes: r.fontes.map(fonteCompleta) };
  return r;
}
function servir(path: string) {
  if (path.includes('/tarefas/pedidos/')) return Promise.resolve({ taskId, listId, replayed: true, fonte });
  if (path === `/memoria/${itemId}`) return Promise.resolve(nota);
  if (path === `/memoria/${itemId}/versoes`) return Promise.resolve(versoes);
  if (path === '/trabalho/estrutura') return Promise.resolve(estrutura);
  if (path === `/trabalho/tarefas/${taskId}/fontes`) return Promise.resolve({ fontes: [fonte] });
  return Promise.reject(new Error(`Rota inesperada: ${path}`));
}
async function preencher() {
  await screen.findByText(nota.body);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir versão v1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Criar tarefa usando esta versão' }));
  await screen.findByRole('option', { name: 'Lista destino QA' });
  fireEvent.change(screen.getByLabelText('Título da nova tarefa'), { target: { value: 'Entrega com fonte QA' } });
  fireEvent.change(screen.getByLabelText('Lista de destino'), { target: { value: listId } });
}
beforeEach(() => { cleanup(); window.history.replaceState({}, '', '/contexto'); localStorage.clear(); atualParaDto = nota; token = 'qa-contexto-token'; permissions = ['obsidian.ver', 'tarefas.ver', 'tarefas.editar']; get.mockReset(); post.mockReset(); get.mockImplementation(servir); post.mockResolvedValue({ taskId, listId, replayed: false }); });

describe('fonte versionada usada em Trabalho', () => {
  it('abre a versão histórica do vínculo e distingue a versão corrente, com corpo como texto', async () => {
    render(<NotaAberta notaId={itemId} versaoInicial={v1id} />);
    expect(await screen.findByText(versoes[1].body)).toBeInTheDocument();
    expect(screen.queryByText(nota.body)).not.toBeInTheDocument();
    expect(screen.getByText('operador:origem anterior QA')).toBeInTheDocument();
    expect(screen.getByText('Você está lendo a versão v1. A memória já está na v2.')).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
  });
  it('não substitui uma versão inexistente pelo corpo atual', async () => {
    render(<NotaAberta notaId={itemId} versaoInicial="qa-inexistente" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('A versão do vínculo não está disponível');
    expect(screen.queryByText(nota.body)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Criar tarefa usando esta versão' })).not.toBeInTheDocument();
  });
  it('cria com versão selecionada, hash e observação corrente; usa link da tarefa real', async () => {
    render(<NotaAberta notaId={itemId} />); await preencher();
    fireEvent.change(screen.getByLabelText('Responsável pela nova tarefa'), { target: { value: 'qa-homonimo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar tarefa' }));
    const link = await screen.findByRole('link', { name: 'Abrir tarefa criada' });
    expect(link).toHaveAttribute('href', `/trabalho?lista=${listId}&tarefa=${taskId}`);
    expect(post).toHaveBeenCalledWith(`/memoria/${itemId}/tarefas`, expect.objectContaining({ versionId: v1id, contentHash: 'a'.repeat(64), expectedItemVersion: 2, listId, title: 'Entrega com fonte QA', assigneeUserId: 'qa-homonimo', requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) }), token);
    expect(screen.queryByRole('option', { name: /Inativa QA/ })).not.toBeInTheDocument();
  });
  it('protege clique repetido durante a mesma escrita', async () => {
    let resolver!: (v: unknown) => void; post.mockImplementation(() => new Promise((r) => { resolver = r; }));
    render(<NotaAberta notaId={itemId} />); await preencher();
    const form = screen.getByRole('form', { name: 'Criar tarefa com fonte' });
    fireEvent.submit(form); fireEvent.submit(form);
    expect(post).toHaveBeenCalledTimes(1);
    await act(async () => resolver({ taskId, listId, replayed: false }));
  });
  it('reusa o ID após resposta perdida consultando tarefa confirmada sem segundo POST', async () => {
    post.mockRejectedValueOnce(new Error('Resposta perdida QA'));
    const tela = render(<NotaAberta notaId={itemId} />); await preencher(); fireEvent.click(screen.getByRole('button', { name: 'Criar tarefa' }));
    await screen.findByRole('alert'); const id = post.mock.calls[0][1].requestId; tela.unmount(); render(<NotaAberta notaId={itemId} />);
    await screen.findByRole('link', { name: 'Abrir tarefa criada' }); expect(get).toHaveBeenCalledWith(`/memoria/${itemId}/tarefas/pedidos/${id}`, token); expect(post).toHaveBeenCalledTimes(1); expect(screen.getByRole('status')).toHaveTextContent('já estava criada');
  });
  it('409 conserva intenção em memória e recarregar não libera nova escrita incerta', async () => {
    post.mockRejectedValue(Object.assign(new Error('Mudou QA'), { status: 409 }));
    const originalGet = servir; get.mockImplementation((p: string) => p.includes('/tarefas/pedidos/') ? Promise.reject(Object.assign(new Error('Sem confirmação QA'), { status: 404 })) : originalGet(p));
    render(<NotaAberta notaId={itemId} />); await preencher(); fireEvent.click(screen.getByRole('button', { name: 'Criar tarefa' }));
    await screen.findByRole('alert'); expect(screen.getByLabelText('Título da nova tarefa')).toHaveValue('Entrega com fonte QA'); expect(screen.getByLabelText('Lista de destino')).toHaveValue(listId); expect(screen.getByRole('button', { name: 'Conferir criação' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Recarregar fonte' })); await screen.findByText('Fonte não disponível para esta conta.'); expect(screen.queryByRole('button', { name: 'Criar tarefa' })).not.toBeInTheDocument(); expect(screen.getByRole('status')).toHaveTextContent('Pedido sem confirmação'); expect(post).toHaveBeenCalledTimes(1);
  });
  it.each([403, 404])('recusa %s após abrir remove corpo, versões e resultado', async (status) => {
    post.mockRejectedValue(Object.assign(new Error('Recusa QA'), { status }));
    render(<NotaAberta notaId={itemId} />); await preencher();
    fireEvent.click(screen.getByRole('button', { name: 'Criar tarefa' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Fonte não disponível');
    expect(screen.queryByText(versoes[1].body)).not.toBeInTheDocument();
    expect(screen.queryByText(nota.title)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Histórico da fonte' })).not.toBeInTheDocument();
  });
  it('fonte arquivada conserva leitura histórica e recusa criação pela tela', async () => {
    get.mockImplementation((path: string) => path === `/memoria/${itemId}` ? Promise.resolve({ ...nota, arquivadoEm: data }) : servir(path));
    render(<NotaAberta notaId={itemId} versaoInicial={v1id} />);
    await screen.findByText(versoes[1].body);
    expect(screen.queryByRole('button', { name: 'Criar tarefa usando esta versão' })).not.toBeInTheDocument();
    expect(screen.getByText('v2 · fonte arquivada')).toBeInTheDocument();
  });
  it('confere resultado próprio após arquivar a fonte sem reconstruir o payload', async () => {
    post.mockRejectedValueOnce(new Error('Resposta perdida após criar QA'));
    const tela = render(<NotaAberta notaId={itemId} />); await preencher(); fireEvent.click(screen.getByRole('button', { name: 'Criar tarefa' })); await screen.findByRole('alert'); const original = { ...post.mock.calls[0][1] }; tela.unmount();
    get.mockImplementation((path: string) => path === `/memoria/${itemId}` ? Promise.resolve({ ...nota, arquivadoEm: data, versao: 3 }) : path === `/memoria/${itemId}/versoes` ? Promise.resolve([{ ...versoes[0], id: '66666666-6666-4666-8666-666666666666', versao: 3, mudanca: 'arquivamento' }, ...versoes]) : servir(path));
    render(<NotaAberta notaId={itemId} versaoInicial={v1id} />); const link = await screen.findByRole('link', { name: 'Abrir tarefa criada' }); expect(link).toHaveAttribute('href', `/trabalho?lista=${listId}&tarefa=${taskId}`); expect(post).toHaveBeenCalledTimes(1); expect(post.mock.calls[0][1]).toEqual(original); expect(get).toHaveBeenCalledWith(`/memoria/${itemId}/tarefas/pedidos/${original.requestId}`, token);
  });
  it.each(['pedido inválido', 'pedido de outra pessoa'])('fonte arquivada não oferece nova criação com %s no armazenamento', async (caso) => {
    const chave = caso === 'pedido de outra pessoa' ? `root_contexto_pedido:qa-outra:${itemId}` : `root_contexto_pedido:qa-eu:${itemId}`;
    localStorage.setItem(chave, JSON.stringify({ pedido: { requestId: caso === 'pedido inválido' ? 'id inválido' : '77777777-7777-4777-8777-777777777777', versionId: v1id, contentHash: 'a'.repeat(64), expectedItemVersion: 2, listId, title: 'Pedido estranho QA', assigneeUserId: null } }));
    get.mockImplementation((path: string) => path === `/memoria/${itemId}` ? Promise.resolve({ ...nota, arquivadoEm: data }) : servir(path));
    render(<NotaAberta notaId={itemId} versaoInicial={v1id} />); await screen.findByText(versoes[1].body);
    expect(screen.queryByRole('button', { name: 'Conferir pedido anterior' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Criar tarefa usando esta versão' })).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
  it('descarta a fonte da sessão anterior enquanto a nova resposta está pendente', async () => {
    let resolver!: (v: unknown) => void;
    const tela = render(<NotaAberta notaId={itemId} />); await screen.findByText(nota.body);
    token = 'qa-nova-sessao';
    get.mockImplementation((path: string) => path === `/memoria/${itemId}` ? new Promise((r) => { resolver = r; }) : path === `/memoria/${itemId}/versoes` ? Promise.resolve([{ ...versoes[0], body: 'Corpo nova sessão QA' }]) : servir(path));
    tela.rerender(<NotaAberta notaId={itemId} />);
    expect(screen.queryByText(nota.body)).not.toBeInTheDocument();
    await act(async () => resolver({ ...nota, body: 'Corpo nova sessão QA' }));
    expect(await screen.findByText('Corpo nova sessão QA')).toBeInTheDocument();
    expect(screen.queryByText(nota.body)).not.toBeInTheDocument();
  });
  it('sem permissão para fonte não busca nem renderiza o conteúdo', () => {
    permissions = ['tarefas.ver']; render(<NotaAberta notaId={itemId} />);
    expect(screen.getByText('Fonte não disponível para esta conta.')).toBeInTheDocument(); expect(get).not.toHaveBeenCalled();
  });
  it('pedido ambíguo congela intenção em memória e após atualizar encontra a versão original', async () => {
    post.mockRejectedValueOnce(new Error('Resposta perdida QA'));
    const tela = render(<NotaAberta notaId={itemId} />); await preencher(); fireEvent.click(screen.getByRole('button', { name: 'Criar tarefa' })); await screen.findByRole('alert'); const original = { ...post.mock.calls[0][1] };
    expect(screen.getByLabelText('Título da nova tarefa')).toBeDisabled(); expect(screen.getByLabelText('Lista de destino')).toBeDisabled(); tela.unmount();
    get.mockImplementation((path: string) => path === `/memoria/${itemId}` ? Promise.resolve({ ...nota, versao: 3 }) : path === `/memoria/${itemId}/versoes` ? Promise.resolve([{ ...versoes[0], id: '66666666-6666-4666-8666-666666666666', versao: 3 }, ...versoes]) : servir(path));
    render(<NotaAberta notaId={itemId} />); await screen.findByRole('link', { name: 'Abrir tarefa criada' }); expect(post).toHaveBeenCalledTimes(1); expect(original.expectedItemVersion).toBe(2); expect(screen.getByRole('status')).toHaveTextContent('já estava criada');
  });
  it('recusa notifica o mapa para remover título e metadados já carregados', async () => {
    const indisponivel = vi.fn();
    get.mockRejectedValue(Object.assign(new Error('Fonte restrita QA'), { status: 404 }));
    render(<NotaAberta notaId={itemId} onIndisponivel={indisponivel} />);
    await screen.findByRole('alert'); expect(indisponivel).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(nota.title)).not.toBeInTheDocument();
  });
  it('o endereço da tarefa abre a versão usada fora da listagem atual', async () => {
    permissions = ['obsidian.ver'];
    window.history.replaceState({}, '', `/contexto?nota=${itemId}&versao=${v1id}`);
    get.mockImplementation((path: string) => path === '/memoria' ? Promise.resolve({ itens: [], total: 0, comVetor: 0 }) : servir(path));
    render(<ContextoPage />);
    const fonteDoVinculo = await screen.findByRole('complementary', { name: 'Fonte usada na tarefa' });
    expect(await within(fonteDoVinculo).findByText(versoes[1].body)).toBeInTheDocument();
    expect(within(fonteDoVinculo).queryByText(nota.body)).not.toBeInTheDocument();
    fireEvent.click(within(fonteDoVinculo).getByRole('button', { name: 'Fechar fonte usada' }));
    expect(screen.queryByRole('complementary', { name: 'Fonte usada na tarefa' })).not.toBeInTheDocument();
    expect(window.location.search).toBe('');
  });
  it('resposta de nota da sessão anterior não aparece após recusa na sessão nova', async () => {
    let entregar!: (v: unknown) => void;
    get.mockImplementation((path: string) => path === `/memoria/${itemId}` ? new Promise((r) => { entregar = r; }) : servir(path));
    const tela = render(<NotaAberta notaId={itemId} />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2)); const antiga = entregar;
    token = 'qa-nova-sessao'; get.mockRejectedValue(Object.assign(new Error('Fonte negada QA'), { status: 404 }));
    tela.rerender(<NotaAberta notaId={itemId} />); await screen.findByRole('alert');
    await act(async () => antiga(nota));
    expect(screen.queryByText(nota.body)).not.toBeInTheDocument();
    expect(screen.queryByText(nota.title)).not.toBeInTheDocument();
  });
  it('fontes do cartão apontam a versão usada e não à versão mais recente', async () => {
    render(<FontesDaTarefa taskId={taskId} />);
    const link = await screen.findByRole('link', { name: 'Abrir versão usada' });
    expect(link).toHaveAttribute('href', `/contexto?nota=${itemId}&versao=${v1id}`);
    expect(screen.getByText('Fonte QA anterior · v1')).toBeInTheDocument();
    expect(screen.getByText('versão atual').nextElementSibling).toHaveTextContent('v2');
  });
  it('reconferência de acesso recusada limpa a citação já carregada', async () => {
    render(<FontesDaTarefa taskId={taskId} />); await screen.findByRole('link', { name: 'Abrir versão usada' });
    get.mockRejectedValue(Object.assign(new Error('Acesso retirado QA'), { status: 403 }));
    fireEvent.click(screen.getByRole('button', { name: 'Conferir acesso às fontes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Fontes não disponíveis');
    expect(screen.queryByText('Fonte QA anterior · v1')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Abrir versão usada' })).not.toBeInTheDocument();
  });
  it('troca de token no cartão limpa citação e ignora resposta atrasada da sessão anterior', async () => {
    let entregar!: (v: unknown) => void; get.mockImplementation(() => new Promise((r) => { entregar = r; }));
    const tela = render(<FontesDaTarefa taskId={taskId} />); await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    const antigo = entregar; token = 'qa-nova-sessao';
    get.mockRejectedValue(Object.assign(new Error('Sem acesso QA'), { status: 404 })); tela.rerender(<FontesDaTarefa taskId={taskId} />);
    await screen.findByRole('alert'); await act(async () => antigo({ fontes: [fonte] }));
    expect(screen.queryByRole('link', { name: 'Abrir versão usada' })).not.toBeInTheDocument();
  });
});
