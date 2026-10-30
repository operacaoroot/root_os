/*
 * P-84 (27/10/2026): Comercial › Clientes ativos, a lista única. Cada linha mostra as seis
 * partes; a que falta aparece marcada; "Criar cadastro" só no lead fechado sem cadastro.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClienteAtivo, ListaDeClientesAtivos } from '@mktos/shared';

const posts: string[] = [];
let LISTA: ListaDeClientesAtivos;

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
    apiGet: vi.fn(async () => LISTA),
    apiPost: vi.fn(async (caminho: string) => {
      posts.push(caminho);
      return { ...LISTA, clientes: LISTA.clientes.map((c) => (c.chave === 'lead:l-papel' ? { ...c, chave: 'partner:p-novo', cadastro: { id: 'p-novo', nome: 'Papeleira', duplicados: 0 }, faltam: c.faltam.filter((f) => f !== 'cadastro'), podeCriarCadastro: false } : c)) };
    }),
  };
});

// eslint-disable-next-line import/first
import ClientesAtivosPage from '@/app/comercial/clientes-ativos/page';

const cliente = (o: Partial<ClienteAtivo> & Pick<ClienteAtivo, 'chave' | 'nome'>): ClienteAtivo => ({
  tipo: 'pagante', valor: null, funil: null, cadastro: null, acordos: [], contrato: null, whatsapp: [], implantacao: null, area: null, faltam: [], podeCriarCadastro: false, ...o,
});

beforeEach(() => {
  posts.length = 0;
  LISTA = {
    clientes: [
      cliente({
        chave: 'partner:p-curral', nome: 'Curral', valor: 7700,
        funil: { leadId: 'l-curral', etapa: 'fechado', rotulo: 'E9 · Negócio fechado' }, cadastro: { id: 'p-curral', nome: 'Curral', duplicados: 1 },
        acordos: [{ id: 'a1', produto: 'Operação', tipo: 'pagante', valor: 7700, fechadoEm: null }], contrato: { leadId: 'l-curral', situacao: 'ativo' },
        whatsapp: [{ conversaId: 'c1', nome: 'ROOT | Curral' }], implantacao: { taskId: 't1', etapa: 'Kickoff marcado' },
      }),
      cliente({
        chave: 'lead:l-papel', nome: 'Papeleira', valor: 10000, funil: { leadId: 'l-papel', etapa: 'fechado', rotulo: 'E9 · Negócio fechado' },
        faltam: ['cadastro', 'acordo', 'contrato', 'whatsapp', 'implantacao'], podeCriarCadastro: true,
      }),
      cliente({ chave: 'acordo:a2', nome: 'Lucas da Guiando', tipo: 'parceria', acordos: [{ id: 'a2', produto: 'Imersão', tipo: 'parceria', valor: 2997, fechadoEm: null }], faltam: ['funil', 'cadastro', 'contrato', 'whatsapp', 'implantacao'] }),
    ],
    porTipo: [{ tipo: 'pagante', total: 2 }, { tipo: 'parceria', total: 1 }],
    comLacuna: 2,
  };
});

describe('P-84: Clientes ativos numa lista só', () => {
  it('conta, mostra cada parte e marca o que falta', async () => {
    render(<ClientesAtivosPage />);
    await screen.findByText('Curral');
    expect(screen.getByTestId('clientes-ativos-total')).toHaveTextContent('3');
    const curral = screen.getByTestId('cliente-ativo-partner:p-curral');
    expect(curral).toHaveTextContent('E9 · Negócio fechado');
    expect(curral).toHaveTextContent('ROOT | Curral');
    expect(curral).toHaveTextContent('Kickoff marcado');
    expect(within(curral).queryByText('falta')).toBeNull();
    expect(within(screen.getByTestId('cliente-ativo-lead:l-papel')).getAllByText('falta')).toHaveLength(5);
    // "Com algo faltando" esconde quem está completo.
    fireEvent.click(screen.getByTestId('clientes-ativos-com-lacuna'));
    expect(screen.queryByText('Curral')).toBeNull();
    expect(screen.getByText('Lucas da Guiando')).toBeInTheDocument();
  });

  it('"Criar cadastro" só aparece no lead fechado sem cadastro e chama a rota do lead', async () => {
    render(<ClientesAtivosPage />);
    await screen.findByText('Papeleira');
    expect(screen.queryByTestId('criar-cadastro-acordo:a2')).toBeNull();
    fireEvent.click(screen.getByTestId('criar-cadastro-lead:l-papel'));
    await waitFor(() => expect(posts).toEqual(['/comercial/clientes-ativos/l-papel/cadastro']));
    await screen.findByTestId('cliente-ativo-partner:p-novo');
  });
});
