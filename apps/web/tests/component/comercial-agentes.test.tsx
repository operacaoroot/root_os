/*
 * OS AGENTES DO COMERCIAL NA TELA (rodada dos agentes, 21/10/2026, lane A2).
 *
 *   · CO-11: o resumo de três linhas do vigia na torre, com a origem e os avisos;
 *   · CO-13 e CO-14: a minuta com o inserido e a lacuna pintados (sem HTML), o
 *     laudo ranqueado, "Gerar minuta" chamando a rota e a recusa sem o modelo
 *     cadastrado aparecendo com a frase exata;
 *   · CO-10: a frase da pasta do cliente depois de "Iniciar onboarding".
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RECUSA_SEM_MODELO_DE_CONTRATO, type MinutaDoContratoNaTela } from '@mktos/shared';

const chamadas: { caminho: string }[] = [];
let MINUTA: MinutaDoContratoNaTela | null = null;
let recusar = false;

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'tok', ready: true, user: { id: 'u' }, can: () => true }) }));
vi.mock('next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/comercial', useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof import('@/lib/api')>();
  return {
    ...real,
    apiGet: vi.fn(async () => MINUTA),
    apiPost: vi.fn(async (caminho: string) => {
      chamadas.push({ caminho });
      if (recusar) throw new real.ErroDaApi(RECUSA_SEM_MODELO_DE_CONTRATO, 400);
      return MINUTA;
    }),
  };
});

import { MinutaDoContrato, TextoDaMinuta } from '@/app/comercial/_painel/MinutaDoContrato';
import { fraseDaPasta } from '@/app/comercial/_painel/IniciarOnboarding';
import { ResumoDoVigiaNaTorre } from '@/app/comercial/torre/ResumoDoVigia';

const MINUTA_PRONTA: MinutaDoContratoNaTela = {
  documentoId: 'doc-1',
  versaoDaProposta: 1,
  hash: 'h'.repeat(64),
  conteudo: 'CONTRATANTE: ⟦inserido: Padaria Exemplo Ltda⟧. Foro: ⟦lacuna: foro⟧.',
  inseridos: 1,
  lacunas: ['foro'],
  origem: 'modelo',
  avisos: [],
  modeloDoDrive: { nome: 'Contrato Root v1', id: 'x', pastaConferida: true },
  geradaEm: '2026-10-21T15:00:00.000Z',
  laudo: {
    apontamentos: [
      { gravidade: 'critica', regra: 'valor_por_extenso', titulo: 'Valor por extenso diferente do algarismo', trecho: 'R$ 2.970,00 (dois mil reais)', detalhe: 'O algarismo diz R$ 2.970,00 e o extenso diz R$ 2.000,00.', origem: 'regra' },
      { gravidade: 'alta', regra: 'lacuna_aberta', titulo: 'Lacuna aberta: foro', trecho: '⟦lacuna: foro⟧', detalhe: 'O contrato não sai com lacuna.', origem: 'regra' },
    ],
    geradoEm: '2026-10-21T15:00:00.000Z',
    porModelo: true,
    avisos: [],
    hashDaMinuta: 'h'.repeat(64),
  },
};

beforeEach(() => {
  chamadas.length = 0;
  MINUTA = null;
  recusar = false;
});

describe('CO-11 · o resumo do vigia na torre', () => {
  it('as três linhas, a origem e o aviso do número descartado', () => {
    render(<ResumoDoVigiaNaTorre resumo={{ linhas: ['Uma.', 'Duas.', 'Três.'], origem: 'misto', avisos: ['linha 2 do modelo descartada: o número 7 não é um dos que o vigia contou'] }} />);
    expect(screen.getByRole('region', { name: 'resumo do vigia' })).toBeTruthy();
    expect(screen.getAllByRole('listitem').map((l) => l.textContent)).toEqual(['Uma.', 'Duas.', 'Três.', 'linha 2 do modelo descartada: o número 7 não é um dos que o vigia contou']);
    expect(screen.getByText(/com linha do sistema · os números são do sistema/)).toBeTruthy();
  });
});

describe('CO-13 e CO-14 · a minuta e o laudo', () => {
  it('o inserido e a lacuna aparecem marcados, como texto (nada de HTML do modelo)', () => {
    const { container } = render(<TextoDaMinuta conteudo={'A ⟦inserido: <b>x</b>⟧ e ⟦lacuna: foro⟧.'} />);
    expect(container.querySelector('[data-marca="inserido"]')?.textContent).toBe('<b>x</b>');
    expect(container.querySelector('[data-marca="lacuna"]')?.textContent).toBe('[foro]');
    expect(container.querySelector('b')).toBeNull();
  });

  it('com minuta, mostra o texto e o laudo ranqueado; "Revisar de novo" chama a rota do revisor', async () => {
    MINUTA = MINUTA_PRONTA;
    render(<MinutaDoContrato leadId="l1" temAceite />);
    await waitFor(() => expect(screen.getByLabelText('laudo da minuta')).toBeTruthy());
    expect(screen.getByText('1 lacuna(s)')).toBeTruthy();
    const itens = screen.getByLabelText('laudo da minuta').querySelectorAll('li');
    expect(itens[0].textContent).toContain('crítica');
    expect(itens[1].textContent).toContain('Lacuna aberta: foro');
    await userEvent.click(screen.getByRole('button', { name: 'Revisar de novo' }));
    await waitFor(() => expect(chamadas.map((c) => c.caminho)).toContain('/comercial/lead/l1/minuta/revisar'));
  });

  it('sem minuta e sem o modelo cadastrado: "Gerar minuta" mostra a recusa com a frase exata', async () => {
    recusar = true;
    render(<MinutaDoContrato leadId="l1" temAceite />);
    await userEvent.click(await screen.findByRole('button', { name: 'Gerar minuta do contrato' }));
    await waitFor(() => expect(screen.getByText(RECUSA_SEM_MODELO_DE_CONTRATO, { exact: false })).toBeTruthy());
    expect(chamadas[0].caminho).toBe('/comercial/lead/l1/minuta');
  });

  it('sem aceite, não há botão: a minuta parte da proposta aceita', async () => {
    render(<MinutaDoContrato leadId="l1" temAceite={false} />);
    await waitFor(() => expect(screen.getByText(/A minuta parte da proposta aceita/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Gerar minuta/ })).toBeNull();
  });
});

describe('CO-10 · a pasta do cliente depois de "Iniciar onboarding"', () => {
  it('a frase de cada estado', () => {
    expect(fraseDaPasta(undefined)).toBeNull();
    expect(fraseDaPasta({ estado: 'pronta', url: 'https://drive.example/x' })).toBe('A pasta do cliente está pronta no Drive.');
    expect(fraseDaPasta({ estado: 'aguardando_aprovacao', approvalId: 'a1' })).toContain('Aprovações');
    expect(fraseDaPasta({ estado: 'erro', motivo: 'o Drive respondeu 500' })).toBe('A pasta do cliente não foi criada: o Drive respondeu 500. Use "Criar pasta de novo" no topo do painel.');
  });
});
