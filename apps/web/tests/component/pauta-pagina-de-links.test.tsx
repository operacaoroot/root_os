import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * A PÁGINA DE LINKS DO EPISÓDIO — MC12, o lado da tela.
 *
 * No detalhe do episódio: criar a página (pauta.editar), ver os botões com a
 * origem de cada um, pôr no ar pelo mesmo caminho do /bio (pauta.publicar +
 * bio.editar) e a trava de remontar uma página no ar sem bio.editar.
 */

const apiPost = vi.fn();
let modulosLigados: string[] | null = null;

vi.mock('@/components/modulos', () => ({
  useModulos: () => ({ modulos: modulosLigados, ligado: (m: string) => modulosLigados === null || modulosLigados.includes(m) }),
}));

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...real, apiPost: (...a: unknown[]) => apiPost(...a) };
});

// eslint-disable-next-line import/first
import { SecaoPaginaDeLinks } from '@/app/pauta/SecaoPaginaDeLinks';

const PAGINA = {
  id: 'pg1',
  handle: 'root-ep-03',
  url: 'https://bio.operacaoroot.com/@root-ep-03',
  titulo: 'Semana 39',
  publicada: false,
  links: [
    { id: 'b1', rotulo: 'Preço do modelo caiu pela metade', destino: 'https://noticia.exemplo/preco', ativo: true, origem: 'item' },
    { id: 'b2', rotulo: 'Assine a newsletter', destino: 'https://root.exemplo/news', ativo: true, origem: 'casa' },
    { id: 'b3', rotulo: 'Matéria que saiu', destino: 'https://noticia.exemplo/saiu', ativo: false, origem: 'item' },
  ],
};

function detalhe(over: Record<string, unknown> = {}) {
  return {
    id: 'e3',
    numero: 3,
    apelido: 'ep-03',
    titulo: 'Semana 39',
    status: 'pacote',
    itens: [],
    descricao: '',
    bioPageId: null,
    paginaDeLinks: null,
    ...over,
  } as never;
}

function renderSecao(over: { detalhe?: never; editavel?: boolean; podeMexerNoAr?: boolean; podePublicar?: boolean } = {}) {
  const onErro = vi.fn();
  const onDetalhe = vi.fn();
  render(
    <SecaoPaginaDeLinks
      token="tok"
      detalhe={over.detalhe ?? detalhe()}
      editavel={over.editavel ?? true}
      podeMexerNoAr={over.podeMexerNoAr ?? true}
      podePublicar={over.podePublicar ?? true}
      onErro={onErro}
      onDetalhe={onDetalhe}
    />,
  );
  return { onErro, onDetalhe };
}

const secao = () => screen.getByRole('region', { name: 'Página de links' });

beforeEach(() => {
  vi.clearAllMocks();
  modulosLigados = null;
});

describe('a página de links do episódio', () => {
  it('sem página: explica o que entra e cria com um clique, mostrando o que a montagem fez', async () => {
    const montado = detalhe({ bioPageId: 'pg1', paginaDeLinks: PAGINA });
    apiPost.mockResolvedValue({
      episodio: montado,
      criados: 2,
      atualizados: 0,
      desativados: 0,
      avisos: ['1 matéria(s) de newsletter ficaram de fora: o link delas é da caixa de entrada, não é público.'],
    });
    const { onDetalhe } = renderSecao();
    expect(secao()).toHaveTextContent('a newsletter fica de fora');
    expect(within(secao()).queryByRole('button', { name: 'Publicar' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Criar página de links' }));
    expect(apiPost).toHaveBeenCalledWith('/pauta/episodios/e3/pagina-de-links', {}, 'tok');
    expect(onDetalhe).toHaveBeenCalledWith(montado);
    const feito = await screen.findByLabelText('O que a montagem fez');
    expect(feito).toHaveTextContent('2 botão(ões) novo(s)');
    expect(feito).toHaveTextContent('newsletter ficaram de fora');
  });

  it('em rascunho: o endereço sem link, os botões com a origem, o tirado riscado, e publicar pelo /publicar', async () => {
    const noAr = detalhe({ bioPageId: 'pg1', paginaDeLinks: { ...PAGINA, publicada: true } });
    apiPost.mockResolvedValue(noAr);
    const { onDetalhe } = renderSecao({ detalhe: detalhe({ bioPageId: 'pg1', paginaDeLinks: PAGINA }) });
    expect(secao()).toHaveTextContent('Rascunho');
    expect(within(secao()).queryByRole('link')).toBeNull();
    const botoes = screen.getByRole('list', { name: 'Botões da página' });
    expect(within(botoes).getAllByRole('listitem')).toHaveLength(3);
    expect(botoes).toHaveTextContent('matéria');
    expect(botoes).toHaveTextContent('da casa');
    expect(within(botoes).getByText('Matéria que saiu').closest('li')).toHaveClass('line-through');
    expect(secao()).toHaveTextContent('só troca o marcador pelo endereço quando a página estiver no ar');
    await userEvent.click(screen.getByRole('button', { name: 'Publicar' }));
    expect(apiPost).toHaveBeenCalledWith('/pauta/episodios/e3/pagina-de-links/publicar', { publicada: true }, 'tok');
    expect(onDetalhe).toHaveBeenCalledWith(noAr);
  });

  it('no ar: o endereço vira link, e dá para tirar do ar', async () => {
    apiPost.mockResolvedValue(detalhe({ bioPageId: 'pg1', paginaDeLinks: PAGINA }));
    renderSecao({ detalhe: detalhe({ bioPageId: 'pg1', paginaDeLinks: { ...PAGINA, publicada: true } }) });
    expect(secao()).toHaveTextContent('No ar');
    expect(within(secao()).getByRole('link', { name: /@root-ep-03/ })).toHaveAttribute('href', PAGINA.url);
    await userEvent.click(screen.getByRole('button', { name: 'Tirar do ar' }));
    expect(apiPost).toHaveBeenCalledWith('/pauta/episodios/e3/pagina-de-links/publicar', { publicada: false }, 'tok');
  });

  it('no ar e sem bio.editar: montar de novo fica apagado e diz por quê (a mesma regra do /bio)', () => {
    renderSecao({ podeMexerNoAr: false, detalhe: detalhe({ bioPageId: 'pg1', paginaDeLinks: { ...PAGINA, publicada: true } }) });
    expect(screen.getByRole('button', { name: 'Montar de novo' })).toBeDisabled();
    expect(secao()).toHaveTextContent('mudar os botões pede bio.editar');
  });

  it('sem pauta.publicar + bio.editar: publicar fica apagado; sem pauta.editar, montar também', () => {
    renderSecao({ podePublicar: false, editavel: false, detalhe: detalhe({ bioPageId: 'pg1', paginaDeLinks: PAGINA }) });
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Montar de novo' })).toBeDisabled();
    expect(secao()).toHaveTextContent('Publicar pede pauta.publicar e bio.editar.');
  });

  it('sem o módulo bio contratado, a seção não aparece (a API recusa do mesmo jeito)', () => {
    modulosLigados = ['pauta'];
    renderSecao({ detalhe: detalhe({ bioPageId: 'pg1', paginaDeLinks: PAGINA }) });
    expect(screen.queryByRole('region', { name: 'Página de links' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Montar de novo' })).toBeNull();
  });

  it('erro da API vai para a tela', async () => {
    apiPost.mockRejectedValue(new Error('Nenhuma matéria mantida tem link público'));
    const { onErro } = renderSecao();
    await userEvent.click(screen.getByRole('button', { name: 'Criar página de links' }));
    expect(onErro).toHaveBeenLastCalledWith('Nenhuma matéria mantida tem link público');
  });
});
