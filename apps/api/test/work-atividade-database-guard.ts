export type WorkActivityTestEnvironment = {
  GITHUB_ACTIONS?: string;
  RUNNER_ENVIRONMENT?: string;
  CI?: string;
};

/** Valida destinos descartáveis desta suíte, sem abrir conexão. */
export function isWorkActivityTestDatabase(url: string, env: WorkActivityTestEnvironment = {}): boolean {
  try {
    const target = new URL(url);
    if (!['postgres:', 'postgresql:'].includes(target.protocol) ||
        !['127.0.0.1', 'localhost'].includes(target.hostname) || target.hash) return false;
    // Prisma accepts connection parameters; do not let a query redirect this destination.
    const params = [...target.searchParams.entries()];
    if (params.length && !(params.length === 1 && params[0][0] === 'schema' && params[0][1] === 'public')) return false;
    const localClone = target.port === '55582' &&
      /^\/rootos_[a-z0-9_-]*(?:write|test|dev|local)[a-z0-9_-]*$/.test(target.pathname);
    const hostedRunner = env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted' &&
      target.port === '5432' && target.pathname === '/marketing_os_test';
    return localClone || hostedRunner;
  } catch {
    return false;
  }
}
