import { AgentEstado, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AuditService } from '../src/audit/audit.service';
import { CofreService } from '../src/cofre/cofre.service';
import { comContexto } from '../src/common/contexto-execucao';
import { EventLogService } from '../src/gateway/event-log.service';
import { InterruptoresRegistry } from '../src/gateway/interruptores.registry';
import { RegistroDeConectores } from '../src/integrations/conectores.registry';
import { ConectoresService } from '../src/integrations/conectores.service';
import { EvolutionDaEmpresaService } from '../src/pauta/evolution.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ExecutoresDeRotinaRegistry } from '../src/routines/executores.registry';
import { MODULO_DO_TIPO, TIPO_WHATSAPP_SINCRONIZAR } from '../src/routines/rotina.tipos';
import { GravadorDoWhatsappService } from '../src/whatsapp/gravador.service';
import {
  CRON_DO_WHATSAPP,
  POR_PAGINA,
  REVISITA_MS,
  SLUG_DA_ROTINA_DO_WHATSAPP,
  SincronizacaoDoWhatsappService,
} from '../src/whatsapp/sincronizacao.service';
import { exigirBancoDescartavel } from './banco-de-teste';
import { subirDubleEvolution, type DubleEvolution, type InstanciaNoDuble } from './evolution-duble';

/*
 * A ROTINA `whatsapp.sincronizar` (produção 22C, W1) — com banco e o dublê HTTP
 * da Evolution (`chat/findChats`, `group/fetchAllGroups`, `chat/findMessages`).
 *
 * Só leitura pela porta; cria e atualiza as conversas (nome, foto,
 * participantes), traz as mensagens que o webhook perdeu, idempotente com o
 * que o webhook já gravou, e a falha da Evolution não derruba nada.
 *
 * Números, nomes e textos daqui são FICTÍCIOS.
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (empresas, cofre, rotinas, conversas e mensagens do WhatsApp)');
if (Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64').length !== 32) process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

/** A empresa da casa é decidida pela suíte (o slug `root` é um só no banco). */
class SincronizacaoDeTeste extends SincronizacaoDoWhatsappService {
  casa = new Set<string>();
  protected override ehDaCasa(orgId: string): Promise<boolean> {
    return Promise.resolve(this.casa.has(orgId));
  }
}

describe('whatsapp: o contrato da rotina', () => {
  it('o tipo é do comercial (o prefixo whatsapp é do módulo leads)', () => {
    expect(TIPO_WHATSAPP_SINCRONIZAR).toBe('whatsapp.sincronizar');
    expect(MODULO_DO_TIPO[TIPO_WHATSAPP_SINCRONIZAR]).toBe('leads');
    expect(CRON_DO_WHATSAPP).toBe('*/5 * * * *');
  });
});

describe.skipIf(!URL)('whatsapp: a sincronização com banco e dublê', () => {
  const MARCA = `ws${Date.now().toString(36).slice(-6)}`;
  const CASA = `org-wsa-${MARCA}`;
  const FORA = `org-wsb-${MARCA}`;
  const SEM = `org-wsc-${MARCA}`;
  const CHAVE_A = `chave-a-${MARCA}-inventada`;
  const CHAVE_B = `chave-b-${MARCA}-inventada`;
  const NUM = '5532900000011';
  const NUM2 = '5532900000012';
  const NUM_LID = '5532900000013';
  const LID = '577215664901532@lid';
  const GRUPO = '120363000000000101@g.us';
  const GRUPO_QUIETO = '120363000000000102@g.us';
  const T0 = 1792681200;

  let prisma: PrismaClient;
  let duble: DubleEvolution;
  let evo: EvolutionDaEmpresaService;
  let conectores: ConectoresService;
  let gravador: GravadorDoWhatsappService;
  let sinc: SincronizacaoDeTeste;
  let executores: ExecutoresDeRotinaRegistry;
  const casar = vi.fn(async () => undefined);

  const em = <T>(orgId: string, fn: () => Promise<T>): Promise<T> => comContexto({ orgId, correlationId: `ws-${MARCA}`, origem: 'http' }, fn);
  const inst = (): InstanciaNoDuble => duble.contas.get(CHAVE_A)!['inst-a'];
  const msg = (remoteJid: string, id: string, segundos: number, texto: string, extra: Record<string, unknown> = {}) => ({
    id: `uuid-${id}`,
    key: { remoteJid, fromMe: false, id, ...extra },
    pushName: 'Café Serra (exemplo)',
    messageType: 'conversation',
    message: { conversation: texto },
    messageTimestamp: T0 + segundos,
    instanceId: 'uuid-da-instancia',
    source: 'android',
  });
  const conversa = (chatJid: string) => prisma.whatsAppConversa.findUniqueOrThrow({ where: { orgId_instancia_chatJid: { orgId: CASA, instancia: 'inst-a', chatJid } } });
  const doChat = async (chatJid: string) => {
    const c = await conversa(chatJid);
    return prisma.whatsAppMensagem.findMany({ where: { conversaId: c.id }, orderBy: { timestamp: 'asc' } });
  };
  const pedidosDe = (rota: string) => duble.pedidos.filter((p) => p.caminho.startsWith(rota)).length;

  beforeAll(async () => {
    duble = await subirDubleEvolution({
      [CHAVE_A]: {
        'inst-a': {
          estado: 'open',
          chats: [
            { id: 'c1', remoteJid: `${NUM}@s.whatsapp.net`, pushName: 'Café Serra (exemplo)', profilePicUrl: 'https://pps.exemplo/c1.jpg', lastMessage: { messageTimestamp: T0 + 30 } },
            { id: 'c2', remoteJid: LID, pushName: 'Pessoa Lid (exemplo)', lastMessage: { key: { remoteJid: LID, remoteJidAlt: `${NUM_LID}@s.whatsapp.net` }, messageTimestamp: T0 + 40 } },
            { id: 'c3', remoteJid: GRUPO, pushName: 'quem falou por último', lastMessage: { messageTimestamp: T0 + 50 } },
            { id: 'c4', remoteJid: 'status@broadcast' },
          ],
          grupos: [
            {
              id: GRUPO, subject: 'ROOT | Café Serra (exemplo)', pictureUrl: 'https://pps.exemplo/g1.jpg', size: 3,
              participants: [{ id: `${NUM}@s.whatsapp.net`, admin: 'superadmin' }, { id: '99887766554433@lid', phoneNumber: `${NUM2}@s.whatsapp.net`, admin: null }, { id: `${NUM2}9@s.whatsapp.net`, admin: 'admin' }],
            },
            { id: GRUPO_QUIETO, subject: 'Estratégia e Produto (exemplo)', size: 2, participants: [{ id: `${NUM}@s.whatsapp.net` }, { id: `${NUM2}@s.whatsapp.net` }] },
          ],
          mensagens: {
            [`${NUM}@s.whatsapp.net`]: [
              msg(`${NUM}@s.whatsapp.net`, `${MARCA}-a1`, 10, 'Oi'),
              msg(`${NUM}@s.whatsapp.net`, `${MARCA}-a2`, 20, 'Bom dia, tudo certo', { fromMe: true }),
              msg(`${NUM}@s.whatsapp.net`, `${MARCA}-a3`, 30, 'Obrigado'),
            ],
            [LID]: [msg(LID, `${MARCA}-l1`, 40, 'pelo lid', { remoteJidAlt: `${NUM_LID}@s.whatsapp.net` })],
            [GRUPO]: [
              msg(GRUPO, `${MARCA}-g1`, 45, 'Bem-vindos', { fromMe: true }),
              msg(GRUPO, `${MARCA}-g2`, 50, 'Obrigada!', { participant: `${NUM2}@s.whatsapp.net` }),
            ],
          },
        },
      },
      [CHAVE_B]: { 'inst-b': { estado: 'open', chats: [{ remoteJid: `${NUM}@s.whatsapp.net` }] } },
    });
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    for (const [id, nome] of [[CASA, 'A'], [FORA, 'B'], [SEM, 'C']]) {
      await prisma.org.create({ data: { id, name: `Sincronização ${nome} ${MARCA}`, slug: `ws-${nome.toLowerCase()}-${MARCA}` } });
    }
    const p = prisma as unknown as PrismaService;
    const eventos = new EventLogService(p);
    const interruptores = new InterruptoresRegistry();
    conectores = new ConectoresService(p, new AuditService(p), eventos, interruptores);
    conectores.onModuleInit();
    const registro = new RegistroDeConectores();
    evo = new EvolutionDaEmpresaService(p, new CofreService(p, eventos), registro, interruptores);
    await em(CASA, () => evo.guardarCredencial(CASA, { url: duble.url, chave: CHAVE_A, instancia: 'inst-a' }, null));
    await em(FORA, () => evo.guardarCredencial(FORA, { url: duble.url, chave: CHAVE_B, instancia: 'inst-b' }, null));

    gravador = new GravadorDoWhatsappService(p, undefined, evo, registro, { casarConversa: casar } as never, undefined);
    executores = new ExecutoresDeRotinaRegistry();
    sinc = new SincronizacaoDeTeste(p, gravador, evo, executores);
    sinc.onModuleInit();
    sinc.casa.add(CASA);
    sinc.casa.add(SEM);
  });

  afterAll(async () => {
    await duble?.fechar();
    if (!prisma) return;
    const orgs = [CASA, FORA, SEM];
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
      prisma.$executeRawUnsafe('DELETE FROM "EventLog" WHERE "orgId" = ANY($1::text[])', orgs),
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
    ]);
    await prisma.whatsAppMensagem.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.whatsAppConversa.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.rotina.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.auditLog.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.segredoDeConector.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.conectorDesligado.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.org.deleteMany({ where: { id: { in: orgs } } });
    await prisma.$disconnect();
  });

  it('o executor do tipo está inscrito', () => {
    expect(executores.tem('whatsapp.sincronizar')).toBe(true);
    expect(executores.donoDe('whatsapp.sincronizar')).toBe('SincronizacaoDoWhatsappService');
  });

  it('garantirRotina: só na casa, LIGADA, a cada 5 min em São Paulo, idempotente e sem desfazer a pausa', async () => {
    await sinc.garantirRotina(FORA);
    expect(await prisma.rotina.count({ where: { orgId: FORA } })).toBe(0);
    await sinc.garantirRotina(CASA);
    await sinc.garantirRotina(CASA);
    const [r] = await prisma.rotina.findMany({ where: { orgId: CASA } });
    expect(r).toMatchObject({ slug: SLUG_DA_ROTINA_DO_WHATSAPP, tipo: 'whatsapp.sincronizar', cron: '*/5 * * * *', tz: 'America/Sao_Paulo', ativo: true, estado: AgentEstado.rodando });
    expect(r.proximaExecucaoEm).not.toBeNull();
    await prisma.rotina.update({ where: { id: r.id }, data: { ativo: false, estado: AgentEstado.pausado } });
    const outro = new SincronizacaoDeTeste(prisma as unknown as PrismaService, gravador, evo);
    outro.casa.add(CASA);
    await outro.garantirRotina(CASA);
    expect(await prisma.rotina.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ ativo: false, estado: AgentEstado.pausado });
    expect(await prisma.rotina.count({ where: { orgId: CASA } })).toBe(1);
    // nunca lança, nem com empresa vazia
    await expect(sinc.garantirRotina('')).resolves.toBeUndefined();
  });

  it('pulada: fora da casa, sem Evolution configurada e com o conector desligado', async () => {
    expect(await em(FORA, () => sinc.passagem(FORA))).toMatchObject({ status: 'pulada', resumo: expect.stringContaining('empresa da casa') });
    expect(await em(SEM, () => sinc.passagem(SEM))).toMatchObject({ status: 'pulada', resumo: expect.stringContaining('não configurada') });
    await em(SEM, () => conectores.desligar(SEM, 'evolution', { motivo: 'teste', actorId: 'suite' }));
    expect(await em(SEM, () => sinc.passagem(SEM))).toMatchObject({ status: 'pulada', resumo: expect.stringContaining('desligado') });
    expect(await prisma.whatsAppConversa.count({ where: { orgId: { in: [FORA, SEM] } } })).toBe(0);
  });

  it('a primeira passagem cria as conversas (nome, foto, participantes) e traz as mensagens, sem somar não lidas', async () => {
    const r = await em(CASA, () => sinc.passagem(CASA, new Date((T0 + 60) * 1000)));
    expect(r.status).toBe('ok');
    expect(r.resumo).toMatch(/^4 conversa\(s\) \(4 nova\(s\), 2 grupo\(s\)\); 6 mensagem\(ns\) lida\(s\), 6 gravada\(s\) agora\.$/);

    const umAum = await conversa(`${NUM}@s.whatsapp.net`);
    expect(umAum).toMatchObject({ grupo: false, nome: 'Café Serra (exemplo)', fotoUrl: 'https://pps.exemplo/c1.jpg', naoLidas: 0 });
    expect(umAum.sincronizadaEm).not.toBeNull();
    expect(umAum.ultimaMensagemEm?.getTime()).toBe((T0 + 30) * 1000);
    expect((await doChat(`${NUM}@s.whatsapp.net`)).map((m) => [m.mensagemExternaId, m.direcao, m.origem])).toEqual([
      [`${MARCA}-a1`, 'entrada', 'sincronizacao'],
      [`${MARCA}-a2`, 'saida', 'sincronizacao'],
      [`${MARCA}-a3`, 'entrada', 'sincronizacao'],
    ]);

    const doLid = await conversa(`${NUM_LID}@s.whatsapp.net`);
    expect(doLid).toMatchObject({ lidJid: LID, nome: 'Pessoa Lid (exemplo)' });
    expect(await doChat(`${NUM_LID}@s.whatsapp.net`)).toHaveLength(1);

    const grupo = await conversa(GRUPO);
    expect(grupo).toMatchObject({ grupo: true, nome: 'ROOT | Café Serra (exemplo)', fotoUrl: 'https://pps.exemplo/g1.jpg', participantes: 3, naoLidas: 0 });
    expect(grupo.participantesLista).toEqual([
      { numero: NUM, nome: null, admin: true },
      { numero: NUM2, nome: null, admin: false },
      { numero: `${NUM2}9`, nome: null, admin: true },
    ]);
    expect((await doChat(GRUPO)).find((m) => !m.deMim)).toMatchObject({ remetenteNumero: NUM2 });

    const quieto = await conversa(GRUPO_QUIETO);
    expect(quieto).toMatchObject({ grupo: true, nome: 'Estratégia e Produto (exemplo)', participantes: 2 });
    expect(await doChat(GRUPO_QUIETO)).toHaveLength(0);

    expect(await prisma.whatsAppConversa.count({ where: { orgId: CASA } })).toBe(4);
    for (const c of [umAum, doLid, grupo, quieto]) expect(casar).toHaveBeenCalledWith(CASA, c.id);
    // só leitura: nada foi enviado
    expect(pedidosDe('/message/sendText')).toBe(0);
    expect(duble.pedidos.filter((p) => p.caminho.startsWith('/chat/findMessages')).every((p) => p.apikey === CHAVE_A)).toBe(true);
  });

  it('sem novidade, a passagem seguinte não pede mensagens', async () => {
    const antes = pedidosDe('/chat/findMessages');
    const r = await em(CASA, () => sinc.passagem(CASA, new Date((T0 + 120) * 1000)));
    expect(r).toMatchObject({ status: 'ok' });
    expect(r.resumo).toContain('0 gravada(s) agora');
    expect(pedidosDe('/chat/findMessages')).toBe(antes);
  });

  it('o que o webhook perdeu entra (e soma não lida, por ser mais novo que a sincronização anterior); o que ele gravou não duplica', async () => {
    const jid = `${NUM}@s.whatsapp.net`;
    // o webhook gravou uma; a outra ele perdeu
    const recebida = { event: 'messages.upsert', instance: 'inst-a', data: msg(jid, `${MARCA}-a4`, 200, 'chegou pelo webhook') };
    expect(await em(CASA, () => gravador.gravar(CASA, recebida))).toBe('gravada');
    inst().mensagens![jid].push(msg(jid, `${MARCA}-a4`, 200, 'chegou pelo webhook'), msg(jid, `${MARCA}-a5`, 210, 'o webhook perdeu esta'));
    inst().chats![0] = { ...(inst().chats![0] as object), lastMessage: { messageTimestamp: T0 + 210 } };

    const r = await em(CASA, () => sinc.passagem(CASA, new Date((T0 + 300) * 1000)));
    expect(r.status).toBe('ok');
    const linhas = await doChat(jid);
    expect(linhas.map((m) => m.mensagemExternaId)).toEqual([`${MARCA}-a1`, `${MARCA}-a2`, `${MARCA}-a3`, `${MARCA}-a4`, `${MARCA}-a5`]);
    expect(linhas.find((m) => m.mensagemExternaId === `${MARCA}-a4`)!.origem).toBe('webhook');
    expect(linhas.find((m) => m.mensagemExternaId === `${MARCA}-a5`)!.origem).toBe('sincronizacao');
    // 1 do webhook + 1 da sincronização (mais nova que a sincronização anterior)
    const c = await conversa(jid);
    expect(c.naoLidas).toBe(2);
    expect(c.ultimaMensagemEm?.getTime()).toBe((T0 + 210) * 1000);
  });

  it('grupo renomeado acompanha o assunto; o nome do 1:1 não é trocado', async () => {
    inst().grupos![0] = { ...(inst().grupos![0] as object), subject: 'ROOT | Café Serra Novo (exemplo)' };
    inst().chats![0] = { ...(inst().chats![0] as object), pushName: 'Outro Nome (exemplo)' };
    await em(CASA, () => sinc.passagem(CASA, new Date((T0 + 400) * 1000)));
    expect((await conversa(GRUPO)).nome).toBe('ROOT | Café Serra Novo (exemplo)');
    expect((await conversa(`${NUM}@s.whatsapp.net`)).nome).toBe('Café Serra (exemplo)');
  });

  it('paginação: até 3 páginas na primeira vez; depois para na página que só traz o que já estava gravado', async () => {
    const jid = '5532900000014@s.whatsapp.net';
    inst().mensagens![jid] = Array.from({ length: 120 }, (_, i) => msg(jid, `${MARCA}-p${i}`, 500 + i, `mensagem ${i}`));
    inst().chats!.push({ id: 'c5', remoteJid: jid, pushName: 'Muitas (exemplo)', lastMessage: { messageTimestamp: T0 + 619 } });
    const antes = pedidosDe('/chat/findMessages');
    await em(CASA, () => sinc.passagem(CASA, new Date((T0 + 700) * 1000)));
    expect(pedidosDe('/chat/findMessages') - antes).toBe(Math.ceil(120 / POR_PAGINA));
    expect(await doChat(jid)).toHaveLength(120);
    expect((await conversa(jid)).naoLidas).toBe(0);

    inst().mensagens![jid].push(msg(jid, `${MARCA}-p120`, 800, 'nova'));
    inst().chats![inst().chats!.length - 1] = { id: 'c5', remoteJid: jid, lastMessage: { messageTimestamp: T0 + 800 } };
    const antes2 = pedidosDe('/chat/findMessages');
    await em(CASA, () => sinc.passagem(CASA, new Date((T0 + 900) * 1000)));
    // a página 1 trouxe uma nova; a 2 só o que já estava: para ali
    expect(pedidosDe('/chat/findMessages') - antes2).toBe(2);
    expect(await doChat(jid)).toHaveLength(121);
    expect((await conversa(jid)).naoLidas).toBe(1);
  });

  it('chat sem a última mensagem: conferido de novo só depois da revisita', async () => {
    const jid = '5532900000015@s.whatsapp.net';
    inst().chats!.push({ id: 'c6', remoteJid: jid, pushName: 'Sem data (exemplo)' });
    inst().mensagens![jid] = [msg(jid, `${MARCA}-s1`, 1000, 'oi')];
    const base = (T0 + 2000) * 1000;
    await em(CASA, () => sinc.passagem(CASA, new Date(base)));
    expect(await doChat(jid)).toHaveLength(1);
    inst().mensagens![jid].push(msg(jid, `${MARCA}-s2`, 1100, 'perdida'));
    await em(CASA, () => sinc.passagem(CASA, new Date(base + 60_000)));
    expect(await doChat(jid)).toHaveLength(1);
    await em(CASA, () => sinc.passagem(CASA, new Date(base + REVISITA_MS + 1000)));
    expect(await doChat(jid)).toHaveLength(2);
  });

  it('a Evolution falhando não derruba nada: erro com resumo de contagens, sem nome nem número, e a próxima tenta de novo', async () => {
    inst().falhar = ['findChats', 'fetchAllGroups'];
    const r = await em(CASA, () => sinc.passagem(CASA, new Date((T0 + 5000) * 1000)));
    expect(r.status).toBe('erro');
    expect(r.resumo).toMatch(/2 leitura\(s\) falharam/);
    expect(r.resumo).not.toMatch(/\d{10,}|Café|exemplo|@/);

    // as mensagens falhando: as conversas seguem atualizadas, a conversa não ganha sincronizadaEm
    inst().falhar = ['findMessages'];
    const jid = `${NUM}@s.whatsapp.net`;
    const antes = (await conversa(jid)).sincronizadaEm;
    inst().mensagens![jid].push(msg(jid, `${MARCA}-a6`, 6000, 'durante a falha'));
    inst().chats![0] = { ...(inst().chats![0] as object), lastMessage: { messageTimestamp: T0 + 6000 } };
    const r2 = await em(CASA, () => sinc.passagem(CASA, new Date((T0 + 6100) * 1000)));
    expect(r2.status).toBe('erro');
    expect((await conversa(jid)).sincronizadaEm).toEqual(antes);

    inst().falhar = [];
    const r3 = await em(CASA, () => sinc.passagem(CASA, new Date((T0 + 6200) * 1000)));
    expect(r3.status).toBe('ok');
    expect((await doChat(jid)).some((m) => m.mensagemExternaId === `${MARCA}-a6`)).toBe(true);
  });

  it('o executor inscrito roda a mesma passagem', async () => {
    const r = await em(CASA, () =>
      executores.executar('whatsapp.sincronizar', { orgId: CASA, rotinaId: 'r', slug: SLUG_DA_ROTINA_DO_WHATSAPP, config: {}, refExterna: null, origem: 'manual', correlationId: 'c', agora: new Date((T0 + 7000) * 1000) }),
    );
    expect(r.status).toBe('ok');
  });
});
