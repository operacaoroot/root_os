import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * O CALENDÁRIO DA SEMANA — MC16, o lado da tela.
 *
 * A aba Semana em /pauta: os sete dias com os slots da grade, cada peça com o
 * tipo, a matéria e o horário, e o que precisa para postar à mão — copiar a
 * legenda, baixar a mídia do storage ou o caminho do mp4 no Mac — mais
 * reagendar, marcar como postada, distribuir o episódio e editar a grade.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();
const apiBlob = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
    apiPut: (...a: unknown[]) => apiPut(...a),
    apiBlob: (...a: unknown[]) => apiBlob(...a),
  };
});

let permissoes = ['pauta.ver', 'pauta.editar', 'pauta.publicar'];
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u1', name: 'Pedro', email: 'p@x.com', roles: [], permissions: permissoes },
    can: (p: string) => permissoes.includes(p),
  }),
}));

// eslint-disable-next-line import/first
import { AbaSemana } from '@/app/pauta/AbaSemana';
// eslint-disable-next-line import/first
import PautaPage from '@/app/pauta/page';

function peca(over: Record<string, unknown> = {}) {
  return {
    id: 'p1', formato: 'carrossel', status: 'aprovada', titulo: 'O preço caiu', legenda: 'Legenda do carrossel.\n\nComente PRECO',
    palavraChave: 'PRECO', episodioId: 'e4', apelido: 'ep-04', itemN: 1, materia: 'Preço do modelo caiu pela metade',
    em: '2026-09-28T15:00:00.000Z', agendadaPara: '2026-09-28T15:00:00.000Z', midia: { onde: 'storage', imagens: [1, 2, 3], esperadas: 3 }, postada: null, motivoParaNaoAgendar: null,
    ...over,
  };
}

function dia(d: string, diaDaSemana: string, linhas: unknown[] = [], feriado: string | null = null) {
  return { dia: d, diaDaSemana, feriado, linhas };
}

const restoDaSemana = () =>
  (['ter', 'qua', 'qui', 'sex', 'sab', 'dom'] as const).map((d, i) => dia(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'][i], d));

function agenda(over: Record<string, unknown> = {}) {
  return {
    de: '2026-09-28', ate: '2026-10-04', fuso: 'America/Sao_Paulo', hoje: '2026-09-28', origemDaGrade: 'padrao', grade: { slots: [], feriados: [] },
    dias: [
      dia('2026-09-28', 'seg', [
        { hora: '09:00', formato: 'story', em: '2026-09-28T12:00:00.000Z', daGrade: true, peca: null },
        { hora: '12:00', formato: 'carrossel', em: '2026-09-28T15:00:00.000Z', daGrade: true, peca: peca() },
      ]),
      dia('2026-09-29', 'ter', [
        {
          hora: '18:00', formato: 'corte', em: '2026-09-29T21:00:00.000Z', daGrade: true,
          peca: peca({ id: 'p2', formato: 'corte', titulo: 'Corte do preço', legenda: 'Legenda do corte', midia: { onde: 'mac', arquivo: '/Users/pedro/Movies/root-midia/ep-04/ep-04-m1-corte.mp4' } }),
        },
      ]),
      dia('2026-09-30', 'qua', [
        {
          hora: '09:00', formato: 'story', em: '2026-09-30T12:00:00.000Z', daGrade: true,
          peca: peca({ id: 'p3', formato: 'story', titulo: 'Story do preço', legenda: 'O preço caiu', palavraChave: null, midia: { onde: 'storage', imagens: [1], esperadas: 1 } }),
        },
        {
          hora: '10:30', formato: 'story', em: '2026-09-30T13:30:00.000Z', daGrade: false,
          peca: peca({ id: 'p4', formato: 'story', titulo: 'Story da planilha', itemN: 2, palavraChave: null, midia: { onde: 'nenhuma', comando: '/root-midia stories ep-04' } }),
        },
      ]),
      dia('2026-10-01', 'qui', [
        {
          hora: '18:00', formato: 'corte', em: '2026-10-01T21:00:00.000Z', daGrade: true,
          peca: peca({ id: 'p5', formato: 'corte', status: 'publicada', titulo: 'Corte da planilha', midia: { onde: 'mac', arquivo: '/m/c2.mp4' }, postada: { em: '2026-10-01T21:05:00.000Z', manual: true, url: null } }),
        },
      ]),
      dia('2026-10-02', 'sex'),
      dia('2026-10-03', 'sab'),
      dia('2026-10-04', 'dom'),
    ],
    paraDistribuir: [
      { episodioId: 'e5', apelido: 'ep-05', titulo: 'Semana 41', status: 'derivacao', aprovadasSemData: 4, motivo: null },
      { episodioId: 'e3', apelido: 'ep-03', titulo: 'Semana 39', status: 'pacote', aprovadasSemData: 1, motivo: 'A agenda da semana vale na Derivação e no Agendado (este episódio está em Pacote).' },
    ],
    ...over,
  };
}

function renderAba(over: { editavel?: boolean; podePostar?: boolean } = {}) {
  const onErro = vi.fn();
  render(<AbaSemana token="tok" editavel={over.editavel ?? true} podePostar={over.podePostar ?? true} onErro={onErro} bump={0} />);
  return { onErro };
}

const oDia = (rotulo: string) => screen.getByRole('region', { name: rotulo });
const aPeca = (rotulo: string) => screen.getByLabelText(rotulo);

beforeEach(() => {
  vi.clearAllMocks();
  permissoes = ['pauta.ver', 'pauta.editar', 'pauta.publicar'];
  apiGet.mockResolvedValue(agenda());
});

describe('a aba Semana', () => {
  it('mostra os sete dias com os slots: vago, a peça com tipo, matéria e horário, o que está fora da grade e o hoje', async () => {
    renderAba();
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/pauta/agenda', 'tok'));
    expect(await screen.findByLabelText('Semana')).toHaveTextContent('28/09 – 04/10');
    const seg = oDia('Seg 28/09');
    expect(seg).toHaveTextContent('hoje');
    expect(seg).toHaveTextContent('09:00');
    expect(seg).toHaveTextContent('vago');
    const car = within(seg).getByLabelText('Carrossel de ep-04');
    expect(car).toHaveTextContent('O preço caiu');
    expect(car).toHaveTextContent('ep-04 · matéria 1');
    expect(car).toHaveTextContent('Preço do modelo caiu pela metade');
    expect(car).toHaveTextContent('PRECO');
    expect(oDia('Qua 30/09')).toHaveTextContent('fora da grade');
    expect(screen.getByText(/no Instagram chega na MD6, e a do TikTok está em espera/)).toBeInTheDocument();
  });

  it('anda de semana em semana e volta para esta', async () => {
    renderAba();
    await userEvent.click(await screen.findByRole('button', { name: 'Próxima ›' }));
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/pauta/agenda?de=2026-10-05', 'tok'));
    await userEvent.click(screen.getByRole('button', { name: 'Esta semana' }));
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/pauta/agenda', 'tok'));
    await userEvent.click(screen.getByRole('button', { name: '‹ Anterior' }));
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/pauta/agenda?de=2026-09-21', 'tok'));
  });

  it('copia a legenda com um toque', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderAba();
    const car = await waitFor(() => aPeca('Carrossel de ep-04'));
    await userEvent.click(within(car).getByRole('button', { name: 'Copiar legenda' }));
    expect(writeText).toHaveBeenCalledWith('Legenda do carrossel.\n\nComente PRECO');
    expect(within(car).getByRole('button', { name: 'Copiado' })).toBeInTheDocument();
    // O story copia o texto.
    const story = within(oDia('Qua 30/09')).getAllByLabelText('Story de ep-04')[0];
    await userEvent.click(within(story).getByRole('button', { name: 'Copiar texto' }));
    expect(writeText).toHaveBeenLastCalledWith('O preço caiu');
  });

  it('salva a mídia do storage com o token: sem a folha de compartilhar, um download por imagem, e a URL não é revogada na hora', async () => {
    const criar = vi.fn(() => 'blob:x');
    const revogar = vi.fn();
    Object.assign(URL, { createObjectURL: criar, revokeObjectURL: revogar });
    const baixados: string[] = [];
    const clique = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      baixados.push(this.download);
    });
    try {
      apiBlob.mockResolvedValue(new Blob(['png']));
      renderAba();
      const car = await waitFor(() => aPeca('Carrossel de ep-04'));
      // Uma de cada vez continua, para o computador.
      const botoes = within(within(car).getByLabelText('Baixar mídia')).getAllByRole('button');
      expect(botoes.map((b) => b.textContent)).toEqual(['1', '2', '3']);
      await userEvent.click(botoes[1]);
      expect(apiBlob).toHaveBeenCalledWith('/pauta/pecas/p1/imagens/2', 'tok');
      await waitFor(() => expect(baixados).toEqual(['ep-04-m1-carrossel-02.png']));

      await userEvent.click(within(car).getByRole('button', { name: 'Salvar as 3 imagens' }));
      await waitFor(() => expect(baixados).toHaveLength(4));
      expect(baixados.slice(1)).toEqual(['ep-04-m1-carrossel-01.png', 'ep-04-m1-carrossel-02.png', 'ep-04-m1-carrossel-03.png']);
      // O Safari do iOS lê o blob depois do clique: revogar na hora quebrava o download.
      expect(revogar).not.toHaveBeenCalled();

      const story = within(oDia('Qua 30/09')).getAllByLabelText('Story de ep-04')[0];
      await userEvent.click(within(story).getByRole('button', { name: 'Salvar a imagem' }));
      expect(apiBlob).toHaveBeenLastCalledWith('/pauta/pecas/p3/imagens/1', 'tok');
    } finally {
      clique.mockRestore();
    }
  });

  it('no celular, as imagens do carrossel vão juntas para a folha de compartilhar; se ela pedir outro toque, os PNG ficam prontos', async () => {
    const compartilhados: File[][] = [];
    let recusar = true;
    const nav = navigator as Navigator & { canShare?: unknown; share?: unknown };
    Object.assign(nav, {
      canShare: vi.fn((d: { files?: File[] }) => (d.files?.length ?? 0) > 0),
      share: vi.fn(async (d: { files: File[] }) => {
        if (recusar) {
          recusar = false;
          throw Object.assign(new Error('sem gesto'), { name: 'NotAllowedError' });
        }
        compartilhados.push(d.files);
      }),
    });
    try {
      apiBlob.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
      const { onErro } = renderAba();
      const car = await waitFor(() => aPeca('Carrossel de ep-04'));
      await userEvent.click(within(car).getByRole('button', { name: 'Salvar as 3 imagens' }));
      const deNovo = await within(car).findByRole('button', { name: 'Abrir o compartilhar (3 imagens prontas)' });
      expect(apiBlob).toHaveBeenCalledTimes(3);
      await userEvent.click(deNovo);
      await waitFor(() => expect(compartilhados).toHaveLength(1));
      // O segundo toque não busca de novo: abre a folha na hora, com os três PNG.
      expect(apiBlob).toHaveBeenCalledTimes(3);
      expect(compartilhados[0].map((f) => [f.name, f.type])).toEqual([
        ['ep-04-m1-carrossel-01.png', 'image/png'],
        ['ep-04-m1-carrossel-02.png', 'image/png'],
        ['ep-04-m1-carrossel-03.png', 'image/png'],
      ]);
      expect(within(car).getByRole('button', { name: 'Salvar as 3 imagens' })).toBeInTheDocument();
      expect(onErro).not.toHaveBeenCalledWith(expect.any(String));
    } finally {
      Reflect.deleteProperty(nav, 'canShare');
      Reflect.deleteProperty(nav, 'share');
    }
  });

  it('o carrossel que subiu pela metade diz "N de M PNG", o que falta e o comando, sem botão de baixar', async () => {
    const parcial = { onde: 'parcial', imagens: [1, 2, 3], esperadas: 7, faltam: [4, 5, 6, 7], comando: '/root-midia carrosseis ep-04' };
    apiGet.mockResolvedValue(
      agenda({
        dias: [
          dia('2026-09-28', 'seg', [{ hora: '12:00', formato: 'carrossel', em: '2026-09-28T15:00:00.000Z', daGrade: true, peca: peca({ midia: parcial }) }]),
          ...restoDaSemana(),
        ],
      }),
    );
    renderAba();
    const car = await waitFor(() => aPeca('Carrossel de ep-04'));
    expect(car).toHaveTextContent('3 de 7 PNG (falta: 4, 5, 6, 7) — não poste ainda. Para completar, no Mac: /root-midia carrosseis ep-04');
    expect(within(car).queryByRole('button', { name: 'Baixar mídia' })).toBeNull();
    expect(within(car).queryByLabelText('Baixar mídia')).toBeNull();
  });

  it('o carrossel de um slide só tem o botão único, sem a fileira de números', async () => {
    apiGet.mockResolvedValue(
      agenda({
        dias: [
          dia('2026-09-28', 'seg', [{ hora: '12:00', formato: 'carrossel', em: '2026-09-28T15:00:00.000Z', daGrade: true, peca: peca({ midia: { onde: 'storage', imagens: [1], esperadas: 1 } }) }]),
          ...restoDaSemana(),
        ],
      }),
    );
    renderAba();
    const car = await waitFor(() => aPeca('Carrossel de ep-04'));
    expect(within(car).getByRole('button', { name: 'Salvar a imagem' })).toBeInTheDocument();
    expect(within(car).queryByLabelText('Baixar mídia')).toBeNull();
  });

  it('peça de episódio fora da Derivação/Agendado: sem Reagendar nem Tirar, com o motivo; postar continua', async () => {
    const motivo = 'A agenda da semana vale na Derivação e no Agendado (este episódio está em Concluído).';
    apiGet.mockResolvedValue(
      agenda({
        dias: [
          dia('2026-09-28', 'seg', [{ hora: '12:00', formato: 'carrossel', em: '2026-09-28T15:00:00.000Z', daGrade: true, peca: peca({ motivoParaNaoAgendar: motivo }) }]),
          ...restoDaSemana(),
        ],
      }),
    );
    renderAba();
    const car = await waitFor(() => aPeca('Carrossel de ep-04'));
    expect(car).toHaveTextContent('está em Concluído');
    expect(within(car).queryByRole('button', { name: 'Reagendar' })).toBeNull();
    expect(within(car).getByRole('button', { name: 'Marcar como postada' })).toBeInTheDocument();
  });

  it('na primeira carga a tela desce até hoje, uma vez só', async () => {
    const rolou: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      rolou.push(this.getAttribute('aria-label') ?? '');
    };
    try {
      apiGet.mockResolvedValue(agenda({ hoje: '2026-09-30' }));
      renderAba();
      await waitFor(() => expect(rolou).toEqual(['Qua 30/09']));
      await userEvent.click(screen.getByRole('button', { name: /Próxima/ }));
      await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
      expect(rolou).toEqual(['Qua 30/09']);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('o corte que ficou no Mac mostra o caminho; sem mídia, o comando que a faz', async () => {
    renderAba();
    const corte = await waitFor(() => within(oDia('Ter 29/09')).getByLabelText('Corte vertical de ep-04'));
    expect(corte).toHaveTextContent('arquivo no Mac: /Users/pedro/Movies/root-midia/ep-04/ep-04-m1-corte.mp4');
    // No celular o caminho não serve: a tela diz como o vídeo chega até o post.
    expect(corte).toHaveTextContent('O vídeo ficou no Mac: poste de lá ou mande por AirDrop para o celular antes do horário.');
    expect(within(corte).getByRole('button', { name: 'Copiar caminho' })).toBeInTheDocument();
    expect(within(corte).queryByRole('button', { name: 'Baixar mídia' })).toBeNull();
    expect(oDia('Qua 30/09')).toHaveTextContent('Sem mídia ainda — no Mac: /root-midia stories ep-04');
  });

  it('MD4: o corte que subiu ao OS baixa o mp4 com o token, em vez de mostrar o caminho do Mac', async () => {
    const baixados: string[] = [];
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    const clique = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      baixados.push(this.download);
    });
    try {
      apiGet.mockResolvedValue(
        agenda({
          dias: [
            dia('2026-09-29', 'ter', [
              {
                hora: '18:00', formato: 'corte', em: '2026-09-29T21:00:00.000Z', daGrade: true,
                peca: peca({ id: 'p9', formato: 'corte', titulo: 'Corte no OS', midia: { onde: 'video', arquivo: '/m/c.mp4', bytes: 40 * 1024 * 1024 } }),
              },
            ]),
          ],
        }),
      );
      apiBlob.mockResolvedValue(new Blob(['mp4'], { type: 'video/mp4' }));
      renderAba();
      const corte = await waitFor(() => within(oDia('Ter 29/09')).getByLabelText('Corte vertical de ep-04'));
      expect(corte).toHaveTextContent('O mp4 está no OS (40 MB)');
      expect(corte).not.toHaveTextContent('AirDrop');
      // Sem a folha de compartilhar (desktop), o download.
      await userEvent.click(within(corte).getByRole('button', { name: 'Salvar o mp4' }));
      expect(apiBlob).toHaveBeenCalledWith('/pauta/pecas/p9/video/arquivo', 'tok');
      await waitFor(() => expect(baixados).toEqual(['ep-04-m1-corte.mp4']));
    } finally {
      clique.mockRestore();
    }
  });

  it('MD4: no celular o mp4 vai à folha de compartilhar, como as imagens (Fotos ou o Instagram); se ela pedir outro toque, fica pronto', async () => {
    const compartilhados: File[][] = [];
    let recusar = true;
    const nav = navigator as Navigator & { canShare?: unknown; share?: unknown };
    Object.assign(nav, {
      canShare: vi.fn((d: { files?: File[] }) => (d.files?.length ?? 0) > 0),
      share: vi.fn(async (d: { files: File[] }) => {
        if (recusar) {
          recusar = false;
          throw Object.assign(new Error('sem gesto'), { name: 'NotAllowedError' });
        }
        compartilhados.push(d.files);
      }),
    });
    try {
      apiGet.mockResolvedValue(
        agenda({
          dias: [
            dia('2026-09-29', 'ter', [
              {
                hora: '18:00', formato: 'corte', em: '2026-09-29T21:00:00.000Z', daGrade: true,
                peca: peca({ id: 'p9', formato: 'corte', titulo: 'Corte no OS', midia: { onde: 'video', arquivo: null, bytes: 40 * 1024 * 1024 } }),
              },
            ]),
          ],
        }),
      );
      apiBlob.mockResolvedValue(new Blob(['mp4'], { type: 'video/mp4' }));
      renderAba();
      const corte = await waitFor(() => within(oDia('Ter 29/09')).getByLabelText('Corte vertical de ep-04'));
      await userEvent.click(within(corte).getByRole('button', { name: 'Salvar o mp4' }));
      const deNovo = await within(corte).findByRole('button', { name: 'Abrir o compartilhar (mp4 pronto)' });
      await userEvent.click(deNovo);
      await waitFor(() => expect(compartilhados).toHaveLength(1));
      expect(apiBlob).toHaveBeenCalledTimes(1);
      expect(compartilhados[0].map((f) => [f.name, f.type])).toEqual([['ep-04-m1-corte.mp4', 'video/mp4']]);
      expect(within(corte).getByRole('button', { name: 'Salvar o mp4' })).toBeInTheDocument();
    } finally {
      Reflect.deleteProperty(nav, 'canShare');
      Reflect.deleteProperty(nav, 'share');
    }
  });

  it('reagenda pelo relógio de São Paulo, e tira da agenda', async () => {
    apiPut.mockResolvedValue({ id: 'p1', agendadaPara: '2026-09-29T22:30:00.000Z' });
    renderAba();
    const car = await waitFor(() => aPeca('Carrossel de ep-04'));
    await userEvent.click(within(car).getByRole('button', { name: 'Reagendar' }));
    const campo = within(car).getByLabelText('Novo dia e hora (horário de São Paulo)') as HTMLInputElement;
    expect(campo.value).toBe('2026-09-28T12:00');
    fireEvent.change(campo, { target: { value: '2026-09-29T19:30' } });
    await userEvent.click(within(car).getByRole('button', { name: 'Salvar' }));
    expect(apiPut).toHaveBeenCalledWith('/pauta/pecas/p1/agenda', { agendadaPara: '2026-09-29T22:30:00.000Z' }, 'tok');
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));

    await userEvent.click(within(aPeca('Carrossel de ep-04')).getByRole('button', { name: 'Reagendar' }));
    await userEvent.click(within(aPeca('Carrossel de ep-04')).getByRole('button', { name: 'Tirar da agenda' }));
    expect(apiPut).toHaveBeenLastCalledWith('/pauta/pecas/p1/agenda', { agendadaPara: null }, 'tok');
  });

  it('marca como postada: o link é opcional e só https; a postada mostra quando e pede o link que faltou', async () => {
    apiPost.mockResolvedValue({});
    renderAba();
    const car = await waitFor(() => aPeca('Carrossel de ep-04'));
    await userEvent.click(within(car).getByRole('button', { name: 'Marcar como postada' }));
    expect(car).toHaveTextContent('nada é enviado daqui');
    const url = within(car).getByLabelText('Link do post (opcional)');
    await userEvent.type(url, 'http://www.instagram.com/p/abc/');
    expect(car).toHaveTextContent('https://');
    expect(within(car).getByRole('button', { name: 'Confirmar' })).toBeDisabled();
    await userEvent.clear(url);
    await userEvent.type(url, 'https://www.instagram.com/p/abc/');
    await userEvent.click(within(car).getByRole('button', { name: 'Confirmar' }));
    expect(apiPost).toHaveBeenCalledWith('/pauta/pecas/p1/postada', { url: 'https://www.instagram.com/p/abc/' }, 'tok');

    const postada = within(oDia('Qui 01/10')).getByLabelText('Corte vertical de ep-04');
    expect(postada).toHaveTextContent('Postada');
    expect(postada).toHaveTextContent('Postada em 01/10 18:05 (à mão)');
    expect(within(postada).queryByRole('button', { name: 'Reagendar' })).toBeNull();
    await userEvent.click(within(postada).getByRole('button', { name: 'Acrescentar o link do post' }));
    expect(within(postada).getByRole('button', { name: 'Salvar link' })).toBeDisabled();
  });

  it('confirmar sem link manda o corpo vazio', async () => {
    apiPost.mockResolvedValue({});
    renderAba();
    const corte = await waitFor(() => within(oDia('Ter 29/09')).getByLabelText('Corte vertical de ep-04'));
    await userEvent.click(within(corte).getByRole('button', { name: 'Marcar como postada' }));
    await userEvent.click(within(corte).getByRole('button', { name: 'Confirmar' }));
    expect(apiPost).toHaveBeenCalledWith('/pauta/pecas/p2/postada', {}, 'tok');
  });

  it('distribui o episódio com as aprovadas sem data (a partir de agora ou do dia escolhido) e mostra a conta', async () => {
    apiPost.mockResolvedValue({ conta: { alocadas: 3, jaAgendadas: 1, semVaga: 1 }, pecas: [], avisos: ['Corte vertical da matéria 3: sem slot livre nas próximas 4 semanas da grade — distribua de novo com um "a partir de" mais adiante ou abra mais slots na grade.'] });
    renderAba();
    const bloco = await screen.findByRole('region', { name: 'Para distribuir' });
    expect(bloco).toHaveTextContent('ep-05');
    expect(bloco).toHaveTextContent('4 peça(s)');
    expect(bloco).toHaveTextContent('está em Pacote');
    expect(within(bloco).getAllByRole('button', { name: 'Distribuir' })).toHaveLength(1);
    await userEvent.click(within(bloco).getByRole('button', { name: 'Distribuir' }));
    expect(apiPost).toHaveBeenCalledWith('/pauta/episodios/e5/agenda/distribuir', {}, 'tok');
    const r = await screen.findByLabelText('Resultado da distribuição');
    expect(r).toHaveTextContent('ep-05: 3 agendada(s) agora · 1 já tinha(m) data · 1 sem slot livre');
    expect(r).toHaveTextContent('"a partir de" mais adiante');

    const campo = within(bloco).getByLabelText('A partir de (vazio = a partir de agora)');
    // O campo vai de hoje até hoje + 62 dias: um ano digitado errado não some com as peças.
    expect(campo).toHaveAttribute('min', '2026-09-28');
    expect(campo).toHaveAttribute('max', '2026-11-29');
    fireEvent.change(campo, { target: { value: '2026-10-05' } });
    await userEvent.click(within(bloco).getByRole('button', { name: 'Distribuir' }));
    expect(apiPost).toHaveBeenLastCalledWith('/pauta/episodios/e5/agenda/distribuir', { aPartirDe: '2026-10-05' }, 'tok');
  });

  it('edita a grade como texto, com a versão lida; a recusa da API vai para a tela', async () => {
    apiGet.mockImplementation(async (path: string) =>
      path === '/pauta/agenda/grade'
        ? { texto: 'carrossel: seg 12:00\n', origem: 'empresa', versao: 3, avisos: [], grade: { slots: [], feriados: [] } }
        : agenda(),
    );
    apiPut.mockRejectedValueOnce(new Error('Linha 2: "reels" não é formato da semana (carrossel, story ou corte).'));
    apiPut.mockResolvedValueOnce({ texto: 'carrossel: seg, qua 12:00\n', origem: 'empresa', versao: 4, avisos: [], grade: { slots: [], feriados: [] } });
    const { onErro } = renderAba();
    await userEvent.click(await screen.findByRole('button', { name: 'Grade da semana' }));
    const texto = (await screen.findByLabelText('Texto da grade')) as HTMLTextAreaElement;
    expect(texto.value).toBe('carrossel: seg 12:00\n');
    expect(screen.getByRole('region', { name: 'Grade da semana' })).toHaveTextContent('Nota da empresa, versão 3.');
    fireEvent.change(texto, { target: { value: 'carrossel: seg 12:00\nreels: ter 9h' } });
    await userEvent.click(screen.getByRole('button', { name: 'Salvar grade' }));
    expect(apiPut).toHaveBeenCalledWith('/pauta/agenda/grade', { texto: 'carrossel: seg 12:00\nreels: ter 9h', versao: 3 }, 'tok');
    await waitFor(() => expect(onErro).toHaveBeenLastCalledWith(expect.stringMatching(/Linha 2/)));
    fireEvent.change(texto, { target: { value: 'carrossel: seg, qua 12h' } });
    await userEvent.click(screen.getByRole('button', { name: 'Salvar grade' }));
    await waitFor(() => expect((screen.getByLabelText('Texto da grade') as HTMLTextAreaElement).value).toBe('carrossel: seg, qua 12:00\n'));
  });

  it('sem pauta.editar não reagenda, não distribui nem edita a grade; sem pauta.publicar não marca postada', async () => {
    apiGet.mockImplementation(async (path: string) =>
      path === '/pauta/agenda/grade' ? { texto: 'x', origem: 'padrao', versao: null, avisos: [], grade: { slots: [], feriados: [] } } : agenda(),
    );
    renderAba({ editavel: false, podePostar: false });
    const car = await waitFor(() => aPeca('Carrossel de ep-04'));
    expect(within(car).queryByRole('button', { name: 'Reagendar' })).toBeNull();
    expect(within(car).queryByRole('button', { name: 'Marcar como postada' })).toBeNull();
    expect(within(car).getByRole('button', { name: 'Copiar legenda' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Para distribuir' })).getByRole('button', { name: 'Distribuir' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Grade da semana' }));
    expect(screen.queryByRole('button', { name: 'Salvar grade' })).toBeNull();
  });

  it('a recusa da API numa ação vai para a tela, e a semana vazia explica o caminho', async () => {
    apiPut.mockRejectedValue(new Error('Já há um carrossel nesse horário ("Outro"): escolha outro.'));
    const { onErro } = renderAba();
    const car = await waitFor(() => aPeca('Carrossel de ep-04'));
    await userEvent.click(within(car).getByRole('button', { name: 'Reagendar' }));
    await userEvent.click(within(car).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(onErro).toHaveBeenLastCalledWith('Já há um carrossel nesse horário ("Outro"): escolha outro.'));
  });

  it('semana sem nada agendado diz de onde vêm as peças; feriado aparece sem slot', async () => {
    apiGet.mockResolvedValue(
      agenda({
        dias: [dia('2026-10-12', 'seg', [], 'Nossa Senhora Aparecida'), ...['ter', 'qua', 'qui', 'sex', 'sab', 'dom'].map((d, i) => dia(`2026-10-1${3 + i}`, d))],
        paraDistribuir: [],
        de: '2026-10-12',
        ate: '2026-10-18',
      }),
    );
    renderAba();
    expect(await screen.findByText(/Nada agendado nesta semana/)).toBeInTheDocument();
    expect(oDia('Seg 12/10')).toHaveTextContent('Nossa Senhora Aparecida — sem slot');
  });

  it('a recusa de uma ação do meio da página aparece presa no topo da tela, e fecha', async () => {
    apiGet.mockImplementation(async (path: string) => (path.startsWith('/pauta/agenda') ? agenda() : { items: [] }));
    apiPost.mockRejectedValue(new Error('A peça mudou enquanto isso — recarregue e tente de novo.'));
    render(<PautaPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Semana' }));
    const car = await waitFor(() => within(screen.getByRole('region', { name: 'Seg 28/09' })).getByLabelText('Carrossel de ep-04'));
    await userEvent.click(within(car).getByRole('button', { name: 'Marcar como postada' }));
    await userEvent.click(within(car).getByRole('button', { name: 'Confirmar' }));
    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent('A peça mudou enquanto isso');
    // `sticky top-0`: no celular a caixa acima das abas ficava fora da vista.
    expect(aviso.className).toMatch(/\bsticky\b/);
    expect(aviso.className).toMatch(/\btop-0\b/);
    await userEvent.click(within(aviso).getByRole('button', { name: 'Fechar o aviso de erro' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a página tem a aba Semana, e ela abre o calendário', async () => {
    apiGet.mockImplementation(async (path: string) => (path.startsWith('/pauta/agenda') ? agenda() : { items: [] }));
    render(<PautaPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Semana' }));
    expect(await screen.findByRole('region', { name: 'Seg 28/09' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Seg 28/09' })).getByRole('button', { name: 'Marcar como postada' })).toBeInTheDocument();
  });
});
