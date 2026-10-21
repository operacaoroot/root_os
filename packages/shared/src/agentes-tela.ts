import type {
  AreaDaFuncao,
  DonoDaFuncao,
  EstadoDaFuncao,
  TipoDaFuncao,
} from './agentes.js';
import type { MotivoForaDaEquipe } from './equipe-pessoas.js';

/*
 * O CATÁLOGO NA TELA E A EQUIPE (rodada dos agentes, 21/10/2026, A7)
 *
 * As formas que `GET /agents/cadastro` e `GET /organograma/equipe` devolvem, e os
 * filtros da tela `/agentes` (que moram no endereço da página). A API monta, a
 * tela lê, e as duas usam estes tipos.
 */

export type AbaDoCatalogo = 'agentes' | 'rotinas' | 'automacoes';

export const ABAS_DO_CATALOGO: readonly { chave: AbaDoCatalogo; rotulo: string; dica: string }[] = [
  { chave: 'agentes', rotulo: 'Agentes', dica: 'decidem com modelo' },
  { chave: 'rotinas', rotulo: 'Rotinas', dica: 'rodam no relógio, sem modelo' },
  { chave: 'automacoes', rotulo: 'Automações e integrações', dica: 'reagem a evento ou sincronizam' },
];

export function abaDoTipo(tipo: TipoDaFuncao): AbaDoCatalogo {
  return tipo === 'agente' ? 'agentes' : tipo === 'rotina' ? 'rotinas' : 'automacoes';
}

export const ROTULO_DO_ESTADO: Readonly<Record<EstadoDaFuncao, string>> = {
  ativo: 'ativo',
  desligado: 'desligado',
  'so-homologacao': 'só homologação',
  aposentado: 'aposentado',
};

/** O dono como a tela mostra: o EFETIVO, e de onde ele veio. */
export interface DonoNaTela {
  /** A pessoa da equipe, ou `null` quando nem o banco nem o padrão resolvem. */
  efetivo: { id: string; nome: string } | null;
  /** `banco` = trocado na Equipe (ou o `Agent.donoId`); `padrao` = o do cadastro. */
  origem: 'banco' | 'padrao' | null;
  /** O dono padrão do cadastro (`rodrigo` | `lucas` | `pedro`); `null` fora do cadastro. */
  padrao: DonoDaFuncao | null;
  /** Há ponteiro no banco que NÃO é pessoa da equipe (conta do sistema, de teste...): vale o padrão. */
  bancoForaDaEquipe: boolean;
}

export interface LinhaDoCatalogo {
  /** `CO-03`… ou `null` para o agente registrado fora do cadastro. */
  id: string | null;
  slug: string;
  nome: string;
  area: AreaDaFuncao | 'Fora do cadastro';
  tipo: TipoDaFuncao;
  aba: AbaDoCatalogo;
  paraQueServe: string;
  /** O estado que vale para o filtro: o do cadastro, rebaixado a `desligado` quando o banco diz que está parado. */
  estado: EstadoDaFuncao;
  /** O do cadastro, sem o banco. */
  estadoDeclarado: EstadoDaFuncao | null;
  /** Por que o estado efetivo difere do declarado (ex.: "pausado na tela"). */
  estadoMotivo: string | null;
  dono: DonoNaTela;
  /** Só para `agente`: a escolha EFETIVA (registro > variável > cadastro > padrão). */
  modelo: {
    modelo: string;
    esforco: string;
    origem: 'registro' | 'variavel' | 'cadastro' | 'padrao';
  } | null;
  modeloExterno: string | null;
  gatilho: string;
  frequencia: string;
  nivel: string;
  capacidades: readonly string[];
  ultima: { em: string; status: string | null; fonte: 'rotina' | 'agente' | 'gasto' } | null;
  proxima: { em: string; fonte: 'rotina' | 'agente' } | null;
  /** Rotinas do tipo no banco (só quando o cadastro tem `rotina`). */
  rotina: { tipo: string; cadastradas: number; ativas: number } | null;
  gastoMes: { totalUsd: number; chamadas: number } | null;
  onde: string;
  soNoPapel: boolean;
  /** Há registro `Agent` desta linha: a tela abre o controle de hoje dentro dela. */
  registrado: boolean;
}

export interface CatalogoDeFuncoes {
  /** `AAAA-MM` do gasto. */
  mes: string;
  /** O provedor de modelo em uso (`anthropic`, `stub`, `ponte`...). */
  provedor: string;
  padrao: { modelo: string; esforco: string };
  linhas: LinhaDoCatalogo[];
  geradoEm: string;
}

/* ------------------------------------------------------------- filtros -- */

export type FiltroDeEstado = 'ativos' | 'desligados' | 'homologacao' | 'todos' | 'aposentados';

export const FILTROS_DE_ESTADO: readonly { chave: FiltroDeEstado; rotulo: string }[] = [
  { chave: 'ativos', rotulo: 'Ativos' },
  { chave: 'desligados', rotulo: 'Desligados' },
  { chave: 'homologacao', rotulo: 'Só homologação' },
  { chave: 'todos', rotulo: 'Todos (menos aposentados)' },
  { chave: 'aposentados', rotulo: 'Aposentados' },
];

export interface FiltroDoCatalogo {
  aba: AbaDoCatalogo;
  estado: FiltroDeEstado;
  area: string | null;
  /** O id da pessoa da equipe, ou `sem-dono`. */
  dono: string | null;
}

export const FILTRO_PADRAO: FiltroDoCatalogo = { aba: 'agentes', estado: 'ativos', area: null, dono: null };

function casaEstado(e: EstadoDaFuncao, f: FiltroDeEstado): boolean {
  switch (f) {
    case 'ativos':
      return e === 'ativo';
    case 'desligados':
      return e === 'desligado';
    case 'homologacao':
      return e === 'so-homologacao';
    case 'aposentados':
      return e === 'aposentado';
    default:
      return e !== 'aposentado';
  }
}

export function filtrarCatalogo(linhas: readonly LinhaDoCatalogo[], f: FiltroDoCatalogo): LinhaDoCatalogo[] {
  return linhas.filter(
    (l) =>
      l.aba === f.aba &&
      casaEstado(l.estado, f.estado) &&
      (!f.area || l.area === f.area) &&
      (!f.dono || (f.dono === 'sem-dono' ? !l.dono.efetivo : l.dono.efetivo?.id === f.dono)),
  );
}

/** Lê o filtro do endereço (`?aba=rotinas&estado=todos&area=Comercial&dono=<id>`). */
export function lerFiltroDaUrl(search: string): FiltroDoCatalogo {
  const p = new URLSearchParams(search);
  const aba = p.get('aba');
  const estado = p.get('estado');
  return {
    aba: ABAS_DO_CATALOGO.some((a) => a.chave === aba) ? (aba as AbaDoCatalogo) : FILTRO_PADRAO.aba,
    estado: FILTROS_DE_ESTADO.some((e) => e.chave === estado) ? (estado as FiltroDeEstado) : FILTRO_PADRAO.estado,
    area: p.get('area')?.trim() || null,
    dono: p.get('dono')?.trim() || null,
  };
}

/** O endereço do filtro; o padrão não aparece (endereço limpo é o padrão). */
export function filtroParaUrl(f: FiltroDoCatalogo): string {
  const p = new URLSearchParams();
  if (f.aba !== FILTRO_PADRAO.aba) p.set('aba', f.aba);
  if (f.estado !== FILTRO_PADRAO.estado) p.set('estado', f.estado);
  if (f.area) p.set('area', f.area);
  if (f.dono) p.set('dono', f.dono);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/* --------------------------------------------------------------- equipe -- */

export interface FuncaoNaEquipe {
  id: string | null;
  slug: string;
  nome: string;
  area: AreaDaFuncao | 'Fora do cadastro';
  tipo: TipoDaFuncao;
  estado: EstadoDaFuncao;
  paraQueServe: string;
  dono: DonoNaTela;
  /** `Agent.donoId` (registro) ou `DonoDaFuncao` (tabela da Equipe). */
  guardadoEm: 'agente' | 'equipe';
}

export interface WhatsappNaEquipe {
  cadastrado: boolean;
  /** `…8888` para todos. */
  final: string | null;
  /** O número inteiro formatado, só para a própria pessoa e para quem administra gente. */
  numero: string | null;
}

export interface PessoaNaEquipe {
  id: string;
  nome: string;
  papeis: string[];
  whatsapp: WhatsappNaEquipe;
  /** Quem está vendo pode cadastrar o número desta pessoa. */
  podeEditarWhatsapp: boolean;
  /** As funções de que ela é dona (dono efetivo), por área, na ordem do cadastro. */
  areas: { area: string; funcoes: FuncaoNaEquipe[] }[];
}

export interface EquipeDaEmpresa {
  pessoas: PessoaNaEquipe[];
  /** As funções sem dono efetivo (padrão que não resolve e nenhum no banco). */
  semDono: FuncaoNaEquipe[];
  /** Contas que ficaram fora da vista, só a contagem por motivo (nada é apagado). */
  foraDaVista: Partial<Record<MotivoForaDaEquipe, number>>;
  podeEditarDono: boolean;
  totais: { pessoas: number; agentes: number; rotinas: number; automacoes: number };
}
