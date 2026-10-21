import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * AS ATAS: FONTES, BUSCA E DUAS COLUNAS (produção 21, P7, 21/10/2026).
 *
 *  1. a lista junta vault, colada, Granola e Drive, e cada item diz se é ata ou
 *     transcrição e de onde veio;
 *  2. a busca (palavra-chave com pausa, de, até, tipo e fonte) vai ao endereço
 *     e à API; "Limpar" tira tudo;
 *  3. no desktop a tela tem a altura da janela e não rola: quem rola é a lista
 *     (e o detalhe), cada um por si;
 *  4. no celular, lista e detalhe são telas separadas, com "Voltar";
 *  5. a pasta do Drive se escolhe colando o link; a transcrição do Drive gera
 *     ata pela rota do Drive e o item abre no Drive.
 */

const get = vi.fn(), post = vi.fn(), put = vi.fn();
let permissions = ['tarefas.ver', 'tarefas.editar', 'obsidian.ver', 'obsidian.editar', 'drive.ver'];
vi.mock('@/lib/api', () => ({
  apiGet: (...a: unknown[]) => get(...a), apiPost: (...a: unknown[]) => post(...a), apiPut: (...a: unknown[]) => put(...a),
  apiPatch: vi.fn(), apiDelete: vi.fn(), apiBlob: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'u' }, can: (p: string) => permissions.includes(p) }) }));
import AtasPage from '@/app/trabalho/atas/page';

const ARQ_ATA = '1AbCdEfGhIjKlMnOpQrStUv';
const ARQ_TRANS = '1ZyXwVuTsRqPoNmLkJiHgFe';
const R1 = '5b1f8e0a-1c2d-4e3f-9a8b-7c6d5e4f3a21';

const item = (id: string, fonte: string, tipo: string, titulo: string, data: string, extra: Record<string, unknown> = {}) => ({
  id, fonte, tipo, titulo, data, participantes: [], resumo: '', caminho: null,
  sugestoes: { rascunho: 0, aceitas: 0, descartadas: 0 }, decididas: [], atualizadaEm: `${data}T12:00:00.000Z`, ...extra,
});
const ATAS = [
  item(`drive:${ARQ_TRANS}`, 'drive', 'transcricao', 'Transcrição kickoff', '2026-10-20', { link: `https://docs.google.com/document/d/${ARQ_TRANS}` }),
  item(`granola:${R1}`, 'granola', 'transcricao', 'Reunião de diretoria', '2026-10-19'),
  item(`drive:${ARQ_ATA}`, 'drive', 'ata', 'Ata comitê', '2026-10-18', { link: `https://docs.google.com/document/d/${ARQ_ATA}` }),
  item('vault:n1', 'vault', 'ata', 'Ata do vault', '2026-10-17'),
  item('memoria:c1', 'colada', 'ata', 'Ata colada', '2026-10-16'),
];
const FONTES = {
  vault: { visivel: true, notas: 3, pasta: '80-Reunioes' },
  granola: { conectado: true, motivo: null, reunioes: 1 },
  drive: { configurada: true, pastaId: '1PastaDasAtas0000000', permitido: true, motivo: null, link: 'https://drive.google.com/drive/folders/1PastaDasAtas0000000', arquivos: 2 },
};
const detalhe = (r: (typeof ATAS)[number], texto: string) => ({ ...r, texto, procedencia: 'fonte', sugestoesDaAta: [], decisoes: [], pendencias: [], versao: null });

function larguraDaJanela(px: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: px });
  act(() => { window.dispatchEvent(new Event('resize')); });
}

beforeEach(() => {
  window.history.replaceState({}, '', '/trabalho/atas');
  permissions = ['tarefas.ver', 'tarefas.editar', 'obsidian.ver', 'obsidian.editar', 'drive.ver'];
  larguraDaJanela(1280);
  get.mockReset(); post.mockReset(); put.mockReset();
  get.mockImplementation((rota: string) => {
    if (rota.startsWith('/trabalho/atas?') || rota === '/trabalho/atas') {
      return Promise.resolve({ pasta: '80-Reunioes', notasDoVault: 3, vaultVisivel: true, iaConfigurada: true, fontes: FONTES, atas: ATAS });
    }
    for (const a of ATAS) {
      if (rota === `/trabalho/atas/${encodeURIComponent(a.id)}`) return Promise.resolve(detalhe(a, a.tipo === 'transcricao' ? `Fala da ${a.titulo}` : `# ${a.titulo}\n\nTexto da ata.`));
    }
    if (rota === '/trabalho/estrutura') return Promise.resolve({ espacos: [], folders: [], listasSoltas: [], camposGlobais: [], tags: [], responsaveis: [], agentes: [] });
    if (rota === '/trabalho/pessoas') return Promise.resolve([]);
    return Promise.resolve(null);
  });
});
afterEach(cleanup);

const rotasDaLista = () => get.mock.calls.map((c) => String(c[0])).filter((r) => r.startsWith('/trabalho/atas?') || r === '/trabalho/atas');

describe('Atas: as fontes e o tipo', () => {
  it('cada item diz se é ata ou transcrição e a fonte', async () => {
    render(<AtasPage />);
    const lista = await screen.findByTestId('atas-lista');
    expect(within(lista).getByTestId(`ata-tipo-drive:${ARQ_TRANS}`)).toHaveTextContent('transcrição');
    expect(within(lista).getByTestId(`ata-drive:${ARQ_TRANS}`)).toHaveTextContent('Drive');
    expect(within(lista).getByTestId(`ata-tipo-granola:${R1}`)).toHaveTextContent('transcrição');
    expect(within(lista).getByTestId(`ata-granola:${R1}`)).toHaveTextContent('Granola');
    expect(within(lista).getByTestId(`ata-tipo-drive:${ARQ_ATA}`)).toHaveTextContent('ata');
    expect(within(lista).getByTestId('ata-vault:n1')).toHaveTextContent('vault');
    expect(within(lista).getByTestId('ata-memoria:c1')).toHaveTextContent('colada');
    expect(screen.getByTestId('drive-estado')).toHaveTextContent('Google Drive: os arquivos da pasta escolhida');
  });
});

describe('Atas: a busca', () => {
  it('a palavra-chave vai ao endereço e à API depois da pausa', async () => {
    render(<AtasPage />);
    await screen.findByTestId('atas-lista');
    fireEvent.change(screen.getByTestId('atas-busca'), { target: { value: 'kickoff' } });
    await waitFor(() => expect(rotasDaLista()).toContain('/trabalho/atas?q=kickoff'));
    expect(new URLSearchParams(window.location.search).get('q')).toBe('kickoff');
  });

  it('de, até, tipo e fonte vão juntos; Limpar tira tudo', async () => {
    render(<AtasPage />);
    await screen.findByTestId('atas-lista');
    fireEvent.change(screen.getByTestId('atas-de'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByTestId('atas-ate'), { target: { value: '2026-10-19' } });
    fireEvent.change(screen.getByTestId('atas-tipo'), { target: { value: 'transcricao' } });
    fireEvent.change(screen.getByTestId('atas-fonte'), { target: { value: 'drive' } });
    await waitFor(() => expect(rotasDaLista()).toContain('/trabalho/atas?de=2026-10-01&ate=2026-10-19&tipo=transcricao&fonte=drive'));
    const p = new URLSearchParams(window.location.search);
    expect([p.get('de'), p.get('ate'), p.get('tipo'), p.get('fonte')]).toEqual(['2026-10-01', '2026-10-19', 'transcricao', 'drive']);
    fireEvent.click(screen.getByTestId('atas-limpar'));
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(rotasDaLista().at(-1)).toBe('/trabalho/atas');
  });

  it('o endereço com a busca abre a tela já filtrada', async () => {
    window.history.replaceState({}, '', '/trabalho/atas?q=diretoria&tipo=ata');
    render(<AtasPage />);
    await screen.findByTestId('atas-lista');
    expect(rotasDaLista()[0]).toBe('/trabalho/atas?q=diretoria&tipo=ata');
    expect(screen.getByTestId('atas-busca')).toHaveValue('diretoria');
    expect(screen.getByTestId('atas-tipo')).toHaveValue('ata');
  });
});

describe('Atas: as duas colunas', () => {
  it('no desktop a tela não rola: a lista tem rolagem própria e a altura vem da janela', async () => {
    render(<AtasPage />);
    await screen.findByTestId('atas-lista');
    const tela = screen.getByTestId('atas-tela');
    expect(tela.style.overflow).toBe('hidden');
    expect(tela.style.height).toMatch(/^\d+px$/);
    const coluna = screen.getByTestId('atas-coluna-lista');
    expect(coluna.className).toContain('overflow-y-auto');
    expect(coluna.className).toContain('h-full');
    // O detalhe rola por si, ao lado da lista.
    expect(screen.getByTestId('atas-coluna-detalhe').className).toContain('overflow-y-auto');
    expect(screen.queryByTestId('atas-voltar')).toBeNull();
  });

  it('no celular, a lista e o detalhe são telas separadas, com Voltar', async () => {
    larguraDaJanela(390);
    render(<AtasPage />);
    await screen.findByTestId('atas-lista');
    expect(screen.queryByTestId('atas-coluna-detalhe')).toBeNull();
    expect(screen.getByTestId('atas-tela').style.overflow).toBe('');
    fireEvent.click(screen.getByTestId('ata-vault:n1'));
    expect(await screen.findByRole('article', { name: 'A ata inteira' })).toHaveTextContent('Texto da ata.');
    expect(screen.queryByTestId('atas-coluna-lista')).toBeNull();
    expect(new URLSearchParams(window.location.search).get('ata')).toBe('vault:n1');
    fireEvent.click(screen.getByTestId('atas-voltar'));
    expect(await screen.findByTestId('atas-coluna-lista')).toBeInTheDocument();
    expect(screen.queryByTestId('atas-coluna-detalhe')).toBeNull();
    expect(new URLSearchParams(window.location.search).get('ata')).toBeNull();
  });
});

describe('Atas: o Google Drive', () => {
  it('a pasta se escolhe colando o link, e a lista recarrega', async () => {
    put.mockResolvedValueOnce({ configurada: true, pastaId: '1NovaPasta000000000', permitido: true, motivo: null, link: 'https://drive.google.com/drive/folders/1NovaPasta000000000' });
    render(<AtasPage />);
    await screen.findByTestId('atas-lista');
    fireEvent.click(screen.getByTestId('ata-pasta-do-drive'));
    fireEvent.change(screen.getByTestId('ata-pasta-campo'), { target: { value: 'https://drive.google.com/drive/folders/1NovaPasta000000000?usp=sharing' } });
    const antes = rotasDaLista().length;
    fireEvent.click(screen.getByTestId('ata-pasta-salvar'));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/trabalho/atas/drive', { pasta: 'https://drive.google.com/drive/folders/1NovaPasta000000000?usp=sharing' }, 'tok'));
    await waitFor(() => expect(rotasDaLista().length).toBeGreaterThan(antes));
  });

  it('sem drive.ver, o botão da pasta não aparece', async () => {
    permissions = ['tarefas.ver', 'tarefas.editar', 'obsidian.ver', 'obsidian.editar'];
    render(<AtasPage />);
    await screen.findByTestId('atas-lista');
    expect(screen.queryByTestId('ata-pasta-do-drive')).toBeNull();
  });

  it('a transcrição do Drive abre inteira, gera ata pela rota do Drive e abre no Drive', async () => {
    post.mockResolvedValueOnce({
      ata: detalhe(item('memoria:gerada', 'drive', 'ata', 'Transcrição kickoff', '2026-10-20', { transcricaoRef: `drive:${ARQ_TRANS}` }), '# Kickoff\n\n## Resumo\n\nResumo.'),
      nova: true, versao: 1, criadas: [], repetidas: 0, avisos: [], cliente: null, ficha: 'nao_se_aplica',
    });
    render(<AtasPage />);
    // A mais nova abre sozinha no desktop: é a transcrição do Drive.
    expect(await screen.findByTestId('transcricao-texto')).toHaveTextContent('Fala da Transcrição kickoff');
    expect(screen.getByTestId('ata-abrir-fonte')).toHaveAttribute('href', `https://docs.google.com/document/d/${ARQ_TRANS}`);
    fireEvent.click(screen.getByTestId(`transcricao-gerar-drive:${ARQ_TRANS}`));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/trabalho/atas/drive/${ARQ_TRANS}/ata`, {}, 'tok'));
    expect(await screen.findByText('A transcrição veio do Drive: ela não vai à ficha do cliente.')).toBeInTheDocument();
    expect(await screen.findByTestId('ata-abrir-transcricao')).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('ata')).toBe('memoria:gerada');
  });
});
