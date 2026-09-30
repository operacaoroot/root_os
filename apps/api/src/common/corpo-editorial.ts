import { createRequire } from 'node:module';
import type * as BodyParser from 'body-parser';
import type { NextFunction, Request, Response } from 'express';

// Mesmo body-parser do Nest: o parser padrão continua em 100 kb nas outras rotas.
const doNest = createRequire(createRequire(__filename).resolve('@nestjs/platform-express'));
const { json } = doNest('body-parser') as typeof BodyParser;

interface ComUse {
  use(path: string, ...handlers: Array<(req: Request, res: Response, next: NextFunction) => void>): unknown;
}

/** Permite corpo editorial de 512 KiB UTF-8 sem elevar o limite global. */
export function instalarCorpoEditorial(app: ComUse, prefixo: string, ehSessao: (token: string) => boolean): void {
  // JSON pode escapar um byte de texto como seis caracteres (\u0000). O teto
  // de transporte cobre essa expansão; o serviço mede o corpo UTF-8 real.
  const parser = json({ limit: '4mb' });
  const corpoEditorial = (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'POST') return next();
    const auth = req.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ') || !ehSessao(auth.slice(7))) return next();
    parser(req, res, next);
  };
  const base = prefixo ? `/${prefixo.replace(/^\/+|\/+$/g, '')}` : '';
  app.use(`${base}/trabalho/tarefas/:taskId/artefatos/:artifactId/versoes`, corpoEditorial);
}
