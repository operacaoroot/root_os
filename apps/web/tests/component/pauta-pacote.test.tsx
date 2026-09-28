import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * O PACOTE DO YOUTUBE — MC11, o lado da tela.
 *
 * No detalhe do episódio: gerar o pacote da transcrição (gasta IA), os três
 * títulos com a escolha do que vai ao ar, a descrição com o botão de copiar e a
 * conferência dos capítulos com a mesma conta da API, e a prévia das thumbs que
 * o Mac já subiu — ou o comando que as renderiza.
 */

const apiPost = vi.fn();
const apiPut = vi.fn();
const apiBlob = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiPost: (...a: unknown[]) => apiPost(...a),
    apiPut: (...a: unknown[]) => apiPut(...a),
    apiBlob: (...a: unknown[]) => apiBlob(...a),
  };
});

// eslint-disable-next-line import/first
import { SecaoPacote } from '@/app/pauta/SecaoPacote';

const DESCRICAO = [
  'Quatro notícias da semana.',
  '',
  'Capítulos',
  '00:00 Abertura',
  '00:31 O preço dos modelos caiu',
  '01:04 Agente de planilha',
  '',
  'Links citados no episódio',
  '• Preço do modelo caiu pela metade: https://noticia.exemplo/preco',
  '',
  'Os links deste episódio, numa página só: {{pagina-de-links}}',
  '',
  '#IA',
].join('\n');

const TITULOS = [
  { texto: 'O preço da IA caiu pela metade', angulo: 'resultado', escolhido: false },
  { texto: 'Quatro ferramentas de IA para usar amanhã', angulo: 'lista', escolhido: true },
  { texto: 'A planilha que se preenche sozinha', angulo: 'curiosidade', escolhido: false },
];

const THUMBS = [
  { n: 1, texto: 'Preço da IA caiu', destaque: 'caiu', tempoSeg: 45, imagem: { bytes: 5000, largura: 1280, altura: 720, enviadaEm: '2026-09-24T01:00:00.000Z' } },
  { n: 2, texto: 'Planilha sozinha', destaque: 'sozinha', tempoSeg: 82, imagem: null },
  { n: 3, texto: 'Ata grátis', destaque: 'grátis', tempoSeg: 214, imagem: null },
];

function detalhe(over: Record<string, unknown> = {}) {
  return {
    id: 'e3',
    numero: 3,
    apelido: 'ep-03',
    titulo: 'Semana 39',
    status: 'pacote',
    rodadaId: 'r3',
    rodadaTitulo: 'Semana 39',
    itens: [],
    janelaIni: '2026-09-17T00:00:00.000Z',
    janelaFim: '2026-09-24T00:00:00.000Z',
    roteiro: '',
    descricao: '',
    midia: {
      arquivoBruto: '/b.mp4', arquivoFinal: '/f.mp4', duracaoSeg: 655, cortes: [], palavraDeCorte: null, editor: 'ffmpeg',
      recebidaEm: '2026-09-24T00:00:00.000Z',
    },
    transcricao: [{ inicio: 0, fim: 650, texto: 'Bom dia.' }],
    transcricaoTexto: 'Bom dia.',
    titulos: [],
    thumbs: [],
    bioPageId: null,
    criadoPor: 'u1',
    criadoEm: '2026-09-20T00:00:00.000Z',
    atualizadoEm: '2026-09-24T00:00:00.000Z',
    avancar: 'derivacao',
    voltar: 'edicao',
    ...over,
  } as never;
}

function renderSecao(over: { detalhe?: never; editavel?: boolean; podeGastarIa?: boolean } = {}) {
  const onErro = vi.fn();
  const onDetalhe = vi.fn();
  render(
    <SecaoPacote
      token="tok"
      detalhe={over.detalhe ?? detalhe()}
      editavel={over.editavel ?? true}
      podeGastarIa={over.podeGastarIa ?? true}
      onErro={onErro}
      onDetalhe={onDetalhe}
    />,
  );
  return { onErro, onDetalhe };
}

const secao = () => screen.getByRole('region', { name: 'Pacote do YouTube' });

beforeEach(() => {
  vi.clearAllMocks();
  apiBlob.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:thumb-1'), revokeObjectURL: vi.fn() });
});

describe('o pacote do YouTube', () => {
  it('antes do Pacote: diz de onde o pacote sai e não oferece gerar', () => {
    renderSecao({ detalhe: detalhe({ status: 'edicao' }) });
    expect(secao()).toHaveTextContent('O pacote sai da transcrição do vídeo final');
    expect(within(secao()).queryByRole('button', { name: /Gerar/ })).toBeNull();
  });

  it('no Pacote, gera sem substituir e mostra o que o sistema ajustou', async () => {
    const gerado = detalhe({ titulos: TITULOS, descricao: DESCRICAO, thumbs: THUMBS.map((t) => ({ ...t, imagem: null })) });
    apiPost.mockResolvedValue({ episodio: gerado, avisos: [], correcoes: ['2 tempo(s) encostado(s) no começo da fala mais próxima.'] });
    const { onDetalhe } = renderSecao();
    await userEvent.click(screen.getByRole('button', { name: 'Gerar pacote' }));
    expect(apiPost).toHaveBeenCalledWith('/pauta/episodios/e3/pacote/gerar', { substituir: false }, 'tok');
    expect(onDetalhe).toHaveBeenCalledWith(gerado);
    expect(await screen.findByRole('list', { name: 'O que o sistema ajustou' })).toHaveTextContent('encostado');
  });

  it('sem automacoes.executar o botão fica apagado e diz por quê', () => {
    renderSecao({ podeGastarIa: false });
    expect(screen.getByRole('button', { name: 'Gerar pacote' })).toBeDisabled();
    expect(secao()).toHaveTextContent('precisa da permissão automacoes.executar');
  });

  it('com pacote, gerar de novo pede confirmação antes de substituir', async () => {
    apiPost.mockResolvedValue({ episodio: detalhe(), avisos: ['Sem capítulos na descrição: vídeo curto.'], correcoes: [] });
    renderSecao({ detalhe: detalhe({ titulos: TITULOS, descricao: DESCRICAO }) });
    await userEvent.click(screen.getByRole('button', { name: 'Gerar de novo' }));
    expect(apiPost).not.toHaveBeenCalled();
    expect(secao()).toHaveTextContent('As imagens enviadas saem junto');
    await userEvent.click(screen.getByRole('button', { name: 'Substituir' }));
    expect(apiPost).toHaveBeenCalledWith('/pauta/episodios/e3/pacote/gerar', { substituir: true }, 'tok');
    expect(await screen.findByText(/Sem capítulos na descrição/)).toBeInTheDocument();
  });

  it('os três títulos com o escolhido marcado; escolher outro manda o número', async () => {
    apiPut.mockResolvedValue(detalhe({ titulos: TITULOS }));
    const { onDetalhe } = renderSecao({ detalhe: detalhe({ titulos: TITULOS, descricao: DESCRICAO }) });
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios[1]).toBeChecked();
    expect(secao()).toHaveTextContent('30/100');
    await userEvent.click(radios[2]);
    expect(apiPut).toHaveBeenCalledWith('/pauta/episodios/e3/pacote/titulo', { n: 3 }, 'tok');
    expect(onDetalhe).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Desmarcar' }));
    expect(apiPut).toHaveBeenLastCalledWith('/pauta/episodios/e3/pacote/titulo', { n: null }, 'tok');
  });

  it('a descrição com o botão copiar, a conta em bytes, os capítulos conferidos e o aviso do marcador', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderSecao({ detalhe: detalhe({ titulos: TITULOS, descricao: DESCRICAO }) });
    expect(screen.getByLabelText('Descrição do vídeo')).toHaveTextContent('00:31 O preço dos modelos caiu');
    expect(screen.getByLabelText('Capítulos')).toHaveTextContent('3 capítulos dentro da regra do YouTube');
    expect(secao()).toHaveTextContent('/5000 bytes');
    expect(secao()).toHaveTextContent('vira o endereço da página de links');
    await userEvent.click(screen.getByRole('button', { name: 'Copiar descrição' }));
    expect(writeText).toHaveBeenCalledWith(DESCRICAO);
    expect(await screen.findByRole('button', { name: 'Descrição copiada' })).toBeInTheDocument();
  });

  it('capítulo fora da regra aparece com o motivo', () => {
    const ruim = DESCRICAO.replace('00:31 O preço', '00:05 O preço');
    renderSecao({ detalhe: detalhe({ titulos: TITULOS, descricao: ruim }) });
    expect(screen.getByLabelText('Capítulos')).toHaveTextContent('menos de 10 s');
  });

  it('a prévia da thumb que o Mac subiu vem pela API com o token; a que falta mostra o brief e o comando', async () => {
    renderSecao({ detalhe: detalhe({ titulos: TITULOS, descricao: DESCRICAO, thumbs: THUMBS }) });
    const img = await screen.findByRole('img', { name: 'Thumb 1: Preço da IA caiu' });
    expect(img).toHaveAttribute('src', 'blob:thumb-1');
    expect(apiBlob).toHaveBeenCalledTimes(1);
    expect(apiBlob).toHaveBeenCalledWith('/pauta/episodios/e3/thumbs/1/imagem', 'tok');
    const lista = screen.getByRole('list', { name: 'Thumbs do episódio' });
    expect(lista).toHaveTextContent('Planilha sozinha');
    expect(lista).toHaveTextContent('frame em 1:22');
    expect(lista).toHaveTextContent('falta renderizar');
    expect(secao()).toHaveTextContent('/root-midia thumbs ep-03');
  });

  it('agendado: o pacote é o registro do que subiu — título travado, sem desmarcar nem o comando das thumbs', () => {
    renderSecao({ detalhe: detalhe({ status: 'agendado', titulos: TITULOS, descricao: DESCRICAO, thumbs: THUMBS.map((t) => ({ ...t, imagem: null })) }) });
    expect(secao()).toHaveTextContent('o pacote é o registro do que subiu');
    for (const r of screen.getAllByRole('radio')) expect(r).toBeDisabled();
    expect(within(secao()).queryByRole('button', { name: 'Desmarcar' })).toBeNull();
    expect(within(secao()).queryByRole('button', { name: /Gerar/ })).toBeNull();
    expect(secao()).not.toHaveTextContent('/root-midia thumbs');
    expect(screen.getByRole('button', { name: 'Copiar descrição' })).toBeEnabled();
  });

  it('sem pauta.editar nada escreve', () => {
    renderSecao({ editavel: false, detalhe: detalhe({ titulos: TITULOS, descricao: DESCRICAO }) });
    expect(screen.getByRole('button', { name: 'Gerar de novo' })).toBeDisabled();
    for (const r of screen.getAllByRole('radio')) expect(r).toBeDisabled();
  });

  it('prévia que não carrega vira erro na tela, sem quebrar a seção', async () => {
    apiBlob.mockRejectedValue(new Error('A thumb 1 ainda não foi renderizada.'));
    const { onErro } = renderSecao({ detalhe: detalhe({ titulos: TITULOS, descricao: DESCRICAO, thumbs: THUMBS }) });
    await waitFor(() => expect(onErro).toHaveBeenCalledWith(expect.stringMatching(/prévia das thumbs não carregou/)));
    expect(screen.queryByRole('img')).toBeNull();
  });
});
