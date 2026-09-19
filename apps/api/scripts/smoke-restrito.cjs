#!/usr/bin/env node
// Grafo Nest COMPILADO + HTTP real em loopback + PostgreSQL restrito.
// Exige TEST_DATABASE_URL/TENANT_DATABASE_URL locais e descartáveis, já migradas
// e com db:seed:politica. Não importa main.js (que lê credenciais pessoais).
const assert = require('node:assert/strict');
const { mkdtempSync, rmdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

function validarUrls(dono, restrito) {
  const urls = [dono, restrito].map(valor => {
    assert(valor, 'Exige duas URLs de teste.');
    const url = new URL(valor);
    assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Smoke restrito só aceita banco local.');
    assert(/test|dev|local|staging|shadow/i.test(url.pathname), 'Banco não descartável.');
    return url;
  });
  assert(urls[0].host === urls[1].host && urls[0].pathname === urls[1].pathname,
    'As conexões devem apontar para o mesmo banco.');
  assert(urls[0].username !== urls[1].username, 'O papel restrito deve ser distinto do dono.');
}

if (process.argv[2] !== '--filho') {
  const dono = process.env.TEST_DATABASE_URL;
  const restrito = process.env.TENANT_DATABASE_URL;
  validarUrls(dono, restrito);
  const pasta = mkdtempSync(join(tmpdir(), 'rootos-smoke-restrito-'));
  try {
    const filho = spawnSync(process.execPath, [__filename, '--filho'], {
      cwd: pasta, stdio: 'inherit', timeout: 60_000,
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: dono, APP_DATABASE_URL: restrito, TENANT_MODO: 'impor',
        JWT_SECRET: 'segredo-exclusivamente-sintetico-do-smoke',
        ONBOARDING_ABERTO: 'sim', ROTINAS_CRON: 'off',
        CLICKUP_SYNC_INTERVAL_MIN: '0', PLUGGY_SYNC_INTERVAL_MIN: '0', OBSIDIAN_REINDEX_MIN: '0',
      },
    });
    process.exitCode = filho.status === 0 && !filho.error ? 0 : 1;
  } finally { rmdirSync(pasta); }
} else {
  validarUrls(process.env.DATABASE_URL, process.env.APP_DATABASE_URL);
  assert.equal(process.env.TENANT_MODO, 'impor', 'Smoke exige modo impor.');
  require('reflect-metadata');
  const { randomUUID } = require('node:crypto');
  const { PrismaClient } = require('@prisma/client');
  const { NestFactory } = require('@nestjs/core');
  const bcrypt = require('bcryptjs');
  const { AppModule } = require('../dist/app.module');
  const { ZodExceptionFilter } = require('../dist/common/zod-exception.filter');
  const { TetoDeCustoIaService } = require('../dist/llm/teto-diario.service');
  const dono = new PrismaClient();
  const papel = new PrismaClient({ datasourceUrl: process.env.APP_DATABASE_URL });
  const emails = [0, 1].map(n => `smoke-${randomUUID()}-${n}@example.test`);
  const correlacao = `smoke-${randomUUID()}`;
  const senha = randomUUID();
  let app;
  let base;
  async function pedir(path, { token, body, method = body ? 'POST' : 'GET', status = 200 } = {}) {
    const resposta = await fetch(`${base}${path}`, {
      method, signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlacao,
        ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(resposta.status, status, `${path}: status HTTP inesperado`);
    return resposta.json();
  }
  async function rodar() {
    const [role] = await papel.$queryRaw`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    assert.deepEqual(role, { rolsuper: false, rolbypassrls: false });
    app = await NestFactory.create(AppModule, { logger: ['error', 'warn'], abortOnError: false });
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new ZodExceptionFilter());
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${app.getHttpServer().address().port}/api`;
    assert.equal((await pedir('/health')).db, 'ok');
    await pedir('/tenants/onboarding/estado', { status: 401 });
    const tokens = [], pessoas = [];
    for (const email of emails) {
      const cadastro = await pedir('/tenants/onboarding/cadastro', {
        status: 201, body: { empresa: 'Smoke sintético', nome: 'Pessoa de teste', email },
      });
      assert.equal(cadastro.ok, true);
      const pessoa = await dono.user.findUniqueOrThrow({ where: { email } });
      pessoas.push(pessoa);
      // Só as contas sintéticas deste teste ganham senha local. OAuth não é simulado como validado.
      await dono.user.update({ where: { id: pessoa.id }, data: { passwordHash: await bcrypt.hash(senha, 4) } });
      const sessao = await pedir('/auth/login', { status: 201, body: { email, password: senha } });
      assert(sessao.token);
      tokens.push(sessao.token);
      await pedir('/tenants/onboarding/estado', { token: sessao.token });
    }
    await pedir('/auth/login', { status: 401, body: { email: emails[0], password: 'senha-errada' } });
    const nota = await pedir('/tenants/onboarding/carga/resposta', {
      token: tokens[0], status: 201, body: { tema: 'negocio', orgId: pessoas[1].orgId,
        resposta: 'Empresa sintética A: frase-exclusiva-A; organiza dados financeiros de pequenas empresas e entrega revisão mensal ao responsável.' },
    });
    const gravada = await dono.contextItem.findUniqueOrThrow({ where: { id: nota.notaId } });
    assert.equal(gravada.orgId, pessoas[0].orgId, 'orgId do corpo não pode substituir o tenant autenticado');
    const grantsA = {};
    for (const field of ['sourceRef', 'title', 'body']) {
      grantsA[field] = await pedir('/memoria/grants', {
        token: tokens[0], status: 201,
        body: {
          sourceType: gravada.sourceType, sourceRef: gravada.sourceRef,
          field, provider: 'agente_externo', consentVersion: 'smoke-v1',
          consentText: `Consentimento sintético explícito: ${gravada.sourceType}/${gravada.sourceRef}/${field}.`,
        },
      });
    }
    const credencial = await pedir('/auth/agent-tokens', {
      token: tokens[0], status: 201,
      body: { name: 'smoke-memoria', scopes: ['memoria.buscar'], validadeDias: 1 },
    });
    assert(credencial.token && credencial.id);
    const buscaAgente = await pedir(`/agent/memoria/buscar?q=${encodeURIComponent('frase-exclusiva-A')}`, {
      token: credencial.token,
    });
    assert.equal(buscaAgente.diagnostico, 'ok');
    assert.equal(buscaAgente.modo, 'textual');
    assert.equal(buscaAgente.itens.length, 1);
    assert.equal(buscaAgente.itens[0].sourceRef, gravada.sourceRef);
    assert(!JSON.stringify(buscaAgente).includes('Bearer'));
    const credencialLeitura = await pedir('/auth/agent-tokens', {
      token: tokens[0], status: 201,
      body: { name: 'smoke-memoria-leitura', scopes: ['memoria.buscar', 'memoria.ler'], validadeDias: 1 },
    });
    const leituraA = await pedir(`/agent/memoria/ler/${encodeURIComponent(nota.notaId)}`, {
      token: credencialLeitura.token,
    });
    assert.equal(leituraA.id, nota.notaId);
    assert(leituraA.fields.body.includes('frase-exclusiva-A'));
    await pedir(`/agent/memoria/ler/${encodeURIComponent(nota.notaId)}`, {
      token: credencial.token, status: 403,
    });

    const notaB = await pedir('/tenants/onboarding/carga/resposta', {
      token: tokens[1], status: 201,
      body: { tema: 'negocio', orgId: pessoas[0].orgId,
        resposta: 'Empresa B sintética exclusiva: frase-própria-B sem relação com a empresa A.' },
    });
    const gravadaB = await dono.contextItem.findUniqueOrThrow({ where: { id: notaB.notaId } });
    assert.equal(gravadaB.orgId, pessoas[1].orgId);
    const grantsB = {};
    for (const field of ['sourceRef', 'title', 'body']) {
      grantsB[field] = await pedir('/memoria/grants', {
        token: tokens[1], status: 201,
        body: {
          sourceType: gravadaB.sourceType, sourceRef: gravadaB.sourceRef,
          field, provider: 'agente_externo', consentVersion: 'smoke-v1',
          consentText: `Consentimento sintético explícito: ${gravadaB.sourceType}/${gravadaB.sourceRef}/${field}.`,
        },
      });
    }
    const credencialB = await pedir('/auth/agent-tokens', {
      token: tokens[1], status: 201,
      body: { name: 'smoke-memoria-b', scopes: ['memoria.buscar', 'memoria.ler'], validadeDias: 1 },
    });
    const buscaB = await pedir(`/agent/memoria/buscar?q=${encodeURIComponent('frase-exclusiva-A')}`, {
      token: credencialB.token,
    });
    assert.equal(buscaB.diagnostico, 'ok');
    assert.equal(buscaB.itens.length, 0, 'PAT da empresa B não pode ver a nota A');
    const buscaBPropria = await pedir(`/agent/memoria/buscar?q=${encodeURIComponent('frase-própria-B')}`, {
      token: credencialB.token,
    });
    assert.equal(buscaBPropria.itens.length, 1);
    assert.equal(buscaBPropria.itens[0].sourceRef, gravadaB.sourceRef);
    await pedir(`/agent/memoria/ler/${encodeURIComponent(nota.notaId)}`, {
      token: credencialB.token, status: 404,
    });
    const leituraB = await pedir(`/agent/memoria/ler/${encodeURIComponent(notaB.notaId)}`, {
      token: credencialB.token,
    });
    assert.equal(leituraB.id, notaB.notaId);

    const grantsListadas = await pedir('/memoria/grants', { token: tokens[0] });
    const grantBodyA = grantsListadas.find((grant) => grant.field === 'body' && grant.sourceRef === gravada.sourceRef);
    assert(grantBodyA?.id, 'a concessão de body da empresa A precisa ser listável antes da revogação');
    await pedir(`/memoria/grants/${grantBodyA.id}/revogar`, { token: tokens[0], method: 'POST', status: 201 });
    const buscaAposRevogarGrant = await pedir(`/agent/memoria/buscar?q=${encodeURIComponent('frase-exclusiva-A')}`, {
      token: credencial.token,
    });
    assert.equal(buscaAposRevogarGrant.diagnostico, 'ok');
    assert.equal(buscaAposRevogarGrant.itens.length, 0, 'revogar grant deve valer na busca seguinte');
    const leituraAposRevogarGrant = await pedir(`/agent/memoria/ler/${encodeURIComponent(nota.notaId)}`, {
      token: credencialLeitura.token,
    });
    assert.equal(leituraAposRevogarGrant.fields.body, undefined);
    await pedir(`/auth/agent-tokens/${credencial.id}/revogar`, { token: tokens[0], method: 'POST', status: 201 });
    await pedir('/agent/memoria/buscar?q=frase-exclusiva-A', { token: credencial.token, status: 401 });
    await pedir('/agent/memoria/buscar?q=Empresa', { token: tokens[1], status: 401 });
    await pedir(`/memoria/${nota.notaId}`, { token: tokens[0] });
    await pedir(`/memoria/${nota.notaId}`, { token: tokens[1], status: 404 });
    await pedir('/tenants/provisionar', { token: tokens[1], body: { slug: 'nao-autorizado-smoke' }, status: 403 });
    assert.equal((await pedir('/memoria/integridade', { token: tokens[0] })).ok, true);
    // O arranque não pode apenas engolir uma falha de varredura e parecer saudável.
    await app.get(TetoDeCustoIaService).liberarReservasPresas('varredura');
    console.log('SMOKE_RESTRITO_OK: boot, saúde, cadastro/login, grants, PAT, revogações imediatas, isolamento HTTP entre tenants e recusa de provisionamento.');
  }
  async function limpar() {
    if (app) await app.close();
    const pessoas = await dono.user.findMany({ where: { email: { in: emails } }, select: { orgId: true } });
    for (const { orgId } of pessoas) {
      await dono.contextItemVersion.deleteMany({ where: { orgId } });
      await dono.contextItem.deleteMany({ where: { orgId } });
      await dono.agentDataGrant.deleteMany({ where: { orgId } });
      await dono.agentToken.deleteMany({ where: { orgId } });
      await dono.knowledgeNote.deleteMany({ where: { orgId } });
      await dono.sop.deleteMany({ where: { orgId } });
      await dono.agent.deleteMany({ where: { orgId } });
      await dono.auditLog.deleteMany({ where: { orgId } });
      await dono.$transaction([
        dono.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
        dono.eventLog.deleteMany({ where: { orgId } }),
        dono.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
      ]);
      await dono.user.deleteMany({ where: { orgId } });
      await dono.role.deleteMany({ where: { orgId } });
      await dono.org.delete({ where: { id: orgId } });
    }
    // A intenção do cadastro pode ter sido registrada na root preexistente.
    // Limpar só a correlação exclusiva deste ensaio, nunca todos os dados dela.
    await dono.auditLog.deleteMany({ where: { metadata: { path: ['correlationId'], equals: `ext-${correlacao}` } } });
    await dono.$transaction([
      dono.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
      dono.eventLog.deleteMany({ where: { correlationId: `ext-${correlacao}` } }),
      dono.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
    ]);
    await Promise.all([dono.$disconnect(), papel.$disconnect()]);
  }
  (async () => {
    let codigo = 0;
    try { await rodar(); } catch (erro) { console.error('SMOKE_RESTRITO_FALHOU:', erro.message); codigo = 1; }
    try { await limpar(); } catch (erro) { console.error('Limpeza das fixtures falhou:', erro.message); codigo = 1; }
    process.exit(codigo);
  })();
}
