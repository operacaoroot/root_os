/**
 * A INTELIGÊNCIA DO COCKPIT, FASE 2 — a parte pura (lane E, 13/10/2026).
 *
 * Sem banco e sem Nest:
 *   · a escada de autonomia: o padrão é o degrau vigente (nunca A0), A0 segura
 *     a tarefa, A1 a A3 deixam rodar, e todo nome da tabela existe no código;
 *   · a próxima ação projetada por etapa, com o "quando" só quando a config dá;
 *   · o fio legível (ata sem tamanho, agenda em São Paulo);
 *   · as contas do relatório e a limpeza da narrativa com número inventado;
 *   · a hora do vigia no fuso da política.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { COMERCIAL_AUTOMACOES, COMERCIAL_ROTULO_DA_ETAPA } from '@mktos/shared';
import { describe, expect, it } from 'vitest';

import { AUTOMACOES_DA_TAREFA, AUTONOMIA_VIGENTE, nivelDe, podeRodar, tarefasDaAutomacao } from '../src/comercial/autonomia';
import { resumoDoEvento } from '../src/comercial/eventos';
import { proximaAcaoDoLead, proximaHoraEmSP, saudeDoLead } from '../src/comercial/proxima-acao';
import {
  alcanceDoLead,
  contarAcoes,
  diasDoPedido,
  funilCumulativo,
  limparNarrativa,
  mediana,
  perdasPorMotivo,
  promptDoRelatorio,
  quemFez,
} from '../src/comercial/relatorio-da-semana';
import { contarPremissas, horaDoVigia, PREMISSA_DA_AUTOMACAO } from '../src/comercial/vigia.service';

const CFG = { fupLeuDias: 3, fupSilencioDias: 7, silencioAprova: false, horaPublicacaoProposta: 18 };
const SEM_NUMEROS = { fupLeuDias: null, fupSilencioDias: null, silencioAprova: false, horaPublicacaoProposta: null };
const AGORA = new Date('2026-10-13T14:00:00-03:00');

describe('a escada de autonomia', () => {
  it('sem nível gravado vale o degrau da régua, e nenhum padrão é A0', () => {
    for (const a of COMERCIAL_AUTOMACOES) {
      expect(AUTONOMIA_VIGENTE[a], a).toMatch(/^A[1-3]$/);
      expect(nivelDe({}, a)).toBe(AUTONOMIA_VIGENTE[a]);
    }
    // R4 nunca é autônomo: assinador, cobrador e fechador ficam em A2 (agente prepara, pessoa aprova).
    expect([AUTONOMIA_VIGENTE.assinador, AUTONOMIA_VIGENTE.cobrador, AUTONOMIA_VIGENTE.fechador]).toEqual(['A2', 'A2', 'A2']);
  });

  it('A0 segura a tarefa da automação; A1 a A3 deixam rodar; tarefa fora da tabela sempre roda', () => {
    expect(podeRodar({ fupeiro: 'A0' }, 'whats.fup')).toMatchObject({ roda: false, automacao: 'fupeiro', nivel: 'A0' });
    for (const n of ['A1', 'A2', 'A3'] as const) expect(podeRodar({ fupeiro: n }, 'whats.fup')).toEqual({ roda: true });
    expect(podeRodar({ fupeiro: 'A0' }, 'espinha.projetar')).toEqual({ roda: true });
    // Reação com duas automações: basta uma em A0 para segurar (a proposta do aceite leva cobrança e contrato juntos).
    expect(podeRodar({ assinador: 'A0' }, 'dinheiro.propor')).toMatchObject({ roda: false, automacao: 'assinador' });
  });

  it('as engrenagens da espinha nunca entram na tabela (pontuação, projeção, saída, decisão)', () => {
    for (const n of ['espinha.projetar', 'espinha.entrada', 'espinha.qualificacao', 'espinha.saida', 'espinha.decisoes-vencidas', 'espinha.reacoes-pendentes', 'sala.abrir', 'inteligencia.duvida', 'whats.janela-de-veto']) {
      expect(AUTOMACOES_DA_TAREFA[n], n).toBeUndefined();
    }
  });

  it('todo nome da tabela está inscrito de verdade em algum serviço do comercial', () => {
    const pasta = join(__dirname, '..', 'src', 'comercial');
    const codigo = readdirSync(pasta)
      .filter((f) => f.endsWith('.ts') && f !== 'autonomia.ts')
      .map((f) => readFileSync(join(pasta, f), 'utf8'))
      .join('\n');
    for (const nome of Object.keys(AUTOMACOES_DA_TAREFA)) {
      expect(codigo.includes(`'${nome}'`), `"${nome}" não aparece inscrito em src/comercial`).toBe(true);
    }
    expect(tarefasDaAutomacao('vigia')).toEqual(['inteligencia.vigia']);
  });
});

describe('a próxima ação é projeção', () => {
  it('reunião marcada sem confirmação: a véspera, um dia antes da conversa', () => {
    const reuniaoEm = new Date('2026-10-16T10:00:00-03:00');
    const a = proximaAcaoDoLead({ etapa: 'reuniao_agendada', reuniaoEm }, CFG, [], AGORA);
    expect(a).toEqual({ tipo: 'vespera', quando: new Date('2026-10-15T10:00:00-03:00').toISOString(), descricao: expect.stringContaining('M3') });
  });

  it('follow-up: M5 depois de N dias da primeira leitura; sem o número, o quando é a validade e diz [a decidir]', () => {
    const lida = new Date('2026-10-10T09:00:00-03:00');
    expect(proximaAcaoDoLead({ etapa: 'follow_up', propostaLidaPelaPrimeiraVezEm: lida, propostaVersao: 1 }, CFG, [], AGORA)).toMatchObject({ tipo: 'm5', quando: new Date('2026-10-13T09:00:00-03:00').toISOString() });
    const validade = new Date('2026-10-20T23:59:00-03:00');
    const sem = proximaAcaoDoLead({ etapa: 'follow_up', propostaLidaPelaPrimeiraVezEm: lida, validade }, SEM_NUMEROS, [], AGORA);
    expect(sem).toMatchObject({ tipo: 'resposta', quando: validade.toISOString() });
    expect(sem!.descricao).toContain('[a decidir]');
  });

  it('decisão aberta vem antes da etapa, com o padrão escrito; sem prazo, sem quando', () => {
    const expiraEm = new Date('2026-10-13T18:00:00-03:00');
    expect(proximaAcaoDoLead({ etapa: 'follow_up' }, CFG, [{ titulo: 'Pediu 8%', padrao: 'manter', expiraEm, semPrazo: false }], AGORA)).toMatchObject({ tipo: 'decisao', quando: expiraEm.toISOString() });
    expect(proximaAcaoDoLead({ etapa: 'follow_up' }, CFG, [{ titulo: 'Pediu 8%', padrao: 'manter', expiraEm: new Date('9999-12-31T23:59:59Z'), semPrazo: true }], AGORA)).toMatchObject({ tipo: 'decisao', quando: null });
  });

  it('contrato: a primeira coisa que falta, na ordem do aceite ao fechamento', () => {
    expect(proximaAcaoDoLead({ etapa: 'contrato', cadastro: { cnpj: 'x' } }, CFG, [], AGORA)?.tipo).toBe('cobranca');
    expect(proximaAcaoDoLead({ etapa: 'contrato', cadastro: {}, cobrancaCriadaEm: AGORA }, CFG, [], AGORA)?.tipo).toBe('pix');
    expect(proximaAcaoDoLead({ etapa: 'contrato', cadastro: {}, cobrancaCriadaEm: AGORA, pixPagoEm: AGORA, contratoAssinadoClienteEm: AGORA, contratoAssinadoRootEm: AGORA }, CFG, [], AGORA)?.tipo).toBe('fechamento');
  });

  it('saídas: só a geladeira com data tem próxima ação; proposta no silêncio-aprova sai às 18h de SP', () => {
    expect(proximaAcaoDoLead({ etapa: 'perdido' }, CFG, [], AGORA)).toBeNull();
    const volta = proximaAcaoDoLead({ etapa: 'geladeira', voltaEm: new Date('2026-12-10T12:00:00Z'), etapaAntesDaSaida: 'proposta' }, CFG, [], AGORA);
    expect(volta).toEqual({ tipo: 'volta_da_geladeira', quando: '2026-12-10T12:00:00.000Z', descricao: `volta da geladeira para ${COMERCIAL_ROTULO_DA_ETAPA.proposta}` });
    expect(proximaAcaoDoLead({ etapa: 'geladeira' }, CFG, [], AGORA)).toBeNull();
    expect(proximaHoraEmSP(AGORA, 18).toISOString()).toBe(new Date('2026-10-13T18:00:00-03:00').toISOString());
    expect(proximaHoraEmSP(new Date('2026-10-13T19:00:00-03:00'), 18).toISOString()).toBe(new Date('2026-10-14T18:00:00-03:00').toISOString());
    const p = proximaAcaoDoLead({ etapa: 'proposta', propostaVersao: 1 }, { ...CFG, silencioAprova: true }, [], AGORA);
    expect(p).toMatchObject({ tipo: 'publicar_proposta', quando: new Date('2026-10-13T18:00:00-03:00').toISOString() });
  });

  it('a saúde fica nula até a mesa decidir a fórmula', () => {
    expect(saudeDoLead()).toBeNull();
  });
});

describe('o fio legível (achados da lane F)', () => {
  it('ata sem o número de caracteres não escreve "undefined"', () => {
    const r = resumoDoEvento('ata.chegou', { hash: 'h', fonte: 'granola' });
    expect(r.resumo).toBe('ata recebida · granola');
    expect(r.resumo).not.toContain('undefined');
    expect(resumoDoEvento('ata.chegou', { hash: 'h', caracteres: 12345, fonte: 'colada' }).resumo).toBe('ata recebida · 12.345 caracteres · colada');
  });

  it('agenda escolhida aparece como "qui 15/10 · 10h" em São Paulo, nunca o ISO cru', () => {
    expect(resumoDoEvento('agenda.escolhida', { horario: '2026-10-15T10:00:00-03:00', oferecidos: [] }).resumo).toBe('escolheu qui 15/10 · 10h');
    expect(resumoDoEvento('agenda.escolhida', { horario: '2026-10-15T13:30:00Z', oferecidos: [] }).resumo).toBe('escolheu qui 15/10 · 10h30');
    expect(resumoDoEvento('kickoff.marcado', { horario: '2026-10-20T15:00:00-03:00' }).resumo).toBe('kickoff marcado · ter 20/10 · 15h');
  });
});

describe('as contas do relatório da quinta', () => {
  it('mediana, recorte e funil cumulativo', () => {
    expect(mediana([])).toBeNull();
    expect(mediana([19, 3, 40])).toBe(19);
    expect(mediana([2, 4, 6, 8])).toBe(5);
    expect(diasDoPedido(undefined)).toBe(7);
    expect(diasDoPedido('30')).toBe(30);
    expect(diasDoPedido('900')).toBe(90);
    // Lead que chegou à proposta e saiu como perdido conta até a proposta.
    expect(alcanceDoLead('perdido', 'follow_up', ['qualificacao', 'proposta'])).toBe(7);
    const f = funilCumulativo([1, 2, 7, 9]);
    expect(f[0]).toEqual({ etapa: 'novo_lead', n: 4 });
    expect(f.find((x) => x.etapa === 'proposta')).toEqual({ etapa: 'proposta', n: 2 });
    expect(f.find((x) => x.etapa === 'fechado')).toEqual({ etapa: 'fechado', n: 1 });
  });

  it('humano, automático e o que o cliente fez (não conta)', () => {
    expect(quemFez({ type: 'decisao.tomada', payload: {} })).toBe('humana');
    expect(quemFez({ type: 'diagnostico.pronto', payload: { aprovadoEm: 'x' } })).toBe('humana');
    expect(quemFez({ type: 'diagnostico.pronto', payload: {} })).toBe('automatica');
    expect(quemFez({ type: 'saida.registrada', payload: { detalhe: 'decisão lead_parado: perdido' } })).toBe('automatica');
    expect(quemFez({ type: 'lead.pontuado', payload: {} })).toBe('automatica');
    expect(quemFez({ type: 'form.respondido', payload: {} })).toBeNull();
    expect(quemFez({ type: 'pix.pago', payload: {} })).toBeNull();
    expect(contarAcoes([{ type: 'lead.pontuado', payload: {} }, { type: 'veto.registrado', payload: {} }, { type: 'sala.visitada', payload: {} }], 2)).toEqual({ automaticas: 1, humanas: 3 });
  });

  it('perdas: perdido e desqualificado, pelo motivo; a geladeira volta e não conta', () => {
    expect(perdasPorMotivo([{ saida: 'perdido', motivo: 'preco' }, { saida: 'desqualificado', motivo: 'sem_base' }, { saida: 'perdido', motivo: 'preco' }, { saida: 'geladeira', motivo: 'momento' }])).toEqual([
      { motivo: 'preco', n: 2 },
      { motivo: 'sem_base', n: 1 },
    ]);
  });

  it('o modelo que inventa número: a frase sai e o número do sistema prevalece', () => {
    const r = limparNarrativa('Foram 47 leads na semana, recorde. A conversa virou proposta onde havia base — e travou na liberação. Vale decidir o prazo do follow-up.');
    expect(r.narrativa).toBe('A conversa virou proposta onde havia base, e travou na liberação. Vale decidir o prazo do follow-up.');
    expect(r.narrativa).not.toMatch(/\d/);
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]).toContain('47');
    expect(limparNarrativa('   ').narrativa).toBeNull();
  });

  it('o pedido proíbe número e leva a marca da tarefa do stub', () => {
    const p = promptDoRelatorio({ periodoDias: 7, leads: 3, fechados: 1, medianaDiasDoOiAoPix: 5, acoes: { automaticas: 10, humanas: 4 }, funil: [], perdasPorMotivo: [], previsao: null, geradoEm: AGORA.toISOString(), narrativa: null });
    expect(p.system).toContain('[tarefa:comercial.relatorio]');
    expect(p.system).toMatch(/NÃO escreva nenhum número/);
  });
});

describe('o vigia', () => {
  it('passa a partir das 08:00 do fuso da política, nunca pela hora do processo', () => {
    expect(horaDoVigia(new Date('2026-10-13T07:59:00-03:00'), 'America/Sao_Paulo')).toEqual({ passou: false, dia: '2026-10-13' });
    expect(horaDoVigia(new Date('2026-10-13T08:00:00-03:00'), 'America/Sao_Paulo')).toEqual({ passou: true, dia: '2026-10-13' });
    // 10:30 UTC é 07:30 em São Paulo: ainda não.
    expect(horaDoVigia(new Date('2026-10-13T10:30:00Z'), 'America/Sao_Paulo').passou).toBe(false);
  });

  it('conta conferidas, quebradas e não conferidas; toda automação tem o texto da premissa', () => {
    const c = contarPremissas([
      { chave: 'a', automacao: null, premissa: 'x', ok: true, detalhe: '', leads: [] },
      { chave: 'b', automacao: null, premissa: 'x', ok: false, detalhe: '', leads: [] },
      { chave: 'c', automacao: null, premissa: 'x', ok: null, detalhe: '', leads: [] },
    ]);
    expect(c).toEqual({ conferidas: 2, quebradas: 1, naoConferidas: 1 });
    for (const a of COMERCIAL_AUTOMACOES) expect(PREMISSA_DA_AUTOMACAO[a], a).toBeTruthy();
    expect(PREMISSA_DA_AUTOMACAO.construtor_de_proposta).toBe('tabela de preço de 04/10');
  });
});
