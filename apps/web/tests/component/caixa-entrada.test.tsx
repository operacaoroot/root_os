import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  CaixaAtividade,
  CaixaAtividadeResposta,
  CaixaMinhaTarefa,
  CaixaResposta,
  CaixaTarefasResposta,
} from '@mktos/shared';

/*
 * ==========================================================================
 * A CAIXA DE ENTRADA — as abas, o Limpar e o balão de comentários (P1)
 * ==========================================================================
 *
 *  1. AS ABAS são um tablist de verdade, e a aba vai na query (`?aba=`);
 *  2. ATIVIDADE mostra quem fez, o que mudou (de → para) e o trecho do
 *     comentário; Limpar tira o item da caixa e grava SÓ a marca (`POST
 *     /caixa/limpar` com o id do item); Limpar tudo manda o instante da leitura;
 *  3. MINHAS TAREFAS: filtros vão para a rota, colunas se escondem e a escolha
 *     fica no localStorage, os comentários abrem num balão lido da rota dona
 *     (`/trabalho/tarefas/:id`), sem sair da tela;
 *  4. ERRO tem "tentar de novo".
 */

const apiGet = vi.fn();
const apiPost = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
  };
});

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u-eu', name: 'Pedro', email: 'p@x.com', roles: [], permissions: ['dashboard.ver', 'tarefas.ver'] },
    can: () => true,
  }),
}));

// eslint-disable-next-line import/first
import CaixaPage from '@/app/caixa/page';
// eslint-disable-next-line import/first
import { CHAVE_DAS_COLUNAS } from '@/app/caixa/AbaMinhasTarefas';

const AGORA = new Date();
const haMin = (m: number) => new Date(AGORA.getTime() - m * 60_000).toISOString();

const CAIXA: CaixaResposta = {
  agora: AGORA.toISOString(),
  eu: { id: 'u-eu', nome: 'Pedro', alcada: 'responsavel', decide: true, decideNestaSessao: true, ativo: true },
  aprovacoes: { estado: 'ok', itens: [], retidasPorImpedimento: 0, truncado: false, teto: 50 },
  tarefas: { estado: 'ok', itens: [], truncado: false, teto: 50, identidades: ['Pedro'], diasSemMovimento: 7, horasPresa: 24 },
  conversa: { estado: 'ok', itens: [], truncado: false, dias: 7, teto: 20 },
  total: 0,
  totalParcial: false,
  source: { tool: 'caixa-pessoal', generatedAt: AGORA.toISOString() },
};

function evento(over: Partial<CaixaAtividade>): CaixaAtividade {
  return {
    id: 'auditoria:a1',
    origem: 'auditoria',
    tipo: 'status',
    tarefaId: 't-1',
    tarefaTitulo: 'Fechar o relatório do cliente',
    lista: 'Operação',
    quem: 'Lucas Fernandes',
    quemTipo: 'user',
    porMim: false,
    quando: haMin(5),
    mudancas: [{ campo: 'status', de: 'A fazer', para: 'Em andamento' }],
    trecho: null,
    trechoCortado: false,
    limpo: false,
    ...over,
  };
}

function atividade(itens: CaixaAtividade[], over: Partial<CaixaAtividadeResposta> = {}): CaixaAtividadeResposta {
  return {
    estado: 'ok',
    itens,
    proximo: null,
    identidades: ['Pedro'],
    limpoAte: null,
    incluirLimpos: false,
    incluirMeus: false,
    tarefasTruncadas: false,
    agora: AGORA.toISOString(),
    ...over,
  };
}

const TAREFA: CaixaMinhaTarefa = {
  id: 't-9',
  titulo: 'Revisar contrato da Ana',
  listaId: 'l-1',
  lista: 'Operacional',
  pastaId: 'p-1',
  pasta: 'Clientes',
  status: 'Em andamento',
  statusCor: '#9bdb1f',
  statusTipo: 'open',
  prazo: new Date(AGORA.getTime() - 86_400_000).toISOString(),
  responsavel: 'Pedro',
  comentarios: 2,
  atualizadaEm: haMin(60),
  motivos: ['prazo_vencido'],
};

function tarefas(itens: CaixaMinhaTarefa[]): CaixaTarefasResposta {
  return {
    estado: 'ok',
    itens,
    truncado: false,
    teto: 200,
    identidades: ['Pedro'],
    listas: [{ id: 'l-1', nome: 'Operacional', pastaId: 'p-1', pasta: 'Clientes' }],
    status: ['A fazer', 'Em andamento'],
    filtros: { responsavel: 'eu', encerradas: false },
    agora: AGORA.toISOString(),
  };
}

let ATIVIDADE: CaixaAtividadeResposta;
let TAREFAS: CaixaTarefasResposta;

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/caixa');
  ATIVIDADE = atividade([
    evento({}),
    evento({
      id: 'comentario:c1',
      origem: 'comentario',
      tipo: 'comentario',
      quem: 'Ana Souza',
      mudancas: [],
      trecho: 'precisa do anexo assinado',
      quando: haMin(30),
    }),
  ]);
  TAREFAS = tarefas([TAREFA]);
  apiGet.mockImplementation((caminho: string) => {
    if (caminho === '/caixa') return Promise.resolve(CAIXA);
    if (caminho.startsWith('/caixa/atividade')) return Promise.resolve(ATIVIDADE);
    if (caminho.startsWith('/caixa/tarefas')) return Promise.resolve(TAREFAS);
    if (caminho.startsWith('/trabalho/tarefas/')) {
      return Promise.resolve({
        comentarios: [
          { id: 'k2', authorId: 'u-2', authorName: 'Lucas', text: 'último recado', createdAt: haMin(10) },
          { id: 'k1', authorId: 'u-3', authorName: 'Ana', text: 'primeiro recado', createdAt: haMin(90) },
        ],
      });
    }
    return Promise.reject(new Error(`rota inesperada ${caminho}`));
  });
  apiPost.mockResolvedValue({ limpos: 1, limpoAte: null });
});

describe('P1: as abas', () => {
  it('abre na Atividade, é um tablist acessível e troca pela query', async () => {
    render(<CaixaPage />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Atividade', 'Minhas tarefas']);
    expect(screen.getByTestId('caixa-aba-atividade').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByTestId('caixa-aba-tarefas'));
    expect(screen.getByTestId('caixa-aba-tarefas').getAttribute('aria-selected')).toBe('true');
    expect(window.location.search).toBe('?aba=tarefas');
    await waitFor(() => expect(screen.getByTestId('caixa-tarefa-t-9')).toBeTruthy());
  });

  it('?aba=tarefas no endereço abre direto em Minhas tarefas', async () => {
    window.history.replaceState(null, '', '/caixa?aba=tarefas');
    render(<CaixaPage />);
    await waitFor(() => expect(screen.getByTestId('caixa-aba-tarefas').getAttribute('aria-selected')).toBe('true'));
  });

  it('a seta do teclado troca de aba', () => {
    render(<CaixaPage />);
    fireEvent.keyDown(screen.getByTestId('caixa-aba-atividade'), { key: 'ArrowRight' });
    expect(screen.getByTestId('caixa-aba-tarefas').getAttribute('aria-selected')).toBe('true');
  });
});

describe('P1: a aba Atividade', () => {
  it('mostra quem fez, o de → para e o trecho do comentário', async () => {
    render(<CaixaPage />);
    const item = await screen.findByTestId('caixa-item-auditoria:a1');
    expect(within(item).getByText('Lucas Fernandes')).toBeTruthy();
    expect(within(item).getByText('A fazer')).toBeTruthy();
    expect(within(item).getByText('Em andamento')).toBeTruthy();
    expect(within(item).getByText(/mudou o status/)).toBeTruthy();
    const comentario = screen.getByTestId('caixa-item-comentario:c1');
    expect(within(comentario).getByText(/precisa do anexo assinado/)).toBeTruthy();
    // O link leva à tarefa no quadro.
    expect(within(item).getByRole('link').getAttribute('href')).toBe('/trabalho?tarefa=t-1');
  });

  it('Limpar tira o item da caixa e manda só o id dele', async () => {
    render(<CaixaPage />);
    fireEvent.click(await screen.findByTestId('caixa-limpar-auditoria:a1'));
    await waitFor(() => expect(screen.queryByTestId('caixa-item-auditoria:a1')).toBeNull());
    expect(apiPost).toHaveBeenCalledWith('/caixa/limpar', { ids: ['auditoria:a1'] }, 'tok');
    expect(screen.getByTestId('caixa-item-comentario:c1')).toBeTruthy();
    // O foco não cai no body: vai ao "Limpar" do item seguinte.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('caixa-limpar-comentario:c1')));
    // Limpo o último, o foco vai ao "Limpar tudo" (ou, desligado, ao topo da aba).
    fireEvent.click(screen.getByTestId('caixa-limpar-comentario:c1'));
    await waitFor(() => expect(screen.queryByTestId('caixa-item-comentario:c1')).toBeNull());
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  });

  it('Limpar tudo manda o instante da leitura e relê a caixa', async () => {
    render(<CaixaPage />);
    await screen.findByTestId('caixa-item-auditoria:a1');
    ATIVIDADE = atividade([]);
    fireEvent.click(screen.getByTestId('caixa-limpar-tudo'));
    await waitFor(() => expect(screen.getByText(/Nada novo nas suas tarefas/)).toBeTruthy());
    expect(apiPost).toHaveBeenCalledWith('/caixa/limpar', { tudo: true, ate: AGORA.toISOString() }, 'tok');
  });

  it('"ver também os já limpos" pede o histórico, e o limpo não tem botão', async () => {
    render(<CaixaPage />);
    await screen.findByTestId('caixa-item-auditoria:a1');
    ATIVIDADE = atividade([evento({ limpo: true })], { incluirLimpos: true });
    fireEvent.click(screen.getByTestId('caixa-incluir-limpos'));
    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith('/caixa/atividade?incluirLimpos=1', 'tok'),
    );
    await waitFor(() => expect(screen.queryByTestId('caixa-item-comentario:c1')).toBeNull());
    expect(screen.queryByTestId('caixa-limpar-auditoria:a1')).toBeNull();
  });

  it('"mostrar o que eu fiz" vai na rota', async () => {
    render(<CaixaPage />);
    await screen.findByTestId('caixa-item-auditoria:a1');
    fireEvent.click(screen.getByTestId('caixa-incluir-meus'));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/caixa/atividade?incluirMeus=1', 'tok'));
  });

  it('erro tem "tentar de novo", e tentar de novo relê', async () => {
    let falhar = true;
    apiGet.mockImplementation((caminho: string) => {
      if (caminho === '/caixa') return Promise.resolve(CAIXA);
      if (caminho.startsWith('/caixa/atividade')) {
        return falhar ? Promise.reject(new Error('API fora do ar')) : Promise.resolve(ATIVIDADE);
      }
      return Promise.resolve(TAREFAS);
    });
    render(<CaixaPage />);
    await waitFor(() => expect(screen.getByText(/API fora do ar/)).toBeTruthy());
    falhar = false;
    fireEvent.click(screen.getAllByRole('button', { name: 'tentar de novo' })[0]);
    await screen.findByTestId('caixa-item-auditoria:a1');
  });

  it('módulo desligado é explicado, não escondido', async () => {
    ATIVIDADE = atividade([], { estado: 'modulo_desligado' });
    render(<CaixaPage />);
    await waitFor(() => expect(screen.getByText(/não está contratado/)).toBeTruthy());
  });
});

describe('P1: a aba Minhas tarefas', () => {
  it('mostra nome, lista, status, vencimento, responsável e comentários', async () => {
    render(<CaixaPage />);
    fireEvent.click(screen.getByTestId('caixa-aba-tarefas'));
    const linha = await screen.findByTestId('caixa-tarefa-t-9');
    expect(within(linha).getByText('Revisar contrato da Ana')).toBeTruthy();
    expect(within(linha).getByText('Operacional')).toBeTruthy();
    expect(within(linha).getByText('Em andamento')).toBeTruthy();
    expect(within(linha).getByText('prazo vencido')).toBeTruthy();
    expect(within(linha).getByTestId('caixa-comentarios-t-9').textContent).toContain('2');
  });

  it('o filtro vai para a rota', async () => {
    render(<CaixaPage />);
    fireEvent.click(screen.getByTestId('caixa-aba-tarefas'));
    await screen.findByTestId('caixa-tarefa-t-9');
    fireEvent.change(screen.getByTestId('caixa-filtro-vencimento'), { target: { value: 'hoje' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/caixa/tarefas?vencimento=hoje', 'tok'));
    fireEvent.change(screen.getByTestId('caixa-filtro-lista'), { target: { value: 'pasta:p-1' } });
    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith('/caixa/tarefas?pastaId=p-1&vencimento=hoje', 'tok'),
    );
    fireEvent.change(screen.getByTestId('caixa-filtro-responsavel'), { target: { value: 'qualquer' } });
    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith('/caixa/tarefas?pastaId=p-1&vencimento=hoje&responsavel=qualquer', 'tok'),
    );
  });

  it('esconder uma coluna tira a coluna e guarda a escolha', async () => {
    render(<CaixaPage />);
    fireEvent.click(screen.getByTestId('caixa-aba-tarefas'));
    await screen.findByTestId('caixa-tarefa-t-9');
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toContain('Responsáveis');
    fireEvent.click(screen.getByTestId('caixa-coluna-responsaveis'));
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).not.toContain('Responsáveis');
    expect(JSON.parse(window.localStorage.getItem(CHAVE_DAS_COLUNAS) ?? '[]')).toEqual([
      'lista',
      'status',
      'vencimento',
      'comentarios',
    ]);
  });

  it('a preferência de colunas volta na próxima visita', async () => {
    window.localStorage.setItem(CHAVE_DAS_COLUNAS, JSON.stringify(['status']));
    render(<CaixaPage />);
    fireEvent.click(screen.getByTestId('caixa-aba-tarefas'));
    await screen.findByTestId('caixa-tarefa-t-9');
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Nome', 'Status']);
  });

  it('o clique nos comentários abre o balão com os últimos, sem sair da tela', async () => {
    render(<CaixaPage />);
    fireEvent.click(screen.getByTestId('caixa-aba-tarefas'));
    fireEvent.click(await screen.findByTestId('caixa-comentarios-t-9'));
    const balao = await screen.findByRole('dialog', { name: /Comentários de Revisar contrato/ });
    await waitFor(() => expect(within(balao).getByText('último recado')).toBeTruthy());
    expect(within(balao).getByText('primeiro recado')).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith('/trabalho/tarefas/t-9', 'tok');
    // Esc fecha e devolve o foco ao botão que abriu.
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByTestId('caixa-comentarios-t-9'));
    // A tabela continua ali: não saiu da tela.
    expect(screen.getByTestId('caixa-tarefa-t-9')).toBeTruthy();
  });

  it('o botão dos comentários alterna o balão: com ele aberto, o clique fecha (e não reabre)', async () => {
    render(<CaixaPage />);
    fireEvent.click(screen.getByTestId('caixa-aba-tarefas'));
    const botao = await screen.findByTestId('caixa-comentarios-t-9');
    fireEvent.click(botao);
    await screen.findByRole('dialog', { name: /Comentários de Revisar contrato/ });
    expect(botao).toHaveAttribute('aria-expanded', 'true');
    fireEvent.mouseDown(botao);
    fireEvent.click(botao);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(botao).toHaveAttribute('aria-expanded', 'false');
    // O botão "fechar" de dentro também devolve o foco.
    fireEvent.click(botao);
    fireEvent.click(await screen.findByRole('button', { name: 'Fechar comentários' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(botao);
  });

  it('sem tarefas, a frase diz isso', async () => {
    TAREFAS = tarefas([]);
    render(<CaixaPage />);
    fireEvent.click(screen.getByTestId('caixa-aba-tarefas'));
    await waitFor(() => expect(screen.getByText(/Nenhuma tarefa aberta com você/)).toBeTruthy());
  });
});
