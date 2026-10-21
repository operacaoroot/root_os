/*
 * A PASTA DO CLIENTE E OS ANEXOS DA TAREFA NA TELA (rodada dos agentes, 21/10/2026, lane A4).
 *
 *  · `PastaDoCliente`: com o ponteiro, o link; sem ele, "Criar pasta do cliente"
 *    (para quem tem tarefas.editar OU leads.editar), a resposta "aguardando
 *    aprovação" vira aviso e some o botão, o erro vira "Criar pasta de novo";
 *  · `PastasDosClientes`: a lista dos clientes com o estado da pasta;
 *  · `AnexosDaTarefa`: os estados da cópia no Drive, o link quando enviado,
 *    o envio pelo multipart e a recusa do tipo antes de subir.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnexoDaTarefa, ClienteComPasta } from '@mktos/shared';

let PERMISSOES = new Set<string>(['tarefas.ver', 'tarefas.editar']);
let RESPOSTAS: Record<string, unknown> = {};
const posts: string[] = [];
const uploads: { caminho: string; nome: string }[] = [];
let respostaDoPost: unknown = {};

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'eu' }, can: (p: string) => PERMISSOES.has(p) }) }));
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return {
    ...real,
    apiGet: vi.fn(async (caminho: string) => {
      const chave = Object.keys(RESPOSTAS).find((k) => caminho.startsWith(k));
      return chave ? RESPOSTAS[chave] : [];
    }),
    apiPost: vi.fn(async (caminho: string) => {
      posts.push(caminho);
      return respostaDoPost;
    }),
    apiUpload: vi.fn(async (caminho: string, arquivo: File) => {
      uploads.push({ caminho, nome: arquivo.name });
      return {};
    }),
  };
});

import { PastaDoCliente, AVISO_DA_PASTA_NA_FILA } from '@/components/clientes/PastaDoCliente';
import { PastasDosClientes } from '@/components/clientes/PastasDosClientes';
import { AnexosDaTarefa } from '@/components/trabalho/AnexosDaTarefa';

beforeEach(() => {
  PERMISSOES = new Set(['tarefas.ver', 'tarefas.editar']);
  RESPOSTAS = {};
  posts.length = 0;
  uploads.length = 0;
  respostaDoPost = {};
});
afterEach(cleanup);

describe('PastaDoCliente', () => {
  it('com o ponteiro, é o link para o Drive', () => {
    render(<PastaDoCliente partnerId="p1" url="https://drive.exemplo.invalid/p1" />);
    expect(screen.getByRole('link', { name: 'Abrir pasta do cliente' })).toHaveAttribute('href', 'https://drive.exemplo.invalid/p1');
  });

  it('sem ponteiro, pede a pasta e mostra que ficou na fila de aprovação', async () => {
    respostaDoPost = { estado: 'aguardando_aprovacao', approvalId: 'a1' };
    render(<PastaDoCliente partnerId="p1" url={null} />);
    await userEvent.click(screen.getByRole('button', { name: 'Criar pasta do cliente' }));
    expect(posts).toEqual(['/clientes/p1/pasta']);
    expect(await screen.findByRole('status')).toHaveTextContent(AVISO_DA_PASTA_NA_FILA);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('o erro do Drive aparece com o motivo e o botão vira "Criar pasta de novo"', async () => {
    respostaDoPost = { estado: 'erro', motivo: 'falta a pasta "_modelo-cliente" dentro da raiz dos clientes.' };
    render(<PastaDoCliente partnerId="p1" url={null} />);
    await userEvent.click(screen.getByRole('button', { name: 'Criar pasta do cliente' }));
    expect(await screen.findByRole('status')).toHaveTextContent('_modelo-cliente');
    expect(screen.getByRole('button', { name: 'Criar pasta de novo' })).toBeInTheDocument();
  });

  it('quem tem só leads.editar também pede; quem não tem nenhuma das duas não vê o botão', () => {
    PERMISSOES = new Set(['leads.editar']);
    render(<PastaDoCliente partnerId="p1" url={null} />);
    expect(screen.getByRole('button', { name: 'Criar pasta do cliente' })).toBeInTheDocument();
    cleanup();
    PERMISSOES = new Set(['tarefas.ver']);
    render(<PastaDoCliente partnerId="p1" url={null} erro="sem raiz" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('A pasta não foi criada: sem raiz');
  });
});

describe('PastasDosClientes', () => {
  it('lista os clientes com o estado da pasta, recolhida até abrir', async () => {
    const clientes: ClienteComPasta[] = [
      { id: 'c1', nome: 'Padaria Exemplo', pastaDriveUrl: 'https://drive.exemplo.invalid/c1', pastaDriveErro: null, aguardandoAprovacao: false, arquivosNaFila: 0 },
      { id: 'c2', nome: 'Oficina Exemplo', pastaDriveUrl: null, pastaDriveErro: null, aguardandoAprovacao: true, arquivosNaFila: 2 },
    ];
    RESPOSTAS['/clientes/pastas'] = clientes;
    render(<PastasDosClientes />);
    expect(screen.queryByText('Padaria Exemplo')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Pastas dos clientes no Drive/ }));
    expect(await screen.findByText('Padaria Exemplo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir pasta do cliente' })).toHaveAttribute('href', 'https://drive.exemplo.invalid/c1');
    expect(screen.getByText('2 arquivo(s) esperando a pasta')).toBeInTheDocument();
    expect(screen.getByText(AVISO_DA_PASTA_NA_FILA)).toBeInTheDocument();
  });
});

describe('AnexosDaTarefa', () => {
  const anexo = (p: Partial<AnexoDaTarefa>): AnexoDaTarefa => ({
    id: 'a', nome: 'arquivo.pdf', tipoMime: 'application/pdf', bytes: 2048, autorNome: 'Rodrigo', criadoEm: '2026-10-21T12:00:00Z',
    estado: 'so_no_os', driveUrl: null, subpasta: null, motivo: null, approvalId: null, ...p,
  });

  it('mostra onde está a cópia de cada anexo, com o link do Drive quando enviado', async () => {
    RESPOSTAS['/trabalho/tarefas/t1/anexos'] = [
      anexo({ id: '1', nome: 'Contrato.pdf', estado: 'enviado', driveUrl: 'https://drive.exemplo.invalid/a1', subpasta: '02-contrato' }),
      anexo({ id: '2', nome: 'Proposta.pdf', estado: 'aguardando_aprovacao', approvalId: 'ap', subpasta: '01-comercial' }),
      anexo({ id: '3', nome: 'Nota.txt', estado: 'so_no_os', motivo: 'tarefa do cliente interno da casa: o anexo fica só no OS.' }),
    ];
    render(<AnexosDaTarefa taskId="t1" />);
    expect(await screen.findByText('Contrato.pdf')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir no Drive' })).toHaveAttribute('href', 'https://drive.exemplo.invalid/a1');
    expect(screen.getByText('Aguardando aprovação para ir ao Drive · 01-comercial')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver em Aprovações' })).toHaveAttribute('href', '/atendimento');
    expect(screen.getByText(/cliente interno/)).toBeInTheDocument();
  });

  it('envia pelo multipart e recusa o executável antes de subir', async () => {
    RESPOSTAS['/trabalho/tarefas/t1/anexos'] = [];
    render(<AnexosDaTarefa taskId="t1" />);
    const campo = await screen.findByLabelText('Anexar arquivo à tarefa');
    await userEvent.upload(campo, new File(['MZ'], 'virus.exe', { type: 'application/x-msdownload' }));
    expect(uploads).toEqual([]);
    expect(await screen.findByRole('alert')).toHaveTextContent(/não aceito/);
    await userEvent.upload(campo, new File(['%PDF'], 'contrato.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(uploads).toEqual([{ caminho: '/trabalho/tarefas/t1/anexos', nome: 'contrato.pdf' }]));
  });

  it('sem tarefas.editar não mostra o envio; sem tarefas.ver não mostra nada', async () => {
    PERMISSOES = new Set(['tarefas.ver']);
    RESPOSTAS['/trabalho/tarefas/t1/anexos'] = [];
    render(<AnexosDaTarefa taskId="t1" />);
    expect(await screen.findByText('Nenhum anexo.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Anexar arquivo à tarefa')).toBeNull();
    cleanup();
    PERMISSOES = new Set();
    const { container } = render(<AnexosDaTarefa taskId="t1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
