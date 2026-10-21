/*
 * RODADA DE PRODUÇÃO 1 (21/10/2026), P5 e P6 na tela:
 *  · Contratos vivos: o contrato importado do CRM antigo diz "anexar o PDF" e que a régua
 *    está a decidir, sem "0/0 parcelas pagas";
 *  · o cartão: a próxima data em dd/mm, o dia da semana no title; sem data, nada;
 *  · o painel do card: "Quem trabalha nesta etapa", só leitura, com o último fato e o que vai fazer.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContratoVivo, QuemTrabalhaNaEtapa as Dados } from '@mktos/shared';

let CONTRATOS: ContratoVivo[] = [];
let QUEM: Dados | Error | null = null;

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'eu' }, can: () => true }) }));
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
      if (caminho.includes('/quem-trabalha')) {
        if (QUEM instanceof Error) throw QUEM;
        return QUEM;
      }
      return CONTRATOS;
    }),
    apiPost: vi.fn(async () => ({})),
  };
});

import ContratosPage from '@/app/comercial/contratos/page';
import { DatasNoBalao, ProximaDataNoCartao } from '@/components/trabalho/DatasDoCartao';
import { QuemTrabalhaNaEtapa } from '@/components/trabalho/QuemTrabalhaNaEtapa';

function contrato(leadId: string, cliente: string, over: Partial<ContratoVivo> = {}): ContratoVivo {
  return {
    leadId, cliente, produto: null, valorCentavos: 150_050, descontoPct: null, parcelas: [], reguaDeCobranca: [], entregas: [],
    primeiroValorEm: null, saude: null, faseDaImplantacao: null, marcos: [], aditivos: null,
    situacao: 'ativo', encerramento: null, cnpj: null, socioDaConta: null, ...over,
  };
}

beforeEach(() => {
  CONTRATOS = [];
  QUEM = null;
});

describe('Contratos vivos: o contrato importado do CRM antigo', () => {
  it('diz para anexar o PDF, lista os contratos e não mostra parcela inventada', async () => {
    CONTRATOS = [
      contrato('a', 'Cliente Sintético Um', {
        importados: [
          { origem: 'cartao:1', titulo: 'Contrato um', produtoRotulo: 'Implantação ROOT OS', valorCentavos: 100_000, fechadoEm: '2026-07-01', semDocumento: true },
          { origem: 'cartao:2', titulo: 'Contrato dois', produtoRotulo: null, valorCentavos: null, fechadoEm: null, semDocumento: true },
        ],
      }),
      contrato('b', 'Cliente do fechamento', { produto: 'operacao', parcelas: [{ n: 1, total: 3, valorCentavos: 399_900, vence: '2026-10-25', estado: 'paga', pagaEm: '2026-10-01T12:00:00.000Z', aviso: null }] }),
    ];
    render(<ContratosPage />);
    const a = await screen.findByTestId('contrato-a');
    const imp = within(a).getByTestId('contratos-importados');
    expect(imp).toHaveTextContent('Contrato importado do CRM antigo · anexar o PDF');
    expect(imp).toHaveTextContent('Contrato um · Implantação ROOT OS · R$ 1.000 · fechado em 01/07');
    expect(imp).toHaveTextContent('Contrato dois · produto ausente');
    expect(imp).toHaveTextContent('sem data de fechamento');
    expect(imp).toHaveTextContent('Nenhum aviso de cobrança sai deste contrato.');
    expect(within(a).queryByText(/parcelas pagas/)).toBeNull();
    // O contrato do fechamento continua igual.
    expect(within(screen.getByTestId('contrato-b')).getByText(/1\/1 parcelas pagas/)).toBeTruthy();
    expect(within(screen.getByTestId('contrato-b')).queryByTestId('contratos-importados')).toBeNull();
  });
});

describe('as datas do cartão', () => {
  it('a próxima data em dd/mm, com o dia da semana e a origem no title; sem data, nada', () => {
    const { container, rerender } = render(<ProximaDataNoCartao dueDate="2099-09-22T00:00:00.000Z" proximoPassoEm={null} />);
    const d = screen.getByTestId('cartao-proxima-data');
    expect(d).toHaveTextContent('22/09');
    expect(d.getAttribute('title')).toBe('terça-feira, 22/09/2099 · prazo da tarefa');
    rerender(<ProximaDataNoCartao dueDate={null} proximoPassoEm={null} />);
    expect(container.textContent).toBe('');
    rerender(<ProximaDataNoCartao dueDate="não é data" />);
    expect(container.textContent).toBe('');
    expect(container.textContent).not.toMatch(/Invalid/);
  });

  it('o balão traz desde quando está na etapa e a próxima data com o dia da semana', () => {
    render(<DatasNoBalao statusDesde="2026-10-21T17:05:00.000Z" dueDate="2099-09-22T00:00:00.000Z" />);
    const b = screen.getByTestId('balao-datas');
    expect(b).toHaveTextContent('na etapa desde quarta-feira, 21/10/2026 às 14:05');
    expect(b).toHaveTextContent('próxima data terça-feira, 22/09/2099 · prazo da tarefa');
  });
});

describe('Quem trabalha nesta etapa', () => {
  const dados: Dados = {
    trilhoId: 't1', fase: 'contrato', faseRotulo: '2 · Contrato e onboarding',
    agentes: [
      { slug: 'leitor-de-ata', nome: 'Leitor de ata', iniciais: 'LA', missao: 'ler a ata', estado: 'ativo', ultimoFato: { texto: 'Ata lida (pdf): 5 proposta(s)', em: '2026-10-12T13:00:00.000Z' }, oQueVaiFazer: 'Já rodou neste cliente. Roda de novo com uma ata de kickoff.' },
      { slug: 'pesquisador-de-conta', nome: 'Pesquisador de conta', iniciais: 'PC', missao: 'dossiê', estado: 'ausente', ultimoFato: null, oQueVaiFazer: 'Não está semeado nesta empresa.' },
    ],
    relogio: { nome: 'Relógio do onboarding', ligado: true, proximaPassagemEm: '2026-10-22T12:00:00.000Z', ultimoFato: null, vaiFazer: ['Cliente: sem próximo passo com dono e data.'] },
  };

  it('lista os agentes com o último fato (dd/mm) e o que vão fazer, e o relógio com a próxima passagem', async () => {
    QUEM = dados;
    render(<QuemTrabalhaNaEtapa trilhoId="t1" token="tok" />);
    const leitor = await screen.findByTestId('quem-trabalha-leitor-de-ata');
    expect(leitor).toHaveTextContent('Leitor de ata');
    expect(leitor).toHaveTextContent('ativo');
    expect(leitor).toHaveTextContent('12/10 Ata lida (pdf): 5 proposta(s)');
    expect(leitor).toHaveTextContent('Já rodou neste cliente.');
    const pesquisador = screen.getByTestId('quem-trabalha-pesquisador-de-conta');
    expect(pesquisador).toHaveTextContent('não semeado');
    expect(pesquisador).toHaveTextContent('Nada feito neste cliente ainda.');
    const relogio = screen.getByTestId('quem-trabalha-relogio');
    expect(relogio).toHaveTextContent('ligado');
    expect(relogio).toHaveTextContent('Na próxima passagem (quinta-feira, 22/10/2026 às 09:00) registra, sem mandar mensagem:');
    expect(relogio).toHaveTextContent('Cliente: sem próximo passo com dono e data.');
    expect(screen.getByTestId('quem-trabalha')).toHaveTextContent('Quem trabalha nesta etapa · 2 · Contrato e onboarding');
    // Só leitura: nenhum botão.
    expect(within(screen.getByTestId('quem-trabalha')).queryByRole('button')).toBeNull();
  });

  it('relógio desligado e erro de leitura dizem o que é, sem tela vazia', async () => {
    QUEM = { ...dados, relogio: { ...dados.relogio, ligado: false, proximaPassagemEm: null, vaiFazer: [] } };
    const { unmount } = render(<QuemTrabalhaNaEtapa trilhoId="t1" token="tok" />);
    expect(await screen.findByText(/Desligado: não lembra nem cobra nada/)).toBeTruthy();
    unmount();
    QUEM = new Error('500');
    render(<QuemTrabalhaNaEtapa trilhoId="t1" token="tok" />);
    await waitFor(() => expect(screen.getByTestId('quem-trabalha')).toHaveTextContent('Não deu para ler os agentes agora.'));
  });
});
