import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import { ApprovalsService } from '../src/approvals/approvals.service';
import { AuditService } from '../src/audit/audit.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { PortaDoOperador, type AcaoRetida } from '../src/gateway/porta-do-operador.service';
import { InterruptoresRegistry } from '../src/gateway/interruptores.registry';
import { ConectoresService } from '../src/integrations/conectores.service';
import { CONECTOR_DA_CAPACIDADE } from '../src/integrations/conectores';
import { comContexto } from '../src/common/contexto-execucao';
import { exigirBancoDescartavel } from './banco-de-teste';
import type { PrismaService } from '../src/prisma/prisma.service';

/*
 * ============================================================================
 * ETAPA A7 DO PLANO DE PRODUTO — AS ESCRITAS INTERNAS SENSÍVEIS PASSAM PELA PORTA
 * ============================================================================
 *
 * A fatia 3.3 fechou o caminho de quem clica na tela para as quatro escritas
 * do GOOGLE. Ficaram para trás as escritas INTERNAS — e entre elas as duas mais
 * sensíveis do catálogo inteiro:
 *
 *   · `DELETE /finance/transactions/:id` — `financeiro.lancamento.excluir`,
 *     R5, o degrau que a escada diz que o OS NUNCA executa. Vivia atrás de
 *     `financeiro.editar` e mais nada;
 *   · `PATCH /users/:id` — `usuario.permissao.alterar`, R4: alçada de titular,
 *     motivo escrito e reautenticação. Vivia atrás de `admin.usuarios`.
 *
 * E `POST /finance/transactions` (`financeiro.lancamento.criar`, R3), no mesmo
 * arquivo e com o mesmo furo.
 *
 * A varredura de 16/09/2026 chamou isto de "o achado mais duro" e o plano de
 * produto o tirou da fila: é o que uma auditoria de cliente encontra primeiro,
 * e segurança é a objeção nº 1 de venda.
 *
 * DOIS BLOCOS, como a suíte da fatia 3.3: sem banco (catálogo e fonte, roda
 * sempre) e com banco (a porta de verdade, com efeitos falsos que anotam se
 * foram chamados — a AUSÊNCIA da anotação é a prova).
 */

interface EscritaInterna {
  capacidade: string;
  rota: string;
  nivel: 'R3' | 'R4' | 'R5';
  controlador: string;
  /** O método do serviço que a rota chamava direto, e não pode mais chamar. */
  chamadaDireta: RegExp;
  args: Record<string, unknown>;
  argsInvalidos: Record<string, unknown>;
}

const ESCRITAS: EscritaInterna[] = [
  {
    capacidade: 'financeiro.lancamento.criar',
    rota: 'POST /finance/transactions',
    nivel: 'R3',
    controlador: 'src/finance/finance.controller.ts',
    chamadaDireta: /this\.svc\.createTransaction\(/,
    args: { accountId: 'conta-1', type: 'saida', description: 'Fornecedor', amount: 120.5, date: '2026-09-01' },
    argsInvalidos: { accountId: 'conta-1', type: 'saida', description: 'Fornecedor', amount: 120.5 }, // sem data
  },
  {
    capacidade: 'financeiro.lancamento.excluir',
    rota: 'DELETE /finance/transactions/:id',
    nivel: 'R5',
    controlador: 'src/finance/finance.controller.ts',
    chamadaDireta: /this\.svc\.deleteTransaction\(/,
    args: { id: 'tx-1' },
    argsInvalidos: {},
  },
  {
    capacidade: 'usuario.permissao.alterar',
    rota: 'PATCH /users/:id',
    nivel: 'R4',
    controlador: 'src/users/users.controller.ts',
    chamadaDireta: /this\.svc\.update\(/,
    args: { id: 'pessoa-1', roles: ['gestor_marketing'] },
    argsInvalidos: { roles: ['gestor_marketing'] }, // sem dizer quem
  },
];

// ---------------------------------------------------------------------------
// Bloco 1 — sem banco
// ---------------------------------------------------------------------------

function acharRaizDaApi(): string {
  const marco = path.join('src', 'gateway', 'tool-gateway.service.ts');
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, marco))) return dir;
    if (existsSync(path.join(dir, 'apps', 'api', marco))) return path.join(dir, 'apps', 'api');
    const pai = path.dirname(dir);
    if (pai === dir) break;
    dir = pai;
  }
  throw new Error(`Não encontrei apps/api a partir de "${process.cwd()}".`);
}

const RAIZ = acharRaizDaApi();
const ler = (rel: string): string => readFileSync(path.join(RAIZ, rel), 'utf8');

interface CapacidadeDoCatalogo {
  id: string;
  nivel?: string;
  rota?: string;
  argsSchema?: { additionalProperties?: boolean; required?: string[] };
  efeito?: { sensibilidade?: string; destruicao?: boolean };
}

const CATALOGO: CapacidadeDoCatalogo[] = (() => {
  const arquivo = path.join(path.resolve(RAIZ, '..', '..'), 'packages', 'policy', 'politica-marketing-os.json');
  return (JSON.parse(readFileSync(arquivo, 'utf8')) as { capacidades: CapacidadeDoCatalogo[] }).capacidades;
})();

describe('A7: o catálogo declara cada escrita interna que passou pela porta', () => {
  it.each(ESCRITAS)('$capacidade é $nivel, tem rota e não tem conector', ({ capacidade, rota, nivel }) => {
    const cap = CATALOGO.find((c) => c.id === capacidade);
    expect(cap, `"${capacidade}" sumiu de politica-marketing-os.json`).toBeDefined();
    // Rebaixar qualquer uma devolve a rota ao estado de antes: sai sozinha.
    expect(cap!.nivel, `"${capacidade}" mudou de nível`).toBe(nivel);
    expect(cap!.rota).toBe(rota);
    // Administração interna: nenhum conector, e a entrada precisa existir para o
    // mapa continuar completo (é `null`, não ausência).
    expect(capacidade in CONECTOR_DA_CAPACIDADE, `"${capacidade}" fora de CONECTOR_DA_CAPACIDADE`).toBe(true);
    expect(CONECTOR_DA_CAPACIDADE[capacidade]).toBeNull();
  });

  it.each(ESCRITAS)('$capacidade tem argsSchema fechado', ({ capacidade, args }) => {
    const cap = CATALOGO.find((c) => c.id === capacidade)!;
    expect(
      cap.argsSchema,
      `"${capacidade}" sem argsSchema: a porta não valida nada e a aprovação assina um corpo livre`,
    ).toBeDefined();
    expect(cap.argsSchema!.additionalProperties).toBe(false);
    expect(cap.argsSchema!.required?.length, `"${capacidade}" sem campo obrigatório nenhum`).toBeGreaterThan(0);
    for (const obrigatorio of cap.argsSchema!.required ?? []) {
      expect(Object.keys(args), `o caso de teste não manda "${obrigatorio}"`).toContain(obrigatorio);
    }
  });

  it('apagar lançamento continua R5 com destruição declarada — o OS prepara, não executa', () => {
    const cap = CATALOGO.find((c) => c.id === 'financeiro.lancamento.excluir')!;
    expect(cap.efeito?.destruicao).toBe(true);
    expect(cap.nivel).toBe('R5');
  });

  it('mudar permissão é restrita — o RASTRO redige os argumentos (a senha nunca vai em claro)', () => {
    expect(CATALOGO.find((c) => c.id === 'usuario.permissao.alterar')!.efeito?.sensibilidade).toBe('restrita');
  });
});

describe('A7: o caminho HTTP não chama mais o serviço direto', () => {
  it.each(ESCRITAS)('a rota de $capacidade entrega à porta', ({ capacidade, controlador, chamadaDireta }) => {
    const fonte = ler(controlador);
    expect(fonte, `${controlador} não conhece a PortaDoOperador`).toContain('PortaDoOperador');
    expect(fonte, `${controlador} não menciona "${capacidade}": a rota voltou a chamar o serviço?`).toContain(
      `'${capacidade}'`,
    );
    /*
     * A chamada direta ao serviço tem de ter SUMIDO do controlador para esta
     * capacidade. `PATCH transactions/:id` continua direto de propósito (não
     * tem capacidade no catálogo) — por isso o padrão é o método específico, e
     * não "this.svc." em geral.
     */
    expect(fonte, `${controlador} ainda chama o serviço direto para ${capacidade}`).not.toMatch(chamadaDireta);
  });

  it('cada efeito novo é inscrito pelo DONO do dado, e não pelo controlador', () => {
    expect(ler('src/finance/finance.service.ts')).toMatch(/['"]financeiro\.lancamento\.criar['"]\s*:/);
    expect(ler('src/finance/finance.service.ts')).toMatch(/['"]financeiro\.lancamento\.excluir['"]\s*:/);
    expect(ler('src/users/users.service.ts')).toMatch(/['"]usuario\.permissao\.alterar['"]\s*:/);
    // E o controlador não inscreve nada: efeito no controlador seria um segundo
    // caminho de execução que a aprovação não alcança.
    expect(ler('src/finance/finance.controller.ts')).not.toMatch(/\.registrar\(/);
    expect(ler('src/users/users.controller.ts')).not.toMatch(/\.registrar\(/);
  });

  it('a tela do financeiro trata a RETENÇÃO — não existe sucesso falso ao criar lançamento', () => {
    const tela = readFileSync(
      path.join(path.resolve(RAIZ, '..', '..'), 'apps', 'web', 'src', 'app', 'financeiro', 'page.tsx'),
      'utf8',
    );
    expect(tela, 'a tela não reconhece a resposta de retenção da porta').toContain('aguardando_aprovacao');
    expect(tela, 'o tratador de criar lançamento não desvia antes do "✅"').toMatch(/foiRetida\(r\)/);
  });

  it('a tela de pessoas trata a RETENÇÃO ao mudar papel ou senha', () => {
    const tela = readFileSync(
      path.join(path.resolve(RAIZ, '..', '..'), 'apps', 'web', 'src', 'app', 'regua', 'AbaPessoas.tsx'),
      'utf8',
    );
    expect(tela, 'a aba de pessoas não reconhece a resposta de retenção da porta').toContain('aguardando_aprovacao');
  });
});

// ---------------------------------------------------------------------------
// Bloco 2 — com banco: a porta de verdade
// ---------------------------------------------------------------------------

const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'escreve propostas, aprovações e RASTRO');

const ORG = 'org-escritas-internas';
const PEDRO = { id: 'pedro-internas' };

describe.skipIf(!URL)('A7: criar é retido, apagar é recusado com preparo, permissão é retida', () => {
  let prisma: PrismaClient;
  let porta: PortaDoOperador;
  let chamadas: Array<{ capacidade: string; args: Record<string, unknown> }>;

  const naEmpresa = <T>(fn: () => Promise<T>): Promise<T> =>
    comContexto({ orgId: ORG, correlationId: 'clique-interno-1', origem: 'http' }, fn);

  const pedir = (e: EscritaInterna, args?: Record<string, unknown>) =>
    naEmpresa(() =>
      porta.executar({
        orgId: ORG,
        actorId: PEDRO.id,
        capabilityId: e.capacidade,
        args: args ?? e.args,
        resource: { type: e.capacidade, id: 'alvo-1' },
      }),
    );

  beforeAll(async () => {
    // Relógio preso às 14:00: fora da janela o sinal sobe todo nível um degrau.
    vi.setSystemTime(new Date('2026-09-01T14:00:00-03:00'));
    process.env.GATEWAY_MODO = 'impor';

    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    await prisma.org.upsert({
      where: { id: ORG },
      create: { id: ORG, name: 'Escritas internas pela porta', slug: 'escritas-internas' },
      update: {},
    });
    const papel = await prisma.role.upsert({
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
        email: 'pedro@internas.teste',
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
    const approvals = new ApprovalsService(p, audit);
    const eventos = new EventLogService(p);

    chamadas = [];
    const registro = new EfeitosRegistry();
    const falso = (capacidade: string) => async (args: Record<string, unknown>) => {
      chamadas.push({ capacidade, args });
      return { ok: true, capacidade };
    };
    registro.registrar(Object.fromEntries(ESCRITAS.map((e) => [e.capacidade, falso(e.capacidade)])));

    const interruptores = new InterruptoresRegistry();
    const conectores = new ConectoresService(p, audit, eventos, interruptores);
    conectores.onModuleInit();

    const gateway = new ToolGateway(
      p,
      policy,
      new SinaisService(p, policy),
      approvals,
      eventos,
      undefined,
      interruptores,
      registro,
    );
    porta = new PortaDoOperador(gateway, registro);
  });

  afterAll(async () => {
    vi.useRealTimers();
    // A faxina do RASTRO numa transação só — ver o mesmo bloco em
    // `escritas-pela-porta.test.ts` para o porquê (append-only por RULE).
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
      prisma.$executeRawUnsafe('DELETE FROM "EventLog" WHERE "orgId" = $1', ORG),
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
    ]);
    await prisma.approval.deleteMany({ where: { orgId: ORG } });
    await prisma.toolCall.deleteMany({ where: { orgId: ORG } });
    await prisma.policyDecision.deleteMany({ where: { orgId: ORG } });
    await prisma.auditLog.deleteMany({ where: { orgId: ORG } });
    await prisma.user.deleteMany({ where: { orgId: ORG } });
    await prisma.role.deleteMany({ where: { orgId: ORG } });
    await prisma.org.deleteMany({ where: { id: ORG } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    chamadas = [];
    // Zera o histórico de chamadas da empresa entre casos: o sinal de volume
    // atípico subiria R3 para R4 a partir do segundo caso.
    await prisma.toolCall.deleteMany({ where: { orgId: ORG } });
  });

  it('criar lançamento (R3) é RETIDO: nada é gravado antes de alguém confirmar', async () => {
    const e = ESCRITAS.find((x) => x.capacidade === 'financeiro.lancamento.criar')!;
    const r = (await pedir(e)) as AcaoRetida;
    expect(r.status).toBe('aguardando_aprovacao');
    expect(r.nivel).toBe('R3');
    expect(r.precisaDeOutraPessoa).toBe(true);
    expect(chamadas, 'o efeito rodou antes da confirmação').toEqual([]);
  });

  it('apagar lançamento (R5) é RECUSADO com o preparo — o efeito nunca roda', async () => {
    const e = ESCRITAS.find((x) => x.capacidade === 'financeiro.lancamento.excluir')!;
    await expect(pedir(e)).rejects.toMatchObject({
      response: expect.objectContaining({
        error: 'recusado_pela_politica',
        preparo: expect.objectContaining({
          capacidade: 'financeiro.lancamento.excluir',
          argumentos: expect.objectContaining({ id: 'tx-1' }),
        }),
      }),
    });
    expect(chamadas, 'R5 chamou o efeito: o OS apagou o que devia só preparar').toEqual([]);
  });

  it('mudar permissão (R4) é RETIDO e exige outra pessoa', async () => {
    const e = ESCRITAS.find((x) => x.capacidade === 'usuario.permissao.alterar')!;
    const r = (await pedir(e)) as AcaoRetida;
    expect(r.status).toBe('aguardando_aprovacao');
    expect(r.nivel).toBe('R4');
    expect(chamadas).toEqual([]);
  });

  it.each(ESCRITAS.filter((e) => e.nivel !== 'R5'))(
    '$capacidade com argumento inválido é recusada ANTES de queimar uma aprovação',
    async (e) => {
      // Conta ANTES e DEPOIS: os casos de retenção acima deixam aprovações
      // pendentes de propósito, e o que se mede aqui é que este pedido não
      // acrescentou nenhuma — não que a fila esteja vazia.
      const antes = await prisma.approval.count({ where: { orgId: ORG } });
      await expect(pedir(e, e.argsInvalidos)).rejects.toThrow();
      const depois = await prisma.approval.count({ where: { orgId: ORG } });
      expect(depois - antes, 'argumento inválido criou aprovação').toBe(0);
      expect(chamadas).toEqual([]);
    },
  );
});
