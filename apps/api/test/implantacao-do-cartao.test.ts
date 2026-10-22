import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  FASES_DA_ETAPA,
  MODELOS_DE_LISTA,
  TrabLimiteDaEtapaSchema,
  chaveDaEtapa,
  faseDoCartao,
  fasesDaEtapa,
  pedidoDoAgente,
} from '@mktos/shared';

import { AuditService } from '../src/audit/audit.service';
import type { PortaDoOperador } from '../src/gateway/porta-do-operador.service';
import { AgendaDaImplantacaoService, VALIDADE_DA_LEITURA_MS } from '../src/implantacao/agenda-da-implantacao.service';
import { ImplantacaoDoQuadroService } from '../src/implantacao/implantacao-do-quadro.service';
import { ACAO_DO_LIMITE, LimiteDaEtapaService } from '../src/implantacao/limite-da-etapa.service';
import { casarReunioes, type CartaoParaCasar, type EventoDaAgenda } from '../src/implantacao/proxima-reuniao';
import type { PrismaService } from '../src/prisma/prisma.service';
import { criarEstruturaSugerida } from '../src/work/estrutura-sugerida';
import { RECUSA_DE_MAQUINA_NO_TRABALHO, SoGenteNoTrabalhoGuard } from '../src/work/so-gente-no-trabalho.guard';
import { EventLogService } from '../src/gateway/event-log.service';
import { CheckoutDeTarefaService } from '../src/work/checkout-de-tarefa.service';
import { WorkService } from '../src/work/work.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * O CARTÃO DA IMPLANTAÇÃO (rodada de produção 2, M1, 22/10/2026).
 *
 *  1. o mapa etapa → fase cobre TODAS as etapas do modelo `onboarding-de-cliente`;
 *  2. a regra que casa evento com card: e-mail, nome pela regra de título, e a
 *     dúvida (dois cards, nome parcial, e-mail e título apontando para cards
 *     diferentes) que não casa;
 *  3. "Pedir agora": o atalho de cada agente e o botão desabilitado com a razão;
 *  4. a agenda é lida UMA vez por empresa em 5 minutos, para N cards; falhar
 *     deixa o quadro de pé com "indisponível";
 *  5. contra o Postgres: o quadro com reunião e selo, o resumo do Dia a dia e o
 *     limite da etapa (só gente, auditado, condicionado à versão lida).
 */

const URL = process.env.TEST_DATABASE_URL;
const ORG = 'org-teste-implantacao-cartao';
const VIZINHA = 'org-teste-implantacao-cartao-vizinha';
const EU = 'u-implantacao-cartao';
const MAQUINA = 'u-implantacao-cartao-maquina';
const INATIVO = 'u-implantacao-cartao-inativo';

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (pastas, listas, tarefas, trilhos, fichas e auditoria)');

const AGORA = new Date('2026-10-22T13:00:00Z'); // 10:00 em São Paulo
const emHoras = (h: number) => new Date(AGORA.getTime() + h * 3_600_000).toISOString();

describe('o mapa etapa → fase do trilho (sem banco)', () => {
  it('toda etapa do modelo "Onboarding de cliente" está no mapa, a de saída sem fase', () => {
    const etapas = MODELOS_DE_LISTA['onboarding-de-cliente'].etapas;
    for (const e of etapas) expect(Object.prototype.hasOwnProperty.call(FASES_DA_ETAPA, chaveDaEtapa(e.name)), e.name).toBe(true);
    expect(Object.keys(FASES_DA_ETAPA)).toHaveLength(etapas.length);
    const saida = etapas.find((e) => e.type === 'closed')!;
    expect(fasesDaEtapa(saida.name)).toBeNull();
    expect(fasesDaEtapa('Kickoff marcado')).toEqual(['contrato']);
    expect(fasesDaEtapa('IMERSAO')).toEqual(['imersao']);
    expect(fasesDaEtapa('Operação assistida')).toEqual(['operacao']);
    expect(fasesDaEtapa('Fechado no comercial')).toEqual(['qualificar', 'diagnostico']);
    expect(fasesDaEtapa('A fazer')).toBeUndefined();
  });

  it('diverge com o selo e a frase; bate sem selo; saída e etapa desconhecida não dizem nada', () => {
    expect(faseDoCartao({ etapa: 'Imersão', faseDoTrilho: 'contrato' })).toEqual({
      fase: 'contrato', numero: 3, diverge: true, selo: 'fase do trilho: 3 de 5',
      frase: 'o card está em Imersão e o trilho ainda na fase 3 de 5 (Contrato e onboarding)',
    });
    expect(faseDoCartao({ etapa: 'Kickoff marcado', faseDoTrilho: 'operacao' })?.frase).toBe('o card está em Kickoff marcado e o trilho já na fase 5 de 5 (Operação assistida)');
    expect(faseDoCartao({ etapa: 'Kit montado', faseDoTrilho: 'contrato' })).toMatchObject({ diverge: false, selo: null, frase: null, numero: 3 });
    expect(faseDoCartao({ etapa: 'Fechado no comercial', faseDoTrilho: 'qualificar' })?.diverge).toBe(false);
    expect(faseDoCartao({ etapa: 'Fechado no comercial', faseDoTrilho: 'diagnostico' })?.diverge).toBe(false);
    expect(faseDoCartao({ etapa: 'Encerrado', faseDoTrilho: 'contrato' })).toBeNull();
    expect(faseDoCartao({ etapa: 'A fazer', faseDoTrilho: 'contrato' })).toBeNull();
    expect(faseDoCartao({ etapa: 'Imersão', faseDoTrilho: null })).toBeNull();
    expect(faseDoCartao({ etapa: 'Imersão', faseDoTrilho: 'encerrado' })).toMatchObject({ diverge: true, selo: 'trilho encerrado' });
    // Todas as combinações do modelo: diverge exatamente quando a fase não é uma das aceitas.
    for (const e of MODELOS_DE_LISTA['onboarding-de-cliente'].etapas) {
      const aceitas = fasesDaEtapa(e.name);
      for (const f of ['qualificar', 'diagnostico', 'contrato', 'imersao', 'operacao'] as const) {
        const r = faseDoCartao({ etapa: e.name, faseDoTrilho: f });
        if (!aceitas) expect(r).toBeNull();
        else expect(r?.diverge, `${e.name} × ${f}`).toBe(!aceitas.includes(f));
      }
    }
  });
});

describe('a regra que casa evento com card (sem banco)', () => {
  const cards: CartaoParaCasar[] = [
    { cardId: 'lume', emails: ['marina@studiolume.com.br', null], nomes: ['Studio Lume'] },
    { cardId: 'alicerce', emails: [], nomes: ['Construtora Alicerce', 'Alicerce'] },
    { cardId: 'gemeo-1', emails: [], nomes: ['Padaria Sol'] },
    { cardId: 'gemeo-2', emails: [], nomes: ['Padaria Sol'] },
  ];
  const ev = (e: Partial<EventoDaAgenda> & { id: string }): EventoDaAgenda => ({ title: null, start: emHoras(24), end: emHoras(25), attendees: [], ...e });

  it('casa pelo e-mail do contato entre os participantes, sem olhar o título', () => {
    const r = casarReunioes([ev({ id: 'e1', title: 'Conversa de alinhamento', attendees: ['operacao.root@gmail.com', 'MARINA@studiolume.com.br'] })], cards, AGORA);
    expect(r.get('lume')).toEqual({ inicio: emHoras(24), diaInteiro: false, titulo: 'Conversa de alinhamento', casadoPor: 'email' });
  });

  it('sem e-mail, casa pelo nome do cliente no título da Root', () => {
    const r = casarReunioes([ev({ id: 'e2', title: 'Reunião Online - Construtora Alicerce - Pedro' })], cards, AGORA);
    expect(r.get('alicerce')).toMatchObject({ casadoPor: 'nome' });
  });

  it('dúvida não casa: dois cards com o nome, nome parcial, título fora do padrão, interna', () => {
    const r = casarReunioes([
      ev({ id: 'd1', title: 'Reunião Online - Padaria Sol - Lucas' }),
      ev({ id: 'd2', title: 'Reunião Online - Construtora - Pedro' }),
      ev({ id: 'd3', title: 'Call com Construtora Alicerce' }),
      ev({ id: 'd4', title: 'Reunião Interna - Studio Lume' }),
    ], cards, AGORA);
    expect(r.size).toBe(0);
  });

  it('e-mail de um card e título de outro é dúvida; e-mail de dois cards também', () => {
    const doisCards: CartaoParaCasar[] = [...cards, { cardId: 'outro', emails: ['marina@studiolume.com.br'], nomes: ['Outro'] }];
    expect(casarReunioes([ev({ id: 'x1', title: 'Reunião Online - Construtora Alicerce - Pedro', attendees: ['marina@studiolume.com.br'] })], cards, AGORA).size).toBe(0);
    expect(casarReunioes([ev({ id: 'x2', title: 'Reunião Online - Studio Lume - Pedro', attendees: ['marina@studiolume.com.br'] })], cards, AGORA).get('lume')?.casadoPor).toBe('email');
    expect(casarReunioes([ev({ id: 'x3', attendees: ['marina@studiolume.com.br'] })], doisCards, AGORA).size).toBe(0);
  });

  it('fica a mais cedo; cancelado, passado e além de 14 dias ficam de fora; dia inteiro vem marcado', () => {
    const titulo = 'Reunião Online - Studio Lume - Pedro';
    const r = casarReunioes([
      ev({ id: 'tarde', title: titulo, start: emHoras(72), end: emHoras(73) }),
      ev({ id: 'cedo', title: titulo, start: emHoras(48), end: emHoras(49) }),
      ev({ id: 'cancelado', title: titulo, start: emHoras(2), end: emHoras(3), status: 'cancelled' }),
      ev({ id: 'passado', title: titulo, start: emHoras(-3), end: emHoras(-2) }),
      ev({ id: 'longe', title: titulo, start: emHoras(24 * 15), end: emHoras(24 * 15 + 1) }),
    ], cards, AGORA);
    expect(r.get('lume')?.inicio).toBe(emHoras(48));
    const d = casarReunioes([ev({ id: 'dia', title: titulo, start: '2026-10-24', end: '2026-10-25' })], cards, AGORA).get('lume');
    expect(d).toMatchObject({ diaInteiro: true, inicio: '2026-10-24T03:00:00.000Z' });
  });
});

describe('"Pedir agora" (sem banco)', () => {
  const trilho = { id: 'tri-1', fase: 'contrato' };
  it('cada agente leva ao ponto certo, com o cliente escolhido', () => {
    expect(pedidoDoAgente({ slug: 'leitor-de-ata', estado: 'ativo', estadoDeclarado: 'ativo' }, trilho, true)).toEqual({ foco: 'ata', href: '/onboarding/tri-1?foco=ata', desabilitado: null });
    expect(pedidoDoAgente({ slug: 'pesquisador-de-conta', estado: 'ativo' }, trilho, true)?.href).toBe('/onboarding/tri-1?foco=dossie');
    expect(pedidoDoAgente({ slug: 'roteirista-de-kickoff', estado: 'ativo' }, trilho, true)?.href).toBe('/onboarding/tri-1/roteiro?foco=personalizar');
    expect(pedidoDoAgente({ slug: 'montador-do-kit', estado: 'ativo' }, trilho, true)?.href).toBe('#kit-da-implantacao');
    expect(pedidoDoAgente({ slug: 'relogio-do-onboarding', estado: 'ativo' }, trilho, true)).toBeNull();
  });
  it('desligado no cadastro, parado no banco, trilho encerrado ou sem permissão: desabilitado com a razão', () => {
    expect(pedidoDoAgente({ slug: 'leitor-de-ata', estado: 'ativo', estadoDeclarado: 'desligado' }, trilho, true)?.desabilitado).toMatch(/Desligado no cadastro/);
    expect(pedidoDoAgente({ slug: 'leitor-de-ata', estado: 'pausado', estadoDeclarado: 'ativo' }, trilho, true)?.desabilitado).toBe('Está pausado em Agentes: ligue antes de pedir.');
    expect(pedidoDoAgente({ slug: 'leitor-de-ata', estado: 'ativo' }, { id: 't', fase: 'encerrado' }, true)?.desabilitado).toMatch(/encerrado/);
    expect(pedidoDoAgente({ slug: 'leitor-de-ata', estado: 'ativo' }, trilho, false)?.desabilitado).toMatch(/editar tarefas/);
    // Não semeado ainda: abrir a bancada semeia, o pedido vale.
    expect(pedidoDoAgente({ slug: 'leitor-de-ata', estado: 'ausente' }, trilho, true)?.desabilitado).toBeNull();
  });
});

/** A porta de mentira: conta as leituras e devolve os eventos (ou lança). */
function portaDeMentira(resposta: () => unknown) {
  const chamadas: Array<{ orgId: string; capabilityId: string; args: Record<string, unknown> }> = [];
  const porta = {
    executar: async (e: { orgId: string; capabilityId: string; args: Record<string, unknown> }) => {
      chamadas.push(e);
      return resposta();
    },
  } as unknown as PortaDoOperador;
  return { porta, chamadas };
}

describe('a agenda do quadro: uma leitura por empresa em 5 minutos (sem banco)', () => {
  it('N leituras no prazo = uma chamada à porta; depois de 5 min lê de novo; em paralelo espera a mesma', async () => {
    const { porta, chamadas } = portaDeMentira(() => []);
    const svc = new AgendaDaImplantacaoService(porta);
    let agora = AGORA;
    svc.agora = () => agora;
    await Promise.all([svc.ler(ORG, EU), svc.ler(ORG, EU), svc.ler(ORG, EU)]);
    for (let i = 0; i < 5; i++) await svc.ler(ORG, EU);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatchObject({ orgId: ORG, capabilityId: 'comunicacao.agenda.periodo' });
    const { de, ate } = chamadas[0].args as { de: string; ate: string };
    expect((Date.parse(ate) - Date.parse(de)) / 86_400_000).toBe(14);
    await svc.ler(VIZINHA, EU);
    expect(chamadas).toHaveLength(2);
    agora = new Date(AGORA.getTime() + VALIDADE_DA_LEITURA_MS + 1);
    await svc.ler(ORG, EU);
    expect(chamadas).toHaveLength(3);
  });

  it('a porta recusando, retendo ou devolvendo outra coisa: indisponível, sem lançar', async () => {
    for (const resposta of [() => { throw new Error('Google Agenda desligado'); }, () => ({ status: 'aguardando_aprovacao' }), () => 'x']) {
      const svc = new AgendaDaImplantacaoService(portaDeMentira(resposta).porta);
      svc.agora = () => AGORA;
      expect(await svc.ler(ORG, EU)).toMatchObject({ ok: false });
    }
  });
});

describe('o limite pelo token: conta de máquina é recusada no guarda (sem banco)', () => {
  it('ia_acao não passa; gente passa', () => {
    const guarda = new SoGenteNoTrabalhoGuard();
    const ctx = (roles: string[]) => ({ switchToHttp: () => ({ getRequest: () => ({ user: { sub: EU, orgId: ORG, roles } }) }) }) as never;
    expect(() => guarda.canActivate(ctx(['ia_acao']))).toThrow(RECUSA_DE_MAQUINA_NO_TRABALHO);
    expect(guarda.canActivate(ctx(['admin_master']))).toBe(true);
  });
  it('o corpo: inteiro de 1 a 99 ou nulo, com a versão lida', () => {
    expect(TrabLimiteDaEtapaSchema.parse({ limite: 3, esperado: null })).toEqual({ limite: 3, esperado: null });
    expect(() => TrabLimiteDaEtapaSchema.parse({ limite: 0, esperado: null })).toThrow();
    expect(() => TrabLimiteDaEtapaSchema.parse({ limite: 3 })).toThrow();
    expect(() => TrabLimiteDaEtapaSchema.parse({ limite: 3, esperado: null, extra: 1 })).toThrow();
  });
});

describe.skipIf(!URL)('o cartão da implantação: contra o Postgres', () => {
  let prisma: PrismaClient;
  let p: PrismaService;
  let listaId: string;
  const etapa: Record<string, string> = {};
  const cards: Record<string, string> = {};
  const LEAD = '00000000-0000-4000-8000-0000000c4a71';

  async function limpar() {
    for (const orgId of [ORG, VIZINHA]) {
      await prisma.onboardingTrilho.deleteMany({ where: { orgId } });
      await prisma.comercialFicha.deleteMany({ where: { orgId } });
      await prisma.lead.deleteMany({ where: { orgId } });
      await prisma.workTask.deleteMany({ where: { orgId } });
      await prisma.workStatus.deleteMany({ where: { orgId } });
      await prisma.workList.deleteMany({ where: { orgId } });
      await prisma.workFolder.deleteMany({ where: { orgId } });
      await prisma.auditLog.deleteMany({ where: { orgId } });
    }
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    p = prisma as unknown as PrismaService;
    for (const orgId of [ORG, VIZINHA]) await prisma.org.upsert({ where: { id: orgId }, create: { id: orgId, name: orgId, slug: orgId }, update: {} });
    await limpar();
    const papel = async (key: string) => prisma.role.upsert({ where: { orgId_key: { orgId: ORG, key } }, create: { orgId: ORG, key, name: key }, update: {} });
    const gente = await papel('admin_master');
    const maquina = await papel('ia_acao');
    for (const [id, role, ativo] of [[EU, gente, true], [MAQUINA, maquina, true], [INATIVO, gente, false]] as const) {
      await prisma.user.upsert({
        where: { id },
        create: { id, orgId: ORG, name: id, email: `${id}@teste.local`, passwordHash: 'x', isActive: ativo, roles: { connect: [{ id: role.id }] } },
        update: { isActive: ativo, roles: { set: [{ id: role.id }] } },
      });
    }

    await prisma.$transaction((tx) => criarEstruturaSugerida(tx, ORG));
    const lista = await prisma.workList.findFirstOrThrow({ where: { orgId: ORG, name: 'Onboarding de cliente' }, include: { statuses: true } });
    listaId = lista.id;
    for (const s of lista.statuses) etapa[s.name] = s.id;
    const card = async (nome: string, etapaNome: string) => {
      const t = await prisma.workTask.create({ data: { orgId: ORG, listId: listaId, statusId: etapa[etapaNome], title: nome } });
      cards[nome] = t.id;
      return t.id;
    };
    // Lume: trilho atrás do card (Imersão × contrato), contato por e-mail, passo vencido.
    await prisma.onboardingTrilho.create({ data: { orgId: ORG, cliente: 'Studio Lume', slug: 'studio-lume', fase: 'contrato', cardId: await card('Studio Lume', 'Imersão'), contatoEmail: 'marina@studiolume.com.br', proximoPasso: 'mandar o kit', proximoPassoEm: new Date(AGORA.getTime() - 86_400_000) } });
    // Alicerce: trilho na fase certa, sem próximo passo, casa pelo nome do título.
    await prisma.onboardingTrilho.create({ data: { orgId: ORG, cliente: 'Construtora Alicerce', slug: 'construtora-alicerce', fase: 'contrato', cardId: await card('Construtora Alicerce', 'Kickoff marcado') } });
    // Padaria: só a ficha do comercial (sem trilho), e-mail no lead; nenhuma reunião.
    await prisma.lead.create({ data: { id: LEAD, orgId: ORG, name: 'Padaria Sol', email: 'dono@padariasol.com.br' } });
    await prisma.comercialFicha.create({ data: { orgId: ORG, leadId: LEAD, empresa: 'Padaria Sol', cardId: await card('Padaria Sol', 'Fechado no comercial') } });
    // Encerrado: fora do resumo; um card solto sem trilho nem ficha: fora do quadro.
    await prisma.onboardingTrilho.create({ data: { orgId: ORG, cliente: 'Antigo', slug: 'antigo', fase: 'operacao', cardId: await card('Antigo', 'Encerrado') } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await limpar();
    await prisma.user.deleteMany({ where: { id: { in: [EU, MAQUINA, INATIVO] } } });
    await prisma.role.deleteMany({ where: { orgId: ORG } });
    await prisma.org.deleteMany({ where: { id: { in: [ORG, VIZINHA] } } });
    await prisma.$disconnect();
  });

  const eventos: EventoDaAgenda[] = [
    { id: 'e1', title: 'Conversa', start: emHoras(26), end: emHoras(27), attendees: ['marina@studiolume.com.br'] },
    { id: 'e2', title: 'Reunião Presencial - Construtora Alicerce - Rodrigo', start: emHoras(50), end: emHoras(51), attendees: [] },
  ];
  const quem = { sub: EU, permissions: ['tarefas.ver', 'dashboard.ver'] };

  function servico(resposta: () => unknown) {
    const { porta, chamadas } = portaDeMentira(resposta);
    const agenda = new AgendaDaImplantacaoService(porta);
    agenda.agora = () => AGORA;
    const svc = new ImplantacaoDoQuadroService(p, agenda);
    svc.agora = () => AGORA;
    return { svc, chamadas };
  }

  it('o quadro: reunião casada por e-mail e por nome, o selo da fase, e uma leitura da agenda para todos os cards', async () => {
    const { svc, chamadas } = servico(() => eventos);
    const r = await svc.daLista(ORG, listaId, quem);
    expect(r.agenda).toBe('ok');
    const de = (nome: string) => r.itens.find((i) => i.tarefaId === cards[nome]);
    expect(de('Studio Lume')).toMatchObject({ reuniao: { casadoPor: 'email', inicio: emHoras(26) }, fase: { diverge: true, selo: 'fase do trilho: 3 de 5' } });
    expect(de('Construtora Alicerce')).toMatchObject({ reuniao: { casadoPor: 'nome' }, fase: { diverge: false, selo: null } });
    expect(de('Padaria Sol')).toMatchObject({ reuniao: null, fase: null });
    expect(de('Antigo')?.fase).toBeNull();
    await svc.daLista(ORG, listaId, quem);
    await svc.resumo(ORG, quem);
    expect(chamadas).toHaveLength(1);
  });

  it('a agenda falhando: o quadro fica de pé, com a fase e sem reunião, e diz "indisponível"', async () => {
    const { svc } = servico(() => { throw new Error('sem credencial do Google'); });
    const r = await svc.daLista(ORG, listaId, quem);
    expect(r.agenda).toBe('indisponivel');
    expect(r.itens.every((i) => i.reuniao === null)).toBe(true);
    expect(r.itens.find((i) => i.tarefaId === cards['Studio Lume'])?.fase?.diverge).toBe(true);
  });

  it('sem permissão de ler a agenda: nem lê, e diz por quê', async () => {
    const { svc, chamadas } = servico(() => eventos);
    const r = await svc.daLista(ORG, listaId, { sub: EU, permissions: ['tarefas.ver'] });
    expect(r.agenda).toBe('sem-permissao');
    expect(chamadas).toHaveLength(0);
  });

  it('o resumo do Dia a dia: sem próximo passo, passo vencido e sem reunião, com os ids; encerrado fora', async () => {
    const { svc } = servico(() => eventos);
    const r = await svc.resumo(ORG, quem);
    expect(r.cartoes).toBe(3);
    expect(r.pendencias['sem-proximo-passo']).toEqual([cards['Construtora Alicerce']]);
    expect(r.pendencias['passo-vencido']).toEqual([cards['Studio Lume']]);
    expect(r.pendencias['sem-reuniao']).toEqual([cards['Padaria Sol']]);
    const falha = await servico(() => { throw new Error('x'); }).svc.resumo(ORG, quem);
    expect(falha).toMatchObject({ agenda: 'indisponivel', pendencias: { 'sem-reuniao': [] } });
    expect(await servico(() => eventos).svc.resumo(VIZINHA, quem)).toMatchObject({ cartoes: null });
  });

  it('a lista de outra empresa é 404', async () => {
    await expect(servico(() => eventos).svc.daLista(VIZINHA, listaId, quem)).rejects.toThrow('Lista não encontrada');
  });

  it('o limite: gente define, auditado com antes e depois; versão vencida é 409; máquina e inativo recusados', async () => {
    const svc = new LimiteDaEtapaService(p, new AuditService(p));
    const imersao = etapa['Imersão'];
    expect(await svc.definir(ORG, EU, imersao, { limite: 3, esperado: null })).toEqual({ statusId: imersao, limite: 3 });
    expect((await prisma.workStatus.findUniqueOrThrow({ where: { id: imersao } })).limite).toBe(3);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { orgId: ORG, action: ACAO_DO_LIMITE, entityId: imersao } });
    expect(log).toMatchObject({ actorId: EU, before: { etapa: 'Imersão', limite: null }, after: { etapa: 'Imersão', limite: 3 } });
    // Outra aba ainda acha que não há limite: 409, nada gravado.
    await expect(svc.definir(ORG, EU, imersao, { limite: 5, esperado: null })).rejects.toThrow(/mudou desde que a tela foi lida/);
    expect((await prisma.workStatus.findUniqueOrThrow({ where: { id: imersao } })).limite).toBe(3);
    await expect(svc.definir(ORG, MAQUINA, imersao, { limite: null, esperado: 3 })).rejects.toThrow(/conta de máquina/);
    await expect(svc.definir(ORG, INATIVO, imersao, { limite: null, esperado: 3 })).rejects.toThrow(/usuário ativo/);
    await expect(svc.definir(VIZINHA, EU, imersao, { limite: null, esperado: 3 })).rejects.toThrow();
    // Tirar o limite volta a nulo, e o quadro só avisa (nada trava aqui).
    expect(await svc.definir(ORG, EU, imersao, { limite: null, esperado: 3 })).toEqual({ statusId: imersao, limite: null });
    expect(await prisma.auditLog.count({ where: { orgId: ORG, action: ACAO_DO_LIMITE } })).toBe(2);
  });

  it('o PATCH antigo do editor de etapas: mudar o limite também é de gente e audita antes e depois; o resto segue igual', async () => {
    const audit = new AuditService(p);
    const work = new WorkService(p, audit, new CheckoutDeTarefaService(p, audit, new EventLogService(p)));
    const kit = etapa['Kit montado'];
    await expect(work.editarStatus(ORG, MAQUINA, kit, { limite: 2 })).rejects.toThrow(RECUSA_DE_MAQUINA_NO_TRABALHO);
    await expect(work.editarStatus(ORG, INATIVO, kit, { limite: 2 })).rejects.toThrow(/usuário ativo/);
    expect((await prisma.workStatus.findUniqueOrThrow({ where: { id: kit } })).limite).toBeNull();
    await work.editarStatus(ORG, EU, kit, { limite: 2 });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { orgId: ORG, action: 'work.status.update', entityId: kit }, orderBy: { createdAt: 'desc' } });
    expect(log).toMatchObject({ before: { limite: null }, after: { limite: 2 } });
    // Sem mexer no limite (cor, nome), a conta de máquina segue como antes.
    await work.editarStatus(ORG, MAQUINA, kit, { color: '#123456', limite: 2 });
    await work.editarStatus(ORG, EU, kit, { limite: null });
  });
});
