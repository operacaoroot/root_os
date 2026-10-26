import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const patches: { rota: string; corpo: unknown }[] = [];
const RESUMO = {
  caixa: { saldo: 1000, aReceber: 0, aPagar: 0, folegoMeses: 2 },
  acordos: {
    linhas: [{ id: 'a-1', cliente: 'Lucas da Guiando', produto: 'Imersão ROOT', tipo: 'parceria', valor: 2997, observacao: null, apelidos: null, recebido: 0, aReceber: 0, semRastro: 0, partnerId: null, partnerNome: null }],
    porTipo: [{ tipo: 'parceria', acordos: 1, valor: 2997, recebido: 0, aReceber: 0 }],
    entregue: 2997, viraCaixa: 0, semCaixaPct: 100, semRastro: 0,
  },
  recorrentes: { linhas: [], custoMensal: 0, receitaMensal: 0, coberturaPct: null },
  mesAMes: { linhas: [], porMes: [], mesAtual: '2026-10', contas: [], detalhe: [] },
  proximos: [],
  dependencia: null,
  pendencias: { semClassificacao: 0, vencidoReceber: 0, vencidoPagar: 0 },
};
vi.mock('@/lib/api', () => ({
  apiGet: vi.fn(async (rota: string) => {
    if (rota === '/finance/partners') return { items: [{ id: 'p-rezende', razaoSocial: 'Lucas Rezende', nomeFantasia: null, isCliente: true }] };
    if (rota.includes('leitura')) return { texto: 'tudo em ordem', geradaEm: '2026-10-26T12:00:00Z', guardada: true };
    return RESUMO;
  }),
  apiPatch: vi.fn(async (rota: string, corpo: unknown) => { patches.push({ rota, corpo }); return { ok: true }; }),
  apiPost: vi.fn(async (rota: string) => (rota.includes('leitura') ? { texto: 'tudo em ordem', geradaEm: '2026-10-26T12:00:00Z', guardada: true } : { ok: true })),
  apiDelete: vi.fn(async () => ({ ok: true })),
}));
import { AnaliseView } from '@/app/financeiro/Analise';

describe('Análise: ligar o acordo ao cadastro do cliente', () => {
  it('escolher o cadastro grava no acordo certo (o id vai no endereço)', async () => {
    render(<AnaliseView token="tok" canEdit onError={() => {}} />);
    const seletor = await screen.findByLabelText('Cliente cadastrado de Lucas da Guiando');
    fireEvent.change(seletor, { target: { value: 'p-rezende' } });
    await vi.waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ rota: '/finance/analise/acordos/a-1', corpo: { partnerId: 'p-rezende' } });
  });
});
