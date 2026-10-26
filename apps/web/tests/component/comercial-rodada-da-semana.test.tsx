import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

/*
 * Layout 26/10: a Rodada da semana (Comercial) conta os números pelo sistema
 * (`GET /comercial/rodada-da-semana`), não pela nota escrita à mão. A nota, quando a
 * sessão é da plataforma, vira um bloco à parte, marcado como texto escrito à mão, e
 * nenhum número dela aparece.
 */

const apiGet = vi.fn();
vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...real, apiGet: (...a: unknown[]) => apiGet(...a) };
});

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u1', name: 'Lucas', email: 'l@x.com', roles: [], permissions: ['leads.ver'] },
    can: () => true,
  }),
}));

let EH_PLATAFORMA = false;
vi.mock('@/lib/plataforma', () => ({ useEhPlataforma: () => EH_PLATAFORMA }));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
}));

// eslint-disable-next-line import/first
import RodadaDaSemanaPage from '@/app/comercial/rodada/page';

const RODADA = {
  semana: { de: '2026-10-26', ate: '2026-11-01', anterior: '2026-10-19', proxima: null, atual: true },
  geradoEm: '2026-10-28T15:00:00.000Z',
  entraram: [{ leadId: 'n', nome: 'Nina Studio', etapa: 'E1 · Novo lead', canal: 'Site', em: '2026-10-27T11:00:00.000Z' }],
  movimentos: [
    { leadId: 'b', nome: 'Bruno', de: 'E6 · Proposta', para: 'E7 · Follow-up', aMao: true, por: 'Lucas', em: '2026-10-27T13:00:00.000Z' },
  ],
  fechados: [
    { leadId: 'a', nome: 'Alicerce', valor: 2970, produto: 'Imersão', em: '2026-10-27T15:00:00.000Z' },
    { leadId: 'f', nome: 'Fábio', valor: null, produto: null, em: '2026-10-26T14:00:00.000Z' },
  ],
  valorFechado: 2970,
  propostas: [{ leadId: 'a', nome: 'Alicerce', versao: 2, valor: 11997, em: '2026-10-27T18:00:00.000Z' }],
  saidas: [
    { leadId: 'g', nome: 'Gil', saida: 'Geladeira', motivo: 'momento', detalhe: null, voltaEm: '2027-01-10', por: 'Lucas', em: '2026-10-28T10:00:00.000Z' },
  ],
  tarefasAtrasadas: [{ id: 't1', titulo: 'Ligar para Ana', prazo: '2026-10-20', pessoa: 'Lucas', lead: { id: 'a', nome: 'Alicerce' } }],
  negociacao: { total: 45000, abertos: 4, pagante: 30000, semCaixa: 15000 },
};

const NOTA = {
  rodada: '2026-10-26',
  rodadas: ['2026-10-26'],
  importadaEm: '2026-10-26T11:00:00.000Z',
  conteudo: {
    decisoes: [{ texto: 'Decidir o preço da turma', decidida: false }],
    mudancas: ['Contrato da Papeleira assinado'],
    interno: [],
    padrao: [],
    dinheiro: { fechado: [{ cliente: 'Escrito à mão', valorCentavos: 99_999_900, valorTexto: 'R$ 999.999', confirmado: true }], emAberto: [] },
  },
};

// O texto da tela é normalizado (espaço comum); o Intl põe espaço rígido entre R$ e o número.
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).replace(/\s/g, ' ');

describe('Rodada da semana', () => {
  beforeEach(() => {
    EH_PLATAFORMA = false;
    apiGet.mockReset();
    apiGet.mockImplementation(async (rota: string) => {
      if (rota.startsWith('/comercial/rodada-da-semana')) return RODADA;
      if (rota === '/tenants/plataforma/operacao/painel') return NOTA;
      throw new Error(`Rota sem fixture: ${rota}`);
    });
  });

  it('mostra os números contados pelo sistema, sem ler a nota', async () => {
    render(<RodadaDaSemanaPage />);
    const numeros = await screen.findByRole('region', { name: 'Números da semana' });
    expect(within(numeros).getByText('Leads que entraram')).toBeInTheDocument();
    expect(within(numeros).getByText(brl(2970))).toBeInTheDocument();
    expect(within(numeros).getByText('2 negócios · 1 sem valor')).toBeInTheDocument();
    expect(within(numeros).getByText(brl(45000))).toBeInTheDocument();
    expect(screen.getByText(/Esta semana: 26\/10 a 01\/11/)).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/comercial/rodada-da-semana', 'tok');
    expect(apiGet).not.toHaveBeenCalledWith('/tenants/plataforma/operacao/painel', 'tok');
    expect(screen.queryByText('Notas da semana')).toBeNull();
  });

  it('cada bloco lista os leads com link para o painel do lead', async () => {
    render(<RodadaDaSemanaPage />);
    await screen.findByRole('region', { name: 'Números da semana' });
    expect(screen.getByText('Nina Studio').closest('a')).toHaveAttribute('href', '/comercial/lead/n');
    expect(screen.getByText(/E6 · Proposta → E7 · Follow-up · movido à mão por Lucas/)).toBeInTheDocument();
    expect(screen.getByText(/Geladeira · momento · volta em 10\/01/)).toBeInTheDocument();
    expect(screen.getByText('Ligar para Ana').closest('a')).toHaveAttribute('href', '/comercial/lead/a');
    expect(screen.getByText(/versão 2/)).toBeInTheDocument();
  });

  it('troca de semana pelo pedido à API', async () => {
    render(<RodadaDaSemanaPage />);
    fireEvent.click(await screen.findByRole('button', { name: '← semana anterior' }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/comercial/rodada-da-semana?semana=2026-10-19', 'tok'));
  });

  it('na plataforma, a nota vira bloco à parte de texto escrito à mão, sem os números dela', async () => {
    EH_PLATAFORMA = true;
    render(<RodadaDaSemanaPage />);
    expect(await screen.findByText('Notas da semana')).toBeInTheDocument();
    expect(screen.getByText(/texto escrito à mão/)).toBeInTheDocument();
    expect(screen.getByText('Decidir o preço da turma')).toBeInTheDocument();
    expect(screen.getByText('Contrato da Papeleira assinado')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Escrito à mão');
    expect(document.body.textContent).not.toContain('999.999');
  });
});
