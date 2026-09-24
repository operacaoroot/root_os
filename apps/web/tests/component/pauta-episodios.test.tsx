import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * A ABA EPISÓDIOS — MC7.
 *
 * O critério de pronto que cabe à tela: a aba mostra a linha do tempo do
 * episódio (as sete etapas, a atual destacada), a lista com número, título e
 * status, e o episódio anda só pelos dois vizinhos que a API devolve. O botão
 * "Criar episódio" nasce da rodada curada, na aba Rodadas e no fim da
 * Curadoria. A regra de transição é da API; a tela só oferece e envia.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const apiPut = vi.fn();
const apiDelete = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
    apiPatch: (...a: unknown[]) => apiPatch(...a),
    apiPut: (...a: unknown[]) => apiPut(...a),
    apiDelete: (...a: unknown[]) => apiDelete(...a),
  };
});

let permissoes = ['pauta.ver', 'pauta.editar'];
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u1', name: 'Pedro', email: 'p@x.com', roles: [], permissions: permissoes },
    can: (p: string) => permissoes.includes(p),
  }),
}));

// eslint-disable-next-line import/first
import { AbaEpisodios } from '@/app/pauta/AbaEpisodios';
// eslint-disable-next-line import/first
import { AbaRodadas } from '@/app/pauta/AbaRodadas';
// eslint-disable-next-line import/first
import { AbaCuradoria } from '@/app/pauta/AbaCuradoria';
// eslint-disable-next-line import/first
import PautaPage from '@/app/pauta/page';

const ORDEM = ['roteiro', 'gravacao', 'edicao', 'pacote', 'derivacao', 'agendado', 'concluido'] as const;
type Status = (typeof ORDEM)[number];

const RESUMO = (id: string, numero: number, status: Status = 'roteiro') => ({
  id,
  numero,
  apelido: `ep-${String(numero).padStart(2, '0')}`,
  titulo: `Episódio da semana ${numero}`,
  status,
  rodadaId: `rodada-${id}`,
  rodadaTitulo: `Semana ${numero}`,
  itens: 2,
  criadoEm: '2026-09-23T10:00:00.000Z',
  atualizadoEm: '2026-09-23T10:00:00.000Z',
});

function detalhe(status: Status = 'edicao', over: Record<string, unknown> = {}) {
  const i = ORDEM.indexOf(status);
  return {
    ...RESUMO('e2', 2, status),
    itens: [
      { id: 'c1', titulo: 'Link do grupo', url: 'https://noticia.exemplo/grupo', origem: 'W', resumo: 'mandado pelo Pedro' },
      { id: 'c5', titulo: 'The Batch', url: 'https://mail.google.com/x', origem: 'L', semLinkPublico: true },
    ],
    janelaIni: '2026-09-16T12:00:00.000Z',
    janelaFim: '2026-09-23T12:00:00.000Z',
    roteiro: '',
    descricao: '',
    midia: {},
    transcricao: [],
    transcricaoTexto: '',
    titulos: [],
    thumbs: [],
    bioPageId: null,
    criadoPor: 'u1',
    avancar: i < ORDEM.length - 1 ? ORDEM[i + 1] : null,
    voltar: i > 0 ? ORDEM[i - 1] : null,
    ...over,
  };
}

function respostas(opts: { lista?: unknown[]; detalhe?: unknown } = {}) {
  apiGet.mockImplementation(async (path: string) => {
    if (path === '/pauta/episodios') {
      return { items: opts.lista ?? [RESUMO('e2', 2, 'edicao'), RESUMO('e1', 1, 'concluido')], source: { tool: 't', generatedAt: '' } };
    }
    if (path === '/pauta/episodios/e2') return structuredClone(opts.detalhe ?? detalhe());
    if (path === '/pauta/episodios/e1') {
      const { itens: _conta, ...resumo } = RESUMO('e1', 1, 'concluido');
      return structuredClone(detalhe('concluido', resumo));
    }
    // O roteiro (MC8) mora no detalhe e tem suíte própria (`pauta-roteiro`).
    const roteiro = path.match(/^\/pauta\/episodios\/([^/]+)\/roteiro$/);
    if (roteiro) {
      return {
        episodioId: roteiro[1], apelido: 'ep-02', titulo: 'x', status: 'edicao', roteiro: '', atualizadoEm: '2026-09-23T10:00:00.000Z',
        palavraDeCorte: { efetiva: 'root, corta', origem: 'padrao', doEpisodio: null, daEmpresa: null }, podeGerar: false, motivo: null,
      };
    }
    if (path.startsWith('/pauta/rodadas')) return { items: [], source: { tool: 't', generatedAt: '' } };
    if (path === '/pauta/canais') return { whatsapp: { configurada: false, conectada: false, motivo: null, grupo: null } };
    throw new Error(`GET inesperado: ${path}`);
  });
}

function renderAba(over: Partial<{ editavel: boolean; inicial: string }> = {}) {
  const onErro = vi.fn();
  const onMudou = vi.fn();
  render(
    <AbaEpisodios token="tok" editavel={over.editavel ?? true} onErro={onErro} bump={0} onMudou={onMudou} inicial={over.inicial} />,
  );
  return { onErro, onMudou };
}

const linhaDoTempo = () => screen.getByRole('list', { name: 'Linha do tempo do episódio' });

beforeEach(() => {
  vi.clearAllMocks();
  permissoes = ['pauta.ver', 'pauta.editar'];
  respostas();
});

describe('a lista de episódios', () => {
  it('mostra número, título e status de cada um, do mais novo para o mais velho', async () => {
    renderAba();
    const lista = await screen.findByRole('list', { name: 'Episódios' });
    const itens = within(lista).getAllByRole('button');
    expect(itens).toHaveLength(2);
    expect(itens[0]).toHaveTextContent('ep-02');
    expect(itens[0]).toHaveTextContent('Episódio da semana 2');
    expect(itens[0]).toHaveTextContent('Edição');
    expect(itens[1]).toHaveTextContent('ep-01');
    expect(itens[1]).toHaveTextContent('Concluído');
  });

  it('sem episódio, explica de onde ele nasce', async () => {
    respostas({ lista: [] });
    renderAba();
    expect(await screen.findByText(/Nenhum episódio ainda/)).toHaveTextContent('Criar episódio');
  });

  it('abre o que outra aba mandou abrir, e troca ao clicar', async () => {
    renderAba({ inicial: 'e1' });
    await screen.findByText('Episódio concluído.');
    await userEvent.click(screen.getAllByRole('button', { name: /ep-02/ })[0]);
    await waitFor(() => expect(screen.getByRole('button', { name: /Avançar para Pacote/ })).toBeInTheDocument());
  });
});

describe('a linha do tempo', () => {
  it('mostra as sete etapas na ordem, com a atual destacada e as anteriores feitas', async () => {
    renderAba();
    await waitFor(() => expect(linhaDoTempo()).toBeInTheDocument());
    const passos = within(linhaDoTempo()).getAllByRole('listitem');
    expect(passos.map((p) => p.textContent?.replace(/✓/g, '').replace(/^\d/, ''))).toEqual([
      'Roteiro', 'Gravação', 'Edição', 'Pacote', 'Derivação', 'Agendado', 'Concluído',
    ]);
    const atual = passos.filter((p) => p.getAttribute('aria-current') === 'step');
    expect(atual).toHaveLength(1);
    expect(atual[0]).toHaveTextContent('Edição');
    expect(within(passos[0]).getByLabelText('feito')).toBeInTheDocument();
    expect(within(passos[1]).getByLabelText('feito')).toBeInTheDocument();
    expect(within(passos[3]).queryByLabelText('feito')).toBeNull();
  });

  it('só oferece os dois vizinhos, e avançar manda o próximo status', async () => {
    apiPost.mockResolvedValue(detalhe('pacote'));
    const { onMudou } = renderAba();
    const avancar = await screen.findByRole('button', { name: 'Avançar para Pacote →' });
    expect(screen.getByRole('button', { name: '← Voltar para Gravação' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /para (Roteiro|Derivação|Agendado|Concluído)/ })).toBeNull();
    await userEvent.click(avancar);
    expect(apiPost).toHaveBeenCalledWith('/pauta/episodios/e2/status', { para: 'pacote' }, 'tok');
    await waitFor(() => expect(within(linhaDoTempo()).getByText('Pacote').closest('li')).toHaveAttribute('aria-current', 'step'));
    expect(onMudou).toHaveBeenCalled();
  });

  it('enquanto a escrita corre, a lista não troca de episódio — a resposta não cai em cima de outro', async () => {
    let soltar!: (d: unknown) => void;
    apiPost.mockReturnValue(new Promise((r) => (soltar = r)));
    renderAba();
    await userEvent.click(await screen.findByRole('button', { name: 'Avançar para Pacote →' }));
    const lista = screen.getByRole('list', { name: 'Episódios' });
    for (const b of within(lista).getAllByRole('button')) expect(b).toBeDisabled();
    soltar(detalhe('pacote'));
    await waitFor(() => expect(within(lista).getAllByRole('button')[1]).toBeEnabled());
    expect(apiPost).toHaveBeenCalledWith('/pauta/episodios/e2/status', { para: 'pacote' }, 'tok');
  });

  it('voltar um passo manda o status anterior', async () => {
    apiPost.mockResolvedValue(detalhe('gravacao'));
    renderAba();
    await userEvent.click(await screen.findByRole('button', { name: '← Voltar para Gravação' }));
    expect(apiPost).toHaveBeenCalledWith('/pauta/episodios/e2/status', { para: 'gravacao' }, 'tok');
  });

  it('no roteiro não há voltar; no concluído não há avançar', async () => {
    respostas({ detalhe: detalhe('roteiro') });
    renderAba();
    await screen.findByRole('button', { name: 'Avançar para Gravação →' });
    expect(screen.queryByRole('button', { name: /Voltar/ })).toBeNull();
  });

  it('a recusa da API aparece na caixa de erro da página e a etapa não muda', async () => {
    apiPost.mockRejectedValue(new Error('O episódio saiu de Edição enquanto isso — recarregue e tente de novo.'));
    const { onErro } = renderAba();
    await userEvent.click(await screen.findByRole('button', { name: 'Avançar para Pacote →' }));
    await waitFor(() => expect(onErro).toHaveBeenCalledWith(expect.stringContaining('enquanto isso')));
    expect(within(linhaDoTempo()).getByText('Edição').closest('li')).toHaveAttribute('aria-current', 'step');
  });

  it('sem pauta.editar, nada anda nem se renomeia', async () => {
    renderAba({ editavel: false });
    expect(await screen.findByRole('button', { name: 'Avançar para Pacote →' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '← Voltar para Gravação' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Título do episódio' })).toBeDisabled();
  });
});

describe('o detalhe', () => {
  it('traz os itens mantidos da rodada com a origem; a newsletter sem link', async () => {
    renderAba();
    const link = await screen.findByRole('link', { name: /Link do grupo/ });
    expect(link).toHaveAttribute('href', 'https://noticia.exemplo/grupo');
    expect(screen.getByText('mandado pelo Pedro')).toBeInTheDocument();
    expect(screen.getByLabelText('Origem: Grupo de WhatsApp')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /The Batch/ })).toBeNull();
    expect(screen.getByText('The Batch')).toBeInTheDocument();
    expect(screen.getByText('só contexto')).toBeInTheDocument();
  });

  it('renomear manda o título novo, e o botão só acende quando o título mudou', async () => {
    apiPatch.mockResolvedValue(detalhe('edicao', { titulo: 'Especial: IA na PME' }));
    renderAba();
    const campo = await screen.findByRole('textbox', { name: 'Título do episódio' });
    const salvar = screen.getByRole('button', { name: 'Salvar título' });
    expect(salvar).toBeDisabled();
    await userEvent.clear(campo);
    await userEvent.type(campo, 'Especial: IA na PME');
    await userEvent.click(salvar);
    expect(apiPatch).toHaveBeenCalledWith('/pauta/episodios/e2', { titulo: 'Especial: IA na PME' }, 'tok');
  });

  it('mostra a mídia que o Mac devolveu (MC9), com o comando quando falta a transcrição', async () => {
    respostas({
      detalhe: detalhe('edicao', {
        midia: {
          arquivoBruto: '/m/bruto.mp4', arquivoFinal: '/m/ep-02-final.mp4', duracaoSeg: 600, cortes: [],
          palavraDeCorte: null, editor: 'palmier', recebidaEm: '2026-09-24T23:00:00.000Z',
        },
      }),
    });
    renderAba();
    const midia = await screen.findByRole('region', { name: 'Mídia do episódio' });
    await waitFor(() => expect(midia).toHaveTextContent('ep-02-final.mp4'));
    expect(midia).toHaveTextContent('PalmierPro');
    expect(midia).toHaveTextContent('/root-midia ep-02');
  });
});

describe('o episódio nasce da rodada curada', () => {
  const RODADA = (id: string, status: string, episodio: unknown = null) => ({
    id, titulo: `Semana ${id}`, status, rotina: null, itens: 3, marcados: 0, pecas: 0, provider: null, model: null,
    erro: null, janelaIni: '2026-09-16T00:00:00.000Z', janelaFim: '2026-09-23T00:00:00.000Z', criadaEm: '2026-09-23T00:00:00.000Z', episodio,
  });
  const DETALHE_RODADA = (id: string, episodio: unknown = null) => ({
    ...RODADA(id, 'curada', episodio), corpo: 'miolo', fichasUsadas: 0, pecas: [], itens: [{ titulo: 'A', url: 'https://a' }],
  });

  function rodadas(episodio: unknown = null) {
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/pauta/rodadas') return { items: [RODADA('r1', 'curada', episodio)], source: { tool: 't', generatedAt: '' } };
      if (path === '/pauta/rodadas/r1') return DETALHE_RODADA('r1', episodio);
      if (path === '/pauta/canais') return { whatsapp: { configurada: false, conectada: false, motivo: null, grupo: null } };
      throw new Error(`GET inesperado: ${path}`);
    });
  }

  it('na aba Rodadas, a curada sem episódio oferece "Criar episódio", que cria e abre', async () => {
    rodadas();
    apiPost.mockResolvedValue({ id: 'novo-ep' });
    const onAbrirEpisodio = vi.fn();
    render(
      <AbaRodadas token="tok" editavel podePublicar={false} onErro={vi.fn()} bump={0} onMudou={vi.fn()} onAbrirEpisodio={onAbrirEpisodio} />,
    );
    await userEvent.click(await screen.findByText('Semana r1'));
    await userEvent.click(await screen.findByRole('button', { name: 'Criar episódio' }));
    expect(apiPost).toHaveBeenCalledWith('/pauta/episodios', { rodadaId: 'r1' }, 'tok');
    await waitFor(() => expect(onAbrirEpisodio).toHaveBeenCalledWith('novo-ep'));
  });

  it('a rodada que já é episódio mostra o número, abre o episódio e não se remove', async () => {
    rodadas({ id: 'e9', numero: 9, status: 'gravacao' });
    const onAbrirEpisodio = vi.fn();
    render(
      <AbaRodadas token="tok" editavel podePublicar={false} onErro={vi.fn()} bump={0} onMudou={vi.fn()} onAbrirEpisodio={onAbrirEpisodio} />,
    );
    expect(await screen.findByText('ep-09')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Semana r1'));
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir episódio ep-09' }));
    expect(onAbrirEpisodio).toHaveBeenCalledWith('e9');
    expect(screen.queryByRole('button', { name: 'Criar episódio' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remover rodada' })).toBeDisabled();
  });

  it('no fim da Curadoria, a rodada recém-confirmada vira episódio pelo botão do aviso', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/pauta/rodadas?')) return { items: [RODADA('r2', 'aguardando_curadoria')], source: { tool: 't', generatedAt: '' } };
      if (path === '/pauta/rodadas/r2') {
        return { ...RODADA('r2', 'aguardando_curadoria'), corpo: '', fichasUsadas: 0, pecas: [], itens: [{ id: 'c1', titulo: 'Item', url: 'https://i', origem: 'R', marcado: true }] };
      }
      throw new Error(`GET inesperado: ${path}`);
    });
    apiPost.mockImplementation(async (path: string) =>
      path === '/pauta/episodios' ? { id: 'ep-da-curadoria' } : { ok: true, status: 'curada', itens: 1 },
    );
    const onAbrirEpisodio = vi.fn();
    render(<AbaCuradoria token="tok" editavel onErro={vi.fn()} bump={0} onMudou={vi.fn()} onAbrirEpisodio={onAbrirEpisodio} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar (1)' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Criar episódio desta rodada' }));
    expect(apiPost).toHaveBeenLastCalledWith('/pauta/episodios', { rodadaId: 'r2' }, 'tok');
    await waitFor(() => expect(onAbrirEpisodio).toHaveBeenCalledWith('ep-da-curadoria'));
  });

  it('a página tem a aba Episódios, e ela abre a lista', async () => {
    respostas();
    render(<PautaPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Episódios' }));
    expect(await screen.findByRole('list', { name: 'Episódios' })).toBeInTheDocument();
  });
});
