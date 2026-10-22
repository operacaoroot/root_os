/*
 * ============================================================================
 * RESTAURAR TAREFAS ARQUIVADAS NUM INTERVALO (rodada de produção 3, I2, 22/10/2026)
 * ============================================================================
 *
 *   node dist/scripts/restaurar-tarefas.js --org <apelido|id> --lista <id> \
 *        --arquivadas-de 2026-10-21T22:30Z --arquivadas-ate 2026-10-21T23:10Z \
 *        --como <e-mail> [--valer]
 *
 * Padrão: SIMULA (diz quantas e quais ids curtos voltariam). `--valer` desarquiva.
 * Nunca imprime título: só contagens e os 8 primeiros caracteres de cada id.
 *
 * O QUE ELE FAZ, e só isso: as tarefas da lista `--lista` que estão ARQUIVADAS
 * (não as excluídas da Lixeira) e cujo arquivamento caiu no intervalo voltam a
 * ficar vivas (`archived = false`), na mesma lista e etapa, com uma linha de
 * auditoria `work.task.restore` por tarefa, em nome de `--como`. Nada é apagado.
 *
 * DE ONDE VEM "ARQUIVADA EM": a auditoria da tarefa (ver o cabeçalho de
 * `work/lixeira/regras-da-lixeira.ts`): a linha mais nova com `after.archived`
 * verdadeiro, senão a de arquivar do importador, senão a `work.task.update` mais
 * nova, senão `updatedAt`. Os 4 cards da Implantação arquivados pela tela em
 * 21/10/2026 (~22:56Z) têm a `work.task.update` daquela hora.
 *
 * `--como` é relido no banco: usuário ativo desta empresa, de gente (conta de
 * máquina é recusada) e com `tarefas.editar`. IDEMPOTENTE: a segunda `--valer` e
 * o `--simular` depois dela dão zero (as tarefas já não estão arquivadas).
 *
 * Roda COMPILADO, sem o Nest, com a conexão dona (`DATABASE_URL`), como
 * `desativar-ia-acao.ts`. A escrita roda no contexto da empresa.
 */
import { ActorType, PrismaClient } from '@prisma/client';

import { temPapelDeMaquina } from '../approvals/alcada';
import { comContexto } from '../common/contexto-execucao';
import { comTenantNaSessao } from '../prisma/sessao-de-banco';
import { idCurto, quandoForamArquivadas } from '../work/lixeira/regras-da-lixeira';

export interface PedidoDeRestauro {
  org: string;
  listaId: string;
  de: Date;
  ate: Date;
  como: string;
  valer: boolean;
}

export interface ResultadoDoRestauro {
  modo: 'simular' | 'valer';
  /** Arquivadas na lista (vivas e excluídas ficam de fora). */
  arquivadasNaLista: number;
  /** As que caem no intervalo: as que voltam (ou voltariam). */
  noIntervalo: number;
  restauradas: number;
  ids: string[];
  /** A lista continua arquivada: as tarefas voltam, mas só aparecem quando ela for desarquivada. */
  listaArquivada: boolean;
}

function lerData(v: string | undefined, nome: string): Date {
  if (!v) throw new Error(`falta --${nome} <AAAA-MM-DDTHH:MMZ>`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`--${nome} não é uma data: use AAAA-MM-DDTHH:MMZ`);
  return d;
}

export async function restaurarTarefas(prisma: PrismaClient, p: PedidoDeRestauro): Promise<ResultadoDoRestauro> {
  if (p.de.getTime() > p.ate.getTime()) throw new Error('--arquivadas-de vem depois de --arquivadas-ate.');
  const empresa = await prisma.org.findFirst({ where: { OR: [{ id: p.org }, { slug: p.org }] }, select: { id: true } });
  if (!empresa) throw new Error('a empresa de --org não existe neste banco.');
  const orgId = empresa.id;

  return comContexto(
    { orgId, actorType: ActorType.user, actorId: null, correlationId: `terminal-restaurar-tarefas-${orgId}-${Date.now()}`, origem: 'script' },
    async () => {
      const pessoa = await prisma.user.findFirst({
        where: { orgId, isActive: true, OR: [{ email: p.como.toLowerCase() }, { email: p.como }, { id: p.como }] },
        select: { id: true, roles: { where: { orgId }, select: { key: true, permissions: { select: { key: true } } } } },
      });
      if (!pessoa) throw new Error('a pessoa de --como não é um usuário ativo desta empresa.');
      const papeis = pessoa.roles.map((r) => r.key);
      if (temPapelDeMaquina(papeis)) throw new Error('--como é conta de máquina: restaurar é de gente.');
      if (!pessoa.roles.some((r) => r.permissions.some((x) => x.key === 'tarefas.editar'))) {
        throw new Error('a pessoa de --como não tem tarefas.editar.');
      }

      const lista = await prisma.workList.findFirst({ where: { id: p.listaId, orgId }, select: { id: true, arquivadaEm: true, folder: { select: { arquivadaEm: true } } } });
      if (!lista) throw new Error('a lista de --lista não existe nesta empresa.');

      const arquivadas = await prisma.workTask.findMany({
        where: { orgId, listId: lista.id, archived: true, excluidaEm: null },
        select: { id: true, updatedAt: true },
        orderBy: { id: 'asc' },
      });
      const quando = await quandoForamArquivadas(prisma, orgId, arquivadas);
      const alvo = arquivadas.filter((t) => {
        const em = quando.get(t.id)?.em ?? t.updatedAt;
        return em.getTime() >= p.de.getTime() && em.getTime() <= p.ate.getTime();
      });
      const base = {
        arquivadasNaLista: arquivadas.length,
        noIntervalo: alvo.length,
        ids: alvo.map((t) => idCurto(t.id)),
        listaArquivada: !!lista.arquivadaEm || !!lista.folder?.arquivadaEm,
      };
      if (!p.valer || alvo.length === 0) return { modo: p.valer ? 'valer' : 'simular', restauradas: 0, ...base };

      const agora = new Date();
      await prisma.$transaction(async (tx) => {
        for (const t of alvo) {
          const updatedAt = new Date(Math.max(agora.getTime(), t.updatedAt.getTime() + 1));
          const r = await tx.workTask.updateMany({
            where: { id: t.id, orgId, archived: true, excluidaEm: null, updatedAt: t.updatedAt },
            data: { archived: false, updatedAt },
          });
          if (r.count !== 1) throw new Error('uma tarefa mudou durante a restauração; nada foi gravado. Rode de novo para conferir.');
          await tx.auditLog.create({
            data: {
              orgId, actorType: ActorType.user, actorId: pessoa.id,
              action: 'work.task.restore', entityType: 'work_task', entityId: t.id,
              before: { archived: true, arquivadaEm: (quando.get(t.id)?.em ?? t.updatedAt).toISOString() },
              after: { archived: false },
              metadata: {
                origem: 'scripts/restaurar-tarefas',
                intervalo: { de: p.de.toISOString(), ate: p.ate.toISOString() },
                listId: lista.id,
              },
            },
          });
        }
      }, { timeout: 60_000 });
      return { modo: 'valer', restauradas: alvo.length, ...base };
    },
  );
}

function opcao(args: string[], nome: string): string | undefined {
  const i = args.indexOf(`--${nome}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const valer = args.includes('--valer');
  if (valer && args.includes('--simular')) throw new Error('escolha um: --simular (padrão) ou --valer.');
  const org = opcao(args, 'org');
  const listaId = opcao(args, 'lista');
  const como = opcao(args, 'como');
  if (!org) throw new Error('falta --org <apelido|id>: o comando nunca escolhe a empresa sozinho.');
  if (!listaId) throw new Error('falta --lista <id>.');
  if (!como) throw new Error('falta --como <e-mail>: a restauração fica registrada em nome de uma pessoa da casa.');
  const de = lerData(opcao(args, 'arquivadas-de'), 'arquivadas-de');
  const ate = lerData(opcao(args, 'arquivadas-ate'), 'arquivadas-ate');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL vazia. Nunca passe a URL na linha de comando.');

  const base = new PrismaClient();
  const prisma = comTenantNaSessao(base, { modo: 'observar', avisar: () => undefined });
  try {
    const r = await restaurarTarefas(prisma, { org, listaId, de, ate, como, valer });
    // Só contagens e ids curtos. Nada de título.
    console.log(JSON.stringify(r, null, 2));
    if (r.modo === 'simular') {
      console.log(r.noIntervalo ? `${r.noIntervalo} tarefa(s) voltariam. Nada foi escrito; rode com --valer para fazer.` : 'Zero a fazer.');
    } else {
      console.log(r.restauradas ? `${r.restauradas} tarefa(s) restaurada(s) (auditoria work.task.restore). Nada foi apagado.` : 'Zero a fazer: nada mudou.');
    }
    if (r.listaArquivada && r.noIntervalo) console.log('ATENÇÃO: a lista (ou a pasta dela) continua arquivada; as tarefas só aparecem quando ela for desarquivada.');
  } finally {
    await base.$disconnect();
  }
}

// Só quando o arquivo compilado é executado: a suíte importa `restaurarTarefas` sem disparar a linha de comando.
if (/restaurar-tarefas\.js$/.test(process.argv[1] ?? '')) {
  main().catch((e) => {
    console.error('\nfalhou:', (e as Error).message);
    process.exit(1);
  });
}
