import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/*
 * REVISÃO E-7: quem libera o R3 da proposta do comercial lê o conteúdo que o
 * hash prende (desconto, validade, quadro, "o que ouvimos", a frase de "como é
 * diferente"), não só produto, valor e parcelas. Sem o cartão carregado e
 * conferido, não há botão de aprovar.
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
import type { ItemDaFila } from '@/app/atendimento/tipos';

const HASH = 'a'.repeat(64);

function item(): ItemDaFila {
  return {
    id: 'ap1', gaveta: 'esperando', status: 'pendente', nivel: 'R3', nivelBase: 'R3', resumo: 'publicar a proposta v1',
    capacidade: 'comercial.proposta.publicar', canal: null, recurso: { tipo: 'comercial.proposta', id: 'lead-1:v1' }, agente: null, correlationId: null,
    conteudo: { leadId: 'lead-1', versao: 1, hash: HASH, produto: 'operacao', valorCentavos: 1_199_700, parcelas: 3 },
    conteudoOculto: false, hashDoConteudo: 'abc', impedimento: null, gatilhos: [], motivoDaRegua: null, exigeReauth: false, exigeMotivo: false,
    alcadaMinima: 'responsavel', proponente: { id: 'u-socio', tipo: 'user', nome: 'Rodrigo' }, propostaEm: '2026-10-13T12:00:00.000Z',
    expiraEm: '2026-10-14T12:00:00.000Z', esperandoMs: 60_000, decididoPor: null, decididoEm: null, motivo: null, aprovadores: [],
    euPossoAprovar: true, porQueNao: null,
  };
}

function conteudo(confere: boolean) {
  return {
    leadId: 'lead-1', versao: 1, estado: 'na_porta', dentroDaTabela: true, hashGravado: HASH, hashDeAgora: confere ? HASH : 'b'.repeat(64), hashAssinado: HASH, confere,
    laudo: { ok: true, apontamentos: [], notas: [] },
    conteudo: {
      produto: 'operacao', rotulo: 'Operação ROOT', valorCentavos: 1_079_730, parcelas: 3, parcelaCentavos: 359_910, ultimaParcelaCentavos: 359_910,
      formas: ['pix', 'boleto'], descricao: 'A operação montada.', descontoPct: 10, alternativa: 'imersao',
      ouvimos: ['fechamento leva 12 dias'], comoEDiferente: 'A conta fecha no dia útil seguinte.',
      quadroDeCustos: { mesNormalCentavos: 18_000, piorMesCentavos: 34_000, exemplo: true, origem: 'exemplo' },
      validaAte: '2026-10-21T21:00:00.000Z', tabelaData: '2026-10-04',
    },
  };
}

const props = { euDecido: true, souOProponente: false, ocupado: false, aoAprovar: vi.fn(), aoRecusar: vi.fn() };

beforeEach(() => vi.clearAllMocks());

describe('revisão E-7: o cartão da proposta em /atendimento', () => {
  it('mostra desconto, validade, quadro, o que ouvimos e a frase; o botão aparece com o hash conferido', async () => {
    apiGet.mockResolvedValue(conteudo(true));
    render(<Item item={item()} {...props} />);
    const cartao = await screen.findByTestId('cartao-da-proposta');
    expect(apiGet).toHaveBeenCalledWith(`/comercial/lead/lead-1/proposta/v/1/conteudo?hash=${HASH}`, 'tok');
    expect(cartao).toHaveTextContent('10%');
    expect(cartao).toHaveTextContent('VALORES DE EXEMPLO');
    expect(cartao).toHaveTextContent('fechamento leva 12 dias');
    expect(cartao).toHaveTextContent('A conta fecha no dia útil seguinte.');
    expect(await screen.findByRole('button', { name: 'Aprovar e executar' })).toBeInTheDocument();
  });

  it('com o hash de agora diferente do assinado, diz que não sai e não oferece aprovar', async () => {
    apiGet.mockResolvedValue(conteudo(false));
    render(<Item item={item()} {...props} />);
    expect(await screen.findByTestId('proposta-divergente')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprovar e executar' })).toBeNull();
    expect(screen.getByTestId('recusar-proposta-ap1')).toBeInTheDocument();
  });
});
