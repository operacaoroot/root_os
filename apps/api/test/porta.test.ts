import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient, ActorType, ApprovalState } from '@prisma/client';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import { ApprovalsService } from '../src/approvals/approvals.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { ToolGateway, type ExecCtx } from '../src/gateway/tool-gateway.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { AcoesService } from '../src/gateway/acoes.service';
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

/*
 * QUEM APROVA, nesta suíte, É UMA PESSOA DE VERDADE, COM PAPEL NO BANCO.
 *
 * Desde a fatia 3.4 a confirmação compara a `alcadaMinima` gravada na aprovação
 * com o PAPEL de quem aprova (`src/approvals/alcada.ts`) — e esse papel é lido
 * DO BANCO, em todo nível, não do token de sessão. Um identificador solto não
 * existe na tabela de usuários, e quem não existe não aprova nada; por isso o
 * `beforeAll` semeia o papel `admin_master` e o usuário `pedro`.
 *
 * Os papéis declarados aqui são só os do token, e servem a uma trava única: a de
 * "é gente" (conta de serviço não confirma). A autoridade vem do banco.
 */
const PEDRO = { id: 'pedro', papeis: ['admin_master'] };

describe.skipIf(!URL)('a porta', () => {
  let prisma: PrismaClient;
  let gateway: ToolGateway;
  /*
   * A MESMA política que a porta usa. Serve para o teste DERIVAR o nível
   * esperado em vez de fixar a string: `simular()` é o motor puro, sem
   * persistir nada (é o simulador da tela da Régua). Fixar 'R2' na mão foi o
   * que quebrou esta suíte quando a fatia 2.2 subiu `crm.lead.criar` para R3.
   */
  let policy: PolicyService;
  let approvals: ApprovalsService;
  let eventos: EventLogService;
  let acoes: AcoesService;
  let registro: EfeitosRegistry;
  let enviados: string[];

  const ctx = (extra: Partial<ExecCtx> = {}): ExecCtx => ({
    orgId: ORG,
    actorType: ActorType.ai,
    actorId: 'agente-teste',
    agentSlug: 'assistente',
    correlationId: 'sess-1',
    ...extra,
  });

  /*
   * A porta lê GATEWAY_MODO no CONSTRUTOR — mexer na variável depois de a
   * instância existir não muda nada (é a mesma pegadinha do `docker restart`
   * que não troca variável de ambiente). Cada teste de modo constrói a sua.
   */
  const porta = async (modo: 'impor' | 'observar'): Promise<ToolGateway> => {
    const anterior = process.env.GATEWAY_MODO;
    const restaurar = () => {
      /*
       * `process.env.X = undefined` grava a STRING "undefined". A porta lê
       * `(process.env.GATEWAY_MODO ?? 'observar')`, e "undefined" não é nulo:
       * a instância seguinte cairia num modo que não é observar nem impor —
       * `observando` daria false e ela se comportaria como IMPOR, sem ninguém
       * perceber. Variável que não existia tem que voltar a não existir.
       */
      if (anterior === undefined) delete process.env.GATEWAY_MODO;
      else process.env.GATEWAY_MODO = anterior;
    };
    process.env.GATEWAY_MODO = modo;
    try {
      const p = prisma as unknown as PrismaService;
      const policy = new PolicyService(p);
      await policy.onModuleInit();
      return new ToolGateway(
        p,
        policy,
        new SinaisService(p, policy),
        new ApprovalsService(p, new AuditService(p)),
        new EventLogService(p),
      );
    } finally {
      restaurar();
    }
  };

  beforeAll(async () => {
    /*
     * Relógio preso às 14:00. Sem isto a suíte passa de dia e falha de noite:
     * o sinal `fora_da_janela` (08:00–20:00) sobe TODO nível um degrau, e os
     * testes de classificação viam R1 onde esperavam R0. Escalonamento tem
     * teste próprio; aqui o que se mede é a classificação.
     */
    vi.setSystemTime(new Date('2026-09-01T14:00:00-03:00'));
    process.env.GATEWAY_MODO = 'impor';
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    await prisma.org.upsert({
      where: { id: ORG },
      create: { id: ORG, name: 'Teste da porta', slug: 'teste-porta' },
      update: {},
    });

    // O aprovador precisa EXISTIR e estar ativo: a confirmação relê o banco.
    const papelDoPedro = await prisma.role.upsert({
      where: { orgId_key: { orgId: ORG, key: 'admin_master' } },
      create: { orgId: ORG, key: 'admin_master', name: 'Admin Master' },
      update: {},
      select: { id: true },
    });
    await prisma.user.upsert({
      where: { id: PEDRO.id },
      create: {
        id: PEDRO.id,
        orgId: ORG,
        email: `pedro@porta.teste`,
        name: 'Pedro',
        // Hash inutilizável de propósito: nada nesta suíte é R4, então ninguém
        // reautentica aqui. Senha de verdade só na suíte de alçada.
        passwordHash: 'sem-senha-util',
        roles: { connect: { id: papelDoPedro.id } },
      },
      update: { isActive: true, roles: { set: [{ id: papelDoPedro.id }] } },
    });

    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    policy = new PolicyService(p);
    await policy.onModuleInit();
    const sinais = new SinaisService(p, policy);
    approvals = new ApprovalsService(p, audit);
    eventos = new EventLogService(p);
    gateway = new ToolGateway(p, policy, sinais, approvals, eventos);

    enviados = [];
    registro = new EfeitosRegistry();
    registro.registrar({
      'whatsapp.mensagem.enviar': async (a) => {
        enviados.push(String(a.corpo));
        return { enviado: true, id: 'msg-1' };
      },
    });
    acoes = new AcoesService(p, registro, eventos);
  });

  afterAll(async () => {
    vi.useRealTimers();
    // O EventLog é append-only de verdade: a RULE de DELETE também vale para o
    // teste. Desligar explicitamente aqui é o preço de a garantia ser real.
    await prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete');
    await prisma.eventLog.deleteMany({ where: { orgId: ORG } });
    await prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete');
    await prisma.approval.deleteMany({ where: { orgId: ORG } });
    await prisma.toolCall.deleteMany({ where: { orgId: ORG } });
    await prisma.policyDecision.deleteMany({ where: { orgId: ORG } });
    await prisma.auditLog.deleteMany({ where: { orgId: ORG } });
    // Usuário e papel ANTES da empresa: as duas tabelas têm FK para Org.
    await prisma.user.deleteMany({ where: { orgId: ORG } });
    await prisma.role.deleteMany({ where: { orgId: ORG } });
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
    const antes = await prisma.policyDecision.count({ where: { orgId: ORG } });
    const recusadasAntes = await prisma.policyDecision.count({
      where: { orgId: ORG, permitido: false },
    });
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

    /*
     * A recusa mais frequente de um agente novo TEM que virar linha em
     * PolicyDecision: é dessa tabela que o relatório de calibragem tira "o que
     * a porta barrou". Antes desta fatia esta recusa criava ToolCall e evento
     * e não criava decisão nenhuma — sumia do relatório.
     */
    expect(await prisma.policyDecision.count({ where: { orgId: ORG } })).toBe(antes + 1);
    expect(await prisma.policyDecision.count({ where: { orgId: ORG, permitido: false } })).toBe(
      recusadasAntes + 1,
    );

    const d = await prisma.policyDecision.findFirst({
      where: { orgId: ORG },
      orderBy: { criadoEm: 'desc' },
    });
    // E o relatório distingue as três recusas: esta, o argumento inválido e o
    // bloqueio por R5 têm motivos diferentes.
    expect(d?.motivo).toBe('recusado na porta: capacidade fora da declaração do agente');
    expect(d?.permitido).toBe(false);
    // Nada foi retido: recusa não passa pela fila de ninguém.
    expect(d?.exigeAprovacao).toBe(false);
    expect(d?.capabilityId).toBe('numeros.painel.ler');

    // O detalhe — qual capacidade, qual campo — fica no ToolCall, ligado à
    // decisão pelo decisionId.
    if (r.status === 'recusado') {
      const tc = await prisma.toolCall.findUnique({ where: { id: r.toolCallId } });
      expect(tc?.decisionId).toBe(d?.id);
      expect(tc?.nivel).toBe('R0');
      expect(tc?.erro).toContain('não está nas capacidades declaradas');
    }
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
    await expect(approvals.confirm(ORG, proposta.approvalId, { ...PEDRO, id: 'agente-teste' })).rejects.toThrow(
      /não pode aprová-la/,
    );
    await approvals.confirm(ORG, proposta.approvalId, PEDRO);

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
    await approvals.confirm(ORG, proposta.approvalId, PEDRO);

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
      // argumento válido de propósito: o que está sob teste é o BLOQUEIO do
      // R5, e sem isso a validação recusaria antes e o teste mediria outra coisa
      { capabilityId: 'financeiro.pagamento.baixar', args: { titulo: 'T-9' }, ctx: ctx() },
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

  it('aprovar EXECUTA — e com o texto GRAVADO, não com o que vier depois', async () => {
    const args = { titulo: 'Resumo', corpo: 'o texto exato que foi aprovado' };

    // 1. o agente propõe: a porta retém e o efeito não roda
    let rodouNaProposta = false;
    const proposta = await gateway.executar(
      {
        capabilityId: 'whatsapp.mensagem.enviar',
        args,
        ctx: ctx(),
        resource: { type: 'whatsapp.mensagem.enviar', id: 'grupo-1' },
      },
      async () => {
        rodouNaProposta = true;
        return {};
      },
    );
    expect(proposta.status).toBe('aguardando_aprovacao');
    expect(rodouNaProposta).toBe(false);
    expect(enviados).toHaveLength(0);
    if (proposta.status !== 'aguardando_aprovacao') return;

    // 2. uma pessoa confirma
    await approvals.confirm(ORG, proposta.approvalId, PEDRO);

    // 3. e AGORA sai — com o texto da proposta
    const r = await acoes.executarAprovada(ORG, proposta.approvalId, 'pedro');
    expect(r.status).toBe('executado');
    expect(enviados).toEqual(['o texto exato que foi aprovado']);

    // 4. dois cliques no botão não mandam duas vezes
    await expect(acoes.executarAprovada(ORG, proposta.approvalId, 'pedro')).rejects.toThrow(
      /já foi executada \(uso único\)/,
    );
    expect(enviados).toHaveLength(1);

    // 5. e ficou registrado que a EXECUÇÃO foi de gente, não da IA
    const ev = await prisma.eventLog.findFirst({
      where: { orgId: ORG, tipo: 'acao.executada' },
      orderBy: { seq: 'desc' },
    });
    expect(ev?.actorType).toBe(ActorType.user);
    expect(ev?.actorId).toBe('pedro');
  });

  it('capacidade aprovada mas sem efeito ligado NÃO finge que executou', async () => {
    const vazio = new AcoesService(prisma as unknown as PrismaService, new EfeitosRegistry(), eventos);
    const proposta = await gateway.executar(
      {
        capabilityId: 'whatsapp.mensagem.enviar',
        args: { titulo: 'T', corpo: 'c' },
        ctx: ctx(),
        resource: { type: 'whatsapp.mensagem.enviar', id: 'grupo-1' },
      },
      async () => ({}),
    );
    if (proposta.status !== 'aguardando_aprovacao') throw new Error('deveria reter');
    await approvals.confirm(ORG, proposta.approvalId, PEDRO);

    const r = await vazio.executarAprovada(ORG, proposta.approvalId, 'pedro');
    expect(r.status).toBe('sem_efeito');
    if (r.status === 'sem_efeito') expect(r.motivo).toContain('efeito não está ligado');
  });

  it('aprovação da superfície antiga não tenta executar nada', async () => {
    const a = await approvals.create({
      orgId: ORG,
      actorId: 'agente-teste',
      resourceType: 'lead',
      resourceId: 'lead-1',
      changes: { status: 'ganho' },
    });
    await approvals.confirm(ORG, a.approvalId, PEDRO);
    // ali quem executa é a própria rota, com o token — não a fila
    const r = await acoes.executarAprovada(ORG, a.approvalId, 'pedro');
    expect(r.status).toBe('nada_a_executar');
  });

  it('fora da janela de horário, a régua sobe o nível sozinha', async () => {
    // 02:00 — o sinal fora_da_janela acende e R0 vira R1. Foi visto em produção
    // antes de existir este teste, e é o que prova que os seis sinais estão
    // ligados a dado real e não são enfeite de tela.
    vi.setSystemTime(new Date('2026-09-01T02:00:00-03:00'));
    const r = await gateway.executar(
      { capabilityId: 'numeros.painel.ler', args: {}, ctx: ctx() },
      async () => ({ ok: true }),
    );
    vi.setSystemTime(new Date('2026-09-01T14:00:00-03:00'));

    expect(r.status).toBe('executado');
    if (r.status === 'executado') {
      expect(r.decisao.nivelBase).toBe('R0');
      expect(r.decisao.nivel).toBe('R1');
      expect(r.decisao.sinaisAcionados).toContain('fora_da_janela');
      expect(r.decisao.motivo).toContain('elevado');
    }
  });

  it('argumento com o nome errado é recusado NA PORTA, antes de reter nada', async () => {
    // O caso de 01/09/2026: o modelo propôs {message}, a capacidade espera
    // {corpo}. Antes, isso passava pela régua, virava item na fila, alguém
    // aprovava — e só então o efeito morria, com a aprovação já queimada.
    const antes = await prisma.approval.count({ where: { orgId: ORG } });
    const decisoesAntes = await prisma.policyDecision.count({ where: { orgId: ORG } });
    const r = await gateway.executar(
      {
        capabilityId: 'whatsapp.mensagem.enviar',
        args: { message: 'texto no campo errado' },
        ctx: ctx(),
      },
      async () => ({ nunca: true }),
    );
    expect(r.status).toBe('recusado');
    if (r.status === 'recusado') expect(r.motivo).toContain('argumentos inválidos');
    // e NÃO entrou na fila de ninguém
    expect(await prisma.approval.count({ where: { orgId: ORG } })).toBe(antes);

    // Mas ENTROU no relatório: recusar sem registrar a decisão é apagar do
    // relatório de calibragem exatamente o erro que mais aparece.
    expect(await prisma.policyDecision.count({ where: { orgId: ORG } })).toBe(decisoesAntes + 1);
    const d = await prisma.policyDecision.findFirst({
      where: { orgId: ORG },
      orderBy: { criadoEm: 'desc' },
    });
    expect(d?.motivo).toBe('recusado na porta: argumentos inválidos');
    expect(d?.permitido).toBe(false);
    expect(d?.exigeAprovacao).toBe(false);
    // O nível registrado é o da capacidade, não um R5 inventado: quem lê o
    // relatório precisa ver que o argumento errado foi num R3.
    expect(d?.nivel).toBe('R3');
    if (r.status === 'recusado') {
      const tc = await prisma.toolCall.findUnique({ where: { id: r.toolCallId } });
      expect(tc?.decisionId).toBe(d?.id);
      // qual campo faltou fica aqui, para o humano que for depurar
      expect(tc?.erro).toContain('message');
    }
  });

  /*
   * R5 EM OBSERVAR — falha fechada, e por quê.
   *
   * Até 10/09/2026 este teste dizia o contrário: "classifica, registra e deixa
   * passar". Era a leitura de que observar afrouxa a classificação, e ela
   * esbarra na escada — R5 é o degrau em que o OS PREPARA, REGISTRA E
   * ENCAMINHA para uma pessoa executar na origem — e na proibição, nas
   * constraints, de regra automática agir no lugar de gente.
   *
   * A exposição prática era zero: nenhuma capacidade R5 tem efeito ligado
   * hoje. Vira grave no dia em que alguém ligar um — e esse dia não avisa.
   */
  it('em MODO OBSERVAR o R5 continua BLOQUEADO: registra o "teria bloqueado" e não chama o efeito', async () => {
    const observador = await porta('observar');

    let rodou = false;
    const r = await observador.executar(
      { capabilityId: 'financeiro.pagamento.baixar', args: { titulo: 'T-9' }, ctx: ctx() },
      async () => {
        rodou = true;
        return { ok: true };
      },
    );
    expect(r.status).toBe('recusado');
    expect(rodou).toBe(false);
    if (r.status === 'recusado') {
      expect(r.decisao.nivel).toBe('R5');
      // R5 não é "não pode": é preparado e devolvido para a pessoa executar
      // na origem. Bloquear sem devolver o preparo seria só sumir com o pedido.
      expect(r.preparo).toMatchObject({ capacidade: 'financeiro.pagamento.baixar' });
    }

    // O propósito do modo continua atendido: a decisão fica registrada com
    // modo=observar, e é dela que sai o "teria bloqueado" do relatório.
    const d = await prisma.policyDecision.findFirst({
      where: { orgId: ORG, modo: 'observar' },
      orderBy: { criadoEm: 'desc' },
    });
    expect(d?.permitido).toBe(false);
    expect(d?.nivel).toBe('R5');

    // E não deixa lixo na fila: uma aprovação de R5 seria item que ninguém
    // pode aprovar, porque R5 não é executado pelo OS em modo nenhum.
    expect(await prisma.approval.count({ where: { orgId: ORG } })).toBe(0);
  });

  /*
   * FATIA 0.3a — a condição de segurança para ir a produção.
   *
   * Até 10/09/2026 a porta, em modo observar, criava a aprovação, escrevia
   * "TERIA RETIDO" no log e chamava o efeito assim mesmo. Como
   * `whatsapp.mensagem.enviar` (R3) já tem efeito ligado em efeitos.service,
   * isso mandava mensagem no nome de alguém que nunca aprovou — escrita
   * externa sem consentimento humano, contra RF-G-03 e RNF-08.
   *
   * A distinção que este teste trava: observar afrouxa a CLASSIFICAÇÃO
   * (teste acima), nunca o CONSENTIMENTO (testes abaixo).
   */
  it('em MODO OBSERVAR, R3 RETÉM DE VERDADE: o efeito não roda e vira item na fila', async () => {
    const observador = await porta('observar');
    const jaEnviados = enviados.length;

    const r = await observador.executar(
      {
        capabilityId: 'whatsapp.mensagem.enviar',
        args: { titulo: 'Resumo', corpo: 'texto que NÃO pode sair sem alguém aprovar' },
        ctx: ctx(),
        resource: { type: 'whatsapp.mensagem.enviar', id: 'grupo-1' },
      },
      // O efeito REAL, o mesmo mapa que o painel usa. Não é um espião que
      // levanta uma flag: se ele rodar, a mensagem saiu de verdade.
      async (args) => registro.executar('whatsapp.mensagem.enviar', args, ORG),
    );

    expect(r.status).toBe('aguardando_aprovacao');
    // A prova: nada saiu pela Evolution.
    expect(enviados).toHaveLength(jaEnviados);

    if (r.status !== 'aguardando_aprovacao') return;
    expect(r.decisao.nivel).toBe('R3');

    // E existe um item para uma pessoa decidir — reter sem enfileirar seria
    // trocar "manda sem aprovar" por "some sem avisar".
    const fila = await approvals.listar(ORG);
    expect(fila.items.map((i) => i.id)).toContain(r.approvalId);

    // O ToolCall registra a retenção, e não um "executado" mentiroso.
    const tc = await prisma.toolCall.findUnique({ where: { id: r.toolCallId } });
    expect(tc?.status).toBe('aguardando_aprovacao');
    expect(tc?.approvalId).toBe(r.approvalId);
  });

  it('em MODO OBSERVAR, o que não exige aprovação continua passando (R0 e R1)', async () => {
    const observador = await porta('observar');

    let rodouR0 = false;
    const r0 = await observador.executar(
      { capabilityId: 'numeros.painel.ler', args: {}, ctx: ctx() },
      async () => {
        rodouR0 = true;
        return { leadsHoje: 12 };
      },
    );
    expect(r0.status).toBe('executado');
    expect(rodouR0).toBe(true);
    if (r0.status === 'executado') expect(r0.decisao.nivel).toBe('R0');

    // R1 escreve, mas dentro do OS: produz artefato e ninguém de fora recebe
    // nada. A aprovação é 'nunca' na matriz da escada.
    let rodouR1 = false;
    const r1 = await observador.executar(
      {
        capabilityId: 'email.rascunhar',
        args: { assunto: 'Prévia', corpo: 'rascunho que fica dentro do OS' },
        ctx: ctx(),
      },
      async () => {
        rodouR1 = true;
        return { rascunhoId: 'r-1' };
      },
    );
    expect(r1.status).toBe('executado');
    expect(rodouR1).toBe(true);
    if (r1.status === 'executado') expect(r1.decisao.nivel).toBe('R1');

    // A porta em observar não vira porta em impor: nada foi para a fila.
    expect(await prisma.approval.count({ where: { orgId: ORG } })).toBe(0);
  });

  /*
   * R2 é o degrau CONFIGURÁVEL da escada (`exigida: 'configuravel'`), e hoje
   * ninguém configura: PolicyService.avaliarERegistrar não passa
   * `aprovacaoR2Ligada`, e `avaliar()` lê `!== false` — logo, ligado.
   *
   * Resultado: toda R2 exige aprovação, e depois desta fatia isso vale nos
   * dois modos. Este teste existe para PINAR esse fato, não para abençoá-lo:
   * o dia em que alguém ligar a configuração por empresa, ele quebra e obriga
   * a decidir na hora se R2 daquele cliente passa ou retém.
   *
   * A CAPACIDADE E O NÍVEL VÊM DO CATÁLOGO, NÃO DE UMA STRING FIXA. Este teste
   * usava `crm.lead.criar` com `expect(nivel).toBe('R2')` cravado, e ficou
   * vermelho no dia em que a fatia 2.2 subiu essa capacidade para R3 — o teste
   * acusava o próprio teste, não o código. Agora o nível esperado sai de
   * `policy.simular()`, o mesmo motor que a porta usa, e a única coisa fixa é
   * a PRÉ-CONDIÇÃO: a capacidade escolhida tem de estar no degrau configurável.
   * Mudou de degrau no catálogo, a falha aponta a pré-condição e diz onde
   * mexer, em vez de morrer no meio com "esperava R2, veio R3".
   */
  const CAP_CONFIGURAVEL = 'operacao.tarefa.alterar';

  it('R2 exige aprovação enquanto ninguém configurar o contrário — e por isso retém em observar', async () => {
    const previsto = policy.simular(ORG, CAP_CONFIGURAVEL);
    expect(
      previsto.aprovacao.exigida,
      `${CAP_CONFIGURAVEL} deixou de ser o degrau configurável no catálogo resolvido ` +
        `(veio ${previsto.nivel}); escolha outra capacidade R2 para este teste`,
    ).toBe('configuravel');
    expect(previsto.exigeAprovacao).toBe(true);

    const observador = await porta('observar');
    let rodou = false;
    const r = await observador.executar(
      {
        capabilityId: CAP_CONFIGURAVEL,
        args: { id: 'tarefa-1', status: 'concluida' },
        ctx: ctx(),
        resource: { type: CAP_CONFIGURAVEL, id: 'tarefa-1' },
      },
      async () => {
        rodou = true;
        return { alterada: true };
      },
    );
    expect(r.status).toBe('aguardando_aprovacao');
    expect(rodou).toBe(false);
    if (r.status === 'aguardando_aprovacao') expect(r.decisao.nivel).toBe(previsto.nivel);
  });

  it('em MODO IMPOR nada disso mudou: R3 continua retendo e R0 continua passando', async () => {
    const impositor = await porta('impor');
    const jaEnviados = enviados.length;

    const retida = await impositor.executar(
      {
        capabilityId: 'whatsapp.mensagem.enviar',
        args: { titulo: 'Resumo', corpo: 'mesmo texto, outro modo' },
        ctx: ctx(),
        resource: { type: 'whatsapp.mensagem.enviar', id: 'grupo-1' },
      },
      async (args) => registro.executar('whatsapp.mensagem.enviar', args, ORG),
    );
    expect(retida.status).toBe('aguardando_aprovacao');
    expect(enviados).toHaveLength(jaEnviados);

    let rodou = false;
    const livre = await impositor.executar(
      { capabilityId: 'numeros.painel.ler', args: {}, ctx: ctx() },
      async () => {
        rodou = true;
        return { leadsHoje: 12 };
      },
    );
    expect(livre.status).toBe('executado');
    expect(rodou).toBe(true);
  });
});
