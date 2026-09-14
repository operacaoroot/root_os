import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { CaixaResposta } from '@mktos/shared';

/*
 * ==========================================================================
 * A TELA DA CAIXA PESSOAL — fatia A7
 * ==========================================================================
 *
 * O que esta suíte cobra, e por que cada caso existe:
 *
 *  1. TELA VAZIA É VITÓRIA E DIZ ISSO. Nunca uma caixa cinza sem explicação —
 *     critério da fatia, escrito com essas palavras;
 *  2. VAZIO POR MOTIVO É DIFERENTE DE VAZIO POR VITÓRIA. "Você acompanha a fila
 *     e não decide nela" é uma frase, não uma lista vazia: permissão não é
 *     alçada, e essa distinção é a fatia inteira;
 *  3. O QUE O CLIQUE VAI PEDIR É DITO ANTES DO CLIQUE — motivo escrito em R4/R5
 *     e a senha. É a lição da tela do Google, que anunciava "✅ enviado" em cima
 *     de um 200 de retenção;
 *  4. A TELA DIZ POR QUAL NOME PROCUROU VOCÊ NO QUADRO. `assignee` é texto livre
 *     herdado do ClickUp: casamento por nome erra nas duas direções, e é melhor
 *     saber disso do que confiar numa caixa vazia;
 *  5. CONVERSA NÃO É MENÇÃO, e está escrito na tela, junto com o motivo de ela
 *     ficar fora do contador (não existe estado de lido);
 *  6. EIXO SEM PERMISSÃO NÃO MATA A TELA. 403 vira "sem acesso" para aquele
 *     eixo, e o resto continua — o desenho de `/contexto` (fatia 4.4);
 *  7. O QUE A PORTA RECUSARIA HOJE APARECE COMO OUTRA COISA, com o caminho para
 *     a fila, que é quem sabe explicar.
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

/* --------------------------------------------------------------- fixtures -- */

const AGORA = new Date();

function resposta(over: Partial<CaixaResposta> = {}): CaixaResposta {
  return {
    // Relógio da máquina, nunca data fixa: a suíte de Conexões desta árvore
    // está vermelha justamente por um fixture com data que envelheceu.
    agora: AGORA.toISOString(),
    eu: {
      id: 'u-eu',
      nome: 'Pedro Magnago',
      alcada: 'responsavel',
      decide: true,
      decideNestaSessao: true,
      ativo: true,
    },
    aprovacoes: {
      estado: 'ok',
      itens: [],
      retidasPorImpedimento: 0,
      truncado: false,
      teto: 50,
    },
    tarefas: {
      estado: 'ok',
      itens: [],
      truncado: false,
      teto: 50,
      identidades: ['Pedro Magnago', 'pedro@root.com'],
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
  propostaEm: new Date(AGORA.getTime() - 3_600_000).toISOString(),
  expiraEm: new Date(AGORA.getTime() + 7_200_000).toISOString(),
  esperandoMs: 3_600_000,
  venceEmMs: 7_200_000,
};

const tarefaParada = {
  id: 't-1',
  titulo: 'Fechar o relatório do cliente',
  lista: 'Operação',
  status: 'Em andamento',
  statusCor: '#fff',
  prioridade: 'alta',
  responsavel: 'Pedro Magnago',
  prazo: new Date(AGORA.getTime() - 86_400_000).toISOString(),
  atualizadaEm: new Date(AGORA.getTime() - 86_400_000).toISOString(),
  agenteSlug: null,
  agenteNome: null,
  agenteDesde: null,
  motivos: ['prazo_vencido' as const],
};

beforeEach(() => {
  apiGet.mockReset();
});

/* ------------------------------------------------------------------ casos -- */

describe('A7: a caixa vazia é vitória, e diz isso', () => {
  it('sem nada esperando, a tela afirma que não há nada — não uma caixa cinza', async () => {
    apiGet.mockResolvedValue(resposta());
    render(<CaixaPage />);
    await waitFor(() => expect(screen.getByText(/Nada esperando por você/)).toBeTruthy());
    expect(screen.getByText(/Nenhuma aprovação esperando a sua assinatura/)).toBeTruthy();
    expect(screen.getByText(/Nenhuma tarefa sua parada/)).toBeTruthy();
    expect(screen.getByText(/Ninguém comentou nas suas tarefas/)).toBeTruthy();
  });

  it('a tela diz QUANDO o número foi medido — ele não é ao vivo', async () => {
    apiGet.mockResolvedValue(resposta());
    render(<CaixaPage />);
    await waitFor(() => expect(screen.getByText(/Medido às \d{2}:\d{2}/)).toBeTruthy());
  });
});

describe('A7: permissão não é alçada, e a tela diz a diferença', () => {
  it('quem acompanha a fila e não decide lê a frase, não uma lista vazia', async () => {
    apiGet.mockResolvedValue(
      resposta({
        eu: {
          id: 'u-eu',
          nome: 'Ana',
          alcada: 'operador',
          decide: false,
          decideNestaSessao: false,
          ativo: true,
        },
        aprovacoes: { estado: 'nao_decide', itens: [], retidasPorImpedimento: 0, truncado: false, teto: 50 },
      }),
    );
    render(<CaixaPage />);
    await waitFor(() => expect(screen.getByText(/não decide nela/)).toBeTruthy());
    expect(screen.getByText(/aprovacoes\.decidir/)).toBeTruthy();
  });

  it('promovido no meio da sessão é avisado a sair e entrar — o token dura horas', async () => {
    apiGet.mockResolvedValue(
      resposta({
        eu: {
          id: 'u-eu',
          nome: 'Pedro',
          alcada: 'titular',
          decide: true,
          decideNestaSessao: false,
          ativo: true,
        },
        aprovacoes: { estado: 'nao_decide', itens: [], retidasPorImpedimento: 0, truncado: false, teto: 50 },
      }),
    );
    render(<CaixaPage />);
    await waitFor(() =>
      expect(screen.getByText(/depois que esta sessão começou/)).toBeTruthy(),
    );
  });

  it('a alçada de quem olha está na tela', async () => {
    apiGet.mockResolvedValue(resposta());
    render(<CaixaPage />);
    await waitFor(() => expect(screen.getByText('responsavel')).toBeTruthy());
  });
});

describe('A7: o que o clique vai pedir é dito ANTES do clique', () => {
  it('R4 anuncia motivo escrito e senha, e leva para a fila', async () => {
    apiGet.mockResolvedValue(
      resposta({
        aprovacoes: {
          estado: 'ok',
          itens: [aprovacao],
          retidasPorImpedimento: 0,
          truncado: false,
          teto: 50,
        },
        total: 1,
      }),
    );
    render(<CaixaPage />);
    await waitFor(() => expect(screen.getByText(/mandar o resumo semanal/)).toBeTruthy());
    expect(screen.getByText('pede motivo escrito')).toBeTruthy();
    expect(screen.getByText('pede sua senha')).toBeTruthy();
    // O conteúdo exato e o botão de assinar moram em `/atendimento`.
    const link = document.querySelector('a[href="/atendimento"]');
    expect(link).toBeTruthy();
  });

  it('a caixa não tem botão de assinar — quem age é a tela de destino', async () => {
    apiGet.mockResolvedValue(
      resposta({
        aprovacoes: {
          estado: 'ok',
          itens: [aprovacao],
          retidasPorImpedimento: 0,
          truncado: false,
          teto: 50,
        },
        total: 1,
      }),
    );
    render(<CaixaPage />);
    await waitFor(() => expect(screen.getByText(/mandar o resumo semanal/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /assinar|confirmar|aprovar/i })).toBeNull();
  });

  it('o que a porta recusaria hoje aparece como OUTRA coisa, com caminho para a fila', async () => {
    apiGet.mockResolvedValue(
      resposta({
        aprovacoes: { estado: 'ok', itens: [], retidasPorImpedimento: 2, truncado: false, teto: 50 },
      }),
    );
    render(<CaixaPage />);
    await waitFor(() => expect(screen.getByText(/esperam por um conserto/)).toBeTruthy());
  });
});

describe('A7: as tarefas paradas, com o critério à mostra', () => {
  it('o motivo da parada aparece na linha', async () => {
    apiGet.mockResolvedValue(
      resposta({
        tarefas: {
          estado: 'ok',
          itens: [tarefaParada],
          truncado: false,
          teto: 50,
          identidades: ['Pedro Magnago'],
          diasSemMovimento: 7,
          horasPresa: 24,
        },
        total: 1,
      }),
    );
    render(<CaixaPage />);
    await waitFor(() => expect(screen.getByText(/Fechar o relatório/)).toBeTruthy());
    expect(screen.getByText('o prazo venceu')).toBeTruthy();
  });

  it('a tela publica por quais nomes procurou você — casamento por nome erra', async () => {
    apiGet.mockResolvedValue(
      resposta({
        tarefas: {
          estado: 'ok',
          itens: [tarefaParada],
          truncado: false,
          teto: 50,
          identidades: ['Pedro Magnago', 'pedro@root.com'],
          diasSemMovimento: 7,
          horasPresa: 24,
        },
        total: 1,
      }),
    );
    render(<CaixaPage />);
    await waitFor(() =>
      expect(screen.getByText(/Pedro Magnago, pedro@root\.com/)).toBeTruthy(),
    );
    expect(screen.getByText(/Se o seu nome no quadro é outro/)).toBeTruthy();
  });

  it('agente de fora da casa aparece como "outro agente", não com o nome do vizinho', async () => {
    apiGet.mockResolvedValue(
      resposta({
        tarefas: {
          estado: 'ok',
          itens: [
            {
              ...tarefaParada,
              agenteSlug: null,
              agenteNome: null,
              agenteDesde: new Date(AGORA.getTime() - 2 * 86_400_000).toISOString(),
              motivos: ['presa_com_agente' as const],
            },
          ],
          truncado: false,
          teto: 50,
          identidades: ['Pedro Magnago'],
          diasSemMovimento: 7,
          horasPresa: 24,
        },
        total: 1,
      }),
    );
    render(<CaixaPage />);
    await waitFor(() => expect(screen.getByText(/com outro agente desde/)).toBeTruthy());
    expect(screen.getByText(/travada com um agente há mais de 24h/)).toBeTruthy();
  });

  it('módulo Trabalho desligado é explicado, não escondido', async () => {
    apiGet.mockResolvedValue(
      resposta({
        tarefas: {
          estado: 'modulo_desligado',
          itens: [],
          truncado: false,
          teto: 50,
          identidades: [],
          diasSemMovimento: 7,
          horasPresa: 24,
        },
      }),
    );
    render(<CaixaPage />);
    await waitFor(() =>
      expect(screen.getAllByText(/módulo Trabalho não está contratado/).length).toBeGreaterThan(0),
    );
  });
});

describe('A7: conversa no quadro NÃO é menção, e a tela assume isso', () => {
  it('a tela diz que menção não existe e por que a conversa fica fora do contador', async () => {
    apiGet.mockResolvedValue(resposta());
    render(<CaixaPage />);
    await waitFor(() =>
      expect(screen.getByText(/este produto não registra menção em comentário/)).toBeTruthy(),
    );
    expect(screen.getByText(/não entra no contador/)).toBeTruthy();
  });

  it('o comentário aparece como trecho, dizendo que é trecho', async () => {
    apiGet.mockResolvedValue(
      resposta({
        conversa: {
          estado: 'ok',
          itens: [
            {
              id: 'c-1',
              tarefaId: 't-1',
              tarefaTitulo: 'Fechar o relatório do cliente',
              autor: 'Lucas',
              trecho: 'isso aqui trava a entrega…',
              trechoCortado: true,
              criadaEm: new Date(AGORA.getTime() - 3_600_000).toISOString(),
            },
          ],
          truncado: false,
          dias: 7,
          teto: 20,
        },
      }),
    );
    render(<CaixaPage />);
    await waitFor(() => expect(screen.getByText(/isso aqui trava a entrega/)).toBeTruthy());
    expect(screen.getByText(/o resto está no quadro/)).toBeTruthy();
    // A conversa não muda o total: a tela continua dizendo que nada espera ação.
    expect(screen.getByText(/Nada esperando por você/)).toBeTruthy();
  });
});

describe('A7: eixo sem permissão não mata a tela', () => {
  it('sem acesso à fila, o quadro continua respondendo', async () => {
    apiGet.mockResolvedValue(
      resposta({
        aprovacoes: {
          estado: 'sem_permissao',
          itens: [],
          retidasPorImpedimento: 0,
          truncado: false,
          teto: 50,
        },
        tarefas: {
          estado: 'ok',
          itens: [tarefaParada],
          truncado: false,
          teto: 50,
          identidades: ['Pedro Magnago'],
          diasSemMovimento: 7,
          horasPresa: 24,
        },
        total: 1,
      }),
    );
    render(<CaixaPage />);
    await waitFor(() =>
      expect(screen.getByText(/não acompanha a fila de aprovação/)).toBeTruthy(),
    );
    expect(screen.getByText(/Fechar o relatório/)).toBeTruthy();
    expect(screen.getByText(/é decisão de papel/)).toBeTruthy();
  });

  it('sessão que não é de usuário ativo desta empresa é avisada a entrar de novo', async () => {
    apiGet.mockResolvedValue(
      resposta({
        eu: { id: 'u-eu', nome: null, alcada: 'nenhuma', decide: false, decideNestaSessao: false, ativo: false },
        aprovacoes: { estado: 'fora_da_casa', itens: [], retidasPorImpedimento: 0, truncado: false, teto: 50 },
      }),
    );
    render(<CaixaPage />);
    await waitFor(() =>
      expect(screen.getAllByText(/Saia e entre de novo/).length).toBeGreaterThan(0),
    );
  });
});

describe('A7: o total é PISO quando um eixo bate no teto', () => {
  it('a tela escreve "N+" e diz que o número é piso', async () => {
    apiGet.mockResolvedValue(
      resposta({
        aprovacoes: {
          estado: 'ok',
          itens: [aprovacao],
          retidasPorImpedimento: 0,
          truncado: true,
          teto: 50,
        },
        total: 50,
        totalParcial: true,
      }),
    );
    render(<CaixaPage />);
    await waitFor(() => expect(screen.getByText('50+')).toBeTruthy());
    expect(screen.getByText(/é um PISO/)).toBeTruthy();
  });
});
