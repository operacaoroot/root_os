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

/**
 * A ata da sessão do comercial (C-9 da revisão, 13/10/2026): a transcrição de
 * uma conversa de 1h30 passa de 100 kb em JSON e morria em 413. O schema
 * (`ComercialAtaSchema`, 400 mil caracteres) é o teto de verdade; o corpo grande
 * só deixa a ata chegar até ele, com a mesma regra de sessão das rotas de mídia.
 */
export const ROTAS_DE_CORPO_GRANDE_DO_COMERCIAL = ['/comercial/lead/:id/ata'] as const;

/**
 * A ata colada no banco de atas do Trabalho (revisão PA-6, 18/10/2026): o
 * schema (`TrabAtaColarSchema`) promete 200 mil caracteres, e uma transcrição
 * de 1h30 já passava dos 100 kb do padrão. Mesma regra de sessão, e SÓ o POST
 * da própria rota: o `app.use` do Express casa também os caminhos de baixo
 * (`/trabalho/atas/:ref/sugestoes`, `/trabalho/atas/sugestoes/:id/aceitar`), e
 * esses continuam nos 100 kb.
 */
export const ROTAS_EXATAS_DE_CORPO_GRANDE = ['/trabalho/atas'] as const;

interface ComUse {
  use(caminho: string, ...handlers: Array<(req: Request, res: Response, next: NextFunction) => void>): unknown;
}

/**
 * Instala o parser grande nas rotas de mídia. Chamar antes do `listen` (o Nest
 * instala o padrão no `init`).
 *
 * O teto maior é para quem já entrou: este middleware roda ANTES do guarda de
 * sessão, e sem conferir o token qualquer anônimo faria a API ler e parsear
 * 2 MB para só então ouvir 401 — vinte vezes o custo de qualquer outra rota.
 * Sem sessão válida, a requisição segue para o parser padrão (100 kb → 413) e
 * o guarda responde o resto.
 */
export function instalarCorpoDaMidia(app: ComUse, prefixo: string, ehSessao: (token: string) => boolean): void {
  const parser = json({ limit: PAUTA_TETO_DO_CORPO_DA_MIDIA });
  const corpoGrandeDaMidia = (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'POST') return next();
    const auth = req.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ') || !ehSessao(auth.slice(7))) return next();
    parser(req, res, next);
  };
  // Montado com `app.use`, o `req.path` é o resto do caminho depois da rota: '/' é ela mesma.
  const soARotaExata = (req: Request, res: Response, next: NextFunction) => {
    if (req.path !== '/' && req.path !== '') return next();
    corpoGrandeDaMidia(req, res, next);
  };
  const base = prefixo ? `/${prefixo.replace(/^\/+|\/+$/g, '')}` : '';
  for (const rota of [...ROTAS_DE_MIDIA_DO_EPISODIO, ...ROTAS_DE_CORPO_GRANDE_DO_COMERCIAL]) app.use(`${base}${rota}`, corpoGrandeDaMidia);
  for (const rota of ROTAS_EXATAS_DE_CORPO_GRANDE) app.use(`${base}${rota}`, soARotaExata);
}
