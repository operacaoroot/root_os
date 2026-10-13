import { describe, expect, it } from 'vitest';

import { inicioDoDiaEmSaoPaulo } from '../src/comercial/decisoes.service';
import { fimDoDiaComDesvio, inicioDoDiaNoFuso, proximaHoraNoFuso } from '../src/comercial/hora-da-politica';
import { validadeAte } from '../src/comercial/proposta-construtor';
import { proximaHoraSP } from '../src/comercial/proposta.service';
import { proximaHoraEmSP } from '../src/comercial/proxima-acao';
import { RelogioDaEspinha } from '../src/comercial/relogio-da-espinha';
import { MarcasDoDia, RelogioComercialRegistry } from '../src/comercial/relogio.registry';

/*
 * REVISÃO ADVERSARIAL, P3 PUROS DO SERVIDOR (lane G/P3-servidor, 13/10/2026).
 *
 * E-17: a hora de São Paulo pelo fuso da política, não por -3 h fixo.
 * E-18: o "uma vez por dia" do pulo de A0 é o dia do fuso, não o dia UTC.
 * E-19: as marcas "já feito no dia" do relógio não crescem.
 */

const SP = 'America/Sao_Paulo';
const NY = 'America/New_York'; // com horário de verão: prova que o fuso é lido, não suposto

describe('E-17: a hora pelo fuso da política', () => {
  it('em São Paulo, o resultado é o de antes', () => {
    expect(validadeAte(new Date('2026-10-13T23:30:00-03:00'), 1, SP)).toBe('2026-10-14T23:59:59-03:00');
    expect(proximaHoraSP(new Date('2026-10-13T12:00:00-03:00'), 18, SP).toISOString()).toBe('2026-10-13T21:00:00.000Z');
    expect(proximaHoraEmSP(new Date('2026-10-13T19:00:00-03:00'), 18, SP).toISOString()).toBe(new Date('2026-10-14T18:00:00-03:00').toISOString());
    expect(inicioDoDiaEmSaoPaulo(new Date('2026-10-13T02:00:00Z'), SP).toISOString()).toBe('2026-10-12T03:00:00.000Z');
  });

  it('num fuso com horário de verão, o desvio acompanha a data (o -3 h fixo erraria)', () => {
    // Nova York: -04:00 em outubro, -05:00 depois de 01/11/2026.
    expect(validadeAte(new Date('2026-10-13T12:00:00Z'), 1, NY)).toBe('2026-10-14T23:59:59-04:00');
    expect(validadeAte(new Date('2026-10-30T12:00:00Z'), 5, NY)).toBe('2026-11-04T23:59:59-05:00');
    expect(proximaHoraSP(new Date('2026-10-13T12:00:00Z'), 18, NY).toISOString()).toBe('2026-10-13T22:00:00.000Z');
    expect(proximaHoraEmSP(new Date('2026-11-02T12:00:00Z'), 18, NY).toISOString()).toBe('2026-11-02T23:00:00.000Z');
    expect(inicioDoDiaNoFuso(new Date('2026-11-02T12:00:00Z'), NY).toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect(fimDoDiaComDesvio('2026-10-14', SP)).toBe('2026-10-14T23:59:59-03:00');
    expect(proximaHoraNoFuso(new Date('2026-10-13T23:30:00-03:00'), 9, SP).toISOString()).toBe('2026-10-14T12:00:00.000Z');
  });
});

describe('E-18 e E-19: as marcas do dia do relógio', () => {
  it('E-18: o pulo de A0 às 20h e às 22h de São Paulo é do mesmo dia (o dia UTC já virou às 21h)', async () => {
    const tarefas = new RelogioComercialRegistry();
    tarefas.inscrever('teste.tarefa', async () => 1);
    tarefas.definirGuarda(async () => ({ roda: false, automacao: 'vigia', nivel: 'A0', motivo: 'teste' }));
    const relogio = new RelogioDaEspinha({} as never, {} as never, tarefas, {} as never, {} as never, {} as never, {} as never);
    const vinte = await relogio.passagem('org-x', new Date('2026-10-14T20:00:00-03:00'));
    expect(vinte.status).toBe('ok'); // o primeiro pulo do dia fica no histórico
    const vinteEDuas = await relogio.passagem('org-x', new Date('2026-10-14T22:00:00-03:00'));
    expect(vinteEDuas.status).toBe('pulada');
    const outroDia = await relogio.passagem('org-x', new Date('2026-10-15T08:00:00-03:00'));
    expect(outroDia.status).toBe('ok');
  });

  it('E-19: virado o dia, as marcas do dia anterior saem; marca de dia velho não fica', () => {
    const m = new MarcasDoDia();
    for (let i = 0; i < 50; i++) m.marcar('2026-10-13', `org-${i}`);
    expect(m.tamanho).toBe(50);
    expect(m.tem('2026-10-13', 'org-1')).toBe(true);
    m.marcar('2026-10-14', 'org-1');
    expect(m.tamanho).toBe(1);
    expect(m.tem('2026-10-14', 'org-1')).toBe(true);
    expect(m.tem('2026-10-13', 'org-2')).toBe(false);
    m.marcar('2026-10-13', 'org-3');
    expect(m.tamanho).toBe(1);
  });
});
