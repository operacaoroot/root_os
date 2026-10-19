/*
 * O BLOCO "LEITURA E REAÇÃO" DO RELATÓRIO (rodada da implantação I5).
 *
 * Os tiles e a tabela mostram só o que a API contou; a situação vira chip com
 * a frase; o N provisório aparece escrito; a ideia vira tarefa pelo POST e o
 * cartão passa a levar à tarefa; o texto do cliente é texto, nunca HTML.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelatorioDeLeitura } from '@mktos/shared';

let RESPOSTAS: Record<string, unknown> = {};
const posts: { caminho: string; corpo: unknown }[] = [];

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'u' }, can: () => true }) }));
vi.mock('next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/comercial/relatorio', useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => <a href={href} {...resto}>{children}</a>,
}));
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return {
    ...real,
    apiGet: vi.fn(async (caminho: string) => {
      const chave = Object.keys(RESPOSTAS).find((k) => caminho.startsWith(k));
      return chave ? RESPOSTAS[chave] : undefined;
    }),
    apiPost: vi.fn(async (caminho: string, corpo: unknown) => {
      posts.push({ caminho, corpo });
      return { tarefaId: 'tarefa-1', listId: 'lista-1', criada: true };
    }),
  };
});

import { LeituraEReacao } from '@/app/comercial/relatorio/LeituraEReacao';

const RELATORIO: RelatorioDeLeitura = {
  periodoDias: 30,
  geradoEm: '2026-10-18T22:00:00.000Z',
  tiles: { propostasVivas: 4, acessosAPropostas: 11, visitasAsSalas: 17, ideiasRecebidas: 2 },
  leitura: [
    {
      leadId: 'l1', nome: 'Construtora Alicerce', enviadaEm: '2026-10-12T21:00:00.000Z', versao: 1, acessos: 3, ultimoAcessoEm: '2026-10-17T12:00:00.000Z',
      secaoMaisLida: { secao: 'investimento', rotulo: 'INVESTIMENTO', segundos: 140 }, ideias: 1,
      situacao: { tipo: 'leu_sem_responder', acessos: 3, fupPreparado: true }, frase: 'leu 3× sem responder · FUP 1 preparado',
    },
    {
      leadId: 'l2', nome: 'Studio Lume', enviadaEm: '2026-10-15T21:00:00.000Z', versao: 2, acessos: 0, ultimoAcessoEm: null,
      secaoMaisLida: null, ideias: 0, situacao: { tipo: 'nao_abriu' }, frase: 'não abriu · reenviar?',
    },
  ],
  ideias: [
    { id: 'r1', leadId: 'l1', nome: 'Construtora Alicerce', secao: 'funciona', rotuloDaSecao: 'COMO FUNCIONA', tipo: 'ideia', texto: '<b>dá</b> para integrar com o banco Inter?', em: '2026-10-17T12:10:00.000Z', respondidaEm: null, tarefaId: null },
  ],
  n: { valor: 3, provisorio: true },
};

beforeEach(() => {
  RESPOSTAS = { '/comercial/relatorio/leitura': RELATORIO };
  posts.length = 0;
});

describe('relatório · leitura e reação', () => {
  it('tiles, tabela com a situação em chip e o N provisório escrito', async () => {
    render(<LeituraEReacao dias={30} />);
    const tiles = await screen.findByTestId('leitura-tiles');
    expect(tiles.textContent).toContain('4propostas vivas');
    expect(tiles.textContent).toContain('11acessos a propostas em 30 dias');
    expect(tiles.textContent).toContain('17visitas às salas em 30 dias');
    expect(tiles.textContent).toContain('2ideias recebidas');
    const linha = screen.getByTestId('leitura-linha-l1');
    expect(within(linha).getByText('leu 3× sem responder · FUP 1 preparado').className).toContain('text-bad');
    expect(linha.textContent).toContain('investimento · 2 min');
    expect(within(screen.getByTestId('leitura-linha-l2')).getByText('não abriu · reenviar?')).toBeTruthy();
    expect(screen.getByTestId('leitura-n').textContent).toContain('número provisório, [a decidir] pela mesa');
  });

  it('a ideia aparece como texto e vira tarefa pelo POST; o cartão passa a levar à tarefa', async () => {
    render(<LeituraEReacao dias={30} />);
    const cartao = await screen.findByTestId('ideia-r1');
    expect(cartao.textContent).toContain('“<b>dá</b> para integrar com o banco Inter?”');
    expect(cartao.querySelector('b')).toBeNull();
    expect(within(cartao).getByTestId('ideia-responder-r1').getAttribute('href')).toContain('l1');
    await userEvent.click(within(cartao).getByTestId('ideia-virar-tarefa-r1'));
    await waitFor(() => expect(posts.map((p) => p.caminho)).toEqual(['/comercial/reacoes/r1/tarefa']));
    expect((await screen.findByTestId('ideia-tarefa-r1')).getAttribute('href')).toBe('/trabalho?lista=lista-1&tarefa=tarefa-1');
  });
});
