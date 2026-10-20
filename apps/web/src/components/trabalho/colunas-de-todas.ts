import type { TrabListaDto, TrabStatusDto } from '@mktos/shared';

/*
 * AS COLUNAS DE "TODAS" (ajuste do Todas, 20/10/2026, pedido do Rodrigo: "ver todas as
 * tarefas e todos os possíveis status das pastas; a visão tem que ser completa").
 *
 * O quadro de "Todas" mostra a UNIÃO dos status reais das listas do recorte (todas as
 * listas da empresa, ou só as do segmento), uma coluna por nome normalizado (sem acento,
 * sem caixa, sem espaço duplo), inclusive as vazias. Ordem: pelo tipo (abertos, em
 * andamento, concluídos) e, dentro do tipo, pela ordem da primeira lista em que o status
 * aparece; a cor e o tipo são os do primeiro status com aquele nome. Antes eram três
 * colunas virtuais por tipo, que escondiam os status de verdade.
 */

/** O id virtual da coluna de "Todas": `nome:<nome normalizado>`. */
export const PREFIXO_DA_COLUNA = 'nome:';

/** Sem acento, sem caixa, sem espaço duplo: "Kickoff  Marcado" e "kickoff marcado" são a mesma coluna. */
export function nomeNormalizado(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function idDaColuna(nomeDoStatus: string): string {
  return `${PREFIXO_DA_COLUNA}${nomeNormalizado(nomeDoStatus)}`;
}

const ORDEM_DO_TIPO: Record<string, number> = { open: 0, custom: 1, closed: 2 };
const posicaoDoTipo = (tipo: string) => ORDEM_DO_TIPO[tipo] ?? 1;

/** Uma coluna de "Todas": um status da lista virtual mais em quantas listas ele existe. */
export interface ColunaDeTodas extends TrabStatusDto { listas: number }

/** O que o quadro sabe de cada tarefa para não deixar nenhuma sem coluna. */
interface StatusDaTarefa { statusName: string; statusType: string; statusColor?: string | null }

/**
 * A união dos status das `listas`, na ordem da tela. As `tarefas` só entram como rede de
 * segurança: uma tarefa cujo status não veio na estrutura ganha a coluna dela (sem contar
 * lista), para a soma das colunas ser sempre o total.
 */
export function colunasDeTodas(listas: TrabListaDto[], tarefas: StatusDaTarefa[] = []): ColunaDeTodas[] {
  const porId = new Map<string, ColunaDeTodas & { seq: number }>();
  let seq = 0;
  for (const l of listas) {
    const vistos = new Set<string>();
    for (const s of [...l.statuses].sort((a, b) => a.order - b.order)) {
      const id = idDaColuna(s.name);
      const ja = porId.get(id);
      if (ja) { if (!vistos.has(id)) ja.listas += 1; }
      else porId.set(id, { id, name: s.name.trim(), type: s.type, color: s.color, order: 0, total: 0, limite: null, listas: 1, seq: seq++ });
      vistos.add(id);
    }
  }
  for (const t of tarefas) {
    const id = idDaColuna(t.statusName);
    if (!porId.has(id)) porId.set(id, { id, name: t.statusName.trim(), type: t.statusType as TrabStatusDto['type'], color: t.statusColor ?? '#87909e', order: 0, total: 0, limite: null, listas: 0, seq: seq++ });
  }
  return [...porId.values()]
    .sort((a, b) => posicaoDoTipo(a.type) - posicaoDoTipo(b.type) || a.seq - b.seq)
    .map(({ seq: _seq, ...c }, i) => ({ ...c, order: i }));
}

/** Para onde vai a tarefa solta numa coluna de "Todas", dentro da lista DELA. */
export type DestinoNaLista =
  | { statusId: string; nome: string; exato: true }
  | { statusId: string; nome: string; exato: false }
  | null;

/**
 * Soltar numa coluna: o status da lista com o mesmo nome; sem ele, o primeiro do mesmo
 * tipo da coluna (a tela avisa); sem os dois, nada (a tela diz o motivo). Nunca devolve
 * um status que não seja da lista da tarefa.
 */
export function destinoNaLista(lista: TrabListaDto | undefined, coluna: Pick<TrabStatusDto, 'id' | 'type'>): DestinoNaLista {
  if (!lista) return null;
  const ordenados = [...lista.statuses].sort((a, b) => a.order - b.order);
  const igual = ordenados.find((s) => idDaColuna(s.name) === coluna.id);
  if (igual) return { statusId: igual.id, nome: igual.name, exato: true };
  const doTipo = ordenados.find((s) => s.type === coluna.type);
  return doTipo ? { statusId: doTipo.id, nome: doTipo.name, exato: false } : null;
}
