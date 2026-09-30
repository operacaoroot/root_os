import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * A ABA CURADORIA — MC6.
 *
 * O critério de pronto é o que o operador faz: marca pelo painel e só os
 * marcados seguem. Esta suíte cobra a tela desse lado — a lista inteira de
 * candidatos com origem, link e resumo; o destaque do que a IA sugeriu SEM
 * marcar nada por conta própria; o filtro por origem e o contador; e que
 * Salvar e Confirmar mandem exatamente os ids marcados, com Confirmar travado
 * enquanto nada estiver marcado. A regra de negócio mora na API; a tela só
 * desenha e envia.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
    apiPut: (...a: unknown[]) => apiPut(...a),
  };
});

// eslint-disable-next-line import/first
import { AbaCuradoria } from '@/app/pauta/AbaCuradoria';

const RESUMO = (id: string, status = 'aguardando_curadoria') => ({
  id,
  titulo: `Semana ${id}`,
  status,
  rotina: null,
  itens: 4,
  marcados: 0,
  pecas: 0,
  provider: 'falso',
  model: 'falso-1',
  erro: null,
  janelaIni: '2026-09-16T00:00:00.000Z',
  janelaFim: '2026-09-23T00:00:00.000Z',
  criadaEm: '2026-09-23T00:00:00.000Z',
});

const DETALHE = {
  ...RESUMO('r1'),
  corpo: '',
  fichasUsadas: 0,
  pecas: [],
  itens: [
    { id: 'c1', titulo: 'Link do grupo', url: 'https://noticia.exemplo/grupo', origem: 'W', fonte: 'Grupo', resumo: 'mandado pelo Pedro', sugerido: true, porque: 'muda preço para PME', marcado: false },
    { id: 'c2', titulo: 'Achado da busca', url: 'https://busca.exemplo/1', origem: 'N', fonte: 'IA PME', resumo: 'desc da busca', sugerido: false, porque: '', marcado: false },
    { id: 'c3', titulo: 'Matéria do feed', url: 'https://feed.exemplo/1', origem: 'R', fonte: 'InfoMoney', resumo: '', sugerido: true, porque: 'ferramenta nova', marcado: false },
    { id: 'c4', titulo: 'The Batch', url: 'https://mail.google.com/x', origem: 'L', fonte: 'Newsletters', resumo: 'contexto', sugerido: false, porque: '', marcado: false, semLinkPublico: true },
  ],
};

function respostas(opts: { rodadas?: unknown[]; detalhe?: unknown } = {}) {
  apiGet.mockImplementation(async (path: string) => {
    if (path === '/pauta/fontes') return {
      items: [
        { id: 'rss-a', nome: 'Feed A', tipo: 'rss', ativo: true, url: 'https://a.exemplo/rss' },
        { id: 'rss-b', nome: 'Feed B', tipo: 'rss', ativo: true, url: 'https://b.exemplo/rss' },
        { id: 'rss-pausado', nome: 'Pausado', tipo: 'rss', ativo: false, url: 'https://p.exemplo/rss' },
        { id: 'busca', nome: 'Busca', tipo: 'busca', ativo: true, url: null },
      ],
    };
    if (path.startsWith('/pauta/rodadas?')) {
      return { items: opts.rodadas ?? [RESUMO('r1'), RESUMO('velha', 'curada')], source: { tool: 't', generatedAt: '' } };
    }
    if (path === '/pauta/rodadas/r1') return structuredClone(opts.detalhe ?? DETALHE);
    throw new Error(`GET inesperado: ${path}`);
  });
}

function renderAba(over: Partial<{ editavel: boolean; inicial: string }> = {}) {
  const onErro = vi.fn();
  const onMudou = vi.fn();
  render(
    <AbaCuradoria
      token="tok"
      editavel={over.editavel ?? true}
      onErro={onErro}
      bump={0}
      onMudou={onMudou}
      inicial={over.inicial}
    />,
  );
  return { onErro, onMudou };
}

function adiado<T>() {
  let resolver!: (v: T) => void;
  const promessa = new Promise<T>((r) => {
    resolver = r;
  });
  return { promessa, resolver };
}

const DETALHE_R2 = {
  ...RESUMO('r2'),
  corpo: '',
  fichasUsadas: 0,
  pecas: [],
  itens: [
    { id: 'c1', titulo: 'Só na segunda', url: 'https://outra.exemplo/1', origem: 'N', fonte: 'IA PME', resumo: '', sugerido: false, porque: '', marcado: false },
  ],
};

const caixa = (titulo: string) => screen.getByRole('checkbox', { name: `Marcar: ${titulo}` }) as HTMLInputElement;
const item = (titulo: string) => caixa(titulo).closest('li') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  respostas();
  apiPost.mockResolvedValue({ ok: true, status: 'curada', itens: 1 });
  apiPut.mockResolvedValue({ ok: true, marcados: 1, candidatos: 4 });
});

describe('a lista de candidatos', () => {
  it('mostra todos os candidatos com origem, link e resumo, e nada vem marcado', async () => {
    renderAba();
    await waitFor(() => expect(caixa('Link do grupo')).toBeInTheDocument());

    expect(screen.getAllByRole('checkbox', { name: /^Marcar:/ })).toHaveLength(4);
    expect(screen.getAllByRole('checkbox', { name: /^Marcar:/ }).every((c) => !(c as HTMLInputElement).checked)).toBe(true);

    const busca = item('Achado da busca');
    expect(within(busca).getByLabelText('Origem: Busca/notícia')).toHaveTextContent('N');
    expect(within(busca).getByRole('link', { name: /Achado da busca/ })).toHaveAttribute('href', 'https://busca.exemplo/1');
    expect(within(busca).getByText('desc da busca')).toBeInTheDocument();
    expect(screen.getByText(/0/, { selector: 'strong' }).parentElement).toHaveTextContent('0 de 4 marcado(s)');
  });

  it('o sugerido pela IA tem destaque e o porquê, mas só a newsletter diz que é só contexto', async () => {
    renderAba();
    await waitFor(() => expect(caixa('Link do grupo')).toBeInTheDocument());

    const sugerido = item('Link do grupo');
    expect(within(sugerido).getByText('sugerido')).toBeInTheDocument();
    expect(within(sugerido).getByText('IA: muda preço para PME')).toBeInTheDocument();
    expect(sugerido.className).toMatch(/border-brand/);
    expect(within(item('Achado da busca')).queryByText('sugerido')).not.toBeInTheDocument();
    expect(within(item('The Batch')).getByText('só contexto')).toBeInTheDocument();
  });

  it('o filtro por origem mostra só aquela origem; "só sugeridos" corta o resto', async () => {
    const user = userEvent.setup();
    renderAba();
    await waitFor(() => expect(caixa('Link do grupo')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /^R · Feed RSS \(1\)/ }));
    expect(screen.getAllByRole('checkbox', { name: /^Marcar:/ })).toHaveLength(1);
    expect(caixa('Matéria do feed')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Todas \(4\)/ }));
    await user.click(screen.getByRole('checkbox', { name: 'só sugeridos' }));
    expect(screen.getAllByRole('checkbox', { name: /^Marcar:/ }).map((c) => c.getAttribute('aria-label'))).toEqual([
      'Marcar: Link do grupo',
      'Marcar: Matéria do feed',
    ]);
  });

  it('a matéria que veio do grupo e do feed conta e aparece no filtro das duas origens', async () => {
    const user = userEvent.setup();
    respostas({
      detalhe: { ...DETALHE, itens: DETALHE.itens.map((i) => (i.id === 'c1' ? { ...i, origens: ['W', 'R'] } : i)) },
    });
    renderAba();
    await waitFor(() => expect(caixa('Link do grupo')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /^R · Feed RSS \(2\)/ }));
    expect(screen.getAllByRole('checkbox', { name: /^Marcar:/ }).map((c) => c.getAttribute('aria-label'))).toEqual([
      'Marcar: Link do grupo',
      'Marcar: Matéria do feed',
    ]);
  });
});

describe('qual rodada está na tela', () => {
  it('abre na rodada que a aba Rodadas mandou, não na mais recente', async () => {
    respostas({ rodadas: [RESUMO('r1'), RESUMO('r2')] });
    const orig = apiGet.getMockImplementation()!;
    apiGet.mockImplementation(async (path: string) => (path === '/pauta/rodadas/r2' ? structuredClone(DETALHE_R2) : orig(path)));
    renderAba({ inicial: 'r2' });
    await waitFor(() => expect(caixa('Só na segunda')).toBeInTheDocument());
    expect(apiGet).not.toHaveBeenCalledWith('/pauta/rodadas/r1', 'tok');
  });

  it('a resposta atrasada da rodada anterior é descartada ao trocar de rodada', async () => {
    const user = userEvent.setup();
    const r1 = adiado<unknown>();
    apiGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/pauta/rodadas?')) return { items: [RESUMO('r1'), RESUMO('r2')], source: { tool: 't', generatedAt: '' } };
      if (path === '/pauta/rodadas/r1') return r1.promessa;
      if (path === '/pauta/rodadas/r2') return structuredClone(DETALHE_R2);
      throw new Error(`GET inesperado: ${path}`);
    });
    renderAba();
    const seletor = await screen.findByRole('combobox', { name: 'Rodada aguardando curadoria' });
    await user.selectOptions(seletor, 'r2');
    await waitFor(() => expect(caixa('Só na segunda')).toBeInTheDocument());

    r1.resolver(structuredClone(DETALHE));
    await new Promise((r) => setTimeout(r, 0));
    expect(caixa('Só na segunda')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Marcar: Link do grupo' })).not.toBeInTheDocument();
  });
});

describe('marcar, salvar e confirmar', () => {
  it('Confirmar fica travado sem nenhum marcado', async () => {
    renderAba();
    await waitFor(() => expect(caixa('Link do grupo')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Confirmar (0)' })).toBeDisabled();
  });

  it('só os marcados vão na confirmação, e a tela avisa que a rodada seguiu', async () => {
    const user = userEvent.setup();
    const { onMudou } = renderAba();
    await waitFor(() => expect(caixa('Link do grupo')).toBeInTheDocument());

    await user.click(caixa('Achado da busca'));
    await user.click(caixa('The Batch'));
    await user.click(caixa('The Batch'));
    expect(screen.getByText('não salvo')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirmar (1)' }));
    expect(apiPost).toHaveBeenCalledWith('/pauta/rodadas/r1/curadoria/confirmar', { marcados: ['c2'] }, 'tok');
    expect(onMudou).toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent('Curadoria confirmada: 1 matéria segue. Próximo passo: criar o episódio.');
  });

  it('"Marcar sugeridos" marca só os sugeridos, e Salvar grava a marcação sem confirmar', async () => {
    const user = userEvent.setup();
    renderAba();
    await waitFor(() => expect(caixa('Link do grupo')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Marcar sugeridos' }));
    expect(caixa('Link do grupo').checked).toBe(true);
    expect(caixa('Matéria do feed').checked).toBe(true);
    expect(caixa('Achado da busca').checked).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(apiPut).toHaveBeenCalledWith('/pauta/rodadas/r1/curadoria', { marcados: ['c1', 'c3'] }, 'tok');
    expect(apiPost).not.toHaveBeenCalled();
    expect(screen.queryByText('não salvo')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
  });

  it('a marcação salva antes volta marcada quando a aba abre', async () => {
    respostas({
      detalhe: { ...DETALHE, itens: DETALHE.itens.map((i) => (i.id === 'c2' ? { ...i, marcado: true } : i)) },
    });
    renderAba();
    await waitFor(() => expect(caixa('Achado da busca').checked).toBe(true));
    expect(screen.getByRole('button', { name: 'Confirmar (1)' })).toBeEnabled();
    expect(screen.queryByText('não salvo')).not.toBeInTheDocument();
  });

  it('enquanto o Salvar não volta, Confirmar fica travado: uma escrita de cada vez', async () => {
    const user = userEvent.setup();
    const put = adiado<unknown>();
    apiPut.mockReturnValueOnce(put.promessa);
    renderAba();
    await waitFor(() => expect(caixa('Link do grupo')).toBeInTheDocument());

    await user.click(caixa('Link do grupo'));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(screen.getByRole('button', { name: 'Salvando…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirmar (1)' })).toBeDisabled();

    put.resolver({ ok: true, marcados: 1, candidatos: 4 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar (1)' })).toBeEnabled());
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('o erro da API chega à caixa de erro da página', async () => {
    const user = userEvent.setup();
    apiPost.mockRejectedValueOnce(new Error('Esta curadoria já foi confirmada.'));
    const { onErro } = renderAba();
    await waitFor(() => expect(caixa('Link do grupo')).toBeInTheDocument());
    await user.click(caixa('Link do grupo'));
    await user.click(screen.getByRole('button', { name: 'Confirmar (1)' }));
    await waitFor(() => expect(onErro).toHaveBeenLastCalledWith('Esta curadoria já foi confirmada.'));
  });
});

describe('sem rodada aguardando e sem permissão', () => {
  it('sem rodada aguardando, explica e monta a lista da semana pela API', async () => {
    const user = userEvent.setup();
    respostas({ rodadas: [RESUMO('velha', 'curada')] });
    apiPost.mockResolvedValueOnce({ id: 'nova' });
    const { onMudou } = renderAba();

    expect(await screen.findByText(/Nenhuma rodada aguardando curadoria/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Montar lista para curadoria' }));
    expect(apiPost).toHaveBeenCalledWith('/pauta/rodadas/curadoria', { horas: 168 }, 'tok');
    expect(onMudou).toHaveBeenCalled();
  });

  it('sem pauta.editar, dá para ler a lista mas não marcar nem confirmar', async () => {
    renderAba({ editavel: false });
    await waitFor(() => expect(caixa('Link do grupo')).toBeInTheDocument());
    expect(caixa('Link do grupo')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Marcar sugeridos' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Montar lista para curadoria' })).toBeDisabled();
  });
});

describe('P05a: escolha explícita de RSS na curadoria', () => {
  it('usa a mesma seleção na coleta e na lista, sem incluir feed pausado nem outra origem', async () => {
    const user = userEvent.setup();
    respostas({ rodadas: [] });
    apiPost.mockImplementation(async (path: string) => path === '/pauta/feeds/coletar'
      ? { novas: 1, fontes: 1, erros: 0, repetidas: 1, colisoes: 1, fonteIds: ['rss-b'] }
      : { id: 'nova', fontesSelecionadas: [{ id: 'rss-b', nome: 'Feed B' }] });
    renderAba();

    await user.click(screen.getByRole('radio', { name: 'Feeds RSS escolhidos' }));
    expect(await screen.findByRole('checkbox', { name: 'Feed B' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Pausado' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Feed B' }));
    expect(screen.getByText('Seleção efetiva: Feed B.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Montar lista para curadoria' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Coletar feeds escolhidos' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/pauta/feeds/coletar', { fonteIds: ['rss-b'] }, 'tok'));
    expect(await screen.findByText(/1 URL repetida; 1 colisão com outra fonte/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Montar lista para curadoria' })).toBeEnabled();

    await user.click(screen.getByRole('checkbox', { name: 'Feed A' }));
    expect(screen.getByRole('button', { name: 'Montar lista para curadoria' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Feed A' }));
    expect(screen.getByRole('button', { name: 'Montar lista para curadoria' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Montar lista para curadoria' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/pauta/rodadas/curadoria', { horas: 168, fonteIds: ['rss-b'] }, 'tok'));
    expect(await screen.findByText(/Lista montada com Feed B/)).toBeInTheDocument();
  });
});
