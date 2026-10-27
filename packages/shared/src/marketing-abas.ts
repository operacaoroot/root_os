import { NAV } from './nav.js';

/*
 * As abas de cada seção do Marketing, no jeito do ROOT Estúdio (26/10/2026): o menu
 * lateral mostra só a seção, e a tela mostra as abas dela no topo. Cada aba é uma
 * rota que já existe, com item próprio no NAV (oculto, com `pai` = a seção): a
 * permissão e o módulo continuam os do item, e a aba some para quem não pode vê-la.
 */
export const ABAS_DO_MARKETING: Record<string, readonly string[]> = {
  'marketing-triagem': ['marketing-triagem', 'maquina-banco', 'marketing-estrategia', 'referencias', 'marketing-ideias'],
  'maquina-producao': ['maquina-producao', 'maquina-agendar', 'maquina-calendario', 'marketing-formatos', 'pauta'],
  'marketing-performance': ['marketing-performance', 'maquina-analise', 'marketing-relatorio', 'instagram'],
};

/** Rótulo da aba quando difere do item (a primeira aba é a própria seção). */
const ROTULO_DA_ABA: Record<string, string> = {
  'marketing-triagem': 'Para aprovar',
  'maquina-producao': 'Quadro',
  'marketing-performance': 'Painel',
  referencias: 'Fontes e referências',
};

export interface AbaDoMarketing {
  key: string;
  label: string;
  href: string;
  ativa: boolean;
}

/**
 * As abas da seção a que a rota pertence, já filtradas pelas permissões e módulos.
 * Rota fora dessas seções devolve lista vazia (a tela não mostra barra de abas).
 */
export function abasDoMarketing(
  pathname: string,
  permissoes: Iterable<string>,
  modulosLigados?: Iterable<string>,
): AbaDoMarketing[] {
  const caminho = pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  const perms = new Set(permissoes);
  const ligados = modulosLigados ? new Set(modulosLigados) : null;
  const destino = NAV.filter((n) => caminho === n.href || caminho.startsWith(`${n.href}/`)).sort((a, b) => b.href.length - a.href.length)[0];
  if (!destino) return [];
  const secao = ABAS_DO_MARKETING[destino.key] ? destino.key : destino.pai && ABAS_DO_MARKETING[destino.pai] ? destino.pai : null;
  if (!secao) return [];
  return ABAS_DO_MARKETING[secao]
    .map((key) => NAV.find((n) => n.key === key))
    .filter((n): n is (typeof NAV)[number] => !!n && perms.has(n.permission) && (!ligados || !n.modulo || ligados.has(n.modulo)))
    .map((n) => ({ key: n.key, label: ROTULO_DA_ABA[n.key] ?? n.label, href: n.href, ativa: n.key === destino.key }));
}

/** O cabeçalho de cada seção com abas, com as frases do ROOT Estúdio. */
export const CABECALHO_DA_SECAO: Record<string, { titulo: string; lead: string }> = {
  'marketing-triagem': { titulo: 'Ideias de conteúdo', lead: 'Aprove temas e guarde referências para criar conteúdo.' },
  'maquina-producao': { titulo: 'Produção', lead: 'Cada ideia aprovada vira uma peça. Acompanhe aqui do formato até o pronto.' },
  'marketing-performance': { titulo: 'Performance', lead: 'Como cada post rendeu contra a mediana da própria casa.' },
};

/** A seção com abas a que a rota pertence (a chave do item da seção), ou null. */
export function secaoComAbas(pathname: string): string | null {
  const caminho = pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  const destino = NAV.filter((n) => caminho === n.href || caminho.startsWith(`${n.href}/`)).sort((a, b) => b.href.length - a.href.length)[0];
  if (!destino) return null;
  if (ABAS_DO_MARKETING[destino.key]) return destino.key;
  return destino.pai && ABAS_DO_MARKETING[destino.pai] ? destino.pai : null;
}
