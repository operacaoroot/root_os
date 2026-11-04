/**
 * ============================================================================
 * A TAREFA DO CANAL (etapa 9b, #16, pedido do Lucas em 04/11/2026)
 * ============================================================================
 *
 *   node dist/scripts/tarefa-do-canal.js --org <apelido|id> --pessoa <userId> [--ensaio]
 *   node dist/scripts/tarefa-do-canal.js --org <apelido|id> --pessoa <userId> --aplicar
 *
 * Os leads antigos chegaram sem o canal de aquisição ("Por canal" do Painel fica em "Sem
 * informação"). Daqui para frente o canal é pedido no E1 e de novo na qualificação; para os
 * antigos, nasce UMA tarefa no Comercial › Tarefas, para a pessoa de `--pessoa`, com a lista dos
 * leads sem canal na descrição. Não mexe em lead nenhum. Se a tarefa aberta já existe (mesmo
 * título), não cria outra. O que nasce vai ao diário `_diario_etapa9b_20261104`.
 */
import { PrismaClient, WorkStatusType } from '@prisma/client';

import { acharOuCriarListaDoComercial } from '../work/lista-do-comercial';

const TITULO = 'Preencher o canal de aquisição dos leads antigos';

function opcao(args: string[], nome: string): string | undefined {
  const i = args.indexOf(`--${nome}`);
  const v = i >= 0 ? args[i + 1] : undefined;
  return v && !v.startsWith('--') ? v : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const aplicar = args.includes('--aplicar');
  const org = opcao(args, 'org');
  const pessoaId = opcao(args, 'pessoa');
  if (!org || !pessoaId) throw new Error('use --org <apelido|id> --pessoa <userId>.');
  const prisma = new PrismaClient();
  try {
    const empresa = await prisma.org.findFirst({ where: { OR: [{ id: org }, { slug: org }] }, select: { id: true } });
    if (!empresa) throw new Error('a empresa de --org não existe neste banco.');
    const orgId = empresa.id;
    const pessoa = await prisma.user.findFirst({ where: { id: pessoaId, orgId, isActive: true }, select: { id: true, name: true } });
    if (!pessoa) throw new Error('--pessoa não é gente ativa desta empresa.');

    const leads = await prisma.lead.findMany({
      where: { orgId, OR: [{ ficha: { is: null } }, { ficha: { is: { canal: null } } }, { ficha: { is: { canal: '' } } }] },
      orderBy: { enteredAt: 'asc' },
      select: { id: true, name: true, enteredAt: true, ficha: { select: { empresa: true, etapa: true } } },
    });
    const total = await prisma.lead.count({ where: { orgId } });
    const linhas = leads.map((l) => `- ${l.ficha?.empresa || l.name} (entrou em ${l.enteredAt.toISOString().slice(0, 10)}, ${l.ficha?.etapa ?? 'sem ficha'}): /comercial/funil?lead=${l.id}&aba=geral`);
    const descricao = [
      `${leads.length} de ${total} leads estão sem o canal de aquisição (como conheceu: BNI, indicação, Instagram, site…).`,
      'Abra cada um e preencha "Como conheceu" na aba Geral do painel do lead. Os novos já pedem o canal no E1 e na qualificação.',
      '',
      ...linhas,
    ].join('\n');

    const lista = await acharOuCriarListaDoComercial(prisma as never, orgId);
    const aberto = lista.statuses.find((s) => s.type === WorkStatusType.open) ?? lista.statuses.find((s) => s.type !== WorkStatusType.closed);
    const ja = await prisma.workTask.findFirst({ where: { orgId, listId: lista.id, title: TITULO, excluidaEm: null, status: { type: { not: WorkStatusType.closed } } }, select: { id: true } });
    console.log(JSON.stringify({ modo: aplicar ? 'aplicar' : 'ensaio', semCanal: leads.length, total, pessoa: pessoa.name, jaExiste: !!ja }));
    if (!aplicar || ja || !leads.length || !aberto) {
      if (!aplicar) console.log('Nada foi escrito. Depois de conferir, rode com --aplicar.');
      return;
    }
    const prazo = new Date(Date.now() + 7 * 86_400_000);
    const criada = await prisma.$transaction(async (tx) => {
      const t = await tx.workTask.create({
        data: { orgId, listId: lista.id, statusId: aberto.id, title: TITULO, description: descricao, assigneeUserId: pessoa.id, areaId: lista.areaId, dueDate: prazo },
        select: { id: true },
      });
      await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "_diario_etapa9b_20261104" (seq serial PRIMARY KEY, tabela text, linha text, coluna text, antes text, depois text, em timestamptz DEFAULT now())`);
      await tx.$executeRawUnsafe(`INSERT INTO "_diario_etapa9b_20261104" (tabela, linha, coluna, antes, depois) VALUES ('WorkTask', $1, '*', NULL, 'criado')`, t.id);
      return t;
    });
    console.log(`tarefa criada: ${criada.id.slice(0, 8)} (${leads.length} leads na descrição)`);
  } finally {
    await prisma.$disconnect();
  }
}

if (/tarefa-do-canal\.js$/.test(process.argv[1] ?? '')) {
  main().catch((e) => {
    console.error('\nfalhou:', (e as Error).message);
    process.exit(1);
  });
}
