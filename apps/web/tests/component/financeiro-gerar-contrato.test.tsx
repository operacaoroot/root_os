import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * GERAR LANÇAMENTO DE CONTRATO NA TELA DO FINANCEIRO (FIN1-E28).
 *
 * A rota exige o vencimento no corpo, e repetir o mesmo vencimento devolve o
 * lançamento já gravado (`replayed`). A tela manda o `proximoVencimento` que
 * mostrou na lista, trava os botões enquanto a chamada está em curso, diz que
 * nada foi gravado quando a resposta é uma repetição e mostra a mensagem do
 * 409 como a API escreveu.
 *
 * Interface com dublê da API: `apiPost` devolve uma promessa que o teste
 * resolve na mão. Não é serviço real.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...real,
    apiGet: (...a: unknown[]) => apiGet(...a),
    apiPost: (...a: unknown[]) => apiPost(...a),
    apiPatch: (...a: unknown[]) => apiPatch(...a),
  };
});

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u-eu', name: 'Pedro', email: 'p@x.com', roles: [], permissions: ['financeiro.ver', 'financeiro.editar'] },
    can: (p: string) => ['financeiro.ver', 'financeiro.editar'].includes(p),
  }),
}));

// eslint-disable-next-line import/first
import FinanceiroPage from '@/app/financeiro/page';
// eslint-disable-next-line import/first
import { ErroDaApi } from '@/lib/api';

const NOVEMBRO = '2026-11-10T00:00:00.000Z';
const FONTE = { tool: 'banco-interno', generatedAt: '2026-10-01T12:00:00.000Z' };

function contrato(id: string, descricao: string, proximoVencimento: string) {
  return {
    id, tipo: 'saida', partnerId: null, partnerName: null, descricao, valor: 1500, diaVencimento: 10,
    periodicidade: 'mensal', chartAccountId: null, accountId: 'conta-1', dataInicio: NOVEMBRO, dataFim: null,
    proximoVencimento, status: 'ativo',
  };
}

const CONTRATOS = {
  items: [contrato('c-aluguel', 'Aluguel', NOVEMBRO), contrato('c-internet', 'Internet', '2026-11-05T00:00:00.000Z')],
  total: 2,
  source: FONTE,
};
const A_PAGAR = {
  items: [], total: 0,
  totals: { aPagar: 0, aReceber: 0, vencidoPagar: 0, vencidoReceber: 0, aguardandoAprovacao: 0 },
  approvalLimit: 5000, source: FONTE,
};

/** A chamada de gerar fica pendente até o teste decidir a resposta. */
let responder: { ok: (corpo: unknown) => void; falha: (e: unknown) => void };

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  apiPatch.mockReset();
  // O que não interessa a este teste nunca responde, e a tela fica no estado inicial.
  apiGet.mockImplementation((rota: string) => {
    if (rota === '/finance/contracts') return Promise.resolve(CONTRATOS);
    if (rota === '/finance/payables') return Promise.resolve(A_PAGAR);
    return new Promise(() => {});
  });
  apiPost.mockImplementation(
    () => new Promise((ok, falha) => (responder = { ok, falha })),
  );
});

async function abrirContratos() {
  const user = userEvent.setup();
  render(<FinanceiroPage />);
  await user.click(screen.getByRole('button', { name: 'A Pagar/Receber' }));
  const linha = (texto: string) => within(screen.getByText(new RegExp(texto)).closest('li') as HTMLElement).getByRole('button');
  await waitFor(() => expect(linha('Aluguel')).toBeInTheDocument());
  return { user, aluguel: () => linha('Aluguel'), internet: () => linha('Internet') };
}

describe('financeiro: gerar lançamento de contrato', () => {
  it('manda o vencimento mostrado na lista e trava os botões até a resposta', async () => {
    const { user, aluguel, internet } = await abrirContratos();
    await user.click(aluguel());
    expect(apiPost).toHaveBeenCalledWith('/finance/contracts/c-aluguel/gerar', { vencimento: NOVEMBRO }, 'tok');
    expect({ aluguel: [aluguel().textContent, (aluguel() as HTMLButtonElement).disabled], internet: (internet() as HTMLButtonElement).disabled })
      .toEqual({ aluguel: ['Gerando…', true], internet: true });

    // O segundo clique com a chamada em curso não sai da tela.
    fireEvent.click(aluguel());
    expect(apiPost).toHaveBeenCalledTimes(1);

    responder.ok({ ok: true, transactionId: 't-1', proximoVencimento: '2026-12-10T00:00:00.000Z', replayed: false });
    expect(await screen.findByText('Lançamento gerado a partir do contrato.')).toBeInTheDocument();
    await waitFor(() => expect((aluguel() as HTMLButtonElement).disabled).toBe(false));
    expect(aluguel().textContent).toBe('Gerar lançamento');
  });

  it('repetição (replayed): avisa que o vencimento já tinha sido gerado e nada foi gravado', async () => {
    const { user, aluguel } = await abrirContratos();
    await user.click(aluguel());
    responder.ok({ ok: true, transactionId: 't-1', proximoVencimento: '2026-12-10T00:00:00.000Z', replayed: true });
    expect(await screen.findByText('Este vencimento já tinha sido gerado. Nenhum lançamento novo.')).toBeInTheDocument();
    expect(screen.queryByText('Lançamento gerado a partir do contrato.')).not.toBeInTheDocument();
  });

  it('409: mostra a mensagem da API e destrava os botões', async () => {
    const { user, aluguel } = await abrirContratos();
    await user.click(aluguel());
    const mensagem = 'O vencimento pedido não é o próximo deste contrato. Atualize a lista antes de gerar.';
    responder.falha(new ErroDaApi(mensagem, 409, 'Conflict'));
    expect(await screen.findByText(mensagem)).toBeInTheDocument();
    await waitFor(() => expect((aluguel() as HTMLButtonElement).disabled).toBe(false));
  });
});
