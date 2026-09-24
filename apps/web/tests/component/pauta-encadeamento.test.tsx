import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * O ENCADEAMENTO — MD1, o lado da tela.
 *
 * Três lugares: a aba Semana mostra o slot PROPOSTO em cinza, com "proposto,
 * falta aprovar" e sem ação de agenda ou postagem; /rotinas oferece "Nova
 * rotina de encadeamento" com o corpo que o POST /rotinas espera; e o detalhe
 * do episódio diz o próximo passo automático.
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

let permissoes = ['pauta.ver', 'pauta.editar', 'pauta.publicar', 'automacoes.ver', 'automacoes.executar'];
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u1', name: 'Pedro', email: 'p@x.com', roles: [], permissions: permissoes },
    can: (p: string) => permissoes.includes(p),
  }),
}));

// eslint-disable-next-line import/first
import { AbaSemana, ehProposta } from '@/app/pauta/AbaSemana';
// eslint-disable-next-line import/first
import { NovaRotinaDeEncadeamento } from '@/app/rotinas/NovaRotinaDeEncadeamento';
// eslint-disable-next-line import/first
import { LinhaDoEncadeamento, textoDoEncadeamento } from '@/app/pauta/LinhaDoEncadeamento';
// eslint-disable-next-line import/first
import RotinasPage from '@/app/rotinas/page';

function peca(over: Record<string, unknown> = {}) {
  return {
    id: 'p1', formato: 'carrossel', status: 'rascunho', titulo: 'O preço caiu', legenda: 'Legenda', palavraChave: 'PRECO',
    episodioId: 'e4', apelido: 'ep-04', itemN: 1, materia: 'Preço do modelo caiu pela metade', em: '2026-09-28T15:00:00.000Z',
    agendadaPara: null, slotProposto: '2026-09-28T15:00:00.000Z', midia: { onde: 'nenhuma', comando: '/root-midia carrosseis ep-04' },
    postada: null, motivoParaNaoAgendar: null, ...over,
  };
}

const dia = (d: string, diaDaSemana: string, linhas: unknown[] = []) => ({ dia: d, diaDaSemana, feriado: null, linhas });

function agenda() {
  return {
    de: '2026-09-28', ate: '2026-10-04', fuso: 'America/Sao_Paulo', hoje: '2026-09-28', origemDaGrade: 'padrao', grade: { slots: [], feriados: [] },
    dias: [
      dia('2026-09-28', 'seg', [
        { hora: '12:00', formato: 'carrossel', em: '2026-09-28T15:00:00.000Z', daGrade: true, peca: peca() },
      ]),
      dia('2026-09-29', 'ter', [
        {
          hora: '18:00', formato: 'corte', em: '2026-09-29T21:00:00.000Z', daGrade: true,
          peca: peca({ id: 'p2', formato: 'corte', status: 'aprovada', titulo: 'Corte', slotProposto: '2026-09-29T21:00:00.000Z' }),
        },
      ]),
      dia('2026-09-30', 'qua', [
        {
          hora: '12:00', formato: 'carrossel', em: '2026-09-30T15:00:00.000Z', daGrade: true,
          peca: peca({ id: 'p3', status: 'aprovada', titulo: 'Agendada de verdade', agendadaPara: '2026-09-30T15:00:00.000Z', slotProposto: null, midia: { onde: 'storage', imagens: [1], esperadas: 1 } }),
        },
      ]),
      dia('2026-10-01', 'qui'),
      dia('2026-10-02', 'sex'),
      dia('2026-10-03', 'sab'),
      dia('2026-10-04', 'dom'),
    ],
    paraDistribuir: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  permissoes = ['pauta.ver', 'pauta.editar', 'pauta.publicar', 'automacoes.ver', 'automacoes.executar'];
});

describe('aba Semana: o slot proposto', () => {
  it('aparece em cinza com "proposto, falta aprovar", sem reagendar nem marcar como postada', async () => {
    apiGet.mockResolvedValue(agenda());
    render(<AbaSemana token="tok" editavel podePostar onErro={vi.fn()} bump={0} />);
    const seg = await screen.findByRole('region', { name: 'Seg 28/09' });
    const proposta = within(seg).getByLabelText('Carrossel proposto de ep-04');
    expect(proposta).toHaveTextContent('proposto, falta aprovar');
    expect(proposta).toHaveTextContent('O preço caiu');
    expect(proposta.className).toContain('opacity-80');
    expect(within(seg).queryByRole('button', { name: 'Reagendar' })).toBeNull();
    expect(within(seg).queryByRole('button', { name: 'Marcar como postada' })).toBeNull();

    // A aprovada que ainda só tem o proposto: falta distribuir.
    expect(within(screen.getByRole('region', { name: 'Ter 29/09' })).getByLabelText('Corte vertical proposto de ep-04')).toHaveTextContent('proposto, falta distribuir');
    // A agendada de verdade continua com as ações de sempre.
    const qua = screen.getByRole('region', { name: 'Qua 30/09' });
    expect(within(qua).getByLabelText('Carrossel de ep-04')).toHaveTextContent('Agendada de verdade');
    expect(within(qua).getByRole('button', { name: 'Reagendar' })).toBeInTheDocument();
  });

  it('proposta é só a peça sem agenda, sem postagem e com slot proposto', () => {
    expect(ehProposta(peca() as never)).toBe(true);
    expect(ehProposta(peca({ agendadaPara: '2026-09-28T15:00:00.000Z' }) as never)).toBe(false);
    expect(ehProposta(peca({ slotProposto: null }) as never)).toBe(false);
    expect(ehProposta(peca({ slotProposto: undefined }) as never)).toBe(false);
    expect(ehProposta(peca({ postada: { em: 'x', manual: true, url: null } }) as never)).toBe(false);
  });
});

describe('nova rotina de encadeamento', () => {
  it('abre com a cada 5 minutos em São Paulo e todas as etapas; criar manda config vazia', async () => {
    apiPost.mockResolvedValue({ id: 'r1' });
    const onCriada = vi.fn();
    render(<NovaRotinaDeEncadeamento token="tok" onCriada={onCriada} />);
    await userEvent.click(screen.getByRole('button', { name: 'Nova rotina de encadeamento' }));
    expect(screen.getByLabelText(/Quando/)).toHaveValue('*/5 * * * *');
    expect(screen.getByLabelText(/Fuso/)).toHaveValue('America/Sao_Paulo');
    expect(screen.getByText(/Nada é publicado/)).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox').every((c) => (c as HTMLInputElement).checked)).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Criar rotina' }));
    await waitFor(() => expect(onCriada).toHaveBeenCalledTimes(1));
    expect(apiPost).toHaveBeenCalledWith(
      '/rotinas',
      { nome: 'Encadeamento da pauta', slug: 'encadeamento-da-pauta', tipo: 'pauta.encadear', cron: '*/5 * * * *', tz: 'America/Sao_Paulo', estado: 'rodando', config: {} },
      'tok',
    );
  });

  it('desmarcar etapas manda só as que ficaram, na ordem do caminho; nenhuma marcada não cria', async () => {
    apiPost.mockResolvedValue({ id: 'r1' });
    render(<NovaRotinaDeEncadeamento token="tok" onCriada={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Nova rotina de encadeamento' }));
    await userEvent.click(screen.getByLabelText(/gerar o pacote/));
    await userEvent.click(screen.getByLabelText(/montar a página/));
    await userEvent.click(screen.getByRole('button', { name: 'Criar rotina' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    expect(apiPost.mock.calls[0][1]).toMatchObject({ config: { etapas: ['newsletter', 'semana', 'slots'] } });

    // O formulário fecha ao criar; reaberto, desmarcar tudo trava o botão.
    await userEvent.click(screen.getByRole('button', { name: 'Nova rotina de encadeamento' }));
    for (const c of screen.getAllByRole('checkbox')) if ((c as HTMLInputElement).checked) await userEvent.click(c);
    expect(screen.getByRole('button', { name: 'Criar rotina' })).toBeDisabled();
  });

  it('/rotinas oferece o botão só com o tipo disponível e sem rotina de encadeamento criada', async () => {
    const lista = (tipos: string[], items: unknown[] = []) => ({
      items, execucoes: [], agendadorAtivo: true, pautaDesligadaPorVariavel: false, descobertaCega: false, tiposDisponiveis: tipos, avisos: [],
      source: { tool: 'banco-interno', generatedAt: '' },
    });
    apiGet.mockResolvedValue(lista(['pauta.coleta', 'pauta.encadear']));
    const { unmount } = render(<RotinasPage />);
    expect(await screen.findByRole('button', { name: 'Nova rotina de encadeamento' })).toBeInTheDocument();
    unmount();

    apiGet.mockResolvedValue(lista(['pauta.coleta']));
    render(<RotinasPage />);
    await screen.findByRole('button', { name: 'Nova rotina de coleta' });
    expect(screen.queryByRole('button', { name: 'Nova rotina de encadeamento' })).toBeNull();
  });
});

describe('o próximo passo automático no detalhe do episódio', () => {
  const detalhe = (status: string) => ({ id: 'e1', status }) as never;
  const estado = (over: Record<string, unknown> = {}) => ({
    episodioId: 'e1', passo: 'semana', motivo: null, etapas: [], rotina: { existe: true, dispara: true, nome: 'Encadeamento da pauta', calada: null }, ultimos: [], ...over,
  });

  it('no Pacote/Derivação consulta a API e diz o passo; sem a rotina, avisa que nada anda sozinho', async () => {
    apiGet.mockResolvedValue(estado({ rotina: { existe: false, dispara: false, nome: null, calada: null } }));
    render(<LinhaDoEncadeamento token="tok" detalhe={detalhe('pacote')} />);
    const linha = await screen.findByLabelText('Próximo passo automático');
    await waitFor(() => expect(linha).toHaveTextContent('gerar a semana de posts.'));
    expect(linha).toHaveTextContent('Sem a rotina de encadeamento em /rotinas, nada anda sozinho.');
    expect(apiGet).toHaveBeenCalledWith('/pauta/episodios/e1/encadeamento', 'tok');
  });

  it('antes da transcrição não consulta; depois de Agendado some', () => {
    const { unmount } = render(<LinhaDoEncadeamento token="tok" detalhe={detalhe('edicao')} />);
    expect(screen.getByLabelText('Próximo passo automático')).toHaveTextContent('nenhum até a transcrição chegar do Mac.');
    unmount();
    render(<LinhaDoEncadeamento token="tok" detalhe={detalhe('agendado')} />);
    expect(screen.queryByLabelText('Próximo passo automático')).toBeNull();
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('parado, com o motivo; rotina pausada também aparece', () => {
    expect(textoDoEncadeamento(estado({ passo: 'parar', motivo: '3 peça(s) em rascunho aguardando aprovação.' }) as never)).toBe(
      'parado — 3 peça(s) em rascunho aguardando aprovação.',
    );
    expect(textoDoEncadeamento(estado({ rotina: { existe: true, dispara: false, nome: 'x', calada: null } }) as never)).toMatch(/não está disparando/);
  });

  it('com o agendador calado por variável, diz qual — e não que a rotina vai andar', () => {
    const t = textoDoEncadeamento(estado({ rotina: { existe: true, dispara: false, nome: 'x', calada: 'PAUTA_CRON=off' } }) as never);
    expect(t).toBe('gerar a semana de posts. A rotina de encadeamento existe, mas o agendador está calado neste servidor (PAUTA_CRON=off).');
  });
});
