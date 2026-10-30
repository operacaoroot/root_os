import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CartaoDeConflito, RespostaDosConflitos } from '@mktos/shared';

/*
 * A ABA CONFLITOS (agenda v2, 29/10/2026, lane G5): os cartões por urgência com
 * os botões, o pedido pronto indo a `POST /agenda/escritas` e a frase do que
 * aconteceu (saiu, ou foi para a fila), a rota do vigia, os filtros e o "Fora da
 * tela". O histórico é o da lane D (aqui, um dublê).
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api')>('@/lib/api')),
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, can: () => true }) }));
vi.mock('@/app/agenda/abas/Historico', () => ({ Historico: () => <div data-historico="">histórico</div> }));

import { AbaConflitos } from '@/app/agenda/abas/AbaConflitos';

const antes = { titulo: 'Reunião Online - Campo Bom - Rodrigo', inicio: '2026-11-04T12:00:00.000Z', fim: '2026-11-04T13:00:00.000Z', local: null, meet: true };

const CHOQUE: CartaoDeConflito = {
  id: 'choque:a+b:Rodrigo', tipo: 'choque', urgencia: 8000, quando: '2026-11-04T12:00:00.000Z', pessoas: ['Rodrigo'],
  titulo: 'Rodrigo está em dois lugares ao mesmo tempo', frase: 'Rodrigo já tem Reunião Online - Promedical - Rodrigo das 09:00 às 10:00.',
  eventos: [
    { id: 'a', titulo: 'Reunião Online - Promedical - Rodrigo', inicio: '2026-11-04T12:00:00.000Z', fim: '2026-11-04T13:00:00.000Z' },
    { id: 'b', titulo: 'Reunião Online - Campo Bom - Rodrigo', inicio: '2026-11-04T12:00:00.000Z', fim: '2026-11-04T13:00:00.000Z' },
  ],
  acoes: [
    { tipo: 'empurrar', rotulo: 'Empurrar Campo Bom para 10:30', pedido: { acao: 'alterar', chave: 'k0000000000aa', eventoId: 'b', antes, depois: { inicio: '2026-11-04T13:30:00.000Z', fim: '2026-11-04T14:30:00.000Z' } } },
    { tipo: 'passar', rotulo: 'Passar Campo Bom para o Lucas (livre)', pedido: { acao: 'alterar', chave: 'k0000000000bb', eventoId: 'b', antes, depois: { responsaveis: ['Lucas'] } } },
    { tipo: 'remarcar', rotulo: 'Remarcar…', pedido: null },
  ],
  serieId: null, confirmado: false,
};
const PADRAO: CartaoDeConflito = {
  id: 'padrao:v', tipo: 'padrao', urgencia: 9000, quando: '2026-11-04T18:00:00.000Z', pessoas: ['Lucas'], titulo: '"call com cliente novo"',
  frase: 'Fora do padrão. proposta: Reunião Online - Juma - Lucas + link do Meet', eventos: [{ id: 'v', titulo: 'call com cliente novo', inicio: '2026-11-04T18:00:00.000Z', fim: '2026-11-04T19:00:00.000Z' }],
  acoes: [
    { tipo: 'aplicar_titulo', rotulo: 'Aplicar título', pedido: null, rota: { metodo: 'POST', caminho: '/agenda/padronizar/v' } },
    { tipo: 'nao_e_reuniao', rotulo: 'Não é reunião', pedido: null, rota: { metodo: 'POST', caminho: '/pendencias/p1/responder', corpo: { escolha: 'nao-e-reuniao' } } },
  ],
  serieId: null, confirmado: false,
};
const JANELA: CartaoDeConflito = {
  id: 'janela:h', tipo: 'janela', urgencia: 7000, quando: '2026-11-03T19:00:00.000Z', pessoas: ['Lucas'], titulo: 'Custeio',
  frase: 'Falta o trajeto de 30 min antes da presencial.', eventos: [{ id: 'h', titulo: 'Reunião Presencial - Custeio - Lucas', inicio: '2026-11-03T19:00:00.000Z', fim: '2026-11-03T20:00:00.000Z' }],
  acoes: [{ tipo: 'manter', rotulo: 'Deixar assim', pedido: null }], serieId: null, confirmado: false,
};
const FERIADO: CartaoDeConflito = {
  id: 'feriado:f', tipo: 'feriado', urgencia: 5000, quando: '2026-11-02T13:00:00.000Z', pessoas: ['Pedro'], titulo: 'Acme marcado no feriado',
  frase: 'Feriado: Finados (seg 02/11). Agenda fechada.', eventos: [{ id: 'f', titulo: 'Reunião Online - Acme - Pedro', inicio: '2026-11-02T13:00:00.000Z', fim: '2026-11-02T14:00:00.000Z' }],
  acoes: [{ tipo: 'levar_para_dia_util', rotulo: 'Levar para ter 03/11, mesmo horário', pedido: { acao: 'alterar', chave: 'k0000000000cc', eventoId: 'f', antes, depois: { inicio: '2026-11-03T13:00:00.000Z', fim: '2026-11-03T14:00:00.000Z' } } }],
  serieId: null, confirmado: false,
};

const RESPOSTA: RespostaDosConflitos = {
  cartoes: [FERIADO, JANELA, CHOQUE, PADRAO],
  vigiaPassouEm: '2026-10-29T17:15:00.000Z',
  contagem: { tudo: 4, choque: 1, padrao: 1, sem_meet: 0, rito: 0, feriado: 1, janela: 1, fora: 0, teto: 0 },
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-29T17:20:00.000Z'));
  apiGet.mockReset();
  apiPost.mockReset();
  apiGet.mockImplementation((path: string) => {
    if (path.startsWith('/agenda/conflitos')) {
      const socio = new URLSearchParams(path.split('?')[1]).get('socio');
      return Promise.resolve(socio ? { ...RESPOSTA, cartoes: RESPOSTA.cartoes.filter((c) => c.pessoas.includes(socio as never)) } : RESPOSTA);
    }
    return Promise.resolve([]);
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('a aba Conflitos', () => {
  it('desenha o topo, o selo do vigia, os cartões e o "Fora da tela"', async () => {
    render(<AbaConflitos />);
    expect(await screen.findByText('Rodrigo está em dois lugares ao mesmo tempo')).toBeInTheDocument();
    expect(screen.getByText(/Quatro coisas pedem/)).toBeInTheDocument();
    expect(screen.getByText(/vigia AG-01 passou às 14:15/)).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/agenda/conflitos?dias=60', 'tok');
    // O feriado vai ao canto, não à lista principal.
    const canto = document.querySelector('[data-fora-da-tela]') as HTMLElement;
    expect(within(canto).getByText('Levar para ter 03/11, mesmo horário')).toBeInTheDocument();
    expect(document.querySelectorAll('section [data-cartao-de-conflito]')).toHaveLength(3);
    expect(document.querySelector('[data-historico]')).not.toBeNull();
    expect(screen.getByText('qua 04/11 · 09:00 · em 6 dias')).toBeInTheDocument();
  });

  it('o botão manda o pedido pronto e diz que saiu', async () => {
    apiPost.mockResolvedValue({ status: 'executado', nivel: 'R2', eventoId: 'b', approvalId: null, precisaDeOutraPessoa: false, mensagem: '', desfazer: null });
    const aoMudar = vi.fn();
    render(<AbaConflitos aoMudar={aoMudar} />);
    fireEvent.click(await screen.findByText('Empurrar Campo Bom para 10:30'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/agenda/escritas', CHOQUE.acoes[0].pedido, 'tok'));
    expect(await screen.findByText('Saiu: gravado no Google e no histórico.')).toBeInTheDocument();
    expect(aoMudar).toHaveBeenCalled();
  });

  it('retido, diz que foi para a fila de aprovação', async () => {
    apiPost.mockResolvedValue({ status: 'aguardando_aprovacao', nivel: 'R3', eventoId: null, approvalId: 'ap1', precisaDeOutraPessoa: true, mensagem: '', desfazer: null });
    render(<AbaConflitos />);
    fireEvent.click(await screen.findByText('Passar Campo Bom para o Lucas (livre)'));
    expect(await screen.findByText(/Foi para a fila de aprovação/)).toBeInTheDocument();
  });

  it('a ação do vigia vai à rota do vigia, com o corpo pronto', async () => {
    apiPost.mockResolvedValue({ ok: true });
    render(<AbaConflitos />);
    fireEvent.click(await screen.findByText('Não é reunião'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/pendencias/p1/responder', { escolha: 'nao-e-reuniao' }, 'tok'));
    expect(await screen.findByText(/Anotado: não é reunião/)).toBeInTheDocument();
  });

  it('"Remarcar…" abre o painel da página; "Deixar assim" tira o cartão da tela', async () => {
    const aoRemarcar = vi.fn();
    render(<AbaConflitos aoRemarcar={aoRemarcar} />);
    await screen.findByText('Rodrigo está em dois lugares ao mesmo tempo');
    const choque = document.querySelector('[data-cartao-de-conflito="choque:a+b:Rodrigo"]') as HTMLElement;
    fireEvent.click(within(choque).getByText('Remarcar…'));
    expect(aoRemarcar).toHaveBeenCalledWith('a');
    fireEvent.click(screen.getByText('Deixar assim'));
    await waitFor(() => expect(document.querySelector('[data-cartao-de-conflito="janela:h"]')).toBeNull());
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('filtra por tipo na tela e por sócio na API', async () => {
    render(<AbaConflitos />);
    await screen.findByText('Rodrigo está em dois lugares ao mesmo tempo');
    fireEvent.click(screen.getByRole('button', { name: /^Padrão/ }));
    expect(screen.queryByText('Rodrigo está em dois lugares ao mesmo tempo')).toBeNull();
    expect(screen.getByText('"call com cliente novo"')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Tudo/ }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Filtrar por sócio' })).getByText('Pedro'));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/agenda/conflitos?dias=60&socio=Pedro', 'tok'));
  });
});
