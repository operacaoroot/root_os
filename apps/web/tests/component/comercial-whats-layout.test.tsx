/*
 * Lane P6 (rodada do painel): o WhatsApp do comercial no desenho de
 * atendimento (lista, conversa, contexto; uma coluna por vez no celular) e a
 * varredura de "texto longo não vaza" nas telas do comercial e na sala.
 *
 * No jsdom não há layout: o que se confere são as classes que fazem o texto
 * quebrar ou cortar (com o texto inteiro no `title`) e as grades com trilho
 * `minmax(0, …)`. A medida de verdade (scrollWidth em 390, 768 e 1440) é do
 * navegador, em homolog/.tmp/p6-varredura.mjs.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CelularDaMesa, CelularDoLead, ContratoVivo, EstadoDaSala, FichaDoLead, ListaDeCelulares, TorreDasAutomacoes } from '@mktos/shared';

let RESPOSTAS: Record<string, unknown> = {};
const posts: { caminho: string; corpo: unknown }[] = [];

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'eu' }, can: () => true }) }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ token: 'tokenDaSalaDeTeste' }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => <a href={href} {...resto}>{children}</a>,
}));
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  const achar = (caminho: string) => {
    const chave = Object.keys(RESPOSTAS)
      .sort((a, b) => b.length - a.length)
      .find((k) => caminho.startsWith(k));
    const r = chave ? RESPOSTAS[chave] : undefined;
    if (r instanceof Error) throw r;
    return r;
  };
  return {
    ...real,
    apiGet: vi.fn(async (caminho: string) => achar(caminho)),
    apiPost: vi.fn(async (caminho: string, corpo: unknown) => {
      posts.push({ caminho, corpo });
      return achar(caminho) ?? {};
    }),
  };
});

import SimuladorPage from '@/app/comercial/simulador/page';
import LayoutDoComercial from '@/app/comercial/layout';
import ContratosPage from '@/app/comercial/contratos/page';
import TorrePage from '@/app/comercial/torre/page';
import SalaPage from '@/app/s/[token]/page';

// Os textos da varredura: nome de 80+, URL de 200+, mensagem de 2.000 e uma palavra sem espaço.
const NOME = 'Construtora e Incorporadora Horizonte Azul do Vale do Paraibuna Sociedade Ltda ME';
const URL_LONGA = `https://exemplo.com.br/${'caminho-muito-comprido-sem-espaco/'.repeat(5)}?utm=${'a'.repeat(40)}`;
const MENSAGEM = `Bom dia! ${URL_LONGA} `.repeat(20).slice(0, 2000);
const PALAVRA = 'Supercalifragilistiexpialidocioso'.repeat(4);
const AGORA = new Date().toISOString();

const LISTA: ListaDeCelulares = {
  provedor: 'simulado',
  leads: [
    { leadId: 'lead-longo', nome: NOME, telefone: '5532999990001', etapa: 'reuniao_agendada', ultimaEm: AGORA, naFila: 3 },
    { leadId: 'lead-ana', nome: 'Ana', telefone: '5532999990002', etapa: 'novo_lead', ultimaEm: AGORA, naFila: 0 },
  ],
};
const CONVERSA: CelularDoLead = {
  leadId: 'lead-longo',
  nome: NOME,
  telefone: '5532999990001',
  etapa: 'reuniao_agendada',
  linkDaSala: null,
  mensagens: [
    { id: 'm1', direcao: 'entrada', destino: 'lead', template: null, texto: URL_LONGA, estado: 'recebida', interativo: null, approvalId: null, vetoAte: null, em: AGORA, enviadaEm: AGORA, erro: null },
    { id: 'm2', direcao: 'saida', destino: 'lead', template: 'M1', texto: MENSAGEM, estado: 'enviada', interativo: { botoes: [{ chave: 'h1', rotulo: `segunda-feira às 10:00 ${PALAVRA}` }] }, approvalId: null, vetoAte: null, em: AGORA, enviadaEm: AGORA, erro: null },
  ],
};
const MESA: CelularDaMesa = { decisoes: [], mensagensNaFila: [], responderDisponivel: true };
const FICHA = {
  leadId: 'lead-longo',
  nome: NOME,
  empresa: NOME,
  telefone: '5532999990001',
  etapa: 'reuniao_agendada',
  saude: 60,
  dono: { id: 'u', nome: 'Mesa' },
  proximaAcao: { tipo: 'lembrete', quando: null, descricao: `Mandar o link ${URL_LONGA}` },
  portao: { proxima: 'sessao', faltando: [], itens: [] },
} as unknown as FichaDoLead;

function respostasDoSimulador() {
  RESPOSTAS['/comercial/simulador/celulares'] = LISTA;
  RESPOSTAS['/comercial/simulador/mesa'] = MESA;
  RESPOSTAS['/comercial/simulador/lead/lead-longo'] = CONVERSA;
  RESPOSTAS['/comercial/lead/lead-longo'] = FICHA;
}

beforeEach(() => {
  RESPOSTAS = {};
  posts.length = 0;
  window.localStorage.clear();
  window.history.replaceState(null, '', '/comercial/simulador');
});

describe('WhatsApp do comercial: três colunas no desktop, uma por vez no celular', () => {
  it('a grade tem lista, conversa e contexto, com trilhos que encolhem (minmax(0, …))', async () => {
    respostasDoSimulador();
    render(<SimuladorPage />);
    const grade = await screen.findByTestId('whats-atendimento');
    expect(grade.className).toContain('grid-cols-[minmax(0,1fr)]');
    expect(grade.className).toMatch(/md:grid-cols-\[minmax\(14rem,18rem\)_minmax\(0,1fr\)\]/);
    expect(grade.className).toMatch(/xl:grid-cols-\[minmax\(15rem,19rem\)_minmax\(0,1fr\)_minmax\(18rem,23rem\)\]/);
    for (const id of ['whats-lista', 'whats-painel-da-conversa', 'whats-contexto']) expect(within(grade).getByTestId(id)).toBeInTheDocument();
    expect(await screen.findByTestId('whats-conversa-lead-longo')).toBeInTheDocument();
    // Sem conversa aberta, o celular mostra a lista e esconde o resto; o contexto só aparece a partir de 1280 px.
    expect(grade.dataset.vista).toBe('lista');
    expect(screen.getByTestId('whats-painel-da-conversa').className).toContain('max-md:hidden');
    expect(screen.getByTestId('whats-contexto').className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(screen.getByTestId('whats-contexto').className).toContain('xl:flex');
    expect(screen.queryByTestId('whats-voltar')).toBeNull();
  });

  it('lista → conversa → contexto → conversa → lista, com voltar', async () => {
    respostasDoSimulador();
    const u = userEvent.setup();
    render(<SimuladorPage />);
    await u.click(await screen.findByTestId('whats-conversa-lead-longo'));
    const grade = screen.getByTestId('whats-atendimento');
    expect(grade.dataset.vista).toBe('conversa');
    expect(screen.getByTestId('whats-lista').className).toContain('max-md:hidden');
    expect(await screen.findByTestId('whats-balao-m2')).toBeInTheDocument();
    expect(screen.getAllByTestId('whats-voltar')).toHaveLength(1);

    await u.click(screen.getByTestId('whats-abrir-contexto'));
    expect(grade.dataset.vista).toBe('contexto');
    const contexto = screen.getByTestId('whats-contexto');
    expect(contexto.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(screen.getByTestId('whats-painel-da-conversa').className).toMatch(/(^|\s)hidden(\s|$)/);
    // O contexto do lead: etapa, próxima ação e o caminho para o cockpit.
    expect(await within(contexto).findByText(/Mandar o link/)).toBeInTheDocument();
    expect(within(contexto).getByText('E3 · Reunião agendada')).toBeInTheDocument();
    expect(within(contexto).getByTestId('whats-abrir-cockpit').getAttribute('href')).toContain('lead=lead-longo');

    await u.click(screen.getByTestId('whats-voltar'));
    expect(grade.dataset.vista).toBe('conversa');
    await u.click(screen.getByTestId('whats-voltar'));
    expect(grade.dataset.vista).toBe('lista');
  });

  it('vindo do painel com ?conversa=, abre direto na conversa', async () => {
    respostasDoSimulador();
    window.history.replaceState(null, '', '/comercial/simulador?conversa=lead-longo');
    render(<SimuladorPage />);
    expect(await screen.findByTestId('whats-balao-m1')).toBeInTheDocument();
    expect(screen.getByTestId('whats-atendimento').dataset.vista).toBe('conversa');
  });

  it('a mesa é alcançável da lista (aba mesa), mesmo sem conversa aberta', async () => {
    respostasDoSimulador();
    RESPOSTAS['/comercial/simulador/mesa'] = { ...MESA, mensagensNaFila: [{ id: 'q1', leadId: 'lead-longo', leadNome: NOME, template: 'M3', texto: MENSAGEM, estado: 'na_fila', approvalId: 'ap1', vetoAte: null, em: AGORA }] } satisfies CelularDaMesa;
    const u = userEvent.setup();
    render(<SimuladorPage />);
    await waitFor(() => expect(screen.getByTestId('whats-abrir-mesa')).toHaveTextContent('mesa · 1'));
    await u.click(screen.getByTestId('whats-abrir-mesa'));
    expect(screen.getByTestId('whats-atendimento').dataset.vista).toBe('contexto');
    expect(screen.getByTestId('whats-aba-mesa')).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('button', { name: 'Liberar envio' })).toBeInTheDocument();
  });

  it('busca e filtro de estado reduzem a lista; sem resultado, diz', async () => {
    respostasDoSimulador();
    const u = userEvent.setup();
    render(<SimuladorPage />);
    await screen.findByTestId('whats-conversa-lead-ana');
    await u.type(screen.getByTestId('whats-busca'), 'ana');
    expect(screen.queryByTestId('whats-conversa-lead-longo')).toBeNull();
    expect(screen.getByTestId('whats-conversa-lead-ana')).toBeInTheDocument();
    await u.clear(screen.getByTestId('whats-busca'));
    fireEvent.change(screen.getByTestId('whats-filtro-estado'), { target: { value: 'na_fila' } });
    expect(screen.queryByTestId('whats-conversa-lead-ana')).toBeNull();
    expect(screen.getByTestId('whats-conversa-lead-longo')).toBeInTheDocument();
    await u.type(screen.getByTestId('whats-busca'), 'zzz');
    expect(screen.getByText('Nenhuma conversa com esse filtro.')).toBeInTheDocument();
  });
});

describe('texto longo não vaza', () => {
  it('no WhatsApp: nome de 80 corta com o nome inteiro no title; balão quebra URL e mensagem de 2.000', async () => {
    respostasDoSimulador();
    window.history.replaceState(null, '', '/comercial/simulador?conversa=lead-longo');
    const u = userEvent.setup();
    render(<SimuladorPage />);
    const item = await screen.findByTestId('whats-conversa-lead-longo');
    expect(item).toHaveAttribute('title', NOME);
    expect(within(item).getByText(NOME).className).toContain('truncate');
    // O contador de "na fila" e a hora não encolhem o nome: a linha é grid com trilho minmax(0,1fr).
    expect(item.className).toContain('grid-cols-[minmax(0,1fr)_auto]');

    const titulo = await screen.findByRole('heading', { level: 2, name: NOME });
    expect(titulo.className).toContain('truncate');
    expect(titulo).toHaveAttribute('title', NOME);

    const balaoUrl = await screen.findByTestId('whats-balao-m1');
    expect(balaoUrl.className).toContain('[overflow-wrap:anywhere]');
    expect(balaoUrl.className).toContain('min-w-0');
    expect(balaoUrl.className).toMatch(/max-w-\[min\(85%,40rem\)\]/);
    const p = within(balaoUrl).getByText(URL_LONGA);
    expect(p.className).toContain('whitespace-pre-wrap');
    expect(p.className).toContain('[overflow-wrap:anywhere]');

    // A mensagem de 2.000 vem recolhida e abre inteira; o botão de horário com rótulo comprido quebra dentro dele.
    const balao = screen.getByTestId('whats-balao-m2');
    expect(within(balao).queryByText(MENSAGEM)).toBeNull();
    await u.click(within(balao).getByRole('button', { name: /ler a mensagem inteira \(2000 caracteres\)/ }));
    expect(within(balao).getByText(MENSAGEM.trim(), { normalizer: (s) => s.trim() })).toBeInTheDocument();
    const horario = within(balao).getByRole('button', { name: /segunda-feira às 10:00/ });
    expect(horario.className).toContain('whitespace-normal');
    expect(horario.className).toContain('max-w-full');
  });

  it('a raiz do comercial herda a quebra em qualquer ponto', () => {
    const { container } = render(
      <LayoutDoComercial>
        <p>{PALAVRA}</p>
      </LayoutDoComercial>,
    );
    const raiz = container.querySelector('[data-comercial-raiz]');
    expect(raiz?.className).toContain('[overflow-wrap:anywhere]');
    expect(raiz?.className).toContain('min-w-0');
  });

  it('contratos: o cliente comprido corta com o nome no title, e a grade tem trilho que encolhe', async () => {
    RESPOSTAS['/comercial/contratos'] = [
      { leadId: 'c1', cliente: NOME, produto: null, valorCentavos: 100, descontoPct: null, parcelas: [], saude: null, faseDaImplantacao: null } as unknown as ContratoVivo,
    ];
    render(<ContratosPage />);
    const nome = await screen.findByText(NOME);
    expect(nome.className).toContain('truncate');
    expect(nome).toHaveAttribute('title', NOME);
    const lista = nome.closest('ul');
    expect(lista?.className).toContain('grid-cols-[minmax(0,1fr)]');
    expect(nome.closest('li')?.className).toContain('min-w-0');
  });

  it('torre: as colunas acompanham a largura em vez de 170/110/90/110 px', async () => {
    RESPOSTAS['/comercial/torre'] = {
      vigia: { ultimaPassagemEm: null, premissasConferidas: 0, premissasQuebradas: 0 },
      custoDeIaHojeCentavos: null,
      custoDesconhecido: false,
      automacoes: [{ chave: 'qualificador', rotulo: `Automação ${PALAVRA}`, autonomia: 'A3', ultimaVezEm: null, acerto30Dias: null, premissa: URL_LONGA, premissaOk: true }],
    } as TorreDasAutomacoes;
    render(<TorrePage />);
    const rotulo = await screen.findByText(`Automação ${PALAVRA}`);
    expect(rotulo.className).toContain('min-w-0');
    const linha = rotulo.closest('li');
    expect(linha?.className).not.toMatch(/170px/);
    expect(linha?.className).toMatch(/md:grid-cols-\[minmax\(8rem,1\.3fr\)/);
  });

  it('sala do cliente: a casca quebra em qualquer ponto e cresce no desktop; o estágio cortado tem title', async () => {
    const sala = {
      slug: 'x',
      empresa: NOME,
      contato: null,
      estagio: 'conversa',
      estagios: [
        { chave: 'conversa', rotulo: 'conversa', estado: 'atual' },
        { chave: 'diagnostico', rotulo: 'diagnóstico', estado: 'vem' },
        { chave: 'proposta', rotulo: 'proposta', estado: 'vem' },
        { chave: 'contrato', rotulo: 'contrato', estado: 'vem' },
        { chave: 'comeco', rotulo: 'começo', estado: 'vem' },
      ],
      conversa: { horario: null, horariosOferecidos: [], duracaoMin: 45, oQueContou: [URL_LONGA] },
      planoDeAcao: [{ texto: PALAVRA, feito: false }],
      diagnostico: null,
      proposta: null,
      aceite: null,
      comeco: null,
      validoAte: AGORA,
    } as unknown as EstadoDaSala;
    RESPOSTAS['/sala/tokenDaSalaDeTeste'] = sala;
    render(<SalaPage />);
    const titulo = await screen.findByRole('heading', { level: 1, name: NOME });
    const casca = titulo.closest('[data-os-app]');
    expect(casca?.className).toContain('[overflow-wrap:anywhere]');
    expect(casca?.firstElementChild?.className).toMatch(/max-w-md.*md:max-w-xl.*lg:max-w-2xl/);
    expect(screen.getByText('diagnóstico')).toHaveAttribute('title', 'diagnóstico');
    expect(screen.getByRole('list', { name: 'estágios' }).className).toContain('grid-cols-[repeat(5,minmax(0,1fr))]');
  });
});
