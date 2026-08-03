import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Client } from 'minio';
import type { Readable } from 'node:stream';

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
