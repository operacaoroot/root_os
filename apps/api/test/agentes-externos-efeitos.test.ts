import { describe, expect, it, vi } from 'vitest';
import { ActorType } from '@prisma/client';

import { ARGUMENTOS_DA_CENTRAL, GRAVAR_NA_MEMORIA, NAO_GRAVAR, chaveDaSugestao, dentroDaJanela, lerArgumentos, recusaDaInvocacao, TarefaCriarArgs } from '../src/agentes-externos/argumentos-da-central';
import { EfeitosDaCentralService } from '../src/agentes-externos/efeitos-da-central.service';
import { RespostaNaConversaService } from '../src/agentes-externos/resposta-na-conversa.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { PendenciasRegistry } from '../src/pendencias/pendencias.registry';
import { CONECTOR_DA_CAPACIDADE } from '../src/integrations/conectores';
import { capacidade, portaDublada } from './porta-dublada';

/*
 * A5 (política 1.13.0, 30/10/2026): as nove capacidades da central que deixam a
 * Rootinha operar o OS só pelas portas dele. Cada uma precisa de três provas:
 * o efeito está ligado, o argumento é validado, e quem NÃO a declarou é
 * recusado pela porta antes de qualquer efeito.
 */

const NOVAS = Object.keys(ARGUMENTOS_DA_CENTRAL);
const ORG = 'org-1';
const PEDRO = '11111111-1111-4111-8111-111111111111';

/** Os serviços dublados que os efeitos chamam, com o que cada chamada recebeu. */
function montar(opcoes: { usuarios?: Array<{ id: string; name: string; roles?: string[]; perms?: string[] }> } = {}) {
  const usuarios = opcoes.usuarios ?? [{ id: PEDRO, name: 'Pedro', roles: ['admin_master'], perms: ['tarefas.editar', 'obsidian.editar'] }];
  const prisma = {
    user: {
      findFirst: async ({ where, select }: { where: { id: string; orgId: string }; select: Record<string, unknown> }) => {
        const u = usuarios.find((x) => x.id === where.id);
        if (!u || where.orgId !== ORG) return null;
        if ('roles' in select && (select.roles as { select?: { key?: boolean } }).select?.key) {
          return { id: u.id, name: u.name, roles: (u.roles ?? []).map((key) => ({ key })) };
        }
        return { id: u.id, name: u.name, roles: [{ permissions: (u.perms ?? []).map((key) => ({ key })) }] };
      },
    },
    agent: { findFirst: vi.fn(async () => null as unknown) },
    session: { findFirst: vi.fn(async () => null as unknown) },
    whatsAppMensagem: { findFirst: vi.fn(async () => null as unknown) },
  };
  const pendencias = { abrir: vi.fn(async () => ({ id: 'pend-1', nova: true, estado: 'aberta' })), listar: vi.fn(async () => []) };
  const tratadores = new PendenciasRegistry();
  const aprovacoes = { listar: vi.fn(async () => ({ items: [], total: 0 })) };
  const memoria = { promover: vi.fn(async () => ({ id: 'nota-1' })) };
  const tarefas = {
    painel: vi.fn(async () => ({
      hoje: '2026-10-30',
      areas: [{ id: 'area-op', nome: 'Operação' }, { id: 'area-com', nome: 'Comercial' }],
      pessoas: [{ id: PEDRO, nome: 'Pedro' }, { id: 'u-lucas', nome: 'Lucas Fernandes' }],
      clientes: [], resumo: [], tarefas: [],
    })),
    criar: vi.fn(async () => ({ criada: true, tarefa: { id: 't-1' } })),
  };
  const trabalho = { comentar: vi.fn(async () => ({ id: 'c-1', createdAt: '2026-10-30T12:00:00.000Z' })) };
  const runtime = { invocar: vi.fn(async () => ({ sessionId: 's-1', status: 'respondida', resposta: 'ok', aprovacoes: [] })) };
  const evolution = { responderComoPessoa: vi.fn(async () => ({ id: 'wamid-1' })) };
  const registro = new EfeitosRegistry();
  const central = new EfeitosDaCentralService(
    prisma as never, registro, pendencias as never, tratadores, aprovacoes as never, memoria as never,
    tarefas as never, trabalho as never, runtime as never,
  );
  const resposta = new RespostaNaConversaService(prisma as never, registro, evolution);
  central.onModuleInit();
  resposta.onModuleInit();
  return { registro, prisma, pendencias, tratadores, aprovacoes, memoria, tarefas, trabalho, runtime, evolution, central };
}

const ctxDaRootinha = (extra: Record<string, unknown> = {}) => ({
  orgId: ORG, actorType: ActorType.ai, actorId: 'rootinha', agentSlug: 'rootinha', correlationId: 'cor-1', solicitanteId: PEDRO, ...extra,
});

describe('A5: o catálogo e os efeitos andam juntos', () => {
  it('são nove, e cada uma tem decisão de conector (só responder no WhatsApp sai da casa)', () => {
    expect(NOVAS.sort()).toEqual([
      'agente.invocar', 'aprovacao.listar', 'briefing.ler', 'caixa.pendencia.criar', 'caixa.pendencia.listar',
      'contexto.memoria.sugerir', 'operacao.tarefa.comentar', 'operacao.tarefa.criar', 'whatsapp.conversa.responder',
    ]);
    for (const id of NOVAS) expect(id in CONECTOR_DA_CAPACIDADE, id).toBe(true);
    expect(NOVAS.filter((id) => CONECTOR_DA_CAPACIDADE[id] !== null)).toEqual(['whatsapp.conversa.responder']);
  });

  it('o esquema do efeito tem os mesmos campos e os mesmos obrigatórios do argsSchema do catálogo', () => {
    for (const id of NOVAS) {
      const s = capacidade(id).argsSchema as { properties: Record<string, unknown>; required: string[] };
      const z = ARGUMENTOS_DA_CENTRAL[id];
      expect(Object.keys(z.shape).sort(), id).toEqual(Object.keys(s.properties).sort());
      const obrigatorios = Object.entries(z.shape).filter(([, v]) => !(v as { isOptional(): boolean }).isOptional()).map(([k]) => k);
      expect(obrigatorios.sort(), id).toEqual([...(s.required ?? [])].sort());
    }
  });

  it('as nove têm efeito ligado, cada uma por um dono só', () => {
    const { registro } = montar();
    for (const id of NOVAS) expect(registro.tem(id), id).toBe(true);
    expect(registro.donoDe('whatsapp.conversa.responder')).toMatch(/RespostaNaConversaService/);
    expect(registro.donoDe('operacao.tarefa.criar')).toMatch(/EfeitosDaCentralService/);
  });

  it('o efeito confere o que a porta não confere: o tamanho máximo', () => {
    expect(() => lerArgumentos(TarefaCriarArgs, { titulo: 'x'.repeat(301) }, 'operacao.tarefa.criar')).toThrow(/titulo/);
    expect(() => lerArgumentos(TarefaCriarArgs, { titulo: 'ok', inventado: 1 }, 'operacao.tarefa.criar')).toThrow(/Nada foi feito/);
  });
});

describe('A5: a porta recusa quem não declarou, antes de qualquer efeito', () => {
  it.each(NOVAS)('%s fora da declaração: recusado, com RASTRO, e o efeito não roda', async (id) => {
    const { porta, registro } = portaDublada();
    const efeito = vi.fn(async () => 'não devia rodar');
    const r = await porta.executar(
      {
        capabilityId: id,
        args: {},
        ctx: { orgId: ORG, actorType: ActorType.ai, actorId: 'rootinha', agentSlug: 'outro-agente', correlationId: 'c', capacidadesDeclaradas: ['numeros.painel.ler'] },
      },
      efeito,
    );
    expect(r.status).toBe('recusado');
    expect((r as { motivo: string }).motivo).toMatch(/não está nas capacidades declaradas/);
    expect(efeito).not.toHaveBeenCalled();
    expect(registro.eventos.map((e) => e.tipo)).toEqual(['tool.recusado']);
    expect(registro.eventos[0].payload?.causa).toBe('fora_da_declaracao');
  });

  it('argumento fora do catálogo é recusado pela porta antes do efeito', async () => {
    const { porta } = portaDublada();
    const efeito = vi.fn(async () => 'não devia rodar');
    const r = await porta.executar(
      {
        capabilityId: 'operacao.tarefa.criar',
        args: { titlo: 'sem o e' },
        ctx: { orgId: ORG, actorType: ActorType.ai, actorId: 'rootinha', agentSlug: 'rootinha', correlationId: 'c', capacidadesDeclaradas: ['operacao.tarefa.criar'] },
      },
      efeito,
    );
    expect(r.status).toBe('recusado');
    expect((r as { motivo: string }).motivo).toMatch(/titulo/);
    expect(efeito).not.toHaveBeenCalled();
  });

  it('declarada e R1: executa sem aprovação; responder no WhatsApp (R3) fica retido', async () => {
    const { porta } = portaDublada();
    const ctx = { orgId: ORG, actorType: ActorType.ai, actorId: 'rootinha', agentSlug: 'rootinha', correlationId: 'c', capacidadesDeclaradas: NOVAS };
    const r1 = await porta.executar({ capabilityId: 'operacao.tarefa.criar', args: { titulo: 'revisar contrato' }, ctx }, async () => 'feito');
    expect(r1.status).toBe('executado');
    const r3 = await porta.executar({ capabilityId: 'whatsapp.conversa.responder', args: { mensagemId: 'ABC', texto: 'oi' }, ctx }, async () => 'não sai');
    expect(r3.status).toBe('aguardando_aprovacao');
  });
});

describe('A5: o que cada efeito faz', () => {
  it('a tarefa nasce pelo serviço do Dia a dia, em nome de quem pediu, na área padrão', async () => {
    const m = montar();
    const r = await m.registro.executar('operacao.tarefa.criar', { titulo: 'revisar contrato', pessoa: 'Lucas', prazo: '2026-11-03' }, ctxDaRootinha());
    expect(m.tarefas.criar).toHaveBeenCalledWith(ORG, PEDRO, expect.objectContaining({ titulo: 'revisar contrato', areaId: 'area-op', pessoaId: 'u-lucas', prazo: '2026-11-03', confirmar: false }));
    expect(r).toMatchObject({ criada: true, emNomeDe: 'Pedro' });
  });

  it('sem pessoa no pedido (só o agente), a tarefa NÃO nasce', async () => {
    const m = montar();
    await expect(m.registro.executar('operacao.tarefa.criar', { titulo: 'x' }, ctxDaRootinha({ solicitanteId: null }))).rejects.toThrow(/em nome de uma pessoa/);
    expect(m.tarefas.criar).not.toHaveBeenCalled();
  });

  it('pessoa sem tarefas.editar não cria nem comenta', async () => {
    const m = montar({ usuarios: [{ id: PEDRO, name: 'Pedro', roles: ['leitor'], perms: [] }] });
    await expect(m.registro.executar('operacao.tarefa.criar', { titulo: 'x' }, ctxDaRootinha())).rejects.toThrow(/tarefas.editar/);
    await expect(m.registro.executar('operacao.tarefa.comentar', { tarefaId: PEDRO, texto: 'oi' }, ctxDaRootinha())).rejects.toThrow(/tarefas.editar/);
  });

  it('o comentário vai pelo WorkService, em nome de quem pediu', async () => {
    const m = montar();
    await m.registro.executar('operacao.tarefa.comentar', { tarefaId: '22222222-2222-4222-8222-222222222222', texto: 'feito' }, ctxDaRootinha());
    expect(m.trabalho.comentar).toHaveBeenCalledWith(ORG, PEDRO, '22222222-2222-4222-8222-222222222222', 'feito');
  });

  it('a pendência nasce com a função do agente no cadastro; sem agente do cadastro, recusa', async () => {
    const m = montar();
    await expect(m.registro.executar('caixa.pendencia.criar', { titulo: 'aprovar orçamento' }, ctxDaRootinha({ agentSlug: 'nao-existe' }))).rejects.toThrow(/cadastro único/);
    await m.registro.executar('caixa.pendencia.criar', { titulo: 'conferir NF', para: 'Lucas' }, ctxDaRootinha({ agentSlug: 'agente-de-tarefas' }));
    expect(m.pendencias.abrir).toHaveBeenCalledWith(ORG, expect.objectContaining({ funcao: 'TR-12', titulo: 'conferir NF', paraUsuarioId: 'u-lucas', opcoes: [{ chave: 'feito', rotulo: 'Feito' }] }));
  });

  it('a fila é lida pelo resumo, nunca pelos argumentos', async () => {
    const m = montar();
    await m.registro.executar('aprovacao.listar', {}, ctxDaRootinha());
    expect(m.aprovacoes.listar).toHaveBeenCalledWith(ORG, 'pendente');
  });

  it('a sugestão de memória NÃO grava: abre pendência, e só "Gravar" de gente grava', async () => {
    const m = montar();
    const r = await m.registro.executar(
      'contexto.memoria.sugerir',
      { titulo: 'Regra do reembolso', corpo: 'Reembolso só com NF.', chave: 'voz.pedro' },
      ctxDaRootinha({ agentSlug: 'agente-de-tarefas' }),
    );
    expect(r).toMatchObject({ gravada: false, chave: 'sugestao/voz.pedro' });
    expect(m.memoria.promover).not.toHaveBeenCalled();
    const aberta = (m.pendencias.abrir.mock.calls[0] as unknown[])[1] as { tipo: string; dados: Record<string, unknown>; opcoes: Array<{ chave: string }> };
    expect(aberta.tipo).toBe('memoria.sugestao');
    expect(aberta.opcoes.map((o) => o.chave)).toEqual([GRAVAR_NA_MEMORIA, NAO_GRAVAR]);
    expect(m.tratadores.permissaoDe('memoria.sugestao')).toBe('obsidian.editar');

    const tratador = m.tratadores.tratador('memoria.sugestao')!;
    const resposta = { orgId: ORG, pendenciaId: 'pend-1', tipo: 'memoria.sugestao', usuarioId: 'u-lucas', refTipo: null, refId: null, dados: aberta.dados };
    await tratador({ ...resposta, escolha: NAO_GRAVAR });
    expect(m.memoria.promover).not.toHaveBeenCalled();
    await tratador({ ...resposta, escolha: GRAVAR_NA_MEMORIA });
    expect(m.memoria.promover).toHaveBeenCalledWith(ORG, expect.objectContaining({ chave: 'sugestao/voz.pedro', title: 'Regra do reembolso', body: 'Reembolso só com NF.' }));
  });

  it('toda nota sugerida nasce sob sugestao/, com ou sem chave', () => {
    expect(chaveDaSugestao('A regra do caixa', undefined, ORG)).toMatch(/^sugestao\/a-regra-do-caixa-[0-9a-f]{8}$/);
    expect(chaveDaSugestao('x', 'sugestao/abc', ORG)).toBe('sugestao/abc');
    expect(chaveDaSugestao('x', 'vault:qualquer', ORG)).toBe('sugestao/vault:qualquer');
  });

  it('invocar: nunca o próprio, nunca quem também invoca, só agente de modelo', async () => {
    expect(recusaDaInvocacao('rootinha', { slug: 'rootinha', tipo: 'llm', capacidades: [] })).toMatch(/a si mesmo/);
    expect(recusaDaInvocacao('rootinha', { slug: 'outro', tipo: 'llm', capacidades: ['agente.invocar'] })).toMatch(/laço/);
    expect(recusaDaInvocacao('rootinha', { slug: 'sincronizador-clickup', tipo: 'conector', capacidades: [] })).toMatch(/não é agente de modelo/);
    expect(recusaDaInvocacao('rootinha', null)).toMatch(/não existe/);
    expect(recusaDaInvocacao('rootinha', { slug: 'briefing-diario', tipo: 'llm', capacidades: ['numeros.painel.ler'] })).toBeNull();

    const m = montar();
    m.prisma.agent.findFirst.mockResolvedValueOnce({ slug: 'rootinha', tipo: 'llm', capacidades: ['agente.invocar'] });
    await expect(m.registro.executar('agente.invocar', { agente: 'rootinha' }, ctxDaRootinha())).rejects.toThrow(/a si mesmo/);
    m.prisma.agent.findFirst.mockResolvedValueOnce({ slug: 'briefing-diario', tipo: 'llm', capacidades: [] });
    await m.registro.executar('agente.invocar', { agente: 'briefing-diario', nota: 'o caixa' }, ctxDaRootinha({ pedidoDeFora: true }));
    expect(m.runtime.invocar).toHaveBeenCalledWith(expect.objectContaining({ agentSlug: 'briefing-diario', solicitanteId: PEDRO, nota: 'o caixa', procedenciaExterna: true }));
  });

  it('o briefing é a última passagem respondida do briefing-diario', async () => {
    const m = montar();
    m.prisma.session.findFirst.mockResolvedValueOnce({ id: 's-9', criadaEm: new Date('2026-10-30T11:00:00Z'), encerradaEm: null, resposta: 'Bom dia', status: 'respondida', canal: 'rotina' });
    const r = await m.registro.executar('briefing.ler', {}, ctxDaRootinha());
    expect(r).toMatchObject({ agente: 'briefing-diario', passagem: { sessionId: 's-9', resposta: 'Bom dia' } });
    const onde = (m.prisma.session.findFirst.mock.calls[0] as unknown[])[0] as { where: { agent: { slug: string } } };
    expect(onde.where.agent.slug).toBe('briefing-diario');
  });

  it('responder: só na conversa da mensagem gravada que chegou, e dentro de 24 h', async () => {
    const m = montar();
    await expect(m.registro.executar('whatsapp.conversa.responder', { mensagemId: 'INVENTADO', texto: 'oi' }, ctxDaRootinha())).rejects.toThrow(/não está gravada/);
    m.prisma.whatsAppMensagem.findFirst.mockResolvedValueOnce({ chatJid: '5532999999999@s.whatsapp.net', timestamp: new Date(Date.now() - 2 * 86_400_000), grupo: false });
    await expect(m.registro.executar('whatsapp.conversa.responder', { mensagemId: 'VELHA', texto: 'oi' }, ctxDaRootinha())).rejects.toThrow(/mais de 24 h/);
    expect(m.evolution.responderComoPessoa).not.toHaveBeenCalled();
    m.prisma.whatsAppMensagem.findFirst.mockResolvedValueOnce({ chatJid: '5532999999999@s.whatsapp.net', timestamp: new Date(), grupo: false });
    const r = await m.registro.executar('whatsapp.conversa.responder', { mensagemId: 'ABC', texto: 'Feito.' }, ctxDaRootinha());
    expect(m.evolution.responderComoPessoa).toHaveBeenCalledWith(ORG, '5532999999999@s.whatsapp.net', 'Feito.');
    expect(r).toMatchObject({ enviado: true, respondeA: 'ABC' });
    const onde = (m.prisma.whatsAppMensagem.findFirst.mock.calls[0] as unknown[])[0] as { where: Record<string, unknown> };
    expect(onde.where).toMatchObject({ orgId: ORG, deMim: false });
  });

  it('a janela da resposta', () => {
    const agora = new Date('2026-10-30T12:00:00Z');
    expect(dentroDaJanela(new Date('2026-10-30T11:00:00Z'), agora)).toBe(true);
    expect(dentroDaJanela(new Date('2026-10-29T11:59:00Z'), agora)).toBe(false);
  });
});
