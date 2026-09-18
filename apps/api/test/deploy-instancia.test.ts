import { describe, it, expect, beforeAll, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Esta suíte cria repositórios Git reais e executa dezenas de processos Bash.
// Isolada termina em ~30 s; junto das 48 suítes da API há contenção de CPU/IO,
// então o timeout unitário padrão de 5 s produz falso negativo sem indicar trava.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

/*
 * ETAPA P1 DO PLANO DE PRODUTO — instalar e atualizar uma instância SEM tocar em servidor.
 *
 * Tudo hermético: `docker` e `curl` são stubs (deploy/test-stubs/bin) que registram cada
 * chamada; o git é real, contra um repositório de FIXTURE criado aqui, com quatro tags:
 *   v1  compose + migrations 001, 002
 *   v2  + migration 003 (a atualização normal)
 *   v0  só a migration 001 (voltar para ela é downgrade)
 *   v3  compose exigindo `${ROOTOS_VAR_NOVA}` sem default (compatibilidade)
 *   v4  sem diretório de migrations (inventário ilegível deve falhar fechado)
 * O que se mede é a ORDEM das chamadas, o que fica em disco e o que NUNCA aparece
 * (segredo em stdout, segredo em argv, .env tocado antes do corte).
 */

const RAIZ = (() => {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'deploy', 'instalar.sh'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('não achei a raiz do repositório');
})();
const STUBS = path.join(RAIZ, 'deploy', 'test-stubs');
// O stub de docker delega SÓ `compose config` ao docker de verdade (é o que funde o compose do painel).
const DOCKER_REAL = spawnSync('bash', ['-c', 'command -v docker'], { encoding: 'utf8' }).stdout.trim();
const COMPOSE_REAL = readFileSync(path.join(RAIZ, 'docker-compose.yml'), 'utf8');

function sh(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string | undefined> } = {}) {
  return spawnSync(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, encoding: 'utf8' });
}
function git(cwd: string, ...args: string[]) {
  const r = sh('git', args, { cwd, env: { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** O repositório de fixture, com as quatro tags. Devolve o caminho e os commits. */
function fixture(): { origem: string; commits: Record<string, string> } {
  const origem = mkdtempSync(path.join(tmpdir(), 'p1-origem-'));
  git(origem, 'init', '-q', '-b', 'main');
  const mig = (n: string) => {
    mkdirSync(path.join(origem, 'apps/api/prisma/migrations', n), { recursive: true });
    writeFileSync(path.join(origem, 'apps/api/prisma/migrations', n, 'migration.sql'), `-- ${n}\n`);
  };
  mkdirSync(path.join(origem, 'deploy'), { recursive: true });
  writeFileSync(path.join(origem, 'deploy/backup-db.sh'), readFileSync(path.join(STUBS, 'backup-db.sh')));
  writeFileSync(path.join(origem, 'docker-compose.yml'), COMPOSE_REAL);
  const commits: Record<string, string> = {};
  mig('20260101000000_um');
  git(origem, 'add', '-A'); git(origem, 'commit', '-qm', 'v0'); git(origem, 'tag', 'v0'); commits.v0 = git(origem, 'rev-parse', 'HEAD');
  mig('20260102000000_dois');
  git(origem, 'add', '-A'); git(origem, 'commit', '-qm', 'v1'); git(origem, 'tag', 'v1'); commits.v1 = git(origem, 'rev-parse', 'HEAD');
  mig('20260103000000_tres');
  git(origem, 'add', '-A'); git(origem, 'commit', '-qm', 'v2'); git(origem, 'tag', 'v2'); commits.v2 = git(origem, 'rev-parse', 'HEAD');
  writeFileSync(path.join(origem, 'docker-compose.yml'), COMPOSE_REAL.replace('API_PORT: "4001"', 'API_PORT: "4001"\n      EXIGIDA: ${ROOTOS_VAR_NOVA}'));
  git(origem, 'add', '-A'); git(origem, 'commit', '-qm', 'v3'); git(origem, 'tag', 'v3'); commits.v3 = git(origem, 'rev-parse', 'HEAD');
  rmSync(path.join(origem, 'apps/api/prisma/migrations'), { recursive: true });
  git(origem, 'add', '-A'); git(origem, 'commit', '-qm', 'v4'); git(origem, 'tag', 'v4'); commits.v4 = git(origem, 'rev-parse', 'HEAD');
  // v5: volta às migrations de v2 mas com a PRIMEIRA (já aplicada) alterada — histórico reescrito
  git(origem, 'checkout', '-q', 'v2', '--', 'apps/api/prisma/migrations', 'docker-compose.yml');
  writeFileSync(path.join(origem, 'apps/api/prisma/migrations/20260101000000_um/migration.sql'), '-- um, ALTERADA depois de aplicada\n');
  git(origem, 'add', '-A'); git(origem, 'commit', '-qm', 'v5'); git(origem, 'tag', 'v5'); commits.v5 = git(origem, 'rev-parse', 'HEAD');
  return { origem, commits };
}

interface Caixa { base: string; log: string; images: string; origem: string; commits: Record<string, string> }
function caixa(): Caixa {
  const dir = mkdtempSync(path.join(tmpdir(), 'p1-caixa-'));
  const { origem, commits } = fixture();
  const log = path.join(dir, 'stub.log'); writeFileSync(log, '');
  const images = path.join(dir, 'images'); writeFileSync(images, '');
  return { base: path.join(dir, 'base'), log, images, origem, commits };
}
/**
 * AMBIENTE LIMPO, de propósito: os scripts NÃO herdam o shell de quem roda a suíte.
 * Uma DATABASE_URL, TEST_DATABASE_URL ou chave real esquecida no ambiente do
 * desenvolvedor não pode chegar a instalar.sh/atualizar.sh — e a suíte é o lugar
 * que prova isso. Só PATH (com os stubs na frente), HOME e TMPDIR passam.
 */
function rodar(c: Caixa, script: 'instalar' | 'atualizar', args: string[], env: Record<string, string> = {}) {
  return spawnSync('bash', [path.join(RAIZ, 'deploy', `${script}.sh`), ...args], {
    encoding: 'utf8',
    env: {
      PATH: `${path.join(STUBS, 'bin')}:${process.env.PATH}`,
      HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? tmpdir(), LANG: 'C.UTF-8',
      STUB_LOG: c.log, STUB_IMAGES: c.images, STUB_REAL_DOCKER: DOCKER_REAL, ROOTOS_BASE: c.base, ROOTOS_REPO: c.origem,
      ESPERA_ENTRE_TENTATIVAS: '0', ROOTOS_ANTHROPIC_API_KEY: 'sk-ant-sintetica', ...env,
    },
  });
}
const lerLog = (c: Caixa) => readFileSync(c.log, 'utf8');
const lerEnv = (c: Caixa, amb: string) => readFileSync(path.join(c.base, amb, '.env'), 'utf8');
const chave = (env: string, k: string) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) ?? [])[1] ?? '';
const modo = (p: string) => (statSync(p).mode & 0o777).toString(8);
const semVersao = (env: string) => env.replace(/^ROOTOS_(VERSION|COMMIT|IMAGE)=.*$/gm, '');
const instalarProd = (c: Caixa, extra: string[] = [], env: Record<string, string> = {}) =>
  rodar(c, 'instalar', ['--ambiente', 'producao', '--tag', 'v1', '--dominio', 'os.cliente.teste', '--bind-ip', '172.16.0.1', ...extra], env);

describe('P1: instalar.sh cria uma instância isolada, sem imprimir segredo', () => {
  let c: Caixa; let r: ReturnType<typeof rodar>;
  beforeAll(() => { c = caixa(); r = instalarProd(c, [], { ROOTOS_ANTHROPIC_API_KEY: '', ROOTOS_OPENAI_API_KEY: 'sk-openai-sintetica' }); });

  it('sobe: exit 0, arquivos no lugar e com 0600', () => {
    expect(r.status, r.stderr + r.stdout).toBe(0);
    const inst = path.join(c.base, 'producao');
    for (const f of ['.env', 'override.yml', 'versoes.log', 'segredos-iniciais.txt']) expect(existsSync(path.join(inst, f)), f).toBe(true);
    expect(modo(path.join(inst, '.env'))).toBe('600');
    expect(modo(path.join(inst, 'segredos-iniciais.txt'))).toBe('600');
    expect(existsSync(path.join(inst, 'repo', 'docker-compose.yml'))).toBe(true);
    expect(git(path.join(inst, 'repo'), 'rev-parse', 'HEAD')).toBe(c.commits.v1);
  });

  it('a imagem é imutável por tag+commit e o build a produziu', () => {
    const env = lerEnv(c, 'producao');
    expect(chave(env, 'ROOTOS_IMAGE')).toBe(`rootos-app:v1-${c.commits.v1.slice(0, 12)}`);
    expect(chave(env, 'ROOTOS_COMMIT')).toBe(c.commits.v1);
    expect(readFileSync(c.images, 'utf8')).toContain(chave(env, 'ROOTOS_IMAGE'));
    expect(readFileSync(path.join(c.base, 'producao', 'override.yml'), 'utf8')).toContain(`image: ${chave(env, 'ROOTOS_IMAGE')}`);
  });

  it('a ordem: build → banco → migrate → seed → política → up', () => {
    const l = lerLog(c);
    const i = (s: string) => l.indexOf(s);
    expect(i('build api')).toBeGreaterThan(-1);
    expect(i('build api')).toBeLessThan(i('up -d db redis minio'));
    expect(i('up -d db redis minio')).toBeLessThan(i('migrate deploy'));
    expect(i('migrate deploy')).toBeLessThan(i('pnpm db:seed'));
    expect(i('pnpm db:seed\n') === -1 ? i('pnpm db:seed') : i('pnpm db:seed')).toBeLessThan(i('db:seed:politica'));
    expect(i('db:seed:politica')).toBeLessThan(i('up -d --no-build'));
  });

  it('nenhum segredo em stdout, stderr ou argv do docker', () => {
    const env = lerEnv(c, 'producao');
    const segredos = readFileSync(path.join(c.base, 'producao', 'segredos-iniciais.txt'), 'utf8');
    const senhaAdmin = chave(segredos, 'ADMIN_PASSWORD');
    for (const s of [chave(env, 'DB_PASSWORD'), chave(env, 'JWT_SECRET'), chave(env, 'ENCRYPTION_KEY'), senhaAdmin, 'sk-openai-sintetica']) {
      expect(s.length).toBeGreaterThan(8);
      expect(r.stdout, `segredo em stdout: ${s.slice(0, 4)}…`).not.toContain(s);
      expect(r.stderr).not.toContain(s);
      expect(lerLog(c), `segredo em argv do docker: ${s.slice(0, 4)}…`).not.toContain(s);
    }
    // a senha do seed viaja por `-e ADMIN_PASSWORD` sem valor
    expect(lerLog(c)).toMatch(/run --rm --no-deps -e ADMIN_PASSWORD -e MCP_SERVICE_PASSWORD api/);
  });

  it('a mensagem final separa o que foi provado do que não foi', () => {
    expect(r.stdout).toMatch(/Provado por este script/);
    expect(r.stdout).toMatch(/NÃO provado por este script: login humano/);
  });

  it('o provedor de LLM segue a chave que veio; a senha inicial é da conta que o seed cria', () => {
    expect(chave(lerEnv(c, 'producao'), 'LLM_PROVIDER')).toBe('openai');
    const segredos = readFileSync(path.join(c.base, 'producao', 'segredos-iniciais.txt'), 'utf8');
    expect(segredos).toContain('admin@marketing-os.local');
  });

  it('homologação ao lado: nomes e portas todos distintos; portas bindadas só no IP interno', () => {
    const h = rodar(c, 'instalar', ['--ambiente', 'homologacao', '--tag', 'v2', '--dominio', 'homolog.cliente.teste', '--bind-ip', '172.16.0.1']);
    expect(h.status, h.stderr).toBe(0);
    const p = lerEnv(c, 'producao'), q = lerEnv(c, 'homologacao');
    for (const k of ['ROOTOS_PROJECT', 'ROOTOS_CONTAINER_PREFIX', 'ROOTOS_NETWORK_NAME', 'DB_NAME', 'DB_PASSWORD', 'JWT_SECRET', 'WEB_HOST_PORT', 'API_HOST_PORT', 'DB_PORT', 'REDIS_PORT', 'MINIO_PORT', 'MINIO_CONSOLE_PORT']) {
      expect(chave(p, k), k).not.toBe(chave(q, k));
    }
    const ov = readFileSync(path.join(c.base, 'homologacao', 'override.yml'), 'utf8');
    expect(ov).toMatch(/"172\.16\.0\.1:4100:4000"/);
    expect(ov).not.toMatch(/0\.0\.0\.0/);
    // homologação nasce SEM relógio, reindexação e sincronização externa
    expect(chave(q, 'ROTINAS_CRON')).toBe('off');
    for (const k of ['BIO_SYNC_INTERVAL_MIN', 'BIO_BRIDGE_INTERVAL_MIN', 'CLICKUP_SYNC_INTERVAL_MIN', 'ASAAS_SYNC_INTERVAL_MIN', 'PLUGGY_SYNC_INTERVAL_MIN', 'OBSIDIAN_REINDEX_MIN']) {
      expect(chave(q, k), k).toBe('0');
    }
    expect(chave(p, 'ROTINAS_CRON')).toBe('on');
  });

  it('recusa reinstalar por cima e recusa irmã com porta igual', () => {
    expect(instalarProd(c).status).not.toBe(0);
    const irmaDir = path.join(c.base, 'sandbox'); mkdirSync(irmaDir);
    writeFileSync(path.join(irmaDir, '.env'), 'ROOTOS_PROJECT=x\nROOTOS_CONTAINER_PREFIX=y\nROOTOS_NETWORK_NAME=z\nWEB_HOST_PORT=4200\nAPI_HOST_PORT=4201\nDB_PORT=5443\nREDIS_PORT=6395\nMINIO_PORT=9020\nMINIO_CONSOLE_PORT=9021\n');
    const c2 = caixa(); mkdirSync(c2.base, { recursive: true }); mkdirSync(path.join(c2.base, 'sandbox'));
    writeFileSync(path.join(c2.base, 'sandbox', '.env'), 'DB_PORT=5443\n');
    const h = rodar(c2, 'instalar', ['--ambiente', 'homologacao', '--tag', 'v1', '--dominio', 'h.teste']);
    expect(h.status).not.toBe(0);
    expect(h.stderr).toMatch(/NÃO podem compartilhar nome nem porta/);
    expect(existsSync(path.join(c2.base, 'homologacao', 'repo'))).toBe(false);
  });
});

describe('P1: instalar.sh valida o que não se gera', () => {
  it('sem chave de LLM recusa, a menos que --sem-llm', () => {
    const c = caixa();
    expect(instalarProd(c, [], { ROOTOS_ANTHROPIC_API_KEY: '' }).status).toBe(64);
    const c2 = caixa();
    expect(instalarProd(c2, ['--sem-llm'], { ROOTOS_ANTHROPIC_API_KEY: '' }).status).toBe(0);
    expect(chave(lerEnv(c2, 'producao'), 'LLM_PROVIDER')).toBe('');
  });

  it('--cliente exige --admin-email E as credenciais do Google no ambiente; provisiona por argv, sem sh -c', () => {
    const c = caixa();
    expect(instalarProd(c, ['--cliente', 'acme']).status).toBe(64);
    expect(instalarProd(c, ['--cliente', 'acme', '--admin-email', 'dono@acme.com.br']).status).toBe(64);
    const r = instalarProd(c, ['--cliente', 'acme', '--admin-email', 'dono@acme.com.br'], { ROOTOS_GOOGLE_CLIENT_ID: 'id-sintetico', ROOTOS_GOOGLE_CLIENT_SECRET: 'segredo-google-sintetico' });
    expect(r.status, r.stderr).toBe(0);
    const env = lerEnv(c, 'producao');
    expect(chave(env, 'GOOGLE_CLIENT_ID')).toBe('id-sintetico');
    expect(chave(env, 'GOOGLE_REDIRECT_URI')).toBe('https://os.cliente.teste/api/google/callback');
    expect(chave(env, 'GOOGLE_LOGIN_ALLOWED_EMAILS')).toBe('dono@acme.com.br');
    expect(lerLog(c)).toMatch(/api node dist\/scripts\/provisionar-tenant\.js acme --modulos todos --admin dono@acme\.com\.br/);
    expect(lerLog(c)).not.toMatch(/provisionar-tenant.*sh -c/);
    expect(r.stdout + r.stderr).not.toContain('segredo-google-sintetico');
  });

  it('e-mail ou slug com injeção são recusados antes de qualquer coisa', () => {
    const c = caixa();
    const env = { ROOTOS_GOOGLE_CLIENT_ID: 'i', ROOTOS_GOOGLE_CLIENT_SECRET: 's' };
    expect(instalarProd(c, ['--cliente', 'acme', '--admin-email', "dono@acme.com'; rm -rf /"], env).status).toBe(64);
    expect(instalarProd(c, ['--cliente', 'acme;id', '--admin-email', 'dono@acme.com.br'], env).status).toBe(64);
    expect(lerLog(c)).toBe('');
  });

  it('tag, domínio e bind-ip inválidos são recusados; --so-checar não deixa nada', () => {
    const c = caixa();
    expect(rodar(c, 'instalar', ['--ambiente', 'producao', '--tag', 'v1;x', '--dominio', 'a.b']).status).toBe(64);
    expect(rodar(c, 'instalar', ['--ambiente', 'producao', '--tag', 'v1', '--dominio', 'https://a.b']).status).toBe(64);
    expect(rodar(c, 'instalar', ['--ambiente', 'producao', '--tag', 'v1', '--dominio', 'a.b', '--bind-ip', 'lo']).status).toBe(64);
    const r = instalarProd(c, ['--so-checar']);
    expect(r.status, r.stderr).toBe(0);
    // NADA persistente: nem a base, nem a instância, nem segredo em disco
    expect(existsSync(c.base)).toBe(false);
    expect(r.stdout).toMatch(/nada foi criado/);
    expect(r.stdout).not.toMatch(/[0-9a-f]{32}/); // nenhum segredo gerado escapa
    // a pré-condição (`docker compose version`) é legítima em --so-checar; build/up não
    expect(lerLog(c)).not.toMatch(/build|up -d|run --rm/);
    // e o único temporário próprio foi limpo
    const restos = readdirSync(tmpdir()).filter((f) => f.startsWith('rootos-so-checar.'));
    expect(restos).toEqual([]);
  });

  it('recusa saúde degradada e identidade ausente ou com commit divergente', () => {
    const degradada = caixa();
    expect(instalarProd(degradada, [], { STUB_HEALTH_STATUS: 'degraded' }).status).not.toBe(0);
    const ausente = caixa();
    expect(instalarProd(ausente, [], { STUB_SEM_IDENTIDADE: '1' }).status).not.toBe(0);
    const divergente = caixa();
    const r = instalarProd(divergente, [], { STUB_COMMIT: 'commit-errado' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/commit.*esperava/);
  });
});

describe('P1: atualizar.sh — compatibilidade, ensaio, corte transacional e volta', () => {
  function instalada(): Caixa {
    const c = caixa();
    const r = instalarProd(c);
    if (r.status !== 0) throw new Error(r.stderr);
    mkdirSync(path.join(c.base, 'producao', 'repo', 'ferramentas', 'propostas'), { recursive: true });
    writeFileSync(path.join(c.base, 'producao', 'repo', 'ferramentas', 'propostas', 'tool.ts'), 'export const x = 1;\n');
    writeFileSync(c.log, '');
    return c;
  }
  const APLICADAS_V1 = '20260101000000_um,20260102000000_dois';

  it('v1 → v2: backup antes, ensaio antes, migrate real antes da política, corte só no fim; .env e ferramentas preservados', () => {
    const c = instalada();
    const envAntes = lerEnv(c, 'producao');
    const r = rodar(c, 'atualizar', ['--ambiente', 'producao', '--tag', 'v2'], { STUB_APPLIED: APLICADAS_V1, STUB_VERSAO: 'v2' });
    expect(r.status, r.stderr + r.stdout).toBe(0);
    const l = lerLog(c); const i = (s: string) => l.indexOf(s);
    expect(i('_prisma_migrations')).toBeGreaterThan(-1);
    const dumps = readdirSync(path.join(c.base, 'producao', 'backups', 'diario'));
    expect(dumps.length).toBe(1);
    expect(i('build api')).toBeLessThan(i('pnpm smoke'));
    expect(i('pnpm smoke')).toBeLessThan(i('migrate deploy\n') === -1 ? l.lastIndexOf('migrate deploy') : l.lastIndexOf('migrate deploy'));
    expect(l.lastIndexOf('migrate deploy')).toBeLessThan(i('db:seed:politica'));
    expect(i('db:seed:politica')).toBeLessThan(i('up -d --no-build api web'));
    // o ensaio recebeu DATABASE_URL sem valor (o valor tem a senha)
    expect(l).toMatch(/run --rm --network rootos-producao-net -e DATABASE_URL -e ROTINAS_CRON=off/);
    expect(l).not.toContain(chave(envAntes, 'DB_PASSWORD'));
    const envDepois = lerEnv(c, 'producao');
    expect(chave(envDepois, 'ROOTOS_VERSION')).toBe('v2');
    expect(chave(envDepois, 'ROOTOS_IMAGE')).toBe(`rootos-app:v2-${c.commits.v2.slice(0, 12)}`);
    expect(semVersao(envDepois), 'o .env mudou fora das 3 chaves de versão').toBe(semVersao(envAntes));
    expect(existsSync(path.join(c.base, 'producao', 'repo', 'ferramentas', 'propostas', 'tool.ts'))).toBe(true);
    expect(git(path.join(c.base, 'producao', 'repo'), 'rev-parse', 'HEAD')).toBe(c.commits.v2);
    expect(readFileSync(path.join(c.base, 'producao', 'versoes.log'), 'utf8')).toMatch(/atualizado anterior=rootos-app:v1-/);
    expect(readdirSync(path.join(c.base, 'producao')).some((f) => f.startsWith('.env.bak.'))).toBe(true);
    expect(readdirSync(path.join(c.base, 'producao')).some((f) => f.startsWith('.override.novo.'))).toBe(false);
  });

  it('downgrade (migration aplicada que não existe na tag) é recusado sem tocar em nada', () => {
    const c = instalada();
    const r = rodar(c, 'atualizar', ['--ambiente', 'producao', '--tag', 'v0'], { STUB_APPLIED: APLICADAS_V1 });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/NÃO existem na tag v0/);
    expect(lerLog(c)).not.toContain('build api');
    expect(existsSync(path.join(c.base, 'producao', 'backups', 'diario'))).toBe(false);
  });

  it('não conseguir ler _prisma_migrations é recusa, não "nada aplicado"', () => {
    const c = instalada();
    const r = rodar(c, 'atualizar', ['--ambiente', 'producao', '--tag', 'v2'], { STUB_FAIL_PSQL: '1' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/não consegui ler _prisma_migrations/);
    expect(lerLog(c)).not.toContain('build api');
  });

  it('não conseguir listar as migrations da tag é recusa, não lista vazia', () => {
    const c = instalada();
    const r = rodar(c, 'atualizar', ['--ambiente', 'producao', '--tag', 'v4'], { STUB_APPLIED: APLICADAS_V1 });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/não consegui ler apps\/api\/prisma\/migrations/);
    expect(lerLog(c)).not.toContain('build api');
  });

  it('compose da tag nova exigindo variável ausente do .env é recusado antes do backup', () => {
    const c = instalada();
    const r = rodar(c, 'atualizar', ['--ambiente', 'producao', '--tag', 'v3'], { STUB_APPLIED: APLICADAS_V1 });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/ROOTOS_VAR_NOVA/);
    expect(existsSync(path.join(c.base, 'producao', 'backups', 'diario'))).toBe(false);
  });

  it('ensaio reprovado: instância intocada (.env, override, HEAD), sem migrate real', () => {
    const c = instalada();
    const envAntes = lerEnv(c, 'producao'); const ovAntes = readFileSync(path.join(c.base, 'producao', 'override.yml'), 'utf8');
    const r = rodar(c, 'atualizar', ['--ambiente', 'producao', '--tag', 'v2'], { STUB_APPLIED: APLICADAS_V1, STUB_FAIL_ENSAIO: '1' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/ENSAIO reprovou/);
    expect(lerEnv(c, 'producao')).toBe(envAntes);
    expect(readFileSync(path.join(c.base, 'producao', 'override.yml'), 'utf8')).toBe(ovAntes);
    expect(git(path.join(c.base, 'producao', 'repo'), 'rev-parse', 'HEAD')).toBe(c.commits.v1);
    const l = lerLog(c);
    expect(l.indexOf('migrate deploy')).toBe(l.lastIndexOf('migrate deploy')); // só o do ensaio
    expect(l).not.toContain('db:seed:politica');
  });

  it('imagem anterior incompatível com schema novo aborta antes do banco real', () => {
    const c = instalada();
    const envAntes = lerEnv(c, 'producao');
    const r = rodar(c, 'atualizar', ['--ambiente', 'producao', '--tag', 'v2'], { STUB_APPLIED: APLICADAS_V1, STUB_FAIL_ANTIGA: '1' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/imagem anterior não roda sobre o schema novo/);
    expect(lerEnv(c, 'producao')).toBe(envAntes);
    const l = lerLog(c);
    expect(l.match(/migrate deploy/g)?.length).toBe(1); // apenas a cópia de ensaio
    expect(l).not.toContain('db:seed:politica');
  });

  it('saúde falhou depois do corte: .env e override restaurados byte a byte, runtime re-subido na imagem anterior', () => {
    const c = instalada();
    const envAntes = lerEnv(c, 'producao'); const ovAntes = readFileSync(path.join(c.base, 'producao', 'override.yml'), 'utf8');
    // saúde falha para TODAS as versões: restaura os arquivos, re-sobe a anterior, mas NÃO
    // pode afirmar que voltou — sai 2, "recuperação não confirmada"
    const r = rodar(c, 'atualizar', ['--ambiente', 'producao', '--tag', 'v2'], { STUB_APPLIED: APLICADAS_V1, STUB_FAIL_HEALTH: '1' });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/RECUPERAÇÃO NÃO ESTÁ CONFIRMADA/);
    expect(r.stderr).toMatch(/NÃO é rollback de schema/);
    expect(r.stderr).toMatch(/backups\/diario\/rootos-.*\.sql\.gz/);
    expect(lerEnv(c, 'producao')).toBe(envAntes);
    expect(readFileSync(path.join(c.base, 'producao', 'override.yml'), 'utf8')).toBe(ovAntes);
    const l = lerLog(c);
    const ultimoUp = l.lastIndexOf('up -d --no-build api web');
    expect(ultimoUp).toBeGreaterThan(l.indexOf('up -d --no-build api web'));
    expect(readFileSync(path.join(c.base, 'producao', 'versoes.log'), 'utf8')).toMatch(/tentou voltar de=rootos-app:v2-.*NÃO CONFIRMADA/);
    expect(git(path.join(c.base, 'producao', 'repo'), 'rev-parse', 'HEAD')).toBe(c.commits.v1);
  });

  it('up falhou no meio do corte (interrupção): o trap restaura', () => {
    const c = instalada();
    const envAntes = lerEnv(c, 'producao');
    const r = rodar(c, 'atualizar', ['--ambiente', 'producao', '--tag', 'v2'], { STUB_APPLIED: APLICADAS_V1, STUB_FAIL_UP: '1' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/CORTE INTERROMPIDO/);
    expect(lerEnv(c, 'producao')).toBe(envAntes);
  });

  it('--voltar re-aponta para a versão anterior registrada; --so-checar não toca', () => {
    const c = instalada();
    expect(rodar(c, 'atualizar', ['--ambiente', 'producao', '--tag', 'v2'], { STUB_APPLIED: APLICADAS_V1, STUB_VERSAO: 'v2' }).status).toBe(0);
    const chk = rodar(c, 'atualizar', ['--ambiente', 'producao', '--tag', 'v3', '--so-checar'], { STUB_APPLIED: APLICADAS_V1 + ',20260103000000_tres' });
    expect(chk.stdout + chk.stderr).toMatch(/ROOTOS_VAR_NOVA|só checando/);
    const v = rodar(c, 'atualizar', ['--ambiente', 'producao', '--voltar'], {});
    expect(v.status, v.stderr).toBe(0);
    const env = lerEnv(c, 'producao');
    expect(chave(env, 'ROOTOS_VERSION')).toBe('v1');
    expect(chave(env, 'ROOTOS_IMAGE')).toBe(`rootos-app:v1-${c.commits.v1.slice(0, 12)}`);
    expect(v.stdout).toMatch(/BANCO continua com as migrations/);
    expect(git(path.join(c.base, 'producao', 'repo'), 'rev-parse', 'HEAD')).toBe(c.commits.v1);
  });
});

describe('E1: --so-checar não toca em nada; cópia falha fechada; recuperação verificada; trava', () => {
  function instalada(): Caixa {
    const c = caixa();
    const r = instalarProd(c);
    if (r.status !== 0) throw new Error(r.stderr);
    writeFileSync(c.log, '');
    return c;
  }
  const APLICADAS_V1 = '20260101000000_um,20260102000000_dois';
  const retrato = (c: Caixa) => ({
    env: lerEnv(c, 'producao'),
    override: readFileSync(path.join(c.base, 'producao', 'override.yml'), 'utf8'),
    versoes: readFileSync(path.join(c.base, 'producao', 'versoes.log'), 'utf8'),
    head: git(path.join(c.base, 'producao', 'repo'), 'rev-parse', 'HEAD'),
    refs: git(path.join(c.base, 'producao', 'repo'), 'for-each-ref'),
    arquivos: readdirSync(path.join(c.base, 'producao')).sort().join(','),
  });

  it('atualizar --tag --so-checar não faz fetch, não grava refs, não toca na instância', () => {
    const c = instalada();
    const antes = retrato(c);
    const r = rodar(c, 'atualizar', ['--ambiente', 'producao', '--tag', 'v2', '--so-checar'], { STUB_APPLIED: APLICADAS_V1 });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/exige o fetch|só checando/);
    expect(retrato(c)).toEqual(antes);
    // leitura de _prisma_migrations é legítima; mutação (build, up, run, dump, banco de ensaio) não
    expect(lerLog(c)).not.toMatch(/build|up -d|run --rm|pg_dump|CREATE DATABASE/);
  });

  it('atualizar --voltar --so-checar planeja e não toca em nada', () => {
    const c = instalada();
    expect(rodar(c, 'atualizar', ['--ambiente', 'producao', '--tag', 'v2'], { STUB_APPLIED: APLICADAS_V1 }).status).toBe(0);
    writeFileSync(c.log, '');
    const antes = retrato(c);
    const r = rodar(c, 'atualizar', ['--ambiente', 'producao', '--voltar', '--so-checar']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/voltaria de/);
    expect(retrato(c)).toEqual(antes);
    expect(lerLog(c)).not.toMatch(/up -d|run --rm|exec/);
    expect(existsSync(path.join(c.base, 'producao', '.atualizando'))).toBe(false);
  });

  it('pg_dump que falha e cópia incompleta abortam o ensaio; instância intocada', () => {
    const cenarios: Record<string, string>[] = [{ STUB_FAIL_DUMP: '1' }, { STUB_COPIA_INCOMPLETA: '1' }];
    for (const env of cenarios) {
      const c = instalada();
      const antes = retrato(c);
      const r = rodar(c, 'atualizar', ['--ambiente', 'producao', '--tag', 'v2'], { STUB_APPLIED: APLICADAS_V1, ...env });
      expect(r.status, JSON.stringify(env)).not.toBe(0);
      expect(r.stderr).toMatch(/cópia incompleta|ensaio inválido|não consegui copiar/i);
      expect(lerLog(c)).toMatch(/bash -o pipefail -c pg_dump .* \| psql -q -v ON_ERROR_STOP=1/);
      expect(lerLog(c)).not.toMatch(/pnpm smoke/);
      const depois = retrato(c);
      expect({ ...depois, arquivos: '' }).toEqual({ ...antes, arquivos: '' });
      expect(existsSync(path.join(c.base, 'producao', '.atualizando'))).toBe(false);
    }
  });

  it('recuperação após saúde falha é VERIFICADA: confirmada sai 1, não confirmada sai 2 e não anuncia sucesso', () => {
    // a) só a versão nova falha: a anterior volta e é confirmada por saúde+versão
    const a = instalada();
    const ra = rodar(a, 'atualizar', ['--ambiente', 'producao', '--tag', 'v2'], { STUB_APPLIED: APLICADAS_V1, STUB_FAIL_HEALTH_FOR: 'v2' });
    expect(ra.status).toBe(1);
    expect(ra.stderr).toMatch(/CONFIRMADO no ar/);
    expect(readFileSync(path.join(a.base, 'producao', 'versoes.log'), 'utf8')).toMatch(/confirmada no ar/);
    // b) tudo falha: restaurou os arquivos, mas NÃO afirma que o runtime voltou
    const b = instalada();
    const envAntes = lerEnv(b, 'producao');
    const rb = rodar(b, 'atualizar', ['--ambiente', 'producao', '--tag', 'v2'], { STUB_APPLIED: APLICADAS_V1, STUB_FAIL_HEALTH: '1' });
    expect(rb.status).toBe(2);
    expect(rb.stderr).toMatch(/RECUPERAÇÃO NÃO ESTÁ CONFIRMADA/);
    expect(rb.stderr).not.toMatch(/CONFIRMADO no ar/);
    expect(lerEnv(b, 'producao')).toBe(envAntes);
    expect(existsSync(path.join(b.base, 'producao', '.atualizando'))).toBe(false);
  });

  it('--voltar real confere versão+commit no ar, não só HTTP 200', () => {
    const c = instalada();
    expect(rodar(c, 'atualizar', ['--ambiente', 'producao', '--tag', 'v2'], { STUB_APPLIED: APLICADAS_V1 }).status).toBe(0);
    const r = rodar(c, 'atualizar', ['--ambiente', 'producao', '--voltar'], { STUB_COMMIT: 'outro-commit' });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/volta NÃO está confirmada/);
  });

  it('duas atualizações da mesma instância não coexistem: trava por instância, obsoleta é removida', () => {
    const c = instalada();
    const trava = path.join(c.base, 'producao', '.atualizando');
    mkdirSync(trava); writeFileSync(path.join(trava, 'pid'), String(process.pid));
    const r = rodar(c, 'atualizar', ['--ambiente', 'producao', '--tag', 'v2'], { STUB_APPLIED: APLICADAS_V1 });
    expect(r.status).toBe(75);
    expect(r.stderr).toMatch(/outra atualização desta instância está em curso/);
    expect(lerLog(c)).not.toMatch(/build|pg_dump/);
    writeFileSync(path.join(trava, 'pid'), '999999');
    const r2 = rodar(c, 'atualizar', ['--ambiente', 'producao', '--tag', 'v2'], { STUB_APPLIED: APLICADAS_V1 });
    expect(r2.status, r2.stderr).toBe(0);
    expect(r2.stderr).toMatch(/trava obsoleta/);
    expect(existsSync(trava)).toBe(false);
  });

  it('migration histórica alterada na tag nova é detectada pelo checksum e recusada', () => {
    const c = instalada();
    const sha = (rel: string) => createHash('sha256').update(readFileSync(path.join(c.base, 'producao', 'repo', rel))).digest('hex');
    const aplicadas = `20260101000000_um:${sha('apps/api/prisma/migrations/20260101000000_um/migration.sql')},20260102000000_dois:${sha('apps/api/prisma/migrations/20260102000000_dois/migration.sql')}`;
    // v2 preserva o histórico: passa
    const ok = rodar(c, 'atualizar', ['--ambiente', 'producao', '--tag', 'v2', '--so-checar'], { STUB_APPLIED: aplicadas });
    expect(ok.status, ok.stderr).toBe(0);
    // v5 reescreveu a primeira migration aplicada: recusa, sem tocar
    const antes = retrato(c);
    const r = rodar(c, 'atualizar', ['--ambiente', 'producao', '--tag', 'v5'], { STUB_APPLIED: aplicadas });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/conteúdo é DIFERENTE na tag v5.*20260101000000_um/);
    expect({ ...retrato(c), arquivos: '' }).toEqual({ ...antes, arquivos: '' });
    expect(lerLog(c)).not.toMatch(/build|pg_dump/);
  });

  it('preserva byte a byte a migration de ensaio já aplicada na homologação', () => {
    // Não adicionar nem editar comentários no SQL: o checksum é o já gravado
    // na VPS. Origem: madrugada-v6, commit 6ce4a40795304f6624300530bc1943954ddfc333.
    const sql = readFileSync(path.join(RAIZ, 'apps/api/prisma/migrations/20260917110000_madrugada_vps_noop/migration.sql'));
    expect(createHash('sha256').update(sql).digest('hex')).toBe(
      'dd4ce3a6be8f741622f6fd3a7b3a2fb94579d9a8015fa323d9f623d39f835b8e',
    );
    expect(sql.toString('utf8').replace(/^--.*$/gm, '').trim()).toBe('SELECT 1;');
  });

  it('recusa perder a noop aplicada e aceita candidato com o mesmo histórico, sem mutação', () => {
    const c = instalada();
    const nome = '20260917110000_madrugada_vps_noop';
    const rel = `apps/api/prisma/migrations/${nome}/migration.sql`;
    const sql = readFileSync(path.join(RAIZ, rel));
    const sha = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');
    const repo = path.join(c.base, 'producao', 'repo');
    const aplicadas = ['20260101000000_um', '20260102000000_dois'].map(n =>
      `${n}:${sha(readFileSync(path.join(repo, `apps/api/prisma/migrations/${n}/migration.sql`)))}`,
    ).concat(`${nome}:${sha(sql)}`).join(',');
    const antes = retrato(c);
    const ausente = rodar(c, 'atualizar', ['--ambiente', 'producao', '--tag', 'v2', '--so-checar'], { STUB_APPLIED: aplicadas });
    expect(ausente.status).not.toBe(0);
    expect(ausente.stderr).toContain(`NÃO existem na tag v2: ${nome}`);
    expect({ ...retrato(c), arquivos: '' }).toEqual({ ...antes, arquivos: '' });

    // Apenas repositórios temporários da fixture; nunca checkout no workspace.
    git(c.origem, 'checkout', '-q', 'v1');
    mkdirSync(path.dirname(path.join(c.origem, rel)), { recursive: true });
    writeFileSync(path.join(c.origem, rel), sql);
    git(c.origem, 'add', rel); git(c.origem, 'commit', '-qm', 'preserva histórico');
    git(c.origem, 'tag', 'v6');
    git(repo, 'fetch', '-q', 'origin', 'refs/tags/v6:refs/tags/v6');
    const preparado = retrato(c);
    const ok = rodar(c, 'atualizar', ['--ambiente', 'producao', '--tag', 'v6', '--so-checar'], { STUB_APPLIED: aplicadas });
    expect(ok.status, ok.stderr + ok.stdout).toBe(0);
    expect(ok.stdout).toContain('migrations pendentes: 0');
    expect({ ...retrato(c), arquivos: '' }).toEqual({ ...preparado, arquivos: '' });
    expect(lerLog(c)).not.toMatch(/build|pg_dump|up -d/);
  });
});

describe('P1: o override gerado passa no `docker compose config` de verdade', () => {
  const temDocker = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;
  it.skipIf(!temDocker)('compose real + override + .env de uma instância recém-instalada validam', () => {
    const c = caixa();
    const r = instalarProd(c);
    expect(r.status, r.stderr).toBe(0);
    const inst = path.join(c.base, 'producao');
    const cfg = spawnSync('docker', ['compose', '-p', 'rootos-producao', '--project-directory', path.join(inst, 'repo'), '--env-file', path.join(inst, '.env'),
      '-f', path.join(inst, 'repo', 'docker-compose.yml'), '-f', path.join(inst, 'override.yml'), 'config', '--services'], { encoding: 'utf8' });
    expect(cfg.status, cfg.stderr).toBe(0);
    expect(cfg.stdout).toMatch(/api/);
  });
});

describe('Q-005: --painel — a instância nasce com o projeto Compose do easyPanel e gera o compose para colar lá', () => {
  const APLICADAS_V1 = '20260101000000_um,20260102000000_dois';
  const PAINEL = ['--painel', 'root/rootos-prod'];
  const lerPainel = (c: Caixa) => readFileSync(path.join(c.base, 'producao', 'painel', 'docker-compose.yml'), 'utf8');

  it('projeto <projeto>_<servico> desde o primeiro up; compose do painel sem build:, imagem por variável, sem segredo', () => {
    const c = caixa();
    const r = instalarProd(c, PAINEL);
    expect(r.status, r.stderr + r.stdout).toBe(0);
    const env = lerEnv(c, 'producao');
    expect(chave(env, 'ROOTOS_PROJECT')).toBe('root_rootos-prod');
    expect(chave(env, 'ROOTOS_PAINEL')).toBe('root/rootos-prod');
    // o compose que SUBIU a instância já usou o projeto do painel — é o que faz o painel adotar volumes e rede
    const l = lerLog(c);
    expect(l).toMatch(/compose -p root_rootos-prod .*up -d --no-build/);
    expect(l).not.toMatch(/-p rootos-producao /);
    const arq = path.join(c.base, 'producao', 'painel', 'docker-compose.yml');
    expect(existsSync(arq)).toBe(true);
    expect(modo(arq)).toBe('600');
    const y = lerPainel(c);
    expect(y).toMatch(/^name: root_rootos-prod$/m);
    expect(y).not.toMatch(/^\s*build:/m);
    expect((y.match(/image: \$\{ROOTOS_IMAGE\}/g) ?? []).length).toBe(2);
    expect(y).not.toContain(chave(env, 'ROOTOS_IMAGE'));
    for (const nome of ['rootos_prod_db', 'rootos_prod_redis', 'rootos_prod_minio', 'rootos_prod_api', 'rootos_prod_web']) expect(y).toContain(`container_name: ${nome}`);
    expect(y).toContain('name: rootos-producao-net');
    // o Traefik do painel roteia os domínios por http://<projeto>_web:4000 na rede easypanel
    expect(y).toMatch(/easypanel:\n\s+external: true/);
    expect(y).toMatch(/aliases:\n\s+- root_rootos-prod_web/);
    const override = readFileSync(path.join(c.base, 'producao', 'override.yml'), 'utf8');
    expect(override, 'a instância também precisa da rede, senão a atualização a tiraria do painel').toContain('- root_rootos-prod_web');
    expect(override).not.toContain('!reset');
    for (const v of ['db', 'redis', 'minio']) expect(y).toContain(`name: root_rootos-prod_mktos_${v}_data`);
    expect(y).toMatch(/host_ip: 172\.16\.0\.1/);
    expect(y).toMatch(/published: "4001"/);
    // nada do .env interpolado: os placeholders sobrevivem e a senha do banco não aparece
    expect(y).toMatch(/\$\{DB_PASSWORD/);
    expect(y).not.toContain(chave(env, 'DB_PASSWORD'));
    expect(y).not.toContain(chave(env, 'JWT_SECRET'));
    expect(r.stdout).toMatch(/ADOTAR NO PAINEL/);
    expect(r.stdout).toMatch(/projeto Compose root_rootos-prod/);
  });

  it('sem --painel nada disso existe; --painel inválido é recusado antes de criar qualquer coisa; --so-checar só planeja', () => {
    const c = caixa();
    expect(instalarProd(c).status).toBe(0);
    expect(chave(lerEnv(c, 'producao'), 'ROOTOS_PAINEL')).toBe('');
    expect(existsSync(path.join(c.base, 'producao', 'painel'))).toBe(false);
    expect(readFileSync(path.join(c.base, 'producao', 'override.yml'), 'utf8')).not.toContain('easypanel');
    for (const ruim of ['Root/x', 'a/b/c', 'so-projeto', 'root/-x', 'root/x;rm']) {
      const d = caixa();
      const r = instalarProd(d, ['--painel', ruim]);
      expect(r.status, ruim).toBe(64);
      expect(existsSync(d.base), ruim).toBe(false);
    }
    const e = caixa();
    const chk = instalarProd(e, [...PAINEL, '--so-checar']);
    expect(chk.status, chk.stderr).toBe(0);
    expect(chk.stdout).toMatch(/easyPanel: serviço 'root\/rootos-prod' → projeto Compose root_rootos-prod/);
    expect(existsSync(e.base)).toBe(false);
  });

  it('atualizar e --voltar regeneram o compose do painel e lembram das 3 chaves de versão; sem --painel, silêncio', () => {
    const c = caixa();
    expect(instalarProd(c, PAINEL).status).toBe(0);
    const antes = lerPainel(c);
    const r = rodar(c, 'atualizar', ['--ambiente', 'producao', '--tag', 'v2'], { STUB_APPLIED: APLICADAS_V1, STUB_VERSAO: 'v2' });
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(lerLog(c)).toMatch(/compose -p root_rootos-prod .*up -d --no-build api web/);
    expect(r.stdout).toMatch(/atualize ROOTOS_IMAGE, ROOTOS_VERSION e ROOTOS_COMMIT/);
    expect(r.stdout).toMatch(/re-sobe a IMAGEM ANTERIOR/);
    expect(r.stdout).toMatch(/não mudou nesta versão/);
    expect(lerPainel(c)).toBe(antes);
    expect(existsSync(path.join(c.base, 'producao', 'painel', 'docker-compose.yml.novo'))).toBe(false);
    expect(readFileSync(path.join(c.base, 'producao', 'override.yml'), 'utf8'), 'a atualização manteve a rede do painel').toContain('- root_rootos-prod_web');
    const chk = rodar(c, 'atualizar', ['--ambiente', 'producao', '--voltar', '--so-checar']);
    expect(chk.status, chk.stderr).toBe(0);
    expect(chk.stdout).toMatch(/easyPanel: regeraria/);
    const v = rodar(c, 'atualizar', ['--ambiente', 'producao', '--voltar']);
    expect(v.status, v.stderr).toBe(0);
    expect(v.stdout).toMatch(/atualize ROOTOS_IMAGE, ROOTOS_VERSION e ROOTOS_COMMIT/);
    // e a instância comum não ganha lembrete nem diretório
    const d = caixa();
    expect(instalarProd(d).status).toBe(0);
    const s = rodar(d, 'atualizar', ['--ambiente', 'producao', '--tag', 'v2'], { STUB_APPLIED: APLICADAS_V1, STUB_VERSAO: 'v2' });
    expect(s.status, s.stderr).toBe(0);
    expect(s.stdout).not.toMatch(/easyPanel/);
    expect(existsSync(path.join(d.base, 'producao', 'painel'))).toBe(false);
  });
});
