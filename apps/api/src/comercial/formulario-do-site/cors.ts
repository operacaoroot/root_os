import type { IncomingMessage, ServerResponse } from 'node:http';

import { CORPO_MAXIMO_DO_FORMULARIO, ORIGENS_DO_FORMULARIO_DO_SITE } from '@mktos/shared';

/*
 * O CORS DO FORMULÁRIO DO SITE (rodada dos agentes, 21/10/2026, CO-15).
 *
 * `POST /api/publico/lead` é a única rota da API que o site da Root
 * (operacaoroot.com) chama do navegador do visitante. O CORS do resto da API
 * continua o de sempre (`WEB_ORIGIN`, no `main.ts`): este middleware é montado
 * SÓ no caminho `/api/publico` e ANTES do CORS geral, porque o CORS geral
 * responde o preflight (`OPTIONS`) sozinho e o recusaria.
 *
 *   · preflight de uma das duas origens: 204 com as permissões exatas (POST,
 *     `Content-Type`, sem credencial); de outra origem: 403 sem cabeçalho;
 *   · POST com `Origin` de outra origem: 403 antes de ler o corpo (o navegador
 *     de um terceiro não grava lead aqui; sem `Origin`, como um servidor ou um
 *     teste de linha de comando, passa e cai no teto por origem do controlador);
 *   · corpo declarado acima de 16 KB: 413 antes de o parser ler.
 *
 * Nada de cookie: a rota é anônima e a resposta não leva credencial.
 */

type Proximo = (erro?: unknown) => void;

function responder(res: ServerResponse, status: number, corpo?: Record<string, unknown>): void {
  res.statusCode = status;
  if (corpo) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(corpo));
  } else {
    res.end();
  }
}

/** A origem do pedido, sem barra no fim; `null` sem cabeçalho. */
export function origemDoPedido(req: IncomingMessage): string | null {
  const o = req.headers.origin;
  return typeof o === 'string' && o ? o.replace(/\/+$/, '') : null;
}

export function corsDoFormularioDoSite(origens: readonly string[] = ORIGENS_DO_FORMULARIO_DO_SITE) {
  const permitidas = new Set(origens);
  return (req: IncomingMessage, res: ServerResponse, proximo: Proximo): void => {
    const origem = origemDoPedido(req);
    const permitida = origem !== null && permitidas.has(origem);
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      if (!permitida) return responder(res, 403);
      res.setHeader('Access-Control-Allow-Origin', origem!);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
      return responder(res, 204);
    }
    if (origem !== null && !permitida) return responder(res, 403, { statusCode: 403, message: 'Origem não autorizada.' });
    if (permitida) res.setHeader('Access-Control-Allow-Origin', origem!);
    const declarado = Number(req.headers['content-length'] ?? 0);
    if (Number.isFinite(declarado) && declarado > CORPO_MAXIMO_DO_FORMULARIO) return responder(res, 413, { statusCode: 413, message: 'Formulário grande demais.' });
    proximo();
  };
}
