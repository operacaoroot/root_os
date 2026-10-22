import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

import { BadRequestException } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import { FECHADO_FORA_MAX_BYTES } from '@mktos/shared';

import { StorageService } from '../storage/storage.service';
import { ehPdf } from './fechado-fora';

/*
 * O PDF DO CONTRATO NO ARMAZÉM, a parte comum (rodada de produção 2, M2).
 *
 * Dois caminhos guardam o contrato assinado do comercial: o "Registrar cliente
 * já fechado" (T1b) e o anexo do contrato importado do CRM antigo (S6). Os dois
 * conferem o arquivo do mesmo jeito (o tipo pelo CONTEÚDO, `%PDF-`, e o teto de
 * 10 MB), guardam no mesmo `StorageService`, pela mesma chave de conteúdo
 * (`chaveDoAnexo` em `fechado-fora.ts`), e registram o mesmo fato
 * `contrato.anexado`. O que é comum mora aqui, uma cópia só.
 */

/** O armazém do PDF (o `StorageService`; a suíte troca por um dublê). */
export interface ArmazemDoAnexo {
  put(key: string, corpo: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ stream: Readable; contentType: string; size: number }>;
}
export const ARMAZEM_DO_ANEXO = 'ARMAZEM_DO_ANEXO';

/** O arquivo como o multer entrega. */
export interface ArquivoRecebido {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/** Confere o PDF recebido: presente, dentro do teto e PDF de verdade (o tipo do navegador não basta). */
export function conferirPdfRecebido(arquivo: ArquivoRecebido | undefined): asserts arquivo is ArquivoRecebido {
  if (!arquivo || !arquivo.size) throw new BadRequestException('Anexe o contrato assinado em PDF.');
  if (arquivo.size > FECHADO_FORA_MAX_BYTES || arquivo.buffer.length > FECHADO_FORA_MAX_BYTES) throw new BadRequestException('PDF acima de 10 MB.');
  if (arquivo.mimetype !== 'application/pdf' || !ehPdf(arquivo.buffer)) throw new BadRequestException('O contrato assinado precisa ser um PDF.');
}

/** O sha256 do conteúdo (hexa, 64): a identidade do arquivo. */
export function sha256DoArquivo(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** O nome que vai ao fio e ao download: só letras, números e `._ -`, até 120. */
export function nomeDoPdf(original: string): string {
  return String(original ?? '').replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120) || 'contrato.pdf';
}

/**
 * O armazém disponível: o dublê da suíte, ou o `StorageService` CONFIGURADO. Sem as chaves
 * do S3 o serviço existe mas não grava: conta como indisponível, para quem chama recusar
 * antes de escrever qualquer fato.
 */
export function armazemDisponivel(armazem: ArmazemDoAnexo | undefined, moduleRef: ModuleRef | undefined): ArmazemDoAnexo | null {
  if (armazem) return armazem;
  try {
    const storage = moduleRef?.get(StorageService, { strict: false }) ?? null;
    return storage && storage.configured ? storage : null;
  } catch {
    return null;
  }
}
