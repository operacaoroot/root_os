import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * MD10 — O VÍDEO NO YOUTUBE, o lado da tela.
 *
 * No detalhe do episódio: a seção YouTube com a auditoria, o canal, a thumb que
 * sobe, o horário (no relógio de São Paulo), o vídeo final que o Mac declarou,
 * o que falta para entrar na semana, "Conectar o canal" e o aviso da volta do
 * OAuth. Na aba Semana: a linha do vídeo no "Aprovar a semana", com o "fica
 * fora". Em /atendimento: o vídeo no cartão do lote, com a descrição inteira.
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

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ token: 'tok', ready: true, user: { id: 'u1', permissions: [] }, can: () => true }),
}));

// eslint-disable-next-line import/first
import { AvisoDoYoutube, SecaoYoutube } from '@/app/pauta/SecaoYoutube';
// eslint-disable-next-line import/first
import { AprovarASemana } from '@/app/pauta/AprovarASemana';
// eslint-disable-next-line import/first
import { CartaoDoLote } from '@/app/atendimento/CartaoDoLote';

const THUMBS = [
  { n: 1, texto: 'agentes no escritório', destaque: 'agentes', tempoSeg: 3, imagem: { bytes: 10, largura: 1280, altura: 720, enviadaEm: 'x' } },
  { n: 2, texto: 'três agentes', destaque: 'três', tempoSeg: 9, imagem: null },
];

function estadoDoYoutube(over: Record<string, unknown> = {}) {
  return {
    episodioId: 'e1',
    apelido: 'ep-01',
    auditoria: 'pendente',
    conectado: false,
    tituloEscolhido: 'Agentes no escritório',
    thumbEscolhida: null,
    publicarEm: null,
    arquivoFinal: '/Users/pedro/Movies/OBS/final.mp4',
    envio: null,
    faltas: ['O canal do YouTube não está conectado: conecte em Conexões (o OAuth é feito na conta dona do canal).', 'Escolha a thumb que sobe ao YouTube no pacote.'],
    itens: [],
    url: null,
    ...over,
  };
}

const secao = () => screen.getByRole('region', { name: 'YouTube' });

beforeEach(() => {
  vi.clearAllMocks();
  apiBlob.mockRejectedValue(new Error('sem imagem no teste'));
});

describe('MD10: a seção YouTube do episódio', () => {
  it('mostra a auditoria, o canal e o que falta; "Conectar o canal" leva à URL do Google', async () => {
    apiGet.mockResolvedValue(estadoDoYoutube());
    apiPost.mockResolvedValue({ tipo: 'redirecionar', url: 'https://accounts.google.com/o/oauth2/v2/auth?state=abc' });
    const navegar = vi.fn();
    render(<SecaoYoutube token="tok" episodioId="e1" apelido="ep-01" thumbs={THUMBS} editavel podeConectar onErro={vi.fn()} navegar={navegar} />);
    expect(await within(secao()).findByText('canal não conectado')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/pauta/episodios/e1/youtube', 'tok');
    expect(secao()).toHaveTextContent('auditoria pendente: nada vai ao YouTube');
    expect(secao()).toHaveTextContent('root-midia youtube ep-01');
    expect(secao()).toHaveTextContent('Escolha a thumb que sobe ao YouTube no pacote.');
    expect(secao()).toHaveTextContent('não declarado pelo Mac');
    await userEvent.click(within(secao()).getByRole('button', { name: 'Conectar o canal' }));
    await waitFor(() => expect(navegar).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?state=abc'));
    expect(apiPost).toHaveBeenCalledWith('/pauta/youtube/conectar', {}, 'tok');
  });

  it('sem credencial no servidor, "Conectar" mostra a instrução em vez de navegar; sem pauta.publicar, não há botão', async () => {
    apiGet.mockResolvedValue(estadoDoYoutube());
    apiPost.mockResolvedValue({ tipo: 'manual', instrucao: 'O YouTube não tem credencial neste processo.' });
    const onErro = vi.fn();
    const navegar = vi.fn();
    const { unmount } = render(<SecaoYoutube token="tok" episodioId="e1" apelido="ep-01" thumbs={THUMBS} editavel podeConectar onErro={onErro} navegar={navegar} />);
    await userEvent.click(await within(secao()).findByRole('button', { name: 'Conectar o canal' }));
    await waitFor(() => expect(onErro).toHaveBeenCalledWith('O YouTube não tem credencial neste processo.'));
    expect(navegar).not.toHaveBeenCalled();
    unmount();
    render(<SecaoYoutube token="tok" episodioId="e1" apelido="ep-01" thumbs={THUMBS} editavel podeConectar={false} onErro={vi.fn()} />);
    await within(secao()).findByText('canal não conectado');
    expect(within(secao()).queryByRole('button', { name: 'Conectar o canal' })).toBeNull();
  });

  it('escolher a thumb e o horário: o horário do campo é de São Paulo e vai em ISO', async () => {
    apiGet.mockResolvedValue(estadoDoYoutube({ conectado: true, auditoria: 'aprovada' }));
    apiPut.mockImplementation(async (url: string, corpo: Record<string, unknown>) =>
      url.endsWith('/thumb')
        ? estadoDoYoutube({ conectado: true, auditoria: 'aprovada', thumbEscolhida: corpo.n })
        : estadoDoYoutube({ conectado: true, auditoria: 'aprovada', thumbEscolhida: 1, publicarEm: corpo.publicarEm }),
    );
    render(<SecaoYoutube token="tok" episodioId="e1" apelido="ep-01" thumbs={THUMBS} editavel podeConectar onErro={vi.fn()} />);
    await within(secao()).findByText('canal conectado');
    expect(secao()).toHaveTextContent('auditoria aprovada: envio e publicação');
    // A thumb 2 ainda não foi renderizada.
    expect(within(secao()).getByText('(sem imagem)')).toBeInTheDocument();
    await userEvent.click(within(secao()).getByRole('radio', { name: /1\. agentes no escritório/ }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/pauta/episodios/e1/pacote/thumb', { n: 1 }, 'tok'));
    const campo = within(secao()).getByLabelText('Horário do vídeo (São Paulo)');
    await userEvent.type(campo, '2026-09-03T18:00');
    await userEvent.click(within(secao()).getByRole('button', { name: 'Salvar horário' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/pauta/episodios/e1/pacote/horario', { publicarEm: '2026-09-03T21:00:00.000Z' }, 'tok'));
    expect(await within(secao()).findByText('Vai ao ar 03/09 18:00.')).toBeInTheDocument();
  });

  it('com o vídeo na semana assinada, trocar a thumb ou o horário pede confirmação antes de derrubar a assinatura', async () => {
    const itens = [{ capabilityId: 'youtube.video.enviar', itemId: 'i1', loteId: 'l1', estadoDoLote: 'ativo', estadoDoItem: 'ativo', janelaAte: '2026-09-03T23:00:00.000Z' }];
    apiGet.mockResolvedValue(estadoDoYoutube({ conectado: true, auditoria: 'aprovada', thumbEscolhida: 2, itens }));
    apiPut.mockResolvedValue(estadoDoYoutube({ conectado: true, auditoria: 'aprovada', thumbEscolhida: 1 }));
    render(<SecaoYoutube token="tok" episodioId="e1" apelido="ep-01" thumbs={THUMBS} editavel podeConectar onErro={vi.fn()} />);
    await within(secao()).findByText('canal conectado');

    // O toque na thumb não grava: mostra o aviso, e "Manter" desiste.
    await userEvent.click(within(secao()).getByRole('radio', { name: /1\. agentes no escritório/ }));
    expect(apiPut).not.toHaveBeenCalled();
    expect(within(secao()).getByRole('alert')).toHaveTextContent('Isto tira o vídeo da semana assinada');
    await userEvent.click(within(secao()).getByRole('button', { name: 'Manter' }));
    expect(within(secao()).queryByRole('alert')).toBeNull();
    expect(apiPut).not.toHaveBeenCalled();

    await userEvent.type(within(secao()).getByLabelText('Horário do vídeo (São Paulo)'), '2026-09-03T18:00');
    await userEvent.click(within(secao()).getByRole('button', { name: 'Salvar horário' }));
    expect(apiPut).not.toHaveBeenCalled();
    await userEvent.click(within(secao()).getByRole('button', { name: 'Confirmar: salvar o horário novo' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/pauta/episodios/e1/pacote/horario', { publicarEm: '2026-09-03T21:00:00.000Z' }, 'tok'));
  });

  it('o vídeo agendado: o link do YouTube, o estado do envio, e a thumb e o horário travados', async () => {
    apiGet.mockResolvedValue(
      estadoDoYoutube({
        conectado: true,
        auditoria: 'aprovada',
        thumbEscolhida: 1,
        publicarEm: '2026-09-03T21:00:00.000Z',
        faltas: ['O vídeo já está agendado no YouTube.'],
        url: 'https://youtu.be/vid-1',
        envio: {
          estado: 'agendado', sha256: 'c'.repeat(64), bytes: 314_572_800, mime: 'video/mp4', videoId: 'vid-1', sessaoExpiraEm: null, sessoes: 1,
          conferidoEm: 'x', thumbDefinidaEm: 'x', playlistId: null, publicarEm: '2026-09-03T21:00:00.000Z', agendadoEm: 'x', erro: null, atualizadoEm: 'x',
        },
      }),
    );
    render(<SecaoYoutube token="tok" episodioId="e1" apelido="ep-01" thumbs={THUMBS} editavel podeConectar onErro={vi.fn()} />);
    expect(await within(secao()).findByRole('link', { name: 'https://youtu.be/vid-1' })).toHaveAttribute('href', 'https://youtu.be/vid-1');
    expect(secao()).toHaveTextContent('publicação agendada no YouTube');
    expect(secao()).toHaveTextContent('300 MB · sha256 cccccccccccc');
    expect(within(secao()).getByRole('radio', { name: /1\. agentes/ })).toBeDisabled();
    expect(within(secao()).getByRole('button', { name: 'Salvar horário' })).toBeDisabled();
  });

  it('a volta do OAuth em Testing avisa que vence em 7 dias; o erro do envio aparece', async () => {
    apiGet.mockResolvedValue(
      estadoDoYoutube({
        conectado: true,
        envio: {
          estado: 'erro', sha256: 'c'.repeat(64), bytes: 1024, mime: 'video/mp4', videoId: null, sessaoExpiraEm: null, sessoes: 1,
          conferidoEm: null, thumbDefinidaEm: null, playlistId: null, publicarEm: null, agendadoEm: null, erro: 'O vídeo não existe no canal conectado (ou é de outro canal).', atualizadoEm: 'x',
        },
      }),
    );
    // O aviso da volta do OAuth mora no topo da aba Episódios (nenhum episódio está aberto na volta do Google).
    render(<AvisoDoYoutube motivo="ok_testing" />);
    render(<SecaoYoutube token="tok" episodioId="e1" apelido="ep-01" thumbs={THUMBS} editavel podeConectar onErro={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Testing: a autorização vence em 7 dias');
    expect(within(await screen.findByRole('region', { name: 'YouTube' })).queryByRole('status')).toBeNull();
    expect(await within(secao()).findByText('O vídeo não existe no canal conectado (ou é de outro canal).')).toBeInTheDocument();
  });
});

function aprovacao(youtube: Record<string, unknown>) {
  return {
    episodioId: 'e1', apelido: 'ep-01', status: 'derivacao', automaticaLigada: true, impedimentos: [],
    pecas: [{ id: 'p1', formato: 'carrossel', itemN: 1, titulo: 'O preço caiu', status: 'rascunho', slot: '2026-09-28T15:00:00.000Z', problema: null, noLote: null, etapa: 'proposto' }],
    lotes: [],
    youtube,
  };
}

describe('MD10: o vídeo no "Aprovar a semana"', () => {
  it('pronto, o vídeo entra no lote com o envio e o agendamento; "fica fora" manda "youtube" na lista', async () => {
    apiGet.mockResolvedValue(aprovacao({ entra: true, faltas: [], publicarEm: '2026-10-01T21:00:00.000Z', capacidades: ['youtube.video.enviar', 'youtube.video.publicar'], noLote: null, automatica: true }));
    apiPost.mockImplementation(async (url: string) =>
      url.endsWith('/preparar-aprovacao') ? { loteId: 'l1', hashConteudo: 'h', validaAte: 'x', itens: 1, fora: ['youtube'], substituidos: [] } : { status: 'aguardando_aprovacao', fila: '/atendimento' },
    );
    render(<AprovarASemana episodioId="e1" token="tok" podePublicar onErro={vi.fn()} onMudou={vi.fn()} />);
    const video = await screen.findByLabelText('O vídeo no YouTube');
    expect(video).toHaveTextContent('01/10 18:00');
    expect(video).toHaveTextContent('Entra com o envio privado (o Mac sobe o vídeo) e o agendamento no horário.');
    expect(video).not.toHaveTextContent('publicação automática está desligada');
    expect(screen.getByRole('button', { name: 'Aprovar a semana (1 post + o vídeo no YouTube)' })).toBeEnabled();
    await userEvent.click(within(video).getByRole('checkbox', { name: 'fica fora' }));
    await userEvent.click(screen.getByRole('button', { name: 'Aprovar a semana (1 post)' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/pauta/episodios/e1/semana/preparar-aprovacao', { fora: ['youtube'] }, 'tok'));
  });

  it('com falta (a auditoria pendente), a linha diz o quê e o vídeo não conta no botão; no modo teste, só o envio', async () => {
    apiGet.mockResolvedValue(aprovacao({ entra: false, faltas: ['YOUTUBE_AUDITORIA=pendente: o projeto do Google ainda não passou pela auditoria.'], publicarEm: null, capacidades: [], noLote: null }));
    const { unmount } = render(<AprovarASemana episodioId="e1" token="tok" podePublicar onErro={vi.fn()} onMudou={vi.fn()} />);
    const video = await screen.findByLabelText('O vídeo no YouTube');
    expect(video).toHaveTextContent('YOUTUBE_AUDITORIA=pendente');
    expect(within(video).queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Aprovar a semana (1 post)' })).toBeEnabled();
    unmount();
    apiGet.mockResolvedValue(aprovacao({ entra: true, faltas: [], publicarEm: '2026-10-01T21:00:00.000Z', capacidades: ['youtube.video.enviar'], noLote: null, automatica: true }));
    render(<AprovarASemana episodioId="e1" token="tok" podePublicar onErro={vi.fn()} onMudou={vi.fn()} />);
    expect(await screen.findByLabelText('O vídeo no YouTube')).toHaveTextContent('Modo teste: entra só o envio, para o canal de teste. O vídeo enviado agora fica privado para sempre');
  });

  it('o vídeo que já subiu entra só com o agendamento; com a publicação automática desligada, a linha avisa que o horário é à mão', async () => {
    apiGet.mockResolvedValue(aprovacao({ entra: true, faltas: [], publicarEm: '2026-10-01T21:00:00.000Z', capacidades: ['youtube.video.publicar'], noLote: null, automatica: false }));
    render(<AprovarASemana episodioId="e1" token="tok" podePublicar onErro={vi.fn()} onMudou={vi.fn()} />);
    const video = await screen.findByLabelText('O vídeo no YouTube');
    expect(video).toHaveTextContent('O vídeo já está no YouTube, privado: entra o agendamento no horário.');
    expect(video).not.toHaveTextContent('envio privado');
    expect(video).toHaveTextContent('A publicação automática está desligada: o agendamento não sai sozinho');
  });
});

describe('MD10: o vídeo no cartão do lote, em /atendimento', () => {
  it('a titular lê o título, a descrição inteira, a thumb, o arquivo e o horário, com a divergência marcada', async () => {
    apiGet.mockResolvedValue({
      loteId: 'l1', estado: 'aguardando', hashCurto: 'f00f00f00f00', validaAte: '2026-10-04T12:00:00.000Z', total: 2, divergentes: 1, handle: 'operacaoroot',
      itens: [],
      youtube: [
        {
          itemId: 'y1', capabilityId: 'youtube.video.enviar', episodioId: 'e1', titulo: 'Agentes no escritório', descricao: 'A descrição inteira.\n\nOs links: https://bio.teste/@root-ep-01',
          bytesDaDescricao: 60, categoria: '28', thumbN: 1, arquivo: { sha256Curto: 'cccccccccccc', bytes: 314_572_800 }, publicarEm: null,
          janelaAte: '2026-10-01T20:00:00.000Z', estadoDoItem: 'ativo', hashCurto: 'aaa', divergente: null,
        },
        {
          itemId: 'y2', capabilityId: 'youtube.video.publicar', episodioId: 'e1', titulo: 'Agentes no escritório', descricao: 'A descrição inteira.',
          bytesDaDescricao: 20, categoria: '28', thumbN: 1, arquivo: { sha256Curto: 'cccccccccccc', bytes: 314_572_800 }, publicarEm: '2026-10-01T21:00:00.000Z',
          janelaAte: '2026-10-01T20:45:00.000Z', estadoDoItem: 'ativo', hashCurto: 'bbb',
          divergente: 'O pacote do vídeo mudou depois de o lote ser montado (título, descrição, thumb, arquivo ou horário): este item não sai.',
        },
      ],
    });
    // O jsdom não tem as duas: ficam de pé até o fim do arquivo, porque a limpeza do cartão revoga a URL depois do caso.
    URL.createObjectURL = vi.fn(() => 'blob:thumb-1');
    URL.revokeObjectURL = vi.fn();
    apiBlob.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    render(<CartaoDoLote loteId="l1" onPronto={vi.fn()} />);
    const envio = await screen.findByTestId('item-do-youtube-y1');
    // A thumb assinada aparece como IMAGEM, pela rota autenticada do pacote, e não só como número.
    expect(await within(envio).findByRole('img', { name: 'Thumb 1 do vídeo' })).toHaveAttribute('src', 'blob:thumb-1');
    expect(apiBlob).toHaveBeenCalledWith('/pauta/episodios/e1/thumbs/1/imagem', 'tok');
    expect(envio).toHaveTextContent('YouTube · envio privado (o Mac sobe o vídeo)');
    expect(envio).toHaveTextContent('vídeo de 300 MB (sha256 cccccccccccc) · thumb 1 · categoria 28');
    expect(envio.querySelector('pre')?.textContent).toBe('A descrição inteira.\n\nOs links: https://bio.teste/@root-ep-01');
    expect(screen.getByTestId('item-do-youtube-y2')).toHaveTextContent('YouTube · agendado para 01/10 18:00');
    expect(screen.getByTestId('divergente-y2')).toHaveTextContent('pacote do vídeo mudou');
  });
});
