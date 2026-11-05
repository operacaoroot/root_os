import { exigirBancoDescartavel } from './banco-de-teste';

/** Owner só semeia QA; aplicação e owner precisam apontar para o mesmo banco descartável. */
export function exigirParDeBancosDescartaveis(owner: string, app: string): void {
  exigirBancoDescartavel(owner, 'fixtures do papel restrito');
  exigirBancoDescartavel(app, 'runtime do papel restrito');
  const a = new URL(owner), b = new URL(app);
  const bancos = new Set(['/rls_test', '/marketing_os_test', '/rls_homolog_test']);
  if (!['127.0.0.1','localhost'].includes(a.hostname) || !['127.0.0.1','localhost'].includes(b.hostname)
    || !bancos.has(a.pathname) || a.pathname !== b.pathname || (a.port || '5432') !== (b.port || '5432')
    || b.username !== 'mktos_app' || a.username === b.username) {
    throw new Error('As duas conexões devem apontar para o mesmo banco local descartável, com papéis distintos e runtime mktos_app.');
  }
}
