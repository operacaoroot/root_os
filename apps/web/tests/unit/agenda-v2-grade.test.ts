import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { lerCompromisso, type EventoDaAgenda as EventoV2, type FeriadoDaAgenda } from '@mktos/shared';

import { GradeDeHoras } from '@/app/agenda/GradeDeHoras';
import { lerEstadoV2, urlDoEstadoV2 } from '@/app/agenda/estado';
import {
  alturaEfetiva,
  ancoraVizinha,
  aparenciaDo,
  choquesDe,
  diasDaJanela,
  doGoogleParaV2,
  ehDoSocio,
  ehRespostaDoEspelho,
  faixasDoTopo,
  janelaDeHoras,
  layoutDoDia,
  lerAlturaGuardada,
  proximoDiaUtil,
  rotuloDaJanela,
  seloDaSincronia,
} from '@/app/agenda/v2';

/*
 * A GRADE DA AGENDA V2 (29/10/2026, lane G3): dias úteis, terços e "+N",
 * choque, faixas de Fora e feriado, altura das horas, o selo da sincronia e o
 * estado no endereço. Tudo no fuso de São Paulo (UTC−3). Clientes fictícios.
 */

let seq = 0;
/** Um evento do espelho às `hhmm` de São Paulo no dia `dia`. */
function ev(dia: string, ini: string, fim: string, titulo: string | null, extra: Partial<EventoV2> = {}): EventoV2 {
  seq++;
  const iso = (h: string) => new Date(`${dia}T${h}:00-03:00`).toISOString();
  return {
    id: extra.id ?? `e${seq}`,
    agenda: 'primary',
    origem: 'google',
    titulo,
    inicio: iso(ini),
    fim: iso(fim),
    diaInteiro: false,
    local: null,
    meet: 'https://meet.google.com/abc-defg-hij',
    convidados: [],
    organizador: 'agenda.casa@exemplo.invalid',
    organizadorEhAgenda: true,
    status: 'confirmado',
    atualizadoNoGoogle: null,
    serieId: null,
    criadoPeloOs: false,
    link: null,
    leitura: lerCompromisso(titulo, ['Finados']),
    ...extra,
  };
}

const JANELA = { inicio: 8 * 60, fim: 21 * 60 };

afterEach(cleanup);

describe('os dias da grade', () => {
  it('5 = segunda a sexta da semana do dia; fim de semana abre a seguinte', () => {
    expect(diasDaJanela('2026-10-29', 5)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
    expect(diasDaJanela('2026-10-31', 5)[0]).toBe('2026-11-02');
    expect(diasDaJanela('2026-11-01', 5)[0]).toBe('2026-11-02');
  });
  it('3 = três dias úteis a partir do dia (pulando o fim de semana)', () => {
    expect(diasDaJanela('2026-10-29', 3)).toEqual(['2026-10-29', '2026-10-30', '2026-11-02']);
  });
  it('1 = o próprio dia, mesmo no fim de semana', () => {
    expect(diasDaJanela('2026-10-31', 1)).toEqual(['2026-10-31']);
  });
  it('as setas andam uma janela', () => {
    expect(ancoraVizinha('2026-10-29', 5, 1)).toBe('2026-11-05');
    expect(ancoraVizinha('2026-10-29', 3, 1)).toBe('2026-11-03');
    expect(ancoraVizinha('2026-11-02', 3, -1)).toBe('2026-10-28');
    expect(ancoraVizinha('2026-10-31', 1, 1)).toBe('2026-11-01');
  });
  it('próximo dia útil e o rótulo', () => {
    expect(proximoDiaUtil('2026-10-31')).toBe('2026-11-02');
    expect(proximoDiaUtil('2026-10-29')).toBe('2026-10-29');
    expect(rotuloDaJanela(['2026-11-02', '2026-11-06'])).toBe('02/11 a 06/11');
  });
});

describe('terços e "+N"', () => {
  it('dois ao mesmo tempo: metades', () => {
    const d = layoutDoDia([ev('2026-11-03', '10:00', '11:00', 'Reunião Online - Papelaria - Rodrigo'), ev('2026-11-03', '10:30', '11:30', 'Reunião Online - Exemplum - Pedro')], '2026-11-03', JANELA);
    expect(d.blocos.map((b) => [b.coluna, b.colunas])).toEqual([[0, 2], [1, 2]]);
    expect(d.mais).toEqual([]);
  });
  it('três ao mesmo tempo: terços, sem "+N"', () => {
    const d = layoutDoDia(
      ['A', 'B', 'C'].map((x) => ev('2026-11-05', '14:00', '15:00', `Reunião Online - ${x} - Lucas`)),
      '2026-11-05',
      JANELA,
    );
    expect(d.blocos.map((b) => b.colunas)).toEqual([3, 3, 3]);
    expect(d.blocos.map((b) => b.coluna).sort()).toEqual([0, 1, 2]);
    expect(d.mais).toEqual([]);
  });
  it('quatro ao mesmo tempo: dois ficam e o terceiro lugar vira "+2" com a lista inteira', () => {
    const quatro = ['A', 'B', 'C', 'D'].map((x) => ev('2026-11-05', '14:00', '15:15', `Reunião Online - ${x} - Rodrigo`));
    const d = layoutDoDia(quatro, '2026-11-05', JANELA);
    expect(d.blocos).toHaveLength(2);
    expect(d.blocos.every((b) => b.colunas === 3 && b.coluna < 2)).toBe(true);
    expect(d.mais).toHaveLength(1);
    expect(d.mais[0].ocultos).toBe(2);
    expect(d.mais[0].eventos).toHaveLength(4);
  });
  it('o que não se sobrepõe ocupa a coluna inteira; cancelado e de outro dia ficam fora', () => {
    const d = layoutDoDia(
      [
        ev('2026-11-03', '08:00', '09:00', 'Reunião Interna - Todos'),
        ev('2026-11-03', '13:00', '14:00', 'Reunião Online - X - Pedro'),
        ev('2026-11-03', '13:00', '14:00', 'Reunião Online - Y - Pedro', { status: 'cancelado' }),
        ev('2026-11-04', '13:00', '14:00', 'Reunião Online - Z - Pedro'),
      ],
      '2026-11-03',
      JANELA,
    );
    expect(d.blocos.map((b) => b.colunas)).toEqual([1, 1]);
  });
  it('a janela de horas alarga para caber o que estiver fora das 08h–21h', () => {
    expect(janelaDeHoras([])).toEqual({ inicio: 480, fim: 1260 });
    expect(janelaDeHoras([ev('2026-11-03', '07:30', '08:00', 'x'), ev('2026-11-03', '21:30', '22:30', 'y')])).toEqual({ inicio: 420, fim: 1380 });
  });
});

describe('o que cada compromisso é', () => {
  it('choque: dois do mesmo sócio ao mesmo tempo; Fechado contra Fechado não é', () => {
    const a = ev('2026-11-04', '09:00', '10:00', 'Reunião Online - Clinimodelo - Rodrigo', { id: 'a' });
    const b = ev('2026-11-04', '09:00', '10:00', 'Reunião Online - Campo Modelo - Rodrigo', { id: 'b' });
    const c = ev('2026-11-04', '09:00', '10:00', 'Reunião Online - Outro - Lucas', { id: 'c' });
    const f1 = ev('2026-11-04', '14:00', '15:00', 'Fechado Rodrigo', { id: 'f1' });
    const f2 = ev('2026-11-04', '14:30', '15:30', null, { id: 'f2', origem: 'livre_ocupado', leitura: { ...lerCompromisso('Fechado Rodrigo') } });
    expect([...choquesDe([a, b, c, f1, f2])].sort()).toEqual(['a', 'b']);
  });
  it('aparência com a palavra: cliente, Fechado da agenda pessoal, fora do padrão, sem Meet', () => {
    expect(aparenciaDo(ev('2026-11-03', '10:00', '11:00', 'Reunião Online - Exemplaria - Pedro')).tom).toBe('cliente');
    const fechado = aparenciaDo(ev('2026-11-03', '14:00', '15:00', null, { origem: 'livre_ocupado', leitura: lerCompromisso('Fechado Rodrigo') }));
    expect(fechado).toMatchObject({ tom: 'fechado', titulo: 'Fechado Rodrigo', etiqueta: 'agenda pessoal · só ocupado' });
    const fdp = aparenciaDo(ev('2026-11-04', '15:00', '16:00', 'call com cliente novo', { convidados: [{ email: 'x@cliente.exemplo', resposta: 'pendente' }] }));
    expect(fdp).toMatchObject({ tom: 'foraDoPadrao', etiqueta: 'fora do padrão' });
    const semMeet = aparenciaDo(ev('2026-11-05', '10:00', '11:00', 'Reunião Online - Clube Modelo - Lucas', { meet: null }));
    expect(semMeet).toMatchObject({ tom: 'cliente', etiqueta: 'sem Meet', semMeet: true });
  });
  it('Quem: pelos responsáveis do título ou pelo e-mail do sócio entre os convidados', () => {
    const e = ev('2026-11-03', '10:00', '11:00', 'Reunião Online - Exemplaria - Pedro');
    expect(ehDoSocio(e, 'Todos')).toBe(true);
    expect(ehDoSocio(e, 'Pedro')).toBe(true);
    expect(ehDoSocio(e, 'Lucas')).toBe(false);
    const comLucas = { ...e, convidados: [{ email: 'lucas@root.exemplo', resposta: 'aceito' as const }] };
    expect(ehDoSocio(comLucas, 'Lucas', { Lucas: 'lucas@root.exemplo' })).toBe(true);
  });
  it('faixas do topo: feriado nacional fecha; facultativo desligado não aparece; Fora de dia inteiro', () => {
    const feriados: FeriadoDaAgenda[] = [
      { id: 'f', data: '2026-11-02', nome: 'Finados', tipo: 'nacional', cidade: null, ligado: true },
      { id: 'g', data: '2026-11-03', nome: 'Facultativo Exemplo', tipo: 'facultativo', cidade: null, ligado: false },
    ];
    const fora = { ...ev('2026-11-05', '00:00', '00:00', 'Pedro Fora - viagem'), diaInteiro: true, inicio: '2026-11-05', fim: '2026-11-06' };
    const f = faixasDoTopo([fora], feriados, diasDaJanela('2026-11-02', 5));
    expect(f).toEqual([
      { tipo: 'feriado', dia: '2026-11-02', texto: 'Finados', fecha: true, pessoa: null },
      { tipo: 'fora', dia: '2026-11-05', texto: 'Pedro Fora - viagem', fecha: false, pessoa: 'Pedro' },
    ]);
  });
});

describe('fonte, altura, selo e endereço', () => {
  it('a leitura direta vira o formato do espelho com a mesma gramática', () => {
    const v2 = doGoogleParaV2({
      id: 'g1', title: 'Reunião Presencial - Exemplaria - Lucas', reuniao: null, start: '2026-11-03T19:00:00.000Z', end: '2026-11-03T20:00:00.000Z',
      diaInteiro: false, location: 'Av. Exemplo', description: null, link: null, meet: null, status: 'confirmed', organizador: null, attendees: ['a@b.exemplo'],
    });
    expect(v2.leitura).toMatchObject({ tipo: 'cliente', cliente: 'Exemplaria', responsaveis: ['Lucas'], modalidade: 'presencial' });
    expect(v2.convidados).toEqual([{ email: 'a@b.exemplo', resposta: 'pendente' }]);
    expect(v2.organizadorEhAgenda).toBe(false);
    expect(ehRespostaDoEspelho({ eventos: [], sincronia: { ultimaPassagem: null, erro: null, atrasada: false }, fonte: 'espelho' })).toBe(true);
    expect(ehRespostaDoEspelho([])).toBe(false);
    expect(ehRespostaDoEspelho({ statusCode: 501 })).toBe(false);
  });
  it('altura: manual entre 28 e 120; auto cabe a janela; sem medida, 48', () => {
    expect(alturaEfetiva(200, 0, JANELA)).toBe(120);
    expect(alturaEfetiva('auto', 0, JANELA)).toBe(48);
    expect(alturaEfetiva('auto', 624, JANELA)).toBe(48);
    expect(alturaEfetiva('auto', 1300, JANELA)).toBe(100);
    expect(lerAlturaGuardada('64')).toBe(64);
    expect(lerAlturaGuardada('lixo')).toBe('auto');
    expect(lerAlturaGuardada(null)).toBe('auto');
  });
  it('o selo: há N s; atrasado e sem espelho avisam', () => {
    const agora = new Date('2026-10-29T15:00:40.000Z');
    expect(seloDaSincronia({ ultimaPassagem: '2026-10-29T15:00:00.000Z', erro: null, atrasada: false }, 'espelho', agora)).toEqual({ texto: 'sincronizado há 40 s', tom: 'ok' });
    expect(seloDaSincronia({ ultimaPassagem: '2026-10-29T14:00:00.000Z', erro: null, atrasada: true }, 'google', agora)?.tom).toBe('atencao');
    expect(seloDaSincronia(null, 'direto', agora)?.texto).toBe('sem espelho: lendo direto do Google');
  });
  it('o endereço: aba, dia, dias e quem; o de antes continua valendo', () => {
    expect(lerEstadoV2('?aba=conflitos&dia=2026-11-02&dias=3&quem=Pedro', '2026-10-29', false)).toEqual({ aba: 'conflitos', dia: '2026-11-02', dias: 3, quem: 'Pedro' });
    expect(lerEstadoV2('?visao=dia&dia=2026-11-02', '2026-10-29', false)).toMatchObject({ aba: 'semana', dias: 1 });
    expect(lerEstadoV2('?visao=mes', '2026-10-29', false)).toMatchObject({ aba: 'mes', dia: '2026-10-29' });
    expect(lerEstadoV2('', '2026-10-29', true).aba).toBe('lista');
    expect(lerEstadoV2('?quem=Fulano&dias=7', '2026-10-29', false)).toMatchObject({ quem: 'Todos', dias: 5 });
    expect(urlDoEstadoV2('/agenda?visao=semana&tarefa=x', { aba: 'semana', dia: '2026-11-02', dias: 5, quem: 'Lucas' })).toBe('/agenda?tarefa=x&aba=semana&dia=2026-11-02&dias=5&quem=Lucas');
  });
});

describe('a grade desenhada', () => {
  const base = {
    choques: new Set<string>(),
    faixas: [],
    hoje: '2026-11-03',
    agora: new Date('2026-11-03T14:20:00-03:00'),
    altura: 48 as const,
    aoClicarEvento: vi.fn(),
  };

  it('terços com o título e "+N" que abre a lista daquele horário', () => {
    const quatro = ['Clinimodelo', 'Fictus', 'Fictícia Peças', 'Exemplaria'].map((x, i) => ev('2026-11-05', '14:00', '15:00', `Reunião Online - ${x} - Rodrigo`, { id: `q${i}` }));
    const aoClicarEvento = vi.fn();
    render(createElement(GradeDeHoras, { ...base, aoClicarEvento, dias: ['2026-11-05'], eventos: quatro }));
    const blocos = document.querySelectorAll('[data-evento]');
    expect(blocos).toHaveLength(2);
    expect((blocos[0] as HTMLElement).style.width).toMatch(/^calc\(33\.33+%/);
    const mais = document.querySelector('[data-mais="2"]') as HTMLElement;
    expect(mais.textContent).toBe('+2');
    fireEvent.click(mais);
    const lista = screen.getByRole('dialog', { name: 'Neste horário' });
    expect(within(lista).getAllByRole('button').filter((b) => /Reunião Online/.test(b.textContent ?? ''))).toHaveLength(4);
    fireEvent.click(within(lista).getByText('Reunião Online - Exemplaria - Rodrigo'));
    expect(aoClicarEvento).toHaveBeenCalledWith(quatro[3]);
  });

  it('choque em magenta com a palavra; a linha do agora no dia de hoje; o compromisso novo tracejado', () => {
    const a = ev('2026-11-03', '09:00', '10:00', 'Reunião Online - Clinimodelo - Rodrigo', { id: 'a' });
    const b = ev('2026-11-03', '09:00', '10:00', 'Reunião Online - Campo Modelo - Rodrigo', { id: 'b' });
    render(createElement(GradeDeHoras, {
      ...base,
      dias: ['2026-11-03'],
      eventos: [a, b],
      choques: choquesDe([a, b]),
      novo: { dia: '2026-11-03', inicio: 15 * 60, fim: 16 * 60, titulo: 'Reunião Online - Fictícia Peças - Rodrigo' },
    }));
    const bloco = document.querySelector('[data-evento="a"]') as HTMLElement;
    expect(bloco.getAttribute('data-tom')).toBe('choque');
    expect(bloco.textContent).toContain('choque');
    const agora = document.querySelector('[data-linha-do-agora]') as HTMLElement;
    // 14:20 é 6h20 depois das 08h: 380 min × 0,8 px.
    expect(agora.style.top).toBe('304px');
    const novo = document.querySelector('[data-compromisso-novo]') as HTMLElement;
    expect(novo.textContent).toContain('novo');
    expect(novo.textContent).toContain('Reunião Online - Fictícia Peças - Rodrigo');
    expect(novo.className).toContain('border-dashed');
  });

  it('feriado que fecha cobre a coluna com a frase da régua', () => {
    render(createElement(GradeDeHoras, {
      ...base,
      dias: ['2026-11-02', '2026-11-03'],
      eventos: [],
      faixas: [{ tipo: 'feriado', dia: '2026-11-02', texto: 'Finados', fecha: true, pessoa: null }],
    }));
    const f = document.querySelector('[data-coluna-do-dia="2026-11-02"] [data-feriado="Finados"]') as HTMLElement;
    expect(f.textContent).toContain('Feriado');
    expect(f.textContent).toContain('marcar assim mesmo');
    expect(document.querySelector('[data-coluna-do-dia="2026-11-03"] [data-feriado]')).toBeNull();
  });

  it('clique no vazio entrega o dia e o minuto (arredondado a 15)', () => {
    const aoClicarVazio = vi.fn();
    render(createElement(GradeDeHoras, { ...base, dias: ['2026-11-03'], eventos: [], aoClicarVazio }));
    const coluna = document.querySelector('[data-coluna-do-dia="2026-11-03"]') as HTMLElement;
    // 0,8 px por minuto: y = 340 é 425 min depois das 08h = 15:05 → 15:00.
    fireEvent.click(coluna, { clientY: 340 });
    expect(aoClicarVazio).toHaveBeenCalledWith('2026-11-03', 15 * 60);
  });

  it('Fora: a etiqueta "Pedro Fora" no compromisso dele naquele dia', () => {
    const rito = ev('2026-11-05', '19:30', '21:00', 'Reunião Interna - Todos', { id: 'rito' });
    render(createElement(GradeDeHoras, {
      ...base,
      dias: ['2026-11-05'],
      eventos: [rito],
      faixas: [{ tipo: 'fora', dia: '2026-11-05', texto: 'Pedro Fora - viagem', fecha: false, pessoa: 'Pedro' }],
    }));
    expect((document.querySelector('[data-evento="rito"]') as HTMLElement).textContent).toContain('Pedro Fora');
  });
});
