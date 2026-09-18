import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { comContextoDePlataforma } from '../prisma/contexto-de-plataforma';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    let db = 'down';
    try {
      await comContextoDePlataforma(() => this.prisma.$queryRaw`SELECT 1`);
      db = 'ok';
    } catch {
      db = 'down';
    }
    return {
      status: db === 'ok' ? 'ok' : 'degraded',
      db,
      time: new Date().toISOString(),
    };
  }

  /** Identifica o artefato em execução sem depender do checkout no host. */
  @Get('versao')
  version() {
    return {
      version: process.env.ROOTOS_VERSION?.trim() || 'development',
      commit: process.env.ROOTOS_COMMIT?.trim() || 'unknown',
    };
  }
}
