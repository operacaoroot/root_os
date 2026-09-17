import { PrismaClient, LeadStatus, TaskStatus } from '@prisma/client';
import { bancoDescartavelEstrito, nomeDoBanco } from '../src/common/banco-descartavel';

/*
 * DADOS DE EXEMPLO — apaga e recria. SÓ EM BANCO DESCARTÁVEL, SÓ COM A FLAG.
 *
 * Este é o bloco que vivia dentro de `prisma/seed.ts` e fazia o "bootstrap"
 * apagar leads, eventos, tarefas, campanhas e fontes da empresa `root` a cada
 * rodada. Saiu de lá na etapa P1-b do plano de produto (17/09/2026) porque
 * comando que destrói não pode estar no caminho automático de instalação.
 *
 * DUAS TRAVAS, E AS DUAS TÊM DE PASSAR:
 *   1. o nome do banco em `DATABASE_URL` se anuncia como descartável
 *      (test/dev/local/staging/shadow — a mesma expressão das suítes). É a
 *      checagem ESTRITA: o destrave das suítes (`PERMITIR_BANCO_NAO_TESTE=1`)
 *      NÃO vale aqui — variável esquecida no shell não é licença para apagar;
 *   2. a flag `--sim-apagar` veio na linha de comando. Sem ela o script para
 *      ANTES de abrir conexão e diz o que teria feito. Nenhum script de
 *      instalação passa essa flag; é para mão humana.
 *
 * Pré-requisito: `db:seed` já rodou (a empresa `root` existe). Este script não
 * cria empresa, papel nem conta — se faltar, ele diz e sai.
 */

const FLAG = '--sim-apagar';
const url = process.env.DATABASE_URL ?? '';

function recusar(motivo: string): never {
  console.error(`\n[seed-demo] RECUSADO — ${motivo}\n`);
  console.error(
    '  O que este comando faz quando roda: apaga TODOS os leads, eventos de lead, eventos de pixel,\n' +
      '  tarefas, campanhas e fontes de lead da empresa `root`, e recria um conjunto de exemplo.\n' +
      '  Para rodar de propósito: DATABASE_URL apontando para um banco cujo NOME se anuncia como\n' +
      `  descartável (test/dev/local/staging/shadow) e a flag ${FLAG}. Não há destrave por variável.\n`,
  );
  process.exit(2);
}

if (!url) recusar('DATABASE_URL não definida');
if (!bancoDescartavelEstrito(url)) recusar(`o banco "${nomeDoBanco(url)}" não se anuncia como descartável pelo nome`);
if (!process.argv.includes(FLAG)) recusar(`faltou a flag ${FLAG}`);

const prisma = new PrismaClient();

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

async function main() {
  const org = await prisma.org.findUnique({ where: { slug: 'root' } });
  if (!org) throw new Error('empresa `root` não existe — rode `db:seed` antes.');

  // 1) Limpa dados de exemplo da empresa e recria
  await prisma.leadEvent.deleteMany({ where: { lead: { orgId: org.id } } });
  await prisma.lead.deleteMany({ where: { orgId: org.id } });
  await prisma.pixelEvent.deleteMany({ where: { orgId: org.id } });
  await prisma.task.deleteMany({ where: { orgId: org.id } });
  await prisma.campaign.deleteMany({ where: { orgId: org.id } });
  await prisma.leadSource.deleteMany({ where: { orgId: org.id } });

  // 2) Fontes de lead
  const sources = await Promise.all(
    [
      { key: 'instagram', name: 'Instagram', channel: 'social' },
      { key: 'sales_page', name: 'Página de vendas', channel: 'site' },
      { key: 'indicacao', name: 'Indicação', channel: 'organico' },
    ].map((s) => prisma.leadSource.create({ data: { orgId: org.id, ...s } })),
  );

  // 3) Campanhas
  const [camp1, camp2] = await Promise.all([
    prisma.campaign.create({
      data: { orgId: org.id, name: 'Black Friday — Tráfego', objective: 'leads', channel: 'meta_ads', budget: '5000.00', spend: '3200.00', status: 'ativa', startAt: daysAgo(20) },
    }),
    prisma.campaign.create({
      data: { orgId: org.id, name: 'Lançamento Curso', objective: 'vendas', channel: 'meta_ads', budget: '8000.00', spend: '1200.00', status: 'ativa', startAt: daysAgo(6) },
    }),
    prisma.campaign.create({
      data: { orgId: org.id, name: 'Remarketing Q3', objective: 'vendas', channel: 'meta_ads', budget: '2000.00', spend: '1980.00', status: 'problema', startAt: daysAgo(40) },
    }),
  ]);

  // 4) Leads (distribuídos no tempo p/ hoje/semana/mês)
  const leadSeed: Array<{ name: string; status: LeadStatus; days: number; sIdx: number; cId?: string; score: number }> = [
    { name: 'Ana Prado', status: 'novo', days: 0, sIdx: 0, cId: camp1.id, score: 40 },
    { name: 'Bruno Lima', status: 'qualificado', days: 0, sIdx: 1, cId: camp2.id, score: 72 },
    { name: 'Carla Souza', status: 'novo', days: 0, sIdx: 0, cId: camp1.id, score: 30 },
    { name: 'Diego Alves', status: 'oportunidade', days: 2, sIdx: 1, cId: camp2.id, score: 85 },
    { name: 'Elisa Nunes', status: 'ganho', days: 3, sIdx: 2, score: 90 },
    { name: 'Felipe Rocha', status: 'reuniao', days: 5, sIdx: 1, cId: camp2.id, score: 66 },
    { name: 'Gabi Martins', status: 'novo', days: 12, sIdx: 0, cId: camp1.id, score: 22 },
    { name: 'Hugo Dias', status: 'perdido', days: 18, sIdx: 2, score: 10 },
    { name: 'Iara Melo', status: 'ganho', days: 25, sIdx: 1, cId: camp2.id, score: 95 },
  ];
  for (const l of leadSeed) {
    await prisma.lead.create({
      data: {
        orgId: org.id,
        name: l.name,
        email: `${l.name.toLowerCase().replace(/\s+/g, '.')}@exemplo.com`,
        phone: '+55 21 99999-0000',
        sourceId: sources[l.sIdx].id,
        campaignId: l.cId,
        utmSource: sources[l.sIdx].key,
        utmMedium: 'cpc',
        utmCampaign: l.cId === camp1.id ? 'black-friday' : 'lancamento',
        status: l.status,
        score: l.score,
        enteredAt: daysAgo(l.days),
        events: { create: [{ type: 'created', payload: { seed: true } }] },
      },
    });
  }

  // 5) Pixel events (funil da página de vendas)
  const pixelNames = ['page_view', 'page_view', 'page_view', 'scroll_50', 'click_cta', 'form_submit', 'purchase'];
  for (let i = 0; i < 40; i++) {
    const name = pixelNames[i % pixelNames.length];
    await prisma.pixelEvent.create({
      data: {
        orgId: org.id,
        eventId: `seed-evt-${i}`,
        sessionId: `sess-${i % 12}`,
        anonymousId: `anon-${i % 12}`,
        eventName: name,
        url: 'https://vendas.exemplo.com/oferta',
        utmSource: i % 2 ? 'instagram' : 'meta_ads',
        utmCampaign: i % 2 ? 'black-friday' : 'lancamento',
        value: name === 'purchase' ? '497.00' : null,
        occurredAt: daysAgo(i % 7),
      },
    });
  }

  // 6) Tarefas (algumas atrasadas)
  const tasks: Array<{ title: string; status: TaskStatus; due: number; tool: string }> = [
    { title: 'Aprovar criativo Black Friday', status: 'aberta', due: -2, tool: 'clickup' },
    { title: 'Responder lead quente (Bruno)', status: 'aberta', due: -1, tool: 'interno' },
    { title: 'Revisar copy da página', status: 'em_andamento', due: 1, tool: 'asana' },
    { title: 'Configurar pixel de conversão', status: 'aberta', due: -3, tool: 'clickup' },
    { title: 'Agendar posts da semana', status: 'concluida', due: -5, tool: 'asana' },
  ];
  for (const t of tasks) {
    await prisma.task.create({
      data: {
        orgId: org.id,
        tool: t.tool,
        title: t.title,
        status: t.status,
        priority: t.due < 0 ? 'alta' : 'normal',
        assignee: 'Equipe',
        dueDate: daysAgo(t.due), // due<0 => futuro; due>0 => passado (atrasada)
      },
    });
  }

  // 7) Uma integração conectada (p/ tela de observabilidade)
  const acc = await prisma.integrationAccount.upsert({
    where: { id: 'seed-clickup' },
    update: {},
    create: { id: 'seed-clickup', orgId: org.id, key: 'clickup', label: 'ClickUp (root)', status: 'connected', connectedAt: new Date() },
  });
  await prisma.integrationHealth.upsert({
    where: { accountId: acc.id },
    update: { status: 'ok', lastSyncAt: new Date(), latencyMs: 180 },
    create: { accountId: acc.id, status: 'ok', lastSyncAt: new Date(), latencyMs: 180 },
  });

  console.log(`✔ Dados de exemplo recriados na empresa ${org.slug} (banco "${nomeDoBanco(url)}").`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
