/*
 * O VÍNCULO DA CONVERSA NA TELA (produção 22C, W3). Dados FICTÍCIOS.
 *
 *  1. o componente do cabeçalho da caixa: ligado (link e Desvincular),
 *     sugestão de um clique, sem vínculo (buscas de lead e cliente, o igual
 *     primeiro, "pôr o número num lead" com a troca de telefone), equipe, e
 *     tudo desabilitado com a razão sem `leads.editar`;
 *  2. a aba WhatsApp do painel do lead (vazio com o convite, conversas, telefone);
 *  3. o bloco WhatsApp da ficha do cliente (e some sem permissão).
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandidatoDeVinculo, ConversaDaCaixa, WhatsappDaFicha } from '@mktos/shared';

// A máquina de homologação roda várias suítes juntas: a renderização com Intl pode passar dos 5 s padrão.
vi.setConfig({ testTimeout: 30_000 });

const posts: { caminho: string; corpo: unknown }[] = [];
const puts: { caminho: string; corpo: unknown }[] = [];
const gets: string[] = [];
let respostas: Record<string, unknown> = {};
let falharPost: ((caminho: string, corpo: unknown) => Error | null) | null = null;

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'eu' }, can: () => true }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => '/whatsapp', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return {
    ...real,
    apiGet: vi.fn(async (caminho: string) => {
      gets.push(caminho);
      const chave = Object.keys(respostas).find((k) => caminho.startsWith(k));
      if (!chave) throw new real.ErroDaApi('não encontrado', 404);
      const r = respostas[chave];
      if (r instanceof Error) throw r;
      return r;
    }),
    apiPost: vi.fn(async (caminho: string, corpo: unknown) => {
      posts.push({ caminho, corpo });
      const e = falharPost?.(caminho, corpo);
      if (e) throw e;
      return {};
    }),
    apiPut: vi.fn(async (caminho: string, corpo: unknown) => {
      puts.push({ caminho, corpo });
      return { telefone: '5532999990001', mudou: true, conversasCasadas: 0 };
    }),
  };
});

import { ErroDaApi } from '@/lib/api';
import { VinculoDaConversa, hrefDoClienteDaConversa, hrefDoLeadDaConversa } from '@/components/whatsapp/VinculoDaConversa';
import { WhatsappDoCliente } from '@/components/whatsapp/WhatsappDoCliente';
import { AbaWhatsapp } from '@/app/comercial/_painel/AbaWhatsapp';
import { ABAS_DO_PAINEL, lerPainel } from '@/app/comercial/_painel/estado';

function conversa(o: Partial<ConversaDaCaixa> = {}): ConversaDaCaixa {
  return {
    id: 'conv-1',
    grupo: true,
    nome: 'ROOT | Padaria Aurora Fictícia',
    numero: null,
    fotoUrl: null,
    participantes: 5,
    equipe: false,
    comunidade: false,
    ultimaMensagemEm: '2026-10-21T15:00:00.000Z',
    previa: { texto: 'bom dia fictício', tipo: 'conversation', deMim: false, remetenteNome: 'Contato Fictício', timestamp: '2026-10-21T15:00:00.000Z' },
    naoLidas: 2,
    vinculo: null,
    sugestao: null,
    arquivada: false,
    ...o,
  };
}

const CANDIDATOS: CandidatoDeVinculo[] = [
  { tipo: 'cliente', id: 'cli-igual', nome: 'Padaria Aurora Fictícia', detalhe: 'Padaria Aurora Fictícia Ltda', igual: true },
  { tipo: 'cliente', id: 'cli-parecido', nome: 'Padaria Aurora Filial', detalhe: null, igual: false },
];

beforeEach(() => {
  posts.length = 0;
  puts.length = 0;
  gets.length = 0;
  respostas = {};
  falharPost = null;
});

describe('o vínculo no cabeçalho da caixa', () => {
  it('ligada a lead: o link abre o painel do lead na aba WhatsApp; Desvincular chama a rota e avisa a caixa', async () => {
    const aoMudar = vi.fn();
    render(<VinculoDaConversa conversa={conversa({ vinculo: { tipo: 'lead', id: 'lead-1', nome: 'Marcenaria Fictícia', vinculadoPor: { id: 'u1', nome: 'Pessoa' }, vinculadoEm: null } })} podeVincular aoMudar={aoMudar} />);
    const link = screen.getByRole('link', { name: 'Marcenaria Fictícia' });
    expect(link).toHaveAttribute('href', '/comercial/funil?lead=lead-1&aba=whatsapp');
    expect(screen.getByTestId('whats-vinculo')).toHaveTextContent('Lead:');
    await userEvent.click(screen.getByTestId('whats-desvincular'));
    await waitFor(() => expect(aoMudar).toHaveBeenCalled());
    expect(posts).toEqual([{ caminho: '/whatsapp/vinculos/conv-1/desvincular', corpo: {} }]);
  });

  it('ligada a cliente: o link leva à ficha pelo cliente', () => {
    render(<VinculoDaConversa conversa={conversa({ vinculo: { tipo: 'cliente', id: 'cli-1', nome: 'Padaria Aurora Fictícia', vinculadoPor: null, vinculadoEm: null } })} podeVincular aoMudar={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Padaria Aurora Fictícia' })).toHaveAttribute('href', '/comercial/ficha/cliente/cli-1');
    expect(screen.getByText('pelo telefone')).toBeInTheDocument();
    expect(hrefDoLeadDaConversa('a b')).toBe('/comercial/funil?lead=a%20b&aba=whatsapp');
    expect(hrefDoClienteDaConversa('x')).toBe('/comercial/ficha/cliente/x');
  });

  it('sugestão: "Vincular a <nome>?" liga com UM clique, pela rota da sugestão', async () => {
    const aoMudar = vi.fn();
    render(<VinculoDaConversa conversa={conversa({ sugestao: { tipo: 'cliente', id: 'cli-igual', nome: 'Padaria Aurora Fictícia', como: 'nome_igual' } })} podeVincular aoMudar={aoMudar} />);
    const botao = screen.getByTestId('whats-vinculo-sugestao');
    expect(botao).toHaveTextContent('Vincular a Padaria Aurora Fictícia?');
    await userEvent.click(botao);
    await waitFor(() => expect(aoMudar).toHaveBeenCalledTimes(1));
    expect(posts).toEqual([{ caminho: '/whatsapp/vinculos/conv-1/sugestao', corpo: {} }]);
  });

  it('sem vínculo: Vincular a cliente abre a busca, o igual vem marcado, escolher liga', async () => {
    respostas['/whatsapp/vinculos/candidatos'] = CANDIDATOS;
    const aoMudar = vi.fn();
    render(<VinculoDaConversa conversa={conversa()} podeVincular aoMudar={aoMudar} />);
    expect(screen.getByTestId('whats-vinculo')).toHaveTextContent('sem vínculo');
    expect(screen.queryByTestId('whats-vinculo-sugestao')).toBeNull();
    // Grupo não tem o convite do telefone.
    expect(screen.queryByTestId('whats-convite-telefone')).toBeNull();
    await userEvent.click(screen.getByTestId('whats-vincular-cliente'));
    expect(screen.getByTestId('whats-vinculo-busca')).toBeInTheDocument();
    const igual = await screen.findByTestId('whats-vinculo-candidato-cli-igual');
    expect(within(igual).getByText('nome igual')).toBeInTheDocument();
    expect(within(screen.getByTestId('whats-vinculo-candidato-cli-parecido')).queryByText('nome igual')).toBeNull();
    expect(gets.some((g) => g.includes('conversaId=conv-1') && g.includes('tipo=cliente'))).toBe(true);
    await userEvent.click(igual);
    await waitFor(() => expect(aoMudar).toHaveBeenCalled());
    expect(posts).toEqual([{ caminho: '/whatsapp/vinculos/conv-1', corpo: { tipo: 'cliente', id: 'cli-igual' } }]);
  });

  it('a busca digitada vai à API; Vincular a lead busca só leads', async () => {
    respostas['/whatsapp/vinculos/candidatos'] = [];
    render(<VinculoDaConversa conversa={conversa()} podeVincular aoMudar={vi.fn()} />);
    await userEvent.click(screen.getByTestId('whats-vincular-lead'));
    await userEvent.type(screen.getByTestId('whats-vinculo-busca'), 'oficina');
    await waitFor(() => expect(gets.some((g) => g.includes('tipo=lead') && g.includes('q=oficina'))).toBe(true));
    expect(await screen.findByText(/Nada encontrado/)).toBeInTheDocument();
  });

  it('1:1 sem vínculo: o convite põe o número num lead; lead com outro telefone pede a troca', async () => {
    respostas['/whatsapp/vinculos/candidatos'] = [{ tipo: 'lead', id: 'lead-9', nome: 'Lead Fictício', detalhe: null, igual: false }];
    falharPost = (caminho, corpo) =>
      caminho.endsWith('/telefone-no-lead') && !(corpo as { substituir?: boolean }).substituir ? new ErroDaApi('Este lead já tem outro telefone.', 409, 'lead_com_outro_telefone') : null;
    const aoMudar = vi.fn();
    render(<VinculoDaConversa conversa={conversa({ id: 'conv-2', grupo: false, nome: 'Contato Fictício', numero: '5532999990001', participantes: null })} podeVincular aoMudar={aoMudar} />);
    expect(screen.getByTestId('whats-convite-telefone')).toHaveTextContent('Este número não está em nenhum lead');
    await userEvent.click(screen.getByTestId('whats-telefone-no-lead'));
    await userEvent.click(await screen.findByTestId('whats-vinculo-candidato-lead-9'));
    await userEvent.click(await screen.findByTestId('whats-trocar-telefone'));
    await waitFor(() => expect(aoMudar).toHaveBeenCalledTimes(1));
    expect(posts).toEqual([
      { caminho: '/whatsapp/vinculos/conv-2/telefone-no-lead', corpo: { leadId: 'lead-9' } },
      { caminho: '/whatsapp/vinculos/conv-2/telefone-no-lead', corpo: { leadId: 'lead-9', substituir: true } },
    ]);
  });

  it('equipe: marcar e tirar', async () => {
    const { rerender } = render(<VinculoDaConversa conversa={conversa()} podeVincular aoMudar={vi.fn()} />);
    await userEvent.click(screen.getByTestId('whats-marcar-equipe'));
    expect(posts.at(-1)).toEqual({ caminho: '/whatsapp/vinculos/conv-1/equipe', corpo: { equipe: true } });
    rerender(<VinculoDaConversa conversa={conversa({ equipe: true })} podeVincular aoMudar={vi.fn()} />);
    expect(screen.getByTestId('whats-vinculo')).toHaveTextContent('Equipe');
    await userEvent.click(screen.getByTestId('whats-tirar-equipe'));
    expect(posts.at(-1)).toEqual({ caminho: '/whatsapp/vinculos/conv-1/equipe', corpo: { equipe: false } });
  });

  // Layout 26/10: Comunidade, o quarto tipo de conversa (ao lado de lead, cliente e equipe).
  it('comunidade: marcar e tirar; o selo aparece e os botões de vínculo somem', async () => {
    const { rerender } = render(<VinculoDaConversa conversa={conversa()} podeVincular aoMudar={vi.fn()} />);
    await userEvent.click(screen.getByTestId('whats-marcar-comunidade'));
    expect(posts.at(-1)).toEqual({ caminho: '/whatsapp/vinculos/conv-1/comunidade', corpo: { comunidade: true } });
    rerender(<VinculoDaConversa conversa={conversa({ comunidade: true })} podeVincular aoMudar={vi.fn()} />);
    expect(screen.getByTestId('whats-selo-comunidade')).toHaveTextContent('Comunidade');
    expect(screen.queryByTestId('whats-vincular-lead')).toBeNull();
    expect(screen.queryByTestId('whats-vincular-cliente')).toBeNull();
    await userEvent.click(screen.getByTestId('whats-tirar-comunidade'));
    expect(posts.at(-1)).toEqual({ caminho: '/whatsapp/vinculos/conv-1/comunidade', corpo: { comunidade: false } });
  });

  it('comunidade: o grupo que caiu em equipe passa para comunidade num clique, e volta para equipe', async () => {
    const { rerender } = render(<VinculoDaConversa conversa={conversa({ nome: 'Operação Root | IA para Negócios', participantes: 55, equipe: true })} podeVincular aoMudar={vi.fn()} />);
    await userEvent.click(screen.getByTestId('whats-marcar-comunidade'));
    expect(posts.at(-1)).toEqual({ caminho: '/whatsapp/vinculos/conv-1/comunidade', corpo: { comunidade: true } });
    rerender(<VinculoDaConversa conversa={conversa({ nome: 'Operação Root | IA para Negócios', participantes: 55, comunidade: true })} podeVincular aoMudar={vi.fn()} />);
    await userEvent.click(screen.getByTestId('whats-marcar-equipe'));
    expect(posts.at(-1)).toEqual({ caminho: '/whatsapp/vinculos/conv-1/equipe', corpo: { equipe: true } });
  });

  it('comunidade 1:1 não mostra o convite de pôr o número num lead', () => {
    render(<VinculoDaConversa conversa={conversa({ grupo: false, numero: '5532999990001', participantes: null, comunidade: true })} podeVincular aoMudar={vi.fn()} />);
    expect(screen.queryByTestId('whats-convite-telefone')).toBeNull();
  });

  it('sem leads.editar: tudo desabilitado, com a razão; nada é chamado', async () => {
    render(<VinculoDaConversa conversa={conversa({ sugestao: { tipo: 'lead', id: 'l1', nome: 'Lead Fictício', como: 'nome_igual' } })} podeVincular={false} aoMudar={vi.fn()} />);
    for (const id of ['whats-vinculo-sugestao', 'whats-vincular-lead', 'whats-vincular-cliente', 'whats-marcar-equipe', 'whats-marcar-comunidade']) {
      expect(screen.getByTestId(id)).toBeDisabled();
      expect(screen.getByTestId(id)).toHaveAttribute('title', expect.stringMatching(/leads\.editar/));
    }
    expect(screen.getByText('Vincular pede a permissão leads.editar.')).toBeInTheDocument();
    expect(posts).toHaveLength(0);
  });

  it('erro da API aparece ao lado (409 ao ligar a outro)', async () => {
    falharPost = () => new ErroDaApi('Esta conversa já está ligada a outro lead ou cliente. Desvincule antes de ligar a outro.', 409);
    render(<VinculoDaConversa conversa={conversa({ sugestao: { tipo: 'lead', id: 'l1', nome: 'Lead Fictício', como: 'nome_igual' } })} podeVincular aoMudar={vi.fn()} />);
    await userEvent.click(screen.getByTestId('whats-vinculo-sugestao'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Desvincule antes');
  });
});

const COM_CONVERSA: WhatsappDaFicha = {
  conversas: [conversa({ id: 'conv-7', grupo: false, nome: 'Contato Fictício', numero: '5532999990001' })],
  ultimas: [
    { id: 'm1', mensagemExternaId: 'E1', deMim: false, tipo: 'conversation', texto: 'olá, mensagem fictícia', midia: null, remetenteNome: 'Contato Fictício', remetenteNumero: null, timestamp: '2026-10-21T15:00:00.000Z', cita: null, enviadaPor: null, lida: true },
    { id: 'm2', mensagemExternaId: 'E2', deMim: true, tipo: 'image', texto: null, midia: null, remetenteNome: null, remetenteNumero: null, timestamp: '2026-10-21T15:01:00.000Z', cita: null, enviadaPor: { id: 'u1', nome: 'Pessoa Fictícia' }, lida: true },
  ],
  telefone: '5532999990001',
  podeEditar: true,
};

describe('a aba WhatsApp do painel do lead', () => {
  it('a aba existe na URL do painel', () => {
    expect(ABAS_DO_PAINEL).toContain('whatsapp');
    expect(lerPainel('?lead=l1&aba=whatsapp')).toEqual({ leadId: 'l1', aba: 'whatsapp' });
  });

  it('sem conversa e sem telefone: o vazio e o convite a preencher; preencher grava pelo PUT', async () => {
    respostas['/whatsapp/vinculos/lead/lead-1'] = { conversas: [], ultimas: [], telefone: null, podeEditar: true } satisfies WhatsappDaFicha;
    const aoMudar = vi.fn();
    render(<AbaWhatsapp leadId="lead-1" aoMudar={aoMudar} />);
    expect(await screen.findByTestId('painel-whatsapp-vazio')).toHaveTextContent('Nenhuma conversa de WhatsApp ligada a este lead');
    expect(screen.getByTestId('painel-whatsapp-telefone')).toHaveTextContent('não preenchido');
    expect(screen.getByText(/Este lead não tem telefone/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('painel-whatsapp-telefone-editar'));
    await userEvent.type(screen.getByTestId('painel-whatsapp-telefone-campo'), '(32) 99999-0001');
    await userEvent.click(screen.getByRole('button', { name: 'salvar' }));
    await waitFor(() => expect(aoMudar).toHaveBeenCalled());
    expect(puts).toEqual([{ caminho: '/whatsapp/vinculos/lead/lead-1/telefone', corpo: { telefone: '(32) 99999-0001' } }]);
  });

  it('telefone inválido não vai à API', async () => {
    respostas['/whatsapp/vinculos/lead/lead-1'] = { conversas: [], ultimas: [], telefone: null, podeEditar: true } satisfies WhatsappDaFicha;
    render(<AbaWhatsapp leadId="lead-1" aoMudar={vi.fn()} />);
    await userEvent.click(await screen.findByTestId('painel-whatsapp-telefone-editar'));
    await userEvent.type(screen.getByTestId('painel-whatsapp-telefone-campo'), '123');
    await userEvent.click(screen.getByRole('button', { name: 'salvar' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(puts).toHaveLength(0);
  });

  it('com conversa: a lista com link para a caixa e as últimas mensagens; telefone formatado', async () => {
    respostas['/whatsapp/vinculos/lead/lead-1'] = COM_CONVERSA;
    render(<AbaWhatsapp leadId="lead-1" aoMudar={vi.fn()} />);
    expect(await screen.findByTestId('whats-ligada-conv-7')).toHaveTextContent('Contato Fictício');
    expect(screen.getByTestId('whats-abrir-conv-7')).toHaveAttribute('href', '/whatsapp?conversa=conv-7');
    const ultimas = screen.getByTestId('whats-ultimas');
    expect(ultimas).toHaveTextContent('olá, mensagem fictícia');
    expect(ultimas).toHaveTextContent('[imagem]');
    expect(ultimas).toHaveTextContent('Pessoa Fictícia');
    expect(screen.getByTestId('painel-whatsapp-telefone')).toHaveTextContent('+55 (32) 99999-0001');
  });

  it('sem leads.editar: o botão de editar vem desabilitado', async () => {
    respostas['/whatsapp/vinculos/lead/lead-1'] = { ...COM_CONVERSA, podeEditar: false };
    render(<AbaWhatsapp leadId="lead-1" aoMudar={vi.fn()} />);
    expect(await screen.findByTestId('painel-whatsapp-telefone-editar')).toBeDisabled();
  });
});

describe('o bloco WhatsApp da ficha do cliente', () => {
  it('mostra o grupo ligado, as últimas e o telefone do cliente', async () => {
    respostas['/whatsapp/vinculos/cliente/cli-1'] = { ...COM_CONVERSA, conversas: [conversa({ id: 'conv-8' })] };
    render(<WhatsappDoCliente clienteId="cli-1" />);
    expect(await screen.findByTestId('ficha-whatsapp')).toHaveTextContent('WhatsApp');
    expect(await screen.findByTestId('whats-ligada-conv-8')).toHaveTextContent('grupo · 5');
    expect(screen.getByTestId('whats-abrir-conv-8')).toHaveAttribute('href', '/whatsapp?conversa=conv-8');
    await userEvent.click(screen.getByTestId('ficha-whatsapp-telefone-editar'));
    await userEvent.clear(screen.getByTestId('ficha-whatsapp-telefone-campo'));
    await userEvent.type(screen.getByTestId('ficha-whatsapp-telefone-campo'), '32 99999-0002');
    await userEvent.click(screen.getByRole('button', { name: 'salvar' }));
    await waitFor(() => expect(puts).toEqual([{ caminho: '/whatsapp/vinculos/cliente/cli-1/telefone', corpo: { telefone: '32 99999-0002' } }]));
  });

  it('sem conversa: o vazio; sem permissão (403): o bloco some', async () => {
    respostas['/whatsapp/vinculos/cliente/cli-2'] = { conversas: [], ultimas: [], telefone: null, podeEditar: true } satisfies WhatsappDaFicha;
    const { unmount } = render(<WhatsappDoCliente clienteId="cli-2" />);
    expect(await screen.findByTestId('ficha-whatsapp-vazio')).toBeInTheDocument();
    unmount();
    respostas['/whatsapp/vinculos/cliente/cli-3'] = new ErroDaApi('Permissão insuficiente', 403);
    render(<WhatsappDoCliente clienteId="cli-3" />);
    await waitFor(() => expect(gets).toContain('/whatsapp/vinculos/cliente/cli-3'));
    await waitFor(() => expect(screen.queryByTestId('ficha-whatsapp')).toBeNull());
  });
});
