import type { BioLinkTipo, BioPlataforma } from '@mktos/shared';

// Respostas do módulo bio da API, do jeito que o painel consome.

export interface BioPageResumo {
  id: string;
  handle: string;
  titulo: string;
  subtitulo: string | null;
  avatarUrl: string | null;
  publicada: boolean;
  _count: { links: number };
}

export interface BioLinkRow {
  id: string;
  ordem: number;
  tipo: BioLinkTipo;
  rotulo: string;
  destino: string;
  icone: string | null;
  destaque: boolean;
  ativo: boolean;
}

export interface BioContaRow {
  id: string;
  plataforma: string;
  handle: string;
  modo: string;
  status: string;
  conexaoId: string | null;
  ultimaColeta: string | null;
  ultimoErro: string | null;
  contagem: number;
}

export interface BioDesafio {
  id: string;
  titulo: string;
  contagem: number;
  meta: number;
  inicio: string;
  fim: string;
  diaAtual: number;
  diasTotais: number;
  diasRestantes: number;
  progresso: number;
  esperado: number;
  saldo: number;
  porDia: number;
  encerrado: boolean;
  contas: BioContaRow[];
}

export interface BioPageDetalhe {
  page: BioPageResumo & { links: BioLinkRow[] };
  desafio: BioDesafio | null;
}

export interface BioConexaoRow {
  id: string;
  plataforma: BioPlataforma;
  handle: string;
  externalId: string;
  status: string;
  expiraEm: string | null;
  escopos: string | null;
  ultimoErro: string | null;
  conectadaEm: string;
  _count: { contas: number };
}

export interface BioCredencialRow {
  plataforma: BioPlataforma;
  configurada: boolean;
  origem: 'perfil' | 'global' | 'ambiente' | null;
  appIdParcial: string | null;
  atualizadaEm: string | null;
  temGlobal: boolean;
  temDoPerfil: boolean;
}

export interface BioAnalyticsResumoRow {
  pageId: string;
  handle: string;
  titulo: string;
  publicada: boolean;
  views: number;
  visitantes: number;
  cliques: number;
  ctr: number;
}

export interface BioAnalyticsDetalhe {
  page: { id: string; handle: string; titulo: string; publicada: boolean };
  views: number;
  cliques: number;
  visitantes: number;
  ctr: number;
  links: { id: string; rotulo: string; tipo: string; ativo: boolean; cliques: number; taxa: number }[];
  origens: { nome: string; total: number }[];
  dispositivos: { nome: string; total: number }[];
  serie: { dia: string; views: number; cliques: number }[];
}

export interface Lista<T> {
  items: T[];
  total: number;
}
