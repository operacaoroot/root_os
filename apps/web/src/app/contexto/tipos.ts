/*
 * ============================================================================
 * O QUE O MAPA LÊ — a cópia deste lado dos cinco contratos que ele consome
 * ============================================================================
 *
 * O mapa não tem fonte própria: ele desenha o que CINCO rotas que já existem
 * devolvem. Aqui ficam só os campos que a tela usa, e nada além deles.
 *
 *   `GET /memoria`              → a memória versionada     (fatia 4.1+4.2)
 *   `GET /agents`               → o roster de agentes      (fatia 5.1)
 *   `GET /rotinas`              → as rotinas com estado    (fatia 5.1)
 *   `GET /integrations/catalog` → as conexões com saúde    (fatia 5.4)
 *   `GET /organograma`          → gente da empresa         (onda 9)
 *
 * POR QUE CÓPIA E NÃO IMPORTE. `RotinaResumo` já existe em
 * `app/rotinas/tipos.ts`, e aquele arquivo declara a regra da casa: cópia com
 * dono é barata, duas telas lendo cópias diferentes não. O lugar certo dos dois
 * é `@mktos/shared` — e é lá que eles têm de ir na primeira fatia que puder
 * tocar o pacote compartilhado. Enquanto isso, importar de `app/rotinas/` de
 * dentro de `app/contexto/` acoplaria esta tela a uma pasta que outra fatia
 * está reescrevendo agora.
 *
 * O RECORTE É DE PROPÓSITO ESTREITO: campo que o mapa não desenha não entra.
 * Um tipo que copia a resposta inteira envelhece junto com ela e obriga a
 * editar esta tela toda vez que a API ganha um campo que ela ignora.
 */

/* --------------------------------------------------------------- memória -- */

/** As seis naturezas de `ContextKind`. Ver `apps/api/prisma/schema.prisma`. */
export type NaturezaDaNota =
  | 'regra'
  | 'definicao'
  | 'dicionario'
  | 'decisao'
  | 'fato'
  | 'nota';

/** As cinco procedências de `ContextSource`. Nota sem procedência não existe. */
export type ProcedenciaDaNota = 'vault' | 'upload' | 'promocao' | 'operador' | 'conector';

export const NATUREZAS: ReadonlyArray<{ valor: NaturezaDaNota; rotulo: string; explica: string }> = [
  { valor: 'regra', rotulo: 'regra', explica: 'o que vale nesta empresa' },
  { valor: 'decisao', rotulo: 'decisão', explica: 'o que foi decidido, com data e motivo' },
  { valor: 'definicao', rotulo: 'definição', explica: 'o que o cliente escolheu chamar de quê' },
  { valor: 'dicionario', rotulo: 'dicionário', explica: 'o que cada campo quer dizer' },
  { valor: 'fato', rotulo: 'fato', explica: 'fato estável do negócio' },
  { valor: 'nota', rotulo: 'nota', explica: 'o resto — é o padrão' },
];

export interface NotaDeContexto {
  id: string;
  chave: string;
  kind: NaturezaDaNota;
  title: string;
  body: string;
  tags: string[];
  sourceType: ProcedenciaDaNota;
  sourceRef: string | null;
  /** O rótulo pronto (`vault:pasta/arquivo.md`). Quem monta é a API. */
  procedencia: string;
  validFrom: string | null;
  validUntil: string | null;
  supersedesId: string | null;
  confidence: number;
  contentHash: string;
  versao: number;
  temVetor: boolean;
  arquivadoEm: string | null;
  criadoEm: string;
  atualizadoEm: string;
}

export interface MemoriaList {
  itens: NotaDeContexto[];
  /** O total que A API declara. A tela mostra este número, não `itens.length`. */
  total: number;
  comVetor: number;
}

export interface VersaoDeNota {
  id: string;
  versao: number;
  mudanca: 'criacao' | 'alteracao' | 'arquivamento' | 'restauracao';
  kind: NaturezaDaNota;
  title: string;
  sourceType: ProcedenciaDaNota;
  sourceRef: string | null;
  procedencia: string;
  contentHash: string;
  motivo: string | null;
  autorTipo: string;
  autorId: string | null;
  eventoId: string | null;
  eventoSeq: string | null;
  /** `migracao` · `falha_ao_registrar` · nulo. Separa as três ausências de elo. */
  semEventoPorque: string | null;
  criadoEm: string;
}

export interface AchadoDeMemoria extends NotaDeContexto {
  score: number;
}

export interface ResultadoDeBusca {
  query: string;
  modo: 'semantica' | 'textual';
  itens: AchadoDeMemoria[];
  fonte: { tool: string; generatedAt: string };
}

/* --------------------------------------------------------------- agentes -- */

/**
 * O estado DECLARADO de um agente — o enum `EstadoDeAgente` do banco.
 *
 * Mudou na fatia A2: era o vocabulário compartilhado com as rotinas
 * (`rodando`/`aprendendo`) e passou a ser o do agente. `ativo` é o que
 * `rodando` queria dizer; `rodando` agora é SITUAÇÃO (derivada de sessão viva)
 * e não estado. Ver `apps/api/src/agents/estado-do-agente.ts`.
 */
export type EstadoDeTripulante = 'planejado' | 'ativo' | 'pausado' | 'encerrado';

export interface AgenteDoMapa {
  slug: string;
  nome: string;
  iniciais: string;
  missao: string;
  pilar: string | null;
  dono: { id: string; nome: string } | null;
  tipo: string;
  estado: EstadoDeTripulante;
  autonomiaAte: string;
  rebaixadoAte: string | null;
  capacidades: string[];
  cron: string | null;
  ultimaExecucaoEm: string | null;
  ultimoStatus: string | null;
  execucoes: number;
  falhas: number;
  /*
   * AS HORAS, COMO O ROSTER PASSOU A DEVOLVÊ-LAS (fatia A3).
   *
   * O campo `horasDevolvidas: number | null` de antes era ACUMULADO de vida
   * inteira com as passagens que falharam dentro — e a gaveta do mapa o
   * publicava sob o rótulo "horas devolvidas", virando o TERCEIRO lugar a
   * afirmar o mesmo número errado (a tela de Agentes e o cartão dela eram os
   * outros dois). Agora o semanal e o acumulado viajam separados, com nome.
   */
  horas: {
    estado: 'sem-linha-de-base' | 'sem-historico' | 'medida';
    naSemana: number | null;
    passagensNaSemana: number;
    diasDaJanela: number;
    janelaCoberta: boolean;
    cobreDesde: string | null;
  };
  horasAcumuladas: number | null;
  passagensBemSucedidas: number;
  temProcedimento: boolean;
  faltando: string[];
}

/** O procedimento escrito do agente (RF-N-01/RF-N-02), como `GET /agents/:slug` devolve. */
export interface ProcedimentoDoAgente {
  proposito: string;
  gatilho: string;
  passos: string[];
  definicaoDePronto: string;
  observacoes: string | null;
  versao: number;
  atualizadoEm: string;
}

/**
 * O que `GET /agents/:slug` acrescenta à linha da listagem.
 *
 * É o que justifica a segunda chamada quando alguém abre um agente no mapa: o
 * PROCEDIMENTO não vem na listagem, e é ele — não o estado nem a contagem de
 * execuções — que responde "o que este agente faz aqui".
 */
export interface DetalheDeAgente {
  slug: string;
  sop: ProcedimentoDoAgente | null;
  escalacao: string;
  formato: { faltando: string[] };
}

export interface RosterDeAgentes {
  items: AgenteDoMapa[];
  kpis: {
    rodando: number;
    horasSemana: number | null;
    semLinhaDeBase: number;
    semProcedimento: number;
  };
}

/* --------------------------------------------------------------- rotinas -- */

export interface RotinaDoMapa {
  id: string;
  slug: string;
  nome: string;
  tipo: string;
  cron: string;
  tz: string;
  ativo: boolean;
  estado: EstadoDeTripulante;
  dispara: boolean;
  origem: string;
  agenteSlug: string | null;
  execucoes: number;
  falhas: number;
  ultimaExecucaoEm: string | null;
  ultimoStatus: string | null;
  proximaExecucaoEm: string | null;
  /*
   * A LINHA DE BASE, e o produto dela que NÃO se publica (a dívida gêmea da
   * fatia A3).
   *
   * `minutosDevolvidos` é `minutosPorExecucao × Rotina.execucoes`, e `execucoes`
   * soma as passagens que deram ERRO. A gaveta o publicava como "tempo
   * devolvido", sem período, ao lado de uma tela (`/rotinas`) que publica o
   * mesmo fato como "por semana" e de outra (`/agentes`) que a fatia A3 acabou
   * de consertar: três números para um fato.
   *
   * O semanal exige o LOG de passagens, e o mapa não o busca (seria uma
   * requisição por rotina para desenhar dezenove pontos). Então aqui fica o que
   * dá para afirmar com honestidade: o acumulado DESCONTANDO as falhas, que sai
   * de `minutosPorExecucao × (execucoes - falhas)` — os três já na resposta.
   * O número por semana continua sendo assunto de `/rotinas`, e a gaveta leva
   * até lá.
   */
  minutosPorExecucao: number | null;
  minutosDevolvidos: number | null;
}

export interface ListaDeRotinas {
  items: RotinaDoMapa[];
  agendadorAtivo: boolean;
  /** Nenhuma rotina dispara em empresa nenhuma. Vira tarja, não nota de rodapé. */
  descobertaCega: boolean;
}

/* -------------------------------------------------------------- conexões -- */

export type EstadoDeConector = 'conectado' | 'nao_configurado' | 'erro' | 'nao_verificado';

export interface SaudeDeConector {
  estado: EstadoDeConector;
  mensagem: string | null;
  /** `tentativa` é a única que vale verde. Ver a tela de Conexões. */
  apuracao: 'tentativa' | 'declaracao' | 'nao_verificado';
  verificadoEm: string;
  latenciaMs: number | null;
}

export interface ConexaoDoMapa {
  key: string;
  label: string;
  category: string;
  authType: string;
  requires: string;
  status: 'connected' | 'disconnected' | 'error' | string;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  desligado?: boolean;
  motivoDesligado?: string | null;
  saude: SaudeDeConector | null;
}

export interface CatalogoDeConexoes {
  items: ConexaoDoMapa[];
}

/* ----------------------------------------------------------------- gente -- */

export interface PessoaDoMapa {
  id: string;
  nome: string;
  /** `null` = a fonte não informa, que é diferente de `false`. */
  ativo: boolean | null;
  papeis: string[] | null;
  pilares: string[];
  agentes: string[];
}

export interface Organograma {
  pilares: { pilar: string; pessoas: PessoaDoMapa[]; agentes: { slug: string }[] }[];
  semPilar: { pessoas: PessoaDoMapa[]; agentes: { slug: string }[] };
  totais: { pessoas: number; agentes: number; agentesSemDono: number; pilares: number };
}

/* ------------------------------------------------------------- formatação -- */

/** Data e hora no formato brasileiro, ou o travessão quando não há. */
export function quando(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR');
}

/** Só a data, para linha de versão e validade. */
export function dia(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

/** Minutos em "Xh Ymin", que é como uma pessoa lê tempo devolvido. */
export function emHoras(minutos: number): string {
  if (minutos < 60) return `${minutos}min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

export function rotuloDaNatureza(kind: NaturezaDaNota): string {
  return NATUREZAS.find((n) => n.valor === kind)?.rotulo ?? kind;
}
