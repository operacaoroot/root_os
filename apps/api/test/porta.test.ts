import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { PrismaClient, ActorType, ApprovalState } from '@prisma/client';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import { ApprovalsService } from '../src/approvals/approvals.service';
import { ApprovalsController } from '../src/approvals/approvals.controller';
import { EventLogService } from '../src/gateway/event-log.service';
import { ToolGateway, type ExecCtx } from '../src/gateway/tool-gateway.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { AcoesService } from '../src/gateway/acoes.service';
import { AuditService } from '../src/audit/audit.service';
import { InterruptoresRegistry } from '../src/gateway/interruptores.registry';
import { ConectoresService } from '../src/integrations/conectores.service';
import { ROTULO_CONECTOR_DESLIGADO } from '../src/integrations/conectores';
import { comContexto } from '../src/common/contexto-execucao';
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
    // A POLÍTICA VAI JUNTO, como o Nest a injeta. Sem ela este serviço não
    // registra o conteúdo redigível (falha fechada — ver `conteudoDaAcao`), e
    // a suíte passaria a medir uma linha de desfecho mais pobre do que a que a
    // aplicação escreve. Medir o que roda em produção é o ponto.
    acoes = new AcoesService(p, registro, eventos, undefined, policy);
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

/*
 * ===========================================================================
 * O GANCHO DA PORTA — o interruptor de conector e o vocabulário do RASTRO
 * ===========================================================================
 *
 * Empresa PRÓPRIA, e não a do bloco acima, por um motivo que é o critério do
 * último caso: `verificar()` conta os eventos incompletos do RASTRO INTEIRO da
 * empresa. Medir isso numa empresa onde vinte outros casos já escreveram
 * responderia outra pergunta.
 *
 * E TUDO RODA DENTRO DE `comContexto`, como a aplicação roda. Não é cerimônia:
 * `ConectoresService` EXIGE que a empresa do argumento seja a da execução em
 * curso — sob isolamento por linha, uma leitura com a empresa errada não erra,
 * devolve vazio, e vazio no desenho ingênuo quer dizer "conector ligado". Em
 * produção quem abre o escopo é o interceptor HTTP (rota) ou o runtime do
 * agente (sessão); aqui é este ajudante.
 */
const ORG2 = 'org-teste-gancho';
const CORPO_SIGILOSO = 'fechamento de agosto: R$ 1.234.567,89 na conta 4455-0 do cliente Fulano';

/**
 * As LINHAS DE DESFECHO: as que contam o que aconteceu. Delas se cobra tudo o
 * que quem as escreve sabe.
 */
const DESFECHO_POSITIVO = new Set(['tool.resultado', 'acao.executada']);

/**
 * As linhas de DESFECHO NEGATIVO. Mesma cobrança, com a ressalva do que não
 * aconteceu: uma recusa não tem `entrega` (nada saiu) e, quando ela vem antes de
 * qualquer aprovação, também não tem `aprovador` nem `aprovadoEm`.
 *
 * `acao.falhou` está aqui e mesmo assim CARREGA os três: a ação foi aprovada,
 * tentou sair e não deu. O conjunto abaixo é teto, não desconto automático.
 */
const DESFECHO_NEGATIVO = new Set([
  'tool.recusado',
  'tool.erro',
  'acao.falhou',
  'aprovacao.invalida',
]);

/** O que uma recusa não tem por não ter acontecido. */
const NAO_ACONTECEU = new Set(['aprovador', 'aprovadoEm', 'entrega']);

/**
 * A DÍVIDA DECLARADA — campos que a política cobra e que NINGUÉM do lado da
 * porta tem como preencher. Cada um com dono, e o dono é o critério: se o campo
 * tem dono fora daqui, faltar é honesto; se não tem, faltar é defeito.
 *
 * A lista é a mesma do bloco "A FRONTEIRA" em `gateway/event-log.service.ts`.
 * Ela existe para que a suíte cobre a fronteira em vez de cobrar zero — e para
 * que ENCOLHER quando alguém ligar um dos donos seja uma mudança de uma linha,
 * aqui, e não uma reescrita do caso.
 */
const DIVIDA_DECLARADA = new Set([
  // do runtime do agente: quem gerou o texto sabe com qual versão de prompt
  'artefato',
  'versaoPrompt',
  // do efeito/conector: só ele enxerga o registro antes e depois
  'estadoAnterior',
  'estadoNovo',
  // de ninguém: não há quem volte para contar o que a pessoa fez com o preparo
  'desfechoInformado',
  // não existe agente quando quem dispara é gente
  'agente',
  /*
   * `motivo` só existe se a política o exigiu NA HORA DE APROVAR. Uma aprovação
   * nascida R3 (sem motivo obrigatório) que a régua reclassifica para R4 na
   * execução — pelos sinais do momento — não tem motivo nenhum para carregar,
   * porque ninguém escreveu um. Inventar aqui seria pior do que faltar.
   */
  'motivo',
]);

/** O que a linha de INTENÇÃO não tem por não ter acontecido ainda. */
const SO_DEPOIS = new Set(['aprovador', 'aprovadoEm', 'entrega', 'resultado', 'desfazer']);

/*
 * O REGISTRO DE INTERRUPTORES, sem banco e sem Nest.
 *
 * Ele tem DUAS respostas para "ninguém se inscreveu", e as duas precisam de
 * caso: `null` para quem constrói a porta à mão (as suítes), e recusa de SUBIR
 * para a aplicação. Sem a segunda, o `null` era uma falha aberta silenciosa — o
 * serviço sai do módulo, o botão de emergência volta a só registrar a decisão, e
 * nada em canto nenhum diz isso.
 */
describe('o registro de interruptores da porta', () => {
  it('sem ninguém inscrito, consultar devolve null — é o comportamento de antes do gancho', async () => {
    const r = new InterruptoresRegistry();
    expect(r.ligado).toBe(false);
    expect(await r.consultar({ orgId: 'qualquer', capabilityId: 'whatsapp.mensagem.enviar' })).toBeNull();
  });

  it('mas a APLICAÇÃO não sobe assim — o teto derruba o arranque, e este também', () => {
    /*
     * Duas posturas opostas para dois freios do mesmo nível seria escolher qual
     * deles pode falhar calado. `ToolGateway.onModuleInit` já recusa subir sem o
     * teto de custo; aqui é o mesmo, no gancho certo.
     */
    const r = new InterruptoresRegistry();
    expect(() => r.onApplicationBootstrap()).toThrow(/ConectoresService/);
    expect(() => r.onApplicationBootstrap()).toThrow(/RF-G-06/);
  });

  it('com alguém inscrito, o arranque passa e a consulta é delegada', async () => {
    const r = new InterruptoresRegistry();
    const perguntas: string[] = [];
    r.registrar(async (e) => {
      perguntas.push(String(e.capabilityId));
      return null;
    }, 'suíte');

    expect(r.ligado).toBe(true);
    expect(() => r.onApplicationBootstrap()).not.toThrow();
    await r.consultar({ orgId: 'org-1', capabilityId: 'email.enviar' });
    expect(perguntas).toEqual(['email.enviar']);
  });
});

describe.skipIf(!URL)('o gancho da porta: interruptor de conector e vocabulário do rastro', () => {
  let prisma: PrismaClient;
  let gateway: ToolGateway;
  let acoes: AcoesService;
  let approvals: ApprovalsService;
  let eventos: EventLogService;
  let conectores: ConectoresService;
  let controlador: ApprovalsController;
  let registro: EfeitosRegistry;
  let enviados: string[];

  /** Quem confirma na rota: o token de sessão do Pedro, já resolvido. */
  const NA_SESSAO = { sub: 'pedro-gancho', orgId: ORG2, roles: ['admin_master'] } as never;

  /** `POST /approvals/:id/confirm`, com o corpo vazio que a tela manda em R3. */
  const confirmarPelaRota = (approvalId: string) =>
    naEmpresa(() => controlador.confirm(NA_SESSAO, approvalId, {}, undefined));

  const ctx2 = (): ExecCtx => ({
    orgId: ORG2,
    actorType: ActorType.ai,
    actorId: 'agente-teste',
    agentSlug: 'assistente',
    correlationId: 'sess-gancho',
  });

  /** O escopo que a aplicação abre. Ver o comentário do bloco. */
  const naEmpresa = <T>(fn: () => Promise<T>): Promise<T> =>
    comContexto({ orgId: ORG2, correlationId: 'sess-gancho', origem: 'agente' }, fn);

  /** Propõe a mensagem de WhatsApp pela porta. R3: retém, não executa. */
  const propor = (corpo = 'aviso para o grupo') =>
    naEmpresa(() =>
      gateway.executar(
        {
          capabilityId: 'whatsapp.mensagem.enviar',
          args: { titulo: 'Resumo', corpo },
          ctx: ctx2(),
          resource: { type: 'whatsapp.mensagem.enviar', id: 'grupo-1' },
        },
        async (args) => registro.executar('whatsapp.mensagem.enviar', args, ORG2),
      ),
    );

  const limparRastro = async () => {
    await prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete');
    await prisma.$executeRawUnsafe('DELETE FROM "EventLog" WHERE "orgId" = $1', ORG2);
    await prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete');
  };

  beforeAll(async () => {
    vi.setSystemTime(new Date('2026-09-01T14:00:00-03:00'));
    process.env.GATEWAY_MODO = 'impor';
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    await prisma.org.upsert({
      where: { id: ORG2 },
      create: { id: ORG2, name: 'Teste do gancho', slug: 'teste-gancho' },
      update: {},
    });
    const papel = await prisma.role.upsert({
      where: { orgId_key: { orgId: ORG2, key: 'admin_master' } },
      create: { orgId: ORG2, key: 'admin_master', name: 'Admin Master' },
      update: {},
      select: { id: true },
    });
    await prisma.user.upsert({
      where: { id: 'pedro-gancho' },
      create: {
        id: 'pedro-gancho',
        orgId: ORG2,
        email: 'pedro@gancho.teste',
        name: 'Pedro',
        passwordHash: 'sem-senha-util',
        roles: { connect: { id: papel.id } },
      },
      update: { isActive: true, roles: { set: [{ id: papel.id }] } },
    });

    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    const policy = new PolicyService(p);
    await policy.onModuleInit();
    approvals = new ApprovalsService(p, audit);
    eventos = new EventLogService(p);

    /*
     * A FIAÇÃO DO GANCHO, igual à do Nest: o registro mora na pasta da porta e
     * quem o preenche é o serviço de integrações, no arranque dele. É a mesma
     * inversão do registro de efeitos, e existe porque a porta importar
     * `ConectoresService` fecharia o ciclo de módulo.
     */
    const interruptores = new InterruptoresRegistry();
    conectores = new ConectoresService(p, audit, eventos, interruptores);
    conectores.onModuleInit();
    expect(interruptores.ligado, 'o interruptor não se inscreveu na porta').toBe(true);

    gateway = new ToolGateway(
      p,
      policy,
      new SinaisService(p, policy),
      approvals,
      eventos,
      undefined,
      interruptores,
    );

    enviados = [];
    registro = new EfeitosRegistry();
    registro.registrar({
      'whatsapp.mensagem.enviar': async (a) => {
        enviados.push(String(a.corpo));
        return { enviado: true, id: 'msg-gancho', destino: '120363@g.us' };
      },
    });
    acoes = new AcoesService(p, registro, eventos, interruptores, policy);

    /*
     * O CONTROLADOR, e não só os serviços.
     *
     * É ele que define a ORDEM entre perguntar ao interruptor e confirmar, e a
     * ordem é o assunto de metade dos casos abaixo. Chamar os serviços na
     * sequência "certa" dentro do teste provaria que o teste sabe a ordem, não
     * que a rota sabe.
     */
    controlador = new ApprovalsController(approvals, acoes);
  });

  afterAll(async () => {
    vi.useRealTimers();
    await limparRastro();
    await prisma.conectorDesligado.deleteMany({ where: { orgId: ORG2 } });
    await prisma.approval.deleteMany({ where: { orgId: ORG2 } });
    await prisma.toolCall.deleteMany({ where: { orgId: ORG2 } });
    await prisma.policyDecision.deleteMany({ where: { orgId: ORG2 } });
    await prisma.auditLog.deleteMany({ where: { orgId: ORG2 } });
    await prisma.user.deleteMany({ where: { orgId: ORG2 } });
    await prisma.role.deleteMany({ where: { orgId: ORG2 } });
    await prisma.org.deleteMany({ where: { id: ORG2 } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.conectorDesligado.deleteMany({ where: { orgId: ORG2 } });
    await prisma.approval.deleteMany({ where: { orgId: ORG2 } });
    await prisma.toolCall.deleteMany({ where: { orgId: ORG2 } });
    enviados = [];
  });

  // -------------------------------------------------------------------------
  // GANCHO 1 — o interruptor alcança a porta (RF-G-06)
  // -------------------------------------------------------------------------

  it('com o WhatsApp LIGADO, a escrita externa é retida — o caminho de sempre', async () => {
    const r = await propor();
    expect(r.status).toBe('aguardando_aprovacao');
    expect(enviados).toHaveLength(0);
  });

  it('desligar o WhatsApp RECUSA a escrita externa na porta — não é só registro', async () => {
    /*
     * O CASO DE EMERGÊNCIA QUE MOTIVA A FATIA INTEIRA.
     *
     * Antes do gancho este caso terminava em `aguardando_aprovacao`: o
     * desligamento aparecia na tela, gravava o evento, e a ação seguia seu
     * caminho como se nada tivesse acontecido. O que se cobra aqui é a palavra
     * RECUSADO — "registrado" não para máquina nenhuma.
     */
    await naEmpresa(() =>
      conectores.desligar(ORG2, 'whatsapp', {
        motivo: 'suspeita de vazamento de token',
        actorId: 'pedro-gancho',
      }),
    );

    const r = await propor();
    expect(
      r.status,
      '\nO WHATSAPP ESTÁ DESLIGADO PARA ESTA EMPRESA E A PORTA DEIXOU PASSAR.\n' +
        '  Desligar conector é botão de emergência: se ele só REGISTRA a decisão,\n' +
        '  quem clicou acha que parou a máquina e ela continua agindo.\n',
    ).toBe('recusado');
    expect(enviados).toHaveLength(0);
    if (r.status !== 'recusado') return;
    expect(r.motivo).toContain('WhatsApp');
    expect(r.motivo).toContain('suspeita de vazamento de token');
    // Para o RASTRO vai o rótulo estável — o MESMO do caminho direto, senão o
    // relatório de calibragem conta a mesma recusa em duas linhas.
    expect(r.decisao.motivo).toBe(ROTULO_CONECTOR_DESLIGADO);
    expect(r.decisao.permitido).toBe(false);

    // Nada foi retido: a recusa não vira item na fila de ninguém.
    expect(await prisma.approval.count({ where: { orgId: ORG2 } })).toBe(0);
  });

  it('a recusa por conector fica gravada nas TRÊS tabelas que a auditoria lê', async () => {
    await naEmpresa(() => conectores.desligar(ORG2, 'whatsapp', { actorId: 'pedro-gancho' }));
    await propor();

    const chamada = await prisma.toolCall.findFirst({
      where: { orgId: ORG2, capabilityId: 'whatsapp.mensagem.enviar' },
      orderBy: { criadoEm: 'desc' },
    });
    expect(chamada?.status).toBe('recusado');
    expect(chamada?.erro).toContain('desligado para esta empresa');

    const decisao = await prisma.policyDecision.findFirst({
      where: { orgId: ORG2 },
      orderBy: { criadoEm: 'desc' },
    });
    expect(decisao?.permitido).toBe(false);
    expect(decisao?.motivo).toBe(ROTULO_CONECTOR_DESLIGADO);

    // Duas linhas no RASTRO, e as duas importam: a do interruptor (quem
    // perguntou e o que respondeu) e a da porta (o que foi recusado).
    const tipos = (
      await prisma.eventLog.findMany({
        where: { orgId: ORG2, tipo: { in: ['conector.recusado', 'tool.recusado'] } },
        select: { tipo: true },
      })
    ).map((l) => l.tipo);
    expect(tipos).toContain('conector.recusado');
    expect(tipos).toContain('tool.recusado');
  });

  it('PELA ROTA: confirmar é recusado, religar, confirmar de novo — e sai', async () => {
    /*
     * A SEQUÊNCIA INTEIRA DA ROTA, e é ela que prova a promessa.
     *
     * Chamar `acoes.executarAprovada` duas vezes não prova nada: quem decide a
     * ORDEM entre perguntar ao interruptor e confirmar é o CONTROLADOR, e é a
     * ordem que estava errada. Com a pergunta DEPOIS do confirm, este roteiro
     * terminava assim: a primeira confirmação deixava a aprovação `confirmada`,
     * a execução era recusada, e a segunda confirmação batia em "Aprovação já
     * confirmada" — para sempre. A ação ficava parada até expirar, fora da fila
     * (que lista pendentes) e fora do alcance de qualquer botão.
     *
     * Pior: a frase que o operador acabou de ler promete que "religar em
     * Conexões restabelece o uso sem nova autorização". Não restabelecia.
     *
     * Perguntando ANTES de confirmar, a promessa passa a ser verdadeira — e é
     * isso que os quatro passos abaixo medem, um a um.
     */
    const proposta = await propor('mensagem que esperou o religamento');
    if (proposta.status !== 'aguardando_aprovacao') throw new Error('deveria reter');

    // O incidente acontece DEPOIS da proposta e ANTES da confirmação.
    await naEmpresa(() =>
      conectores.desligar(ORG2, 'whatsapp', { motivo: 'incidente em curso', actorId: 'pedro-gancho' }),
    );

    // PASSO 1 — confirmar é recusado, com a frase em português.
    await expect(
      confirmarPelaRota(proposta.approvalId),
      '\nA ROTA DE CONFIRMAÇÃO DEIXOU PASSAR COM O CONECTOR DESLIGADO.\n',
    ).rejects.toThrow(/desligado para esta empresa/);
    expect(enviados).toHaveLength(0);

    // PASSO 2 — e NADA mudou: a aprovação continua PENDENTE e continua na fila.
    const depoisDaRecusa = await prisma.approval.findUniqueOrThrow({
      where: { id: proposta.approvalId },
    });
    expect(
      depoisDaRecusa.status,
      '\nA RECUSA CONSUMIU O ESTADO DA APROVAÇÃO.\n' +
        '  `confirmada` aqui é o limbo: some da fila (que lista pendentes) e\n' +
        '  `confirm` passa a recusá-la. Ninguém mais executa esta ação.\n',
    ).toBe(ApprovalState.pendente);
    expect(depoisDaRecusa.aprovadoPorId).toBeNull();
    expect(depoisDaRecusa.aprovadoEm).toBeNull();

    const fila = await approvals.listar(ORG2);
    expect(
      fila.items.map((i) => i.id),
      '\nA APROVAÇÃO SUMIU DA FILA DEPOIS DE UMA RECUSA POR CONECTOR.\n',
    ).toContain(proposta.approvalId);

    // PASSO 3 — religar. Nenhuma credencial é tocada; é só apagar a linha.
    await naEmpresa(() => conectores.religar(ORG2, 'whatsapp', { actorId: 'pedro-gancho' }));

    // PASSO 4 — o MESMO botão, sem nova autorização e sem nova proposta.
    const r = await confirmarPelaRota(proposta.approvalId);
    expect(r.execucao.status).toBe('executado');
    expect(enviados).toEqual(['mensagem que esperou o religamento']);
  });

  it('o último portão continua de pé: quem NÃO perguntou antes é barrado', async () => {
    /*
     * O SEGUNDO PONTO DE CHAMADA, dentro de `executarAprovada`.
     *
     * A rota pergunta antes, mas a conferência continua onde o efeito é chamado:
     * ela cobre a janela entre uma e outra e qualquer chamador que não tenha
     * perguntado. Este caso é esse chamador — confirma pelo serviço, desliga, e
     * chama a execução direto.
     *
     * Com o gancho só na porta, este roteiro passava inteiro: a pessoa aprova às
     * 14h, alguém desliga o conector às 14h05, e o clique em "confirmar" às
     * 14h07 manda a mensagem — porque a decisão de política já tinha acontecido
     * lá atrás, na proposta. Aprovação não é salvo-conduto contra o botão de
     * parar.
     */
    const proposta = await propor('mensagem aprovada antes do incidente');
    if (proposta.status !== 'aguardando_aprovacao') throw new Error('deveria reter');
    await approvals.confirm(ORG2, proposta.approvalId, { id: 'pedro-gancho', papeis: ['admin_master'] });

    // O incidente acontece DEPOIS da aprovação.
    await naEmpresa(() =>
      conectores.desligar(ORG2, 'whatsapp', { motivo: 'incidente em curso', actorId: 'pedro-gancho' }),
    );

    await expect(
      naEmpresa(() => acoes.executarAprovada(ORG2, proposta.approvalId, 'pedro-gancho')),
      '\nA MENSAGEM SAIU DEPOIS DE ALGUÉM TER DESLIGADO O CONECTOR.\n' +
        '  É exatamente o buraco do tamanho da fila de aprovação que o último\n' +
        '  portão existe para fechar.\n',
    ).rejects.toThrow(/desligado para esta empresa/);
    expect(enviados).toHaveLength(0);

    /*
     * A aprovação NÃO foi queimada — e o estado em que ela fica é a dívida
     * declarada deste caminho: `confirmada` e não consumida. `executarAprovada`
     * aceita exatamente esse estado, então religar e chamar de novo executa;
     * o que não existe é um botão de tela que faça isso, porque `confirm` recusa
     * o que não está pendente. Por isso a pergunta do controlador vem antes: o
     * caminho normal nunca chega aqui.
     */
    const ap = await prisma.approval.findUniqueOrThrow({ where: { id: proposta.approvalId } });
    expect(ap.status).toBe(ApprovalState.confirmada);
    expect(ap.consumidoEm).toBeNull();

    await naEmpresa(() => conectores.religar(ORG2, 'whatsapp', { actorId: 'pedro-gancho' }));
    const r = await naEmpresa(() => acoes.executarAprovada(ORG2, proposta.approvalId, 'pedro-gancho'));
    expect(r.status).toBe('executado');
    expect(enviados).toEqual(['mensagem aprovada antes do incidente']);
  });

  it('conector desligado NÃO barra a leitura que não sai da casa', async () => {
    // O desligamento é do CONECTOR, não da empresa: `numeros.painel.ler` lê o
    // banco do próprio OS e não tem conector no mapa.
    await naEmpresa(() => conectores.desligar(ORG2, 'whatsapp', { actorId: 'pedro-gancho' }));
    const r = await naEmpresa(() =>
      gateway.executar({ capabilityId: 'numeros.painel.ler', args: {}, ctx: ctx2() }, async () => ({
        leadsHoje: 12,
      })),
    );
    expect(r.status).toBe('executado');
  });

  it('não conseguir PERGUNTAR ao interruptor também recusa — falha fechada', async () => {
    /*
     * Sem o escopo de execução aberto, `ConectoresService` não tem como provar
     * que a leitura enxerga a linha certa e se recusa a responder "ligado"
     * (`EmpresaDivergenteError`). A porta não desfaz essa decisão: ela só troca
     * o THROW por uma recusa, porque um erro escapando dali derrubaria o laço do
     * agente inteiro em vez de virar uma linha com motivo.
     */
    const r = await gateway.executar(
      {
        capabilityId: 'whatsapp.mensagem.enviar',
        args: { titulo: 'T', corpo: 'sem contexto nenhum' },
        ctx: ctx2(),
        resource: { type: 'whatsapp.mensagem.enviar', id: 'grupo-1' },
      },
      async (args) => registro.executar('whatsapp.mensagem.enviar', args, ORG2),
    );
    expect(r.status).toBe('recusado');
    if (r.status === 'recusado') expect(r.motivo).toContain('Não foi possível conferir');
    expect(enviados).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // GANCHO 2 — o vocabulário do RASTRO (RF-R-03, RF-R-04)
  // -------------------------------------------------------------------------

  it('a linha de EXECUÇÃO POR APROVAÇÃO sai completa no nível dela', async () => {
    await limparRastro();
    const proposta = await propor(CORPO_SIGILOSO);
    if (proposta.status !== 'aguardando_aprovacao') throw new Error('deveria reter');
    await approvals.confirm(ORG2, proposta.approvalId, { id: 'pedro-gancho', papeis: ['admin_master'] });
    await naEmpresa(() => acoes.executarAprovada(ORG2, proposta.approvalId, 'pedro-gancho'));

    const linha = await prisma.eventLog.findFirstOrThrow({
      where: { orgId: ORG2, tipo: 'acao.executada' },
      orderBy: { seq: 'desc' },
    });
    const payload = linha.payload as Record<string, unknown>;
    const rastro = payload.rastro as { faltando: string[]; completo: boolean; exigidos: string[] };

    expect(rastro.exigidos).toContain('aprovador');
    expect(
      rastro.faltando.filter((c) => !DIVIDA_DECLARADA.has(c)),
      '\nA LINHA QUE REPRESENTA A AÇÃO EXECUTADA SAIU INCOMPLETA.\n' +
        '  Os campos vêm do `conteudo`, com as palavras da política — ver o bloco\n' +
        '  "OS PONTOS DE CHAMADA" em gateway/event-log.service.ts. Campo que\n' +
        '  falta e NÃO está na dívida declarada é campo que este serviço tem.\n',
    ).toEqual([]);

    // A ARMADILHA: o aprovador já ia no payload, com outro nome. O conserto foi
    // RENOMEAR — não existe um segundo registrador nem um campo duplicado.
    expect(payload.aprovador).toBe('pedro-gancho');
    expect(payload.aprovadoPor).toBeUndefined();
    expect(payload.canal).toBe('whatsapp');
    expect(linha.contentHash).toBeTruthy();
  });

  it('o texto confidencial não vai CRU para o rastro, nem na execução', async () => {
    await limparRastro();
    const proposta = await propor(CORPO_SIGILOSO);
    if (proposta.status !== 'aguardando_aprovacao') throw new Error('deveria reter');
    await approvals.confirm(ORG2, proposta.approvalId, { id: 'pedro-gancho', papeis: ['admin_master'] });
    await naEmpresa(() => acoes.executarAprovada(ORG2, proposta.approvalId, 'pedro-gancho'));

    /*
     * `whatsapp.mensagem.enviar` é `confidencial` no catálogo. Ligar o
     * vocabulário sem passar a SENSIBILIDADE junto teria feito o texto da
     * mensagem entrar em claro no RASTRO — trocar um campo faltando por um
     * vazamento é pior do que não ter ligado.
     */
    const linhas = await prisma.eventLog.findMany({ where: { orgId: ORG2 } });
    for (const l of linhas) {
      expect(JSON.stringify(l.payload), `evento ${l.tipo}`).not.toContain('4455-0');
    }
    const execucao = linhas.find((l) => l.tipo === 'acao.executada')!;
    const argumentos = (execucao.payload as Record<string, Record<string, unknown>>).argumentos;
    expect(argumentos.sigiloso).toBe(true);
    expect(argumentos.algoritmo).toBe('sha256');
  });

  it('a linha de EXECUÇÃO PELA PORTA carrega quem aprovou — R3 com token', async () => {
    /*
     * O OUTRO CAMINHO DE EXECUÇÃO, e o que ele perdia.
     *
     * `tool.resultado` é a linha de desfecho de quem passou pela porta com um
     * token na mão. A porta CONSOME a aprovação três linhas acima de gravar essa
     * linha — ela tem o aprovador e o instante em que ele assinou. Até
     * 11/09/2026 `ApprovalsService.consumir` devolvia `void`: os dois eram
     * lidos, conferidos e jogados fora, e o R3 saía declarando `aprovador` e
     * `aprovadoEm` em falta numa ação que teve gente no caminho. Dívida contada
     * onde não havia dívida nenhuma.
     */
    await limparRastro();
    const args = { titulo: 'Resumo', corpo: 'texto aprovado e enviado pela porta' };
    const proposta = await approvals.propor({
      orgId: ORG2,
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
      canal: 'whatsapp',
    });
    await approvals.confirm(ORG2, proposta.approvalId, {
      id: 'pedro-gancho',
      papeis: ['admin_master'],
    });

    const r = await naEmpresa(() =>
      gateway.executar(
        {
          capabilityId: 'whatsapp.mensagem.enviar',
          args,
          ctx: ctx2(),
          resource: { type: 'whatsapp.mensagem.enviar', id: 'grupo-1' },
          approvalToken: proposta.token,
        },
        async (a) => registro.executar('whatsapp.mensagem.enviar', a, ORG2),
      ),
    );
    expect(r.status).toBe('executado');

    const linha = await prisma.eventLog.findFirstOrThrow({
      where: { orgId: ORG2, tipo: 'tool.resultado' },
      orderBy: { seq: 'desc' },
    });
    const payload = linha.payload as Record<string, unknown>;
    const rastro = payload.rastro as { faltando: string[]; completo: boolean };

    expect(payload.aprovador).toBe('pedro-gancho');
    expect(payload.aprovadoEm).toBeTruthy();
    expect(
      rastro.faltando.filter((c) => !DIVIDA_DECLARADA.has(c)),
      '\nA LINHA DE DESFECHO DA PORTA NÃO DIZ QUEM APROVOU.\n' +
        '  A porta consome o token e tem o aprovador em mãos — ver\n' +
        '  `ToolGateway.deQuemAprovou` e o retorno de `ApprovalsService.consumir`.\n',
    ).toEqual([]);
  });

  it('A FRONTEIRA: só a linha de INTENÇÃO pode estar incompleta', async () => {
    /*
     * O CRITÉRIO, medido em vez de lido no diff: `GET /audit/verificar` devolve
     * `incompletosPorNivel`, e é ele que diz o tamanho da dívida sem depender de
     * ninguém acreditar em ninguém.
     *
     * ESSE NÚMERO NÃO CAI A ZERO, E NÃO DEVE CAIR — quem o ler como meta vai ler
     * o resto como defeito. A fronteira não é "uma linha, três campos": é a
     * natureza da linha.
     *
     *   · LINHA DE INTENÇÃO (`tool.proposta`) — gravada ANTES de existir
     *     aprovação e antes de qualquer coisa sair. Num R3 ela não tem como
     *     carregar `aprovador`, `aprovadoEm` nem `entrega`. Preenchê-los seria
     *     escrever no RASTRO que houve gente antes de haver.
     *   · LINHA DE DESFECHO (`tool.resultado`, `acao.executada`, `acao.falhou`,
     *     `tool.recusado`, `tool.erro`) — carrega tudo o que quem a escreve SABE.
     *
     * Este caso percorre os DOIS caminhos de execução no mesmo rastro — a fila
     * de aprovação e a porta com token — e cobra a fronteira nos dois: toda
     * linha incompleta é de intenção, e nenhuma linha de desfecho está
     * incompleta. A versão anterior media um caminho só, e só o caminho feliz.
     */
    await limparRastro();

    // Caminho 1: a fila de aprovação (proposta → confirmação → execução).
    const pelaFila = await propor('mensagem do caso de integridade');
    if (pelaFila.status !== 'aguardando_aprovacao') throw new Error('deveria reter');
    await confirmarPelaRota(pelaFila.approvalId);

    // Caminho 2: a porta com o token na mão.
    const args = { titulo: 'Resumo', corpo: 'a que passou pela porta' };
    const comToken = await approvals.propor({
      orgId: ORG2,
      propostoPorId: 'agente-teste',
      propostoPorTipo: ActorType.ai,
      capabilityId: 'whatsapp.mensagem.enviar',
      resourceType: 'whatsapp.mensagem.enviar',
      resourceId: 'grupo-2',
      args,
      hashKeys: ['titulo', 'corpo'],
      decisao: {
        nivel: 'R3', nivelBase: 'R3', permitido: true, exigeAprovacao: true,
        exigeReautenticacao: false, exigeMotivo: false,
        aprovacao: { exigida: 'sempre', vinculo: 'conteudo', usoUnico: true, validadeSegundos: 900, reautenticacao: false, alcadaMinima: 'responsavel' },
        sinaisAcionados: [], motivo: 'R3',
      },
      canal: 'whatsapp',
    });
    await approvals.confirm(ORG2, comToken.approvalId, {
      id: 'pedro-gancho',
      papeis: ['admin_master'],
    });
    await naEmpresa(() =>
      gateway.executar(
        {
          capabilityId: 'whatsapp.mensagem.enviar',
          args,
          ctx: ctx2(),
          resource: { type: 'whatsapp.mensagem.enviar', id: 'grupo-2' },
          approvalToken: comToken.token,
        },
        async (a) => registro.executar('whatsapp.mensagem.enviar', a, ORG2),
      ),
    );

    // Caminho 3: uma LEITURA R0, para a fronteira não ser medida só em R3.
    await naEmpresa(() =>
      gateway.executar({ capabilityId: 'numeros.painel.ler', args: {}, ctx: ctx2() }, async () => ({
        leadsHoje: 12,
      })),
    );

    // Caminho 4: uma RECUSA. É a terceira natureza de linha, e sem ela a
    // fronteira seria medida só onde tudo deu certo.
    await naEmpresa(() => conectores.desligar(ORG2, 'whatsapp', { actorId: 'pedro-gancho' }));
    const recusada = await propor('esta não deveria sair');
    expect(recusada.status).toBe('recusado');
    await naEmpresa(() => conectores.religar(ORG2, 'whatsapp', { actorId: 'pedro-gancho' }));

    const v = await eventos.verificar(ORG2);
    expect(v.ok).toBe(true);

    const linhas = await prisma.eventLog.findMany({
      where: { orgId: ORG2 },
      orderBy: { seq: 'asc' },
    });
    const rastroDe = (l: (typeof linhas)[number]) =>
      (l.payload as { rastro?: { completo?: boolean; faltando?: string[] } }).rastro;

    const positivos = linhas.filter((l) => DESFECHO_POSITIVO.has(l.tipo));
    const negativos = linhas.filter((l) => DESFECHO_NEGATIVO.has(l.tipo));
    expect(positivos.length, 'nenhuma linha de desfecho positivo foi escrita').toBeGreaterThanOrEqual(2);
    expect(negativos.length, 'nenhuma linha de desfecho negativo foi escrita').toBeGreaterThanOrEqual(1);

    /*
     * O CRITÉRIO DA LINHA DE DESFECHO: ela pode faltar SÓ o que tem dono fora de
     * quem a escreve. Nada do que a porta sabe.
     *
     * `aprovador` e `aprovadoEm` são o teste de fogo desta lista: os dois estão
     * em mãos no instante em que a linha é gravada, e era exatamente onde a
     * primeira versão do gancho os jogava fora.
     */
    for (const l of positivos) {
      const semDono = (rastroDe(l)?.faltando ?? []).filter((c) => !DIVIDA_DECLARADA.has(c));
      expect(
        semDono,
        `\nA LINHA DE DESFECHO "${l.tipo}" (${l.nivel}) SAIU SEM ${semDono.join(', ')}.\n` +
          '  Campo sem dono declarado é campo que quem escreve a linha TEM e\n' +
          '  jogou fora. Ver "A FRONTEIRA" no cabeçalho de\n' +
          '  gateway/event-log.service.ts para a lista de dívidas com dono.\n',
      ).toEqual([]);
    }

    // E a linha do "não": mesma cobrança, descontado só o que não aconteceu.
    for (const l of negativos) {
      const semDono = (rastroDe(l)?.faltando ?? []).filter(
        (c) => !DIVIDA_DECLARADA.has(c) && !NAO_ACONTECEU.has(c),
      );
      expect(
        semDono,
        `\nA LINHA DE RECUSA "${l.tipo}" (${l.nivel}) SAIU SEM ${semDono.join(', ')}.\n` +
          '  Recusa não tem entrega nem aprovador — mas tem CANAL, argumentos,\n' +
          '  fontes e custo, que quem a escreve sabe.\n',
      ).toEqual([]);
    }

    /*
     * O CRITÉRIO DA LINHA DE INTENÇÃO: ela só pode faltar o que AINDA NÃO
     * ACONTECEU. Se um dia faltar `argumentos`, `fontes` ou `custo` — que a
     * proposta tem —, é defeito.
     */
    const intencoes = linhas.filter((l) => l.tipo === 'tool.proposta');
    for (const l of intencoes) {
      const faltando = rastroDe(l)?.faltando ?? [];
      const indevidos = faltando.filter((c) => !SO_DEPOIS.has(c) && !DIVIDA_DECLARADA.has(c));
      expect(indevidos, `a proposta ${l.nivel} não deveria faltar ${indevidos.join(', ')}`).toEqual([]);
    }

    /*
     * E TODA LINHA INCOMPLETA É EXPLICADA por uma das duas regras acima — é isto
     * que impede a suíte de ficar verde ignorando um tipo de evento novo.
     */
    const incompletas = linhas.filter((l) => rastroDe(l)?.completo === false);
    for (const l of incompletas) {
      expect(
        DESFECHO_POSITIVO.has(l.tipo) || DESFECHO_NEGATIVO.has(l.tipo) || l.tipo === 'tool.proposta',
        `evento "${l.tipo}" saiu incompleto e não é nem intenção nem desfecho conhecido`,
      ).toBe(true);
    }

    /*
     * A CONTAGEM QUE A ROTA DEVOLVE — e por que ela NÃO é zero.
     *
     * Sobram as propostas (que não sabem quem vai aprovar), as linhas R4 (que
     * não têm o antes-e-depois do sistema de destino) e a recusa (que não tem
     * entrega nem aprovador porque nada aconteceu). O R0 sai COMPLETO — a
     * política pede dele só o que a porta tem —, e é por isso que ele não
     * aparece aqui.
     *
     * A régua subiu a segunda chamada de R3 para R4 sozinha, pelos sinais do
     * momento: este caso mede dois níveis sem precisar encená-los.
     */
    expect(Object.keys(v.incompletosPorNivel).sort()).toEqual(['R3', 'R4']);
  });

  it('payload e conteudo em desacordo AVISAM, em vez de se apagarem em silêncio', async () => {
    /*
     * A ARMADILHA DO ESPALHAMENTO, fechada na montagem em vez de caso a caso.
     *
     * `conteudo` vira chave de primeiro nível do payload, e o conteúdo vence —
     * tem de vencer, porque é ele que passa pela redação de sensibilidade. O que
     * era silencioso é o resto: quem escrevia os dois lados só se defendia
     * repetindo o valor letra por letra, e no dia em que alguém melhorasse a
     * frase de um lado, a palavra do outro sumia sem barulho. Um caso de teste
     * por chamada guardava isso; agora quem guarda é `EventLogService.montar`,
     * para a classe inteira.
     */
    await limparRastro();
    eventos.esquecerAvisos();
    const avisos: string[] = [];
    const espiao = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((m: unknown) => void avisos.push(String(m)));

    try {
      await eventos.registrar({
        orgId: ORG2,
        tipo: 'teste.colisao',
        actorType: ActorType.system,
        payload: { motivo: 'o que o payload dizia' },
        conteudo: { motivo: 'o que o conteudo diz' },
      });
      // Valor IGUAL dos dois lados é inofensivo — é exatamente o que a
      // duplicação letra por letra fazia — e não gera aviso nenhum.
      await eventos.registrar({
        orgId: ORG2,
        tipo: 'teste.duplicata',
        actorType: ActorType.system,
        payload: { motivo: 'a mesma frase' },
        conteudo: { motivo: 'a mesma frase' },
      });
    } finally {
      espiao.mockRestore();
    }

    const colisoes = avisos.filter((a) => a.includes('veio em payload E em conteudo'));
    expect(colisoes).toHaveLength(1);
    expect(colisoes[0]).toContain('teste.colisao');
    expect(colisoes[0]).toContain('motivo');

    // E o vencedor continua sendo o conteúdo, que é o lado redigido.
    const linha = await prisma.eventLog.findFirstOrThrow({
      where: { orgId: ORG2, tipo: 'teste.colisao' },
    });
    expect((linha.payload as Record<string, unknown>).motivo).toBe('o que o conteudo diz');
  });
});
