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

/**
 * A página dona deste arquivo, lida do próprio nome.
 *
 * O upload monta a chave como `<pageId>-<12 hexadecimais>.<ext>`
 * (`bio.controller.ts`), e o `pageId` é o uuid da `BioPage`. É o que permite à
 * entrega — que é pública, anônima e não recebe nada além do nome do arquivo —
 * resolver de que empresa é a requisição (RF-T-04).
 *
 * Casa o uuid pela FORMA, e não por "o que vem antes do último hífen": o hash
 * é hexadecimal, então `lastIndexOf('-')` daria a resposta certa hoje e a
 * errada no dia em que o sufixo mudar. Devolve `null` para nome que não segue a
 * convenção — e nome fora da convenção não deixa de ser servido, só deixa de ter
 * empresa resolvida (ver `bio-public.controller.ts`).
 */
const AVATAR_PAGE_ID_RE =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})-[0-9a-fA-F]+\.(?:png|jpg|webp|gif)$/;

export function pageIdDoAvatar(arquivo: string): string | null {
  return AVATAR_PAGE_ID_RE.exec(arquivo)?.[1] ?? null;
}
