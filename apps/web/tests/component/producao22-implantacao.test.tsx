/*
 * RODADA DE PRODUÇÃO 2 (22/10/2026), M1 na tela:
 *  · o cartão: "reunião dd/mm" com o dia da semana e a hora no title, e o selo
 *    "fase do trilho: N de 5" quando etapa e trilho divergem; sem dado, nada;
 *  · o painel do card: a reunião por extenso, "Agenda indisponível" e a frase da divergência;
 *  · "Pedir agora" em cada agente, desabilitado com a razão quando o agente está desligado;
 *  · o menu da coluna: "Limite de cartões nesta etapa", com a versão lida e o 409;
 *  · Dia a dia › Visão geral: o cartão "Implantação" com as três linhas e "Implantação em dia".
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImplantacaoDoCartao, ImplantacaoDoQuadro, QuemTrabalhaNaEtapa as Dados, ResumoDaImplantacao } from '@mktos/shared';

let QUADRO: ImplantacaoDoQuadro | Error = { agenda: 'ok', itens: [] };
let QUEM: Dados | null = null;
let RESUMO: ResumoDaImplantacao | Error | null = null;
let PODE = true;
const patches: Array<{ caminho: string; corpo: unknown }> = [];
let respostaDoPatch: () => unknown = () => ({});

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'eu' }, can: () => PODE }) }));
vi.mock('next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return {
    ...real,
    apiGet: vi.fn(async (caminho: string) => {
      if (caminho.includes('/implantacao/cartoes')) { if (QUADRO instanceof Error) throw QUADRO; return QUADRO; }
      if (caminho.includes('/implantacao/resumo')) { if (RESUMO instanceof Error) throw RESUMO; return RESUMO; }
      if (caminho.includes('/quem-trabalha')) return QUEM;
      if (caminho.includes('/kit')) return { kit: null, avisoSemKit: false };
      return null;
    }),
    apiPatch: vi.fn(async (caminho: string, corpo: unknown) => { patches.push({ caminho, corpo }); return respostaDoPatch(); }),
  };
});

import { ImplantacaoDoQuadroContexto, ImplantacaoNoPainel, ReuniaoESeloNoCartao } from '@/components/trabalho/ImplantacaoDoCartao';
import { LimiteDaColuna } from '@/components/trabalho/LimiteDaColuna';
import { QuemTrabalhaNaEtapa } from '@/components/trabalho/QuemTrabalhaNaEtapa';
import { ImplantacaoNoDiaADia } from '@/components/tarefas/ImplantacaoNoDiaADia';

const REUNIAO = { inicio: '2026-10-23T17:00:00.000Z', diaInteiro: false, titulo: 'Reunião Online - Studio Lume - Pedro', casadoPor: 'email' as const };
const DIVERGE = { fase: 'contrato' as const, numero: 3, diverge: true, selo: 'fase do trilho: 3 de 5', frase: 'o card está em Imersão e o trilho ainda na fase 3 de 5 (Contrato e onboarding)' };

function noQuadro(itens: ImplantacaoDoCartao[], tarefaId: string) {
  return (
    <ImplantacaoDoQuadroContexto.Provider value={{ agenda: 'ok', porCartao: new Map(itens.map((i) => [i.tarefaId, i])) }}>
      <ReuniaoESeloNoCartao tarefaId={tarefaId} />
    </ImplantacaoDoQuadroContexto.Provider>
  );
}

beforeEach(() => {
  QUADRO = { agenda: 'ok', itens: [] };
  QUEM = null;
  RESUMO = null;
  PODE = true;
  patches.length = 0;
  respostaDoPatch = () => ({});
});

describe('o cartão: reunião e selo da fase', () => {
  it('"reunião 23/10" com o dia da semana e a hora de São Paulo no title, e o selo quando diverge', () => {
    render(noQuadro([{ tarefaId: 'c1', reuniao: REUNIAO, fase: DIVERGE }], 'c1'));
    const r = screen.getByTestId('cartao-reuniao');
    expect(r).toHaveTextContent('reunião 23/10');
    expect(r.getAttribute('title')).toBe('Próxima reunião: sexta-feira, 23/10/2026 às 14:00');
    const s = screen.getByTestId('cartao-selo-fase');
    expect(s).toHaveTextContent('fase do trilho: 3 de 5');
    expect(s.getAttribute('title')).toContain('o card está em Imersão e o trilho ainda na fase 3 de 5');
  });

  it('sem evento, sem divergência ou sem o card na leitura: nada', () => {
    const { container, rerender } = render(noQuadro([{ tarefaId: 'c1', reuniao: null, fase: { ...DIVERGE, diverge: false, selo: null, frase: null } }], 'c1'));
    expect(container.textContent).toBe('');
    rerender(noQuadro([], 'c1'));
    expect(container.textContent).toBe('');
    rerender(<ReuniaoESeloNoCartao tarefaId="c1" />);
    expect(container.textContent).toBe('');
  });

  it('reunião de dia inteiro: sem hora', () => {
    render(noQuadro([{ tarefaId: 'c1', reuniao: { ...REUNIAO, inicio: '2026-10-24T03:00:00.000Z', diaInteiro: true }, fase: null }], 'c1'));
    expect(screen.getByTestId('cartao-reuniao')).toHaveTextContent('reunião 24/10');
    expect(screen.getByTestId('cartao-reuniao').getAttribute('title')).toBe('Próxima reunião: sábado, 24/10/2026 (dia inteiro)');
  });
});

describe('o painel do card: agenda e trilho', () => {
  it('a reunião por extenso e a frase da divergência', async () => {
    QUADRO = { agenda: 'ok', itens: [{ tarefaId: 'c1', reuniao: REUNIAO, fase: DIVERGE }] };
    render(<ImplantacaoNoPainel tarefaId="c1" listId="l1" token="tok" />);
    expect(await screen.findByTestId('painel-reuniao')).toHaveTextContent('Próxima reunião: sexta-feira, 23/10/2026 às 14:00 · Reunião Online - Studio Lume - Pedro');
    expect(screen.getByTestId('painel-fase-diverge')).toHaveTextContent('o card está em Imersão e o trilho ainda na fase 3 de 5');
  });

  it('a agenda falhando: "Agenda indisponível", e o selo continua', async () => {
    QUADRO = { agenda: 'indisponivel', itens: [{ tarefaId: 'c1', reuniao: null, fase: DIVERGE }] };
    render(<ImplantacaoNoPainel tarefaId="c1" listId="l1" token="tok" />);
    expect(await screen.findByTestId('painel-reuniao')).toHaveTextContent('Próxima reunião: Agenda indisponível');
    expect(screen.getByTestId('painel-fase-diverge')).toBeTruthy();
  });

  it('sem reunião nos 14 dias diz isso; a leitura falhando não mostra nada', async () => {
    QUADRO = { agenda: 'ok', itens: [{ tarefaId: 'c1', reuniao: null, fase: null }] };
    const { unmount } = render(<ImplantacaoNoPainel tarefaId="c1" listId="l1" token="tok" />);
    expect(await screen.findByTestId('painel-reuniao')).toHaveTextContent('nenhuma nos próximos 14 dias');
    expect(screen.queryByTestId('painel-fase-diverge')).toBeNull();
    unmount();
    QUADRO = new Error('500');
    const { container } = render(<ImplantacaoNoPainel tarefaId="c1" listId="l1" token="tok" />);
    await new Promise((r) => setTimeout(r, 10));
    expect(container.textContent).toBe('');
  });
});

describe('"Pedir agora" em Quem trabalha nesta etapa', () => {
  const agente = (slug: string, estado: Dados['agentes'][number]['estado'], estadoDeclarado = 'ativo'): Dados['agentes'][number] => ({
    slug, nome: slug, iniciais: 'AG', missao: 'm', estado, ultimoFato: null, oQueVaiFazer: 'x', estadoDeclarado,
  });
  const dados = (agentes: Dados['agentes'], fase = 'contrato'): Dados => ({
    trilhoId: 'tri-1', fase, faseRotulo: '2 · Contrato e onboarding', agentes,
    relogio: { nome: 'Relógio do onboarding', ligado: false, proximaPassagemEm: null, ultimoFato: null, vaiFazer: [] },
  });

  it('cada agente abre o ponto certo, com o trilho do cliente', async () => {
    QUEM = dados([agente('leitor-de-ata', 'ativo'), agente('pesquisador-de-conta', 'ativo'), agente('roteirista-de-kickoff', 'ativo'), agente('montador-do-kit', 'ativo')]);
    render(<QuemTrabalhaNaEtapa trilhoId="tri-1" token="tok" />);
    expect((await screen.findByTestId('pedir-agora-leitor-de-ata')).getAttribute('href')).toBe('/onboarding/tri-1?foco=ata');
    expect(screen.getByTestId('pedir-agora-pesquisador-de-conta').getAttribute('href')).toBe('/onboarding/tri-1?foco=dossie');
    expect(screen.getByTestId('pedir-agora-roteirista-de-kickoff').getAttribute('href')).toBe('/onboarding/tri-1/roteiro?foco=personalizar');
    expect(screen.getByTestId('pedir-agora-montador-do-kit').getAttribute('href')).toBe('#kit-da-implantacao');
    // O kit mora no painel: o clique leva até ele sem sair da página.
    fireEvent.click(screen.getByTestId('pedir-agora-montador-do-kit'));
    // Sem botão de escrita na seção: os atalhos são links.
    expect(within(screen.getByTestId('quem-trabalha')).queryByRole('button')).toBeNull();
  });

  it('agente desligado no cadastro ou pausado em Agentes: botão desabilitado com a razão', async () => {
    QUEM = dados([agente('leitor-de-ata', 'ativo', 'desligado'), agente('pesquisador-de-conta', 'pausado')]);
    render(<QuemTrabalhaNaEtapa trilhoId="tri-1" token="tok" />);
    const b = await screen.findByTestId('pedir-agora-leitor-de-ata');
    expect(b).toBeDisabled();
    expect(screen.getByTestId('pedir-agora-razao-leitor-de-ata')).toHaveTextContent('Desligado no cadastro de agentes: ligue antes de pedir.');
    expect(screen.getByTestId('pedir-agora-pesquisador-de-conta')).toBeDisabled();
    expect(screen.getByTestId('pedir-agora-razao-pesquisador-de-conta')).toHaveTextContent('Está pausado em Agentes');
  });

  it('sem permissão de editar tarefas: desabilitado, dizendo por quê', async () => {
    PODE = false;
    QUEM = dados([agente('leitor-de-ata', 'ativo')]);
    render(<QuemTrabalhaNaEtapa trilhoId="tri-1" token="tok" />);
    expect(await screen.findByTestId('pedir-agora-leitor-de-ata')).toBeDisabled();
    expect(screen.getByTestId('pedir-agora-razao-leitor-de-ata')).toHaveTextContent('Pedir exige a permissão de editar tarefas.');
  });
});

describe('o menu da coluna: limite de cartões nesta etapa', () => {
  const st = { id: '00000000-0000-4000-8000-0000000000a1', name: 'Imersão', limite: null };

  it('define o limite com a versão lida e recarrega o quadro', async () => {
    const onMudou = vi.fn();
    render(<LimiteDaColuna status={st} token="tok" onMudou={onMudou} onErro={vi.fn()} />);
    fireEvent.click(screen.getByTestId(`coluna-menu-${st.id}`));
    expect(screen.getByTestId('coluna-menu-limite')).toHaveTextContent('Limite de cartões nesta etapa');
    expect(screen.getByTestId('coluna-menu-limite')).toHaveTextContent('sem limite');
    fireEvent.click(screen.getByTestId('coluna-menu-limite'));
    fireEvent.change(screen.getByTestId('coluna-limite-input'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('coluna-limite-salvar'));
    await waitFor(() => expect(onMudou).toHaveBeenCalled());
    expect(patches).toEqual([{ caminho: `/trabalho/statuses/${st.id}/limite`, corpo: { limite: 3, esperado: null } }]);
  });

  it('número fora da régua não sai; vazio tira o limite; 409 avisa e recarrega', async () => {
    const onMudou = vi.fn();
    render(<LimiteDaColuna status={{ ...st, limite: 2 }} token="tok" onMudou={onMudou} onErro={vi.fn()} />);
    fireEvent.click(screen.getByTestId(`coluna-menu-${st.id}`));
    fireEvent.click(screen.getByTestId('coluna-menu-limite'));
    fireEvent.change(screen.getByTestId('coluna-limite-input'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('coluna-limite-salvar'));
    expect(await screen.findByTestId('coluna-limite-aviso')).toHaveTextContent('número inteiro de 1 a 99');
    expect(patches).toHaveLength(0);
    respostaDoPatch = () => { throw Object.assign(new Error('conflito'), { status: 409 }); };
    fireEvent.click(screen.getByTestId('coluna-limite-tirar'));
    expect(await screen.findByText(/O limite mudou desde que a tela foi lida/)).toBeTruthy();
    expect(patches).toEqual([{ caminho: `/trabalho/statuses/${st.id}/limite`, corpo: { limite: null, esperado: 2 } }]);
    expect(onMudou).toHaveBeenCalled();
  });
});

describe('Dia a dia › Visão geral: o cartão Implantação', () => {
  const resumo = (over: Partial<ResumoDaImplantacao['pendencias']>, agenda: ResumoDaImplantacao['agenda'] = 'ok'): ResumoDaImplantacao => ({
    cartoes: 4, agenda, pendencias: { 'sem-proximo-passo': [], 'passo-vencido': [], 'sem-reuniao': [], ...over },
  });

  it('as três linhas com a contagem, cada uma levando à Implantação filtrada', async () => {
    RESUMO = resumo({ 'sem-proximo-passo': ['a', 'b', 'c'], 'passo-vencido': ['d'], 'sem-reuniao': ['a', 'b'] });
    render(<ImplantacaoNoDiaADia token="tok" />);
    const sem = await screen.findByTestId('implantacao-linha-sem-proximo-passo');
    expect(sem).toHaveTextContent('3 clientes sem próximo passo');
    expect(sem.getAttribute('href')).toBe('/trabalho/implantacao?pendencia=sem-proximo-passo');
    expect(screen.getByTestId('implantacao-linha-passo-vencido')).toHaveTextContent('1 com passo vencido');
    expect(screen.getByTestId('implantacao-linha-passo-vencido').getAttribute('href')).toBe('/trabalho/implantacao?pendencia=passo-vencido');
    expect(screen.getByTestId('implantacao-linha-sem-reuniao')).toHaveTextContent('2 sem reunião marcada');
    expect(screen.queryByTestId('implantacao-em-dia')).toBeNull();
  });

  it('sem pendência: "Implantação em dia"; agenda indisponível: a linha diz isso', async () => {
    RESUMO = resumo({});
    const { unmount } = render(<ImplantacaoNoDiaADia token="tok" />);
    expect(await screen.findByTestId('implantacao-em-dia')).toHaveTextContent('Implantação em dia.');
    unmount();
    RESUMO = resumo({ 'passo-vencido': ['d'] }, 'indisponivel');
    render(<ImplantacaoNoDiaADia token="tok" />);
    expect(await screen.findByTestId('implantacao-linha-sem-reuniao')).toHaveTextContent('Reunião marcada: agenda indisponível');
    expect(screen.queryByTestId('implantacao-em-dia')).toBeNull();
  });

  it('a empresa sem a lista da implantação, ou a leitura falhando: o cartão não aparece', async () => {
    RESUMO = { ...resumo({}), cartoes: null };
    const { container, unmount } = render(<ImplantacaoNoDiaADia token="tok" />);
    await waitFor(() => expect(container.textContent).toBe(''));
    unmount();
    RESUMO = new Error('500');
    const r2 = render(<ImplantacaoNoDiaADia token="tok" />);
    await waitFor(() => expect(r2.container.textContent).toBe(''));
  });
});
