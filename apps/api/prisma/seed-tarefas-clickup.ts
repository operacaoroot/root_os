// Carga das TAREFAS do ClickUp para Dia a dia › Tarefas (19/10/2026).
//
// Só tarefa entra: leads, contratos e posts do ClickUp ficaram de fora do
// arquivo (são cadastro e já moram no Comercial e no Marketing). Cada tarefa
// cai na lista da sua ÁREA ("Tarefas › <área>", a mesma que a tela usa), com
// pessoa, prazo e cliente (o card do CRM, quando existe).
//
// IDEMPOTENTE e SEM DUPLICAR: a chave é o id do ClickUp (`externalId`, único
// por empresa). Rodar de novo atualiza a tarefa que já existe; nunca cria a
// segunda. Status já mexido no OS não volta para trás (só é escrito ao criar).
//   pnpm --filter @mktos/api db:seed:tarefas [arquivo.json]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient, WorkListaNatureza, WorkStatusType } from '@prisma/client';
import { AREAS_PADRAO, DOMINIO_DAS_CONTAS_DO_SISTEMA, equipeDasContas } from '@mktos/shared';

const prisma = new PrismaClient();

interface Arquivo {
  tarefas: {
    id: string;
    titulo: string;
    area: string;
    responsaveis: string[];
    prazo: string | null;
    status: 'aberta' | 'fazendo';
    cliente: { chave: string } | { nome: string } | null;
    origem: string;
    url: string | null;
    nota: string | null;
    passos?: { titulo: string; fase: string }[];
  }[];
}

const STATUS = [
  { name: 'A fazer', type: WorkStatusType.open, color: '#87909e' },
  { name: 'Fazendo', type: WorkStatusType.custom, color: '#f9a400' },
  { name: 'Feito', type: WorkStatusType.closed, color: '#30a46c' },
];
const instante = (dia: string) => new Date(`${dia}T03:00:00.000Z`);

async function main() {
  const caminho = process.argv[2] ?? join(__dirname, 'data', 'tarefas-clickup-2026-10-19.json');
  const arquivo = JSON.parse(readFileSync(caminho, 'utf8')) as Arquivo;
  const org = await prisma.org.findUnique({ where: { slug: 'root' } });
  if (!org) throw new Error('Empresa "root" não encontrada.');
  const orgId = org.id;

  // Áreas (as padrão, se a empresa ainda não tem nenhuma; as que existem ficam).
  if ((await prisma.workArea.count({ where: { orgId } })) === 0) {
    await prisma.workArea.createMany({ data: AREAS_PADRAO.map((a, i) => ({ orgId, nome: a.nome, cor: a.cor, ordem: i })), skipDuplicates: true });
  }
  const areas = new Map((await prisma.workArea.findMany({ where: { orgId } })).map((a) => [a.nome, a]));

  const espaco = await prisma.workSpace.upsert({
    where: { orgId_name: { orgId, name: 'Tarefas' } }, update: {}, create: { orgId, name: 'Tarefas', order: 0 },
  });
  const listas = new Map<string, { id: string; aberta: string; fazendo: string }>();
  async function listaDa(nomeDaArea: string) {
    const ja = listas.get(nomeDaArea);
    if (ja) return ja;
    const area = areas.get(nomeDaArea);
    if (!area) throw new Error(`Área "${nomeDaArea}" não existe na empresa.`);
    let lista = await prisma.workList.findFirst({
      where: { orgId, areaPadraoId: area.id, natureza: WorkListaNatureza.tarefas },
      include: { statuses: { orderBy: { order: 'asc' } } }, orderBy: { createdAt: 'asc' },
    });
    if (!lista) {
      lista = await prisma.workList.create({
        data: {
          orgId, spaceId: espaco.id, name: area.nome, natureza: WorkListaNatureza.tarefas, areaPadraoId: area.id,
          statuses: { create: STATUS.map((s, i) => ({ name: s.name, type: s.type, color: s.color, order: i })) },
        },
        include: { statuses: { orderBy: { order: 'asc' } } },
      });
    }
    const aberta = lista.statuses.find((s) => s.type === WorkStatusType.open) ?? lista.statuses[0];
    const fazendo = lista.statuses.find((s) => s.type === WorkStatusType.custom) ?? aberta;
    const r = { id: lista.id, aberta: aberta.id, fazendo: fazendo.id };
    listas.set(nomeDaArea, r);
    return r;
  }

  // Pessoas pelo nome, na mesma régua da tela (uma pessoa por nome, na conta que
  // entrou por último; sem a conta da empresa). Sem conta: fica como texto.
  const contas = await prisma.user.findMany({
    where: { orgId, isActive: true, NOT: { email: { endsWith: DOMINIO_DAS_CONTAS_DO_SISTEMA } } },
    select: { id: true, name: true, lastLoginAt: true },
  });
  const { pessoas } = equipeDasContas(
    contas.map((c) => ({ id: c.id, nome: c.name, ultimoAcesso: c.lastLoginAt?.toISOString() ?? null })),
    { nome: org.name, slug: org.slug },
  );
  const usuarios = pessoas.map((p) => ({ id: p.id, name: p.nome }));
  const pessoa = (nome?: string) => {
    if (!nome) return null;
    const n = nome.toLowerCase();
    return usuarios.find((u) => u.name.toLowerCase() === n) ?? usuarios.find((u) => u.name.toLowerCase().split(' ')[0] === n.split(' ')[0]) ?? null;
  };

  let criadas = 0, atualizadas = 0;
  for (const t of arquivo.tarefas) {
    const lista = await listaDa(t.area);
    const area = areas.get(t.area)!;
    const dono = pessoa(t.responsaveis[0]);
    const cliente = t.cliente && 'chave' in t.cliente
      ? await prisma.workTask.findFirst({ where: { orgId, externalId: t.cliente.chave }, select: { id: true } })
      : null;
    const comum = {
      title: t.titulo,
      areaId: area.id,
      clienteId: cliente?.id ?? null,
      assigneeUserId: dono?.id ?? null,
      assignee: dono ? null : t.responsaveis.join(', ') || null,
      dueDate: t.prazo ? instante(t.prazo) : null,
      externalUrl: t.url,
      description: [t.origem, t.nota].filter(Boolean).join('\n') || null,
    };
    const ja = await prisma.workTask.findFirst({ where: { orgId, externalId: t.id }, select: { id: true } });
    const tarefa = ja
      ? await prisma.workTask.update({ where: { id: ja.id }, data: comum })
      : await prisma.workTask.create({
        data: { ...comum, orgId, listId: lista.id, statusId: t.status === 'fazendo' ? lista.fazendo : lista.aberta, externalId: t.id },
      });
    if (ja) atualizadas++; else criadas++;

    // Passos (implantação): subtarefas da tarefa, cada uma com a sua chave.
    for (const [i, p] of (t.passos ?? []).entries()) {
      const chave = `${t.id}-passo-${String(i + 1).padStart(2, '0')}`;
      const existe = await prisma.workTask.findFirst({ where: { orgId, externalId: chave }, select: { id: true } });
      if (existe) {
        await prisma.workTask.update({ where: { id: existe.id }, data: { title: p.titulo, description: p.fase, areaId: area.id } });
      } else {
        await prisma.workTask.create({
          data: { orgId, listId: lista.id, statusId: lista.aberta, title: p.titulo, description: p.fase, parentId: tarefa.id, areaId: area.id, externalId: chave, order: i },
        });
      }
    }
  }
  console.log(`Tarefas do ClickUp: ${criadas} criadas, ${atualizadas} atualizadas (de ${arquivo.tarefas.length}).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
