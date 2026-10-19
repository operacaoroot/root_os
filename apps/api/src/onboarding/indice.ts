import type { PrismaClient } from '@prisma/client';

/** A pasta virtual onde as notas da carga vivem dentro do índice. */
export const PASTA_DO_ONBOARDING = 'onboarding';

/** Caminho legado, preservado para compatibilidade; não identifica o novo espelho. */
export function caminhoDaNota(chave: string): string {
  const limpo = chave
    .replace(/^onboarding:/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${PASTA_DO_ONBOARDING}/${limpo || 'nota'}.md`;
}

export interface NotaParaIndice {
  chave: string;
  titulo: string;
  corpo: string;
  tags: readonly string[];
}

/** Sem pessoa e versão escolhida, recusa antes de escrever. O core do caller fica preservado. */
export async function espelharNoIndice(
  _prisma: PrismaClient,
  _orgId: string,
  _nota: NotaParaIndice,
): Promise<{ path: string; criada: boolean }> {
  throw new Error('O espelho exige pessoa e Item/Version reais; a chamada legada não grava no índice.');
}
