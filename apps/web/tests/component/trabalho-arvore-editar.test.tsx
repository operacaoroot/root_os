import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * A3 (adendo da rodada de produção 1, 21/10/2026): editar a árvore do Trabalho
 * onde a pessoa está olhando.
 *
 *  · "+ nova pasta" no fim da árvore: Enter cria, Esc desfaz; nome repetido no
 *    nível é recusado na tela com a frase da API;
 *  · renomear pasta e lista por duplo clique ou "⋯" › Renomear: Enter salva, Esc
 *    desfaz, a recusa da API fica à vista com o nome aberto;
 *  · as protegidas mostram o menu com o item desabilitado e o porquê;
 *  · excluir pasta com conteúdo pede o destino (outra pasta ou Sem pasta);
 *  · excluir lista com tarefa: mover as tarefas para outra lista e excluir, ou
 *    arquivar todas e excluir;
 *  · Alt+↑/↓ reordena e o foco fica no item; arrastar lista para outra pasta,
 *    para Sem pasta e sobre uma irmã.
 */

const get = vi.fn(), post = vi.fn(), patch = vi.fn(), del = vi.fn();
vi.mock('@/lib/api', () => ({
  apiGet: (...a: unknown[]) => get(...a), apiPost: (...a: unknown[]) => post(...a),
  apiPatch: (...a: unknown[]) => patch(...a), apiDelete: (...a: unknown[]) => del(...a), apiBlob: vi.fn(),
}));
let permissoes = ['tarefas.ver', 'tarefas.editar'];
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'eu' }, can: (p: string) => permissoes.includes(p) }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }) }));
import TrabalhoPage from '@/app/trabalho/page';

const GESTAO = 'a0a0a0a0-0000-4000-8000-00000000000a';
const MKT = 'b0b0b0b0-0000-4000-8000-00000000000b';
const CLIENTES = 'c0c0c0c0-0000-4000-8000-00000000000c';
const VAZIA = 'd0d0d0d0-0000-4000-8000-00000000000d';
const V1 = '2026-10-21T10:00:00.000Z';

const st = (id: string, name: string, type: string, order: number) => ({ id, name, type, color: '#87909e', order, total: 0, limite: null });
const lista = (id: string, name: string, total = 0, natureza: 'tarefas' | 'cadastro' = 'tarefas') => ({
  id, name, externalId: null, spaceId: null, order: 0, total, fields: [], natureza,
  statuses: [st(`${id}-a`, 'A fazer', 'open', 0), st(`${id}-f`, 'Feito', 'closed', 1)],
});
const financeiro = lista('l-fin', 'Financeiro', 2);
const pessoas = lista('l-pes', 'Pessoas');
const demandas = lista('l-dem', 'Demandas', 1);
const execucao = lista('l-exec', 'Execução');
const onboarding = lista('l-onb', 'Onboarding de cliente', 1);
const cadastro = lista('l-cad', 'Clientes ativos', 0, 'cadastro');
const avulsa = lista('l-avulsa', 'Avulsa');
const pessoasSolta = lista('l-pes-solta', 'pessoas');
const estrutura = {
  espacos: [],
  folders: [
    { id: GESTAO, name: 'Gestão', order: 0, spaceId: null, parentId: null, externalId: null, lists: [financeiro, pessoas] },
    { id: MKT, name: 'Marketing', order: 0, spaceId: null, parentId: GESTAO, externalId: null, lists: [demandas] },
    { id: CLIENTES, name: 'Clientes', order: 1, spaceId: null, parentId: null, externalId: null, lists: [execucao, onboarding, cadastro] },
    { id: VAZIA, name: 'Administrativa', order: 2, spaceId: null, parentId: null, externalId: null, lists: [] },
  ],
  listasSoltas: [avulsa, pessoasSolta], camposGlobais: [], tags: [], responsaveis: [], agentes: [], pessoas: [],
};

beforeEach(() => {
  permissoes = ['tarefas.ver', 'tarefas.editar'];
  window.history.replaceState({}, '', '/trabalho?lista=l-avulsa');
  get.mockReset(); post.mockReset(); patch.mockReset(); del.mockReset();
  get.mockImplementation((rota: string) => {
    if (rota === '/trabalho/estrutura') return Promise.resolve(estrutura);
    if (rota.startsWith('/trabalho/tarefas?')) return Promise.resolve({ total: 0, items: [], source: { tool: 'qa', generatedAt: V1 } });
    if (rota.startsWith('/trabalho/quadro/movimento')) return Promise.resolve({ itens: [] });
    if (rota.startsWith('/trabalho/vistas')) return Promise.resolve([]);
    if (rota.startsWith('/tenants/onboarding/trilhos')) return Promise.resolve([]);
    if (rota.startsWith('/tenants/plataforma')) return Promise.reject(new Error('não'));
    return Promise.resolve([]);
  });
  post.mockResolvedValue({ ok: true });
  patch.mockResolvedValue({});
  del.mockResolvedValue({ id: 'x', modo: 'apagada', tarefasArquivadas: 0 });
});
afterEach(cleanup);

const abrir = async () => {
  render(<TrabalhoPage />);
  await screen.findByTestId(`trabalho-arvore-pasta-${GESTAO}`);
};
const aviso = () => screen.getByTestId('trabalho-arvore-aviso');
const recargas = () => get.mock.calls.filter(([r]) => r === '/trabalho/estrutura').length;

describe('A3: criar e renomear na árvore', () => {
  it('"+ nova pasta": Enter cria no topo, Esc desfaz, repetido no nível é recusado sem chamar a API', async () => {
    post.mockResolvedValueOnce({ id: 'nova' });
    await abrir();
    fireEvent.click(screen.getByTestId('trabalho-arvore-nova-pasta'));
    let campo = screen.getByTestId('trabalho-arvore-nova-pasta-nome');
    expect(campo).toHaveFocus();
    fireEvent.change(campo, { target: { value: 'Rascunho' } });
    fireEvent.keyDown(campo, { key: 'Escape' });
    expect(screen.queryByTestId('trabalho-arvore-nova-pasta-nome')).toBeNull();
    expect(post).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('trabalho-arvore-nova-pasta')).toHaveFocus());

    fireEvent.click(screen.getByTestId('trabalho-arvore-nova-pasta'));
    campo = screen.getByTestId('trabalho-arvore-nova-pasta-nome');
    fireEvent.change(campo, { target: { value: '  gestao ' } });
    fireEvent.keyDown(campo, { key: 'Enter' });
    expect(screen.getByTestId('trabalho-arvore-nova-pasta-nome-erro')).toHaveTextContent('Já existe uma pasta com esse nome neste lugar.');
    expect(post).not.toHaveBeenCalled();

    fireEvent.change(campo, { target: { value: 'Pessoas e cultura' } });
    await act(async () => { fireEvent.keyDown(campo, { key: 'Enter' }); });
    expect(post).toHaveBeenCalledWith('/trabalho/pastas', { name: 'Pessoas e cultura' }, 'tok');
    await waitFor(() => expect(aviso()).toHaveTextContent('Pasta Pessoas e cultura criada.'));
  });

  it('com uma pasta escolhida no topo, a nova nasce dentro dela', async () => {
    window.history.replaceState({}, '', `/trabalho?pasta=${GESTAO}`);
    post.mockResolvedValueOnce({ id: 'nova' });
    await abrir();
    fireEvent.click(screen.getByTestId('trabalho-arvore-nova-pasta'));
    const campo = screen.getByTestId('trabalho-arvore-nova-pasta-nome');
    // "Marketing" já existe dentro de Gestão.
    fireEvent.change(campo, { target: { value: 'MARKETING' } });
    fireEvent.keyDown(campo, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('Já existe uma pasta com esse nome neste lugar.');
    fireEvent.change(campo, { target: { value: 'Contratos' } });
    await act(async () => { fireEvent.keyDown(campo, { key: 'Enter' }); });
    expect(post).toHaveBeenCalledWith('/trabalho/pastas', { name: 'Contratos', parentId: GESTAO }, 'tok');
  });

  it('renomear lista por duplo clique: Esc desfaz, Enter salva, o foco volta ao item', async () => {
    await abrir();
    fireEvent.doubleClick(screen.getByTestId('trabalho-arvore-lista-l-pes'));
    let campo = screen.getByTestId('trabalho-arvore-renomear-lista-l-pes');
    expect(campo).toHaveValue('Pessoas');
    fireEvent.change(campo, { target: { value: 'Outro' } });
    fireEvent.keyDown(campo, { key: 'Escape' });
    expect(patch).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('trabalho-arvore-lista-l-pes')).toHaveFocus());

    fireEvent.doubleClick(screen.getByTestId('trabalho-arvore-lista-l-pes'));
    campo = screen.getByTestId('trabalho-arvore-renomear-lista-l-pes');
    // Repetido no mesmo nível (sem acento nem maiúscula): recusa na tela.
    fireEvent.change(campo, { target: { value: 'FINANCEIRO' } });
    fireEvent.keyDown(campo, { key: 'Enter' });
    expect(screen.getByTestId('trabalho-arvore-renomear-lista-l-pes-erro')).toHaveTextContent('Já existe uma lista com esse nome neste lugar.');
    expect(patch).not.toHaveBeenCalled();
    // Um nome que existe em OUTRO nível passa.
    fireEvent.change(campo, { target: { value: 'Execução' } });
    await act(async () => { fireEvent.keyDown(campo, { key: 'Enter' }); });
    expect(patch).toHaveBeenCalledWith('/trabalho/listas/l-pes', { name: 'Execução' }, 'tok');
    await waitFor(() => expect(aviso()).toHaveTextContent('A lista Pessoas agora se chama Execução.'));
    await waitFor(() => expect(screen.getByTestId('trabalho-arvore-lista-l-pes')).toHaveFocus());
  });

  it('renomear pasta pelo menu "⋯"; a recusa da API fica à vista com o nome aberto', async () => {
    patch.mockRejectedValueOnce(Object.assign(new Error('Já existe uma pasta com esse nome neste lugar.'), { status: 409 }));
    await abrir();
    fireEvent.click(screen.getByTestId(`trabalho-pasta-acoes-${VAZIA}`));
    fireEvent.click(screen.getByTestId(`trabalho-pasta-acoes-${VAZIA}-renomear`));
    const campo = screen.getByTestId(`trabalho-arvore-renomear-pasta-${VAZIA}`);
    fireEvent.change(campo, { target: { value: 'Arquivo morto' } });
    await act(async () => { fireEvent.keyDown(campo, { key: 'Enter' }); });
    expect(patch).toHaveBeenCalledWith(`/trabalho/pastas/${VAZIA}`, { name: 'Arquivo morto' }, 'tok');
    expect(await screen.findByTestId(`trabalho-arvore-renomear-pasta-${VAZIA}-erro`)).toHaveTextContent('Já existe uma pasta com esse nome neste lugar.');
    expect(screen.getByTestId(`trabalho-arvore-renomear-pasta-${VAZIA}`)).toBeInTheDocument();
  });

  it('as protegidas: o menu mostra Renomear e Excluir desabilitados com o porquê; duplo clique não abre o nome', async () => {
    await abrir();
    fireEvent.click(screen.getByTestId(`trabalho-pasta-acoes-${CLIENTES}`));
    const menuDaPasta = screen.getByRole('menu', { name: 'Ações da pasta Clientes' });
    expect(within(menuDaPasta).getByTestId(`trabalho-pasta-acoes-${CLIENTES}-renomear`)).toBeDisabled();
    expect(within(menuDaPasta).getByTestId(`trabalho-pasta-acoes-${CLIENTES}-excluir`)).toBeDisabled();
    expect(menuDaPasta).toHaveTextContent('guarda a lista Onboarding de cliente');
    fireEvent.keyDown(menuDaPasta, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByTestId(`trabalho-pasta-acoes-${CLIENTES}`)).toHaveFocus();

    fireEvent.click(screen.getByTestId('trabalho-lista-acoes-l-onb'));
    expect(screen.getByTestId('trabalho-lista-acoes-l-onb-renomear')).toBeDisabled();
    expect(screen.getByTestId('trabalho-lista-acoes-l-onb-excluir')).toHaveTextContent('fica na pasta Clientes, com este nome, e não se apaga');
    fireEvent.doubleClick(screen.getByTestId('trabalho-arvore-lista-l-onb'));
    expect(screen.queryByTestId('trabalho-arvore-renomear-lista-l-onb')).toBeNull();
    fireEvent.doubleClick(screen.getByTestId(`trabalho-arvore-pasta-${CLIENTES}`));
    expect(screen.queryByTestId(`trabalho-arvore-renomear-pasta-${CLIENTES}`)).toBeNull();
  });

  it('o menu anda pelo teclado: abre no primeiro item habilitado e as setas pulam o desabilitado', async () => {
    await abrir();
    fireEvent.click(screen.getByTestId('trabalho-lista-acoes-l-fin'));
    const menu = screen.getByRole('menu');
    expect(screen.getByTestId('trabalho-lista-acoes-l-fin-renomear')).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByTestId('trabalho-lista-acoes-l-fin-arquivar')).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(screen.getByTestId('trabalho-lista-acoes-l-fin-excluir')).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByTestId('trabalho-lista-acoes-l-fin-renomear')).toHaveFocus();
  });

  it('sem tarefas.editar a árvore não tem menu, nova pasta nem arraste', async () => {
    permissoes = ['tarefas.ver'];
    await abrir();
    expect(screen.queryByTestId('trabalho-arvore-nova-pasta')).toBeNull();
    expect(screen.queryByTestId('trabalho-lista-acoes-l-fin')).toBeNull();
    expect(screen.getByTestId('trabalho-arvore-lista-l-fin')).toHaveAttribute('draggable', 'false');
  });
});

describe('A3: excluir com destino', () => {
  it('pasta com listas e subpasta: o diálogo pede o destino (sem a própria nem as de dentro) e manda o que a tela viu', async () => {
    post.mockResolvedValueOnce({ id: GESTAO, modo: 'apagada', listasMovidas: 2, pastasMovidas: 1 });
    await abrir();
    fireEvent.click(screen.getByTestId(`trabalho-pasta-acoes-${GESTAO}`));
    fireEvent.click(screen.getByTestId(`trabalho-pasta-acoes-${GESTAO}-excluir`));
    const dialogo = await screen.findByRole('dialog');
    expect(dialogo).toHaveTextContent('A pasta tem 2 listas e 1 pasta dentro. Nenhuma lista é apagada');
    const destino = within(dialogo).getByTestId('trabalho-excluir-pasta-destino') as HTMLSelectElement;
    expect([...destino.options].map((o) => o.textContent)).toEqual(['Escolha o destino', 'Clientes', 'Administrativa', 'Sem pasta']);
    const confirmar = within(dialogo).getByTestId('trabalho-excluir-pasta-confirmar');
    expect(confirmar).toBeDisabled();
    fireEvent.change(destino, { target: { value: VAZIA } });
    await act(async () => { fireEvent.click(confirmar); });
    expect(post).toHaveBeenCalledWith(`/trabalho/pastas/${GESTAO}/excluir`, { destino: { folderId: VAZIA }, esperadas: { listas: 2, pastas: 1 } }, 'tok');
    expect(del).not.toHaveBeenCalled();
    await waitFor(() => expect(aviso()).toHaveTextContent('A pasta Gestão saiu; 2 listas e 1 pasta foram para Administrativa, com as tarefas.'));
  });

  it('pasta levando para Sem pasta; a recusa da API fica no diálogo', async () => {
    post.mockRejectedValueOnce(Object.assign(new Error('No destino já existe uma lista chamada "Demandas". Renomeie uma delas antes de apagar a pasta.'), { status: 409 }));
    await abrir();
    fireEvent.click(screen.getByTestId(`trabalho-pasta-acoes-${MKT}`));
    fireEvent.click(screen.getByTestId(`trabalho-pasta-acoes-${MKT}-excluir`));
    const dialogo = await screen.findByRole('dialog');
    fireEvent.change(within(dialogo).getByTestId('trabalho-excluir-pasta-destino'), { target: { value: '__sem-pasta__' } });
    await act(async () => { fireEvent.click(within(dialogo).getByTestId('trabalho-excluir-pasta-confirmar')); });
    expect(post).toHaveBeenCalledWith(`/trabalho/pastas/${MKT}/excluir`, { destino: { semPasta: true }, esperadas: { listas: 1, pastas: 0 } }, 'tok');
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('Renomeie uma delas');
  });

  it('pasta vazia: confirmação simples pelo DELETE', async () => {
    del.mockResolvedValueOnce({ id: VAZIA, modo: 'apagada' });
    await abrir();
    fireEvent.click(screen.getByTestId(`trabalho-pasta-acoes-${VAZIA}`));
    fireEvent.click(screen.getByTestId(`trabalho-pasta-acoes-${VAZIA}-excluir`));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).queryByTestId('trabalho-excluir-pasta-destino')).toBeNull();
    await act(async () => { fireEvent.click(within(dialogo).getByTestId('trabalho-excluir-pasta-confirmar')); });
    expect(del).toHaveBeenCalledWith(`/trabalho/pastas/${VAZIA}`, 'tok');
  });

  it('lista com tarefas: mover para outra lista e excluir (os destinos não têm a própria, a da implantação nem cadastro)', async () => {
    post.mockResolvedValueOnce({ id: 'l-fin', destinoId: 'l-exec', movidas: 2, mudaramDeEtapa: 1 });
    del.mockResolvedValueOnce({ id: 'l-fin', modo: 'apagada', tarefasArquivadas: 0 });
    await abrir();
    fireEvent.click(screen.getByTestId('trabalho-lista-acoes-l-fin'));
    fireEvent.click(screen.getByTestId('trabalho-lista-acoes-l-fin-excluir'));
    const dialogo = await screen.findByRole('dialog');
    expect(dialogo).toHaveTextContent('A lista tem 2 tarefas ativas.');
    const confirmar = within(dialogo).getByTestId('trabalho-excluir-lista-confirmar');
    fireEvent.change(within(dialogo).getByTestId('trabalho-excluir-lista-nome'), { target: { value: 'financeiro' } });
    expect(confirmar).toBeDisabled();
    fireEvent.click(within(dialogo).getByTestId('trabalho-excluir-lista-mover'));
    const destino = within(dialogo).getByTestId('trabalho-excluir-lista-destino') as HTMLSelectElement;
    expect([...destino.options].map((o) => o.textContent)).toEqual([
      'Escolha a lista', 'Gestão / Pessoas', 'Gestão / Marketing / Demandas', 'Clientes / Execução', 'Sem pasta / Avulsa', 'Sem pasta / pessoas',
    ]);
    expect(confirmar).toBeDisabled();
    fireEvent.change(destino, { target: { value: 'l-exec' } });
    expect(confirmar).toHaveTextContent('Mover e excluir');
    await act(async () => { fireEvent.click(confirmar); });
    expect(post).toHaveBeenCalledWith('/trabalho/listas/l-fin/mover-tarefas', { destinoId: 'l-exec', esperadas: 2 }, 'tok');
    await waitFor(() => expect(del).toHaveBeenCalledWith('/trabalho/listas/l-fin', 'tok', { confirmarNome: 'financeiro' }));
    await waitFor(() => expect(aviso()).toHaveTextContent('2 tarefas foram para Clientes / Execução. 1 mudou de etapa'));
  });

  it('lista com tarefas: arquivar todas e excluir, encadeado', async () => {
    post.mockResolvedValueOnce({ id: 'l-dem', arquivadas: 1 });
    del.mockResolvedValueOnce({ id: 'l-dem', modo: 'arquivada', tarefasArquivadas: 1 });
    await abrir();
    fireEvent.click(screen.getByTestId('trabalho-lista-acoes-l-dem'));
    fireEvent.click(screen.getByTestId('trabalho-lista-acoes-l-dem-excluir'));
    const dialogo = await screen.findByRole('dialog');
    fireEvent.click(within(dialogo).getByTestId('trabalho-excluir-lista-arquivar'));
    fireEvent.change(within(dialogo).getByTestId('trabalho-excluir-lista-nome'), { target: { value: 'Demandas' } });
    await act(async () => { fireEvent.click(within(dialogo).getByTestId('trabalho-excluir-lista-confirmar')); });
    expect(post).toHaveBeenCalledWith('/trabalho/listas/l-dem/arquivar-tarefas', { esperadas: 1 }, 'tok');
    await waitFor(() => expect(del).toHaveBeenCalledWith('/trabalho/listas/l-dem', 'tok', { confirmarNome: 'Demandas' }));
  });

  it('o primeiro passo valeu e o segundo falhou: o diálogo diz que as tarefas já mudaram', async () => {
    post.mockResolvedValueOnce({ id: 'l-dem', arquivadas: 1 });
    del.mockRejectedValueOnce(Object.assign(new Error('Lista não encontrada'), { status: 404 }));
    await abrir();
    fireEvent.click(screen.getByTestId('trabalho-lista-acoes-l-dem'));
    fireEvent.click(screen.getByTestId('trabalho-lista-acoes-l-dem-excluir'));
    const dialogo = await screen.findByRole('dialog');
    fireEvent.click(within(dialogo).getByTestId('trabalho-excluir-lista-arquivar'));
    fireEvent.change(within(dialogo).getByTestId('trabalho-excluir-lista-nome'), { target: { value: 'Demandas' } });
    await act(async () => { fireEvent.click(within(dialogo).getByTestId('trabalho-excluir-lista-confirmar')); });
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('1 tarefa foi arquivada. A lista não saiu: Lista não encontrada');
  });
});

describe('A3: ordem e arraste', () => {
  function dataTransfer() {
    const dados: Record<string, string> = {};
    return { setData: (k: string, v: string) => { dados[k] = v; }, getData: (k: string) => dados[k] ?? '', effectAllowed: 'all', dropEffect: 'move' };
  }

  it('Alt+↓ numa lista grava o nível inteiro na ordem nova e o foco fica no item', async () => {
    await abrir();
    const item = screen.getByTestId('trabalho-arvore-lista-l-fin');
    item.focus();
    await act(async () => { fireEvent.keyDown(item, { key: 'ArrowDown', altKey: true }); });
    expect(post).toHaveBeenCalledWith('/trabalho/arvore/ordem', { tipo: 'lista', paiId: GESTAO, ids: ['l-pes', 'l-fin'] }, 'tok');
    await waitFor(() => expect(aviso()).toHaveTextContent('Financeiro: posição 2 de 2.'));
    await waitFor(() => expect(screen.getByTestId('trabalho-arvore-lista-l-fin')).toHaveFocus());
    // Na ponta, não grava nada (o dublê devolve a árvore de antes: Financeiro segue em primeiro).
    post.mockClear();
    fireEvent.keyDown(screen.getByTestId('trabalho-arvore-lista-l-fin'), { key: 'ArrowUp', altKey: true });
    expect(post).not.toHaveBeenCalled();
    // Sem Alt, a seta não reordena.
    fireEvent.keyDown(screen.getByTestId('trabalho-arvore-lista-l-fin'), { key: 'ArrowDown' });
    expect(post).not.toHaveBeenCalled();
  });

  it('Alt+↑ numa pasta de topo reordena as pastas de topo', async () => {
    await abrir();
    const pasta = screen.getByTestId(`trabalho-arvore-pasta-${VAZIA}`);
    pasta.focus();
    await act(async () => { fireEvent.keyDown(pasta, { key: 'ArrowUp', altKey: true }); });
    expect(post).toHaveBeenCalledWith('/trabalho/arvore/ordem', { tipo: 'pasta', paiId: null, ids: [GESTAO, VAZIA, CLIENTES] }, 'tok');
  });

  it('a subpasta aparece dentro da mãe, recuada', async () => {
    await abrir();
    expect(within(screen.getByTestId(`trabalho-arvore-no-${GESTAO}`)).getByTestId(`trabalho-arvore-pasta-${MKT}`)).toBeInTheDocument();
  });

  it('arrastar uma lista para o nome de outra pasta muda a lista de pasta', async () => {
    await abrir();
    const antes = recargas();
    const dt = dataTransfer();
    fireEvent.dragStart(screen.getByTestId('trabalho-arvore-lista-l-avulsa'), { dataTransfer: dt });
    const alvo = screen.getByTestId(`trabalho-arvore-pasta-${VAZIA}`).parentElement as HTMLElement;
    fireEvent.dragOver(alvo, { dataTransfer: dt });
    await act(async () => { fireEvent.drop(alvo, { dataTransfer: dt }); });
    expect(patch).toHaveBeenCalledWith('/trabalho/listas/l-avulsa', { folderId: VAZIA }, 'tok');
    await waitFor(() => expect(aviso()).toHaveTextContent('A lista Avulsa foi para Administrativa.'));
    await waitFor(() => expect(recargas()).toBeGreaterThan(antes));
  });

  it('arrastar para "Sem pasta" tira a lista da pasta; a lista da implantação não sai', async () => {
    await abrir();
    let dt = dataTransfer();
    fireEvent.dragStart(screen.getByTestId('trabalho-arvore-lista-l-fin'), { dataTransfer: dt });
    fireEvent.dragOver(screen.getByTestId('trabalho-arvore-sem-pasta'), { dataTransfer: dt });
    await act(async () => { fireEvent.drop(screen.getByTestId('trabalho-arvore-sem-pasta'), { dataTransfer: dt }); });
    expect(patch).toHaveBeenCalledWith('/trabalho/listas/l-fin', { folderId: null }, 'tok');

    patch.mockClear();
    dt = dataTransfer();
    fireEvent.dragStart(screen.getByTestId('trabalho-arvore-lista-l-onb'), { dataTransfer: dt });
    const alvo = screen.getByTestId(`trabalho-arvore-pasta-${GESTAO}`).parentElement as HTMLElement;
    fireEvent.dragOver(alvo, { dataTransfer: dt });
    await act(async () => { fireEvent.drop(alvo, { dataTransfer: dt }); });
    expect(patch).not.toHaveBeenCalled();
  });

  it('arrastar com nome repetido no destino avisa e não grava', async () => {
    await abrir();
    // "pessoas" solta indo para Gestão, que já tem "Pessoas": a tela recusa com o nome.
    const dt = dataTransfer();
    fireEvent.dragStart(screen.getByTestId('trabalho-arvore-lista-l-pes-solta'), { dataTransfer: dt });
    const alvo = screen.getByTestId(`trabalho-arvore-pasta-${GESTAO}`).parentElement as HTMLElement;
    fireEvent.dragOver(alvo, { dataTransfer: dt });
    await act(async () => { fireEvent.drop(alvo, { dataTransfer: dt }); });
    expect(patch).not.toHaveBeenCalled();
    expect(aviso()).toHaveTextContent('No destino já existe uma lista chamada "pessoas". Renomeie uma delas antes de mover.');
  });

  it('soltar uma lista sobre uma irmã põe antes dela; sobre uma lista de outra pasta, muda de pasta e entra naquela posição', async () => {
    await abrir();
    let dt = dataTransfer();
    fireEvent.dragStart(screen.getByTestId('trabalho-arvore-lista-l-pes'), { dataTransfer: dt });
    let alvo = screen.getByTestId('trabalho-arvore-lista-l-fin').parentElement as HTMLElement;
    fireEvent.dragOver(alvo, { dataTransfer: dt });
    await act(async () => { fireEvent.drop(alvo, { dataTransfer: dt }); });
    expect(post).toHaveBeenCalledWith('/trabalho/arvore/ordem', { tipo: 'lista', paiId: GESTAO, ids: ['l-pes', 'l-fin'] }, 'tok');
    expect(patch).not.toHaveBeenCalled();

    post.mockClear();
    dt = dataTransfer();
    fireEvent.dragStart(screen.getByTestId('trabalho-arvore-lista-l-avulsa'), { dataTransfer: dt });
    alvo = screen.getByTestId('trabalho-arvore-lista-l-pes').parentElement as HTMLElement;
    fireEvent.dragOver(alvo, { dataTransfer: dt });
    await act(async () => { fireEvent.drop(alvo, { dataTransfer: dt }); });
    expect(patch).toHaveBeenCalledWith('/trabalho/listas/l-avulsa', { folderId: GESTAO }, 'tok');
    await waitFor(() => expect(post).toHaveBeenCalledWith('/trabalho/arvore/ordem', { tipo: 'lista', paiId: GESTAO, ids: ['l-fin', 'l-avulsa', 'l-pes'] }, 'tok'));
  });

  it('arrastar uma pasta sobre uma irmã reordena as pastas daquele nível', async () => {
    await abrir();
    const dt = dataTransfer();
    fireEvent.dragStart(screen.getByTestId(`trabalho-arvore-pasta-${VAZIA}`), { dataTransfer: dt });
    const alvo = screen.getByTestId(`trabalho-arvore-pasta-${GESTAO}`).parentElement as HTMLElement;
    fireEvent.dragOver(alvo, { dataTransfer: dt });
    await act(async () => { fireEvent.drop(alvo, { dataTransfer: dt }); });
    expect(post).toHaveBeenCalledWith('/trabalho/arvore/ordem', { tipo: 'pasta', paiId: null, ids: [VAZIA, GESTAO, CLIENTES] }, 'tok');
  });
});
