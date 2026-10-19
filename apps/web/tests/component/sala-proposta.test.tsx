/*
 * A PROPOSTA COMPLETA (rodada da implantação I4, prancheta 4).
 *
 * A página `/s/<token>/proposta` mostra as três seções com o rótulo mono, o
 * preço, o quadro de custos com "[a decidir]" onde a proposta não traz o
 * número, o rail com aceitar, o WhatsApp com o marcador (sem abrir conversa) e
 * o contador. A barra de reação: o chip "faz sentido" grava e fica pressionado;
 * "anotar uma ideia" abre o campo com foco, conta os caracteres, fecha com Esc
 * e, enviada, a anotação aparece na seção com o selo. O erro da API aparece
 * legível. A sala ganha o link para a proposta completa, e a página da
 * proposta não conta de novo a visita que a sala já contou.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EstadoDaSala, ReacoesNaPaginaDaProposta } from '@mktos/shared';

const TOKEN = 'a'.repeat(43);
const gets: string[] = [];
const posts: { caminho: string; corpo: unknown }[] = [];
let RESPOSTA_DO_POST: (caminho: string, corpo: unknown) => unknown = () => ({});

vi.mock('next/navigation', () => ({ useParams: () => ({ token: TOKEN }), usePathname: () => `/s/${TOKEN}/proposta`, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return {
    ...real,
    apiGet: vi.fn(async (caminho: string) => {
      gets.push(caminho);
      if (caminho.endsWith('/proposta/reacoes')) return REACOES;
      return ESTADO;
    }),
    apiPost: vi.fn(async (caminho: string, corpo: unknown) => {
      posts.push({ caminho, corpo });
      const r = RESPOSTA_DO_POST(caminho, corpo);
      if (r instanceof Error) throw r;
      return r;
    }),
  };
});

import PropostaDaSalaPage from '@/app/s/[token]/proposta/page';
import SalaPage from '@/app/s/[token]/page';

const OFERTA = { produto: 'operacao', rotulo: 'Operação ROOT', valorCentavos: 1199700, parcelas: 3, parcelaCentavos: 399900, formas: ['pix', 'boleto'], descricao: 'A operação montada com você.', descontoPct: null } as const;

const ESTADO: EstadoDaSala = {
  slug: 'alicerce',
  empresa: 'Alicerce Engenharia',
  contato: 'Marina',
  estagio: 'proposta',
  estagios: [
    { chave: 'conversa', rotulo: 'Conversa', estado: 'passou' },
    { chave: 'diagnostico', rotulo: 'Diagnóstico', estado: 'passou' },
    { chave: 'proposta', rotulo: 'Proposta', estado: 'atual' },
    { chave: 'contrato', rotulo: 'Contrato', estado: 'vem' },
    { chave: 'comeco', rotulo: 'Começo', estado: 'vem' },
  ],
  conversa: { horario: null, horariosOferecidos: [], duracaoMin: 45, oQueContou: ['Omie'] },
  planoDeAcao: [],
  diagnostico: null,
  proposta: {
    versao: 2,
    publicadaEm: '2026-10-18T13:00:00.000Z',
    validaAte: null,
    ouvimos: ['fechamento do mês atrasa', 'base de clientes solta'],
    recomendada: { ...OFERTA, formas: [...OFERTA.formas] },
    alternativa: null,
    custosDeTerceiros: { mesNormalCentavos: 40000, piorMesCentavos: null, exemplo: true },
    blocosLidos: [],
    ajustePendente: false,
    duvidas: [],
  },
  aceite: null,
  comeco: null,
  validoAte: '2027-01-10T00:00:00.000Z',
};

let REACOES: ReacoesNaPaginaDaProposta;
const reacoesVazias = (): ReacoesNaPaginaDaProposta => ({ versao: 2, acesso: 3, fazSentido: [], anotacoes: [], contagem: { anotacoes: 0, duvidas: 0 } });

const fetchMock = vi.fn(async () => new Response('{}', { status: 201 }));

beforeEach(() => {
  gets.length = 0;
  posts.length = 0;
  REACOES = reacoesVazias();
  RESPOSTA_DO_POST = (caminho) => (caminho.endsWith('/visita') ? ESTADO : REACOES);
  window.sessionStorage.clear();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a página da proposta', () => {
  it('mostra as três seções com o rótulo mono, o preço, os custos e o rail sem número inventado', async () => {
    render(<PropostaDaSalaPage />);
    expect(await screen.findByText('// 01 · O QUE VAMOS MONTAR')).toBeTruthy();
    expect(screen.getByText('// 02 · COMO FUNCIONA')).toBeTruthy();
    expect(screen.getByText('// 03 · INVESTIMENTO')).toBeTruthy();
    expect(screen.getByTestId('preco').textContent).toBe('R$ 11.997');
    // O pior mês e o Claude do 1º mês não vieram: "[a decidir]", nunca um número.
    const custos = screen.getByRole('table');
    expect(within(custos).getByText('Claude do 1º mês').closest('tr')?.textContent).toContain('[a decidir]');
    expect(within(custos).getByText('pior mês').closest('tr')?.textContent).toContain('[a decidir]');
    expect(screen.getByText('valores de exemplo, ainda não são os da sua empresa')).toBeTruthy();

    const rail = screen.getByRole('complementary', { name: 'resumo da proposta' });
    expect(within(rail).getByRole('link', { name: 'aceitar a proposta' }).getAttribute('href')).toBe(`/s/${TOKEN}#aceite`);
    const whats = within(rail).getByRole('button', { name: 'falar no WhatsApp' });
    expect(whats.getAttribute('aria-disabled')).toBe('true');
    expect(within(rail).getByText('[NÚMERO DA ROOT]')).toBeTruthy();
    expect(rail.querySelector('a[href*="wa.me"]')).toBeNull();
    expect(screen.getByTestId('contador').textContent).toBe('0 anotações · 0 dúvidas');
    // Abrir direto (sem passar pela sala nesta aba) conta a visita.
    expect(posts.some((p) => p.caminho === `/sala/${TOKEN}/visita`)).toBe(true);
  });

  it('"faz sentido" grava a reação da seção e fica pressionado', async () => {
    RESPOSTA_DO_POST = (caminho) => (caminho.endsWith('/visita') ? ESTADO : { ...reacoesVazias(), fazSentido: ['montar'] });
    render(<PropostaDaSalaPage />);
    const secao = (await screen.findByText('// 01 · O QUE VAMOS MONTAR')).closest('section')!;
    const chip = within(secao).getByRole('button', { name: 'faz sentido' });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(chip);
    await waitFor(() => expect(chip.getAttribute('aria-pressed')).toBe('true'));
    expect(posts.find((p) => p.caminho.endsWith('/proposta/reacao'))?.corpo).toEqual({ secao: 'montar', tipo: 'faz_sentido', versao: 2 });
  });

  it('"anotar uma ideia" abre o campo com foco, conta, fecha com Esc e, enviada, mostra o selo na seção', async () => {
    render(<PropostaDaSalaPage />);
    const secao = (await screen.findByText('// 03 · INVESTIMENTO')).closest('section')!;
    const chip = within(secao).getByRole('button', { name: 'anotar uma ideia' });
    await userEvent.click(chip);
    const campo = within(secao).getByRole('textbox');
    await waitFor(() => expect(document.activeElement).toBe(campo));
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    await userEvent.type(campo, 'Dá para');
    expect(within(secao).getByText('7/1000')).toBeTruthy();
    fireEvent.keyDown(campo, { key: 'Escape' });
    expect(within(secao).queryByRole('textbox')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(chip));

    RESPOSTA_DO_POST = (caminho) =>
      caminho.endsWith('/visita')
        ? ESTADO
        : { ...reacoesVazias(), anotacoes: [{ id: 'r1', secao: 'investimento', tipo: 'ideia', texto: 'Parcelar em 4?', em: '2026-10-18T21:05:00.000Z' }], contagem: { anotacoes: 1, duvidas: 0 } };
    await userEvent.click(chip);
    await userEvent.type(within(secao).getByRole('textbox'), 'Parcelar em 4?');
    await userEvent.click(within(secao).getByRole('button', { name: 'enviar' }));
    expect(await within(secao).findByText('Parcelar em 4?')).toBeTruthy();
    expect(within(secao).getByText('a sua anotação · enviada 18:05')).toBeTruthy();
    expect(screen.getByTestId('contador').textContent).toBe('1 anotação · 0 dúvidas');
    expect(posts.find((p) => p.caminho.endsWith('/proposta/reacao'))?.corpo).toEqual({ secao: 'investimento', tipo: 'ideia', texto: 'Parcelar em 4?', versao: 2 });
  });

  it('o erro da API aparece legível, e o campo continua aberto com o texto', async () => {
    RESPOSTA_DO_POST = (caminho) => (caminho.endsWith('/visita') ? ESTADO : new Error('Muitas tentativas. Espere alguns minutos.'));
    render(<PropostaDaSalaPage />);
    const secao = (await screen.findByText('// 02 · COMO FUNCIONA')).closest('section')!;
    await userEvent.click(within(secao).getByRole('button', { name: 'tenho uma dúvida' }));
    await userEvent.type(within(secao).getByRole('textbox'), 'E o boleto?');
    await userEvent.click(within(secao).getByRole('button', { name: 'enviar' }));
    expect((await within(secao).findByRole('alert')).textContent).toBe('Muitas tentativas. Espere alguns minutos.');
    expect((within(secao).getByRole('textbox') as HTMLTextAreaElement).value).toBe('E o boleto?');
  });

  it('sem proposta publicada, diz isso e leva de volta à sala', async () => {
    RESPOSTA_DO_POST = () => ({ ...ESTADO, proposta: null });
    render(<PropostaDaSalaPage />);
    expect(await screen.findByText(/A proposta ainda não foi publicada/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'voltar para a sala' }).getAttribute('href')).toBe(`/s/${TOKEN}`);
  });
});

describe('a sala leva à proposta completa', () => {
  it('o bloco da proposta tem o link, e a página da proposta não conta de novo a visita da sala', async () => {
    const primeira = render(<SalaPage />);
    const link = await screen.findByTestId('abrir-proposta-completa');
    expect(link.getAttribute('href')).toBe(`/s/${TOKEN}/proposta`);
    expect(posts.filter((p) => p.caminho.endsWith('/visita'))).toHaveLength(1);
    primeira.unmount();

    render(<PropostaDaSalaPage />);
    expect(await screen.findByText('// 01 · O QUE VAMOS MONTAR')).toBeTruthy();
    expect(posts.filter((p) => p.caminho.endsWith('/visita'))).toHaveLength(1);
    expect(gets).toContain(`/sala/${TOKEN}`);
  });
});

describe('o registro de leitura', () => {
  it('a seção na tela por 2 s manda a primeira batida (keepalive, só seção, segundos e versão); ao sair, manda o que sobrou', async () => {
    const chamadas: { cb: IntersectionObserverCallback; el?: Element }[] = [];
    class Observador {
      constructor(private readonly cb: IntersectionObserverCallback) {}
      observe(el: Element) {
        chamadas.push({ cb: this.cb, el });
      }
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal('IntersectionObserver', Observador);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<PropostaDaSalaPage />);
      await screen.findByText('// 01 · O QUE VAMOS MONTAR');
      const montar = chamadas.find((c) => (c.el as HTMLElement).dataset.secao === 'montar')!;
      const ver = (sim: boolean) => montar.cb([{ isIntersecting: sim, target: montar.el } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
      ver(true);
      await vi.advanceTimersByTimeAsync(2100);
      const batidas = () => fetchMock.mock.calls.map((c) => c as unknown as [string, RequestInit]).filter(([url]) => String(url).endsWith('/proposta/leitura'));
      expect(batidas()).toHaveLength(1);
      const [url, init] = batidas()[0];
      expect(url).toBe(`/api/sala/${TOKEN}/proposta/leitura`);
      expect(init.keepalive).toBe(true);
      expect(JSON.parse(String(init.body))).toEqual({ secao: 'montar', segundos: 2, versao: 2 });
      await vi.advanceTimersByTimeAsync(3000);
      ver(false);
      expect(batidas()).toHaveLength(2);
      expect(JSON.parse(String(batidas()[1][1].body))).toEqual({ secao: 'montar', segundos: 3, versao: 2 });
    } finally {
      vi.useRealTimers();
    }
  });
});
