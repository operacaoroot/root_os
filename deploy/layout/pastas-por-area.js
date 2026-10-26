// PASTAS DO TRABALHO = ÁREAS DA EMPRESA (aprovado pelo Lucas em 26/10/2026, catálogo P-50/P-61).
// Marketing fica como está (já tem as listas do ClickUp). "Gestão" vira "Administrativo" (a lista
// Administrativo já mora nela); nascem as pastas Financeiro, Pessoas e Operação e cada lista vai para a sua.
// Nada é apagado. O "antes" fica em /tmp/pastas-por-area-antes.json; `--desfazer` volta a partir dele.
// Rode DENTRO do mktos_api:
//   node /tmp/pastas-por-area.js             -> ensaio (só lê)
//   node /tmp/pastas-por-area.js --valer     -> grava
//   node /tmp/pastas-por-area.js --desfazer  -> volta (listas às pastas de antes, nome da Gestão; pastas novas vazias são apagadas)
'use strict';
const D = '/app/apps/api/dist/';
require(D + 'scripts/sem-tarefas-de-fundo');
const fs = require('node:fs');
const req = (m) => require(require.resolve(m, { paths: [D] }));
const { NestFactory } = req('@nestjs/core');
const { randomUUID } = require('node:crypto');
const { AppModule } = require(D + 'app.module');
const { comContexto } = require(D + 'common/contexto-execucao');
const { PrismaService } = require(D + 'prisma/prisma.service');
const { WorkService } = require(D + 'work/work.service');

const VALER = process.argv.includes('--valer');
const DESFAZER = process.argv.includes('--desfazer');
const ORG = '63cdd80e-0435-488d-98b5-c2653d235e50';
const LUCAS = 'fbb3983f-bd69-43d8-b284-5316cf25534a';
const ANTES = '/tmp/pastas-por-area-antes.json';
const DESTINO = { Financeiro: 'Financeiro', Pessoas: 'Pessoas', 'Operação': 'Operação' };

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const work = app.get(WorkService);
  const ctx = (fn) => comContexto({ orgId: ORG, actorId: LUCAS, actorType: 'user', correlationId: randomUUID(), origem: 'script' }, fn);
  const pastas = await prisma.workFolder.findMany({ where: { orgId: ORG, arquivadaEm: null, parentId: null }, select: { id: true, name: true } });
  const listas = await prisma.workList.findMany({ where: { orgId: ORG, arquivadaEm: null, name: { in: ['Administrativo', 'Financeiro', 'Pessoas', 'Operação'] } }, select: { id: true, name: true, folderId: true, folder: { select: { name: true } } } });
  console.log('pastas de cima:', pastas.map((p) => p.name).join(' | '));
  console.log('listas:', JSON.stringify(listas.map((l) => ({ lista: l.name, pasta: l.folder?.name ?? '(sem pasta)' }))));

  if (DESFAZER) {
    const a = JSON.parse(fs.readFileSync(ANTES, 'utf8'));
    await ctx(async () => {
      for (const l of a.listas) await work.editarLista(ORG, LUCAS, l.id, { folderId: l.folderId });
      if (a.gestao) await work.editarPasta(ORG, LUCAS, a.gestao.id, { name: a.gestao.name });
      for (const id of a.criadas) await work.apagarPasta(ORG, LUCAS, id).catch((e) => console.log('pasta', id, 'ficou:', e.message));
    });
    console.log('desfeito');
    return app.close();
  }

  const gestao = pastas.find((p) => p.name === 'Gestão');
  const plano = listas.filter((l) => DESTINO[l.name] && l.folder?.name !== DESTINO[l.name]);
  console.log('plano:', gestao ? 'renomear "Gestão" -> "Administrativo";' : 'sem pasta Gestão;', plano.map((l) => `${l.name} -> pasta ${DESTINO[l.name]}`).join('; '));
  if (!VALER) return app.close();

  fs.writeFileSync(ANTES, JSON.stringify({ gestao, listas: listas.map((l) => ({ id: l.id, folderId: l.folderId })), criadas: [] }, null, 2));
  const criadas = [];
  await ctx(async () => {
    if (gestao && !pastas.some((p) => p.name === 'Administrativo')) await work.editarPasta(ORG, LUCAS, gestao.id, { name: 'Administrativo' });
    for (const l of plano) {
      let p = (await prisma.workFolder.findFirst({ where: { orgId: ORG, arquivadaEm: null, parentId: null, name: DESTINO[l.name] }, select: { id: true } }));
      if (!p) { p = await work.criarPasta(ORG, LUCAS, { name: DESTINO[l.name] }); criadas.push(p.id); console.log('pasta criada', DESTINO[l.name]); }
      await work.editarLista(ORG, LUCAS, l.id, { folderId: p.id });
      console.log('lista', l.name, '-> pasta', DESTINO[l.name]);
    }
  });
  const a = JSON.parse(fs.readFileSync(ANTES, 'utf8')); a.criadas = criadas; fs.writeFileSync(ANTES, JSON.stringify(a, null, 2));
  await app.close();
}

main().then(() => process.exit(0)).catch((err) => { console.error('ERRO', err?.response ?? err); process.exit(1); });
