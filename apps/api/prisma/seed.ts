import { PrismaClient, LeadStatus, TaskStatus } from '@prisma/client';
import { PERMISSIONS, ROLES } from '@mktos/shared';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ADMIN_EMAIL = 'admin@marketing-os.local';
const ADMIN_PASSWORD = 'admin12345'; // DEV — trocar em produção
const MCP_EMAIL = 'mcp@marketing-os.local';
const MCP_PASSWORD = 'mcp-service-12345'; // DEV — conta de serviço só-leitura p/ o MCP/IA

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

async function main() {
  // 1) Org
  const org = await prisma.org.upsert({
    where: { slug: 'root' },
    update: {},
    create: { name: 'Marketing OS (root)', slug: 'root' },
  });

  // 2) Permissions (fonte única em @mktos/shared)
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  }
  const allPerms = await prisma.permission.findMany();
  const permByKey = new Map(allPerms.map((p) => [p.key, p.id]));

  // 3) Roles + vínculos de permissão
  for (const [key, def] of Object.entries(ROLES)) {
    await prisma.role.upsert({
      where: { orgId_key: { orgId: org.id, key } },
      update: {
        name: def.name,
        permissions: { set: def.permissions.map((k) => ({ id: permByKey.get(k)! })) },
      },
      create: {
        orgId: org.id,
        key,
        name: def.name,
        permissions: { connect: def.permissions.map((k) => ({ id: permByKey.get(k)! })) },
      },
    });
  }
  const adminRole = await prisma.role.findUniqueOrThrow({
    where: { orgId_key: { orgId: org.id, key: 'admin_master' } },
  });

  // 4) Usuário admin
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { passwordHash, roles: { set: [{ id: adminRole.id }] } },
    create: {
      orgId: org.id,
      name: 'Admin Root',
      email: ADMIN_EMAIL,
      passwordHash,
      roles: { connect: [{ id: adminRole.id }] },
    },
  });

  // 4b) Usuário de serviço do MCP/IA (só leitura — menor privilégio)
  const iaRole = await prisma.role.findUniqueOrThrow({
    where: { orgId_key: { orgId: org.id, key: 'ia_servico' } },
  });
  const mcpHash = await bcrypt.hash(MCP_PASSWORD, 10);
  await prisma.user.upsert({
    where: { email: MCP_EMAIL },
    update: { passwordHash: mcpHash, roles: { set: [{ id: iaRole.id }] } },
    create: {
      orgId: org.id,
      name: 'MCP Service (IA)',
      email: MCP_EMAIL,
      passwordHash: mcpHash,
      roles: { connect: [{ id: iaRole.id }] },
    },
  });

  // 5) Limpa dados de exemplo do org (idempotência) e recria
  await prisma.leadEvent.deleteMany({ where: { lead: { orgId: org.id } } });
  await prisma.lead.deleteMany({ where: { orgId: org.id } });
  await prisma.pixelEvent.deleteMany({ where: { orgId: org.id } });
  await prisma.task.deleteMany({ where: { orgId: org.id } });
  await prisma.campaign.deleteMany({ where: { orgId: org.id } });
  await prisma.leadSource.deleteMany({ where: { orgId: org.id } });

  // 5a) Fontes de lead
  const sources = await Promise.all(
    [
      { key: 'instagram', name: 'Instagram', channel: 'social' },
      { key: 'sales_page', name: 'Página de vendas', channel: 'site' },
      { key: 'indicacao', name: 'Indicação', channel: 'organico' },
    ].map((s) =>
      prisma.leadSource.create({ data: { orgId: org.id, ...s } }),
    ),
  );

  // 5b) Campanhas
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

  // 5c) Leads (distribuídos no tempo p/ hoje/semana/mês)
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

  // 5d) Pixel events (funil da página de vendas)
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

  // 5e) Tarefas (algumas atrasadas)
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

  // 5f) Uma integração conectada (p/ tela de observabilidade)
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

  console.log('✔ Seed concluído.');
  console.log(`  Org: ${org.name} (${org.slug})`);
  console.log(`  Login admin → ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`  MCP serviço → ${MCP_EMAIL} / ${MCP_PASSWORD} (read-only)`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
