import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CABECALHO_DA_ASSINATURA,
  CABECALHO_DO_INSTANTE,
  assinar,
  citaRootinha,
  configuracaoDoRepasse,
  decidirRepasse,
  lerMensagem,
} from '../src/agentes-externos/repasse-ao-hermes';
import { RepasseAoHermesService } from '../src/agentes-externos/repasse-ao-hermes.service';
import { RepasseDoWhatsappRegistry } from '../src/gateway/canais/repasse.registry';
import { CanalDeAprovacaoController } from '../src/gateway/canais/canal-de-aprovacao.controller';
import { EntradaDeGrupoRegistry } from '../src/gateway/canais/entrada-de-grupo.registry';

/*
 * A9 (30/10/2026): o repasse ao Hermes. Desligado por padrão; quando ligado, só
 * as mensagens da Rootinha saem, assinadas, com prazo curto; e o que a entrada
 * já faz (comunidade, links, TR-12, comercial, aprovação) segue igual — o
 * repasse não consome nada e a falha dele não derruba a entrada.
 */

const ORG = 'org-1';
const SEGREDO = 's'.repeat(40);
const PEDRO = { id: 'u-pedro', name: 'Pedro', phone: '5532999990001', roles: [{ key: 'admin_master' }] };

function evento(o: { jid?: string; texto?: string; participant?: string; fromMe?: boolean; id?: string; tipo?: string } = {}) {
  const grupo = (o.jid ?? '').endsWith('@g.us');
  return {
    event: o.tipo ?? 'messages.upsert',
    data: {
      key: {
        id: o.id ?? 'WAMID-1',
        remoteJid: o.jid ?? '5532999990001@s.whatsapp.net',
        fromMe: o.fromMe ?? false,
        ...(grupo ? { participant: o.participant ?? '5532999990001@s.whatsapp.net' } : {}),
      },
      pushName: 'Pedro',
      message: { conversation: o.texto ?? 'quais tarefas atrasadas?' },
      messageTimestamp: 1761840000,
    },
  };
}

describe('A9: quais mensagens são da Rootinha (puro)', () => {
  it('lê a mensagem nova e ignora eco, outro evento e mensagem sem texto', () => {
    expect(lerMensagem(evento())).toMatchObject({ mensagemId: 'WAMID-1', grupo: false, remetente: '5532999990001', texto: 'quais tarefas atrasadas?' });
    expect(lerMensagem(evento({ fromMe: true }))).toBeNull();
    expect(lerMensagem(evento({ tipo: 'messages.update' }))).toBeNull();
    expect(lerMensagem(evento({ texto: '   ' }))).toBeNull();
    expect(lerMensagem(evento({ jid: '1203630@g.us', participant: '5521988887777@s.whatsapp.net' }))).toMatchObject({ grupo: true, remetente: '5521988887777' });
  });

  it('cita "Rootinha" como palavra, sem caixa nem acento', () => {
    expect(citaRootinha('@Rootinha cria a tarefa')).toBe(true);
    expect(citaRootinha('ROOTINHA, me ajuda')).toBe(true);
    expect(citaRootinha('rootinhas não existem')).toBe(false);
    expect(citaRootinha('a Root resolve')).toBe(false);
  });

  it('direta de pessoa da equipe: vai, sem marca de fora', () => {
    const m = lerMensagem(evento())!;
    expect(decidirRepasse(m, { id: 'u-pedro', nome: 'Pedro' })).toEqual({ repassar: true, motivo: 'direta-da-equipe', deFora: false, pessoa: { id: 'u-pedro', nome: 'Pedro' } });
  });

  it('direta de quem não é da equipe: só citando a Rootinha, e marcada de fora', () => {
    expect(decidirRepasse(lerMensagem(evento({ jid: '5521988887777@s.whatsapp.net' }))!, null)).toMatchObject({ repassar: false });
    expect(decidirRepasse(lerMensagem(evento({ jid: '5521988887777@s.whatsapp.net', texto: 'Rootinha, qual o prazo?' }))!, null)).toMatchObject({ repassar: true, motivo: 'citou-rootinha', deFora: true });
  });

  it('grupo: só citando a Rootinha — mesmo quem é da equipe', () => {
    const semCitar = lerMensagem(evento({ jid: '1203630@g.us', texto: 'tarefa pro Lucas: revisar' }))!;
    expect(decidirRepasse(semCitar, { id: 'u-pedro', nome: 'Pedro' })).toMatchObject({ repassar: false });
    const citando = lerMensagem(evento({ jid: '1203630@g.us', texto: 'Rootinha, resume o dia' }))!;
    expect(decidirRepasse(citando, { id: 'u-pedro', nome: 'Pedro' })).toMatchObject({ repassar: true, deFora: false });
    expect(decidirRepasse(citando, null)).toMatchObject({ repassar: true, deFora: true });
  });

  it('a resposta de decisão do canal de aprovação nunca vai', () => {
    expect(decidirRepasse(lerMensagem(evento({ texto: 'APROVAR ROOT-AB12CD34' }))!, { id: 'u-pedro', nome: 'Pedro' })).toMatchObject({ repassar: false });
  });

  it('as duas variáveis, ou nenhuma; segredo com 32+', () => {
    expect(configuracaoDoRepasse({})).toMatchObject({ ligado: false });
    expect(configuracaoDoRepasse({ ROOTINHA_WEBHOOK_URL: 'http://172.16.0.1:8650/rootos' })).toMatchObject({ ligado: false });
    expect(configuracaoDoRepasse({ ROOTINHA_WEBHOOK_URL: 'http://h/x', ROOTINHA_WEBHOOK_SEGREDO: 'curto' })).toMatchObject({ ligado: false });
    expect(configuracaoDoRepasse({ ROOTINHA_WEBHOOK_URL: 'ftp://h/x', ROOTINHA_WEBHOOK_SEGREDO: SEGREDO })).toMatchObject({ ligado: false });
    expect(configuracaoDoRepasse({ ROOTINHA_WEBHOOK_URL: 'http://172.16.0.1:8650/rootos', ROOTINHA_WEBHOOK_SEGREDO: SEGREDO })).toMatchObject({ ligado: true });
  });
});

describe('A9: o serviço', () => {
  const antes = { ...process.env };
  beforeEach(() => {
    process.env.ROOTINHA_WEBHOOK_URL = 'http://172.16.0.1:8650/rootos';
    process.env.ROOTINHA_WEBHOOK_SEGREDO = SEGREDO;
  });
  afterEach(() => {
    process.env = { ...antes };
  });

  function montar(estado = 'ativo') {
    const prisma = {
      agent: { findFirst: async () => ({ estado, ativo: true }) },
      user: { findMany: async () => [PEDRO] },
    };
    const registro = new RepasseDoWhatsappRegistry();
    const svc = new RepasseAoHermesService(prisma as never, registro);
    const enviar = vi.fn(async () => new Response('{}', { status: 200 }));
    svc.enviar = enviar as never;
    svc.onModuleInit();
    return { svc, registro, enviar };
  }

  it('desligado sem as variáveis: não se inscreve', () => {
    delete process.env.ROOTINHA_WEBHOOK_URL;
    delete process.env.ROOTINHA_WEBHOOK_SEGREDO;
    const registro = new RepasseDoWhatsappRegistry();
    new RepasseAoHermesService({} as never, registro).onModuleInit();
    expect(registro.quantos).toBe(0);
  });

  it('ligado: manda o POST assinado, com prazo, e o corpo diz como responder', async () => {
    const m = montar();
    expect(m.registro.quantos).toBe(1);
    expect(await m.registro.repassar(ORG, evento())).toEqual(['RepasseAoHermesService:direta-da-equipe']);
    const [url, init] = m.enviar.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('http://172.16.0.1:8650/rootos');
    const corpo = String(init.body);
    expect(init.headers[CABECALHO_DA_ASSINATURA]).toBe(assinar(SEGREDO, init.headers[CABECALHO_DO_INSTANTE], corpo));
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(corpo)).toMatchObject({
      orgId: ORG, mensagemId: 'WAMID-1', deFora: false, pessoa: { id: 'u-pedro' },
      responderCom: { capacidade: 'whatsapp.conversa.responder', mensagemId: 'WAMID-1' },
    });
  });

  it('Rootinha pausada: silêncio', async () => {
    const m = montar('pausado');
    expect(await m.registro.repassar(ORG, evento())).toEqual([]);
    expect(m.enviar).not.toHaveBeenCalled();
  });

  it('grupo sem citar: não sai nada', async () => {
    const m = montar();
    expect(await m.registro.repassar(ORG, evento({ jid: '1203630@g.us', texto: 'bom dia' }))).toEqual([]);
    expect(m.enviar).not.toHaveBeenCalled();
  });

  it('Hermes fora do ar vira rótulo, não exceção', async () => {
    const m = montar();
    m.svc.enviar = (async () => { throw new Error('ECONNREFUSED'); }) as never;
    expect(await m.registro.repassar(ORG, evento())).toEqual(['RepasseAoHermesService:erro']);
  });
});

describe('A9: a entrada de sempre não muda', () => {
  it('o grupo inscrito (links, TR-12) continua recebendo; o repasse corre ao lado; a falha dele não derruba', async () => {
    const grupos = new EntradaDeGrupoRegistry();
    const doGrupo = vi.fn(async () => 'capturado');
    grupos.registrar('1203630@g.us', doGrupo, 'teste-links');
    const repasses = new RepasseDoWhatsappRegistry();
    const copia = vi.fn(async () => { throw new Error('Hermes caiu'); });
    repasses.registrar(copia, 'teste-rootinha');
    const canal = { receber: vi.fn(async () => ({ desfecho: 'canal' })) };
    const controller = new CanalDeAprovacaoController(canal as never, grupos, undefined, undefined, undefined, repasses);
    process.env.CANAL_APROVACAO_SEGREDO = 'c'.repeat(40);
    process.env.CANAL_APROVACAO_CODIGO_SEGREDO = 'd'.repeat(40);
    // O segredo do webhook é conferido antes; aqui o que importa é a cadeia em segundo plano.
    await (controller as unknown as { emSegundoPlano(o: string, c: unknown): Promise<void> }).emSegundoPlano(
      '11111111-1111-4111-8111-111111111111',
      evento({ jid: '1203630@g.us', texto: 'Rootinha, https://exemplo.com' }),
    );
    expect(doGrupo).toHaveBeenCalledTimes(1);
    expect(copia).toHaveBeenCalledTimes(1);
    expect(canal.receber).not.toHaveBeenCalled();
  });

  it('sem inscrito no repasse, a conversa direta segue para o canal como antes', async () => {
    const canal = { receber: vi.fn(async () => ({ desfecho: 'canal' })) };
    const controller = new CanalDeAprovacaoController(canal as never, new EntradaDeGrupoRegistry(), undefined, undefined, undefined, new RepasseDoWhatsappRegistry());
    await (controller as unknown as { emSegundoPlano(o: string, c: unknown): Promise<void> }).emSegundoPlano('11111111-1111-4111-8111-111111111111', evento());
    expect(canal.receber).toHaveBeenCalledTimes(1);
  });
});
