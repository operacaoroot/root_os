import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * O BANCO DE ATAS DO TRABALHO (rodada do painel P3, 18/10/2026).
 *
 *  1. a lista mostra as atas com data, participantes e resumo; a primeira abre
 *     sozinha, inteira, em markdown renderizado sem innerHTML;
 *  2. colar uma ata manda o texto para `POST /trabalho/atas` e abre a ata salva;
 *  3. "Sugerir tarefas" pede `POST /trabalho/atas/:ref/sugestoes` e mostra o que
 *     a leitura disse (inclusive o que o parser descartou);
 *  4. aceitar é UM clique, na lista sugerida ou na escolhida; descartar idem;
 *  5. sem `tarefas.editar`, nenhum botão de escrita aparece.
 */

const get = vi.fn(), post = vi.fn();
let permissions = ['tarefas.ver', 'tarefas.editar'];
vi.mock('@/lib/api', () => ({
  apiGet: (...a: unknown[]) => get(...a), apiPost: (...a: unknown[]) => post(...a),
  apiPatch: vi.fn(), apiDelete: vi.fn(), apiBlob: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'u' }, can: (p: string) => permissions.includes(p) }) }));
import AtasPage from '@/app/trabalho/atas/page';

const REF = 'memoria:ata-1';
const REF_VAULT = 'vault:nota-9';
const L_EXEC = '0a0a0a0a-0000-4000-8000-0000000000e1';
const L_ONB = '0a0a0a0a-0000-4000-8000-0000000000e2';

const resumo = (id: string, titulo: string, extra: Record<string, unknown> = {}) => ({
  id, fonte: id.startsWith('vault') ? 'vault' : 'colada', titulo, data: '2026-10-16', participantes: ['Marina Alves', 'Paulo Rocha'],
  resumo: 'A equipe revisou a implantação.', caminho: null, sugestoes: { rascunho: 0, aceitas: 0, descartadas: 0 },
  atualizadaEm: '2026-10-16T12:00:00.000Z', ...extra,
});
const sugestao = (id: string, titulo: string, extra: Record<string, unknown> = {}) => ({
  id, ataRef: REF, titulo, listaId: L_EXEC, listaNome: 'Execução', donoSugerido: 'Marina', vencimento: '2026-10-23',
  trecho: 'Marina vai enviar o relatório mensal até 23/10.', estado: 'rascunho', workTaskId: null,
  criadaEm: '2026-10-18T12:00:00.000Z', decididaEm: null, decididaPor: null, ...extra,
});

let sugestoes: ReturnType<typeof sugestao>[] = [];
const detalhe = () => ({
  ...resumo(REF, 'Reunião de operação semanal'),
  texto: '# Reunião\n\n## Encaminhamentos\n- Marina vai enviar o relatório mensal até 23/10.\n\n<script>alert(1)</script>',
  procedencia: 'memória: ata:2026-10-16-reuniao · versão 1',
  sugestoesDaAta: sugestoes,
});
const estrutura = {
  espacos: [],
  folders: [{ id: 'f-cli', name: 'Clientes', order: 0, spaceId: null, parentId: null, externalId: null, lists: [
    { id: L_EXEC, name: 'Execução', externalId: null, spaceId: null, order: 0, total: 0, statuses: [], fields: [] },
    { id: L_ONB, name: 'Onboarding de cliente', externalId: null, spaceId: null, order: 1, total: 0, statuses: [], fields: [] },
  ] }],
  listasSoltas: [], camposGlobais: [], tags: [], responsaveis: [], agentes: [],
};

beforeEach(() => {
  window.history.replaceState({}, '', '/trabalho/atas');
  permissions = ['tarefas.ver', 'tarefas.editar'];
  sugestoes = [];
  get.mockReset(); post.mockReset();
  get.mockImplementation((rota: string) => {
    if (rota === '/trabalho/atas') {
      return Promise.resolve({ pasta: '80-Reunioes', notasDoVault: 0, iaConfigurada: true, atas: [resumo(REF, 'Reunião de operação semanal'), resumo(REF_VAULT, 'Diretoria', { caminho: '80-Reunioes/Diretoria.md', participantes: [] })] });
    }
    if (rota === `/trabalho/atas/${encodeURIComponent(REF)}`) return Promise.resolve(detalhe());
    if (rota === `/trabalho/atas/${encodeURIComponent(REF_VAULT)}`) return Promise.resolve({ ...resumo(REF_VAULT, 'Diretoria'), texto: 'Ata da diretoria.', procedencia: 'vault: 80-Reunioes/Diretoria.md', sugestoesDaAta: [] });
    if (rota === '/trabalho/estrutura') return Promise.resolve(estrutura);
    return Promise.resolve(null);
  });
});
afterEach(cleanup);

describe('Atas: a lista e a ata aberta', () => {
  it('lista as atas com data, participantes e resumo, e abre a primeira inteira', async () => {
    render(<AtasPage />);
    const lista = await screen.findByTestId('atas-lista');
    const item = within(lista).getByTestId(`ata-${REF}`);
    expect(item).toHaveTextContent('Reunião de operação semanal');
    expect(item).toHaveTextContent('16/10/2026');
    expect(item).toHaveTextContent('Marina Alves, Paulo Rocha');
    expect(item).toHaveTextContent('A equipe revisou a implantação.');
    expect(within(lista).getByTestId(`ata-${REF_VAULT}`)).toHaveTextContent('vault');
    // A ata inteira, em markdown: título e lista viram elementos; o <script> fica texto.
    const ata = await screen.findByRole('article', { name: 'A ata inteira' });
    expect(within(ata).getByRole('heading', { name: 'Encaminhamentos' })).toBeInTheDocument();
    expect(within(ata).getByText(/Marina vai enviar o relatório/).tagName).toBe('LI');
    expect(ata.querySelector('script')).toBeNull();
    expect(ata).toHaveTextContent('<script>alert(1)</script>');
    expect(screen.getByText(/só as atas coladas aqui/)).toBeInTheDocument();
  });

  it('abrir outra ata troca a ata da direita e escreve ?ata= no endereço', async () => {
    render(<AtasPage />);
    fireEvent.click(await screen.findByTestId(`ata-${REF_VAULT}`));
    expect(await screen.findByText('Ata da diretoria.')).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('ata')).toBe(REF_VAULT);
  });

  it('o link da tarefa (?ata=) abre a ata pedida', async () => {
    window.history.replaceState({}, '', `/trabalho/atas?ata=${encodeURIComponent(REF_VAULT)}`);
    render(<AtasPage />);
    expect(await screen.findByText('Ata da diretoria.')).toBeInTheDocument();
  });
});

describe('Atas: colar', () => {
  it('colar manda o texto para a API e abre a ata salva', async () => {
    post.mockResolvedValueOnce(detalhe());
    render(<AtasPage />);
    fireEvent.click(await screen.findByTestId('ata-colar'));
    const salvar = screen.getByTestId('ata-colar-salvar');
    expect(salvar).toBeDisabled();
    fireEvent.change(screen.getByTestId('ata-colar-titulo'), { target: { value: 'Reunião de operação semanal' } });
    const texto = 'Marina vai enviar o relatório mensal até 23/10. '.repeat(4);
    fireEvent.change(screen.getByTestId('ata-colar-texto'), { target: { value: texto } });
    fireEvent.change(screen.getByLabelText('Data da reunião'), { target: { value: '2026-10-16' } });
    expect(salvar).toBeEnabled();
    fireEvent.click(salvar);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/trabalho/atas', {
      titulo: 'Reunião de operação semanal', data: '2026-10-16', participantes: [], texto,
    }, 'tok'));
    await waitFor(() => expect(screen.queryByTestId('ata-colar-texto')).toBeNull());
  });
});

describe('Atas: sugestões', () => {
  it('Sugerir tarefas pede a leitura e mostra o que o parser disse', async () => {
    post.mockImplementationOnce(() => {
      sugestoes = [sugestao('s1', 'Enviar o relatório mensal')];
      return Promise.resolve({ criadas: sugestoes, repetidas: 0, avisos: ['"Contratar": cita um trecho que NÃO está na ata — descartada (era invenção)'] });
    });
    render(<AtasPage />);
    fireEvent.click(await screen.findByTestId(`ata-gerar-${REF}`));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/trabalho/atas/${encodeURIComponent(REF)}/sugestoes`, {}, 'tok'));
    expect(await screen.findByText('1 sugestão nova em rascunho.')).toBeInTheDocument();
    expect(screen.getByText(/NÃO está na ata/)).toBeInTheDocument();
    const s = await screen.findByTestId('ata-sugestao-s1');
    expect(s).toHaveTextContent('Marina vai enviar o relatório mensal até 23/10.');
    expect(s).toHaveTextContent('dono sugerido: Marina');
    expect(s).toHaveTextContent('vence 23/10/2026');
  });

  it('aceitar é um clique, na lista sugerida', async () => {
    sugestoes = [sugestao('s1', 'Enviar o relatório mensal')];
    post.mockImplementationOnce(() => {
      sugestoes = [sugestao('s1', 'Enviar o relatório mensal', { estado: 'aceita', workTaskId: 'w1', decididaPor: 'Rodrigo' })];
      return Promise.resolve(sugestoes[0]);
    });
    render(<AtasPage />);
    fireEvent.click(await screen.findByTestId('ata-aceitar-s1'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/trabalho/atas/sugestoes/s1/aceitar', { listaId: L_EXEC }, 'tok'));
    expect(post).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/aceita em Execução por Rodrigo/)).toBeInTheDocument();
    expect(screen.queryByTestId('ata-aceitar-s1')).toBeNull();
    expect(screen.getByRole('link', { name: 'abrir a tarefa' })).toHaveAttribute('href', `/trabalho?lista=${L_EXEC}&tarefa=w1`);
  });

  it('sem lista sugerida, aceitar espera a lista escolhida e a manda junto', async () => {
    sugestoes = [sugestao('s2', 'Revisar o roteiro', { listaId: null, listaNome: null })];
    post.mockResolvedValueOnce({});
    render(<AtasPage />);
    const aceitar = await screen.findByTestId('ata-aceitar-s2');
    expect(aceitar).toBeDisabled();
    await screen.findByRole('option', { name: 'Clientes › Onboarding de cliente' });
    fireEvent.change(screen.getByLabelText('Lista da tarefa "Revisar o roteiro"'), { target: { value: L_ONB } });
    expect(aceitar).toBeEnabled();
    fireEvent.click(aceitar);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/trabalho/atas/sugestoes/s2/aceitar', { listaId: L_ONB }, 'tok'));
  });

  it('descartar é um clique e não cria tarefa', async () => {
    sugestoes = [sugestao('s3', 'Agendar o kickoff')];
    post.mockImplementationOnce(() => {
      sugestoes = [sugestao('s3', 'Agendar o kickoff', { estado: 'descartada', decididaPor: 'Rodrigo' })];
      return Promise.resolve(sugestoes[0]);
    });
    render(<AtasPage />);
    fireEvent.click(await screen.findByTestId('ata-descartar-s3'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/trabalho/atas/sugestoes/s3/descartar', {}, 'tok'));
    expect(post).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/descartada por Rodrigo/)).toBeInTheDocument();
  });

  it('o erro da API aparece como veio (ex.: o 409 do segundo clique)', async () => {
    sugestoes = [sugestao('s1', 'Enviar o relatório mensal')];
    post.mockRejectedValueOnce(new Error('Esta sugestão já foi aceita: a tarefa já existe.'));
    render(<AtasPage />);
    fireEvent.click(await screen.findByTestId('ata-aceitar-s1'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Esta sugestão já foi aceita: a tarefa já existe.');
  });
});

describe('Atas: só leitura', () => {
  it('sem tarefas.editar não há colar, sugerir, aceitar nem descartar', async () => {
    permissions = ['tarefas.ver'];
    sugestoes = [sugestao('s1', 'Enviar o relatório mensal')];
    render(<AtasPage />);
    expect(await screen.findByTestId('ata-sugestao-s1')).toBeInTheDocument();
    expect(screen.queryByTestId('ata-colar')).toBeNull();
    expect(screen.queryByTestId(`ata-gerar-${REF}`)).toBeNull();
    expect(screen.queryByTestId('ata-aceitar-s1')).toBeNull();
    expect(screen.queryByTestId('ata-descartar-s1')).toBeNull();
    expect(get).not.toHaveBeenCalledWith('/trabalho/estrutura', 'tok');
  });

  it('sem tarefas.ver a tela diz que não há permissão e não consulta nada', () => {
    permissions = [];
    render(<AtasPage />);
    expect(screen.getByText('Sem permissão para ver as atas.')).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });
});
