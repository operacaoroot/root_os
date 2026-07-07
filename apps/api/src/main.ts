import 'reflect-metadata';
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ZodExceptionFilter } from './common/zod-exception.filter';

// Credenciais PRÓPRIAS do root (isolamento): ficam em ~/.config/root/*.env,
// nunca no repo. Carregadas AQUI sem sobrescrever o .env local da API.
for (const name of ['openai.env', 'zapfy.env', 'clickup.env', 'google.env']) {
  const p = join(homedir(), '.config', 'root', name);
  if (existsSync(p)) loadEnv({ path: p, override: false });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: (process.env.WEB_ORIGIN ?? 'http://localhost:4000').split(','),
    credentials: true,
  });
  app.useGlobalFilters(new ZodExceptionFilter());
  const port = Number(process.env.API_PORT ?? 4001);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`Marketing OS API → http://localhost:${port}/api`);
}
bootstrap();
