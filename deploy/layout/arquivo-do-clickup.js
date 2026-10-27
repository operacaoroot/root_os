// O ARQUIVO DO CLICKUP (leva 5, L1, decisão da reunião de 26/10/2026: "o ClickUp não vai mais ser usado").
// As listas importadas do ClickUp que ainda apareciam em "Todas" e no Dia a dia (Gestão de Temas, Copy,
// Rotina de stories, Design & Gravação) vão para a pasta "Arquivo do ClickUp", DENTRO de Marketing, e
// ganham a marca `arquivoDoClickUp` (a pasta e cada lista). Com a marca, elas saem de Todas, das
// contagens e do Dia a dia, e os status herdados deixam de virar coluna vazia; na árvore a pasta fica,
// recolhida. NADA é apagado nem arquivado: tarefas, status, campos e ids ficam como estão (a Produção
// do Marketing lê o status de algumas). A troca de pasta é direta no banco, auditada
// (`work.list.update` / `work.folder.update` / `work.folder.create`, origem script).
// Pré-requisito: a migration `20261027010000_arquivo_do_clickup` aplicada (as duas colunas).
// O "antes" fica em /tmp/arquivo-do-clickup-antes.json; `--desfazer` volta a partir dele.
// Rode DENTRO do mktos_api:
//   node /tmp/arquivo-do-clickup.js             -> ensaio (só lê e diz o que faria, com as contagens)
//   node /tmp/arquivo-do-clickup.js --valer     -> grava
//   node /tmp/arquivo-do-clickup.js --desfazer  -> volta (listas às pastas de antes, marcas falsas; a pasta criada sai se ficou vazia)
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

const VALER = process.argv.includes('--valer');
const DESFAZER = process.argv.includes('--desfazer');
const ORG = '63cdd80e-0435-488d-98b5-c2653d235e50';
// Quem assina: o Lucas, dono da pasta Marketing (o mesmo ator dos scripts de layout de 26/10).
const ATOR = 'fbb3983f-bd69-43d8-b284-5316cf25534a';
const ANTES = '/tmp/arquivo-do-clickup-antes.json';
const ORIGEM = 'script.arquivo-do-clickup';
const PASTA_MARKETING = 'Marketing';
const PASTA_ARQUIVO = 'Arquivo do ClickUp';
// As quatro da reunião. Lista do ClickUp que não está aqui (Análise, Calendário de conteúdo, Demandas gerais) FICA.
const LISTAS = ['Gestão de Temas', 'Copy', 'Rotina de stories', 'Design & Gravação'];

const chave = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
const ehIdDoClickUp = (externalId) => typeof externalId === 'string' && /^\d{6,}$/.test(externalId);
const curto = (id) => String(id).slice(0, 8);

/** Tarefas ABERTAS (não concluídas, vivas, de lista de tarefas) nas listas dadas: é o número que Todas e o Dia a dia mostram. */
async function abertasEm(prisma, listIds) {
  if (!listIds.length) return 0;
  return prisma.workTask.count({
    where: { orgId: ORG, archived: false, excluidaEm: null, listId: { in: listIds }, list: { natureza: 'tarefas' }, status: { type: { not: 'closed' } } },
  });
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const audit = app.get(AuditService);
  const ctx = (fn) => comContexto({ orgId: ORG, actorId: ATOR, actorType: 'user', correlationId: randomUUID(), origem: 'script' }, fn);
  const log = (acao, tipo, id, before, after, sufixo = '') => audit.log({
    orgId: ORG, actorId: ATOR, action: acao, entityType: tipo, entityId: id, before, after, metadata: { origem: ORIGEM + sufixo },
  });

  if (DESFAZER) {
    const a = JSON.parse(fs.readFileSync(ANTES, 'utf8'));
    await ctx(async () => {
      for (const l of a.listas) {
        await prisma.workList.updateMany({ where: { id: l.id, orgId: ORG }, data: { folderId: l.folderId, spaceId: l.spaceId, order: l.order, arquivoDoClickUp: false } });
        await log('work.list.update', 'work_list', l.id, { folderId: a.pasta.id, arquivoDoClickUp: true }, { folderId: l.folderId, spaceId: l.spaceId, arquivoDoClickUp: false }, '.desfazer');
        console.log(`lista "${l.name}" voltou para ${l.pastaNome ?? '(sem pasta)'}`);
      }
      await prisma.workFolder.updateMany({ where: { id: a.pasta.id, orgId: ORG }, data: { arquivoDoClickUp: false } });
      await log('work.folder.update', 'work_folder', a.pasta.id, { arquivoDoClickUp: true }, { arquivoDoClickUp: false }, '.desfazer');
      if (a.pasta.criada) {
        const resto = await prisma.workList.count({ where: { orgId: ORG, folderId: a.pasta.id } })
          + await prisma.workFolder.count({ where: { orgId: ORG, parentId: a.pasta.id } });
        if (resto === 0) {
          await prisma.workFolder.delete({ where: { id: a.pasta.id } });
          await log('work.folder.delete', 'work_folder', a.pasta.id, { name: PASTA_ARQUIVO, parentId: a.marketing.id }, null, '.desfazer');
          console.log(`pasta "${PASTA_ARQUIVO}" (criada pelo script, vazia) saiu`);
        } else console.log(`pasta "${PASTA_ARQUIVO}" ficou: alguém pôs ${resto} coisa(s) nela depois`);
      }
    });
    console.log('desfeito');
    return app.close();
  }

  // A pasta de topo Marketing (viva, do Trabalho). Precisa ser exatamente uma.
  const marketings = (await prisma.workFolder.findMany({
    where: { orgId: ORG, parentId: null, arquivadaEm: null, doComercial: false },
    select: { id: true, name: true, spaceId: true },
  })).filter((p) => chave(p.name) === chave(PASTA_MARKETING));
  if (marketings.length !== 1) {
    console.log(`pastas de topo chamadas "${PASTA_MARKETING}": ${marketings.length}. Precisa ser exatamente uma; nada foi feito.`);
    return app.close();
  }
  const marketing = marketings[0];

  // A pasta "Arquivo do ClickUp" dentro dela, se já existe.
  const dentro = await prisma.workFolder.findMany({ where: { orgId: ORG, parentId: marketing.id }, select: { id: true, name: true, arquivadaEm: true, arquivoDoClickUp: true } });
  const arquivo = dentro.find((p) => chave(p.name) === chave(PASTA_ARQUIVO)) ?? null;
  if (arquivo?.arquivadaEm) {
    console.log(`a pasta "${PASTA_ARQUIVO}" existe mas está ARQUIVADA (${curto(arquivo.id)}): desarquive pela Lixeira antes. Nada foi feito.`);
    return app.close();
  }

  // As listas da pasta Marketing (e da própria Arquivo, se já houver): as quatro pelo nome.
  const pastasDoMarketing = [marketing.id, ...(arquivo ? [arquivo.id] : [])];
  const listas = await prisma.workList.findMany({
    where: { orgId: ORG, folderId: { in: pastasDoMarketing } },
    select: { id: true, name: true, externalId: true, folderId: true, spaceId: true, order: true, arquivadaEm: true, arquivoDoClickUp: true, natureza: true, folder: { select: { name: true } } },
    orderBy: { order: 'asc' },
  });
  const vao = listas.filter((l) => LISTAS.some((n) => chave(n) === chave(l.name)));
  const naoAchadas = LISTAS.filter((n) => !listas.some((l) => chave(l.name) === chave(n)));
  const outrasDoClickUp = listas.filter((l) => ehIdDoClickUp(l.externalId) && !vao.includes(l));
  console.log(`pasta "${marketing.name}" (${curto(marketing.id)}) · pasta "${PASTA_ARQUIVO}": ${arquivo ? `já existe (${curto(arquivo.id)}${arquivo.arquivoDoClickUp ? ', marcada' : ', sem marca'})` : 'será criada'}`);
  console.log('listas que VÃO para o Arquivo:', vao.map((l) => `${l.name} [${l.externalId ?? 'sem externalId'}${ehIdDoClickUp(l.externalId) ? ', id do ClickUp' : ''}; ${l.natureza}; em ${l.folder?.name}${l.arquivadaEm ? '; ARQUIVADA' : ''}${l.arquivoDoClickUp ? '; já marcada' : ''}]`).join(' | ') || '(nenhuma)');
  if (naoAchadas.length) console.log('não achadas em Marketing (ficam de fora):', naoAchadas.join(' | '));
  if (outrasDoClickUp.length) console.log('outras listas com id do ClickUp que FICAM onde estão:', outrasDoClickUp.map((l) => l.name).join(' | '));

  // A PROVA: a contagem de abertas que Todas e o Dia a dia mostram, antes e depois (as duas telas leem o mesmo recorte).
  const todasAsListasDeTarefa = await prisma.workList.findMany({
    where: { orgId: ORG, arquivadaEm: null, natureza: 'tarefas', doComercial: false, OR: [{ folderId: null }, { folder: { doComercial: false, arquivadaEm: null } }] },
    select: { id: true },
  });
  const abertasAntes = await abertasEm(prisma, todasAsListasDeTarefa.map((l) => l.id));
  const abertasNoArquivo = await abertasEm(prisma, vao.filter((l) => l.natureza === 'tarefas').map((l) => l.id));
  console.log(`prova: abertas em Todas/Dia a dia hoje = ${abertasAntes}; nas listas do Arquivo = ${abertasNoArquivo}; esperado depois = ${abertasAntes - abertasNoArquivo}`);
  console.log('(a conferência na tela: Dia a dia › Visão geral "abertas" e Trabalho › Todas com Ocultar concluídas devem mostrar o mesmo número, antes e depois)');

  if (!vao.length) { console.log('nenhuma lista para mover: nada a fazer'); return app.close(); }
  if (!VALER) return app.close();

  const antes = {
    marketing: { id: marketing.id },
    pasta: { id: arquivo?.id ?? null, criada: !arquivo },
    listas: vao.map((l) => ({ id: l.id, name: l.name, folderId: l.folderId, spaceId: l.spaceId, order: l.order, pastaNome: l.folder?.name ?? null, arquivoDoClickUp: l.arquivoDoClickUp })),
  };
  await ctx(async () => {
    let pastaId = arquivo?.id ?? null;
    if (!pastaId) {
      const fim = await prisma.workFolder.aggregate({ where: { orgId: ORG, parentId: marketing.id }, _max: { order: true } });
      // Pasta dentro de pasta herda o espaço pela mãe (a árvore lê pelo `parentId`); o nome é único entre irmãs.
      const nova = await prisma.workFolder.create({
        data: { orgId: ORG, parentId: marketing.id, spaceId: null, name: PASTA_ARQUIVO, order: fim._max.order === null ? 0 : fim._max.order + 1, arquivoDoClickUp: true },
        select: { id: true },
      });
      pastaId = nova.id;
      antes.pasta.id = pastaId;
      fs.writeFileSync(ANTES, JSON.stringify(antes, null, 2));
      await log('work.folder.create', 'work_folder', pastaId, null, { name: PASTA_ARQUIVO, parentId: marketing.id, arquivoDoClickUp: true });
      console.log(`pasta "${PASTA_ARQUIVO}" criada (${curto(pastaId)})`);
    } else {
      fs.writeFileSync(ANTES, JSON.stringify(antes, null, 2));
      if (!arquivo.arquivoDoClickUp) {
        await prisma.workFolder.updateMany({ where: { id: pastaId, orgId: ORG }, data: { arquivoDoClickUp: true } });
        await log('work.folder.update', 'work_folder', pastaId, { arquivoDoClickUp: false }, { arquivoDoClickUp: true });
        console.log(`pasta "${PASTA_ARQUIVO}" marcada`);
      }
    }
    const fimDasListas = await prisma.workList.aggregate({ where: { orgId: ORG, folderId: pastaId }, _max: { order: true } });
    let order = fimDasListas._max.order === null ? 0 : fimDasListas._max.order + 1;
    for (const l of vao) {
      const jaNaPasta = l.folderId === pastaId;
      const data = { arquivoDoClickUp: true, ...(jaNaPasta ? {} : { folderId: pastaId, spaceId: null, order: order++ }) };
      await prisma.workList.updateMany({ where: { id: l.id, orgId: ORG }, data });
      await log('work.list.update', 'work_list', l.id,
        { folderId: l.folderId, spaceId: l.spaceId, arquivoDoClickUp: l.arquivoDoClickUp },
        { folderId: pastaId, spaceId: null, arquivoDoClickUp: true });
      console.log(`lista "${l.name}" ${jaNaPasta ? 'já estava na pasta; marcada' : `-> "${PASTA_ARQUIVO}" e marcada`}`);
    }
  });
  const abertasDepois = await abertasEm(prisma, (await prisma.workList.findMany({
    where: { orgId: ORG, arquivadaEm: null, natureza: 'tarefas', doComercial: false, arquivoDoClickUp: false, OR: [{ folderId: null }, { folder: { doComercial: false, arquivadaEm: null, arquivoDoClickUp: false } }] },
    select: { id: true },
  })).map((l) => l.id));
  console.log(`prova depois: abertas em Todas/Dia a dia = ${abertasDepois} (esperado ${abertasAntes - abertasNoArquivo})`);
  await app.close();
}

main().then(() => process.exit(0)).catch((err) => { console.error('ERRO', err?.response ?? err); process.exit(1); });
