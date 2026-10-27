// A LISTA "TAREFAS DO COMERCIAL" NA PASTA "COMERCIAL" DO TRABALHO (aprovado pelo Lucas em 26/10/2026).
// A lista do comercial (chave `comercial:tarefas`, a do Funil vivo e do painel do lead) vai para a pasta de
// topo "Comercial" que o Lucas criou hoje; a lista VAZIA "Comercial" de dentro dessa pasta sai (só se não
// tiver nenhuma tarefa, nem arquivada nem na Lixeira). As tarefas não mudam (mesmos ids, mesmo lead).
// A troca de pasta é direta no banco (as guardas do WorkService recusam mexer na lista do comercial pela
// árvore) e fica na auditoria (`work.list.update`, origem script). A lista vazia sai pelo WorkService
// (`apagarLista`: apagada se vazia de verdade, arquivada se guardar campo com valor).
// O "antes" fica em /tmp/comercial-na-arvore-antes.json; `--desfazer` volta a partir dele.
// Rode DENTRO do mktos_api:
//   node /tmp/comercial-na-arvore.js             -> ensaio (só lê e diz o que faria)
//   node /tmp/comercial-na-arvore.js --valer     -> grava
//   node /tmp/comercial-na-arvore.js --desfazer  -> volta (a lista do comercial sem pasta; a lista "Comercial" vazia renasce)
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
const { AuditService } = require(D + 'audit/audit.service');
const { WorkService } = require(D + 'work/work.service');

const VALER = process.argv.includes('--valer');
const DESFAZER = process.argv.includes('--desfazer');
const ORG = '63cdd80e-0435-488d-98b5-c2653d235e50';
const LUCAS = 'fbb3983f-bd69-43d8-b284-5316cf25534a';
const ANTES = '/tmp/comercial-na-arvore-antes.json';
const CHAVE = 'comercial:tarefas';
const PASTA = 'Comercial';

const mesmoNome = (a, b) => a.trim().toLocaleLowerCase('pt-BR') === b.trim().toLocaleLowerCase('pt-BR');

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const audit = app.get(AuditService);
  const work = app.get(WorkService);
  const ctx = (fn) => comContexto({ orgId: ORG, actorId: LUCAS, actorType: 'user', correlationId: randomUUID(), origem: 'script' }, fn);

  const lista = await prisma.workList.findFirst({
    where: { orgId: ORG, externalId: CHAVE },
    select: { id: true, name: true, folderId: true, spaceId: true, order: true, arquivadaEm: true, folder: { select: { name: true } } },
  });
  if (!lista) { console.log('a lista do comercial não existe nesta empresa: nada a fazer'); return app.close(); }
  console.log('lista do comercial:', JSON.stringify({ id: lista.id, nome: lista.name, pasta: lista.folder?.name ?? '(sem pasta)', arquivada: !!lista.arquivadaEm }));

  if (DESFAZER) {
    const a = JSON.parse(fs.readFileSync(ANTES, 'utf8'));
    await ctx(async () => {
      await prisma.workList.update({ where: { id: a.lista.id }, data: { folderId: a.lista.folderId, spaceId: a.lista.spaceId, order: a.lista.order } });
      await audit.log({
        orgId: ORG, actorId: LUCAS, action: 'work.list.update', entityType: 'work_list', entityId: a.lista.id,
        before: { folderId: a.pasta.id }, after: { folderId: a.lista.folderId, spaceId: a.lista.spaceId },
        metadata: { origem: 'script.comercial-na-arvore.desfazer' },
      });
      // A lista "Comercial" vazia que saiu volta vazia, com as mesmas etapas (era só o recipiente).
      if (a.vazia && a.vazia.modo === 'apagada') {
        const ja = await prisma.workList.findFirst({ where: { orgId: ORG, folderId: a.pasta.id, name: a.vazia.name, arquivadaEm: null }, select: { id: true } });
        if (!ja) {
          const nova = await prisma.workList.create({
            data: {
              orgId: ORG, folderId: a.pasta.id, name: a.vazia.name, order: a.vazia.order, natureza: a.vazia.natureza,
              statuses: { create: a.vazia.statuses.map((s) => ({ name: s.name, type: s.type, color: s.color, order: s.order })) },
            },
            select: { id: true },
          });
          await audit.log({ orgId: ORG, actorId: LUCAS, action: 'work.list.create', entityType: 'work_list', entityId: nova.id, after: { name: a.vazia.name, folderId: a.pasta.id }, metadata: { origem: 'script.comercial-na-arvore.desfazer' } });
        }
      } else if (a.vazia && a.vazia.modo === 'arquivada') {
        await prisma.workList.updateMany({ where: { id: a.vazia.id, orgId: ORG }, data: { arquivadaEm: null } });
        await audit.log({ orgId: ORG, actorId: LUCAS, action: 'work.list.unarchive', entityType: 'work_list', entityId: a.vazia.id, after: { arquivadaEm: null }, metadata: { origem: 'script.comercial-na-arvore.desfazer' } });
      }
    });
    console.log('desfeito');
    return app.close();
  }

  // A pasta de topo "Comercial" do Trabalho (viva, fora da marca do Comercial, que é a da pasta Clientes).
  const pastas = (await prisma.workFolder.findMany({
    where: { orgId: ORG, parentId: null, arquivadaEm: null, doComercial: false },
    select: { id: true, name: true },
  })).filter((p) => mesmoNome(p.name, PASTA));
  if (pastas.length !== 1) {
    console.log(`pastas de topo chamadas "${PASTA}": ${pastas.length}. Precisa ser exatamente uma; nada foi feito.`);
    return app.close();
  }
  const pasta = pastas[0];
  const dentro = await prisma.workList.findMany({
    where: { orgId: ORG, folderId: pasta.id, arquivadaEm: null },
    select: { id: true, name: true, externalId: true, order: true, natureza: true, statuses: { select: { name: true, type: true, color: true, order: true } } },
  });
  console.log(`pasta "${pasta.name}" (${pasta.id}) tem:`, dentro.map((l) => l.name).join(' | ') || '(nada)');

  // A lista "Comercial" de dentro: sai só vazia (nenhuma tarefa, nem arquivada, nem na Lixeira).
  const vazias = [];
  for (const l of dentro.filter((x) => x.externalId !== CHAVE && mesmoNome(x.name, PASTA))) {
    const tarefas = await prisma.workTask.count({ where: { orgId: ORG, listId: l.id } });
    if (tarefas === 0) vazias.push(l);
    else console.log(`a lista "${l.name}" (${l.id}) tem ${tarefas} tarefa(s): ela FICA (nada será apagado).`);
  }
  const jaNaPasta = lista.folderId === pasta.id;
  console.log('plano:', [
    jaNaPasta ? 'a lista do comercial já está na pasta' : `mover "${lista.name}" de ${lista.folder?.name ?? '(sem pasta)'} para a pasta "${pasta.name}"`,
    ...vazias.map((l) => `tirar a lista vazia "${l.name}" (${l.id})`),
  ].join('; '));
  if (lista.arquivadaEm) console.log('atenção: a lista do comercial está arquivada; o Comercial a desarquiva na próxima tarefa criada.');
  if (!VALER) return app.close();

  const antes = {
    pasta,
    lista: { id: lista.id, folderId: lista.folderId, spaceId: lista.spaceId, order: lista.order },
    vazia: null,
  };
  fs.writeFileSync(ANTES, JSON.stringify(antes, null, 2));
  await ctx(async () => {
    for (const l of vazias) {
      const r = await work.apagarLista(ORG, LUCAS, l.id, { confirmarNome: l.name });
      antes.vazia = { id: l.id, name: l.name, order: l.order, natureza: l.natureza, statuses: l.statuses, modo: r.modo };
      fs.writeFileSync(ANTES, JSON.stringify(antes, null, 2));
      console.log(`lista "${l.name}" ${r.modo}`);
    }
    if (!jaNaPasta) {
      const fim = await prisma.workList.aggregate({ where: { orgId: ORG, folderId: pasta.id }, _max: { order: true } });
      const order = fim._max.order === null ? 0 : fim._max.order + 1;
      // Na pasta, a lista herda o espaço dela: `spaceId` vai nulo, como `editarLista` grava.
      await prisma.workList.update({ where: { id: lista.id }, data: { folderId: pasta.id, spaceId: null, order } });
      await audit.log({
        orgId: ORG, actorId: LUCAS, action: 'work.list.update', entityType: 'work_list', entityId: lista.id,
        before: { folderId: lista.folderId, spaceId: lista.spaceId }, after: { folderId: pasta.id, spaceId: null },
        metadata: { origem: 'script.comercial-na-arvore' },
      });
      console.log(`lista "${lista.name}" -> pasta "${pasta.name}"`);
    }
  });
  await app.close();
}

main().then(() => process.exit(0)).catch((err) => { console.error('ERRO', err?.response ?? err); process.exit(1); });
