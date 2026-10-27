import 'reflect-metadata';

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { Readable } from 'node:stream';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
  PayloadTooLargeException,
  type ArgumentsHost,
} from '@nestjs/common';
import { TETO_DA_MIDIA_DO_WHATSAPP, tipoDaMidiaParaEnviar } from '@mktos/shared';

import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import type { MidiaDaCaixaPelaEvolution, MidiaParaEnviarPelaEvolution, RespostaDeGentePelaEvolution } from '../src/gateway/canais/evolution.port';
import { EvolutionDaEmpresaService } from '../src/pauta/evolution.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { StorageService } from '../src/storage/storage.service';
import {
  ArquivoGrandeDemaisFilter,
  CaixaDoWhatsappController,
  MidiaDoWhatsappController,
  SoGenteNaCaixaGuard,
} from '../src/whatsapp/caixa.controller';
import { CaixaDoWhatsappService, type QuemNaCaixa } from '../src/whatsapp/caixa.service';
import type { SincronizacaoDoWhatsappService } from '../src/whatsapp/sincronizacao.service';
import {
  abreNoNavegador,
  cabecalhoDoArquivo,
  chaveDaMidiaNoStorage,
  nomeDoArquivo,
  nomeDoUpload,
} from '../src/whatsapp/midia-da-caixa';

/*
 * Layout 27/10 (Lucas: "não consigo nem abrir, nem enviar documentos pelo wpp do OS").
 * O ARQUIVO NA CAIXA DE WHATSAPP, sem banco: um Prisma de mentira em memória,
 * a porta da Evolution e o storage como dublês.
 *
 *  1. as rotas: abrir é `leads.ver` (como ler a conversa); mandar é `whatsapp.conversar` e de gente;
 *  2. a catraca: só a caixa chama a porta de arquivo;
 *  3. abrir: a primeira vez vem da Evolution e fica no storage, a segunda vem do storage;
 *     outra empresa é 404; o que o WhatsApp não guarda mais é 410 com frase;
 *  4. mandar: documento, foto e áudio com a porta certa, a assinatura na legenda, o teto,
 *     a gravação e o storage; máquina e conversa arquivada não mandam;
 *  5. o conector: as rotas e os corpos da Evolution v2 num servidor HTTP de mentira.
 *
 * Tudo fictício: números 5500000000xxx, nomes inventados.
 */

describe('arquivo na caixa: rotas, catraca e regras puras', () => {
  it('abrir é leads.ver sem guarda extra; mandar é whatsapp.conversar e só de gente', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, MidiaDoWhatsappController.prototype.midia)).toEqual(['leads.ver']);
    expect(Reflect.getMetadata('__guards__', MidiaDoWhatsappController.prototype.midia)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSIONS_KEY, CaixaDoWhatsappController.prototype.midia)).toEqual(['whatsapp.conversar']);
    expect(Reflect.getMetadata('__guards__', CaixaDoWhatsappController.prototype.midia)).toEqual([SoGenteNaCaixaGuard]);
  });

  it('o multer acima de 100 MB responde 413 em português', () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const host = { switchToHttp: () => ({ getResponse: () => ({ status }) }) } as unknown as ArgumentsHost;
    new ArquivoGrandeDemaisFilter().catch(new PayloadTooLargeException('File too large'), host);
    expect(status).toHaveBeenCalledWith(413);
    expect(json.mock.calls[0][0]).toMatchObject({ message: 'Arquivo acima de 100 MB: o WhatsApp não aceita.' });
  });

  const RAIZ = path.resolve(__dirname, '..');
  const fontes: Array<{ arquivo: string; texto: string }> = [];
  const andar = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const c = path.join(dir, e);
      if (statSync(c).isDirectory()) andar(c);
      else if (e.endsWith('.ts')) {
        const texto = readFileSync(c, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        fontes.push({ arquivo: path.relative(RAIZ, c).split(path.sep).join('/'), texto });
      }
    }
  };
  andar(path.join(RAIZ, 'src'));

  it('só src/whatsapp/caixa.service.ts chama .baixarMidia( e .responderMidiaComoPessoa(', () => {
    const chamam = fontes.filter((f) => /\.(baixarMidia|responderMidiaComoPessoa)\s*\(/.test(f.texto)).map((f) => f.arquivo).sort();
    expect(chamam).toEqual(['src/whatsapp/caixa.service.ts']);
  });

  it('o símbolo da porta de arquivo só mora na porta, no módulo dos canais e na caixa', () => {
    const usam = fontes.filter((f) => f.texto.includes('MIDIA_DA_CAIXA_PELA_EVOLUTION')).map((f) => f.arquivo).sort();
    expect(usam).toEqual(['src/gateway/canais/canais.module.ts', 'src/gateway/canais/evolution.port.ts', 'src/whatsapp/caixa.service.ts']);
  });

  it('o tipo de envio, o nome, o cabeçalho e o que abre no navegador', () => {
    expect(tipoDaMidiaParaEnviar('image/jpeg')).toBe('image');
    expect(tipoDaMidiaParaEnviar('image/gif')).toBe('document');
    expect(tipoDaMidiaParaEnviar('video/mp4')).toBe('video');
    expect(tipoDaMidiaParaEnviar('audio/ogg; codecs=opus')).toBe('audio');
    expect(tipoDaMidiaParaEnviar('application/pdf')).toBe('document');
    const dia = new Date('2026-10-27T12:00:00Z');
    expect(nomeDoArquivo(null, 'image', 'image/jpeg', dia)).toBe('imagem-2026-10-27.jpg');
    expect(nomeDoArquivo('C:\\pasta\\proposta "final".pdf', 'document', 'application/pdf', dia)).toBe('proposta _final_.pdf');
    expect(nomeDoArquivo(null, 'audio', 'audio/ogg', dia)).toBe('audio-2026-10-27.ogg');
    expect(cabecalhoDoArquivo('proposta ação.pdf', true)).toBe(`inline; filename="proposta acao.pdf"; filename*=UTF-8''proposta%20a%C3%A7%C3%A3o.pdf`);
    expect(cabecalhoDoArquivo("it's.zip", false)).toBe(`attachment; filename="it's.zip"; filename*=UTF-8''it%27s.zip`);
    expect(abreNoNavegador('application/pdf')).toBe(true);
    expect(abreNoNavegador('image/png')).toBe(true);
    expect(abreNoNavegador('image/svg+xml')).toBe(false);
    expect(abreNoNavegador('application/zip')).toBe(false);
    expect(nomeDoUpload(Buffer.from('proposta-ação.pdf', 'utf8').toString('latin1'))).toBe('proposta-ação.pdf');
    expect(nomeDoUpload('simples.pdf')).toBe('simples.pdf');
  });
});

// ---------------------------------------------------------------- o dublê

const ORG = 'org-midia-a';
const ORG2 = 'org-midia-b';
const T0 = new Date('2026-10-27T12:00:00.000Z');

interface Linha {
  id: string;
  orgId: string;
  conversaId: string;
  instancia: string;
  chatJid: string;
  grupo: boolean;
  deMim: boolean;
  tipo: string;
  texto: string | null;
  midia: unknown;
  mensagemExternaId: string;
  remetenteJid: string | null;
  remetenteNome: string | null;
  remetenteNumero: string | null;
  citaMensagemExternaId: string | null;
  enviadaPorId: string | null;
  lidaEm: Date | null;
  timestamp: Date;
  origem?: string;
}

function montar() {
  const mensagens: Linha[] = [];
  const conversas = [
    { id: 'conv-lead', orgId: ORG, instancia: 'inst', chatJid: '5500000000101@s.whatsapp.net', grupo: false, arquivadaEm: null as Date | null, leadId: 'lead-1', clienteId: null, naoLidas: 0, participantesLista: null },
    { id: 'conv-grupo', orgId: ORG, instancia: 'inst', chatJid: '120363000000000001@g.us', grupo: true, arquivadaEm: null as Date | null, leadId: null, clienteId: 'cli-1', naoLidas: 0, participantesLista: null },
    { id: 'conv-arquivada', orgId: ORG, instancia: 'inst', chatJid: '5500000000102@s.whatsapp.net', grupo: false, arquivadaEm: T0, leadId: null, clienteId: null, naoLidas: 0, participantesLista: null },
  ];
  const usuarios: Record<string, { orgId: string; nome: string; papeis: string[]; permissoes: string[]; ativo: boolean }> = {
    'u-gente': { orgId: ORG, nome: 'Pessoa Ficticia', papeis: ['comercial'], permissoes: ['leads.ver', 'whatsapp.conversar'], ativo: true },
    'u-sem': { orgId: ORG, nome: 'Sem Permissao', papeis: ['comercial'], permissoes: ['leads.ver'], ativo: true },
  };
  const comercial: unknown[] = [];
  const auditoria: Array<{ action: string; after: Record<string, unknown> }> = [];
  let proximo = 0;

  const linha = (dados: Partial<Linha> & Pick<Linha, 'id' | 'orgId' | 'tipo'>): Linha => ({
    conversaId: 'conv-lead',
    instancia: 'inst',
    chatJid: '5500000000101@s.whatsapp.net',
    grupo: false,
    deMim: false,
    texto: null,
    midia: null,
    mensagemExternaId: `EXT-${dados.id}`,
    remetenteJid: null,
    remetenteNome: null,
    remetenteNumero: null,
    citaMensagemExternaId: null,
    enviadaPorId: null,
    lidaEm: null,
    timestamp: T0,
    ...dados,
  });

  const prisma = {
    user: {
      findFirst: async ({ where, select }: { where: { id: string; orgId: string }; select: Record<string, unknown> }) => {
        const u = usuarios[where.id];
        if (!u || u.orgId !== where.orgId) return null;
        const roles = select.roles as { where?: unknown } | undefined;
        if (roles?.where) return u.ativo ? { roles: [{ permissions: u.permissoes.map((key) => ({ key })) }] } : null;
        return { id: where.id, isActive: u.ativo, passwordHash: 'x', roles: u.papeis.map((key) => ({ key })) };
      },
      findMany: async ({ where }: { where: { id: string | { in: string[] }; orgId: string } }) => {
        const ids = typeof where.id === 'string' ? [where.id] : where.id.in;
        return ids.filter((id) => usuarios[id]?.orgId === where.orgId).map((id) => ({ id, name: usuarios[id].nome }));
      },
    },
    whatsAppConversa: {
      findFirst: async ({ where }: { where: { id: string; orgId: string } }) => conversas.find((c) => c.id === where.id && c.orgId === where.orgId) ?? null,
      updateMany: async () => ({ count: 1 }),
    },
    whatsAppMensagem: {
      findFirst: async ({ where }: { where: { id: string; orgId: string } }) => mensagens.find((m) => m.id === where.id && m.orgId === where.orgId) ?? null,
      findFirstOrThrow: async ({ where }: { where: { id: string; orgId: string } }) => {
        const m = mensagens.find((x) => x.id === where.id && x.orgId === where.orgId);
        if (!m) throw new Error('não achou');
        return m;
      },
      findMany: async () => [],
      upsert: async ({ create, update }: { create: Omit<Linha, 'id'>; update: Partial<Linha> }) => {
        const ja = mensagens.find((m) => m.orgId === create.orgId && m.mensagemExternaId === create.mensagemExternaId);
        if (ja) {
          Object.assign(ja, update);
          return { id: ja.id, timestamp: ja.timestamp };
        }
        proximo += 1;
        const nova = linha({ ...create, id: `msg-nova-${proximo}` } as Linha);
        mensagens.push(nova);
        return { id: nova.id, timestamp: nova.timestamp };
      },
    },
    comercialMensagem: {
      createMany: async ({ data }: { data: unknown[] }) => {
        comercial.push(...data);
        return { count: data.length };
      },
    },
    auditLog: {
      create: async ({ data }: { data: { action: string; after: Record<string, unknown> } }) => {
        auditoria.push(data);
        return data;
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };

  const objetos = new Map<string, { corpo: Buffer; tipo: string }>();
  const storage = {
    configured: true,
    put: vi.fn(async (chave: string, corpo: Buffer, tipo: string) => {
      objetos.set(chave, { corpo, tipo });
    }),
    get: vi.fn(async (chave: string) => {
      const o = objetos.get(chave);
      if (!o) throw Object.assign(new Error('Not Found'), { code: 'NotFound' });
      return { stream: Readable.from([o.corpo]), contentType: o.tipo, size: o.corpo.length };
    }),
  };

  const enviados: Array<{ orgId: string; chatJid: string; midia: MidiaParaEnviarPelaEvolution }> = [];
  const porta = {
    baixar: vi.fn(async (): Promise<{ base64: string; mime: string | null; nome: string | null }> => ({
      base64: Buffer.from('%PDF-1.4 ficticio').toString('base64'),
      mime: 'application/pdf',
      nome: 'veio-da-evolution.pdf',
    })),
    falharEnvio: null as Error | null,
  };
  const midiaPelaEvolution: MidiaDaCaixaPelaEvolution = {
    baixarMidia: (...a) => porta.baixar(...(a as [])),
    async responderMidiaComoPessoa(orgId, chatJid, midia) {
      if (porta.falharEnvio) throw porta.falharEnvio;
      enviados.push({ orgId, chatJid, midia });
      return { id: `EVO-MIDIA-${enviados.length}` };
    },
  };
  const resposta: RespostaDeGentePelaEvolution = { responderComoPessoa: vi.fn() };

  const svc = new CaixaDoWhatsappService(
    prisma as unknown as PrismaService,
    {} as SincronizacaoDoWhatsappService,
    resposta,
    undefined,
    midiaPelaEvolution,
    storage as unknown as StorageService,
  );
  return { svc, prisma, mensagens, conversas, linha, objetos, storage, porta, enviados, comercial, auditoria };
}

async function bytesDe(corpo: Buffer | Readable): Promise<Buffer> {
  if (Buffer.isBuffer(corpo)) return corpo;
  const partes: Buffer[] = [];
  for await (const p of corpo) partes.push(p as Buffer);
  return Buffer.concat(partes);
}

const gente: QuemNaCaixa = { id: 'u-gente', papeis: ['comercial'], permissoes: ['leads.ver', 'whatsapp.conversar'] };

function arquivo(nome: string, mimetype: string, bytes: number | Buffer) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.alloc(bytes, 1);
  return { buffer, originalname: nome, mimetype, size: buffer.length };
}

// ------------------------------------------------------------------ abrir

describe('arquivo na caixa: abrir', () => {
  let d: ReturnType<typeof montar>;
  beforeEach(() => {
    d = montar();
    d.mensagens.push(
      d.linha({ id: 'm-doc', orgId: ORG, tipo: 'document', midia: { mime: 'application/pdf', nome: 'contrato-ficticio.pdf', tamanho: 17, segundos: null } }),
      d.linha({
        id: 'm-grupo',
        orgId: ORG,
        tipo: 'image',
        conversaId: 'conv-grupo',
        chatJid: '120363000000000001@g.us',
        grupo: true,
        remetenteJid: '5500000000103@s.whatsapp.net',
        midia: { mime: 'image/jpeg', nome: null, tamanho: 10, segundos: null },
      }),
      d.linha({ id: 'm-texto', orgId: ORG, tipo: 'conversation', texto: 'oi' }),
      d.linha({ id: 'm-outra', orgId: ORG2, tipo: 'document', midia: { mime: 'application/pdf', nome: 'de-outra.pdf', tamanho: 10, segundos: null } }),
      d.linha({ id: 'm-grande', orgId: ORG, tipo: 'video', midia: { mime: 'video/mp4', nome: null, tamanho: 60 * 1024 * 1024, segundos: 300 } }),
    );
  });

  it('a primeira vez busca na Evolution com a key da mensagem e guarda no storage; a segunda vem do storage', async () => {
    const a = await d.svc.abrirMidia(ORG, 'm-doc');
    expect(d.porta.baixar).toHaveBeenCalledTimes(1);
    expect(d.porta.baixar.mock.calls[0]).toEqual([
      ORG,
      { id: 'EXT-m-doc', remoteJid: '5500000000101@s.whatsapp.net', fromMe: false, participant: null },
      50 * 1024 * 1024,
    ]);
    expect((await bytesDe(a.corpo)).toString()).toBe('%PDF-1.4 ficticio');
    expect(a).toMatchObject({ mime: 'application/pdf', nome: 'contrato-ficticio.pdf', inline: true, tamanho: 17 });
    expect(d.objetos.get(chaveDaMidiaNoStorage(ORG, 'm-doc'))?.tipo).toBe('application/pdf');

    const b = await d.svc.abrirMidia(ORG, 'm-doc');
    expect(d.porta.baixar).toHaveBeenCalledTimes(1);
    expect(Buffer.isBuffer(b.corpo)).toBe(false);
    expect((await bytesDe(b.corpo)).toString()).toBe('%PDF-1.4 ficticio');
    expect(b).toMatchObject({ mime: 'application/pdf', nome: 'contrato-ficticio.pdf', tamanho: 17 });
  });

  it('no grupo vai o participante; sem nome, o arquivo ganha "imagem-<dia>.jpg"', async () => {
    d.porta.baixar.mockResolvedValueOnce({ base64: Buffer.from('jpeg').toString('base64'), mime: 'image/jpeg', nome: null });
    const a = await d.svc.abrirMidia(ORG, 'm-grupo');
    expect(d.porta.baixar.mock.calls[0][1]).toEqual({ id: 'EXT-m-grupo', remoteJid: '120363000000000001@g.us', fromMe: false, participant: '5500000000103@s.whatsapp.net' });
    expect(a).toMatchObject({ mime: 'image/jpeg', nome: 'imagem-2026-10-27.jpg', inline: true });
  });

  it('mensagem de outra empresa, inexistente ou sem arquivo é 404, sem ir à Evolution', async () => {
    await expect(d.svc.abrirMidia(ORG, 'm-outra')).rejects.toBeInstanceOf(NotFoundException);
    await expect(d.svc.abrirMidia(ORG, 'nao-existe')).rejects.toBeInstanceOf(NotFoundException);
    await expect(d.svc.abrirMidia(ORG, '../../etc')).rejects.toBeInstanceOf(NotFoundException);
    await expect(d.svc.abrirMidia(ORG, 'm-texto')).rejects.toThrow('Esta mensagem não tem arquivo.');
    expect(d.porta.baixar).not.toHaveBeenCalled();
  });

  it('o que o WhatsApp não guarda mais é 410 com a frase; nada vai ao storage', async () => {
    d.porta.baixar.mockRejectedValueOnce(Object.assign(new Error('A Evolution respondeu HTTP 400'), { name: 'EvolutionRespondeuErro', status: 400 }));
    const e = await d.svc.abrirMidia(ORG, 'm-doc').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(GoneException);
    expect((e as Error).message).toBe('O WhatsApp não guarda mais esse arquivo. Peça para mandarem de novo.');
    d.porta.baixar.mockResolvedValueOnce({ base64: '', mime: null, nome: null });
    await expect(d.svc.abrirMidia(ORG, 'm-doc')).rejects.toBeInstanceOf(GoneException);
    expect(d.storage.put).not.toHaveBeenCalled();
  });

  it('acima de 50 MB não busca na Evolution: 413 com a frase', async () => {
    await expect(d.svc.abrirMidia(ORG, 'm-grande')).rejects.toThrow('Arquivo acima de 50 MB: abra pelo celular.');
    expect(d.porta.baixar).not.toHaveBeenCalled();
    d.porta.baixar.mockRejectedValueOnce(Object.assign(new Error('o corpo passa de 66 MB'), { name: 'CorpoAcimaDoTetoError' }));
    await expect(d.svc.abrirMidia(ORG, 'm-doc')).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('sem storage configurado, abre pela Evolution toda vez', async () => {
    d.storage.configured = false;
    await d.svc.abrirMidia(ORG, 'm-doc');
    await d.svc.abrirMidia(ORG, 'm-doc');
    expect(d.porta.baixar).toHaveBeenCalledTimes(2);
    expect(d.storage.get).not.toHaveBeenCalled();
  });

  it('a rota responde com o tipo, o tamanho e o nome (inline para PDF)', async () => {
    const cabecalhos: Record<string, unknown> = {};
    const res = { setHeader: (k: string, v: unknown) => (cabecalhos[k] = v), end: vi.fn() };
    const c = new MidiaDoWhatsappController(d.svc);
    await c.midia({ orgId: ORG, sub: 'u-gente' } as never, 'm-doc', res as never);
    expect(cabecalhos['Content-Type']).toBe('application/pdf');
    expect(cabecalhos['Content-Length']).toBe(17);
    expect(cabecalhos['Content-Disposition']).toBe(`inline; filename="contrato-ficticio.pdf"; filename*=UTF-8''contrato-ficticio.pdf`);
    expect(cabecalhos['Cache-Control']).toBe('private, no-store');
    expect(res.end.mock.calls[0][0].toString()).toBe('%PDF-1.4 ficticio');
  });
});

// ------------------------------------------------------------------ mandar

describe('arquivo na caixa: mandar', () => {
  let d: ReturnType<typeof montar>;
  beforeEach(() => {
    d = montar();
  });

  it('documento: sendMedia com o nome e a legenda assinada; grava sem a assinatura, no fio do lead e no storage', async () => {
    const pdf = Buffer.from('%PDF-1.4 proposta ficticia');
    const r = await d.svc.responderComMidia(ORG, 'conv-lead', arquivo('proposta.pdf', 'application/pdf', pdf), '  segue a proposta  ', gente);
    expect(d.enviados).toHaveLength(1);
    expect(d.enviados[0]).toEqual({
      orgId: ORG,
      chatJid: '5500000000101@s.whatsapp.net',
      midia: { tipo: 'document', mime: 'application/pdf', base64: pdf.toString('base64'), nome: 'proposta.pdf', legenda: '*Pessoa Ficticia*\nsegue a proposta' },
    });
    expect(r.mensagem).toMatchObject({
      deMim: true,
      tipo: 'document',
      texto: 'segue a proposta',
      midia: { mime: 'application/pdf', nome: 'proposta.pdf', tamanho: pdf.length, segundos: null },
      enviadaPor: { id: 'u-gente', nome: 'Pessoa Ficticia' },
    });
    expect(d.mensagens[0]).toMatchObject({ mensagemExternaId: 'EVO-MIDIA-1', origem: 'caixa', enviadaPorId: 'u-gente' });
    expect(d.objetos.get(chaveDaMidiaNoStorage(ORG, r.mensagem.id))?.corpo.equals(pdf)).toBe(true);
    expect(d.comercial).toHaveLength(1);
    expect(d.comercial[0]).toMatchObject({ leadId: 'lead-1', texto: 'documento: proposta.pdf\nsegue a proposta', mensagemExternaId: 'EVO-MIDIA-1' });
    // A auditoria não leva o nome do arquivo nem a legenda.
    expect(d.auditoria[0].action).toBe('whatsapp.midia.enviada_por_pessoa');
    expect(JSON.stringify(d.auditoria[0].after)).not.toMatch(/proposta|segue/);
    // Depois de mandar, abre pelo storage, sem a Evolution.
    const aberto = await d.svc.abrirMidia(ORG, r.mensagem.id);
    expect((await bytesDe(aberto.corpo)).equals(pdf)).toBe(true);
    expect(d.porta.baixar).not.toHaveBeenCalled();
  });

  it('foto sem legenda: sai com o nome de quem enviou como legenda; no grupo, o destino é o grupo', async () => {
    const r = await d.svc.responderComMidia(ORG, 'conv-grupo', arquivo('foto.jpg', 'image/jpeg', 2048), undefined, gente);
    expect(d.enviados[0]).toMatchObject({ chatJid: '120363000000000001@g.us', midia: { tipo: 'image', legenda: '*Pessoa Ficticia*' } });
    expect(r.mensagem).toMatchObject({ tipo: 'image', texto: null });
    expect(d.comercial).toHaveLength(0);
  });

  it('áudio: sai sem legenda nenhuma (nem a assinatura) e grava sem texto', async () => {
    const r = await d.svc.responderComMidia(ORG, 'conv-lead', arquivo('nota.ogg', 'audio/ogg', 4096), 'texto que não vai', gente);
    expect(d.enviados[0].midia).toMatchObject({ tipo: 'audio', mime: 'audio/ogg', legenda: null });
    expect(r.mensagem).toMatchObject({ tipo: 'audio', texto: null });
  });

  it('o teto do WhatsApp: foto acima de 16 MB é recusada sem enviar; documento do mesmo tamanho passa', async () => {
    const grande = TETO_DA_MIDIA_DO_WHATSAPP + 1;
    const e = await d.svc.responderComMidia(ORG, 'conv-lead', arquivo('foto.png', 'image/png', grande), '', gente).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PayloadTooLargeException);
    expect((e as Error).message).toMatch(/^Foto acima de 16 MB: o WhatsApp não aceita/);
    expect(d.enviados).toHaveLength(0);
    await d.svc.responderComMidia(ORG, 'conv-lead', arquivo('planilha.zip', 'application/zip', grande), '', gente);
    expect(d.enviados[0].midia.tipo).toBe('document');
  });

  it('máquina, quem não tem whatsapp.conversar no banco, conversa arquivada, de outra empresa ou sem arquivo: nada sai', async () => {
    await expect(d.svc.responderComMidia(ORG, 'conv-lead', arquivo('a.pdf', 'application/pdf', 10), '', { ...gente, papeis: ['ia_acao'] })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(d.svc.responderComMidia(ORG, 'conv-lead', arquivo('a.pdf', 'application/pdf', 10), '', { id: 'u-sem', papeis: ['comercial'], permissoes: ['whatsapp.conversar'] })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(d.svc.responderComMidia(ORG, 'conv-arquivada', arquivo('a.pdf', 'application/pdf', 10), '', gente)).rejects.toBeInstanceOf(ConflictException);
    await expect(d.svc.responderComMidia(ORG2, 'conv-lead', arquivo('a.pdf', 'application/pdf', 10), '', gente)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(d.svc.responderComMidia(ORG, 'conv-lead', undefined, 'só legenda', gente)).rejects.toThrow('Escolha o arquivo.');
    expect(d.enviados).toHaveLength(0);
    expect(d.mensagens).toHaveLength(0);
  });

  it('a Evolution recusa: 502 com frase, nada gravado', async () => {
    d.porta.falharEnvio = Object.assign(new Error('x'), { name: 'EvolutionRespondeuErro', status: 400 });
    await expect(d.svc.responderComMidia(ORG, 'conv-lead', arquivo('a.pdf', 'application/pdf', 10), '', gente)).rejects.toThrow(
      'A Evolution recusou o envio (HTTP 400). Nada foi enviado.',
    );
    expect(d.mensagens).toHaveLength(0);
    expect(d.storage.put).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ o conector

describe('arquivo na caixa: o conector fala a Evolution v2', () => {
  let servidor: Server;
  let base = '';
  const pedidos: Array<{ caminho: string; corpo: Record<string, unknown> }> = [];

  beforeAll(async () => {
    servidor = createServer((req, res) => {
      const partes: Buffer[] = [];
      req.on('data', (p: Buffer) => partes.push(p));
      req.on('end', () => {
        const corpo = JSON.parse(Buffer.concat(partes).toString() || '{}') as Record<string, unknown>;
        pedidos.push({ caminho: req.url ?? '', corpo });
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/chat/getBase64FromMediaMessage/inst-midia') {
          const id = ((corpo.message as { key: { id: string } }).key).id;
          if (id === 'SUMIU') {
            res.statusCode = 400;
            res.end(JSON.stringify({ message: 'Message not found' }));
            return;
          }
          const tamanho = id === 'GRANDE' ? 100_000 : 10;
          res.end(JSON.stringify({ mediaType: 'documentMessage', fileName: 'x.pdf', mimetype: 'application/pdf', base64: Buffer.alloc(tamanho, 7).toString('base64') }));
          return;
        }
        if (req.url === '/message/sendMedia/inst-midia') return void res.end(JSON.stringify({ key: { id: 'EVO-SENDMEDIA' } }));
        if (req.url === '/message/sendWhatsAppAudio/inst-midia') return void res.end(JSON.stringify({ key: { id: 'EVO-AUDIO' } }));
        res.statusCode = 404;
        res.end('{}');
      });
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((ok) => servidor.close(() => ok())));
  beforeEach(() => {
    pedidos.length = 0;
  });

  const conector = () => {
    const valores: Record<string, string> = { url: base, chave: 'chave-inventada-midia', instancia: 'inst-midia' };
    const cofre = { envolver: vi.fn(async (ref: { nome: string }, fn: (c: { usar: (f: (v: string) => string) => string }) => unknown) => fn({ usar: (f) => f(valores[ref.nome]) })) };
    const prisma = { org: { findFirst: vi.fn(async () => ({ id: 'org-casa' })) } };
    return new EvolutionDaEmpresaService(prisma as never, cofre as never);
  };

  it('baixar: getBase64FromMediaMessage com a key e convertToMp4 falso', async () => {
    const r = await conector().baixarMidia('org-casa', { id: 'ABC', remoteJid: '120363000000000001@g.us', fromMe: false, participant: '5500000000103@s.whatsapp.net' }, 1000);
    expect(pedidos[0]).toEqual({
      caminho: '/chat/getBase64FromMediaMessage/inst-midia',
      corpo: { message: { key: { id: 'ABC', remoteJid: '120363000000000001@g.us', fromMe: false, participant: '5500000000103@s.whatsapp.net' } }, convertToMp4: false },
    });
    expect(Buffer.from(r.base64, 'base64')).toHaveLength(10);
    expect(r).toMatchObject({ mime: 'application/pdf', nome: 'x.pdf' });
  });

  it('baixar: a Evolution que não acha a mensagem responde fora do 2xx; a resposta acima do teto para no teto', async () => {
    await expect(conector().baixarMidia('org-casa', { id: 'SUMIU', remoteJid: '5500000000101@s.whatsapp.net', fromMe: true }, 1000)).rejects.toMatchObject({ name: 'EvolutionRespondeuErro', status: 400 });
    // 100 KB viram ~133 KB de base64; com o teto de 1 KB o corpo pode ter no máximo ~66 KB.
    await expect(conector().baixarMidia('org-casa', { id: 'GRANDE', remoteJid: '5500000000101@s.whatsapp.net', fromMe: false }, 1000)).rejects.toMatchObject({ name: 'CorpoAcimaDoTetoError' });
  });

  it('mandar documento e foto: sendMedia; áudio: sendWhatsAppAudio; destino 1:1 só com os dígitos', async () => {
    const c = conector();
    const doc = await c.responderMidiaComoPessoa('org-casa', '5500000000101@s.whatsapp.net', { tipo: 'document', mime: 'application/pdf', base64: 'QUJD', nome: 'proposta.pdf', legenda: '*Pessoa*\nsegue' });
    expect(doc.id).toBe('EVO-SENDMEDIA');
    expect(pedidos[0]).toEqual({
      caminho: '/message/sendMedia/inst-midia',
      corpo: { number: '5500000000101', mediatype: 'document', mimetype: 'application/pdf', media: 'QUJD', fileName: 'proposta.pdf', caption: '*Pessoa*\nsegue' },
    });
    await c.responderMidiaComoPessoa('org-casa', '120363000000000001@g.us', { tipo: 'image', mime: 'image/jpeg', base64: 'QUJD', nome: 'f.jpg', legenda: null });
    expect(pedidos[1].corpo).toEqual({ number: '120363000000000001@g.us', mediatype: 'image', mimetype: 'image/jpeg', media: 'QUJD', fileName: 'f.jpg' });
    const audio = await c.responderMidiaComoPessoa('org-casa', '5500000000101@s.whatsapp.net', { tipo: 'audio', mime: 'audio/ogg', base64: 'QUJD', nome: 'a.ogg', legenda: null });
    expect(audio.id).toBe('EVO-AUDIO');
    expect(pedidos[2]).toEqual({ caminho: '/message/sendWhatsAppAudio/inst-midia', corpo: { number: '5500000000101', audio: 'QUJD' } });
    await expect(c.responderMidiaComoPessoa('org-casa', 'status@broadcast', { tipo: 'audio', mime: 'audio/ogg', base64: 'QUJD', nome: 'a.ogg', legenda: null })).rejects.toThrow(
      /não é uma conversa do WhatsApp/,
    );
    expect(pedidos).toHaveLength(3);
  });
});
