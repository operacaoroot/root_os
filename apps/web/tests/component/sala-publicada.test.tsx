/*
 * A SALA PUBLICADA POR VERSÃO (rodada da implantação I3, pranchetas 2 e 3).
 *
 *  1. sem versão publicada, a sala de antes (nada do quadro de implantação);
 *  2. com versão, o selo "no ar · versão N", as cinco estações (data só nas
 *     feitas), os passos, os publicados (proposta com link, kit esmaecido sem
 *     link), o combinado, quem cuida e o WhatsApp com o marcador, sem wa.me;
 *  3. o aceite começa no "aceitar" da proposta: o bloco #aceite aparece no
 *     estágio da proposta (antes ele só existia no do contrato).
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EstadoDaSala, SalaVersaoPublica } from '@mktos/shared';

const TOKEN = 'b'.repeat(43);
let ESTADO: EstadoDaSala;

vi.mock('next/navigation', () => ({ useParams: () => ({ token: TOKEN }), usePathname: () => `/s/${TOKEN}`, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return {
    ...real,
    apiGet: vi.fn(async () => ESTADO),
    apiPost: vi.fn(async () => ESTADO),
  };
});

import SalaPage from '@/app/s/[token]/page';

const OFERTA = { produto: 'operacao', rotulo: 'Operação ROOT', valorCentavos: 1199700, parcelas: 3, parcelaCentavos: 399900, formas: ['pix'], descricao: 'A operação montada com você.', descontoPct: null } as const;

function estadoBase(): EstadoDaSala {
  return {
    slug: 'alicerce',
    empresa: 'Construtora Alicerce',
    contato: 'Marina',
    estagio: 'proposta',
    estagios: [
      { chave: 'conversa', rotulo: 'Conversa', estado: 'passou' },
      { chave: 'diagnostico', rotulo: 'Diagnóstico', estado: 'passou' },
      { chave: 'proposta', rotulo: 'Proposta', estado: 'atual' },
      { chave: 'contrato', rotulo: 'Contrato', estado: 'vem' },
      { chave: 'comeco', rotulo: 'Começo', estado: 'vem' },
    ],
    conversa: { horario: null, horariosOferecidos: [], duracaoMin: 45, oQueContou: [] },
    planoDeAcao: [{ texto: 'conversa de 45 min', feito: true }],
    diagnostico: null,
    proposta: {
      versao: 1, publicadaEm: '2026-10-12T13:00:00.000Z', validaAte: '2026-10-26T23:59:00.000Z', ouvimos: ['fechamento atrasa'],
      recomendada: { ...OFERTA, formas: [...OFERTA.formas] }, alternativa: null, custosDeTerceiros: null, blocosLidos: [], ajustePendente: false, duvidas: [],
    },
    aceite: null,
    comeco: null,
    validoAte: '2027-01-10T00:00:00.000Z',
  };
}

const PUBLICADA: SalaVersaoPublica = {
  versao: 2,
  publicadaEm: '2026-10-18T17:00:00.000Z',
  conteudo: {
    nome: 'Sala · Construtora Alicerce',
    estacoes: [
      { chave: 'conversa', rotulo: 'Conversa', estado: 'feita', em: '2026-10-10T14:00:00.000Z' },
      { chave: 'acordo', rotulo: 'Acordo', estado: 'atual', em: null },
      { chave: 'kickoff', rotulo: 'Kickoff', estado: 'futura', em: null },
      { chave: 'contexto', rotulo: 'Contexto', estado: 'futura', em: null },
      { chave: 'frente', rotulo: 'Frente rodando', estado: 'futura', em: null },
    ],
    proximosPassos: [{ oque: 'marcar o kickoff', quando: '2026-10-21', comQuem: 'Marina' }],
    publicados: [
      { tipo: 'proposta', titulo: 'Proposta v1', estado: 'publicada · esperando a sua leitura', disponivel: true },
      { tipo: 'contrato', titulo: 'Contrato', estado: 'sai depois do aceite', disponivel: false },
      { tipo: 'roteiro', titulo: 'Roteiro do kickoff', estado: 'chega depois do acordo', disponivel: false },
      { tipo: 'kit', titulo: 'Kit de implantação', estado: 'chega após o kickoff', disponivel: false },
    ],
    combinado: ['Resposta em até 4 horas úteis', 'Retornos às 08:30, 13:00 e 18:00'],
    quemCuida: { nome: 'Lucas', papel: 'sócio' },
    whatsapp: { numero: null, rotulo: '[NÚMERO DA ROOT]' },
  },
};

beforeEach(() => {
  ESTADO = estadoBase();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', `/s/${TOKEN}`);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanup());

describe('a sala publicada por versão', () => {
  it('sem versão publicada: a sala de antes, sem o quadro da implantação', async () => {
    render(<SalaPage />);
    expect(await screen.findByText('nosso plano juntos')).toBeTruthy();
    expect(screen.queryByTestId('sala-publicada')).toBeNull();
  });

  it('com versão: selo, estações com data só nas feitas, passos, publicados, combinado e WhatsApp com o marcador', async () => {
    ESTADO = { ...estadoBase(), publicada: PUBLICADA };
    render(<SalaPage />);
    expect(await screen.findByTestId('sala-publicada')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sala · Construtora Alicerce');
    expect(screen.getByTestId('sala-selo').textContent).toMatch(/no ar · versão 2 · 18\/10/);
    const estacoes = within(screen.getByTestId('sala-estacoes')).getAllByRole('listitem');
    expect(estacoes.map((e) => e.textContent)).toEqual(['01Conversafeita · 10/10', '02Acordoagora', '03Kickoffdepois', '04Contextodepois', '05Frente rodandodepois']);
    expect(estacoes[1].getAttribute('aria-current')).toBe('step');
    expect(screen.getByTestId('sala-passos').textContent).toContain('marcar o kickoff21/10com Marina');
    const publicados = within(screen.getByTestId('sala-publicados')).getAllByRole('listitem');
    expect(within(publicados[0]).getByRole('link').getAttribute('href')).toBe(`/s/${TOKEN}/proposta`);
    expect(within(publicados[3]).queryByRole('link')).toBeNull();
    expect(publicados[3].className).toContain('opacity-50');
    expect(screen.getByTestId('sala-combinado').textContent).toContain('Resposta em até 4 horas úteis');
    expect(screen.getByText('Lucas')).toBeTruthy();
    const whats = screen.getByTestId('sala-whatsapp');
    expect(whats.tagName).toBe('BUTTON');
    expect(whats.textContent).toContain('[NÚMERO DA ROOT]');
    expect(document.querySelector('a[href*="wa.me"]')).toBeNull();
    expect(whats.parentElement!.className).toContain('fixed');
    expect(screen.getByText(/Cada visita sua fica registrada/)).toBeTruthy();
    // O que é ação do cliente continua: a proposta está ali embaixo.
    expect(screen.getByTestId('abrir-proposta-completa')).toBeTruthy();
  });

  it('o "aceitar" da proposta abre o bloco do aceite já no estágio da proposta', async () => {
    render(<SalaPage />);
    await screen.findByText('nosso plano juntos');
    expect(document.getElementById('aceite')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /aceitar/i }));
    expect(await screen.findByText('1 · seus dados')).toBeTruthy();
    expect(document.getElementById('aceite')).not.toBeNull();
  });

  it('chegar com #aceite (o botão da página da proposta) já mostra o aceite', async () => {
    window.history.replaceState({}, '', `/s/${TOKEN}#aceite`);
    render(<SalaPage />);
    expect(await screen.findByText('1 · seus dados')).toBeTruthy();
  });
});
