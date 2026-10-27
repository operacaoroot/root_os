/*
 * A ABA GERAL E A ABA PENDÊNCIAS DO PAINEL DO LEAD (leva 5, L4, 27/10/2026).
 *
 * A Geral: três cartões (Quem · Origem · Negócio), campo vazio em cinza com
 * "preencher", editável no clique (Enter salva, Esc desfaz, otimista com volta
 * em erro), cada campo pelo caminho que já existia (PATCH da ficha, PUT do
 * telefone, POST do mover); "vincular a contato" lista as conversas sem
 * vínculo; a variante B mostra a linha do tempo. A Pendências: "falta
 * preencher" leva ao campo; os próximos passos têm "fazer", "marcar como
 * feito" (nota no fio), "fazer à mão" e "subir documento".
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FichaDoLead, FichaGeralExtra, PendenciasDoLead } from '@mktos/shared';

let RESPOSTAS: Record<string, unknown> = {};
const posts: { caminho: string; corpo: unknown }[] = [];
const patches: { caminho: string; corpo: unknown }[] = [];
const puts: { caminho: string; corpo: unknown }[] = [];
const gets: string[] = [];
let RESPOSTA_DO_PATCH: (caminho: string, corpo: unknown) => unknown = () => ({});

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'eu', roles: ['admin_master'] }, can: () => true }) }));
vi.mock('next/navigation', () => ({
  useParams: () => ({}),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => <a href={href} {...resto}>{children}</a>,
}));
vi.mock('@/app/comercial/_painel/historico', () => ({
  HistoricoDaEntidade: ({ aberto, entityId }: { aberto: boolean; entityId: string }) => (aberto ? <div data-testid="historico-dublê">histórico de {entityId}</div> : null),
  TIPO_DA_ENTIDADE_DO_LEAD: 'lead',
}));
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return {
    ...real,
    apiGet: vi.fn(async (caminho: string) => {
      gets.push(caminho);
      const chave = Object.keys(RESPOSTAS).sort((a, b) => b.length - a.length).find((k) => caminho.startsWith(k));
      const r = chave ? RESPOSTAS[chave] : undefined;
      if (r instanceof Error) throw r;
      if (r === undefined) throw new real.ErroDaApi('não encontrado', 404);
      return typeof r === 'function' ? (r as () => unknown)() : r;
    }),
    apiPost: vi.fn(async (caminho: string, corpo: unknown) => {
      posts.push({ caminho, corpo });
      return {};
    }),
    apiPatch: vi.fn(async (caminho: string, corpo: unknown) => {
      patches.push({ caminho, corpo });
      const r = RESPOSTA_DO_PATCH(caminho, corpo);
      if (r instanceof Error) throw r;
      return r;
    }),
    apiPut: vi.fn(async (caminho: string, corpo: unknown) => {
      puts.push({ caminho, corpo });
      return { telefone: '5532999990002', mudou: true, conversasCasadas: 0 };
    }),
  };
});

import { ProvedorDoPainel } from '@/app/comercial/_painel/provedor';

function ficha(extra: Partial<FichaDoLead> = {}): FichaDoLead {
  return {
    leadId: 'l1', nome: 'Marina Duarte', telefone: null, email: null, empresa: 'Construtora Alicerce', cnpj: null, canal: 'indicacao_cliente', origemIndicacao: null,
    perfil: 'P2', pontuacao: 70, sistemaErp: 'Omie', baseDados: true, dono: { id: 'u1', nome: 'Mesa' }, vendedor: null, valorNegociadoCentavos: null, tipoNegocio: 'pagante',
    socioDaConta: null, produto: null, valorCentavos: 1_199_700, parcelas: null, forma: null, validade: null, propostaVersao: 1, etapa: 'follow_up', etapaDesde: '2026-10-12T13:00:00.000Z',
    motivoSaida: null, voltaEm: null, saude: null, proximaAcao: null, proximasAcoesAutomaticas: [],
    portao: { proxima: 'contrato', faltando: ['aceite'], itens: [{ chave: 'resposta', rotulo: 'resposta do cliente (aceite) ou saída com motivo', cumprido: false }] },
    ligadoA: { sala: 'x', ata: true, proposta: 1, contrato: null, cobranca: null },
    fio: [
      { eventoId: 'e1', type: 'whats.recebida', fonte: 'whats', resumo: 'oi, quero saber da Operação ROOT', em: '2026-10-12T13:00:00.000Z', dia: 1 },
      { eventoId: 'e2', type: 'proposta.publicada', fonte: 'agente', resumo: 'proposta v1 publicada', em: '2026-10-13T13:00:00.000Z', dia: 2 },
    ],
    ...extra,
  };
}

const extra = (e: Partial<FichaGeralExtra> = {}): FichaGeralExtra => ({
  leadId: 'l1', tipoDePessoa: null, preferenciasDeAtendimento: null, parcelaCentavos: null, proposta: { origem: 'sala', link: null, ref: null, versao: 1 }, negocioTravado: false, ...e,
});

const pendencias = (passos: PendenciasDoLead['passos'] = [], feitos = 0): PendenciasDoLead => ({ leadId: 'l1', etapa: 'follow_up', passos, feitos, geradoEm: '2026-10-27T12:00:00.000Z' });

function irPara(url: string) {
  window.history.replaceState(null, '', url);
}

function Fundo() {
  return <main id="root-os-main" tabIndex={-1}>a tela de trás</main>;
}

beforeEach(() => {
  RESPOSTAS = {
    '/comercial/lead/l1': ficha(),
    '/comercial/lead/l1/geral': extra(),
    '/comercial/lead/l1/pendencias': pendencias(),
    '/comercial/decisoes': [],
    '/comercial/tarefas': { hoje: '2026-10-27', pessoas: [], tarefas: [] },
    '/perfil/pessoas': { pessoas: [{ id: 'u1', nome: 'Mesa', fotoUrl: null, aniversario: null, cargo: null }, { id: 'u2', nome: 'Lucas', fotoUrl: null, aniversario: null, cargo: null }] },
    '/organograma/equipe': { pessoas: [{ id: 'u1' }, { id: 'u2' }] },
    '/whatsapp/conversas': { conversas: [{ id: 'c1', grupo: false, nome: 'Marina', numero: '5532999990002', fotoUrl: null, participantes: null, equipe: false, comunidade: false, ultimaMensagemEm: null, previa: null, naoLidas: 0, vinculo: null, sugestao: null, arquivada: false }], contagens: {}, podeResponder: true, podeVincular: true, mais: false },
  };
  posts.length = 0;
  patches.length = 0;
  puts.length = 0;
  gets.length = 0;
  RESPOSTA_DO_PATCH = () => ({});
  window.localStorage.removeItem('painel.variante');
  irPara('/comercial/funil?lead=l1&aba=geral');
});

afterEach(() => {
  document.body.style.overflow = '';
  vi.restoreAllMocks();
});

describe('a aba Geral (variante A)', () => {
  it('é a primeira aba; três cartões com rótulo em cima e valor embaixo; a etapa como faixa; o vazio diz "preencher"', async () => {
    render(<ProvedorDoPainel><Fundo /></ProvedorDoPainel>);
    const dialogo = await screen.findByRole('dialog', { name: 'Construtora Alicerce' });
    expect(within(dialogo).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Geral', 'Pendências e sugestões', 'Sala', 'WhatsApp']);
    expect(within(dialogo).getByRole('tab', { name: 'Geral' })).toHaveAttribute('aria-selected', 'true');
    const geral = await within(dialogo).findByTestId('ficha-geral');
    expect(geral).toHaveAttribute('data-variante', 'A');
    for (const c of ['quem', 'origem', 'negocio']) expect(within(geral).getByTestId(`ficha-cartao-${c}`)).toBeInTheDocument();
    expect(within(geral).getByTestId('ficha-valor-empresa')).toHaveTextContent('Construtora Alicerce');
    expect(within(geral).getByTestId('ficha-valor-canal')).toHaveTextContent('Indicação de cliente');
    expect(within(geral).getByTestId('ficha-valor-tipoDePessoa')).toHaveTextContent('preencher');
    expect(within(geral).getByTestId('ficha-valor-telefone')).toHaveTextContent('preencher');
    expect(within(geral).getByTestId('ficha-valor-tipoNegocio')).toHaveTextContent('Pagante');
    expect(within(geral).getByTestId('ficha-valor-linkDaProposta')).toHaveTextContent('proposta v1 na sala');
    expect(within(geral).getByTestId('ficha-campo-etapa')).toHaveTextContent('E7 · Follow-up');
    // Nada de texto corrido: nenhum parágrafo com a ficha em frase.
    expect(within(geral).queryByText(/CNPJ ausente/)).toBeNull();
    // Os editores antigos saíram do cabeçalho.
    expect(within(dialogo).queryByTestId('lead-negocio')).toBeNull();
    expect(within(dialogo).queryByText('editar nome e empresa')).toBeNull();
  });

  it('texto: "preencher" abre o campo, Enter salva pelo PATCH da ficha e o valor aparece na hora; Esc desfaz sem gravar', async () => {
    render(<ProvedorDoPainel><Fundo /></ProvedorDoPainel>);
    const u = userEvent.setup();
    const geral = await screen.findByTestId('ficha-geral');
    await u.click(within(geral).getByTestId('ficha-valor-preferenciasDeAtendimento'));
    const campo = within(geral).getByTestId('ficha-editor-preferenciasDeAtendimento');
    await u.type(campo, 'só de manhã{Enter}');
    await waitFor(() => expect(patches).toEqual([{ caminho: '/comercial/lead/l1/ficha', corpo: { preferenciasDeAtendimento: 'só de manhã' } }]));
    // Otimista: o valor já está na tela, antes de a ficha voltar.
    expect(within(geral).getByTestId('ficha-valor-preferenciasDeAtendimento')).toHaveTextContent('só de manhã');
    // Esc desfaz.
    await u.click(within(geral).getByTestId('ficha-valor-email'));
    await u.type(within(geral).getByTestId('ficha-editor-email'), 'x@y.co');
    await u.keyboard('{Escape}');
    expect(within(geral).getByTestId('ficha-valor-email')).toHaveTextContent('preencher');
    expect(patches).toHaveLength(1);
    expect(screen.getByRole('dialog')).toBeInTheDocument(); // o Esc do campo não fechou o painel
  });

  it('se a API negar, o valor volta e o erro fica ao lado do campo', async () => {
    RESPOSTA_DO_PATCH = () => new Error('E-mail inválido.');
    render(<ProvedorDoPainel><Fundo /></ProvedorDoPainel>);
    const u = userEvent.setup();
    const geral = await screen.findByTestId('ficha-geral');
    await u.click(within(geral).getByTestId('ficha-valor-email'));
    await u.type(within(geral).getByTestId('ficha-editor-email'), 'torto{Enter}');
    await waitFor(() => expect(patches).toHaveLength(1));
    const campo = within(geral).getByTestId('ficha-campo-email');
    expect(await within(campo).findByRole('alert')).toHaveTextContent('E-mail inválido.');
    expect(within(campo).getByTestId('ficha-valor-email')).toHaveTextContent('preencher');
  });

  it('lista fechada: tipo de pessoa, como conheceu e vendedor (gente da casa) gravam ao escolher; o valor em reais vira número', async () => {
    render(<ProvedorDoPainel><Fundo /></ProvedorDoPainel>);
    const u = userEvent.setup();
    const geral = await screen.findByTestId('ficha-geral');
    await u.click(within(geral).getByTestId('ficha-valor-tipoDePessoa'));
    await u.selectOptions(within(geral).getByTestId('ficha-editor-tipoDePessoa'), 'PJ');
    await waitFor(() => expect(patches.at(-1)).toEqual({ caminho: '/comercial/lead/l1/ficha', corpo: { tipoDePessoa: 'PJ' } }));
    expect(within(geral).getByTestId('ficha-valor-tipoDePessoa')).toHaveTextContent('Pessoa jurídica');
    await u.click(within(geral).getByTestId('ficha-valor-canal'));
    const canal = within(geral).getByTestId('ficha-editor-canal');
    expect(within(canal).getAllByRole('option').map((o) => o.textContent)).toEqual(['sem informação', 'Indicação de cliente', 'Indicação de parceiro', 'BNI', 'Evento', 'Rede social', 'Site', 'Comunidade', 'Outro']);
    await u.selectOptions(canal, 'bni');
    await waitFor(() => expect(patches.at(-1)).toEqual({ caminho: '/comercial/lead/l1/ficha', corpo: { canal: 'bni' } }));
    await u.click(within(geral).getByTestId('ficha-valor-vendedorId'));
    const vendedor = await within(geral).findByTestId('ficha-editor-vendedorId');
    await waitFor(() => expect(within(vendedor).getByRole('option', { name: 'Lucas' })).toBeInTheDocument());
    await u.selectOptions(vendedor, 'u2');
    await waitFor(() => expect(patches.at(-1)).toEqual({ caminho: '/comercial/lead/l1/ficha', corpo: { vendedorId: 'u2' } }));
    await u.click(within(geral).getByTestId('ficha-valor-valorNegociado'));
    await u.type(within(geral).getByTestId('ficha-editor-valorNegociado'), '1.200,50{Enter}');
    await waitFor(() => expect(patches.at(-1)).toEqual({ caminho: '/comercial/lead/l1/ficha', corpo: { valorNegociado: 1200.5 } }));
    expect(within(geral).getByTestId('ficha-valor-valorNegociado')).toHaveTextContent('R$ 1.200,50');
  });

  it('o WhatsApp grava pela rota do vínculo; "vincular a contato" lista as conversas sem vínculo e liga a escolhida', async () => {
    render(<ProvedorDoPainel><Fundo /></ProvedorDoPainel>);
    const u = userEvent.setup();
    const geral = await screen.findByTestId('ficha-geral');
    await u.click(within(geral).getByTestId('ficha-valor-telefone'));
    await u.type(within(geral).getByTestId('ficha-editor-telefone'), '(32) 99999-0002{Enter}');
    await waitFor(() => expect(puts).toEqual([{ caminho: '/whatsapp/vinculos/lead/l1/telefone', corpo: { telefone: '(32) 99999-0002' } }]));
    await u.click(within(geral).getByTestId('ficha-whatsapp-vincular'));
    await waitFor(() => expect(gets).toContain('/whatsapp/conversas?filtro=sem_vinculo&limite=60'));
    await u.click(await within(geral).findByTestId('ficha-whatsapp-conversa-c1'));
    await waitFor(() => expect(posts).toEqual([{ caminho: '/whatsapp/vinculos/c1', corpo: { tipo: 'lead', id: 'l1' } }]));
  });

  it('a etapa é só leitura, com o mover do funil: E8 pede a confirmação com o aviso da regra; a saída pede o motivo', async () => {
    render(<ProvedorDoPainel><Fundo /></ProvedorDoPainel>);
    const u = userEvent.setup();
    const geral = await screen.findByTestId('ficha-geral');
    const mover = within(geral).getByTestId('ficha-mover');
    expect(within(mover).queryByRole('option', { name: /Follow-up/ })).toBeNull();
    await u.selectOptions(mover, 'contrato');
    const confirmar = await within(geral).findByTestId('ficha-mover-confirmar');
    expect(confirmar).toHaveTextContent(/só a etapa muda: o contrato e a cobrança nascem do aceite/);
    expect(posts).toHaveLength(0);
    await u.click(within(confirmar).getByRole('button', { name: 'mover mesmo assim' }));
    await waitFor(() => expect(posts).toEqual([{ caminho: '/comercial/lead/l1/mover', corpo: { para: 'contrato' } }]));
    await u.selectOptions(within(geral).getByTestId('ficha-mover'), 'perdido');
    const saida = await within(geral).findByTestId('ficha-mover-confirmar');
    await u.type(within(saida).getByTestId('ficha-mover-motivo'), 'fechou com outro');
    await u.click(within(saida).getByRole('button', { name: 'mover para a saída' }));
    await waitFor(() => expect(posts.at(-1)).toEqual({ caminho: '/comercial/lead/l1/mover', corpo: { para: 'perdido', motivo: 'fechou com outro' } }));
  });

  it('?campo=telefone abre o editor do WhatsApp e a lista de conversas (o "vincular WhatsApp" do menu do lead)', async () => {
    irPara('/comercial/funil?lead=l1&aba=geral&campo=telefone');
    render(<ProvedorDoPainel><Fundo /></ProvedorDoPainel>);
    const geral = await screen.findByTestId('ficha-geral');
    expect(await within(geral).findByTestId('ficha-editor-telefone')).toBeInTheDocument();
    expect(await within(geral).findByTestId('ficha-whatsapp-conversas')).toBeInTheDocument();
  });

  it('depois do aceite, produto, parcelas e 1ª parcela não se editam pela ficha', async () => {
    RESPOSTAS['/comercial/lead/l1/geral'] = extra({ negocioTravado: true, parcelaCentavos: 29_700 });
    RESPOSTAS['/comercial/lead/l1'] = ficha({ produto: 'imersao', parcelas: 10 });
    render(<ProvedorDoPainel><Fundo /></ProvedorDoPainel>);
    const geral = await screen.findByTestId('ficha-geral');
    expect((await within(geral).findAllByText('Depois do aceite, produto, parcelas e 1ª parcela são do contrato (aba Dinheiro).', { exact: false })).length).toBeGreaterThan(0);
    expect(within(geral).getByTestId('ficha-valor-produto').tagName).toBe('SPAN');
    expect(within(geral).getByTestId('ficha-valor-parcelas')).toHaveTextContent('10×');
    expect(within(geral).getByTestId('ficha-valor-parcela')).toHaveTextContent('R$ 297');
    // O valor negociado continua editável (não é do contrato).
    expect(within(geral).getByTestId('ficha-valor-valorNegociado').tagName).toBe('BUTTON');
  });
});

describe('a variante B e o Histórico', () => {
  it('a variante B põe os cartões numa coluna e a linha do tempo (5 últimos fatos) à direita; o botão alterna e guarda no navegador', async () => {
    window.localStorage.setItem('painel.variante', 'B');
    render(<ProvedorDoPainel><Fundo /></ProvedorDoPainel>);
    const u = userEvent.setup();
    const geral = await screen.findByTestId('ficha-geral');
    expect(geral).toHaveAttribute('data-variante', 'B');
    const linha = within(geral).getByTestId('ficha-linha-do-tempo');
    expect(within(linha).getAllByRole('listitem').map((l) => l.textContent)).toEqual([expect.stringContaining('proposta v1 publicada'), expect.stringContaining('oi, quero saber')]);
    // Na B a etapa mora no cartão Negócio.
    expect(within(within(geral).getByTestId('ficha-cartao-negocio')).getByTestId('ficha-campo-etapa')).toBeInTheDocument();
    await u.click(screen.getByTestId('painel-variante'));
    await waitFor(() => expect(screen.getByTestId('ficha-geral')).toHaveAttribute('data-variante', 'A'));
    expect(window.localStorage.getItem('painel.variante')).toBe('A');
  });

  it('o link "Histórico" do cabeçalho abre o AuditLog do lead; Esc fecha só ele', async () => {
    render(<ProvedorDoPainel><Fundo /></ProvedorDoPainel>);
    const u = userEvent.setup();
    await screen.findByTestId('ficha-geral');
    await u.click(screen.getByTestId('painel-historico'));
    expect(await screen.findByTestId('historico-dublê')).toHaveTextContent('histórico de l1');
    await u.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('historico-dublê')).toBeNull());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('a aba Pendências e sugestões', () => {
  it('"falta preencher" lista os vazios da Geral e um clique leva ao campo; os passos têm fazer, marcar como feito, fazer à mão e subir documento', async () => {
    irPara('/comercial/funil?lead=l1&aba=pendencias');
    RESPOSTAS['/comercial/lead/l1/pendencias'] = pendencias(
      [
        { chave: 'proxima:resposta', titulo: 'esperar a resposta do cliente', detalhe: null, origem: 'proxima_acao', quando: '2026-10-20T12:00:00.000Z', vencido: true, desde: '2026-10-12T13:00:00.000Z', acao: { tipo: 'aba', aba: 'whatsapp' }, podeFazerAMao: false, podeSubirDocumento: false },
        { chave: 'automacao:e1:contrato.na_pasta', titulo: 'A automação "contrato.na_pasta" não concluiu', detalhe: 'Drive sem permissão', origem: 'automacao', quando: null, vencido: true, desde: '2026-10-26T13:00:00.000Z', acao: null, podeFazerAMao: true, podeSubirDocumento: true },
        { chave: 'decisao:d1', titulo: 'Decisão na fila: pediu desconto', detalhe: null, origem: 'decisao', quando: null, vencido: false, desde: '2026-10-26T13:00:00.000Z', acao: { tipo: 'link', href: '/caixa?aba=decisoes' }, podeFazerAMao: false, podeSubirDocumento: false },
      ],
      2,
    );
    render(<ProvedorDoPainel><Fundo /></ProvedorDoPainel>);
    const u = userEvent.setup();
    const dialogo = await screen.findByRole('dialog');
    const preencher = await within(dialogo).findByTestId('pendencias-preencher');
    await within(preencher).findByTestId('pendencia-campo-tipoDePessoa');
    expect(within(preencher).queryByTestId('pendencia-campo-empresa')).toBeNull();
    expect(within(preencher).queryByTestId('pendencia-campo-tipoNegocio')).toBeNull();
    const passos = within(dialogo).getByTestId('pendencias-passos');
    expect(await within(passos).findByTestId('pendencias-feitos')).toHaveTextContent('2 marcados como feitos');
    expect(within(passos).getByTestId('pendencia-fazer-decisao:d1')).toHaveAttribute('href', '/caixa?aba=decisoes');
    const automacao = within(passos).getByTestId('pendencia-passo-automacao:e1:contrato.na_pasta');
    expect(automacao).toHaveTextContent('Drive sem permissão');
    expect(within(automacao).getByTestId('pendencia-a-mao-automacao:e1:contrato.na_pasta')).toBeInTheDocument();
    expect(within(automacao).getByTestId('pendencia-documento-automacao:e1:contrato.na_pasta')).toBeInTheDocument();
    // Marcar como feito grava a nota no fio com a chave do passo.
    await u.click(within(passos).getByTestId('pendencia-feito-proxima:resposta'));
    await u.click(within(passos).getByRole('button', { name: 'gravar no fio' }));
    await waitFor(() => expect(posts).toEqual([{ caminho: '/comercial/lead/l1/fio/nota', corpo: { texto: 'feito: esperar a resposta do cliente', feito: 'proxima:resposta' } }]));
    // O bloco de tarefas do lead mora aqui.
    expect(within(dialogo).getByTestId('painel-tarefas')).toBeInTheDocument();
    // "Fazer" leva à aba certa.
    await u.click(within(passos).getByTestId('pendencia-fazer-proxima:resposta'));
    expect(window.location.search).toBe('?lead=l1&aba=whatsapp');
  });

  it('um clique em "falta preencher" vai à Geral com o campo aberto', async () => {
    irPara('/comercial/funil?lead=l1&aba=pendencias');
    render(<ProvedorDoPainel><Fundo /></ProvedorDoPainel>);
    const u = userEvent.setup();
    const dialogo = await screen.findByRole('dialog');
    await u.click(await within(dialogo).findByTestId('pendencia-campo-tipoDePessoa'));
    expect(window.location.search).toBe('?lead=l1&aba=geral&campo=tipoDePessoa');
    expect(await within(dialogo).findByTestId('ficha-editor-tipoDePessoa')).toBeInTheDocument();
  });
});
