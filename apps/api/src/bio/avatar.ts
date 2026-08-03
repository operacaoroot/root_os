/** Regras do avatar, compartilhadas entre o upload (privado) e a entrega (pública). */

export const AVATAR_PREFIXO = 'bio/avatar/';
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/** mimetype aceito → extensão gravada. SVG fica de fora de propósito (XSS). */
export const AVATAR_TIPOS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * O nome do arquivo vem da URL pública, então precisa ser validado antes de
 * virar chave do bucket: só o formato que o upload gera, sem barra e sem "..".
 */
export const AVATAR_ARQUIVO_RE = /^[A-Za-z0-9-]+\.(png|jpg|webp|gif)$/;
