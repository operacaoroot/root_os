/*
 * ============================================================================
 * A GUARDA DA VAULT, LIBERADA POR GENTE (R-6 da ROOT-19-REV)
 * ============================================================================
 *
 *   node dist/scripts/liberar-guarda-da-vault.js --como pedro@empresa.com \
 *     --motivo "a pasta 20-empresa foi reorganizada de propósito" --simular
 *   node dist/scripts/liberar-guarda-da-vault.js --como pedro@empresa.com \
 *     --motivo "a pasta 20-empresa foi reorganizada de propósito"
 *   ... --guarda arquivamento   (ou movimentos; sem a opção, as duas)
 *
 * POR QUE ESTE COMANDO EXISTE. A projeção da vault segura duas coisas em massa:
 * arquivar mais que o teto numa volta só (cara de vault montada no lugar
 * errado) e mover mais que o mesmo teto (cara de reorganização que ninguém
 * conferiu). As duas frases mandavam "arquive na tela" — e a tela deixou de
 * arquivar nota da vault (E4 da ROOT-05-REV, na borda HTTP desde a ROOT-20).
 * Sem este comando o que a guarda segura não teria saída humana nenhuma.
 *
 * O QUE ELE FAZ, e só isso: lê o último recibo da vault da casa, mostra o que a
 * guarda segurou e grava no RASTRO a LIBERAÇÃO daquele conjunto exato, com quem
 * liberou e por quê (`memoria.vault.guarda_liberada`). Quem arquiva ou move é a
 * volta seguinte da projeção, conferindo que o conjunto de agora é o mesmo que
 * foi liberado; se a vault mudou de novo, a guarda continua segurando e o novo
 * recibo diz o novo conjunto. A liberação vale por 24 horas e uma vez só.
 *
 * QUEM PODE: um usuário ativo da empresa da casa com `obsidian.editar` — a
 * mesma permissão de reindexar. O autor e o motivo ficam no evento; motivo é
 * obrigatório, e "arquivar 80 notas porque sim" não é motivo.
 *
 * POR QUE ELE NÃO SOBE O NEST. Mesmo motivo de `expurgar-rastro.ts` e de
 * `gerar-documentacao.ts`: subir o `AppModule` acordaria cron, conector e fila
 * só para gravar um evento. Roda COMPILADO (`dist/`) porque é assim que ele
 * existe dentro do container da api.
 *
 * A CONEXÃO É A DONA DAS TABELAS (`DATABASE_URL`), embrulhada por
 * `comTenantNaSessao`: a gravação do evento roda dentro do contexto da casa e
 * leva `app.org_id` da casa, como a de qualquer rota.
 */
import { ActorType, PrismaClient } from '@prisma/client';
import { comContexto } from '../common/contexto-execucao';
import { EventLogService } from '../gateway/event-log.service';
import { MemoriaService, TIPO_DO_RECIBO } from '../memory/memoria.service';
import { comTenantNaSessao } from '../prisma/sessao-de-banco';

/** A empresa da casa — a mesma constante de `obsidian.service.ts`. */
const SLUG_DA_CASA = 'root';

/** Valor de uma opção `--nome valor`, ou `undefined`. */
function opcao(args: string[], nome: string): string | undefined {
  const i = args.indexOf(`--${nome}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

interface GuardaNoRecibo {
  quantidade?: unknown;
  conjunto?: unknown;
}

function conjuntoDe(g: GuardaNoRecibo | undefined): { conjunto: string; quantidade: number } | null {
  if (!g || typeof g.conjunto !== 'string' || !g.conjunto) return null;
  return { conjunto: g.conjunto, quantidade: Number(g.quantidade ?? 0) };
}

export interface PedidoDeLiberacao {
  como: string;
  motivo: string;
  guarda?: 'arquivamento' | 'movimentos';
  simular?: boolean;
}

/**
 * A liberação, sem a borda da linha de comando — é o que a suíte chama com o
 * banco de teste. Devolve o evento gravado (nulo na simulação ou sem nada a
 * liberar) e o que estava segurado.
 */
export async function liberarAGuarda(
  prisma: PrismaClient,
  pedido: PedidoDeLiberacao,
  escrever: (linha: string) => void = (l) => console.log(l),
): Promise<{
  eventoId: string | null;
  arquivamento: { conjunto: string; quantidade: number } | null;
  movimentos: { conjunto: string; quantidade: number } | null;
}> {
  const { como, motivo, guarda: qual, simular } = pedido;
  const casa = await prisma.org.findFirst({ where: { slug: SLUG_DA_CASA }, select: { id: true, slug: true } });
  if (!casa) throw new Error(`a empresa da casa ("${SLUG_DA_CASA}") não existe neste banco`);

  const usuario = await prisma.user.findFirst({
    where: { orgId: casa.id, isActive: true, OR: [{ email: como }, { id: como }] },
    select: { id: true, email: true, roles: { select: { permissions: { select: { key: true } } } } },
  });
  if (!usuario) {
    throw new Error(`não achei usuário ativo "${como}" na empresa da casa. Use o e-mail com que a pessoa entra.`);
  }
  const permissoes = new Set(usuario.roles.flatMap((r) => r.permissions.map((p) => p.key)));
  if (!permissoes.has('obsidian.editar')) {
    throw new Error(`${usuario.email} não tem obsidian.editar, a permissão de reindexar a vault.`);
  }

  const recibo = await prisma.eventLog.findFirst({
    where: { orgId: casa.id, tipo: TIPO_DO_RECIBO },
    orderBy: { seq: 'desc' },
    select: { id: true, ocorreuEm: true, payload: true },
  });
  if (!recibo) throw new Error('a vault da casa ainda não tem recibo: não há o que liberar.');
  const guardas = (
    recibo.payload as { recibo?: { projecao?: { guardas?: Record<string, GuardaNoRecibo> } } } | null
  )?.recibo?.projecao?.guardas;
  const arquivamento = qual === 'movimentos' ? null : conjuntoDe(guardas?.arquivamento);
  const movimentos = qual === 'arquivamento' ? null : conjuntoDe(guardas?.movimentos);

  escrever(`\nÚltimo recibo da vault: ${recibo.id} (${recibo.ocorreuEm.toISOString()})`);
  escrever(`  arquivamentos segurados: ${arquivamento ? arquivamento.quantidade : 0}`);
  escrever(`  movimentos segurados:    ${movimentos ? movimentos.quantidade : 0}`);
  if (!arquivamento && !movimentos) {
    escrever('\nNada segurado pela guarda neste recibo. Nada foi gravado.\n');
    return { eventoId: null, arquivamento, movimentos };
  }
  if (simular) {
    escrever('\nSIMULAÇÃO: nada foi gravado. Sem --simular, a liberação vai ao RASTRO.\n');
    return { eventoId: null, arquivamento, movimentos };
  }

  const memoria = new MemoriaService(prisma as never, new EventLogService(prisma as never));
  const evento = await comContexto(
    {
      orgId: casa.id,
      actorType: ActorType.user,
      actorId: usuario.id,
      correlationId: `terminal-liberar-guarda-${recibo.id}`,
      origem: 'script',
    },
    () => memoria.liberarGuardaDaVault(casa.id, { reciboId: recibo.id, arquivamento, movimentos, motivo }),
  );
  escrever(
    `\nLiberação gravada no RASTRO (evento ${evento.id}, seq ${evento.seq}). A volta seguinte da ` +
      'projeção arquiva e move este conjunto, se a vault ainda estiver como o recibo mostra; o ' +
      'recibo dela diz o que aconteceu.\n',
  );
  return { eventoId: evento.id, arquivamento, movimentos };
}

async function main() {
  const args = process.argv.slice(2);
  const como = opcao(args, 'como');
  const motivo = opcao(args, 'motivo');
  const qual = opcao(args, 'guarda');
  const simular = args.includes('--simular');

  if (!como || !motivo) {
    console.error(
      'uso: liberar-guarda-da-vault.js --como <e-mail> --motivo "<por quê>" ' +
        '[--guarda arquivamento|movimentos] [--simular]',
    );
    process.exitCode = 2;
    return;
  }
  if (qual && qual !== 'arquivamento' && qual !== 'movimentos') {
    throw new Error(`--guarda "${qual}" não existe. Valores: arquivamento | movimentos (sem a opção, as duas).`);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL vazia. O comando precisa da conexão DONA das tabelas. Nunca passe a URL na ' +
        'linha de comando: ela fica no histórico do shell.',
    );
  }

  const base = new PrismaClient({ datasourceUrl: url });
  const prisma = comTenantNaSessao(base, { modo: 'observar', avisar: () => undefined });
  try {
    const r = await liberarAGuarda(prisma, { como, motivo, guarda: qual as PedidoDeLiberacao['guarda'], simular });
    if (!r.arquivamento && !r.movimentos) process.exitCode = 1;
  } finally {
    await base.$disconnect();
  }
}

// Só quando o arquivo compilado é executado: a suíte importa `liberarAGuarda` sem disparar a linha de comando.
if (/liberar-guarda-da-vault\.js$/.test(process.argv[1] ?? '')) {
  main().catch((e) => {
    console.error('\nfalhou:', (e as Error).message);
    process.exit(1);
  });
}
