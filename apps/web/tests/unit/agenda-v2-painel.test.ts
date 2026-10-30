import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ClienteDaBuscaDaAgenda, ResultadoDaEscrita, ResultadoDaRegua } from '@mktos/shared';

/*
 * O PAINEL DE MARCAR (agenda v2, 29/10/2026, lane G3): a frase preenche só o
 * que disse, o título sai da função do servidor, o semáforo é o da régua, e a
 * escrita vai a `POST /agenda/escritas` com os quatro desfechos (saiu no clique
 * com desfazer, fila, vermelho com "marcar assim mesmo", recusado). Mais o link
 * de escolha, a busca do cliente com a ficha e o rascunho na sessão. Hoje =
 * quinta, 29/10/2026. Dados fictícios.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api')>('@/lib/api')),
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
}));

// O motor da régua é da lane G2; aqui ele responde o que o caso pede.
let respostaDaRegua: ResultadoDaRegua = { cor: 'verde', itens: [] };
const avaliar = vi.fn();
vi.mock('@mktos/shared', async () => {
  const real = await vi.importActual<typeof import('@mktos/shared')>('@mktos/shared');
  return { ...real, avaliarNaRegua: (...a: unknown[]) => { avaliar(...a); return respostaDaRegua; } };
});

import { PainelDeMarcar, CHAVE_DO_RASCUNHO } from '@/app/agenda/PainelDeMarcar';
import {
  aplicarFrase,
  desfechoDa,
  duracoesAte,
  motivoSemLink,
  pedidoDeCancelar,
  pedidoDeMarcar,
  rascunhoVazio,
  tituloDoRascunho,
} from '@/app/agenda/painel';
import { interpretarFrase, lerCompromisso, type EventoDaAgenda as EventoV2 } from '@mktos/shared';

const HOJE = '2026-10-29';
const BASE = rascunhoVazio('2026-11-02', '09:00');

function painel(extra: Record<string, unknown> = {}) {
  const aoEscrever = vi.fn();
  const aoFechar = vi.fn();
  const r = render(createElement(PainelDeMarcar, {
    modo: 'lado',
    edicao: null,
    inicial: BASE,
    eventos: [],
    regras: null,
    hoje: HOJE,
    clientesConhecidos: ['Fictícia Peças', 'Exemplaria'],
    token: 'tok',
    podeMarcar: true,
    aoFechar,
    aoEscrever,
    agora: new Date('2026-10-29T15:00:00Z'),
    ...extra,
  }));
  return { ...r, aoEscrever, aoFechar };
}

const titulo = () => (document.querySelector('[data-titulo-montado]') as HTMLElement).textContent;
const escrever = (texto: string) => fireEvent.change(screen.getByLabelText('Atalho'), { target: { value: texto } });
const resultado = (r: Partial<ResultadoDaEscrita>): ResultadoDaEscrita => ({
  status: 'executado', nivel: 'R2', eventoId: 'novo1', approvalId: null, precisaDeOutraPessoa: false, mensagem: '', desfazer: null, ...r,
});

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  avaliar.mockReset();
  respostaDaRegua = { cor: 'verde', itens: [] };
  sessionStorage.clear();
  apiGet.mockResolvedValue([]);
});
afterEach(cleanup);

describe('a conta do painel', () => {
  it('a frase sobre a base: só o que disse muda; apagar volta ao que era', () => {
    const base = { ...BASE, local: 'Sala 2', duracaoMin: 45 };
    const r = aplicarFrase(base, interpretarFrase('online com ficticia sexta 15h rodrigo', { hoje: HOJE, clientes: ['Fictícia Peças'] }));
    expect(r).toMatchObject({ tipo: 'cliente', cliente: 'Fictícia Peças', dia: '2026-10-30', hora: '15:00', responsaveis: ['Rodrigo'], duracaoMin: 45, local: 'Sala 2' });
    expect(aplicarFrase(base, interpretarFrase('', { hoje: HOJE }))).toEqual(base);
  });
  it('duração de 5 min até o fim do dia', () => {
    expect(duracoesAte('09:00')[0]).toBe(5);
    expect(duracoesAte('23:00').at(-1)).toBe(60);
    expect(duracoesAte('23:50')).toEqual([5, 10]);
  });
  it('o título é o do servidor; o que falta vira a frase', () => {
    expect(tituloDoRascunho({ ...BASE, cliente: 'Exemplaria', responsaveis: ['Lucas'], modalidade: 'presencial' }).titulo).toBe('Reunião Presencial - Exemplaria - Lucas');
    expect(tituloDoRascunho({ ...BASE, tipo: 'interna', responsaveis: ['Rodrigo', 'Lucas', 'Pedro'] }).titulo).toBe('Reunião Interna - Todos');
    expect(tituloDoRascunho({ ...BASE, tipo: 'bloqueio', responsaveis: ['Pedro'] }).titulo).toBe('Fechado Pedro');
    expect(tituloDoRascunho({ ...BASE, tipo: 'fora', responsaveis: ['Pedro'] }).falta).toMatch(/motivo do Fora/);
    expect(tituloDoRascunho(BASE).falta).toMatch(/Escolha quem vai/);
  });
  it('o pedido de marcar: instantes de São Paulo, cliente e convidados; e-mail torto recusa', () => {
    const p = pedidoDeMarcar({ ...BASE, cliente: 'Exemplaria', responsaveis: ['Lucas'], convidados: 'a@cliente.exemplo', pauta: 'proposta' }, 'k');
    expect(p).toEqual({
      acao: 'marcar',
      chave: 'k',
      compromisso: {
        tipo: 'cliente', modalidade: 'online', responsaveis: ['Lucas'], cliente: 'Exemplaria',
        inicio: '2026-11-02T12:00:00.000Z', fim: '2026-11-02T13:00:00.000Z', pauta: 'proposta', convidados: ['a@cliente.exemplo'],
      },
    });
    expect(() => pedidoDeMarcar({ ...BASE, cliente: 'Exemplaria', responsaveis: ['Lucas'], convidados: 'nao-e-email' }, 'k')).toThrow(/não parece um e-mail/);
    const fora = pedidoDeMarcar({ ...BASE, tipo: 'fora', responsaveis: ['Pedro'], motivo: 'viagem' }, 'k', { motivo: 'feriado, mas preciso' });
    expect(fora).toMatchObject({ compromisso: { tipo: 'fora', motivo: 'viagem' }, forcado: { motivo: 'feriado, mas preciso' } });
  });
  it('cancelar pede motivo', () => {
    const e = { id: 'x', titulo: 'Reunião Interna - Todos' } as EventoV2;
    expect(() => pedidoDeCancelar(e, '  ', true, 'k')).toThrow(/motivo/);
    expect(pedidoDeCancelar(e, 'cliente pediu', false, 'k')).toEqual({ acao: 'cancelar', chave: 'k', eventoId: 'x', tituloAtual: 'Reunião Interna - Todos', motivo: 'cliente pediu', avisar: false });
  });
  it('os quatro desfechos', () => {
    expect(desfechoDa(resultado({ desfazer: { acao: 'desmarcar', chave: 'd', eventoId: 'n', tituloAtual: 't' } })).tipo).toBe('saiu');
    expect(desfechoDa(resultado({ status: 'aguardando_aprovacao', approvalId: 'a1', precisaDeOutraPessoa: true })).texto).toMatch(/fila de aprovação\. Quem confirma é outra pessoa/);
    expect(desfechoDa(resultado({ status: 'recusado', regua: { cor: 'vermelho', itens: [] } })).tipo).toBe('regua');
    expect(desfechoDa(resultado({ status: 'recusado', mensagem: 'conector desligado' }))).toEqual({ tipo: 'recusado', texto: 'conector desligado' });
  });
  it('o link de escolha é de um sócio e de reunião', () => {
    expect(motivoSemLink({ ...BASE, responsaveis: ['Rodrigo', 'Lucas'] })).toMatch(/um sócio só/);
    expect(motivoSemLink({ ...BASE, tipo: 'bloqueio', responsaveis: ['Rodrigo'] })).toMatch(/reunião/);
    expect(motivoSemLink({ ...BASE, responsaveis: ['Rodrigo'] })).toBeNull();
  });
});

describe('o painel na tela', () => {
  it('a frase do desenho preenche os campos e o título', () => {
    painel();
    escrever('online com ficticia sexta 15h 1h rodrigo');
    expect(titulo()).toBe('Reunião Online - Fictícia Peças - Rodrigo');
    expect((screen.getByLabelText('Quando') as HTMLInputElement).value).toBe('2026-10-30');
    expect((screen.getByLabelText('Hora') as HTMLInputElement).value).toBe('15:00');
    expect((screen.getByLabelText('Duração') as HTMLSelectElement).value).toBe('60');
    expect(screen.getByRole('button', { name: 'Rodrigo' }).getAttribute('aria-pressed')).toBe('true');
    // apagar a frase devolve o painel ao que estava
    escrever('');
    expect((screen.getByLabelText('Quando') as HTMLInputElement).value).toBe('2026-11-02');
  });

  it('o semáforo é o da régua, com a proposta certa e o próprio evento fora na edição', () => {
    respostaDaRegua = { cor: 'amarelo', itens: [{ nivel: 'atencao', regra: 'teto', frase: '4ª reunião do Rodrigo no dia (limite 5)' }] };
    painel({ inicial: { ...BASE, cliente: 'Exemplaria', responsaveis: ['Rodrigo'] } });
    const s = document.querySelector('[data-semaforo]') as HTMLElement;
    expect(s.getAttribute('data-semaforo')).toBe('amarelo');
    expect(within(s).getByText('ATENÇÃO')).toBeTruthy();
    expect(s.textContent).toContain('4ª reunião do Rodrigo no dia (limite 5)');
    expect(s.textContent).toContain('Meet nasce junto');
    expect(avaliar.mock.calls.at(-1)?.[0].proposta).toMatchObject({ tipo: 'cliente', responsaveis: ['Rodrigo'], inicio: '2026-11-02T12:00:00.000Z', fim: '2026-11-02T13:00:00.000Z', ignorarEventoId: null });
  });

  it('Marcar sai no clique: manda o pedido, mostra "desfazer", e o desfazer vai à mesma rota', async () => {
    const desfazer = { acao: 'desmarcar' as const, chave: 'antiga', eventoId: 'novo1', tituloAtual: 'Reunião Online - Exemplaria - Lucas' };
    apiPost.mockResolvedValueOnce(resultado({ mensagem: 'Marcado no Google.', desfazer }));
    const { aoEscrever } = painel({ inicial: { ...BASE, cliente: 'Exemplaria', responsaveis: ['Lucas'] } });
    expect(screen.getByText('nível R2 · sai no clique · fica no histórico com desfazer')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar' }));
    await screen.findByText('Marcado no Google.');
    const [rota, corpo, token] = apiPost.mock.calls[0];
    expect(rota).toBe('/agenda/escritas');
    expect(token).toBe('tok');
    expect(corpo).toMatchObject({ acao: 'marcar', compromisso: { tipo: 'cliente', cliente: 'Exemplaria', responsaveis: ['Lucas'] } });
    expect(typeof corpo.chave).toBe('string');
    expect(aoEscrever).toHaveBeenCalled();
    expect(sessionStorage.getItem(CHAVE_DO_RASCUNHO)).toBeNull();
    apiPost.mockResolvedValueOnce(resultado({ mensagem: 'Desmarcado.' }));
    fireEvent.click(screen.getByRole('button', { name: 'desfazer' }));
    await screen.findByText('Desmarcado.');
    expect(apiPost.mock.calls[1][1]).toMatchObject({ acao: 'desmarcar', eventoId: 'novo1' });
    expect(apiPost.mock.calls[1][1].chave).not.toBe('antiga');
  });

  it('o corpo é o PedidoDeEscrita cru; convite sem e-mail de sócio vira aviso', async () => {
    apiPost.mockResolvedValueOnce({ ...resultado({ mensagem: 'Marcado no Google.' }), responsaveisSemEmail: ['Lucas', 'Pedro'] });
    painel({ inicial: { ...BASE, cliente: 'Exemplaria', responsaveis: ['Lucas', 'Pedro'] } });
    fireEvent.click(screen.getByRole('button', { name: 'Marcar' }));
    await screen.findByText(/convite saiu sem o e-mail de Lucas e Pedro/);
    const corpo = apiPost.mock.calls[0][1];
    expect(corpo.acao).toBe('marcar');
    expect(corpo).not.toHaveProperty('pedido');
  });

  it('foi para a fila: diz, leva a /atendimento e troca a linha do nível', async () => {
    apiPost.mockResolvedValueOnce(resultado({ status: 'aguardando_aprovacao', approvalId: 'a1', precisaDeOutraPessoa: true }));
    painel({ inicial: { ...BASE, cliente: 'Exemplaria', responsaveis: ['Lucas'] } });
    fireEvent.click(screen.getByRole('button', { name: 'Marcar' }));
    await screen.findByText(/Foi para a fila de aprovação/);
    expect(screen.getByRole('link', { name: 'ir para a fila' }).getAttribute('href')).toBe('/atendimento');
    expect(screen.getByText('nível R2 · esta escrita foi para a fila de aprovação')).toBeTruthy();
  });

  it('o vermelho do servidor: nada saiu; "Marcar assim mesmo" pede o motivo e reenvia com forcado', async () => {
    apiPost.mockResolvedValueOnce(resultado({ status: 'recusado', mensagem: 'A régua deu vermelho.', regua: { cor: 'vermelho', itens: [{ nivel: 'bloqueio', regra: 'feriado', frase: 'Finados: a agenda fecha' }] } }));
    painel({ inicial: { ...BASE, cliente: 'Exemplaria', responsaveis: ['Lucas'] } });
    fireEvent.click(screen.getByRole('button', { name: 'Marcar' }));
    await screen.findByText('Finados: a agenda fecha');
    expect((screen.getByRole('button', { name: 'Marcar' }) as HTMLButtonElement).disabled).toBe(true);
    const forcar = screen.getByRole('button', { name: 'Marcar assim mesmo' }) as HTMLButtonElement;
    expect(forcar.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Marcar assim mesmo: por quê/), { target: { value: 'o cliente só pode nesse dia' } });
    apiPost.mockResolvedValueOnce(resultado({ mensagem: 'Marcado assim mesmo.' }));
    fireEvent.click(forcar);
    await screen.findByText('Marcado assim mesmo.');
    expect(apiPost.mock.calls[1][1].forcado).toEqual({ motivo: 'o cliente só pode nesse dia' });
  });

  it('o vermelho da régua da tela também segura o Marcar', () => {
    respostaDaRegua = { cor: 'vermelho', itens: [{ nivel: 'bloqueio', regra: 'choque', frase: 'Rodrigo já tem reunião às 09:00' }] };
    painel({ inicial: { ...BASE, cliente: 'Exemplaria', responsaveis: ['Rodrigo'] } });
    expect((screen.getByRole('button', { name: 'Marcar' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('BLOQUEIO')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Marcar assim mesmo' })).toBeTruthy();
  });

  it('recusado: a mensagem; erro de rede: a mensagem também', async () => {
    apiPost.mockResolvedValueOnce(resultado({ status: 'recusado', mensagem: 'O Google Agenda está desligado em Conexões.' }));
    painel({ inicial: { ...BASE, cliente: 'Exemplaria', responsaveis: ['Lucas'] } });
    fireEvent.click(screen.getByRole('button', { name: 'Marcar' }));
    await screen.findByText('O Google Agenda está desligado em Conexões.');
    apiPost.mockRejectedValueOnce(new Error('Escrita da agenda: lane G4.'));
    fireEvent.click(screen.getByRole('button', { name: 'Marcar' }));
    await screen.findByText('Escrita da agenda: lane G4.');
  });

  it('a busca do cliente mostra a ficha (etapa, contato, vezes na agenda) e liga o lead', async () => {
    const achado: ClienteDaBuscaDaAgenda = {
      id: 'lead-1', tipo: 'lead', nome: 'Fictícia Peças', etapa: 'Proposta',
      contato: { nome: 'Marcos Exemplo', email: 'marcos@ficticia.exemplo' },
      naAgenda: { vezes: 2, ultima: '2026-10-21T13:00:00.000Z', com: ['Rodrigo'] },
    };
    apiGet.mockImplementation((rota: string) => Promise.resolve(rota.startsWith('/agenda/clientes') ? [achado] : []));
    painel({ inicial: { ...BASE, responsaveis: ['Rodrigo'] } });
    const campo = screen.getByLabelText('Cliente');
    fireEvent.focus(campo);
    fireEvent.change(campo, { target: { value: 'andr' } });
    const opcao = await waitFor(() => within(screen.getByRole('listbox')).getByRole('option'));
    expect(apiGet).toHaveBeenCalledWith('/agenda/clientes?q=andr', 'tok');
    fireEvent.click(within(opcao).getByRole('button'));
    const ficha = document.querySelector('[data-ficha-do-cliente]') as HTMLElement;
    expect(ficha.textContent).toContain('lead · Proposta');
    expect(ficha.textContent).toContain('contato: Marcos Exemplo · marcos@ficticia.exemplo');
    expect(ficha.textContent).toContain('já esteve na agenda 2x · última 21/10 com Rodrigo');
    expect(titulo()).toBe('Reunião Online - Fictícia Peças - Rodrigo');
    apiPost.mockResolvedValueOnce(resultado({ mensagem: 'ok' }));
    fireEvent.click(screen.getByRole('button', { name: 'Marcar' }));
    await screen.findByText('ok');
    expect(apiPost.mock.calls[0][1].compromisso).toMatchObject({ leadId: 'lead-1', convidados: ['marcos@ficticia.exemplo'] });
  });

  it('Mandar link de escolha: pede o convite e mostra o link para copiar', async () => {
    apiPost.mockResolvedValueOnce({ id: 'conv-1', url: 'https://os.exemplo/agendar/tokenficticio', validoAte: '2026-11-05T15:00:00.000Z' });
    painel({ inicial: { ...BASE, cliente: 'Exemplaria', responsaveis: ['Pedro'], leadId: 'lead-9', duracaoMin: 45 } });
    fireEvent.click(screen.getByRole('button', { name: 'Mandar link de escolha' }));
    await screen.findByText('https://os.exemplo/agendar/tokenficticio');
    expect(apiPost).toHaveBeenCalledWith('/agenda/convites', { socio: 'Pedro', tipo: 'cliente', modalidade: 'online', duracaoMin: 45, leadId: 'lead-9' }, 'tok');
    expect(screen.getByRole('button', { name: 'copiar o link' })).toBeTruthy();
  });

  it('o rascunho fica na sessão', () => {
    painel();
    escrever('interna todos amanhã 10h');
    const guardado = JSON.parse(sessionStorage.getItem(CHAVE_DO_RASCUNHO) ?? '{}');
    expect(guardado).toMatchObject({ tipo: 'interna', responsaveis: ['Rodrigo', 'Lucas', 'Pedro'], dia: '2026-10-30', hora: '10:00' });
  });

  it('editar evento fora de forma: só o horário muda, o título fica', async () => {
    const e: EventoV2 = {
      id: 'ev-cru', agenda: 'primary', origem: 'google', titulo: 'call com cliente novo',
      inicio: '2026-11-04T18:00:00.000Z', fim: '2026-11-04T19:00:00.000Z', diaInteiro: false, local: null, meet: null,
      convidados: [], organizador: 'agenda.casa@exemplo.invalid', organizadorEhAgenda: true, status: 'confirmado',
      atualizadoNoGoogle: null, serieId: null, criadoPeloOs: false, link: null, leitura: lerCompromisso('call com cliente novo'),
    };
    const { rascunhoDoEvento } = await import('@/app/agenda/painel');
    painel({ edicao: e, inicial: { ...rascunhoDoEvento(e), hora: '16:00' } });
    expect(screen.queryByLabelText('Atalho')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Tipo' })).toBeNull();
    expect(titulo()).toBe('call com cliente novo');
    apiPost.mockResolvedValueOnce(resultado({ mensagem: 'Movido.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Movido.');
    expect(apiPost.mock.calls[0][1]).toEqual({
      acao: 'alterar',
      chave: expect.any(String),
      eventoId: 'ev-cru',
      antes: { titulo: 'call com cliente novo', inicio: e.inicio, fim: e.fim, local: null, meet: false },
      depois: { inicio: '2026-11-04T19:00:00.000Z', fim: '2026-11-04T20:00:00.000Z' },
    });
    expect(screen.getByText(/a régua não sabe de quem é este compromisso/)).toBeTruthy();
  });

  it('editar evento no padrão: o mesmo painel, a régua sem o próprio evento, e só o que mudou vai no pedido', async () => {
    const e: EventoV2 = {
      id: 'ev-ok', agenda: 'primary', origem: 'google', titulo: 'Reunião Online - Exemplaria - Pedro',
      inicio: '2026-11-04T16:00:00.000Z', fim: '2026-11-04T17:00:00.000Z', diaInteiro: false, local: null, meet: 'https://meet.google.com/x',
      convidados: [], organizador: 'agenda.casa@exemplo.invalid', organizadorEhAgenda: true, status: 'confirmado',
      atualizadoNoGoogle: null, serieId: null, criadoPeloOs: true, link: null, leitura: lerCompromisso('Reunião Online - Exemplaria - Pedro'),
    };
    const { rascunhoDoEvento } = await import('@/app/agenda/painel');
    painel({ edicao: e, inicial: rascunhoDoEvento(e) });
    expect(titulo()).toBe('Reunião Online - Exemplaria - Pedro');
    expect(avaliar.mock.calls.at(-1)?.[0].proposta.ignorarEventoId).toBe('ev-ok');
    fireEvent.click(screen.getByRole('button', { name: 'Lucas' }));
    expect(titulo()).toBe('Reunião Online - Exemplaria - Lucas');
    apiPost.mockResolvedValueOnce(resultado({ mensagem: 'Alterado.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Alterado.');
    expect(apiPost.mock.calls[0][1].depois).toEqual({ responsaveis: ['Lucas', 'Pedro'] });
  });

  it('sem permissão de editar a agenda: sem botão de marcar', () => {
    painel({ podeMarcar: false });
    expect(screen.queryByRole('button', { name: 'Marcar' })).toBeNull();
    expect(screen.getByText(/pede a permissão de editar a agenda/)).toBeTruthy();
  });
});
