/*
 * OS FILTROS NUM BOTÃO SÓ (rodada da interface U2, 20/10/2026).
 *
 * O Rodrigo pediu: os filtros das tarefas, da Implantação e do Funil vivo num
 * botão "Filtros", com a vista salva ao lado. Cada tela DECLARA os filtros dela
 * (chave no endereço, rótulo, tipo, opções) e o painel desenha. O estado continua
 * no ENDEREÇO: é o que a vista salva guarda e o que o link compartilhado carrega.
 *
 * Funções puras aqui; o desenho mora em BotaoDeFiltros.tsx.
 */

export type TipoDeFiltro =
  | 'pessoa'
  | 'lista'
  | 'cliente'
  | 'etapa'
  | 'etiqueta'
  | 'prazo'
  | 'opcoes'
  | 'booleano'
  | 'texto';

export interface OpcaoDeFiltro {
  valor: string;
  rotulo: string;
}

export interface DefinicaoDeFiltro {
  /** A chave no endereço (`?assigneeUserId=…`). Única por tela. */
  chave: string;
  rotulo: string;
  tipo: TipoDeFiltro;
  /** Para os tipos de escolha. Vazio = o filtro aparece com a frase de `semOpcoes`. */
  opcoes?: OpcaoDeFiltro[];
  /** Rótulo da opção "sem filtro" (padrão "Todos"). */
  vazio?: string;
  /** Frase quando as opções ainda não chegaram ou não existem. */
  semOpcoes?: string;
  /** Para `texto`. */
  placeholder?: string;
  /** Para `booleano`: o valor gravado quando marcado (padrão "1"). */
  valorMarcado?: string;
  /** Dica curta abaixo do controle. */
  dica?: string;
}

export type ValoresDeFiltro = Record<string, string>;

/** Quantos filtros declarados estão com valor. É o `n` de "Filtros (n)". */
export function contarFiltrosAtivos(defs: readonly DefinicaoDeFiltro[], valores: ValoresDeFiltro): number {
  return defs.reduce((n, d) => n + ((valores[d.chave] ?? '').trim() !== '' ? 1 : 0), 0);
}

/** Lê do endereço só as chaves declaradas. Chave ausente vira texto vazio. */
export function lerFiltrosDoEndereco(search: string, defs: readonly DefinicaoDeFiltro[]): ValoresDeFiltro {
  const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const valores: ValoresDeFiltro = {};
  for (const d of defs) valores[d.chave] = p.get(d.chave) ?? '';
  return valores;
}

/**
 * Escreve os valores no endereço sem mexer nas chaves que não são filtro
 * (`pasta`, `visao`, `segmento`…). Valor vazio tira a chave. Devolve a busca
 * nova, com `?` quando não vazia.
 */
export function escreverFiltrosNoEndereco(search: string, valores: ValoresDeFiltro): string {
  const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  for (const [chave, valor] of Object.entries(valores)) {
    if ((valor ?? '').trim() === '') p.delete(chave);
    else p.set(chave, valor);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Todos os declarados em branco: o que "Limpar tudo" manda escrever. */
export function filtrosEmBranco(defs: readonly DefinicaoDeFiltro[]): ValoresDeFiltro {
  return Object.fromEntries(defs.map((d) => [d.chave, '']));
}
