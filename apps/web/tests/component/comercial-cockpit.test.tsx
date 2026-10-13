/*
 * As telas do cockpit que dependem de rota ainda em obra na API (torre e
 * relatório, lane E) e a fila de decisões (lane C): renderizam com os tipos do
 * shared quando a API entrega, dizem a verdade quando ela responde 501 e nunca
 * escrevem número que não veio.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilaDeDecisoes, RelatorioDaSemana, TorreDasAutomacoes } from '@mktos/shared';

import { ErroDaApi } from '@/lib/api';

let RESPOSTAS: Record<string, unknown> = {};
const posts: { caminho: string; corpo: unknown }[] = [];

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: null, can: () => true }) }));
vi.mock('next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/comercial', useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => <a href={href} {...resto}>{children}</a>,
}));
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return {
    ...real,
    apiGet: vi.fn(async (caminho: string) => {
      const chave = Object.keys(RESPOSTAS).find((k) => caminho.startsWith(k));
      const r = chave ? RESPOSTAS[chave] : undefined;
      if (r instanceof Error) throw r;
      return r;
    }),
    apiPost: vi.fn(async (caminho: string, corpo: unknown) => {
      posts.push({ caminho, corpo });
      return {};
    }),
  };
});

import TorrePage from '@/app/comercial/torre/page';
import RelatorioPage from '@/app/comercial/relatorio/page';
import FilaPage from '@/app/comercial/page';

beforeEach(() => {
  RESPOSTAS = {};
  posts.length = 0;
});

describe('torre (tela 12)', () => {
  it('com 501 diz que ainda não foi entregue e não mostra número', async () => {
    RESPOSTAS['/comercial/torre'] = new ErroDaApi('fase 2', 501);
    render(<TorrePage />);
    expect(await screen.findByText(/ainda não foi entregue pela API/)).toBeInTheDocument();
    expect(screen.queryByText('premissas conferidas')).toBeNull();
  });

  it('com dados mostra autonomia, acerto e premissa; o nulo aparece ausente', async () => {
    const t: TorreDasAutomacoes = {
      vigia: { ultimaPassagemEm: '2026-10-13T11:00:00.000Z', premissasConferidas: 11, premissasQuebradas: 0 },
      custoDeIaHojeCentavos: null,
      custoDesconhecido: false,
      automacoes: [
        { chave: 'qualificador', rotulo: 'qualificador', autonomia: 'A3', ultimaVezEm: '2026-10-13T19:41:00.000Z', acerto30Dias: 0.97, premissa: 'formulário grava no lead', premissaOk: true },
        { chave: 'leitor_de_ata', rotulo: 'leitor de ata', autonomia: 'A2', ultimaVezEm: null, acerto30Dias: null, premissa: 'chave do modelo válida', premissaOk: null },
      ],
    };
    RESPOSTAS['/comercial/torre'] = t;
    render(<TorrePage />);
    expect(await screen.findByText('formulário grava no lead')).toBeInTheDocument();
    expect(screen.getByText('97%')).toBeInTheDocument();
    expect(screen.getByText('A3')).toBeInTheDocument();
    expect(screen.getByText('nunca')).toBeInTheDocument();
    expect(screen.getByText('sem medida')).toBeInTheDocument(); // C-5: custo sem livro-caixa
    expect(screen.getAllByText('ausente').length).toBeGreaterThanOrEqual(1); // acerto do leitor
    expect(screen.getByText('08:00')).toBeInTheDocument();
  });
});

describe('relatório (tela 13)', () => {
  it('com 501 diz que ainda não foi entregue; gerar com 501 diz que nada foi feito', async () => {
    RESPOSTAS['/comercial/relatorio/semana'] = new ErroDaApi('fase 2', 501);
    render(<RelatorioPage />);
    expect(await screen.findByText(/relatório da semana ainda não foi entregue/)).toBeInTheDocument();
    expect(screen.queryByText('fechados')).toBeNull();
  });

  it('com dados mostra contagens, funil, perdas e a mediana ausente quando nula', async () => {
    const r: RelatorioDaSemana = {
      periodoDias: 30,
      leads: 42,
      fechados: 5,
      medianaDiasDoOiAoPix: null,
      acoes: { automaticas: 312, humanas: 9 },
      funil: [{ etapa: 'entraram', n: 42 }, { etapa: 'aceite', n: 6 }],
      perdasPorMotivo: [{ motivo: 'preco', n: 3 }],
      previsao: { fechamentosProvaveis: 1, leadsEmProposta: 4 },
      geradoEm: '2026-10-15T22:30:00.000Z',
      narrativa: null,
    };
    RESPOSTAS['/comercial/relatorio/semana'] = r;
    render(<RelatorioPage />);
    expect((await screen.findAllByText('42')).length).toBe(2); // o resumo e a linha "entraram" do funil
    expect(screen.getByText('312 · 9')).toBeInTheDocument();
    expect(screen.getByText('ausente')).toBeInTheDocument();
    expect(screen.getByText('preço')).toBeInTheDocument();
    expect(screen.getByText('1 fechamento provável entre 4 leads em proposta')).toBeInTheDocument();
    expect(screen.getByText(/o relator ainda não escreveu/)).toBeInTheDocument();
  });
});

describe('fila de decisões (tela 03)', () => {
  it('mostra o padrão e o prazo, e responde pela rota com um toque', async () => {
    const fila: FilaDeDecisoes = {
      resumo: { decisoes: 1, acoesAutomaticasHoje: 31, leadsVivos: 14, automacoesComErro: 0 },
      decisoes: [
        {
          id: 'd1', leadId: 'l1', leadNome: 'Construtora Alicerce', tipo: 'pedido_de_ajuste',
          titulo: 'Construtora Alicerce pediu 8% de desconto', contexto: 'Leu a proposta 3 vezes.',
          opcoes: [{ chave: 'desconto:8', rotulo: 'Aprovar 8%' }, { chave: 'manter', rotulo: 'Manter o preço', efeito: 'nada muda' }],
          padrao: 'manter', expiraEm: new Date(Date.now() + 4 * 3600_000).toISOString(), criadaEm: new Date().toISOString(),
          estado: 'aberta', escolha: null, decididoPor: null, canal: null,
        },
      ],
      rodouSozinhoHoje: [],
    };
    RESPOSTAS['/comercial/fila'] = fila;
    render(<FilaPage />);
    expect(await screen.findByText('Construtora Alicerce pediu 8% de desconto')).toBeInTheDocument();
    expect(screen.getByText('expira em 4 h')).toBeInTheDocument();
    expect(screen.getByText(/Se ninguém responder até/).textContent).toContain('Manter o preço');
    await userEvent.setup().click(screen.getByRole('button', { name: /Aprovar 8%/ }));
    await waitFor(() => expect(posts).toEqual([{ caminho: '/comercial/decisoes/d1/responder', corpo: { escolha: 'desconto:8' } }]));
  });
});
