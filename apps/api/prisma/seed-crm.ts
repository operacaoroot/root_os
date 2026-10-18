// Seed CRM — cria a lista "Gestão de Leads" no Trabalho nativo (etapas do funil,
// canal, vendedor, valor da proposta) e carrega os negócios do arquivo, que é de
// onde o painel do comercial (/comercial) lê. Idempotente: a chave de cada
// cartão é o `id` do arquivo (`externalId`), então rodar de novo atualiza em
// vez de duplicar. Não apaga nada que já esteja na lista.
//   pnpm --filter @mktos/api db:seed:crm [arquivo.json]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient, WorkFieldType, WorkStatusType } from '@prisma/client';

const prisma = new PrismaClient();

interface Snapshot {
  espaco: { id: string; nome: string };
  pastas: { id: string; nome: string; pai?: string }[];
  lista: { id: string; nome: string; pasta: string };
  etapas: { nome: string; tipo: 'open' | 'custom' | 'closed'; cor: string }[];
  campos: { nome: string; tipo: 'drop_down' | 'moeda' | 'data'; opcoes: [string, string][] }[];
  leads: {
    id: string;
    titulo: string;
    etapa: string;
    responsavel?: string;
    criadoEm: number | string;
    nota?: string;
    etapaDesde?: number | string;
    prazo?: number;
    campos: Record<string, string | number>;
  }[];
}

const dia = (ms: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(ms));

async function main() {
  const arquivo = process.argv[2] ?? join(__dirname, 'data', 'crm-fechados-financeiro-2026-10-18.json');
  const s: Snapshot = JSON.parse(readFileSync(arquivo, 'utf8'));
  const org = await prisma.org.findUnique({ where: { slug: 'root' } });
  if (!org) throw new Error('org root não encontrada; rode o seed base antes');
  const orgId = org.id;

  const espaco =
    (await prisma.workSpace.findFirst({ where: { orgId, OR: [{ externalId: s.espaco.id }, { name: s.espaco.nome }] } })) ??
    (await prisma.workSpace.create({ data: { orgId, name: s.espaco.nome, externalId: s.espaco.id } }));

  // Só a pasta da lista, no topo do espaço: o painel não depende da árvore toda.
  const p = s.pastas.find((x) => x.id === s.lista.pasta)!;
  const pasta =
    (await prisma.workFolder.findFirst({ where: { orgId, externalId: p.id } })) ??
    (await prisma.workFolder.findFirst({ where: { orgId, spaceId: espaco.id, parentId: null, name: p.nome } })) ??
    (await prisma.workFolder.create({ data: { orgId, spaceId: espaco.id, name: p.nome, externalId: p.id } }));

  const lista =
    (await prisma.workList.findFirst({ where: { orgId, externalId: s.lista.id } })) ??
    (await prisma.workList.create({ data: { orgId, folderId: pasta.id, name: s.lista.nome, externalId: s.lista.id } }));

  const etapas = new Map<string, string>();
  for (const [i, e] of s.etapas.entries()) {
    const st = await prisma.workStatus.upsert({
      where: { listId_name: { listId: lista.id, name: e.nome } },
      update: { type: e.tipo as WorkStatusType, color: e.cor, order: i },
      create: { listId: lista.id, name: e.nome, type: e.tipo as WorkStatusType, color: e.cor, order: i },
    });
    etapas.set(e.nome, st.id);
  }

  const campos = new Map<string, { id: string; tipo: string; opcoes: Map<string, string> }>();
  for (const [i, c] of s.campos.entries()) {
    const f =
      (await prisma.workField.findFirst({ where: { orgId, listId: lista.id, name: c.nome } })) ??
      (await prisma.workField.create({ data: { orgId, listId: lista.id, name: c.nome, type: c.tipo as WorkFieldType, order: i } }));
    const opcoes = new Map<string, string>();
    for (const [j, [nome, cor]] of c.opcoes.entries()) {
      const o = await prisma.workFieldOption.upsert({
        where: { fieldId_name: { fieldId: f.id, name: nome } },
        update: { color: cor, order: j },
        create: { fieldId: f.id, name: nome, color: cor, order: j },
      });
      opcoes.set(nome, o.id);
    }
    campos.set(c.nome, { id: f.id, tipo: c.tipo, opcoes });
  }

  for (const [i, l] of s.leads.entries()) {
    const statusId = etapas.get(l.etapa);
    if (!statusId) throw new Error(`${l.titulo}: etapa ${l.etapa} não existe na lista`);
    // O gatilho só carimba statusDesde quando ele vem nulo; aqui vai a data real da etapa, se houver.
    const statusDesde = l.etapaDesde != null ? new Date(l.etapaDesde) : null;
    const dados = {
      listId: lista.id,
      statusId,
      title: l.titulo,
      description: l.nota ?? null,
      assignee: l.responsavel ?? null,
      dueDate: l.prazo ? new Date(l.prazo) : null,
      // Só o que veio do ClickUp (id numérico/alfanumérico curto) ganha link de volta.
      externalUrl: /^[0-9a-z]{9,11}$/.test(l.id) ? `https://app.clickup.com/t/${l.id}` : null,
      order: i,
    };
    const existente = await prisma.workTask.findFirst({ where: { orgId, externalId: l.id } });
    const t = existente
      ? await prisma.workTask.update({ where: { id: existente.id }, data: { ...dados, ...(statusDesde ? { statusDesde } : {}) } })
      : await prisma.workTask.create({
          data: { orgId, externalId: l.id, createdAt: new Date(l.criadoEm), ...dados, ...(statusDesde ? { statusDesde } : {}) },
        });
    if (existente && statusDesde && existente.statusId !== statusId) {
      // Troca de etapa no update: o gatilho carimbou agora; volta para a data da origem.
      await prisma.workTask.update({ where: { id: t.id }, data: { statusDesde } });
    }

    for (const [nome, bruto] of Object.entries(l.campos)) {
      const c = campos.get(nome);
      if (!c) throw new Error(`${l.titulo}: campo ${nome} não existe na lista`);
      let valor: { optionId: string | null; value: string | null };
      if (c.tipo === 'drop_down') {
        const optionId = c.opcoes.get(String(bruto));
        if (!optionId) throw new Error(`${l.titulo}: opção ${bruto} não existe em ${nome}`);
        valor = { optionId, value: null };
      } else if (c.tipo === 'moeda') {
        valor = { optionId: null, value: `BRL ${Number(bruto).toFixed(2)}` };
      } else {
        valor = { optionId: null, value: typeof bruto === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(bruto) ? bruto : dia(Number(bruto)) };
      }
      await prisma.workFieldValue.upsert({
        where: { taskId_fieldId: { taskId: t.id, fieldId: c.id } },
        update: valor,
        create: { taskId: t.id, fieldId: c.id, ...valor },
      });
    }
  }

  const total = await prisma.workTask.count({ where: { orgId, listId: lista.id } });
  console.log(`CRM: lista "${lista.name}" com ${total} cartão(ões); ${s.leads.length} vieram do arquivo.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
