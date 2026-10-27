import { rotuloDoTipoDeMensagem } from '@mktos/shared';

/*
 * Layout 27/10 (Lucas: "não consigo nem abrir, nem enviar documentos pelo wpp do OS").
 * AS REGRAS PURAS DO ARQUIVO NA CAIXA DE WHATSAPP, sem Nest: onde o arquivo
 * mora no storage, o nome que ele leva, se abre no navegador ou baixa.
 *
 * O arquivo de uma mensagem é buscado na Evolution só quando alguém abre, e
 * fica no storage do OS (MinIO/S3, o mesmo `StorageService` dos anexos) com a
 * chave da empresa e da mensagem: a segunda vez abre sem a Evolution. O que a
 * caixa manda já entra no storage na hora do envio.
 */

/** Os tipos de mensagem que têm arquivo. */
const TIPOS_COM_ARQUIVO = new Set(['image', 'video', 'audio', 'document', 'sticker']);

export function temArquivo(tipo: string): boolean {
  return TIPOS_COM_ARQUIVO.has(tipo);
}

/** A chave do arquivo de uma mensagem no storage: por empresa e por mensagem. */
export function chaveDaMidiaNoStorage(orgId: string, mensagemId: string): string {
  return `whatsapp-midia/${orgId}/${mensagemId}`;
}

/** O tipo MIME sem parâmetros e só com o que um tipo tem, ou `null`. */
export function mimeLimpo(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = v.split(';')[0].trim().toLowerCase();
  return /^[a-z0-9][a-z0-9.+-]{0,60}\/[a-z0-9][a-z0-9.+-]{0,100}$/.test(m) ? m : null;
}

const EXTENSAO: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'application/pdf': 'pdf',
};

/** A extensão de um tipo MIME conhecido, ou `bin`. */
export function extensaoDoMime(mime: string | null): string {
  return (mime && EXTENSAO[mime]) || 'bin';
}

/**
 * O nome do arquivo: o que veio (sem caminho, sem controle, até 120), senão
 * "<tipo>-<dia>.<extensão>" ("imagem-2026-10-27.jpg").
 */
export function nomeDoArquivo(nome: unknown, tipo: string, mime: string | null, quando: Date): string {
  const limpo =
    typeof nome === 'string'
      ? nome
          .split(/[\\/]/)
          .pop()!
          .replace(/[\u0000-\u001f\u007f"<>|:*?]+/g, '_')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 120)
      : '';
  if (limpo && limpo !== '.' && limpo !== '..') return limpo;
  const dia = Number.isNaN(quando.getTime()) ? 'arquivo' : quando.toISOString().slice(0, 10);
  const rotulo = rotuloDoTipoDeMensagem(tipo)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return `${rotulo}-${dia}.${extensaoDoMime(mime)}`;
}

/** Abre no navegador (foto, áudio, vídeo, PDF) ou baixa (o resto). SVG baixa: ele pode levar script. */
export function abreNoNavegador(mime: string): boolean {
  if (mime === 'image/svg+xml') return false;
  return /^(image|audio|video)\//.test(mime) || mime === 'application/pdf';
}

/**
 * O nome do arquivo como o navegador mandou. O multer lê o nome do multipart
 * em latin1, e "proposta-ação.pdf" chegava "proposta-aÃ§Ã£o.pdf": quando os
 * bytes formam UTF-8 válido, o nome é relido em UTF-8.
 */
export function nomeDoUpload(original: unknown): string {
  if (typeof original !== 'string') return '';
  if (!/[\u0080-ÿ]/.test(original) || /[^\u0000-ÿ]/.test(original)) return original;
  const relido = Buffer.from(original, 'latin1').toString('utf8');
  return relido.includes('�') ? original : relido;
}

/** O `Content-Disposition` com o nome em ASCII (navegador antigo) e em UTF-8. */
export function cabecalhoDoArquivo(nome: string, inline: boolean): string {
  const ascii = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]|["\\]/g, '_');
  const utf8 = encodeURIComponent(nome).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
