#!/usr/bin/env node
// Grafo Nest COMPILADO + HTTP real em loopback + PostgreSQL restrito.
// Exige TEST_DATABASE_URL/TENANT_DATABASE_URL locais e descartáveis, já migradas
// e com db:seed:politica. Não importa main.js (que lê credenciais pessoais).
const assert = require('node:assert/strict');
const { mkdtempSync, rmdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync, spawn } = require('node:child_process');

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

function rodarClientePython(api, entrada) {
  const raiz = join(__dirname, '../../..');
  const script = join(raiz, 'tools/conector-local/smoke_http.py');
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-B', script, '--api', api], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH, PYTHONPATH: join(raiz, 'tools/conector-local'), PYTHONWARNINGS: 'error' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderrBytes = 0;
    const maxOutput = 64 * 1024;
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('cliente Python excedeu o timeout do smoke')); }, 30_000);
    child.stdout.on('data', (chunk) => {
      if (Buffer.byteLength(stdout) + chunk.length <= maxOutput) stdout += chunk;
      else child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk) => { stderrBytes += chunk.length; if (stderrBytes > maxOutput) child.kill('SIGKILL'); });
    child.on('error', (error) => { clearTimeout(timer); reject(new Error(`cliente Python não iniciou: ${error.message}`)); });
    child.on('close', (status) => {
      clearTimeout(timer);
      if (status !== 0) {
        try {
          const diagnostic = JSON.parse(stdout);
          if (diagnostic?.marker === 'PYTHON_CLIENT_SMOKE_ERROR') {
            return reject(new Error(`cliente Python falhou (${diagnostic.stage}/${diagnostic.kind}${diagnostic.status ? `/${diagnostic.status}` : ''})`));
          }
        } catch { /* diagnóstico não estruturado permanece sanitizado */ }
        return reject(new Error('cliente Python falhou (erro sanitizado)'));
      }
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('cliente Python não devolveu marcador JSON')); }
    });
    child.stdin.end(JSON.stringify(entrada));
  });
}

if (process.argv[2] !== '--filho') {
  const dono = process.env.TEST_DATABASE_URL;
  const restrito = process.env.TENANT_DATABASE_URL;
  validarUrls(dono, restrito);
  const e4bObrigatorio = process.env.E4B_TOOL_REQUIRED === '1';
  if (e4bObrigatorio) {
    for (const nome of ['E4B_TOOL_SLUG', 'E4B_TOOL_TABLE', 'E4B_TOOL_HASH']) {
      assert(process.env[nome], `${nome} é obrigatório quando E4B_TOOL_REQUIRED=1`);
    }
  }
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
        ...(e4bObrigatorio ? {
          E4B_TOOL_REQUIRED: '1',
          E4B_TOOL_SLUG: process.env.E4B_TOOL_SLUG,
          E4B_TOOL_TABLE: process.env.E4B_TOOL_TABLE,
          E4B_TOOL_HASH: process.env.E4B_TOOL_HASH,
        } : {}),
      },
    });
    process.exitCode = filho.status === 0 && !filho.error ? 0 : 1;
  } finally { rmdirSync(pasta); }
} else {
  validarUrls(process.env.DATABASE_URL, process.env.APP_DATABASE_URL);
  assert.equal(process.env.TENANT_MODO, 'impor', 'Smoke exige modo impor.');
  require('reflect-metadata');
  const { randomUUID } = require('node:crypto');
  const { ActorType, Prisma, PrismaClient } = require('@prisma/client');
  const { NestFactory } = require('@nestjs/core');
  const bcrypt = require('bcryptjs');
  const { AppModule } = require('../dist/app.module');
  const { ZodExceptionFilter } = require('../dist/common/zod-exception.filter');
  const { TetoDeCustoIaService } = require('../dist/llm/teto-diario.service');
  const { PolicyService } = require('../dist/policy/policy.service');
  const { ToolGateway } = require('../dist/gateway/tool-gateway.service');
  const { EfeitosRegistry } = require('../dist/gateway/efeitos.registry');
  const { ferramentasGeradas, FERRAMENTAS_TOOL_HASH } = require('../dist/ferramentas/bridge');
  const { configurarBodyParser } = require('../dist/common/configurar-body-parser');
  const { comEmpresaResolvida } = require('../dist/prisma/contexto-de-plataforma');
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
    app = await NestFactory.create(AppModule, { logger: ['error', 'warn'], abortOnError: false, bodyParser: false });
    configurarBodyParser(app);
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new ZodExceptionFilter());
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${app.getHttpServer().address().port}/api`;
    const wireOverLimit = await fetch(`${base}/conector/remessa`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oversized: 'x'.repeat(12 * 1024 * 1024) }),
    });
    assert.equal(wireOverLimit.status, 413, 'parser da remessa deve rejeitar JSON acima do teto de wire');
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

    async function rodarFerramentaE4b() {
      assert.equal(process.env.E4B_TOOL_REQUIRED, '1', 'a prova E4b exige marcador explícito');
      const slug = process.env.E4B_TOOL_SLUG;
      const tabela = process.env.E4B_TOOL_TABLE;
      const toolHash = process.env.E4B_TOOL_HASH;
      assert(slug && tabela && toolHash, 'identidade E4b incompleta');
      assert(/^[a-z][a-z0-9-]{1,47}$/.test(slug), 'slug E4B inválido');
      assert(/^tool_[a-z0-9_]+_registro$/.test(tabela), 'tabela E4B inválida');
      assert(/^[a-f0-9]{64}$/.test(toolHash), 'toolHash E4B inválido');
      const geradas = ferramentasGeradas();
      assert.equal(geradas.length, 1, 'a prova E4b exige exatamente uma ferramenta sintética compilada');
      assert.equal(geradas[0].slug, slug, 'slug compilado diverge do esperado');
      assert.equal(geradas[0].tableName, tabela, 'tabela compilada diverge do esperado');
      assert.equal(FERRAMENTAS_TOOL_HASH, toolHash, 'toolHash compilado diverge do inventário validado');
      const ativacao = `ferramentas:${slug}`;
      const listCapability = geradas[0].listCapability;
      const createCapability = geradas[0].createCapability;
      for (const pessoa of pessoas) {
        await dono.org.update({ where: { id: pessoa.orgId }, data: { modulos: { push: ativacao } } });
      }

      // A proposta no manifesto não ativa catálogo: antes da sobrescrita o
      // gateway classifica como R5 e o efeito não chega à tabela.
      await pedir(`/ferramentas/${slug}/registros`, { token: tokens[0], status: 403 });
      assert.equal(await dono.$queryRaw(Prisma.sql`SELECT count(*)::int AS total FROM ${Prisma.raw(tabela)}`).then((r) => r[0].total), 0);

      const efeitoR0 = {
        escreveForaDoOS: false, produzArtefato: false, reversibilidade: 'automatica',
        exposicaoExterna: false, impactoFinanceiro: 'nenhum', sensibilidade: 'interna',
        destruicao: false, obrigacaoLegal: false,
      };
      const capacidadeListar = {
        id: listCapability, ferramenta: `${slug}_listar`, rota: `GET /ferramentas/${slug}/registros`,
        descricao: 'lista registros sintéticos da prova local E4b', nivel: 'R0',
        argsSchema: { type: 'object', additionalProperties: false, properties: {} }, efeito: efeitoR0,
      };
      const capacidadeCriar = {
        id: createCapability, ferramenta: `${slug}_criar`, rota: `POST /ferramentas/${slug}/registros`,
        descricao: 'cria artefato interno sintético da prova local E4b', nivel: 'R1',
        argsSchema: {
          type: 'object', additionalProperties: false, required: ['titulo', 'texto'],
          properties: { titulo: { type: 'string', minLength: 1 }, texto: { type: 'string', minLength: 1 } },
        },
        efeito: { ...efeitoR0, produzArtefato: true },
      };
      const delta = {
        versao: 'e4b-sintetica-1', atualizadoEm: '2026-09-21', origem: 'fixture sintética E4b',
        descricao: 'classificação local reproduzível da ferramenta sintética',
        estende: 'politica-marketing-os.json', capacidades: [capacidadeListar, capacidadeCriar],
      };
      const policyService = app.get(PolicyService);
      for (const pessoa of pessoas) {
        // Fora de requisição não há empresa no contexto, e sob TENANT_MODO=impor
        // o $transaction da sobrescrita recusa (RF-T-04) — como faria em produção.
        const resultado = await comEmpresaResolvida(pessoa.orgId, () => policyService.sobrescrever({
          orgId: pessoa.orgId,
          delta,
          autorId: 'fixture-autor-sintetico-e4b',
          motivo: 'fixture E4b local: classificar R0/R1 sem alegar assinatura humana real',
        }));
        assert.equal(resultado.criada, true, 'a política sintética deve abrir versão própria');
        const policy = await dono.policyVersion.findFirstOrThrow({ where: { orgId: pessoa.orgId, ativaAte: null } });
        assert.equal(policy.autorId, 'fixture-autor-sintetico-e4b');
        assert.match(policy.motivo, /fixture E4b local/);
      }

      await pedir(`/ferramentas/${slug}/registros`, {
        token: tokens[0], status: 201, body: { titulo: 'A', texto: 'registro exclusivo A' },
      });
      await pedir(`/ferramentas/${slug}/registros`, {
        token: tokens[1], status: 201, body: { titulo: 'B', texto: 'registro exclusivo B' },
      });
      const listaA = await pedir(`/ferramentas/${slug}/registros`, { token: tokens[0] });
      const listaB = await pedir(`/ferramentas/${slug}/registros`, { token: tokens[1] });
      assert(listaA.registros.every((row) => row.orgId === pessoas[0].orgId), 'leitura A atravessou RLS');
      assert(listaB.registros.every((row) => row.orgId === pessoas[1].orgId), 'leitura B atravessou RLS');
      assert(listaA.registros.some((row) => row.texto === 'registro exclusivo A'));
      assert(!listaA.registros.some((row) => row.texto === 'registro exclusivo B'));
      const criado = await pedir(`/ferramentas/${slug}/registros`, {
        token: tokens[0], status: 201, body: { titulo: 'criado A', texto: 'artefato interno A' },
      });
      assert.equal(criado.orgId, pessoas[0].orgId);

      // O papel SQL restrito, sem WHERE de tenant, ainda só enxerga A.
      const linhasRestritas = await papel.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.org_id', ${pessoas[0].orgId}, true)`;
        return tx.$queryRaw(Prisma.sql`SELECT "orgId", "texto" FROM ${Prisma.raw(tabela)} ORDER BY "id"`);
      });
      assert(linhasRestritas.length >= 2);
      assert(linhasRestritas.every((row) => row.orgId === pessoas[0].orgId), 'papel restrito atravessou RLS');

      const usuarioComPapeis = await dono.user.findUniqueOrThrow({
        where: { id: pessoas[0].id }, select: { roles: { select: { id: true, key: true } } },
      });
      const papeisOriginais = usuarioComPapeis.roles.map((role) => ({ id: role.id }));
      const permissaoVer = await dono.permission.findUniqueOrThrow({ where: { key: 'mcp.ver' } });
      for (const role of usuarioComPapeis.roles) {
        await dono.role.update({ where: { id: role.id }, data: { permissions: { disconnect: { id: permissaoVer.id } } } });
      }
      await pedir(`/ferramentas/${slug}/registros`, { token: tokens[0], status: 403 });
      for (const role of usuarioComPapeis.roles) {
        await dono.role.update({ where: { id: role.id }, data: { permissions: { connect: { id: permissaoVer.id } } } });
      }
      await dono.user.update({ where: { id: pessoas[0].id }, data: { roles: { set: [] } } });
      await pedir(`/ferramentas/${slug}/registros`, { token: tokens[0], status: 403 });
      await dono.user.update({ where: { id: pessoas[0].id }, data: { roles: { set: papeisOriginais } } });
      await dono.user.update({ where: { id: pessoas[0].id }, data: { isActive: false } });
      await pedir(`/ferramentas/${slug}/registros`, { token: tokens[0], status: 403 });
      await dono.user.update({ where: { id: pessoas[0].id }, data: { isActive: true } });

      const papelMaquina = await dono.role.findFirstOrThrow({ where: { orgId: pessoas[0].orgId, key: 'ia_acao' } });
      await dono.user.update({ where: { id: pessoas[0].id }, data: { roles: { set: [{ id: papelMaquina.id }] } } });
      await assert.rejects(
        app.get(EfeitosRegistry).executar(listCapability, {}, {
          orgId: pessoas[0].orgId, actorId: pessoas[0].id, actorType: ActorType.user,
        }),
        /máquina não opera como pessoa/,
      );
      await dono.user.update({ where: { id: pessoas[0].id }, data: { roles: { set: papeisOriginais } } });

      const agente = await dono.agent.create({
        data: {
          orgId: pessoas[0].orgId, slug: `e4b-${randomUUID()}`, nome: 'Agente sintético E4b',
          missao: 'Provar autoridade atual da ferramenta sintética', estado: 'ativo', ativo: true,
          capacidades: [listCapability, createCapability], contextoFixo: [],
        },
      });
      const gateway = app.get(ToolGateway);
      const ctxAi = {
        orgId: pessoas[0].orgId, actorType: ActorType.ai, actorId: agente.id,
        agentSlug: agente.slug, correlationId: `e4b-ai-${randomUUID()}`,
        capacidadesDeclaradas: [listCapability, createCapability],
      };
      const aiCriou = await gateway.executar(
        { capabilityId: createCapability, args: { titulo: 'AI real', texto: 'validada no banco' }, ctx: ctxAi },
        (args, ctx) => app.get(EfeitosRegistry).executar(createCapability, args, ctx),
      );
      assert.equal(aiCriou.status, 'executado', 'AI ativa e declarada deve executar R1');

      await dono.org.update({
        where: { id: pessoas[0].orgId },
        data: { modulos: { set: (await dono.org.findUniqueOrThrow({ where: { id: pessoas[0].orgId } })).modulos.filter((m) => m !== ativacao) } },
      });
      await pedir(`/ferramentas/${slug}/registros`, { token: tokens[0], status: 404 });
      await assert.rejects(
        app.get(EfeitosRegistry).executar(listCapability, {}, {
          orgId: pessoas[0].orgId, actorId: agente.id, actorType: ActorType.ai, agentSlug: agente.slug,
        }),
        /Ferramenta não encontrada/,
      );
      await pedir(`/ferramentas/slug-desconhecido-e4b/registros`, { token: tokens[1], status: 404 });
      console.log('E4B_TOOL_HTTP_RLS_OK: R5 antes de PolicyService, R0/R1, 2 orgs/RLS, autoridade humana/máquina/AI e efeito pós-desativação.');
    }
    if (process.env.E4B_TOOL_REQUIRED === '1') await rodarFerramentaE4b();
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

    // E3b.2a: a ponte Python usa uma fonte de importação sintética. A
    // consulta de memória permanece neste processo para provar a separação
    // entre identidade do dispositivo e PAT/grant do agente.
    const fontePython = await pedir('/conector/fontes', {
      token: tokens[0], status: 201,
      body: {
        nome: 'Smoke importação Python', tipo: 'pasta', raizLogica: 'cliente/python-fixture',
        incluir: ['**/*.md'], excluir: [], tiposPermitidos: ['.md'],
        modo: 'importacao', regraExclusao: 'ignorar', tamanhoMaximo: 2 * 1024 * 1024,
      },
    });
    const codigoPython = await pedir('/conector/pareamento/codigo', {
      token: tokens[0], status: 201,
      body: { nomeDispositivo: 'Python fixture', fonteIds: [fontePython.id] },
    });
    assert.equal(codigoPython.orgId, pessoas[0].orgId);
    assert.deepEqual(codigoPython.sourceIds, [fontePython.id]);
    const pythonRun = await rodarClientePython(new URL(base).origin, {
      orgId: pessoas[0].orgId, pairingId: codigoPython.id, code: codigoPython.codigo,
      sourceId: fontePython.id, humanToken: tokens[0],
    });
    assert.deepEqual(
      { marker: pythonRun.marker, sourceId: pythonRun.sourceId, status: pythonRun.status, revocations: pythonRun.revocations },
      { marker: 'PYTHON_CLIENT_SMOKE_OK', sourceId: fontePython.id, status: 'concluida', revocations: 'ok' },
    );
    assert.equal(pythonRun.sourceRef, `${fontePython.id}/docs/fixture.md`);
    const itemPython = await dono.contextItem.findFirst({ where: { orgId: pessoas[0].orgId, sourceType: 'conector', sourceRef: pythonRun.sourceRef } });
    assert(itemPython, 'a remessa Python precisa criar uma nota no tenant correto');
    const semGrantPython = await pedir(`/agent/memoria/buscar?q=${encodeURIComponent('frase exclusiva do cliente Python')}`, { token: credencial.token });
    assert.equal(semGrantPython.itens.length, 0, 'importação do conector não concede memória automaticamente');
    for (const field of ['sourceRef', 'title', 'body']) await pedir('/memoria/grants', {
      token: tokens[0], status: 201,
      body: {
        sourceType: 'conector', sourceRef: pythonRun.sourceRef, field, provider: 'agente_externo',
        consentVersion: 'smoke-python-v1',
        consentText: `Consentimento sintético explícito: conector/${pythonRun.sourceRef}/${field}.`,
      },
    });
    const comGrantPython = await pedir(`/agent/memoria/buscar?q=${encodeURIComponent('frase exclusiva do cliente Python')}`, { token: credencial.token });
    assert.equal(comGrantPython.itens.length, 1, 'grant exato deve liberar somente a nota importada');
    assert.equal(comGrantPython.itens[0].sourceRef, pythonRun.sourceRef);

    const buscaAgente = await pedir(`/agent/memoria/buscar?q=${encodeURIComponent('frase-exclusiva-A')}`, {
      token: credencial.token,
    });
    assert.equal(buscaAgente.diagnostico, 'ok');
    assert.equal(buscaAgente.modo, 'textual');
    assert.equal(buscaAgente.itens.length, 1);
    assert.equal(buscaAgente.itens[0].sourceRef, gravada.sourceRef);
    assert(!JSON.stringify(buscaAgente).includes('Bearer'));

    // E3a.1: o receptor só conhece destino lógico. O pareamento público usa o
    // orgId como seletor, mas o código/hash vinculado é a autoridade; nenhum
    // JWT de sessão pode atravessar a guarda exclusiva do dispositivo.
    const fonteConector = await pedir('/conector/fontes', {
      token: tokens[0], status: 201,
      body: {
        nome: 'Smoke pasta lógica', tipo: 'pasta', raizLogica: 'cliente/documentos',
        incluir: ['**/*.md'], excluir: ['privado/**'], tiposPermitidos: ['.md'],
        modo: 'sincronizacao', regraExclusao: 'arquivar', tamanhoMaximo: 2 * 1024 * 1024,
      },
    });
    const codigoConector = await pedir('/conector/pareamento/codigo', {
      token: tokens[0], status: 201,
      body: { nomeDispositivo: 'Smoke laptop', fonteIds: [fonteConector.id] },
    });
    const snapshotRun = await rodarClientePython(new URL(base).origin, {
      orgId: pessoas[0].orgId, pairingId: codigoConector.id, code: codigoConector.codigo,
      sourceId: fonteConector.id, humanToken: tokens[0], snapshot: true,
    });
    assert.equal(snapshotRun.marker, 'PYTHON_SNAPSHOT_SMOKE_OK');
    const snapshotItem = await dono.contextItem.findFirst({ where: { orgId: pessoas[0].orgId, sourceType: 'conector', sourceRef: `${fonteConector.id}/docs/fixture.md` }, include: { versoes: true } });
    assert(snapshotItem, 'snapshot precisa criar a nota');
    assert.equal(snapshotItem.versoes.filter((version) => version.mudanca !== 'arquivamento').length, 3, 'snapshot A/B/A precisa preservar exatamente 3 versões de conteúdo');
    assert.equal(snapshotItem.versoes.length, 4, 'a ausência acrescenta apenas a versão de arquivamento');
    assert(snapshotItem.arquivadoEm, 'snapshot vazio arquivar precisa arquivar a ausência');
    const snapshotDeliveries = await dono.connectorDelivery.findMany({
      where: { orgId: pessoas[0].orgId, sourceId: fonteConector.id },
      select: { status: true }, orderBy: { ordem: 'asc' },
    });
    assert.equal(snapshotDeliveries.length, 4, 'snapshot arquivar deve criar exatamente quatro remessas (A/B/A/vazio)');
    assert(snapshotDeliveries.every((delivery) => delivery.status === 'concluida'), 'todas as remessas do snapshot devem concluir');
    const fonteSnapshotIgnorar = await pedir('/conector/fontes', {
      token: tokens[0], status: 201,
      body: {
        nome: 'Smoke snapshot ignorar', tipo: 'pasta', raizLogica: 'cliente/python-fixture-ignore',
        incluir: ['**/*.md'], excluir: [], tiposPermitidos: ['.md'], modo: 'sincronizacao',
        regraExclusao: 'ignorar', tamanhoMaximo: 2 * 1024 * 1024,
      },
    });
    const codigoSnapshotIgnorar = await pedir('/conector/pareamento/codigo', {
      token: tokens[0], status: 201,
      body: { nomeDispositivo: 'Python snapshot ignorar', fonteIds: [fonteSnapshotIgnorar.id] },
    });
    const ignoreRun = await rodarClientePython(new URL(base).origin, {
      orgId: pessoas[0].orgId, pairingId: codigoSnapshotIgnorar.id, code: codigoSnapshotIgnorar.codigo,
      sourceId: fonteSnapshotIgnorar.id, humanToken: tokens[0], snapshot: true,
    });
    assert.equal(ignoreRun.marker, 'PYTHON_SNAPSHOT_SMOKE_OK');
    const ignoredItem = await dono.contextItem.findFirst({ where: { orgId: pessoas[0].orgId, sourceType: 'conector', sourceRef: `${fonteSnapshotIgnorar.id}/docs/fixture.md` }, include: { versoes: true } });
    assert(ignoredItem && !ignoredItem.arquivadoEm, 'snapshot vazio ignorar não pode arquivar ausência');
    assert.equal(ignoredItem.versoes.filter((version) => version.mudanca !== 'arquivamento').length, 3, 'snapshot ignorar deve preservar exatamente três versões de conteúdo');
    assert.equal(ignoredItem.versoes.length, 3, 'snapshot ignorar não deve criar versão de arquivamento');
    const ignoredDeliveries = await dono.connectorDelivery.findMany({
      where: { orgId: pessoas[0].orgId, sourceId: fonteSnapshotIgnorar.id },
      select: { status: true }, orderBy: { ordem: 'asc' },
    });
    assert.equal(ignoredDeliveries.length, 4, 'snapshot ignorar deve criar exatamente quatro remessas (A/B/A/vazio)');
    assert(ignoredDeliveries.every((delivery) => delivery.status === 'concluida'), 'todas as remessas ignorar devem concluir');
    const codigoConectorDireto = await pedir('/conector/pareamento/codigo', {
      token: tokens[0], status: 201,
      body: { nomeDispositivo: 'Smoke laptop', fonteIds: [fonteConector.id] },
    });
    assert(codigoConectorDireto.codigo && codigoConectorDireto.id);
    const dispositivo = await pedir('/conector/pareamento', {
      status: 201,
      body: { orgId: pessoas[0].orgId, pairingId: codigoConectorDireto.id, code: codigoConectorDireto.codigo, nomeDispositivo: 'Smoke laptop' },
    });
    assert(dispositivo.token && dispositivo.id);
    const pulso = await pedir('/conector/pulso', {
      token: dispositivo.token, status: 200,
      body: { versao: 'smoke-1', so: 'fixture', usuarioLocal: 'fixture', relogio: new Date().toISOString() },
    });
    assert.equal(pulso.revogado, false);
    assert.deepEqual(pulso.fontes.map((fonte) => fonte.id), [fonteConector.id]);
    assert(!JSON.stringify(pulso).includes(dispositivo.token));
    await pedir('/conector/pulso', {
      token: tokens[0], status: 401,
      body: { versao: 'smoke-1', so: 'fixture', usuarioLocal: 'fixture', relogio: new Date().toISOString() },
    });
    await pedir('/conector/pulso', {
      token: credencial.token, status: 401,
      body: { versao: 'smoke-1', so: 'fixture', usuarioLocal: 'fixture', relogio: new Date().toISOString() },
    });
    await pedir('/agent/memoria/buscar?q=frase-exclusiva-A', { token: dispositivo.token, status: 401 });
    await pedir('/auth/agent-tokens', { token: dispositivo.token, status: 401 });

    // E3a.2: a remessa atravessa a mesma ponte de dispositivo, mas não concede
    // memória por si só. O PAT recebe zero itens até haver grant explícito da
    // fonte/campo, e só então consegue consultar o texto remetido.
    const remessa = await pedir('/conector/remessa', {
      token: dispositivo.token, status: 201,
      body: { fonteId: fonteConector.id, modo: 'sincronizacao', chaveRequisicao: `smoke-${randomUUID()}` },
    });
    const textoRemessa = 'conteúdo sintético exclusivo da remessa ' + 'x'.repeat(120_000);
    const crypto = require('node:crypto');
    const hashRemessa = crypto.createHash('sha256').update(textoRemessa).digest('hex');
    await pedir(`/conector/remessa/${remessa.remessaId}/lote`, {
      token: dispositivo.token, status: 200,
      body: { itens: [{ caminhoRelativo: 'docs/smoke.md', texto: textoRemessa, hashConteudo: hashRemessa, tamanho: Buffer.byteLength(textoRemessa), mime: 'text/markdown' }] },
    });
    await pedir(`/conector/remessa/${remessa.remessaId}/fim`, {
      token: dispositivo.token, status: 200,
      body: { itensVistos: [{ caminhoRelativo: 'docs/smoke.md' }], itensEnviados: 1, erros: [], manifestoCompleto: true },
    });
    const refRemessa = `${fonteConector.id}/docs/smoke.md`;
    const patRemessa = await pedir('/auth/agent-tokens', {
      token: tokens[0], status: 201,
      body: { name: 'smoke-remessa-sem-grant', scopes: ['memoria.buscar'], validadeDias: 1 },
    });
    const semGrant = await pedir(`/agent/memoria/buscar?q=${encodeURIComponent('exclusivo da remessa')}`, { token: patRemessa.token });
    assert.equal(semGrant.itens.length, 0, 'remessa não concede memória sem grant separado');
    for (const field of ['sourceRef', 'title', 'body']) await pedir('/memoria/grants', {
      token: tokens[0], status: 201,
      body: { sourceType: 'conector', sourceRef: refRemessa, field, provider: 'agente_externo', consentVersion: 'smoke-v1', consentText: `Consentimento sintético explícito: conector/${refRemessa}/${field}.` },
    });
    const comGrant = await pedir(`/agent/memoria/buscar?q=${encodeURIComponent('exclusivo da remessa')}`, { token: patRemessa.token });
    assert.equal(comGrant.diagnostico, 'ok');
    assert.equal(comGrant.itens.length, 1);
    assert.equal(comGrant.itens[0].sourceRef, refRemessa);
    await pedir(`/conector/fontes/${fonteConector.id}/revogar`, { token: tokens[0], method: 'POST', status: 201 });
    const pulsoSemFonte = await pedir('/conector/pulso', {
      token: dispositivo.token, status: 200,
      body: { versao: 'smoke-1', so: 'fixture', usuarioLocal: 'fixture', relogio: new Date().toISOString() },
    });
    assert.equal(pulsoSemFonte.revogado, true);
    assert.deepEqual(pulsoSemFonte.fontes, []);
    await pedir(`/conector/dispositivos/${dispositivo.id}/revogar`, { token: tokens[0], method: 'POST', status: 201 });
    await pedir('/conector/pulso', {
      token: dispositivo.token, status: 401,
      body: { versao: 'smoke-1', so: 'fixture', usuarioLocal: 'fixture', relogio: new Date().toISOString() },
    });
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
    console.log('SMOKE_RESTRITO_OK: boot, saúde, cadastro/login, grants, PAT, conector pareamento/pulso/remessa/revogação, isolamento HTTP entre tenants e recusa de provisionamento.');
  }
  async function limpar() {
    if (app) await app.close();
    const pessoas = await dono.user.findMany({ where: { email: { in: emails } }, select: { orgId: true } });
    for (const { orgId } of pessoas) {
      // O que a prova E4b deixa: registros da ferramenta sintética, a decisão e
      // a chamada da porta, e a versão de política aberta pela sobrescrita.
      if (process.env.E4B_TOOL_REQUIRED === '1' && /^tool_[a-z0-9_]+_registro$/.test(process.env.E4B_TOOL_TABLE ?? '')) {
        await dono.$executeRawUnsafe(`DELETE FROM "${process.env.E4B_TOOL_TABLE}" WHERE "orgId" = $1`, orgId);
      }
      await dono.policyDecision.deleteMany({ where: { orgId } });
      await dono.toolCall.deleteMany({ where: { orgId } });
      await dono.approval.deleteMany({ where: { orgId } });
      await dono.policyVersion.deleteMany({ where: { orgId } });
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
