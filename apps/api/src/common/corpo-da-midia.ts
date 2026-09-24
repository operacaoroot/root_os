import { createRequire } from 'node:module';
import type * as BodyParser from 'body-parser';
import type { NextFunction, Request, Response } from 'express';
import { PAUTA_TETO_DO_CORPO_DA_MIDIA } from '@mktos/shared';

/*
 * O CORPO GRANDE SÓ NAS ROTAS DE MÍDIA DO EPISÓDIO (MC-R).
 *
 * O Nest instala o `json()` do body-parser com o limite padrão de 100 kb para a
 * API inteira, e a transcrição de mais de ~40 min de fala (ou a edição com os
 * 3000 cortes que o schema aceita) passava disso: 413 antes de chegar ao
 * controller. Subir o limite global afrouxaria todas as rotas para socorrer
 * duas. O parser grande entra ANTES do padrão e só nestes caminhos, só em
 * POST; o do Nest vê `req._body` marcado e não lê o corpo de novo.
 *
 * O parser vai EMBRULHADO numa função com outro nome, e isso não é enfeite: o
 * Nest decide se instala o seu `json()` procurando na pilha do Express uma
 * camada cuja função se chame `jsonParser`. Registrar o `json()` cru aqui faria
 * o Nest achar que o parser já existe e NÃO instalar o padrão — todas as outras
 * rotas ficariam sem corpo.
 *
 * E o `json()` é o do MESMO body-parser que o Nest usa, achado a partir do
 * `@nestjs/platform-express`. Na raiz do monorepo há um Express 5 (de outro
 * pacote) com o body-parser 2 dentro, e é ele que `import 'express'` acharia:
 * outro parser, que não marca `req._body`, e o do Nest leria o corpo de novo e
 * devolveria 413 pelos 100 kb.
 */
const doNest = createRequire(createRequire(__filename).resolve('@nestjs/platform-express'));
const { json } = doNest('body-parser') as typeof BodyParser;

export const ROTAS_DE_MIDIA_DO_EPISODIO = ['/pauta/episodios/:id/midia', '/pauta/episodios/:id/transcricao'] as const;

interface ComUse {
  use(caminho: string, ...handlers: Array<(req: Request, res: Response, next: NextFunction) => void>): unknown;
}

/** Instala o parser grande nas rotas de mídia. Chamar antes do `listen` (o Nest instala o padrão no `init`). */
export function instalarCorpoDaMidia(app: ComUse, prefixo = 'api'): void {
  const parser = json({ limit: PAUTA_TETO_DO_CORPO_DA_MIDIA });
  const corpoGrandeDaMidia = (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'POST') return next();
    parser(req, res, next);
  };
  const base = prefixo ? `/${prefixo.replace(/^\/+|\/+$/g, '')}` : '';
  for (const rota of ROTAS_DE_MIDIA_DO_EPISODIO) app.use(`${base}${rota}`, corpoGrandeDaMidia);
}
