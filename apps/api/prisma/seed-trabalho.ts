import { PrismaClient, WorkStatusType, WorkPriority } from '@prisma/client';

// Seed do módulo TRABALHO com a FOTOGRAFIA real do ClickUp (espaço `root`):
// estrutura levantada em 07/07/2026 via API + retrato do sync de 25/07/2026
// (último bom antes do token ser revogado). Idempotente: roda quantas vezes
// precisar. Importa os temas (ContentItem) e tarefas (Task) preservando o id
// do ClickUp em externalId — quando o token voltar, o sync reconcilia por ele.

const prisma = new PrismaClient();

// Paleta no espírito do ClickUp (status e opções de campo).
const CORES = ['#ee5e99', '#f9d900', '#6fddff', '#b660e0', '#ff7fab', '#51e898', '#ff936c', '#7c4dff', '#00c2e0', '#ffab4a'];

// Estrutura real do espaço `root` (5 pastas, 11 listas; 07/07/2026).
const ESTRUTURA: Array<{ pasta: string; listas: Array<{ nome: string; externalId?: string }> }> = [
  {
    pasta: 'Projeto Mkt',
    listas: [
      { nome: 'Gestão de Temas', externalId: '901327640001' },
      { nome: 'Copy' },
      { nome: 'Design & Gravação' },
      { nome: 'Calendário de conteúdo' },
      { nome: 'Análise' },
      { nome: 'Tarefas Gerais' },
    ],
  },
  { pasta: 'Adm', listas: [{ nome: 'Atribuições' }, { nome: 'Demandas administrativas' }] },
  { pasta: 'Comercial', listas: [{ nome: 'List' }] },
  { pasta: 'Contratos', listas: [{ nome: 'Gestão de contratos' }] },
  { pasta: 'Projeto 2', listas: [{ nome: 'List' }] },
];

// Pipeline da Gestão de Temas: união do que as duas fotografias viram
// (25/07 mostrou o time trabalhando num status novo, `insights`).
const STATUSES_TEMAS = [
  { name: 'insights', type: WorkStatusType.open, color: '#87909e' },
  { name: 'validar ideia', type: WorkStatusType.custom, color: '#f9d900' },
  { name: 'escrever roteiro', type: WorkStatusType.custom, color: '#6fddff' },
  { name: 'complete', type: WorkStatusType.closed, color: '#6bc950' },
];

// Demais listas: a fotografia não capturou os statuses reais → pipeline padrão.
const STATUSES_PADRAO = [
  { name: 'A fazer', type: WorkStatusType.open, color: '#87909e' },
  { name: 'Em andamento', type: WorkStatusType.custom, color: '#f9d900' },
  { name: 'Concluída', type: WorkStatusType.closed, color: '#6bc950' },
];

// Campos personalizados da Gestão de Temas com as opções REAIS em uso (25/07).
const CAMPOS_TEMAS: Array<{ nome: string; opcoes: string[] }> = [
  { nome: 'Formato', opcoes: ['Reel', 'Carrossel'] },
  { nome: 'Eixo', opcoes: ['Mercado', 'Lifestyle', 'Cultura', 'Sua empresa', 'Case'] },
  {
    nome: 'Tipo',
    opcoes: ['Estudo de caso', 'Série', 'Bastidor', 'Esquetes', 'Entretenimento', 'Trend', 'Polêmico', 'React', 'Depoimento', 'Vlog'],
  },
  { nome: 'Fonte', opcoes: ['Referência', 'Própria'] },
];

// As 73 tarefas do retrato não trazem a lista de origem (o sync achatava) →
// entram numa lista própria para o time realocar arrastando (uso real do board).
const LISTA_REALOCAR = 'Importadas do ClickUp (realocar)';

async function main() {
  const org = await prisma.org.findUnique({ where: { slug: 'root' } });
  if (!org) throw new Error('Org `root` não existe — rode `pnpm db:seed` antes.');
  const orgId = org.id;

  // 1) Pastas e listas
  const listaPorNome = new Map<string, string>(); // "pasta/lista" → id
  for (const [pi, p] of ESTRUTURA.entries()) {
    const existente = await prisma.workFolder.findFirst({ where: { orgId, spaceId: null, parentId: null, name: p.pasta } });
    const folder = existente
      ? await prisma.workFolder.update({ where: { id: existente.id }, data: { order: pi } })
      : await prisma.workFolder.create({ data: { orgId, name: p.pasta, order: pi } });
    for (const [li, l] of p.listas.entries()) {
      let list = await prisma.workList.findFirst({ where: { orgId, folderId: folder.id, name: l.nome } });
      if (!list) {
        list = await prisma.workList.create({
          data: { orgId, folderId: folder.id, name: l.nome, order: li, externalId: l.externalId ?? null },
        });
      } else if (l.externalId && list.externalId !== l.externalId) {
        list = await prisma.workList.update({ where: { id: list.id }, data: { externalId: l.externalId } });
      }
      listaPorNome.set(`${p.pasta}/${l.nome}`, list.id);
    }
  }

  // 2) Statuses por lista
  const statusId = new Map<string, string>(); // "listId/status" → id
  for (const [chave, listId] of listaPorNome) {
    const conjunto = chave === 'Projeto Mkt/Gestão de Temas' ? STATUSES_TEMAS : STATUSES_PADRAO;
    for (const [si, s] of conjunto.entries()) {
      const st = await prisma.workStatus.upsert({
        where: { listId_name: { listId, name: s.name } },
        update: { type: s.type, color: s.color, order: si },
        create: { listId, name: s.name, type: s.type, color: s.color, order: si },
      });
      statusId.set(`${listId}/${s.name}`, st.id);
    }
  }

  // 3) Campos personalizados da Gestão de Temas (+ opções reais, com cor)
  const temasId = listaPorNome.get('Projeto Mkt/Gestão de Temas')!;
  const opcaoId = new Map<string, string>(); // "campo/opcao" → id
  const campoId = new Map<string, string>();
  for (const [ci, c] of CAMPOS_TEMAS.entries()) {
    let field = await prisma.workField.findFirst({ where: { orgId, listId: temasId, name: c.nome } });
    if (!field) field = await prisma.workField.create({ data: { orgId, listId: temasId, name: c.nome, order: ci } });
    campoId.set(c.nome, field.id);
    for (const [oi, o] of c.opcoes.entries()) {
      const opt = await prisma.workFieldOption.upsert({
        where: { fieldId_name: { fieldId: field.id, name: o } },
        update: { order: oi },
        create: { fieldId: field.id, name: o, color: CORES[oi % CORES.length], order: oi },
      });
      opcaoId.set(`${c.nome}/${o}`, opt.id);
    }
  }

  // 4) Fotografia → tarefas. Temas (ContentItem) entram na Gestão de Temas.
  const temas = await prisma.contentItem.findMany({ where: { orgId, source: 'clickup' } });
  let importadosTemas = 0;
  for (const t of temas) {
    if (!t.externalId) continue;
    // status cru da fotografia; se o time criar outros no ClickUp, nascem aqui como custom
    let stId = statusId.get(`${temasId}/${t.status}`);
    if (!stId) {
      const novo = await prisma.workStatus.upsert({
        where: { listId_name: { listId: temasId, name: t.status } },
        update: {},
        create: { listId: temasId, name: t.status, type: WorkStatusType.custom, color: '#ee5e99', order: 90 },
      });
      statusId.set(`${temasId}/${t.status}`, novo.id);
      stId = novo.id;
    }
    const task = await prisma.workTask.upsert({
      where: { orgId_externalId: { orgId, externalId: t.externalId } },
      update: { title: t.title, statusId: stId, assignee: t.assignee, dueDate: t.dueDate, externalUrl: t.url },
      create: {
        orgId, listId: temasId, statusId: stId, title: t.title,
        assignee: t.assignee, dueDate: t.dueDate,
        externalId: t.externalId, externalUrl: t.url,
      },
    });
    // valores dos campos personalizados (Formato/Eixo/Tipo/Fonte)
    const valores: Array<[string, string | null]> = [
      ['Formato', t.formato], ['Eixo', t.eixo], ['Tipo', t.tipo], ['Fonte', t.fonte],
    ];
    for (const [campo, valor] of valores) {
      if (!valor) continue;
      const fId = campoId.get(campo)!;
      let oId = opcaoId.get(`${campo}/${valor}`);
      if (!oId) {
        const opt = await prisma.workFieldOption.upsert({
          where: { fieldId_name: { fieldId: fId, name: valor } },
          update: {},
          create: { fieldId: fId, name: valor, color: '#87909e', order: 99 },
        });
        opcaoId.set(`${campo}/${valor}`, opt.id);
        oId = opt.id;
      }
      await prisma.workFieldValue.upsert({
        where: { taskId_fieldId: { taskId: task.id, fieldId: fId } },
        update: { optionId: oId },
        create: { taskId: task.id, fieldId: fId, optionId: oId },
      });
    }
    importadosTemas++;
  }

  // 5) Tarefas operacionais (Task tool=clickup) → lista "realocar"
  let realocar = await prisma.workList.findFirst({ where: { orgId, name: LISTA_REALOCAR } });
  if (!realocar) {
    const projMkt = await prisma.workFolder.findFirst({ where: { orgId, spaceId: null, parentId: null, name: 'Projeto Mkt' } });
    realocar = await prisma.workList.create({ data: { orgId, folderId: projMkt!.id, name: LISTA_REALOCAR, order: 99 } });
    for (const [si, s] of STATUSES_PADRAO.entries()) {
      await prisma.workStatus.create({ data: { listId: realocar.id, name: s.name, type: s.type, color: s.color, order: si } });
    }
  }
  const stRealocar = await prisma.workStatus.findMany({ where: { listId: realocar.id } });
  const porTipo = (tipo: WorkStatusType) => stRealocar.find((s) => s.type === tipo)!.id;
  const mapa: Record<string, string> = {
    aberta: porTipo(WorkStatusType.open),
    em_andamento: porTipo(WorkStatusType.custom),
    bloqueada: porTipo(WorkStatusType.custom),
    concluida: porTipo(WorkStatusType.closed),
  };
  const tarefas = await prisma.task.findMany({ where: { orgId, tool: 'clickup' } });
  let importadasTarefas = 0;
  for (const t of tarefas) {
    if (!t.externalId) continue;
    await prisma.workTask.upsert({
      where: { orgId_externalId: { orgId, externalId: t.externalId } },
      update: { title: t.title, assignee: t.assignee, dueDate: t.dueDate },
      create: {
        orgId, listId: realocar.id, statusId: mapa[t.status] ?? mapa.aberta,
        title: t.title, description: t.description,
        priority: t.priority === 'alta' ? WorkPriority.alta : WorkPriority.normal,
        assignee: t.assignee, dueDate: t.dueDate,
        externalId: t.externalId, externalUrl: t.externalUrl,
      },
    });
    importadasTarefas++;
  }

  const totais = await prisma.$transaction([
    prisma.workFolder.count({ where: { orgId } }),
    prisma.workList.count({ where: { orgId } }),
    prisma.workStatus.count({ where: { list: { orgId } } }),
    prisma.workField.count({ where: { orgId } }),
    prisma.workFieldOption.count({ where: { field: { orgId } } }),
    prisma.workTask.count({ where: { orgId } }),
  ]);
  console.log(
    `[seed-trabalho] pastas=${totais[0]} listas=${totais[1]} statuses=${totais[2]} ` +
      `campos=${totais[3]} opções=${totais[4]} tarefas=${totais[5]} ` +
      `(temas importados: ${importadosTemas}, tarefas importadas: ${importadasTarefas})`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
