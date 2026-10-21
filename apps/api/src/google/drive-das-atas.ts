import { sigiloso } from '../gateway/event-log.service';

/*
 * O DRIVE PARA O BANCO DE ATAS (produção 21, P7, 21/10/2026), a parte pura.
 *
 * A consulta da lista dentro da pasta e a forma do que a leitura de um
 * arquivo devolve. O HTTP fica no `GoogleService` (o único arquivo com o
 * endereço do Google); quem consome é o banco de atas, PELA PORTA, com as
 * capacidades R0 `contexto.arquivo.listar` e `contexto.arquivo.ler`.
 */

/** O teto do arquivo lido: 15 MB (uma ata em PDF com algumas páginas cabe com folga). */
export const MAX_BYTES_DO_ARQUIVO_LIDO = 15 * 1024 * 1024;

const ID_DO_DRIVE = /^[A-Za-z0-9_-]{10,120}$/;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

export interface OpcoesDaListaDoDrive {
  /** O id da pasta: lista só os arquivos que estão dentro dela. */
  pasta?: string;
  /** Busca no TEXTO e no nome (`fullText contains`), o que o Drive indexa. */
  texto?: string;
  /** AAAA-MM-DD: só os modificados a partir desse dia. */
  desde?: string;
}

/** Um valor dentro de aspas simples na consulta do Drive: barra e aspas escapadas, sem quebra de linha. */
function valorDaConsulta(v: string): string {
  return String(v ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .slice(0, 200);
}

/**
 * A consulta (`q`) da lista da pasta. Id de pasta fora do formato é recusado
 * aqui (lança), para nenhum texto colado virar pedaço de consulta.
 */
export function consultaDoDrive(o: { pasta: string; nome?: string; texto?: string; desde?: string }): string {
  if (!ID_DO_DRIVE.test(o.pasta)) throw new Error('id de pasta do Drive fora do formato');
  const partes = [`'${o.pasta}' in parents`, 'trashed = false', "mimeType != 'application/vnd.google-apps.folder'"];
  if (o.nome?.trim()) partes.push(`name contains '${valorDaConsulta(o.nome.trim())}'`);
  if (o.texto?.trim()) partes.push(`fullText contains '${valorDaConsulta(o.texto.trim())}'`);
  if (o.desde && DIA.test(o.desde)) partes.push(`modifiedTime >= '${o.desde}T00:00:00'`);
  return partes.join(' and ');
}

/** O que a leitura de um arquivo devolve, com o texto marcado sigiloso para o registro da porta. */
export interface ArquivoLidoDoDrive {
  id: string;
  nome: string;
  mimeType: string;
  modificadoEm: string | null;
  link: string | null;
  /** As pastas onde o arquivo está (quem lê confere que é a pasta das atas). */
  pastas: string[];
  bytes: number | null;
  /** `sigiloso(texto)`: quem recebe da porta abre com `textoDaLeitura`. */
  texto: unknown;
}

export function leituraDoArquivo(a: Omit<ArquivoLidoDoDrive, 'texto'> & { texto: string }): ArquivoLidoDoDrive {
  return { ...a, texto: sigiloso(a.texto, 'texto do arquivo do Drive') };
}

/** O texto de uma leitura que voltou da porta (desembrulha o `sigiloso`). */
export function textoDaLeitura(v: unknown): string {
  const bruto = v && typeof v === 'object' && '__sigiloso' in v ? (v as unknown as { valor: unknown }).valor : v;
  return typeof bruto === 'string' ? bruto : '';
}

export function ehLeituraDoArquivo(v: unknown): v is ArquivoLidoDoDrive {
  const o = v as Partial<ArquivoLidoDoDrive> | null;
  return !!o && typeof o === 'object' && typeof o.id === 'string' && typeof o.nome === 'string' && Array.isArray(o.pastas);
}
