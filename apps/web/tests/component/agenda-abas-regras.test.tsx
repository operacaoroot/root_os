import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RegrasDaAgenda, RelatorioDaAgenda } from '@mktos/shared';

/*
 * AS ABAS REGRAS E RELATÓRIOS (agenda v2, 29/10/2026, lanes G2 e G5): o desenho
 * `Regras` com os valores semeados, a edição inline só com `podeEditar`, e o
 * relatório com as contagens. Dados fictícios.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api')>('@/lib/api')),
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPut: (...a: unknown[]) => apiPut(...a),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, can: () => true }) }));

import { AbaRegras } from '@/app/agenda/abas/AbaRegras';
import { AbaRelatorios } from '@/app/agenda/abas/AbaRelatorios';

const pessoa = (id: string, nome: 'Rodrigo' | 'Lucas' | 'Pedro', over = {}) => ({
  id, nome, area: null as string | null, email: `${nome.toLowerCase()}@casa.teste` as string | null, janela: { inicio: '08:00', fim: '18:00' },
  intervaloMin: 15, trajetoMin: 30, tetoPorDia: 5, bloqueiosFixos: [] as Array<{ diaDaSemana: number; inicio: string; fim?: string | null }>,
  emailPessoal: null as string | null, fechadoLigado: false, substituto: 'Rodrigo' as 'Rodrigo' | 'Lucas' | 'Pedro' | null, ...over,
});

const REGRAS = (podeEditar: boolean): RegrasDaAgenda => ({
  podeEditar,
  pessoas: [
    pessoa('p1', 'Rodrigo', { area: 'onboarding e contrato', janela: { inicio: '08:00', fim: '19:00' }, bloqueiosFixos: [{ diaDaSemana: 4, inicio: '19:00', fim: null }], fechadoLigado: true, substituto: 'Lucas' }),
    pessoa('p2', 'Lucas', { area: 'marca e marketing', janela: { inicio: '09:00', fim: '18:00' }, tetoPorDia: 4 }),
    pessoa('p3', 'Pedro', { area: 'FinOps', janela: { inicio: '08:30', fim: '18:00' }, intervaloMin: 10, email: null }),
  ],
  ritos: [
    { id: 'r1', nome: 'Reunião Interna - Todos (pauta da semana)', titulo: 'Reunião Interna - Todos', diaDaSemana: 2, ordinalNoMes: null, inicio: '08:00', duracaoMin: 60, quem: 'Todos', politica: 'pergunta', ligado: true, aDecidir: true },
    { id: 'r2', nome: 'Sábado da Root', titulo: 'Sábado da Root', diaDaSemana: 6, ordinalNoMes: 1, inicio: null, duracaoMin: 1440, quem: 'Todos', politica: 'bloqueia', ligado: true, aDecidir: false },
  ],
  feriados: [
    { id: 'f1', data: '2026-11-02', nome: 'Finados', tipo: 'nacional', cidade: null, ligado: true },
    { id: 'f2', data: '2026-11-15', nome: 'Proclamação da República', tipo: 'nacional', cidade: null, ligado: true },
    { id: 'f3', data: '2027-02-08', nome: 'Carnaval', tipo: 'facultativo', cidade: null, ligado: false },
  ],
  textos: [
    { id: 't1', frase: 'Cliente novo só depois das 10h na segunda.', ligada: true },
    { id: 't3', frase: 'Sexta depois das 16h só interna.', ligada: false },
  ],
});

let regras: RegrasDaAgenda;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-29T17:20:00.000Z'));
  apiGet.mockReset();
  apiPost.mockReset();
  apiPut.mockReset();
  regras = REGRAS(true);
  apiGet.mockImplementation((path: string) => (path === '/agenda/regras' ? Promise.resolve(regras) : Promise.resolve(RELATORIO)));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('a aba Regras', () => {
  it('desenha as três colunas, os ritos, a nomenclatura, os feriados e as frases', async () => {
    render(<AbaRegras />);
    const rodrigo = (await screen.findByText('onboarding e contrato')).closest('[data-regra-pessoa]') as HTMLElement;
    expect(within(rodrigo).getByText('08:00 a 19:00')).toBeInTheDocument();
    expect(within(rodrigo).getByText('qui a partir de 19:00')).toBeInTheDocument();
    expect(within(rodrigo).getByText('LIGADA')).toBeInTheDocument();
    expect(within(rodrigo).getByText(/sem o e-mail da agenda pessoal/)).toBeInTheDocument();
    const pedro = document.querySelector('[data-regra-pessoa="Pedro"]') as HTMLElement;
    expect(within(pedro).getByText('10 min')).toBeInTheDocument();
    expect(within(pedro).getByText('sem e-mail na Equipe')).toBeInTheDocument();
    expect(screen.getByText('ter 08:00 · 1 h')).toBeInTheDocument();
    expect(screen.getByText('[a decidir]')).toBeInTheDocument();
    expect(screen.getByText('1º sáb · dia inteiro')).toBeInTheDocument();
    expect(screen.getByText('Nome Fora - motivo')).toBeInTheDocument();
    expect(screen.getByText('FECHAM A AGENDA')).toBeInTheDocument();
    expect(screen.getByText('02/11 Finados · 15/11 Proclamação da República')).toBeInTheDocument();
    expect(screen.getByText('DESLIGADA')).toBeInTheDocument();
  });

  it('sem `podeEditar`, nada de editar', async () => {
    regras = REGRAS(false);
    render(<AbaRegras />);
    await screen.findByText('onboarding e contrato');
    expect(screen.queryByText(/^Editar /)).toBeNull();
    expect(screen.queryByText('+ Nova regra')).toBeNull();
    expect(screen.queryByText('adicionar cidade…')).toBeNull();
    expect(screen.getByText(/editar é dos sócios/)).toBeInTheDocument();
  });

  it('editar a régua de um sócio manda o PUT com os campos', async () => {
    apiPut.mockImplementation((_p: string, corpo: Record<string, unknown>) => Promise.resolve({ ...regras.pessoas[1], ...corpo }));
    render(<AbaRegras />);
    await screen.findByText('marca e marketing');
    fireEvent.click(screen.getByText('Editar Lucas'));
    const lucas = document.querySelector('[data-regra-pessoa="Lucas"]') as HTMLElement;
    fireEvent.change(within(lucas).getByLabelText('tetoPorDia'), { target: { value: '3' } });
    fireEvent.click(within(lucas).getByText('Salvar'));
    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    const [path, corpo] = apiPut.mock.calls[0];
    expect(path).toBe('/agenda/regras/pessoa/p2');
    expect(corpo).toMatchObject({ tetoPorDia: 3, janela: { inicio: '09:00', fim: '18:00' }, substituto: 'Rodrigo' });
  });

  it('adicionar cidade e nova regra em frase', async () => {
    apiPost.mockImplementation((path: string, corpo: Record<string, unknown>) =>
      Promise.resolve(path === '/agenda/feriados' ? { id: 'm1', tipo: 'municipal', ligado: true, ...corpo } : { id: 't9', ligada: true, ...corpo }),
    );
    render(<AbaRegras />);
    await screen.findByText('onboarding e contrato');
    fireEvent.click(screen.getByText('adicionar cidade…'));
    fireEvent.change(screen.getByLabelText('data do feriado municipal'), { target: { value: '2026-05-31' } });
    fireEvent.change(screen.getByLabelText('nome do feriado municipal'), { target: { value: 'Aniversário da cidade' } });
    fireEvent.change(screen.getByLabelText('cidade'), { target: { value: 'Cidade Fictícia' } });
    fireEvent.click(screen.getByText('Adicionar'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/agenda/feriados', { data: '2026-05-31', nome: 'Aniversário da cidade', cidade: 'Cidade Fictícia' }, 'tok'));
    expect(await screen.findByText(/Aniversário da cidade · Cidade Fictícia/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('nova regra em frase'), { target: { value: 'Nada na hora do almoço.' } });
    fireEvent.click(screen.getByText('+ Nova regra'));
    expect(await screen.findByText('Nada na hora do almoço.')).toBeInTheDocument();
  });

  it('ligar uma regra em frase', async () => {
    apiPut.mockResolvedValue({ id: 't3', frase: 'Sexta depois das 16h só interna.', ligada: true });
    render(<AbaRegras />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sexta depois das 16h só interna.' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/agenda/regras-texto/t3', { ligada: true }, 'tok'));
  });
});

const RELATORIO: RelatorioDaAgenda = {
  de: '2026-10-01',
  ate: '2026-10-31',
  porSocio: [
    { socio: 'Rodrigo', total: 4, porTipo: { cliente: 3, interna: 1 } },
    { socio: 'Lucas', total: 2, porTipo: { cliente: 1, interna: 1 } },
    { socio: 'Pedro', total: 1, porTipo: { interna: 1 } },
  ],
  porTipo: { cliente: 4, interna: 1 },
  semMeet: [{ id: 'x', titulo: 'Reunião Online - Clube Modelo - Lucas', inicio: '2026-11-05T13:00:00.000Z' }],
  responsavelSemEmail: ['Pedro'],
  marcadosAssimMesmo: [{ eventoId: 'z', titulo: 'Reunião Online - Zeta - Rodrigo', inicio: '2026-10-21T12:00:00.000Z', motivo: 'cliente só podia nesse horário', quem: 'Rodrigo Teste', quando: '2026-10-20T12:00:00.000Z' }],
  criadosDiretoNoGoogle: 3,
};

describe('a aba Relatórios', () => {
  it('mostra as contagens, o sem Meet, o sem e-mail e o marcado assim mesmo', async () => {
    render(<AbaRelatorios />);
    expect(await screen.findByText('cliente só podia nesse horário')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/agenda/relatorios', 'tok');
    expect(screen.getByText('Reunião Online - Clube Modelo - Lucas')).toBeInTheDocument();
    expect(screen.getByText(/Pedro: sem e-mail na Equipe/)).toBeInTheDocument();
    expect(screen.getByText('Rodrigo Teste')).toBeInTheDocument();
    const tipo = document.querySelector('[data-por-tipo]') as HTMLElement;
    expect(within(tipo).getByText('3')).toBeInTheDocument();
  });

  it('trocar o período pede de novo', async () => {
    render(<AbaRelatorios />);
    await screen.findByText('cliente só podia nesse horário');
    fireEvent.change(screen.getByLabelText('de'), { target: { value: '2026-09-01' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/agenda/relatorios?de=2026-09-01&ate=2026-10-31', 'tok'));
  });
});
