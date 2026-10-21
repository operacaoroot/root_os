import { randomUUID } from 'node:crypto';
import { AgentEstado, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { funcaoPorSlug } from '@mktos/shared';

import { exigirBancoDescartavel } from './banco-de-teste';
import { GastoPorFuncaoService } from '../src/llm/gasto-por-funcao.service';
import {
  ROTINAS_DA_CASA,
  TIPOS_DA_CASA,
  garantirRotinaDaCasa,
  inscreverTarefaDaCasa,
  registrarPassagemDeFundo,
  rotinaDaCasa,
} from '../src/routines/rotinas-da-casa';
import { ExecutorDasRotinasDaCasa } from '../src/routines/executores/casa.executor';
import { ExecutoresDeRotinaRegistry } from '../src/routines/executores.registry';
import { lerNovaRotina } from '../src/routines/nova-rotina';
import { ROSTER_DE_ENTRADA, ROSTER_DO_ONBOARDING, semearRoster } from '../src/agents/roster';
import { EMAIL_DA_CONTA_DE_ACAO, PREFIXO_DA_SENHA_INUTILIZADA, desativarIaAcao } from '../src/scripts/desativar-ia-acao';
import type { PrismaService } from '../src/prisma/prisma.service';

/*
 * A FUNDAÇÃO DOS AGENTES CONTRA UM BANCO DE VERDADE (rodada dos agentes, 21/10/2026, A1).
 *
 *  · o livro do gasto por função soma e lê o mês;
 *  · cada uma das cinco rotinas da casa registra a passagem no histórico, com
 *    ok/erro/pulada e duração, respeita a pausa da tela e o arrendamento;
 *  · o "Rodar agora" roda o trabalho inscrito; o tique devolve pulada;
 *  · o roster semeia com o filtro de módulo;
 *  · a conta ia-acao@ é desativada sem apagar, com auditoria, e de forma idempotente.
 */

const URL = process.env.TEST_DATABASE_URL ?? '';
exigirBancoDescartavel(URL, 'cria e apaga empresas, rotinas, gasto e uma conta de teste');

const A = `a1-fund-${randomUUID().slice(0, 8)}`;
const B = `a1-fund-b-${randomUUID().slice(0, 8)}`;

describe.skipIf(!URL)('a fundação dos agentes, com banco', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    await prisma.org.create({ data: { id: A, name: A, slug: A, modulos: [] } });
    await prisma.org.create({ data: { id: B, name: B, slug: B, modulos: ['financeiro', 'leads', 'trabalho', 'campanhas'] } });
  }, 60_000);

  afterAll(async () => {
    const orgs = { in: [A, B] };
    await prisma.gastoDeIaPorFuncao.deleteMany({ where: { orgId: orgs } });
    await prisma.rotinaExecucao.deleteMany({ where: { orgId: orgs } });
    await prisma.rotina.deleteMany({ where: { orgId: orgs } });
    await prisma.sop.deleteMany({ where: { orgId: orgs } });
    await prisma.agent.deleteMany({ where: { orgId: orgs } });
    await prisma.auditLog.deleteMany({ where: { orgId: orgs } });
    await prisma.user.deleteMany({ where: { orgId: orgs } });
    await prisma.org.deleteMany({ where: { id: orgs } });
    await prisma.$disconnect();
  }, 60_000);

  // ---------------------------------------------------------------------------
  describe('o livro do gasto por função', () => {
    it('soma por função e por dia, e lê o mês por função para a tela de Agentes', async () => {
      const svc = new GastoPorFuncaoService(prisma as unknown as PrismaService);
      const agora = new Date('2026-10-21T15:00:00Z');
      await svc.registrar({ orgId: A, funcao: 'CO-11', modelo: 'claude-haiku-5-5', gastoUsd: 0.001, agora });
      await svc.registrar({ orgId: A, funcao: 'CO-11', modelo: 'claude-haiku-5-5', gastoUsd: 0.002, agora });
      await svc.registrar({ orgId: A, agentSlug: 'assistente', modelo: 'claude-sonnet-5-5', estimadoUsd: 0.01, agora });
      await svc.registrar({ orgId: A, funcao: 'CE-05', modelo: 'text-embedding-3-small', tipo: 'vetorizacao', gastoUsd: 0.0004, agora });
      await svc.registrar({ orgId: A, modelo: 'claude-opus-5-5', gastoUsd: 0.5, naoMedida: false, agora });
      // Outro mês e outra empresa não entram.
      await svc.registrar({ orgId: A, funcao: 'CO-11', modelo: 'claude-haiku-5-5', gastoUsd: 9, agora: new Date('2026-09-10T15:00:00Z') });
      await svc.registrar({ orgId: B, funcao: 'CO-11', modelo: 'claude-haiku-5-5', gastoUsd: 9, agora });

      const mes = await svc.doMes(A, '2026-10');
      const porFuncao = Object.fromEntries(mes.itens.map((i) => [i.funcao ?? '(sem)', i]));
      expect(porFuncao['CO-11']).toMatchObject({ chamadas: 2, gastoUsd: 0.003, totalUsd: 0.003, agentSlug: funcaoPorSlug('vigia-das-08h')!.slug });
      expect(porFuncao['CE-01']).toMatchObject({ agentSlug: 'assistente', estimadoUsd: 0.01, chamadas: 1 });
      expect(porFuncao['CE-05'].porTipo).toEqual({ vetorizacao: 0.0004 });
      expect(porFuncao['(sem)']).toMatchObject({ funcao: null, agentSlug: null, totalUsd: 0.5 });
      expect(mes.totalUsd).toBeCloseTo(0.003 + 0.01 + 0.0004 + 0.5, 6);
      const porSlug = await svc.totalDoMesPorSlug(A, '2026-10');
      expect(porSlug.get('assistente')).toBe(0.01);
    });

    it('melhor esforço: empresa inexistente não lança', async () => {
      const svc = new GastoPorFuncaoService(prisma as unknown as PrismaService);
      await expect(svc.registrar({ orgId: 'nao-existe', funcao: 'CO-11', modelo: 'x' })).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  describe('as cinco rotinas da casa', () => {
    it('saem do cadastro único: casa.clickup, casa.vault, casa.conciliacao, casa.bio, casa.metas', () => {
      expect(ROTINAS_DA_CASA.map((r) => r.tipo).sort()).toEqual([...TIPOS_DA_CASA].sort());
      expect(ROTINAS_DA_CASA.map((r) => r.slug).sort()).toEqual(
        ['conciliador-bancario', 'coletor-bio', 'indexador-vault', 'ponte-metas', 'sincronizador-clickup'].sort(),
      );
      for (const r of ROTINAS_DA_CASA) expect(funcaoPorSlug(r.slug)?.tipo).toBe('rotina');
    });

    it.each(TIPOS_DA_CASA)('%s: a passagem vai ao histórico com status e duração, sem dado de cliente', async (tipo) => {
      const r = await registrarPassagemDeFundo(prisma, { orgId: A, tipo }, async () => ({ status: 'ok', resumo: '3 item(ns)' }), {
        criar: 'sempre',
        intervaloMin: 30,
      });
      expect(r.status).toBe('ok');
      const def = rotinaDaCasa(tipo);
      const rotina = await prisma.rotina.findUniqueOrThrow({ where: { orgId_slug: { orgId: A, slug: def.slug } } });
      expect(rotina).toMatchObject({ tipo, origem: 'casa', estado: AgentEstado.rodando, ativo: true, agenteSlug: def.slug, execucoes: 1, falhas: 0 });
      expect(rotina.reservadoAte.getTime()).toBe(0);
      const linhas = await prisma.rotinaExecucao.findMany({ where: { orgId: A, rotinaId: rotina.id } });
      expect(linhas).toHaveLength(1);
      expect(linhas[0]).toMatchObject({ status: 'ok', resumo: '3 item(ns)', erro: null });
      expect(linhas[0].duracaoMs).toBeGreaterThanOrEqual(0);
    });

    it('erro do trabalho vira linha de erro e falha contada; o trabalho não derruba quem chamou', async () => {
      const r = await registrarPassagemDeFundo(prisma, { orgId: A, tipo: 'casa.bio' }, async () => {
        throw new Error('a plataforma recusou');
      });
      expect(r).toEqual({ status: 'erro', resumo: 'a plataforma recusou' });
      const rotina = await prisma.rotina.findUniqueOrThrow({ where: { orgId_slug: { orgId: A, slug: 'coletor-bio' } } });
      expect(rotina.falhas).toBe(1);
      const ultima = await prisma.rotinaExecucao.findFirst({ where: { rotinaId: rotina.id }, orderBy: { inicioEm: 'desc' } });
      expect(ultima).toMatchObject({ status: 'erro', erro: 'a plataforma recusou' });
    });

    it('pulada vira linha uma vez; a repetida igual não', async () => {
      const pular = async () => ({ status: 'pulada' as const, resumo: 'nada a recalcular' });
      await registrarPassagemDeFundo(prisma, { orgId: A, tipo: 'casa.metas' }, pular);
      await registrarPassagemDeFundo(prisma, { orgId: A, tipo: 'casa.metas' }, pular);
      const rotina = await prisma.rotina.findUniqueOrThrow({ where: { orgId_slug: { orgId: A, slug: 'ponte-metas' } } });
      const puladas = await prisma.rotinaExecucao.count({ where: { rotinaId: rotina.id, status: 'pulada' } });
      expect(puladas).toBe(1);
      expect(rotina.execucoes).toBe(1); // a pulada não conta como execução
    });

    it('empresa que nunca teve trabalho não ganha rotina vazia (criar se houver trabalho)', async () => {
      await registrarPassagemDeFundo(prisma, { orgId: B, tipo: 'casa.conciliacao' }, async () => ({ status: 'pulada', resumo: 'nenhuma conexão' }));
      expect(await prisma.rotina.count({ where: { orgId: B, tipo: 'casa.conciliacao' } })).toBe(0);
    });

    it('pausada em /rotinas, o trabalho NÃO roda', async () => {
      await prisma.rotina.update({ where: { orgId_slug: { orgId: A, slug: 'indexador-vault' } }, data: { estado: AgentEstado.pausado } });
      let rodou = false;
      const r = await registrarPassagemDeFundo(prisma, { orgId: A, tipo: 'casa.vault' }, async () => {
        rodou = true;
        return { status: 'ok', resumo: 'x' };
      });
      expect(rodou).toBe(false);
      expect(r.status).toBe('pulada');
      await prisma.rotina.update({ where: { orgId_slug: { orgId: A, slug: 'indexador-vault' } }, data: { estado: AgentEstado.rodando } });
    });

    it('com outra passagem em curso (arrendamento), não roda em dobro', async () => {
      await prisma.rotina.update({
        where: { orgId_slug: { orgId: A, slug: 'sincronizador-clickup' } },
        data: { reservadoAte: new Date(Date.now() + 60_000) },
      });
      let rodou = false;
      const r = await registrarPassagemDeFundo(prisma, { orgId: A, tipo: 'casa.clickup' }, async () => {
        rodou = true;
        return { status: 'ok', resumo: 'x' };
      });
      expect(rodou).toBe(false);
      expect(r).toEqual({ status: 'pulada', resumo: 'outra passagem desta rotina está em curso' });
      await prisma.rotina.update({ where: { orgId_slug: { orgId: A, slug: 'sincronizador-clickup' } }, data: { reservadoAte: new Date(0) } });
    });

    it('garantir diz se criou (o gancho do ClickUp nascer desligado) e é idempotente', async () => {
      const primeira = await garantirRotinaDaCasa(prisma, B, 'casa.clickup');
      const segunda = await garantirRotinaDaCasa(prisma, B, 'casa.clickup');
      expect([primeira.criada, segunda.criada]).toEqual([true, false]);
      expect(segunda.rotina.id).toBe(primeira.rotina.id);
    });

    it('o executor casa.*: Rodar agora roda o trabalho inscrito; o tique devolve pulada', async () => {
      const registro = new ExecutoresDeRotinaRegistry();
      const ex = new ExecutorDasRotinasDaCasa(registro);
      ex.onModuleInit();
      expect(registro.inscritos).toEqual(expect.arrayContaining([...TIPOS_DA_CASA]));
      inscreverTarefaDaCasa('casa.metas', async (orgId) => ({ status: 'ok', resumo: `rodou em ${orgId === A ? 'A' : '?'}` }), 'teste');
      const ctx = { orgId: A, rotinaId: 'x', slug: 'ponte-metas', config: {}, refExterna: null, correlationId: 'c', agora: new Date() };
      expect(await registro.executar('casa.metas', { ...ctx, origem: 'manual' })).toEqual({ status: 'ok', resumo: 'rodou em A' });
      expect((await registro.executar('casa.metas', { ...ctx, origem: 'cron' })).status).toBe('pulada');
    });

    it('as rotinas da casa não se criam pela tela', () => {
      const lida = lerNovaRotina({ nome: 'Outra', tipo: 'casa.vault', cron: '* * * * *' }, ['pauta.coleta']);
      expect(lida).toHaveProperty('erro');
    });
  });

  // ---------------------------------------------------------------------------
  describe('o roster semeia com o filtro de módulo', () => {
    it('empresa sem módulo: o assistente só com a espinha; com módulos, com o que eles alcançam', async () => {
      await semearRoster(prisma, A, { donoId: null });
      await semearRoster(prisma, B, { donoId: null });
      const semModulo = await prisma.agent.findUniqueOrThrow({ where: { orgId_slug: { orgId: A, slug: 'assistente' } } });
      const comModulos = await prisma.agent.findUniqueOrThrow({ where: { orgId_slug: { orgId: B, slug: 'assistente' } } });
      expect(semModulo.capacidades.sort()).toEqual(['contexto.memoria.buscar', 'numeros.painel.ler']);
      expect(comModulos.capacidades.sort()).toEqual([...funcaoPorSlug('assistente')!.capacidades].sort());
      for (const a of [semModulo, comModulos]) {
        expect(a.capacidades).not.toContain('whatsapp.mensagem.enviar');
        expect(a.capacidades).not.toContain('financeiro.pagamento.baixar');
        expect(a.capacidades).not.toContain('contexto.nota.ler');
        expect(a.capacidades).not.toContain('numeros.funil.ler');
      }
      expect(semModulo.missao).toBe(funcaoPorSlug('assistente')!.paraQueServe);
    });

    it('os rosters saem do cadastro (nome, missão, capacidades), com complemento para cada um', () => {
      for (const a of [...ROSTER_DE_ENTRADA, ...ROSTER_DO_ONBOARDING]) {
        const f = funcaoPorSlug(a.slug)!;
        expect(a.nome).toBe(f.nome);
        expect(a.missao).toBe(f.paraQueServe);
        expect([...a.capacidades]).toEqual([...f.capacidades]);
        expect(a.iniciais).toMatch(/^[A-Z]{2}$/);
        expect(a.sop.passos.length).toBeGreaterThan(0);
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe('a conta ia-acao@ é desativada, nunca apagada', () => {
    it('simula, desativa com auditoria, e a segunda vez não muda nada', async () => {
      const papel = await prisma.role.create({ data: { orgId: A, key: `ia_acao_${A}`, name: 'IA Ação' } });
      const email = `ia-acao+${A}@marketing-os.local`;
      const conta = await prisma.user.create({
        data: { orgId: A, name: 'IA Ação', email, passwordHash: '$2a$10$hashqualquerdeteste', roles: { connect: { id: papel.id } } },
      });

      const simulada = await desativarIaAcao(prisma, { valer: false, email });
      expect(simulada.desfecho).toBe('desativaria');
      expect((await prisma.user.findUniqueOrThrow({ where: { id: conta.id } })).isActive).toBe(true);

      const feita = await desativarIaAcao(prisma, { valer: true, email });
      expect(feita.desfecho).toBe('desativada');
      const depois = await prisma.user.findUniqueOrThrow({ where: { id: conta.id }, include: { roles: true } });
      expect(depois.isActive).toBe(false);
      expect(depois.passwordHash.startsWith(PREFIXO_DA_SENHA_INUTILIZADA)).toBe(true);
      expect(depois.roles.map((r) => r.id)).toEqual([papel.id]); // nada apagado
      const auditoria = await prisma.auditLog.findMany({ where: { orgId: A, action: 'usuario.conta_de_maquina_desativada' } });
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]).toMatchObject({ entityType: 'User', entityId: conta.id, actorType: 'system' });
      expect(JSON.stringify(auditoria[0])).not.toContain(depois.passwordHash);

      const de_novo = await desativarIaAcao(prisma, { valer: true, email });
      expect(de_novo.desfecho).toBe('ja-desativada');
      expect(await prisma.auditLog.count({ where: { orgId: A, action: 'usuario.conta_de_maquina_desativada' } })).toBe(1);

      await prisma.user.update({ where: { id: conta.id }, data: { roles: { set: [] } } });
      await prisma.role.delete({ where: { id: papel.id } });
    });

    it('conta inexistente: nada a fazer', async () => {
      expect((await desativarIaAcao(prisma, { valer: true, email: `ninguem+${A}@x.local` })).desfecho).toBe('inexistente');
      expect(EMAIL_DA_CONTA_DE_ACAO).toBe('ia-acao@marketing-os.local');
    });
  });
});
