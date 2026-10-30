/*
 * A BUSCA DO CLIENTE NO PAINEL DE MARCAR (agenda v2, 29/10/2026, lane G3) — a parte pura.
 *
 * Quem marca escreve duas letras e vê o lead do Funil ou o cliente, com a etapa,
 * o contato e quantas vezes o nome já esteve na agenda. A comparação é sem
 * acento e sem caixa (`normalizarParaAgenda`, a mesma da gramática), porque
 * "ficticia pecas" tem de achar "Fictícia Peças". A ordem: começa pelo que foi
 * digitado, depois uma palavra que começa por ele, depois o que só contém; no
 * empate, cliente antes de lead e depois o nome.
 */
import { normalizarParaAgenda } from '@mktos/shared';

/** Mínimo de letras para buscar (menos que isso seria a lista inteira). */
export const BUSCA_MINIMO = 2;
/** Quantos resultados no máximo. */
export const BUSCA_MAXIMO = 8;

export interface CandidatoDaBusca {
  id: string;
  tipo: 'lead' | 'cliente';
  /** O nome que a agenda escreve no título. */
  nome: string;
  /** Outros textos que também casam (o nome da pessoa do lead, a razão social). */
  outros: string[];
}

/** Quão bem `q` casa com o candidato: 0 começa, 1 uma palavra começa, 2 contém; nulo não casa. */
export function notaDaBusca(q: string, c: CandidatoDaBusca): number | null {
  const alvo = normalizarParaAgenda(q);
  if (!alvo) return null;
  let melhor: number | null = null;
  for (const texto of [c.nome, ...c.outros]) {
    const n = normalizarParaAgenda(texto);
    if (!n) continue;
    const nota = n.startsWith(alvo) ? 0 : n.split(/[\s/&.,()-]+/).some((p) => p.startsWith(alvo)) ? 1 : n.includes(alvo) ? 2 : null;
    if (nota !== null && (melhor === null || nota < melhor)) melhor = nota;
  }
  return melhor;
}

/** Os candidatos que casam, na ordem da tela, até `limite`. */
export function ordenarBusca<T extends CandidatoDaBusca>(q: string, candidatos: readonly T[], limite = BUSCA_MAXIMO): T[] {
  return candidatos
    .map((c) => ({ c, nota: notaDaBusca(q, c) }))
    .filter((x): x is { c: T; nota: number } => x.nota !== null)
    .sort(
      (a, b) =>
        a.nota - b.nota ||
        (a.c.tipo === b.c.tipo ? 0 : a.c.tipo === 'cliente' ? -1 : 1) ||
        a.c.nome.localeCompare(b.c.nome, 'pt-BR'),
    )
    .slice(0, limite)
    .map((x) => x.c);
}

/** A chave de comparação de um nome de cliente com o `leituraCliente` do espelho. */
export const chaveDoNome = (nome: string | null | undefined): string => normalizarParaAgenda(nome);
