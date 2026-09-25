import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * A SEMANA DE POSTS — MC15, o lado da tela.
 *
 * No detalhe do episódio: gerar por matéria o carrossel, o story e o corte
 * vertical, ver a prévia em texto (slides, story, trecho do corte com os
 * tempos), aprovar, descartar e editar — sem publicar nada.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();
const apiPatch = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
    apiPut: (...a: unknown[]) => apiPut(...a),
    apiPatch: (...a: unknown[]) => apiPatch(...a),
  };
});

// eslint-disable-next-line import/first
import { SecaoSemana } from '@/app/pauta/SecaoSemana';

function carrossel(over: Record<string, unknown> = {}) {
  return {
    id: 'car1', formato: 'carrossel', status: 'rascunho', titulo: 'Carrossel do preço', corpo: 'Legenda.\n\nComentário com PRECO → o link…',
    criadaEm: '2026-09-24T12:00:00.000Z',
    slides: [
      { titulo: 'O preço caiu', texto: '' },
      { titulo: 'O fato', texto: 'A API ficou pela metade.' },
      { titulo: 'Na prática', texto: 'Mil reais a menos.' },
      { titulo: 'Palavra-chave: PRECO', texto: 'Comentário com PRECO → o link da matéria.' },
    ],
    cta: { instrucao: 'Comentário com a palavra', palavra: 'PRECO', beneficio: 'O link chega no direct.' },
    palavraChave: 'PRECO', imagens: [], avisos: [], transcricaoMudou: false,
    ...over,
  };
}
function story(over: Record<string, unknown> = {}) {
  return {
    id: 'st1', formato: 'story', status: 'rascunho', titulo: 'Preço do modelo', corpo: 'O preço caiu pela metade', chamada: 'O episódio completo está no link da bio.',
    tempoSeg: 20.4, criadaEm: '2026-09-24T12:00:00.000Z', imagens: [{ n: 1, largura: 1080, altura: 1920, bytes: 1, enviadaEm: 'x' }], avisos: [], transcricaoMudou: false,
    ...over,
  };
}
function corte(over: Record<string, unknown> = {}) {
  return {
    id: 'co1', formato: 'corte', status: 'rascunho', titulo: 'Corte do preço', corpo: 'Legenda do corte', inicio: 20.4, fim: 80.4,
    trecho: 'A primeira: o preço dos modelos caiu pela metade.', video: null, criadaEm: '2026-09-24T12:00:00.000Z', imagens: [], avisos: [], transcricaoMudou: false,
    ...over,
  };
}

function semana(over: Record<string, unknown> = {}, pecas: Record<string, unknown> | null = null) {
  return {
    episodioId: 'e4', apelido: 'ep-04', status: 'derivacao', arquivoFinal: '/m/final.mp4', duracaoSeg: 390, paginaDeLinks: null, motivo: null,
    materias: [
      { n: 1, itemId: 'c1', titulo: 'Preço do modelo caiu', origem: 'N', link: 'https://noticia.exemplo/preco', pecas: pecas ?? { carrossel: carrossel(), story: story(), corte: corte() } },
      { n: 2, itemId: 'c3', titulo: 'The Batch', origem: 'L', link: null, pecas: pecas ? {} : { story: story({ id: 'st2' }) } },
    ],
    ...over,
  };
}

function detalhe(over: Record<string, unknown> = {}) {
  return {
    id: 'e4', numero: 4, apelido: 'ep-04', titulo: 'Semana 40', status: 'derivacao',
    itens: [{ titulo: 'a', url: 'https://a' }, { titulo: 'b', url: '' }],
    transcricao: [{ inicio: 0, fim: 4, texto: 'Bom dia.' }],
    ...over,
  } as never;
}

function renderSecao(over: { detalhe?: never; editavel?: boolean; podeGastarIa?: boolean } = {}) {
  const onErro = vi.fn();
  const onMudou = vi.fn();
  render(
    <SecaoSemana
      token="tok"
      detalhe={over.detalhe ?? detalhe()}
      editavel={over.editavel ?? true}
      podeGastarIa={over.podeGastarIa ?? true}
      onErro={onErro}
      onMudou={onMudou}
    />,
  );
  return { onErro, onMudou };
}

const secao = () => screen.getByRole('region', { name: 'Semana de posts' });
const materia = (n: number) => screen.getByRole('article', { name: `Matéria ${n}` });

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockResolvedValue(semana());
});

describe('a semana de posts do episódio', () => {
  it('no Pacote sem peças gera a semana sem substituir e, com o episódio indo à Derivação, avisa a página', async () => {
    apiGet.mockResolvedValue(semana({ status: 'pacote' }, {}));
    apiPost.mockResolvedValue({ ...semana(), conta: { criadas: 9, substituidas: 0, mantidas: 0, falharam: 0 }, avisos: ['Matéria 2 · Corte: o corte está fora de ordem.'] });
    const { onMudou } = renderSecao({ detalhe: detalhe({ status: 'pacote' }) });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/pauta/episodios/e4/semana', 'tok'));
    expect(secao()).toHaveTextContent('Nada é publicado daqui');
    expect(secao()).toHaveTextContent('/root-midia carrosseis|stories|cortes ep-04');

    await userEvent.click(await screen.findByRole('button', { name: 'Gerar a semana' }));
    expect(apiPost).toHaveBeenCalledWith('/pauta/episodios/e4/semana/gerar', { substituir: false }, 'tok');
    expect(await screen.findByLabelText('Resultado da geração')).toHaveTextContent('9 nova(s) · 0 substituída(s) · 0 mantida(s)');
    expect(secao()).toHaveTextContent('Matéria 2 · Corte: o corte está fora de ordem.');
    expect(onMudou).toHaveBeenCalled();
  });

  it('mostra por matéria as três peças: os slides em texto, o story com a chamada e o trecho do corte com os tempos', async () => {
    renderSecao();
    const m1 = await waitFor(() => materia(1));
    const car = within(m1).getByLabelText('Carrossel');
    expect(within(car).getByLabelText('Slides')).toHaveTextContent('O preço caiu');
    expect(within(car).getByLabelText('Slides')).toHaveTextContent('Palavra-chave: PRECO');
    expect(car).toHaveTextContent('PRECO');
    expect(car).toHaveTextContent('sem PNG — /root-midia carrosseis ep-04');
    const st = within(m1).getByLabelText('Story');
    expect(st).toHaveTextContent('O preço caiu pela metade');
    expect(st).toHaveTextContent('O episódio completo está no link da bio.');
    expect(st).toHaveTextContent('1 de 1 PNG');
    const co = within(m1).getByLabelText('Corte vertical');
    expect(within(co).getByLabelText('Trecho do corte')).toHaveTextContent('00:20 – 01:20 (60 s)');
    expect(co).toHaveTextContent('caiu pela metade');
    expect(co).toHaveTextContent('sem mp4 — /root-midia cortes ep-04');
    expect(within(m1).getByRole('link', { name: /Preço do modelo caiu/ })).toHaveAttribute('href', 'https://noticia.exemplo/preco');
    // A newsletter não tem link público, e o que não saiu é dito.
    expect(materia(2)).toHaveTextContent('(sem link público)');
    expect(materia(2)).toHaveTextContent('Carrossel: não saiu — gere de novo.');
  });

  it('MD4: o estado do render diz o mp4 no OS ou só no Mac, e o JPEG que falta para a Meta', async () => {
    apiGet.mockResolvedValue(
      semana({}, {
        story: story({ jpegs: [] }),
        corte: corte({ video: { arquivo: '/m/c.mp4', duracaoSeg: 60, largura: 1080, altura: 1920, bytes: 42 * 1024 * 1024, chave: 'k', sha256: 'a'.repeat(64) } }),
        carrossel: carrossel({ imagens: [{ n: 1, largura: 1080, altura: 1350, bytes: 1, enviadaEm: 'x' }], jpegs: [{ n: 1, largura: 1080, altura: 1350, bytes: 1, enviadaEm: 'x' }] }),
      }),
    );
    renderSecao();
    const m1 = await waitFor(() => materia(1));
    expect(within(m1).getByLabelText('Corte vertical')).toHaveTextContent('mp4 no OS (42 MB)');
    expect(within(m1).getByLabelText('Story')).toHaveTextContent('1 de 1 PNG · 0 JPEG (a Meta só aceita JPEG)');
    expect(within(m1).getByLabelText('Carrossel')).toHaveTextContent('1 de 4 PNG · 1 JPEG (a Meta só aceita JPEG)');
  });

  it('MD4: o mp4 registrado e ainda não enviado aparece como só no Mac, com o comando que sobe', async () => {
    apiGet.mockResolvedValue(semana({}, { corte: corte({ video: { arquivo: '/m/ep-04-m1-corte.mp4', duracaoSeg: 60, largura: 1080, altura: 1920, bytes: 1, registradoEm: 'x' } }) }));
    renderSecao();
    const m1 = await waitFor(() => materia(1));
    expect(within(m1).getByLabelText('Corte vertical')).toHaveTextContent('mp4 só no Mac (ep-04-m1-corte.mp4) — /root-midia cortes ep-04 sobe');
  });

  it('gerar de novo pede confirmação e substitui só os rascunhos', async () => {
    apiPost.mockResolvedValue({ ...semana(), conta: { criadas: 0, substituidas: 5, mantidas: 1, falharam: 0 }, avisos: [] });
    renderSecao();
    await userEvent.click(await screen.findByRole('button', { name: 'Gerar de novo' }));
    expect(secao()).toHaveTextContent('As peças aprovadas e publicadas ficam como estão.');
    expect(apiPost).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Substituir' }));
    expect(apiPost).toHaveBeenCalledWith('/pauta/episodios/e4/semana/gerar', { substituir: true }, 'tok');
  });

  it('aprovar e descartar vão pelo PATCH da peça e relêem a semana; a descartada se recupera', async () => {
    apiPatch.mockResolvedValue({ ok: true });
    renderSecao();
    const car = within(await waitFor(() => materia(1))).getByLabelText('Carrossel');
    await userEvent.click(within(car).getByRole('button', { name: 'Aprovar' }));
    expect(apiPatch).toHaveBeenCalledWith('/pauta/pecas/car1', { status: 'aprovada' }, 'tok');
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    await userEvent.click(within(within(materia(1)).getByLabelText('Story')).getByRole('button', { name: 'Descartar' }));
    expect(apiPatch).toHaveBeenLastCalledWith('/pauta/pecas/st1', { status: 'descartada' }, 'tok');

    apiGet.mockResolvedValue(semana({}, { corte: corte({ status: 'descartada' }) }));
    await userEvent.click(within(within(materia(1)).getByLabelText('Carrossel')).getByRole('button', { name: 'Descartar' }));
    await waitFor(() => expect(within(materia(1)).getByLabelText('Corte vertical')).toHaveTextContent('Descartada'));
    await userEvent.click(within(within(materia(1)).getByLabelText('Corte vertical')).getByRole('button', { name: 'Recuperar' }));
    expect(apiPatch).toHaveBeenLastCalledWith('/pauta/pecas/co1', { status: 'rascunho' }, 'tok');
  });

  it('editar o story manda só os campos dele e aplica a semana que volta', async () => {
    apiPut.mockResolvedValue(semana({}, { story: story({ corpo: 'Texto novo', status: 'rascunho' }) }));
    renderSecao();
    const st = within(await waitFor(() => materia(1))).getByLabelText('Story');
    await userEvent.click(within(st).getByRole('button', { name: 'Editar' }));
    const texto = within(st).getByLabelText('Texto do story');
    await userEvent.clear(texto);
    await userEvent.type(texto, 'Texto novo');
    expect(st).toHaveTextContent('Salvar volta a peça para rascunho');
    await userEvent.click(within(st).getByRole('button', { name: 'Salvar' }));
    expect(apiPut).toHaveBeenCalledWith(
      '/pauta/pecas/st1/semana',
      { titulo: 'Preço do modelo', texto: 'Texto novo', chamada: 'O episódio completo está no link da bio.' },
      'tok',
    );
    await waitFor(() => expect(within(materia(1)).getByLabelText('Story')).toHaveTextContent('Texto novo'));
  });

  it('o corte editado é conferido na tela: 3 min ou mais trava o salvar com o porquê', async () => {
    apiPut.mockResolvedValue(semana());
    renderSecao();
    const co = within(await waitFor(() => materia(1))).getByLabelText('Corte vertical');
    await userEvent.click(within(co).getByRole('button', { name: 'Editar' }));
    const fim = within(co).getByLabelText('Fim (s)');
    await userEvent.clear(fim);
    await userEvent.type(fim, '220');
    expect(co).toHaveTextContent('precisa ter menos de 3 minutos');
    expect(within(co).getByRole('button', { name: 'Salvar' })).toBeDisabled();
    await userEvent.clear(fim);
    await userEvent.type(fim, '75,5');
    await userEvent.click(within(co).getByRole('button', { name: 'Salvar' }));
    expect(apiPut).toHaveBeenCalledWith('/pauta/pecas/co1/semana', { titulo: 'Corte do preço', legenda: 'Legenda do corte', inicio: 20.4, fim: 75.5 }, 'tok');
  });

  it('editar só a legenda do corte não manda o trecho (a API descartaria o mp4 já renderizado)', async () => {
    apiGet.mockResolvedValue(semana({}, { corte: corte({ video: { arquivo: '/m/ep-04-m1-corte.mp4', duracaoSeg: 60, largura: 1080, altura: 1920, bytes: 1, registradoEm: 'x' } }) }));
    apiPut.mockResolvedValue(semana());
    renderSecao();
    const co = within(await waitFor(() => materia(1))).getByLabelText('Corte vertical');
    await userEvent.click(within(co).getByRole('button', { name: 'Editar' }));
    const legenda = within(co).getByLabelText('Legenda');
    await userEvent.clear(legenda);
    await userEvent.type(legenda, 'Outra legenda');
    await userEvent.click(within(co).getByRole('button', { name: 'Salvar' }));
    expect(apiPut).toHaveBeenCalledWith('/pauta/pecas/co1/semana', { titulo: 'Corte do preço', legenda: 'Outra legenda' }, 'tok');
  });

  it('depois de concluído não há Editar (o texto é o registro), e o story avisa a página de links fora do ar', async () => {
    apiGet.mockResolvedValue(semana({ status: 'concluido' }));
    renderSecao({ detalhe: detalhe({ status: 'concluido' }) });
    const m1 = await waitFor(() => materia(1));
    expect(within(m1).queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(within(m1).getAllByRole('button', { name: 'Aprovar' }).length).toBeGreaterThan(0);
    expect(secao()).toHaveTextContent('o texto das peças é o registro do que foi ao ar');
    expect(within(m1).getByLabelText('Story')).toHaveTextContent('A página de links do episódio ainda não está no ar');
  });

  it('a peça na agenda avisa que editar ou descartar a tira de lá (o slot não volta sozinho)', async () => {
    apiGet.mockResolvedValue(semana({}, { carrossel: carrossel({ status: 'aprovada', agendadaPara: '2026-09-28T15:00:00.000Z' }), story: story({ status: 'aprovada' }) }));
    renderSecao();
    const car = within(await waitFor(() => materia(1))).getByLabelText('Carrossel');
    expect(car).toHaveTextContent('na agenda: 28/09 12:00');
    expect(car).toHaveTextContent('Editar ou descartar tira a peça da agenda (28/09 12:00); depois é distribuir de novo na aba Semana.');
    // A aprovada sem slot não tem o aviso.
    expect(within(materia(1)).getByLabelText('Story')).not.toHaveTextContent('tira a peça da agenda');
  });

  it('com a página de links no ar, o story não avisa', async () => {
    apiGet.mockResolvedValue(semana({ paginaDeLinks: 'https://bio.exemplo/ep-04' }));
    renderSecao();
    const st = within(await waitFor(() => materia(1))).getByLabelText('Story');
    expect(st).not.toHaveTextContent('página de links');
  });

  it('o carrossel editado manda os slides sem o do CTA e a palavra em maiúscula; palavra inválida trava', async () => {
    apiPut.mockResolvedValue(semana());
    renderSecao();
    const car = within(await waitFor(() => materia(1))).getByLabelText('Carrossel');
    await userEvent.click(within(car).getByRole('button', { name: 'Editar' }));
    expect(within(car).queryByLabelText('Título do slide 4')).toBeNull();
    const palavra = within(car).getByDisplayValue('PRECO');
    await userEvent.clear(palavra);
    await userEvent.type(palavra, 'pré ço');
    expect(within(car).getByRole('button', { name: 'Salvar' })).toBeDisabled();
    await userEvent.clear(palavra);
    await userEvent.type(palavra, 'custo');
    await userEvent.click(within(car).getByRole('button', { name: 'Salvar' }));
    const [, corpo] = apiPut.mock.calls[0];
    expect(corpo).toMatchObject({ palavraChave: 'CUSTO', slides: [{ titulo: 'O preço caiu' }, { titulo: 'O fato' }, { titulo: 'Na prática' }] });
  });

  it('sem automacoes.executar o gerar fica apagado com o porquê; sem pauta.editar nada escreve; publicada não mexe', async () => {
    apiGet.mockResolvedValue(semana({}, { carrossel: carrossel({ status: 'publicada' }), story: story(), corte: corte() }));
    renderSecao({ podeGastarIa: false });
    const botao = await screen.findByRole('button', { name: 'Gerar de novo' });
    expect(botao).toBeDisabled();
    expect(secao()).toHaveTextContent('precisa da permissão automacoes.executar');
    expect(within(within(materia(1)).getByLabelText('Carrossel')).queryByRole('button')).toBeNull();
  });

  it('sem pauta.editar não há aprovar, editar nem gerar', async () => {
    renderSecao({ editavel: false });
    const m1 = await waitFor(() => materia(1));
    expect(within(m1).queryByRole('button', { name: 'Aprovar' })).toBeNull();
    expect(within(m1).queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Gerar de novo' })).toBeDisabled();
  });

  it('antes do Pacote não lê a semana nem oferece gerar; o erro da API vai para a tela', async () => {
    renderSecao({ detalhe: detalhe({ status: 'edicao' }) });
    await waitFor(() => expect(secao()).toHaveTextContent('A semana de posts sai no Pacote ou na Derivação'));
    expect(apiGet).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Gerar/ })).toBeNull();
  });

  it('a recusa da API ao gerar vai para a caixa de erro', async () => {
    apiGet.mockResolvedValue(semana({ status: 'pacote' }, {}));
    apiPost.mockRejectedValue(new Error('Nenhuma peça foi gravada.'));
    const { onErro } = renderSecao({ detalhe: detalhe({ status: 'pacote' }) });
    await userEvent.click(await screen.findByRole('button', { name: 'Gerar a semana' }));
    await waitFor(() => expect(onErro).toHaveBeenCalledWith('Nenhuma peça foi gravada.'));
  });
});
