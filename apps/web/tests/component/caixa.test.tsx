import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { CaixaAtividadeResposta, CaixaResposta, CaixaTarefasResposta } from '@mktos/shared';

/*
 * ==========================================================================
 * O TOPO DA CAIXA — o que espera a sua assinatura (fatia A7 + rodada do painel P1)
 * ==========================================================================
 *
 * A caixa virou caixa de entrada (abas Atividade e Minhas tarefas, cobertas em
 * `caixa-entrada.test.tsx`). O topo guarda o que a fatia A7 cobrava, agora como
 * CONTAGEM com caminho para `/atendimento`, que é onde a fila e a assinatura
 * continuam:
 *
 *  1. PERMISSÃO NÃO É ALÇADA. Quem acompanha a fila e não decide lê a frase,
 *     não um zero; promovido no meio da sessão é avisado a sair e entrar;
 *  2. A CAIXA NÃO ASSINA. Nenhum botão de assinar, confirmar ou aprovar aqui;
 *  3. O QUE A PORTA RECUSARIA HOJE aparece como outra coisa, com o caminho;
 *  4. EIXO SEM PERMISSÃO NÃO MATA A TELA, e sessão de fora é avisada;
 *  5. O NÚMERO É PISO quando bate no teto, e a tela diz.
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
    user: { id: 'u-eu', name: 'Pedro', email: 'p@x.com', roles: [], permissions: ['dashboard.ver'] },
    can: () => true,
  }),
}));

// eslint-disable-next-line import/first
import CaixaPage from '@/app/caixa/page';

const AGORA = new Date();

function resposta(over: Partial<CaixaResposta> = {}): CaixaResposta {
  return {
    agora: AGORA.toISOString(),
    eu: { id: 'u-eu', nome: 'Pedro Magnago', alcada: 'responsavel', decide: true, decideNestaSessao: true, ativo: true },
    aprovacoes: { estado: 'ok', itens: [], retidasPorImpedimento: 0, truncado: false, teto: 50 },
    tarefas: {
      estado: 'ok',
      itens: [],
      truncado: false,
      teto: 50,
      identidades: ['Pedro Magnago'],
      diasSemMovimento: 7,
      horasPresa: 24,
    },
    conversa: { estado: 'ok', itens: [], truncado: false, dias: 7, teto: 20 },
    total: 0,
    totalParcial: false,
    source: { tool: 'caixa-pessoal', generatedAt: AGORA.toISOString() },
    ...over,
  };
}

const aprovacao = {
  id: 'ap-1',
  resumo: 'mandar o resumo semanal no grupo',
  nivel: 'R4',
  capacidade: 'whatsapp.mensagem.enviar',
  canal: 'whatsapp',
  alcadaMinima: 'titular',
  exigeMotivo: true,
  exigeReauth: true,
  proponente: 'Lucas Fernandes',
  proponenteTipo: 'user' as const,
  propostaEm: AGORA.toISOString(),
  expiraEm: new Date(AGORA.getTime() + 7_200_000).toISOString(),
  esperandoMs: 0,
  venceEmMs: 7_200_000,
};

const ATIVIDADE_VAZIA: CaixaAtividadeResposta = {
  estado: 'ok',
  itens: [],
  proximo: null,
  identidades: ['Pedro Magnago'],
  limpoAte: null,
  incluirLimpos: false,
  incluirMeus: false,
  tarefasTruncadas: false,
  agora: AGORA.toISOString(),
};

const TAREFAS_VAZIAS: CaixaTarefasResposta = {
  estado: 'ok',
  itens: [],
  truncado: false,
  teto: 200,
  identidades: ['Pedro Magnago'],
  listas: [],
  status: [],
  filtros: { responsavel: 'eu', encerradas: false },
  agora: AGORA.toISOString(),
};

function servir(caixa: CaixaResposta) {
  apiGet.mockImplementation((caminho: string) => {
    if (caminho === '/caixa') return Promise.resolve(caixa);
    if (caminho.startsWith('/caixa/atividade')) return Promise.resolve(ATIVIDADE_VAZIA);
    if (caminho.startsWith('/caixa/tarefas')) return Promise.resolve(TAREFAS_VAZIAS);
    return Promise.reject(new Error(`rota inesperada ${caminho}`));
  });
}

beforeEach(() => {
  apiGet.mockReset();
});

describe('o topo: aprovações que você pode assinar', () => {
  it('conta as aprovações e leva para /atendimento', async () => {
    servir(resposta({ aprovacoes: { estado: 'ok', itens: [aprovacao], retidasPorImpedimento: 0, truncado: false, teto: 50 }, total: 1 }));
    render(<CaixaPage />);
    await waitFor(() => expect(screen.getByTestId('caixa-aprovacoes').textContent).toContain('1'));
    expect(document.querySelector('a[href="/atendimento"]')).toBeTruthy();
    // A caixa não assina: quem age é a fila.
    expect(screen.queryByRole('button', { name: /assinar|confirmar|aprovar/i })).toBeNull();
    // O conteúdo da ação retida não passa por aqui.
    expect(screen.queryByText(/mandar o resumo semanal/)).toBeNull();
  });

  it('nada esperando diz isso, e a alçada de quem olha aparece', async () => {
    servir(resposta());
    render(<CaixaPage />);
    await waitFor(() => expect(screen.getByText(/nada esperando/)).toBeTruthy());
    expect(screen.getByText('responsavel')).toBeTruthy();
    expect(screen.getByText(/medido às \d{2}:\d{2}/)).toBeTruthy();
  });

  it('quem acompanha a fila e não decide lê a frase, não um zero', async () => {
    servir(
      resposta({
        eu: { id: 'u-eu', nome: 'Ana', alcada: 'operador', decide: false, decideNestaSessao: false, ativo: true },
        aprovacoes: { estado: 'nao_decide', itens: [], retidasPorImpedimento: 0, truncado: false, teto: 50 },
      }),
    );
    render(<CaixaPage />);
    await waitFor(() => expect(screen.getByText(/não decide nela/)).toBeTruthy());
    expect(screen.getByText(/aprovacoes\.decidir/)).toBeTruthy();
  });

  it('promovido no meio da sessão é avisado a sair e entrar', async () => {
    servir(
      resposta({
        eu: { id: 'u-eu', nome: 'Pedro', alcada: 'titular', decide: true, decideNestaSessao: false, ativo: true },
        aprovacoes: { estado: 'nao_decide', itens: [], retidasPorImpedimento: 0, truncado: false, teto: 50 },
      }),
    );
    render(<CaixaPage />);
    await waitFor(() => expect(screen.getByText(/depois que esta sessão começou/)).toBeTruthy());
  });

  it('o que a porta recusaria hoje aparece como outra coisa, com caminho para a fila', async () => {
    servir(resposta({ aprovacoes: { estado: 'ok', itens: [], retidasPorImpedimento: 2, truncado: false, teto: 50 } }));
    render(<CaixaPage />);
    await waitFor(() => expect(screen.getByText(/esperam um conserto/)).toBeTruthy());
  });

  it('sem acesso à fila, a frase de papel aparece e as abas continuam', async () => {
    servir(resposta({ aprovacoes: { estado: 'sem_permissao', itens: [], retidasPorImpedimento: 0, truncado: false, teto: 50 } }));
    render(<CaixaPage />);
    await waitFor(() => expect(screen.getByText(/não acompanha a fila de aprovação/)).toBeTruthy());
    expect(screen.getByTestId('caixa-aba-atividade')).toBeTruthy();
  });

  it('sessão que não é de usuário ativo desta empresa é avisada a entrar de novo', async () => {
    servir(
      resposta({
        eu: { id: 'u-eu', nome: null, alcada: 'nenhuma', decide: false, decideNestaSessao: false, ativo: false },
        aprovacoes: { estado: 'fora_da_casa', itens: [], retidasPorImpedimento: 0, truncado: false, teto: 50 },
      }),
    );
    render(<CaixaPage />);
    await waitFor(() => expect(screen.getAllByText(/Saia e entre de novo/).length).toBeGreaterThan(0));
  });

  it('bateu no teto: "N+" e a frase de piso', async () => {
    servir(
      resposta({
        aprovacoes: { estado: 'ok', itens: [aprovacao], retidasPorImpedimento: 0, truncado: true, teto: 50 },
        total: 50,
        totalParcial: true,
      }),
    );
    render(<CaixaPage />);
    await waitFor(() => expect(screen.getByText('1+')).toBeTruthy());
    expect(screen.getByText(/o número é um piso/)).toBeTruthy();
  });

  it('a medição falhou: erro com "tentar de novo", e as abas continuam', async () => {
    apiGet.mockImplementation((caminho: string) =>
      caminho === '/caixa'
        ? Promise.reject(new Error('fora do ar'))
        : Promise.resolve(caminho.startsWith('/caixa/atividade') ? ATIVIDADE_VAZIA : TAREFAS_VAZIAS),
    );
    render(<CaixaPage />);
    await waitFor(() => expect(screen.getByText(/Não foi possível medir as aprovações/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'tentar de novo' })).toBeTruthy();
    expect(screen.getByTestId('caixa-aba-tarefas')).toBeTruthy();
  });
});
