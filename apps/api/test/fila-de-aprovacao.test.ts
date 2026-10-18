import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ActorType, ApprovalState, PrismaClient, RiskLevel, ToolCallStatus } from '@prisma/client';

import { ApprovalsController } from '../src/approvals/approvals.controller';
import { ApprovalsService } from '../src/approvals/approvals.service';
import { AcoesService } from '../src/gateway/acoes.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { EventLogService } from '../src/gateway/event-log.service';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import { AuditService } from '../src/audit/audit.service';
import { SemTenantError } from '../src/common/contexto-execucao';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * A MONTAGEM DA FILA — `GET /approvals/fila`, fatia 3.10, RF-A-05.
 *
 * Por que esta suíte existe, e por que ela é de BANCO:
 *
 * A fila é o maior código novo da fatia e o único que junta cinco tabelas
 * (`Approval`, `ToolCall`, `PolicyDecision`, `User`, `Role`→`Permission`) para
 * responder uma pergunta que a tela não sabe fazer sozinha. A suíte do navegador
 * (`apps/web/tests/component/atendimento.test.tsx`) prova o DESENHO contra uma
 * resposta simulada — ela nunca tocou na montagem. Um filtro de empresa que
 * caísse numa edição não acenderia luz nenhuma ali.
 *
 * E o critério de pronto da fatia diz, com todas as letras, que NENHUM USUÁRIO
 * VÊ ITEM DE OUTRA EMPRESA. Três coisas tornam essa frase cara aqui:
 *
 *   1. esta é a PRIMEIRA rota de requisição do repositório a devolver o corpo de
 *      uma ação retida (`ToolCall.args`) — o texto que vai sair, não um resumo;
 *   2. o isolamento por linha do Postgres está LIGADO na migração e INERTE na
 *      prática, porque a aplicação ainda conecta como DONA das tabelas (ver
 *      `test/tenant-isolation.test.ts`). Quem separa empresa, hoje, é o `where`
 *      escrito à mão em cada consulta;
 *   3. são SEIS consultas nesta rota, cada uma com o seu `orgId` digitado.
 *
 * Cinco delas vazariam em silêncio: `findMany` sem `orgId` devolve tudo e não
 * dá erro. Esta suíte é a luz vermelha — duas empresas, uma proposta em cada, e
 * a fila de uma não devolve NADA da outra: nem item, nem aprovador, nem censo.
 *
 * ---------------------------------------------------------------------------
 * A EMPRESA É SEMEADA À MÃO, NÃO PELA PORTA
 * ---------------------------------------------------------------------------
 * Propor pela porta escreveria no `EventLog`, que é append-only por RULE do
 * banco: a suíte teria de DESLIGAR a regra para limpar depois de si, num banco
 * que roda os arquivos em paralelo. O assunto aqui é a MONTAGEM da leitura, não
 * o caminho da proposta (esse é de `porta.test.ts`), então as linhas entram
 * direto — com os mesmos campos que a porta grava.
 *
 * COMO RODAR:
 *   TEST_DATABASE_URL='postgresql://mkt:shadow@localhost:55432/marketing_os_test' \
 *     pnpm --filter @mktos/api test
 */
const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'cria e apaga empresas, usuários e aprovações');

const ORG_A = 'org-fila-a';
const ORG_B = 'org-fila-b';
const ORG_C = 'org-fila-teto';
const TODAS = [ORG_A, ORG_B, ORG_C];

/** A capacidade usada em toda a suíte: R3, `confidencial`, com `argsSchema`. */
const CAP = 'whatsapp.mensagem.enviar';

/** O texto da empresa B. Se ele aparecer na fila da A, é vazamento. */
const SEGREDO_DA_B = 'contrato da B fecha em 4455-0 — não vaze';

/** Token de sessão de quem olha. `permissions` é o que a trava da rota lê. */
const sessao = (sub: string, orgId: string, permissions: string[]) =>
  ({ sub, orgId, email: `${sub}@teste`, name: sub, roles: ['admin_master'], permissions }) as never;

const VER = ['aprovacoes.ver'];
const VER_E_DECIDIR = ['aprovacoes.ver', 'aprovacoes.decidir'];

describe.skipIf(!URL)('a fila de aprovação, montada do banco', () => {
  let prisma: PrismaClient;
  let controlador: ApprovalsController;
  /** approvalId por apelido, para as asserções não dependerem de ordem. */
  const ids: Record<string, string> = {};

  /**
   * Uma aprovação PENDENTE com ação retida, como a porta a grava.
   *
   * `capabilityId` do `ToolCall` é chave estrangeira para `Capability`, então a
   * linha só entra se o catálogo estiver semeado — ver a conferência no
   * `beforeAll`.
   */
  const reter = async (entrada: {
    apelido: string;
    orgId: string;
    propostoPorId: string;
    corpo: string;
    /** Argumentos fora do formato: para provar a conferência da porta. */
    argsForaDoFormato?: boolean;
    status?: ApprovalState;
    expiraEm?: Date;
    /** Outra capacidade que não a da suíte — usada pelo caso do efeito desligado. */
    capacidade?: string;
  }) => {
    const { apelido, orgId, propostoPorId, corpo } = entrada;
    const cap = entrada.capacidade ?? CAP;
    const decisao = await prisma.policyDecision.create({
      data: {
        orgId,
        capabilityId: cap,
        nivelBase: RiskLevel.R2,
        nivel: RiskLevel.R3,
        permitido: true,
        exigeAprovacao: true,
        sinais: ['exposicao_externa', `marca_${apelido}`],
        motivo: 'escreve fora do OS com exposição externa',
      },
      select: { id: true },
    });
    const chamada = await prisma.toolCall.create({
      data: {
        orgId,
        capabilityId: cap,
        decisionId: decisao.id,
        agentSlug: 'curador',
        actorType: ActorType.ai,
        actorId: propostoPorId,
        status: ToolCallStatus.aguardando_aprovacao,
        // `corpo` é o campo exigido pelo argsSchema da capacidade; `sobrando`
        // não existe lá, e o schema é `additionalProperties: false`.
        args: entrada.argsForaDoFormato ? { corpo, sobrando: 'campo que não existe' } : { corpo },
        nivel: RiskLevel.R3,
        correlationId: `corr-${apelido}`,
      },
      select: { id: true },
    });
    const ap = await prisma.approval.create({
      data: {
        orgId,
        decisionId: decisao.id,
        toolCallId: chamada.id,
        capabilityId: cap,
        propostoPorId,
        propostoPorTipo: ActorType.ai,
        resourceType: cap,
        resourceId: `grupo-${apelido}`,
        contentHash: `hash-${apelido}-0123456789abcdef`,
        resumo: `mensagem ${apelido}`,
        status: entrada.status ?? ApprovalState.pendente,
        nivelExigido: RiskLevel.R3,
        alcadaMinima: 'responsavel',
        canal: 'whatsapp',
        tokenHash: `token-${apelido}-${Math.random()}`,
        expiraEm: entrada.expiraEm ?? new Date(Date.now() + 60 * 60 * 1000),
      },
      select: { id: true },
    });
    ids[apelido] = ap.id;
    return ap.id;
  };

  /** Uma empresa com papéis, permissões e gente. */
  const semearEmpresa = async (
    orgId: string,
    pessoas: Array<{ id: string; nome: string; decide: boolean }>,
  ) => {
    await prisma.org.upsert({
      where: { id: orgId },
      create: { id: orgId, name: orgId, slug: orgId },
      update: {},
    });
    // Dois papéis: um que decide (alçada `titular`, pelo `alcada.ts`) e um que
    // só acompanha (`analista`, alçada `operador`).
    const papeis: Record<string, string> = {};
    for (const [key, chaves] of [
      ['admin_master', VER_E_DECIDIR],
      ['analista', VER],
    ] as const) {
      const papel = await prisma.role.upsert({
        where: { orgId_key: { orgId, key } },
        create: {
          orgId,
          key,
          name: key,
          permissions: { connect: chaves.map((k) => ({ key: k })) },
        },
        update: { permissions: { set: chaves.map((k) => ({ key: k })) } },
        select: { id: true },
      });
      papeis[key] = papel.id;
    }
    for (const p of pessoas) {
      const papelId = papeis[p.decide ? 'admin_master' : 'analista'];
      await prisma.user.upsert({
        where: { id: p.id },
        create: {
          id: p.id,
          orgId,
          name: p.nome,
          email: `${p.id}@teste.fila`,
          passwordHash: 'sem-senha-util',
          roles: { connect: { id: papelId } },
        },
        update: { isActive: true, orgId, roles: { set: [{ id: papelId }] } },
      });
    }
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();

    // O catálogo global de permissões. É upsert e NUNCA apagado no fim: a
    // tabela é compartilhada com as outras suítes que rodam em paralelo neste
    // banco, e remover uma chave dali quebraria a vizinha.
    for (const key of VER_E_DECIDIR) {
      await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
    }

    const capacidade = await prisma.capability.findUnique({ where: { id: CAP } });
    expect(
      capacidade,
      `\nA capacidade "${CAP}" não está no banco de teste.\n` +
        '  `ToolCall.capabilityId` é chave estrangeira para `Capability` — sem a semente\n' +
        '  do catálogo esta suíte não tem como reter ação nenhuma. Rode:\n' +
        '    DATABASE_URL=$TEST_DATABASE_URL pnpm --filter @mktos/api db:seed:politica\n',
    ).not.toBeNull();

    await semearEmpresa(ORG_A, [
      { id: 'pedro-a', nome: 'Pedro da A', decide: true },
      { id: 'lucia-a', nome: 'Lúcia da A', decide: true },
      { id: 'tito-a', nome: 'Tito da A', decide: false },
    ]);
    await semearEmpresa(ORG_B, [
      { id: 'rodrigo-b', nome: 'Rodrigo da B', decide: true },
      { id: 'bia-b', nome: 'Bia da B', decide: true },
    ]);
    await semearEmpresa(ORG_C, [{ id: 'caio-c', nome: 'Caio da C', decide: true }]);

    await reter({ apelido: 'a1', orgId: ORG_A, propostoPorId: 'pedro-a', corpo: 'aviso da A' });
    await reter({
      apelido: 'a2',
      orgId: ORG_A,
      propostoPorId: 'pedro-a',
      corpo: 'mensagem com argumento velho',
      argsForaDoFormato: true,
    });
    await reter({ apelido: 'b1', orgId: ORG_B, propostoPorId: 'rodrigo-b', corpo: SEGREDO_DA_B });

    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    const policy = new PolicyService(p);
    await policy.onModuleInit();
    const approvals = new ApprovalsService(p, audit);
    const eventos = new EventLogService(p);

    /*
     * A PORTA COMPLETA, porque a fila pergunta a ela o que a EXECUÇÃO recusaria
     * hoje (`conferirAprovado`). Sem o registro de efeitos ela responde com a
     * frase de falha fechada, e todo item da fila viria com impedimento — o que
     * passaria despercebido num teste que só conta linhas.
     */
    const efeitos = new EfeitosRegistry();
    efeitos.registrar({ [CAP]: async () => ({ enviado: true }) });
    const gateway = new ToolGateway(
      p,
      policy,
      new SinaisService(p, policy),
      approvals,
      eventos,
      undefined,
      undefined,
      efeitos,
    );
    const acoes = new AcoesService(p, gateway, eventos, undefined, policy);
    controlador = new ApprovalsController(approvals, acoes, p, gateway);
  });

  afterAll(async () => {
    // Limpeza cirúrgica, por empresa: o banco roda os arquivos em paralelo e
    // `deleteMany` sem `where` apagaria o dado da suíte vizinha.
    await prisma.approval.deleteMany({ where: { orgId: { in: TODAS } } });
    await prisma.toolCall.deleteMany({ where: { orgId: { in: TODAS } } });
    await prisma.policyDecision.deleteMany({ where: { orgId: { in: TODAS } } });
    await prisma.auditLog.deleteMany({ where: { orgId: { in: TODAS } } });
    await prisma.user.deleteMany({ where: { orgId: { in: TODAS } } });
    await prisma.role.deleteMany({ where: { orgId: { in: TODAS } } });
    await prisma.org.deleteMany({ where: { id: { in: TODAS } } });
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // O CRITÉRIO DE PRONTO: ninguém vê item de outra empresa
  // ---------------------------------------------------------------------------

  describe('nenhum usuário vê item de outra empresa', () => {
    it('os ITENS são só os da empresa de quem olha', async () => {
      const daA = await controlador.fila(sessao('lucia-a', ORG_A, VER_E_DECIDIR));
      const daB = await controlador.fila(sessao('bia-b', ORG_B, VER_E_DECIDIR));

      expect(daA.itens.map((i) => i.id).sort()).toEqual([ids.a1, ids.a2].sort());
      expect(daB.itens.map((i) => i.id)).toEqual([ids.b1]);
    });

    it('e o CONTEÚDO da outra empresa não aparece em lugar nenhum da resposta', async () => {
      /*
         A asserção é sobre a RESPOSTA INTEIRA serializada, e não sobre o campo
         `conteudo`: o corpo de uma mensagem viaja em mais de um lugar (resumo,
         recurso, argumentos) e um vazamento por um campo esquecido continua
         sendo um vazamento. Esta rota é a primeira da casa a devolver texto
         confidencial por requisição — aqui a rede é grossa de propósito.
      */
      const daA = await controlador.fila(sessao('lucia-a', ORG_A, VER_E_DECIDIR));
      const inteira = JSON.stringify(daA);

      expect(inteira, 'o texto da empresa B apareceu na fila da empresa A').not.toContain(
        SEGREDO_DA_B,
      );
      expect(inteira).not.toContain(ids.b1);
      expect(inteira).not.toContain('rodrigo-b');
      expect(inteira).not.toContain('Bia da B');
      expect(inteira).not.toContain(ORG_B);
    });

    it('QUEM PODE APROVAR só lista gente da própria empresa', async () => {
      const daA = await controlador.fila(sessao('lucia-a', ORG_A, VER_E_DECIDIR));
      const item = daA.itens.find((i) => i.id === ids.a1)!;

      // A proposta é do agente (`propostoPorTipo: ai`) com o id do Pedro, então
      // ele fica de fora pela regra de "quem propõe não assina".
      expect(item.aprovadores.map((a) => a.id)).toEqual(['lucia-a']);
      expect(item.aprovadores.every((a) => a.email.endsWith('@teste.fila'))).toBe(true);
      expect(JSON.stringify(item.aprovadores)).not.toContain('-b');
    });

    it('o CENSO conta só a própria empresa', async () => {
      const daA = await controlador.fila(sessao('lucia-a', ORG_A, VER_E_DECIDIR));
      const daB = await controlador.fila(sessao('bia-b', ORG_B, VER_E_DECIDIR));

      // A tem 2 pessoas que decidem (Pedro e Lúcia) e 1 que só acompanha.
      expect(daA.censo.pessoasQueDecidem).toBe(2);
      expect(daA.censo.porAlcada.titular).toBe(2);
      expect(daA.censo.pessoasAtivas).toBe(3);
      // B tem 2, e nenhuma delas é da A.
      expect(daB.censo.pessoasQueDecidem).toBe(2);
      expect(daB.censo.pessoasAtivas).toBe(2);
    });

    it('token sem empresa resolvida RECUSA — nunca "todas"', async () => {
      /*
       * O padrão da casa (`exigirTenant`, RF-T-04). Sem ele, `where: { orgId:
       * undefined }` vira um filtro que o Prisma ignora e a fila devolve as
       * aprovações de TODAS as empresas — com o conteúdo delas.
       */
      await expect(controlador.fila(sessao('lucia-a', '', VER_E_DECIDIR))).rejects.toThrow(
        SemTenantError,
      );
      await expect(
        controlador.fila(sessao('lucia-a', undefined as unknown as string, VER_E_DECIDIR)),
      ).rejects.toThrow(/tenant não resolvido/);
    });
  });

  // ---------------------------------------------------------------------------
  // O CONTEÚDO EXATO — quem o recebe, e quem não
  // ---------------------------------------------------------------------------

  describe('o conteúdo exato só vai para quem pode decidir', () => {
    it('quem DECIDE lê o corpo que vai sair', async () => {
      const fila = await controlador.fila(sessao('lucia-a', ORG_A, VER_E_DECIDIR));
      const item = fila.itens.find((i) => i.id === ids.a1)!;

      expect(item.conteudo).toEqual({ corpo: 'aviso da A' });
      expect(item.conteudoOculto).toBe(false);
      expect(fila.eu.veConteudo).toBe(true);
    });

    it('quem só VÊ recebe a fila inteira SEM o corpo', async () => {
      const fila = await controlador.fila(sessao('tito-a', ORG_A, VER));
      const item = fila.itens.find((i) => i.id === ids.a1)!;

      // A fila continua inteira: os dois itens, o nível, os gatilhos, o prazo.
      expect(fila.itens).toHaveLength(2);
      expect(item.nivel).toBe('R3');
      expect(item.gatilhos).toContain('exposicao_externa');
      // O que não vem é o texto.
      expect(item.conteudo).toBeNull();
      expect(item.conteudoOculto).toBe(true);
      expect(fila.eu.veConteudo).toBe(false);
      expect(JSON.stringify(fila)).not.toContain('aviso da A');
    });

    it('e nem o token de quem foi PROMOVIDO no meio da sessão abre o conteúdo', async () => {
      /*
       * O banco já diz que a Lúcia decide; o token desta sessão ainda não
       * carrega `aprovacoes.decidir`. A trava da rota lê o TOKEN, então o botão
       * levaria 403 — e o conteúdo segue a mesma régua do botão. As duas fontes
       * precisam concordar.
       */
      const fila = await controlador.fila(sessao('lucia-a', ORG_A, VER));
      const item = fila.itens.find((i) => i.id === ids.a1)!;

      expect(fila.eu.decide, 'o banco diz que ela decide').toBe(true);
      expect(fila.eu.decideNestaSessao, 'mas o token desta sessão, não').toBe(false);
      expect(item.conteudoOculto).toBe(true);
      expect(item.euPossoAprovar).toBe(false);
      expect(item.porQueNao).toMatch(/entre de novo/i);
    });
  });

  // ---------------------------------------------------------------------------
  // O BOTÃO NÃO PODE PROMETER O QUE A EXECUÇÃO RECUSA
  // ---------------------------------------------------------------------------

  describe('o que a execução recusaria hoje vira explicação, não botão', () => {
    it('argumento que não casa mais com o formato aparece como impedimento', async () => {
      const fila = await controlador.fila(sessao('lucia-a', ORG_A, VER_E_DECIDIR));
      const bom = fila.itens.find((i) => i.id === ids.a1)!;
      const torto = fila.itens.find((i) => i.id === ids.a2)!;

      expect(bom.impedimento, 'o item saudável não pode ganhar impedimento').toBeNull();
      expect(bom.euPossoAprovar).toBe(true);

      expect(torto.impedimento).toMatch(/não casam mais com o formato/);
      expect(
        torto.euPossoAprovar,
        '\nA TELA OFERECEU BOTÃO QUE A EXECUÇÃO VAI RECUSAR.\n' +
          '  A recusa acontece DEPOIS de a aprovação virar `confirmada`, que é\n' +
          '  irreversível para a fila: o item vai para a gaveta de onde só se recusa.\n',
      ).toBe(false);
      expect(torto.porQueNao).toMatch(/não casam mais com o formato/);
    });

    it('confirmar pela rota é recusado ANTES de a aprovação mudar de estado', async () => {
      /*
       * A prova de que a conferência vem antes do `confirm`, e não depois: a
       * rota recusa e a linha continua PENDENTE. Com a conferência no lugar
       * antigo (dentro de `executarAprovada`), este roteiro terminava com a
       * aprovação `confirmada` e não consumida — fora da fila e fora do alcance
       * de qualquer botão.
       */
      await expect(
        controlador.confirm(sessao('lucia-a', ORG_A, VER_E_DECIDIR), ids.a2, {}, undefined),
      ).rejects.toThrow(/não casam mais com o formato/);

      const depois = await prisma.approval.findUniqueOrThrow({ where: { id: ids.a2 } });
      expect(
        depois.status,
        '\nA RECUSA CUSTOU O ESTADO DA APROVAÇÃO.\n' +
          '  `confirmada` aqui é a gaveta sem confirmação possível: some da fila de\n' +
          '  pendentes e `confirm` passa a recusá-la.\n',
      ).toBe(ApprovalState.pendente);
      expect(depois.aprovadoPorId).toBeNull();
    });

    it('capacidade SEM EFEITO LIGADO também vira impedimento — a quinta causa', async () => {
      /*
       * A QUINTA ENTRADA PARA A GAVETA SEM SAÍDA, fechada em 11/09/2026.
       *
       * Das cinco coisas que fazem a execução de uma aprovação recusar, quatro
       * já eram antecipadas por esta conferência (conector desligado,
       * capacidade fora do catálogo, régua que reclassificou, argumento fora do
       * formato). A quinta — "o efeito desta capacidade não está ligado nesta
       * versão" — não era, porque a pergunta não fazia parte de
       * `conferirAprovado`: quem a fazia era `AcoesService.executarAprovada`,
       * DEPOIS do `confirm`.
       *
       * O resultado era a gaveta: a aprovação virava `confirmada`, a execução
       * devolvia `sem_efeito`, e `confirmada`-não-consumida some de `listar`,
       * é recusada por `confirm` e não tem botão que a reexecute. Ficava lá até
       * expirar.
       *
       * E ela é a ÚNICA das cinco que não é transitória: as outras se consertam
       * religando o conector, mudando a régua ou repropondo. Efeito que não
       * existe no código não volta sozinho — por isso a saída certa era entrar
       * na conferência, e não afrouxar o desfecho.
       *
       * `usuario.permissao.alterar` é R4, está no catálogo e NÃO está no
       * `EfeitosRegistry` desta suíte (que só inscreve a capacidade do WhatsApp)
       * — a mesma situação da produção hoje.
       */
      const semEfeito = await reter({
        apelido: 'sem-efeito',
        orgId: ORG_A,
        propostoPorId: 'pedro-a',
        corpo: 'promover alguém',
        capacidade: 'usuario.permissao.alterar',
      });

      const fila = await controlador.fila(sessao('lucia-a', ORG_A, VER_E_DECIDIR));
      const item = fila.itens.find((i) => i.id === semEfeito)!;
      expect(item.impedimento).toMatch(/efeito dela não está ligado/);
      expect(
        item.euPossoAprovar,
        '\nA TELA OFERECEU BOTÃO PARA UMA AÇÃO QUE NÃO TEM O QUE EXECUTAR.\n' +
          '  Quem clicasse gastaria o `confirm` — e a aprovação ficaria `confirmada` e\n' +
          '  não consumida, que é a gaveta de onde nenhuma superfície a tira.\n',
      ).toBe(false);

      // E confirmar pela rota recusa SEM mexer no estado: continua pendente.
      await expect(
        controlador.confirm(sessao('lucia-a', ORG_A, VER_E_DECIDIR), semEfeito, {}, undefined),
      ).rejects.toThrow(/efeito dela não está ligado/);

      const depois = await prisma.approval.findUniqueOrThrow({ where: { id: semEfeito } });
      expect(depois.status).toBe(ApprovalState.pendente);
      expect(depois.consumidoEm).toBeNull();

      await prisma.approval.delete({ where: { id: semEfeito } });
    });
  });

  // ---------------------------------------------------------------------------
  // AS GAVETAS E OS TETOS
  // ---------------------------------------------------------------------------

  describe('as gavetas e os tetos dizem a verdade', () => {
    it('pendente com prazo vencido cai em "expirou" sem NINGUÉM escrever no banco', async () => {
      const id = await reter({
        apelido: 'vencida',
        orgId: ORG_A,
        propostoPorId: 'pedro-a',
        corpo: 'proposta de ontem',
        expiraEm: new Date(Date.now() - 60 * 1000),
      });

      const fila = await controlador.fila(sessao('lucia-a', ORG_A, VER_E_DECIDIR));
      const item = fila.itens.find((i) => i.id === id)!;
      expect(item.gaveta).toBe('expirou');
      expect(item.euPossoAprovar).toBe(false);

      // A COLUNA continua `pendente`: uma rota de leitura não decide o destino
      // de uma ação. E `expirarVencidas()`, que mudaria o estado, não tem
      // chamador nenhum no repositório — dívida declarada no relatório.
      const linha = await prisma.approval.findUniqueOrThrow({ where: { id } });
      expect(linha.status).toBe(ApprovalState.pendente);

      await prisma.approval.delete({ where: { id } });
    });

    it('pedido novo aparece mesmo com mais vencidas-pendentes do que o teto (as que valem vêm primeiro)', async () => {
      /*
       * Medido na homologação em 18/10/2026: 141 vivas, 102 mostradas, e o
       * pedido de mover criado agora ficava fora porque a leitura pegava as 100
       * mais antigas, todas pendentes com prazo vencido havia dias.
       */
      const base = {
        orgId: ORG_C,
        propostoPorId: 'caio-c',
        propostoPorTipo: ActorType.ai,
        resourceType: CAP,
        resourceId: 'grupo-vencidas',
        contentHash: 'hash-vencidas',
        resumo: 'pendente esquecida',
        status: ApprovalState.pendente,
        nivelExigido: RiskLevel.R3,
        alcadaMinima: 'operador' as const,
        expiraEm: new Date(Date.now() - 24 * 60 * 60 * 1000),
        criadoEm: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      };
      await prisma.approval.createMany({
        data: Array.from({ length: 101 }, (_, i) => ({ ...base, tokenHash: `token-vencida-${i}-${Math.random()}` })),
      });
      const nova = await reter({
        apelido: 'nova',
        orgId: ORG_C,
        propostoPorId: 'pedro-c',
        corpo: 'pedido de agora',
        expiraEm: new Date(Date.now() + 10 * 60 * 1000),
      });

      const fila = await controlador.fila(sessao('caio-c', ORG_C, VER_E_DECIDIR));
      expect(fila.total).toBe(102);
      expect(fila.truncado).toBe(true);
      const item = fila.itens.find((i) => i.id === nova);
      expect(item, 'o pedido novo ficou fora da fila por causa das vencidas').toBeDefined();
      expect(item!.gaveta).toBe('esperando');
      expect(fila.itens.filter((i) => i.gaveta === 'expirou').length).toBe(fila.tetos.vivas - 1);

      await prisma.approval.deleteMany({ where: { orgId: ORG_C } });
    });

    it('o total reportado é o TOTAL, não o que coube na página', async () => {
      /*
       * O teto de linhas encerradas é 60. Enquanto `total` era `itens.length`,
       * uma empresa com 61 recusas via "60" e acreditava — e item que não
       * aparece é item que ninguém decide.
       */
      const base = {
        orgId: ORG_C,
        propostoPorId: 'caio-c',
        propostoPorTipo: ActorType.ai,
        resourceType: CAP,
        resourceId: 'grupo-teto',
        contentHash: 'hash-teto',
        resumo: 'recusada antiga',
        status: ApprovalState.rejeitada,
        nivelExigido: RiskLevel.R3,
        alcadaMinima: 'operador' as const,
        expiraEm: new Date(Date.now() + 60 * 60 * 1000),
      };
      await prisma.approval.createMany({
        data: Array.from({ length: 61 }, (_, i) => ({
          ...base,
          tokenHash: `token-teto-${i}-${Math.random()}`,
        })),
      });

      const fila = await controlador.fila(sessao('caio-c', ORG_C, VER_E_DECIDIR));
      expect(fila.total).toBe(61);
      expect(fila.mostrando).toBe(fila.tetos.fechadas);
      expect(fila.mostrando).toBeLessThan(fila.total);
      expect(
        fila.truncado,
        '\nA FILA CORTOU LINHAS E NÃO DISSE.\n' +
          '  Teto é legítimo; teto silencioso com total mentiroso, não.\n',
      ).toBe(true);
      expect(fila.censo.truncado).toBe(false);

      await prisma.approval.deleteMany({ where: { orgId: ORG_C } });
    });
  });
});
