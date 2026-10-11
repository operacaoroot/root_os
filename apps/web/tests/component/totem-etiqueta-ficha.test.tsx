/**
 * A FICHA QUE O QR DA ETIQUETA ABRE (`/p/<codigo>`).
 *
 * A tela mostra o que a API mandou e nada além: sem preço na resposta, nenhum
 * "R$" na tela; etiqueta revogada ou inexistente vira a página simples de
 * etiqueta não encontrada; e o cadastro só aparece com campanha, montado com a
 * origem `qr` e o código da etiqueta como credencial.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TotemFichaDaEtiqueta } from '@mktos/shared';

vi.mock('@/components/totem/CadastroCupom', () => ({
  CadastroCupom: (props: { origem: string; credencial: { etiqueta?: string } }) => (
    <div role="dialog" aria-label="Cadastro">
      cadastro {props.origem} {props.credencial.etiqueta}
    </div>
  ),
}));

import { FichaDaEtiqueta } from '@/app/p/[codigo]/FichaDaEtiqueta';

const CODIGO = 'ABCDE12345';

function ficha(parcial: Partial<TotemFichaDaEtiqueta> = {}): TotemFichaDaEtiqueta {
  return {
    codigo: CODIGO,
    loja: { nome: 'Loja Centro', cidade: 'Brasília' },
    produto: {
      codigo: '00123',
      nome: 'Castanha de caju',
      categoria: 'Castanhas',
      composicao: 'Castanha de caju torrada.',
      beneficios: null,
      alergenicos: 'Contém castanha de caju.',
      porcaoG: 30,
      porcaoDescricao: null,
      nutricional: [{ nutriente: 'Proteínas', quantidade: 5.5, unidade: 'g', vd: 11 }],
      selos: ['vegano'],
      imagemUrl: null,
      fonteNutricional: null,
    },
    lote: {
      codigo: 'L2610A',
      fabricadoEm: '2026-10-01',
      validadeEm: '2027-04-01',
      repostoEm: '2026-10-05T13:00:00.000Z',
      presumido: false,
      situacao: 'ok',
    },
    config: {
      nomeExibicao: 'Sr. aGranel',
      corPrimaria: '#28371D',
      corFundo: '#F5F3EC',
      logoUrl: null,
      cadastroLigado: true,
    },
    campanha: null,
    ...parcial,
  };
}

function respostaJson(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FichaDaEtiqueta', () => {
  it('mostra produto, lote e reposição, e nenhum preço quando a API não mandou', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respostaJson(200, ficha()));
    vi.stubGlobal('fetch', fetchFalso);

    render(<FichaDaEtiqueta codigo={CODIGO} />);

    expect(await screen.findByRole('heading', { name: 'Castanha de caju' })).toBeInTheDocument();
    expect(String(fetchFalso.mock.calls[0][0])).toContain(`/totem-etiqueta/${CODIGO}`);
    expect(screen.getByText('L2610A')).toBeInTheDocument();
    expect(screen.getByText('01/04/2027')).toBeInTheDocument();
    expect(screen.getByText('Reposto em 05/10/2026.')).toBeInTheDocument();
    expect(screen.getByText('Vegano')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('R$');
    expect(screen.getByRole('link', { name: 'Política de privacidade' })).toHaveAttribute(
      'href',
      `/totem/privacidade?e=${CODIGO}`,
    );
  });

  it('mostra o preço quando a API mandou', async () => {
    const base = ficha();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respostaJson(200, { ...base, produto: { ...base.produto, precoCentavos: 8990, unidadePreco: 'kg' } }),
      ),
    );

    render(<FichaDaEtiqueta codigo={CODIGO} />);

    expect(await screen.findByText('R$ 89,90 o quilo')).toBeInTheDocument();
  });

  it('etiqueta revogada ou inexistente vira a página de etiqueta não encontrada', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson(404, { message: 'Não encontramos o que você procurou.' })));

    render(<FichaDaEtiqueta codigo={CODIGO} />);

    expect(await screen.findByRole('heading', { name: 'Etiqueta não encontrada' })).toBeInTheDocument();
  });

  it('sem campanha não há chamada para o cadastro', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson(200, ficha())));

    render(<FichaDaEtiqueta codigo={CODIGO} />);

    await screen.findByRole('heading', { name: 'Castanha de caju' });
    expect(screen.queryByRole('button', { name: 'Cadastre-se e ganhe seu cupom' })).not.toBeInTheDocument();
  });

  it('com campanha, a chamada abre o cadastro com origem qr e o código da etiqueta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respostaJson(200, ficha({ campanha: { chamada: 'Ganhe 10% na primeira compra', descricaoBeneficio: null } })),
      ),
    );

    render(<FichaDaEtiqueta codigo={CODIGO} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Cadastre-se e ganhe seu cupom' }));
    expect(screen.getByRole('dialog', { name: 'Cadastro' })).toHaveTextContent(`cadastro qr ${CODIGO}`);
  });

  it('lote vencido avisa a equipe da loja', async () => {
    const base = ficha();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respostaJson(200, { ...base, lote: { ...base.lote!, validadeEm: '2026-09-30', situacao: 'vencido' } }),
      ),
    );

    render(<FichaDaEtiqueta codigo={CODIGO} />);

    expect(await screen.findByText('Lote vencido em 30/09/2026. Avise a equipe da loja.')).toBeInTheDocument();
  });
});
