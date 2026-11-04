import { describe, expect, it } from 'vitest';
import { isWorkActivityTestDatabase } from './work-atividade-database-guard';

const runner = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' };
const ciUrl = 'postgresql://fixture:fixture@localhost:5432/marketing_os_test';
const localUrl = 'postgresql://fixture:fixture@127.0.0.1:55582/rootos_m02_write';

describe('destinos descartáveis da suíte de atividade', () => {
  it.each([
    localUrl,
    'postgres://fixture:fixture@localhost:55582/rootos_m02_test',
    'postgresql://fixture:fixture@127.0.0.1:55582/rootos_dev?schema=public',
  ])('preserva o clone local autorizado: %s', url => {
    expect(isWorkActivityTestDatabase(url)).toBe(true);
  });

  it.each([ciUrl, ciUrl.replace('localhost', '127.0.0.1'), ciUrl + '?schema=public'])(
    'aceita o serviço descartável exato do runner hospedado: %s', url => {
      expect(isWorkActivityTestDatabase(url, runner)).toBe(true);
    },
  );

  it.each([
    {}, { CI: 'true' }, { GITHUB_ACTIONS: 'true' },
    { GITHUB_ACTIONS: 'false', RUNNER_ENVIRONMENT: 'github-hosted' },
    { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'self-hosted' },
  ])('não usa uma indicação genérica de CI como autorização: %j', env => {
    expect(isWorkActivityTestDatabase(ciUrl, env)).toBe(false);
  });

  it.each([
    ciUrl.replace('localhost', 'db.example.invalid'),
    ciUrl.replace('localhost', 'localhost.example.invalid'),
    ciUrl.replace(':5432/', ':55439/'),
    ciUrl.replace(':5432/', '/'),
    ciUrl.replace('/marketing_os_test', '/marketing_os'),
    ciUrl.replace('/marketing_os_test', '/marketing_os_test_backup'),
    ciUrl.replace('/marketing_os_test', '/marketing_os_test/other'),
    localUrl.replace('/rootos_m02_write', '/rootos_production'),
    localUrl.replace('postgresql:', 'https:'),
    localUrl + '/production',
    localUrl + '?host=db.example.invalid',
    localUrl + '?schema=private',
    localUrl + '?schema=public&schema=private',
    localUrl + '#ignored',
    '', 'not a URL',
  ])('recusa destino ou configuração fora da lista: %s', url => {
    expect(isWorkActivityTestDatabase(url, runner)).toBe(false);
  });
});
