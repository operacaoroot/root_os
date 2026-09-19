const REMESSA_PATH = /^\/api\/conector\/remessa(?:\/|$)/i;

type BodyParserApp = {
  useBodyParser: (parser: 'json' | 'urlencoded', options?: Record<string, unknown>) => unknown;
};

function isJson(req: any): boolean {
  return /^application\/json(?:;|$)/i.test(String(req.headers?.['content-type'] ?? ''));
}

function isRemessa(req: any): boolean {
  return REMESSA_PATH.test(String(req.path ?? req.originalUrl ?? ''));
}

/**
 * Mantém o limite histórico das rotas da API e abre um limite maior somente
 * para o JSON de remessa, cujo contrato já limita arquivo/lote no serviço.
 * O mesmo helper é usado pelo boot e pelo smoke compilado.
 */
export function configurarBodyParser(app: BodyParserApp): void {
  app.useBodyParser('json', {
    limit: '12mb',
    type: (req: any) => isRemessa(req) && isJson(req),
  });
  app.useBodyParser('json', {
    limit: '100kb',
    type: (req: any) => !isRemessa(req) && isJson(req),
  });
  app.useBodyParser('urlencoded', { extended: true, limit: '100kb' });
}
