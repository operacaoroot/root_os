import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient, ActorType, ApprovalState } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { MINIMO_DO_MOTIVO, avaliar, type Capacidade, type Nivel } from '@mktos/policy';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import { ApprovalsService } from '../src/approvals/approvals.service';
import {
  EXIGE_MOTIVO_POR_NIVEL,
  alcadaConhecida,
  alcadaDe,
  atendeAlcada,
  temPapelDeMaquina,
} from '../src/approvals/alcada';
import { LIMITE_DE_RECUSAS, ReauthService } from '../src/auth/reauth.service';
import { AuditService } from '../src/audit/audit.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { ToolGateway, type ExecCtx } from '../src/gateway/tool-gateway.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { AcoesService } from '../src/gateway/acoes.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * A ESCADA INTEIRA NO PONTO EM QUE ELA VIRA DECISÃO DE GENTE (RF-A-01 a RF-A-04).
 *
 * Duas promessas do produto eram FALSAS até 11/09/2026, e as duas moravam na
 * mesma função (`ApprovalsService.confirm`):
 *
 *  1. "R4 exige reautenticação" — o código escrevia `reautenticadoEm: new Date()`
 *     sem pedir nada a ninguém. O sistema afirmava, no RASTRO, um fato que não
 *     tinha acontecido.
 *  2. "R4 exige alçada suficiente" — `alcadaMinima` era gravada em toda
 *     aprovação e nunca comparada com o papel de quem aprovava.
 *
 * E havia uma terceira, mais silenciosa: "quem aprova é gente". A porta já
 * impedia o agente que PROPÔS de aprovar, mas `ia_servico` e `ia_acao` têm
 * `mcp.executar` — a permissão que a rota de confirmação exige —, então um
 * SEGUNDO token de serviço aprovava o que o primeiro propôs.
 *
 * Esta suíte cobre os quatro degraus do ponto de vista de quem decide, e o faz
 * contra banco de verdade porque as três travas dependem de estado: a aprovação
 * gravada, o usuário do banco, o hash da senha.
 *
 * COMO RODAR (o banco é o padrão da api — ver `test/banco-de-teste.ts`):
 *   TEST_DATABASE_URL='postgresql://mkt:shadow@localhost:55432/marketing_os_test' \
 *     npx vitest run test/alcada-reautenticacao.test.ts
 *
 * ELA NÃO CONTA LINHA GLOBALMENTE. Treze arquivos rodam em PARALELO contra o
 * mesmo banco; tudo aqui é filtrado por `ORG`, que é só desta suíte, e a limpeza
 * é por `orgId`. Contar `approval.count()` sem `where` seria contar as pendências
 * da suíte vizinha — foi defeito real de outra fatia.
 */
const URL = process.env.TEST_DATABASE_URL;
const ORG = 'org-teste-alcada';

/** E-mails são únicos no banco INTEIRO, não por empresa: sufixo próprio. */
const SUFIXO = 'alcada-reauth.teste';

const SENHA_DO_TITULAR = 'senha-real-do-titular-1';
const SENHA_DO_OPERADOR = 'senha-real-do-operador-2';

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (e desliga o append-only do EventLog)');

describe.skipIf(!URL)('alçada e reautenticação na aprovação', () => {
  let prisma: PrismaClient;
  let gateway: ToolGateway;
  let policy: PolicyService;
  let approvals: ApprovalsService;
  /** A mesma fila, montada SEM verificador de reautenticação (ver o último caso). */
  let semVerificador: ApprovalsService;
  let reauth: ReauthService;
  let eventos: EventLogService;
  let acoes: AcoesService;
  let jwt: JwtService;

  /** ids dos usuários criados aqui — usados como `sub` da sessão. */
  const id = {
    titular: '',
    operador: '',
    maquina: '',
    rebaixado: '',
    /** Um SEGUNDO titular: prova que o vínculo da prova é com a pessoa, não com o papel. */
    titular2: '',
    /** Papel que NÃO existe no catálogo do RBAC — no banco, não só no token. */
    forasteiro: '',
    /** Perfil que só lê: é gente, e não responde por decisão nenhuma. */
    consulta: '',
  };

  /** O efeito rodou? É a pergunta que separa "pede confirmação" de porta. */
  let executou: string[];

  const ctx = (extra: Partial<ExecCtx> = {}): ExecCtx => ({
    orgId: ORG,
    actorType: ActorType.ai,
    actorId: 'agente-que-propos',
    agentSlug: 'assistente',
    correlationId: 'sessao-da-proposta',
    ...extra,
  });

  /**
   * Propõe pela PORTA e devolve a retenção. Usar o caminho real importa: é a
   * porta que copia `alcadaMinima` e `exigeReauth` da decisão para a linha da
   * aprovação, e é exatamente esse par que esta suíte mede.
   */
  const reter = async (capabilityId: string, args: Record<string, unknown>, agentSlug = 'assistente') => {
    const r = await gateway.executar(
      {
        capabilityId,
        args,
        ctx: ctx({ agentSlug }),
        resource: { type: capabilityId, id: 'alvo-1' },
      },
      async () => {
        executou.push(capabilityId);
        return { nunca: true };
      },
    );
    if (r.status !== 'aguardando_aprovacao') {
      throw new Error(`esperava retenção em ${capabilityId}, veio ${r.status}`);
    }
    return r;
  };

  const aprovacao = (approvalId: string) =>
    prisma.approval.findUniqueOrThrow({ where: { id: approvalId } });

  beforeAll(async () => {
    // 14:00: fora da janela 08:00–20:00 o sinal `fora_da_janela` sobe todo nível
    // um degrau, e esta suíte mede níveis.
    vi.setSystemTime(new Date('2026-09-01T14:00:00-03:00'));
    process.env.GATEWAY_MODO = 'impor';

    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    await prisma.org.upsert({
      where: { id: ORG },
      create: { id: ORG, name: 'Teste de alçada', slug: 'teste-alcada' },
      update: {},
    });

    /*
     * PAPÉIS DE VERDADE, no banco. A alçada não é um campo do usuário: ela é
     * derivada do PAPEL (`src/approvals/alcada.ts`), e é por isso que a suíte
     * cria papéis com as chaves reais do catálogo do RBAC.
     */
    const papel = async (key: string, name: string) =>
      prisma.role.upsert({
        where: { orgId_key: { orgId: ORG, key } },
        create: { orgId: ORG, key, name },
        update: {},
        select: { id: true },
      });
    const admin = await papel('admin_master', 'Admin Master');
    const analista = await papel('analista', 'Analista');
    const bot = await papel('ia_acao', 'IA / Ação');
    // Um papel escrito à mão no banco, que o catálogo do RBAC não conhece.
    const forasteiro = await papel('diretor-regional', 'Diretor Regional (inventado)');
    const consulta = await papel('consulta_limitada', 'Consulta Limitada');

    const usuario = async (email: string, nome: string, senha: string, papelId: string) => {
      const u = await prisma.user.upsert({
        where: { email },
        create: {
          orgId: ORG,
          email,
          name: nome,
          passwordHash: await bcrypt.hash(senha, 10),
          roles: { connect: { id: papelId } },
        },
        update: {},
        select: { id: true },
      });
      return u.id;
    };

    id.titular = await usuario(`titular@${SUFIXO}`, 'Titular', SENHA_DO_TITULAR, admin.id);
    id.operador = await usuario(`operador@${SUFIXO}`, 'Operador', SENHA_DO_OPERADOR, analista.id);
    id.maquina = await usuario(`bot@${SUFIXO}`, 'Bot', 'irrelevante', bot.id);
    // Esta é a peça do caso "papel revogado": no BANCO ela é analista; o token de
    // sessão dela (emitido antes da revogação) ainda diz admin_master.
    id.rebaixado = await usuario(
      `rebaixado@${SUFIXO}`,
      'Rebaixado',
      SENHA_DO_TITULAR,
      analista.id,
    );
    id.forasteiro = await usuario(
      `forasteiro@${SUFIXO}`,
      'Forasteiro',
      SENHA_DO_TITULAR,
      forasteiro.id,
    );
    id.consulta = await usuario(`consulta@${SUFIXO}`, 'Consulta', SENHA_DO_TITULAR, consulta.id);
    id.titular2 = await usuario(`titular2@${SUFIXO}`, 'Titular Dois', SENHA_DO_TITULAR, admin.id);

    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    jwt = new JwtService({ secret: 'segredo-desta-suite' });
    reauth = new ReauthService(p, jwt, audit);

    policy = new PolicyService(p);
    await policy.onModuleInit();
    approvals = new ApprovalsService(p, audit, reauth);
    semVerificador = new ApprovalsService(p, audit);
    eventos = new EventLogService(p);
    /*
     * Desde a fatia 3.3 quem dispara o efeito é a PORTA, nos dois caminhos de
     * execução — inclusive no pós-aprovação, que é o desta suíte. O registro
     * entra na construção dela; `AcoesService` recebe a porta.
     */
    const registro = new EfeitosRegistry();
    gateway = new ToolGateway(
      p,
      policy,
      new SinaisService(p, policy),
      approvals,
      eventos,
      undefined,
      undefined,
      registro,
    );
    acoes = new AcoesService(p, gateway, eventos);
  });

  afterAll(async () => {
    vi.useRealTimers();
    // O EventLog é append-only por RULE do banco — vale para o teste também.
    /*
     * NUMA TRANSAÇÃO SÓ. `EventLog` é do banco INTEIRO e os arquivos de teste
     * rodam em PARALELO contra ele: em comandos soltos, a RULE de append-only
     * fica desligada para TODO MUNDO na janela entre eles, e quem estiver
     * medindo o append-only nesse instante sai vermelho por um defeito que não
     * existe. Dentro de uma transação o ALTER TABLE segura ACCESS EXCLUSIVE até
     * o commit, e worker morto no meio devolve a RULE ligada. Mesmo conserto da
     * onda 6 em `rastro-retencao.test.ts`.
     */
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
      prisma.eventLog.deleteMany({ where: { orgId: ORG } }),
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
    ]);
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
    executou = [];
    /*
     * Limpar `ToolCall` a cada caso não é higiene: é o que mantém o NÍVEL
     * estável. `volume_atipico` compara as chamadas da última hora com a média
     * dos 30 dias — a partir da SEGUNDA chamada da mesma capacidade na mesma
     * empresa ele acende e sobe tudo um degrau. `erro_recente` faz o mesmo a
     * partir de um único `recusado` do mesmo agente.
     */
    await prisma.approval.deleteMany({ where: { orgId: ORG } });
    await prisma.toolCall.deleteMany({ where: { orgId: ORG } });
  });

  // ------------------------------------------------------- a escada, degrau a degrau

  it('R2 executa direto — e hoje ninguém desliga a aprovação configurável dele', async () => {
    /*
     * R2 é o único degrau em que a aprovação é CONFIGURÁVEL por cliente
     * (`APROVACAO_POR_NIVEL.R2.exigida === 'configuravel'`). Com ela desligada,
     * R2 executa direto — é o que a escada promete, e é o que este primeiro
     * bloco prova, no motor puro.
     */
    const capacidade = policy.resolverCapacidade(ORG, 'crm.lead.alterar');
    const desligada = avaliar(capacidade, { aprovacaoR2Ligada: false });
    expect(desligada.nivel).toBe('R2');
    expect(desligada.exigeAprovacao).toBe(false);
    expect(desligada.permitido).toBe(true);
    expect(desligada.exigeReautenticacao).toBe(false);
    expect(desligada.aprovacao.alcadaMinima).toBe('operador');

    /*
     * E o segundo bloco registra a VERDADE de hoje, que é diferente: ninguém no
     * produto passa `aprovacaoR2Ligada`. `ToolGateway` chama a régua com
     * `ctx: { sinais }` e mais nada, e `avaliar` trata "não informado" como
     * LIGADO — então, na prática, R2 retém sempre. Não é um defeito desta fatia
     * (o interruptor por empresa é que não existe), e está no relatório; o que
     * não podia é a suíte afirmar um comportamento que o produto não tem.
     */
    const r = await gateway.executar(
      {
        capabilityId: 'crm.lead.alterar',
        args: { id: 'lead-1', status: 'ganho' },
        ctx: ctx({ agentSlug: 'agente-do-r2' }),
        resource: { type: 'crm.lead.alterar', id: 'lead-1' },
      },
      async () => {
        executou.push('crm.lead.alterar');
        return { ok: true };
      },
    );
    expect(r.status).toBe('aguardando_aprovacao');
    expect(executou).toHaveLength(0);
    if (r.status !== 'aguardando_aprovacao') return;
    expect(r.decisao.nivel).toBe('R2');

    // O que R2 pede de quem aprova é o PISO: operador basta.
    const linha = await aprovacao(r.approvalId);
    expect(linha.alcadaMinima).toBe('operador');
    expect(linha.exigeReauth).toBe(false);
    await approvals.confirm(ORG, r.approvalId, { id: id.operador, papeis: ['analista'] });
    expect((await aprovacao(r.approvalId)).status).toBe(ApprovalState.confirmada);
  });

  it('R3 fica aguardando: o efeito não roda e a fila recebe o item', async () => {
    const retida = await reter('whatsapp.mensagem.enviar', { titulo: 'T', corpo: 'o texto' });
    expect(executou).toHaveLength(0);
    expect(retida.decisao.nivel).toBe('R3');

    const linha = await aprovacao(retida.approvalId);
    expect(linha.status).toBe(ApprovalState.pendente);
    // R3 pede responsavel, e NÃO pede reautenticação — é o degrau da assinatura
    // no conteúdo, não o da prova de identidade.
    expect(linha.alcadaMinima).toBe('responsavel');
    expect(linha.exigeReauth).toBe(false);

    const fila = await approvals.listar(ORG);
    expect(fila.items.map((i) => i.id)).toContain(retida.approvalId);
  });

  it('R5 nunca executa: prepara, registra o preparo e encaminha para gente', async () => {
    const r = await gateway.executar(
      {
        capabilityId: 'financeiro.pagamento.baixar',
        args: { titulo: 'T-1', valor: 1250.5 },
        ctx: ctx({ agentSlug: 'agente-do-r5' }),
      },
      async () => {
        executou.push('financeiro.pagamento.baixar');
        return { baixado: true };
      },
    );

    expect(r.status).toBe('recusado');
    expect(executou).toHaveLength(0);
    if (r.status !== 'recusado') return;
    expect(r.decisao.nivel).toBe('R5');
    expect(r.decisao.permitido).toBe(false);
    // O MATERIAL PREPARADO volta para quem pediu — R5 não é "não pode", é "não
    // sou eu quem faz".
    expect(r.preparo).toMatchObject({
      capacidade: 'financeiro.pagamento.baixar',
      argumentos: { titulo: 'T-1', valor: 1250.5 },
    });

    // E o preparo fica REGISTRADO: a chamada existe, recusada, no nível certo…
    const chamada = await prisma.toolCall.findUniqueOrThrow({ where: { id: r.toolCallId } });
    expect(chamada.status).toBe('recusado');
    expect(chamada.nivel).toBe('R5');
    // …com os argumentos redigidos, porque a capacidade é de sensibilidade
    // restrita (RF-R-04): o RASTRO guarda QUE campos, não o conteúdo deles.
    expect(chamada.args).toMatchObject({ redigido: true });
    expect((chamada.args as { chaves: string[] }).chaves).toEqual(['titulo', 'valor']);

    // …e o RASTRO tem a linha da recusa, no fio da proposta.
    const recusado = await prisma.eventLog.findFirst({
      where: { orgId: ORG, tipo: 'tool.recusado', toolCallId: r.toolCallId },
    });
    expect(recusado?.nivel).toBe('R5');

    // R5 NÃO vira item de fila: não existe aprovação para dar. Quem executa é
    // uma pessoa, na origem.
    expect(await prisma.approval.count({ where: { orgId: ORG } })).toBe(0);
  });

  // ------------------------------------------------------------------- alçada

  it('R4 sem alçada suficiente é RECUSADA — e a aprovação continua pendente', async () => {
    const retida = await reter('usuario.permissao.alterar', { userId: 'u-1', papel: 'admin_master' });
    const linha = await aprovacao(retida.approvalId);
    expect(linha.nivelExigido).toBe('R4');
    expect(linha.alcadaMinima).toBe('titular');

    await expect(
      approvals.confirm(ORG, retida.approvalId, {
        id: id.operador,
        papeis: ['analista'],
        // Senha CERTA de propósito: o que recusa aqui é a alçada, e a suíte
        // precisa provar que não foi a reautenticação passando na frente.
        reauth: { senha: SENHA_DO_OPERADOR },
      }),
    ).rejects.toThrow(/Alçada insuficiente/i);

    const depois = await aprovacao(retida.approvalId);
    expect(depois.status).toBe(ApprovalState.pendente);
    expect(depois.aprovadoPorId).toBeNull();
    expect(depois.reautenticadoEm).toBeNull();

    // A recusa é EVENTO, não silêncio: é o que permite ver alguém batendo numa
    // aprovação acima da alçada dele.
    const registro = await prisma.auditLog.findFirst({
      where: { orgId: ORG, action: 'approval.confirm.recusada', actorId: id.operador },
      orderBy: { createdAt: 'desc' },
    });
    expect(registro?.after).toMatchObject({ exigida: 'titular', tem: 'operador' });
  });

  it('R3 pede responsavel: operador não alcança, titular alcança', async () => {
    const retida = await reter('whatsapp.mensagem.enviar', { titulo: 'T', corpo: 'c' });

    await expect(
      approvals.confirm(ORG, retida.approvalId, { id: id.operador, papeis: ['analista'] }),
    ).rejects.toThrow(/Alçada insuficiente/i);
    expect((await aprovacao(retida.approvalId)).status).toBe(ApprovalState.pendente);

    await approvals.confirm(ORG, retida.approvalId, { id: id.titular, papeis: ['admin_master'] });
    const depois = await aprovacao(retida.approvalId);
    expect(depois.status).toBe(ApprovalState.confirmada);
    expect(depois.aprovadoPorId).toBe(id.titular);
    // R3 não exige reautenticação, e o campo não pode mentir dizendo que houve.
    expect(depois.reautenticadoEm).toBeNull();
  });

  it('papel desconhecido não concede alçada nenhuma — nem o piso', async () => {
    // A tabela é fechada de propósito: papel escrito à mão no banco, papel de
    // uma versão futura, papel que saiu do catálogo — todos valem zero. O erro
    // caro aqui é conceder autoridade a quem não se sabe quem é.
    expect(alcadaDe(['papel-que-alguem-inventou'])).toBeNull();
    expect(alcadaDe([])).toBeNull();
    expect(atendeAlcada('operador', null)).toBe(false);

    // E o papel inventado está no BANCO desta pessoa, não só no token dela —
    // que é o único lugar de onde a alçada sai desde a correção de 11/09/2026.
    const retida = await reter('whatsapp.mensagem.enviar', { titulo: 'T', corpo: 'c' });
    await expect(
      approvals.confirm(ORG, retida.approvalId, {
        id: id.forasteiro,
        papeis: ['diretor-regional'],
      }),
    ).rejects.toThrow(/Alçada insuficiente/i);
  });

  it('um perfil que só LÊ não recebe autoridade de aprovar nem no piso', async () => {
    /*
     * O critério declarado nesta tabela é AUTORIDADE, não conjunto de
     * permissões. `consulta_limitada` só lê — não responde por ação nenhuma —,
     * e até 11/09/2026 ele recebia `operador`, o piso da escada. Era inerte
     * (o perfil não tem `mcp.executar`, então não alcança a rota), e contrariava
     * o critério que o próprio arquivo declara.
     *
     * E ele NÃO é conta de máquina: a recusa precisa ser de alçada, não a
     * mensagem "conta de serviço (IA)", que seria falsa sobre uma pessoa.
     */
    expect(alcadaDe(['consulta_limitada'])).toBeNull();
    expect(temPapelDeMaquina(['consulta_limitada'])).toBe(false);

    const retida = await reter('whatsapp.mensagem.enviar', { titulo: 'T', corpo: 'c' });
    await expect(
      approvals.confirm(ORG, retida.approvalId, {
        id: id.consulta,
        papeis: ['consulta_limitada'],
      }),
    ).rejects.toThrow(/Alçada insuficiente/i);
  });

  it('degrau que a tabela não conhece NÃO é atendido por ninguém', async () => {
    /*
     * A comparação usava `indexOf` numa lista solta, e `indexOf` de valor
     * desconhecido devolve -1: `-1 >= -1` é verdadeiro, então QUALQUER alçada
     * real satisfazia uma exigência desconhecida. O revisor executou: uma alçada
     * inventada era atendida por um operador. Hoje seria inerte — a escada tem
     * três degraus — mas no dia em que alguém acrescentar o quarto, toda
     * aprovação nesse degrau passaria a ser confirmável pelo piso, em silêncio.
     *
     * Agora a comparação é por FORÇA, num mapa exaustivo sobre o tipo `Alcada`
     * do pacote de política, e o que a tabela não conhece recusa.
     */
    const inventada = 'diretoria';
    expect(alcadaConhecida(inventada)).toBe(false);
    expect(atendeAlcada(inventada, 'operador')).toBe(false);
    expect(atendeAlcada(inventada, 'titular')).toBe(false);
    expect(atendeAlcada(undefined, 'titular')).toBe(false);

    // E os três degraus que existem continuam se comparando como sempre.
    expect(atendeAlcada('operador', 'titular')).toBe(true);
    expect(atendeAlcada('titular', 'responsavel')).toBe(false);
    expect(atendeAlcada('responsavel', 'responsavel')).toBe(true);
  });

  // ---------------------------------------------------------- reautenticação

  it('R4 com alçada mas SEM reautenticação é recusada', async () => {
    const retida = await reter('usuario.permissao.alterar', { userId: 'u-1' });
    expect((await aprovacao(retida.approvalId)).exigeReauth).toBe(true);

    await expect(
      approvals.confirm(
        ORG,
        retida.approvalId,
        { id: id.titular, papeis: ['admin_master'] },
        'liberação combinada com a diretoria na reunião de segunda',
      ),
    ).rejects.toThrow(/exige reautenticação/i);

    const depois = await aprovacao(retida.approvalId);
    expect(depois.status).toBe(ApprovalState.pendente);
    expect(depois.reautenticadoEm).toBeNull();
  });

  it('senha errada não reautentica ninguém — e nada é escrito', async () => {
    const retida = await reter('usuario.permissao.alterar', { userId: 'u-1' });

    await expect(
      approvals.confirm(
        ORG,
        retida.approvalId,
        {
          id: id.titular,
          papeis: ['admin_master'],
          reauth: { senha: 'nem-perto-da-senha' },
        },
        'liberação combinada com a diretoria na reunião de segunda',
      ),
    ).rejects.toThrow(/Senha incorreta/i);

    const depois = await aprovacao(retida.approvalId);
    expect(depois.status).toBe(ApprovalState.pendente);
    expect(depois.reautenticadoEm).toBeNull();
    expect(depois.aprovadoPorId).toBeNull();

    const registro = await prisma.auditLog.findFirst({
      where: { orgId: ORG, action: 'auth.reautenticacao.recusada', actorId: id.titular },
      orderBy: { createdAt: 'desc' },
    });
    expect(registro?.after).toMatchObject({ motivo: 'senha-incorreta' });
  });

  it('com alçada E senha certa, R4 passa — e `reautenticadoEm` vira verdade', async () => {
    const retida = await reter('usuario.permissao.alterar', { userId: 'u-1' });

    const antes = new Date();
    await approvals.confirm(
      ORG,
      retida.approvalId,
      {
        id: id.titular,
        papeis: ['admin_master'],
        reauth: { senha: SENHA_DO_TITULAR },
      },
      'liberação combinada com a diretoria na reunião de segunda',
    );

    const depois = await aprovacao(retida.approvalId);
    expect(depois.status).toBe(ApprovalState.confirmada);
    expect(depois.aprovadoPorId).toBe(id.titular);
    // O campo que era escrito sem ninguém provar nada agora só existe porque
    // alguém provou — e o instante é o da prova.
    expect(depois.reautenticadoEm).toBeInstanceOf(Date);
    expect(depois.reautenticadoEm!.getTime()).toBeGreaterThanOrEqual(antes.getTime() - 1000);

    // A reautenticação também vira linha de auditoria, presa à aprovação.
    const registro = await prisma.auditLog.findFirst({
      where: { orgId: ORG, action: 'auth.reautenticacao', entityId: retida.approvalId },
    });
    expect(registro?.actorId).toBe(id.titular);

    // E como `usuario.permissao.alterar` não tem efeito ligado, o OS diz isso em
    // vez de fingir que executou.
    const exec = await acoes.executarAprovada(ORG, retida.approvalId, id.titular);
    expect(exec.status).toBe('sem_efeito');
  });

  it('a prova em token vale para a aprovação que a pediu — e só para ela', async () => {
    const alvo = await reter('usuario.permissao.alterar', { userId: 'u-1' });
    await prisma.toolCall.deleteMany({ where: { orgId: ORG } });
    const outra = await reter('usuario.permissao.alterar', { userId: 'u-2' });

    const prova = await reauth.provar({
      userId: id.titular,
      orgId: ORG,
      senha: SENHA_DO_TITULAR,
      aprovacaoId: alvo.approvalId,
    });

    // A prova de UMA aprovação não carimba a OUTRA. Sem esse vínculo, digitar a
    // senha uma vez abriria cinco minutos de R4 livre.
    await expect(
      approvals.confirm(
        ORG,
        outra.approvalId,
        { id: id.titular, papeis: ['admin_master'], reauth: { token: prova.token } },
        'liberação combinada com a diretoria na reunião de segunda',
      ),
    ).rejects.toThrow(/não vale para esta aprovação/i);
    expect((await aprovacao(outra.approvalId)).status).toBe(ApprovalState.pendente);

    // Nem serve para outra pessoa — e a outra pessoa aqui tem a MESMA alçada,
    // para que o que recuse seja o vínculo da prova e não a autoridade dela.
    await expect(
      approvals.confirm(
        ORG,
        alvo.approvalId,
        { id: id.titular2, papeis: ['admin_master'], reauth: { token: prova.token } },
        'liberação combinada com a diretoria na reunião de segunda',
      ),
    ).rejects.toThrow(/não vale para esta aprovação/i);

    // Na aprovação certa, com a pessoa certa, passa.
    await approvals.confirm(
      ORG,
      alvo.approvalId,
      { id: id.titular, papeis: ['admin_master'], reauth: { token: prova.token } },
      'liberação combinada com a diretoria na reunião de segunda',
    );
    expect((await aprovacao(alvo.approvalId)).reautenticadoEm).toBeInstanceOf(Date);
  });

  it('token de SESSÃO não serve de prova de reautenticação', async () => {
    const retida = await reter('usuario.permissao.alterar', { userId: 'u-1' });
    // Um token de sessão é assinado com a MESMA chave. Se a prova conferisse só
    // a assinatura, quem já está logado reautenticaria sozinho — que é
    // exatamente não reautenticar.
    const sessao = jwt.sign({ typ: 'sessao', sub: id.titular, orgId: ORG, roles: ['admin_master'] });

    await expect(
      approvals.confirm(
        ORG,
        retida.approvalId,
        { id: id.titular, papeis: ['admin_master'], reauth: { token: sessao } },
        'liberação combinada com a diretoria na reunião de segunda',
      ),
    ).rejects.toThrow(/não vale para esta aprovação/i);
    expect((await aprovacao(retida.approvalId)).status).toBe(ApprovalState.pendente);
  });

  it('em R4 a alçada é reconferida NO BANCO: token com papel revogado não passa', async () => {
    /*
     * O token de sessão vale oito horas. Se ele fosse a única fonte da alçada,
     * revogar o papel de alguém às nove da manhã só teria efeito às cinco da
     * tarde — e no meio disso a pessoa aprovaria um R4. Como a reautenticação já
     * vai ao banco buscar o hash da senha, ela traz os papéis de lá, e a alçada
     * é conferida duas vezes.
     */
    const retida = await reter('usuario.permissao.alterar', { userId: 'u-1' });

    await expect(
      approvals.confirm(ORG, retida.approvalId, {
        id: id.rebaixado,
        // o token ainda diz titular…
        papeis: ['admin_master'],
        reauth: { senha: SENHA_DO_TITULAR },
      }),
    ).rejects.toThrow(/Alçada insuficiente/i);

    expect((await aprovacao(retida.approvalId)).status).toBe(ApprovalState.pendente);
    // …e a recusa diz de onde veio o papel que não bastou: do BANCO.
    const registro = await prisma.auditLog.findFirst({
      where: { orgId: ORG, action: 'approval.confirm.recusada', actorId: id.rebaixado },
      orderBy: { createdAt: 'desc' },
    });
    expect(registro?.after).toMatchObject({ motivo: 'alcada-insuficiente', tem: 'operador' });
  });

  it('usuário inativo não reautentica, mesmo com a senha certa', async () => {
    const retida = await reter('usuario.permissao.alterar', { userId: 'u-1' });
    await prisma.user.update({ where: { id: id.titular }, data: { isActive: false } });
    try {
      await expect(
        approvals.confirm(ORG, retida.approvalId, {
          id: id.titular,
          papeis: ['admin_master'],
          reauth: { senha: SENHA_DO_TITULAR },
        }),
      ).rejects.toThrow(/usuário ativo/i);
    } finally {
      await prisma.user.update({ where: { id: id.titular }, data: { isActive: true } });
    }
    expect((await aprovacao(retida.approvalId)).status).toBe(ApprovalState.pendente);
  });

  // ------------------------------------------------------ quem aprova é gente

  it('o agente que PROPÔS não aprova — nem com papel de titular no token', async () => {
    const retida = await reter('whatsapp.mensagem.enviar', { titulo: 'T', corpo: 'c' });
    await expect(
      approvals.confirm(ORG, retida.approvalId, {
        id: 'agente-que-propos',
        papeis: ['admin_master'],
      }),
    ).rejects.toThrow(/não pode aprová-la/i);
    expect((await aprovacao(retida.approvalId)).status).toBe(ApprovalState.pendente);
  });

  it('OUTRO agente também não aprova: conta de serviço não é gente', async () => {
    /*
     * O furo que isto fecha. `ia_servico` e `ia_acao` têm `mcp.executar`, que é a
     * permissão exigida por `POST /approvals/:id/confirm`. A trava do proponente
     * compara ids — então bastava um SEGUNDO token de serviço, com outro id, para
     * um agente carimbar o que o outro propôs.
     */
    expect(temPapelDeMaquina(['ia_acao'])).toBe(true);
    expect(alcadaDe(['ia_servico'])).toBeNull();

    const retida = await reter('whatsapp.mensagem.enviar', { titulo: 'T', corpo: 'c' });
    await expect(
      approvals.confirm(ORG, retida.approvalId, { id: id.maquina, papeis: ['ia_acao'] }),
    ).rejects.toThrow(/conta de serviço/i);

    const depois = await aprovacao(retida.approvalId);
    expect(depois.status).toBe(ApprovalState.pendente);
    expect(depois.aprovadoPorId).toBeNull();
  });

  it('acumular papel de máquina com papel humano não devolve a alçada', async () => {
    // Um usuário que junta `admin_master` e `ia_acao` é um caminho de automação
    // com cara de pessoa. Uma conta de máquina no conjunto contamina o conjunto.
    expect(alcadaDe(['admin_master', 'ia_acao'])).toBeNull();

    const retida = await reter('whatsapp.mensagem.enviar', { titulo: 'T', corpo: 'c' });
    await expect(
      approvals.confirm(ORG, retida.approvalId, {
        id: id.maquina,
        papeis: ['admin_master', 'ia_acao'],
      }),
    ).rejects.toThrow(/conta de serviço/i);
  });

  it('nome solto (o jeito antigo do terminal) falha dizendo o que está quebrado', async () => {
    /*
     * `confirm` aceitava `actorId: string` e decidia com isso — dava para aprovar
     * em nome de qualquer palavra, e era assim que `src/scripts/aprovar.ts`
     * mandava o `--como "Pedro"` do terminal.
     *
     * O TIPO JÁ RECUSA: a chamada abaixo não compila sem o `as never`, e é por
     * isso que ele está aqui — este caso mede a GUARDA DE EXECUÇÃO, que é a que
     * sobra quando o texto chega por um `any` (script, JavaScript, teste). Sem
     * ela a recusa sairia lá adiante como "usuário não existe": verdadeira, e a
     * três passos da causa.
     *
     * As duas asserções são o contrato: a mensagem diz o caminho certo, e a
     * aprovação continua PENDENTE — recusar não pode consumir o item da fila.
     */
    const retida = await reter('whatsapp.mensagem.enviar', { titulo: 'T', corpo: 'c' });
    const comoNomeSolto = 'Pedro' as never;
    await expect(approvals.confirm(ORG, retida.approvalId, comoNomeSolto)).rejects.toThrow(
      /exige um USUÁRIO/i,
    );
    const erro = await approvals
      .confirm(ORG, retida.approvalId, comoNomeSolto)
      .catch((e: Error) => e.message);
    expect(erro).not.toMatch(/Alçada insuficiente/i);
    expect(erro).toMatch(/--como/);
    expect((await aprovacao(retida.approvalId)).status).toBe(ApprovalState.pendente);
  });

  it('sem verificador de reautenticação, R4 falha FECHADA', async () => {
    // Montagem sem `ReauthService` (é o que uma suíte antiga faz). A ausência do
    // verificador não pode virar dispensa: seria o bug original de volta, agora
    // por omissão de dependência.
    const retida = await reter('usuario.permissao.alterar', { userId: 'u-1' });
    await expect(
      semVerificador.confirm(
        ORG,
        retida.approvalId,
        { id: id.titular, papeis: ['admin_master'], reauth: { senha: SENHA_DO_TITULAR } },
        'liberação combinada com a diretoria na reunião de segunda',
      ),
    ).rejects.toThrow(/verificador não está disponível/i);
    expect((await aprovacao(retida.approvalId)).status).toBe(ApprovalState.pendente);

    // …e o degrau que NÃO exige reautenticação continua passando na mesma
    // montagem: falhar fechado é sobre R4, não sobre tudo.
    await prisma.toolCall.deleteMany({ where: { orgId: ORG } });
    const r3 = await reter('whatsapp.mensagem.enviar', { titulo: 'T', corpo: 'c' });
    await semVerificador.confirm(ORG, r3.approvalId, { id: id.titular, papeis: ['admin_master'] });
    expect((await aprovacao(r3.approvalId)).status).toBe(ApprovalState.confirmada);
  });


  // ------------------------------------------ a releitura do banco, em todo nível

  it('R3: usuário DESATIVADO não confirma — a situação é lida agora, não no login', async () => {
    /*
     * O furo mais caro da primeira versão desta fatia. A releitura do banco
     * existia, mas presa ao caminho de reautenticação — quer dizer, só em R4/R5.
     * R3 é onde mora a única capacidade com efeito ligado de verdade
     * (`whatsapp.mensagem.enviar`), e nele a alçada saía do TOKEN, que vale oito
     * horas. Demitido de manhã seguia aprovando saída externa até a tarde.
     */
    const retida = await reter('whatsapp.mensagem.enviar', { titulo: 'T', corpo: 'c' });
    await prisma.user.update({ where: { id: id.titular }, data: { isActive: false } });
    try {
      await expect(
        approvals.confirm(ORG, retida.approvalId, { id: id.titular, papeis: ['admin_master'] }),
      ).rejects.toThrow(/usuário ativo/i);
    } finally {
      await prisma.user.update({ where: { id: id.titular }, data: { isActive: true } });
    }
    expect((await aprovacao(retida.approvalId)).status).toBe(ApprovalState.pendente);

    const registro = await prisma.auditLog.findFirst({
      where: { orgId: ORG, action: 'approval.confirm.recusada', actorId: id.titular },
      orderBy: { createdAt: 'desc' },
    });
    expect(registro?.after).toMatchObject({ motivo: 'usuario-inativo' });
  });

  it('R3: quem NÃO EXISTE na tabela de usuários não confirma', async () => {
    const retida = await reter('whatsapp.mensagem.enviar', { titulo: 'T', corpo: 'c' });
    await expect(
      approvals.confirm(ORG, retida.approvalId, {
        id: 'usuario-que-nunca-existiu',
        papeis: ['admin_master'],
      }),
    ).rejects.toThrow(/usuário ativo/i);
    expect((await aprovacao(retida.approvalId)).status).toBe(ApprovalState.pendente);

    const registro = await prisma.auditLog.findFirst({
      where: { orgId: ORG, action: 'approval.confirm.recusada', actorId: 'usuario-que-nunca-existiu' },
      orderBy: { createdAt: 'desc' },
    });
    expect(registro?.after).toMatchObject({ motivo: 'usuario-inexistente' });
  });

  it('R3: REBAIXADO no banco não confirma, mesmo com o token antigo dizendo titular', async () => {
    const retida = await reter('whatsapp.mensagem.enviar', { titulo: 'T', corpo: 'c' });
    await expect(
      approvals.confirm(ORG, retida.approvalId, {
        id: id.rebaixado,
        papeis: ['admin_master'], // o token de oito horas ainda diz isto
      }),
    ).rejects.toThrow(/Alçada insuficiente/i);
    expect((await aprovacao(retida.approvalId)).status).toBe(ApprovalState.pendente);
  });

  it('e a alçada do BANCO manda sempre — inclusive para CONCEDER', async () => {
    // O espelho do caso acima: o token diz analista, o banco diz admin_master.
    // Se o token pudesse recusar, uma promoção só valeria no próximo login.
    const retida = await reter('whatsapp.mensagem.enviar', { titulo: 'T', corpo: 'c' });
    await approvals.confirm(ORG, retida.approvalId, {
      id: id.titular,
      papeis: ['analista'],
    });
    expect((await aprovacao(retida.approvalId)).status).toBe(ApprovalState.confirmada);
  });

  // -------------------------------------------------------------- motivo escrito

  it('a exigência de motivo por nível é a mesma que a régua calcula', async () => {
    /*
     * `Decisao.exigeMotivo` não sobrevive à proposta: a linha guarda o NÍVEL, e é
     * dele que a confirmação deriva a exigência. Esta tabela local pode divergir
     * da régua, então ela fica presa à régua aqui, degrau por degrau.
     */
    const inerte = {
      escreveForaDoOS: false,
      produzArtefato: false,
      reversibilidade: 'automatica',
      exposicaoExterna: false,
      impactoFinanceiro: 'nenhum',
      sensibilidade: 'publica',
      destruicao: false,
      obrigacaoLegal: false,
    } as Capacidade['efeito'];

    for (const nivel of Object.keys(EXIGE_MOTIVO_POR_NIVEL) as Nivel[]) {
      const decisao = avaliar({ id: 'x', descricao: 'x', nivel, efeito: inerte });
      expect(decisao.nivel).toBe(nivel);
      expect(EXIGE_MOTIVO_POR_NIVEL[nivel]).toBe(decisao.exigeMotivo);
    }
  });

  it('R4 sem motivo escrito é recusada — e o motivo fica gravado quando existe', async () => {
    const retida = await reter('usuario.permissao.alterar', { userId: 'u-1' });

    await expect(
      approvals.confirm(ORG, retida.approvalId, {
        id: id.titular,
        papeis: ['admin_master'],
        reauth: { senha: SENHA_DO_TITULAR },
      }),
    ).rejects.toThrow(/motivo escrito/i);
    expect((await aprovacao(retida.approvalId)).status).toBe(ApprovalState.pendente);

    // Texto curto é o que um chamador automático manda quando o campo virou
    // obrigatório e ninguém pensou nele. O mínimo é o do pacote de política.
    await expect(
      approvals.confirm(
        ORG,
        retida.approvalId,
        { id: id.titular, papeis: ['admin_master'], reauth: { senha: SENHA_DO_TITULAR } },
        'ok',
      ),
    ).rejects.toThrow(new RegExp(`${MINIMO_DO_MOTIVO} caracteres`));

    await approvals.confirm(
      ORG,
      retida.approvalId,
      { id: id.titular, papeis: ['admin_master'], reauth: { senha: SENHA_DO_TITULAR } },
      'cliente pediu o envio hoje, combinado na reunião de segunda',
    );
    const depois = await aprovacao(retida.approvalId);
    expect(depois.status).toBe(ApprovalState.confirmada);
    expect(depois.motivo).toMatch(/cliente pediu o envio hoje/);
  });

  it('R3 não exige motivo — e guarda o que a pessoa escreveu assim mesmo', async () => {
    const retida = await reter('whatsapp.mensagem.enviar', { titulo: 'T', corpo: 'c' });
    await approvals.confirm(
      ORG,
      retida.approvalId,
      { id: id.titular, papeis: ['admin_master'] },
      'mando porque o cliente cobrou no grupo',
    );
    const depois = await aprovacao(retida.approvalId);
    expect(depois.status).toBe(ApprovalState.confirmada);
    expect(depois.motivo).toMatch(/cliente cobrou/);
  });

  // ------------------------------------------------- tentativa repetida de senha

  it('a partir de poucas recusas a senha nem é conferida — e o rastro tem teto', async () => {
    /*
     * Sessenta tentativas simultâneas contra a senha do titular respondiam em
     * menos de quatro segundos, sem nenhuma recusa por excesso: força bruta e,
     * de quebra, negação de serviço (bcryptjs é JS puro e roda na fila do
     * processo). O conserto definitivo é limite de taxa na borda, que não existe
     * nesta API e é fatia própria; aqui a trava conta as recusas já registradas
     * no RASTRO, por pessoa e por aprovação.
     */
    const retida = await reter('usuario.permissao.alterar', { userId: 'u-1' });
    const chutar = (n: number) =>
      approvals
        .confirm(
          ORG,
          retida.approvalId,
          { id: id.titular, papeis: ['admin_master'], reauth: { senha: `chute-${n}` } },
          'tentativa automatizada de adivinhar a senha do titular',
        )
        .then(() => 'confirmou (não devia)')
        .catch((e: Error) => e.message);

    // Em paralelo, como o revisor mediu: a fila por aprovação é o que impede as
    // sessenta de lerem "zero recusas" antes de a primeira ser escrita.
    const respostas = await Promise.all(Array.from({ length: 20 }, (_, i) => chutar(i)));
    const senhaIncorreta = respostas.filter((m) => /Senha incorreta/i.test(m)).length;
    const travadas = respostas.filter((m) => /Tentativas demais/i.test(m)).length;
    expect(senhaIncorreta).toBeLessThanOrEqual(LIMITE_DE_RECUSAS);
    expect(travadas).toBeGreaterThanOrEqual(20 - LIMITE_DE_RECUSAS);

    // O rastro para de crescer: no máximo LIMITE recusas e UMA linha de trava.
    const recusas = await prisma.auditLog.count({
      where: { orgId: ORG, entityId: retida.approvalId, action: 'auth.reautenticacao.recusada' },
    });
    const travas = await prisma.auditLog.count({
      where: { orgId: ORG, entityId: retida.approvalId, action: 'auth.reautenticacao.travada' },
    });
    expect(recusas).toBeLessThanOrEqual(LIMITE_DE_RECUSAS);
    expect(travas).toBe(1);

    // E nem a senha CERTA passa enquanto a janela está de pé: a trava é sobre a
    // aprovação, não sobre o chute.
    await expect(
      approvals.confirm(
        ORG,
        retida.approvalId,
        { id: id.titular, papeis: ['admin_master'], reauth: { senha: SENHA_DO_TITULAR } },
        'agora com a senha certa, ainda dentro da janela',
      ),
    ).rejects.toThrow(/Tentativas demais/i);
    expect((await aprovacao(retida.approvalId)).status).toBe(ApprovalState.pendente);
  });

  // ------------------------------------------------- a prova e a senha vigente

  it('a prova em token morre quando a senha do aprovador muda', async () => {
    /*
     * É a primeira coisa que a vítima de uma sessão roubada faz. Sem o vínculo
     * com a senha vigente, a prova de cinco minutos emitida pelo ladrão
     * continuava valendo depois da troca — a vítima achava que tinha resolvido.
     */
    const retida = await reter('usuario.permissao.alterar', { userId: 'u-1' });
    const prova = await reauth.provar({
      userId: id.titular2,
      orgId: ORG,
      senha: SENHA_DO_TITULAR,
      aprovacaoId: retida.approvalId,
    });

    await prisma.user.update({
      where: { id: id.titular2 },
      data: { passwordHash: await bcrypt.hash('senha-nova-da-vitima', 10) },
    });
    try {
      await expect(
        approvals.confirm(
          ORG,
          retida.approvalId,
          { id: id.titular2, papeis: ['admin_master'], reauth: { token: prova.token } },
          'usando prova emitida antes da troca de senha',
        ),
      ).rejects.toThrow(/senha mudou/i);
    } finally {
      await prisma.user.update({
        where: { id: id.titular2 },
        data: { passwordHash: await bcrypt.hash(SENHA_DO_TITULAR, 10) },
      });
    }
    expect((await aprovacao(retida.approvalId)).status).toBe(ApprovalState.pendente);
  });

  it('não se emite prova para uma aprovação que não existe', async () => {
    // Sem esta conferência a rota era um oráculo de senha desacoplado da fila:
    // dava para descobrir a senha de alguém sem tocar em aprovação nenhuma.
    await expect(
      reauth.provar({
        userId: id.titular,
        orgId: ORG,
        senha: SENHA_DO_TITULAR,
        aprovacaoId: 'aprovacao-que-nao-existe',
      }),
    ).rejects.toThrow(/não encontrada/i);
  });

  // ------------------------------------------------------------- a rejeição

  it('conta de máquina não REJEITA a proposta de um humano', async () => {
    /*
     * As quatro travas valiam só para o "sim". Rejeitar não executa nada, mas
     * apaga a proposta de uma pessoa por decisão de máquina — a invariante 7 de
     * trás para frente.
     */
    const retida = await reter('whatsapp.mensagem.enviar', { titulo: 'T', corpo: 'c' });
    await prisma.approval.update({
      where: { id: retida.approvalId },
      data: { propostoPorId: id.titular, propostoPorTipo: ActorType.user },
    });

    await expect(
      approvals.reject(ORG, retida.approvalId, { id: id.maquina, papeis: ['ia_acao'] }),
    ).rejects.toThrow(/conta de serviço/i);
    expect((await aprovacao(retida.approvalId)).status).toBe(ApprovalState.pendente);

    // Quem não existe no banco também não rejeita.
    await expect(
      approvals.reject(ORG, retida.approvalId, { id: 'ninguem', papeis: ['admin_master'] }),
    ).rejects.toThrow(/usuário ativo/i);

    await approvals.reject(ORG, retida.approvalId, { id: id.operador, papeis: ['analista'] });
    expect((await aprovacao(retida.approvalId)).status).toBe(ApprovalState.rejeitada);
  });

  it('a cadeia do RASTRO continua íntegra depois de tudo isso', async () => {
    const v = await eventos.verificar(ORG);
    expect(v.ok).toBe(true);
  });
});
