import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { lerCompromisso, type EventoDaAgenda as EventoV2, type RespostaDoEspelho } from '@mktos/shared';

/*
 * A PÁGINA DA AGENDA V2 (29/10/2026, lane G3): lê do espelho (sem cair no
 * Google quando ele responde), o selo da sincronia, as abas (Regras só com
 * `dashboard.ver`, o número dos Conflitos), o filtro Quem, clique no vazio abre
 * o painel naquele horário, o detalhe com Editar e Cancelar, a Lista com a
 * linha do agora e "entrar no Meet", e a folha de baixo abaixo de 860 px.
 * "Agora" = terça, 03/11/2026, 14:20 em São Paulo. Dados fictícios.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<typeof import('@/lib/api')>('@/lib/api')),
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
}));
let permissoes = ['dashboard.ver', 'agenda.editar'];
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, can: (p: string) => permissoes.includes(p) }) }));
vi.mock('@/components/modulos', () => ({ useModulos: () => ({ modulos: [] }) }));

import AgendaPage from '@/app/agenda/page';

const AGORA = new Date('2026-11-03T17:20:00.000Z'); // 14:20 em São Paulo

function ev(id: string, dia: string, ini: string, fim: string, titulo: string, extra: Partial<EventoV2> = {}): EventoV2 {
  return {
    id, agenda: 'primary', origem: 'google', titulo,
    inicio: new Date(`${dia}T${ini}:00-03:00`).toISOString(), fim: new Date(`${dia}T${fim}:00-03:00`).toISOString(),
    diaInteiro: false, local: null, meet: null, convidados: [], organizador: 'operacao.root@gmail.com', organizadorEhAgenda: true,
    status: 'confirmado', atualizadoNoGoogle: null, serieId: null, criadoPeloOs: false, link: null, leitura: lerCompromisso(titulo), ...extra,
  };
}

const EVENTOS: EventoV2[] = [
  ev('affari', '2026-11-03', '13:30', '14:30', 'Reunião Online - Affari - Pedro', { meet: 'https://meet.google.com/aaa-bbbb-ccc' }),
  ev('papeleira', '2026-11-03', '15:00', '16:00', 'Reunião Online - Papeleira Santa Rita - Rodrigo', { meet: 'https://meet.google.com/ddd-eeee-fff' }),
  ev('custeio', '2026-11-03', '16:30', '17:30', 'Reunião Presencial - Custeio - Lucas', { local: 'Av. Exemplo, 100' }),
  ev('fechado', '2026-11-04', '08:00', '13:00', 'Fechado Rodrigo', { origem: 'livre_ocupado', titulo: null, leitura: lerCompromisso('Fechado Rodrigo') }),
];

let espelho: RespostaDoEspelho | Error = { eventos: EVENTOS, sincronia: { ultimaPassagem: '2026-11-03T17:19:20.000Z', erro: null, atrasada: false }, fonte: 'espelho' };

function comLargura(estreito: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({ matches: estreito && q.includes('max-width'), media: q, addEventListener: () => {}, removeEventListener: () => {} }),
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
  permissoes = ['dashboard.ver', 'agenda.editar'];
  espelho = { eventos: EVENTOS, sincronia: { ultimaPassagem: '2026-11-03T17:19:20.000Z', erro: null, atrasada: false }, fonte: 'espelho' };
  apiGet.mockReset();
  apiPost.mockReset();
  apiGet.mockImplementation((rota: string) => {
    if (rota.startsWith('/agenda/espelho')) return espelho instanceof Error ? Promise.reject(espelho) : Promise.resolve(espelho);
    if (rota.startsWith('/agenda/conflitos')) {
      // O cartão na forma de RespostaDosConflitos: a aba real (lane B) lê eventos, ações e pessoas.
      const cartao = (id: string, confirmado: boolean) => ({
        id, tipo: 'choque', urgencia: 1, quando: '2026-11-04T12:00:00.000Z', pessoas: ['Rodrigo'], titulo: 'Rodrigo em dois lugares',
        frase: 'Rodrigo está em dois lugares ao mesmo tempo', eventos: [], acoes: [], serieId: null, confirmado,
      });
      return Promise.resolve({ cartoes: [cartao('c1', false), cartao('c2', false), cartao('c3', true)], vigiaPassouEm: null, contagem: { tudo: 3, choque: 3 } });
    }
    if (rota.startsWith('/agenda/regras')) return Promise.reject(new Error('501'));
    if (rota.startsWith('/google/calendar/periodo')) return Promise.resolve([]);
    if (rota === '/agenda/fora-do-padrao') return Promise.resolve({ total: 0, itens: [], ultimaPassagemEm: null, rotina: null });
    return Promise.resolve([]);
  });
  comLargura(false);
  sessionStorage.clear();
  window.localStorage?.clear?.();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState({}, '', '/');
  delete (window as unknown as Record<string, unknown>).matchMedia;
});

const abrir = (url: string) => { window.history.replaceState({}, '', url); return render(createElement(AgendaPage)); };
const grade = () => waitFor(() => { const g = document.querySelector('[data-visao-da-agenda="grade"]'); expect(g).toBeTruthy(); return g as HTMLElement; });

describe('a fonte e o selo', () => {
  it('lê do espelho e não bate no Google; o selo diz há quanto sincronizou', async () => {
    abrir('/agenda?aba=semana&dia=2026-11-03');
    const g = await grade();
    await waitFor(() => expect(g.querySelector('[data-evento="papeleira"]')).toBeTruthy());
    expect(apiGet.mock.calls.some(([r]) => String(r).startsWith('/google/calendar/periodo'))).toBe(false);
    expect(apiGet.mock.calls.find(([r]) => String(r).startsWith('/agenda/espelho'))?.[0]).toBe(
      `/agenda/espelho?de=${encodeURIComponent('2026-11-02T03:00:00.000Z')}&ate=${encodeURIComponent('2026-11-07T03:00:00.000Z')}`,
    );
    expect(screen.getByText(/sincronizado há 40 s/)).toBeTruthy();
  });

  it('espelho atrasado: o selo avisa', async () => {
    espelho = { eventos: EVENTOS, sincronia: { ultimaPassagem: '2026-11-03T16:00:00.000Z', erro: null, atrasada: true }, fonte: 'google' };
    abrir('/agenda?aba=semana&dia=2026-11-03');
    await screen.findByText(/espelho atrasado: lendo direto do Google/);
  });
});

describe('as abas', () => {
  it('seis abas; o número dos Conflitos abertos; Regras só com dashboard.ver', async () => {
    abrir('/agenda?aba=semana&dia=2026-11-03');
    await grade();
    const abas = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(abas).toEqual(['Semana e dia', 'Lista', 'Mês', 'Conflitos2', 'Relatórios', 'Regras']);
    fireEvent.click(screen.getByRole('tab', { name: /Conflitos/ }));
    // A aba de verdade (lane B) monta no lugar do marcador da lane 0.
    await waitFor(() => expect(document.querySelector('[data-aba-conflitos]')).toBeTruthy());
    cleanup();
    permissoes = ['agenda.editar'];
    abrir('/agenda?aba=semana&dia=2026-11-03');
    expect(screen.queryByRole('tab', { name: 'Regras' })).toBeNull();
  });
});

describe('Semana e dia', () => {
  it('Quem: com Lucas, só o que é do Lucas', async () => {
    abrir('/agenda?aba=semana&dia=2026-11-03');
    const g = await grade();
    await waitFor(() => expect(g.querySelector('[data-evento="affari"]')).toBeTruthy());
    fireEvent.click(within(screen.getByRole('group', { name: 'Quem' })).getByRole('button', { name: 'Lucas' }));
    expect(window.location.search).toContain('quem=Lucas');
    await waitFor(() => expect(g.querySelector('[data-evento="affari"]')).toBeNull());
    expect(g.querySelector('[data-evento="custeio"]')).toBeTruthy();
  });

  it('o Fechado da agenda pessoal aparece tracejado, sem título, com "agenda pessoal · só ocupado"', async () => {
    abrir('/agenda?aba=semana&dia=2026-11-03');
    const g = await grade();
    const f = await waitFor(() => { const x = g.querySelector('[data-evento="fechado"]'); expect(x).toBeTruthy(); return x as HTMLElement; });
    expect(f.textContent).toContain('Fechado Rodrigo');
    expect(f.textContent).toContain('agenda pessoal · só ocupado');
    expect(f.className).toContain('border-dashed');
  });

  it('clique no vazio abre o painel naquele horário, com o compromisso novo tracejado na grade', async () => {
    abrir('/agenda?aba=semana&dia=2026-11-03');
    const g = await grade();
    const coluna = g.querySelector('[data-coluna-do-dia="2026-11-05"]') as HTMLElement;
    // 0,8 px por minuto a partir das 08h: y = 336 → 420 min → 15:00.
    fireEvent.click(coluna, { clientY: 336 });
    const painel = await screen.findByRole('complementary', { name: 'Marcar' });
    expect((within(painel).getByLabelText('Quando') as HTMLInputElement).value).toBe('2026-11-05');
    expect((within(painel).getByLabelText('Hora') as HTMLInputElement).value).toBe('15:00');
    expect(g.querySelector('[data-coluna-do-dia="2026-11-05"] [data-compromisso-novo]')).toBeTruthy();
  });

  it('detalhe: Editar abre o mesmo painel; Cancelar pede motivo, pergunta se avisa, e vai à rota de escritas', async () => {
    abrir('/agenda?aba=semana&dia=2026-11-03');
    const g = await grade();
    const bloco = await waitFor(() => { const x = g.querySelector('[data-evento="custeio"]'); expect(x).toBeTruthy(); return x as HTMLElement; });
    fireEvent.click(bloco);
    const detalhe = await screen.findByRole('complementary', { name: 'Compromisso' });
    expect(within(detalhe).getByText('Av. Exemplo, 100')).toBeTruthy();
    fireEvent.click(within(detalhe).getByRole('button', { name: 'Cancelar compromisso' }));
    const botao = within(detalhe).getByRole('button', { name: 'Cancelar o compromisso' }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    fireEvent.change(within(detalhe).getByLabelText('Motivo do cancelamento'), { target: { value: 'o cliente pediu para remarcar' } });
    apiPost.mockResolvedValueOnce({ status: 'executado', nivel: 'R2', eventoId: 'custeio', approvalId: null, precisaDeOutraPessoa: false, mensagem: 'Cancelado no Google.', desfazer: { acao: 'reabrir', chave: 'r', eventoId: 'custeio', tituloAtual: 'x' } });
    fireEvent.click(botao);
    await within(detalhe).findByText('Cancelado no Google.');
    expect(apiPost.mock.calls[0][0]).toBe('/agenda/escritas');
    expect(apiPost.mock.calls[0][1]).toMatchObject({ acao: 'cancelar', eventoId: 'custeio', tituloAtual: 'Reunião Presencial - Custeio - Lucas', motivo: 'o cliente pediu para remarcar', avisar: false });
    expect(within(detalhe).getByRole('button', { name: 'desfazer' })).toBeTruthy();

    fireEvent.click(within(detalhe).getByRole('button', { name: 'Editar' }));
    const editar = await screen.findByRole('complementary', { name: 'Editar compromisso' });
    expect((within(editar).getByLabelText('Hora') as HTMLInputElement).value).toBe('16:30');
    expect(within(editar).getByText('Reunião Presencial - Custeio - Lucas')).toBeTruthy();
  });

  it('a altura das horas fica guardada no navegador', async () => {
    abrir('/agenda?aba=semana&dia=2026-11-03');
    await grade();
    fireEvent.click(screen.getByRole('button', { name: 'Aumentar altura' }));
    expect(window.localStorage.getItem('agenda.v2.alturaDaHora')).toBe('56');
    fireEvent.click(screen.getByRole('button', { name: 'auto' }));
    expect(window.localStorage.getItem('agenda.v2.alturaDaHora')).toBe('auto');
  });
});

describe('a Lista e o celular', () => {
  it('a Lista do dia: a linha do AGORA entre o que passou e o que vem, e "entrar no Meet" quando falta pouco', async () => {
    abrir('/agenda?aba=lista&dia=2026-11-03');
    const lista = await waitFor(() => { const l = document.querySelector('[data-visao-da-agenda="lista"]'); expect(l).toBeTruthy(); return l as HTMLElement; });
    await within(lista).findByText('Reunião Online - Papeleira Santa Rita - Rodrigo');
    const itens = [...lista.querySelectorAll('ol > li')];
    const agora = itens.findIndex((li) => li.hasAttribute('data-linha-do-agora'));
    expect(itens[agora - 1].getAttribute('data-evento')).toBe('affari');
    expect(itens[agora + 1].getAttribute('data-evento')).toBe('papeleira');
    const papeleira = itens[agora + 1] as HTMLElement;
    expect(papeleira.textContent).toContain('em 40 min');
    expect(within(papeleira).getByRole('link', { name: 'entrar no Meet' }).getAttribute('href')).toBe('https://meet.google.com/ddd-eeee-fff');
    expect((itens.find((li) => li.getAttribute('data-evento') === 'affari') as HTMLElement).textContent).toContain('acontecendo agora');
    expect((itens.find((li) => li.getAttribute('data-evento') === 'custeio') as HTMLElement).textContent).not.toContain('entrar no Meet');
    expect(within(lista).getByRole('button', { name: /Conflitos/ }).textContent).toContain('2');
  });

  it('abaixo de 860 px a Lista é o padrão e "+ Marcar" abre a folha de baixo', async () => {
    comLargura(true);
    abrir('/agenda?dia=2026-11-03');
    const lista = await waitFor(() => { const l = document.querySelector('[data-visao-da-agenda="lista"]'); expect(l).toBeTruthy(); return l as HTMLElement; });
    fireEvent.click(within(lista).getByRole('button', { name: '+ Marcar' }));
    const folha = await screen.findByRole('dialog', { name: 'Novo compromisso' });
    expect(within(folha).getByLabelText('Atalho')).toBeTruthy();
  });

  it('Mês: o mês inteiro com o tipo novo', async () => {
    abrir('/agenda?aba=mes&dia=2026-11-03');
    const mes = await waitFor(() => { const m = document.querySelector('[data-visao-da-agenda="mes"]'); expect(m).toBeTruthy(); return m as HTMLElement; });
    await waitFor(() => expect(within(mes.querySelector('[data-dia-do-mes="2026-11-04"]') as HTMLElement).getByText('Fechado Rodrigo')).toBeTruthy());
  });
});
