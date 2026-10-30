import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { lerCompromisso, type EventoDaAgenda as EventoV2 } from '@mktos/shared';

import { GradeDeHoras } from '@/app/agenda/GradeDeHoras';
import { pedidoDeAlterar, rascunhoDoEvento } from '@/app/agenda/painel';
import { horaDeMinutos } from '@/app/agenda/v2';

/*
 * ARRASTAR E ESTICAR NA GRADE (agenda v2, 29/10/2026, lane G3): ponteiro nativo,
 * sem biblioteca. Arrastar move em passos de 15 min, puxar a borda de baixo
 * estica, Esc desiste, mexer pouco é clique. Soltar NÃO grava: entrega o
 * destino, e o pedido `alterar` sai do painel com `antes` = o retrato de agora.
 * 48 px por hora = 0,8 px por minuto (15 min = 12 px).
 */

function ev(id: string, ini: string, fim: string, titulo: string, extra: Partial<EventoV2> = {}): EventoV2 {
  return {
    id, agenda: 'primary', origem: 'google', titulo,
    inicio: new Date(`2026-11-03T${ini}:00-03:00`).toISOString(),
    fim: new Date(`2026-11-03T${fim}:00-03:00`).toISOString(),
    diaInteiro: false, local: null, meet: 'https://meet.google.com/x', convidados: [], organizador: 'agenda.casa@exemplo.invalid',
    organizadorEhAgenda: true, status: 'confirmado', atualizadoNoGoogle: null, serieId: null, criadoPeloOs: true, link: null,
    leitura: lerCompromisso(titulo), ...extra,
  };
}

// O jsdom não tem PointerEvent: sem ele o `fireEvent.pointer*` cria um Event sem coordenadas.
if (typeof (window as { PointerEvent?: unknown }).PointerEvent === 'undefined') {
  class PointerEventDeTeste extends MouseEvent {
    pointerId: number;
    constructor(tipo: string, init: PointerEventInit = {}) {
      super(tipo, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventDeTeste;
}

const EV = ev('mov', '10:00', '11:00', 'Reunião Online - Fictícia Peças - Rodrigo');

function montar(extra: Record<string, unknown> = {}) {
  const aoSoltar = vi.fn();
  const aoClicarEvento = vi.fn();
  render(createElement(GradeDeHoras, {
    dias: ['2026-11-03'],
    eventos: [EV],
    choques: new Set<string>(),
    faixas: [],
    hoje: '2026-11-01',
    agora: new Date('2026-11-01T12:00:00Z'),
    altura: 48,
    podeMover: () => true,
    aoSoltar,
    aoClicarEvento,
    ...extra,
  }));
  return { aoSoltar, aoClicarEvento, bloco: document.querySelector('[data-evento="mov"]') as HTMLElement };
}

afterEach(cleanup);

describe('arrastar move', () => {
  it('48 px para baixo = 1 hora depois, mesma duração', () => {
    const { aoSoltar, bloco } = montar();
    fireEvent.pointerDown(bloco, { clientX: 50, clientY: 100, button: 0 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 148 });
    expect(document.querySelector('[data-fantasma]')?.textContent).toBe('11:00–12:00');
    fireEvent.pointerUp(window, { clientX: 50, clientY: 148 });
    expect(aoSoltar).toHaveBeenCalledWith(EV, { dia: '2026-11-03', inicio: 11 * 60, fim: 12 * 60 });
  });

  it('o passo é de 15 min: 20 px viram 30 min (25 min arredonda para 30)', () => {
    const { aoSoltar, bloco } = montar();
    fireEvent.pointerDown(bloco, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(window, { clientX: 0, clientY: -20 });
    fireEvent.pointerUp(window);
    expect(aoSoltar).toHaveBeenCalledWith(EV, { dia: '2026-11-03', inicio: 9 * 60 + 30, fim: 10 * 60 + 30 });
  });

  it('mexer pouco é clique: abre o detalhe, não move', () => {
    const { aoSoltar, aoClicarEvento, bloco } = montar();
    fireEvent.pointerDown(bloco, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(window, { clientX: 1, clientY: 2 });
    fireEvent.pointerUp(window);
    fireEvent.click(bloco);
    expect(aoSoltar).not.toHaveBeenCalled();
    expect(aoClicarEvento).toHaveBeenCalledWith(EV);
  });

  it('o clique que vem logo depois de soltar não abre o detalhe', async () => {
    const { aoSoltar, aoClicarEvento, bloco } = montar();
    fireEvent.pointerDown(bloco, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(window, { clientX: 0, clientY: 48 });
    fireEvent.pointerUp(window);
    fireEvent.click(bloco);
    expect(aoSoltar).toHaveBeenCalledTimes(1);
    expect(aoClicarEvento).not.toHaveBeenCalled();
    await act(() => new Promise((r) => setTimeout(r, 0)));
    fireEvent.click(bloco);
    expect(aoClicarEvento).toHaveBeenCalledTimes(1);
  });

  it('Esc desiste no meio', () => {
    const { aoSoltar, bloco } = montar();
    fireEvent.pointerDown(bloco, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(window, { clientX: 0, clientY: 96 });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerUp(window);
    expect(aoSoltar).not.toHaveBeenCalled();
    expect(document.querySelector('[data-fantasma]')).toBeNull();
  });

  it('evento que não pode mudar (convite de outra agenda) não arrasta', () => {
    const { aoSoltar, bloco } = montar({ podeMover: () => false });
    fireEvent.pointerDown(bloco, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(window, { clientX: 0, clientY: 96 });
    fireEvent.pointerUp(window);
    expect(aoSoltar).not.toHaveBeenCalled();
    expect(document.querySelector('[data-borda-de-esticar]')).toBeNull();
  });
});

describe('puxar a borda estica', () => {
  it('24 px para baixo = mais 30 min no fim; o início fica', () => {
    const { aoSoltar } = montar();
    const borda = document.querySelector('[data-borda-de-esticar="mov"]') as HTMLElement;
    fireEvent.pointerDown(borda, { clientX: 0, clientY: 200, button: 0 });
    fireEvent.pointerMove(window, { clientX: 0, clientY: 224 });
    fireEvent.pointerUp(window);
    expect(aoSoltar).toHaveBeenCalledWith(EV, { dia: '2026-11-03', inicio: 10 * 60, fim: 11 * 60 + 30 });
  });

  it('não encolhe abaixo de 15 min', () => {
    const { aoSoltar } = montar();
    const borda = document.querySelector('[data-borda-de-esticar="mov"]') as HTMLElement;
    fireEvent.pointerDown(borda, { clientX: 0, clientY: 200, button: 0 });
    fireEvent.pointerMove(window, { clientX: 0, clientY: 0 });
    fireEvent.pointerUp(window);
    expect(aoSoltar).toHaveBeenCalledWith(EV, { dia: '2026-11-03', inicio: 10 * 60, fim: 10 * 60 + 15 });
  });
});

describe('o destino vira o pedido alterar (o painel confirma)', () => {
  it('só o horário muda: `depois` leva início e fim, `antes` é o retrato de agora', () => {
    const r = { ...rascunhoDoEvento(EV), hora: horaDeMinutos(11 * 60), duracaoMin: 90 };
    const p = pedidoDeAlterar(EV, r, 'k1');
    expect(p).toEqual({
      acao: 'alterar',
      chave: 'k1',
      eventoId: 'mov',
      antes: { titulo: EV.titulo, inicio: EV.inicio, fim: EV.fim, local: null, meet: true },
      depois: { inicio: new Date('2026-11-03T11:00:00-03:00').toISOString(), fim: new Date('2026-11-03T12:30:00-03:00').toISOString() },
    });
  });
  it('soltar no mesmo lugar não pede nada', () => {
    expect(pedidoDeAlterar(EV, rascunhoDoEvento(EV), 'k')).toBeNull();
  });
});
