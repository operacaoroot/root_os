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
import type { EstadoDaSalaNoPainel, VersoesDaSala } from '@mktos/shared';

const chamadas: { metodo: string; caminho: string; corpo?: unknown }[] = [];
let VERSOES: VersoesDaSala;
let ESTADO: EstadoDaSalaNoPainel;
const permissoes = { editar: true };

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'u' }, can: (p: string) => p !== 'leads.editar' || permissoes.editar }) }));
vi.mock('next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/comercial', useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return {
    ...real,
    apiGet: vi.fn(async (caminho: string) => (caminho.endsWith('/sala/estado') ? ESTADO : VERSOES)),
    apiPut: vi.fn(async (caminho: string, corpo: unknown) => {
      chamadas.push({ metodo: 'PUT', caminho, corpo });
      return VERSOES;
    }),
    apiPost: vi.fn(async (caminho: string, corpo: unknown) => {
      chamadas.push({ metodo: 'POST', caminho, corpo });
      if (caminho.endsWith('/sala/link')) return { link: 'http://localhost:3000/s/TOKEN-DE-TESTE', validaAte: '2026-11-20T12:00:00.000Z' };
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
  permissoes.editar = true;
  ESTADO = {
    leadId: 'l1',
    temSala: true,
    ativa: true,
    validaAte: '2026-11-20T12:00:00.000Z',
    entrega: 'simulado',
    linkDisponivel: true,
    marcos: [
      { tipo: 'criada', rotulo: 'Sala criada', em: '2026-10-20T12:00:00.000Z', detalhe: 'Na chegada do lead (o fato "lead.chegou").', tom: 'bom' },
      { tipo: 'link', rotulo: 'Não entregue: WhatsApp simulado', em: '2026-10-20T12:01:00.000Z', detalhe: 'A primeira mensagem (M1) saiu pelo provedor simulado.', tom: 'alerta' },
      { tipo: 'publicada', rotulo: 'Nenhuma versão publicada', em: null, detalhe: 'O cliente vê a sala sem o quadro de implantação.', tom: 'neutro' },
      { tipo: 'na_porta', rotulo: 'Versão 1 esperando outra pessoa', em: '2026-10-21T12:00:00.000Z', detalhe: 'Só aparece depois da liberação.', tom: 'alerta', link: '/atendimento' },
      { tipo: 'visita', rotulo: 'O cliente ainda não abriu a sala', em: null, detalhe: 'Pré-visualização não conta.', tom: 'neutro' },
    ],
  };
});

describe('aba Sala: quando a sala entra (P9)', () => {
  it('mostra a ajuda, a linha do tempo real e o caminho de Aprovações', async () => {
    render(<AbaSala leadId="l1" aoMudar={async () => undefined} />);
    expect((await screen.findByTestId('sala-ajuda')).textContent).toBe(
      'A sala nasce quando o lead entra. O cliente recebe o link na primeira mensagem do WhatsApp. O que você publica aqui só aparece para ele depois que outra pessoa liberar em Aprovações.',
    );
    expect((await screen.findByTestId('sala-marco-link')).textContent).toContain('Não entregue: WhatsApp simulado');
    expect(screen.getByTestId('sala-marco-criada').textContent).toContain('lead.chegou');
    const ir = screen.getByTestId('sala-marco-na_porta').querySelector('a');
    expect(ir?.getAttribute('href')).toBe('/atendimento');
  });

  it('com leads.editar, "Copiar link da sala" pede o link e põe na área de transferência', async () => {
    const escrever = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: escrever }, configurable: true });
    render(<AbaSala leadId="l1" aoMudar={async () => undefined} />);
    await userEvent.click(await screen.findByTestId('sala-copiar-link'));
    await waitFor(() => expect(escrever).toHaveBeenCalledWith('http://localhost:3000/s/TOKEN-DE-TESTE'));
    expect(chamadas.some((c) => c.metodo === 'POST' && c.caminho === '/comercial/lead/l1/sala/link')).toBe(true);
    expect((await screen.findByRole('status')).textContent).toContain('Link copiado');
    // O link não fica escrito na tela.
    expect(document.body.textContent).not.toContain('TOKEN-DE-TESTE');
  });

  it('sem leads.editar o botão não aparece', async () => {
    permissoes.editar = false;
    render(<AbaSala leadId="l1" aoMudar={async () => undefined} />);
    await screen.findByTestId('sala-marco-link');
    expect(screen.queryByTestId('sala-copiar-link')).toBeNull();
  });

  it('sem área de transferência, o link aparece para copiar à mão', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('negado'); }) }, configurable: true });
    render(<AbaSala leadId="l1" aoMudar={async () => undefined} />);
    await userEvent.click(await screen.findByTestId('sala-copiar-link'));
    expect(((await screen.findByTestId('sala-link-manual')) as HTMLInputElement).value).toBe('http://localhost:3000/s/TOKEN-DE-TESTE');
  });
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
