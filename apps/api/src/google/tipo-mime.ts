/*
 * O TIPO MIME QUE VAI A UM CABEÇALHO (revisão adversarial de 21/10/2026).
 *
 * O `tipoMime` do arquivo chega de fora (o navegador de quem subiu, o anexo do
 * WhatsApp) e entra literalmente numa linha `Content-Type:` do corpo multipart
 * do Drive. Com quebra de linha no meio, quem manda o arquivo escreveria
 * cabeçalho ou parte nova no pedido ao Google. Só passa `tipo/subtipo` com os
 * caracteres de token da RFC 6838 (sem parâmetro, sem espaço, sem controle),
 * até 127 de cada lado.
 */

const TOKEN = "[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}";
export const PADRAO_DO_TIPO_MIME = new RegExp(`^${TOKEN}/${TOKEN}$`);

export function tipoMimeValido(tipo: unknown): tipo is string {
  return typeof tipo === 'string' && PADRAO_DO_TIPO_MIME.test(tipo);
}

/** O tipo, ou `application/octet-stream` quando ele não serve para cabeçalho. */
export function tipoMimeOuBinario(tipo: unknown): string {
  return tipoMimeValido(tipo) ? tipo : 'application/octet-stream';
}
