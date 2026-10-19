/*
 * A ABA SALA DA BANCADA (rodada da implantação I3).
 *
 * Mostra o que está no ar e o rascunho; acrescentar um passo e gravar manda o
 * PUT com o quê, quando e com quem; publicar manda o POST e diz que a
 * liberação é de outra pessoa; o que vem do fio aparece como "não se digita".
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VersoesDaSala } from '@mktos/shared';

const chamadas: { metodo: string; caminho: string; corpo?: unknown }[] = [];
let VERSOES: VersoesDaSala;

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'u' }, can: () => true }) }));
vi.mock('next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/comercial', useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return {
    ...real,
    apiGet: vi.fn(async () => VERSOES),
    apiPut: vi.fn(async (caminho: string, corpo: unknown) => {
      chamadas.push({ metodo: 'PUT', caminho, corpo });
      return VERSOES;
    }),
    apiPost: vi.fn(async (caminho: string, corpo: unknown) => {
      chamadas.push({ metodo: 'POST', caminho, corpo });
      return { ...VERSOES, estado: 'na_porta', approvalId: 'ap-1' };
    }),
  };
});

import { AbaSala } from '@/app/comercial/_painel/AbaSala';

const CONTEUDO = {
  nome: 'Sala · Construtora Alicerce',
  estacoes: [
    { chave: 'conversa', rotulo: 'Conversa', estado: 'feita', em: '2026-10-10T14:00:00.000Z' },
    { chave: 'acordo', rotulo: 'Acordo', estado: 'atual', em: null },
    { chave: 'kickoff', rotulo: 'Kickoff', estado: 'futura', em: null },
    { chave: 'contexto', rotulo: 'Contexto', estado: 'futura', em: null },
    { chave: 'frente', rotulo: 'Frente rodando', estado: 'futura', em: null },
  ],
  proximosPassos: [],
  publicados: [{ tipo: 'kit', titulo: 'Kit de implantação', estado: 'chega após o kickoff', disponivel: false }],
  combinado: ['Resposta em até 4 horas úteis'],
  quemCuida: { nome: 'Lucas', papel: 'sócio' },
  whatsapp: { numero: null, rotulo: '[NÚMERO DA ROOT]' },
} as VersoesDaSala['rascunho']['conteudo'];

beforeEach(() => {
  chamadas.length = 0;
  VERSOES = {
    leadId: 'l1',
    rascunho: { versao: 1, estado: 'novo', conteudo: CONTEUDO, hash: 'a'.repeat(64), approvalId: null, atualizadoEm: null },
    publicada: null,
    historico: [],
    temSala: true,
  };
});

describe('aba Sala', () => {
  it('sem versão no ar diz isso; o derivado do fio aparece como "não se digita"', async () => {
    render(<AbaSala leadId="l1" aoMudar={async () => undefined} />);
    expect((await screen.findByTestId('sala-no-ar')).textContent).toContain('Nenhuma versão publicada');
    expect(screen.getByText('vem do fio · não se digita')).toBeTruthy();
    expect(screen.getByText(/Conversa · /)).toBeTruthy();
    expect(screen.getByText(/\[NÚMERO DA ROOT\]/)).toBeTruthy();
  });

  it('acrescentar um passo e gravar manda o PUT com o quê, quando e com quem', async () => {
    render(<AbaSala leadId="l1" aoMudar={async () => undefined} />);
    await userEvent.click(await screen.findByTestId('sala-passo-novo'));
    await userEvent.type(screen.getByLabelText('passo 1: o quê'), 'marcar o kickoff');
    await userEvent.type(screen.getByLabelText('passo 1: quando'), '2026-10-21');
    await userEvent.type(screen.getByLabelText('passo 1: com quem'), 'Marina');
    await userEvent.click(screen.getByTestId('sala-salvar'));
    await waitFor(() => expect(chamadas.length).toBe(1));
    expect(chamadas[0]).toMatchObject({ metodo: 'PUT', caminho: '/comercial/lead/l1/sala/rascunho' });
    expect((chamadas[0].corpo as { proximosPassos: unknown[] }).proximosPassos).toEqual([{ oque: 'marcar o kickoff', quando: '2026-10-21', comQuem: 'Marina' }]);
  });

  it('publicar pede a liberação de outra pessoa', async () => {
    render(<AbaSala leadId="l1" aoMudar={async () => undefined} />);
    await userEvent.click(await screen.findByTestId('sala-publicar'));
    await waitFor(() => expect(chamadas.some((c) => c.metodo === 'POST' && c.caminho === '/comercial/lead/l1/sala/publicar')).toBe(true));
  });
});
