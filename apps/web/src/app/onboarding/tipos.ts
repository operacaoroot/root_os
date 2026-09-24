/*
 * O contrato da tela do onboarding com a API. O original mora em
 * `apps/api/src/onboarding/trilho/trilho.service.ts` (e nos arquivos puros ao
 * lado). Cópia declarada, como `rotinas/tipos.ts` — o pacote compartilhado não
 * é desta fatia.
 */

export type Fase = 'qualificar' | 'diagnostico' | 'contrato' | 'imersao' | 'operacao' | 'encerrado';
export type Nivel = 'beaba' | 'avancar-junto' | 'entregar-pronto';
export type Perfil = 'P1' | 'P2' | 'P3' | 'nao-entra';
export type Blocos = 'A' | 'BCD';

export const ROTULO_DA_FASE: Record<Fase, string> = {
  qualificar: '0 · Qualificar',
  diagnostico: '1 · Diagnóstico',
  contrato: '2 · Contrato e onboarding',
  imersao: '3 · Imersão',
  operacao: '4 · Operação assistida',
  encerrado: 'Encerrado',
};

export const ORDEM_DAS_FASES: Fase[] = ['qualificar', 'diagnostico', 'contrato', 'imersao', 'operacao', 'encerrado'];

export const ROTULO_DO_NIVEL: Record<Nivel, string> = {
  beaba: 'Ensinar o beabá',
  'avancar-junto': 'Avançar junto',
  'entregar-pronto': 'Entregar pronto',
};

export const ROTULO_DO_BLOCO: Record<string, string> = {
  A: 'Qualificação',
  B: 'A memória da casa',
  C: 'Intenção',
  D: 'Operação e linha de base',
};

export interface Pessoa {
  nome: string;
  papel?: string;
  contato?: string;
}

export interface Portoes {
  triagemRespondidaEm?: string;
  propostaEnviadaEm?: string;
  entradaCompensadaEm?: string;
  dupla?: { donoPerguntas?: Pessoa; guardiaoAcesso?: Pessoa };
  linhaDeBase?: { metrica: string; valor: number; unidade?: string; medidoEm: string; quemMediu: string };
  ambienteOkEm?: string;
  criterioDeSaida?: { atingidoEm: string; evidencia: string };
  medicaoDia30?: { valor: number; medidoEm: string; quemMediu: string };
  antesDepois?: { antes: number; depois: number; unidade?: string; registradoEm: string };
  caseEm?: string;
  mensalidadePropostaEm?: string;
}

export interface PortaoNaTela {
  chave: string;
  rotulo: string;
  cumprido: boolean;
  detalhe: string | null;
}

export interface ItemNaBancada {
  temaId: string;
  bloco: string;
  titulo: string;
  pergunta: string;
  aprofundar: string;
  obrigatorio: boolean;
  formato: 'texto' | 'escolha';
  opcoes: string[] | null;
  ramo: string[] | null;
  origem: string;
  tipo: string;
  proposta: string | null;
  fonteMinuto: string | null;
  fonteTrecho: string | null;
  fonteNota: string | null;
  status: string;
  textoFinal: string | null;
  aprovadoPor: string | null;
  aprovadoEm: string | null;
  respondidoPor: string | null;
  respondidoEm: string | null;
  respondidoVia: string | null;
  notaId: string | null;
  carregadoEm: string | null;
}

export interface ConviteNaBancada {
  id: string;
  blocos: string;
  estado: 'ativo' | 'concluido' | 'expirado' | 'revogado';
  validoAte: string;
  enviadoEm: string | null;
  lembradoEm: string | null;
  concluidoEm: string | null;
  revogadoEm: string | null;
  acessos: number;
  ultimoAcessoEm: string | null;
  temLink: boolean;
  criadoEm: string;
}

export interface MarcoNaBancada {
  id: string;
  tipo: string;
  texto: string;
  dados: Record<string, unknown>;
  quem: string | null;
  em: string;
}

export interface AtaNaBancada {
  id: string;
  fonte: string;
  referencia: string | null;
  caracteres: number;
  segredosRemovidos: number;
  modelo: string | null;
  custoUsd: number;
  custoEstimado: boolean;
  propostas: number;
  emBranco: number;
  erro: string | null;
  lidaPor: string | null;
  lidaEm: string;
}

export interface Pendencia {
  trilhoId: string;
  tipo: string;
  texto: string;
  conviteId?: string;
  dados?: Record<string, unknown>;
}

export interface Receita {
  chave: string;
  nome: string;
  dor: string;
  preRequisito: string;
  oQueSeInstala: string;
  nivelNaRegua: string;
  criterioDeSaida: string;
  metricaDaLinhaDeBase: string;
  ondeJaRodou: string;
  nicho: string;
  estado: 'inteira' | 'semente';
  pautaDaImersao: { dia1: string[]; dia2: string[] };
}

export interface Dossie {
  afirmacoes: { texto: string; fonte: string; hipotese: boolean }[];
  hipoteses: { titulo: string; comoEra: string; comoFica: string; receita: string | null; metrica: string }[];
  perguntasQueFaltam: string[];
  perfilSugerido: Perfil | null;
  motivoDoPerfil: string | null;
}

export interface TrilhoResumo {
  id: string;
  cliente: string;
  slug: string;
  fase: Fase;
  faseRotulo: string;
  perfil: string | null;
  nivel: string | null;
  nivelRotulo: string | null;
  receita: string | null;
  contatoNome: string | null;
  conduzidoPor: string | null;
  implantadoPor: string | null;
  reuniaoEm: string | null;
  kickoffEm: string | null;
  imersaoEm: string | null;
  proximoPasso: string | null;
  proximoPassoDono: string | null;
  proximoPassoEm: string | null;
  empresaId: string | null;
  cardId: string | null;
  podeAvancar: boolean;
  faltando: string[];
  proxima: Fase | null;
  itens: { respondidos: number; obrigatorios: number; propostos: number; pendentesDeAprovacao: number };
  pendencias: number;
  criadoEm: string;
  atualizadoEm: string;
}

export interface TrilhoCompleto extends TrilhoResumo {
  contatoWhatsapp: string | null;
  contatoEmail: string | null;
  grupoJid: string | null;
  observacoes: string | null;
  portoes: Portoes;
  portoesNaTela: PortaoNaTela[];
  itens_: ItemNaBancada[];
  convites: ConviteNaBancada[];
  atas: AtaNaBancada[];
  marcos: MarcoNaBancada[];
  receitaDetalhe: Receita | null;
  dossie: Dossie | null;
  pendenciasDoRelogio: Pendencia[];
  receitas: { chave: string; nome: string; estado: string }[];
}

export interface ConviteGerado {
  conviteId: string;
  token: string;
  link: string;
  validoAte: string;
  mensagem: string;
  aprovadosPelaRegra: number;
}

export interface MensagensDoConvite {
  envio: string | null;
  lembrete: string | null;
  cobranca: string | null;
  link: string | null;
  faltam: string[];
}

export interface RoteiroDoKickoff {
  titulo: string;
  cabecalho: {
    cliente: string;
    perfil: string | null;
    nivel: string | null;
    nivelRotulo: string | null;
    receita: string | null;
    receitaNome: string | null;
    conduzidoPor: string | null;
    implantadoPor: string | null;
    kickoffEm: string | null;
  };
  consentimento: string;
  comoConduzir: string[];
  triagem: { titulo: string; resposta: string }[];
  blocos: {
    bloco: string;
    titulo: string;
    temas: { id: string; n: string; titulo: string; pergunta: string; aprofundar: string; obrigatorio: boolean; tag: string; coberto: boolean }[];
  }[];
  cobertura: { cobertos: number; total: number; emBranco: string[]; obrigatoriosEmBranco: string[] };
  markdown: string;
}

export interface RetratoDoTrilho {
  texto: string;
  partes: { temaId: string; bloco: string; titulo: string; texto: string; fonte: string }[];
  pendentes: string[];
  primeiraPergunta: { pergunta: string | null; resposta: string };
}

export interface ResultadoDaLeitura {
  ata: AtaNaBancada;
  leitura: { propostas: unknown[]; emBranco: string[]; avisos: string[] };
  preservadas: string[];
}

// ---- o link público -------------------------------------------------------

export interface ItemDoLink {
  temaId: string;
  bloco: string;
  blocoRotulo: string;
  titulo: string;
  pergunta: string;
  aprofundar: string;
  obrigatorio: boolean;
  formato: 'texto' | 'escolha';
  opcoes: string[] | null;
  modo: 'confirmar' | 'responder' | 'feito';
  proposta: string | null;
  fonte: string | null;
  interpretado: boolean;
  status: string;
  textoFinal: string | null;
  respondidoVia: string | null;
  respondidoEm: string | null;
}

export type EstadoDaEstacao = 'feita' | 'aqui' | 'adiante';

export interface EstacaoDoMapa {
  n: number;
  chave: 'conversa' | 'acordo' | 'kickoff' | 'contexto' | 'memoria' | 'frente';
  titulo: string;
  oQueE: string;
  quando: string | null;
  estado: EstadoDaEstacao;
  detalhe: string | null;
}

export interface MapaDoCliente {
  titulo: string;
  subtitulo: string;
  estacaoAtual: number;
  estacoes: EstacaoDoMapa[];
  promessa: { pasta: string; notas: string[]; fontes: string | null; primeiraPergunta: string | null };
}

export interface OrdemDoKickoff {
  decisoes: string[];
  confirmacoes: string[];
  extras: string[];
}

export type EstadoDoNo = 'pronta' | 'rascunho' | 'vazia' | 'conversa' | 'indice';

export interface NoDaTeia {
  id: string;
  tipo: 'tema' | 'conversa' | 'indice';
  titulo: string;
  pasta: string;
  estado: EstadoDoNo;
  bloco: string | null;
  temaId: string | null;
  minuto: string | null;
  corpo: string | null;
  ligacoes: string[];
}

export interface TeiaDoCliente {
  pasta: string;
  nos: NoDaTeia[];
  arestas: { de: string; para: string }[];
  contagem: { prontas: number; rascunhos: number; vazias: number; daConversa: number };
}

export interface EstadoDoLink {
  cliente: string;
  contatoNome: string | null;
  blocos: Blocos;
  estado: 'ativo' | 'concluido' | 'expirado' | 'revogado';
  validoAte: string;
  concluido: boolean;
  kickoffEm: string | null;
  audioDisponivel: boolean;
  itens: ItemDoLink[];
  mapa: MapaDoCliente;
  ordem: OrdemDoKickoff;
  teia: TeiaDoCliente;
  progresso: { confirmados: number; respondidos: number; total: number; obrigatoriosFaltando: string[] };
}

/*
 * DIA não é INSTANTE — a mesma régua do `fusoDaData` da API (`mensagens.ts`):
 * data do trilho ("2026-09-22") é gravada à meia-noite UTC e diz o DIA, então
 * se formata em UTC; no fuso de Brasília ela voltaria um dia. Instante de
 * verdade (acesso, resposta, marco) continua em São Paulo.
 */
const fusoDaData = (d: Date) =>
  d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0
    ? 'UTC'
    : 'America/Sao_Paulo';

export const dataBR = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR', { timeZone: fusoDaData(d) });
};
export const dataHoraBR = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }) : '—';
export const paraInputDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');
