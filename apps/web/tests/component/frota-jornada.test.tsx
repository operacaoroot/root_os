import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

/*
 * A JORNADA NA FROTA (29/10/2026): a vista da frota (casas pela trilha + quadro do que
 * está parado esperando quem) e a aba da casa (as fases com cada item do backlog).
 */

import { JornadaDaCasa, JornadaView } from '@/app/frota/jornada';
import type { CasaDetalhe, CasaResumo, Resumo } from '@/app/frota/tipos';

const fases = [
  { n: 0, nome: 'Decisões antes de contratar', conta: 4, feito: 1, esperando: 2, andamento: 0, regrediu: 0 },
  { n: 2, nome: 'Preparar (as etapas do kit)', conta: 3, feito: 1, esperando: 0, andamento: 1, regrediu: 1 },
];
const item = (id: string, o: Partial<CasaResumo['jornada'] extends infer J ? NonNullable<J>['proximo'][number] : never> = {}) => ({
  id, fase: 0, item: `item ${id}`, quem: 'humano', situacao: 'afazer' as const, espera: null, quando: null, nota: null, autoTexto: null, projeto: false, ...o,
});
const casa = {
  id: 'c1', casa: 'casa-a', cliente: 'Cliente A', etapa: 'manter',
  jornada: {
    pct: 25, feitos: 2, validos: 8, faseAtual: 0, faseNome: 'Decisões antes de contratar', temNota: true, geradoEm: null, fases,
    esperando: 2, porQuem: { cliente: 1, root: 1, terceiro: 0 }, andamento: 1,
    regrediu: [item('2.7', { fase: 2, situacao: 'regrediu', autoTexto: 'último backup bom há 4 dias' })],
    proximo: [item('0.6', { item: 'Cofre do cliente: qual' })],
  },
} as unknown as CasaResumo;
const semJornada = { id: 'c2', casa: 'casa-b', cliente: 'Cliente B', etapa: 'fora-do-kit', jornada: null } as unknown as CasaResumo;
const linha = (id: string, o: object) => ({ ...item(id), casaId: 'c1', casa: 'casa-a', trava: null, ...o });
const resumo = {
  casas: [casa, semJornada],
  jornada: {
    regrediu: [linha('2.7', { situacao: 'regrediu', item: 'Etapa 06 backup', autoTexto: 'último backup bom há 4 dias' })],
    cliente: [linha('0.7', { situacao: 'esperando', item: 'Destino do backup fora', espera: 'cliente', quando: '2026-10-16', trava: 'cliente' })],
    root: [linha('0.8', { situacao: 'esperando', item: 'Canal de alerta', espera: 'root', trava: 'root' })],
    terceiro: [],
    andamento: [linha('P5.1', { situacao: 'andamento', item: 'Migrar dados do PC', projeto: true })],
  },
} as unknown as Resumo;

describe('jornada da Frota', () => {
  it('a vista mostra a fase atual, o próximo passo e o quadro de quem trava', () => {
    const abrir = vi.fn();
    render(<JornadaView resumo={resumo} abrir={abrir} />);
    expect(screen.getAllByText(/Decisões antes de contratar/).length).toBeGreaterThan(0);
    expect(screen.getByText('Cofre do cliente: qual')).toBeTruthy();
    expect(screen.getByText('esperando o cliente · 1')).toBeTruthy();
    expect(screen.getByText('Destino do backup fora')).toBeTruthy();
    expect(screen.getByText('último backup bom há 4 dias')).toBeTruthy();
    expect(screen.getByText(/1 casa\(s\) ainda sem jornada/)).toBeTruthy();
    fireEvent.click(screen.getByText('Canal de alerta'));
    expect(abrir).toHaveBeenCalledWith('c1');
  });

  it('a aba da casa abre a fase atual e explica como marcar', () => {
    const detalhe = {
      casa: 'casa-a',
      jornadaCompleta: {
        pct: 25, faseAtual: 0, arquivo: true, kit: '170b4ff',
        fases: [{ n: 0, nome: 'Decisões antes de contratar', total: 2, feito: 1, na: 0 }, { n: 9, nome: 'Entrega', total: 1, feito: 0, na: 0 }],
        itens: [
          { id: '0.1', fase: 0, item: 'De quem é o servidor', situacao: 'feito', projeto: false },
          { id: '0.7', fase: 0, item: 'Destino do backup fora', situacao: 'esperando', espera: 'cliente', projeto: false },
          { id: '9.1', fase: 9, item: 'Entrega ao cliente', situacao: 'afazer', projeto: false },
        ],
      },
    } as unknown as CasaDetalhe;
    render(<JornadaDaCasa casa={detalhe} />);
    expect(screen.getByText('Destino do backup fora')).toBeTruthy();
    expect(screen.queryByText('Entrega ao cliente')).toBeNull();
    fireEvent.click(screen.getByText(/Fase 9 · Entrega/));
    expect(screen.getByText('Entrega ao cliente')).toBeTruthy();
    expect(screen.getAllByText(/kit-jornada marcar/).length).toBeGreaterThan(0);
  });

  it('sem jornada diz como ligar', () => {
    render(<JornadaDaCasa casa={{ casa: 'casa-b', jornadaCompleta: null } as unknown as CasaDetalhe} />);
    expect(screen.getByText(/ainda não relata a jornada/)).toBeTruthy();
  });
});
