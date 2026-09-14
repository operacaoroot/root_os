import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LinhaDoTempoItem, LinhaDoTempoResposta } from '@mktos/shared';

/*
 * ==========================================================================
 * A TELA DA LINHA DO TEMPO — fatia A9
 * ==========================================================================
 *
 * O que esta suíte cobra, e por que cada caso existe:
 *
 *  1. O EVENTO QUE A TELA NÃO SABE NOMEAR APARECE, marcado. Sumir com ele
 *     deixaria a tela parecendo completa quando não está — e "não sei ler este
 *     evento" é informação sobre o sistema, não defeito a esconder;
 *  2. A TELA DIZ O QUE NÃO MOSTRA. Evento com conteúdo ganha o caminho para a
 *     fila de aprovação, que é onde o conteúdo exato se lê, com permissão
 *     própria. É a lição da tela do Google, que anunciava "✅ enviado" em cima
 *     de um 200 de retenção;
 *  3. O HORIZONTE É DITO. A linha não começa na fundação do mundo: começa onde a
 *     retenção desta empresa manda;
 *  4. "CARREGAR MAIS" MANDA O CURSOR, e ACUMULA. Sem cursor na query, a segunda
 *     página seria a primeira outra vez;
 *  5. TROCAR FILTRO NÃO ACUMULA com o recorte anterior — misturar dois recortes
 *     na mesma lista é a tela mentindo sobre o que foi pedido;
 *  6. CONTAGEM PARCIAL É DITA PARCIAL. Número parcial declarado é honesto;
 *     varredura completa escondida é a conta que só aparece no cliente grande.
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
    user: { id: 'u-eu', name: 'Pedro', email: 'p@x.com', roles: [], permissions: ['auditoria.ver'] },
    can: (p: string) => p === 'auditoria.ver',
  }),
}));

// eslint-disable-next-line import/first
import LinhaDoTempoPage from '@/app/linha-do-tempo/page';

/* --------------------------------------------------------------- fixtures -- */

function item(over: Partial<LinhaDoTempoItem> = {}): LinhaDoTempoItem {
  return {
    id: 'e1',
    seq: '42',
    tipo: 'tool.resultado',
    rotulo: 'Ferramenta executada',
    familia: 'ferramenta',
    conhecido: true,
    // Relógio da máquina, não data fixa: a suíte de Conexões desta árvore está
    // vermelha justamente por um fixture com data que envelheceu.
    ocorreuEm: new Date().toISOString(),
    atorTipo: 'ai',
    atorId: null,
    ator: null,
    agenteSlug: 'assistente',
    agenteNome: 'Assistente da central',
    capacidade: 'numeros.painel.ler',
    nivel: 'R0',
    correlacao: null,
    objeto: [{ chave: 'capacidade', valor: 'numeros.painel.ler' }],
    sensibilidade: null,
    registroCompleto: true,
    temConteudo: false,
    ...over,
  };
}

function resposta(over: Partial<LinhaDoTempoResposta> = {}): LinhaDoTempoResposta {
  return {
    itens: [item()],
    proximoCursor: null,
    filtros: {
      agentes: [{ slug: 'assistente', nome: 'Assistente da central', eventos: 12 }],
      familias: [{ chave: 'ferramenta', rotulo: 'Ferramentas', eventos: 12 }],
      tipos: [{ tipo: 'tool.resultado', rotulo: 'Ferramenta executada', conhecido: true, eventos: 12 }],
      desconhecidos: 0,
      janela: 12,
      parcial: false,
    },
    retencaoDias: 365,
    source: { tool: 'rastro', generatedAt: new Date().toISOString() },
    ...over,
  };
}

beforeEach(() => {
  apiGet.mockReset();
});

/* ========================================================================== */

describe('A9: o evento que a tela não sabe nomear aparece, marcado', () => {
  it('mostra o tipo cru e o selo — nunca esconde a linha', async () => {
    apiGet.mockResolvedValue(
      resposta({
        itens: [item({ tipo: 'tipo.novo.de.amanha', rotulo: 'tipo.novo.de.amanha', conhecido: false })],
      }),
    );
    render(<LinhaDoTempoPage />);
    expect(await screen.findByText('tipo.novo.de.amanha')).toBeTruthy();
    expect(screen.getByText(/não sei ler este evento/)).toBeTruthy();
  });

  it('evento conhecido NÃO ganha o selo', async () => {
    apiGet.mockResolvedValue(resposta());
    render(<LinhaDoTempoPage />);
    expect(await screen.findByText('Ferramenta executada')).toBeTruthy();
    expect(screen.queryByText(/não sei ler este evento/)).toBeNull();
  });
});

describe('A9: a tela diz o que ela NÃO mostra', () => {
  it('evento com conteúdo aponta para a fila de aprovação', async () => {
    apiGet.mockResolvedValue(resposta({ itens: [item({ temConteudo: true })] }));
    render(<LinhaDoTempoPage />);
    const aviso = await screen.findByText('tem conteúdo');
    expect(aviso.getAttribute('href')).toBe('/atendimento');
  });

  it('evento sem conteúdo não promete nada', async () => {
    apiGet.mockResolvedValue(resposta());
    render(<LinhaDoTempoPage />);
    await screen.findByText('Ferramenta executada');
    expect(screen.queryByText('tem conteúdo')).toBeNull();
  });

  it('registro incompleto é dito — o fato aconteceu, o registro dele é que falhou', async () => {
    apiGet.mockResolvedValue(resposta({ itens: [item({ registroCompleto: false })] }));
    render(<LinhaDoTempoPage />);
    expect(await screen.findByText(/registro incompleto/)).toBeTruthy();
  });

  it('o horizonte da retenção está na tela', async () => {
    apiGet.mockResolvedValue(resposta({ retencaoDias: 90 }));
    render(<LinhaDoTempoPage />);
    expect(await screen.findByText(/90 dia\(s\)/)).toBeTruthy();
    expect(screen.getByText(/expurgado e não está aqui/)).toBeTruthy();
  });

  it('contagem parcial dos filtros é DITA parcial', async () => {
    apiGet.mockResolvedValue(
      resposta({
        filtros: { ...resposta().filtros!, janela: 5000, parcial: true, desconhecidos: 3 },
      }),
    );
    render(<LinhaDoTempoPage />);
    expect(await screen.findByText(/são PARCIAIS/)).toBeTruthy();
    expect(screen.getByText(/3 tipo\(s\) de evento sem nome/)).toBeTruthy();
  });
});

describe('A9: o ator é legível, e o de fora da empresa é declarado', () => {
  it('pessoa de fora aparece como de fora — nunca com nome inventado', async () => {
    apiGet.mockResolvedValue(
      resposta({
        itens: [item({ atorTipo: 'user', atorId: 'u-de-fora', ator: null, agenteSlug: null, agenteNome: null })],
      }),
    );
    render(<LinhaDoTempoPage />);
    expect(await screen.findByText('alguém de fora desta empresa')).toBeTruthy();
  });

  it('agente sem nome resolvido aparece pelo slug, e o filtro diz que ele é de fora', async () => {
    apiGet.mockResolvedValue(
      resposta({
        itens: [item({ agenteNome: null })],
        filtros: { ...resposta().filtros!, agentes: [{ slug: 'sumido', nome: null, eventos: 2 }] },
      }),
    );
    render(<LinhaDoTempoPage />);
    expect(await screen.findByText('agente assistente')).toBeTruthy();
    expect(screen.getByText(/sumido \(fora da casa\)/)).toBeTruthy();
  });
});

describe('A9: pagina por cursor e filtra sem misturar recortes', () => {
  it('"carregar mais" manda o cursor e ACUMULA', async () => {
    apiGet
      .mockResolvedValueOnce(
        resposta({ itens: [item({ id: 'a', rotulo: 'Primeiro' })], proximoCursor: 'CURSOR-1' }),
      )
      .mockResolvedValueOnce(
        resposta({ itens: [item({ id: 'b', rotulo: 'Segundo' })], proximoCursor: null, filtros: null }),
      );

    render(<LinhaDoTempoPage />);
    await screen.findByText('Primeiro');
    await userEvent.click(screen.getByRole('button', { name: /carregar mais/ }));

    await waitFor(() => expect(screen.getByText('Segundo')).toBeTruthy());
    // ACUMULA: a página anterior não é descartada.
    expect(screen.getByText('Primeiro')).toBeTruthy();
    expect(String(apiGet.mock.calls[1][0])).toContain('cursor=CURSOR-1');
    // E o menu de filtros não esvazia: `filtros` vem nulo na segunda página.
    expect(screen.getByLabelText('Agente')).toBeTruthy();
  });

  it('sem próximo cursor, o botão dá lugar ao fim da linha', async () => {
    apiGet.mockResolvedValue(resposta());
    render(<LinhaDoTempoPage />);
    await screen.findByText('Ferramenta executada');
    expect(screen.queryByRole('button', { name: /carregar mais/ })).toBeNull();
    expect(screen.getByText(/fim da linha/)).toBeTruthy();
  });

  it('trocar o filtro recomeça a lista, sem cursor e sem mistura', async () => {
    apiGet
      .mockResolvedValueOnce(
        resposta({ itens: [item({ id: 'a', rotulo: 'Antes do filtro' })], proximoCursor: 'C1' }),
      )
      .mockResolvedValueOnce(
        resposta({ itens: [item({ id: 'b', rotulo: 'Depois do filtro' })], proximoCursor: null }),
      );

    render(<LinhaDoTempoPage />);
    await screen.findByText('Antes do filtro');
    await userEvent.selectOptions(screen.getByLabelText('Família de evento'), 'ferramenta');

    await waitFor(() => expect(screen.getByText('Depois do filtro')).toBeTruthy());
    expect(screen.queryByText('Antes do filtro')).toBeNull();
    const segunda = String(apiGet.mock.calls[1][0]);
    expect(segunda).toContain('familia=ferramenta');
    expect(segunda).not.toContain('cursor=');
  });

  it('lista vazia com filtro explica que o recorte é exato', async () => {
    apiGet.mockResolvedValue(resposta({ itens: [] }));
    render(<LinhaDoTempoPage />);
    await waitFor(() => expect(screen.getByText(/A linha começa na primeira ação/)).toBeTruthy());

    await userEvent.selectOptions(screen.getByLabelText('Família de evento'), 'ferramenta');
    await waitFor(() => expect(screen.getByText(/O filtro é exato/)).toBeTruthy());
  });

  it('a recusa da API aparece na tela, em vez de lista silenciosamente vazia', async () => {
    apiGet.mockRejectedValue(new Error('cursor inválido — use o `proximoCursor`…'));
    render(<LinhaDoTempoPage />);
    expect(await screen.findByText(/cursor inválido/)).toBeTruthy();
  });
});
