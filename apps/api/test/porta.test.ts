import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, ActorType, ApprovalState } from '@prisma/client';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import { ApprovalsService } from '../src/approvals/approvals.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { ToolGateway, type ExecCtx } from '../src/gateway/tool-gateway.service';
import { AuditService } from '../src/audit/audit.service';
import type { PrismaService } from '../src/prisma/prisma.service';

/*
 * O roteiro da demo, em teste, contra banco de verdade.
 *
 * Precisa de TEST_DATABASE_URL com as migrations aplicadas e a política
 * semeada. Sobe assim:
 *   docker run -d --name mktos-shadow -e POSTGRES_PASSWORD=shadow \
 *     -e POSTGRES_USER=mkt -e POSTGRES_DB=marketing_os -p 55432:5432 \
 *     pgvector/pgvector:pg16
 *   DATABASE_URL=... pnpm --filter @mktos/api db:deploy
 *   DATABASE_URL=... pnpm --filter @mktos/api db:seed:politica
 *   TEST_DATABASE_URL=... pnpm --filter @mktos/api test:porta
 */
const URL = process.env.TEST_DATABASE_URL;
const ORG = 'org-teste-porta';

describe.skipIf(!URL)('a porta', () => {
  let prisma: PrismaClient;
  let gateway: ToolGateway;
  let approvals: ApprovalsService;
  let eventos: EventLogService;

  const ctx = (extra: Partial<ExecCtx> = {}): ExecCtx => ({
    orgId: ORG,
    actorType: ActorType.ai,
    actorId: 'agente-teste',
    agentSlug: 'assistente',
    correlationId: 'sess-1',
    ...extra,
  });

  beforeAll(async () => {
    process.env.GATEWAY_MODO = 'impor';
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    await prisma.org.upsert({
      where: { id: ORG },
      create: { id: ORG, name: 'Teste da porta', slug: 'teste-porta' },
      update: {},
    });

    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    const policy = new PolicyService(p);
    await policy.onModuleInit();
    const sinais = new SinaisService(p, policy);
    approvals = new ApprovalsService(p, audit);
    eventos = new EventLogService(p);
    gateway = new ToolGateway(p, policy, sinais, approvals, eventos);
  });

  afterAll(async () => {
    // O EventLog é append-only de verdade: a RULE de DELETE também vale para o
    // teste. Desligar explicitamente aqui é o preço de a garantia ser real.
    await prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete');
    await prisma.eventLog.deleteMany({ where: { orgId: ORG } });
    await prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete');
    await prisma.approval.deleteMany({ where: { orgId: ORG } });
    await prisma.toolCall.deleteMany({ where: { orgId: ORG } });
    await prisma.policyDecision.deleteMany({ where: { orgId: ORG } });
    await prisma.auditLog.deleteMany({ where: { orgId: ORG } });
    await prisma.org.deleteMany({ where: { id: ORG } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.approval.deleteMany({ where: { orgId: ORG } });
    await prisma.toolCall.deleteMany({ where: { orgId: ORG } });
  });

  it('R0 executa direto — leitura não pede licença a ninguém', async () => {
    let rodou = false;
    const r = await gateway.executar(
      { capabilityId: 'numeros.painel.ler', args: {}, ctx: ctx() },
      async () => {
        rodou = true;
        return { leadsHoje: 12 };
      },
    );
    expect(r.status).toBe('executado');
    expect(rodou).toBe(true);
    if (r.status === 'executado') expect(r.decisao.nivel).toBe('R0');
  });

  it('R3 RETÉM: a ação não acontece e vira item na fila', async () => {
    let rodou = false;
    const r = await gateway.executar(
      {
        capabilityId: 'whatsapp.mensagem.enviar',
        args: { titulo: 'Resumo da semana', corpo: 'texto exato' },
        ctx: ctx(),
        resource: { type: 'whatsapp.mensagem.enviar', id: 'grupo-1' },
      },
      async () => {
        rodou = true;
        return { enviado: true };
      },
    );

    expect(r.status).toBe('aguardando_aprovacao');
    // é isto que separa "pede confirmação na tela" de porta: o efeito NÃO rodou
    expect(rodou).toBe(false);
    if (r.status === 'aguardando_aprovacao') {
      expect(r.decisao.nivel).toBe('R3');
      const fila = await approvals.listar(ORG);
      expect(fila.items.map((i) => i.id)).toContain(r.approvalId);
    }
  });

  it('R5 é BLOQUEADO antes de existir efeito, e devolve o preparo', async () => {
    let rodou = false;
    const r = await gateway.executar(
      { capabilityId: 'financeiro.pagamento.baixar', args: { titulo: 'T-1' }, ctx: ctx() },
      async () => {
        rodou = true;
        return { baixado: true };
      },
    );
    expect(r.status).toBe('recusado');
    expect(rodou).toBe(false);
    if (r.status === 'recusado') {
      expect(r.decisao.nivel).toBe('R5');
      expect(r.motivo).toContain('preparado e encaminhado');
      // R5 não é "não pode": é preparado e devolvido para a pessoa executar
      expect(r.preparo).toMatchObject({ capacidade: 'financeiro.pagamento.baixar' });
    }
  });

  it('capacidade fora da declaração do agente é recusada, sem olhar nível', async () => {
    const r = await gateway.executar(
      {
        capabilityId: 'numeros.painel.ler', // é R0, e mesmo assim recusa
        args: {},
        ctx: ctx({ capacidadesDeclaradas: ['contexto.memoria.buscar'] }),
      },
      async () => ({ nunca: true }),
    );
    expect(r.status).toBe('recusado');
    if (r.status === 'recusado') expect(r.motivo).toContain('não está nas capacidades declaradas');
  });

  it('capacidade que não existe vale R5 — falha fechada', async () => {
    const r = await gateway.executar(
      { capabilityId: 'inventada.que.nao.existe', args: {}, ctx: ctx() },
      async () => ({ nunca: true }),
    );
    expect(r.status).toBe('recusado');
    if (r.status === 'recusado') {
      expect(r.decisao.motivo).toBe('capacidade sem classificação vale R5');
    }
  });

  it('aprovado, executa — e o token é de USO ÚNICO mesmo em corrida', async () => {
    const args = { titulo: 'Resumo', corpo: 'o texto exato que vai sair' };
    const proposta = await approvals.propor({
      orgId: ORG,
      propostoPorId: 'agente-teste',
      propostoPorTipo: ActorType.ai,
      capabilityId: 'whatsapp.mensagem.enviar',
      resourceType: 'whatsapp.mensagem.enviar',
      resourceId: 'grupo-1',
      args,
      hashKeys: ['titulo', 'corpo'],
      decisao: {
        nivel: 'R3',
        nivelBase: 'R3',
        permitido: true,
        exigeAprovacao: true,
        exigeReautenticacao: false,
        exigeMotivo: false,
        aprovacao: {
          exigida: 'sempre',
          vinculo: 'conteudo',
          usoUnico: true,
          validadeSegundos: 900,
          reautenticacao: false,
          alcadaMinima: 'responsavel',
        },
        sinaisAcionados: [],
        motivo: 'classificado como R3',
      },
    });

    // quem aprova é gente, e nunca quem propôs
    await expect(approvals.confirm(ORG, proposta.approvalId, 'agente-teste')).rejects.toThrow(
      /não pode aprová-la/,
    );
    await approvals.confirm(ORG, proposta.approvalId, 'pedro');

    const executa = () =>
      gateway.executar(
        {
          capabilityId: 'whatsapp.mensagem.enviar',
          args,
          ctx: ctx(),
          resource: { type: 'whatsapp.mensagem.enviar', id: 'grupo-1' },
          approvalToken: proposta.token,
        },
        async () => ({ enviado: true }),
      );

    // duas ao mesmo tempo: no Map isso mandava a mensagem duas vezes
    const [a, b] = await Promise.all([executa(), executa()]);
    const sucessos = [a, b].filter((r) => r.status === 'executado');
    const recusas = [a, b].filter((r) => r.status === 'recusado');
    expect(sucessos).toHaveLength(1);
    expect(recusas).toHaveLength(1);
    // a segunda não estoura: vira resultado, e o laço do agente segue vivo
    const recusa = recusas[0];
    if (recusa.status === 'recusado') expect(recusa.motivo).toContain('uso único');
  });

  it('mudar o conteúdo depois de aprovado invalida a aprovação', async () => {
    const args = { titulo: 'Original', corpo: 'texto aprovado' };
    const proposta = await approvals.propor({
      orgId: ORG,
      propostoPorId: 'agente-teste',
      propostoPorTipo: ActorType.ai,
      capabilityId: 'whatsapp.mensagem.enviar',
      resourceType: 'whatsapp.mensagem.enviar',
      resourceId: 'grupo-1',
      args,
      hashKeys: ['titulo', 'corpo'],
      decisao: {
        nivel: 'R3', nivelBase: 'R3', permitido: true, exigeAprovacao: true,
        exigeReautenticacao: false, exigeMotivo: false,
        aprovacao: { exigida: 'sempre', vinculo: 'conteudo', usoUnico: true, validadeSegundos: 900, reautenticacao: false, alcadaMinima: 'responsavel' },
        sinaisAcionados: [], motivo: 'R3',
      },
    });
    await approvals.confirm(ORG, proposta.approvalId, 'pedro');

    await expect(
      approvals.consumir({
        orgId: ORG,
        token: proposta.token,
        resourceType: 'whatsapp.mensagem.enviar',
        resourceId: 'grupo-1',
        args: { titulo: 'Original', corpo: 'TEXTO TROCADO DEPOIS DA APROVAÇÃO' },
        hashKeys: ['titulo', 'corpo'],
        actorId: 'agente-teste',
      }),
    ).rejects.toThrow(/difere do que foi aprovado/);
  });

  it('a recusa também fica registrada — é dela que sai a prova', async () => {
    const antes = await prisma.policyDecision.count({ where: { orgId: ORG, permitido: false } });
    await gateway.executar(
      { capabilityId: 'financeiro.pagamento.baixar', args: {}, ctx: ctx() },
      async () => ({}),
    );
    const depois = await prisma.policyDecision.count({ where: { orgId: ORG, permitido: false } });
    expect(depois).toBe(antes + 1);
  });

  it('o registro vem ANTES do efeito, e a cadeia fecha', async () => {
    const ordem: string[] = [];
    await gateway.executar(
      { capabilityId: 'numeros.painel.ler', args: {}, ctx: ctx({ correlationId: 'sess-cadeia' }) },
      async () => {
        // quando o efeito roda, a proposta já tem que estar gravada
        const gravados = await prisma.eventLog.count({
          where: { orgId: ORG, correlationId: 'sess-cadeia', tipo: 'tool.proposta' },
        });
        ordem.push(`proposta gravada: ${gravados}`);
        return {};
      },
    );
    expect(ordem[0]).toBe('proposta gravada: 1');

    const v = await eventos.verificar(ORG);
    expect(v.ok, JSON.stringify(v.quebrouEm)).toBe(true);
    expect(v.verificados).toBeGreaterThan(0);
  });

  it('adulterar uma linha do rastro quebra a cadeia e a verificação acusa', async () => {
    await gateway.executar(
      { capabilityId: 'numeros.painel.ler', args: {}, ctx: ctx() },
      async () => ({}),
    );
    const alvo = await prisma.eventLog.findFirst({ where: { orgId: ORG }, orderBy: { seq: 'desc' } });
    // As RULEs impedem UPDATE pelo caminho normal; aqui força por SQL cru,
    // desligando a regra, para provar que a VERIFICAÇÃO pega.
    await prisma.$executeRawUnsafe(`ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_update`);
    await prisma.$executeRawUnsafe(`UPDATE "EventLog" SET tipo = 'adulterado' WHERE id = $1`, alvo!.id);
    await prisma.$executeRawUnsafe(`ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_update`);

    const v = await eventos.verificar(ORG);
    expect(v.ok).toBe(false);
    expect(v.quebrouEm?.motivo).toContain('não bate com o hash gravado');

    // limpa para não contaminar os outros testes
    await prisma.$executeRawUnsafe(`ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete`);
    await prisma.$executeRawUnsafe(`DELETE FROM "EventLog" WHERE "orgId" = $1`, ORG);
    await prisma.$executeRawUnsafe(`ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete`);
  });

  it('em MODO OBSERVAR a porta classifica, registra e deixa passar', async () => {
    process.env.GATEWAY_MODO = 'observar';
    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    const policy = new PolicyService(p);
    await policy.onModuleInit();
    const observador = new ToolGateway(
      p,
      policy,
      new SinaisService(p, policy),
      new ApprovalsService(p, audit),
      new EventLogService(p),
    );
    process.env.GATEWAY_MODO = 'impor';

    let rodou = false;
    const r = await observador.executar(
      { capabilityId: 'financeiro.pagamento.baixar', args: {}, ctx: ctx() },
      async () => {
        rodou = true;
        return { ok: true };
      },
    );
    // R5 em observação: NÃO barra a operação, mas a decisão fica registrada
    expect(r.status).toBe('executado');
    expect(rodou).toBe(true);
    const d = await prisma.policyDecision.findFirst({
      where: { orgId: ORG, modo: 'observar' },
      orderBy: { criadoEm: 'desc' },
    });
    expect(d?.permitido).toBe(false);
    expect(d?.nivel).toBe('R5');
  });
});
