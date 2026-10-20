import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * ATAS MAIS VIVAS E O GRANOLA DIRETO (rodada da interface, 20/10/2026, U5).
 *
 *  1. sem a conexão direta, o bloco "Reuniões do Granola" diz onde conectar;
 *  2. conectado, lista as reuniões com o cliente reconhecido, e "Gerar ata"
 *     chama `POST /trabalho/atas/granola/:id/ata`, abre a ata e diz o que a
 *     leitura fez (versão, ficha, o que o parser tirou);
 *  3. a ata aberta mostra decisões e pendências, com a pendência que virou
 *     tarefa marcada e o link dela;
 *  4. a lista mostra pendentes, aceitas e descartadas, quem aceitou e o link;
 *  5. a ata do Granola reprocessa da transcrição (`POST :ref/reprocessar`);
 *  6. Conexões › Granola: "Conectar ao Granola" leva o navegador à autorização,
 *     e o retorno (`?granola=ok`) aparece escrito.
 */

const get = vi.fn(), post = vi.fn();
const TODAS = ['tarefas.ver', 'tarefas.editar', 'obsidian.ver', 'obsidian.editar', 'admin.usuarios'];
let permissions = [...TODAS];
vi.mock('@/lib/api', () => ({
  apiGet: (...a: unknown[]) => get(...a), apiPost: (...a: unknown[]) => post(...a),
  apiPatch: vi.fn(), apiDelete: vi.fn(), apiBlob: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'u' }, can: (p: string) => permissions.includes(p) }) }));
vi.mock('@/lib/ficha', () => ({ abrirFicha: vi.fn() }));
import AtasPage from '@/app/trabalho/atas/page';
import { ConexaoGranola } from '@/app/conexoes/ConexaoGranola';

const R1 = '5b1f8e0a-1c2d-4e3f-9a8b-7c6d5e4f3a21';
const R2 = '9c2e7d1b-3a4b-4c5d-8e9f-0a1b2c3d4e5f';
const REF = 'memoria:ata-granola-1';
const CARD = '0a0a0a0a-0000-4000-8000-0000000000c1';
const LISTA = '0a0a0a0a-0000-4000-8000-0000000000e1';
const TAREFA = '0a0a0a0a-0000-4000-8000-0000000000t1';

let conectado = true;
let comAta = false;

const reunioes = () => ({
  conectado,
  desligado: false,
  motivo: conectado ? null : 'Conecte o Granola em Configurações › Integrações para ler as reuniões daqui.',
  iaConfigurada: true,
  reunioes: conectado
    ? [
        { id: R1, titulo: 'Kickoff Padaria Exemplo', em: '2026-10-16T14:00:00.000Z', participantes: ['Marina Alves <marina@padariaexemplo.com.br>'], cliente: { taskId: CARD, titulo: 'Padaria Exemplo', porque: 'dominio' }, ataRef: comAta ? REF : null, ataVersao: comAta ? 1 : null, naFicha: comAta },
        { id: R2, titulo: 'Conversa avulsa sem cliente', em: '2026-10-15T10:00:00.000Z', participantes: [], cliente: null, ataRef: null, ataVersao: null, naFicha: false },
      ]
    : [],
});

const sugestao = (id: string, titulo: string, extra: Record<string, unknown> = {}) => ({
  id, ataRef: REF, titulo, listaId: LISTA, listaNome: 'Execução', donoSugerido: null, vencimento: null,
  trecho: 'Ainda falta definir quem cuida das redes sociais da loja nova.', estado: 'rascunho', workTaskId: null,
  criadaEm: '2026-10-20T12:00:00.000Z', decididaEm: null, decididaPor: null, ...extra,
});

const resumoGranola = () => ({
  id: REF, fonte: 'granola', titulo: 'Kickoff Padaria Exemplo', data: '2026-10-16', participantes: ['Marina Alves'],
  resumo: 'Reunião de kickoff.', caminho: null, granolaId: R1,
  sugestoes: { rascunho: 1, aceitas: 1, descartadas: 1 },
  decididas: [
    { id: 's-aceita', titulo: 'Definir o responsável pelas redes sociais', estado: 'aceita', decididaPor: 'Rodrigo Teste', decididaEm: '2026-10-20T13:00:00.000Z', workTaskId: TAREFA, listaId: LISTA },
    { id: 's-desc', titulo: 'Contratar agência', estado: 'descartada', decididaPor: 'Rodrigo Teste', decididaEm: '2026-10-20T12:30:00.000Z', workTaskId: null, listaId: null },
  ],
  atualizadaEm: '2026-10-20T12:00:00.000Z',
});

const detalheGranola = () => ({
  ...resumoGranola(),
  texto: '# Kickoff Padaria Exemplo\n\n## Decisões\n\n- O relatório mensal sai na primeira segunda-feira do mês\n\n## Pendências\n\n- Definir quem cuida das redes sociais da loja nova',
  procedencia: 'memória: ata:2026-10-16-kickoff-padaria-exemplo · versão 1 · granola:' + R1,
  sugestoesDaAta: [
    sugestao('s-aceita', 'Definir o responsável pelas redes sociais', { estado: 'aceita', workTaskId: TAREFA, decididaPor: 'Rodrigo Teste', decididaEm: '2026-10-20T13:00:00.000Z' }),
    sugestao('s-nova', 'Mandar a planilha de vendas'),
  ],
  decisoes: ['O relatório mensal sai na primeira segunda-feira do mês'],
  pendencias: [
    { texto: 'Definir quem cuida das redes sociais da loja nova', sugestaoId: 's-aceita', estado: 'aceita', workTaskId: TAREFA },
    { texto: 'Mandar a planilha de vendas de setembro', sugestaoId: 's-nova', estado: 'rascunho', workTaskId: null },
  ],
  versao: 1,
});

beforeEach(() => {
  window.history.replaceState({}, '', '/trabalho/atas');
  permissions = [...TODAS];
  conectado = true;
  comAta = false;
  get.mockReset(); post.mockReset();
  get.mockImplementation((rota: string) => {
    if (rota === '/trabalho/atas') return Promise.resolve({ pasta: '80-Reunioes', notasDoVault: 0, vaultVisivel: true, iaConfigurada: true, atas: comAta ? [resumoGranola()] : [] });
    if (rota === '/trabalho/atas/granola') return Promise.resolve(reunioes());
    if (rota === `/trabalho/atas/${encodeURIComponent(REF)}`) return Promise.resolve(detalheGranola());
    if (rota === '/trabalho/estrutura') return Promise.resolve({ espacos: [], folders: [], listasSoltas: [], camposGlobais: [], tags: [], responsaveis: [], agentes: [] });
    if (rota === '/trabalho/pessoas') return Promise.resolve([]);
    if (rota.startsWith('/trabalho/clientes')) return Promise.resolve([]);
    return Promise.resolve(null);
  });
});
afterEach(cleanup);

describe('Atas › Reuniões do Granola', () => {
  it('sem a conexão direta, diz onde conectar e não oferece "Gerar ata"', async () => {
    conectado = false;
    render(<AtasPage />);
    const bloco = await screen.findByTestId('granola-reunioes');
    expect(within(bloco).getByTestId('granola-sem-conexao')).toHaveTextContent('Conecte o Granola em Configurações › Integrações');
    expect(within(bloco).getByRole('link', { name: 'Abrir Integrações' })).toHaveAttribute('href', '/conexoes');
    expect(within(bloco).queryByRole('button', { name: /Gerar ata/ })).toBeNull();
  });

  it('lista as reuniões com o cliente reconhecido; Gerar ata puxa a transcrição e abre a ata', async () => {
    post.mockImplementation((rota: string) => {
      if (rota === `/trabalho/atas/granola/${encodeURIComponent(R1)}/ata`) {
        comAta = true;
        return Promise.resolve({
          ata: detalheGranola(), nova: true, versao: 1, criadas: [sugestao('s-nova', 'Mandar a planilha de vendas')], repetidas: 0,
          avisos: ['Sugestão "Contratar uma agência": descartada, o trecho citado NÃO está inteiro na ata (inventado ou emendado)'],
          cliente: { taskId: CARD, titulo: 'Padaria Exemplo', porque: 'dominio' }, ficha: 'criada',
        });
      }
      return Promise.resolve(null);
    });
    render(<AtasPage />);
    const r1 = await screen.findByTestId(`granola-reuniao-${R1}`);
    expect(r1).toHaveTextContent('Kickoff Padaria Exemplo');
    expect(r1).toHaveTextContent('Padaria Exemplo');
    expect(r1).toHaveTextContent('Marina Alves <marina@padariaexemplo.com.br>');
    expect(screen.getByTestId(`granola-reuniao-${R2}`)).toHaveTextContent('sem cliente reconhecido');

    fireEvent.click(within(r1).getByTestId(`granola-gerar-${R1}`));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/trabalho/atas/granola/${encodeURIComponent(R1)}/ata`, {}, 'tok'));
    const leitura = await screen.findByRole('list', { name: 'O que a leitura disse' });
    expect(leitura).toHaveTextContent('1 sugestão nova em rascunho.');
    expect(leitura).toHaveTextContent('Ata gerada da transcrição.');
    expect(leitura).toHaveTextContent('A reunião entrou na ficha de Padaria Exemplo.');
    expect(leitura).toHaveTextContent('NÃO está inteiro');
    expect(new URLSearchParams(window.location.search).get('ata')).toBe(REF);
    // Depois de gerar, a reunião mostra a ata e a ficha.
    await waitFor(() => expect(screen.getByTestId(`granola-reuniao-${R1}`)).toHaveTextContent('abrir a ata'));
    expect(screen.getByTestId(`granola-gerar-${R1}`)).toHaveTextContent('Gerar de novo');
  });

  it('a ata aberta mostra decisões e pendências, e a pendência que virou tarefa leva à tarefa', async () => {
    comAta = true;
    render(<AtasPage />);
    const decisoes = await screen.findByTestId('ata-decisoes');
    expect(decisoes).toHaveTextContent('O relatório mensal sai na primeira segunda-feira do mês');
    const virou = screen.getByTestId('ata-pendencia-0');
    expect(within(virou).getByRole('link', { name: 'virou tarefa' })).toHaveAttribute('href', `/trabalho?tarefa=${TAREFA}`);
    expect(screen.getByTestId('ata-pendencia-1')).toHaveTextContent('sugestão para decidir');
  });

  it('a lista mostra pendentes, aceitas e descartadas, quem aceitou e o link da tarefa', async () => {
    comAta = true;
    render(<AtasPage />);
    const item = await screen.findByTestId(`ata-${REF}`);
    expect(item).toHaveTextContent('Granola');
    expect(item).toHaveTextContent('1 para decidir');
    expect(item).toHaveTextContent('1 virou tarefa');
    expect(item).toHaveTextContent('1 descartada');
    const decididas = screen.getByTestId(`ata-decididas-${REF}`);
    expect(decididas).toHaveTextContent('aceita por Rodrigo Teste');
    expect(decididas).toHaveTextContent('descartada por Rodrigo Teste');
    expect(within(decididas).getByRole('link', { name: 'abrir a tarefa' })).toHaveAttribute('href', `/trabalho?lista=${LISTA}&tarefa=${TAREFA}`);
  });

  it('a ata do Granola reprocessa da transcrição', async () => {
    comAta = true;
    post.mockResolvedValue({ origem: 'granola', ata: detalheGranola(), nova: false, versao: 2, criadas: [], repetidas: 2, avisos: [], cliente: null, ficha: 'atualizada' });
    render(<AtasPage />);
    const botao = await screen.findByTestId(`ata-gerar-${REF}`);
    expect(botao).toHaveTextContent('Reprocessar da transcrição');
    fireEvent.click(botao);
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/trabalho/atas/${encodeURIComponent(REF)}/reprocessar`, {}, 'tok'));
    expect(await screen.findByText('Ata reprocessada: versão 2 da mesma nota.')).toBeInTheDocument();
  });

  it('sem obsidian.editar, a lista aparece mas Gerar ata não', async () => {
    permissions = ['tarefas.ver', 'tarefas.editar'];
    render(<AtasPage />);
    await screen.findByTestId(`granola-reuniao-${R1}`);
    expect(screen.queryByTestId(`granola-gerar-${R1}`)).toBeNull();
    expect(screen.getByText(/Gerar ata grava uma nota na memória/)).toBeInTheDocument();
  });
});

describe('Conexões › Granola: o modo direto', () => {
  const conexao = {
    caminho: '/api/trabalho/granola/org-1', cabecalho: 'x-root-segredo', desligado: false, desligadoEm: null, motivoDesligado: null,
    senha: { ativa: false, desde: null, usadaEm: null, revogadaEm: null }, recebendo: false, total: 0, ultimos30Dias: 0, semCliente: 0, ultimas: [],
  };
  let diretoConectado = false;
  beforeEach(() => {
    diretoConectado = false;
    window.history.replaceState({}, '', '/conexoes');
    get.mockImplementation((rota: string) => {
      if (rota === '/trabalho/fichas/granola/conexao') return Promise.resolve(conexao);
      if (rota === '/trabalho/granola/direto') {
        return Promise.resolve({ conectado: diretoConectado, desde: diretoConectado ? '2026-10-20T12:00:00.000Z' : null, servidor: 'https://mcp.granola.ai/mcp', retorno: 'https://os.exemplo/api/trabalho/granola/callback' });
      }
      return Promise.resolve(null);
    });
  });

  it('"Conectar ao Granola" pede a autorização e leva o navegador à página do Granola', async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, assign, search: '', origin: 'http://localhost' } });
    post.mockResolvedValue({ tipo: 'redirecionar', url: 'https://mcp-auth.exemplo/oauth2/authorize?state=x' });
    try {
      render(<ConexaoGranola token="tok" gerenciar />);
      const direto = await screen.findByTestId('granola-direto');
      expect(direto).toHaveTextContent('Não conectado');
      expect(direto).toHaveTextContent('https://os.exemplo/api/trabalho/granola/callback');
      fireEvent.click(within(direto).getByTestId('granola-conectar'));
      await waitFor(() => expect(post).toHaveBeenCalledWith('/integrations/granola/autorizacao', {}, 'tok'));
      await waitFor(() => expect(assign).toHaveBeenCalledWith('https://mcp-auth.exemplo/oauth2/authorize?state=x'));
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('o retorno da autorização aparece escrito, e conectado mostra "Desconectar"', async () => {
    diretoConectado = true;
    window.history.replaceState({}, '', '/conexoes?granola=ok');
    render(<ConexaoGranola token="tok" gerenciar />);
    expect(await screen.findByTestId('granola-retorno')).toHaveTextContent('Granola conectado.');
    const direto = await screen.findByTestId('granola-direto');
    await waitFor(() => expect(direto).toHaveTextContent('Conectado'));
    expect(within(direto).getByRole('button', { name: 'Desconectar' })).toBeInTheDocument();
  });
});
