import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AuditService } from '../src/audit/audit.service';
import { CofreService } from '../src/cofre/cofre.service';
import { comContexto } from '../src/common/contexto-execucao';
import { EvolutionEntradaService } from '../src/comercial/evolution-entrada.service';
import { CanalDeAprovacaoController } from '../src/gateway/canais/canal-de-aprovacao.controller';
import { segredoDoCanalDaEmpresa } from '../src/gateway/canais/configuracao-do-canal';
import { EntradaDeGrupoRegistry } from '../src/gateway/canais/entrada-de-grupo.registry';
import { EntradaDiretaRegistry } from '../src/gateway/canais/entrada-direta.registry';
import { GravacaoDoWhatsappRegistry } from '../src/gateway/canais/gravacao-do-whatsapp.registry';
import { EventLogService } from '../src/gateway/event-log.service';
import { InterruptoresRegistry } from '../src/gateway/interruptores.registry';
import { RegistroDeConectores } from '../src/integrations/conectores.registry';
import { ConectoresService } from '../src/integrations/conectores.service';
import { EvolutionDaEmpresaService } from '../src/pauta/evolution.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { GravadorDoWhatsappService } from '../src/whatsapp/gravador.service';
import { exigirBancoDescartavel } from './banco-de-teste';
import { subirDubleEvolution, type DubleEvolution } from './evolution-duble';

/*
 * TUDO O QUE CHEGA FICA GRAVADO (produção 22C, W1) — com banco e o dublê HTTP
 * da Evolution.
 *
 * O webhook do canal grava PRIMEIRO (1:1, grupo, fromMe, @lid, mídia só com
 * metadados), é idempotente (a reentrega não duplica nem soma não lida), só
 * grava com a instância desta empresa no corpo e com o conector ligado, e — o
 * principal — OS LEITORES DE SEMPRE CONTINUAM RECEBENDO O MESMO CORPO, na
 * mesma ordem: grupo de links → entrada do lead → canal de aprovação.
 *
 * Números, nomes e textos daqui são FICTÍCIOS.
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (empresas, cofre, conversas e mensagens do WhatsApp)');
if (Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64').length !== 32) process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

describe.skipIf(!URL)('whatsapp: o webhook grava antes dos leitores', () => {
  const MARCA = `wg${Date.now().toString(36).slice(-6)}`;
  const ORG_A = `org-wga-${MARCA}`;
  const ORG_B = `org-wgb-${MARCA}`;
  const CHAVE_A = `chave-a-${MARCA}-inventada`;
  const CHAVE_B = `chave-b-${MARCA}-inventada`;
  const SEGREDO_DO_CANAL = `canal-${MARCA}-transporte-0123456789`;
  const SEGREDO_DO_CODIGO = `canal-${MARCA}-codigo-9876543210ab`;
  const NUM = '5532900000001';
  const NUM_LEAD = '5532900000009';
  const NUM2 = '5532900000002';
  const GRUPO = '120363000000000077@g.us';
  const GRUPO_DE_LINKS = '120363000000000088@g.us';
  const LID = '271828182845904@lid';
  const T0 = 1792681200;

  let prisma: PrismaClient;
  let duble: DubleEvolution;
  let evo: EvolutionDaEmpresaService;
  let registro: RegistroDeConectores;
  let conectores: ConectoresService;
  let gravador: GravadorDoWhatsappService;
  let gravacao: GravacaoDoWhatsappRegistry;
  let entrada: EvolutionEntradaService;
  let diretas: EntradaDiretaRegistry;
  let grupos: EntradaDeGrupoRegistry;
  const casar = vi.fn(async () => undefined);
  const garantirRotina = vi.fn(async () => undefined);
  const receberDoLead = vi.fn(async () => ({ eventoId: 'e', novo: true }));
  const doGrupoDeLinks = vi.fn(async () => 'captura');
  const ambienteAntes = { ...process.env };
  let leadId = '';

  const em = <T>(orgId: string, fn: () => Promise<T>): Promise<T> => comContexto({ orgId, correlationId: `wg-${MARCA}`, origem: 'http' }, fn);

  const corpo = (key: Record<string, unknown>, message: Record<string, unknown>, extra: Record<string, unknown> = {}, instancia: string | null = 'inst-a') => ({
    event: 'messages.upsert',
    ...(instancia ? { instance: instancia } : {}),
    apikey: 'a-chave-da-instancia-vem-no-corpo',
    data: {
      key: { remoteJid: `${NUM}@s.whatsapp.net`, fromMe: false, id: `${MARCA}-1`, ...key },
      pushName: 'Café Serra (exemplo)',
      messageType: Object.keys(message)[0] ?? 'conversation',
      message,
      messageTimestamp: T0,
      ...extra,
    },
  });
  const conversas = (orgId: string) => prisma.whatsAppConversa.findMany({ where: { orgId }, orderBy: { criadoEm: 'asc' } });
  const mensagens = (orgId: string) => prisma.whatsAppMensagem.findMany({ where: { orgId }, orderBy: { criadoEm: 'asc' } });

  /** O controlador como o arranque o monta: com o registro de gravação inscrito. */
  const controlador = (canal: { receber: (...a: unknown[]) => Promise<{ desfecho: string }> }, comGravacao = true) =>
    new CanalDeAprovacaoController(canal as never, grupos, diretas, undefined, comGravacao ? gravacao : undefined);

  const entregar = async (c: CanalDeAprovacaoController, orgId: string, body: unknown) => {
    const r = await c.whatsapp(orgId, segredoDoCanalDaEmpresa(orgId)!, body);
    await c.trabalhoEmCurso;
    return r;
  };

  beforeAll(async () => {
    process.env.WHATSAPP_PROVEDOR = 'evolution';
    process.env.CANAL_APROVACAO_SEGREDO = SEGREDO_DO_CANAL;
    process.env.CANAL_APROVACAO_CODIGO_SEGREDO = SEGREDO_DO_CODIGO;
    duble = await subirDubleEvolution({
      [CHAVE_A]: { 'inst-a': { estado: 'open' } },
      [CHAVE_B]: { 'inst-b': { estado: 'open' } },
    });
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    for (const [id, nome] of [[ORG_A, 'A'], [ORG_B, 'B']]) {
      await prisma.org.create({ data: { id, name: `WhatsApp ${nome} ${MARCA}`, slug: `wg-${nome.toLowerCase()}-${MARCA}` } });
    }
    leadId = (await prisma.lead.create({ data: { orgId: ORG_A, name: 'Lead (exemplo)', phone: NUM_LEAD, status: 'novo' }, select: { id: true } })).id;

    const p = prisma as unknown as PrismaService;
    const eventos = new EventLogService(p);
    const interruptores = new InterruptoresRegistry();
    conectores = new ConectoresService(p, new AuditService(p), eventos, interruptores);
    conectores.onModuleInit();
    registro = new RegistroDeConectores();
    evo = new EvolutionDaEmpresaService(p, new CofreService(p, eventos), registro, interruptores);
    evo.onModuleInit();
    await em(ORG_A, () => evo.guardarCredencial(ORG_A, { url: duble.url, chave: CHAVE_A, instancia: 'inst-a' }, null));
    await em(ORG_B, () => evo.guardarCredencial(ORG_B, { url: duble.url, chave: CHAVE_B, instancia: 'inst-b' }, null));

    gravacao = new GravacaoDoWhatsappRegistry();
    gravador = new GravadorDoWhatsappService(p, gravacao, evo, registro, { casarConversa: casar } as never, { garantirRotina } as never);
    gravador.onModuleInit();

    // Os leitores de sempre: a entrada do lead DE VERDADE (só o fio do comercial é dublê) e o grupo de links.
    diretas = new EntradaDiretaRegistry(p);
    entrada = new EvolutionEntradaService(p, { receberDoLead } as never, {} as never, evo, diretas);
    entrada.onModuleInit();
    grupos = new EntradaDeGrupoRegistry();
    grupos.registrar(GRUPO_DE_LINKS, doGrupoDeLinks, 'suíte');
  });

  afterAll(async () => {
    for (const k of ['WHATSAPP_PROVEDOR', 'CANAL_APROVACAO_SEGREDO', 'CANAL_APROVACAO_CODIGO_SEGREDO']) {
      if (ambienteAntes[k] === undefined) delete process.env[k];
      else process.env[k] = ambienteAntes[k];
    }
    await duble?.fechar();
    if (!prisma) return;
    const orgs = [ORG_A, ORG_B];
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
      prisma.$executeRawUnsafe('DELETE FROM "EventLog" WHERE "orgId" = ANY($1::text[])', orgs),
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
    ]);
    await prisma.whatsAppMensagem.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.whatsAppConversa.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.lead.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.auditLog.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.segredoDeConector.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.conectorDesligado.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.org.deleteMany({ where: { id: { in: orgs } } });
    await prisma.$disconnect();
  });

  it('o gravador se inscreveu no registro da porta', () => {
    expect(gravacao.inscrito).toBe(true);
  });

  it('1:1 de entrada pelo webhook: conversa canônica, mensagem com origem webhook, 1 não lida, nome pelo pushName', async () => {
    const canal = { receber: vi.fn(async () => ({ desfecho: 'canal' })) };
    expect(await entregar(controlador(canal), ORG_A, corpo({}, { conversation: 'Oi, quero saber mais' }))).toEqual({ ok: true });
    const [c] = await conversas(ORG_A);
    expect(c).toMatchObject({ instancia: 'inst-a', chatJid: `${NUM}@s.whatsapp.net`, grupo: false, nome: 'Café Serra (exemplo)', naoLidas: 1 });
    expect(c.ultimaMensagemEm?.getTime()).toBe(T0 * 1000);
    const [m] = await mensagens(ORG_A);
    expect(m).toMatchObject({
      conversaId: c.id, orgId: ORG_A, origem: 'webhook', direcao: 'entrada', deMim: false, tipo: 'conversation',
      texto: 'Oi, quero saber mais', remetenteNumero: NUM, remetenteJid: `${NUM}@s.whatsapp.net`, mensagemExternaId: `${MARCA}-1`,
    });
    expect(casar).toHaveBeenCalledWith(ORG_A, c.id);
    expect(garantirRotina).toHaveBeenCalledWith(ORG_A);
    // e o canal recebeu como sempre (o número não é lead nem identidade)
    expect(canal.receber).toHaveBeenCalledTimes(1);
  });

  it('a duplicata (reentrega ou a mesma pela sincronização) não duplica nem soma não lida', async () => {
    expect(await em(ORG_A, () => gravador.gravar(ORG_A, corpo({}, { conversation: 'Oi, quero saber mais' })))).toBe('repetida');
    expect(await mensagens(ORG_A)).toHaveLength(1);
    expect((await conversas(ORG_A))[0].naoLidas).toBe(1);
  });

  it('fromMe (a casa pelo celular): saída, não soma não lida, não troca o nome', async () => {
    expect(await em(ORG_A, () => gravador.gravar(ORG_A, corpo({ id: `${MARCA}-2`, fromMe: true }, { conversation: 'Bom dia!' }, { pushName: 'Root (exemplo)', messageTimestamp: T0 + 60 })))).toBe('gravada');
    const [c] = await conversas(ORG_A);
    expect(c).toMatchObject({ naoLidas: 1, nome: 'Café Serra (exemplo)' });
    expect(c.ultimaMensagemEm?.getTime()).toBe((T0 + 60) * 1000);
    const m = (await mensagens(ORG_A)).at(-1)!;
    expect(m).toMatchObject({ deMim: true, direcao: 'saida', remetenteJid: null, remetenteNumero: null, texto: 'Bom dia!' });
  });

  it('mensagem mais velha não volta a última mensagem da conversa', async () => {
    await em(ORG_A, () => gravador.gravar(ORG_A, corpo({ id: `${MARCA}-velha` }, { conversation: 'antiga' }, { messageTimestamp: T0 - 3600 })));
    expect((await conversas(ORG_A))[0].ultimaMensagemEm?.getTime()).toBe((T0 + 60) * 1000);
  });

  it('grupo: conversa @g.us sem nome, remetente é o participante, mídia só com metadados', async () => {
    const r = await em(ORG_A, () =>
      gravador.gravar(
        ORG_A,
        corpo(
          { id: `${MARCA}-g1`, remoteJid: GRUPO, participant: '99887766554433@lid', participantAlt: `${NUM2}@s.whatsapp.net` },
          { imageMessage: { mimetype: 'image/jpeg', caption: 'foto da obra', fileLength: 1234, url: 'https://mmg.whatsapp.net/x', mediaKey: 'CHAVE-DA-MIDIA', jpegThumbnail: 'AAAA' }, base64: 'QkFTRTY0' },
          { pushName: 'Participante (exemplo)' },
        ),
      ),
    );
    expect(r).toBe('gravada');
    const c = (await conversas(ORG_A)).find((x) => x.grupo)!;
    expect(c).toMatchObject({ chatJid: GRUPO, nome: null, naoLidas: 1 });
    const m = (await mensagens(ORG_A)).find((x) => x.conversaId === c.id)!;
    expect(m).toMatchObject({ grupo: true, tipo: 'image', texto: 'foto da obra', remetenteNumero: NUM2, remetenteNome: 'Participante (exemplo)' });
    expect(m.midia).toEqual({ mime: 'image/jpeg', nome: null, tamanho: 1234, segundos: null });
    expect(JSON.stringify(m)).not.toMatch(/CHAVE-DA-MIDIA|mmg\.whatsapp|QkFTRTY0|AAAA/);
  });

  it('@lid sem o número: conversa no lid; depois, com o número ao lado, a MESMA conversa passa a ser a do número', async () => {
    await em(ORG_A, () => gravador.gravar(ORG_A, corpo({ id: `${MARCA}-l1`, remoteJid: LID }, { conversation: 'oi pelo lid' }, { pushName: 'Pessoa Lid (exemplo)' })));
    const antes = (await conversas(ORG_A)).find((x) => x.chatJid === LID)!;
    expect(antes).toMatchObject({ lidJid: null, nome: 'Pessoa Lid (exemplo)', naoLidas: 1 });
    expect((await mensagens(ORG_A)).find((x) => x.mensagemExternaId === `${MARCA}-l1`)).toMatchObject({ remetenteNumero: null, chatJid: LID });

    await em(ORG_A, () => gravador.gravar(ORG_A, corpo({ id: `${MARCA}-l2`, remoteJid: LID, remoteJidAlt: '5532900000003@s.whatsapp.net' }, { conversation: 'agora com número' }, { messageTimestamp: T0 + 120 })));
    const depois = (await conversas(ORG_A)).find((x) => x.id === antes.id)!;
    expect(depois).toMatchObject({ chatJid: '5532900000003@s.whatsapp.net', lidJid: LID, naoLidas: 2 });
    const doLid = (await mensagens(ORG_A)).filter((x) => x.conversaId === antes.id);
    expect(doLid.map((x) => x.chatJid)).toEqual(['5532900000003@s.whatsapp.net', '5532900000003@s.whatsapp.net']);
    expect(doLid.at(-1)).toMatchObject({ remetenteNumero: '5532900000003' });

    // e o que vier só com o lid de novo cai na conversa do número
    await em(ORG_A, () => gravador.gravar(ORG_A, corpo({ id: `${MARCA}-l3`, remoteJid: LID }, { conversation: 'de novo só lid' })));
    expect((await mensagens(ORG_A)).find((x) => x.mensagemExternaId === `${MARCA}-l3`)!.conversaId).toBe(antes.id);
    expect((await conversas(ORG_A)).filter((x) => x.chatJid === LID || x.lidJid === LID)).toHaveLength(1);
  });

  it('@lid com o número já na primeira mensagem: conversa do número, lid guardado', async () => {
    const lid2 = '314159265358979@lid';
    await em(ORG_A, () => gravador.gravar(ORG_A, corpo({ id: `${MARCA}-l4`, remoteJid: lid2, senderPn: '5532900000004@s.whatsapp.net' }, { conversation: 'oi' })));
    expect((await conversas(ORG_A)).find((x) => x.lidJid === lid2)).toMatchObject({ chatJid: '5532900000004@s.whatsapp.net' });
  });

  it('outra instância, sem instância, recado e evento que não é mensagem: nada é gravado', async () => {
    const antes = (await mensagens(ORG_A)).length;
    expect(await em(ORG_A, () => gravador.gravar(ORG_A, corpo({ id: `${MARCA}-x1` }, { conversation: 'x' }, {}, 'inst-b')))).toBe('ignorado: outra instância');
    expect(await em(ORG_A, () => gravador.gravar(ORG_A, corpo({ id: `${MARCA}-x2` }, { conversation: 'x' }, {}, null)))).toBe('ignorado: sem instância');
    expect(await em(ORG_A, () => gravador.gravar(ORG_A, corpo({ id: `${MARCA}-x3`, remoteJid: 'status@broadcast' }, { conversation: 'x' })))).toBe('ignorado: status ou lista de transmissão');
    expect(await em(ORG_A, () => gravador.gravar(ORG_A, { event: 'messages.update', instance: 'inst-a', data: {} }))).toBe('ignorado: evento messages.update');
    expect(await em(ORG_A, () => gravador.gravar(ORG_A, 'lixo'))).toBe('ignorado: corpo vazio');
    expect((await mensagens(ORG_A)).length).toBe(antes);
  });

  it('connection.update esquece a sonda guardada da Evolution desta empresa (Conexões mede de novo)', async () => {
    const esquecer = vi.spyOn(registro, 'esquecer');
    expect(await em(ORG_A, () => gravador.gravar(ORG_A, { event: 'connection.update', instance: 'inst-a', data: { instance: 'inst-a', state: 'close', wuid: `${NUM}@s.whatsapp.net` } }))).toBe('conexão: close');
    expect(esquecer).toHaveBeenCalledWith(ORG_A, 'evolution');
    esquecer.mockClear();
    expect(await em(ORG_A, () => gravador.gravar(ORG_A, { event: 'connection.update', instance: 'inst-b', data: { state: 'open' } }))).toBe('ignorado: outra instância');
    expect(esquecer).not.toHaveBeenCalled();
    esquecer.mockRestore();
  });

  it('empresas separadas: a mesma mensagem na B é outra linha, da B; a B não toca a conversa da A', async () => {
    const antesA = await conversas(ORG_A);
    expect(await em(ORG_B, () => gravador.gravar(ORG_B, corpo({}, { conversation: 'Oi, quero saber mais' }, {}, 'inst-b')))).toBe('gravada');
    const [cb] = await conversas(ORG_B);
    expect(cb).toMatchObject({ orgId: ORG_B, chatJid: `${NUM}@s.whatsapp.net`, naoLidas: 1 });
    expect((await mensagens(ORG_B)).map((m) => m.orgId)).toEqual([ORG_B]);
    expect(await conversas(ORG_A)).toEqual(antesA);
    // a instância da A no caminho da B não grava
    expect(await em(ORG_B, () => gravador.gravar(ORG_B, corpo({ id: `${MARCA}-b2` }, { conversation: 'x' })))).toBe('ignorado: outra instância');
  });

  it('conector desligado nesta empresa: nada é gravado', async () => {
    await em(ORG_B, () => conectores.desligar(ORG_B, 'evolution', { motivo: 'teste', actorId: 'suite' }));
    const antes = (await mensagens(ORG_B)).length;
    expect(await em(ORG_B, () => gravador.gravar(ORG_B, corpo({ id: `${MARCA}-b3` }, { conversation: 'x' }, {}, 'inst-b')))).toBe('ignorado: conector desligado');
    expect((await mensagens(ORG_B)).length).toBe(antes);
  });

  it('a gravação que falha não lança (vira rótulo) e não derruba o webhook', async () => {
    const quebrado = new GravadorDoWhatsappService(
      { whatsAppConversa: { findUnique: async () => { throw new Error('banco fora'); } } } as never,
      undefined,
      evo,
    );
    expect(await em(ORG_A, () => quebrado.gravar(ORG_A, corpo({ id: `${MARCA}-q` }, { conversation: 'x' })))).toBe('erro');
  });

  describe('OS LEITORES DE SEMPRE CONTINUAM RECEBENDO', () => {
    /** Entrega o mesmo corpo por dois controladores (com e sem gravação) e devolve o que cada leitor recebeu. */
    const pelosDois = async (body: () => Record<string, unknown>) => {
      const saidas: Array<{ canal: unknown[][]; lead: unknown[][]; grupo: unknown[][] }> = [];
      for (const comGravacao of [false, true]) {
        receberDoLead.mockClear();
        doGrupoDeLinks.mockClear();
        const canal = { receber: vi.fn(async () => ({ desfecho: 'canal' })) };
        const b = body();
        const antes = JSON.stringify(b);
        await entregar(controlador(canal, comGravacao), ORG_A, b);
        // o gravador não mexe no corpo que os leitores recebem
        expect(JSON.stringify(b)).toBe(antes);
        saidas.push({ canal: canal.receber.mock.calls, lead: receberDoLead.mock.calls, grupo: doGrupoDeLinks.mock.calls });
      }
      expect(saidas[1]).toEqual(saidas[0]);
      return saidas[1];
    };

    it('a mensagem do lead vai à entrada do comercial igual, e também fica gravada', async () => {
      const n = (await mensagens(ORG_A)).length;
      const s = await pelosDois(() => corpo({ id: `${MARCA}-lead`, remoteJid: `${NUM_LEAD}@s.whatsapp.net` }, { conversation: 'quero a proposta' }));
      expect(s.lead).toEqual([[ORG_A, leadId, 'quero a proposta', `${MARCA}-lead`]]);
      expect(s.canal).toEqual([]);
      expect((await mensagens(ORG_A)).length).toBe(n + 1);
      expect((await mensagens(ORG_A)).at(-1)).toMatchObject({ remetenteNumero: NUM_LEAD, texto: 'quero a proposta' });
    });

    it('o @lid do lead com o número real ao lado: a entrada recebe igual', async () => {
      const s = await pelosDois(() => corpo({ id: `${MARCA}-lead-lid`, remoteJid: '161803398874989@lid', remoteJidAlt: `${NUM_LEAD}@s.whatsapp.net` }, { conversation: 'pelo lid' }));
      expect(s.lead).toEqual([[ORG_A, leadId, 'pelo lid', `${MARCA}-lead-lid`]]);
    });

    it('quem não é lead nem identidade: o canal recebe o MESMO corpo', async () => {
      const s = await pelosDois(() => corpo({ id: `${MARCA}-canal`, remoteJid: '5532900000005@s.whatsapp.net' }, { conversation: 'ROOT-ABCD1234 aprovar' }));
      expect(s.canal).toHaveLength(1);
      expect(s.canal[0][0]).toBe(ORG_A);
      expect(s.canal[0][1]).toMatchObject({ event: 'messages.upsert', data: { key: { id: `${MARCA}-canal` } } });
      expect(s.lead).toEqual([]);
    });

    it('o grupo de links vai ao inscrito do grupo igual (e o grupo fica gravado)', async () => {
      const s = await pelosDois(() => corpo({ id: `${MARCA}-links`, remoteJid: GRUPO_DE_LINKS, participant: `${NUM2}@s.whatsapp.net` }, { conversation: 'https://exemplo.com/materia' }));
      expect(s.grupo).toHaveLength(1);
      expect(s.canal).toEqual([]);
      expect((await conversas(ORG_A)).some((c) => c.chatJid === GRUPO_DE_LINKS)).toBe(true);
    });

    it('fromMe e outro grupo seguem para o canal igual; connection.update também', async () => {
      const deMim = await pelosDois(() => corpo({ id: `${MARCA}-eco`, fromMe: true }, { conversation: 'eco' }));
      expect(deMim.canal).toHaveLength(1);
      const outroGrupo = await pelosDois(() => corpo({ id: `${MARCA}-g9`, remoteJid: GRUPO, participant: `${NUM2}@s.whatsapp.net` }, { conversation: 'no grupo' }));
      expect(outroGrupo.canal).toHaveLength(1);
      const conexao = await pelosDois(() => ({ event: 'connection.update', instance: 'inst-a', data: { state: 'open' } }));
      expect(conexao.canal).toHaveLength(1);
    });

    it('com a gravação quebrada, os leitores recebem do mesmo jeito', async () => {
      const quebrada = new GravacaoDoWhatsappRegistry();
      quebrada.registrar(async () => {
        throw new Error('banco fora');
      }, 'suíte');
      receberDoLead.mockClear();
      const canal = { receber: vi.fn(async () => ({ desfecho: 'canal' })) };
      const c = new CanalDeAprovacaoController(canal as never, grupos, diretas, undefined, quebrada);
      await entregar(c, ORG_A, corpo({ id: `${MARCA}-lead-2`, remoteJid: `${NUM_LEAD}@s.whatsapp.net` }, { conversation: 'mesmo assim' }));
      expect(receberDoLead).toHaveBeenCalledTimes(1);
    });
  });
});
