// A IMPLANTAÇÃO VAI PARA A LISTA "ONBOARDING DE CLIENTE" (leva 5, L3, decisão do Rodrigo em 26/10/2026).
// A subseção Implantação saiu do menu e do Dia a dia "por enquanto"; os clientes ficam na lista
// "Onboarding de cliente" (pasta Clientes). Para cada OnboardingTrilho ATIVO (fase != encerrado) SEM card
// na lista (cardId nulo, card inexistente ou na Lixeira), este script abre o card:
//   · trilho com lead (a ficha do comercial aponta o trilho): o card tem o MESMO id que o fechamento usa
//     (`cardIdDoLead`), para o fechamento futuro achar e reaproveitar o card em vez de abrir outro;
//   · trilho sem lead: id derivado do trilho (`uuidDe`), para rodar de novo achar o mesmo card.
// O card nasce com o nome do cliente, a etapa pela FASE do trilho (mapa `FASES_DA_ETAPA` do shared, a
// primeira etapa da lista que aceita a fase), a descrição com o link `/onboarding/<id>` e a origem
// `implantacao-20261027` (na descrição e em `metadata.origem` da auditoria `work.task.create`), e o
// trilho ganha `cardId`. Um card com esse id que já esteja arquivado ou na Lixeira VOLTA (como o
// fechamento faz), em vez de nascer outro. Nenhum trilho, convite ou marco muda.
// `abrirCardDaImplantacao` não é chamado de propósito: as três procedências dele (fechamento, antecipado,
// importação do CRM) escreveriam no card uma história que não é a destes clientes.
// O "antes" fica em /tmp/implantacao-para-lista-antes.json; `--desfazer` volta a partir dele: os cards
// CRIADOS por este script vão para a Lixeira (recuperável; "dado nenhum é apagado"), os RESTAURADOS voltam
// ao estado de antes, e o `cardId` do trilho volta ao que era (nulo, ou o card antigo).
// Rode DENTRO do mktos_api:
//   node /tmp/implantacao-para-lista.js             -> ensaio (conta os trilhos e diz o que faria)
//   node /tmp/implantacao-para-lista.js --valer     -> grava
//   node /tmp/implantacao-para-lista.js --desfazer  -> volta
'use strict';
const D = '/app/apps/api/dist/';
require(D + 'scripts/sem-tarefas-de-fundo');
const fs = require('node:fs');
const req = (m) => require(require.resolve(m, { paths: [D] }));
const { NestFactory } = req('@nestjs/core');
const { randomUUID } = require('node:crypto');
const { FASES_DA_ETAPA, chaveDaEtapa, LISTA_DA_IMPLANTACAO, PASTA_DA_IMPLANTACAO } = req('@mktos/shared');
const { AppModule } = require(D + 'app.module');
const { comContexto } = require(D + 'common/contexto-execucao');
const { PrismaService } = require(D + 'prisma/prisma.service');
const { AuditService } = require(D + 'audit/audit.service');
const { cardIdDoLead } = require(D + 'comercial/card-da-implantacao');
const { uuidDe } = require(D + 'comercial/eventos');

const VALER = process.argv.includes('--valer');
const DESFAZER = process.argv.includes('--desfazer');
const ORG = '63cdd80e-0435-488d-98b5-c2653d235e50';
// Quem assina: o Rodrigo (a decisão é dele).
const ATOR = process.env.ATOR_ID || 'fbb3983f-bd69-43d8-b284-5316cf25534a';
const ANTES = '/tmp/implantacao-para-lista-antes.json';
const ORIGEM = 'implantacao-20261027';

const chave = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
const curto = (id) => String(id ?? '').slice(0, 8);
const dataCurta = (d) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

/** A etapa da lista para a fase do trilho: a primeira, na ordem da lista, cujo mapa aceita a fase; sem ela, a primeira aberta. */
function etapaDaFase(etapas, fase) {
  for (const e of etapas) {
    const aceitas = FASES_DA_ETAPA[chaveDaEtapa(e.name)];
    if (Array.isArray(aceitas) && aceitas.includes(fase)) return { etapa: e, peloMapa: true };
  }
  return { etapa: etapas.find((e) => e.type === 'open') ?? etapas[0], peloMapa: false };
}

function descricaoDoCard(t, agora) {
  const contato = [t.contatoNome, t.contatoWhatsapp, t.contatoEmail].filter(Boolean).join(' · ');
  const linhas = [
    `Cliente: ${t.cliente}`,
    `Contato: ${contato || '[a decidir]'}`,
    `Fase do trilho: ${t.fase}`,
    '',
    `Trilho de onboarding: /onboarding/${t.id}`,
  ];
  if (t.leadId) linhas.push(`Lead no comercial: /comercial/lead/${t.leadId}`);
  linhas.push('', `Origem: ${ORIGEM} · a Implantação virou lista em ${dataCurta(agora)} (decisão de 26/10/2026). Nada foi redigitado: os dados vêm do trilho.`);
  return linhas.join('\n').slice(0, 4000);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const audit = app.get(AuditService);
  const ctx = (fn) => comContexto({ orgId: ORG, actorId: ATOR, actorType: 'user', correlationId: randomUUID(), origem: 'script' }, fn);
  const agora = new Date();

  if (DESFAZER) {
    const a = JSON.parse(fs.readFileSync(ANTES, 'utf8'));
    await ctx(async () => {
      for (const c of a.cards) {
        // Só o que este script tocou: a auditoria do card precisa ter a origem.
        const prova = await prisma.auditLog.findFirst({ where: { orgId: ORG, entityId: c.cardId, entityType: 'work_task', metadata: { path: ['origem'], equals: ORIGEM } }, select: { id: true } });
        if (!prova) { console.log(`card ${curto(c.cardId)} sem a origem na auditoria: não mexo`); continue; }
        if (c.modo === 'criado') {
          await prisma.workTask.updateMany({ where: { id: c.cardId, orgId: ORG, excluidaEm: null }, data: { excluidaEm: agora, excluidaPor: ATOR, archived: true } });
          await audit.log({ orgId: ORG, actorId: ATOR, action: 'work.task.delete', entityType: 'work_task', entityId: c.cardId, before: { excluidaEm: null }, after: { excluidaEm: agora.toISOString(), lixeira: true }, metadata: { origem: ORIGEM + '.desfazer', trilhoId: c.trilhoId } });
          console.log(`card ${curto(c.cardId)} (criado) -> Lixeira`);
        } else if (c.modo === 'restaurado') {
          await prisma.workTask.updateMany({ where: { id: c.cardId, orgId: ORG }, data: { archived: c.antes.archived, excluidaEm: c.antes.excluidaEm ? new Date(c.antes.excluidaEm) : null, excluidaPor: c.antes.excluidaPor } });
          await audit.log({ orgId: ORG, actorId: ATOR, action: 'work.task.update', entityType: 'work_task', entityId: c.cardId, before: { archived: false, excluidaEm: null }, after: c.antes, metadata: { origem: ORIGEM + '.desfazer', trilhoId: c.trilhoId } });
          console.log(`card ${curto(c.cardId)} (restaurado) voltou ao estado de antes`);
        }
        await prisma.onboardingTrilho.updateMany({ where: { id: c.trilhoId, orgId: ORG, cardId: c.cardId }, data: { cardId: c.cardIdAntes } });
        if (c.fichaLigada) await prisma.comercialFicha.updateMany({ where: { leadId: c.leadId, orgId: ORG, cardId: c.cardId }, data: { cardId: null } });
      }
    });
    console.log('desfeito (os cards criados estão na Lixeira; "apagar de vez" é pela Lixeira, com admin.usuarios)');
    return app.close();
  }

  // A lista "Onboarding de cliente" na pasta Clientes (a marcada do Comercial, senão pelo nome).
  const pastas = await prisma.workFolder.findMany({ where: { orgId: ORG, parentId: null, arquivadaEm: null }, select: { id: true, name: true, doComercial: true } });
  const clientes = pastas.find((p) => p.doComercial && chave(p.name) === chave(PASTA_DA_IMPLANTACAO)) ?? pastas.find((p) => chave(p.name) === chave(PASTA_DA_IMPLANTACAO));
  if (!clientes) { console.log(`a pasta "${PASTA_DA_IMPLANTACAO}" não existe nesta empresa: nada a fazer`); return app.close(); }
  const lista = (await prisma.workList.findMany({ where: { orgId: ORG, folderId: clientes.id, arquivadaEm: null }, select: { id: true, name: true, statuses: { orderBy: { order: 'asc' }, select: { id: true, name: true, type: true } } } }))
    .find((l) => chave(l.name) === chave(LISTA_DA_IMPLANTACAO));
  if (!lista) { console.log(`a lista "${LISTA_DA_IMPLANTACAO}" não existe em "${clientes.name}": nada a fazer`); return app.close(); }
  console.log(`lista "${lista.name}" (${curto(lista.id)}) na pasta "${clientes.name}" · etapas: ${lista.statuses.map((s) => s.name).join(' > ')}`);

  // Os trilhos ativos e o card de cada um.
  const trilhos = await prisma.onboardingTrilho.findMany({
    where: { orgId: ORG, fase: { not: 'encerrado' } },
    select: { id: true, cliente: true, slug: true, fase: true, cardId: true, contatoNome: true, contatoWhatsapp: true, contatoEmail: true, conduzidoPor: true, implantadoPor: true },
    orderBy: { criadoEm: 'asc' },
  });
  const encerrados = await prisma.onboardingTrilho.count({ where: { orgId: ORG, fase: 'encerrado' } });
  console.log(`trilhos: ${trilhos.length} ativo(s), ${encerrados} encerrado(s) (ficam de fora)`);

  const plano = [];
  for (const t of trilhos) {
    const ficha = await prisma.comercialFicha.findFirst({ where: { orgId: ORG, trilhoId: t.id }, select: { leadId: true, partnerId: true, cardId: true } });
    const cardAtual = t.cardId ? await prisma.workTask.findFirst({ where: { id: t.cardId, orgId: ORG }, select: { id: true, listId: true, archived: true, excluidaEm: true, status: { select: { name: true } } } }) : null;
    const temCard = !!cardAtual && !cardAtual.excluidaEm;
    if (temCard) {
      console.log(`· ${t.cliente} (${t.fase}): já tem card ${curto(cardAtual.id)} em ${cardAtual.status.name}${cardAtual.archived ? ' (arquivado, fica)' : ''}${cardAtual.listId !== lista.id ? ' [em OUTRA lista]' : ''}${ficha ? `; lead ${curto(ficha.leadId)}` : ''}`);
      continue;
    }
    const cardId = ficha ? cardIdDoLead(ORG, ficha.leadId) : uuidDe([ORG, 'implantacao-para-lista', t.id]);
    const existente = await prisma.workTask.findFirst({ where: { id: cardId, orgId: ORG }, select: { id: true, archived: true, excluidaEm: true, excluidaPor: true, listId: true, status: { select: { name: true } } } });
    const { etapa, peloMapa } = etapaDaFase(lista.statuses, t.fase);
    const motivo = !t.cardId ? 'sem cardId' : !cardAtual ? `cardId ${curto(t.cardId)} não existe` : 'card na Lixeira';
    plano.push({ t, ficha, cardId, existente, etapa, peloMapa, motivo });
    console.log(`· ${t.cliente} (${t.fase}): ${motivo} -> ${existente ? `RESTAURAR card ${curto(cardId)} (${existente.excluidaEm ? 'na Lixeira' : existente.archived ? 'arquivado' : 'vivo'}, em ${existente.status.name})` : `CRIAR card ${curto(cardId)} em "${etapa.name}"${peloMapa ? '' : ' (fase fora do mapa: primeira etapa aberta)'}`}${ficha ? `; lead ${curto(ficha.leadId)} (id derivado do lead)` : '; sem lead (id derivado do trilho)'}`);
  }
  console.log(`plano: ${plano.filter((p) => !p.existente).length} card(s) a criar, ${plano.filter((p) => p.existente).length} a restaurar, ${trilhos.length - plano.length} trilho(s) já com card`);
  if (!plano.length) { console.log('nada a fazer'); return app.close(); }
  if (!VALER) return app.close();

  const antes = { listaId: lista.id, cards: [] };
  fs.writeFileSync(ANTES, JSON.stringify(antes, null, 2));
  await ctx(async () => {
    for (const p of plano) {
      const { t, ficha, cardId, existente, etapa } = p;
      const registro = { trilhoId: t.id, cardId, cardIdAntes: t.cardId ?? null, leadId: ficha?.leadId ?? null, fichaLigada: false, modo: existente ? 'restaurado' : 'criado', antes: existente ? { archived: existente.archived, excluidaEm: existente.excluidaEm, excluidaPor: existente.excluidaPor } : null };
      if (existente) {
        // Como o fechamento faz: o card que alguém arquivou ou mandou à Lixeira volta, porque o cliente ficaria sem lugar na lista.
        await prisma.workTask.updateMany({ where: { id: cardId, orgId: ORG }, data: { archived: false, excluidaEm: null, excluidaPor: null } });
        await prisma.workComment.create({ data: { orgId: ORG, taskId: cardId, authorId: null, authorName: 'Implantação', text: `O card voltou ${existente.excluidaEm ? 'da Lixeira' : 'das arquivadas'} em ${dataCurta(agora)}: a Implantação virou lista (${ORIGEM}) e o trilho /onboarding/${t.id} ficaria sem card.` } });
        await audit.log({ orgId: ORG, actorId: ATOR, action: 'work.task.restore', entityType: 'work_task', entityId: cardId, before: registro.antes, after: { archived: false, excluidaEm: null }, metadata: { origem: ORIGEM, trilhoId: t.id } });
        console.log(`card ${curto(cardId)} restaurado para ${t.cliente}`);
      } else {
        await prisma.workTask.create({
          data: {
            id: cardId, orgId: ORG, listId: lista.id, statusId: etapa.id,
            title: String(t.cliente).slice(0, 200),
            description: descricaoDoCard({ ...t, leadId: ficha?.leadId ?? null }, agora),
            assignee: t.implantadoPor ?? t.conduzidoPor ?? null,
            clienteId: ficha?.partnerId ?? null,
          },
        });
        await prisma.workComment.create({ data: { orgId: ORG, taskId: cardId, authorId: null, authorName: 'Implantação', text: `Card aberto em ${dataCurta(agora)} porque a Implantação virou a lista ${lista.name} (${ORIGEM}). O trilho continua em /onboarding/${t.id}.` } });
        // A mesma linha que o quadro grava ao criar: a caixa e o rodapé do cartão a leem.
        await audit.log({ orgId: ORG, actorId: ATOR, action: 'work.task.create', entityType: 'work_task', entityId: cardId, after: { title: t.cliente, status: etapa.name, list: lista.name, procedencia: ORIGEM, trilhoId: t.id, leadId: ficha?.leadId ?? null }, metadata: { origem: ORIGEM, trilhoId: t.id } });
        console.log(`card ${curto(cardId)} criado para ${t.cliente} em "${etapa.name}"`);
      }
      await prisma.onboardingTrilho.updateMany({ where: { id: t.id, orgId: ORG }, data: { cardId } });
      if (ficha && !ficha.cardId) {
        const r = await prisma.comercialFicha.updateMany({ where: { leadId: ficha.leadId, orgId: ORG, cardId: null }, data: { cardId } });
        registro.fichaLigada = r.count === 1;
      }
      antes.cards.push(registro);
      fs.writeFileSync(ANTES, JSON.stringify(antes, null, 2));
    }
  });
  console.log(`feito: ${antes.cards.length} trilho(s) com card na lista "${lista.name}"`);
  await app.close();
}

main().then(() => process.exit(0)).catch((err) => { console.error('ERRO', err?.response ?? err); process.exit(1); });
