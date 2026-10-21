import { z } from 'zod';

/* ==========================================================================
 * O BANCO DE ATAS DO TRABALHO (rodada do painel P3, 18/10/2026)
 * ==========================================================================
 *
 * As atas da operação chegam por dois caminhos e moram em lugares diferentes:
 *
 *   · `vault` — notas do vault que o conector do Obsidian já indexa
 *     (`KnowledgeNote`), filtradas pela pasta das reuniões (padrão
 *     `80-Reunioes`, configurável pela nota da memória `trabalho.atas.pasta`);
 *   · `colada` — ata avulsa colada ou enviada na tela. Ela vira NOTA DA MEMÓRIA
 *     (chave `ata:<data>-<slug>`, procedência operador) pelo `MemoriaService`,
 *     o caminho da ADR-011. Nunca por fora.
 *
 * O id que a tela e a API trocam é a REFERÊNCIA da ata: `vault:<id da nota
 * indexada>` ou `memoria:<id da nota da memória>`. É ela que a sugestão de
 * tarefa guarda em `ataRef`, e é por ela que a tarefa aceita aponta de volta.
 *
 * As SUGESTÕES de tarefa nascem em rascunho, propostas pelo leitor de atas do
 * Trabalho; o parser confere cada trecho contra a ata e descarta o que não
 * está nela. Aceitar cria a tarefa pelo serviço do Trabalho; nada vira tarefa
 * sozinho.
 */

export const ATA_PASTA_PADRAO = '80-Reunioes';
/** A nota da memória que muda a pasta das atas do vault (primeira linha = a pasta). */
export const ATA_CHAVE_DA_PASTA = 'trabalho.atas.pasta';
/** O prefixo das chaves da memória das atas coladas. */
export const ATA_PREFIXO_DA_CHAVE = 'ata:';
export const ATA_MIN_CARACTERES = 120;
export const ATA_MAX_CARACTERES = 200_000;

/**
 * `granola` (rodada da interface, 20/10/2026): a ata que o OS escreveu a partir
 * da TRANSCRIÇÃO de uma reunião lida direto do Granola. Mora na memória como a
 * colada (a referência continua `memoria:<id>`); a fonte só diz de onde veio,
 * pela procedência `granola:<id da reunião>`.
 */
export type TrabAtaFonte = 'vault' | 'colada' | 'granola' | 'drive';
export const TRAB_ATA_FONTES = ['vault', 'colada', 'granola', 'drive'] as const;
export type TrabAtaSugestaoEstado = 'rascunho' | 'aceita' | 'descartada';

/*
 * ATA OU TRANSCRIÇÃO (rodada de produção 1, P7, 21/10/2026). Cada item da lista
 * é uma das duas coisas, com filtro na tela:
 *   · vault: ata (a pasta das reuniões guarda atas);
 *   · colada: ata;
 *   · Granola: a REUNIÃO (a fala gravada) é transcrição; a ata que o OS escreveu
 *     a partir dela é ata;
 *   · Google Drive: pela regra de `tipoDoArquivoDeAta` (o nome do arquivo).
 */
export type TrabAtaTipo = 'ata' | 'transcricao';
export const TRAB_ATA_TIPOS = ['ata', 'transcricao'] as const;

export interface TrabAtaContagem {
  rascunho: number;
  aceitas: number;
  descartadas: number;
}

export interface TrabAtaResumo {
  /**
   * A referência: `vault:<id>`, `memoria:<id>`, `drive:<id do arquivo>` ou
   * `granola:<id da reunião>` (a transcrição de uma reunião do Granola).
   */
  id: string;
  fonte: TrabAtaFonte;
  /** Ata ou transcrição (P7). Ausente nas respostas antigas: vale `ata`. */
  tipo?: TrabAtaTipo;
  /** O endereço para abrir na fonte (Drive, Granola), quando ela diz. */
  link?: string | null;
  /** Tamanho do arquivo na fonte (Drive), quando ela diz. Nada além do índice fica no OS. */
  bytes?: number | null;
  /** Na transcrição: a ata que o OS já escreveu a partir dela (`memoria:<id>`). */
  ataGerada?: string | null;
  /** Na ata escrita pelo OS: a transcrição de onde ela veio (`granola:<id>` ou `drive:<id>`). */
  transcricaoRef?: string | null;
  titulo: string;
  /** AAAA-MM-DD, quando a ata diz (cabeçalho, linha "Data:" ou nome do arquivo). */
  data: string | null;
  participantes: string[];
  resumo: string;
  /** O caminho no vault (só `vault`). */
  caminho: string | null;
  sugestoes: TrabAtaContagem;
  /**
   * As sugestões já decididas, com quem decidiu e a tarefa criada (as mais
   * recentes primeiro, até 6). É o que deixa a lista dizer "aceita por Fulana,
   * virou a tarefa X" sem abrir a ata.
   */
  decididas?: TrabAtaDecidida[];
  /** O id da reunião no Granola, quando a ata veio de lá (é por ele que "Reprocessar" busca de novo). */
  granolaId?: string | null;
  atualizadaEm: string;
}

export interface TrabAtaDecidida {
  id: string;
  titulo: string;
  estado: 'aceita' | 'descartada';
  decididaPor: string | null;
  decididaEm: string | null;
  workTaskId: string | null;
  /** A lista da tarefa criada (para o link abrir a tarefa no quadro). */
  listaId: string | null;
}

/** Uma pendência da ata aberta e, quando virou tarefa, a sugestão e a tarefa. */
export interface TrabAtaPendencia {
  texto: string;
  sugestaoId: string | null;
  estado: TrabAtaSugestaoEstado | null;
  workTaskId: string | null;
}

export interface TrabAtaDetalhe extends TrabAtaResumo {
  texto: string;
  /** De onde veio, em uma linha (o caminho do vault ou a procedência da memória). */
  procedencia: string;
  sugestoesDaAta: TrabAtaSugestaoDto[];
  /** A seção "Decisões" da ata, item por item (vazia quando a ata não tem a seção). */
  decisoes?: string[];
  /** As seções "Pendências", "Próximos passos" e "Encaminhamentos", item por item, marcadas quando viraram tarefa. */
  pendencias?: TrabAtaPendencia[];
  /** A versão da nota da memória (a ata do Granola reprocessada ganha versão nova da mesma nota). */
  versao?: number | null;
}

export interface TrabAtaLista {
  atas: TrabAtaResumo[];
  /** A pasta do vault que está valendo. */
  pasta: string;
  /** Quantas notas do vault esta empresa tem indexadas (zero = só as coladas aparecem). */
  notasDoVault: number;
  /**
   * Quem pediu pode ler o vault (`obsidian.ver`)? Sem essa permissão a lista
   * traz só as coladas: o banco de atas não alarga o acesso ao vault.
   */
  vaultVisivel: boolean;
  iaConfigurada: boolean;
  /** Os filtros que valeram nesta lista (P7). */
  filtros?: TrabAtaFiltros;
  /** O estado de cada fonte, para a tela dizer por que uma delas não trouxe nada (P7). */
  fontes?: TrabAtaFontes;
}

/** O estado das fontes de atas desta empresa. Nenhuma é obrigatória. */
export interface TrabAtaFontes {
  vault: { visivel: boolean; notas: number; pasta: string };
  granola: { conectado: boolean; motivo: string | null; reunioes: number };
  drive: TrabAtaDriveEstado & { arquivos: number };
}

/** A pasta do Google Drive que a empresa escolheu para as atas (nota `trabalho.atas.drive`). */
export interface TrabAtaDriveEstado {
  /** Há pasta escolhida. */
  configurada: boolean;
  /** O id da pasta (não é segredo: é o que está no link da pasta). */
  pastaId: string | null;
  /** Quem pediu pode ler o Drive (`drive.ver`)? Sem ela, a fonte não é lida. */
  permitido: boolean;
  /** Quando a fonte não trouxe nada, a frase que a tela mostra. */
  motivo: string | null;
  /** O endereço da pasta no Drive. */
  link: string | null;
}

/** A nota da memória com a pasta do Google Drive das atas (primeira linha = o id da pasta). */
export const ATA_CHAVE_DO_DRIVE = 'trabalho.atas.drive';

/*
 * A BUSCA (P7): palavra-chave (título e corpo), intervalo de datas e os
 * filtros de tipo e de fonte, todos no endereço da tela
 * (`?q=&de=&ate=&tipo=&fonte=`). A ordem é sempre por data, a mais nova
 * primeiro.
 */
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const vazioSome = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
export const TrabAtaFiltrosSchema = z.object({
  q: z.preprocess(vazioSome, z.string().trim().max(200).optional()),
  de: z.preprocess(vazioSome, z.string().regex(DIA, 'de no formato AAAA-MM-DD').optional()),
  ate: z.preprocess(vazioSome, z.string().regex(DIA, 'até no formato AAAA-MM-DD').optional()),
  tipo: z.preprocess(vazioSome, z.enum(TRAB_ATA_TIPOS).optional()),
  fonte: z.preprocess(vazioSome, z.enum(TRAB_ATA_FONTES).optional()),
});
export interface TrabAtaFiltros {
  q?: string;
  de?: string;
  ate?: string;
  tipo?: TrabAtaTipo;
  fonte?: TrabAtaFonte;
}

/** A pasta do Drive escolhida na tela: o link da pasta ou o id. `null` tira a pasta. */
export const TrabAtaDrivePastaSchema = z.object({
  pasta: z.string().trim().max(500).nullable(),
});
export type TrabAtaDrivePastaInput = z.infer<typeof TrabAtaDrivePastaSchema>;

const ID_DO_DRIVE = /^[A-Za-z0-9_-]{10,120}$/;

/**
 * O id de uma pasta do Google Drive a partir do que a pessoa colou: o link
 * (`drive.google.com/drive/folders/<id>`, com ou sem `/u/0/` e `?usp=`), o link
 * antigo (`open?id=<id>`) ou o próprio id. Qualquer outra coisa é `null`.
 */
export function idDaPastaDoDrive(colado: string | null | undefined): string | null {
  const t = String(colado ?? '').trim();
  if (!t) return null;
  if (ID_DO_DRIVE.test(t)) return t;
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !/(^|\.)drive\.google\.com$/i.test(url.hostname)) return null;
  const pasta = /\/folders\/([A-Za-z0-9_-]+)/.exec(url.pathname)?.[1] ?? url.searchParams.get('id');
  return pasta && ID_DO_DRIVE.test(pasta) ? pasta : null;
}

/** O endereço da pasta no Drive, para o link "abrir a pasta". */
export function linkDaPastaDoDrive(id: string): string {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;
}

/**
 * ATA OU TRANSCRIÇÃO, para um arquivo do Drive: a regra é o NOME. Um nome que
 * diz "transcrição", "transcricao", "transcript" ou "transcrito", ou a
 * extensão de legenda (`.vtt`, `.srt`), é transcrição; o resto é ata. O
 * conteúdo não entra na regra de propósito: a lista não abre o arquivo, e o
 * tipo de um item não pode mudar quando alguém o abre.
 */
export function tipoDoArquivoDeAta(nome: string): TrabAtaTipo {
  const n = String(nome ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (/\.(vtt|srt)$/.test(n)) return 'transcricao';
  return /transcri(?:cao|coes|to|ta|pt|ption)/.test(n) ? 'transcricao' : 'ata';
}

/** Os tipos de arquivo do Drive que o banco de atas lê: Documento Google, PDF com texto, .txt e .md (e legendas). */
export function arquivoDoDriveEhLegivel(nome: string, mimeType: string): boolean {
  const n = String(nome ?? '').toLowerCase();
  const m = String(mimeType ?? '').toLowerCase();
  if (m === 'application/vnd.google-apps.document' || m === 'application/pdf') return true;
  if (m.startsWith('text/')) return true;
  return /\.(md|markdown|txt|vtt|srt|pdf)$/.test(n);
}

export interface TrabAtaSugestaoDto {
  id: string;
  ataRef: string;
  titulo: string;
  listaId: string | null;
  listaNome: string | null;
  donoSugerido: string | null;
  /** AAAA-MM-DD, só quando a ata disse a data. */
  vencimento: string | null;
  /** O pedaço da ata de onde a sugestão saiu (conferido contra a ata). */
  trecho: string;
  estado: TrabAtaSugestaoEstado;
  workTaskId: string | null;
  criadaEm: string;
  decididaEm: string | null;
  decididaPor: string | null;
}

export interface TrabAtaGeracao {
  criadas: TrabAtaSugestaoDto[];
  /** Sugestões que a leitura repetiu de uma rodada anterior (mesmo título). */
  repetidas: number;
  /** O que o parser descartou ou ajustou, para quem decide saber. */
  avisos: string[];
}

export const TrabAtaColarSchema = z.object({
  titulo: z.string().trim().min(3).max(200),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data no formato AAAA-MM-DD').nullish(),
  participantes: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  texto: z.string().min(ATA_MIN_CARACTERES, `a ata precisa ter ao menos ${ATA_MIN_CARACTERES} caracteres`).max(ATA_MAX_CARACTERES),
});
export type TrabAtaColarInput = z.infer<typeof TrabAtaColarSchema>;

export const TrabAtaAceitarSchema = z.object({
  /** A lista escolhida na tela; sem ela vale a da sugestão. */
  listaId: z.string().uuid().optional(),
  /**
   * O dono e o vencimento que a pessoa confirmou ou corrigiu na tela. Ausente
   * vale o da sugestão; `null` (ou dono vazio) tira. Quem aceita é quem decide.
   */
  dono: z.string().trim().max(120).nullish(),
  vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'vencimento no formato AAAA-MM-DD').nullish(),
  /*
   * Rodada do trabalho T5 (19/10/2026): tudo editável antes de criar. O título
   * (pré-preenchido no imperativo), o que será executado (a descrição; o trecho
   * da ata continua guardado como procedência), o responsável escolhido entre os
   * perfis reais da empresa (`responsavelId`, vence o `dono` em texto) e o
   * cliente (T4, obrigatório).
   */
  titulo: z.string().trim().min(1).max(300).optional(),
  descricao: z.string().max(4000).nullish(),
  responsavelId: z.string().uuid().nullish(),
  clienteId: z.union([z.literal('interno'), z.string().uuid()]).optional(),
});
export type TrabAtaAceitarInput = z.infer<typeof TrabAtaAceitarSchema>;

/* ==========================================================================
 * AS REUNIÕES DO GRANOLA, LIDAS DIRETO (rodada da interface, 20/10/2026)
 * ==========================================================================
 *
 * Ao lado do Zap (que continua igual), o OS fala com o servidor MCP do Granola
 * com a autorização de cada empresa (OAuth no navegador, token no cofre). O
 * bloco "Reuniões do Granola" da tela de Atas lista as últimas reuniões e
 * "Gerar ata" puxa a TRANSCRIÇÃO, escreve a ata no formato da casa e as
 * sugestões de tarefa num pedido só. A transcrição não é gravada em lugar
 * nenhum: ficam o hash, o tamanho, o custo e a procedência.
 */

export interface TrabGranolaCliente {
  taskId: string;
  titulo: string;
  /** Por que esse card: e-mail, domínio ou nome (as regras do Zap). */
  porque: 'email' | 'dominio' | 'nome';
}

export interface TrabGranolaReuniao {
  id: string;
  titulo: string;
  /** ISO, quando o Granola diz. */
  em: string | null;
  participantes: string[];
  cliente: TrabGranolaCliente | null;
  /** A ata já gerada desta reunião (`memoria:<id>`), quando existe. */
  ataRef: string | null;
  ataVersao: number | null;
  /** A reunião já está na ficha do cliente (pelo Zap ou por uma ata gerada aqui). */
  naFicha: boolean;
}

export interface TrabGranolaReunioes {
  /** A empresa autorizou o Granola direto e o token está no cofre. */
  conectado: boolean;
  /** O conector está desligado em Conexões (a autorização fica guardada). */
  desligado: boolean;
  /** Quando não dá para listar, a frase que a tela mostra. */
  motivo: string | null;
  reunioes: TrabGranolaReuniao[];
  iaConfigurada: boolean;
}

export interface TrabGranolaAtaGerada {
  ata: TrabAtaDetalhe;
  /** Primeira ata desta reunião (`true`) ou versão nova da mesma nota. */
  nova: boolean;
  versao: number;
  criadas: TrabAtaSugestaoDto[];
  repetidas: number;
  avisos: string[];
  cliente: TrabGranolaCliente | null;
  /** O que aconteceu na ficha do cliente. `nao_se_aplica`: a transcrição veio do Drive, que não leva reunião à ficha. */
  ficha: 'criada' | 'atualizada' | 'ja_estava' | 'sem_cliente' | 'nao_se_aplica';
}

/** O estado da conexão direta, para o cartão de Conexões. */
export interface TrabGranolaConexaoDireta {
  conectado: boolean;
  desde: string | null;
  /** O endereço do servidor MCP que este processo usa. */
  servidor: string;
  /** Para onde o Granola devolve o navegador depois da autorização. */
  retorno: string;
}

export const GRANOLA_DIAS_DA_LISTA = 30;

/**
 * A referência da ata, desmontada. `null` quando não é uma das formas.
 * `memoria:` volta como `colada` (a fonte de verdade, colada ou escrita do
 * Granola ou do Drive, sai da procedência da nota); `granola:` é a TRANSCRIÇÃO
 * de uma reunião do Granola; `drive:` é um arquivo da pasta do Drive.
 */
export function lerRefDaAta(ref: string): { fonte: TrabAtaFonte; id: string } | null {
  const m = /^(vault|memoria|drive|granola):([A-Za-z0-9_-]{1,120})$/.exec(String(ref ?? ''));
  if (!m) return null;
  const fonte: TrabAtaFonte = m[1] === 'vault' ? 'vault' : m[1] === 'drive' ? 'drive' : m[1] === 'granola' ? 'granola' : 'colada';
  return { fonte, id: m[2] };
}

/** `vault:` e `drive:` para as duas fontes de arquivo; `memoria:` para toda nota da memória (colada, ou escrita do Granola ou do Drive). */
export function refDaAta(fonte: TrabAtaFonte, id: string): string {
  return `${fonte === 'vault' ? 'vault' : fonte === 'drive' ? 'drive' : 'memoria'}:${id}`;
}

/** A referência da TRANSCRIÇÃO de uma reunião do Granola na lista de atas. */
export function refDaTranscricaoDoGranola(id: string): string {
  return `granola:${id}`;
}
