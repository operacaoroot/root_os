import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { lerDelta, lerPolitica, resolverPolitica } from '@mktos/policy';
import politicaRoot from '@mktos/policy/politica-root.json';
import politicaMktos from '@mktos/policy/politica-marketing-os.json';
import { comContexto, contextoAtual } from '../src/common/contexto-execucao';
import { comContextoDePlataforma, comEmpresaResolvida, caminhosDePlataformaFaltando } from '../src/prisma/contexto-de-plataforma';
import { anunciarPapel, comTenantNaSessao } from '../src/prisma/sessao-de-banco';
import type { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { GoogleLoginService } from '../src/auth/google-login.service';
import { AuditService } from '../src/audit/audit.service';
import { HealthController } from '../src/health/health.controller';
import { PolicyService } from '../src/policy/policy.service';
import { FinanceService } from '../src/finance/finance.service';
import { TetoDeCustoIaService } from '../src/llm/teto-diario.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { ProvisionamentoService } from '../src/tenants/provisionar.service';
import { ProvisionamentoController } from '../src/tenants/provisionar.controller';
import { ModulosService } from '../src/tenants/modulos.service';
import { OnboardingService } from '../src/onboarding/onboarding.service';
import { MemoriaService } from '../src/memory/memoria.service';
import type { AgentDataGrantService } from '../src/memory/agent-data-grant.service';
import type { AgentRuntime } from '../src/agents/agent-runtime.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { provisionarTenant } from '../src/tenants/provisionar';
import type { PluggyService } from '../src/finance/pluggy.service';
import type { AsaasService } from '../src/finance/asaas.service';
import { exigirBancoDescartavel } from './banco-de-teste';

describe('contexto da empresa descoberta', () => {
  it('a descoberta não troca uma empresa autenticada', async () => {
    await comContexto({ orgId: 'empresa-a', correlationId: 'teste' }, async () => {
      expect(await comContextoDePlataforma(async () => contextoAtual()?.orgId)).toBe('empresa-a');
      await expect(comEmpresaResolvida('empresa-b', async () => 'vazou')).rejects.toThrow('diverge');
      expect(contextoAtual()?.orgId).toBe('empresa-a');
    });
    expect(contextoAtual()).toBeUndefined();
  });

  it('recusa sentinela como empresa e tem todos os caminhos ligados', async () => {
    await expect(comEmpresaResolvida('__plataforma__', async () => 1)).rejects.toThrow('sentinela');
    expect(caminhosDePlataformaFaltando()).toEqual([]);
  });
});

// Mesmo contrato das demais provas RLS: no job de isolamento, com duas conexões.
if (process.env.RLS_NO_TESTE === '1') {
  const donaUrl = process.env.TEST_DATABASE_URL;
  const appUrl = process.env.TENANT_DATABASE_URL;
  if (!donaUrl || !appUrl || donaUrl === appUrl) throw new Error('Prova de plataforma exige conexões dona e restrita distintas.');
  exigirBancoDescartavel(donaUrl, 'fixtures de plataforma');
  exigirBancoDescartavel(appUrl, 'prova do papel restrito');

  describe('serviços reais sob papel restrito e TENANT_MODO=impor', () => {
    const dona = new PrismaClient({ datasourceUrl: donaUrl });
    const base = new PrismaClient({ datasourceUrl: appUrl });
    const app = comTenantNaSessao(base, { modo: 'impor', avisar: () => {} }) as PrismaService;
    const marca = randomUUID();
    const a = randomUUID(), b = randomUUID();
    const email = `plataforma-${marca}@example.test`;
    const permissao = `teste.plataforma.${marca}`;
    const jwt = new JwtService({ secret: 'segredo-sintetico-do-teste-plataforma' });
    const auth = new AuthService(app, jwt, new AuditService(app));
    const extras: string[] = [];
    let operadorRoot: { id: string; orgId: string; email: string };
    let papelRoot: { id: string };
    const eventos = new EventLogService(app);
    const provisionamento = new ProvisionamentoService(app, eventos, new AuditService(app), new ModulosService(app));
    const onboarding = new OnboardingService(app, provisionamento, new MemoriaService(app, eventos, {} as AgentDataGrantService),
      eventos, new AuditService(app), {} as AgentRuntime);

    beforeAll(async () => {
      const [papel] = await base.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`
        SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
      expect(papel).toEqual({ rolsuper: false, rolbypassrls: false });
      const [{ n }] = await dona.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) n FROM pg_class WHERE relname IN ('User', 'Org', 'AuditLog', 'BankConnection')
        AND relrowsecurity AND relforcerowsecurity`;
      expect(Number(n)).toBe(4);
      for (const id of [a, b]) await dona.org.create({ data: { id, slug: `t-${id}`, name: id } });
      await dona.user.create({ data: { orgId: a, email, name: 'Sintético', passwordHash: await bcrypt.hash('teste-local', 4),
        roles: { create: { orgId: a, key: 'admin_master', name: 'Administrador',
          permissions: { create: { key: permissao } } } } } });
      const doc = resolverPolitica(lerPolitica(politicaRoot, 'teste'), lerDelta(politicaMktos, 'teste'));
      for (const orgId of [a, b]) {
        await dona.policyVersion.create({ data: { orgId, versao: 1, motivo: 'teste', documento: doc as unknown as Prisma.InputJsonValue } });
        await dona.bankConnection.create({ data: { orgId, provider: 'pluggy', status: 'connected', externalId: `sintetico-${orgId}` } });
      }
      // Outras suítes RLS deixam uma root sintética. Não renomear nem apagar
      // essa fixture: criamos só nosso operador/papel e limpamos só seus rastros.
      let root = await dona.org.findUnique({ where: { slug: 'root' } });
      if (!root) {
        root = await dona.org.create({ data: { slug: 'root', name: 'Plataforma sintética' } });
        extras.push(root.id);
      }
      papelRoot = await dona.role.create({ data: { orgId: root.id, key: `teste-${marca}`, name: 'Operador sintético',
        permissions: { connectOrCreate: { where: { key: 'admin.permissoes' }, create: { key: 'admin.permissoes' } } } } });
      operadorRoot = await dona.user.create({ data: { orgId: root.id, email: `operador-${email}`, name: 'Operador',
        passwordHash: 'inutilizavel-no-teste', roles: { connect: { id: papelRoot.id } } } });
    });

    afterAll(async () => {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      if (operadorRoot) {
        await dona.auditLog.deleteMany({ where: { orgId: operadorRoot.orgId, OR: [
          { actorId: operadorRoot.id }, { metadata: { path: ['correlationId'], equals: marca } },
        ] } });
        await dona.$transaction([
          dona.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
          dona.eventLog.deleteMany({ where: { orgId: operadorRoot.orgId, correlationId: marca } }),
          dona.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
        ]);
        await dona.user.delete({ where: { id: operadorRoot.id } });
        await dona.role.delete({ where: { id: papelRoot.id } });
      }
      for (const orgId of [a, b, ...extras]) {
        const contas = await dona.integrationAccount.findMany({ where: { orgId }, select: { id: true } });
        await dona.integrationHealth.deleteMany({ where: { accountId: { in: contas.map(c => c.id) } } });
        await dona.integrationAccount.deleteMany({ where: { orgId } });
        await dona.bankConnection.deleteMany({ where: { orgId } });
        await dona.auditLog.deleteMany({ where: { orgId } });
        await dona.contextItemVersion.deleteMany({ where: { orgId } });
        await dona.contextItem.deleteMany({ where: { orgId } });
        await dona.knowledgeNote.deleteMany({ where: { orgId } });
        await dona.sop.deleteMany({ where: { orgId } });
        await dona.agent.deleteMany({ where: { orgId } });
        await dona.gastoDeIaNoDia.deleteMany({ where: { orgId } });
        await dona.$transaction([
          dona.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
          dona.eventLog.deleteMany({ where: { orgId } }),
          dona.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
        ]);
        await dona.user.deleteMany({ where: { orgId } });
        await dona.role.deleteMany({ where: { orgId } });
        await dona.policyVersion.deleteMany({ where: { orgId } });
        await dona.org.deleteMany({ where: { id: orgId } });
      }
      await dona.permission.deleteMany({ where: { key: permissao } });
      await Promise.all([base.$disconnect(), dona.$disconnect()]);
    });

    it('libera boot restrito e a saúde anônima', async () => {
      const linhas: string[] = [];
      await anunciarPapel(base, 'impor', m => linhas.push(m));
      expect(linhas.join('\n')).toContain('papel restrito');
      expect(await new HealthController(app).check()).toMatchObject({ status: 'ok', db: 'ok' });
    });

    it('login grava lastLogin e auditoria na empresa encontrada', async () => {
      const sessao = await auth.login(email, 'teste-local');
      expect(jwt.verify(sessao.token).orgId).toBe(a);
      expect(jwt.verify(sessao.token).permissions).toContain(permissao);
      expect((await dona.user.findUniqueOrThrow({ where: { email } })).lastLoginAt).not.toBeNull();
      expect(await dona.auditLog.count({ where: { orgId: a, action: 'auth.login' } })).toBe(1);
      expect(await dona.auditLog.count({ where: { orgId: b, action: 'auth.login' } })).toBe(0);
      await expect(auth.login(email, 'senha-errada')).rejects.toThrow('Credenciais inválidas');
    });

    it('não encontra usuário de A durante uma requisição de B', async () => {
      await comEmpresaResolvida(b, async () => {
        await expect(auth.login(email, 'teste-local')).rejects.toThrow('Credenciais inválidas');
        expect(await app.user.findMany()).toEqual([]);
      });
    });

    it('login Google encontra o usuário sob plataforma e escreve no tenant resolvido', async () => {
      const google = new GoogleLoginService(app, jwt, auth);
      expect((await google['findUser'](email))?.orgId).toBe(a);
      // Provisionamento já dentro de A nunca muda para root/outra empresa.
      const criado = await comEmpresaResolvida(a, () => google['provision'](`google-${email}`, 'Google sintético'));
      expect(criado.orgId).toBe(a);
      const sessao = await auth.issueSession(criado, undefined, 'auth.login.google');
      expect(jwt.verify(sessao.token).orgId).toBe(a);
    });

    it('carrega políticas das duas empresas no arranque sem descartar as sobrescritas', async () => {
      const politica = new PolicyService(app);
      await politica.onModuleInit();
      expect(politica['cache'].has(a)).toBe(true);
      expect(politica['cache'].has(b)).toBe(true);
    });

    it('provisionar duas vezes encontra a empresa existente pelo slug', async () => {
      const entrada = { slug: `t-${a}` };
      const opcoes = { emContexto: <T>(id: string, fn: () => Promise<T>) => comEmpresaResolvida(id, fn) };
      const primeira = await provisionarTenant(app, entrada, opcoes);
      const segunda = await provisionarTenant(app, entrada, opcoes);
      expect(primeira.orgId).toBe(a);
      expect(segunda.orgId).toBe(a);
      expect(primeira.criada).toBe(false);
      expect(segunda.criada).toBe(false);
    });

    it('sincronização bancária lê conexões dentro de cada empresa', async () => {
      vi.useFakeTimers();
      vi.stubEnv('PLUGGY_SYNC_INTERVAL_MIN', '360');
      const financeiro = new FinanceService(app, new AuditService(app), { configured: true } as PluggyService,
        { configured: false } as AsaasService, new EfeitosRegistry());
      const vistas: string[] = [];
      vi.spyOn(financeiro, 'syncBankConnection').mockImplementation(async (orgId, connectionId) => {
        expect(contextoAtual()?.orgId).toBe(orgId);
        const conexao = await app.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
        expect(conexao.orgId).toBe(orgId);
        vistas.push(orgId);
        return { accounts: 0, transactions: 0 };
      });
      try {
        const timeout = vi.spyOn(globalThis, 'setTimeout');
        financeiro.onModuleInit();
        const rodada = timeout.mock.calls.find(([, ms]) => ms === 30_000)?.[0];
        timeout.mockRestore();
        vi.clearAllTimers();
        vi.useRealTimers();
        expect(rodada).toBeTypeOf('function');
        await (rodada as () => Promise<void>)();
        expect(vistas).toEqual(expect.arrayContaining([a, b]));
        await financeiro['markHealth'](b, 'pluggy', 'Sintético', 'ok', null);
        expect(await dona.integrationAccount.count({ where: { orgId: b, key: 'pluggy' } })).toBe(1);
        expect(await dona.integrationAccount.count({ where: { orgId: a, key: 'pluggy' } })).toBe(0);
      } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllEnvs();
      }
    });

    async function reservas() {
      await dona.gastoDeIaNoDia.deleteMany({ where: { orgId: { in: [a, b] } } });
      const velha = new Date(Date.now() - 3600_000);
      for (const [orgId, valor] of [[a, 4], [b, 3]] as const) {
        await dona.gastoDeIaNoDia.create({ data: { orgId, dia: '2026-01-01',
          reservadoUsd: valor, gastoUsd: 2, atualizadoEm: velha } });
      }
      return new TetoDeCustoIaService(app, eventos);
    }

    it('arranque libera vencidas de A/B, preserva reserva recente e não altera gasto', async () => {
      const teto = await reservas();
      await dona.gastoDeIaNoDia.create({ data: { orgId: a, dia: '2026-01-02', reservadoUsd: 5 } });
      expect(await teto.liberarReservasPresas('arranque')).toBe(7);
      const recente = await dona.gastoDeIaNoDia.findUniqueOrThrow({ where: { orgId_dia: { orgId: a, dia: '2026-01-02' } } });
      expect(Number(recente.reservadoUsd)).toBe(5);
      const antiga = await dona.gastoDeIaNoDia.findUniqueOrThrow({ where: { orgId_dia: { orgId: a, dia: '2026-01-01' } } });
      expect(Number(antiga.gastoUsd)).toBe(2);
      expect(await dona.eventLog.count({ where: { orgId: b, tipo: 'ia.reserva_liberada' } })).toBeGreaterThan(0);
    });

    it('varredura chamada dentro de A não atravessa para B', async () => {
      const teto = await reservas();
      expect(await comEmpresaResolvida(a, () => teto.liberarReservasPresas('varredura'))).toBe(4);
      const outra = await dona.gastoDeIaNoDia.findUniqueOrThrow({ where: { orgId_dia: { orgId: b, dia: '2026-01-01' } } });
      expect(Number(outra.reservadoUsd)).toBe(3);
    });

    it('preserva a parcela que o processo ainda tem em voo, inclusive no arranque', async () => {
      const teto = await reservas();
      // Representa a contabilização em memória que reservar() faz antes do INSERT.
      teto['abertas'].set(teto['chave'](a, '2026-01-01'), 2);
      expect(await comEmpresaResolvida(a, () => teto.liberarReservasPresas('arranque'))).toBe(2);
      const linha = await dona.gastoDeIaNoDia.findUniqueOrThrow({ where: { orgId_dia: { orgId: a, dia: '2026-01-01' } } });
      expect(Number(linha.reservadoUsd)).toBe(2);
    });

    it('duas varreduras concorrentes liberam cada reserva uma única vez', async () => {
      const teto = await reservas();
      const outro = new TetoDeCustoIaService(app, eventos);
      const resultados = await Promise.all([teto.liberarReservasPresas('varredura'), outro.liberarReservasPresas('varredura')]);
      expect(resultados.reduce((soma, n) => soma + n, 0)).toBe(7);
      expect(await teto.liberarReservasPresas('varredura')).toBe(0);
    });

    it('operador autorizado provisiona e repete sem duplicar nem plantar admin em empresa existente', async () => {
      const operador = operadorRoot;
      const controller = new ProvisionamentoController(provisionamento, new AuditService(app), app);
      const user = { sub: operador.id, orgId: operador.orgId, email: operador.email, name: 'Operador sintético', roles: ['admin_master'], permissions: ['admin.permissoes'] };
      await comContexto({ orgId: operador.orgId, actorType: 'user', actorId: operador.id, correlationId: marca, origem: 'http' }, async () => {
        const entrada = { slug: `p-${marca}`, nome: 'Empresa sintética' };
        const primeira = await controller.provisionar(user, entrada);
        extras.push(primeira.orgId);
        expect(primeira.criada).toBe(true);
        expect(primeira.rastro.falhaNaConclusao).toBeNull();
        const segunda = await controller.provisionar(user, { ...entrada, admin: { email: `intruso-${email}` }, modulos: [] });
        expect(segunda.orgId).toBe(primeira.orgId);
        expect(segunda.criada).toBe(false);
        expect(segunda.ignorado).toEqual(expect.arrayContaining(['admin', 'modulos']));
        expect(contextoAtual()?.orgId).toBe(operador.orgId);
      });
      expect(await dona.user.count({ where: { email: `intruso-${email}` } })).toBe(0);
      expect(await dona.auditLog.count({ where: { actorId: operador.id, action: 'tenant.provisionar.criado' } })).toBe(1);
    });

    it('empresa cliente e operador desativado não ganham a descoberta global', async () => {
      const operador = operadorRoot;
      const entrada = { slug: `negado-${marca.slice(0, 8)}` };
      const quem = { tipo: 'user' as const, id: operador.id, origem: 'http' as const };
      await comContexto({ orgId: b, actorId: operador.id, correlationId: marca }, async () => {
        await expect(provisionamento.provisionar(entrada, quem)).rejects.toThrow('operador ativo');
        expect(contextoAtual()?.orgId).toBe(b);
      });
      await dona.user.update({ where: { id: operador.id }, data: { isActive: false } });
      try {
        await comContexto({ orgId: operador.orgId, actorId: operador.id, correlationId: marca }, async () => {
          await expect(provisionamento.provisionar(entrada, quem)).rejects.toThrow('operador ativo');
        });
      } finally { await dona.user.update({ where: { id: operador.id }, data: { isActive: true } }); }
      expect(await dona.org.count({ where: { slug: entrada.slug } })).toBe(0);
      expect(await dona.auditLog.count({ where: { orgId: b, action: 'tenant.provisionar.recusado' } })).toBeGreaterThan(0);
    });

    it('permissão revogada no banco vence o token antigo; HTTP não reconfigura empresa', async () => {
      const operador = operadorRoot;
      const papel = { id: papelRoot.id };
      await dona.role.update({ where: papel, data: { permissions: { disconnect: { key: 'admin.permissoes' } } } });
      try {
        await comContexto({ orgId: operador.orgId, actorId: operador.id, origem: 'http', correlationId: marca }, async () => {
          const quem = { tipo: 'user' as const, id: operador.id };
          await expect(provisionamento.provisionar({ slug: `negado-${marca.slice(0, 8)}` }, quem)).rejects.toThrow('operador ativo');
          await expect(provisionamento.provisionar({ slug: `t-${b}`, modo: 'reconfigurar' }, quem)).rejects.toThrow('procedimento administrativo');
        });
      } finally { await dona.role.update({ where: papel, data: { permissions: { connect: { key: 'admin.permissoes' } } } }); }
    });

    it('cadastro semeia roster, carga grava memória com rastro e outra empresa não a lê', async () => {
      const cadastro = await comContexto({ orgId: null, correlationId: marca, origem: 'http' }, () =>
        onboarding.cadastrar({ empresa: 'Piloto sintético', responsavel: { nome: 'Pessoa sintética', email: `piloto-${email}` } }));
      extras.push(cadastro.orgId);
      expect(cadastro.criada).toBe(true);
      expect(cadastro.roster?.criados.length).toBeGreaterThan(0);
      const resposta = await comEmpresaResolvida(cadastro.orgId, () => onboarding.responder(cadastro.orgId, 'negocio',
        'Esta empresa sintética vende serviços de organização financeira para pequenas empresas, com revisão mensal de dados.'));
      const nota = await dona.contextItem.findUniqueOrThrow({ where: { id: resposta.notaId } });
      expect(nota.orgId).toBe(cadastro.orgId);
      expect(await dona.eventLog.count({ where: { orgId: cadastro.orgId } })).toBeGreaterThan(0);
      await comEmpresaResolvida(b, async () => {
        await expect(onboarding.estado(cadastro.orgId)).rejects.toThrow('empresa não encontrada');
        expect(await app.contextItem.findMany({ where: { id: resposta.notaId } })).toEqual([]);
      });
      const elos = await comEmpresaResolvida(cadastro.orgId, () => new MemoriaService(app, eventos, {} as AgentDataGrantService).conferirElos(cadastro.orgId));
      expect(elos.ok).toBe(true);
    });
  });
}
