import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ActorType, ApprovalState, PrismaClient } from '@prisma/client';
import { NAV } from '@mktos/shared';

import { CaixaService } from '../src/caixa/caixa.service';
import {
  DIAS_DE_CONVERSA,
  DIAS_SEM_MOVIMENTO,
  ESTADO_DO_EIXO,
  FRASE_DO_MOTIVO,
  HORAS_PRESA_COM_AGENTE,
  MOTIVO_DA_PARADA,
  TETO_APROVACOES,
  TETO_CONVERSA,
  TETO_DO_TRECHO,
  TETO_TAREFAS,
  condicoesDeParada,
  condicoesDeResponsavel,
  corteDaConversa,
  cortePresaComAgente,
  corteSemMovimento,
  ehDeOutraPessoa,
  identidadesDe,
  motivosDaParada,
  trechoDoComentario,
} from '../src/caixa/o-que-espera';
import { alcadasAtendidasPor, atendeAlcada } from '../src/approvals/alcada';
import { PREFIXOS_DA_ESPINHA, moduloDoCaminho } from '../src/tenants/modulos';
import { SemTenantError } from '../src/common/contexto-execucao';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { ToolGateway } from '../src/gateway/tool-gateway.service';
import type { ModulosService } from '../src/tenants/modulos.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * ==========================================================================
 * A CAIXA PESSOAL — "o que precisa de mim", fatia A7
 * ==========================================================================
 *
 * O que esta suíte trava, defesa por defesa. Cada caso fica VERMELHO se a peça
 * que ele mede sair:
 *
 *  1. SEM FONTE NOVA, E SEM ESCRITA. O serviço lê `Approval`, `ToolCall`,
 *     `User`, `WorkTask`, `WorkComment` e `Agent` — e não tem um único verbo de
 *     escrita. Um `create`/`update`/`upsert` no arquivo reprova: "o que espera
 *     por mim" materializado numa tabela seria a segunda verdade sobre o mesmo
 *     fato que o ADR-011 evita na memória;
 *  2. PERMISSÃO NÃO É ALÇADA. A consulta pede `alcadaMinima IN (o que a minha
 *     alçada alcança)`, e o conjunto vem de `alcadasAtendidasPor`, DERIVADO de
 *     `atendeAlcada`. Uma lista escrita à mão faria a caixa prometer assinatura
 *     que `confirm` recusa (ou esconder uma que ele aceita);
 *  3. INVARIANTE 7 ESTÁ NO `WHERE`. `propostoPorId <> eu`: quem propõe não
 *     assina, e isso sai do banco, não de um filtro na tela;
 *  4. "ACOMPANHA E NÃO DECIDE" É ESTADO PRÓPRIO, e as duas fontes (o papel do
 *     BANCO e a permissão do TOKEN) precisam concordar — as duas divergem em
 *     direções opostas no meio de uma sessão de oito horas;
 *  5. CONTEÚDO NÃO SAI. Os argumentos gravados entram só na pergunta que a porta
 *     responde; nenhum campo da resposta os carrega. A caixa seria a SEGUNDA
 *     superfície do repositório a devolver o corpo de uma ação retida, e a
 *     primeira o entrega apenas a quem tem `aprovacoes.decidir`;
 *  6. O IMPEDIMENTO DA PORTA SAI DA CONTA. Linha que a porta recusaria hoje não
 *     é "esperando por você": vira número à parte;
 *  7. ESPINHA NÃO É DADO LIVRE. Com o módulo `trabalho` desligado, `WorkTask` e
 *     `WorkComment` NÃO SÃO NEM CONSULTADOS — a rota responde sempre porque é
 *     espinha, e o gate do módulo tem de acontecer aqui dentro;
 *  8. EMPRESA EM TODA CONSULTA. Seis `where`, seis `orgId`. `findMany` sem
 *     `orgId` devolve tudo e não dá erro, e é assim que vaza em silêncio;
 *  9. UMA ARITMÉTICA. O contador da casca é DERIVADO da mesma montagem da tela —
 *     dois caminhos para o mesmo número é o defeito que a A3 pagou nas horas;
 * 10. PREFIXO DECLARADO. `caixa` é espinha; sem a declaração `moduloDoCaminho`
 *     LANÇA em tempo de execução, que foi como `memoria` e `rotinas` nasceram
 *     quebradas inteiras.
 *
 * SEM BANCO, de propósito, pelo mesmo argumento de `linha-do-tempo.test.ts`: o
 * que está sob teste é DECISÃO (que consulta é montada, o que entra na conta, o
 * que é recusado), não persistência — e suíte de trava que se PULA na máquina de
 * quem não tem `TEST_DATABASE_URL` é o pior desfecho possível.
 */

const RAIZ = path.resolve(__dirname, '..');
const FONTE_DO_SERVICO = readFileSync(path.join(RAIZ, 'src/caixa/caixa.service.ts'), 'utf8');
const FONTE_DO_CONTROLLER = readFileSync(path.join(RAIZ, 'src/caixa/caixa.controller.ts'), 'utf8');

/**
 * A fonte do serviço SEM os comentários.
 *
 * Os cabeçalhos desta casa citam o código que NÃO se deve escrever ("`include:
 * { agente: … }` traria o agente de qualquer empresa"), e uma varredura ingênua
 * acusaria a explicação como se fosse a violação. Só o código conta.
 */
const CODIGO_DO_SERVICO = FONTE_DO_SERVICO.split('\n')
  .filter((l) => !/^\s*(\/\/|\/?\*)/.test(l))
  .join('\n');

/* ========================================================================== *
 * Dublês
 * ========================================================================== */

const ORG = 'org-caixa';
const EU = 'u-eu';
const AGORA = new Date('2026-09-14T12:00:00.000Z');

interface Consulta {
  modelo: string;
  where: Record<string, unknown>;
}

interface LinhaDeAprovacao {
  id: string;
  resumo: string;
  nivelExigido: string;
  capabilityId: string | null;
  toolCallId: string | null;
  canal: string | null;
  alcadaMinima: string;
  exigeReauth: boolean;
  propostoPorId: string;
  propostoPorTipo: ActorType;
  criadoEm: Date;
  expiraEm: Date;
}

function aprovacao(over: Partial<LinhaDeAprovacao> = {}): LinhaDeAprovacao {
  return {
    id: 'ap-1',
    resumo: 'mandar o resumo semanal no grupo',
    nivelExigido: 'R3',
    capabilityId: 'whatsapp.mensagem.enviar',
    toolCallId: 'tc-1',
    canal: 'whatsapp',
    alcadaMinima: 'responsavel',
    exigeReauth: false,
    propostoPorId: 'u-outro',
    propostoPorTipo: ActorType.user,
    criadoEm: new Date(AGORA.getTime() - 3_600_000),
    expiraEm: new Date(AGORA.getTime() + 3_600_000),
    ...over,
  };
}

function tarefa(over: Record<string, unknown> = {}) {
  return {
    id: 't-1',
    title: 'Fechar o relatório do cliente',
    priority: 'normal',
    dueDate: new Date(AGORA.getTime() - 86_400_000),
    updatedAt: new Date(AGORA.getTime() - 3_600_000),
    agenteId: null,
    agenteEm: null,
    assignee: 'Pedro Magnago',
    status: { name: 'Em andamento', color: '#fff' },
    list: { name: 'Operação' },
    ...over,
  };
}

function comentario(over: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    text: 'Pedro, isso aqui trava a entrega — consegue olhar?',
    authorId: 'u-outro',
    authorName: 'Lucas',
    createdAt: new Date(AGORA.getTime() - 3_600_000),
    task: { id: 't-1', title: 'Fechar o relatório do cliente' },
    ...over,
  };
}

/** O texto que NÃO pode aparecer na resposta: é conteúdo de ação retida. */
const SEGREDO_DO_ARGUMENTO = 'contrato fecha em 4455-0, nao vaze';

function bancada(opts: {
  /** Quem sou eu, segundo o banco. `null` = não sou usuário ativo daqui. */
  eu?: { name: string; email: string; papeis: string[]; decide: boolean } | null;
  aprovacoes?: LinhaDeAprovacao[];
  tarefas?: Record<string, unknown>[];
  comentarios?: Record<string, unknown>[];
  agentes?: { id: string; slug: string; nome: string; iniciais: string; estado: string }[];
  /** Capacidades que a porta recusaria hoje. */
  impedidas?: string[];
  modulos?: string[];
}) {
  const consultas: Consulta[] = [];
  const eu =
    opts.eu === undefined
      ? { name: 'Pedro Magnago', email: 'pedro@root.com', papeis: ['gestor_marketing'], decide: true }
      : opts.eu;

  const prisma = {
    user: {
      findFirst: (args: { where: Record<string, unknown> }) => {
        consultas.push({ modelo: 'user.findFirst', where: args.where });
        if (!eu) return Promise.resolve(null);
        return Promise.resolve({
          id: EU,
          name: eu.name,
          email: eu.email,
          roles: eu.papeis.map((key) => ({
            key,
            permissions: eu.decide ? [{ key: 'aprovacoes.decidir' }] : [],
          })),
        });
      },
      findMany: (args: { where: Record<string, unknown> }) => {
        consultas.push({ modelo: 'user.findMany', where: args.where });
        return Promise.resolve([{ id: 'u-outro', name: 'Lucas Fernandes' }]);
      },
    },
    approval: {
      findMany: (args: { where: Record<string, unknown> }) => {
        consultas.push({ modelo: 'approval.findMany', where: args.where });
        return Promise.resolve(opts.aprovacoes ?? []);
      },
    },
    toolCall: {
      findMany: (args: { where: Record<string, unknown> }) => {
        consultas.push({ modelo: 'toolCall.findMany', where: args.where });
        return Promise.resolve(
          ((args.where.id as { in: string[] })?.in ?? []).map((id) => ({
            id,
            args: { corpo: SEGREDO_DO_ARGUMENTO },
          })),
        );
      },
    },
    workTask: {
      findMany: (args: { where: Record<string, unknown> }) => {
        consultas.push({ modelo: 'workTask.findMany', where: args.where });
        return Promise.resolve(opts.tarefas ?? []);
      },
    },
    workComment: {
      findMany: (args: { where: Record<string, unknown> }) => {
        consultas.push({ modelo: 'workComment.findMany', where: args.where });
        return Promise.resolve(opts.comentarios ?? []);
      },
    },
    agent: {
      findMany: (args: { where: Record<string, unknown> }) => {
        consultas.push({ modelo: 'agent.findMany', where: args.where });
        return Promise.resolve(opts.agentes ?? []);
      },
    },
  } as unknown as PrismaService;

  const impedidas = new Set(opts.impedidas ?? []);
  const gateway = {
    conferirAprovado: ({ capabilityId }: { capabilityId: string }) => {
      if (impedidas.has(capabilityId)) {
        throw new Error(`campo "corpo": não casa com o argsSchema de ${capabilityId}`);
      }
    },
  } as unknown as ToolGateway;

  const modulos = {
    modulosDaOrg: () => Promise.resolve(new Set(opts.modulos ?? ['trabalho'])),
  } as unknown as ModulosService;

  return { svc: new CaixaService(prisma, gateway, modulos), consultas };
}

/*
 * O RELÓGIO FICA PARADO EM `AGORA`. O serviço mede o tempo com `new Date()` —
 * é ele quem decide o que já venceu e o que já está travado há muito. Com o
 * relógio real, os limiares dos casos ("25h atrás") seriam medidos contra a hora
 * em que a suíte rodou, e o caso de "presa com agente" passaria ou falharia
 * conforme o horário do dia. É o defeito que deixou a suíte de Conexões desta
 * árvore vermelha: fixture com data que envelheceu.
 */
beforeAll(() => {
  vi.setSystemTime(AGORA);
});
afterAll(() => {
  vi.useRealTimers();
});

const SESSAO = {
  orgId: ORG,
  usuarioId: EU,
  permissoes: ['dashboard.ver', 'aprovacoes.ver', 'aprovacoes.decidir', 'tarefas.ver'],
  comConversa: true,
};

/* ========================================================================== *
 * 1. Sem fonte nova, sem escrita
 * ========================================================================== */

describe('A7: a caixa agrega o que existe, e não escreve nada', () => {
  it('o serviço não tem NENHUM caminho de escrita', () => {
    // Uma tabela "o que espera por mim" seria uma segunda verdade sobre um fato
    // que já tem dono. Se alguém a criar, é aqui que a conversa acontece.
    for (const verbo of [
      'create',
      'createMany',
      'update',
      'updateMany',
      'upsert',
      'delete',
      'deleteMany',
      '$executeRaw',
    ]) {
      expect(FONTE_DO_SERVICO.includes(`${verbo}(`), `o serviço passou a chamar ${verbo}`).toBe(
        false,
      );
    }
  });

  it('o serviço não registra evento nem confirma aprovação — quem age é a tela de destino', () => {
    expect(FONTE_DO_SERVICO.includes('.registrar(')).toBe(false);
    expect(FONTE_DO_SERVICO.includes('confirmar(')).toBe(false);
    expect(FONTE_DO_SERVICO.includes('dispararAprovado')).toBe(false);
  });

  it('no módulo caixa, a ÚNICA escrita é a marca pessoal de "limpei" (rodada do painel P1)', () => {
    // A caixa de entrada ganhou uma escrita: `CaixaVisto`, a marca de leitura
    // do próprio usuário. Ela mora num serviço próprio, e nenhum outro arquivo
    // do módulo pode escrever — este serviço aqui continua sem verbo nenhum.
    const pasta = path.join(RAIZ, 'src/caixa');
    const comEscrita = readdirSync(pasta)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => {
        const codigo = readFileSync(path.join(pasta, f), 'utf8')
          .split('\n')
          .filter((l) => !/^\s*(\/\/|\/?\*)/.test(l))
          .join('\n');
        return /this\.prisma\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/.test(codigo);
      });
    expect(comEscrita).toEqual(['caixa-visto.service.ts']);
  });

  it('o controller não tem verbo de escrita', () => {
    for (const verbo of ['@Post(', '@Put(', '@Patch(', '@Delete(']) {
      expect(FONTE_DO_CONTROLLER.includes(verbo), `o controller ganhou um ${verbo}`).toBe(false);
    }
  });

  it('as tabelas lidas são só as seis declaradas', () => {
    const modelos = [...FONTE_DO_SERVICO.matchAll(/this\.prisma\.(\w+)\./g)].map((m) => m[1]);
    expect([...new Set(modelos)].sort()).toEqual([
      'approval',
      'toolCall',
      'user',
      'workComment',
      'workTask',
    ]);
    // `Agent` entra pelo caminho declarado (agentes-da-casa), não por consulta
    // solta — é o único lugar que confere a empresa do agente na leitura.
    expect(FONTE_DO_SERVICO).toContain('agentesDaCasa');
  });
});

/* ========================================================================== *
 * 2. Permissão não é alçada
 * ========================================================================== */

describe('A7: permissão não é alçada, e as duas estão no lugar certo', () => {
  it('o conjunto de alçadas alcançadas é DERIVADO de atendeAlcada', () => {
    // Se alguém escrever a ordem dos degraus à mão em outro arquivo, esta é a
    // asserção que denuncia a divergência.
    for (const tem of ['operador', 'responsavel', 'titular'] as const) {
      const alcancadas = alcadasAtendidasPor(tem);
      for (const minima of ['operador', 'responsavel', 'titular'] as const) {
        expect(alcancadas.includes(minima), `${tem} → ${minima}`).toBe(
          atendeAlcada(minima, tem),
        );
      }
    }
    expect(alcadasAtendidasPor(null)).toEqual([]);
  });

  it('operador não recebe no `WHERE` uma aprovação que pede responsavel', async () => {
    const b = bancada({
      eu: { name: 'Ana', email: 'ana@root.com', papeis: ['analista'], decide: true },
    });
    await b.svc.montar(SESSAO);
    const w = b.consultas.find((c) => c.modelo === 'approval.findMany')!.where;
    expect(w.alcadaMinima).toEqual({ in: ['operador'] });
  });

  it('titular recebe os três degraus', async () => {
    const b = bancada({
      eu: { name: 'Pedro', email: 'p@root.com', papeis: ['admin_master'], decide: true },
    });
    await b.svc.montar(SESSAO);
    const w = b.consultas.find((c) => c.modelo === 'approval.findMany')!.where;
    expect(w.alcadaMinima).toEqual({ in: ['operador', 'responsavel', 'titular'] });
  });

  it('sem alçada nenhuma a caixa não pergunta ao banco — e devolve vazio', async () => {
    // `consulta_limitada` é GENTE sem autoridade (ver `alcada.ts`). Perguntar
    // ao banco por `IN ()` é ida de graça.
    const b = bancada({
      eu: { name: 'Zé', email: 'ze@root.com', papeis: ['consulta_limitada'], decide: true },
    });
    const r = await b.svc.montar(SESSAO);
    expect(b.consultas.some((c) => c.modelo === 'approval.findMany')).toBe(false);
    expect(r.aprovacoes.itens).toEqual([]);
    expect(r.aprovacoes.estado).toBe(ESTADO_DO_EIXO.ok);
    expect(r.eu.alcada).toBe('nenhuma');
  });

  it('conta de máquina não assina: `ia_acao` fica sem alçada', async () => {
    const b = bancada({
      eu: { name: 'IA', email: 'ia@root.com', papeis: ['admin_master', 'ia_acao'], decide: true },
    });
    const r = await b.svc.montar(SESSAO);
    // Basta UM papel de máquina para o ator inteiro deixar de ser gente.
    expect(r.eu.alcada).toBe('nenhuma');
    expect(b.consultas.some((c) => c.modelo === 'approval.findMany')).toBe(false);
  });
});

/* ========================================================================== *
 * 3. Invariante 7 e o prazo, no WHERE
 * ========================================================================== */

describe('A7: quem propõe não assina, e vencida não espera ninguém', () => {
  it('o `WHERE` exclui o proponente e o prazo vencido', async () => {
    const b = bancada({});
    await b.svc.montar(SESSAO);
    const w = b.consultas.find((c) => c.modelo === 'approval.findMany')!.where;
    expect(w.propostoPorId).toEqual({ not: EU });
    expect(w.status).toBe(ApprovalState.pendente);
    expect((w.expiraEm as { gt: Date }).gt).toBeInstanceOf(Date);
  });

  it('a própria proposta não volta como coisa a assinar', async () => {
    // A defesa está no `WHERE`, então o dublê a exercita do lado da leitura: se
    // alguém tirar `propostoPorId` da consulta, a linha abaixo aparece.
    const b = bancada({ aprovacoes: [aprovacao({ propostoPorId: EU })] });
    const r = await b.svc.montar(SESSAO);
    const w = b.consultas.find((c) => c.modelo === 'approval.findMany')!.where;
    expect(w.propostoPorId).toEqual({ not: EU });
    expect(r.aprovacoes.itens.map((i) => i.id)).toEqual(['ap-1']);
    // (O banco de verdade não devolveria esta linha; o que o caso trava é a
    // presença da condição, que é a única coisa que impede o item de entrar.)
  });
});

/* ========================================================================== *
 * 4. "Acompanha e não decide" é estado próprio
 * ========================================================================== */

describe('A7: as duas fontes de "decide" precisam concordar', () => {
  it('token sem `aprovacoes.decidir` (rebaixado no meio da sessão) não vê fila para assinar', async () => {
    const b = bancada({ aprovacoes: [aprovacao()] });
    const r = await b.svc.montar({
      ...SESSAO,
      permissoes: ['dashboard.ver', 'aprovacoes.ver', 'tarefas.ver'],
    });
    expect(r.aprovacoes.estado).toBe(ESTADO_DO_EIXO.naoDecide);
    expect(r.aprovacoes.itens).toEqual([]);
    expect(r.eu.decideNestaSessao).toBe(false);
    // O banco ainda diz que decide — a tela mostra a divergência em vez de
    // oferecer um botão que o `PermissionsGuard` recusaria.
    expect(r.eu.decide).toBe(true);
  });

  it('papel do banco sem `aprovacoes.decidir` (promovido só no token) também não', async () => {
    const b = bancada({
      eu: { name: 'Ana', email: 'a@root.com', papeis: ['analista'], decide: false },
      aprovacoes: [aprovacao()],
    });
    const r = await b.svc.montar(SESSAO);
    expect(r.aprovacoes.estado).toBe(ESTADO_DO_EIXO.naoDecide);
    expect(r.eu.decide).toBe(false);
  });

  it('sem `aprovacoes.ver` o eixo diz "sem permissão" — não morre a tela toda', async () => {
    const b = bancada({ tarefas: [tarefa()] });
    const r = await b.svc.montar({ ...SESSAO, permissoes: ['dashboard.ver', 'tarefas.ver'] });
    expect(r.aprovacoes.estado).toBe(ESTADO_DO_EIXO.semPermissao);
    // E o outro eixo continua respondendo: é a decisão de `/contexto`.
    expect(r.tarefas.itens).toHaveLength(1);
  });

  it('token que não é de usuário ativo desta empresa não recebe eixo nenhum', async () => {
    const b = bancada({ eu: null, aprovacoes: [aprovacao()], tarefas: [tarefa()] });
    const r = await b.svc.montar(SESSAO);
    expect(r.eu.ativo).toBe(false);
    expect(r.aprovacoes.estado).toBe(ESTADO_DO_EIXO.foraDaCasa);
    expect(r.tarefas.estado).toBe(ESTADO_DO_EIXO.foraDaCasa);
    expect(r.conversa.estado).toBe(ESTADO_DO_EIXO.foraDaCasa);
    expect(r.total).toBe(0);
  });
});

/* ========================================================================== *
 * 5. Conteúdo não sai
 * ========================================================================== */

describe('A7: o conteúdo exato da ação retida NÃO sai por aqui', () => {
  it('nenhum campo da resposta carrega os argumentos gravados', async () => {
    const b = bancada({ aprovacoes: [aprovacao()] });
    const r = await b.svc.montar(SESSAO);
    const inteiro = JSON.stringify(r);
    expect(inteiro).not.toContain(SEGREDO_DO_ARGUMENTO);
    expect(inteiro).not.toContain('"args"');
    expect(inteiro).not.toContain('"conteudo"');
    // O resumo SAI — é o mesmo que `/atendimento` entrega a quem tem
    // `aprovacoes.ver`, e é o que permite reconhecer o item.
    expect(r.aprovacoes.itens[0].resumo).toBe('mandar o resumo semanal no grupo');
  });

  it('a tela diz o que o clique vai pedir: motivo escrito em R4/R5 e senha', async () => {
    const b = bancada({
      aprovacoes: [aprovacao({ nivelExigido: 'R4', alcadaMinima: 'titular', exigeReauth: true })],
      eu: { name: 'Pedro', email: 'p@root.com', papeis: ['admin_master'], decide: true },
    });
    const r = await b.svc.montar(SESSAO);
    expect(r.aprovacoes.itens[0].exigeMotivo).toBe(true);
    expect(r.aprovacoes.itens[0].exigeReauth).toBe(true);
  });

  it('proponente que é máquina aparece como "agente", não como identificador cru', async () => {
    const b = bancada({
      aprovacoes: [aprovacao({ propostoPorTipo: ActorType.ai, propostoPorId: 'curador' })],
    });
    const r = await b.svc.montar(SESSAO);
    expect(r.aprovacoes.itens[0].proponente).toBe('agente');
    // E não se procura gente pelo slug de um agente: seria consulta que nunca
    // acha nada.
    expect(b.consultas.some((c) => c.modelo === 'user.findMany')).toBe(false);
  });
});

/* ========================================================================== *
 * 6. O impedimento da porta sai da conta
 * ========================================================================== */

describe('A7: o que a porta recusaria hoje não está esperando por você', () => {
  it('a linha impedida sai da lista, sai do total e vira número à parte', async () => {
    const b = bancada({
      aprovacoes: [
        aprovacao({ id: 'ap-boa' }),
        aprovacao({ id: 'ap-ruim', capabilityId: 'capacidade.que.mudou', toolCallId: 'tc-2' }),
      ],
      impedidas: ['capacidade.que.mudou'],
    });
    const r = await b.svc.montar(SESSAO);
    expect(r.aprovacoes.itens.map((i) => i.id)).toEqual(['ap-boa']);
    expect(r.aprovacoes.retidasPorImpedimento).toBe(1);
    expect(r.total).toBe(1);
  });

  it('a FRASE da porta não vai para a caixa — ela mora em /atendimento', async () => {
    const b = bancada({
      aprovacoes: [aprovacao({ capabilityId: 'capacidade.que.mudou' })],
      impedidas: ['capacidade.que.mudou'],
    });
    const r = await b.svc.montar(SESSAO);
    expect(JSON.stringify(r)).not.toContain('argsSchema');
  });

  it('aprovação da superfície antiga (sem ação retida) não é perguntada à porta', async () => {
    const b = bancada({
      aprovacoes: [aprovacao({ toolCallId: null, capabilityId: null })],
    });
    const r = await b.svc.montar(SESSAO);
    expect(b.consultas.some((c) => c.modelo === 'toolCall.findMany')).toBe(false);
    expect(r.aprovacoes.itens).toHaveLength(1);
  });
});

/* ========================================================================== *
 * 7. Espinha não é dado livre
 * ========================================================================== */

describe('A7: o gate do módulo acontece DENTRO da rota de espinha', () => {
  it('com `trabalho` desligado, WorkTask e WorkComment não são nem consultados', async () => {
    const b = bancada({ modulos: ['leads'], tarefas: [tarefa()], comentarios: [comentario()] });
    const r = await b.svc.montar(SESSAO);
    expect(r.tarefas.estado).toBe(ESTADO_DO_EIXO.moduloDesligado);
    expect(r.conversa.estado).toBe(ESTADO_DO_EIXO.moduloDesligado);
    expect(b.consultas.some((c) => c.modelo === 'workTask.findMany')).toBe(false);
    expect(b.consultas.some((c) => c.modelo === 'workComment.findMany')).toBe(false);
    expect(r.total).toBe(0);
  });

  it('sem `tarefas.ver` também não se toca no quadro', async () => {
    const b = bancada({ tarefas: [tarefa()] });
    const r = await b.svc.montar({
      ...SESSAO,
      permissoes: ['dashboard.ver', 'aprovacoes.ver', 'aprovacoes.decidir'],
    });
    expect(r.tarefas.estado).toBe(ESTADO_DO_EIXO.semPermissao);
    expect(b.consultas.some((c) => c.modelo === 'workTask.findMany')).toBe(false);
  });

  it('`caixa` é prefixo de espinha declarado — sem isso a família inteira lança', () => {
    expect(PREFIXOS_DA_ESPINHA).toContain('caixa');
    expect(() => moduloDoCaminho('/api/caixa')).not.toThrow();
    expect(moduloDoCaminho('/api/caixa')).toBeNull();
    expect(moduloDoCaminho('/api/caixa/contador')).toBeNull();
  });
});

/* ========================================================================== *
 * 8. A empresa, em toda consulta
 * ========================================================================== */

describe('A7: nenhuma consulta sai sem empresa', () => {
  it('todas as consultas levam orgId', async () => {
    const b = bancada({
      aprovacoes: [aprovacao()],
      tarefas: [tarefa({ agenteId: 'ag-1', agenteEm: new Date(AGORA.getTime() - 90_000_000) })],
      comentarios: [comentario()],
      agentes: [{ id: 'ag-1', slug: 'analista', nome: 'Analista', iniciais: 'AN', estado: 'ativo' }],
    });
    await b.svc.montar(SESSAO);
    expect(b.consultas.length).toBeGreaterThanOrEqual(6);
    for (const c of b.consultas) {
      expect(c.where.orgId, `${c.modelo} saiu sem orgId`).toBe(ORG);
    }
  });

  it('token sem empresa é ERRO, nunca "todas as empresas"', async () => {
    const b = bancada({});
    await expect(b.svc.montar({ ...SESSAO, orgId: '' })).rejects.toBeInstanceOf(SemTenantError);
    expect(b.consultas).toEqual([]);
  });

  it('o comentário confere a empresa na tarefa também, e não só nele mesmo', async () => {
    const b = bancada({ comentarios: [comentario()] });
    await b.svc.montar(SESSAO);
    const w = b.consultas.find((c) => c.modelo === 'workComment.findMany')!.where;
    expect((w.task as Record<string, unknown>).orgId).toBe(ORG);
  });
});

/* ========================================================================== *
 * 9. Uma aritmética só
 * ========================================================================== */

describe('A7: o contador da casca e a tela publicam o MESMO número', () => {
  it('o contador é derivado da montagem, e bate item por item', async () => {
    const b = bancada({
      aprovacoes: [aprovacao({ id: 'a1' }), aprovacao({ id: 'a2', toolCallId: 'tc-2' })],
      tarefas: [tarefa({ id: 't-1' }), tarefa({ id: 't-2' })],
      comentarios: [comentario(), comentario({ id: 'c-2' })],
    });
    const tela = await b.svc.montar(SESSAO);
    const selo = await b.svc.contar({
      orgId: SESSAO.orgId,
      usuarioId: SESSAO.usuarioId,
      permissoes: SESSAO.permissoes,
    });
    expect(selo.quantos).toBe(tela.total);
    expect(selo.aprovacoes).toBe(tela.aprovacoes.itens.length);
    expect(selo.tarefas).toBe(tela.tarefas.itens.length);
    expect(selo.parcial).toBe(tela.totalParcial);
  });

  it('a conversa NÃO entra no contador — sem estado de lido ela nunca zeraria', async () => {
    const b = bancada({ comentarios: [comentario(), comentario({ id: 'c-2' })] });
    const tela = await b.svc.montar(SESSAO);
    expect(tela.conversa.itens).toHaveLength(2);
    expect(tela.total).toBe(0);
  });

  it('o contador não paga a consulta da conversa', async () => {
    const b = bancada({ comentarios: [comentario()] });
    await b.svc.contar({
      orgId: SESSAO.orgId,
      usuarioId: SESSAO.usuarioId,
      permissoes: SESSAO.permissoes,
    });
    expect(b.consultas.some((c) => c.modelo === 'workComment.findMany')).toBe(false);
  });

  it('bateu no teto, o total é PISO e diz isso', async () => {
    const muitas = Array.from({ length: TETO_APROVACOES + 1 }, (_, i) =>
      aprovacao({ id: `ap-${i}`, toolCallId: `tc-${i}` }),
    );
    const b = bancada({ aprovacoes: muitas });
    const r = await b.svc.montar(SESSAO);
    expect(r.aprovacoes.itens).toHaveLength(TETO_APROVACOES);
    expect(r.aprovacoes.truncado).toBe(true);
    expect(r.totalParcial).toBe(true);
    // `take` é teto+1 justamente para SABER que há mais — é o que impede o teto
    // silencioso que a fila de aprovação já pagou.
    expect(FONTE_DO_SERVICO).toContain('TETO_APROVACOES + 1');
    expect(FONTE_DO_SERVICO).toContain('TETO_TAREFAS + 1');
    expect(FONTE_DO_SERVICO).toContain('TETO_CONVERSA + 1');
  });
});

/* ========================================================================== *
 * 10. As regras da parada
 * ========================================================================== */

describe('A7: o que é uma tarefa PARADA', () => {
  it('tarefa em movimento, no prazo e livre não está parada', () => {
    expect(
      motivosDaParada(
        { dueDate: new Date(AGORA.getTime() + 86_400_000), updatedAt: AGORA, agenteId: null, agenteEm: null },
        AGORA,
      ),
    ).toEqual([]);
  });

  it('os três motivos, um a um', () => {
    expect(
      motivosDaParada(
        { dueDate: new Date(AGORA.getTime() - 1), updatedAt: AGORA, agenteId: null, agenteEm: null },
        AGORA,
      ),
    ).toEqual([MOTIVO_DA_PARADA.prazoVencido]);

    expect(
      motivosDaParada(
        {
          dueDate: null,
          updatedAt: new Date(corteSemMovimento(AGORA).getTime() - 1),
          agenteId: null,
          agenteEm: null,
        },
        AGORA,
      ),
    ).toEqual([MOTIVO_DA_PARADA.semMovimento]);

    expect(
      motivosDaParada(
        {
          dueDate: null,
          updatedAt: AGORA,
          agenteId: 'ag-1',
          agenteEm: new Date(cortePresaComAgente(AGORA).getTime() - 1),
        },
        AGORA,
      ),
    ).toEqual([MOTIVO_DA_PARADA.presaComAgente]);
  });

  it('agente que acabou de assumir NÃO deixa a tarefa parada — ela está com ele', () => {
    // É o checkout atômico da A4 respeitado: trabalho na mão de um agente não é
    // trabalho esperando por você. Só vira, passado o relógio.
    expect(
      motivosDaParada(
        { dueDate: null, updatedAt: AGORA, agenteId: 'ag-1', agenteEm: AGORA },
        AGORA,
      ),
    ).toEqual([]);
  });

  it('dois problemas aparecem como dois motivos', () => {
    const motivos = motivosDaParada(
      {
        dueDate: new Date(AGORA.getTime() - 1),
        updatedAt: AGORA,
        agenteId: 'ag-1',
        agenteEm: new Date(cortePresaComAgente(AGORA).getTime() - 1),
      },
      AGORA,
    );
    // Mostrar só o primeiro mandaria a pessoa soltar a tarefa e achar que
    // resolveu o prazo.
    expect(motivos).toEqual([MOTIVO_DA_PARADA.prazoVencido, MOTIVO_DA_PARADA.presaComAgente]);
  });

  it('o `WHERE` usa os MESMOS cortes da regra — um número aqui e outro lá daria linha sem motivo', () => {
    const [prazo, movimento, presa] = condicoesDeParada(AGORA);
    expect(prazo).toEqual({ dueDate: { lt: AGORA } });
    expect(movimento).toEqual({ updatedAt: { lt: corteSemMovimento(AGORA) } });
    expect(presa).toEqual({
      AND: [{ agenteId: { not: null } }, { agenteEm: { lt: cortePresaComAgente(AGORA) } }],
    });
  });

  it('o corte vai para o banco, e não para um filtro depois do teto', async () => {
    const b = bancada({ tarefas: [tarefa()] });
    await b.svc.montar(SESSAO);
    const w = b.consultas.find((c) => c.modelo === 'workTask.findMany')!.where;
    const ands = w.AND as { OR: unknown[] }[];
    expect(ands).toHaveLength(2);
    expect(ands[1].OR).toHaveLength(3);
    // Tarefa arquivada e status encerrado não esperam ninguém.
    expect(w.archived).toBe(false);
    expect(w.status).toEqual({ type: { not: 'closed' } });
  });

  it('cada motivo tem frase — a tabela é exaustiva sobre o tipo', () => {
    for (const m of Object.values(MOTIVO_DA_PARADA)) {
      expect(FRASE_DO_MOTIVO[m]?.length ?? 0).toBeGreaterThan(3);
    }
    expect(FRASE_DO_MOTIVO.sem_movimento).toContain(String(DIAS_SEM_MOVIMENTO));
    expect(FRASE_DO_MOTIVO.presa_com_agente).toContain(String(HORAS_PRESA_COM_AGENTE));
  });
});

/* ========================================================================== *
 * 11. "Minhas tarefas" é casamento por NOME, e a tela publica o critério
 * ========================================================================== */

describe('A7: o casamento por nome, declarado', () => {
  it('as identidades são nome, e-mail e a parte antes do @, sem repetição', () => {
    expect(identidadesDe({ name: 'Pedro Magnago', email: 'pedro@root.com' })).toEqual([
      'Pedro Magnago',
      'pedro@root.com',
      'pedro',
    ]);
  });

  it('nome vazio não entra — `equals: ""` casaria com todo responsável em branco', () => {
    expect(identidadesDe({ name: '   ', email: null })).toEqual([]);
    expect(identidadesDe({ name: null, email: null })).toEqual([]);
  });

  it('repetição some sem diferenciar maiúscula', () => {
    expect(identidadesDe({ name: 'pedro', email: 'Pedro@root.com' })).toEqual([
      'pedro',
      'Pedro@root.com',
    ]);
  });

  it('a comparação no banco é sem maiúscula — `in` não aceitaria modo', () => {
    expect(condicoesDeResponsavel(['Pedro'])).toEqual([
      { assignee: { equals: 'Pedro', mode: 'insensitive' } },
    ]);
  });

  it('sem identidade nenhuma o eixo diz isso, e não pergunta ao banco', async () => {
    const b = bancada({
      eu: { name: '', email: '', papeis: ['gestor_marketing'], decide: true },
      tarefas: [tarefa()],
    });
    const r = await b.svc.montar(SESSAO);
    expect(r.tarefas.estado).toBe(ESTADO_DO_EIXO.semIdentidade);
    expect(b.consultas.some((c) => c.modelo === 'workTask.findMany')).toBe(false);
  });

  it('a resposta publica por quais nomes procurou', async () => {
    const b = bancada({ tarefas: [tarefa()] });
    const r = await b.svc.montar(SESSAO);
    expect(r.tarefas.identidades).toEqual(['Pedro Magnago', 'pedro@root.com', 'pedro']);
  });
});

/* ========================================================================== *
 * 12. O agente da tarefa resolve DENTRO da empresa
 * ========================================================================== */

describe('A7: o nome do agente nunca vem de relação do Prisma', () => {
  it('agente desta empresa aparece pelo nome', async () => {
    const b = bancada({
      tarefas: [tarefa({ agenteId: 'ag-1', agenteEm: new Date(AGORA.getTime() - 90_000_000) })],
      agentes: [{ id: 'ag-1', slug: 'analista', nome: 'Analista', iniciais: 'AN', estado: 'ativo' }],
    });
    const r = await b.svc.montar(SESSAO);
    expect(r.tarefas.itens[0].agenteNome).toBe('Analista');
    expect(r.tarefas.itens[0].motivos).toContain(MOTIVO_DA_PARADA.presaComAgente);
    const w = b.consultas.find((c) => c.modelo === 'agent.findMany')!.where;
    expect(w.orgId).toBe(ORG);
  });

  it('ponteiro que não é desta casa devolve nome NULO — a tela diz "outro agente"', async () => {
    const b = bancada({
      tarefas: [tarefa({ agenteId: 'ag-da-vizinha', agenteEm: new Date(AGORA.getTime() - 90_000_000) })],
      agentes: [],
    });
    const r = await b.svc.montar(SESSAO);
    expect(r.tarefas.itens[0].agenteNome).toBeNull();
    expect(r.tarefas.itens[0].agenteSlug).toBeNull();
  });

  it('o serviço não usa `include` em lugar nenhum — só `select`', () => {
    // `include: { agente: … }` devolve o agente do outro lado do ponteiro, de
    // qualquer empresa. A varredura é sobre o CÓDIGO, não sobre os comentários
    // que explicam justamente por que não se escreve isso.
    expect(CODIGO_DO_SERVICO.includes('include:')).toBe(false);
    expect(CODIGO_DO_SERVICO).toContain('select:');
  });
});

/* ========================================================================== *
 * 13. Conversa: o que é, e o que NÃO é
 * ========================================================================== */

describe('A7: conversa no quadro não é menção, e o comentário próprio sai', () => {
  it('comentário meu, por ID, não volta como coisa a ler', async () => {
    const b = bancada({
      comentarios: [comentario({ id: 'meu', authorId: EU }), comentario({ id: 'dele' })],
    });
    const r = await b.svc.montar(SESSAO);
    expect(r.conversa.itens.map((c) => c.id)).toEqual(['dele']);
  });

  it('sem ID, compara pelo nome — e na dúvida o comentário FICA', () => {
    expect(ehDeOutraPessoa({ authorId: null, authorName: 'Pedro Magnago' }, { id: EU, name: 'pedro magnago' })).toBe(false);
    expect(ehDeOutraPessoa({ authorId: null, authorName: 'Lucas' }, { id: EU, name: 'Pedro' })).toBe(true);
    // Sem nome meu não há como comparar: fica. Ruído é melhor que recado perdido.
    expect(ehDeOutraPessoa({ authorId: null, authorName: 'Pedro' }, { id: EU, name: null })).toBe(true);
  });

  it('a janela da conversa é declarada e vai para o `WHERE`', async () => {
    const b = bancada({ comentarios: [comentario()] });
    const r = await b.svc.montar(SESSAO);
    const w = b.consultas.find((c) => c.modelo === 'workComment.findMany')!.where;
    expect((w.createdAt as { gte: Date }).gte.getTime()).toBeGreaterThan(0);
    expect(r.conversa.dias).toBe(DIAS_DE_CONVERSA);
    expect(corteDaConversa(AGORA).getTime()).toBe(
      AGORA.getTime() - DIAS_DE_CONVERSA * 86_400_000,
    );
  });

  it('o trecho é trecho, e diz que foi cortado', () => {
    const curto = trechoDoComentario('  olha   isso  ');
    expect(curto).toEqual({ trecho: 'olha isso', truncado: false });
    const longo = trechoDoComentario('x'.repeat(TETO_DO_TRECHO + 10));
    expect(longo.truncado).toBe(true);
    expect(longo.trecho.endsWith('…')).toBe(true);
    expect(longo.trecho.length).toBe(TETO_DO_TRECHO + 1);
  });

  it('o eixo tem teto próprio, e ele é menor: conversa é contexto, não fila', () => {
    expect(TETO_CONVERSA).toBeLessThan(TETO_TAREFAS);
  });
});

/* ========================================================================== *
 * 14. A permissão da rota é a do menu
 * ========================================================================== */

describe('A7: a rota e o item de menu pedem a MESMA permissão', () => {
  it('a rota pede `dashboard.ver`, a mesma do item Caixa', () => {
    // Item de menu pedindo uma permissão e API respondendo a outra é o 403 que a
    // fila de aprovação já pagou uma vez (fatia 3.10).
    const item = NAV.find((n) => n.key === 'caixa');
    expect(item?.href).toBe('/caixa');
    expect(item?.permission).toBe('dashboard.ver');
    expect(FONTE_DO_CONTROLLER).toContain("@RequirePermissions('dashboard.ver')");
    expect(FONTE_DO_CONTROLLER).toContain("@Controller('caixa')");
    expect(FONTE_DO_CONTROLLER).toContain('JwtAuthGuard');
    expect(FONTE_DO_CONTROLLER).toContain('PermissionsGuard');
  });

  it('`contador` é declarado ANTES de qualquer rota com parâmetro', () => {
    // O Nest casa rota na ordem dos métodos da classe: um `:id` futuro engoliria
    // `contador`, e a barra lateral ficaria sem selo sem nada acusar.
    const iContador = FONTE_DO_CONTROLLER.indexOf("@Get('contador')");
    const iParametro = FONTE_DO_CONTROLLER.search(/@Get\('[^']*:/);
    expect(iContador).toBeGreaterThan(0);
    if (iParametro >= 0) expect(iContador).toBeLessThan(iParametro);
  });
});

/* ========================================================================== *
 * 15. CONTRA O BANCO — as consultas que o dublê não consegue provar
 * ========================================================================== *
 *
 * O dublê prova a DECISÃO (que condição entra no `where`, o que entra na conta).
 * Ele não prova que o Postgres aceita a consulta — e três coisas aqui só falham
 * de verdade contra o banco:
 *
 *   1. `mode: 'insensitive'` dentro de um `OR` de `equals` no campo do
 *      responsável (o `in` do Prisma não aceita modo, e é por isso que não é um
 *      `in`);
 *   2. o filtro por RELAÇÃO `status: { type: { not: 'closed' } }` — status é
 *      outra tabela, e o tipo é enum;
 *   3. `alcadaMinima: { in: [...] }` com o enum `Alcada` do Prisma.
 *
 * Consulta malformada aqui é 500 na tela pessoal de todo mundo, e nenhum caso
 * com dublê acenderia luz. A empresa é semeada à mão (o assunto é a LEITURA) e
 * limpa pelos ids que ela criou.
 */

const URL_DO_BANCO = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL_DO_BANCO ?? '', 'cria e apaga empresa, usuários, tarefas e aprovações');

describe.skipIf(!URL_DO_BANCO)('A7: a caixa contra o Postgres', () => {
  const ORG_DB = 'org-caixa-db';
  const EU_DB = 'u-caixa-eu';
  const OUTRO_DB = 'u-caixa-outro';
  const CAP_DB = 'whatsapp.mensagem.enviar';

  let prisma: PrismaClient;
  let svc: CaixaService;
  let listaId: string;

  beforeAll(async () => {
    /*
     * O relógio parado de cima atrapalharia as datas relativas gravadas aqui:
     * as linhas entram no banco com o `now()` do Postgres (`@default(now())`,
     * `@updatedAt`), e comparar esse tempo com um `new Date()` congelado em
     * setembro faria toda tarefa nascer "sem movimento". O `afterAll` devolve o
     * relógio parado, para um `describe` acrescentado depois não herdar o real.
     */
    vi.useRealTimers();
    prisma = new PrismaClient({ datasources: { db: { url: URL_DO_BANCO } } });
    await prisma.$connect();

    const gateway = { conferirAprovado: () => {} } as unknown as ToolGateway;
    const modulos = {
      modulosDaOrg: () => Promise.resolve(new Set(['trabalho'])),
    } as unknown as ModulosService;
    svc = new CaixaService(prisma as unknown as PrismaService, gateway, modulos);

    await prisma.org.upsert({
      where: { id: ORG_DB },
      create: { id: ORG_DB, name: ORG_DB, slug: ORG_DB, modulos: ['trabalho'] },
      update: { modulos: ['trabalho'] },
    });

    const permissao = await prisma.permission.upsert({
      where: { key: 'aprovacoes.decidir' },
      create: { key: 'aprovacoes.decidir' },
      update: {},
      select: { id: true },
    });
    const papel = await prisma.role.upsert({
      where: { orgId_key: { orgId: ORG_DB, key: 'gestor_marketing' } },
      create: {
        orgId: ORG_DB,
        key: 'gestor_marketing',
        name: 'Gestor',
        permissions: { connect: { id: permissao.id } },
      },
      update: { permissions: { connect: { id: permissao.id } } },
      select: { id: true },
    });

    await prisma.user.upsert({
      where: { id: EU_DB },
      create: {
        id: EU_DB,
        orgId: ORG_DB,
        name: 'Pedro Magnago',
        email: 'pedro-caixa@root.test',
        passwordHash: 'x',
        roles: { connect: { id: papel.id } },
      },
      update: { roles: { connect: { id: papel.id } } },
    });
    await prisma.user.upsert({
      where: { id: OUTRO_DB },
      create: {
        id: OUTRO_DB,
        orgId: ORG_DB,
        name: 'Lucas Fernandes',
        email: 'lucas-caixa@root.test',
        passwordHash: 'x',
      },
      update: {},
    });

    const lista = await prisma.workList.create({
      data: { orgId: ORG_DB, name: 'Lista da caixa' },
      select: { id: true },
    });
    listaId = lista.id;
    const aberto = await prisma.workStatus.create({
      data: { listId: listaId, name: 'A fazer', type: 'open', order: 0 },
      select: { id: true },
    });
    const fechado = await prisma.workStatus.create({
      data: { listId: listaId, name: 'Concluído', type: 'closed', order: 1 },
      select: { id: true },
    });

    const ontem = new Date(Date.now() - 86_400_000);
    const amanha = new Date(Date.now() + 86_400_000);

    // 1. parada, e o responsável está gravado em OUTRA caixa de letras.
    const parada = await prisma.workTask.create({
      data: {
        orgId: ORG_DB,
        listId: listaId,
        statusId: aberto.id,
        title: 'Tarefa parada',
        assignee: 'PEDRO MAGNAGO',
        dueDate: ontem,
      },
      select: { id: true },
    });
    // 2. minha, no prazo e em movimento: NÃO é parada.
    await prisma.workTask.create({
      data: {
        orgId: ORG_DB,
        listId: listaId,
        statusId: aberto.id,
        title: 'Tarefa em andamento',
        assignee: 'Pedro Magnago',
        dueDate: amanha,
      },
    });
    // 3. minha, vencida, mas com status ENCERRADO: não espera ninguém.
    await prisma.workTask.create({
      data: {
        orgId: ORG_DB,
        listId: listaId,
        statusId: fechado.id,
        title: 'Tarefa concluída e vencida',
        assignee: 'Pedro Magnago',
        dueDate: ontem,
      },
    });
    // 4. vencida, de outra pessoa: não é minha.
    await prisma.workTask.create({
      data: {
        orgId: ORG_DB,
        listId: listaId,
        statusId: aberto.id,
        title: 'Tarefa do Lucas',
        assignee: 'Lucas Fernandes',
        dueDate: ontem,
      },
    });

    await prisma.workComment.create({
      data: {
        taskId: parada.id,
        authorId: OUTRO_DB,
        authorName: 'Lucas Fernandes',
        text: 'Pedro, isso trava a entrega',
      },
    });
    await prisma.workComment.create({
      data: {
        taskId: parada.id,
        authorId: EU_DB,
        authorName: 'Pedro Magnago',
        text: 'meu próprio comentário, não é recado para mim',
      },
    });

    const chamada = await prisma.toolCall.create({
      data: {
        orgId: ORG_DB,
        capabilityId: CAP_DB,
        agentSlug: 'curador',
        actorType: ActorType.ai,
        actorId: 'curador',
        status: 'aguardando_aprovacao',
        args: { corpo: 'texto que NÃO pode sair pela caixa' },
        nivel: 'R3',
      },
      select: { id: true },
    });
    // Do OUTRO usuário, alçada `responsavel`: eu assino.
    await prisma.approval.create({
      data: {
        orgId: ORG_DB,
        toolCallId: chamada.id,
        capabilityId: CAP_DB,
        propostoPorId: OUTRO_DB,
        propostoPorTipo: ActorType.user,
        resourceType: CAP_DB,
        resourceId: 'grupo-x',
        contentHash: 'hash-caixa-db-0123456789',
        resumo: 'mandar o resumo no grupo',
        status: ApprovalState.pendente,
        nivelExigido: 'R3',
        alcadaMinima: 'responsavel',
        tokenHash: 'token-hash-caixa-db-1',
        expiraEm: new Date(Date.now() + 3_600_000),
      },
    });
    // Proposta por MIM: invariante 7 tira da minha caixa.
    await prisma.approval.create({
      data: {
        orgId: ORG_DB,
        capabilityId: CAP_DB,
        propostoPorId: EU_DB,
        propostoPorTipo: ActorType.user,
        resourceType: CAP_DB,
        resourceId: 'grupo-y',
        contentHash: 'hash-caixa-db-9876543210',
        resumo: 'a que eu mesmo propus',
        status: ApprovalState.pendente,
        nivelExigido: 'R3',
        alcadaMinima: 'responsavel',
        tokenHash: 'token-hash-caixa-db-2',
        expiraEm: new Date(Date.now() + 3_600_000),
      },
    });
    // Pendente e VENCIDA: não espera ninguém.
    await prisma.approval.create({
      data: {
        orgId: ORG_DB,
        capabilityId: CAP_DB,
        propostoPorId: OUTRO_DB,
        propostoPorTipo: ActorType.user,
        resourceType: CAP_DB,
        resourceId: 'grupo-z',
        contentHash: 'hash-caixa-db-vencida',
        resumo: 'a que venceu',
        status: ApprovalState.pendente,
        nivelExigido: 'R3',
        alcadaMinima: 'responsavel',
        tokenHash: 'token-hash-caixa-db-3',
        expiraEm: new Date(Date.now() - 1_000),
      },
    });
    // Alçada acima da minha (`titular`): não é minha para assinar.
    await prisma.approval.create({
      data: {
        orgId: ORG_DB,
        capabilityId: CAP_DB,
        propostoPorId: OUTRO_DB,
        propostoPorTipo: ActorType.user,
        resourceType: CAP_DB,
        resourceId: 'grupo-w',
        contentHash: 'hash-caixa-db-titular',
        resumo: 'a que pede titular',
        status: ApprovalState.pendente,
        nivelExigido: 'R4',
        alcadaMinima: 'titular',
        tokenHash: 'token-hash-caixa-db-4',
        expiraEm: new Date(Date.now() + 3_600_000),
      },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.workComment.deleteMany({ where: { orgId: ORG_DB } });
    await prisma.workTask.deleteMany({ where: { orgId: ORG_DB } });
    await prisma.workStatus.deleteMany({ where: { listId: listaId } });
    await prisma.workList.deleteMany({ where: { orgId: ORG_DB } });
    await prisma.approval.deleteMany({ where: { orgId: ORG_DB } });
    await prisma.toolCall.deleteMany({ where: { orgId: ORG_DB } });
    await prisma.user.deleteMany({ where: { orgId: ORG_DB } });
    await prisma.role.deleteMany({ where: { orgId: ORG_DB } });
    await prisma.org.deleteMany({ where: { id: ORG_DB } });
    await prisma.$disconnect();
    vi.setSystemTime(AGORA);
  });

  const pedido = {
    orgId: ORG_DB,
    usuarioId: EU_DB,
    permissoes: ['dashboard.ver', 'aprovacoes.ver', 'aprovacoes.decidir', 'tarefas.ver'],
    comConversa: true,
  };

  it('a consulta de aprovação roda, e traz SÓ a que eu assino', async () => {
    const r = await svc.montar(pedido);
    expect(r.aprovacoes.estado).toBe(ESTADO_DO_EIXO.ok);
    expect(r.aprovacoes.itens.map((i) => i.resumo)).toEqual(['mandar o resumo no grupo']);
    // A minha proposta, a vencida e a de alçada acima ficaram de fora — e as
    // três saíram no `WHERE`, não num filtro de tela.
    expect(r.aprovacoes.itens[0].proponente).toBe('Lucas Fernandes');
  });

  it('o conteúdo gravado no ToolCall não atravessa a resposta', async () => {
    const r = await svc.montar(pedido);
    expect(JSON.stringify(r)).not.toContain('texto que NÃO pode sair');
  });

  it('o responsável casa sem diferenciar maiúscula, e o encerrado não entra', async () => {
    const r = await svc.montar(pedido);
    expect(r.tarefas.estado).toBe(ESTADO_DO_EIXO.ok);
    // "PEDRO MAGNAGO" casou com "Pedro Magnago" — é o `mode: 'insensitive'`
    // dentro do OR, que um `in` não conseguiria expressar.
    expect(r.tarefas.itens.map((t) => t.titulo)).toEqual(['Tarefa parada']);
    expect(r.tarefas.itens[0].motivos).toContain(MOTIVO_DA_PARADA.prazoVencido);
  });

  it('a conversa traz o recado do outro e descarta o meu', async () => {
    const r = await svc.montar(pedido);
    expect(r.conversa.itens.map((c) => c.autor)).toEqual(['Lucas Fernandes']);
    expect(r.conversa.itens[0].trecho).toContain('trava a entrega');
  });

  it('o contador bate com a tela, medido no banco de verdade', async () => {
    const tela = await svc.montar(pedido);
    const selo = await svc.contar({
      orgId: pedido.orgId,
      usuarioId: pedido.usuarioId,
      permissoes: pedido.permissoes,
    });
    expect(tela.total).toBe(2);
    expect(selo.quantos).toBe(tela.total);
  });
});
