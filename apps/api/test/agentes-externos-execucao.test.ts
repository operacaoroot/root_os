import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { ExecucaoExternaService } from '../src/agentes-externos/execucao-externa.service';
import type { ContextoDoEfeito } from '../src/gateway/efeitos.registry';
import { portaDublada } from './porta-dublada';

/*
 * A2 (30/10/2026): a rota de execução do agente externo. A porta é a da
 * aplicação (`portaDublada`): o que se prova aqui é o `ExecCtx` que este serviço
 * monta e os três desfechos que ela devolve, todos no RASTRO.
 */

const ORG = 'org-1';
const PEDRO = '11111111-1111-4111-8111-111111111111';
const LUCAS = '33333333-3333-4333-8333-333333333333';

function montar(agente: Record<string, unknown> | null = {}, opcoes: { mensagens?: Array<{ mensagemExternaId: string; remetenteNumero: string }> } = {}) {
  const dublada = portaDublada();
  const registro = dublada.registro;
  const usuarios = [
    { id: PEDRO, phone: '+55 32 99999-0001', roles: [{ key: 'admin_master' }] },
    { id: LUCAS, phone: '5532999990002', roles: [{ key: 'admin_master' }] },
    { id: 'ia', phone: null, roles: [{ key: 'ia_servico' }] },
  ];
  const prisma = {
    agent: {
      findFirst: async () =>
        agente === null
          ? null
          : {
              slug: 'rootinha',
              estado: 'ativo',
              ativo: true,
              capacidades: ['operacao.tarefa.criar', 'whatsapp.conversa.responder', 'email.rascunhar', 'briefing.ler'],
              rebaixadoAte: null,
              ...agente,
            },
    },
    user: {
      findFirst: async ({ where }: { where: { id: string } }) => usuarios.find((u) => u.id === where.id) ?? null,
      findMany: async () => usuarios.filter((u) => u.phone),
    },
    whatsAppMensagem: {
      findFirst: async ({ where }: { where: { mensagemExternaId: string } }) => {
        const m = (opcoes.mensagens ?? []).find((x) => x.mensagemExternaId === where.mensagemExternaId);
        return m ? { id: 'm-1', remetenteNumero: m.remetenteNumero } : null;
      },
    },
  };
  const eventos = { registrar: vi.fn(async (e: { tipo: string }) => { registro.eventos.push(e as never); return { id: 'ev' }; }) };
  const efeitoDaTarefa = vi.fn(async (_a: Record<string, unknown>, _org: string, _ctx: ContextoDoEfeito) => ({ criada: true }));
  const efeitoDoBriefing = vi.fn(async () => ({ passagem: null }));
  dublada.efeitos.registrar({
    'operacao.tarefa.criar': efeitoDaTarefa,
    'whatsapp.conversa.responder': async () => ({ enviado: true }),
    'briefing.ler': efeitoDoBriefing,
  }, 'teste');
  const svc = new ExecucaoExternaService(prisma as never, dublada.porta, dublada.efeitos, eventos as never);
  return { svc, registro, efeitoDaTarefa, efeitoDoBriefing };
}

const doConsole = { orgId: ORG, solicitantePadraoId: PEDRO };

describe('A2: a rota de execução do agente externo', () => {
  it('agente que não existe nesta empresa: 404, e nada no rastro', async () => {
    const m = montar(null);
    await expect(m.svc.executar(doConsole, 'rootinha', 'operacao.tarefa.criar', { args: { titulo: 'x' } })).rejects.toBeInstanceOf(NotFoundException);
    expect(m.registro.toolCalls).toHaveLength(0);
  });

  it('pausado: recusado com a causa do laço, no rastro, sem passar pela porta', async () => {
    const m = montar({ estado: 'pausado' });
    const r = await m.svc.executar(doConsole, 'rootinha', 'operacao.tarefa.criar', { args: { titulo: 'x' } });
    expect(r).toMatchObject({ status: 'recusado', causa: 'agente_pausado' });
    expect(m.registro.eventos.map((e) => e.tipo)).toEqual(['agente.externo.pedido', 'agente.passagem_recusada']);
    expect(m.registro.toolCalls).toHaveLength(0);
    expect(m.efeitoDaTarefa).not.toHaveBeenCalled();
  });

  it('encerrado e interruptor desligado também recusam', async () => {
    expect(await montar({ estado: 'encerrado' }).svc.executar(doConsole, 'rootinha', 'briefing.ler', {})).toMatchObject({ status: 'recusado', causa: 'agente_encerrado' });
    expect(await montar({ ativo: false }).svc.executar(doConsole, 'rootinha', 'briefing.ler', {})).toMatchObject({ status: 'recusado', causa: 'agente_desativado' });
  });

  it('fora da declaração lida do registro Agent: a PORTA recusa, com ToolCall e tool.recusado', async () => {
    const m = montar();
    const r = await m.svc.executar(doConsole, 'rootinha', 'email.enviar', { args: { to: 'a@b.c', subject: 'x', body: 'y' } });
    expect(r).toMatchObject({ status: 'recusado' });
    expect((r as { motivo: string }).motivo).toMatch(/não está nas capacidades declaradas/);
    expect(m.registro.toolCalls).toHaveLength(1);
    expect(m.registro.eventos.map((e) => e.tipo)).toEqual(['agente.externo.pedido', 'tool.recusado']);
  });

  it('declarada e sem efeito ligado: recusa antes da porta, sem criar aprovação impossível', async () => {
    const m = montar();
    const r = await m.svc.executar(doConsole, 'rootinha', 'email.rascunhar', { args: { assunto: 'a', corpo: 'b' } });
    expect(r).toMatchObject({ status: 'recusado', causa: 'sem_efeito' });
    expect(m.registro.propostas).toHaveLength(0);
  });

  it('R1 declarada: executado; o ator é o AGENTE e a pessoa vai como solicitante do efeito', async () => {
    const m = montar();
    const r = await m.svc.executar(doConsole, 'rootinha', 'operacao.tarefa.criar', { args: { titulo: 'revisar contrato' } });
    expect(r).toMatchObject({ status: 'executado', nivel: 'R1', resultado: { criada: true } });
    const ctx = m.efeitoDaTarefa.mock.calls[0][2];
    expect(ctx).toMatchObject({ actorType: 'ai', actorId: 'rootinha', agentSlug: 'rootinha', solicitanteId: PEDRO });
    expect(m.registro.toolCalls[0]).toMatchObject({ actorType: 'ai', actorId: 'rootinha', agentSlug: 'rootinha', status: 'executado' });
    const pedido = m.registro.eventos.find((e) => e.tipo === 'agente.externo.pedido')!;
    expect(pedido.payload).toMatchObject({ solicitanteId: PEDRO, deFora: false });
  });

  it('R3: aguardando aprovação com o bilhete, e quem PROPÕE é o agente (não a pessoa)', async () => {
    const m = montar();
    const r = await m.svc.executar(doConsole, 'rootinha', 'whatsapp.conversa.responder', { args: { mensagemId: 'ABC', texto: 'oi' } });
    expect(r).toMatchObject({ status: 'aguardando_aprovacao', nivel: 'R3', fila: expect.any(String) });
    expect((r as { approvalId: string }).approvalId).toBeTruthy();
    expect(m.registro.propostas[0]).toMatchObject({ propostoPorId: 'rootinha', propostoPorTipo: 'ai' });
  });

  it('procedência externa dita pelo corpo sobe um degrau: o R1 fica retido', async () => {
    const m = montar();
    const r = await m.svc.executar(doConsole, 'rootinha', 'operacao.tarefa.criar', { args: { titulo: 'x' }, procedenciaExterna: true, origem: { canal: 'whatsapp' } });
    expect(r).toMatchObject({ status: 'aguardando_aprovacao', nivel: 'R2' });
    expect(m.efeitoDaTarefa).not.toHaveBeenCalled();
  });

  it('o corpo não desmarca: mensagem de quem não é da equipe marca sozinha', async () => {
    const m = montar({}, { mensagens: [{ mensagemExternaId: 'CLIENTE-1', remetenteNumero: '5521988887777' }] });
    const r = await m.svc.executar(doConsole, 'rootinha', 'operacao.tarefa.criar', {
      args: { titulo: 'x' }, procedenciaExterna: false, origem: { canal: 'whatsapp', mensagemId: 'CLIENTE-1' },
    });
    expect(r).toMatchObject({ status: 'aguardando_aprovacao', nivel: 'R2' });
    const pedido = m.registro.eventos.find((e) => e.tipo === 'agente.externo.pedido')!;
    expect(pedido.payload).toMatchObject({ deFora: true });
  });

  it('mensagem que não está gravada também marca de fora', async () => {
    const m = montar();
    const r = await m.svc.executar(doConsole, 'rootinha', 'operacao.tarefa.criar', { args: { titulo: 'x' }, origem: { canal: 'whatsapp', mensagemId: 'SUMIU' } });
    expect(r).toMatchObject({ status: 'aguardando_aprovacao' });
  });

  it('mensagem de pessoa da equipe: o solicitante é quem escreveu, e não há marca', async () => {
    const m = montar({}, { mensagens: [{ mensagemExternaId: 'LUCAS-1', remetenteNumero: '553299990002' }] });
    const r = await m.svc.executar(doConsole, 'rootinha', 'operacao.tarefa.criar', { args: { titulo: 'x' }, origem: { canal: 'whatsapp', mensagemId: 'LUCAS-1' } });
    expect(r).toMatchObject({ status: 'executado' });
    expect(m.efeitoDaTarefa.mock.calls[0][2]).toMatchObject({ solicitanteId: LUCAS });
  });

  it('rebaixado (RF-N-07): o que passa de R1 depois da régua é recusado pela porta', async () => {
    const m = montar({ rebaixadoAte: new Date(Date.now() + 3_600_000) });
    expect(await m.svc.executar(doConsole, 'rootinha', 'operacao.tarefa.criar', { args: { titulo: 'x' } })).toMatchObject({ status: 'executado' });
    const r = await m.svc.executar(doConsole, 'rootinha', 'whatsapp.conversa.responder', { args: { mensagemId: 'ABC', texto: 'oi' } });
    expect(r).toMatchObject({ status: 'recusado' });
    expect((r as { motivo: string }).motivo).toMatch(/rebaixada/);
    expect(m.registro.propostas).toHaveLength(0);
  });

  it('solicitante que não é gente desta empresa: 400', async () => {
    const m = montar();
    await expect(m.svc.executar(doConsole, 'rootinha', 'briefing.ler', { solicitanteId: '44444444-4444-4444-8444-444444444444' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(m.svc.executar({ orgId: ORG, solicitantePadraoId: 'ia' }, 'rootinha', 'briefing.ler', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('corpo malformado não chega à porta', async () => {
    const m = montar();
    await expect(m.svc.executar(doConsole, 'rootinha', 'briefing.ler', { args: {}, inventado: true })).rejects.toThrow();
    expect(m.registro.toolCalls).toHaveLength(0);
  });

  it('token de um agente não abre a rota de outro', async () => {
    const m = montar();
    const corpo = { orgId: ORG, solicitantePadraoId: PEDRO, corpo: { id: 'c-1', nome: 'hermes', agentSlug: 'rootinha' } };
    await expect(m.svc.executar(corpo, 'briefing-diario', 'briefing.ler', {})).rejects.toBeInstanceOf(NotFoundException);
  });
});
