import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FichaDoLead } from '@mktos/shared';

/*
 * Layout 26/10: A ATA LIGADA A UM LEAD OU A UM CLIENTE.
 *
 *  1. na lista de Atas, cada ata diz "sem ligação" ou a que está ligada;
 *  2. a ata aberta liga a um lead (busca pelo nome ou pela empresa) com
 *     `PUT /trabalho/atas/:ref/ligacao`, leva o título e a data da lista, e
 *     passa a mostrar o lead com o link do painel; "desligar" manda `null`;
 *  3. sem `leads.ver`, ligar a lead não aparece (cliente continua);
 *  4. o painel do lead (aba Fio, "ligado a") mostra as atas ligadas com a data
 *     e o título, cada uma abrindo na tela Atas;
 *  5. a ficha do cliente tem a seção "Atas" com as ligadas a ele.
 */

const get = vi.fn(), post = vi.fn(), put = vi.fn();
const TODAS = ['tarefas.ver', 'tarefas.editar', 'obsidian.ver', 'obsidian.editar', 'leads.ver'];
let permissions = [...TODAS];
vi.mock('@/lib/api', () => ({
  apiGet: (...a: unknown[]) => get(...a), apiPost: (...a: unknown[]) => post(...a), apiPut: (...a: unknown[]) => put(...a),
  apiPatch: vi.fn(), apiDelete: vi.fn(), apiBlob: vi.fn(),
  ErroDaApi: class extends Error {},
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'u' }, can: (p: string) => permissions.includes(p) }) }));
vi.mock('@/lib/ficha', () => ({ abrirFicha: vi.fn() }));
import AtasPage from '@/app/trabalho/atas/page';
import { AbaFio } from '@/app/comercial/_painel/AbaFio';
import { AtasDoCliente } from '@/components/trabalho/AtasLigadas';

const REF = 'memoria:ata-kickoff';
const LEAD = '11111111-1111-4111-8111-111111111111';
const CLIENTE = '22222222-2222-4222-8222-222222222222';

let ligadaA: unknown = null;

const resumo = () => ({
  id: REF, fonte: 'colada', tipo: 'ata', titulo: 'Kickoff Padaria', data: '2026-10-20', participantes: [], resumo: '',
  caminho: null, sugestoes: { rascunho: 0, aceitas: 0, descartadas: 0 }, decididas: [], ligadaA, atualizadaEm: '2026-10-20T12:00:00.000Z',
});

function respostas(caminho: string) {
  if (caminho.startsWith('/trabalho/atas/alvos?tipo=lead')) return Promise.resolve([{ tipo: 'lead', id: LEAD, nome: 'Ana Souza', detalhe: 'Padaria Exemplo' }]);
  if (caminho.startsWith('/trabalho/atas/alvos?tipo=cliente')) return Promise.resolve([{ tipo: 'cliente', id: CLIENTE, nome: 'Padaria Exemplo', detalhe: null }]);
  if (caminho.startsWith('/trabalho/atas/ligadas')) {
    return Promise.resolve([
      { ataRef: REF, titulo: 'Kickoff Padaria', data: '2026-10-20', tipo: 'ata', ligadaEm: '2026-10-26T12:00:00.000Z' },
      { ataRef: 'granola:reuniao-2', titulo: 'Conversa de proposta', data: '2026-10-24', tipo: 'transcricao', ligadaEm: '2026-10-26T12:00:00.000Z' },
    ]);
  }
  if (caminho.startsWith('/trabalho/atas/')) return Promise.resolve({ ...resumo(), texto: '# Kickoff', procedencia: 'memória', sugestoesDaAta: [], decisoes: [], pendencias: [] });
  if (caminho.startsWith('/trabalho/atas')) return Promise.resolve({ atas: [resumo()], pasta: '80-Reunioes', notasDoVault: 0, vaultVisivel: true, iaConfigurada: true });
  return Promise.reject(new Error(`sem resposta para ${caminho}`));
}

beforeEach(() => {
  permissions = [...TODAS];
  ligadaA = null;
  window.history.replaceState({}, '', '/trabalho/atas');
  get.mockReset().mockImplementation((caminho: string) => respostas(caminho));
  post.mockReset();
  put.mockReset();
});
afterEach(() => cleanup());

describe('Atas: ligar a ata a um lead ou a um cliente', () => {
  it('a lista e a ata aberta dizem "sem ligação"; ligar a lead manda o PUT e mostra o lead com o link do painel', async () => {
    put.mockImplementation(() => Promise.resolve({ lead: { id: LEAD, nome: 'Ana Souza' }, cliente: null, ligadaEm: '2026-10-26T12:00:00.000Z', ligadaPor: 'Lucas' }));
    render(<AtasPage />);
    expect(await screen.findByTestId(`ata-ligada-a-${REF}`)).toHaveTextContent('sem ligação');
    const ligacao = await screen.findByTestId('ata-ligacao');
    expect(within(ligacao).getByTestId('ata-sem-ligacao')).toBeInTheDocument();

    fireEvent.click(within(ligacao).getByTestId('ata-ligar-lead'));
    fireEvent.click(await screen.findByTestId(`ata-alvo-${LEAD}`));
    await waitFor(() => expect(put).toHaveBeenCalledWith(
      `/trabalho/atas/${encodeURIComponent(REF)}/ligacao`,
      { leadId: LEAD, titulo: 'Kickoff Padaria', data: '2026-10-20' },
      'tok',
    ));
    const link = await screen.findByTestId('ata-ligada-lead');
    expect(link).toHaveTextContent('lead Ana Souza');
    expect(link).toHaveAttribute('href', `/comercial/funil?lead=${LEAD}&aba=fio`);
    expect(screen.getByTestId(`ata-ligada-a-${REF}`)).toHaveTextContent('ligada a lead Ana Souza');
    // Ligar não é subir a ata para o comercial: nenhum POST.
    expect(post).not.toHaveBeenCalled();
  });

  it('ligada a cliente: o link abre a ficha e "desligar" manda null', async () => {
    ligadaA = { lead: null, cliente: { id: CLIENTE, nome: 'Padaria Exemplo' }, ligadaEm: '2026-10-26T12:00:00.000Z', ligadaPor: null };
    put.mockImplementation(() => Promise.resolve(null));
    render(<AtasPage />);
    const link = await screen.findByTestId('ata-ligada-cliente');
    expect(link).toHaveAttribute('href', `/comercial/ficha/cliente/${CLIENTE}`);
    fireEvent.click(screen.getByTestId('ata-desligar-cliente'));
    await waitFor(() => expect(put).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ clienteId: null }), 'tok'));
    expect(await screen.findByTestId('ata-sem-ligacao')).toBeInTheDocument();
  });

  it('sem leads.ver, ligar a lead não aparece; sem tarefas.editar, nenhum botão de ligar', async () => {
    permissions = TODAS.filter((p) => p !== 'leads.ver');
    render(<AtasPage />);
    const ligacao = await screen.findByTestId('ata-ligacao');
    expect(within(ligacao).queryByTestId('ata-ligar-lead')).toBeNull();
    expect(within(ligacao).getByTestId('ata-ligar-cliente')).toBeInTheDocument();
    cleanup();
    permissions = ['tarefas.ver', 'obsidian.ver', 'leads.ver'];
    render(<AtasPage />);
    const soLeitura = await screen.findByTestId('ata-ligacao');
    expect(within(soLeitura).queryByTestId('ata-ligar-cliente')).toBeNull();
  });
});

function ficha(): FichaDoLead {
  return {
    leadId: LEAD, nome: 'Ana Souza', telefone: null, email: null, empresa: 'Padaria Exemplo', cnpj: null, canal: null, origemIndicacao: null,
    perfil: null, pontuacao: null, sistemaErp: null, baseDados: null, dono: null, socioDaConta: null, produto: null,
    valorCentavos: null, parcelas: null, forma: null, validade: null, propostaVersao: null, etapa: 'sessao', etapaDesde: '2026-10-12T13:00:00.000Z',
    motivoSaida: null, voltaEm: null, saude: null, proximaAcao: null, proximasAcoesAutomaticas: [],
    portao: { proxima: null, faltando: [], itens: [] },
    ligadoA: { sala: null, ata: false, proposta: null, contrato: null, cobranca: null },
    fio: [],
  } as unknown as FichaDoLead;
}

describe('o lead e o cliente mostram as atas ligadas', () => {
  it('painel do lead: "ligado a" conta as atas e lista data e título, cada uma abrindo em Atas', async () => {
    render(<AbaFio leadId={LEAD} ficha={ficha()} carregando={false} aoMudar={async () => {}} />);
    const lista = await screen.findByTestId('lead-atas-ligadas');
    expect(get).toHaveBeenCalledWith(`/trabalho/atas/ligadas?lead=${LEAD}`, 'tok');
    expect(screen.getByText('ata · 2 ligadas')).toBeInTheDocument();
    const kickoff = within(lista).getByText('Kickoff Padaria');
    expect(kickoff.closest('a')).toHaveAttribute('href', `/trabalho/atas?ata=${encodeURIComponent(REF)}`);
    expect(within(lista).getByText('20/10/2026')).toBeInTheDocument();
    expect(within(lista).getByText('transcrição')).toBeInTheDocument();
  });

  it('painel do lead sem ata ligada continua dizendo "ainda não"', async () => {
    get.mockImplementation((caminho: string) => (caminho.startsWith('/trabalho/atas/ligadas') ? Promise.resolve([]) : respostas(caminho)));
    render(<AbaFio leadId={LEAD} ficha={ficha()} carregando={false} aoMudar={async () => {}} />);
    await waitFor(() => expect(get).toHaveBeenCalledWith(`/trabalho/atas/ligadas?lead=${LEAD}`, 'tok'));
    expect(await screen.findByText('ata · ainda não')).toBeInTheDocument();
    expect(screen.queryByTestId('lead-atas-ligadas')).toBeNull();
  });

  it('ficha do cliente: a seção Atas lista as ligadas a ele', async () => {
    render(<AtasDoCliente clienteId={CLIENTE} />);
    const secao = await screen.findByTestId('ficha-atas');
    await waitFor(() => expect(within(secao).getByText('Conversa de proposta')).toBeInTheDocument());
    expect(get).toHaveBeenCalledWith(`/trabalho/atas/ligadas?cliente=${CLIENTE}`, 'tok');
    expect(within(secao).getByText('24/10/2026')).toBeInTheDocument();
  });

  it('ficha do cliente sem ata ligada diz onde ligar', async () => {
    get.mockImplementation(() => Promise.resolve([]));
    render(<AtasDoCliente clienteId={CLIENTE} />);
    expect(await screen.findByText(/Nenhuma ata ligada a este cliente/)).toBeInTheDocument();
  });
});
