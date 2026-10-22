/*
 * O CONTRATO IMPORTADO DO CRM ANTIGO (produção 22, M2): o PDF entra pelo cartão de
 * Contratos vivos e pelo bloco do painel do lead, o aviso "anexar o PDF" some quando o
 * contrato tem o PDF (nome, tamanho e data na tela), o bloco Parcelas lança em série ou
 * linha a linha em centavos inteiros com a soma, e o interruptor da régua mostra a frase
 * antes de ligar; ligada, as parcelas não se editam mais.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AVISO_DO_CONTRATO_IMPORTADO,
  centavosDigitados,
  tamanhoLegivel,
  textoDosCentavos,
  type ContratoImportadoNaTela,
  type ContratoVivo,
} from '@mktos/shared';

const chamadas: { metodo: string; caminho: string; corpo?: unknown }[] = [];
let CONTRATOS: ContratoVivo[] = [];
let podeEditar = true;

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'eu' }, can: () => podeEditar }) }));
vi.mock('next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return {
    ...real,
    apiGet: vi.fn(async () => CONTRATOS),
    apiUpload: vi.fn(async (caminho: string, arquivo: File) => { chamadas.push({ metodo: 'upload', caminho, corpo: arquivo.name }); return { novo: true, versao: 1, contrato: CONTRATOS[0] }; }),
    apiPut: vi.fn(async (caminho: string, corpo: unknown) => { chamadas.push({ metodo: 'put', caminho, corpo }); return { novo: true, versao: 1, contrato: CONTRATOS[0] }; }),
    apiPost: vi.fn(async (caminho: string, corpo: unknown) => { chamadas.push({ metodo: 'post', caminho, corpo }); return { novo: true, versao: 1, contrato: CONTRATOS[0] }; }),
    apiBlob: vi.fn(async () => new Blob(['%PDF-'])),
  };
});

import ContratosPage from '@/app/comercial/contratos/page';
import { ContratosImportados } from '@/app/comercial/_painel/ContratosImportados';

const ORIGEM = 'cartao:sintetico-1';

function importado(over: Partial<ContratoImportadoNaTela> = {}): ContratoImportadoNaTela {
  return {
    origem: ORIGEM, titulo: 'Assessoria mensal', produtoRotulo: 'Assessoria', valorCentavos: 600_000, fechadoEm: '2025-11-03', semDocumento: true,
    anexo: null, anexosAnteriores: 0, parcelasManuais: null, regua: { ligada: false, em: null, por: null }, ...over,
  };
}

function contrato(leadId: string, cliente: string, importados: ContratoImportadoNaTela[]): ContratoVivo {
  return {
    leadId, cliente, produto: null, valorCentavos: 600_000, descontoPct: null, parcelas: [], reguaDeCobranca: [], entregas: [],
    primeiroValorEm: null, saude: null, faseDaImplantacao: null, marcos: [], aditivos: null,
    situacao: 'ativo', encerramento: null, cnpj: null, socioDaConta: null, importados,
  };
}

const ANEXO = { nome: 'Contrato assinado.pdf', bytes: 1_258_291, sha256: 'a'.repeat(64), em: '2026-10-21T15:00:00.000Z', versao: 1, por: 'Pessoa da Mesa' };
const PARCELAS = {
  versao: 1,
  somaCentavos: 450_000,
  em: '2026-10-21T15:00:00.000Z',
  por: 'Pessoa da Mesa',
  linhas: [
    { n: 1, valorCentavos: 150_000, vence: '2026-09-10', pagaEm: '2026-09-10', estado: 'paga' as const, aviso: null },
    { n: 2, valorCentavos: 150_000, vence: '2026-10-10', pagaEm: null, estado: 'atrasada' as const, aviso: null },
    { n: 3, valorCentavos: 150_000, vence: '2026-11-10', pagaEm: null, estado: 'pendente' as const, aviso: null },
  ],
};

beforeEach(() => {
  chamadas.length = 0;
  podeEditar = true;
  CONTRATOS = [];
});

describe('as contas da tela', () => {
  it('valor digitado vira centavos inteiros sem ponto flutuante, e o tamanho sai legível', () => {
    expect(centavosDigitados('1.234,56')).toBe(123_456);
    expect(centavosDigitados('R$ 0,1')).toBe(10);
    expect(centavosDigitados('800')).toBe(80_000);
    expect(centavosDigitados('1500.50')).toBeNull();
    expect(centavosDigitados('abc')).toBeNull();
    expect(textoDosCentavos(123_456)).toBe('1234,56');
    expect(tamanhoLegivel(1_258_291)).toBe('1,2 MB');
    expect(tamanhoLegivel(870_400)).toBe('850 KB');
  });
});

describe('o PDF do contrato importado', () => {
  it('no painel do lead: sem PDF, o aviso e o botão; anexado, o aviso some e mostra nome, tamanho e data', async () => {
    const aoMudar = vi.fn();
    const { rerender } = render(<ContratosImportados itens={[importado()]} leadId="lead-1" aoMudar={aoMudar} />);
    expect(screen.getByTestId('contratos-importados-aviso')).toHaveTextContent(AVISO_DO_CONTRATO_IMPORTADO);
    const pdf = new File(['%PDF-1.4'], 'contrato.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('contrato-importado-anexo-input'), { target: { files: [pdf] } });
    await waitFor(() => expect(chamadas).toEqual([{ metodo: 'upload', caminho: `/comercial/contratos/lead-1/importados/anexo?origem=${encodeURIComponent(ORIGEM)}`, corpo: 'contrato.pdf' }]));
    await waitFor(() => expect(aoMudar).toHaveBeenCalled());
    expect(screen.getByRole('status')).toHaveTextContent('PDF anexado.');

    rerender(<ContratosImportados itens={[importado({ semDocumento: false, anexo: ANEXO })]} leadId="lead-1" aoMudar={aoMudar} />);
    expect(screen.queryByTestId('contratos-importados-aviso')).toBeNull();
    expect(screen.queryByText(AVISO_DO_CONTRATO_IMPORTADO)).toBeNull();
    expect(screen.getByTestId('contrato-importado-anexo')).toHaveTextContent('PDF anexado · Contrato assinado.pdf · 1,2 MB · 21/10');
    expect(screen.getByTestId('contrato-importado-anexar')).toHaveTextContent('Anexar outro PDF');
  });

  it('arquivo que não é PDF é recusado na tela, sem chamar a API', async () => {
    render(<ContratosImportados itens={[importado()]} leadId="lead-1" />);
    const html = new File(['<html>'], 'pagina.html', { type: 'text/html' });
    fireEvent.change(screen.getByTestId('contrato-importado-anexo-input'), { target: { files: [html] } });
    expect(await screen.findByText('O contrato assinado precisa ser um PDF.')).toBeInTheDocument();
    expect(chamadas).toEqual([]);
  });

  it('sem leads.editar não há botão de anexar nem de lançar', () => {
    podeEditar = false;
    render(<ContratosImportados itens={[importado({ parcelasManuais: PARCELAS })]} leadId="lead-1" />);
    expect(screen.queryByTestId('contrato-importado-anexar')).toBeNull();
    expect(screen.queryByTestId('parcelas-editar')).toBeNull();
    expect(screen.getByTestId('regua-do-importado-ligar')).toBeDisabled();
  });

  it('no cartão de Contratos vivos: anexar daqui, e o aviso some quando o contrato tem o PDF', async () => {
    CONTRATOS = [
      contrato('a', 'Cliente Sem PDF', [importado()]),
      contrato('b', 'Cliente Com PDF', [importado({ origem: 'cartao:sintetico-2', semDocumento: false, anexo: ANEXO, parcelasManuais: PARCELAS })]),
    ];
    render(<ContratosPage />);
    const semPdf = within(await screen.findByTestId('contrato-a'));
    expect(semPdf.getByText(AVISO_DO_CONTRATO_IMPORTADO)).toBeInTheDocument();
    expect(semPdf.getByTestId('contrato-importado-resumo-parcelas')).toHaveTextContent('Parcelas a lançar no painel do lead. Régua de cobrança desligada. Nenhum aviso de cobrança sai deste contrato.');
    const comPdf = within(screen.getByTestId('contrato-b'));
    expect(comPdf.queryByText(AVISO_DO_CONTRATO_IMPORTADO)).toBeNull();
    expect(comPdf.getByTestId('contrato-importado-anexo')).toHaveTextContent('Contrato assinado.pdf · 1,2 MB · 21/10');
    expect(comPdf.getByTestId('contrato-importado-resumo-parcelas')).toHaveTextContent('3 parcelas lançadas · soma R$ 4.500');
    // O cartão não tem o editor de parcelas: o lançamento mora no painel do lead.
    expect(comPdf.queryByTestId('parcelas-do-importado')).toBeNull();
    fireEvent.change(semPdf.getByTestId('contrato-importado-anexo-input'), { target: { files: [new File(['%PDF-'], 'x.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(chamadas[0]).toMatchObject({ metodo: 'upload', caminho: `/comercial/contratos/a/importados/anexo?origem=${encodeURIComponent(ORIGEM)}` }));
  });
});

describe('o bloco Parcelas', () => {
  it('lança em série mensal, mostra a soma e salva em centavos inteiros com a versão lida', async () => {
    const aoMudar = vi.fn();
    render(<ContratosImportados itens={[importado()]} leadId="lead-1" aoMudar={aoMudar} />);
    expect(screen.getByTestId('parcelas-vazio')).toBeInTheDocument();
    expect(screen.getByTestId('regua-do-importado-ligar')).toBeDisabled();
    fireEvent.click(screen.getByTestId('parcelas-editar'));
    fireEvent.change(screen.getByTestId('parcelas-serie-quantidade'), { target: { value: '3' } });
    fireEvent.change(screen.getByTestId('parcelas-serie-valor'), { target: { value: '1.500,50' } });
    fireEvent.change(screen.getByTestId('parcelas-serie-vencimento'), { target: { value: '2027-01-31' } });
    fireEvent.click(screen.getByTestId('parcelas-gerar'));
    expect(screen.getByTestId('parcelas-linha-1-vence')).toHaveValue('2027-02-28');
    expect(screen.getByTestId('parcelas-soma-editada')).toHaveTextContent('3 parcelas · soma R$ 4.501,50');
    // Linha a linha: troca o valor da terceira e marca a primeira como paga.
    fireEvent.change(screen.getByTestId('parcelas-linha-2-valor'), { target: { value: '1.000' } });
    expect(screen.getByTestId('parcelas-soma-editada')).toHaveTextContent('soma R$ 4.001');
    fireEvent.click(screen.getByTestId('parcelas-salvar'));
    await waitFor(() => expect(chamadas).toEqual([{
      metodo: 'put',
      caminho: '/comercial/contratos/lead-1/importados/parcelas',
      corpo: { origem: ORIGEM, versaoEsperada: 0, linhas: [
        { valorCentavos: 150_050, vence: '2027-01-31', pagaEm: null },
        { valorCentavos: 150_050, vence: '2027-02-28', pagaEm: null },
        { valorCentavos: 100_000, vence: '2027-03-31', pagaEm: null },
      ] },
    }]));
    await waitFor(() => expect(aoMudar).toHaveBeenCalled());
  });

  it('valor com ponto decimal não salva e diz por quê', () => {
    render(<ContratosImportados itens={[importado()]} leadId="lead-1" />);
    fireEvent.click(screen.getByTestId('parcelas-editar'));
    fireEvent.change(screen.getByTestId('parcelas-linha-0-valor'), { target: { value: '1500.50' } });
    fireEvent.change(screen.getByTestId('parcelas-linha-0-vence'), { target: { value: '2027-01-10' } });
    expect(screen.getByText('valor em reais, com vírgula nos centavos')).toBeInTheDocument();
    expect(screen.getByTestId('parcelas-salvar')).toBeDisabled();
  });

  it('lista as parcelas lançadas com a soma; ligar a régua mostra a frase e pede a ciência', async () => {
    const aoMudar = vi.fn();
    render(<ContratosImportados itens={[importado({ parcelasManuais: PARCELAS })]} leadId="lead-1" aoMudar={aoMudar} />);
    expect(screen.getByTestId('parcelas-soma')).toHaveTextContent('soma R$ 4.500');
    expect(within(screen.getByTestId('parcelas-lista')).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByTestId('regua-do-importado-estado')).toHaveAttribute('data-ligada', 'nao');
    expect(screen.getByTestId('regua-do-importado-ligar')).toHaveAttribute('role', 'switch');
    fireEvent.click(screen.getByTestId('regua-do-importado-ligar'));
    const frase = screen.getByTestId('regua-do-importado-frase');
    expect(frase).toHaveTextContent('Nenhuma mensagem vai ao cliente e nenhuma cobrança nasce no Asaas');
    expect(frase.textContent).not.toMatch(/[—–]/);
    expect(screen.getByTestId('regua-do-importado-confirmar')).toBeDisabled();
    fireEvent.click(screen.getByTestId('regua-do-importado-ciente'));
    fireEvent.click(screen.getByTestId('regua-do-importado-confirmar'));
    await waitFor(() => expect(chamadas).toEqual([{ metodo: 'post', caminho: '/comercial/contratos/lead-1/importados/regua', corpo: { origem: ORIGEM, versaoDasParcelas: 1, ciente: true } }]));
    await waitFor(() => expect(aoMudar).toHaveBeenCalled());
  });

  it('régua ligada: o interruptor fica ligado e as parcelas não se editam mais', () => {
    render(<ContratosImportados itens={[importado({ parcelasManuais: PARCELAS, regua: { ligada: true, em: '2026-10-21T15:00:00.000Z', por: 'Pessoa da Mesa' } })]} leadId="lead-1" />);
    expect(screen.getByTestId('regua-do-importado-estado')).toHaveAttribute('data-ligada', 'sim');
    expect(screen.getByTestId('regua-do-importado-estado')).toHaveTextContent('Régua de cobrança ligada em 21/10 por Pessoa da Mesa. As parcelas não se editam mais por aqui.');
    expect(screen.queryByTestId('parcelas-editar')).toBeNull();
    expect(screen.queryByTestId('regua-do-importado-ligar')).toBeNull();
  });
});
