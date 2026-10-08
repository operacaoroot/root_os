import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObrigacaoFinanceiraQA, PedidoDecisaoFinanceiraQA, RespostaDecisaoFinanceiraQA } from '@/app/financeiro/obrigacoes/contrato';

const apiGet = vi.fn(), apiPost = vi.fn(), apiPatch = vi.fn();
vi.mock('@/lib/api', async () => ({
  ...await vi.importActual<typeof import('@/lib/api')>('@/lib/api'),
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: (...args: unknown[]) => apiPost(...args),
  apiPatch: (...args: unknown[]) => apiPatch(...args),
}));
const USER = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const TX = '33333333-3333-4333-8333-333333333333';
const VERSION = '44444444-4444-4444-8444-444444444444';
const REQUEST = '55555555-5555-4555-8555-555555555555';
const DECISION = '66666666-6666-4666-8666-666666666666';
const CONTRACT = '77777777-7777-4777-8777-777777777777';
const HASH = 'a'.repeat(64), NOW = '2026-10-08T01:00:00.000Z';
const PATH = '/finance/exercicio/obrigacoes/' + TX;
const KEY = 'rootos.financeiro.exercicio:' + USER + ':' + TX + ':' + ORG;
const OTHER = '88888888-8888-4888-8888-888888888888';
let pessoa = USER, token = 'sessao-a';
let permissions = ['financeiro.ver', 'financeiro.editar'];
vi.mock('@/lib/auth', () => ({ useAuth: () => ({
  token, ready: true,
  user: { id: pessoa, name: 'Pessoa QA', email: 'fixture@example.invalid', roles: [], permissions },
  can: (p: string) => permissions.includes(p),
}) }));
import { ObrigacaoFinanceira } from '@/app/financeiro/obrigacoes/ObrigacaoFinanceira';
import FinanceiroPage from '@/app/financeiro/page';
import { ErroDaApi } from '@/lib/api';

function detalhe(overrides: Partial<ObrigacaoFinanceiraQA> = {}): ObrigacaoFinanceiraQA {
  const conta = { id: 'conta-qa', nome: 'Conta manual QA', currency: 'BRL', provider: 'manual' as const, ativa: true };
  return {
    modo: 'exercicio', fonte: 'financeiro_local_qa', consultadoEm: NOW, orgId: ORG,
    transactionId: TX, versionId: VERSION, contentHash: HASH, expectedUpdatedAt: NOW,
    valorCanonico: 'BRL 6000.00', currency: 'BRL', tipo: 'saida', status: 'previsto',
    approvalStatus: 'aguardando', paidAt: null, reconciledAt: null, conta,
    origem: { tipo: 'contrato_recorrente_qa', contractId: CONTRACT, descricao: 'Contrato QA recorrente', vencimentoGerado: NOW, comercial: null },
    condicoes: {
      descricao: 'Parcela QA de outubro', tipo: 'saida', valorCanonico: 'BRL 6000.00', currency: 'BRL',
      competencia: NOW, vencimento: NOW, conta,
      contrato: { id: CONTRACT, descricao: 'Contrato QA recorrente', tipo: 'saida', valorCanonico: 'BRL 6000.00', diaVencimento: 8,
        periodicidade: 'mensal', dataInicio: NOW, dataFim: null, status: 'ativo' },
      contraparte: { id: 'contraparte-qa', razaoSocial: 'Contraparte QA', ativo: true },
      classificacao: { id: 'classificacao-qa', codigo: '3.1.1', nome: 'Serviço QA', ativo: true, permiteLancamento: true },
      projetoFinanceiro: null, departamento: null, temRateio: false,
    },
    decisao: null, historico: [], canDecide: true, alcadaExigida: 'responsavel', alcadaAtual: 'responsavel', impedimento: null,
    ...overrides,
  };
}
function resposta(body: PedidoDecisaoFinanceiraQA, replayed = false): RespostaDecisaoFinanceiraQA {
  return { modo: 'exercicio', orgId: ORG, transactionId: TX, decisionId: DECISION,
    versionId: body.versionId, contentHash: body.contentHash, replayed,
    decisao: { id: DECISION, requestId: body.requestId, versionId: body.versionId, contentHash: body.contentHash,
      ator: { id: USER, nome: 'Responsável QA' }, decididoEm: NOW, aprovar: body.aprovar, motivo: body.motivo,
      alcadaExigida: 'responsavel', alcadaVerificada: 'responsavel' },
    resultado: { status: 'previsto', approvalStatus: body.aprovar ? 'aprovado' : 'rejeitado', paidAt: null, reconciledAt: null,
      pagamentoExecutado: false, cobrancaExecutada: false, conciliacaoExecutada: false },
  };
}
function promessa<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
async function abrir() {
  const view = render(<ObrigacaoFinanceira token="sessao-a" userId={USER} transactionId={TX} />);
  await screen.findByRole('heading', { name: 'Parcela QA de outubro' });
  return { ...view, user: userEvent.setup() };
}
async function preencher(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText('Conferi a origem, o valor, a moeda e as condições desta versão.'));
  await user.type(screen.getByRole('textbox', { name: 'Motivo da decisão' }), '  Condições conferidas no exercício QA.  ');
}
beforeEach(() => {
  apiGet.mockReset(); apiPost.mockReset(); apiPatch.mockReset(); localStorage.clear();
  pessoa = USER; token = 'sessao-a'; permissions = ['financeiro.ver', 'financeiro.editar'];
  apiGet.mockResolvedValue(detalhe());
  apiPost.mockImplementation((_path, body) => Promise.resolve(resposta(body)));
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(REQUEST);
});

describe('F08: detalhe de obrigação e decisão recuperável (API simulada)', () => {
  it('mostra origem persistida, condições e moeda sem oferecer liquidação', async () => {
    await abrir();
    const origem = screen.getByRole('region', { name: 'Origem e condições' });
    expect(within(origem).getByText('BRL 6000.00', { selector: 'code' })).toBeInTheDocument();
    expect(within(origem).getByText(/Contrato recorrente: Contrato QA recorrente/)).toBeInTheDocument();
    expect(within(origem).getByText(TX)).toBeInTheDocument();
    expect(screen.getByText(/sua alçada atual: responsavel/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Baixar|Pagar|Conciliar/ })).not.toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith(PATH, 'sessao-a');
  });
  it('preserva 10/11 no calendário contábil a partir de midnight UTC', async () => {
    const data = detalhe();
    data.origem.vencimentoGerado = '2026-11-10T00:00:00.000Z';
    data.condicoes.competencia = '2026-11-01T00:00:00.000Z';
    data.condicoes.vencimento = '2026-11-10T00:00:00.000Z';
    data.condicoes.contrato.diaVencimento = 10;
    data.condicoes.contrato.dataInicio = '2026-10-01T00:00:00.000Z';
    data.condicoes.contrato.dataFim = '2027-09-30T00:00:00.000Z';
    apiGet.mockResolvedValueOnce(data);
    await abrir();
    const origem = within(screen.getByRole('region', { name: 'Origem e condições' }));
    expect(origem.getByText('Gerado para 10/11/2026')).toBeInTheDocument();
    expect(origem.getByText('01/11/2026 / 10/11/2026')).toBeInTheDocument();
    expect(origem.getByText('Vigência: 01/10/2026 até 30/09/2027.')).toBeInTheDocument();
    expect(origem.queryByText(/09\/11\/2026.*21:00:00/)).not.toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });
  it('mantém consulta, conferência e decisão no horário de Brasília', async () => {
    const instant = '2026-11-10T00:00:00.000Z';
    const data = detalhe({ consultadoEm: instant, expectedUpdatedAt: instant });
    const decisao = { ...resposta({ requestId: REQUEST, versionId: VERSION, contentHash: HASH,
      expectedUpdatedAt: instant, aprovar: true, motivo: 'Decisão QA conferida.' }).decisao, decididoEm: instant };
    data.decisao = decisao; data.historico = [decisao]; data.approvalStatus = 'aprovado'; data.canDecide = false;
    apiGet.mockResolvedValueOnce(data);
    await abrir();
    expect(screen.getByText(/consulta em 09\/11\/2026,\s*21:00:00/)).toBeInTheDocument();
    expect(screen.getByText(/Registro conferido em 09\/11\/2026,\s*21:00:00/)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Histórico da obrigação' }))
      .getByText(/Aprovada por Responsável QA.*09\/11\/2026,\s*21:00:00/)).toBeInTheDocument();
  });
  it('envia os seis campos exatos, bloqueia clique repetido e mostra somente decisão prevista', async () => {
    const deferred = promessa<RespostaDecisaoFinanceiraQA>(); apiPost.mockReturnValueOnce(deferred.promise);
    const { user } = await abrir(); await preencher(user);
    const approve = screen.getByRole('button', { name: 'Aprovar condições exatas' });
    await user.click(approve); fireEvent.click(approve);
    const body = { requestId: REQUEST, versionId: VERSION, contentHash: HASH, expectedUpdatedAt: NOW,
      aprovar: true, motivo: 'Condições conferidas no exercício QA.' };
    expect(apiPost).toHaveBeenCalledExactlyOnceWith(PATH + '/decisoes', body, 'sessao-a');
    expect(approve).toBeDisabled();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ orgId: ORG, payload: body });
    await act(async () => deferred.resolve(resposta(body)));
    expect(await screen.findByRole('heading', { name: 'Decisão registrada.' })).toBeInTheDocument();
    expect(screen.getByText('Resultado: aprovado · previsto · sem pagamento, cobrança ou conciliação.')).toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(approve).toBeDisabled();
  });
  it('respeita a capacidade negada pelo servidor mesmo com alçada nominal', async () => {
    apiGet.mockResolvedValueOnce(detalhe({ canDecide: false, impedimento: 'Condições correntes divergentes.' }));
    await abrir();
    expect(screen.getByText('Condições correntes divergentes.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aprovar condições exatas' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rejeitar condições exatas' })).toBeDisabled();
    expect(apiPost).not.toHaveBeenCalled();
  });
  it('rejeição preserva previsto e aparece no histórico sem baixa', async () => {
    const { user } = await abrir(); await preencher(user);
    await user.click(screen.getByRole('button', { name: 'Rejeitar condições exatas' }));
    expect(await screen.findByText('Resultado: rejeitado · previsto · sem pagamento, cobrança ou conciliação.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Histórico da obrigação' })).getByText(/Rejeitada por Responsável QA/)).toBeInTheDocument();
    expect(apiPatch).not.toHaveBeenCalled();
  });
  it('perda de resposta e remontagem recuperam o POST congelado, mesmo com revisão corrente diferente', async () => {
    apiPost.mockRejectedValueOnce(new TypeError('Falha de conexão.'));
    const first = await abrir(); await preencher(first.user);
    await first.user.click(screen.getByRole('button', { name: 'Aprovar condições exatas' }));
    expect(await screen.findByRole('heading', { name: 'Resultado ainda não confirmado' })).toBeInTheDocument();
    const original = apiPost.mock.calls[0]; first.unmount();
    apiGet.mockResolvedValueOnce(detalhe({ expectedUpdatedAt: '2026-10-08T02:00:00.000Z' }));
    const second = await abrir();
    expect(screen.getByRole('textbox', { name: 'Motivo da decisão' })).toBeDisabled();
    apiPost.mockImplementationOnce((_path, body) => Promise.resolve(resposta(body, true)));
    await second.user.click(screen.getByRole('button', { name: 'Conferir pedido anterior' }));
    expect(await screen.findByRole('heading', { name: 'Decisão já registrada; pedido conferido.' })).toBeInTheDocument();
    expect(apiPost.mock.calls[1]).toEqual(original);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
  it('409 conserva intenção e só permite descartá-la depois de conferir o estado atual', async () => {
    apiPost.mockRejectedValueOnce(new ErroDaApi('As condições mudaram.', 409, 'financeiro_exercicio_alterado'));
    const { user } = await abrir(); await preencher(user);
    await user.click(screen.getByRole('button', { name: 'Aprovar condições exatas' }));
    expect(await screen.findByText('As condições mudaram.')).toBeInTheDocument();
    const discard = screen.getByRole('button', { name: 'Descartar pedido recusado' }); expect(discard).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Motivo da decisão' })).toHaveValue('  Condições conferidas no exercício QA.  ');
    await user.click(screen.getByRole('button', { name: 'Conferir estado atual' }));
    await waitFor(() => expect(discard).toBeEnabled()); await user.click(discard);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(apiPost).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 404])('POST %s retira conteúdo e pedido privados', async (status) => {
    apiPost.mockRejectedValueOnce(new ErroDaApi('Acesso indisponível.', status));
    const { user } = await abrir(); await preencher(user);
    await user.click(screen.getByRole('button', { name: 'Aprovar condições exatas' }));
    expect(await screen.findByText('Acesso indisponível.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Origem e condições' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
  it.each([401, 403, 404])('GET %s ao reconferir retira leitura e pedido privados', async (status) => {
    apiPost.mockRejectedValueOnce(new TypeError('Conexão encerrada.'));
    const { user } = await abrir(); await preencher(user);
    await user.click(screen.getByRole('button', { name: 'Aprovar condições exatas' }));
    await screen.findByRole('heading', { name: 'Resultado ainda não confirmado' });
    apiGet.mockRejectedValueOnce(new ErroDaApi('Leitura indisponível.', status));
    await user.click(screen.getByRole('button', { name: 'Conferir estado atual' }));
    expect(await screen.findByText('Leitura indisponível.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Origem e condições' })).not.toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
  it('GET antigo não reaparece depois de trocar de pessoa', async () => {
    const late = promessa<ObrigacaoFinanceiraQA>(); apiGet.mockReturnValueOnce(late.promise);
    const view = render(<ObrigacaoFinanceira token="sessao-a" userId={USER} transactionId={TX} />);
    apiGet.mockResolvedValueOnce(detalhe({ condicoes: { ...detalhe().condicoes, descricao: 'Parcela da outra pessoa QA' } }));
    view.rerender(<ObrigacaoFinanceira token="sessao-b" userId={OTHER} transactionId={TX} />);
    await screen.findByRole('heading', { name: 'Parcela da outra pessoa QA' });
    await act(async () => late.resolve(detalhe()));
    expect(screen.queryByRole('heading', { name: 'Parcela QA de outubro' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Parcela da outra pessoa QA' })).toBeInTheDocument();
  });
  it.each(['resposta', 'erro'] as const)('POST antigo (%s/finally) preserva o pedido da pessoa anterior', async (kind) => {
    const late = promessa<RespostaDecisaoFinanceiraQA>(); apiPost.mockReturnValueOnce(late.promise);
    const view = await abrir(); await preencher(view.user);
    await view.user.click(screen.getByRole('button', { name: 'Aprovar condições exatas' }));
    const body = apiPost.mock.calls[0][1] as PedidoDecisaoFinanceiraQA;
    const raw = localStorage.getItem(KEY);
    apiGet.mockResolvedValueOnce(detalhe({ condicoes: { ...detalhe().condicoes, descricao: 'Outra sessão QA' } }));
    view.rerender(<ObrigacaoFinanceira token="sessao-b" userId={OTHER} transactionId={TX} />);
    await screen.findByRole('heading', { name: 'Outra sessão QA' });
    await act(async () => { if (kind === 'resposta') late.resolve(resposta(body)); else late.reject(new ErroDaApi('Erro da pessoa anterior.', 401)); });
    expect(localStorage.getItem(KEY)).toBe(raw);
    expect(screen.queryByRole('region', { name: 'Resultado da decisão' })).not.toBeInTheDocument();
    expect(screen.queryByText('Erro da pessoa anterior.')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Motivo da decisão' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Conferir estado atual' })).toBeEnabled();
  });
  it('não restaura pedido de outra empresa para a mesma pessoa e lançamento', async () => {
    const body = { requestId: REQUEST, versionId: VERSION, contentHash: HASH, expectedUpdatedAt: NOW, aprovar: true, motivo: 'Intenção privada anterior.' };
    localStorage.setItem(KEY, JSON.stringify({ path: PATH + '/decisoes', orgId: ORG, payload: body, recusado: false }));
    apiGet.mockResolvedValueOnce(detalhe({ orgId: OTHER }));
    await abrir();
    expect(screen.queryByRole('region', { name: 'Pedido a conferir' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });
  it.each(['outra obrigação', 'efeito incompatível'] as const)('resposta com %s conserva o pedido original sem anunciar sucesso', async (kind) => {
    apiPost.mockImplementationOnce((_path, body) => {
      const r = resposta(body);
      return Promise.resolve(kind === 'outra obrigação' ? { ...r, transactionId: OTHER } : { ...r, resultado: { ...r.resultado, pagamentoExecutado: true } });
    });
    const { user } = await abrir(); await preencher(user);
    await user.click(screen.getByRole('button', { name: 'Aprovar condições exatas' }));
    expect(await screen.findByText('A resposta da decisão não foi confirmada para este pedido.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Resultado da decisão' })).not.toBeInTheDocument();
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });
  it('aceita empresa e pessoa de IDs persistidos prefixados, sem impor UUID legado', async () => {
    const orgId = 'qa_empresa_root_local', userId = 'qa_responsavel_local';
    apiGet.mockResolvedValueOnce(detalhe({ orgId }));
    apiPost.mockImplementationOnce((_path, body) => {
      const r = resposta(body);
      return Promise.resolve({ ...r, orgId, decisao: { ...r.decisao, ator: { id: userId, nome: 'Responsável QA prefixado' } } });
    });
    render(<ObrigacaoFinanceira token="sessao-prefixada" userId={userId} transactionId={TX} />);
    await screen.findByRole('heading', { name: 'Parcela QA de outubro' });
    const user = userEvent.setup(); await preencher(user);
    await user.click(screen.getByRole('button', { name: 'Aprovar condições exatas' }));
    expect(await screen.findByRole('heading', { name: 'Decisão registrada.' })).toBeInTheDocument();
    expect(screen.getByText(/Aprovada por Responsável QA prefixado/)).toBeInTheDocument();
    expect(localStorage.getItem('rootos.financeiro.exercicio:' + userId + ':' + TX + ':' + orgId)).toBeNull();
  });
  it('moeda da conta divergente impede apresentação decidível', async () => {
    const d = detalhe(); d.conta = { ...d.conta, currency: 'USD' }; apiGet.mockResolvedValueOnce(d);
    render(<ObrigacaoFinanceira token="sessao-a" userId={USER} transactionId={TX} />);
    expect(await screen.findByText('A resposta não permite conferir as condições desta obrigação.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprovar condições exatas' })).not.toBeInTheDocument();
  });
});

describe('F08: entrada pela lista financeira', () => {
  const row = { id: TX, tipo: 'saida', description: 'Registro do exercício QA', partnerName: null, chartCodigo: null,
    amount: 6000, dueDate: NOW, status: 'previsto', approvalStatus: 'aguardando', vencido: false, diasAtraso: 0 };
  function lista(items: object[]) {
    return { items, total: items.length, totals: { aPagar: 6000, aReceber: 0, vencidoPagar: 0, vencidoReceber: 0, aguardandoAprovacao: 1 }, approvalLimit: 5000 };
  }
  function apiLista(items: object[]) {
    apiGet.mockImplementation((path: string) => path === '/finance/payables' ? Promise.resolve(lista(items)) : new Promise(() => {}));
  }
  it('marcador persistido abre detalhe e esconde ações legadas; registro comum conserva aprovação', async () => {
    apiLista([{ ...row, exercicioFinanceiro: true }, { ...row, id: OTHER, description: 'Registro comum QA' }]);
    render(<FinanceiroPage />); const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'A Pagar/Receber' }));
    const link = await screen.findByRole('link', { name: 'Conferir obrigação' });
    expect(link).toHaveAttribute('href', '/financeiro/obrigacoes/' + TX);
    const exercise = within(link.closest('tr')!);
    expect(exercise.queryByRole('button', { name: /Aprovar|Rejeitar|Baixar/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aprovar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rejeitar' })).toBeInTheDocument();
  });
  it('pessoa com leitura pode abrir exercício sem decisão legada', async () => {
    permissions = ['financeiro.ver']; apiLista([{ ...row, exercicioFinanceiro: true }]);
    render(<FinanceiroPage />); await userEvent.setup().click(screen.getByRole('button', { name: 'A Pagar/Receber' }));
    expect(await screen.findByRole('link', { name: 'Conferir obrigação' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprovar' })).not.toBeInTheDocument();
  });
  it.each([401, 403, 409])('geração recusada %s conserva o status para retirar leitura ou manter conflito', async (status) => {
    const contractName = 'Contrato privado QA anterior à resposta';
    const contract = { ...detalhe().condicoes.contrato, id: CONTRACT, descricao: contractName,
      valor: 6000, accountId: 'conta-qa', partnerId: null, partnerName: null, chartAccountId: null,
      proximoVencimento: NOW };
    apiGet.mockImplementation((path: string) => path === '/finance/payables'
      ? Promise.resolve(lista([{ ...row, exercicioFinanceiro: true }]))
      : path === '/finance/contracts' ? Promise.resolve({ items: [contract], total: 1 })
      : new Promise(() => {}));
    apiPost.mockRejectedValue(new ErroDaApi('Geração recusada QA.', status));
    render(<FinanceiroPage />); const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'A Pagar/Receber' }));
    await screen.findByText(row.description);
    const contractRow = (await screen.findByText(new RegExp(contractName))).closest('li')!;
    await user.type(screen.getByPlaceholderText('Razão social'), 'Rascunho QA preservado');
    await user.click(within(contractRow).getByRole('button', { name: 'Gerar lançamento' }));
    await screen.findByText('Geração recusada QA.');
    expect(apiPost).toHaveBeenCalledOnce();
    if (status === 409) {
      expect(screen.getByText(row.description)).toBeInTheDocument();
      expect(screen.getByText(new RegExp(contractName))).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Razão social')).toHaveValue('Rascunho QA preservado');
      await waitFor(() => expect(within(contractRow).getByRole('button', { name: 'Gerar lançamento' })).toBeEnabled());
    } else {
      expect(screen.queryByText(row.description)).not.toBeInTheDocument();
      expect(screen.queryByText(new RegExp(contractName))).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Conferir obrigação' })).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText('Razão social')).not.toBeInTheDocument();
    }
  });
  it('a lista antiga não reaparece após trocar de sessão', async () => {
    const late = promessa<unknown>();
    apiGet.mockImplementation((path: string, t: string) => path === '/finance/payables'
      ? t === 'sessao-a' ? late.promise : Promise.resolve(lista([{ ...row, description: 'Registro da sessão B', exercicioFinanceiro: true }]))
      : new Promise(() => {}));
    const view = render(<FinanceiroPage />); const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'A Pagar/Receber' }));
    pessoa = OTHER; token = 'sessao-b'; view.rerender(<FinanceiroPage />);
    await user.click(screen.getByRole('button', { name: 'A Pagar/Receber' }));
    await screen.findByText('Registro da sessão B');
    await act(async () => late.resolve(lista([{ ...row, exercicioFinanceiro: true }])));
    expect(screen.queryByText('Registro do exercício QA')).not.toBeInTheDocument();
    expect(screen.getByText('Registro da sessão B')).toBeInTheDocument();
  });
});
