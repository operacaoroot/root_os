/*
 * A CAIXA DE WHATSAPP (produção 22C, W2): lista, filtros, busca, abrir e ler,
 * responder, arquivar e a estrutura de telas separadas no celular (390 px).
 *
 * No jsdom não há layout: o celular se confere pelas classes (`max-md:hidden`)
 * e pelo `data-vista` da grade; a medida de verdade (sem rolagem lateral a
 * 390 px) é do navegador, no e2e. Dados todos fictícios.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversaAberta, ConversaDaCaixa, ListaDaCaixa, MensagemDaCaixa } from '@mktos/shared';

let RESPOSTAS: Record<string, unknown> = {};
const gets: string[] = [];
const posts: { caminho: string; corpo: unknown }[] = [];

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'eu' }, can: () => true }) }));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => <a href={href} {...resto}>{children}</a>,
}));
// O vínculo é da lane C: aqui só se confere que a caixa o embute com o que o contrato pede.
vi.mock('@/components/whatsapp/VinculoDaConversa', () => ({
  VinculoDaConversa: ({ conversa, podeVincular }: { conversa: ConversaDaCaixa; podeVincular: boolean }) => (
    <span data-testid="whats-vinculo" data-pode-vincular={String(podeVincular)}>
      {conversa.vinculo ? conversa.vinculo.nome : 'sem vínculo'}
    </span>
  ),
}));
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  const achar = (caminho: string) => {
    const semQuery = caminho.split('?')[0];
    const chave = Object.keys(RESPOSTAS)
      .sort((a, b) => b.length - a.length)
      .find((k) => (k.includes('?') ? caminho.startsWith(k) : semQuery === k));
    const r = chave ? RESPOSTAS[chave] : undefined;
    if (r instanceof Error) throw r;
    return r;
  };
  return {
    ...real,
    apiGet: vi.fn(async (caminho: string) => {
      gets.push(caminho);
      const r = achar(caminho);
      return typeof r === 'function' ? (r as (c: string) => unknown)(caminho) : r;
    }),
    apiPost: vi.fn(async (caminho: string, corpo: unknown) => {
      posts.push({ caminho, corpo });
      const r = achar(`POST ${caminho}`);
      if (r instanceof Error) throw r;
      return typeof r === 'function' ? (r as (c: unknown) => unknown)(corpo) : r ?? {};
    }),
  };
});

import { ErroDaApi } from '@/lib/api';
import CaixaPage from '@/app/whatsapp/page';

const AGORA = new Date().toISOString();

function conversa(id: string, extra: Partial<ConversaDaCaixa> = {}): ConversaDaCaixa {
  return {
    id,
    grupo: false,
    nome: `Contato ${id}`,
    numero: '5500000000001',
    fotoUrl: null,
    participantes: null,
    equipe: false,
    comunidade: false,
    ultimaMensagemEm: AGORA,
    previa: { texto: 'mensagem inventada', tipo: 'conversation', deMim: false, remetenteNome: null, timestamp: AGORA },
    naoLidas: 0,
    vinculo: null,
    sugestao: null,
    arquivada: false,
    ...extra,
  };
}

function msg(id: string, extra: Partial<MensagemDaCaixa> = {}): MensagemDaCaixa {
  return {
    id,
    mensagemExternaId: `ext-${id}`,
    deMim: false,
    tipo: 'conversation',
    texto: `texto ${id}`,
    midia: null,
    remetenteNome: null,
    remetenteNumero: null,
    timestamp: AGORA,
    cita: null,
    enviadaPor: null,
    lida: true,
    ...extra,
  };
}

const C1 = conversa('c1', {
  nome: 'Lead Ficticio',
  naoLidas: 2,
  vinculo: { tipo: 'lead', id: 'lead-1', nome: 'Lead Ficticio', vinculadoPor: null, vinculadoEm: null },
  previa: { texto: 'resposta da casa', tipo: 'conversation', deMim: true, remetenteNome: null, timestamp: AGORA },
});
const C2 = conversa('c2', {
  grupo: true,
  numero: null,
  nome: 'ROOT | Cliente Ficticio',
  participantes: 6,
  vinculo: { tipo: 'cliente', id: 'cli-1', nome: 'Cliente Ficticio', vinculadoPor: null, vinculadoEm: null },
  previa: { texto: null, tipo: 'image', deMim: false, remetenteNome: 'Pessoa Ficticia', timestamp: AGORA },
});
const C3 = conversa('c3', { nome: 'Sem Nome Ficticio', fotoUrl: 'https://exemplo.invalid/foto.jpg' });

const LISTA: ListaDaCaixa = {
  conversas: [C2, C1, C3],
  contagens: { todas: 3, leads: 1, clientes: 1, grupos: 1, sem_vinculo: 1, equipe: 0, comunidade: 0, arquivadas: 2 },
  podeResponder: true,
  podeVincular: true,
  mais: false,
};

function aberta(c: ConversaDaCaixa, mensagens: MensagemDaCaixa[], extra: Partial<ConversaAberta> = {}): ConversaAberta {
  return { conversa: c, mensagens, maisAntigas: false, participantes: [], podeResponder: true, podeVincular: true, ...extra };
}

beforeEach(() => {
  RESPOSTAS = {};
  gets.length = 0;
  posts.length = 0;
  window.history.replaceState(null, '', '/whatsapp');
  RESPOSTAS['/whatsapp/conversas'] = LISTA;
});

describe('caixa de WhatsApp: a lista', () => {
  it('mostra as conversas com foto ou iniciais, prévia, selo de grupo, não lidas e chips com contagem', async () => {
    render(<CaixaPage />);
    const lista = await screen.findByTestId('caixa-lista');
    expect(within(lista).getAllByRole('button').map((b) => b.dataset.testid)).toEqual(['caixa-conversa-c2', 'caixa-conversa-c1', 'caixa-conversa-c3']);
    expect(screen.getByTestId('caixa-previa-c1')).toHaveTextContent('Você: resposta da casa');
    expect(screen.getByTestId('caixa-previa-c2')).toHaveTextContent('Pessoa Ficticia: 📎 imagem');
    expect(screen.getByTestId('caixa-selo-grupo-c2')).toHaveTextContent(/grupo · 6/);
    expect(screen.getByTestId('caixa-nao-lidas-c1')).toHaveTextContent('2');
    expect(screen.queryByTestId('caixa-nao-lidas-c3')).toBeNull();
    // Foto com referrerPolicy; sem foto, as iniciais.
    const foto = screen.getByTestId('caixa-conversa-c3').querySelector('img');
    expect(foto).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(screen.getByTestId('caixa-conversa-c1')).toHaveTextContent('LF');
    expect(screen.getByTestId('caixa-filtro-todas')).toHaveTextContent('Todas3');
    expect(screen.getByTestId('caixa-filtro-sem_vinculo')).toHaveTextContent('Sem vínculo1');
    expect(screen.getByTestId('caixa-filtro-arquivadas')).toHaveTextContent('Arquivadas2');
    expect(screen.getByTestId('caixa-filtro-todas')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('caixa-ir-para-celulares')).toHaveAttribute('href', '/whatsapp/simulador');
  });

  it('o chip muda o filtro no endereço e na API', async () => {
    const u = userEvent.setup();
    render(<CaixaPage />);
    await screen.findByTestId('caixa-conversa-c1');
    await u.click(screen.getByTestId('caixa-filtro-leads'));
    expect(window.location.search).toBe('?filtro=leads');
    await waitFor(() => expect(gets).toContain('/whatsapp/conversas?filtro=leads'));
    expect(screen.getByTestId('caixa-filtro-leads')).toHaveAttribute('aria-pressed', 'true');
  });

  it('abre já no filtro do endereço (o link do Dia a dia)', async () => {
    window.history.replaceState(null, '', '/whatsapp?filtro=sem_vinculo');
    render(<CaixaPage />);
    await waitFor(() => expect(gets).toContain('/whatsapp/conversas?filtro=sem_vinculo'));
    expect(screen.getByTestId('caixa-filtro-sem_vinculo')).toHaveAttribute('aria-pressed', 'true');
  });

  it('a busca vai à API e ao endereço depois da pausa', async () => {
    const u = userEvent.setup();
    render(<CaixaPage />);
    await screen.findByTestId('caixa-conversa-c1');
    await u.type(screen.getByTestId('caixa-busca'), 'abacaxi');
    await waitFor(() => expect(gets).toContain('/whatsapp/conversas?q=abacaxi'));
    expect(window.location.search).toBe('?q=abacaxi');
  });

  // Layout 26/10: Comunidade, o quarto tipo de conversa, com chip, contagem e selo.
  it('comunidade: o chip com a contagem vem depois de Equipe, filtra pela API, e a conversa leva o selo', async () => {
    const COM = conversa('c4', { grupo: true, numero: null, nome: 'Operação Root | IA para Negócios', participantes: 55, comunidade: true });
    RESPOSTAS['/whatsapp/conversas'] = { ...LISTA, conversas: [...LISTA.conversas, COM], contagens: { ...LISTA.contagens, todas: 4, grupos: 2, comunidade: 1 } };
    const u = userEvent.setup();
    render(<CaixaPage />);
    await screen.findByTestId('caixa-conversa-c4');
    expect(screen.getByTestId('caixa-filtro-comunidade')).toHaveTextContent('Comunidade1');
    const chips = within(screen.getByRole('group', { name: 'Filtros' })).getAllByRole('button').map((b) => b.dataset.testid);
    expect(chips.indexOf('caixa-filtro-comunidade')).toBe(chips.indexOf('caixa-filtro-equipe') + 1);
    expect(screen.getByTestId('caixa-conversa-c4')).toHaveTextContent('comunidade');
    expect(screen.getByTestId('caixa-conversa-c3')).not.toHaveTextContent('comunidade');
    await u.click(screen.getByTestId('caixa-filtro-comunidade'));
    expect(window.location.search).toBe('?filtro=comunidade');
    await waitFor(() => expect(gets).toContain('/whatsapp/conversas?filtro=comunidade'));
  });

  it('lista vazia diz o porquê', async () => {
    RESPOSTAS['/whatsapp/conversas'] = { ...LISTA, conversas: [], contagens: { ...LISTA.contagens, todas: 0 } };
    render(<CaixaPage />);
    expect(await screen.findByTestId('caixa-vazia')).toHaveTextContent(/Nenhuma conversa ainda/);
  });
});

describe('caixa de WhatsApp: abrir, ler, responder, arquivar', () => {
  const M_ENTRADA = msg('m1', { texto: 'pergunta inventada', lida: false });
  const M_CASA = msg('m2', { deMim: true, texto: 'resposta da casa', enviadaPor: { id: 'u1', nome: 'Pessoa da Casa' } });

  function respostasDaConversa(c = C1, mensagens = [M_ENTRADA, M_CASA], extra: Partial<ConversaAberta> = {}) {
    RESPOSTAS[`/whatsapp/conversas/${c.id}`] = aberta(c, mensagens, extra);
    RESPOSTAS[`POST /whatsapp/conversas/${c.id}/lida`] = { lidas: 1 };
  }

  it('abrir põe a conversa no endereço, mostra os balões e marca como lida', async () => {
    respostasDaConversa();
    const u = userEvent.setup();
    render(<CaixaPage />);
    await u.click(await screen.findByTestId('caixa-conversa-c1'));
    expect(window.location.search).toBe('?conversa=c1');
    const hist = await screen.findByTestId('caixa-historico');
    await within(hist).findByTestId('caixa-balao-m1');
    expect(within(hist).getByTestId('caixa-balao-m1')).toHaveAttribute('data-de-mim', 'nao');
    expect(within(hist).getByTestId('caixa-balao-m2')).toHaveAttribute('data-de-mim', 'sim');
    expect(screen.getByTestId('caixa-enviada-por-m2')).toHaveTextContent('enviada por Pessoa da Casa');
    expect(screen.getByTestId('caixa-titulo')).toHaveTextContent('Lead Ficticio');
    expect(screen.getByTestId('caixa-subtitulo')).toHaveTextContent('+55 (00) 00000-0001');
    expect(screen.getByTestId('whats-vinculo')).toHaveAttribute('data-pode-vincular', 'true');
    await waitFor(() => expect(posts.map((p) => p.caminho)).toContain('/whatsapp/conversas/c1/lida'));
    await waitFor(() => expect(screen.queryByTestId('caixa-nao-lidas-c1')).toBeNull());
  });

  it('grupo: nome de quem escreveu, participantes, citação e o documento com nome, tamanho, Abrir e Baixar', async () => {
    const msgs = [
      msg('g1', { remetenteNome: 'Pessoa Ficticia', texto: 'oi grupo' }),
      msg('g2', { tipo: 'document', texto: null, remetenteNumero: '5500000000003', midia: { mime: 'application/pdf', nome: 'contrato-ficticio.pdf', tamanho: 2048, segundos: null } }),
      msg('g3', { deMim: true, texto: 'respondendo', cita: { mensagemExternaId: 'ext-g1', texto: 'oi grupo', tipo: 'conversation', remetenteNome: 'Pessoa Ficticia', deMim: false } }),
    ];
    respostasDaConversa(C2, msgs, { participantes: [{ numero: '5500000000002', nome: 'Pessoa Ficticia', admin: true }] });
    window.history.replaceState(null, '', '/whatsapp?conversa=c2');
    render(<CaixaPage />);
    const g1 = await screen.findByTestId('caixa-balao-g1');
    expect(g1).toHaveTextContent('Pessoa Ficticia');
    expect(screen.getByTestId('caixa-balao-g2')).toHaveTextContent('+5500000000003');
    // Layout 27/10: o cartão "mídia não baixada" virou o documento de verdade (o arquivo só vem no clique).
    expect(screen.getByTestId('caixa-midia-nome-g2')).toHaveTextContent('contrato-ficticio.pdf');
    expect(screen.getByTestId('caixa-midia-g2')).toHaveTextContent(/2 KB · PDF/);
    expect(screen.getByTestId('caixa-midia-abrir-g2')).toBeInTheDocument();
    expect(screen.getByTestId('caixa-midia-baixar-g2')).toBeInTheDocument();
    expect(screen.queryByText(/mídia não baixada/)).toBeNull();
    expect(screen.getByTestId('caixa-citacao-g3')).toHaveTextContent('Pessoa Ficticiaoi grupo');
    expect(screen.getByTestId('caixa-subtitulo')).toHaveTextContent('grupo · 6 participantes');
    expect(screen.getByTestId('caixa-participantes')).toHaveTextContent('Pessoa Ficticia · +55 (00) 00000-0002 · admin');
  });

  it('responder: Enter envia, Shift+Enter quebra a linha, o balão entra com quem enviou', async () => {
    respostasDaConversa();
    const enviada = msg('m9', { deMim: true, texto: 'linha um\nlinha dois', enviadaPor: { id: 'eu', nome: 'Eu Ficticio' }, timestamp: new Date(Date.now() + 1000).toISOString() });
    RESPOSTAS['POST /whatsapp/conversas/c1/responder'] = { mensagem: enviada };
    window.history.replaceState(null, '', '/whatsapp?conversa=c1');
    const u = userEvent.setup();
    render(<CaixaPage />);
    const caixa = await screen.findByTestId('caixa-resposta');
    expect(screen.getByTestId('caixa-enviar')).toBeDisabled();
    await u.type(caixa, 'linha um{Shift>}{Enter}{/Shift}linha dois');
    expect(caixa).toHaveValue('linha um\nlinha dois');
    expect(screen.getByTestId('caixa-contador')).toHaveTextContent('19/4000');
    expect(posts.some((p) => p.caminho.endsWith('/responder'))).toBe(false);
    await u.type(caixa, '{Enter}');
    await waitFor(() => expect(posts.find((p) => p.caminho === '/whatsapp/conversas/c1/responder')?.corpo).toEqual({ texto: 'linha um\nlinha dois' }));
    expect(await screen.findByTestId('caixa-balao-m9')).toHaveTextContent('linha um');
    expect(screen.getByTestId('caixa-enviada-por-m9')).toHaveTextContent('enviada por Eu Ficticio');
    expect(caixa).toHaveValue('');
  });

  // Layout 26/10: a mensagem sai como ROOT; o nome de quem enviou não vai no texto (fica só no OS).
  it('responder: vai à API só o texto digitado, sem nome, e o aviso diz que sai como ROOT', async () => {
    respostasDaConversa();
    RESPOSTAS['POST /whatsapp/conversas/c1/responder'] = { mensagem: msg('m8', { deMim: true, texto: 'oi', enviadaPor: { id: 'eu', nome: 'Eu Ficticio' } }) };
    window.history.replaceState(null, '', '/whatsapp?conversa=c1');
    const u = userEvent.setup();
    render(<CaixaPage />);
    const caixa = await screen.findByTestId('caixa-resposta');
    expect(screen.getByTestId('caixa-aviso-envio')).toHaveTextContent('com o seu nome em negrito no topo');
    expect(screen.getByTestId('caixa-aviso-envio')).toHaveTextContent('para o cliente saber quem está falando');
    await u.type(caixa, 'oi{Enter}');
    await waitFor(() => expect(posts.find((p) => p.caminho === '/whatsapp/conversas/c1/responder')?.corpo).toEqual({ texto: 'oi' }));
  });

  it('a falha do envio aparece ao lado da caixa, e o texto fica', async () => {
    respostasDaConversa();
    RESPOSTAS['POST /whatsapp/conversas/c1/responder'] = new ErroDaApi('A Evolution não respondeu. Nada foi enviado; tente de novo.', 503);
    window.history.replaceState(null, '', '/whatsapp?conversa=c1');
    const u = userEvent.setup();
    render(<CaixaPage />);
    const caixa = await screen.findByTestId('caixa-resposta');
    await u.type(caixa, 'oi{Enter}');
    expect(await screen.findByText(/Nada foi enviado/)).toBeInTheDocument();
    expect(caixa).toHaveValue('oi');
  });

  it('sem whatsapp.conversar: a caixa de resposta fica desligada com a razão, e não há arquivar', async () => {
    respostasDaConversa(C1, [M_ENTRADA], { podeResponder: false, podeVincular: false });
    RESPOSTAS['/whatsapp/conversas'] = { ...LISTA, podeResponder: false, podeVincular: false };
    window.history.replaceState(null, '', '/whatsapp?conversa=c1');
    render(<CaixaPage />);
    const caixa = await screen.findByTestId('caixa-resposta');
    expect(caixa).toBeDisabled();
    expect(screen.getByTestId('caixa-sem-resposta')).toHaveTextContent(/permissão de conversar/);
    expect(screen.getByTestId('caixa-enviar')).toBeDisabled();
    expect(screen.queryByTestId('caixa-arquivar')).toBeNull();
    expect(screen.getByTestId('whats-vinculo')).toHaveAttribute('data-pode-vincular', 'false');
  });

  it('arquivar e voltar para a caixa; arquivada não recebe resposta', async () => {
    respostasDaConversa();
    let arquivada = false;
    RESPOSTAS['POST /whatsapp/conversas/c1/arquivar'] = (corpo: { arquivada: boolean }) => {
      arquivada = corpo.arquivada;
      return { ...C1, arquivada };
    };
    window.history.replaceState(null, '', '/whatsapp?conversa=c1');
    const u = userEvent.setup();
    render(<CaixaPage />);
    const botao = await screen.findByTestId('caixa-arquivar');
    expect(botao).toHaveTextContent('Arquivar conversa');
    await u.click(botao);
    await waitFor(() => expect(screen.getByTestId('caixa-arquivar')).toHaveTextContent('Voltar para a caixa'));
    expect(posts.find((p) => p.caminho.endsWith('/arquivar'))?.corpo).toEqual({ arquivada: true });
    expect(screen.getByTestId('caixa-resposta')).toBeDisabled();
    expect(screen.getByTestId('caixa-sem-resposta')).toHaveTextContent(/arquivada/);
    await u.click(screen.getByTestId('caixa-arquivar'));
    await waitFor(() => expect(screen.getByTestId('caixa-arquivar')).toHaveTextContent('Arquivar conversa'));
    expect(arquivada).toBe(false);
    expect(screen.getByTestId('caixa-resposta')).not.toBeDisabled();
  });

  it('mais antigas pelo botão, com o cursor da primeira mensagem', async () => {
    respostasDaConversa(C1, [M_ENTRADA], { maisAntigas: true });
    window.history.replaceState(null, '', '/whatsapp?conversa=c1');
    const u = userEvent.setup();
    render(<CaixaPage />);
    await screen.findByTestId('caixa-balao-m1');
    RESPOSTAS['/whatsapp/conversas/c1?antesDe='] = aberta(C1, [msg('m0', { texto: 'a mais antiga', timestamp: '2026-10-01T10:00:00.000Z' })], { maisAntigas: false });
    await u.click(screen.getByTestId('caixa-mais-antigas'));
    expect(await screen.findByTestId('caixa-balao-m0')).toHaveTextContent('a mais antiga');
    expect(gets.some((g) => g.startsWith('/whatsapp/conversas/c1?antesDe=') && g.includes('antesDeId=m1'))).toBe(true);
    expect(screen.queryByTestId('caixa-mais-antigas')).toBeNull();
    const ordem = within(screen.getByTestId('caixa-historico')).getAllByTestId(/^caixa-balao-/).map((b) => b.dataset.testid);
    expect(ordem).toEqual(['caixa-balao-m0', 'caixa-balao-m1']);
  });

  it('conversa de outra empresa ou que não existe: a frase, sem caixa de resposta', async () => {
    RESPOSTAS['/whatsapp/conversas/sumida'] = new ErroDaApi('Conversa não encontrada.', 404);
    window.history.replaceState(null, '', '/whatsapp?conversa=sumida');
    render(<CaixaPage />);
    expect(await screen.findByText(/não existe ou não é desta empresa/)).toBeInTheDocument();
    expect(screen.queryByTestId('caixa-resposta')).toBeNull();
  });
});

describe('caixa de WhatsApp: 390 px, lista e conversa em telas separadas', () => {
  it('sem conversa: a lista aparece e a conversa some no celular; aberta: o contrário, com Voltar', async () => {
    RESPOSTAS['/whatsapp/conversas/c1'] = aberta(C1, [msg('m1')]);
    const u = userEvent.setup();
    render(<CaixaPage />);
    const grade = await screen.findByTestId('caixa-grade');
    expect(grade.dataset.vista).toBe('lista');
    expect(grade.className).toContain('grid-cols-[minmax(0,1fr)]');
    expect(grade.className).toMatch(/md:grid-cols-\[minmax\(16rem,22rem\)_minmax\(0,1fr\)\]/);
    expect(screen.getByTestId('caixa-coluna-lista').className).not.toContain('max-md:hidden');
    expect(screen.getByTestId('caixa-coluna-conversa').className).toContain('max-md:hidden');
    // Cada coluna rola por dentro; a página não.
    expect(screen.getByTestId('caixa-coluna-lista').className).toContain('overflow-hidden');

    await u.click(await screen.findByTestId('caixa-conversa-c1'));
    expect(grade.dataset.vista).toBe('conversa');
    expect(screen.getByTestId('caixa-coluna-lista').className).toContain('max-md:hidden');
    expect(screen.getByTestId('caixa-coluna-conversa').className).not.toContain('max-md:hidden');
    expect(screen.getByTestId('caixa-historico').className).toContain('overflow-y-auto');
    const voltar = screen.getByTestId('caixa-voltar');
    expect(voltar.className).toContain('md:hidden');
    await u.click(voltar);
    expect(grade.dataset.vista).toBe('lista');
    expect(window.location.search).toBe('');
  });

  it('o voltar do navegador fecha a conversa', async () => {
    RESPOSTAS['/whatsapp/conversas/c1'] = aberta(C1, [msg('m1')]);
    const u = userEvent.setup();
    render(<CaixaPage />);
    await u.click(await screen.findByTestId('caixa-conversa-c1'));
    expect(screen.getByTestId('caixa-grade').dataset.vista).toBe('conversa');
    await act(async () => {
      window.history.replaceState(null, '', '/whatsapp');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByTestId('caixa-grade').dataset.vista).toBe('lista');
  });
});
