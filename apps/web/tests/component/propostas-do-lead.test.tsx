/*
 * AS PROPOSTAS PELO LEAD (rodada de produção 3, I5, 22/10/2026).
 *
 * A primeira coluna é o lead (a empresa, com o contato no balão), o título da
 * proposta vira texto de apoio, a origem e as colunas do funil saíram, a
 * situação fica, e clicar na linha abre o lead. A proposta do serviço sem lead
 * diz "sem lead" e oferece "Vincular a um lead" e "Criar lead"; o vínculo
 * gravado vale mais que o casamento pelo nome. "Aparelhos da equipe" fica entre
 * o painel e a lista.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PainelComercialNegocio, PropostaDaSalaNaLista } from '@mktos/shared';

import { leadsDaBusca } from '@/app/propostas/lead-da-proposta';

let RESPOSTAS: Record<string, unknown> = {};
let ERROS: Record<string, Error> = {};
const posts: { caminho: string; corpo: unknown }[] = [];
let RESPOSTA_DO_POST: (caminho: string, corpo: unknown) => unknown = () => ({});
let PERMISSOES: string[] = ['leads.ver', 'leads.editar'];
const push = vi.fn();

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'eu' }, can: (p: string) => PERMISSOES.includes(p) }) }));
vi.mock('next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/propostas', useRouter: () => ({ push }), useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => <a href={href} {...resto}>{children}</a>,
}));
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return {
    ...real,
    apiGet: vi.fn(async (caminho: string) => {
      const chaveErro = Object.keys(ERROS).find((k) => caminho.startsWith(k));
      if (chaveErro) throw ERROS[chaveErro];
      const chave = Object.keys(RESPOSTAS).sort((a, b) => b.length - a.length).find((k) => caminho.startsWith(k));
      return chave ? RESPOSTAS[chave] : [];
    }),
    apiPost: vi.fn(async (caminho: string, corpo: unknown) => {
      posts.push({ caminho, corpo });
      const r = RESPOSTA_DO_POST(caminho, corpo);
      if (r instanceof Error) throw r;
      return r;
    }),
  };
});

import { ErroDaApi } from '@/lib/api';
import Propostas from '@/app/propostas/page';

const negocio = (id: string, titulo: string, nome: string, extra: Partial<PainelComercialNegocio> = {}): PainelComercialNegocio => ({
  id, titulo, nome, etapaChave: 'proposta', etapa: 'Proposta', etapaCor: '#999', resultado: 'aberta', valor: 10_000, vendedor: null, canal: null,
  produto: null, contato: null, atualizadoEm: '2026-10-20T12:00:00.000Z', mesEntrada: '2026-10', mesFechado: null, mesesFechados: [], diasNaEtapa: 1, clienteAtivo: false, ...extra,
});

const daSala = (leadId: string, cliente: string): PropostaDaSalaNaLista => ({
  leadId, cliente, titulo: 'Imersão · v2', versao: 2, produto: 'imersao', valor: 12_000, publicadaEm: '2026-10-19T12:00:00.000Z', etapa: 1,
  estado: 'Abriu', aberturas: 3, ultimaAtividade: '2026-10-21T12:00:00.000Z', reacoes: { fazSentido: 1, duvidas: 0, ideias: 0 }, aceitaEm: null, pagaEm: null, etapaDoLead: 'Proposta',
});

const doServico = (cliente: string, chave: string, titulo: string, ultima = '2026-10-20T12:00:00.000Z') => ({
  cliente, chave, titulo, estado: 'Enviada', etapa: 0, aberturas: 0, pessoas: 0, ultimaAtividade: ultima, criadaEm: '2026-10-01T12:00:00.000Z', link: `https://proposta.exemplo/${cliente}/${chave}`,
});

beforeEach(() => {
  RESPOSTAS = {
    '/comercial/propostas': { propostas: [daSala('lead-sala', 'Construtora Alicerce')], foraDoTeto: 0 },
    '/comercial/painel': { negocios: [
      negocio('lead-sala', 'Construtora Alicerce', 'Marina Duarte', { contato: '+55 32 9999-0000' }),
      negocio('lead-beta', 'Beta Comércio', 'Bruno Lima'),
      negocio('lead-casa', 'Casa Comum', 'Carla Reis'),
    ] },
    '/comercial/vinculos-de-propostas': { vinculos: [{ proposta: 'servico:cliente-beta/escopo-1', leadId: 'lead-beta', como: 'vinculada', em: '2026-10-21T12:00:00.000Z' }] },
    '/tenants/plataforma/quem-sou': { plataforma: true },
    '/tenants/plataforma/propostas': {
      propostas: [
        doServico('cliente-beta', 'escopo-1', 'Operação ROOT · Escopo da Beta'),
        doServico('cliente-novo', 'escopo-2', 'Operação ROOT · Escopo do Cliente Novo', '2026-10-19T12:00:00.000Z'),
      ],
      aparelhosDaEquipe: [{ nome: 'Pessoa da Mesa', aparelho: 'celular', descricao: null, desde: '2026-10-01T12:00:00.000Z' }],
    },
  };
  ERROS = {};
  posts.length = 0;
  RESPOSTA_DO_POST = () => ({});
  PERMISSOES = ['leads.ver', 'leads.editar'];
  push.mockReset();
});
afterEach(() => cleanup());

describe('as propostas pelo lead', () => {
  it('a busca do vincular acha pela empresa e pelo contato, sem acento, em ordem de empresa', () => {
    const n = [negocio('1', 'Zeta Ltda', 'José'), negocio('2', 'Ação Social', 'Ana'), negocio('3', 'Beta', 'Bruno', { contato: 'bruno@beta.exemplo' })];
    expect(leadsDaBusca(n, 'acao').map((x) => x.id)).toEqual(['2']);
    expect(leadsDaBusca(n, 'JOSE').map((x) => x.id)).toEqual(['1']);
    expect(leadsDaBusca(n, 'beta.exemplo').map((x) => x.id)).toEqual(['3']);
    expect(leadsDaBusca(n, '').map((x) => x.id)).toEqual(['2', '3', '1']);
  });

  it('o lead é a primeira coluna, sem origem e sem as colunas do funil; o contato fica no balão e o título vai de apoio', async () => {
    render(<Propostas />);
    const tabela = await screen.findByTestId('propostas-lista');
    const cabecalhos = within(tabela).getAllByRole('columnheader').map((c) => c.textContent);
    expect(cabecalhos.slice(0, 2)).toEqual(['Lead', 'Situação']);
    expect(cabecalhos).not.toContain('Origem');
    expect(cabecalhos).not.toContain('No funil');
    expect(cabecalhos).not.toContain('Proposta');
    const sala = await screen.findByTestId('proposta-lead-sala:lead-sala');
    expect(sala).toHaveTextContent('Construtora Alicerce');
    expect(sala).toHaveAttribute('href', '/comercial/lead/lead-sala');
    expect(sala).toHaveAttribute('title', 'Contato: Marina Duarte · +55 32 9999-0000');
    expect(screen.getByTestId('proposta-sala:lead-sala')).toHaveTextContent('Imersão · v2');
    expect(screen.getByTestId('proposta-sala:lead-sala')).toHaveTextContent('Abriu');
    expect(tabela).not.toHaveTextContent('Serviço de propostas');
  });

  it('o vínculo gravado dá o lead da proposta do serviço; clicar na linha abre o lead', async () => {
    render(<Propostas />);
    const beta = await screen.findByTestId('proposta-lead-servico:cliente-beta/escopo-1');
    expect(beta).toHaveTextContent('Beta Comércio');
    const u = userEvent.setup();
    await u.click(within(screen.getByTestId('proposta-servico:cliente-beta/escopo-1')).getByText('Enviada'));
    expect(push).toHaveBeenCalledWith('/comercial/lead/lead-beta');
  });

  it('sem lead: a linha diz e oferece vincular (busca entre os leads) e criar; vincular grava e a linha passa a ser do lead', async () => {
    let vinculado = false;
    RESPOSTA_DO_POST = (caminho) => {
      vinculado = true;
      return caminho.endsWith('/lead') ? {} : { mudou: true, vinculo: { proposta: 'servico:cliente-novo/escopo-2', leadId: 'lead-casa', como: 'vinculada', em: '2026-10-22T12:00:00.000Z' } };
    };
    render(<Propostas />);
    const chave = 'servico:cliente-novo/escopo-2';
    expect(await screen.findByTestId(`proposta-sem-lead-${chave}`)).toHaveTextContent('sem lead');
    expect(screen.getByTestId(`proposta-${chave}`)).toHaveTextContent('Operação ROOT · Escopo do Cliente Novo');
    expect(screen.getByTestId(`proposta-criar-lead-${chave}`)).toBeInTheDocument();
    const u = userEvent.setup();
    await u.click(screen.getByTestId(`proposta-vincular-${chave}`));
    await u.type(screen.getByTestId(`proposta-busca-${chave}`), 'carla');
    expect(screen.queryByTestId('proposta-escolher-lead-beta')).toBeNull();
    RESPOSTAS['/comercial/vinculos-de-propostas'] = { vinculos: [{ proposta: chave, leadId: 'lead-casa', como: 'vinculada', em: '2026-10-22T12:00:00.000Z' }] };
    await u.click(screen.getByTestId('proposta-escolher-lead-casa'));
    expect(vinculado).toBe(true);
    expect(posts).toEqual([{ caminho: '/comercial/vinculos-de-propostas', corpo: { proposta: chave, leadId: 'lead-casa' } }]);
    expect(await screen.findByRole('status')).toHaveTextContent('Proposta vinculada ao lead.');
    expect(await screen.findByTestId(`proposta-lead-${chave}`)).toHaveTextContent('Casa Comum');
    expect(screen.queryByTestId(`proposta-sem-lead-${chave}`)).toBeNull();
  });

  it('criar lead manda o nome da proposta e a referência dela; a frase diz que nasceu em Qualificação', async () => {
    const chave = 'servico:cliente-novo/escopo-2';
    RESPOSTA_DO_POST = () => ({ mudou: true, leadCriado: true, vinculo: { proposta: chave, leadId: 'lead-novo', como: 'criada', em: '2026-10-22T12:00:00.000Z' } });
    render(<Propostas />);
    const u = userEvent.setup();
    await u.click(await screen.findByTestId(`proposta-criar-lead-${chave}`));
    expect(posts).toEqual([{ caminho: '/comercial/vinculos-de-propostas/lead', corpo: { proposta: chave, nome: 'Operação ROOT · Escopo do Cliente Novo' } }]);
    expect(await screen.findByRole('status')).toHaveTextContent('Lead criado em Qualificação e ligado à proposta.');
  });

  it('a proposta já vinculada a outro lead: a frase da API aparece e nada muda na linha', async () => {
    const chave = 'servico:cliente-novo/escopo-2';
    RESPOSTA_DO_POST = () => new ErroDaApi('Esta proposta já está vinculada a outro lead. Abra o lead dela para conferir.', 409);
    render(<Propostas />);
    const u = userEvent.setup();
    await u.click(await screen.findByTestId(`proposta-vincular-${chave}`));
    await u.click(screen.getByTestId('proposta-escolher-lead-casa'));
    expect(await screen.findByRole('alert')).toHaveTextContent('já está vinculada a outro lead');
    expect(screen.getByTestId(`proposta-sem-lead-${chave}`)).toBeInTheDocument();
  });

  it('sem leads.editar, a linha sem lead só diz "sem lead"; clicar abre o detalhe da proposta', async () => {
    PERMISSOES = ['leads.ver'];
    RESPOSTAS['/tenants/plataforma/propostas/cliente-novo/escopo-2'] = {
      ...doServico('cliente-novo', 'escopo-2', 'Operação ROOT · Escopo do Cliente Novo'),
      tempoTotalMs: 0, maisVista: null, tempoPorParte: [], audios: [], visitas: [], visitasDaEquipeIgnoradas: 0,
    };
    render(<Propostas />);
    const chave = 'servico:cliente-novo/escopo-2';
    await screen.findByTestId(`proposta-sem-lead-${chave}`);
    expect(screen.queryByTestId(`proposta-vincular-${chave}`)).toBeNull();
    expect(screen.queryByTestId(`proposta-criar-lead-${chave}`)).toBeNull();
    const u = userEvent.setup();
    await u.click(screen.getByTestId(`proposta-sem-lead-${chave}`));
    expect(push).not.toHaveBeenCalled();
    expect(await screen.findByRole('dialog', { name: 'Detalhe da proposta' })).toBeInTheDocument();
  });

  it('"Aparelhos da equipe" fica entre o painel e a lista', async () => {
    render(<Propostas />);
    const tabela = await screen.findByTestId('propostas-lista');
    const aparelhos = screen.getByTestId('propostas-aparelhos');
    const painel = screen.getByText('Leram o investimento').closest('section')!;
    expect(painel.compareDocumentPosition(aparelhos) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(aparelhos.compareDocumentPosition(tabela) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('as propostas sem a sessão da plataforma', () => {
  it('só as da sala, cada uma com o lead dela', async () => {
    ERROS['/tenants/plataforma/quem-sou'] = new ErroDaApi('sem acesso', 403);
    render(<Propostas />);
    await waitFor(() => expect(screen.getByTestId('proposta-lead-sala:lead-sala')).toHaveTextContent('Construtora Alicerce'));
    expect(screen.queryByTestId('propostas-aparelhos')).toBeNull();
  });
});
