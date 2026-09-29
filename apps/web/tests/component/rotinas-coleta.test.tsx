import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * "NOVA ROTINA DE COLETA" EM /rotinas — MC5.
 *
 * A tela oferece a coleta de quinta com os padrões do episódio (quinta 22h em
 * São Paulo, janela de 168h) e manda o corpo que o `POST /rotinas` espera. O
 * botão só aparece para quem edita rotina e quando o executor está inscrito na
 * API. A validação de verdade é da API; aqui só se cobra o que a tela envia.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
    apiPatch: (...a: unknown[]) => apiPatch(...a),
  };
});

let permissoes = ['automacoes.ver', 'automacoes.executar'];
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u1', name: 'Pedro', email: 'p@x.com', roles: [], permissions: permissoes },
    can: (p: string) => permissoes.includes(p),
  }),
}));

// eslint-disable-next-line import/first
import RotinasPage from '@/app/rotinas/page';
// eslint-disable-next-line import/first
import { NovaRotinaDeColeta } from '@/app/rotinas/NovaRotinaDeColeta';

function rotinaDeColeta() {
  return {
    id: 'r-coleta',
    slug: 'coleta-semanal-da-pauta',
    nome: 'Coleta semanal da pauta',
    tipo: 'pauta.coleta',
    temExecutor: true,
    cron: '0 22 * * 4',
    tz: 'America/Sao_Paulo',
    ativo: true,
    estado: 'rodando',
    dispara: true,
    origem: 'manual',
    agenteSlug: 'editor-de-pauta',
    execucoes: 0,
    falhas: 0,
    ultimaExecucaoEm: null,
    ultimoStatus: null,
    proximaExecucaoEm: null,
    minutosPorExecucao: null,
    minutosDevolvidos: null,
  };
}

function lista(tipos: string[] | undefined, items: unknown[] = []) {
  return {
    items,
    execucoes: [],
    agendadorAtivo: true,
    pautaDesligadaPorVariavel: false,
    descobertaCega: false,
    tiposDisponiveis: tipos,
    avisos: [],
    source: { tool: 'banco-interno', generatedAt: '' },
  };
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  apiPatch.mockReset();
  permissoes = ['automacoes.ver', 'automacoes.executar'];
});

function renderForm() {
  const onCriada = vi.fn();
  render(<NovaRotinaDeColeta token="tok" onCriada={onCriada} />);
  return { onCriada };
}

describe('nova rotina de coleta: o formulário', () => {
  it('abre com os padrões da quinta 22h em São Paulo e janela de uma semana', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Nova rotina de coleta' }));

    expect(screen.getByLabelText('Dia da semana')).toHaveValue('4');
    expect(screen.getByLabelText(/^Horário/)).toHaveValue('22:00');
    expect(screen.getByLabelText(/Fuso/)).toHaveValue('America/Sao_Paulo');
    expect(screen.getByLabelText(/Janela/)).toHaveValue(168);
    expect(screen.getByLabelText(/Estado/)).toHaveValue('rodando');
    expect(screen.getByText(/Quinta-feira, às 22:00/)).toBeInTheDocument();
  });

  it('criar manda o corpo do POST /rotinas com o tipo da coleta, fecha e avisa a página', async () => {
    apiPost.mockResolvedValue({ id: 'r1' });
    const { onCriada } = renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Nova rotina de coleta' }));
    const janela = screen.getByLabelText(/Janela/);
    await userEvent.clear(janela);
    await userEvent.type(janela, '72');
    await userEvent.click(screen.getByRole('button', { name: 'Criar rotina' }));

    await waitFor(() => expect(onCriada).toHaveBeenCalledTimes(1));
    expect(apiPost).toHaveBeenCalledWith(
      '/rotinas',
      {
        nome: 'Coleta semanal da pauta',
        slug: 'coleta-semanal-da-pauta',
        tipo: 'pauta.coleta',
        cron: '0 22 * * 4',
        tz: 'America/Sao_Paulo',
        estado: 'rodando',
        config: { horas: 72 },
      },
      'tok',
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Nova rotina de coleta' })).toBeInTheDocument();
  });

  it('o erro da API aparece dentro do card, perto do botão, e o formulário fica aberto', async () => {
    apiPost.mockRejectedValue(new Error('Já existe uma rotina "coleta-semanal-da-pauta" nesta empresa.'));
    const { onCriada } = renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Nova rotina de coleta' }));
    await userEvent.click(screen.getByRole('button', { name: 'Criar rotina' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Já existe uma rotina/);
    expect(onCriada).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Criar rotina' })).toBeInTheDocument();
  });

  it('cron sem os cinco campos ou janela fora de 6 a 336h trava o Criar', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Nova rotina de coleta' }));
    await userEvent.selectOptions(screen.getByLabelText('Como definir o horário'), 'avancado');
    const cron = screen.getByLabelText(/Quando/);
    await userEvent.clear(cron);
    await userEvent.type(cron, '0 22 * *');
    expect(screen.getByRole('button', { name: 'Criar rotina' })).toBeDisabled();
    await userEvent.type(cron, ' 4');
    expect(screen.getByRole('button', { name: 'Criar rotina' })).toBeEnabled();
    const janela = screen.getByLabelText(/Janela/);
    await userEvent.clear(janela);
    await userEvent.type(janela, '400');
    expect(screen.getByRole('button', { name: 'Criar rotina' })).toBeDisabled();
  });
});

describe('nova rotina de coleta: na tela /rotinas', () => {
  it('aparece quando o executor está inscrito e a pessoa edita rotina; criar recarrega a lista', async () => {
    apiGet.mockResolvedValue(lista(['pauta.coleta', 'pauta.rodada']));
    apiPost.mockResolvedValue({ id: 'r1' });
    render(<RotinasPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Nova rotina de coleta' }));
    await userEvent.click(screen.getByRole('button', { name: 'Criar rotina' }));

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    expect(apiGet).toHaveBeenLastCalledWith('/rotinas', 'tok');
  });

  it('não aparece sem o executor inscrito, nem para quem só lê', async () => {
    apiGet.mockResolvedValue(lista(['pauta.rodada']));
    const { unmount } = render(<RotinasPage />);
    await screen.findByText(/Nenhuma rotina nesta empresa/);
    expect(screen.queryByRole('button', { name: 'Nova rotina de coleta' })).toBeNull();
    unmount();

    permissoes = ['automacoes.ver'];
    apiGet.mockResolvedValue(lista(['pauta.coleta']));
    render(<RotinasPage />);
    await screen.findByText(/Nenhuma rotina nesta empresa/);
    expect(screen.queryByRole('button', { name: 'Nova rotina de coleta' })).toBeNull();
  });

  it('some quando a empresa já tem uma coleta, e a API sem o campo só esconde o botão', async () => {
    apiGet.mockResolvedValue(lista(['pauta.coleta'], [rotinaDeColeta()]));
    const { unmount } = render(<RotinasPage />);
    await screen.findByText('Coleta semanal da pauta');
    expect(screen.queryByRole('button', { name: 'Nova rotina de coleta' })).toBeNull();
    unmount();

    apiGet.mockResolvedValue(lista(undefined));
    render(<RotinasPage />);
    await screen.findByText(/Nenhuma rotina nesta empresa/);
    expect(screen.queryByRole('button', { name: 'Nova rotina de coleta' })).toBeNull();
  });

  it('"Rodar agora" que volta pulada mostra o motivo', async () => {
    apiGet.mockResolvedValue(lista(['pauta.coleta'], [rotinaDeColeta()]));
    apiPost.mockResolvedValue({ ok: true, status: 'pulada', resumo: 'nenhuma fonte ativa nas origens W, N — nada a coletar' });
    render(<RotinasPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Rodar agora' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Não rodou: nenhuma fonte ativa nas origens W, N — nada a coletar',
    );
    expect(apiPost).toHaveBeenCalledWith('/rotinas/r-coleta/rodar', {}, 'tok');
  });
});


describe('horário simples da coleta', () => {
  it('envia domingo à meia-noite com o fuso informado, sem converter para o fuso do navegador', async () => {
    apiPost.mockResolvedValue({ id: 'r1' });
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Nova rotina de coleta' }));
    await userEvent.selectOptions(screen.getByLabelText('Dia da semana'), '0');
    const hora = screen.getByLabelText(/^Horário/);
    fireEvent.change(hora, { target: { value: '00:00' } });
    const fuso = screen.getByLabelText('Fuso');
    await userEvent.clear(fuso);
    await userEvent.type(fuso, 'Europe/Lisbon');
    await userEvent.click(screen.getByRole('button', { name: 'Criar rotina' }));
    expect(apiPost).toHaveBeenCalledWith('/rotinas', expect.objectContaining({ cron: '0 0 * * 0', tz: 'Europe/Lisbon' }), 'tok');
  });

  it('preserva dia e horário ao alternar os modos', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Nova rotina de coleta' }));
    await userEvent.selectOptions(screen.getByLabelText('Dia da semana'), '6');
    fireEvent.change(screen.getByLabelText(/^Horário/), { target: { value: '23:59' } });
    await userEvent.selectOptions(screen.getByLabelText('Como definir o horário'), 'avancado');
    expect(screen.getByLabelText(/Quando/)).toHaveValue('59 23 * * 6');
    fireEvent.change(screen.getByLabelText(/Quando/), { target: { value: '15 8 * * 1' } });
    await userEvent.selectOptions(screen.getByLabelText('Como definir o horário'), 'simples');
    expect(screen.getByLabelText('Dia da semana')).toHaveValue('1');
    expect(screen.getByLabelText(/^Horário/)).toHaveValue('08:15');
  });

  it('mantém cron com frequência avançada e avisa em vez de substituí-lo', async () => {
    apiPost.mockResolvedValue({ id: 'r1' });
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Nova rotina de coleta' }));
    await userEvent.selectOptions(screen.getByLabelText('Como definir o horário'), 'avancado');
    fireEvent.change(screen.getByLabelText(/Quando/), { target: { value: '0 9 * * 1-5' } });
    await userEvent.selectOptions(screen.getByLabelText('Como definir o horário'), 'simples');
    expect(screen.getByRole('alert')).toHaveTextContent(/não representa/);
    expect(screen.getByLabelText('Como definir o horário')).toHaveValue('avancado');
    expect(screen.getByLabelText(/Quando/)).toHaveValue('0 9 * * 1-5');
    await userEvent.click(screen.getByRole('button', { name: 'Criar rotina' }));
    expect(apiPost).toHaveBeenCalledWith('/rotinas', expect.objectContaining({ cron: '0 9 * * 1-5' }), 'tok');
  });

  it('não cria quando falta horário e cancelar não envia nada', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Nova rotina de coleta' }));
    fireEvent.change(screen.getByLabelText(/^Horário/), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Criar rotina' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(apiPost).not.toHaveBeenCalled();
  });
});
