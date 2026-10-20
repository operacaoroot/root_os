/*
 * "Iniciar onboarding" antes do negócio fechado (ajustes da versão final A2, 19/10/2026).
 *
 *  1. o painel do lead: o botão só aparece com `leads.editar` e `tarefas.editar`,
 *     antes de "Negócio fechado", fora das saídas e enquanto o lead não tem card;
 *     escolher a etapa (padrão Kickoff marcado) chama a rota e depois mostra o link;
 *  2. a Implantação: o botão do topo abre a busca de leads elegíveis e só inicia
 *     com um lead escolhido (nunca cartão solto); sem as permissões, não aparece.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComercialEtapa, FichaDoLead } from '@mktos/shared';

let PERMISSOES = new Set(['leads.editar', 'tarefas.editar', 'leads.ver']);
const posts: { caminho: string; corpo: unknown }[] = [];
const gets: string[] = [];

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'eu' }, can: (p: string) => PERMISSOES.has(p) }) }));
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return {
    ...real,
    apiGet: vi.fn(async (caminho: string) => {
      gets.push(caminho);
      if (caminho.startsWith('/comercial/onboarding-antecipado/etapas')) return { etapas: ['Kickoff marcado', 'Kit montado'], padrao: 'Kickoff marcado' };
      if (caminho.startsWith('/comercial/onboarding-antecipado/elegiveis')) {
        return [{ leadId: 'l9', nome: 'Marina Duarte', empresa: 'Construtora Alicerce', etapa: 'proposta', rotuloDaEtapa: 'Proposta' }];
      }
      throw new real.ErroDaApi('não encontrado', 404);
    }),
    apiPost: vi.fn(async (caminho: string, corpo: unknown) => {
      posts.push({ caminho, corpo });
      return { leadId: 'l9', estado: 'criado', cardId: '11111111-1111-4111-8111-111111111111', listId: 'lista', etapa: (corpo as { etapa: string }).etapa, trilhoId: 't1', partnerId: 'p1', cliente: 'criado', selo: 'Iniciado antes do fechamento · lead em Proposta' };
    }),
  };
});

import { IniciarOnboarding } from '@/app/comercial/_painel/IniciarOnboarding';
import { IniciarOnboardingDaImplantacao } from '@/components/trabalho/IniciarOnboardingDaImplantacao';
import { mostrarIniciarOnboardingNoLead } from '@/lib/onboarding-antecipado';

function ficha(etapa: ComercialEtapa, comCard = false): FichaDoLead {
  return {
    leadId: 'l1', nome: 'Marina Duarte', telefone: null, email: null, empresa: 'Construtora Alicerce', cnpj: null, canal: null, origemIndicacao: null,
    perfil: 'P2', pontuacao: 70, sistemaErp: null, baseDados: null, dono: null, socioDaConta: null, produto: null,
    valorCentavos: null, parcelas: null, forma: null, validade: null, propostaVersao: 1, etapa, etapaDesde: '2026-10-12T13:00:00.000Z',
    motivoSaida: null, voltaEm: null, saude: null, proximaAcao: null, proximasAcoesAutomaticas: [],
    portao: { proxima: null, faltando: [], itens: [] },
    ligadoA: { sala: null, ata: true, proposta: 1, contrato: null, cobranca: null, implantacao: comCard ? { cardId: 'c1', listId: 'li', etapa: 'Kickoff marcado', trilhoId: 't1' } : null },
    fio: [],
  } as FichaDoLead;
}

beforeEach(() => {
  PERMISSOES = new Set(['leads.editar', 'tarefas.editar', 'leads.ver']);
  posts.length = 0;
  gets.length = 0;
});

describe('quem vê "Iniciar onboarding" no lead (regra pura)', () => {
  const can = (ps: string[]) => (p: string) => ps.includes(p);
  it('as duas permissões, antes de fechado, fora das saídas e sem card', () => {
    const todas = can(['leads.editar', 'tarefas.editar']);
    for (const e of ['novo_lead', 'qualificacao', 'sessao', 'proposta', 'follow_up', 'contrato'] as ComercialEtapa[]) expect(mostrarIniciarOnboardingNoLead(todas, ficha(e))).toBe(true);
    for (const e of ['fechado', 'perdido', 'geladeira', 'desqualificado', 'parceiro'] as ComercialEtapa[]) expect(mostrarIniciarOnboardingNoLead(todas, ficha(e))).toBe(false);
    expect(mostrarIniciarOnboardingNoLead(todas, ficha('proposta', true))).toBe(false);
    expect(mostrarIniciarOnboardingNoLead(can(['leads.editar']), ficha('proposta'))).toBe(false);
    expect(mostrarIniciarOnboardingNoLead(can(['tarefas.editar']), ficha('proposta'))).toBe(false);
  });
});

describe('painel do lead: Iniciar onboarding', () => {
  it('lead em proposta: escolhe a etapa (padrão Kickoff marcado), chama a rota e mostra o link do card', async () => {
    const aoMudar = vi.fn(async () => {});
    render(<IniciarOnboarding leadId="l1" ficha={ficha('proposta')} aoMudar={aoMudar} />);
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar onboarding' }));
    const select = await screen.findByLabelText('etapa de entrada');
    await waitFor(() => expect(select).toHaveValue('Kickoff marcado'));
    await userEvent.selectOptions(select, 'Kit montado');
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar onboarding' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ caminho: '/comercial/leads/l1/onboarding-antecipado', corpo: { etapa: 'Kit montado' } });
    expect(aoMudar).toHaveBeenCalled();
    expect(await screen.findByTestId('lead-onboarding-link')).toHaveAttribute('href', '/trabalho/implantacao?tarefa=11111111-1111-4111-8111-111111111111');
  });

  it('não aparece em lead fechado, em saída, com card ou sem as duas permissões', () => {
    for (const f of [ficha('fechado'), ficha('perdido'), ficha('geladeira'), ficha('proposta', true)]) {
      const { unmount } = render(<IniciarOnboarding leadId="l1" ficha={f} aoMudar={async () => {}} />);
      expect(screen.queryByTestId('lead-iniciar-onboarding')).toBeNull();
      unmount();
    }
    PERMISSOES = new Set(['leads.editar', 'leads.ver']);
    render(<IniciarOnboarding leadId="l1" ficha={ficha('proposta')} aoMudar={async () => {}} />);
    expect(screen.queryByTestId('lead-iniciar-onboarding')).toBeNull();
  });
});

describe('Implantação: Iniciar onboarding pelo topo do quadro', () => {
  it('abre a busca de leads elegíveis e só inicia com um lead escolhido', async () => {
    const onIniciado = vi.fn();
    render(<IniciarOnboardingDaImplantacao onIniciado={onIniciado} />);
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar onboarding' }));
    const lead = await screen.findByRole('radio');
    const iniciar = screen.getAllByRole('button', { name: 'Iniciar onboarding' }).at(-1)!;
    // Sem lead escolhido, nada nasce: não há cartão solto.
    expect(iniciar).toBeDisabled();
    expect(gets.some((g) => g.startsWith('/comercial/onboarding-antecipado/elegiveis'))).toBe(true);
    await userEvent.click(lead);
    await waitFor(() => expect(iniciar).toBeEnabled());
    await userEvent.click(iniciar);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ caminho: '/comercial/leads/l9/onboarding-antecipado', corpo: { etapa: 'Kickoff marcado' } });
    expect(onIniciado).toHaveBeenCalledWith(expect.objectContaining({ cardId: '11111111-1111-4111-8111-111111111111' }));
  });

  it('sem leads.editar ou sem tarefas.editar, o botão não aparece', () => {
    PERMISSOES = new Set(['tarefas.editar', 'leads.ver']);
    const { unmount } = render(<IniciarOnboardingDaImplantacao onIniciado={() => {}} />);
    expect(screen.queryByTestId('implantacao-iniciar-onboarding')).toBeNull();
    unmount();
    PERMISSOES = new Set(['leads.editar', 'leads.ver']);
    render(<IniciarOnboardingDaImplantacao onIniciado={() => {}} />);
    expect(screen.queryByTestId('implantacao-iniciar-onboarding')).toBeNull();
  });
});
