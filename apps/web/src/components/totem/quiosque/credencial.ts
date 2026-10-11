import { TotemTokenSchema } from '@mktos/shared';
import { z } from 'zod';

import type { Armazem } from './armazem';

/*
 * O REGISTRO DO APARELHO ATIVADO: o token e os nomes que a tela de manutenção
 * mostra. Fica em dois lugares, localStorage e IndexedDB, porque a limpeza de
 * dados de um navegador de quiosque às vezes leva um e deixa o outro; quem
 * sobrar restaura o par na próxima abertura.
 */

const CHAVE = 'totem.aparelho';

const AparelhoSchema = z.object({
  token: TotemTokenSchema,
  dispositivo: z.object({ id: z.string().min(1), nome: z.string() }),
  loja: z.object({ id: z.string().min(1), nome: z.string() }),
  ativadoEm: z.string(),
});
export type AparelhoAtivado = z.infer<typeof AparelhoSchema>;

function lerLocal(): unknown {
  try {
    const bruto = globalThis.localStorage?.getItem(CHAVE);
    return bruto ? JSON.parse(bruto) : null;
  } catch {
    return null;
  }
}

function gravarLocal(a: AparelhoAtivado | null): void {
  try {
    if (a) globalThis.localStorage?.setItem(CHAVE, JSON.stringify(a));
    else globalThis.localStorage?.removeItem(CHAVE);
  } catch {
    /* armazenamento bloqueado: o IndexedDB (ou a memória) segura */
  }
}

export async function lerAparelho(armazem: Armazem): Promise<AparelhoAtivado | null> {
  const local = AparelhoSchema.safeParse(lerLocal());
  if (local.success) {
    await armazem.gravar(CHAVE, local.data).catch(() => undefined);
    return local.data;
  }
  const guardado = AparelhoSchema.safeParse(await armazem.ler(CHAVE).catch(() => null));
  if (!guardado.success) return null;
  gravarLocal(guardado.data);
  return guardado.data;
}

export async function gravarAparelho(armazem: Armazem, a: AparelhoAtivado): Promise<void> {
  gravarLocal(a);
  await armazem.gravar(CHAVE, a).catch(() => undefined);
}

export async function esquecerAparelho(armazem: Armazem): Promise<void> {
  gravarLocal(null);
  await armazem.apagar(CHAVE).catch(() => undefined);
}
