/*
 * CONTRATOS VIVOS (rodada do trabalho T8, 19/10/2026): o painel de contagens,
 * a ordem (ativos primeiro, encerrados por último, como a API devolve), busca
 * por nome e CNPJ, filtros, e encerrar à mão com motivo; parcela em aberto pede
 * a ciência antes de liberar o botão.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContratoVivo } from '@mktos/shared';

const posts: { caminho: string; corpo: unknown }[] = [];
let CONTRATOS: ContratoVivo[] = [];

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
    apiGet: vi.fn(async () => CONTRATOS),
    apiPost: vi.fn(async (caminho: string, corpo: unknown) => { posts.push({ caminho, corpo }); return {}; }),
  };
});

import ContratosPage from '@/app/comercial/contratos/page';

function contrato(leadId: string, cliente: string, over: Partial<ContratoVivo> = {}): ContratoVivo {
  return {
    leadId, cliente, produto: 'operacao', valorCentavos: 1_199_700, descontoPct: null, parcelas: [], reguaDeCobranca: [], entregas: [],
    primeiroValorEm: null, saude: null, faseDaImplantacao: null, marcos: [], aditivos: null,
    situacao: 'ativo', encerramento: null, cnpj: '12.345.678/0001-90', socioDaConta: 'Rodrigo', ...over,
  };
}

beforeEach(() => {
  posts.length = 0;
  CONTRATOS = [
    contrato('a', 'Construtora Alicerce'),
    contrato('b', 'Studio Lume', { situacao: 'em_implantacao', socioDaConta: 'Pedro', cnpj: '98.765.432/0001-10', produto: 'imersao' }),
    contrato('c', 'Café Serra', {
      parcelas: [{ n: 1, total: 3, valorCentavos: 399_900, vence: '2026-10-25', estado: 'pendente', pagaEm: null, aviso: null }],
    }),
    contrato('d', 'Ótica Vista', { situacao: 'concluido', encerramento: { situacao: 'concluido', motivo: 'Escopo entregue.', em: '2026-10-18T12:00:00.000Z', por: 'Rodrigo', parcelasEmAberto: 0 } }),
    contrato('e', 'Pet Feliz', { situacao: 'desativado', encerramento: { situacao: 'desativado', motivo: 'Cliente pediu a pausa.', em: '2026-10-17T12:00:00.000Z', por: 'Pedro', parcelasEmAberto: 1 } }),
  ];
});

describe('T8: contratos vivos', () => {
  it('o painel conta ativos (com os em implantação), em implantação, concluídos e desativados', async () => {
    render(<ContratosPage />);
    await screen.findByText('Construtora Alicerce');
    expect(screen.getByTestId('contratos-contagem-ativo')).toHaveTextContent('3');
    expect(screen.getByTestId('contratos-contagem-em_implantacao')).toHaveTextContent('1');
    expect(screen.getByTestId('contratos-contagem-concluido')).toHaveTextContent('1');
    expect(screen.getByTestId('contratos-contagem-desativado')).toHaveTextContent('1');
    const ordem = within(screen.getByTestId('contratos-lista')).getAllByRole('listitem').map((li) => li.getAttribute('data-situacao'));
    expect(ordem.slice(-2)).toEqual(['concluido', 'desativado']);
    expect(screen.getByTestId('contrato-encerramento-d')).toHaveTextContent('Concluído em 18/10 por Rodrigo: Escopo entregue.');
    expect(screen.queryByTestId('contrato-concluir-d')).toBeNull();
  });

  it('busca por nome e por CNPJ, e filtra por sócio e por produto', async () => {
    render(<ContratosPage />);
    await screen.findByText('Construtora Alicerce');
    const itens = () => within(screen.getByTestId('contratos-lista')).queryAllByRole('listitem').map((li) => li.getAttribute('data-testid'));
    fireEvent.change(screen.getByTestId('contratos-busca'), { target: { value: '98765432' } });
    expect(itens()).toEqual(['contrato-b']);
    fireEvent.change(screen.getByTestId('contratos-busca'), { target: { value: 'otica' } });
    expect(itens()).toEqual(['contrato-d']);
    fireEvent.change(screen.getByTestId('contratos-busca'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('contratos-filtro-socio'), { target: { value: 'Pedro' } });
    expect(itens()).toEqual(['contrato-b']);
    fireEvent.change(screen.getByTestId('contratos-filtro-socio'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('contratos-filtro-produto'), { target: { value: 'imersao' } });
    expect(itens()).toEqual(['contrato-b']);
  });

  it('concluir pede motivo; parcela em aberto pede a ciência antes de liberar', async () => {
    render(<ContratosPage />);
    await screen.findByText('Café Serra');
    fireEvent.click(screen.getByTestId('contrato-desativar-c'));
    const confirmar = screen.getByTestId('contrato-confirmar');
    fireEvent.change(screen.getByTestId('contrato-motivo'), { target: { value: 'Cliente desistiu.' } });
    expect(confirmar).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('NÃO cancela a cobrança');
    fireEvent.click(screen.getByTestId('contrato-ciente'));
    expect(confirmar).toBeEnabled();
    fireEvent.click(confirmar);
    await waitFor(() => expect(posts).toEqual([{ caminho: '/comercial/contratos/c/encerrar', corpo: { situacao: 'desativado', motivo: 'Cliente desistiu.', cienteDasParcelas: true } }]));
  });
});
