import 'reflect-metadata';
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ZodExceptionFilter } from './common/zod-exception.filter';
import { LoggerDeCorrelacao } from './common/logger-correlacao';
import { configurarBodyParser } from './common/configurar-body-parser';
import { instalarCorpoDaMidia } from './common/corpo-da-midia';
import { ehTokenDeSessao } from './auth/jwt-auth.guard';

// Credenciais PRÓPRIAS do root (isolamento): ficam em ~/.config/root/*.env,
// nunca no repo. Carregadas AQUI sem sobrescrever o .env local da API.
for (const name of ['openai.env', 'zapfy.env', 'clickup.env', 'google.env', 'pluggy.env', 'asaas.env', 'meta.env']) {
  const p = join(homedir(), '.config', 'root', name);
  if (existsSync(p)) loadEnv({ path: p, override: false });
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const prefixo = 'api';
  // As rotas de mídia do episódio aceitam corpo maior. O parser delas entra
  // ANTES do de `configurarBodyParser`: o primeiro JSON que casa lê o corpo, e o
  // de 100 kb recusaria a mídia com 413 antes de ela chegar aqui.
  const jwt = app.get(JwtService, { strict: false });
  instalarCorpoDaMidia(app, prefixo, (token) => {
    try {
      return ehTokenDeSessao(jwt.verify(token));
    } catch {
      return false;
    }
  });
  configurarBodyParser(app);

  /*
   * UM SALTO DE PROXY, E SÓ UM — o Traefik.
   *
   * Sem esta linha o `req.ip` do Express é o par do SOCKET, que neste desenho é
   * sempre o proxy: toda linha de auditoria de login e de aprovação gravava o
   * endereço da infraestrutura, igual para todo mundo. A coluna que existe para
   * dizer DE ONDE veio a tentativa de senha não dizia nada (ver
   * `src/auth/endereco-de-origem.ts`).
   *
   * `1` e não `true`: `true` faz o Express confiar na cadeia INTEIRA de
   * `X-Forwarded-For`, e esse cabeçalho é escrito por quem chama — o atacante
   * escolheria qual endereço fica registrado como dele, que é pior do que um
   * endereço inútil. Com `1` o Express poda um salto (o Traefik) e o que sobra é
   * quem falou com o proxy.
   *
   * SE UM DIA ENTRAR OUTRO SALTO NA FRENTE (Cloudflare, um balanceador), este
   * número precisa subir junto. Deixá-lo em 1 nesse cenário faz `req.ip` voltar
   * a ser o do proxy de dentro — errado, mas não forjável.
   */
  app.set('trust proxy', 1);

  // Toda linha de log passa a sair com a correlação da história em curso
  // (RNF-09). É o ponto canônico da troca: instalar de dentro de um módulo usa
  // o mesmo mecanismo e perde a disputa em silêncio para esta linha. Ver
  // common/logger-correlacao.ts.
  app.useLogger(new LoggerDeCorrelacao());
  app.setGlobalPrefix(prefixo);
  app.enableCors({
    origin: (process.env.WEB_ORIGIN ?? 'http://localhost:4000').split(','),
    credentials: true,
    // Sem isto o navegador ESCONDE o cabeçalho de resposta: o front recebe o
    // erro na tela e não consegue dizer qual correlação procurar no log. Hoje a
    // chamada é de mesma origem e passa sem; no dia em que a API atender em
    // outro host, passa a ser a diferença entre ter e não ter o fio.
    exposedHeaders: ['x-correlation-id'],
  });
  app.useGlobalFilters(new ZodExceptionFilter());
  const port = Number(process.env.API_PORT ?? 4001);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`Marketing OS API → http://localhost:${port}/api`);
}
bootstrap();
