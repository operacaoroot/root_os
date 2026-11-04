import type { IncomingMessage, ServerResponse } from 'node:http';

import { ORIGENS_DO_FORMULARIO_DO_SITE } from '@mktos/shared';

import { origemDoPedido } from '../comercial/formulario-do-site/cors';

/*
 * O PIXEL NO SITE (etapa 8, #12, 04/11/2026): `POST /events/track` aceita o site da empresa
 * (operacaoroot.com, a mesma lista do formulário) além das origens do próprio OS. Só abre o
 * CORS: nunca recusa o evento (a rota é pública e o pixel de mesma origem segue igual), e o
 * preflight de origem fora da lista volta sem a permissão, que o navegador barra sozinho.
 */
type Proximo = (erro?: unknown) => void;

export function corsDoPixel(origens: readonly string[] = [...ORIGENS_DO_FORMULARIO_DO_SITE, ...(process.env.WEB_ORIGIN ?? '').split(',').filter(Boolean)]) {
  const permitidas = new Set(origens.map((o) => o.trim()).filter(Boolean));
  return (req: IncomingMessage, res: ServerResponse, proximo: Proximo): void => {
    const origem = origemDoPedido(req);
    const permitida = origem !== null && permitidas.has(origem);
    res.setHeader('Vary', 'Origin');
    if (permitida) res.setHeader('Access-Control-Allow-Origin', origem!);
    if (req.method === 'OPTIONS') {
      if (permitida) {
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Max-Age', '600');
      }
      res.statusCode = 204;
      res.end();
      return;
    }
    proximo();
  };
}
