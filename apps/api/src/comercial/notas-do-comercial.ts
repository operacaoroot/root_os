import { ContextKind, ContextSource } from '@prisma/client';

import type { MemoriaService } from '../memory/memoria.service';

/*
 * AS NOTAS DO COMERCIAL NA MEMÓRIA (lane E, fase 2, 13/10/2026).
 *
 * O vigia das 08:00 e o relator da quinta guardam o que produziram como nota da
 * memória, pelo caminho da ADR-011 (`MemoriaService`: evento no RASTRO, versão,
 * histórico), como o relatório do mês da pauta (MK6). Sem tabela nova:
 *
 *   · `comercial.vigia` — UMA nota; cada passagem é uma versão nova. O histórico
 *     da nota é o histórico do vigia;
 *   · `comercial.relatorio.semana.AAAA-MM-DD.<N>d` — uma nota por dia de geração
 *     E por recorte (revisão E-11): o de 30 dias gerado à tarde não ocupa o
 *     lugar do de 7 da quinta, e gerar um recorte não versiona o outro. A chave
 *     antiga, sem recorte, ainda é lida (`chavesDoRelatorio`).
 *
 * O corpo é markdown para gente ler, com o dado estruturado num bloco
 * ```json no fim, que a torre e a tela 13 relêem (`dadoDaNota`).
 */

export const CHAVE_DO_VIGIA = 'comercial.vigia';
export const PREFIXO_DO_RELATORIO = 'comercial.relatorio.semana.';

/** A chave do relatório de um dia com um recorte (E-11). */
export function chaveDoRelatorio(dia: string, dias: number): string {
  return `${PREFIXO_DO_RELATORIO}${dia}.${dias}d`;
}

/** As chaves a procurar para um dia e um recorte: a nova, e a antiga sem recorte (o dado confere o recorte). */
export function chavesDoRelatorio(dia: string, dias: number): string[] {
  return [chaveDoRelatorio(dia, dias), `${PREFIXO_DO_RELATORIO}${dia}`];
}

const BLOCO_JSON = /```json\n([\s\S]*?)\n```\s*$/;

export function corpoComDado(markdown: string, dado: unknown): string {
  return `${markdown.trimEnd()}\n\n\`\`\`json\n${JSON.stringify(dado)}\n\`\`\`\n`;
}

/** O dado estruturado do corpo de uma nota do comercial; `null` se não houver ou não ler. */
export function dadoDaNota<T>(body: string | null | undefined): T | null {
  const m = BLOCO_JSON.exec(String(body ?? ''));
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as T;
  } catch {
    return null;
  }
}

/** Cria ou versiona a nota (e a restaura se estava arquivada). */
export async function gravarNota(
  memoria: MemoriaService,
  orgId: string,
  chave: string,
  dados: { title: string; body: string; motivo: string; tags: string[]; sourceRef: string },
): Promise<{ id: string; versao: number }> {
  const entrada = {
    kind: ContextKind.definicao,
    title: dados.title,
    body: dados.body,
    sourceType: ContextSource.promocao,
    sourceRef: dados.sourceRef,
    motivo: dados.motivo,
  };
  const existente = await memoria.porChave(orgId, chave);
  if (!existente) {
    const n = await memoria.criar(orgId, { chave, tags: dados.tags, ...entrada });
    return { id: n.id, versao: n.versao };
  }
  let nota = await memoria.alterar(orgId, existente.id, entrada);
  if (nota.arquivadoEm) nota = await memoria.restaurar(orgId, nota.id, 'a nota do comercial voltou a valer');
  return { id: nota.id, versao: nota.versao };
}
