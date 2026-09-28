import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * A NEWSLETTER DO EPISÓDIO — MC13, o lado da tela.
 *
 * No detalhe do episódio: gerar da transcrição, ver a checagem anti-slop
 * (aprovada ou apontada) e quanto saiu da fala, copiar/baixar em markdown e
 * HTML, informar o link do vídeo — e o aviso de que o envio é manual (D-MC7).
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
import { SecaoNewsletter } from '@/app/pauta/SecaoNewsletter';

const MARKDOWN = '# Semana 39\n\nHoje são quatro notícias.\n\n## O preço caiu\n\nFonte: [Preço](https://noticia.exemplo/preco)';

function newsletter(over: Record<string, unknown> = {}) {
  return {
    pecaId: 'p1',
    titulo: 'Semana 39',
    status: 'rascunho',
    criadaEm: '2026-09-24T12:00:00.000Z',
    markdown: MARKDOWN,
    checagem: { aprovada: true, apontamentos: [] },
    tentativas: 1,
    frases: { total: 9, ditas: 8 },
    secoes: 4,
    links: 3,
    urlDoVideo: null,
    pendentes: ['Falta o link do vídeo no YouTube: o marcador {{video}} fica até ele ser informado.'],
    transcricaoMudou: false,
    avisos: [],
    ...over,
  };
}

function detalhe(over: Record<string, unknown> = {}) {
  return {
    id: 'e3',
    numero: 3,
    apelido: 'ep-03',
    titulo: 'Semana 39',
    status: 'pacote',
    itens: [],
    transcricao: [{ inicio: 0, fim: 4, texto: 'Bom dia.' }],
    paginaDeLinks: null,
    ...over,
  } as never;
}

function renderSecao(over: { detalhe?: never; editavel?: boolean; podeGastarIa?: boolean } = {}) {
  const onErro = vi.fn();
  render(
    <SecaoNewsletter
      token="tok"
      detalhe={over.detalhe ?? detalhe()}
      editavel={over.editavel ?? true}
      podeGastarIa={over.podeGastarIa ?? true}
      onErro={onErro}
    />,
  );
  return { onErro };
}

const secao = () => screen.getByRole('region', { name: 'Newsletter' });

let escrito: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  escrito = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (t: string) => void escrito.push(t) },
  });
  apiGet.mockResolvedValue({ newsletter: null });
});

describe('a newsletter do episódio', () => {
  it('sem newsletter explica de onde sai, diz que o envio é manual e gera sem substituir', async () => {
    apiPost.mockResolvedValue({ newsletter: newsletter() });
    renderSecao();
    await waitFor(() => expect(secao()).toHaveTextContent('Sai do que foi dito no vídeo'));
    expect(secao()).toHaveTextContent('O envio é manual por enquanto');
    expect(secao()).toHaveTextContent('D-MC7');
    expect(apiGet).toHaveBeenCalledWith('/pauta/episodios/e3/newsletter', 'tok');

    await userEvent.click(screen.getByRole('button', { name: 'Gerar newsletter' }));
    expect(apiPost).toHaveBeenCalledWith('/pauta/episodios/e3/newsletter/gerar', { substituir: false }, 'tok');
    expect(await screen.findByText('Checagem anti-slop aprovada')).toBeInTheDocument();
    expect(secao()).toHaveTextContent('8 de 9 frases vêm da fala do vídeo');
    expect(secao()).toHaveTextContent('Falta o link do vídeo no YouTube');
    expect(screen.getByLabelText('Texto da newsletter')).toHaveTextContent('Hoje são quatro notícias.');
  });

  it('reprovada, mostra cada apontamento com a regra, o trecho e onde; a refeita e a transcrição mudada avisam', async () => {
    apiGet.mockResolvedValue({
      newsletter: newsletter({
        checagem: {
          aprovada: false,
          apontamentos: [
            { regra: 'emoji', trecho: '🚀', onde: 'título “Semana 39 🚀”' },
            { regra: 'paragrafo_longo', trecho: 'um dois três…', onde: 'parágrafo 2 (80 palavras; o teto é 60)' },
          ],
        },
        tentativas: 2,
        transcricaoMudou: true,
      }),
    });
    renderSecao();
    expect(await screen.findByText('Checagem anti-slop: 2 apontamento(s)')).toBeInTheDocument();
    const lista = screen.getByRole('list', { name: 'Apontamentos da checagem' });
    expect(within(lista).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Emoji: “🚀” — título “Semana 39 🚀”',
      'Parágrafo longo para o celular: “um dois três…” — parágrafo 2 (80 palavras; o teto é 60)',
    ]);
    expect(secao()).toHaveTextContent('refeita uma vez pela checagem');
    expect(secao()).toHaveTextContent('A transcrição mudou depois desta newsletter');
  });

  it('gerar de novo pede confirmação e manda substituir', async () => {
    apiGet.mockResolvedValue({ newsletter: newsletter() });
    apiPost.mockResolvedValue({ newsletter: newsletter({ pecaId: 'p2' }) });
    renderSecao();
    await userEvent.click(await screen.findByRole('button', { name: 'Gerar de novo' }));
    expect(apiPost).not.toHaveBeenCalled();
    expect(secao()).toHaveTextContent('A atual fica como descartada');
    await userEvent.click(screen.getByRole('button', { name: 'Substituir' }));
    expect(apiPost).toHaveBeenCalledWith('/pauta/episodios/e3/newsletter/gerar', { substituir: true }, 'tok');
  });

  it('copia o markdown e o HTML que a API exporta', async () => {
    apiGet.mockResolvedValue({ newsletter: newsletter() });
    apiTexto.mockResolvedValue('<!doctype html><p>oi</p>');
    renderSecao();
    await userEvent.click(await screen.findByRole('button', { name: 'Copiar markdown' }));
    expect(escrito).toEqual([MARKDOWN]);
    expect(screen.getByRole('button', { name: 'Markdown copiado' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Copiar HTML' }));
    expect(apiTexto).toHaveBeenCalledWith('/pauta/episodios/e3/newsletter.html', 'tok');
    expect(escrito[1]).toBe('<!doctype html><p>oi</p>');
    expect(screen.getByRole('button', { name: 'HTML copiado' })).toBeInTheDocument();
  });

  it('com ClipboardItem, o HTML vai para a área de transferência no clique, antes de a API responder (Safari); a falha da API vai para a tela', async () => {
    const itens: Array<Record<string, unknown>> = [];
    class ItemDuble {
      constructor(readonly dados: Record<string, unknown>) {}
    }
    const global = globalThis as { ClipboardItem?: unknown };
    const antes = global.ClipboardItem;
    global.ClipboardItem = ItemDuble;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (t: string) => void escrito.push(t),
        write: async (lista: ItemDuble[]) => {
          itens.push(...lista.map((i) => i.dados));
          await Promise.all(lista.map((i) => i.dados['text/html']));
        },
      },
    });
    try {
      apiGet.mockResolvedValue({ newsletter: newsletter() });
      let responder: (h: string) => void = () => {};
      apiTexto.mockReturnValue(new Promise<string>((r) => (responder = r)));
      const { onErro } = renderSecao();
      await userEvent.click(await screen.findByRole('button', { name: 'Copiar HTML' }));
      expect(itens).toHaveLength(1);
      expect(itens[0]['text/html']).toBeInstanceOf(Promise);
      responder('<!doctype html><p>oi</p>');
      const blob = (await itens[0]['text/html']) as Blob;
      expect(blob.type).toBe('text/html');
      const lido = await new Promise<string>((r) => {
        const leitor = new FileReader();
        leitor.onload = () => r(String(leitor.result));
        leitor.readAsText(blob);
      });
      expect(lido).toBe('<!doctype html><p>oi</p>');
      expect(await screen.findByRole('button', { name: 'HTML copiado' })).toBeInTheDocument();

      apiTexto.mockRejectedValue(new Error('A newsletter não foi achada.'));
      await userEvent.click(screen.getByRole('button', { name: 'HTML copiado' }));
      await waitFor(() => expect(onErro).toHaveBeenCalledWith('A newsletter não foi achada.'));
    } finally {
      global.ClipboardItem = antes;
    }
  });

  it('o link do vídeo: http é recusado na tela, https salva, vazio tira', async () => {
    apiGet.mockResolvedValue({ newsletter: newsletter() });
    apiPut.mockResolvedValue({ newsletter: newsletter({ urlDoVideo: 'https://video.exemplo/v', pendentes: [] }) });
    renderSecao();
    const campo = await screen.findByLabelText('Link do vídeo no YouTube (depois de subir)');
    await userEvent.type(campo, 'http://video.exemplo/v');
    expect(screen.getByRole('button', { name: 'Salvar link' })).toBeDisabled();
    expect(secao()).toHaveTextContent('O link começa com https://');
    await userEvent.clear(campo);
    await userEvent.type(campo, 'https://video.exemplo/v');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar link' }));
    expect(apiPut).toHaveBeenCalledWith('/pauta/episodios/e3/newsletter/video', { urlDoVideo: 'https://video.exemplo/v' }, 'tok');
    await waitFor(() => expect(secao()).not.toHaveTextContent('Falta o link do vídeo'));

    apiPut.mockResolvedValue({ newsletter: newsletter() });
    await userEvent.clear(campo);
    await userEvent.click(screen.getByRole('button', { name: 'Salvar link' }));
    expect(apiPut).toHaveBeenLastCalledWith('/pauta/episodios/e3/newsletter/video', { urlDoVideo: null }, 'tok');
  });

  it('sem automacoes.executar o gerar fica apagado com o porquê', async () => {
    renderSecao({ podeGastarIa: false });
    const gerar = await screen.findByRole('button', { name: 'Gerar newsletter' });
    expect(gerar).toBeDisabled();
    expect(secao()).toHaveTextContent('precisa da permissão automacoes.executar');
  });

  it('sem pauta.editar: gerar, o campo do vídeo e salvar apagados; copiar e baixar seguem', async () => {
    apiGet.mockResolvedValue({ newsletter: newsletter() });
    renderSecao({ editavel: false });
    expect(await screen.findByRole('button', { name: 'Gerar de novo' })).toBeDisabled();
    expect(screen.getByLabelText('Link do vídeo no YouTube (depois de subir)')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Salvar link' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Copiar markdown' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Baixar .html' })).toBeEnabled();
  });

  it('antes do Pacote ou concluído não oferece gerar e diz por quê', async () => {
    renderSecao({ detalhe: detalhe({ status: 'edicao' }) });
    await waitFor(() => expect(secao()).toHaveTextContent('A newsletter sai da transcrição do vídeo final'));
    expect(screen.queryByRole('button', { name: 'Gerar newsletter' })).not.toBeInTheDocument();
  });

  it('o erro da API vai para a tela', async () => {
    apiGet.mockRejectedValue(new Error('fora do ar'));
    const { onErro } = renderSecao();
    await waitFor(() => expect(onErro).toHaveBeenCalledWith('A newsletter não carregou: fora do ar'));
    apiGet.mockResolvedValue({ newsletter: null });
  });
});
