/*
 * REGISTRAR CLIENTE JÁ FECHADO NO FUNIL VIVO (rodada do trabalho T1b, 19/10/2026).
 *
 * A porta única de quem fechou fora do sistema: o botão no topo do Funil vivo
 * abre o formulário; sem o PDF e sem o motivo de não cobrar nada é enviado; o
 * padrão é NÃO criar cobrança nova; o envio é multipart com o PDF e os dados; a
 * resposta diz que o fechamento espera outra pessoa em /atendimento.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMERCIAL_ETAPAS, type FunilVivo } from '@mktos/shared';

let PODE = true;
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'eu' }, can: () => PODE }) }));
vi.mock('next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/comercial/funil', useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => <a href={href} {...resto}>{children}</a>,
}));
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return {
    ...real,
    apiGet: vi.fn(async (caminho: string) => (caminho.startsWith('/comercial/funil') ? FUNIL : undefined)),
    apiPost: vi.fn(async () => ({})),
  };
});

import FunilPage from '@/app/comercial/funil/page';
import { centavosDoTexto } from '@/app/comercial/_funil/RegistrarFechadoFora';

const FUNIL: FunilVivo = {
  colunas: [...COMERCIAL_ETAPAS.map((e) => ({ etapa: e, rotulo: e, cartoes: [] })), { etapa: 'saidas' as const, rotulo: 'Saídas', cartoes: [] }],
};

const RESPOSTA = {
  leadId: 'lead-1',
  leadNovo: true,
  registroNovo: true,
  versao: 1,
  chave: 'fech-lead-1-v1',
  anexo: { sha256: 'a'.repeat(64), nome: 'contrato.pdf', bytes: 20 },
  fechamento: { estado: 'na_fila', approvalId: 'ap-1', pulado: null },
};

const fetchMock = vi.fn();
beforeEach(() => {
  PODE = true;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => RESPOSTA });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function abrir() {
  render(<FunilPage />);
  const u = userEvent.setup();
  await u.click(await screen.findByRole('button', { name: 'Registrar cliente já fechado' }));
  return { u, painel: screen.getByTestId('registrar-fechado-fora') };
}

describe('registrar cliente já fechado no Funil vivo', () => {
  it('só quem edita leads vê a ação', async () => {
    PODE = false;
    render(<FunilPage />);
    await screen.findByTestId('funil-coluna-novo_lead');
    expect(screen.queryByRole('button', { name: 'Registrar cliente já fechado' })).toBeNull();
  });

  it('sem o PDF e sem o motivo de não cobrar, nada é enviado e a tela diz o que falta', async () => {
    const { u, painel } = await abrir();
    expect(within(painel).getByRole('checkbox', { name: /Criar cobrança nova no Asaas/ })).not.toBeChecked();
    await u.click(within(painel).getByRole('button', { name: 'registrar e pedir o fechamento' }));
    const alerta = within(painel).getByRole('alert');
    expect(alerta).toHaveTextContent('razão social');
    expect(alerta).toHaveTextContent('contrato assinado: anexe o PDF');
    expect(alerta).toHaveTextContent('motivo sem cobrança');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('envia o PDF e os dados; o padrão é sem cobrança nova; a resposta diz quem assina', async () => {
    const { u, painel } = await abrir();
    const campo = (nome: string | RegExp) => within(painel).getByLabelText(nome);
    await u.type(campo('Razão social'), 'Padaria Trigo Bom Ltda');
    await u.type(campo('CNPJ ou CPF'), '12.345.678/0001-90');
    await u.type(campo('Quem assina'), 'Joana Trigo');
    await u.type(campo('E-mail de quem assina'), 'joana@trigobom.test');
    await u.type(campo('WhatsApp do contato'), '(32) 99999-0001');
    expect(campo('Valor total (R$)')).toHaveValue('11.997,00');
    expect(campo('Parcelas')).toHaveValue(3);
    await u.selectOptions(campo('Produto (tabela de 04/10)'), 'imersao');
    expect(campo('Valor total (R$)')).toHaveValue('2.970,00');
    expect(campo('Parcelas')).toHaveValue(10);
    await u.type(campo('Assinado em'), '2026-09-01');
    await u.type(campo('1º vencimento'), '2026-09-10');
    await u.type(campo('Por que não criar cobrança'), 'o cliente já paga por boleto do banco');
    await u.upload(campo('Contrato assinado (PDF, até 10 MB)'), new File(['%PDF-1.4'], 'contrato.pdf', { type: 'application/pdf' }));
    await u.click(within(painel).getByRole('button', { name: 'registrar e pedir o fechamento' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/comercial\/clientes-fechados-fora$/);
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect((form.get('file') as File).name).toBe('contrato.pdf');
    expect(JSON.parse(String(form.get('dados')))).toMatchObject({
      razaoSocial: 'Padaria Trigo Bom Ltda',
      produto: 'imersao',
      valorCentavos: 297_000,
      parcelas: 10,
      forma: 'boleto',
      assinadoEm: '2026-09-01',
      primeiroVencimento: '2026-09-10',
      criarCobranca: false,
      motivoSemCobranca: 'o cliente já paga por boleto do banco',
    });
    const feito = await within(painel).findByTestId('registrar-fechado-fora-feito');
    expect(feito).toHaveTextContent('O fechamento espera a assinatura de outra pessoa com alçada titular em /atendimento.');
    expect(feito).toHaveTextContent('fech-lead-1-v1');
  });

  it('marcando a cobrança nova, o motivo some e não vai no envio', async () => {
    const { u, painel } = await abrir();
    await u.click(within(painel).getByRole('checkbox', { name: /Criar cobrança nova no Asaas/ }));
    expect(within(painel).queryByLabelText('Por que não criar cobrança')).toBeNull();
  });

  it('o valor em reais vira centavos sem inventar', () => {
    expect(centavosDoTexto('11.997,00')).toBe(1_199_700);
    expect(centavosDoTexto('R$ 2.970')).toBe(297_000);
    expect(centavosDoTexto('2970.5')).toBe(297_050);
    expect(centavosDoTexto('dois mil')).toBeNull();
    expect(centavosDoTexto('')).toBeNull();
  });
});
