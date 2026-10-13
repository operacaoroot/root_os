import { createHmac, timingSafeEqual } from 'node:crypto';

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
 *     antiga, sem recorte, ainda é procurada (`chavesDoRelatorio`), mas o dado
 *     dela só vale com o selo (E-13): nota de antes do selo é lida como ausente.
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

/*
 * O SELO (revisão E-13). A nota é editável em /memoria por quem tem escrita na
 * memória, e o procedimento de origem (`sourceType`) também: quem edita escolhe
 * o que declara. Sem o selo, editar o bloco json mudaria as premissas e os
 * números que a torre e a tela 13 mostram como medidos, e um `dia` de hoje na
 * nota calaria a passagem das 08:00. O selo é um HMAC do dado com a chave do
 * servidor (`ENCRYPTION_KEY`); o dado editado à mão não confere e é lido como
 * ausente: a tela mostra os números ao vivo e o vigia passa de novo. Sem a
 * chave no ambiente (suíte, máquina de desenvolvimento) o selo usa uma chave
 * fixa: protege contra o engano, não contra quem lê este arquivo.
 */
const DOMINIO_DO_SELO = 'comercial.nota.v1:';

function chaveDoSelo(): string {
  const k = process.env.ENCRYPTION_KEY?.trim();
  return k && k.length >= 16 ? k : 'comercial-nota-sem-chave-no-ambiente';
}

function selo(dadoSemSelo: string): string {
  return createHmac('sha256', chaveDoSelo()).update(DOMINIO_DO_SELO).update(dadoSemSelo).digest('hex');
}

export function corpoComDado(markdown: string, dado: Record<string, unknown> | object): string {
  const json = JSON.stringify(dado);
  const comSelo = `${json.slice(0, -1)}${json.length > 2 ? ',' : ''}"_selo":"${selo(json)}"}`;
  return `${markdown.trimEnd()}\n\n\`\`\`json\n${comSelo}\n\`\`\`\n`;
}

/** O dado estruturado do corpo de uma nota do comercial; `null` se não houver, não ler ou o selo não conferir. */
export function dadoDaNota<T>(body: string | null | undefined): T | null {
  const m = BLOCO_JSON.exec(String(body ?? ''));
  if (!m) return null;
  try {
    const bruto = JSON.parse(m[1]) as unknown;
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null;
    const { _selo, ...dado } = bruto as Record<string, unknown>;
    if (typeof _selo !== 'string') return null;
    const esperado = Buffer.from(selo(JSON.stringify(dado)), 'hex');
    const recebido = Buffer.from(_selo, 'hex');
    if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) return null;
    return dado as T;
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
