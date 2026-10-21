import { NOTA_DA_RAIZ_DOS_CLIENTES, idDaPastaDoDrive } from '@mktos/shared';

import type { MemoriaService } from '../../memory/memoria.service';

/*
 * A RAIZ DAS PASTAS DOS CLIENTES (rodada dos agentes, 21/10/2026, TR-04).
 *
 * A nota da memória `clientes.pasta.raiz`, primeira linha = o id da pasta (ou o
 * link do Drive, que vira id). Só LIDA aqui: quem escreve a nota é gente, pela
 * memória (caminho da ADR-011). Lida sem leitor (`null`): é configuração da
 * empresa, e quem dispara o efeito (o aprovador, uma rotina) não precisa de
 * `obsidian.ver` para a pasta do cliente nascer.
 */

export const FRASE_SEM_RAIZ =
  'A empresa ainda não configurou a pasta raiz dos clientes: crie a nota da memória "clientes.pasta.raiz" com o id da pasta do Drive na primeira linha.';
export const FRASE_SEM_GOOGLE = 'A empresa não tem o Google conectado: conecte em Conexões para a pasta do cliente nascer no Drive.';

/** O id da raiz, ou `null` quando a nota falta, está arquivada ou não traz um id do Drive. */
export async function idDaRaizDosClientes(memoria: Pick<MemoriaService, 'porChave'>, orgId: string): Promise<string | null> {
  const nota = await memoria.porChave(orgId, NOTA_DA_RAIZ_DOS_CLIENTES, null);
  if (!nota || nota.arquivadoEm) return null;
  const primeira = String(nota.body ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  return idDaPastaDoDrive(primeira ?? null);
}
