/*
 * A EMISSÃO NA ABA CONTRATO (Contratos, F2, 02/11/2026): os quatro passos do mockup, a lista do que falta vinda da API,
 * o botão travado, a retenção R4 com a frase certa, o passo do arrasto levando à seção, o "+ contrato", a prévia com o
 * 409 da lacuna, aditivo em rascunho e o que a ficha faz com a API de verdade (PDF relativo, cancelado não reabre).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContratoNaFicha, ContratoNoQuadro, EmissaoNaFicha, QuadroDeContratos } from '@mktos/shared';

const chamadas: { metodo: string; caminho: string; corpo?: unknown }[] = [];
let RESPOSTAS: Record<string, unknown> = {};
let RESPOSTA_DA_ESCRITA: (caminho: string, corpo: unknown) => unknown = () => ({});
let BLOB: () => Blob | Error = () => new Blob(['%PDF-']);
const pedidosDeBlob: string[] = [];
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
      if (!(caminho in RESPOSTAS)) throw new real.ErroDaApi('não encontrado', 404);
      return RESPOSTAS[caminho];
    }),
    apiBlob: vi.fn(async (caminho: string) => {
      pedidosDeBlob.push(caminho);
      const b = BLOB();
      if (b instanceof Error) throw b;
      return b;
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
import { ErroDaApi } from '@/lib/api';
import { passoDoCampo } from '@/app/comercial/_contratos/regras';

function cartao(id: string, leadId: string, over: Partial<ContratoNoQuadro> = {}): ContratoNoQuadro {
  return { id, fantasma: false, leadId, cliente: 'Padaria Modelo', contato: null, etapa: 'minuta', estado: 'rascunho', modalidade: 'implantacao', numero: null, valorCentavos: 1_200_000, dono: null, vigenciaFim: null, temPdf: false, importado: false, aditivos: 0, assinaturas: null, lacunas: 2, aviso: null, ...over };
}

const EMISSAO: EmissaoNaFicha = {
  temAceite: true,
  molde: { titulo: 'CONTRATO DE IMPLANTAÇÃO', data: '2026-10-26' },
  campos: [
    { nome: 'contratante_nome', rotulo: 'Razão social do contratante', tipo: 'texto', fonte: 'aceite', valor: 'Padaria Modelo Ltda' },
    { nome: 'objeto_implantacao', rotulo: 'O que será implantado', tipo: 'texto', fonte: 'falta', valor: null },
    { nome: 'entregas', rotulo: 'Entregas (uma por linha)', tipo: 'lista', fonte: 'contrato', valor: ['A base'] },
    { nome: 'credito_continuidade', rotulo: 'Abater o valor', tipo: 'opcional', fonte: 'falta', valor: null },
  ],
  minuta: {
    documentoId: 'doc1', hash: 'h'.repeat(64), conteudo: '# CONTRATO\n\nObjeto: ⟦lacuna: objeto_implantacao⟧.', origem: 'sistema', base: 'molde', geradaEm: '2026-11-02T12:00:00.000Z',
    lacunas: ['objeto_implantacao'], avisos: ['sem modelo nesta instância: a minuta é a que o sistema preencheu sozinho'],
    laudo: { apontamentos: [{ gravidade: 'alta', regra: 'lacuna_aberta', titulo: 'Lacuna aberta: objeto_implantacao', trecho: null, detalhe: 'preencha', origem: 'regra' }], geradoEm: '2026-11-02T12:00:00.000Z', porModelo: false, avisos: [], hashDaMinuta: 'h'.repeat(64) },
    desatualizada: false,
  },
  titulares: [{ nome: 'Titular Um', email: 'titular@root.test' }],
  envioNaFila: null,
};

function naFicha(base: ContratoNoQuadro, over: Partial<ContratoNaFicha> = {}): ContratoNaFicha {
  return { ...base, tipo: 'contrato', paiId: null, vigenciaInicio: null, hashDoConteudo: 'h'.repeat(64), minutaId: 'doc1', linkPdf: null, faturaPor: '11.111.111/0001-11', motivoDoFim: null, signatarios: [], documentos: [], historico: [], ultimaConferenciaEm: null, faltaParaEnviar: ['Preencher a lacuna: objeto_implantacao.', 'Quem assina pela Root, entre os titulares.'], emissao: EMISSAO, ...over };
}

const quadro = (itens: ContratoNoQuadro[], assinaturaConfigurada = true): QuadroDeContratos => ({
  itens,
  assinaturaConfigurada,
  totais: { contratadoCentavos: 0, porEtapa: { a_emitir: 0, minuta: 0, em_assinatura: 0, ativo: 0, renovar: 0, a_encerrar: 0, encerrado: 0 } },
});

const c1 = cartao('c1', 'l1');
const aoMudar = vi.fn(async () => {});
const montar = (campo: string | null = null) => render(<AbaContrato leadId="l1" campo={campo} aoMudar={aoMudar} />);

beforeEach(() => {
  chamadas.length = 0;
  pedidosDeBlob.length = 0;
  painelAbrir.mockClear();
  podeEditar = true;
  BLOB = () => new Blob(['%PDF-']);
  RESPOSTA_DA_ESCRITA = () => ({});
  RESPOSTAS = {
    '/comercial/contratos/quadro': quadro([c1]),
    '/comercial/contratos/registro/c1': naFicha(c1),
    '/comercial/contratos': [],
  };
  window.history.replaceState(null, '', '/comercial/contratos');
});
afterEach(cleanup);

describe('a seção Emitir', () => {
  it('traz os quatro passos, a minuta com lacuna, o aviso, e o botão travado com a lista que veio da API', async () => {
    montar();
    const emitir = await screen.findByTestId('contrato-emitir');
    expect(within(emitir).getByRole('region', { name: 'Qual contrato' })).toBeInTheDocument();
    expect(within(emitir).getByRole('region', { name: 'Dados que entram no molde' })).toBeInTheDocument();
    expect(within(emitir).getByRole('region', { name: 'quem assina' })).toBeInTheDocument();
    expect(within(emitir).getByRole('region', { name: 'Laudo do revisor' })).toBeInTheDocument();
    expect(screen.getByTestId('emitir-do-aceite')).toHaveTextContent('Padaria Modelo Ltda');
    expect(screen.getByTestId('emitir-do-aceite')).toHaveTextContent('da proposta aceita');
    expect(screen.getByTestId('emitir-lacunas')).toHaveTextContent('objeto_implantacao');
    expect(screen.getByTestId('emitir-avisos')).toHaveTextContent('sem modelo nesta instância');
    expect(screen.getByTestId('contrato-falta-para-enviar')).toHaveTextContent('Faltam 2 itens');
    expect(screen.getByTestId('contrato-falta-para-enviar')).toHaveTextContent('Preencher a lacuna: objeto_implantacao.');
    expect(screen.getByTestId('contrato-pedir-envio')).toBeDisabled();
  });

  it('salvar manda só o que mudou, lista vira lista, campo apagado vai nulo; gerar fica travado até salvar', async () => {
    montar();
    fireEvent.change(await screen.findByTestId('emitir-campo-objeto_implantacao'), { target: { value: 'um sistema de pedidos' } });
    fireEvent.change(screen.getByTestId('emitir-campo-entregas'), { target: { value: 'A base\n\nA rotina' } });
    fireEvent.change(screen.getByTestId('emitir-campo-credito_continuidade'), { target: { value: 'nao' } });
    fireEvent.change(screen.getByTestId('emitir-fatura-por'), { target: { value: '22.222.222/0001-22' } });
    expect(screen.getByTestId('emitir-gerar-minuta')).toBeDisabled();
    fireEvent.click(screen.getByTestId('emitir-salvar-dados'));
    await waitFor(() => expect(chamadas).toEqual([{
      metodo: 'patch',
      caminho: '/comercial/contratos/registro/c1',
      corpo: { campos: { objeto_implantacao: 'um sistema de pedidos', entregas: ['A base', 'A rotina'], credito_continuidade: 'nao' }, faturaPor: '22.222.222/0001-22' },
    }]));
    await waitFor(() => expect(screen.getByTestId('emitir-gerar-minuta')).toBeEnabled());
    fireEvent.click(screen.getByTestId('emitir-gerar-minuta'));
    await waitFor(() => expect(chamadas[1]).toEqual({ metodo: 'post', caminho: '/comercial/contratos/registro/c1/minuta', corpo: {} }));
  });

  it('trocar a modalidade é PATCH; o revisor roda de novo pela rota do registro', async () => {
    montar();
    fireEvent.click(await screen.findByTestId('emitir-modalidade-continuidade'));
    await waitFor(() => expect(chamadas[0]).toEqual({ metodo: 'patch', caminho: '/comercial/contratos/registro/c1', corpo: { modalidade: 'continuidade' } }));
    await waitFor(() => expect(screen.getByTestId('emitir-revisar')).toBeEnabled());
    fireEvent.click(screen.getByTestId('emitir-revisar'));
    await waitFor(() => expect(chamadas[1]).toEqual({ metodo: 'post', caminho: '/comercial/contratos/registro/c1/revisar', corpo: {} }));
  });

  it('nada faltando: pedir responde retida, com a frase do R4 e sem dizer que enviou', async () => {
    RESPOSTAS['/comercial/contratos/registro/c1'] = naFicha(c1, { faltaParaEnviar: [] });
    RESPOSTA_DA_ESCRITA = () => ({ status: 'aguardando_aprovacao', approvalId: 'a1' });
    montar();
    const botao = await screen.findByTestId('contrato-pedir-envio');
    expect(screen.getByTestId('contrato-falta-para-enviar')).toHaveTextContent('Nada saiu para assinatura ainda.');
    fireEvent.click(botao);
    expect(await screen.findByTestId('contrato-envio-retido')).toHaveTextContent('Foi para Aprovações: outra pessoa titular precisa confirmar com a senha');
    expect(chamadas[0]).toEqual({ metodo: 'post', caminho: '/comercial/contratos/registro/c1/enviar', corpo: {} });
    expect(screen.queryByText(/enviado/i)).toBeNull();
    expect(screen.getByTestId('contrato-pedir-envio')).toBeDisabled();
  });

  it('pedido já na fila aparece ao reabrir, com o botão travado', async () => {
    RESPOSTAS['/comercial/contratos/registro/c1'] = naFicha(c1, { faltaParaEnviar: [], emissao: { ...EMISSAO, envioNaFila: 'a9' } });
    montar();
    expect(await screen.findByTestId('contrato-envio-retido')).toBeInTheDocument();
    expect(screen.getByTestId('contrato-pedir-envio')).toBeDisabled();
  });

  it('a recusa do envio mostra a lista que a API mandou', async () => {
    RESPOSTAS['/comercial/contratos/registro/c1'] = naFicha(c1, { faltaParaEnviar: [] });
    RESPOSTA_DA_ESCRITA = () => new ErroDaApi('Ainda falta o que está na lista.', 409, null, ['Preencher a lacuna: foro.']);
    montar();
    fireEvent.click(await screen.findByTestId('contrato-pedir-envio'));
    expect(await screen.findByText('Preencher a lacuna: foro.')).toBeInTheDocument();
    expect(screen.queryByTestId('contrato-envio-retido')).toBeNull();
  });

  it('sem ZapSign, nada falta na lista mas o botão fica travado, e a faixa diz', async () => {
    RESPOSTAS['/comercial/contratos/quadro'] = quadro([c1], false);
    RESPOSTAS['/comercial/contratos/registro/c1'] = naFicha(c1, { faltaParaEnviar: [] });
    montar();
    expect(await screen.findByTestId('contrato-pedir-envio')).toBeDisabled();
    expect(screen.getByTestId('contrato-sem-zapsign')).toBeInTheDocument();
  });

  it('sem minuta, o laudo e a prévia dizem que ainda não há; sem aceite, avisa', async () => {
    RESPOSTAS['/comercial/contratos/registro/c1'] = naFicha(c1, { minutaId: null, emissao: { ...EMISSAO, temAceite: false, minuta: null } });
    montar();
    expect(await screen.findByTestId('emitir-sem-aceite')).toBeInTheDocument();
    expect(screen.queryByTestId('emitir-abrir-previa')).toBeNull();
    expect(screen.getByTestId('emitir-gerar-minuta')).toHaveTextContent('Gerar minuta');
    expect(screen.getByTestId('emitir-previa')).toHaveTextContent('Ainda não há minuta');
  });

  it('minuta velha avisa', async () => {
    RESPOSTAS['/comercial/contratos/registro/c1'] = naFicha(c1, { emissao: { ...EMISSAO, minuta: { ...EMISSAO.minuta!, desatualizada: true } } });
    montar();
    expect(await screen.findByTestId('emitir-desatualizada')).toHaveTextContent('Gere de novo');
  });

  it('o titular se escolhe pela lista, na linha da Root', async () => {
    montar();
    fireEvent.click(await screen.findByTestId('signatarios-editar'));
    fireEvent.change(screen.getByTestId('signatario-titular-1'), { target: { value: 'titular@root.test' } });
    expect(screen.getByTestId('signatario-nome-1')).toHaveValue('Titular Um');
    expect(screen.getByTestId('signatario-email-1')).toHaveValue('titular@root.test');
  });

  it('sem leads.editar: lê tudo, não pede nada', async () => {
    podeEditar = false;
    montar();
    await screen.findByTestId('contrato-emitir');
    expect(screen.queryByTestId('contrato-pedir-envio')).toBeNull();
    expect(screen.queryByTestId('emitir-gerar-minuta')).toBeNull();
    expect(screen.getByTestId('emitir-campo-objeto_implantacao')).toBeDisabled();
  });
});

describe('a seção some e o passo do arrasto chega nela', () => {
  it('em assinatura ou assinado, não há Emitir nem o botão', async () => {
    const c = cartao('c1', 'l1', { etapa: 'ativo', estado: 'ativo', temPdf: true });
    RESPOSTAS['/comercial/contratos/quadro'] = quadro([c]);
    RESPOSTAS['/comercial/contratos/registro/c1'] = naFicha(c, { emissao: null, faltaParaEnviar: [] });
    montar();
    await screen.findByTestId('ficha-contrato');
    expect(screen.queryByTestId('contrato-emitir')).toBeNull();
    expect(screen.queryByTestId('contrato-pedir-envio')).toBeNull();
  });

  it('campo=gerar_minuta e campo=pedir_aprovacao levam à seção', async () => {
    expect(passoDoCampo('gerar_minuta')).toBe('minuta');
    expect(passoDoCampo('pedir_aprovacao')).toBe('envio');
    expect(passoDoCampo('outra')).toBeNull();
    montar('pedir_aprovacao');
    expect(await screen.findByTestId('contrato-emitir')).toHaveAttribute('data-passo', 'envio');
  });
});

describe('a prévia', () => {
  const fechar = vi.fn();
  beforeEach(() => {
    fechar.mockClear();
    vi.stubGlobal('open', vi.fn(() => ({ close: fechar, location: { href: '' } })));
    URL.createObjectURL = vi.fn(() => 'blob:previa');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('abre o previa.pdf com o token, numa aba', async () => {
    montar();
    fireEvent.click(await screen.findByTestId('emitir-abrir-previa'));
    await waitFor(() => expect(pedidosDeBlob).toEqual(['/comercial/contratos/registro/c1/previa.pdf']));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(fechar).not.toHaveBeenCalled();
  });

  it('o 409 da lacuna fecha a aba e mostra a lista', async () => {
    BLOB = () => new ErroDaApi('O PDF não sai enquanto houver lacuna.', 409, null, ['Preencher a lacuna: objeto_implantacao.']);
    montar();
    fireEvent.click(await screen.findByTestId('emitir-abrir-previa'));
    expect(await screen.findByText('O PDF não sai enquanto houver lacuna.')).toBeInTheDocument();
    expect(within(screen.getByTestId('emitir-previa')).getByRole('alert')).toHaveTextContent('Preencher a lacuna: objeto_implantacao.');
    expect(fechar).toHaveBeenCalled();
  });

  it('o PDF de caminho relativo (anexo guardado no OS) vai pela API com token, nunca como link do site', async () => {
    const c = cartao('c1', 'l1', { etapa: 'ativo', estado: 'ativo', temPdf: true });
    RESPOSTAS['/comercial/contratos/quadro'] = quadro([c]);
    RESPOSTAS['/comercial/contratos/registro/c1'] = naFicha(c, {
      emissao: null,
      linkPdf: '/comercial/lead/l1/contrato-anexado',
      documentos: [{ id: 'c1', tipo: 'contrato', titulo: 'Contrato', estado: 'ativo', numero: null, temPdf: true, assinadoEm: null }],
    });
    montar();
    fireEvent.click(await screen.findByTestId('contrato-abrir-pdf'));
    await waitFor(() => expect(pedidosDeBlob).toEqual(['/comercial/lead/l1/contrato-anexado']));
  });
});

describe('o aditivo em rascunho', () => {
  it('"Emitir" abre a mesma seção sobre a ficha do aditivo, sem o passo da modalidade', async () => {
    const pai = cartao('c1', 'l1', { etapa: 'ativo', estado: 'ativo', temPdf: true });
    const filho = cartao('f1', 'l1');
    RESPOSTAS['/comercial/contratos/quadro'] = quadro([pai]);
    RESPOSTAS['/comercial/contratos/registro/c1'] = naFicha(pai, { emissao: null, faltaParaEnviar: [], documentos: [{ id: 'c1', tipo: 'contrato', titulo: 'Contrato', estado: 'ativo', numero: null, temPdf: true, assinadoEm: null }, { id: 'f1', tipo: 'aditivo', titulo: 'Aditivo', estado: 'rascunho', numero: null, temPdf: false, assinadoEm: null }] });
    RESPOSTAS['/comercial/contratos/registro/f1'] = naFicha(filho, { tipo: 'aditivo', paiId: 'c1', faltaParaEnviar: [] , emissao: { ...EMISSAO, molde: null, campos: [] } });
    RESPOSTA_DA_ESCRITA = () => ({ status: 'aguardando_aprovacao', approvalId: 'a2' });
    montar();
    fireEvent.click(await screen.findByTestId('documento-emitir-f1'));
    const botao = await screen.findByTestId('contrato-pedir-envio');
    expect(screen.queryByRole('region', { name: 'Qual contrato' })).toBeNull();
    fireEvent.click(botao);
    await waitFor(() => expect(chamadas[0].caminho).toBe('/comercial/contratos/registro/f1/enviar'));
  });
});

describe('o encaixe com a API de verdade', () => {
  it('cancelado não oferece reabrir; encerrado reabre sem motivo; antes do envio dá para cancelar', async () => {
    const cancelado = cartao('c1', 'l1', { etapa: 'encerrado', estado: 'cancelado' });
    RESPOSTAS['/comercial/contratos/quadro'] = quadro([cancelado]);
    RESPOSTAS['/comercial/contratos/registro/c1'] = naFicha(cancelado, { emissao: null, faltaParaEnviar: [] });
    const { unmount } = montar();
    await screen.findByTestId('contrato-fim');
    expect(screen.queryByTestId('contrato-reabrir')).toBeNull();
    unmount();

    const encerrado = cartao('c1', 'l1', { etapa: 'encerrado', estado: 'encerrado' });
    RESPOSTAS['/comercial/contratos/quadro'] = quadro([encerrado]);
    RESPOSTAS['/comercial/contratos/registro/c1'] = naFicha(encerrado, { emissao: null, faltaParaEnviar: [] });
    const segundo = montar();
    fireEvent.click(await screen.findByTestId('contrato-reabrir'));
    fireEvent.click(screen.getByTestId('contrato-reabrir-confirmar'));
    await waitFor(() => expect(chamadas[0]).toEqual({ metodo: 'post', caminho: '/comercial/contratos/registro/c1/reabrir', corpo: {} }));
    segundo.unmount();

    chamadas.length = 0;
    RESPOSTAS['/comercial/contratos/quadro'] = quadro([c1]);
    RESPOSTAS['/comercial/contratos/registro/c1'] = naFicha(c1);
    montar();
    fireEvent.click(await screen.findByTestId('contrato-cancelar'));
    fireEvent.change(screen.getByTestId('contrato-motivo'), { target: { value: 'Criado no lead errado.' } });
    fireEvent.click(screen.getByTestId('contrato-cancelar-confirmar'));
    await waitFor(() => expect(chamadas[0]).toEqual({ metodo: 'post', caminho: '/comercial/contratos/registro/c1/cancelar', corpo: { motivo: 'Criado no lead errado.' } }));
  });
});

describe('+ contrato no quadro', () => {
  const fantasma = cartao('sem-contrato:l9', 'l9', { fantasma: true, cliente: 'Cliente Sem Papel', etapa: 'a_emitir', estado: null, modalidade: null, lacunas: null });

  it('o seletor mostra os fantasmas, cria o registro e abre a aba Contrato em Emitir', async () => {
    RESPOSTAS['/comercial/contratos/quadro'] = quadro([fantasma, c1]);
    render(<ContratosPage />);
    fireEvent.click(await screen.findByTestId('contratos-novo'));
    const criar = screen.getByTestId('contratos-novo-criar');
    expect(criar).toBeDisabled();
    fireEvent.change(screen.getByTestId('contratos-novo-lead'), { target: { value: 'l9' } });
    fireEvent.change(screen.getByTestId('contratos-novo-modalidade'), { target: { value: 'continuidade' } });
    fireEvent.click(criar);
    await waitFor(() => expect(chamadas).toEqual([{ metodo: 'post', caminho: '/comercial/contratos/registro', corpo: { leadId: 'l9', modalidade: 'continuidade' } }]));
    await waitFor(() => expect(painelAbrir).toHaveBeenCalledWith('l9', 'contrato', null, 'minuta'));
  });

  it('sem fantasma, diz o que fazer em vez de uma lista vazia', async () => {
    render(<ContratosPage />);
    fireEvent.click(await screen.findByTestId('contratos-novo'));
    expect(screen.getByTestId('contratos-novo-vazio')).toHaveTextContent('abra o painel dele na aba Contrato');
  });
});

describe('o texto da tela', () => {
  it('nenhum travessão e nenhum verde na emissão', async () => {
    montar();
    const emitir = await screen.findByTestId('contrato-emitir');
    expect(emitir.textContent).not.toMatch(/—/);
    expect(emitir.innerHTML).not.toMatch(/text-good|bg-good/);
  });
});
