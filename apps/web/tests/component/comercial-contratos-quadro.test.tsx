/*
 * O MÓDULO DE CONTRATOS NA TELA (fase F4, 02/11/2026): o quadro com as sete colunas, o
 * cartão fantasma, a faixa sem ZapSign, o gesto que abre o passo e nunca grava, a lista
 * com o lote que volta com recusa, e a ficha na aba Contrato: retenção em Aprovações,
 * signatários, aditivo, distrato com parcela em aberto, criar contrato e o importado.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DICA_DA_ETAPA,
  ETAPAS_DO_QUADRO,
  ROTULO_DA_ETAPA_DO_QUADRO,
  acaoDoMovimento,
  type ContratoNaFicha,
  type ContratoNoQuadro,
  type ContratoVivo,
  type QuadroDeContratos,
} from '@mktos/shared';

const chamadas: { metodo: string; caminho: string; corpo?: unknown }[] = [];
let RESPOSTAS: Record<string, unknown> = {};
let RESPOSTA_DA_ESCRITA: (caminho: string, corpo: unknown) => unknown = () => ({});
let podeEditar = true;

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'eu' }, can: () => podeEditar }) }));
vi.mock('next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => <a href={href} {...resto}>{children}</a>,
}));
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  const escrita = (metodo: string) => async (caminho: string, corpo: unknown) => {
    chamadas.push({ metodo, caminho, corpo });
    const r = RESPOSTA_DA_ESCRITA(caminho, corpo);
    if (r instanceof Error) throw r;
    return r;
  };
  return {
    ...real,
    apiGet: vi.fn(async (caminho: string) => {
      const chave = Object.keys(RESPOSTAS).sort((a, b) => b.length - a.length).find((k) => caminho === k);
      if (!chave) throw new real.ErroDaApi('não encontrado', 404);
      return RESPOSTAS[chave];
    }),
    apiPost: vi.fn(escrita('post')),
    apiPut: vi.fn(escrita('put')),
    apiPatch: vi.fn(escrita('patch')),
  };
});

const painelAbrir = vi.fn();
vi.mock('@/app/comercial/_painel/provedor', async (original) => {
  const real = await original<typeof import('@/app/comercial/_painel/provedor')>();
  return {
    ...real,
    usePainel: () => ({ abrir: painelAbrir, versao: 0, hrefDoLead: (l: string) => `/x?lead=${l}`, mudou: vi.fn(), avisar: vi.fn() }),
    LinkDoLead: ({ children, leadId, aba, className, title, ...resto }: { children: React.ReactNode; leadId: string; aba?: string; className?: string; title?: string }) => (
      <a href={`/comercial/contratos?lead=${leadId}&aba=${aba}`} className={className} title={title} {...resto}>{children}</a>
    ),
    useMudouNoPainel: () => {},
  };
});

import ContratosPage from '@/app/comercial/contratos/page';
import { AbaContrato } from '@/app/comercial/_painel/AbaContrato';

function cartao(id: string, leadId: string, cliente: string, over: Partial<ContratoNoQuadro> = {}): ContratoNoQuadro {
  return {
    id, fantasma: false, leadId, cliente, contato: null, etapa: 'ativo', estado: 'ativo', modalidade: 'implantacao', numero: null,
    valorCentavos: 1_200_000, dono: 'Sócia Um', vigenciaFim: null, temPdf: true, importado: false, aditivos: 0, assinaturas: null, lacunas: null, aviso: null, ...over,
  };
}

const fantasma = cartao('sem-contrato:l1', 'l1', 'Cliente Sem Papel', { fantasma: true, etapa: 'a_emitir', estado: null, modalidade: null, temPdf: false, contato: 'Contato Um' });
const emAssinatura = cartao('c2', 'l2', 'Cliente Na Assinatura', { etapa: 'em_assinatura', estado: 'em_assinatura', temPdf: true, assinaturas: { feitas: 1, total: 3 }, dono: 'Sócio Dois' });
const ativo = cartao('c3', 'l3', 'Cliente Vigente', { numero: '2026-009', vigenciaFim: '2027-06-30' });
const encerrado = cartao('c4', 'l4', 'Cliente Encerrado', { etapa: 'encerrado', estado: 'encerrado' });
const importado = cartao('c5', 'l5', 'Cliente Importado', { importado: true, temPdf: false, estado: 'ativo' });
const importadoFim = cartao('c6', 'l6', 'Importado Encerrado', { importado: true, etapa: 'encerrado', estado: 'encerrado' });

function quadro(itens: ContratoNoQuadro[], assinaturaConfigurada = true): QuadroDeContratos {
  const porEtapa = Object.fromEntries(ETAPAS_DO_QUADRO.map((e) => [e, itens.filter((c) => c.etapa === e).length])) as QuadroDeContratos['totais']['porEtapa'];
  return { itens, totais: { contratadoCentavos: 3_866_700, porEtapa }, assinaturaConfigurada };
}

function naFicha(base: ContratoNoQuadro, over: Partial<ContratoNaFicha> = {}): ContratoNaFicha {
  return {
    ...base, tipo: 'contrato', paiId: null, vigenciaInicio: null, hashDoConteudo: null, minutaId: null, linkPdf: null, faturaPor: null, motivoDoFim: null,
    signatarios: [], documentos: [], historico: [], ultimaConferenciaEm: null, faltaParaEnviar: [], ...over,
  };
}

function vivo(leadId: string, over: Partial<ContratoVivo> = {}): ContratoVivo {
  return {
    leadId, cliente: 'x', produto: null, valorCentavos: null, descontoPct: null, parcelas: [], reguaDeCobranca: [], entregas: [], primeiroValorEm: null,
    saude: null, faseDaImplantacao: null, marcos: [], aditivos: null, situacao: 'ativo', encerramento: null, cnpj: null, socioDaConta: null, ...over,
  };
}

const PARCELA = { n: 1, total: 2, valorCentavos: 100_000, vence: '2026-12-10', estado: 'pendente' as const, pagaEm: null, aviso: null };

beforeEach(() => {
  chamadas.length = 0;
  painelAbrir.mockClear();
  podeEditar = true;
  RESPOSTA_DA_ESCRITA = () => ({});
  window.history.replaceState(null, '', '/comercial/contratos');
  RESPOSTAS = {
    '/comercial/contratos': [vivo('l3', { cnpj: '12.345.678/0001-90' })],
    '/comercial/contratos/quadro': quadro([fantasma, emAssinatura, ativo, encerrado, importado, importadoFim]),
  };
});
afterEach(cleanup);

/** Solta um cartão numa coluna pelo arrastar HTML5. */
function arrastar(id: string, etapa: string) {
  const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
  fireEvent.dragStart(screen.getByTestId(`contrato-card-${id}`), { dataTransfer });
  const coluna = screen.getByTestId(`contratos-coluna-${etapa}`);
  // `dragOver` sem `preventDefault` é o que o navegador lê como "não solte aqui".
  const aceitou = !fireEvent.dragOver(coluna, { dataTransfer });
  fireEvent.drop(coluna, { dataTransfer });
  return aceitou;
}

describe('o quadro', () => {
  it('sete colunas com rótulo e dica, "ninguém aqui" na vazia e as contagens da API no topo', async () => {
    render(<ContratosPage />);
    await screen.findByTestId('contratos-quadro');
    for (const e of ETAPAS_DO_QUADRO) {
      const coluna = within(screen.getByTestId(`contratos-coluna-${e}`));
      expect(coluna.getByText(ROTULO_DA_ETAPA_DO_QUADRO[e])).toBeInTheDocument();
      expect(coluna.getByText(DICA_DA_ETAPA[e])).toBeInTheDocument();
    }
    expect(within(screen.getByTestId('contratos-coluna-minuta')).getByText('ninguém aqui')).toBeInTheDocument();
    expect(screen.getByTestId('contratos-total-ativo')).toHaveTextContent('2');
    expect(screen.getByTestId('contratos-kpi-a_emitir')).toHaveTextContent('1');
    expect(screen.getByTestId('contratos-kpi-em_assinatura')).toHaveTextContent('1');
    expect(screen.getByTestId('contratos-kpi-contratado')).toHaveTextContent('R$ 38.667');
    // Sem exemplo inventado: os nomes da tela são só os da API.
    expect(screen.queryByText(/exemplo/i)).toBeNull();
  });

  it('o cartão fantasma é tracejado, diz "sem contrato" e abre a aba Contrato', async () => {
    render(<ContratosPage />);
    const card = await screen.findByTestId('contrato-card-sem-contrato:l1');
    expect(card).toHaveAttribute('data-fantasma', 'sim');
    expect(card.className).toContain('border-dashed');
    expect(within(card).getByText('sem contrato')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Cliente Sem Papel' })).toHaveAttribute('href', expect.stringContaining('aba=contrato'));
  });

  it('o cartão de verdade não é tracejado e conta as assinaturas com palavra', async () => {
    render(<ContratosPage />);
    const card = await screen.findByTestId('contrato-card-c2');
    expect(card.className).not.toContain('border-dashed');
    expect(within(card).getByText('1 de 3 assinaram')).toBeInTheDocument();
  });

  it('sem ZapSign a faixa diz a frase; com ZapSign ela não aparece', async () => {
    RESPOSTAS['/comercial/contratos/quadro'] = quadro([ativo], false);
    render(<ContratosPage />);
    expect(await screen.findByTestId('contratos-sem-zapsign')).toHaveTextContent('A ZapSign não está configurada nesta instância: nenhum contrato sai para assinatura.');
    cleanup();
    RESPOSTAS['/comercial/contratos/quadro'] = quadro([ativo], true);
    render(<ContratosPage />);
    await screen.findByTestId('contratos-quadro');
    expect(screen.queryByTestId('contratos-sem-zapsign')).toBeNull();
  });

  it('busca por nome, número e CNPJ (do contrato vivo), e filtra por sócio', async () => {
    render(<ContratosPage />);
    await screen.findByTestId('contratos-quadro');
    const busca = screen.getByTestId('contratos-busca-quadro');
    fireEvent.change(busca, { target: { value: '2026-009' } });
    expect(screen.queryByTestId('contrato-card-c2')).toBeNull();
    expect(screen.getByTestId('contrato-card-c3')).toBeInTheDocument();
    fireEvent.change(busca, { target: { value: '12345678' } });
    expect(screen.getByTestId('contrato-card-c3')).toBeInTheDocument();
    expect(screen.queryByTestId('contrato-card-c4')).toBeNull();
    fireEvent.change(busca, { target: { value: '' } });
    fireEvent.change(screen.getByTestId('contratos-filtro-dono'), { target: { value: 'Sócio Dois' } });
    expect(screen.getByTestId('contrato-card-c2')).toBeInTheDocument();
    expect(screen.queryByTestId('contrato-card-c3')).toBeNull();
    // As contagens do topo não filtram.
    expect(screen.getByTestId('contratos-kpi-a_emitir')).toHaveTextContent('1');
  });
});

describe('o gesto abre o passo e nunca grava', () => {
  it('arrastar para onde há ação abre a aba Contrato no passo, sem nenhuma escrita', async () => {
    render(<ContratosPage />);
    await screen.findByTestId('contratos-quadro');
    expect(arrastar('c3', 'encerrado')).toBe(true);
    expect(painelAbrir).toHaveBeenCalledWith('l3', 'contrato', null, 'encerrar');
    painelAbrir.mockClear();
    expect(arrastar('sem-contrato:l1', 'minuta')).toBe(true);
    expect(painelAbrir).toHaveBeenCalledWith('l1', 'contrato', null, 'minuta');
    painelAbrir.mockClear();
    expect(arrastar('c4', 'ativo')).toBe(true);
    expect(painelAbrir).toHaveBeenCalledWith('l4', 'contrato', null, 'reabrir');
    expect(chamadas).toEqual([]);
  });

  it('em assinatura para ativo não existe: a coluna recusa e nada abre (assinar é com a ZapSign)', async () => {
    render(<ContratosPage />);
    await screen.findByTestId('contratos-quadro');
    expect(acaoDoMovimento(emAssinatura, 'ativo')).toBeNull();
    expect(screen.getByTestId('contrato-card-c2')).toHaveAttribute('draggable', 'false');
    expect(arrastar('c2', 'ativo')).toBe(false);
    expect(painelAbrir).not.toHaveBeenCalled();
    expect(screen.queryByTestId('contrato-mover-c2')).toBeNull();
    expect(chamadas).toEqual([]);
  });

  it('o seletor "Mover" faz o mesmo que o arrasto, só com os destinos que têm ação', async () => {
    render(<ContratosPage />);
    const seletor = await screen.findByTestId('contrato-mover-c3');
    expect(within(seletor).getAllByRole('option').map((o) => o.textContent)).toEqual(['Mover', 'Encerrado: abre o encerramento']);
    fireEvent.change(seletor, { target: { value: 'encerrado' } });
    expect(painelAbrir).toHaveBeenCalledWith('l3', 'contrato', seletor, 'encerrar');
    expect(chamadas).toEqual([]);
  });

  it('importado encerrado não reabre: as rotas antigas só encerram', async () => {
    render(<ContratosPage />);
    await screen.findByTestId('contratos-quadro');
    expect(screen.getByTestId('contrato-card-c6')).toHaveAttribute('draggable', 'false');
    expect(arrastar('c6', 'ativo')).toBe(false);
    expect(painelAbrir).not.toHaveBeenCalled();
  });

  it('sem leads.editar não há arrasto nem seletor', async () => {
    podeEditar = false;
    render(<ContratosPage />);
    await screen.findByTestId('contratos-quadro');
    expect(screen.getByTestId('contrato-card-c3')).toHaveAttribute('draggable', 'false');
    expect(screen.queryByTestId('contrato-mover-c3')).toBeNull();
  });
});

describe('a lista e o lote', () => {
  beforeEach(() => window.history.replaceState(null, '', '/comercial/contratos?visao=lista'));

  it('a mesma base em tabela; o fantasma não entra no lote', async () => {
    render(<ContratosPage />);
    await screen.findByTestId('contratos-tabela');
    expect(within(screen.getByTestId('contrato-linha-c3')).getByText('Cliente Vigente')).toBeInTheDocument();
    expect(screen.getByTestId('contrato-marcar-sem-contrato:l1')).toBeDisabled();
    expect(screen.queryByTestId('contratos-lote')).toBeNull();
  });

  it('encerrar pede motivo, manda o lote e mostra cada recusado com o motivo; o recusado segue marcado', async () => {
    RESPOSTA_DA_ESCRITA = () => ({ ok: ['c3'], recusados: [{ id: 'c5', motivo: 'Contrato importado encerra pela rota antiga.' }] });
    render(<ContratosPage />);
    fireEvent.click(await screen.findByTestId('contrato-marcar-c3'));
    fireEvent.click(screen.getByTestId('contrato-marcar-c5'));
    expect(screen.getByTestId('contratos-lote')).toHaveTextContent('2 contratos marcados');
    fireEvent.click(screen.getByTestId('lote-encerrar'));
    const confirmar = screen.getByTestId('lote-confirmar');
    expect(confirmar).toBeDisabled();
    fireEvent.change(screen.getByTestId('lote-motivo'), { target: { value: 'Cliente saiu em definitivo.' } });
    fireEvent.click(confirmar);
    await waitFor(() => expect(chamadas).toEqual([{ metodo: 'post', caminho: '/comercial/contratos/lote', corpo: { acao: 'encerrar', ids: ['c3', 'c5'], motivo: 'Cliente saiu em definitivo.' } }]));
    const resultado = await screen.findByTestId('lote-resultado');
    expect(resultado).toHaveTextContent('1 contrato feito. 1 recusado.');
    expect(within(screen.getByTestId('lote-recusados')).getByRole('listitem')).toHaveTextContent('Cliente Importado: Contrato importado encerra pela rota antiga.');
    expect(screen.getByTestId('contrato-marcar-c3')).not.toBeChecked();
    expect(screen.getByTestId('contrato-marcar-c5')).toBeChecked();
  });

  it('conferir vai direto; lote retido diz Aprovações e não dá sucesso', async () => {
    RESPOSTA_DA_ESCRITA = () => ({ status: 'aguardando_aprovacao' });
    render(<ContratosPage />);
    fireEvent.click(await screen.findByTestId('contrato-marcar-c2'));
    fireEvent.click(screen.getByTestId('lote-conferir'));
    expect(await screen.findByTestId('lote-retido')).toHaveTextContent('Foi para Aprovações: outra pessoa precisa confirmar.');
    expect(chamadas[0].corpo).toEqual({ acao: 'conferir', ids: ['c2'] });
    expect(screen.queryByTestId('lote-resultado')).toBeNull();
  });

  it('erro da API fica ao lado da barra e os marcados continuam', async () => {
    RESPOSTA_DA_ESCRITA = () => new Error('A API recusou.');
    render(<ContratosPage />);
    fireEvent.click(await screen.findByTestId('contrato-marcar-c2'));
    fireEvent.click(screen.getByTestId('lote-conferir'));
    expect(await screen.findByText('A API recusou.')).toBeInTheDocument();
    expect(screen.getByTestId('contrato-marcar-c2')).toBeChecked();
  });
});

describe('o encerramento antigo continua alcançável', () => {
  it('"Parcelas e encerramento" abre a lista antiga, com Concluir e Desativar', async () => {
    render(<ContratosPage />);
    await screen.findByTestId('contratos-quadro');
    fireEvent.click(screen.getByTestId('contratos-visao-vivos'));
    expect(window.location.search).toBe('?visao=vivos');
    expect(await screen.findByTestId('contrato-concluir-l3')).toBeInTheDocument();
    expect(screen.getByTestId('contrato-desativar-l3')).toBeInTheDocument();
  });
});

describe('a aba Contrato', () => {
  const aoMudar = vi.fn(async () => {});
  const montar = (leadId: string, campo: string | null = null) => render(<AbaContrato leadId={leadId} ficha={null} campo={campo} aoMudar={aoMudar} />);

  it('lead sem contrato registrado: "Criar contrato" com a modalidade', async () => {
    montar('l1');
    fireEvent.change(await screen.findByTestId('contrato-criar-modalidade'), { target: { value: 'continuidade' } });
    fireEvent.click(screen.getByTestId('contrato-criar'));
    await waitFor(() => expect(chamadas).toEqual([{ metodo: 'post', caminho: '/comercial/contratos/registro', corpo: { leadId: 'l1', modalidade: 'continuidade' } }]));
  });

  it('criar retido não diz que criou', async () => {
    RESPOSTA_DA_ESCRITA = () => ({ status: 'aguardando_aprovacao' });
    montar('l1');
    fireEvent.click(await screen.findByTestId('contrato-criar'));
    expect(await screen.findByTestId('contrato-retido')).toHaveTextContent('Foi para Aprovações: outra pessoa precisa confirmar.');
  });

  it('em assinatura: etapas, quantas faltam, e conferir mostra a frase da API', async () => {
    RESPOSTAS['/comercial/contratos/registro/c2'] = naFicha(emAssinatura, {
      signatarios: [
        { id: 's1', ordem: 1, papel: 'cliente', nome: 'Pessoa Um', email: 'um@exemplo.test', assinadoEm: '2026-10-31T12:12:00.000Z' },
        { id: 's2', ordem: 2, papel: 'cliente', nome: 'Pessoa Dois', email: 'dois@exemplo.test', assinadoEm: null },
        { id: 's3', ordem: 3, papel: 'root', nome: 'Pessoa Três', email: 'tres@exemplo.test', assinadoEm: null },
      ],
    });
    RESPOSTA_DA_ESCRITA = () => ({ contratoId: 'c2', estado: 'em_assinatura', mudou: false, assinaturas: { feitas: 1, total: 3 }, frase: 'Conferido: nada mudou.' });
    montar('l2');
    expect(await screen.findByTestId('contrato-faltam')).toHaveTextContent('Faltam 2 assinaturas.');
    expect(within(screen.getByTestId('contrato-etapas')).getByText('Em assinatura').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('signatario-s1')).toHaveTextContent('assinou 31/10/2026');
    expect(screen.getByTestId('signatario-s2')).toHaveTextContent('pendente');
    // Sem envio, a edição de quem assina não aparece.
    expect(screen.queryByTestId('signatarios-editar')).toBeNull();
    fireEvent.click(screen.getByTestId('contrato-conferir'));
    expect(await screen.findByText('Conferido: nada mudou.')).toBeInTheDocument();
    expect(chamadas[0].caminho).toBe('/comercial/contratos/registro/c2/conferir');
  });

  it('ação retida vai para Aprovações, nunca com sucesso falso', async () => {
    RESPOSTAS['/comercial/contratos/registro/c2'] = naFicha(emAssinatura);
    RESPOSTA_DA_ESCRITA = () => ({ status: 'aguardando_aprovacao', approvalId: 'ap1' });
    montar('l2');
    fireEvent.click(await screen.findByTestId('contrato-reenviar'));
    expect(await screen.findByTestId('contrato-retido')).toHaveTextContent('Foi para Aprovações: outra pessoa precisa confirmar.');
    expect(screen.queryByText('Reenvio registrado.')).toBeNull();
  });

  it('cancelar o envio pede motivo; retido, o formulário fica aberto', async () => {
    RESPOSTAS['/comercial/contratos/registro/c2'] = naFicha(emAssinatura);
    RESPOSTA_DA_ESCRITA = () => ({ status: 'aguardando_aprovacao' });
    montar('l2');
    fireEvent.click(await screen.findByTestId('contrato-cancelar'));
    const confirmar = screen.getByTestId('contrato-cancelar-confirmar');
    expect(confirmar).toBeDisabled();
    fireEvent.change(screen.getByTestId('contrato-motivo'), { target: { value: 'Valor errado na minuta.' } });
    fireEvent.click(confirmar);
    await waitFor(() => expect(chamadas).toEqual([{ metodo: 'post', caminho: '/comercial/contratos/registro/c2/cancelar', corpo: { motivo: 'Valor errado na minuta.' } }]));
    expect(await screen.findByTestId('contrato-retido')).toBeInTheDocument();
    expect(screen.getByTestId('contrato-cancelar-confirmar')).toBeInTheDocument();
  });

  it('sem ZapSign: a faixa aparece e conferir e reenviar ficam travados', async () => {
    RESPOSTAS['/comercial/contratos/quadro'] = quadro([emAssinatura], false);
    RESPOSTAS['/comercial/contratos/registro/c2'] = naFicha(emAssinatura);
    montar('l2');
    expect(await screen.findByTestId('contrato-sem-zapsign')).toBeInTheDocument();
    expect(await screen.findByTestId('contrato-conferir')).toBeDisabled();
    expect(screen.getByTestId('contrato-reenviar')).toBeDisabled();
  });

  it('o gesto de encerrar chega com o formulário aberto; parcela em aberto pede a ciência', async () => {
    RESPOSTAS['/comercial/contratos/registro/c3'] = naFicha(ativo);
    RESPOSTAS['/comercial/contratos/l3'] = vivo('l3', { parcelas: [PARCELA] });
    montar('l3', 'encerrar');
    const confirmar = await screen.findByTestId('contrato-encerrar-confirmar');
    fireEvent.change(screen.getByTestId('contrato-motivo'), { target: { value: 'Fim do escopo combinado.' } });
    expect(await screen.findByTestId('contrato-parcelas-em-aberto')).toHaveTextContent('1 parcela em aberto.');
    expect(confirmar).toBeDisabled();
    fireEvent.click(screen.getByTestId('contrato-parcelas-ciente'));
    expect(confirmar).toBeEnabled();
    fireEvent.click(confirmar);
    await waitFor(() => expect(chamadas).toEqual([{ metodo: 'post', caminho: '/comercial/contratos/registro/c3/encerrar', corpo: { motivo: 'Fim do escopo combinado.', cienteDasParcelas: true } }]));
  });

  it('sem conseguir ler as parcelas, não supõe zero: pede a ciência', async () => {
    RESPOSTAS['/comercial/contratos/registro/c3'] = naFicha(ativo);
    montar('l3', 'encerrar');
    expect(await screen.findByTestId('contrato-parcelas-em-aberto')).toHaveTextContent('Não deu para ler as parcelas agora.');
  });

  it('antes do envio: lista o que falta e edita quem assina, com assinatura conjunta', async () => {
    const minuta = cartao('c7', 'l7', 'Cliente Na Minuta', { etapa: 'minuta', estado: 'rascunho' });
    RESPOSTAS['/comercial/contratos/quadro'] = quadro([minuta]);
    RESPOSTAS['/comercial/contratos/registro/c7'] = naFicha(minuta, { faltaParaEnviar: ['Falta o CNPJ que fatura.'] });
    montar('l7', 'envio');
    expect(await screen.findByTestId('contrato-falta-para-enviar')).toHaveTextContent('Falta o CNPJ que fatura.');
    expect(screen.getByTestId('signatarios-vazio')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('signatarios-editar'));
    const salvar = screen.getByTestId('signatarios-salvar');
    expect(salvar).toBeDisabled();
    fireEvent.change(screen.getByTestId('signatario-nome-0'), { target: { value: 'Pessoa Um' } });
    fireEvent.change(screen.getByTestId('signatario-email-0'), { target: { value: 'um@exemplo.test' } });
    fireEvent.click(screen.getByTestId('signatario-mais-cliente'));
    fireEvent.change(screen.getByTestId('signatario-nome-2'), { target: { value: 'Pessoa Dois' } });
    fireEvent.change(screen.getByTestId('signatario-email-2'), { target: { value: 'dois@exemplo.test' } });
    fireEvent.change(screen.getByTestId('signatario-nome-1'), { target: { value: 'Pessoa Três' } });
    fireEvent.change(screen.getByTestId('signatario-email-1'), { target: { value: 'um@exemplo.test' } });
    expect(screen.getByTestId('signatarios-problema')).toHaveTextContent('O mesmo e-mail aparece em dois signatários.');
    fireEvent.change(screen.getByTestId('signatario-email-1'), { target: { value: 'tres@exemplo.test' } });
    fireEvent.click(salvar);
    await waitFor(() => expect(chamadas).toEqual([{
      metodo: 'put',
      caminho: '/comercial/contratos/registro/c7/signatarios',
      corpo: { signatarios: [
        { papel: 'cliente', nome: 'Pessoa Um', email: 'um@exemplo.test' },
        { papel: 'root', nome: 'Pessoa Três', email: 'tres@exemplo.test' },
        { papel: 'cliente', nome: 'Pessoa Dois', email: 'dois@exemplo.test' },
      ] },
    }]));
  });

  it('os dados mandam só o que mudou, e o CNPJ que fatura é texto', async () => {
    RESPOSTAS['/comercial/contratos/registro/c3'] = naFicha(ativo, { faturaPor: null });
    montar('l3');
    const salvar = await screen.findByTestId('contrato-dados-salvar');
    expect(salvar).toBeDisabled();
    fireEvent.change(screen.getByTestId('contrato-fatura-por'), { target: { value: 'CNPJ que fatura' } });
    fireEvent.click(salvar);
    await waitFor(() => expect(chamadas).toEqual([{ metodo: 'patch', caminho: '/comercial/contratos/registro/c3', corpo: { faturaPor: 'CNPJ que fatura' } }]));
  });

  it('o que veio da API não conta como texto não salvo; o que a pessoa escreveu conta', async () => {
    RESPOSTAS['/comercial/contratos/registro/c3'] = naFicha(ativo);
    montar('l3');
    const numero = await screen.findByTestId('contrato-numero');
    expect(numero).toHaveValue('2026-009');
    expect(numero).toHaveAttribute('data-painel-ignorar');
    fireEvent.change(numero, { target: { value: '2026-010' } });
    expect(numero).not.toHaveAttribute('data-painel-ignorar');
  });

  it('aditivo: o que muda vira linha, com o valor em centavos', async () => {
    RESPOSTAS['/comercial/contratos/registro/c3'] = naFicha(ativo);
    montar('l3');
    fireEvent.click(await screen.findByTestId('contrato-novo-aditivo'));
    expect(screen.getByTestId('filho-hoje')).toHaveTextContent('R$ 12.000');
    fireEvent.change(screen.getByTestId('filho-novo'), { target: { value: '4.200,00' } });
    fireEvent.change(screen.getByTestId('filho-vale-de'), { target: { value: '2026-12-01' } });
    fireEvent.change(screen.getByTestId('filho-motivo'), { target: { value: 'Segunda frente de atendimento.' } });
    fireEvent.click(screen.getByTestId('filho-criar'));
    await waitFor(() => expect(chamadas).toEqual([{
      metodo: 'post',
      caminho: '/comercial/contratos/registro/c3/filhos',
      corpo: { tipo: 'aditivo', motivo: 'Segunda frente de atendimento.', valorCentavos: 420_000, mudancas: 'Valor: R$ 4.200, a partir de 01/12/2026' },
    }]));
  });

  it('distrato: última data, motivo, e a ciência das parcelas em aberto', async () => {
    RESPOSTAS['/comercial/contratos/registro/c3'] = naFicha(ativo);
    RESPOSTAS['/comercial/contratos/l3'] = vivo('l3', { parcelas: [PARCELA, { ...PARCELA, n: 2 }] });
    montar('l3');
    fireEvent.click(await screen.findByTestId('contrato-novo-distrato'));
    fireEvent.change(screen.getByTestId('filho-ultima-data'), { target: { value: '2026-11-30' } });
    fireEvent.change(screen.getByTestId('filho-motivo'), { target: { value: 'Cliente não segue com a segunda fase.' } });
    const criar = screen.getByTestId('filho-criar');
    expect(await screen.findByTestId('contrato-parcelas-em-aberto')).toHaveTextContent('2 parcelas em aberto. O distrato não cancela a cobrança');
    expect(criar).toBeDisabled();
    fireEvent.click(screen.getByTestId('contrato-parcelas-ciente'));
    fireEvent.click(criar);
    await waitFor(() => expect(chamadas[0]).toEqual({
      metodo: 'post',
      caminho: '/comercial/contratos/registro/c3/filhos',
      corpo: { tipo: 'distrato', motivo: 'Cliente não segue com a segunda fase.', vigenciaFim: '2026-11-30' },
    }));
  });

  it('aditivo e distrato retidos não fecham o formulário nem dizem que criaram', async () => {
    RESPOSTAS['/comercial/contratos/registro/c3'] = naFicha(ativo);
    RESPOSTA_DA_ESCRITA = () => ({ status: 'aguardando_aprovacao' });
    montar('l3');
    fireEvent.click(await screen.findByTestId('contrato-novo-aditivo'));
    fireEvent.change(screen.getByTestId('filho-novo'), { target: { value: '100' } });
    fireEvent.change(screen.getByTestId('filho-motivo'), { target: { value: 'Motivo suficiente.' } });
    fireEvent.click(screen.getByTestId('filho-criar'));
    expect(await screen.findByTestId('filho-retido')).toBeInTheDocument();
    expect(screen.getByTestId('contrato-filho-form')).toBeInTheDocument();
  });

  it('"Gerar minuta" abre o bloco que já existe só no clique', async () => {
    RESPOSTAS['/comercial/contratos/registro/c3'] = naFicha(ativo);
    montar('l3');
    fireEvent.click(await screen.findByTestId('contrato-abrir-minuta'));
    expect(await screen.findByText(/A minuta parte da proposta aceita/)).toBeInTheDocument();
  });

  it('contrato importado mostra o que sempre mostrou e encerra pela rota antiga', async () => {
    RESPOSTAS['/comercial/contratos/quadro'] = quadro([importado]);
    RESPOSTAS['/comercial/contratos/l5'] = vivo('l5', {
      importados: [{ origem: 'cartao:1', titulo: 'Contrato um', produtoRotulo: 'Operação', valorCentavos: 100_000, fechadoEm: '2026-07-01', semDocumento: true }],
    });
    montar('l5', 'encerrar');
    expect(await screen.findByTestId('contratos-importados')).toBeInTheDocument();
    expect(screen.getByTestId('contrato-importado-anexar')).toBeInTheDocument();
    expect(screen.queryByTestId('ficha-contrato')).toBeNull();
    fireEvent.click(screen.getByTestId('contrato-concluir-l5'));
    fireEvent.change(screen.getByTestId('contrato-motivo'), { target: { value: 'Escopo entregue.' } });
    fireEvent.click(screen.getByTestId('contrato-confirmar'));
    await waitFor(() => expect(chamadas).toEqual([{ metodo: 'post', caminho: '/comercial/contratos/l5/encerrar', corpo: { situacao: 'concluido', motivo: 'Escopo entregue.' } }]));
    await act(async () => { await Promise.resolve(); });
  });

  it('nenhum texto da aba leva travessão', async () => {
    RESPOSTAS['/comercial/contratos/registro/c2'] = naFicha(emAssinatura);
    const { container } = montar('l2');
    await screen.findByTestId('ficha-contrato');
    expect(container.textContent).not.toMatch(/[–—]/);
  });
});
