// Layout 26/10: as 2 tarefas da lista "Comercial" (criada pelo Lucas na pasta Comercial) passam para
// "Tarefas do comercial", ligadas ao lead que ele escolheu; a lista "Comercial" é arquivada (decisão dele).
// O Trabalho recusa mover tarefa de outra lista para a do comercial, por isso a mudança vai direto no
// banco, numa transação, com auditoria de cada passo (origem script).
// Rode DENTRO do mktos_api: node /tmp/x.js            (ensaio: só mostra)
//                           node /tmp/x.js --valer    (grava; guarda o antes em /tmp/comercial-tarefas-para-lead-antes.json)
//                           node /tmp/x.js --desfazer (volta do arquivo do antes)
'use strict';
const D = '/app/apps/api/dist/';
require(D + 'scripts/sem-tarefas-de-fundo');
const fs = require('node:fs');
const req = (m) => require(require.resolve(m, { paths: [D] }));
const { NestFactory } = req('@nestjs/core');
const { AppModule } = require(D + 'app.module');
const { PrismaService } = require(D + 'prisma/prisma.service');
const { AuditService } = require(D + 'audit/audit.service');
const ORG = '63cdd80e-0435-488d-98b5-c2653d235e50';
const LUCAS = 'fbb3983f-bd69-43d8-b284-5316cf25534a';
const LISTA_VELHA = '4ef39e65-0862-49ff-8788-ed0d0af4c8f5';
const LISTA_DO_COMERCIAL = 'f12cccdf-fca0-4d97-84ba-6dc9f5838dc7';
const LEAD_DE = { // título -> lead (respostas do Lucas em 26/10)
  'Proposta É o que tem pra hj': '3c581849-4715-5d5f-b63c-0dc4568dbf52', // Sr. João · É oq tem pra hj
  'Proposta Pet Cricao': '34d7fd6b-616a-5674-bdcd-f03b0aa343df', // Raul · Pet Cricao
};
const ANTES = '/tmp/comercial-tarefas-para-lead-antes.json';
const VALER = process.argv.includes('--valer');
const DESFAZER = process.argv.includes('--desfazer');
const META = { origem: DESFAZER ? 'script.comercial-tarefas-para-lead.desfazer' : 'script.comercial-tarefas-para-lead' };
(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const p = app.get(PrismaService); const audit = app.get(AuditService);
  if (DESFAZER) {
    const a = JSON.parse(fs.readFileSync(ANTES, 'utf8'));
    await p.$transaction(async (tx) => {
      for (const t of a.tarefas) {
        await tx.workTask.update({ where: { id: t.id }, data: { listId: t.listId, statusId: t.statusId, leadId: t.leadId, areaId: t.areaId } });
        await audit.log({ orgId: ORG, actorId: LUCAS, action: 'work.task.update', entityType: 'work_task', entityId: t.id, after: { listId: t.listId, statusId: t.statusId, leadId: t.leadId, areaId: t.areaId }, metadata: META }, tx);
      }
      await tx.workList.update({ where: { id: LISTA_VELHA }, data: { arquivadaEm: a.lista.arquivadaEm } });
      await audit.log({ orgId: ORG, actorId: LUCAS, action: 'work.list.unarchive', entityType: 'work_list', entityId: LISTA_VELHA, after: { arquivadaEm: a.lista.arquivadaEm }, metadata: META }, tx);
    });
    console.log('desfeito'); await app.close(); process.exit(0);
  }
  const destino = await p.workList.findFirst({ where: { id: LISTA_DO_COMERCIAL, orgId: ORG }, select: { name: true, areaPadraoId: true, statuses: { select: { id: true, name: true, type: true } } } });
  const lista = await p.workList.findFirst({ where: { id: LISTA_VELHA, orgId: ORG }, select: { name: true, arquivadaEm: true } });
  const tarefas = await p.workTask.findMany({ where: { orgId: ORG, listId: LISTA_VELHA, excluidaEm: null },
    select: { id: true, title: true, listId: true, statusId: true, leadId: true, areaId: true, status: { select: { name: true, type: true } } } });
  const campos = await p.workFieldValue.count({ where: { orgId: ORG, taskId: { in: tarefas.map((t) => t.id) } } });
  const naLixeira = await p.workTask.count({ where: { orgId: ORG, listId: LISTA_VELHA, excluidaEm: { not: null } } });
  console.log(`destino: ${destino.name} · lista velha: ${lista.name} (arquivada: ${!!lista.arquivadaEm}) · vivas: ${tarefas.length} · na lixeira: ${naLixeira} · valores de campo: ${campos}`);
  const plano = [];
  for (const t of tarefas) {
    const leadId = LEAD_DE[t.title];
    if (!leadId) { console.log('SEM LEAD ESCOLHIDO, fica:', t.title); continue; }
    const st = destino.statuses.find((s) => s.name === t.status.name) ?? destino.statuses.find((s) => s.type === t.status.type);
    if (!st) { console.log('SEM ETAPA equivalente, fica:', t.title); continue; }
    plano.push({ t, leadId, statusId: st.id, areaId: destino.areaPadraoId ?? t.areaId });
    console.log(`${VALER ? 'move' : 'moveria'} "${t.title}" -> ${destino.name} · etapa ${st.name} · lead ${leadId}`);
  }
  const vaiSobrar = tarefas.length - plano.length;
  console.log(vaiSobrar === 0 ? `${VALER ? 'arquiva' : 'arquivaria'} a lista "${lista.name}"` : `a lista "${lista.name}" fica (sobram ${vaiSobrar})`);
  if (VALER && plano.length) {
    fs.writeFileSync(ANTES, JSON.stringify({ tarefas: plano.map(({ t }) => ({ id: t.id, listId: t.listId, statusId: t.statusId, leadId: t.leadId, areaId: t.areaId })), lista: { arquivadaEm: lista.arquivadaEm } }, null, 2));
    await p.$transaction(async (tx) => {
      for (const { t, leadId, statusId, areaId } of plano) {
        await tx.workTask.update({ where: { id: t.id }, data: { listId: LISTA_DO_COMERCIAL, statusId, leadId, areaId } });
        await audit.log({ orgId: ORG, actorId: LUCAS, action: 'work.task.update', entityType: 'work_task', entityId: t.id,
          before: { listId: t.listId, statusId: t.statusId, leadId: t.leadId, areaId: t.areaId }, after: { listId: LISTA_DO_COMERCIAL, statusId, leadId, areaId }, metadata: META }, tx);
      }
      if (vaiSobrar === 0 && !lista.arquivadaEm) {
        const agora = new Date();
        await tx.workList.update({ where: { id: LISTA_VELHA }, data: { arquivadaEm: agora } });
        await audit.log({ orgId: ORG, actorId: LUCAS, action: 'work.list.archive', entityType: 'work_list', entityId: LISTA_VELHA, before: { arquivadaEm: null }, after: { arquivadaEm: agora.toISOString() }, metadata: META }, tx);
      }
    });
    console.log('gravado; antes em', ANTES);
  }
  await app.close(); process.exit(0);
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
