import { z } from 'zod';

import { SUBPASTAS_DO_CLIENTE } from './pasta-do-cliente.js';

/*
 * OS ARQUIVOS DO CLIENTE E O ANEXO NA TAREFA (rodada dos agentes, 21/10/2026, lane A4).
 *
 * O arquivista (TR-05) guarda cada arquivo que chega para um cliente no storage
 * do OS e, quando há pasta do cliente no Drive, manda uma cópia para a subpasta
 * certa pela porta (`drive.arquivo.enviar`, R3). O estado de cada arquivo é um
 * destes. O anexo na tarefa (TR-06) é um desses arquivos, com origem
 * `anexo-da-tarefa`.
 */

export const ESTADOS_DO_ARQUIVO_DO_CLIENTE = [
  /** Sem pasta do cliente ainda: sai quando a pasta nascer. */
  'na_fila',
  /** Foi à porta e espera a segunda pessoa. */
  'aguardando_aprovacao',
  /** Está na pasta do cliente no Drive. */
  'enviado',
  /** Confiança baixa: espera uma pessoa escolher a subpasta. */
  'classificar_a_mao',
  /** Cliente interno ou sem cliente: só no storage do OS. */
  'so_no_os',
  'erro',
] as const;
export type EstadoDoArquivoDoCliente = (typeof ESTADOS_DO_ARQUIVO_DO_CLIENTE)[number];

/**
 * O teto do anexo: 10 MB. É o corte do proxy do Next (`middlewareClientMaxBodySize`)
 * e o mesmo da sala do cliente; acima disso a requisição nem chega à API.
 */
export const ANEXO_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Os tipos aceitos no anexo: documento, planilha, apresentação, imagem e texto.
 * Executável, script, página HTML e compactado ficam de fora: o OS guarda e
 * repassa o arquivo, nunca abre nem executa, e não aceita o que só serve para rodar.
 */
export const TIPOS_DE_ANEXO: Readonly<Record<string, readonly string[]>> = {
  'application/pdf': ['pdf'],
  'text/plain': ['txt'],
  'text/markdown': ['md'],
  'text/csv': ['csv'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.ms-excel': ['xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.ms-powerpoint': ['ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
  'application/vnd.oasis.opendocument.text': ['odt'],
  'application/vnd.oasis.opendocument.spreadsheet': ['ods'],
};

/** A extensão do nome, minúscula e sem ponto (`''` sem extensão). */
export function extensaoDoNome(nome: string): string {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(String(nome ?? '').trim());
  return m ? m[1].toLowerCase() : '';
}

/**
 * O anexo é aceito? O tipo declarado tem de estar na lista E a extensão do nome
 * tem de ser uma das daquele tipo (um `.exe` declarado como PDF é recusado).
 * `text/markdown` também chega como `text/plain` ou `application/octet-stream`
 * em alguns navegadores: para `.md` vale qualquer dos três.
 */
export function motivoParaRecusarAnexo(nome: string, tipoMime: string, bytes: number): string | null {
  if (!Number.isFinite(bytes) || bytes < 1) return 'o arquivo está vazio.';
  if (bytes > ANEXO_MAX_BYTES) return 'o arquivo passa de 10 MB.';
  const ext = extensaoDoNome(nome);
  const mime = String(tipoMime ?? '').toLowerCase().split(';')[0].trim();
  if (ext === 'md' && ['text/markdown', 'text/plain', 'application/octet-stream', 'text/x-markdown'].includes(mime)) return null;
  const extensoes = TIPOS_DE_ANEXO[mime];
  if (!extensoes) return 'tipo de arquivo não aceito: mande PDF, documento, planilha, apresentação, imagem ou texto.';
  if (!extensoes.includes(ext)) return 'a extensão do arquivo não confere com o tipo dele.';
  return null;
}

/** O tipo que o OS grava para o anexo (o `.md` vira `text/markdown`). */
export function tipoDoAnexo(nome: string, tipoMime: string): string {
  if (extensaoDoNome(nome) === 'md') return 'text/markdown';
  return String(tipoMime ?? '').toLowerCase().split(';')[0].trim();
}

/** A confiança abaixo da qual a classificação do arquivista não vale sozinha. */
export const LIMIAR_DE_CONFIANCA_DO_ARQUIVISTA = 0.6;

/** As subpastas que uma pessoa escolhe na pendência "classificar à mão" (sem `_fonte`). */
export const SUBPASTAS_PARA_CLASSIFICAR = SUBPASTAS_DO_CLIENTE.filter((s) => s !== '_fonte');

export const AnexoDaTarefaSchema = z.object({
  id: z.string(),
  nome: z.string(),
  tipoMime: z.string(),
  bytes: z.number(),
  autorNome: z.string(),
  criadoEm: z.string(),
  /** Onde a cópia está: `so_no_os` quando a tarefa não tem cliente ou o cliente é interno. */
  estado: z.enum(ESTADOS_DO_ARQUIVO_DO_CLIENTE),
  /** O link do arquivo no Drive, quando já foi enviado. */
  driveUrl: z.string().nullable(),
  subpasta: z.string().nullable(),
  motivo: z.string().nullable(),
  approvalId: z.string().nullable(),
});
export type AnexoDaTarefa = z.infer<typeof AnexoDaTarefaSchema>;

/** Um cliente com o estado da pasta dele (a tela "Pastas dos clientes"). */
export const ClienteComPastaSchema = z.object({
  id: z.string(),
  nome: z.string(),
  pastaDriveUrl: z.string().nullable(),
  pastaDriveErro: z.string().nullable(),
  /** A criação da pasta está na fila de aprovação. */
  aguardandoAprovacao: z.boolean(),
  /** Arquivos esperando a pasta nascer. */
  arquivosNaFila: z.number(),
});
export type ClienteComPasta = z.infer<typeof ClienteComPastaSchema>;
