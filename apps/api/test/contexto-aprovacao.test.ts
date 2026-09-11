import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient, ActorType } from '@prisma/client';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import { ApprovalsService } from '../src/approvals/approvals.service';
import { AuditService } from '../src/audit/audit.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { ToolGateway, type ExecCtx } from '../src/gateway/tool-gateway.service';
import { EfeitosRegistry, type ContextoDoEfeito } from '../src/gateway/efeitos.registry';
import { AcoesService } from '../src/gateway/acoes.service';
import {
  SemTenantError,
  comContexto,
  contextoAtual,
  correlacaoEhExterna,
  marcarCorrelacaoExterna,
} from '../src/common/contexto-execucao';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * O SEGUNDO CAMINHO DE EXECUÇÃO, contra banco de verdade (RF-T-04, RNF-09).
 *
 * A pergunta que este arquivo responde: quando uma pessoa aprova uma ação
 * retida, o que sai do outro lado sabe QUEM aprovou e a QUE história pertence?
 * Antes de 10/09/2026 não sabia — o efeito era chamado com `(args, orgId)` e
 * mais nada, então o conector agia sem ator e a linha do RASTRO era o único
 * lugar do sistema onde a informação existia.
 *
 * Precisa de TEST_DATABASE_URL com as migrations aplicadas e a política
 * semeada. O container descartável é o mesmo do `porta.test.ts` (veja lá como
 * subi-lo); daqui em diante:
 *   TEST_DATABASE_URL='postgresql://mkt:shadow@localhost:55432/marketing_os_test' \
 *     npx vitest run test/contexto-aprovacao.test.ts
 *
 * O BANCO É O MESMO DAS OUTRAS — `marketing_os_test`, o único da suíte padrão
 * (inventário em `test/banco-de-teste.ts`). Este comentário pedia um banco
 * PRÓPRIO ("a cauda do EventLog embaralha"), e a recomendação era falsa desde
 * sempre: `pnpm --filter @mktos/api test` e a CI rodam os 13 arquivos EM
 * PARALELO contra um banco só. O que torna isso seguro não é separar banco — é
 * cada suíte só afirmar sobre o que ela mesma criou: limpeza por `orgId`,
 * contagem com `where`, marca própria por rodada. Banco separado só escondia
 * quem não fazia isso (ver o conserto em `provisionamento.test.ts`).
 */
const URL = process.env.TEST_DATABASE_URL;
const ORG = 'org-teste-contexto';
const OUTRA_ORG = 'org-teste-contexto-vizinha';

/*
 * O GUARDA DE BANCO — a mesma regra de `tenant-isolation.test.ts`, e agora
 * literalmente o mesmo código: mora em `banco-de-teste.ts`.
 *
 * Esta suíte não só escreve: ela DESLIGA a RULE de append-only do `EventLog` e
 * apaga linhas (ver `afterAll`). Apontar `TEST_DATABASE_URL` para o banco
 * errado — copiar a linha de produção para conferir alguma coisa é o jeito
 * clássico — apagaria RASTRO, que é justamente o que não se apaga
 * (02-CONSTRAINTS). Então o nome do banco tem de se anunciar como descartável,
 * ou o operador destrava na mão.
 *
 * Sem `TEST_DATABASE_URL` a função não faz nada e o `describe.skipIf` abaixo
 * pula a suíte — diferente de `tenant-isolation.test.ts`, que LANÇA nesse caso
 * porque não tem como se pular sozinha.
 */
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (e desliga o append-only do EventLog)');

describe.skipIf(!URL)('contexto de execução na aprovação', () => {
  let prisma: PrismaClient;
  let gateway: ToolGateway;
  let policy: PolicyService;
  let approvals: ApprovalsService;
  let eventos: EventLogService;
  let acoes: AcoesService;
  let registro: EfeitosRegistry;

  /** O que o efeito VIU quando foi chamado — é a prova da fatia. */
  let recebido: { orgId: string; ctx: ContextoDoEfeito; noArmazem: unknown }[];
  /** Quando ligado, o efeito falha: serve para provar o registro de `acao.falhou`. */
  let falhar: boolean;

  const ctx = (extra: Partial<ExecCtx> = {}): ExecCtx => ({
    orgId: ORG,
    actorType: ActorType.ai,
    actorId: 'agente-teste',
    agentSlug: 'assistente',
    correlationId: 'sessao-da-proposta',
    ...extra,
  });

  /** Propõe uma ação R3 pela porta e devolve a aprovação que ficou retida. */
  const propor = async (args: Record<string, unknown>, sobre: Partial<ExecCtx> = {}) => {
    const r = await gateway.executar(
      {
        capabilityId: 'whatsapp.mensagem.enviar',
        args,
        ctx: ctx(sobre),
        resource: { type: 'whatsapp.mensagem.enviar', id: 'grupo-1' },
      },
      async () => ({ nunca: true }),
    );
    if (r.status !== 'aguardando_aprovacao') {
      throw new Error(`esperava retenção, veio ${r.status}`);
    }
    return r;
  };

  beforeAll(async () => {
    // 14:00: fora da janela 08:00–20:00 o sinal sobe todo nível um degrau, e
    // esta suíte depende de `whatsapp.mensagem.enviar` cair em R3 (retenção).
    vi.setSystemTime(new Date('2026-09-01T14:00:00-03:00'));
    process.env.GATEWAY_MODO = 'impor';
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    for (const [id, slug] of [
      [ORG, 'teste-contexto'],
      [OUTRA_ORG, 'teste-contexto-vizinha'],
    ]) {
      await prisma.org.upsert({
        where: { id },
        create: { id, name: `Teste do contexto (${slug})`, slug },
        update: {},
      });
    }

    const p = prisma as unknown as PrismaService;
    policy = new PolicyService(p);
    await policy.onModuleInit();
    approvals = new ApprovalsService(p, new AuditService(p));
    eventos = new EventLogService(p);
    gateway = new ToolGateway(p, policy, new SinaisService(p, policy), approvals, eventos);

    recebido = [];
    falhar = false;
    registro = new EfeitosRegistry();
    registro.registrar({
      'whatsapp.mensagem.enviar': async (_args, orgId, ctxEfeito) => {
        // `noArmazem` é o contexto que o efeito enxerga SEM receber parâmetro
        // nenhum: é o que um conector lá no fundo da pilha teria disponível.
        recebido.push({ orgId, ctx: ctxEfeito, noArmazem: contextoAtual() });
        if (falhar) throw new Error('conector fora do ar');
        return { enviado: true, id: 'msg-1' };
      },
      'numeros.painel.ler': async (_args, orgId, ctxEfeito) => {
        recebido.push({ orgId, ctx: ctxEfeito, noArmazem: contextoAtual() });
        return { leadsHoje: 12 };
      },
    });
    acoes = new AcoesService(p, registro, eventos);
  });

  afterAll(async () => {
    vi.useRealTimers();
    // O EventLog é append-only de verdade: a RULE de DELETE também vale para o
    // teste. Desligar explicitamente aqui é o preço de a garantia ser real.
    await prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete');
    await prisma.eventLog.deleteMany({ where: { orgId: { in: [ORG, OUTRA_ORG] } } });
    await prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete');
    await prisma.approval.deleteMany({ where: { orgId: { in: [ORG, OUTRA_ORG] } } });
    await prisma.toolCall.deleteMany({ where: { orgId: { in: [ORG, OUTRA_ORG] } } });
    await prisma.policyDecision.deleteMany({ where: { orgId: { in: [ORG, OUTRA_ORG] } } });
    await prisma.auditLog.deleteMany({ where: { orgId: { in: [ORG, OUTRA_ORG] } } });
    await prisma.org.deleteMany({ where: { id: { in: [ORG, OUTRA_ORG] } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    recebido = [];
    falhar = false;
    await prisma.approval.deleteMany({ where: { orgId: ORG } });
    await prisma.toolCall.deleteMany({ where: { orgId: ORG } });
  });

  it('o efeito aprovado sai no nome de QUEM APROVOU, não de quem propôs', async () => {
    const proposta = await propor({ titulo: 'Resumo', corpo: 'o texto aprovado' });
    await approvals.confirm(ORG, proposta.approvalId, 'pedro');

    const r = await acoes.executarAprovada(ORG, proposta.approvalId, 'pedro');
    expect(r.status).toBe('executado');
    expect(recebido).toHaveLength(1);

    const visto = recebido[0];
    expect(visto.orgId).toBe(ORG);
    // A proposta é da IA (`agente-teste`); a execução é de gente. É a diferença
    // entre "o agente mandou" e "o Pedro mandou, depois de ler".
    expect(visto.ctx.actorType).toBe(ActorType.user);
    expect(visto.ctx.actorId).toBe('pedro');
    // o agente que propôs continua no registro — some o autor, some o porquê
    expect(visto.ctx.agentSlug).toBe('assistente');
  });

  it('a correlação do efeito é a da PROPOSTA — é o que amarra ao evento original', async () => {
    const proposta = await propor({ titulo: 'T', corpo: 'c' }, { correlationId: 'sessao-42' });
    await approvals.confirm(ORG, proposta.approvalId, 'pedro');
    await acoes.executarAprovada(ORG, proposta.approvalId, 'pedro');

    expect(recebido[0].ctx.correlationId).toBe('sessao-42');

    // e o mesmo fio liga as duas pontas do RASTRO: o agente propôs, a pessoa
    // executou, e as duas linhas se acham com um filtro só.
    const linhas = await prisma.eventLog.findMany({
      where: { orgId: ORG, correlationId: 'sessao-42' },
      orderBy: { seq: 'asc' },
      select: { tipo: true, actorType: true, actorId: true, correlationId: true },
    });
    const tipos = linhas.map((l) => l.tipo);
    expect(tipos).toContain('tool.proposta');
    expect(tipos).toContain('acao.executada');

    const executada = linhas.find((l) => l.tipo === 'acao.executada');
    expect(executada?.actorType).toBe(ActorType.user);
    expect(executada?.actorId).toBe('pedro');

    const proposto = linhas.find((l) => l.tipo === 'tool.proposta');
    expect(proposto?.actorType).toBe(ActorType.ai);
    // mesma história, atores diferentes: é exatamente o que a correlação serve
    // para mostrar
    expect(proposto?.correlationId).toBe(executada?.correlationId);
  });

  it('a correlação chega ao fundo da pilha sem parâmetro nenhum (RNF-09)', async () => {
    // Um conector três chamadas abaixo do efeito não recebe `ctx`. Ele lê do
    // contexto de execução — e é isso que faz o identificador ATRAVESSAR, em
    // vez de parar no primeiro que se lembrou de repassá-lo.
    const proposta = await propor({ titulo: 'T', corpo: 'c' }, { correlationId: 'sessao-77' });
    await approvals.confirm(ORG, proposta.approvalId, 'pedro');
    await acoes.executarAprovada(ORG, proposta.approvalId, 'pedro');

    expect(recebido[0].noArmazem).toMatchObject({
      orgId: ORG,
      actorId: 'pedro',
      correlationId: 'sessao-77',
      origem: 'aprovacao',
    });
  });

  it('o efeito enxerga também DE ONDE a execução veio — a requisição que confirmou', async () => {
    // A correlação do efeito é a da proposta; a da requisição de confirmação é
    // outra. Sem guardar a segunda, o log do efeito e o log da rota que o
    // disparou não se encontram (RNF-09). `correlacaoPai` é deduzido pelo
    // próprio `comContexto`, sem ninguém repassá-lo.
    const proposta = await propor({ titulo: 'T', corpo: 'c' }, { correlationId: 'sessao-88' });
    await approvals.confirm(ORG, proposta.approvalId, 'pedro');

    await comContexto({ orgId: ORG, correlationId: 'http-do-clique', origem: 'http' }, () =>
      acoes.executarAprovada(ORG, proposta.approvalId, 'pedro'),
    );

    expect(recebido[0].noArmazem).toMatchObject({
      correlationId: 'sessao-88',
      correlacaoPai: 'http-do-clique',
      origem: 'aprovacao',
    });
  });

  it('correlação escolhida por quem aprova entra no RASTRO MARCADA como de fora', async () => {
    // O furo que isto fecha: quem confirma manda um cabeçalho de correlação e
    // escolhe a string gravada em `correlacaoDaConfirmacao` — num evento que
    // não se apaga. Apontando para o fio de OUTRA ação, plantaria um vínculo
    // falso. O interceptor marca antes de adotar; aqui o que se prova é que a
    // marca chega inteira ao evento.
    const proposta = await propor({ titulo: 'T', corpo: 'c' }, { correlationId: 'sessao-99' });
    await approvals.confirm(ORG, proposta.approvalId, 'pedro');

    const forjada = marcarCorrelacaoExterna('sessao-de-outra-acao');
    await comContexto({ orgId: ORG, correlationId: forjada, origem: 'http' }, () =>
      acoes.executarAprovada(ORG, proposta.approvalId, 'pedro'),
    );

    const executada = await prisma.eventLog.findFirst({
      where: { orgId: ORG, tipo: 'acao.executada', correlationId: 'sessao-99' },
      orderBy: { seq: 'desc' },
    });
    const payload = executada?.payload as { correlacaoDaConfirmacao?: string };
    expect(payload?.correlacaoDaConfirmacao).toBe(forjada);
    // o campo que amarra a ação continua sendo o NOSSO, e o plantado se
    // denuncia sozinho
    expect(executada?.correlationId).toBe('sessao-99');
    expect(correlacaoEhExterna(executada?.correlationId)).toBe(false);
    expect(correlacaoEhExterna(payload?.correlacaoDaConfirmacao)).toBe(true);
  });

  it('no caminho do agente, o efeito também enxerga a sessão sem receber nada', async () => {
    // R0 executa direto pela porta. O efeito é chamado pelo laço do agente com
    // `(args, orgId)`, e mesmo assim vê a sessão: a porta abriu o contexto.
    //
    // O `comContexto` de fora imita a requisição que disparou o agente: a porta
    // reabre o escopo com a MESMA correlação (a da sessão), e é por isso que o
    // efeito — o ponto mais fundo da pilha — ainda sabe de onde tudo veio.
    const r = await comContexto(
      { orgId: ORG, correlationId: 'http-do-painel', origem: 'http' },
      () =>
        gateway.executar(
          { capabilityId: 'numeros.painel.ler', args: {}, ctx: ctx({ correlationId: 'sessao-do-agente' }) },
          async (args) => registro.executar('numeros.painel.ler', args, ORG),
        ),
    );
    expect(r.status).toBe('executado');
    expect(recebido[0].ctx).toMatchObject({
      orgId: ORG,
      actorType: ActorType.ai,
      actorId: 'agente-teste',
      agentSlug: 'assistente',
      correlationId: 'sessao-do-agente',
    });
    expect(recebido[0].noArmazem).toMatchObject({
      origem: 'agente',
      correlationId: 'sessao-do-agente',
      correlacaoPai: 'http-do-painel',
    });
  });

  it('chamada sem tenant resolvido FALHA e não executa nada (RF-T-04)', async () => {
    const proposta = await propor({ titulo: 'T', corpo: 'c' });
    await approvals.confirm(ORG, proposta.approvalId, 'pedro');

    for (const vazio of ['', '   ']) {
      await expect(
        acoes.executarAprovada(vazio, proposta.approvalId, 'pedro'),
      ).rejects.toThrow(SemTenantError);
    }
    await expect(
      acoes.executarAprovada(undefined as unknown as string, proposta.approvalId, 'pedro'),
    ).rejects.toThrow(SemTenantError);

    expect(recebido).toHaveLength(0);
    // e a aprovação continua de pé, esperando gente: falhar fechado não pode
    // consumir o uso único
    const ainda = await prisma.approval.findUnique({ where: { id: proposta.approvalId } });
    expect(ainda?.status).toBe('confirmada');
  });

  it('aprovação de OUTRA empresa não é alcançada por esta — o tenant filtra de verdade', async () => {
    const proposta = await propor({ titulo: 'T', corpo: 'c' });
    await approvals.confirm(ORG, proposta.approvalId, 'pedro');

    await expect(
      acoes.executarAprovada(OUTRA_ORG, proposta.approvalId, 'pedro'),
    ).rejects.toThrow(/não encontrada/i);
    expect(recebido).toHaveLength(0);
  });

  it('efeito que falha registra a falha COM ator, agente, nível e correlação', async () => {
    falhar = true;
    const proposta = await propor({ titulo: 'T', corpo: 'c' }, { correlationId: 'sessao-quebrada' });
    await approvals.confirm(ORG, proposta.approvalId, 'pedro');

    await expect(acoes.executarAprovada(ORG, proposta.approvalId, 'pedro')).rejects.toThrow(
      /conector fora do ar/,
    );

    const falha = await prisma.eventLog.findFirst({
      where: { orgId: ORG, tipo: 'acao.falhou', correlationId: 'sessao-quebrada' },
      orderBy: { seq: 'desc' },
    });
    expect(falha).toBeTruthy();
    expect(falha?.actorType).toBe(ActorType.user);
    expect(falha?.actorId).toBe('pedro');
    expect(falha?.agentSlug).toBe('assistente');
    expect(falha?.nivel).toBe('R3');
  });

  it('a cadeia do RASTRO continua íntegra depois de tudo isso', async () => {
    // O contexto acrescentou campo a evento; se alguma escrita tivesse saído
    // fora da cauda serializada, o encadeamento quebraria aqui.
    const v = await eventos.verificar(ORG);
    expect(v.ok).toBe(true);
  });
});
