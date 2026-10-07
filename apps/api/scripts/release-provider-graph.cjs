// QA: resolve providers sem init, conexão ao banco ou chamada ao modelo.
require('reflect-metadata');
const assert = require('node:assert/strict');
const { Test } = require('@nestjs/testing');
const { AppModule } = require('../dist/app.module.js');
const { PrismaService } = require('../dist/prisma/prisma.service.js');
const { ContextBuilder } = require('../dist/agents/context-builder.service.js');
const { VaultVersionadaService } = require('../dist/agents/vault-versionada.service.js');
const { ReportsService } = require('../dist/reports/reports.service.js');
(async () => {
  const module = await Test.createTestingModule({imports:[AppModule]})
    .overrideProvider(PrismaService).useValue({}).compile();
  assert.ok(module.get(ContextBuilder));
  assert.ok(module.get(VaultVersionadaService));
  assert.ok(module.get(ReportsService));
  console.log(JSON.stringify({resolved:3, hooksRun:false, database:'stub', paidApi:false}));
  // close dispararia hooks de destruição de providers que não inicializamos.
})().catch(e => {console.error(e); process.exitCode=1});
