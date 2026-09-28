import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * O ROTEIRO DO EPISÓDIO — MC8.
 *
 * O critério de pronto que cabe à tela: o roteiro sai dos itens mantidos (o
 * botão manda gerar), fica editável (o editor salva com a versão lida),
 * exporta em markdown (pelo GET `.md`, com o token) e abre no modo de gravação
 * (tela limpa, fonte grande, links clicáveis, a palavra de corte à vista). O
 * markdown vira elemento React — nada de innerHTML, e só http(s) é link.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();
const apiTexto = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
    apiPut: (...a: unknown[]) => apiPut(...a),
    apiTexto: (...a: unknown[]) => apiTexto(...a),
  };
});

// eslint-disable-next-line import/first
import { SecaoRoteiro } from '@/app/pauta/SecaoRoteiro';
// eslint-disable-next-line import/first
import { RoteiroMarkdown, blocosDoMarkdown } from '@/app/pauta/roteiro-markdown';

const ROTEIRO = [
  '# ep-03 · Semana 39',
  '',
  '> **Palavra de corte: “root, corta”.** Errou? Diga a palavra.',
  '',
  '## 1. Preço caiu pela metade',
  '',
  'A API ficou mais barata.',
  '',
  '- **Link:** https://noticia.exemplo/preco',
  '- **Na tela:** a página da matéria',
  '',
  '## 2. The Batch',
  '',
  '- **Link:** sem link público — cite The Batch',
].join('\n');

type Status = 'roteiro' | 'gravacao' | 'edicao';

function painel(over: Record<string, unknown> = {}) {
  return {
    episodioId: 'e3',
    apelido: 'ep-03',
    titulo: 'Semana 39',
    status: 'roteiro' as Status,
    roteiro: '',
    atualizadoEm: '2026-09-23T12:00:00.000Z',
    palavraDeCorte: { efetiva: 'root, corta', origem: 'padrao', doEpisodio: null, daEmpresa: null },
    podeGerar: true,
    motivo: null,
    ...over,
  };
}

function renderSecao(over: Partial<{ editavel: boolean; podeGastarIa: boolean; status: Status }> = {}) {
  const onErro = vi.fn();
  const onMudou = vi.fn();
  render(
    <SecaoRoteiro
      token="tok"
      episodioId="e3"
      status={over.status ?? 'roteiro'}
      editavel={over.editavel ?? true}
      podeGastarIa={over.podeGastarIa ?? true}
      bump={0}
      onErro={onErro}
      onMudou={onMudou}
    />,
  );
  return { onErro, onMudou };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockResolvedValue(painel());
});

describe('o markdown do roteiro na tela', () => {
  it('títulos, citação, lista e negrito viram elementos; a URL solta vira link clicável em nova aba', () => {
    render(<RoteiroMarkdown texto={ROTEIRO} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ep-03 · Semana 39');
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['1. Preço caiu pela metade', '2. The Batch']);
    const link = screen.getByRole('link', { name: 'https://noticia.exemplo/preco' });
    expect(link).toHaveAttribute('href', 'https://noticia.exemplo/preco');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByText('Palavra de corte: “root, corta”.').tagName).toBe('STRONG');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('só http(s) é link, sem HTML cru; a pontuação no fim fica fora da URL', () => {
    render(<RoteiroMarkdown texto={'Veja [isto](javascript:alert(1)) e <b>negrito</b> em https://a.exemplo/x.'} />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://a.exemplo/x');
    expect(document.querySelector('b')).toBeNull();
    expect(screen.getByText(/<b>negrito<\/b>/)).toBeInTheDocument();
  });

  it('a URL solta com parênteses equilibrados vai inteira; o parêntese que fecha a frase fica fora', () => {
    render(<RoteiroMarkdown texto={'- **Link:** https://pt.wikipedia.org/wiki/GPT_(modelo)\n\n(veja https://a.exemplo/x)'} />);
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['https://pt.wikipedia.org/wiki/GPT_(modelo)', 'https://a.exemplo/x']);
  });

  it('linhas seguidas são um parágrafo; linha em branco separa', () => {
    const b = blocosDoMarkdown('um\ndois\n\ntrês\n---\n> a\n> b');
    expect(b).toEqual([
      { tipo: 'paragrafo', linhas: ['um', 'dois'] },
      { tipo: 'paragrafo', linhas: ['três'] },
      { tipo: 'regua' },
      { tipo: 'citacao', linhas: ['a', 'b'] },
    ]);
  });
});

describe('gerar o roteiro', () => {
  it('mostra a palavra de corte e gera pela API, avisando a aba que o episódio andou', async () => {
    apiPost.mockResolvedValue(painel({ status: 'gravacao', roteiro: ROTEIRO, espelho: { caminho: 'fichas-os/episodios/ep-03-roteiro.md', erro: null } }));
    const { onMudou } = renderSecao();
    expect(await screen.findByText('“root, corta”')).toBeInTheDocument();
    expect(screen.getByText('(padrão)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Gerar roteiro' }));
    expect(apiPost).toHaveBeenCalledWith('/pauta/episodios/e3/roteiro/gerar', { substituir: false }, 'tok');
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Texto do roteiro' })).toHaveValue(ROTEIRO));
    expect(onMudou).toHaveBeenCalled();
    expect(screen.getByText(/Espelhado no vault em fichas-os\/episodios\/ep-03-roteiro\.md/)).toBeInTheDocument();
  });

  it('com roteiro já escrito, pede a confirmação antes de substituir', async () => {
    apiGet.mockResolvedValue(painel({ status: 'gravacao', roteiro: ROTEIRO }));
    apiPost.mockResolvedValue(painel({ status: 'gravacao', roteiro: `${ROTEIRO}\nnovo` }));
    renderSecao({ status: 'gravacao' });
    await userEvent.click(await screen.findByRole('button', { name: 'Gerar de novo' }));
    expect(apiPost).not.toHaveBeenCalled();
    const dialogo = screen.getByRole('alertdialog', { name: 'Substituir o roteiro' });
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Substituir' }));
    expect(apiPost).toHaveBeenCalledWith('/pauta/episodios/e3/roteiro/gerar', { substituir: true }, 'tok');
  });

  it('depois da gravação, diz por que não gera e não oferece o botão', async () => {
    apiGet.mockResolvedValue(painel({ status: 'edicao', roteiro: ROTEIRO, podeGerar: false, motivo: 'O episódio já passou da gravação (está em Edição).' }));
    renderSecao({ status: 'edicao' });
    expect(await screen.findByText(/já passou da gravação/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Gerar/ })).toBeNull();
  });

  it('sem automacoes.executar o botão fica apagado e diz o motivo', async () => {
    renderSecao({ podeGastarIa: false });
    const gerar = await screen.findByRole('button', { name: 'Gerar roteiro' });
    expect(gerar).toBeDisabled();
    expect(gerar).toHaveAttribute('title', expect.stringContaining('automacoes.executar'));
  });

  it('sem pauta.editar, o editor e a palavra ficam travados', async () => {
    renderSecao({ editavel: false });
    expect(await screen.findByRole('textbox', { name: 'Texto do roteiro' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Palavra de corte deste episódio' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Gerar roteiro' })).toBeDisabled();
  });

  it('a recusa da API vai para a caixa de erro da página', async () => {
    apiPost.mockRejectedValue(new Error('A IA não devolveu um roteiro utilizável (não veio JSON) — nada foi gravado.'));
    const { onErro, onMudou } = renderSecao();
    await userEvent.click(await screen.findByRole('button', { name: 'Gerar roteiro' }));
    await waitFor(() => expect(onErro).toHaveBeenCalledWith(expect.stringContaining('nada foi gravado')));
    expect(onMudou).not.toHaveBeenCalled();
  });
});

describe('editar, exportar e a palavra do episódio', () => {
  it('editar à mão salva com a versão lida; o botão só acende quando o texto mudou', async () => {
    apiGet.mockResolvedValue(painel({ status: 'gravacao', roteiro: 'velho' }));
    apiPut.mockResolvedValue(painel({ status: 'gravacao', roteiro: 'velho e novo', atualizadoEm: '2026-09-23T12:01:00.000Z' }));
    renderSecao({ status: 'gravacao' });
    const editor = await screen.findByRole('textbox', { name: 'Texto do roteiro' });
    const salvar = screen.getByRole('button', { name: 'Salvar roteiro' });
    expect(salvar).toBeDisabled();
    await userEvent.type(editor, ' e novo');
    expect(screen.getByRole('button', { name: 'Gerar de novo' })).toBeDisabled();
    await userEvent.click(salvar);
    expect(apiPut).toHaveBeenCalledWith('/pauta/episodios/e3/roteiro', { roteiro: 'velho e novo', versao: '2026-09-23T12:00:00.000Z' }, 'tok');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar roteiro' })).toBeDisabled());
  });

  it('exportar busca o .md com o token e baixa ep-NN-roteiro.md com o texto da API', async () => {
    const blobs: Blob[] = [];
    const baixados: string[] = [];
    const criar = vi.fn((b: Blob) => {
      blobs.push(b);
      return 'blob:roteiro';
    });
    const revogar = vi.fn();
    Object.assign(URL, { createObjectURL: criar, revokeObjectURL: revogar });
    const clique = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      baixados.push(`${this.download}|${this.getAttribute('href')}`);
    });
    try {
      apiGet.mockResolvedValue(painel({ status: 'gravacao', roteiro: ROTEIRO }));
      apiTexto.mockResolvedValue(`${ROTEIRO}\n`);
      const { onErro } = renderSecao({ status: 'gravacao' });
      await userEvent.click(await screen.findByRole('button', { name: 'Exportar .md' }));
      expect(apiTexto).toHaveBeenCalledWith('/pauta/episodios/e3/roteiro.md', 'tok');
      await waitFor(() => expect(baixados).toEqual(['ep-03-roteiro.md|blob:roteiro']));
      expect(blobs[0].type).toBe('text/markdown;charset=utf-8');
      const lido = await new Promise<string>((ok) => {
        const leitor = new FileReader();
        leitor.onload = () => ok(String(leitor.result));
        leitor.readAsText(blobs[0]);
      });
      expect(lido).toBe(`${ROTEIRO}\n`);
      // A URL fica viva depois do clique: o Safari do iOS lê o blob depois, e revogar na hora quebrava o download.
      expect(revogar).not.toHaveBeenCalled();
      expect(onErro).not.toHaveBeenCalledWith(expect.any(String));
    } finally {
      clique.mockRestore();
      Reflect.deleteProperty(URL, 'createObjectURL');
      Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  });

  it('sem como baixar no navegador, exportar avisa em vez de voltar calado', async () => {
    apiGet.mockResolvedValue(painel({ status: 'gravacao', roteiro: ROTEIRO }));
    apiTexto.mockResolvedValue(`${ROTEIRO}\n`);
    const { onErro } = renderSecao({ status: 'gravacao' });
    await userEvent.click(await screen.findByRole('button', { name: 'Exportar .md' }));
    await waitFor(() => expect(onErro).toHaveBeenCalledWith(expect.stringContaining('não deixou baixar')));
  });

  it('trocar a palavra com o texto editado não apaga a edição, e o salvar segue com a versão nova', async () => {
    apiGet.mockResolvedValue(painel({ status: 'gravacao', roteiro: ROTEIRO }));
    const comOps = ROTEIRO.replace('“root, corta”', '“ops”');
    apiPut.mockResolvedValueOnce(
      painel({
        status: 'gravacao',
        roteiro: comOps,
        atualizadoEm: '2026-09-23T12:02:00.000Z',
        palavraDeCorte: { efetiva: 'ops', origem: 'episodio', doEpisodio: 'ops', daEmpresa: null },
      }),
    );
    renderSecao({ status: 'gravacao' });
    const editor = await screen.findByRole('textbox', { name: 'Texto do roteiro' });
    await userEvent.type(editor, '\nnota à mão');
    await userEvent.type(screen.getByRole('textbox', { name: 'Palavra de corte deste episódio' }), 'ops');
    await userEvent.click(screen.getByRole('button', { name: 'Usar neste episódio' }));
    expect(await screen.findByText('(só deste episódio)')).toBeInTheDocument();
    expect(editor).toHaveValue(`${ROTEIRO}\nnota à mão`);

    apiPut.mockResolvedValueOnce(painel({ status: 'gravacao', roteiro: `${comOps}\nnota à mão`, atualizadoEm: '2026-09-23T12:03:00.000Z' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar roteiro' }));
    expect(apiPut).toHaveBeenLastCalledWith(
      '/pauta/episodios/e3/roteiro',
      { roteiro: `${ROTEIRO}\nnota à mão`, versao: '2026-09-23T12:02:00.000Z' },
      'tok',
    );
  });

  it('a palavra do episódio é enviada aparada, e volta à da empresa com nulo', async () => {
    apiPut.mockResolvedValue(painel({ palavraDeCorte: { efetiva: 'ops', origem: 'episodio', doEpisodio: 'ops', daEmpresa: 'corta, Pedro' } }));
    renderSecao();
    const campo = await screen.findByRole('textbox', { name: 'Palavra de corte deste episódio' });
    await userEvent.type(campo, '  ops ');
    await userEvent.click(screen.getByRole('button', { name: 'Usar neste episódio' }));
    expect(apiPut).toHaveBeenCalledWith('/pauta/episodios/e3/palavra-de-corte', { palavraDeCorte: 'ops' }, 'tok');
    expect(await screen.findByText('(só deste episódio)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Voltar à da empresa' }));
    expect(apiPut).toHaveBeenLastCalledWith('/pauta/episodios/e3/palavra-de-corte', { palavraDeCorte: null }, 'tok');
  });

  it('o espelho que falha não esconde que o roteiro foi salvo', async () => {
    apiGet.mockResolvedValue(painel({ status: 'gravacao', roteiro: 'a' }));
    apiPut.mockResolvedValue(painel({ status: 'gravacao', roteiro: 'ab', espelho: { caminho: null, erro: 'a vault não existe' } }));
    renderSecao({ status: 'gravacao' });
    await userEvent.type(await screen.findByRole('textbox', { name: 'Texto do roteiro' }), 'b');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar roteiro' }));
    expect(await screen.findByText(/O roteiro está salvo, mas o espelho no vault falhou: a vault não existe/)).toBeInTheDocument();
  });
});

describe('a edição e a releitura do painel', () => {
  function montar(status: Status) {
    return (
      <SecaoRoteiro token="tok" episodioId="e3" status={status} editavel podeGastarIa bump={0} onErro={vi.fn()} onMudou={vi.fn()} />
    );
  }

  it('o episódio andou de etapa (mesmo roteiro): a edição fica e o salvar usa a versão nova', async () => {
    apiGet.mockResolvedValue(painel({ status: 'gravacao', roteiro: 'base' }));
    const { rerender } = render(montar('gravacao'));
    const editor = await screen.findByRole('textbox', { name: 'Texto do roteiro' });
    await userEvent.type(editor, ' e mais');
    apiGet.mockResolvedValue(painel({ status: 'edicao', roteiro: 'base', atualizadoEm: '2026-09-23T12:05:00.000Z' }));
    rerender(montar('edicao'));
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar roteiro' })).toBeEnabled());
    expect(editor).toHaveValue('base e mais');
    apiPut.mockResolvedValue(painel({ status: 'edicao', roteiro: 'base e mais' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar roteiro' }));
    expect(apiPut).toHaveBeenCalledWith('/pauta/episodios/e3/roteiro', { roteiro: 'base e mais', versao: '2026-09-23T12:05:00.000Z' }, 'tok');
  });

  it('outra aba mudou o roteiro: avisa, e o salvar leva a versão de onde a edição partiu (a API recusa)', async () => {
    apiGet.mockResolvedValue(painel({ status: 'gravacao', roteiro: 'base' }));
    const { rerender } = render(montar('gravacao'));
    const editor = await screen.findByRole('textbox', { name: 'Texto do roteiro' });
    await userEvent.type(editor, ' minha');
    apiGet.mockResolvedValue(painel({ status: 'edicao', roteiro: 'da outra aba', atualizadoEm: '2026-09-23T12:06:00.000Z' }));
    rerender(montar('edicao'));
    expect(await screen.findByText(/mudou em outra aba enquanto você editava/)).toBeInTheDocument();
    expect(editor).toHaveValue('base minha');
    apiPut.mockRejectedValue(new Error('O roteiro mudou em outra aba enquanto isso — recarregue e tente de novo.'));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar roteiro' }));
    expect(apiPut).toHaveBeenCalledWith('/pauta/episodios/e3/roteiro', { roteiro: 'base minha', versao: '2026-09-23T12:00:00.000Z' }, 'tok');
  });
});

describe('abrir para gravar', () => {
  it('abre a tela limpa com o roteiro em fonte grande, os links clicáveis e a palavra de corte à vista', async () => {
    apiGet.mockResolvedValue(painel({ status: 'gravacao', roteiro: ROTEIRO }));
    renderSecao({ status: 'gravacao' });
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir para gravar' }));
    const tela = screen.getByRole('dialog', { name: 'Gravar ep-03' });
    expect(tela).toHaveClass('fixed', 'inset-0');
    expect(within(tela).getByText('Corta:')).toHaveTextContent('Corta: “root, corta”');
    expect(within(tela).getByRole('link', { name: 'https://noticia.exemplo/preco' })).toHaveAttribute('target', '_blank');
    const artigo = within(tela).getByRole('article');
    expect(artigo).toHaveStyle({ fontSize: '22px' });
    await userEvent.click(within(tela).getByRole('button', { name: 'A+' }));
    expect(artigo).toHaveStyle({ fontSize: '26px' });
  });

  it('Esc e "Fechar" saem do modo de gravação', async () => {
    apiGet.mockResolvedValue(painel({ status: 'gravacao', roteiro: ROTEIRO }));
    renderSecao({ status: 'gravacao' });
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir para gravar' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir para gravar' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sem roteiro não há gravar nem exportar', async () => {
    renderSecao();
    await screen.findByRole('button', { name: 'Gerar roteiro' });
    expect(screen.queryByRole('button', { name: 'Abrir para gravar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Exportar .md' })).toBeNull();
  });
});
