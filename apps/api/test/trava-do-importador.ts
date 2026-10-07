import { PrismaClient } from '@prisma/client';

/*
 * A CLI do importador ClickUp → Work pressupõe uma operação por vez, numa janela de
 * manutenção: o apply e a reconciliação rodam em transação serializável, e o rollback e a
 * árvore começam por `LOCK TABLE` nas tabelas Work, global às empresas. As suítes da árvore
 * (ROOT-17) e da reconciliação (ROOT-11 P4) rodam essa CLI de verdade. Em paralelo no mesmo
 * banco, a ordem dos locks de uma cruza com a da outra e o Postgres derruba uma delas por
 * deadlock ou serialização, mesmo com empresas diferentes (medido na integração FUL-36).
 * A trava consultiva faz uma suíte esperar a outra acabar; os casos não mudam.
 */
const TRAVA = 'mktos:testes:cli-do-importador-clickup';

export async function travarSuiteDoImportador(url: string): Promise<() => Promise<void>> {
  const umaConexao = new URL(url);
  umaConexao.searchParams.set('connection_limit', '1');
  const sessao = new PrismaClient({ datasources: { db: { url: umaConexao.toString() } } });
  await sessao.$executeRaw`SELECT pg_advisory_lock(hashtext(${TRAVA}))`;
  // A trava é da conexão: fechar a sessão a solta, também se o processo do teste morrer.
  return () => sessao.$disconnect();
}
