import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PautaComentarioNaFila, PautaFilaDeComentarios, PautaTextoDaDm } from '@mktos/shared';

/*
 * MD9 — "Quem comentou e o que responder", na aba Semana: a fila da DM à mão,
 * com o @, a palavra, a peça, copiar o texto, abrir o perfil e marcar como
 * respondido; e o texto da DM de cada matéria (MC18.0), com copiar e editar.
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
    apiBlob: vi.fn(),
  };
});

// eslint-disable-next-line import/first
import { ComentariosComPalavra } from '@/app/pauta/ComentariosComPalavra';
// eslint-disable-next-line import/first
import { NovaRotinaDeComentarios } from '@/app/rotinas/NovaRotinaDeComentarios';

const TEXTO = 'O link da matéria que saiu no post (Agentes de IA):\nhttps://bio.teste/r/l1\n\nO episódio completo, com todas as matérias da semana:\nhttps://bio.teste/@root-ep-01';

function linha(over: Partial<PautaComentarioNaFila> = {}): PautaComentarioNaFila {
  return {
    id: 'l1',
    usuario: 'fulano.silva',
    palavra: 'AGENTES',
    pecaId: 'p1',
    formato: 'carrossel',
    apelido: 'ep-01',
    itemN: 1,
    tituloDaPeca: 'Carrossel dos agentes',
    comentadoEm: new Date(Date.now() - 3600_000).toISOString(),
    expiraEm: new Date(Date.now() + 6 * 86_400_000).toISOString(),
    respondidoEm: null,
    respondidoPor: null,
    texto: TEXTO,
    motivo: null,
    ...over,
  };
}

function texto(over: Partial<PautaTextoDaDm> = {}): PautaTextoDaDm {
  return {
    episodioId: 'e1',
    apelido: 'ep-01',
    itemId: 'item-1',
    itemN: 1,
    palavra: 'AGENTES',
    materia: 'Agentes de IA',
    texto: TEXTO,
    motivo: null,
    link: 'https://bio.teste/r/l1',
    bytes: 150,
    editado: false,
    checagem: { aprovada: true, apontamentos: [] },
    ...over,
  };
}

function fila(over: Partial<PautaFilaDeComentarios> = {}): PautaFilaDeComentarios {
  return {
    linhas: [linha()],
    textos: [texto()],
    pendentes: 1,
    conta: { handle: 'operacaoroot', podeLerComentarios: true },
    ultimaColeta: { em: new Date().toISOString(), status: 'ok', resumo: '1 post(s), 3 comentário(s) lido(s) · 1 novo(s) na fila' },
    source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    ...over,
  };
}

const secao = () => screen.getByRole('region', { name: 'Quem comentou e o que responder' });

function montar(props: Partial<{ podeResponder: boolean; editavel: boolean }> = {}) {
  const onErro = vi.fn();
  render(<ComentariosComPalavra token="tok" podeResponder editavel onErro={onErro} bump={0} {...props} />);
  return { onErro };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a fila da DM à mão', () => {
  it('mostra o @, a palavra, a peça, o prazo e a última leitura; o perfil abre o Instagram em outra aba', async () => {
    apiGet.mockResolvedValue(fila());
    montar();
    const item = await within(secao()).findByRole('listitem', { name: 'Comentário de @fulano.silva' });
    expect(item).toHaveTextContent('@fulano.silva');
    expect(item).toHaveTextContent('AGENTES');
    expect(item).toHaveTextContent('ep-01 · Carrossel · matéria 1 · Carrossel dos agentes');
    expect(item).toHaveTextContent(/responder até/);
    expect(within(secao()).getByText('1 esperando a DM')).toBeInTheDocument();
    expect(secao()).toHaveTextContent(/Última leitura: .* \(ok\) — 1 post\(s\)/);
    const perfil = within(item).getByRole('link', { name: /Abrir perfil/ });
    expect(perfil).toHaveAttribute('href', 'https://www.instagram.com/fulano.silva/');
    expect(perfil).toHaveAttribute('target', '_blank');
    expect(perfil).toHaveAttribute('rel', 'noopener noreferrer');
    expect(apiGet).toHaveBeenCalledWith('/pauta/comentarios', 'tok');
  });

  it('"Copiar texto" leva o texto com o /r/ para a área de transferência', async () => {
    const escrever = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: escrever }, configurable: true });
    apiGet.mockResolvedValue(fila());
    montar();
    const item = await within(secao()).findByRole('listitem', { name: 'Comentário de @fulano.silva' });
    await userEvent.click(within(item).getByRole('button', { name: 'Copiar texto' }));
    expect(escrever).toHaveBeenCalledWith(TEXTO);
    expect(await within(secao()).findByRole('status')).toHaveTextContent('Texto copiado');
  });

  it('"Marquei como respondido" chama a API e recarrega; sem pauta.publicar o botão não aparece', async () => {
    apiGet.mockResolvedValueOnce(fila()).mockResolvedValueOnce(
      fila({ linhas: [linha({ respondidoEm: new Date().toISOString(), respondidoPor: 'Pedro' })], pendentes: 0 }),
    );
    apiPost.mockResolvedValue({});
    montar();
    const item = await within(secao()).findByRole('listitem', { name: 'Comentário de @fulano.silva' });
    await userEvent.click(within(item).getByRole('button', { name: 'Marquei como respondido' }));
    expect(apiPost).toHaveBeenCalledWith('/pauta/comentarios/l1/respondido', {}, 'tok');
    await waitFor(() => expect(within(secao()).getByRole('listitem', { name: 'Comentário de @fulano.silva' })).toHaveTextContent('respondido por Pedro'));
    expect(within(secao()).queryByRole('button', { name: 'Marquei como respondido' })).toBeNull();
  });

  it('sem pauta.publicar não há "Marquei como respondido"', async () => {
    apiGet.mockResolvedValue(fila());
    montar({ podeResponder: false });
    await within(secao()).findByRole('listitem', { name: 'Comentário de @fulano.silva' });
    expect(within(secao()).queryByRole('button', { name: 'Marquei como respondido' })).toBeNull();
  });

  it('depois de 7 dias o @ some da linha, sem link de perfil; sem texto, o copiar fica desligado com o motivo', async () => {
    apiGet.mockResolvedValue(
      fila({
        linhas: [linha({ id: 'l2', usuario: null, expiraEm: new Date(Date.now() - 1000).toISOString(), texto: null, motivo: 'A matéria não tem link público.' })],
        pendentes: 0,
      }),
    );
    montar();
    const item = await within(secao()).findByRole('listitem', { name: 'Comentário de pessoa apagada' });
    expect(item).toHaveTextContent('@ apagado depois de 7 dias');
    expect(item).toHaveTextContent('passou dos 7 dias');
    expect(within(item).queryByRole('link', { name: /Abrir perfil/ })).toBeNull();
    expect(within(item).getByRole('button', { name: 'Copiar texto' })).toBeDisabled();
    expect(item).toHaveTextContent('A matéria não tem link público.');
  });

  it('sem a permissão de comentários e sem a rotina, a seção diz o que falta', async () => {
    apiGet.mockResolvedValue(fila({ linhas: [], pendentes: 0, conta: { handle: 'operacaoroot', podeLerComentarios: false }, ultimaColeta: null }));
    montar();
    expect(await within(secao()).findByText(/não concedeu a leitura de comentários/)).toBeInTheDocument();
    expect(secao()).toHaveTextContent('Nova rotina de comentários');
    expect(secao()).toHaveTextContent('Ninguém comentou a palavra nos últimos 7 dias.');
  });
});

describe('o texto da DM de cada matéria (MC18.0)', () => {
  it('mostra o texto com os bytes, e "Preparar os textos da DM" quando o link ainda não existe', async () => {
    apiGet.mockResolvedValue(
      fila({
        linhas: [],
        pendentes: 0,
        textos: [texto(), texto({ itemId: 'item-3', itemN: 3, palavra: 'PLANILHA', texto: null, link: null, motivo: 'O link rastreado da DM ainda não existe: "Preparar os textos da DM".' })],
      }),
    );
    apiPost.mockResolvedValue([]);
    montar();
    await userEvent.click(await within(secao()).findByText('Texto da DM por matéria (2)'));
    const primeira = within(secao()).getByRole('listitem', { name: 'Texto da DM de ep-01 matéria 1' });
    expect(primeira).toHaveTextContent('https://bio.teste/r/l1');
    expect(primeira).toHaveTextContent('150 de 1000 bytes');
    await userEvent.click(within(secao()).getByRole('button', { name: /Preparar os textos da DM/ }));
    expect(apiPost).toHaveBeenCalledWith('/pauta/episodios/e1/dm/preparar', {}, 'tok');
  });

  it('editar conta bytes (acento vale 2), recusa passar de 1000 e salva pelo PUT; "Voltar ao padrão" manda nulo', async () => {
    apiGet.mockResolvedValue(fila({ linhas: [], pendentes: 0, textos: [texto({ editado: true })] }));
    apiPut.mockResolvedValue(texto());
    montar();
    await userEvent.click(await within(secao()).findByText('Texto da DM por matéria (1)'));
    const item = within(secao()).getByRole('listitem', { name: 'Texto da DM de ep-01 matéria 1' });
    await userEvent.click(within(item).getByRole('button', { name: 'Editar' }));
    const caixa = within(item).getByRole('textbox', { name: 'Texto da DM' });
    await userEvent.clear(caixa);
    await userEvent.type(caixa, 'ação');
    expect(item).toHaveTextContent('6 de 1000 bytes');
    await userEvent.click(within(item).getByRole('button', { name: 'Salvar texto' }));
    expect(apiPut).toHaveBeenCalledWith('/pauta/episodios/e1/dm/item-1', { texto: 'ação' }, 'tok');

    await userEvent.click(await within(item).findByRole('button', { name: 'Voltar ao padrão' }));
    expect(apiPut).toHaveBeenLastCalledWith('/pauta/episodios/e1/dm/item-1', { texto: null }, 'tok');
  });

  it('o texto acima de 1000 bytes trava o salvar com a frase da Meta', async () => {
    apiGet.mockResolvedValue(fila({ linhas: [], pendentes: 0 }));
    montar();
    await userEvent.click(await within(secao()).findByText('Texto da DM por matéria (1)'));
    const item = within(secao()).getByRole('listitem', { name: 'Texto da DM de ep-01 matéria 1' });
    await userEvent.click(within(item).getByRole('button', { name: 'Editar' }));
    const caixa = within(item).getByRole('textbox', { name: 'Texto da DM' });
    await userEvent.clear(caixa);
    // 600 "ç" são 600 caracteres e 1200 bytes.
    await userEvent.click(caixa);
    await userEvent.paste('ç'.repeat(600));
    expect(item).toHaveTextContent('1200 de 1000 bytes');
    expect(item).toHaveTextContent(/a Meta mede em bytes/);
    expect(within(item).getByRole('button', { name: 'Salvar texto' })).toBeDisabled();
  });

  it('sem pauta.editar não há editar nem preparar', async () => {
    apiGet.mockResolvedValue(fila({ linhas: [], pendentes: 0, textos: [texto(), texto({ itemId: 'x', texto: null, link: null, motivo: '"Preparar os textos da DM".' })] }));
    montar({ editavel: false });
    await userEvent.click(await within(secao()).findByText('Texto da DM por matéria (2)'));
    expect(within(secao()).queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(within(secao()).queryByRole('button', { name: /Preparar/ })).toBeNull();
  });
});

describe('a rotina que monta a fila', () => {
  it('abre de 10 em 10 minutos em São Paulo, diz que só lê, e cria sem config', async () => {
    apiPost.mockResolvedValue({ id: 'r3' });
    const onCriada = vi.fn();
    render(<NovaRotinaDeComentarios token="tok" onCriada={onCriada} />);
    await userEvent.click(screen.getByRole('button', { name: 'Nova rotina de comentários' }));
    expect(screen.getByLabelText(/Quando/)).toHaveValue('*/10 * * * *');
    expect(screen.getByText(/META_WEBHOOK_PESSOA_HMAC_KEY/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Criar rotina' }));
    await waitFor(() => expect(onCriada).toHaveBeenCalledTimes(1));
    expect(apiPost).toHaveBeenCalledWith(
      '/rotinas',
      { nome: 'Comentários com palavra-chave', slug: 'comentarios-com-palavra', tipo: 'pauta.coletar-comentarios', cron: '*/10 * * * *', tz: 'America/Sao_Paulo', estado: 'rodando', config: {} },
      'tok',
    );
  });
});
