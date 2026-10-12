import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  TOTEM_MIDIA_ARQUIVO_RE,
  TOTEM_MIDIA_MAX_BYTES,
  TOTEM_MIDIA_TIPOS,
  totemUrlDaMidia,
  type TotemMidiaTipo,
} from '@mktos/shared';

/*
 * AS IMAGENS DO TOTEM (foto do produto, banner da campanha).
 *
 * O tipo sai da ASSINATURA do arquivo, não do `mimetype` que o navegador
 * declara: o cabeçalho é do cliente e diz o que ele quiser. O que a rota
 * pública devolve como `Content-Type` é o tipo conferido aqui, então um HTML
 * com nome de `.png` nunca sai servido como imagem nem como página.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function comeca(buf: Uint8Array, bytes: readonly number[], desde = 0): boolean {
  if (buf.length < desde + bytes.length) return false;
  return bytes.every((b, i) => buf[desde + i] === b);
}

function ascii(texto: string): number[] {
  return [...texto].map((c) => c.charCodeAt(0));
}

/** O tipo pela assinatura dos primeiros bytes, ou `null` quando não é jpeg, png nem webp. */
export function tipoPelaAssinatura(buf: Uint8Array): TotemMidiaTipo | null {
  if (comeca(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (comeca(buf, PNG)) return 'image/png';
  if (comeca(buf, ascii('RIFF')) && comeca(buf, ascii('WEBP'), 8)) return 'image/webp';
  return null;
}

export interface MidiaConferida {
  tipo: TotemMidiaTipo;
  /** `<hash>.<ext>`, o nome que a rota pública aceita. */
  arquivo: string;
  chave: string;
  url: string;
}

export function chaveDaMidia(orgId: string, arquivo: string): string {
  return `totem/${orgId}/${arquivo}`;
}

/** O par da URL pública vale? (`orgId` uuid, arquivo no formato que o envio gera.) */
export function midiaPedidaValida(orgId: string, arquivo: string): boolean {
  return UUID_RE.test(orgId) && TOTEM_MIDIA_ARQUIVO_RE.test(arquivo);
}

/**
 * Confere o arquivo enviado e devolve onde guardá-lo. O nome é o hash do
 * conteúdo: a mesma foto enviada duas vezes cai na mesma chave, e trocar a foto
 * gera endereço novo em vez de sobrescrever o que o quiosque guardou.
 */
export function conferirMidia(orgId: string, buf: Uint8Array | undefined): MidiaConferida {
  if (!buf || buf.length === 0) throw new BadRequestException('Escolha uma imagem para enviar.');
  if (buf.length > TOTEM_MIDIA_MAX_BYTES) {
    throw new BadRequestException(`A imagem passa de ${TOTEM_MIDIA_MAX_BYTES / 1024 / 1024} MB.`);
  }
  const tipo = tipoPelaAssinatura(buf);
  if (!tipo) throw new BadRequestException('Envie uma imagem JPG, PNG ou WEBP.');
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 32);
  const arquivo = `${hash}.${TOTEM_MIDIA_TIPOS[tipo]}`;
  return { tipo, arquivo, chave: chaveDaMidia(orgId, arquivo), url: totemUrlDaMidia(orgId, arquivo) };
}
