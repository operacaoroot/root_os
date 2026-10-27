/*
 * O POPUP DO CHAT (leva 5, L7, 27/10/2026): abre com as últimas mensagens e a
 * caixa de texto à vista, o menu das abas fixo fora do que rola, troca de
 * conversa sem desmontar a lista, e fica montado ao fechar.
 *
 * LIMITE DO JSDOM: não há layout, então `scrollHeight`/`clientHeight` são
 * postos à mão no container da conversa (6000 × 400) e `scrollTop` é guardado
 * com a mesma trava do navegador (não passa de `scrollHeight - clientHeight`).
 * O que se prova é que o efeito de rolagem roda (num `useLayoutEffect`, antes
 * de pintar) e leva o container ao fim sem interação; a medida em pixels é do
 * navegador, no e2e. Dados todos fictícios.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversaAberta, ConversaDaCaixa, ListaDaCaixa, MensagemDaCaixa } from '@mktos/shared';

let RESPOSTAS: Record<string, unknown> = {};
const gets: string[] = [];

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'eu' }, can: () => true }) }));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => <a href={href} {...resto}>{children}</a>,
}));
vi.mock('@/components/whatsapp/VinculoDaConversa', () => ({
  VinculoDaConversa: ({ conversa }: { conversa: ConversaDaCaixa }) => <span data-testid="whats-vinculo">{conversa.vinculo ? conversa.vinculo.nome : 'sem vínculo'}</span>,
}));
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  const achar = (caminho: string) => {
    const semQuery = caminho.split('?')[0];
    const chave = Object.keys(RESPOSTAS)
      .sort((a, b) => b.length - a.length)
      .find((k) => (k.includes('?') ? caminho.startsWith(k) : semQuery === k));
    return chave ? RESPOSTAS[chave] : undefined;
  };
  return {
    ...real,
    apiGet: vi.fn(async (caminho: string) => {
      gets.push(caminho);
      const r = achar(caminho);
      if (r instanceof Error) throw r;
      return typeof r === 'function' ? (r as (c: string) => unknown)(caminho) : r;
    }),
    apiPost: vi.fn(async () => ({})),
    apiStream: vi.fn(),
  };
});

import { ChatFlutuante } from '@/components/ChatFlutuante';
import { CaixaDoWhatsapp } from '@/app/whatsapp/_caixa/CaixaDoWhatsapp';

const AGORA = new Date().toISOString();
const ALTURA_DA_CONVERSA = 6000;
const ALTURA_VISIVEL = 400;

function conversa(id: string, extra: Partial<ConversaDaCaixa> = {}): ConversaDaCaixa {
  return {
    id, grupo: false, nome: `Contato ${id}`, numero: '5500000000001', fotoUrl: null, participantes: null, equipe: false, comunidade: false,
    ultimaMensagemEm: AGORA, previa: { texto: 'mensagem inventada', tipo: 'conversation', deMim: false, remetenteNome: null, timestamp: AGORA },
    naoLidas: 0, vinculo: null, sugestao: null, arquivada: false, ...extra,
  };
}
function msg(id: string, extra: Partial<MensagemDaCaixa> = {}): MensagemDaCaixa {
  return {
    id, mensagemExternaId: `ext-${id}`, deMim: false, tipo: 'conversation', texto: `texto ${id}`, midia: null, remetenteNome: null, remetenteNumero: null,
    timestamp: new Date(Date.parse(AGORA) + Number(id.replace(/\D/g, '')) * 1000).toISOString(), cita: null, enviadaPor: null, lida: true, ...extra,
  };
}
const C1 = conversa('c1', { nome: 'Lead Ficticio' });
const C2 = conversa('c2', { nome: 'Outro Contato' });
const LISTA: ListaDaCaixa = {
  conversas: [C1, C2],
  contagens: { todas: 2, leads: 0, clientes: 0, grupos: 0, sem_vinculo: 2, equipe: 0, comunidade: 0, arquivadas: 0 },
  podeResponder: true, podeVincular: true, mais: false,
};
const SESSENTA = Array.from({ length: 60 }, (_, i) => msg(`m${i + 1}`));
function aberta(c: ConversaDaCaixa, mensagens: MensagemDaCaixa[]): ConversaAberta {
  return { conversa: c, mensagens, maisAntigas: false, participantes: [], podeResponder: true, podeVincular: true };
}

/** O jsdom não mede nada: o container da conversa ganha medidas fixas e um scrollTop com a trava do navegador. */
const topos = new WeakMap<HTMLElement, number>();
const ehHistorico = (el: HTMLElement) => el.getAttribute?.('data-testid') === 'caixa-historico';
const originais = {
  scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight'),
  clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight'),
  scrollTop: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop'),
};
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return ehHistorico(this) ? ALTURA_DA_CONVERSA : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return ehHistorico(this) ? ALTURA_VISIVEL : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get() { return topos.get(this) ?? 0; },
    set(v: number) { topos.set(this, Math.max(0, Math.min(v, ehHistorico(this) ? ALTURA_DA_CONVERSA - ALTURA_VISIVEL : 0))); },
  });
});
afterAll(() => {
  for (const nome of ['scrollHeight', 'clientHeight', 'scrollTop'] as const) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[nome];
    if (originais[nome]) Object.defineProperty(Element.prototype, nome, originais[nome]!);
  }
});

beforeEach(() => {
  RESPOSTAS = {
    '/whatsapp/resumo': { naoLidas: { total: 0, leads: 0, clientes: 0, semVinculo: 0, equipe: 0 }, conversasSemVinculo: 0 },
    '/whatsapp/conversas': LISTA,
    '/whatsapp/conversas/c1': aberta(C1, SESSENTA),
    '/whatsapp/conversas/c2': aberta(C2, [msg('m901', { texto: 'oi do outro' })]),
  };
  gets.length = 0;
});

async function abrirPopupNaConversa(u: ReturnType<typeof userEvent.setup>) {
  render(<ChatFlutuante />);
  await u.click(screen.getByTitle('Chat: a central e as conversas do WhatsApp'));
  await u.click(await screen.findByTestId('caixa-conversa-c1'));
  await screen.findByTestId('caixa-balao-m60');
  return screen.getByTestId('caixa-historico');
}

describe('o popup do Chat abre no fim da conversa', () => {
  it('com 60 mensagens, o container de rolagem está no fim sem interação e a caixa de texto tem o foco', async () => {
    const u = userEvent.setup();
    const historico = await abrirPopupNaConversa(u);
    expect(within(historico).getAllByTestId(/caixa-balao-/)).toHaveLength(60);
    // scrollTop + clientHeight = scrollHeight: a última mensagem está à vista, sem ninguém ter rolado.
    expect(historico.scrollTop + historico.clientHeight).toBe(historico.scrollHeight);
    expect(document.activeElement).toBe(screen.getByTestId('caixa-resposta'));
    // Nenhum iframe: a caixa é a mesma componente da tela /whatsapp, embutida.
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByTestId('caixa')).toHaveAttribute('data-embutida', 'sim');
  });

  it('o menu das abas fica fora do container que rola, e o popup contém a rolagem', async () => {
    const u = userEvent.setup();
    const historico = await abrirPopupNaConversa(u);
    const abas = screen.getByRole('tablist', { name: 'O que abrir' });
    expect(historico.contains(abas)).toBe(false);
    expect(screen.getByTestId('chat-popup').contains(abas)).toBe(true);
    expect(historico.className).toContain('overscroll-contain');
    expect(screen.getByTestId('chat-popup').className).toContain('overscroll-contain');
    // A caixa de texto também está fora do que rola.
    expect(historico.contains(screen.getByTestId('caixa-resposta'))).toBe(false);
  });

  it('o popup não mexe no endereço da página em que a pessoa está', async () => {
    window.history.replaceState(null, '', '/painel?x=1');
    const u = userEvent.setup();
    await abrirPopupNaConversa(u);
    expect(`${window.location.pathname}${window.location.search}`).toBe('/painel?x=1');
    // "abrir inteira" leva à caixa inteira na mesma conversa.
    expect(screen.getByTitle('Abrir a caixa inteira, nesta conversa')).toHaveAttribute('href', '/whatsapp?conversa=c1');
  });

  it('no popup (uma coluna), voltar à lista limpa a conversa, e a próxima abre no fim sem "Sem mensagens" piscar', async () => {
    let soltar: (() => void) | null = null;
    RESPOSTAS['/whatsapp/conversas/c2'] = () => new Promise((resolve) => { soltar = () => resolve(aberta(C2, [msg('m901', { texto: 'oi do outro' })])); });
    const u = userEvent.setup();
    const historico = await abrirPopupNaConversa(u);
    historico.scrollTop = 0;
    await u.click(screen.getByTestId('caixa-voltar'));
    await u.click(await screen.findByTestId('caixa-conversa-c2'));
    // Entre a lista e a conversa nova: só o aviso discreto, nunca a lista da conversa anterior nem "Sem mensagens".
    expect(screen.getByTestId('caixa-abrindo')).toHaveTextContent('Abrindo…');
    expect(screen.getByTestId('caixa-historico')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('caixa-balao-m60')).toBeNull();
    expect(screen.queryByText('Sem mensagens gravadas nesta conversa.')).toBeNull();
    await act(async () => { soltar?.(); });
    await screen.findByTestId('caixa-balao-m901');
    expect(screen.queryByTestId('caixa-abrindo')).toBeNull();
    const novo = screen.getByTestId('caixa-historico');
    expect(novo.scrollTop + novo.clientHeight).toBe(novo.scrollHeight);
  });

  it('fechar esconde o popup sem desmontar; reabrir mostra a mesma conversa no fim, sem recarregar tudo', async () => {
    const classes = () => screen.getByTestId('chat-popup').className.split(/\s+/);
    const u = userEvent.setup();
    const historico = await abrirPopupNaConversa(u);
    const leiturasDaC1 = () => gets.filter((g) => g.startsWith('/whatsapp/conversas/c1')).length;
    const antes = leiturasDaC1();
    historico.scrollTop = 0;
    await u.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(classes()).toContain('hidden');
    expect(screen.getByTestId('caixa-balao-m60')).toBeInTheDocument();
    await u.click(screen.getByTitle('Chat: a central e as conversas do WhatsApp'));
    expect(classes()).not.toContain('hidden');
    const dePois = screen.getByTestId('caixa-historico');
    expect(dePois.scrollTop + dePois.clientHeight).toBe(dePois.scrollHeight);
    // Reabrir relê a conversa UMA vez (o que ficou parado), não a tela inteira.
    await waitFor(() => expect(leiturasDaC1()).toBe(antes + 1));
  });
});

describe('a caixa na tela /whatsapp (duas colunas) troca de conversa sem piscar', () => {
  it('a lista anterior fica, esmaecida, até a nova chegar; a nova abre no fim', async () => {
    let soltar: (() => void) | null = null;
    RESPOSTAS['/whatsapp/conversas/c2'] = () => new Promise((resolve) => { soltar = () => resolve(aberta(C2, [msg('m901', { texto: 'oi do outro' })])); });
    window.history.replaceState(null, '', '/whatsapp');
    const u = userEvent.setup();
    render(<CaixaDoWhatsapp />);
    await u.click(await screen.findByTestId('caixa-conversa-c1'));
    await screen.findByTestId('caixa-balao-m60');
    // Na página de duas colunas a lista de conversas continua à esquerda: a troca é direta.
    await u.click(screen.getByTestId('caixa-conversa-c2'));
    expect(screen.getByTestId('caixa-abrindo')).toHaveTextContent('Abrindo a conversa…');
    expect(screen.getByTestId('caixa-historico')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('caixa-balao-m60')).toBeInTheDocument();
    expect(screen.getByTestId('caixa-titulo')).toHaveTextContent('Outro Contato');
    await act(async () => { soltar?.(); });
    await screen.findByTestId('caixa-balao-m901');
    expect(screen.queryByTestId('caixa-balao-m60')).toBeNull();
    expect(screen.queryByTestId('caixa-abrindo')).toBeNull();
    const novo = screen.getByTestId('caixa-historico');
    expect(novo.scrollTop + novo.clientHeight).toBe(novo.scrollHeight);
  });
});
