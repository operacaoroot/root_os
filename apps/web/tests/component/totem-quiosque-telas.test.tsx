/**
 * AS TELAS DO QUIOSQUE — o que o cliente lê de pé, na frente do totem.
 *
 * A ficha precisa avisar quando o lote venceu, dizer "recebido em" quando a
 * loja ainda não confirmou a remessa e esconder o preço que o painel não
 * liberou. A tela de início troca o botão do cupom pelo QR da etiqueta quando
 * o totem está sem internet, e a busca digitada no teclado de tela vira
 * evento depois de uma pausa.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { TotemCatalogoLote } from '@mktos/shared';

import { FichaDoProduto } from '@/components/totem/quiosque/FichaDoProduto';
import { TelaInicial } from '@/components/totem/quiosque/TelaInicial';
import { catalogoDeExemplo, produtoDeExemplo } from '../totem-quiosque-dados';

const DIA = 86_400_000;

function diaDaqui(dias: number): string {
  const d = new Date(Date.now() + dias * DIA);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

function lote(campos: Partial<TotemCatalogoLote> = {}): TotemCatalogoLote {
  return {
    codigo: 'L2026-10',
    fabricadoEm: null,
    validadeEm: diaDaqui(200),
    repostoEm: '2026-10-05T14:00:00.000Z',
    presumido: false,
    situacao: 'ok',
    ...campos,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('FichaDoProduto', () => {
  it('mostra selos, alergênicos em destaque e a tabela com %VD', () => {
    const produto = produtoDeExemplo({
      nome: 'Granola tradicional',
      selos: ['integral', 'sem_conservantes'],
      composicao: 'Aveia, mel e castanha-de-caju.',
      alergenicos: 'Contém castanha-de-caju. Pode conter amendoim.',
      porcaoG: 40,
      nutricional: [
        { nutriente: 'Valor energético', quantidade: 168, unidade: 'kcal', vd: 8 },
        { nutriente: 'Açúcares adicionados', quantidade: 4.5, unidade: 'g', vd: null },
      ],
    });
    render(<FichaDoProduto produto={produto} aoVoltar={() => {}} />);

    const selos = within(screen.getByRole('list', { name: 'Selos' })).getAllByRole('listitem');
    expect(selos.map((s) => s.textContent)).toEqual(['Integral', 'Sem conservantes']);
    expect(screen.getByRole('note')).toHaveTextContent('Alergênicos: Contém castanha-de-caju');
    expect(screen.getByText('Porção de 40 g')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '%VD*' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Valor energético 168 kcal 8%/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Açúcares adicionados 4,5 g \*\*/ })).toBeInTheDocument();
    expect(screen.getByText('** VD não estabelecido.')).toBeInTheDocument();
  });

  it('lote vencido manda consultar um atendente', () => {
    const produto = produtoDeExemplo({ nome: 'Uva-passa', lote: lote({ validadeEm: diaDaqui(-3), situacao: 'ok' }) });
    render(<FichaDoProduto produto={produto} aoVoltar={() => {}} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Consulte um atendente');
    expect(screen.queryByText('Dentro da validade')).not.toBeInTheDocument();
  });

  it('lote presumido diz "recebido em DD/MM"; confirmado, a data de reposição', () => {
    const { unmount } = render(
      <FichaDoProduto produto={produtoDeExemplo({ nome: 'Lentilha', lote: lote({ presumido: true }) })} aoVoltar={() => {}} />,
    );
    expect(screen.getByText(/recebido em \d{2}\/\d{2}\./)).toBeInTheDocument();
    expect(screen.getByText('Dentro da validade')).toBeInTheDocument();
    unmount();

    render(<FichaDoProduto produto={produtoDeExemplo({ nome: 'Lentilha', lote: lote() })} aoVoltar={() => {}} />);
    expect(screen.getByText(/reposto em \d{2}\/10\/2026\./)).toBeInTheDocument();
  });

  it('sem lote registrado, pede para falar com um atendente', () => {
    render(<FichaDoProduto produto={produtoDeExemplo({ nome: 'Chia' })} aoVoltar={() => {}} />);
    expect(screen.getByText(/ainda não registrou o lote/)).toBeInTheDocument();
  });

  it('o preço só aparece quando o catálogo traz', () => {
    const { unmount } = render(<FichaDoProduto produto={produtoDeExemplo({ nome: 'Chia' })} aoVoltar={() => {}} />);
    expect(screen.queryByText(/R\$/)).not.toBeInTheDocument();
    unmount();

    render(
      <FichaDoProduto
        produto={produtoDeExemplo({ nome: 'Chia', precoCentavos: 5990, unidadePreco: 'kg' })}
        aoVoltar={() => {}}
      />,
    );
    expect(screen.getByText(/R\$\s59,90 o quilo/)).toBeInTheDocument();
  });
});

describe('TelaInicial', () => {
  const comCadastro = catalogoDeExemplo({
    config: { ...catalogoDeExemplo().config, cadastroLigado: true },
    produtos: [
      produtoDeExemplo({ nome: 'Granola tradicional', categoria: 'Cereais' }),
      produtoDeExemplo({ nome: 'Castanha-do-pará', categoria: 'Castanhas' }),
    ],
  });

  function telaInicial(online: boolean, aoRegistrar = vi.fn(), aoAbrirCadastro = vi.fn()) {
    render(
      <TelaInicial
        catalogo={comCadastro}
        online={online}
        aoAbrirProduto={() => {}}
        aoRegistrar={aoRegistrar}
        aoAbrirCadastro={aoAbrirCadastro}
      />,
    );
    return { aoRegistrar, aoAbrirCadastro };
  }

  it('com internet e cadastro ligado, oferece o cupom', () => {
    const { aoAbrirCadastro } = telaInicial(true);
    fireEvent.click(screen.getByRole('button', { name: /Ganhe seu cupom/ }));
    expect(aoAbrirCadastro).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Sem internet/)).not.toBeInTheDocument();
  });

  it('sem internet, troca o botão pelo QR da etiqueta e avisa discretamente', () => {
    telaInicial(false);
    expect(screen.queryByRole('button', { name: /Ganhe seu cupom/ })).not.toBeInTheDocument();
    expect(screen.getByText('Para se cadastrar, aponte o celular para o QR da etiqueta.')).toBeInTheDocument();
    expect(screen.getByText(/Sem internet: mostrando o catálogo guardado/)).toBeInTheDocument();
  });

  it('o teclado de tela abre no toque do campo, busca e registra o termo depois da pausa', () => {
    vi.useFakeTimers();
    const { aoRegistrar } = telaInicial(true);
    fireEvent.click(screen.getByRole('searchbox'));
    const teclado = screen.getByRole('group', { name: 'Teclado' });

    for (const letra of 'GRANILA') fireEvent.click(within(teclado).getByRole('button', { name: letra }));

    expect(screen.getByRole('searchbox')).toHaveValue('granila');
    expect(screen.getByText('Um produto encontrado.')).toBeInTheDocument();
    expect(screen.getByText('Granola tradicional')).toBeInTheDocument();
    expect(aoRegistrar).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(aoRegistrar).toHaveBeenCalledExactlyOnceWith('busca', { termo: 'granila' });
  });

  it('busca sem resultado vira o evento próprio', () => {
    vi.useFakeTimers();
    const { aoRegistrar } = telaInicial(true);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'quinoa' } });
    expect(screen.getByText(/Não encontramos "quinoa"/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(aoRegistrar).toHaveBeenCalledExactlyOnceWith('busca_sem_resultado', { termo: 'quinoa' });
  });
});
