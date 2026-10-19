import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * REVISÃO P2-1 DA T1b: o R4 do fechamento de quem fechou FORA do sistema é a
 * única conferência humana dos dados declarados e do PDF. A titular lê, no
 * item, razão social, valor, parcelas, o motivo da cobrança pulada e o link do
 * PDF; o botão de assinar só aparece com o conteúdo carregado e o hash conferindo.
 */

const apiGet = vi.fn();
vi.mock('@/lib/api', async () => {
  const real = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...real, apiGet: (...a: unknown[]) => apiGet(...a) };
});
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: null, can: () => true }) }));

// eslint-disable-next-line import/first
import { Item } from '@/app/atendimento/Item';
// eslint-disable-next-line import/first
import { leadDoFechamento } from '@/app/atendimento/CartaoDoFechamento';
// eslint-disable-next-line import/first
import type { ItemDaFila } from '@/app/atendimento/tipos';

const HASH = 'c'.repeat(64);
const LEAD = '11111111-2222-5333-8444-555555555555';

function item(): ItemDaFila {
  return {
    id: 'ap9', gaveta: 'esperando', status: 'pendente', nivel: 'R4', nivelBase: 'R4', resumo: 'fechar o negócio',
    capacidade: 'comercial.fechamento.executar', canal: null, recurso: { tipo: 'comercial.fechamento', id: `fech-${LEAD}-v1` }, agente: null, correlationId: null,
    conteudo: { leadId: LEAD, chave: `fech-${LEAD}-v1`, propostaHash: HASH },
    conteudoOculto: false, hashDoConteudo: 'abc', impedimento: null, gatilhos: [], motivoDaRegua: null, exigeReauth: true, exigeMotivo: true,
    alcadaMinima: 'titular', proponente: { id: 'u-mesa', tipo: 'user', nome: 'Mesa' }, propostaEm: '2026-10-19T12:00:00.000Z',
    expiraEm: '2026-10-19T12:10:00.000Z', esperandoMs: 60_000, decididoPor: null, decididoEm: null, motivo: null, aprovadores: [],
    euPossoAprovar: true, porQueNao: null,
  };
}

function conteudo(confere: boolean) {
  return {
    leadId: LEAD, nome: 'Padaria Trigo Bom Ltda', origem: 'fora', versao: 1, chave: `fech-${LEAD}-v1`, produto: 'operacao', rotuloDoProduto: 'Operação ROOT',
    valorCentavos: 1_199_700, parcelas: 3, forma: 'boleto',
    dados: { cnpj: '12345678000190', razaoSocial: 'Padaria Trigo Bom Ltda', endereco: '[a decidir]', quemAssina: 'Joana Trigo', email: 'joana@trigobom.test' },
    fora: {
      assinadoEm: '2026-09-01', primeiroVencimento: '2026-09-10', criarCobranca: false, motivoSemCobranca: 'o cliente já paga por boleto do banco', por: 'Mesa',
      anexo: { nome: 'contrato.pdf', bytes: 20, sha256: 'a'.repeat(64), assinadoEm: '2026-09-01', por: 'Mesa' },
    },
    hashDeAgora: confere ? HASH : 'd'.repeat(64), hashAssinado: HASH, confere,
  };
}

const props = { euDecido: true, souOProponente: false, ocupado: false, aoAprovar: vi.fn(), aoRecusar: vi.fn() };

beforeEach(() => vi.clearAllMocks());

describe('revisão P2-1: o cartão do fechamento de quem fechou fora em /atendimento', () => {
  it('mostra os dados declarados, a cobrança pulada com o motivo e o PDF; assinar aparece com o hash conferido', async () => {
    apiGet.mockResolvedValue(conteudo(true));
    render(<Item item={item()} {...props} />);
    expect(apiGet).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('aprov-acao-ap9'));
    const cartao = await screen.findByTestId('cartao-do-fechamento');
    expect(apiGet).toHaveBeenCalledWith(`/comercial/fechamentos/${LEAD}/conteudo?hash=${HASH}`, 'tok');
    expect(cartao).toHaveTextContent('fechado fora do sistema, registrado à mão por Mesa');
    expect(cartao).toHaveTextContent('12345678000190');
    expect(screen.getByTestId('fechamento-valor')).toHaveTextContent('R$ 11.997,00 em 3× por boleto');
    expect(screen.getByTestId('fechamento-cobranca')).toHaveTextContent('nenhuma cobrança nova: o cliente já paga por boleto do banco');
    expect(screen.getByTestId('fechamento-pdf')).toHaveTextContent('baixar o PDF (contrato.pdf)');
    expect(await screen.findByRole('button', { name: /Assinar como titular/ })).toBeInTheDocument();
    expect(screen.queryByTestId('fechamento-esperando-ap9')).toBeNull();
  });

  it('com o hash de agora diferente do assinado, diz que não sai e não oferece assinar', async () => {
    apiGet.mockResolvedValue(conteudo(false));
    render(<Item item={item()} {...props} />);
    await userEvent.click(screen.getByTestId('aprov-acao-ap9'));
    expect(await screen.findByTestId('fechamento-divergente')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Assinar como titular/ })).toBeNull();
    expect(screen.getByTestId('fechamento-esperando-ap9')).toBeInTheDocument();
  });

  it('sem o conteúdo (erro ao carregar), não há botão de assinar', async () => {
    apiGet.mockRejectedValue(new Error('falhou'));
    render(<Item item={item()} {...props} />);
    await userEvent.click(screen.getByTestId('aprov-acao-ap9'));
    expect(await screen.findByTestId('fechamento-sem-conteudo')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Assinar como titular/ })).toBeNull();
  });

  it('o lead sai dos argumentos ou da chave do recurso', () => {
    expect(leadDoFechamento({ leadId: 'x' }, 'fech-y-v1')).toBe('x');
    expect(leadDoFechamento(null, `fech-${LEAD}-v2`)).toBe(LEAD);
    expect(leadDoFechamento(null, 'outra coisa')).toBeNull();
  });
});
