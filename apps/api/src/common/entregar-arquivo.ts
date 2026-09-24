import { pipeline } from 'node:stream';
import type { Logger } from '@nestjs/common';

/**
 * Entrega um arquivo do storage na resposta com `pipeline`, não `pipe`: quem
 * baixa e desiste no meio (a Graph refazendo o download, o celular fechando a
 * aba) destrói a leitura do storage, e o storage que falha no meio encerra a
 * resposta em vez de deixá-la pendurada com o Content-Length já enviado.
 */
export function entregarArquivo(stream: NodeJS.ReadableStream, res: NodeJS.WritableStream, log: Logger, rotulo: string): void {
  pipeline(stream, res, (e) => {
    if (e) log.warn(`${rotulo} interrompido: ${e.message}`);
  });
}
