import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Client } from 'minio';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

/** O pedaço de cada parte do envio em partes: só ele fica em memória. O S3 pede ao menos 5 MB. */
export const PARTE_DO_ENVIO = 16 * 1024 * 1024;

/**
 * Storage de objetos (MinIO na stack, S3 em qualquer outro lugar).
 *
 * O MinIO NÃO é público: na VPS as portas dele ficam bindadas em 172.17.0.1, só
 * a rede do compose alcança. Por isso nada aqui devolve URL do bucket — quem
 * serve o arquivo ao browser é a própria API, numa rota pública que faz o
 * streaming. Assim a credencial do bucket nunca sai do servidor.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly log = new Logger('StorageService');
  private readonly bucket = process.env.S3_BUCKET ?? 'marketing-os';
  private cliente: Client | null = null;

  get configured(): boolean {
    return !!(process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY);
  }

  private get client(): Client {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'storage não configurado: defina S3_ACCESS_KEY e S3_SECRET_KEY no .env',
      );
    }
    this.cliente ??= new Client({
      endPoint: process.env.S3_ENDPOINT ?? 'minio',
      port: Number(process.env.S3_PORT ?? 9000),
      useSSL: (process.env.S3_USE_SSL ?? 'false') === 'true',
      accessKey: process.env.S3_ACCESS_KEY as string,
      secretKey: process.env.S3_SECRET_KEY as string,
    });
    return this.cliente;
  }

  async onModuleInit(): Promise<void> {
    if (!this.configured) {
      this.log.warn('S3/MinIO sem credencial — upload de imagem fica indisponível.');
      return;
    }
    try {
      if (!(await this.client.bucketExists(this.bucket))) {
        await this.client.makeBucket(this.bucket);
        this.log.log(`bucket "${this.bucket}" criado`);
      }
      this.log.log(`storage pronto — bucket "${this.bucket}"`);
    } catch (e) {
      // Não derruba a API: sem storage o resto do sistema segue funcionando.
      this.log.warn(`storage indisponível no boot: ${(e as Error).message}`);
    }
  }

  async put(key: string, corpo: Buffer, contentType: string): Promise<void> {
    await this.client.putObject(this.bucket, key, corpo, corpo.length, {
      'Content-Type': contentType,
      // imutável: a chave carrega o hash do conteúdo, então nunca muda embaixo
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
  }

  /**
   * Grava um arquivo grande que chega como stream (MD4, o mp4 do corte), sem
   * segurá-lo inteiro em memória: no máximo uma parte de 16 MB por vez.
   *
   * Não usa o `putObject(stream)` do `minio`: ele liga o stream ao fatiador com
   * `pipe`, que não repassa erro da origem. Quando a conferência do mp4 recusa
   * o arquivo no meio (sem faststart, sha diferente, corpo maior que o
   * declarado), o fatiador nunca termina e o envio fica pendurado para sempre.
   * Aqui o envio em partes é feito à mão: o erro do stream interrompe a leitura,
   * o envio é abortado e o objeto NUNCA aparece — no S3 ele só passa a existir
   * no `complete`, que só roda depois de o stream terminar limpo. Uma chave que
   * já existia com o mesmo conteúdo não é tocada por um envio que falhou.
   *
   * Arquivo que cabe numa parte vai num PUT só, como o `put`.
   */
  async putStream(key: string, stream: Readable, tamanho: number, contentType: string): Promise<void> {
    const cliente = this.client;
    const cabecalhos = { 'Content-Type': contentType, 'Cache-Control': 'private, max-age=31536000, immutable' };
    if (tamanho <= PARTE_DO_ENVIO) {
      const partes: Buffer[] = [];
      for await (const pedaco of stream) partes.push(pedaco as Buffer);
      const corpo = Buffer.concat(partes);
      await cliente.putObject(this.bucket, key, corpo, corpo.length, cabecalhos);
      return;
    }
    const uploadId = await cliente.initiateNewMultipartUpload(this.bucket, key, cabecalhos);
    try {
      const etags: Array<{ part: number; etag: string }> = [];
      let pendentes: Buffer[] = [];
      let acumulado = 0;
      const enviarParte = async (corpo: Buffer) => {
        const part = etags.length + 1;
        const r = await cliente.uploadPart(
          {
            bucketName: this.bucket,
            objectName: key,
            uploadID: uploadId,
            partNumber: part,
            headers: { 'Content-Length': corpo.length, 'Content-MD5': createHash('md5').update(corpo).digest('base64') },
          },
          corpo,
        );
        etags.push({ part, etag: r.etag });
      };
      for await (const pedaco of stream) {
        pendentes.push(pedaco as Buffer);
        acumulado += (pedaco as Buffer).length;
        while (acumulado >= PARTE_DO_ENVIO) {
          const tudo = Buffer.concat(pendentes);
          await enviarParte(tudo.subarray(0, PARTE_DO_ENVIO));
          const sobra = tudo.subarray(PARTE_DO_ENVIO);
          pendentes = sobra.length ? [sobra] : [];
          acumulado = sobra.length;
        }
      }
      if (acumulado > 0 || etags.length === 0) await enviarParte(Buffer.concat(pendentes));
      await cliente.completeMultipartUpload(this.bucket, key, uploadId, etags);
    } catch (e) {
      stream.destroy();
      await cliente.abortMultipartUpload(this.bucket, key, uploadId).catch((erro: Error) => {
        this.log.warn(`envio em partes de ${key} não foi abortado: ${erro.message}`);
      });
      throw e;
    }
  }

  async get(key: string): Promise<{ stream: Readable; contentType: string; size: number }> {
    const meta = await this.client.statObject(this.bucket, key);
    const stream = await this.client.getObject(this.bucket, key);
    return {
      stream,
      contentType: (meta.metaData?.['content-type'] as string) ?? 'application/octet-stream',
      size: meta.size,
    };
  }
}
