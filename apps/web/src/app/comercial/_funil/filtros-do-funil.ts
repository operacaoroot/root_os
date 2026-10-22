/*
 * OS FILTROS E A VISÃO DO FUNIL VIVO (rodada da interface U2/U4, 20/10/2026) — a parte sem tela.
 *
 * O par [Vistas ▾] [Filtros (n)] do cabeçalho, como nas tarefas. O estado mora
 * no ENDEREÇO (as chaves de `VistaFunilSchema.filtros`, mais `visao`): é o que
 * a vista salva guarda e o que o link compartilhado carrega. O responsável
 * (dono do lead) é o PRIMEIRO filtro do painel.
 *
 * O link antigo `?filtro=` (as etiquetas de antes) continua abrindo: ele é
 * traduzido para o painel na abertura e sai do endereço.
 *
 * Fica fora do page.tsx porque página do App Router não exporta nada além do componente.
 */
import {
  COMERCIAL_CHAVES_DOS_FILTROS_DO_FUNIL,
  COMERCIAL_ESTAGIOS,
  COMERCIAL_FILTROS_DO_FUNIL,
  COMERCIAL_PERFIS,
  COMERCIAL_PRODUTOS,
  COMERCIAL_ROTULO_DA_ETAPA,
  filtrosDoFiltroAntigo,
  filtrosDoFunilVazios,
  type ComercialFiltrosDoFunil,
  type VistaFunil,
} from '@mktos/shared';

import type { DefinicaoDeFiltro, ValoresDeFiltro } from '@/components/filtros/filtros';
import { ROTULO_DO_PRODUTO } from '@/lib/cockpit';

import { colunasNoEndereco, lerColunas, lerOrdem, ordemNoEndereco, type ChaveDaColuna, type OrdemDaLista } from './lista-do-funil';

export type VisaoDoFunil = VistaFunil['visao'];

export interface EnderecoDoFunil {
  visao: VisaoDoFunil;
  filtros: ComercialFiltrosDoFunil;
  /** O endereço trazia filtro ou visão: a vista padrão não passa por cima do link. */
  temFiltro: boolean;
  /** O endereço trazia o `?filtro=` antigo, que foi traduzido e precisa sair. */
  migrou: boolean;
  /** I5: as colunas visíveis do formato Lista (`?colunas=`; ausente = o padrão). */
  colunas: ChaveDaColuna[];
  /** I5: a ordenação da lista (`?ordem=coluna:asc|desc`; ausente = a ordem da API). */
  ordem: OrdemDaLista | null;
}

/** I5: o que a lista guarda no endereço e na vista, além da visão e dos filtros. */
export interface ListaNoEndereco {
  colunas: readonly ChaveDaColuna[];
  ordem: OrdemDaLista | null;
}

const explicacao = (chave: string) => COMERCIAL_FILTROS_DO_FUNIL.find((f) => f.chave === chave)?.explicacao;

/** Os filtros do painel, na ordem do pedido do Rodrigo: responsável primeiro. */
export function definicoesDosFiltros(donos: readonly { id: string; nome: string }[]): DefinicaoDeFiltro[] {
  return [
    {
      chave: 'dono',
      rotulo: 'Responsável',
      tipo: 'pessoa',
      vazio: 'Todos',
      opcoes: [{ valor: 'eu', rotulo: 'Eu' }, { valor: 'sem', rotulo: 'Sem responsável' }, ...donos.map((d) => ({ valor: d.id, rotulo: d.nome }))],
      dica: 'O dono do lead na ficha.',
    },
    { chave: 'produto', rotulo: 'Produto', tipo: 'opcoes', opcoes: COMERCIAL_PRODUTOS.map((p) => ({ valor: p, rotulo: ROTULO_DO_PRODUTO[p] })) },
    { chave: 'perfil', rotulo: 'Perfil', tipo: 'opcoes', opcoes: COMERCIAL_PERFIS.map((p) => ({ valor: p, rotulo: p })) },
    {
      chave: 'etapa',
      rotulo: 'Etapa',
      tipo: 'etapa',
      opcoes: [...COMERCIAL_ESTAGIOS.map((e) => ({ valor: e, rotulo: COMERCIAL_ROTULO_DA_ETAPA[e] })), { valor: 'saidas', rotulo: 'Todas as saídas' }],
    },
    { chave: 'parado', rotulo: 'Só os parados', tipo: 'booleano', valorMarcado: '1', dica: explicacao('parados') },
    { chave: 'decisao', rotulo: 'Decisão sua', tipo: 'booleano', valorMarcado: '1', dica: explicacao('decisao') },
    { chave: 'q', rotulo: 'Empresa ou contato', tipo: 'texto', placeholder: 'buscar pelo nome' },
  ];
}

/** Lê do endereço a visão e os filtros; traduz o `?filtro=` antigo. */
export function lerEnderecoDoFunil(search: string): EnderecoDoFunil {
  const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const filtros = filtrosDoFunilVazios();
  for (const k of COMERCIAL_CHAVES_DOS_FILTROS_DO_FUNIL) filtros[k] = p.get(k) ?? '';
  const antigo = p.get('filtro');
  const migrou = antigo !== null;
  if (antigo) Object.assign(filtros, { ...filtrosDoFiltroAntigo(antigo), ...Object.fromEntries(Object.entries(filtros).filter(([, v]) => v)) });
  const visao: VisaoDoFunil = p.get('visao') === 'lista' ? 'lista' : 'quadro';
  const temFiltro = p.has('visao') || p.has('colunas') || p.has('ordem') || COMERCIAL_CHAVES_DOS_FILTROS_DO_FUNIL.some((k) => filtros[k] !== '');
  return { visao, filtros, temFiltro, migrou, colunas: lerColunas(p.get('colunas')), ordem: lerOrdem(p.get('ordem')) };
}

/**
 * Escreve a visão e os filtros no endereço sem mexer no resto (`lead`, `aba`
 * do painel). Visão "quadro" e filtro vazio saem do endereço; o `?filtro=`
 * antigo também sai.
 */
export function escreverEnderecoDoFunil(search: string, visao: VisaoDoFunil, filtros: ComercialFiltrosDoFunil, lista?: ListaNoEndereco): string {
  const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  p.delete('filtro');
  if (visao === 'lista') p.set('visao', 'lista');
  else p.delete('visao');
  for (const k of COMERCIAL_CHAVES_DOS_FILTROS_DO_FUNIL) {
    const v = (filtros[k] ?? '').trim() === '' ? '' : filtros[k];
    if (v) p.set(k, v);
    else p.delete(k);
  }
  // I5: as colunas e a ordem da lista; o padrão sai do endereço. Sem `lista`, ficam como estão.
  if (lista) {
    const colunas = colunasNoEndereco(lista.colunas);
    if (colunas) p.set('colunas', colunas);
    else p.delete('colunas');
    const ordem = ordemNoEndereco(lista.ordem);
    if (ordem) p.set('ordem', ordem);
    else p.delete('ordem');
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/**
 * I5: a configuração da vista salva. Colunas e ordem só entram quando fogem do
 * padrão, para a vista de antes continuar igual (a comparação "modificada" é
 * pelo texto da configuração).
 */
export function configDaVistaDoFunil(visao: VisaoDoFunil, filtros: ComercialFiltrosDoFunil, lista: ListaNoEndereco): VistaFunil {
  const colunas = colunasNoEndereco(lista.colunas);
  const ordem = ordemNoEndereco(lista.ordem);
  return { visao, filtros, ...(colunas ? { colunas: colunas.split(',') } : {}), ...(ordem ? { ordem } : {}) };
}

/** O caminho da API para os filtros de agora (sem filtro: o funil inteiro). */
export function caminhoDoFunil(filtros: ComercialFiltrosDoFunil): string {
  const p = new URLSearchParams();
  for (const k of COMERCIAL_CHAVES_DOS_FILTROS_DO_FUNIL) {
    const v = (filtros[k] ?? '').trim();
    if (v) p.set(k, v);
  }
  const s = p.toString();
  return s ? `/comercial/funil?${s}` : '/comercial/funil';
}

/** Os valores no formato do botão de filtros. */
export function valoresDoPainel(filtros: ComercialFiltrosDoFunil): ValoresDeFiltro {
  return { ...filtros };
}
