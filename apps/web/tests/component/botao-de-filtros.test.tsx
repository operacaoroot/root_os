import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { BotaoDeFiltros, type DefinicaoDeFiltro } from '@/components/filtros/BotaoDeFiltros';
import { contarFiltrosAtivos, escreverFiltrosNoEndereco, lerFiltrosDoEndereco } from '@/components/filtros/filtros';

const DEFS: DefinicaoDeFiltro[] = [
  { chave: 'assigneeUserId', rotulo: 'Responsável', tipo: 'pessoa', opcoes: [{ valor: 'u1', rotulo: 'Ana' }, { valor: 'u2', rotulo: 'Bruno' }] },
  { chave: 'prazo', rotulo: 'Prazo', tipo: 'prazo', opcoes: [{ valor: 'atrasadas', rotulo: 'Atrasadas' }] },
  { chave: 'arquivadas', rotulo: 'Mostrar arquivadas', tipo: 'booleano' },
  { chave: 'q', rotulo: 'Busca', tipo: 'texto' },
];

function Tela({ inicial = {} as Record<string, string> }) {
  const [valores, setValores] = useState<Record<string, string>>(inicial);
  return (
    <BotaoDeFiltros
      filtros={DEFS}
      valores={valores}
      aoMudar={(c, v) => setValores((x) => ({ ...x, [c]: v }))}
      aoLimparTudo={() => setValores({})}
    />
  );
}

describe('filtros: funções puras', () => {
  it('conta só os declarados com valor', () => {
    expect(contarFiltrosAtivos(DEFS, { assigneeUserId: 'u1', q: '  ', outra: 'x' })).toBe(1);
  });
  it('lê e escreve no endereço sem tocar no que não é filtro', () => {
    expect(lerFiltrosDoEndereco('?pasta=todas&prazo=atrasadas', DEFS)).toEqual({ assigneeUserId: '', prazo: 'atrasadas', arquivadas: '', q: '' });
    expect(escreverFiltrosNoEndereco('?pasta=todas&prazo=atrasadas', { prazo: '', assigneeUserId: 'u2' })).toBe('?pasta=todas&assigneeUserId=u2');
    expect(escreverFiltrosNoEndereco('?prazo=x', { prazo: '' })).toBe('');
  });
});

describe('BotaoDeFiltros', () => {
  it('mostra a contagem e abre o painel com todos os filtros', () => {
    render(<Tela inicial={{ assigneeUserId: 'u1', prazo: 'atrasadas' }} />);
    expect(screen.getByTestId('filtros-contagem').textContent).toBe('(2)');
    fireEvent.click(screen.getByTestId('filtros-botao'));
    const painel = screen.getByRole('dialog', { name: 'Filtros' });
    expect(painel).toBeTruthy();
    expect(screen.getByTestId('filtros-assigneeUserId')).toBeTruthy();
    expect(screen.getByTestId('filtros-q')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByTestId('filtros-assigneeUserId'));
  });

  it('limpa um filtro e limpa tudo', () => {
    render(<Tela inicial={{ assigneeUserId: 'u1', prazo: 'atrasadas' }} />);
    fireEvent.click(screen.getByTestId('filtros-botao'));
    fireEvent.click(screen.getByTestId('filtros-limpar-prazo'));
    expect(screen.getByTestId('filtros-contagem').textContent).toBe('(1)');
    fireEvent.click(screen.getByTestId('filtros-limpar-tudo'));
    expect(screen.queryByTestId('filtros-contagem')).toBeNull();
  });

  it('limpar um filtro devolve o foco ao controle dele, não ao body', () => {
    render(<Tela inicial={{ assigneeUserId: 'u1', prazo: 'atrasadas', arquivadas: '1', q: 'abc' }} />);
    fireEvent.click(screen.getByTestId('filtros-botao'));
    for (const chave of ['prazo', 'arquivadas', 'q']) {
      const limpar = screen.getByTestId(`filtros-limpar-${chave}`);
      limpar.focus();
      fireEvent.click(limpar);
      expect(screen.queryByTestId(`filtros-limpar-${chave}`)).toBeNull();
      expect(document.activeElement).toBe(screen.getByTestId(`filtros-${chave}`));
    }
    expect(screen.getByTestId('filtros-contagem').textContent).toBe('(1)');
  });

  it('"Limpar tudo" devolve o foco ao primeiro controle do painel, não ao body', () => {
    render(<Tela inicial={{ prazo: 'atrasadas', q: 'abc' }} />);
    fireEvent.click(screen.getByTestId('filtros-botao'));
    const tudo = screen.getByTestId('filtros-limpar-tudo') as HTMLButtonElement;
    tudo.focus();
    fireEvent.click(tudo);
    expect(tudo.disabled).toBe(true);
    expect(document.activeElement).toBe(screen.getByTestId('filtros-assigneeUserId'));
    expect(document.activeElement).not.toBe(document.body);
  });

  it('escolher no painel conta, e fechar não perde', () => {
    render(<Tela />);
    fireEvent.click(screen.getByTestId('filtros-botao'));
    fireEvent.change(screen.getByTestId('filtros-assigneeUserId'), { target: { value: 'u2' } });
    fireEvent.click(screen.getByTestId('filtros-arquivadas'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('filtros-contagem').textContent).toBe('(2)');
  });

  it('Esc devolve o foco ao botão', async () => {
    vi.useFakeTimers();
    render(<Tela />);
    const botao = screen.getByTestId('filtros-botao');
    fireEvent.click(botao);
    fireEvent.keyDown(document, { key: 'Escape' });
    vi.runAllTimers();
    vi.useRealTimers();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(document.activeElement).toBe(botao);
  });

  it('Tab no último controle volta ao primeiro (foco preso no painel)', () => {
    render(<Tela />);
    fireEvent.click(screen.getByTestId('filtros-botao'));
    const painel = screen.getByTestId('filtros-painel');
    const controles = painel.querySelectorAll<HTMLElement>('select, input, button:not([disabled])');
    const ultimo = controles[controles.length - 1];
    ultimo.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(controles[0]);
  });
});
