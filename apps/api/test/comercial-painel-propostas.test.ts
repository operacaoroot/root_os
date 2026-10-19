import { randomUUID } from 'node:crypto';

import { NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PainelComercialService } from '../src/painel-comercial/painel-comercial.service';
import { PropostasDaSalaService } from '../src/painel-comercial/propostas-da-sala.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * O PAINEL GERAL DO COMERCIAL E AS PROPOSTAS DA SALA (versão final, 19/10/2026).
 *
 * O desenho é do Lucas; os dados são do cockpit. A suíte confere, contra o
 * Postgres de teste, que:
 *   · o painel lê `Lead` + `ComercialFicha` (etapa, valor, canal, dono) e os
 *     fatos `cliente.ativo`/encerramento, e nada da lista "Gestão de Leads";
 *   · número que falta fica ausente (sem valor não soma, sem canal é "Sem
 *     informação", conversão nula sem fechamento);
 *   · as propostas da sala saem da última `proposta.publicada`, com leitura
 *     por seção, reações e aceite;
 *   · nada atravessa a empresa: a outra org não vê nem conta nada.
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (empresas, leads, fichas, eventos e reações)');

const MARCA = `pp${Date.now().toString(36).slice(-6)}`;
const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
const p = prisma as unknown as PrismaService;
const painel = new PainelComercialService(p);
const propostas = new PropostasDaSalaService(p);

const AGORA = new Date('2026-10-19T15:00:00Z');
let ORG = '';
let OUTRA = '';
let LUCAS = '';
const L: Record<string, string> = {};

async function lead(org: string, nome: string, ficha: Record<string, unknown> | null, extra: Record<string, unknown> = {}) {
  const l = await prisma.lead.create({ data: { orgId: org, name: nome, status: 'novo', enteredAt: new Date('2026-08-10T12:00:00Z'), ...extra } });
  if (ficha) await prisma.comercialFicha.create({ data: { leadId: l.id, ...ficha } as never });
  return l.id;
}

async function fato(leadId: string, type: string, em: string, payload: Record<string, unknown> = {}) {
  await prisma.leadEvent.create({ data: { id: randomUUID(), leadId, type, occurredAt: new Date(em), payload: payload as never } });
}

beforeAll(async () => {
  ORG = (await prisma.org.create({ data: { name: `Painel ${MARCA}`, slug: `painel-${MARCA}` } })).id;
  OUTRA = (await prisma.org.create({ data: { name: `Outra ${MARCA}`, slug: `outra-painel-${MARCA}` } })).id;
  LUCAS = (await prisma.user.create({ data: { orgId: ORG, name: 'Lucas Teste', email: `lucas-${MARCA}@painel.teste`, passwordHash: 'x' } })).id;

  // Em negociação, com valor, canal e dono.
  L.aberto = await lead(ORG, 'Ana', { etapa: 'proposta', valorCentavos: 1199700, produto: 'operacao', canal: 'indicacao', donoId: LUCAS, empresa: 'Alicerce' });
  // Em negociação sem valor nem canal nem dono: entra na contagem, fora da soma.
  L.semValor = await lead(ORG, 'Bruno', { etapa: 'qualificacao' });
  // Lead sem ficha: está em E1.
  L.semFicha = await lead(ORG, 'Carla', null);
  // Fechou em setembro pelo fato `cliente.ativo`, com o dono do LEAD (sem dono na ficha).
  L.ganho = await lead(ORG, 'Davi', { etapa: 'fechado', valorCentavos: 297000, produto: 'imersao', canal: 'evento', empresa: 'Studio Lume' }, { ownerId: LUCAS });
  await fato(L.ganho, 'cliente.ativo', '2026-09-05T12:00:00Z');
  // Fechou e o contrato foi encerrado: ganho no ano, não é cliente ativo.
  L.encerrado = await lead(ORG, 'Eva', { etapa: 'fechado', valorCentavos: 297000, produto: 'imersao' });
  await fato(L.encerrado, 'cliente.ativo', '2026-07-01T12:00:00Z');
  await fato(L.encerrado, 'contrato.concluido', '2026-10-01T12:00:00Z');
  // Perdido em outubro e um na geladeira.
  L.perdido = await lead(ORG, 'Fabio', { etapa: 'perdido', etapaDesde: new Date('2026-10-02T12:00:00Z'), valorCentavos: 100000 });
  L.geladeira = await lead(ORG, 'Gil', { etapa: 'geladeira' });

  // A outra empresa tem um ganho grande e uma proposta lida: nada disso pode aparecer.
  L.alheio = await lead(OUTRA, 'Hugo', { etapa: 'fechado', valorCentavos: 9_999_900 });
  await fato(L.alheio, 'cliente.ativo', '2026-09-10T12:00:00Z');
  await fato(L.alheio, 'proposta.publicada', '2026-09-01T12:00:00Z', { versao: 1, produto: 'operacao', valorCentavos: 9_999_900 });

  // A proposta da sala: v1 publicada e substituída pela v2, lida em duas visitas, com reações e aceite.
  await fato(L.aberto, 'proposta.publicada', '2026-10-01T12:00:00Z', { versao: 1, produto: 'operacao', valorCentavos: 1300000 });
  await fato(L.aberto, 'proposta.publicada', '2026-10-05T12:00:00Z', { versao: 2, produto: 'operacao', valorCentavos: 1199700 });
  const reacao = (versao: number, secao: string, tipo: string, acesso: number, extra: Record<string, unknown> = {}) =>
    prisma.leadReacao.create({ data: { id: randomUUID(), leadId: L.aberto, versao, secao, tipo, acesso, criadoEm: new Date('2026-10-06T12:00:00Z'), ...extra } as never });
  await reacao(2, 'montar', 'leitura', 1, { segundos: 40, atualizadoEm: new Date('2026-10-06T12:01:00Z') });
  await reacao(2, 'investimento', 'leitura', 1, { segundos: 90, atualizadoEm: new Date('2026-10-06T12:03:00Z') });
  await reacao(2, 'montar', 'leitura', 2, { segundos: 20, atualizadoEm: new Date('2026-10-07T09:00:00Z') });
  await reacao(1, 'investimento', 'leitura', 1, { segundos: 500 }); // da versão antiga: não conta
  await reacao(2, 'montar', 'faz_sentido', 1);
  await reacao(2, 'investimento', 'ideia', 2, { texto: 'Dá para começar pelo financeiro?' });
  await fato(L.aberto, 'proposta.aceita', '2026-10-08T12:00:00Z', { versao: 2 });

  // Uma publicada que ninguém abriu.
  await fato(L.semValor, 'proposta.publicada', '2026-10-10T12:00:00Z', { versao: 1, produto: 'imersao', valorCentavos: 297000 });
});

afterAll(async () => {
  for (const org of [ORG, OUTRA].filter(Boolean)) {
    const ids = (await prisma.lead.findMany({ where: { orgId: org }, select: { id: true } })).map((l) => l.id);
    await prisma.leadReacao.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.leadEvent.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.comercialFicha.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.lead.deleteMany({ where: { orgId: org } });
    await prisma.user.deleteMany({ where: { orgId: org } });
    await prisma.org.delete({ where: { id: org } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

describe('Painel geral do Comercial lendo o cockpit', () => {
  it('conta o ano com os fatos do cockpit e deixa ausente o que não existe', async () => {
    const r = await painel.painel(ORG, AGORA);
    expect(r.ano).toBe(2026);
    expect(r.negocios).toHaveLength(7);
    // Em negociação: Ana (proposta, R$ 11.997), Bruno (sem valor) e Carla (sem ficha, E1).
    expect(r.totais.abertos).toBe(3);
    expect(r.totais.emNegociacao).toBe(11997);
    expect(r.totais.ganhosNoAno).toBe(2);
    expect(r.totais.valorGanhoNoAno).toBe(5940);
    expect(r.totais.perdidosNoAno).toBe(1);
    expect(r.totais.naGeladeira).toBe(1);
    expect(r.totais.conversao).toBe(67);
    expect(r.totais.ticketMedio).toBe(2970);
    expect(r.totais.ganhosSemValor).toBe(0);
    expect(r.totais.clientesAtivos).toBe(1);
    expect(r.totais.contratosVivos).toBe(1);
    expect(r.foraDoTeto).toBe(0);
  });

  it('o negócio leva etapa, canal, vendedor e produto do cockpit', async () => {
    const r = await painel.painel(ORG, AGORA);
    const ana = r.negocios.find((n) => n.id === L.aberto)!;
    expect(ana).toMatchObject({ titulo: 'Alicerce', nome: 'Ana', etapaChave: 'proposta', etapa: 'E6 · Proposta', resultado: 'aberta', valor: 11997, canal: 'Indicação', vendedor: 'Lucas Teste', produto: 'Operação ROOT' });
    const davi = r.negocios.find((n) => n.id === L.ganho)!;
    expect(davi).toMatchObject({ resultado: 'ganho', vendedor: 'Lucas Teste', canal: 'Evento', mesFechado: '2026-09', mesesFechados: ['2026-09'], clienteAtivo: true });
    const carla = r.negocios.find((n) => n.id === L.semFicha)!;
    expect(carla).toMatchObject({ etapaChave: 'novo_lead', valor: null, canal: null, vendedor: null });
    expect(r.negocios.find((n) => n.id === L.encerrado)!.clienteAtivo).toBe(false);
  });

  it('funil por etapa, meses e grupos', async () => {
    const r = await painel.painel(ORG, AGORA);
    expect(r.etapas.map((e) => e.id)).toEqual(['novo_lead', 'qualificacao', 'reuniao_agendada', 'sessao', 'diagnostico', 'proposta', 'follow_up', 'contrato', 'fechado', 'desqualificado', 'geladeira', 'perdido', 'parceiro']);
    expect(r.etapas.find((e) => e.id === 'fechado')).toMatchObject({ qtd: 2, valor: 5940, resultado: 'ganho' });
    expect(r.fechadosPorMes.find((m) => m.mes === '2026-09')).toMatchObject({ qtd: 1, valor: 2970 });
    expect(r.fechadosPorMes.find((m) => m.mes === '2026-07')).toMatchObject({ qtd: 1 });
    expect(r.entradasPorMes.find((m) => m.mes === '2026-08')!.qtd).toBe(7);
    expect(r.canais.find((c) => c.nome === 'Sem informação')!.leads).toBe(5);
    const lucas = r.vendedores.find((v) => v.nome === 'Lucas Teste')!;
    expect(lucas).toMatchObject({ leads: 2, abertos: 1, ganhos: 1, valorGanho: 2970 });
  });

  it('a outra empresa não vê nada desta e esta não conta nada dela', async () => {
    const r = await painel.painel(OUTRA, AGORA);
    expect(r.negocios.map((n) => n.id)).toEqual([L.alheio]);
    const daqui = await painel.painel(ORG, AGORA);
    expect(daqui.negocios.some((n) => n.id === L.alheio)).toBe(false);
  });

  it('empresa sem leads: painel vazio, conversão e ticket ausentes', async () => {
    const vazia = (await prisma.org.create({ data: { name: `Vazia ${MARCA}`, slug: `vazia-painel-${MARCA}` } })).id;
    try {
      const r = await painel.painel(vazia, AGORA);
      expect(r.negocios).toEqual([]);
      expect(r.totais.conversao).toBeNull();
      expect(r.totais.ticketMedio).toBeNull();
    } finally {
      await prisma.org.delete({ where: { id: vazia } });
    }
  });
});

describe('Lista de leads lendo a tabela Lead do cockpit', () => {
  it('traz contato, empresa, etapa, canal e dono; sem ficha é E1; ordena pela última atividade', async () => {
    const r = await painel.listaDeLeads(ORG);
    expect(r.leads).toHaveLength(7);
    expect(r.foraDoTeto).toBe(0);
    const ana = r.leads.find((x) => x.id === L.aberto)!;
    expect(ana).toMatchObject({ contato: 'Ana', empresa: 'Alicerce', etapaChave: 'proposta', etapa: 'E6 · Proposta', canal: 'Indicação', dono: 'Lucas Teste' });
    expect(r.leads.find((x) => x.id === L.semFicha)).toMatchObject({ etapaChave: 'novo_lead', empresa: null, canal: null, dono: null });
    const datas = r.leads.map((x) => x.ultimaAtividade);
    expect([...datas].sort().reverse()).toEqual(datas);
  });

  it('não atravessa a empresa', async () => {
    expect((await painel.listaDeLeads(ORG)).leads.some((x) => x.id === L.alheio)).toBe(false);
    expect((await painel.listaDeLeads(OUTRA)).leads.map((x) => x.id)).toEqual([L.alheio]);
  });
});

describe('Propostas publicadas pela sala', () => {
  it('uma linha por lead, na última versão, com leitura, reações e aceite', async () => {
    const r = await propostas.lista(ORG);
    expect(r.propostas.map((x) => x.leadId)).toEqual([L.semValor, L.aberto]);
    const ana = r.propostas.find((x) => x.leadId === L.aberto)!;
    expect(ana).toMatchObject({ cliente: 'Alicerce', titulo: 'Operação ROOT · v2', versao: 2, valor: 11997, etapa: 3, estado: 'Aceita', aberturas: 2 });
    expect(ana.reacoes).toEqual({ fazSentido: 1, duvidas: 0, ideias: 1 });
    expect(ana.aceitaEm).toBe('2026-10-08T12:00:00.000Z');
    const bruno = r.propostas.find((x) => x.leadId === L.semValor)!;
    expect(bruno).toMatchObject({ etapa: 0, estado: 'Ainda não abriu', aberturas: 0, ultimaAtividade: null });
  });

  it('o detalhe soma o tempo por seção só da versão vigente e lista as visitas', async () => {
    const d = await propostas.detalhe(ORG, L.aberto);
    expect(d.tempoTotalSegundos).toBe(150);
    expect(d.tempoPorParte).toEqual([
      { secao: 'montar', nome: 'O que vamos montar', segundos: 60, aberturasQueViram: 2 },
      { secao: 'investimento', nome: 'Investimento', segundos: 90, aberturasQueViram: 1 },
    ]);
    expect(d.maisVista).toBe('Investimento');
    expect(d.visitas.map((v) => [v.acesso, v.segundos, v.leuAte])).toEqual([[2, 20, 'O que vamos montar'], [1, 130, 'Investimento']]);
    expect(d.fazSentidoPorSecao).toEqual([{ secao: 'montar', nome: 'O que vamos montar', vezes: 1 }]);
    expect(d.anotacoes.map((a) => [a.tipo, a.texto])).toEqual([['ideia', 'Dá para começar pelo financeiro?']]);
  });

  it('não atravessa a empresa', async () => {
    const r = await propostas.lista(ORG);
    expect(r.propostas.some((x) => x.leadId === L.alheio)).toBe(false);
    await expect(propostas.detalhe(ORG, L.alheio)).rejects.toBeInstanceOf(NotFoundException);
    expect((await propostas.lista(OUTRA)).propostas.map((x) => x.leadId)).toEqual([L.alheio]);
  });

  it('lead sem proposta publicada: 404', async () => {
    await expect(propostas.detalhe(ORG, L.geladeira)).rejects.toBeInstanceOf(NotFoundException);
  });
});
