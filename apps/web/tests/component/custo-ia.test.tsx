import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

/*
 * A TELA DE CUSTO DE IA E A PÍLULA DO CONSOLE — fatia 6.4, RF-B-03.
 *
 * POR QUE ESTA SUÍTE EXISTE. `page.tsx` dizia, em comentário, que a tela "é
 * obrigada" a mostrar três coisas. Comentário não obriga ninguém: o revisor
 * apagou a seção inteira do que o painel não mede e a suíte ficou verde, porque
 * nenhum teste importava a página. Tudo o que está aqui é o que quebra quando a
 * afirmação sai do JSX.
 *
 * O que cada caso cobra, e o que ele deixa vermelho se a defesa sair:
 *
 *  1. O RODAPÉ "o que este painel não mede" está na tela — com o nome do item, a
 *     ordem de grandeza e a procedência. É a única coisa que impede o operador
 *     de ler o total como se fosse o total.
 *  2. A PÍLULA também diz que não mede tudo. Ela é o que todo mundo vê; a tela
 *     de detalhe é o que quase ninguém abre.
 *  3. SEM LIVRO-CAIXA, A TELA RECUSA O TOTAL. Nada de "US$ 0,00 · conferido com
 *     o banco" com centenas de dólares na tabela logo abaixo.
 *  4. A LINHA DO RESÍDUO se chama "não atribuído a agente" — nunca mais "sem
 *     agente · chamada simples: relatório, curadoria, pauta, ficha", que era
 *     factualmente falso.
 *  5. O RODAPÉ DA TABELA POR AGENTE inclui o estimado. Sem ele, o "total" era
 *     um quarto do gasto.
 *  6. JANELA INTEIRA SEM PREÇO imprime travessão no cartão grande, não zero.
 */

const apiGet = vi.fn();

vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...real, apiGet: (...a: unknown[]) => apiGet(...a) };
});

let PERMISSOES: string[] = ['dashboard.ver'];

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    token: 'tok',
    ready: true,
    user: { id: 'u1', name: 'Pedro', email: 'p@x.com', roles: [], permissions: PERMISSOES },
    can: (p: string) => PERMISSOES.includes(p),
  }),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, title }: { href: string; children: React.ReactNode; title?: string }) => (
    <a href={href} title={title}>
      {children}
    </a>
  ),
}));

// eslint-disable-next-line import/first
import CustoDeIaPage from '@/app/painel/custo-ia/page';
// eslint-disable-next-line import/first
import { PilulaCustoIa } from '@/app/painel/custo-ia/Pilula';
// eslint-disable-next-line import/first
import type { RelatorioDeCustoIa } from '@/app/painel/custo-ia/calculo';

/* ----------------------------------------------------------- os relatórios -- */

const NAO_COBERTO = [
  {
    oQue: 'Vetorização (embeddings)',
    onde: 'obsidian e pauta chamam /embeddings por fetch próprio, fora do LlmProvider',
    ordemDeGrandeza: 'não medido',
    procedencia: 'a existência está na catraca de arquitetura; a grandeza não tem medição aqui',
  },
];

function relatorio(p: Partial<RelatorioDeCustoIa> = {}): RelatorioDeCustoIa {
  const porDia = p.porDia ?? [];
  const soma = (f: 'medidoUsd' | 'estimadoUsd') =>
    Number(porDia.reduce((t, d) => t + d[f], 0).toFixed(6));
  const base: RelatorioDeCustoIa = {
    orgId: 'org-1',
    fusoHorario: 'America/Sao_Paulo',
    de: '2026-09-01',
    ate: '2026-09-03',
    dias: 3,
    teto: {
      configurado: true,
      ativo: true,
      tetoDiarioUsd: 25,
      percentualAlerta: 80,
      definidoEm: null,
      motivo: null,
    },
    hoje: {
      dia: '2026-09-03',
      fusoHorario: 'America/Sao_Paulo',
      ativo: true,
      tetoUsd: 25,
      gastoUsd: 2,
      gastoEstimadoUsd: 1,
      reservadoUsd: 0,
      arrastoUsd: 0,
      comprometidoUsd: 3,
      restanteUsd: 22,
      chamadas: 5,
      chamadasSemPreco: 0,
      cortes: 0,
    },
    porDia,
    porAgente: [],
    porAgenteEDia: [],
    livroCaixa: {
      linhas: porDia.length,
      tetoConfigurado: true,
      passosComCusto: 0,
      gastoDosPassosUsd: 0,
      totalConfiavel: true,
      motivo: null,
    },
    conferencia: {
      medidoUsd: soma('medidoUsd'),
      estimadoUsd: soma('estimadoUsd'),
      chamadas: porDia.reduce((t, d) => t + d.chamadas, 0),
      linhas: porDia.length,
    },
    atribuidoAAgenteUsd: 0,
    naoCoberto: NAO_COBERTO,
    geradoEm: '2026-09-03T18:00:00.000Z',
  };
  return {
    ...base,
    ...p,
    porDia,
    livroCaixa: p.livroCaixa ?? base.livroCaixa,
    conferencia: p.conferencia ?? base.conferencia,
  };
}

const dia = (over: Partial<RelatorioDeCustoIa['porDia'][number]> & { dia: string }) => ({
  medidoUsd: 0,
  estimadoUsd: 0,
  reservadoUsd: 0,
  chamadas: 0,
  chamadasSemPreco: 0,
  cortes: 0,
  ...over,
});

beforeEach(() => {
  apiGet.mockReset();
  PERMISSOES = ['dashboard.ver'];
});

/* ------------------------------------------------------------------ casos -- */

describe('a tela diz o que ela NÃO mede', () => {
  it('CONTROLE NEGATIVO: o rodapé do não-coberto está na tela, com procedência', async () => {
    apiGet.mockResolvedValue(
      relatorio({ porDia: [dia({ dia: '2026-09-01', medidoUsd: 3, chamadas: 4 })] }),
    );
    render(<CustoDeIaPage />);

    // Apagar a seção `naoCoberto` de page.tsx derruba as três afirmações.
    expect(await screen.findByText('O que este painel não mede')).toBeInTheDocument();
    expect(screen.getByText('Vetorização (embeddings)')).toBeInTheDocument();
    expect(screen.getByText('não medido')).toBeInTheDocument();
    expect(screen.getByText(/Procedência:/)).toBeInTheDocument();
  });

  it('CONTROLE NEGATIVO: a pílula do Console também avisa que não mede tudo', async () => {
    apiGet.mockResolvedValue(relatorio());
    render(<PilulaCustoIa />);

    expect(await screen.findByText(/não mede:/)).toHaveTextContent(
      'não mede: Vetorização (embeddings)',
    );
  });

  it('a pílula pede um dia só — 30 dias no topo do Console seria varredura de sobra', async () => {
    apiGet.mockResolvedValue(relatorio());
    render(<PilulaCustoIa />);
    await screen.findByText(/não mede:/);
    expect(apiGet).toHaveBeenCalledWith('/dashboard/custo-ia?dias=1', 'tok');
  });

  it('a pílula não inventa zero quando a API falha', async () => {
    apiGet.mockRejectedValue(new Error('kaput'));
    render(<PilulaCustoIa />);
    expect(await screen.findByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/US\$\s*0,00/)).not.toBeInTheDocument();
  });
});

describe('sem livro-caixa, a tela recusa o total', () => {
  const semLivro = () =>
    relatorio({
      porDia: [],
      teto: {
        configurado: false,
        ativo: false,
        tetoDiarioUsd: null,
        percentualAlerta: 80,
        definidoEm: null,
        motivo: null,
      },
      hoje: null,
      porAgente: [
        {
          slug: 'analista',
          nome: 'Analista',
          iniciais: 'AN',
          medidoUsd: 812.34,
          passos: 412,
          passosNaoMedidos: 0,
          sessoes: 40,
          ultimoEm: '2026-09-03T12:00:00.000Z',
        },
      ],
      atribuidoAAgenteUsd: 812.34,
      livroCaixa: {
        linhas: 0,
        tetoConfigurado: false,
        passosComCusto: 412,
        gastoDosPassosUsd: 812.34,
        totalConfiavel: false,
        motivo:
          'A empresa NÃO tem teto configurado, e o livro-caixa só é escrito para quem tem.',
      },
    });

  /*
   * O CASO QUE REPROVOU A FATIA. Antes, esta tela imprimia "Custo medido
   * US$ 0,00 · conferido com o banco" com US$ 812,34 na tabela logo abaixo.
   */
  it('CONTROLE NEGATIVO: nenhum cartão de total, e a recusa no lugar dele', async () => {
    apiGet.mockResolvedValue(semLivro());
    render(<CustoDeIaPage />);

    expect(await screen.findByText('Sem total a mostrar')).toBeInTheDocument();
    expect(screen.getByText(/livro-caixa só é escrito para quem tem/)).toBeInTheDocument();
    // o cartão que mentia não está mais na tela
    expect(screen.queryByText('Custo medido')).not.toBeInTheDocument();
    expect(screen.queryByText(/conferido com o banco/)).not.toBeInTheDocument();
  });

  it('o que ainda vale — os passos — aparece com o número e a contagem', async () => {
    apiGet.mockResolvedValue(semLivro());
    render(<CustoDeIaPage />);
    const recusa = (await screen.findByText('Sem total a mostrar')).closest('div')!;
    expect(recusa).toHaveTextContent('412 passo(s) de modelo com custo medido');
  });

  it('a pílula diz que sem teto nada é escrito no livro-caixa', async () => {
    apiGet.mockResolvedValue(semLivro());
    render(<PilulaCustoIa />);
    expect(await screen.findByText(/sem teto definido/)).toHaveTextContent(
      'nada é escrito no livro-caixa',
    );
  });
});

describe('a tabela por agente', () => {
  const comAgentes = () =>
    relatorio({
      porDia: [dia({ dia: '2026-09-01', medidoUsd: 10, estimadoUsd: 34, chamadas: 20 })],
      porAgente: [
        {
          slug: 'analista',
          nome: 'Analista',
          iniciais: 'AN',
          medidoUsd: 10,
          passos: 12,
          passosNaoMedidos: 0,
          sessoes: 3,
          ultimoEm: '2026-09-01T12:00:00.000Z',
        },
      ],
      atribuidoAAgenteUsd: 10,
    });

  /*
   * CONTROLE NEGATIVO do rótulo. A linha dizia "Sem agente · chamada simples:
   * relatório, curadoria, pauta, ficha" — e `complete()` grava ZERO no medido,
   * então aquele dinheiro NUNCA poderia cair ali. O rótulo mandava o operador
   * procurar a causa no lugar errado.
   */
  it('CONTROLE NEGATIVO: a linha do resíduo se chama "não atribuído", não "sem agente"', async () => {
    apiGet.mockResolvedValue(comAgentes());
    render(<CustoDeIaPage />);

    expect(await screen.findByText(/Não atribuído a agente/)).toBeInTheDocument();
    expect(screen.queryByText(/^Sem agente/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/chamada simples: relatório, curadoria, pauta, ficha/),
    ).not.toBeInTheDocument();
  });

  /*
   * CONTROLE NEGATIVO do rodapé. Gasto do período: 10 medido + 34 estimado = 44.
   * Um rodapé só com a coluna medida mostraria 22,7% do gasto e chamaria de
   * total.
   */
  it('CONTROLE NEGATIVO: o rodapé mostra o estimado, e não chama o medido de total', async () => {
    apiGet.mockResolvedValue(comAgentes());
    render(<CustoDeIaPage />);

    const rodape = (await screen.findByText(/Gasto no período/)).closest('tr')!;
    expect(within(rodape).getByText(/34,00/)).toBeInTheDocument();
    expect(within(rodape).getByText(/44,00/)).toBeInTheDocument();
    // e o rodapé não se chama mais "total medido"
    expect(screen.queryByText(/Total medido no período/)).not.toBeInTheDocument();
  });

  it('o excedente diagnostica a causa em vez de afirmar sempre a virada do dia', async () => {
    apiGet.mockResolvedValue({ ...comAgentes(), atribuidoAAgenteUsd: 90 });
    render(<CustoDeIaPage />);
    expect(await screen.findByText(/Isso NÃO cabe no caso de borda/)).toBeInTheDocument();
  });
});

describe('a janela inteiramente sem preço', () => {
  /*
   * CONTROLE NEGATIVO do agregado. A regra "não medido nunca vira zero" valia
   * linha a linha e era abandonada no cartão grande.
   */
  it('CONTROLE NEGATIVO: o cartão grande imprime travessão, não US$ 0,00', async () => {
    apiGet.mockResolvedValue(
      relatorio({
        porDia: [
          dia({ dia: '2026-09-01', chamadas: 10, chamadasSemPreco: 10 }),
          dia({ dia: '2026-09-02', chamadas: 7, chamadasSemPreco: 7 }),
        ],
      }),
    );
    render(<CustoDeIaPage />);

    // `closest('div')` devolveria o próprio rótulo (que já é um div); o cartão
    // é o pai dele.
    const cartao = (await screen.findByText('Custo medido')).parentElement!;
    expect(within(cartao).getByText('—')).toBeInTheDocument();
    expect(within(cartao).queryByText(/US\$\s*0,00/)).not.toBeInTheDocument();
    expect(cartao).toHaveTextContent('nenhuma das 17 chamadas tinha preço na tabela');
  });

  /*
   * A MESMA REGRA NA PÍLULA, e só na parcela certa. O número grande continua
   * sendo o comprometido em dinheiro — é ele que a porta compara, e travessão
   * ali desfaria o que a revisão aprovou. Quem vira travessão é "medido", que é
   * a única parcela da pílula que AFIRMA uma medição.
   */
  it('CONTROLE NEGATIVO: na pílula, "medido" vira travessão e o comprometido não', async () => {
    const r = relatorio();
    r.hoje = { ...r.hoje!, gastoUsd: 0, chamadas: 6, chamadasSemPreco: 6, comprometidoUsd: 3 };
    apiGet.mockResolvedValue(r);
    render(<PilulaCustoIa />);

    const parcelas = await screen.findByText(/^medido/);
    expect(parcelas).toHaveTextContent('medido —');
    expect(parcelas).toHaveTextContent('6 não medidas');
    // o número que a porta compara continua sendo número
    expect(screen.getByText(/US\$\s*3,00/)).toBeInTheDocument();
  });
});

describe('a conferência', () => {
  it('mostra O QUE divergiu, e não só que divergiu', async () => {
    apiGet.mockResolvedValue(
      relatorio({
        porDia: [dia({ dia: '2026-09-01', medidoUsd: 1, chamadas: 3 })],
        conferencia: { medidoUsd: 1, estimadoUsd: 0, chamadas: 900_000, linhas: 1 },
      }),
    );
    render(<CustoDeIaPage />);

    await waitFor(() =>
      expect(screen.getByText(/não bate com o que o banco somou/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/chamadas: a tela soma 3 e o banco contou 900000/)).toBeInTheDocument();
  });
});

describe('a permissão', () => {
  it('perfil sem dashboard.ver não vê número nenhum', () => {
    PERMISSOES = [];
    apiGet.mockResolvedValue(relatorio());
    render(<CustoDeIaPage />);
    expect(screen.getByText(/não tem a permissão/)).toBeInTheDocument();
    expect(screen.queryByText('O que este painel não mede')).not.toBeInTheDocument();
  });
});
