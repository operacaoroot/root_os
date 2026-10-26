import { describe, expect, it } from 'vitest';

import type { PainelComercialService } from '../src/painel-comercial/painel-comercial.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { TarefasDoComercialService } from '../src/comercial/tarefas/tarefas-do-comercial.service';
import {
  fechouEm,
  movimentosDaSemana,
  propostasDaSemana,
  saidasDaSemana,
  semanaDaRodada,
  type FatoDaRodada,
  type LeadDaRodada,
} from '../src/comercial/rodada/rodada-da-semana';
import { RodadaDaSemanaService } from '../src/comercial/rodada/rodada-da-semana.service';

/*
 * Layout 26/10: a Rodada da semana do Comercial sai do banco, não do texto escrito à
 * mão (`painel-root.md`). A suíte confere a semana de São Paulo (segunda a domingo),
 * as regras de cada bloco e que o serviço monta a resposta só com o que o Prisma, o
 * Painel geral e as tarefas do comercial devolvem. Sem banco: o Prisma é um dublê.
 */

const AGORA = new Date('2026-10-28T15:00:00Z'); // quarta, 12:00 em São Paulo

describe('a semana da rodada', () => {
  it('é segunda 00:00 a domingo 23:59 de São Paulo, com fim exclusivo', () => {
    const s = semanaDaRodada(undefined, AGORA);
    expect(s).toMatchObject({ de: '2026-10-26', ate: '2026-11-01', anterior: '2026-10-19', proxima: null, atual: true });
    expect(s.inicio.toISOString()).toBe('2026-10-26T03:00:00.000Z');
    expect(s.fim.toISOString()).toBe('2026-11-02T03:00:00.000Z');
  });

  it('domingo 23:30 em São Paulo ainda é a semana; segunda 00:30 já é a seguinte', () => {
    expect(semanaDaRodada(undefined, new Date('2026-11-02T02:30:00Z')).de).toBe('2026-10-26');
    expect(semanaDaRodada(undefined, new Date('2026-11-02T03:30:00Z')).de).toBe('2026-11-02');
  });

  it('qualquer dia pedido vira a segunda da semana dele, com a próxima', () => {
    const s = semanaDaRodada('2026-10-22', AGORA);
    expect(s).toMatchObject({ de: '2026-10-19', ate: '2026-10-25', proxima: '2026-10-26', atual: false });
  });

  it('semana futura ou pedido inválido viram a semana de agora', () => {
    expect(semanaDaRodada('2026-12-01', AGORA).de).toBe('2026-10-26');
    expect(semanaDaRodada('ontem', AGORA).de).toBe('2026-10-26');
    expect(semanaDaRodada(['2026-10-01'], AGORA).de).toBe('2026-10-26');
  });
});

const LEADS = new Map<string, LeadDaRodada>([
  ['a', { id: 'a', nome: 'Ana', empresa: 'Alicerce' }],
  ['b', { id: 'b', nome: 'Bruno', empresa: null }],
]);
const em = (iso: string) => new Date(iso);

describe('os blocos da rodada', () => {
  const fatos: FatoDaRodada[] = [
    { leadId: 'a', type: 'etapa.mudou', payload: { de: 'sessao', para: 'diagnostico', motivo: 'ata' }, occurredAt: em('2026-10-27T12:00:00Z') },
    { leadId: 'b', type: 'etapa.mudou', payload: { de: 'proposta', para: 'follow_up', motivo: 'mão' }, occurredAt: em('2026-10-27T13:00:00.000Z') },
    { leadId: 'b', type: 'etapa.movida_a_mao', payload: { de: 'proposta', para: 'follow_up', por: 'Lucas' }, occurredAt: em('2026-10-27T13:00:00.001Z') },
    { leadId: 'b', type: 'etapa.mudou', payload: { de: 'follow_up', para: 'geladeira', motivo: 'saída' }, occurredAt: em('2026-10-28T10:00:00Z') },
    { leadId: 'b', type: 'saida.registrada', payload: { saida: 'geladeira', motivo: 'momento', voltaEm: '2027-01-10', por: 'Lucas' }, occurredAt: em('2026-10-28T10:00:00.002Z') },
    { leadId: 'a', type: 'proposta.publicada', payload: { versao: 2, valorCentavos: 1199700 }, occurredAt: em('2026-10-27T18:00:00Z') },
  ];

  it('movimento: só para etapa do funil, com quem moveu à mão', () => {
    const m = movimentosDaSemana(fatos, LEADS);
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ leadId: 'b', nome: 'Bruno', de: 'E6 · Proposta', para: 'E7 · Follow-up', aMao: true, por: 'Lucas' });
    expect(m[1]).toMatchObject({ leadId: 'a', nome: 'Alicerce', de: 'E4 · Sessão estratégica', para: 'E5 · Diagnóstico', aMao: false, por: null });
  });

  it('saída: o tipo e o motivo em palavras', () => {
    expect(saidasDaSemana(fatos, LEADS)).toEqual([
      { leadId: 'b', nome: 'Bruno', saida: 'Geladeira', motivo: 'momento', detalhe: null, voltaEm: '2027-01-10', por: 'Lucas', em: '2026-10-28T10:00:00.002Z' },
    ]);
  });

  it('proposta enviada: cada versão publicada, com o valor do fato', () => {
    expect(propostasDaSemana(fatos, LEADS)).toEqual([{ leadId: 'a', nome: 'Alicerce', versao: 2, valor: 11997, em: '2026-10-27T18:00:00.000Z' }]);
  });

  it('fechou: o primeiro cliente.ativo; sem ele, a ficha em E9', () => {
    const ficha = { etapa: 'fechado', clienteAtivoEm: null, etapaDesde: em('2026-10-27T12:00:00Z') };
    expect(fechouEm(em('2026-09-01T00:00:00Z'), ficha)?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(fechouEm(null, ficha)?.toISOString()).toBe('2026-10-27T12:00:00.000Z');
    expect(fechouEm(null, { ...ficha, etapa: 'contrato' })).toBeNull();
  });
});

describe('o serviço da rodada', () => {
  function servico() {
    const chamadas: Record<string, unknown[]> = {};
    const registrar = (nome: string, args: unknown) => {
      (chamadas[nome] ??= []).push(args);
    };
    const prisma = {
      lead: {
        findMany: async (args: { where: { id?: unknown } }) => {
          registrar('lead.findMany', args);
          if (!args.where.id) {
            return [{ id: 'n', name: 'Nina', enteredAt: em('2026-10-27T11:00:00Z'), source: { name: 'Site' }, ficha: null }];
          }
          return [
            { id: 'a', name: 'Ana', ficha: { empresa: 'Alicerce', valorCentavos: 297000, produto: 'imersao' } },
            { id: 'f', name: 'Fábio', ficha: { empresa: null, valorCentavos: null, produto: null } },
            { id: 'v', name: 'Vera', ficha: { empresa: 'Velha', valorCentavos: 500000, produto: 'operacao' } },
          ];
        },
      },
      leadEvent: {
        findMany: async (args: unknown) => {
          registrar('leadEvent.findMany', args);
          return [
            { leadId: 'a', type: 'cliente.ativo', payload: {}, occurredAt: em('2026-10-27T15:00:00Z') },
            // Vera voltou a ter cliente.ativo na semana, mas o primeiro foi em setembro: não fechou agora.
            { leadId: 'v', type: 'cliente.ativo', payload: {}, occurredAt: em('2026-10-28T15:00:00Z') },
          ];
        },
        groupBy: async (args: unknown) => {
          registrar('leadEvent.groupBy', args);
          return [
            { leadId: 'a', _min: { occurredAt: em('2026-10-27T15:00:00Z') } },
            { leadId: 'v', _min: { occurredAt: em('2026-09-02T15:00:00Z') } },
          ];
        },
      },
      comercialFicha: {
        findMany: async (args: unknown) => {
          registrar('comercialFicha.findMany', args);
          return [{ leadId: 'f', etapa: 'fechado', clienteAtivoEm: null, etapaDesde: em('2026-10-26T14:00:00Z') }];
        },
      },
    } as unknown as PrismaService;
    const painel = {
      painel: async () => ({ totais: { emNegociacao: 45000, abertos: 4, emNegociacaoPagante: 30000, emNegociacaoSemCaixa: 15000 } }),
    } as unknown as PainelComercialService;
    const tarefas = {
      listar: async () => ({
        hoje: '2026-10-28',
        pessoas: [],
        abertas: 2,
        tarefas: [
          { id: 't1', titulo: 'Ligar para Ana', prazo: '2026-10-20', situacao: 'atrasada', pessoa: { id: 'u', nome: 'Lucas' }, responsavelTexto: null, lead: { id: 'a', nome: 'Alicerce' } },
          { id: 't2', titulo: 'Mandar proposta', prazo: '2026-10-29', situacao: 'proximos_7', pessoa: null, responsavelTexto: null, lead: null },
        ],
      }),
    } as unknown as TarefasDoComercialService;
    return { svc: new RodadaDaSemanaService(prisma, painel, tarefas), chamadas };
  }

  it('monta a semana com o que o banco e os dois serviços devolvem', async () => {
    const { svc } = servico();
    const r = await svc.rodada('org', 'u', undefined, AGORA);
    expect(r.semana).toEqual({ de: '2026-10-26', ate: '2026-11-01', anterior: '2026-10-19', proxima: null, atual: true });
    expect(r.entraram).toEqual([{ leadId: 'n', nome: 'Nina', etapa: 'E1 · Novo lead', canal: 'Site', em: '2026-10-27T11:00:00.000Z' }]);
    expect(r.fechados.map((f) => [f.leadId, f.valor])).toEqual([['a', 2970], ['f', null]]);
    expect(r.valorFechado).toBe(2970);
    expect(r.tarefasAtrasadas).toEqual([{ id: 't1', titulo: 'Ligar para Ana', prazo: '2026-10-20', pessoa: 'Lucas', lead: { id: 'a', nome: 'Alicerce' } }]);
    expect(r.negociacao).toEqual({ total: 45000, abertos: 4, pagante: 30000, semCaixa: 15000 });
  });

  it('toda leitura leva a empresa da sessão e a janela da semana', async () => {
    const { svc, chamadas } = servico();
    await svc.rodada('org-1', 'u', '2026-10-22', AGORA);
    const janela = { gte: new Date('2026-10-19T03:00:00.000Z'), lt: new Date('2026-10-26T03:00:00.000Z') };
    for (const lista of Object.values(chamadas)) {
      for (const args of lista) expect((args as { where: { orgId: string } }).where.orgId).toBe('org-1');
    }
    expect((chamadas['leadEvent.findMany'][0] as { where: { occurredAt: unknown } }).where.occurredAt).toEqual(janela);
    expect((chamadas['lead.findMany'][0] as { where: { enteredAt: unknown } }).where.enteredAt).toEqual(janela);
  });
});
