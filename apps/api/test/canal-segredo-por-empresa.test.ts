import 'reflect-metadata';
import { createHmac, randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditService } from '../src/audit/audit.service';
import { JwtAuthGuard, TIPO_DA_SESSAO } from '../src/auth/jwt-auth.guard';
import { PermissionsGuard } from '../src/auth/permissions.guard';
import { ContextoInterceptor } from '../src/common/contexto.interceptor';
import { IntegracaoDaEvolutionController } from '../src/comercial/evolution.controller';
import { CanalDeAprovacaoController } from '../src/gateway/canais/canal-de-aprovacao.controller';
import type { CanalDeAprovacaoService } from '../src/gateway/canais/canal-de-aprovacao.service';
import { segredoDoCanalDaEmpresa, segredoDoWebhookConfere } from '../src/gateway/canais/configuracao-do-canal';
import { ADMINISTRACAO_DA_EVOLUTION } from '../src/gateway/canais/evolution.port';
import { PrismaService } from '../src/prisma/prisma.service';

/*
 * PRODUÇÃO 22, M4 · O SEGREDO DO WEBHOOK POR EMPRESA.
 *
 * A casa continua com o segredo do processo. Cada outra empresa usa o
 * HMAC-SHA256 dele com o próprio `orgId`. O global nunca vale em outra empresa,
 * o derivado de A nunca vale em B, e a tela mostra o segredo da empresa só para
 * quem tem `admin.usuarios`, sem cache e auditado sem o valor.
 */

const GLOBAL = 'segredo-do-processo-da-suite-m4-0123456789';
const CODIGO = 'segredo-do-codigo-da-suite-m4-9876543210ab';
const CASA = 'org-casa-m4';
const ORG_A = 'org-a-m4';
const ORG_B = 'org-b-m4';
const ambiente = { CANAL_APROVACAO_SEGREDO: GLOBAL, CANAL_APROVACAO_CODIGO_SEGREDO: CODIGO } as NodeJS.ProcessEnv;
const ehDaCasa = vi.fn(async (orgId: string) => orgId === CASA);

describe('o segredo do webhook de cada empresa', () => {
  beforeEach(() => ehDaCasa.mockClear());

  it('o derivado é o HMAC-SHA256 do segredo do processo com o orgId, em hexadecimal', () => {
    const esperado = createHmac('sha256', GLOBAL).update(ORG_A).digest('hex');
    expect(segredoDoCanalDaEmpresa(ORG_A, ambiente)).toBe(esperado);
    expect(segredoDoCanalDaEmpresa(ORG_A, ambiente)).not.toBe(segredoDoCanalDaEmpresa(ORG_B, ambiente));
  });

  it('a casa entra com o segredo do processo', async () => {
    expect(await segredoDoWebhookConfere(GLOBAL, CASA, ehDaCasa, ambiente)).toBe(true);
  });

  it('outra empresa entra com o derivado dela, sem perguntar se é a casa', async () => {
    expect(await segredoDoWebhookConfere(segredoDoCanalDaEmpresa(ORG_A, ambiente)!, ORG_A, ehDaCasa, ambiente)).toBe(true);
    expect(ehDaCasa).not.toHaveBeenCalled();
  });

  it('o segredo do processo é recusado em outra empresa', async () => {
    expect(await segredoDoWebhookConfere(GLOBAL, ORG_A, ehDaCasa, ambiente)).toBe(false);
    expect(ehDaCasa).toHaveBeenCalledWith(ORG_A);
  });

  it('o derivado de A é recusado em B (e na casa)', async () => {
    const deA = segredoDoCanalDaEmpresa(ORG_A, ambiente)!;
    expect(await segredoDoWebhookConfere(deA, ORG_B, ehDaCasa, ambiente)).toBe(false);
    expect(await segredoDoWebhookConfere(deA, CASA, ehDaCasa, ambiente)).toBe(false);
  });

  it('quem não tem o segredo do processo nunca provoca a pergunta "é a casa?"', async () => {
    expect(await segredoDoWebhookConfere('qualquer-coisa-do-mesmo-tamanho-0000000000', CASA, ehDaCasa, ambiente)).toBe(false);
    expect(await segredoDoWebhookConfere(undefined, CASA, ehDaCasa, ambiente)).toBe(false);
    expect(ehDaCasa).not.toHaveBeenCalled();
  });

  it('canal desligado (ou pela metade) recusa tudo, inclusive o derivado', async () => {
    const pelaMetade = { CANAL_APROVACAO_SEGREDO: GLOBAL } as NodeJS.ProcessEnv;
    const derivadoDeAntes = segredoDoCanalDaEmpresa(ORG_A, ambiente)!;
    expect(segredoDoCanalDaEmpresa(ORG_A, pelaMetade)).toBeNull();
    expect(await segredoDoWebhookConfere(derivadoDeAntes, ORG_A, ehDaCasa, pelaMetade)).toBe(false);
    expect(await segredoDoWebhookConfere(GLOBAL, CASA, ehDaCasa, pelaMetade)).toBe(false);
  });

  it('se a pergunta "é a casa?" falha, o segredo do processo não entra', async () => {
    const falha = vi.fn(async () => {
      throw new Error('banco fora');
    });
    expect(await segredoDoWebhookConfere(GLOBAL, CASA, falha, ambiente)).toBe(false);
  });
});

describe('o webhook do canal confere pelo orgId do caminho', () => {
  const antes = { ...process.env };
  beforeEach(() => {
    process.env.CANAL_APROVACAO_SEGREDO = GLOBAL;
    process.env.CANAL_APROVACAO_CODIGO_SEGREDO = CODIGO;
  });
  afterEach(() => {
    process.env = { ...antes };
  });

  function montar(comBanco = true) {
    const receber = vi.fn(async () => ({ desfecho: 'ignorado:teste' }));
    const prisma = {
      org: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === CASA ? { id: CASA } : null)) },
    } as unknown as PrismaService;
    const webhook = new CanalDeAprovacaoController({ receber } as unknown as CanalDeAprovacaoService, undefined, undefined, comBanco ? prisma : undefined);
    return { webhook, receber };
  }

  it('casa com o segredo do processo: entra', async () => {
    const { webhook, receber } = montar();
    await expect(webhook.whatsapp(CASA, GLOBAL, { event: 'x' })).resolves.toEqual({ ok: true });
    await webhook.trabalhoEmCurso;
    expect(receber).toHaveBeenCalledTimes(1);
  });

  it('outra empresa com o derivado dela: entra; com o global ou o de outra: 404', async () => {
    const { webhook, receber } = montar();
    await expect(webhook.whatsapp(ORG_A, segredoDoCanalDaEmpresa(ORG_A)!, { event: 'x' })).resolves.toEqual({ ok: true });
    await webhook.trabalhoEmCurso;
    await expect(webhook.whatsapp(ORG_A, GLOBAL, { event: 'x' })).rejects.toMatchObject({ status: 404 });
    await expect(webhook.whatsapp(ORG_B, segredoDoCanalDaEmpresa(ORG_A)!, { event: 'x' })).rejects.toMatchObject({ status: 404 });
    expect(receber).toHaveBeenCalledTimes(1);
  });

  it('sem o banco, o segredo do processo não vale em empresa nenhuma (falha fechada)', async () => {
    const { webhook } = montar(false);
    await expect(webhook.whatsapp(CASA, GLOBAL, { event: 'x' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('a rota da tela: GET /integrations/evolution/segredo-do-webhook', () => {
  let app: INestApplication;
  let baseUrl = '';
  const jwt = new JwtService({ secret: randomUUID() + randomUUID(), signOptions: { expiresIn: '15m' } });
  const auditados: unknown[] = [];
  const antes = { ...process.env };
  const logs: string[] = [];

  beforeAll(async () => {
    process.env.CANAL_APROVACAO_SEGREDO = GLOBAL;
    process.env.CANAL_APROVACAO_CODIGO_SEGREDO = CODIGO;
    const prisma = {
      org: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === CASA ? { id: CASA } : null)) },
    };
    const audit = { log: vi.fn(async (x: unknown) => void auditados.push(x)) };
    const reflector = new Reflector();
    Reflect.defineMetadata('design:paramtypes', [Object, PrismaService, AuditService], IntegracaoDaEvolutionController);
    const modulo = await Test.createTestingModule({
      controllers: [IntegracaoDaEvolutionController],
      providers: [
        { provide: ADMINISTRACAO_DA_EVOLUTION, useValue: {} },
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: JwtService, useValue: jwt },
        Reflector,
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue(new JwtAuthGuard(jwt))
      .overrideGuard(PermissionsGuard).useValue(new PermissionsGuard(reflector))
      .compile();
    app = modulo.createNestApplication({
      logger: { log: (m: string) => logs.push(String(m)), error: (m: string) => logs.push(String(m)), warn: (m: string) => logs.push(String(m)), debug: () => undefined, verbose: () => undefined },
    });
    app.useGlobalInterceptors(new ContextoInterceptor());
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    process.env = { ...antes };
    if (app) await app.close();
  });

  const pedir = (orgId: string, permissions: string[]) =>
    fetch(`${baseUrl}/integrations/evolution/segredo-do-webhook`, {
      headers: { authorization: `Bearer ${jwt.sign({ typ: TIPO_DA_SESSAO, sub: 'u-1', orgId, roles: [], permissions })}` },
    });

  it('sem admin.usuarios: 403, e o segredo não sai', async () => {
    const r = await pedir(ORG_A, ['dashboard.ver']);
    expect(r.status).toBe(403);
    expect(await r.text()).not.toContain(segredoDoCanalDaEmpresa(ORG_A)!);
  });

  it('com admin.usuarios, empresa de fora: o derivado dela, no-store, auditado sem o valor', async () => {
    auditados.length = 0;
    const r = await pedir(ORG_A, ['admin.usuarios']);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const corpo = (await r.json()) as { segredo: string; daCasa: boolean; ligado: boolean; cabecalho: string };
    expect(corpo).toMatchObject({ ligado: true, daCasa: false, cabecalho: 'x-canal-segredo' });
    expect(corpo.segredo).toBe(segredoDoCanalDaEmpresa(ORG_A));
    expect(corpo.segredo).not.toBe(GLOBAL);
    expect(auditados).toHaveLength(1);
    expect(JSON.stringify(auditados)).not.toContain(corpo.segredo);
    expect(JSON.stringify(auditados)).toContain('integracao.evolution.segredo_do_webhook_visto');
    expect(logs.join('\n')).not.toContain(corpo.segredo);
  });

  it('com admin.usuarios, a casa: o segredo do processo', async () => {
    const r = await pedir(CASA, ['admin.usuarios']);
    const corpo = (await r.json()) as { segredo: string; daCasa: boolean };
    expect(corpo).toMatchObject({ daCasa: true, segredo: GLOBAL });
    expect(logs.join('\n')).not.toContain(GLOBAL);
  });
});
