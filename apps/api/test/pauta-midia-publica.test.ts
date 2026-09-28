import 'reflect-metadata';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { Readable, Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PAUTA_MIDIA_PUBLICA_VALIDADE_MAXIMA_SEG, PAUTA_VIDEO_DO_CORTE_MAX_BYTES } from '@mktos/shared';

import { assinar, conferir, origemDaMidiaPublica, rastroDoToken, segredoDaMidiaPublica } from '../src/pauta/midia-publica';
import { MidiaPublicaService } from '../src/pauta/midia-publica.service';
import { MidiaPublicaController, MidiaPublicaDaPecaController } from '../src/pauta/midia-publica.controller';
import { conferirJpegDaPeca, dimensoesDoJpeg } from '../src/pauta/imagem-jpeg';
import {
  ConferenciaDoMp4,
  ErroDoEnvio,
  chaveDoVideoDaPeca,
  conferirCabecalhosDoEnvio,
  lerMoov,
  tetoDoVideo,
} from '../src/pauta/video-do-corte';
import { PARTE_DO_ENVIO, StorageService } from '../src/storage/storage.service';
import { chavesDaMeta, formatarBytes, motivoParaNaoRemover, usoDoStorage } from '../src/storage/uso-da-midia';
import { ROTAS_DE_MIDIA_DO_EPISODIO } from '../src/common/corpo-da-midia';
import { moduloDoCaminho } from '../src/tenants/modulos';
import { contextoAtual } from '../src/common/contexto-execucao';
import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import { caixa, jpegDeTeste, mp4DeTeste, sha256 } from './mp4-de-teste';

/*
 * MD4 — a mídia da peça numa URL pública assinada, o JPEG que a Meta aceita e o
 * mp4 do corte que sobe por stream. Tudo sem banco: a parte com banco (a rota
 * pública dentro da empresa do token, com a sessão em modo impor) está em
 * `rotas-publicas-tenant.test.ts`.
 */

const SEGREDO = 's'.repeat(40);
const AGORA = 1_800_000_000;
const ORG = 'org-a';
const PECA = 'peca-1';
const CHAVE_MP4 = chaveDoVideoDaPeca(PECA, 'a'.repeat(64));

// ---------------------------------------------------------------------------
// 1. O token
// ---------------------------------------------------------------------------

describe('midia pública: o token assinado', () => {
  const base = { orgId: ORG, pecaId: PECA, chave: CHAVE_MP4, exp: AGORA + 600 };

  it('assina e confere de volta a empresa, a peça, a chave e o vencimento', () => {
    const token = assinar(base, SEGREDO, AGORA);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    expect(conferir(token, SEGREDO, AGORA)).toEqual(base);
    expect(rastroDoToken(token)).toBe(token.split('.')[1].slice(0, 8));
  });

  it('vencido, com o segredo errado ou sem segredo não confere', () => {
    const token = assinar(base, SEGREDO, AGORA);
    expect(conferir(token, SEGREDO, AGORA + 600)).toBeNull();
    expect(conferir(token, SEGREDO, AGORA + 601)).toBeNull();
    expect(conferir(token, 'x'.repeat(40), AGORA)).toBeNull();
    expect(conferir(token, null, AGORA)).toBeNull();
  });

  it('adulterado — outra empresa, outra peça, outra chave, prazo esticado ou o HMAC mexido — não confere', () => {
    const token = assinar(base, SEGREDO, AGORA);
    const [payload, mac] = token.split('.');
    const trocar = (campo: Record<string, unknown>) => {
      const p = { ...JSON.parse(Buffer.from(payload, 'base64url').toString()), ...campo };
      return `${Buffer.from(JSON.stringify(p)).toString('base64url')}.${mac}`;
    };
    expect(conferir(trocar({ o: 'org-b' }), SEGREDO, AGORA)).toBeNull();
    expect(conferir(trocar({ p: 'peca-2' }), SEGREDO, AGORA)).toBeNull();
    expect(conferir(trocar({ c: 'pauta/pecas/peca-1/outra.mp4' }), SEGREDO, AGORA)).toBeNull();
    expect(conferir(trocar({ e: AGORA + 3000 }), SEGREDO, AGORA)).toBeNull();
    const outroMac = `${mac.slice(0, -2)}${mac.endsWith('AA') ? 'AB' : 'AA'}`;
    expect(conferir(`${payload}.${outroMac}`, SEGREDO, AGORA)).toBeNull();
    for (const lixo of ['', '.', 'a.b.c', `${payload}.`, `${payload}.${mac}x`, 'x'.repeat(2000), `${payload}.${mac}`.replace('.', '..')]) {
      expect(conferir(lixo, SEGREDO, AGORA), lixo.slice(0, 20)).toBeNull();
    }
  });

  it('exp acima de 1 h é recusado ao assinar — e, se um segredo vazado o assinasse, ao conferir', () => {
    expect(() => assinar({ ...base, exp: AGORA + PAUTA_MIDIA_PUBLICA_VALIDADE_MAXIMA_SEG + 1 }, SEGREDO, AGORA)).toThrow(/1 h/);
    expect(() => assinar({ ...base, exp: AGORA }, SEGREDO, AGORA)).toThrow(/futuro/);
    expect(() => assinar(base, 'curto', AGORA)).toThrow(/curto/);
    const noLimite = assinar({ ...base, exp: AGORA + PAUTA_MIDIA_PUBLICA_VALIDADE_MAXIMA_SEG }, SEGREDO, AGORA);
    expect(conferir(noLimite, SEGREDO, AGORA)).not.toBeNull();
    // O mesmo token, lido 1 s ANTES de ser assinado, passaria de 1 h: é o que um relógio adulterado produziria.
    expect(conferir(noLimite, SEGREDO, AGORA - 1)).toBeNull();
  });

  it('o segredo curto é o mesmo que nenhum; a origem cai na da bio', () => {
    expect(segredoDaMidiaPublica({ PAUTA_MIDIA_PUBLICA_SEGREDO: 'curto' })).toBeNull();
    expect(segredoDaMidiaPublica({ PAUTA_MIDIA_PUBLICA_SEGREDO: `  ${SEGREDO}  ` })).toBe(SEGREDO);
    expect(origemDaMidiaPublica({ PUBLIC_BIO_ORIGIN: 'https://bio.exemplo.test/' })).toBe('https://bio.exemplo.test');
    expect(origemDaMidiaPublica({ PUBLIC_BIO_ORIGIN: 'https://bio.x', PAUTA_MIDIA_PUBLICA_ORIGEM: 'https://midia.x' })).toBe('https://midia.x');
    expect(origemDaMidiaPublica({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. O serviço: nada vai ao banco antes de o token conferir
// ---------------------------------------------------------------------------

function montar(o: { modulos?: string[]; meta?: Record<string, unknown>; status?: string } = {}) {
  const consultas: string[] = [];
  const auditoria: Array<Record<string, unknown>> = [];
  const meta = o.meta ?? {
    episodioId: 'e1',
    itemId: 'c1',
    formato: 'corte',
    imagens: [
      { n: 1, chave: 'pauta/peca/peca-1-1-aaaaaaaaaaaa.jpg', sha: 'aaaaaaaaaaaa', tipo: 'jpeg', largura: 1080, altura: 1920, bytes: 10, enviadaEm: '' },
      { n: 1, chave: 'pauta/peca/peca-1-1-bbbbbbbbbbbb.png', sha: 'bbbbbbbbbbbb', largura: 1080, altura: 1920, bytes: 10, enviadaEm: '' },
    ],
    video: { arquivo: '/Users/p/c.mp4', duracaoSeg: 60, largura: 1080, altura: 1920, bytes: 4096, chave: CHAVE_MP4, sha256: 'a'.repeat(64) },
  };
  const prisma = {
    pautaPeca: {
      findFirst: async ({ where }: { where: { id: string; orgId: string } }) => {
        consultas.push(`PautaPeca.findFirst:${contextoAtual()?.orgId ?? 'sem'}`);
        return where.id === PECA && where.orgId === ORG ? { id: PECA, status: o.status ?? 'aprovada', meta } : null;
      },
    },
  };
  const modulos = {
    modulosDaOrg: async (orgId: string) => {
      consultas.push(`Org.modulos:${orgId}`);
      return new Set(o.modulos ?? ['pauta']);
    },
  };
  const guardados = new Map<string, Buffer>([[CHAVE_MP4, Buffer.from('mp4')], ['pauta/peca/peca-1-1-aaaaaaaaaaaa.jpg', Buffer.from('jpg')]]);
  const storage = {
    get: async (chave: string) => {
      const b = guardados.get(chave);
      if (!b) throw new Error('NoSuchKey');
      return { stream: Readable.from([b]), size: b.length, contentType: 'x' };
    },
  };
  const audit = { log: async (a: Record<string, unknown>) => void auditoria.push(a) };
  const svc = new MidiaPublicaService(prisma as never, audit as never, storage as never, modulos as never);
  return { svc, consultas, auditoria };
}

describe('midia pública: o serviço', () => {
  beforeEach(() => {
    vi.stubEnv('PAUTA_MIDIA_PUBLICA_SEGREDO', SEGREDO);
    vi.stubEnv('PAUTA_MIDIA_PUBLICA_ORIGEM', '');
    vi.stubEnv('PUBLIC_BIO_ORIGIN', 'https://bio.exemplo.test');
  });
  afterEach(() => vi.unstubAllEnvs());

  const tokenDe = (chave: string, exp = Math.floor(Date.now() / 1000) + 600, org = ORG) => assinar({ orgId: org, pecaId: PECA, chave, exp }, SEGREDO);

  it('token vencido, adulterado, de outra empresa ou com a chave trocada: nulo SEM nenhuma consulta', async () => {
    const { svc, consultas } = montar();
    const valido = tokenDe(CHAVE_MP4);
    const [payload, mac] = valido.split('.');
    const trocado = (campo: Record<string, unknown>) =>
      `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), ...campo })).toString('base64url')}.${mac}`;
    const vencido = assinar({ orgId: ORG, pecaId: PECA, chave: CHAVE_MP4, exp: AGORA + 10 }, SEGREDO, AGORA);
    for (const t of [vencido, trocado({ o: 'org-b' }), trocado({ c: 'pauta/pecas/peca-1/corte-b.mp4' }), `${payload}.${'A'.repeat(43)}`, 'lixo']) {
      expect(await svc.abrir(t)).toBeNull();
    }
    expect(consultas).toEqual([]);
  });

  it('sem segredo configurado a rota fica desligada: nulo sem consulta, e assinar é 503', async () => {
    vi.stubEnv('PAUTA_MIDIA_PUBLICA_SEGREDO', '');
    const { svc, consultas } = montar();
    expect(await svc.abrir(assinar({ orgId: ORG, pecaId: PECA, chave: CHAVE_MP4, exp: Math.floor(Date.now() / 1000) + 60 }, SEGREDO))).toBeNull();
    expect(consultas).toEqual([]);
    await expect(svc.assinarDaPeca(ORG, PECA, 'u1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('token válido: abre a empresa DO TOKEN, confere o módulo e a chave, e entrega com o tipo pela extensão', async () => {
    const { svc, consultas } = montar();
    const mp4 = await svc.abrir(tokenDe(CHAVE_MP4));
    expect(mp4).toMatchObject({ size: 3, contentType: 'video/mp4' });
    expect(consultas).toEqual([`Org.modulos:${ORG}`, `PautaPeca.findFirst:${ORG}`]);
    const jpg = await svc.abrir(tokenDe('pauta/peca/peca-1-1-aaaaaaaaaaaa.jpg'));
    expect(jpg).toMatchObject({ contentType: 'image/jpeg' });
  });

  it('assinado, mas a chave já não é da peça (render novo), é o PNG da prévia, a empresa perdeu a pauta ou a peça foi descartada: nulo', async () => {
    expect(await montar().svc.abrir(tokenDe('pauta/pecas/peca-1/corte-velho.mp4'))).toBeNull();
    expect(await montar().svc.abrir(tokenDe('pauta/peca/peca-1-1-bbbbbbbbbbbb.png'))).toBeNull();
    const semPauta = montar({ modulos: ['bio'] });
    expect(await semPauta.svc.abrir(tokenDe(CHAVE_MP4))).toBeNull();
    expect(semPauta.consultas).toEqual([`Org.modulos:${ORG}`]);
    expect(await montar({ status: 'descartada' }).svc.abrir(tokenDe(CHAVE_MP4))).toBeNull();
    // Assinado para outra empresa: dentro dela a peça não existe.
    expect(await montar().svc.abrir(tokenDe(CHAVE_MP4, undefined, 'org-b'))).toBeNull();
  });

  it('assinar devolve uma URL por JPEG e pelo mp4, na origem da bio, com 1 h; o RASTRO leva só 8 caracteres do HMAC', async () => {
    const { svc, auditoria } = montar();
    const antes = Date.now();
    const r = await svc.assinarDaPeca(ORG, PECA, 'u1');
    expect(r.midias.map((m) => [m.tipo, m.n])).toEqual([
      ['jpeg', 1],
      ['mp4', null],
    ]);
    for (const m of r.midias) expect(m.url).toMatch(/^https:\/\/bio\.exemplo\.test\/api\/midia-publica\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    const exp = new Date(r.exp).getTime();
    expect(exp - antes).toBeGreaterThan(3590_000);
    expect(exp - antes).toBeLessThanOrEqual(3601_000);
    const rastro = auditoria[0] as { action: string; after: { midias: Array<{ hmac: string }> } };
    expect(rastro.action).toBe('pauta.midia_publica_assinada');
    expect(rastro.after.midias.map((m) => m.hmac.length)).toEqual([8, 8]);
    expect(JSON.stringify(rastro)).not.toContain(r.midias[0].url.split('/').pop()!);
    // A URL assinada abre.
    expect(await svc.abrir(r.midias[1].url.split('/').pop()!)).toMatchObject({ contentType: 'video/mp4' });
  });

  it('só a peça aprovada ganha URL: o rascunho é 400 ao assinar, e a que voltou a rascunho perde a URL já assinada', async () => {
    for (const status of ['rascunho', 'publicada', 'descartada']) {
      await expect(montar({ status }).svc.assinarDaPeca(ORG, PECA, 'u1')).rejects.toThrow(/Só a peça aprovada/);
    }
    expect(await montar({ status: 'rascunho' }).svc.abrir(tokenDe(CHAVE_MP4))).toBeNull();
    // Publicada enquanto a Graph ainda baixa: a URL segue até vencer.
    expect(await montar({ status: 'publicada' }).svc.abrir(tokenDe(CHAVE_MP4))).toMatchObject({ contentType: 'video/mp4' });
  });

  it('peça sem mídia no OS é 400; peça que não é da semana é 404', async () => {
    const semMidia = montar({ meta: { episodioId: 'e1', itemId: 'c1', formato: 'story', imagens: [] } });
    await expect(semMidia.svc.assinarDaPeca(ORG, PECA, 'u1')).rejects.toThrow(/ainda não tem mídia/);
    await expect(montar().svc.assinarDaPeca(ORG, 'outra', 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// 3. As rotas
// ---------------------------------------------------------------------------

/** Uma resposta que é um Writable de verdade (o `pipeline` exige), com os cabeçalhos num mapa. */
function respostaFalsa(cabecalhos = new Map<string, unknown>()) {
  const recebido: Buffer[] = [];
  const res = Object.assign(
    new Writable({
      write(parte: Buffer, _enc, pronto) {
        recebido.push(parte);
        pronto();
      },
    }),
    { setHeader: (k: string, v: unknown) => cabecalhos.set(k, v), removeHeader: (k: string) => cabecalhos.delete(k) },
  );
  return { res, recebido };
}

describe('midia pública: as rotas', () => {
  it('a pública não tem guarda; 404 igual quando não abre; entrega sem cache e sem a correlação', async () => {
    expect(Reflect.getMetadata('path', MidiaPublicaController)).toBe('midia-publica');
    expect(Reflect.getMetadata(GUARDS_METADATA, MidiaPublicaController)).toBeUndefined();
    const c404 = new MidiaPublicaController({ abrir: async () => null } as never);
    await expect(c404.servir('x', {} as never)).rejects.toBeInstanceOf(NotFoundException);

    const cabecalhos = new Map<string, unknown>([['x-correlation-id', 'de-fora']]);
    const { res, recebido } = respostaFalsa(cabecalhos);
    const c = new MidiaPublicaController({
      abrir: async () => ({ stream: Readable.from([Buffer.from('mp4')]), size: 3, contentType: 'video/mp4' }),
    } as never);
    await c.servir('t', res as never);
    await finished(res).catch(() => undefined);
    expect(Object.fromEntries(cabecalhos)).toEqual({
      'Content-Type': 'video/mp4',
      'Content-Length': 3,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    expect(Buffer.concat(recebido).toString()).toBe('mp4');
  });

  it('o storage que falha no meio encerra a resposta; quem baixa e desiste destrói a leitura do storage', async () => {
    const quebrado = new Readable({ read() {} });
    const falha = respostaFalsa();
    const c1 = new MidiaPublicaController({ abrir: async () => ({ stream: quebrado, size: 9, contentType: 'video/mp4' }) } as never);
    await c1.servir('t', falha.res as never);
    quebrado.push(Buffer.from('mp'));
    quebrado.destroy(new Error('minio caiu'));
    await finished(falha.res).catch(() => undefined);
    expect(falha.res.destroyed).toBe(true);

    const lento = new Readable({ read() {} });
    const desiste = respostaFalsa();
    const c2 = new MidiaPublicaController({ abrir: async () => ({ stream: lento, size: 9, contentType: 'video/mp4' }) } as never);
    await c2.servir('t', desiste.res as never);
    desiste.res.destroy();
    await finished(lento).catch(() => undefined);
    expect(lento.destroyed).toBe(true);
  });

  it('assinar é autenticado e pede pauta.publicar; o prefixo novo é do módulo pauta', () => {
    expect(Reflect.getMetadata('path', MidiaPublicaDaPecaController)).toBe('pauta');
    expect(Reflect.getMetadata(GUARDS_METADATA, MidiaPublicaDaPecaController)).toHaveLength(2);
    const proto = MidiaPublicaDaPecaController.prototype as unknown as Record<string, object>;
    expect(Reflect.getMetadata('path', proto.assinar)).toBe('pecas/:id/midia-publica');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.assinar)).toEqual(['pauta.publicar']);
    expect(moduloDoCaminho('/api/midia-publica/abc.def')).toBe('pauta');
    expect(moduloDoCaminho('/api/MIDIA-PUBLICA/abc')).toBe('pauta');
  });
});

// ---------------------------------------------------------------------------
// 4. O JPEG
// ---------------------------------------------------------------------------

describe('midia da peça: o JPEG', () => {
  const carrossel = { largura: 1080, altura: 1350 };
  const story = { largura: 1080, altura: 1920 };

  it('lê largura e altura do SOF0 e do SOF2', () => {
    expect(dimensoesDoJpeg(jpegDeTeste(1080, 1350))).toEqual({ ok: true, largura: 1080, altura: 1350 });
    expect(dimensoesDoJpeg(jpegDeTeste(720, 1280, { sof: 0xc2 }))).toEqual({ ok: true, largura: 720, altura: 1280 });
  });

  it('aceita a proporção do formato na faixa de largura da Meta', () => {
    const ok = (b: Buffer, p: typeof carrossel) => conferirJpegDaPeca({ buffer: b, mimetype: 'image/jpeg' }, p);
    expect(ok(jpegDeTeste(1080, 1350), carrossel)).toEqual({ ok: true, largura: 1080, altura: 1350 });
    expect(ok(jpegDeTeste(1440, 1800), carrossel).ok).toBe(true);
    expect(ok(jpegDeTeste(1080, 1920), story).ok).toBe(true);
    expect(ok(jpegDeTeste(320, 569), story).ok).toBe(true);
  });

  it('recusa PNG disfarçado, SOF sem perda, largura fora de 320–1440, proporção errada e mais de 8 MB', () => {
    const r = (b: Buffer, p = carrossel, mimetype = 'image/jpeg', size?: number) => conferirJpegDaPeca({ buffer: b, mimetype, size }, p);
    expect(r(Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'))).toMatchObject({ ok: false, motivo: expect.stringMatching(/não é um JPEG/) });
    expect(r(jpegDeTeste(1080, 1350, { sof: 0xc3 }))).toMatchObject({ ok: false, motivo: expect.stringMatching(/não aceita/) });
    expect(r(jpegDeTeste(1600, 2000))).toMatchObject({ ok: false, motivo: expect.stringMatching(/320 a 1440/) });
    expect(r(jpegDeTeste(300, 375))).toMatchObject({ ok: false, motivo: expect.stringMatching(/320 a 1440/) });
    expect(r(jpegDeTeste(1080, 1920))).toMatchObject({ ok: false, motivo: expect.stringMatching(/1080×1350/) });
    expect(r(jpegDeTeste(1080, 1350), carrossel, 'image/png')).toMatchObject({ ok: false });
    expect(r(jpegDeTeste(1080, 1350), carrossel, 'image/jpeg', 8 * 1024 * 1024 + 1)).toMatchObject({ ok: false, motivo: expect.stringMatching(/8 MB/) });
    expect(r(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]))).toMatchObject({ ok: false, motivo: expect.stringMatching(/SOF/) });
  });
});

// ---------------------------------------------------------------------------
// 5. O mp4 do corte
// ---------------------------------------------------------------------------

/** `pedaco`: o tamanho fixo de cada pedaço, ou os offsets onde o corpo é partido. */
async function passar(corpo: Buffer, declarado: { bytes: number; sha256: string }, aoLerMoov?: (m: unknown) => void, pedaco: number | number[] = 1000) {
  const c = new ConferenciaDoMp4(declarado, aoLerMoov as never);
  const pedacos: Buffer[] = [];
  if (typeof pedaco === 'number') for (let i = 0; i < corpo.length; i += pedaco) pedacos.push(corpo.subarray(i, i + pedaco));
  else [0, ...pedaco].forEach((ini, k, cortes) => pedacos.push(corpo.subarray(ini, cortes[k + 1] ?? corpo.length)));
  let saiu = 0;
  await new Promise<void>((ok, falha) => {
    c.on('data', (d: Buffer) => (saiu += d.length));
    c.on('end', ok);
    c.on('error', falha);
    Readable.from(pedacos).pipe(c);
  }).catch((e) => {
    throw Object.assign(e, { saiu });
  });
  return { resultado: c.resultado!, saiu };
}

describe('midia da peça: o mp4 do corte conferido no caminho', () => {
  const cab = (h: Record<string, string>) => conferirCabecalhosDoEnvio(h, PAUTA_VIDEO_DO_CORTE_MAX_BYTES);
  const certo = { 'content-type': 'video/mp4', 'content-length': '5000', 'x-conteudo-sha256': 'a'.repeat(64) };

  it('o cabeçalho: 415 sem video/mp4, 411 sem comprimento ou com chunked, 413 acima do teto, 400 sem sha', () => {
    expect(cab(certo)).toEqual({ bytes: 5000, sha256: 'a'.repeat(64) });
    const status = (h: Record<string, string>) => {
      try {
        cab(h);
        return 200;
      } catch (e) {
        return (e as ErroDoEnvio).status;
      }
    };
    expect(status({ ...certo, 'content-type': 'application/json' })).toBe(415);
    expect(status({ ...certo, 'content-length': '' })).toBe(411);
    expect(status({ ...certo, 'transfer-encoding': 'chunked' })).toBe(411);
    expect(status({ ...certo, 'content-length': String(301 * 1024 * 1024) })).toBe(413);
    expect(status({ ...certo, 'x-conteudo-sha256': 'zz' })).toBe(400);
    expect(tetoDoVideo({})).toBe(300 * 1024 * 1024);
    expect(tetoDoVideo({ PAUTA_VIDEO_MAX_BYTES: '1000' })).toBe(1000);
    expect(tetoDoVideo({ PAUTA_VIDEO_MAX_BYTES: 'lixo' })).toBe(300 * 1024 * 1024);
  });

  it('com faststart passa inteiro, em qualquer tamanho de pedaço, com o sha, a duração e o tamanho lidos do moov', async () => {
    const mp4 = mp4DeTeste({ duracaoSeg: 59.5 });
    for (const pedaco of [1, 7, 64, 100_000]) {
      const { resultado, saiu } = await passar(mp4, { bytes: mp4.length, sha256: sha256(mp4) }, undefined, pedaco);
      expect(saiu).toBe(mp4.length);
      expect(resultado).toEqual({ bytes: mp4.length, sha256: sha256(mp4), duracaoSeg: 59.5, largura: 1080, altura: 1920 });
    }
    expect(lerMoov(Buffer.alloc(0))).toEqual({ duracaoSeg: null, largura: null, altura: null });
  });

  it('o mdat com tamanho de 64 bits passa com o cabeçalho de 16 bytes partido em qualquer byte', async () => {
    const semMdat = mp4DeTeste().subarray(0, -(8 + 4096));
    const enchimento = Buffer.alloc(2048, 7);
    const cab = Buffer.alloc(16);
    cab.writeUInt32BE(1, 0);
    cab.write('mdat', 4, 'latin1');
    cab.writeBigUInt64BE(BigInt(16 + enchimento.length), 8);
    const mp4 = Buffer.concat([semMdat, cab, enchimento]);
    for (let k = 1; k < 16; k++) {
      const { resultado } = await passar(mp4, { bytes: mp4.length, sha256: sha256(mp4) }, undefined, [semMdat.length + k]);
      expect(resultado).toMatchObject({ bytes: mp4.length, sha256: sha256(mp4), duracaoSeg: 60 });
    }
  });

  it('sem faststart (moov depois do mdat) é 400 no mdat, sem esperar o fim', async () => {
    const mp4 = mp4DeTeste({ faststart: false, mdat: 50_000 });
    const e = await passar(mp4, { bytes: mp4.length, sha256: sha256(mp4) }).catch((x) => x);
    expect(e).toBeInstanceOf(ErroDoEnvio);
    expect(e).toMatchObject({ status: 400, message: expect.stringMatching(/faststart/) });
    expect(e.saiu).toBeLessThan(mp4.length);
  });

  it('corpo maior que o declarado aborta (413); menor, truncado ou com outro sha é 400', async () => {
    const mp4 = mp4DeTeste();
    await expect(passar(Buffer.concat([mp4, Buffer.alloc(10)]), { bytes: mp4.length, sha256: sha256(mp4) })).rejects.toMatchObject({ status: 413 });
    // Declarar menos do que o arquivo tem faz a caixa passar do fim declarado: recusa antes.
    await expect(passar(mp4, { bytes: mp4.length - 10, sha256: sha256(mp4) })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/passa do fim/) });
    await expect(passar(mp4.subarray(0, mp4.length - 10), { bytes: mp4.length, sha256: sha256(mp4) })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/terminou com/) });
    await expect(passar(mp4, { bytes: mp4.length, sha256: 'b'.repeat(64) })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/sha256/) });
    const naoMp4 = Buffer.concat([caixa('free', Buffer.alloc(10)), mp4]);
    await expect(passar(naoMp4, { bytes: naoMp4.length, sha256: sha256(naoMp4) })).rejects.toMatchObject({ message: expect.stringMatching(/ftyp/) });
    const semMdat = mp4.subarray(0, mp4.length - 4104);
    await expect(passar(semMdat, { bytes: semMdat.length, sha256: sha256(semMdat) })).rejects.toMatchObject({ message: expect.stringMatching(/moov e mdat/) });
  });

  it('quem lê o moov pode abortar ali: o corte de outro trecho não espera o resto', async () => {
    const mp4 = mp4DeTeste({ duracaoSeg: 30, mdat: 200_000 });
    const lidos: unknown[] = [];
    const e = await passar(mp4, { bytes: mp4.length, sha256: sha256(mp4) }, (m) => {
      lidos.push(m);
      throw new ErroDoEnvio(400, 'outro trecho');
    }).catch((x) => x);
    expect(lidos).toEqual([{ duracaoSeg: 30, largura: 1080, altura: 1920 }]);
    expect(e).toMatchObject({ message: 'outro trecho' });
    expect(e.saiu).toBeLessThan(10_000);
  });
});

// ---------------------------------------------------------------------------
// 6. O storage por stream, e o corpo que nenhum parser toca
// ---------------------------------------------------------------------------

describe('midia da peça: o storage recebe em partes e nunca conclui um envio que falhou', () => {
  function storageFalso() {
    const chamadas: string[] = [];
    const partes: number[] = [];
    const cliente = {
      putObject: async (_b: string, k: string, corpo: Buffer) => void chamadas.push(`put:${k}:${corpo.length}`),
      initiateNewMultipartUpload: async () => {
        chamadas.push('iniciar');
        return 'up-1';
      },
      uploadPart: async (cfg: { partNumber: number }, corpo: Buffer) => {
        partes.push(corpo.length);
        return { etag: `e${cfg.partNumber}`, key: 'k', part: cfg.partNumber };
      },
      completeMultipartUpload: async (_b: string, _k: string, _id: string, etags: unknown[]) => void chamadas.push(`completar:${etags.length}`),
      abortMultipartUpload: async () => void chamadas.push('abortar'),
    };
    vi.stubEnv('S3_ACCESS_KEY', 'k');
    vi.stubEnv('S3_SECRET_KEY', 's');
    const storage = new StorageService();
    (storage as unknown as { cliente: unknown }).cliente = cliente;
    return { storage, chamadas, partes };
  }
  afterEach(() => vi.unstubAllEnvs());

  it('arquivo grande sobe em partes de 16 MB e conclui; pequeno vai num PUT só', async () => {
    const { storage, chamadas, partes } = storageFalso();
    const total = PARTE_DO_ENVIO * 2 + 123;
    const pedacos = Array.from({ length: Math.ceil(total / (1024 * 1024)) }, (_, i) => Buffer.alloc(Math.min(1024 * 1024, total - i * 1024 * 1024)));
    await storage.putStream('k.mp4', Readable.from(pedacos), total, 'video/mp4');
    expect(partes).toEqual([PARTE_DO_ENVIO, PARTE_DO_ENVIO, 123]);
    expect(chamadas).toEqual(['iniciar', 'completar:3']);
    await storage.putStream('p.mp4', Readable.from([Buffer.alloc(10)]), 10, 'video/mp4');
    expect(chamadas.at(-1)).toBe('put:p.mp4:10');
  });

  it('o erro no meio do stream aborta o envio em partes, sem concluir e sem ficar pendurado', async () => {
    const { storage, chamadas } = storageFalso();
    const mp4 = Buffer.concat([mp4DeTeste({ mdat: PARTE_DO_ENVIO + 10 })]);
    const conferencia = new ConferenciaDoMp4({ bytes: mp4.length, sha256: 'c'.repeat(64) });
    Readable.from([mp4.subarray(0, PARTE_DO_ENVIO), mp4.subarray(PARTE_DO_ENVIO)]).pipe(conferencia);
    await expect(storage.putStream('k.mp4', conferencia, mp4.length, 'video/mp4')).rejects.toMatchObject({ message: expect.stringMatching(/sha256/) });
    expect(chamadas).toEqual(['iniciar', 'abortar']);
  });
});

describe('midia da peça: o uso do storage (MD4), medido e com os órfãos separados', () => {
  const dia = 86_400_000;
  const agora = new Date('2026-09-25T12:00:00Z');
  const obj = (chave: string, mb: number, diasAtras: number) => ({ chave, bytes: mb * 1024 * 1024, modificadoEm: new Date(agora.getTime() - diasAtras * dia) });

  it('a meta referencia o mp4 do corte e cada imagem; o resto do bucket é órfão, com a idade', () => {
    const meta = { video: { chave: 'pauta/pecas/p1/corte-a.mp4' }, imagens: [{ chave: 'pauta/peca/p1-1-aaa.png' }, { chave: 'pauta/peca/p1-1-aaa.jpg' }, { n: 2 }] };
    expect(chavesDaMeta(meta)).toEqual(['pauta/pecas/p1/corte-a.mp4', 'pauta/peca/p1-1-aaa.png', 'pauta/peca/p1-1-aaa.jpg']);
    expect(chavesDaMeta(null)).toEqual([]);
    expect(chavesDaMeta({ video: null, imagens: 'x' })).toEqual([]);

    const objetos = [
      obj('pauta/pecas/p1/corte-a.mp4', 120, 20),
      // O candidato trocado (MD13), o re-render e o envio que caiu no 409: ninguém aponta para eles.
      obj('pauta/pecas/p1/corte-velho.mp4', 118, 30),
      obj('pauta/pecas/p2/corte-409.mp4', 121, 10),
      obj('pauta/pecas/p1/corte-de-ontem.mp4', 119, 1),
      obj('pauta/peca/p1-1-aaa.png', 1, 20),
    ];
    const uso = usoDoStorage(objetos, new Set(chavesDaMeta(meta)), agora, 7);
    expect(uso).toMatchObject({ objetos: 5, referenciados: { objetos: 2 }, orfaos: { objetos: 3 } });
    expect(uso.bytes).toBe(479 * 1024 * 1024);
    // O órfão de ontem pode ser um envio que ainda vai ser gravado na peça: fica.
    expect(uso.removiveis.map((o) => [o.chave, o.idadeDias])).toEqual([
      ['pauta/pecas/p1/corte-velho.mp4', 30],
      ['pauta/pecas/p2/corte-409.mp4', 10],
    ]);
    expect(formatarBytes(uso.bytes)).toBe('479 MB');
    expect(formatarBytes(1_610_612_736)).toBe('1,5 GB');
  });

  it('a remoção recusa quando nenhuma peça referencia nada (a leitura não atravessou o isolamento) ou quando uma empresa falhou', () => {
    const objetos = [obj('pauta/pecas/p1/corte-a.mp4', 120, 20)];
    expect(motivoParaNaoRemover(usoDoStorage(objetos, new Set(), agora, 7), 0, 0)).toMatch(/não atravessou o isolamento/);
    expect(motivoParaNaoRemover(usoDoStorage(objetos, new Set(['pauta/pecas/p1/corte-a.mp4']), agora, 7), 3, 1)).toMatch(/falhou/);
    expect(motivoParaNaoRemover(usoDoStorage(objetos, new Set(['pauta/pecas/p1/corte-a.mp4']), agora, 7), 3, 0)).toBeNull();
  });

  it('o storage lista o prefixo com tamanho e data, remove um objeto por vez, e o boot loga o total da mídia das peças', async () => {
    const removidos: string[] = [];
    const cliente = {
      listObjectsV2: (_b: string, prefixo: string) =>
        Readable.from(
          prefixo === 'pauta/pecas/'
            ? [{ name: 'pauta/pecas/p1/corte-a.mp4', size: 3 * 1024 * 1024, lastModified: agora }]
            : [{ name: 'pauta/peca/p1-1-aaa.png', size: 1024, lastModified: agora }],
        ),
      removeObject: async (_b: string, k: string) => void removidos.push(k),
      bucketExists: async () => true,
    };
    vi.stubEnv('S3_ACCESS_KEY', 'k');
    vi.stubEnv('S3_SECRET_KEY', 's');
    try {
      const storage = new StorageService();
      (storage as unknown as { cliente: unknown }).cliente = cliente;
      expect(await storage.listar('pauta/pecas/')).toEqual([{ chave: 'pauta/pecas/p1/corte-a.mp4', bytes: 3 * 1024 * 1024, modificadoEm: agora }]);
      await storage.remover('pauta/pecas/p1/corte-a.mp4');
      expect(removidos).toEqual(['pauta/pecas/p1/corte-a.mp4']);

      const linhas: string[] = [];
      (storage as unknown as { log: { log: (m: string) => void; warn: (m: string) => void } }).log = { log: (m) => linhas.push(m), warn: (m) => linhas.push(m) };
      await storage.onModuleInit();
      await vi.waitFor(() => expect(linhas.some((l) => l.startsWith('mídia das peças no storage: 3 MB em 2 objeto(s)'))).toBe(true));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('o comando existe compilado no package.json e fica fora de toda rotina', () => {
    const pacote = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pacote.scripts['storage:uso']).toBe('node dist/scripts/storage-uso.js');
    const script = readFileSync(path.join(__dirname, '..', 'src', 'scripts', 'storage-uso.ts'), 'utf8');
    expect(script).toMatch(/--remover-orfaos/);
    expect(script).toMatch(/--confirmar/);
    expect(script).toMatch(/conferirQueAtravessaOIsolamento/);
  });
});

describe('midia da peça: o corpo video/mp4 chega intacto ao controller', () => {
  it('a rota nova não está entre as de corpo grande, e o json/urlencoded do Nest não leem video/mp4', async () => {
    expect(ROTAS_DE_MIDIA_DO_EPISODIO).not.toContain('/pauta/pecas/:id/video/arquivo' as never);
    const doNest = createRequire(createRequire(__filename).resolve('@nestjs/platform-express'));
    const express = doNest('express') as typeof import('express');
    const { json, urlencoded } = doNest('body-parser') as typeof import('body-parser');
    const app = express();
    app.use(json());
    app.use(urlencoded({ extended: true }));
    app.post('/x', (req, res) => {
      const lidoAntes = (req as unknown as { _body?: boolean })._body === true;
      let n = 0;
      req.on('data', (d: Buffer) => (n += d.length));
      req.on('end', () => res.json({ lidoAntes, n }));
    });
    const servidor = createServer(app);
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    try {
      const corpo = mp4DeTeste({ mdat: 300_000 });
      const r = await fetch(`http://127.0.0.1:${(servidor.address() as AddressInfo).port}/x`, {
        method: 'POST',
        headers: { 'Content-Type': 'video/mp4' },
        body: corpo,
      });
      expect(await r.json()).toEqual({ lidoAntes: false, n: corpo.length });
    } finally {
      servidor.close();
    }
  });
});
