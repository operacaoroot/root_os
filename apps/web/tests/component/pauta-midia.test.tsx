import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * A MÍDIA DO EPISÓDIO — MC9, o lado da tela.
 *
 * A tela só LÊ o que a estação de mídia do Mac devolveu: onde está o vídeo
 * final (o nome, com o caminho no título), a duração, o que foi cortado por
 * motivo e a transcrição com os tempos do final. Enquanto falta algo, ela diz o
 * comando que resolve (`/root-midia ep-NN`).
 */

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...real, apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiPatch: vi.fn() };
});

// eslint-disable-next-line import/first
import { SecaoMidia } from '@/app/pauta/SecaoMidia';

const MIDIA = {
  arquivoBruto: '/Users/pedro/Movies/OBS/2026-09-24 20-00-00.mp4',
  arquivoFinal: '/Users/pedro/Movies/OBS/ep-02-final.mp4',
  duracaoSeg: 545,
  duracaoBrutoSeg: 610,
  cortes: [
    { inicio: 0, fim: 4, motivo: 'silencio' },
    { inicio: 100, fim: 156, motivo: 'palavra-de-corte' },
    { inicio: 300, fim: 305, motivo: 'silencio' },
  ],
  palavraDeCorte: 'root, corta',
  editor: 'ffmpeg',
  recebidaEm: '2026-09-24T23:00:00.000Z',
};

const SEGMENTOS = [
  { inicio: 0, fim: 4.5, texto: 'Bom dia, esta é a semana 39.' },
  { inicio: 64.2, fim: 70, texto: 'A primeira notícia é sobre o Pix automático.' },
];

const secao = () => screen.getByRole('region', { name: 'Mídia do episódio' });

describe('a mídia do episódio', () => {
  it('gravado e sem mídia: diz o comando do Mac e que o vídeo fica lá', () => {
    render(<SecaoMidia apelido="ep-02" status="gravacao" midia={{}} transcricao={[]} />);
    expect(secao()).toHaveTextContent('/root-midia ep-02');
    expect(secao()).toHaveTextContent('O vídeo fica no Mac');
  });

  it('no roteiro ainda não há o que mostrar', () => {
    render(<SecaoMidia apelido="ep-02" status="roteiro" midia={{}} transcricao={[]} />);
    expect(secao()).toHaveTextContent('A mídia vem depois da gravação.');
    expect(secao()).not.toHaveTextContent('/root-midia');
  });

  it('em edição com mídia: o nome do vídeo final, durações, cortes por motivo e o que falta', () => {
    render(<SecaoMidia apelido="ep-02" status="edicao" midia={MIDIA} transcricao={[]} />);
    const final = screen.getByText('ep-02-final.mp4');
    expect(final).toHaveAttribute('title', MIDIA.arquivoFinal);
    expect(secao()).not.toHaveTextContent('/Users/pedro');
    expect(secao()).toHaveTextContent('9:05');
    expect(secao()).toHaveTextContent('(bruto 10:10)');
    expect(secao()).toHaveTextContent('3 — 2 de silêncio, 1 de palavra de corte; 1:05 tirados');
    expect(secao()).toHaveTextContent('ffmpeg · palavra “root, corta”');
    expect(secao()).toHaveTextContent('Falta a transcrição do vídeo final: /root-midia ep-02');
  });

  it('com a transcrição: a conta, o fim e cada trecho com o tempo do vídeo final', async () => {
    render(<SecaoMidia apelido="ep-02" status="pacote" midia={MIDIA} transcricao={SEGMENTOS} />);
    await userEvent.click(screen.getByText(/Transcrição — 2 trecho\(s\), até 1:10/));
    const itens = within(screen.getByRole('list', { name: 'Transcrição' })).getAllByRole('listitem');
    expect(itens.map((i) => i.textContent)).toEqual(['0:00Bom dia, esta é a semana 39.', '1:04A primeira notícia é sobre o Pix automático.']);
    expect(secao()).not.toHaveTextContent('Falta a transcrição');
  });

  it('mídia fora da forma (de antes do MC9, ou quebrada) conta como sem mídia', () => {
    render(<SecaoMidia apelido="ep-02" status="edicao" midia={{ arquivoFinal: 'x.mp4' }} transcricao={[]} />);
    expect(secao()).toHaveTextContent('Ainda sem mídia');
    expect(screen.queryByText('x.mp4')).toBeNull();
  });
});
