import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * ETAPA P1-b DO PLANO DE PRODUTO — O BOOTSTRAP NUNCA APAGA NEM SOBRESCREVE
 *
 * O `prisma/seed.ts` fazia `deleteMany` em seis tabelas e, no mesmo comando,
 * religava todos os módulos, realinhava papéis com `set` e trocava a senha do
 * admin sempre que `ADMIN_PASSWORD` estivesse no ambiente. O plano chamava isso
 * de "bootstrap idempotente".
 *
 * DOIS BLOCOS: catraca de FONTE (roda sempre) e a prova COM BANCO — que roda o
 * seed de verdade, várias vezes, contra fixtures com módulos, papéis e
 * credenciais personalizados, e mede que NADA disso mudou. A ausência textual
 * de `deleteMany` não prova preservação; rodar duas vezes prova.
 */

function acharRaizDaApi(): string {
  const marco = path.join('prisma', 'seed.ts');
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, marco))) return dir;
    if (existsSync(path.join(dir, 'apps', 'api', marco))) return path.join(dir, 'apps', 'api');
    const pai = path.dirname(dir);
    if (pai === dir) break;
    dir = pai;
  }
  throw new Error(`Não encontrei apps/api a partir de "${process.cwd()}".`);
}
const RAIZ_API = acharRaizDaApi();
const RAIZ_REPO = path.resolve(RAIZ_API, '..', '..');
const ler = (rel: string): string => readFileSync(path.join(RAIZ_API, rel), 'utf8');
const semComentarios = (fonte: string): string =>
  fonte.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

// ---------------------------------------------------------------------------
// Bloco 1 — sem banco
// ---------------------------------------------------------------------------

describe('P1-b: a semente de instalação não apaga nem sobrescreve', () => {
  it('prisma/seed.ts não tem deleteMany nem delete', () => {
    const seed = ler('prisma/seed.ts');
    expect(seed, 'um deleteMany voltou para o seed de instalação').not.toMatch(/\.deleteMany\(/);
    expect(seed).not.toMatch(/\.delete\(/);
  });

  it('prisma/seed.ts não realinha relação nem no `set` nem no `connect` de quem existe', () => {
    /*
     * `set` reduzia ao de fábrica; `connect` recolocaria o que alguém tirou de
     * propósito. Para org, papel e conta EXISTENTES o `update` é vazio. A
     * varredura olha o CÓDIGO sem comentário, porque a explicação usa as
     * palavras proibidas.
     */
    const seed = semComentarios(ler('prisma/seed.ts'));
    expect(seed, 'voltou um `set` de relação no seed').not.toMatch(/\{\s*set:\s*\[/);
    // os três upserts de instalação têm `update: {}`
    const updatesVazios = [...seed.matchAll(/update:\s*\{\s*\}/g)].length;
    expect(updatesVazios, 'org, papel e categoria financeira precisam de update vazio').toBeGreaterThanOrEqual(3);
    // e a única escrita em conta existente é a rotação EXPLÍCITA
    expect(seed).toContain("'--rotacionar-senhas'");
    expect(seed).toMatch(/if \(ROTACIONAR_SENHAS && envPassword\)/);
  });

  it('a destruição mora em seed-demo.ts, atrás das duas travas — e sem destrave por variável', () => {
    const demo = ler('prisma/seed-demo.ts');
    expect(demo).toMatch(/\.deleteMany\(/);
    expect(demo).toContain("from '../src/common/banco-descartavel'");
    expect(demo, 'o demo tem de usar a checagem ESTRITA').toMatch(/bancoDescartavelEstrito\(url\)/);
    // sem comentário: o cabeçalho EXPLICA que o destrave não vale, e a explicação
    // usa a palavra proibida
    expect(semComentarios(demo), 'o demo herdou o destrave das suítes').not.toMatch(
      /bancoEhDescartavel|PERMITIR_BANCO_NAO_TESTE/,
    );
    expect(demo).toContain("'--sim-apagar'");
    const posFlag = demo.indexOf('process.argv.includes(FLAG)');
    const posClient = demo.indexOf('new PrismaClient()');
    expect(posFlag, 'a flag não é conferida').toBeGreaterThan(0);
    expect(posFlag, 'a flag é conferida DEPOIS de abrir o PrismaClient').toBeLessThan(posClient);
  });

  it('o bootstrap chama o seed de preservação e NUNCA o demo, o sync nem a rotação', () => {
    const bootstrap = readFileSync(path.join(RAIZ_REPO, 'scripts', 'bootstrap.sh'), 'utf8');
    const comandos = bootstrap.split('\n').filter((l) => /^\s*pnpm /.test(l));
    expect(comandos.some((l) => /db:seed\s*$/.test(l)), 'falta o db:seed puro, sem flag').toBe(true);
    expect(comandos.some((l) => l.includes('db:seed:politica'))).toBe(true);
    expect(comandos.some((l) => l.includes('db:deploy'))).toBe(true);
    expect(comandos.some((l) => /db:migrate\b/.test(l)), 'o bootstrap não pode aplicar migration com migrate dev').toBe(false);
    expect(comandos.some((l) => l.includes('seed:demo')), 'o bootstrap chama o demo').toBe(false);
    expect(comandos.some((l) => l.includes('sync-permissions')), 'o bootstrap realinha permissões').toBe(false);
    expect(comandos.some((l) => l.includes('rotacionar-senhas')), 'o bootstrap rotaciona senha').toBe(false);
  });

  it('os scripts existem nos dois package.json', () => {
    const raiz = JSON.parse(readFileSync(path.join(RAIZ_REPO, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    const api = JSON.parse(readFileSync(path.join(RAIZ_API, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(raiz.scripts.bootstrap).toBe('bash scripts/bootstrap.sh');
    expect(api.scripts['db:seed:demo']).toBe('tsx prisma/seed-demo.ts');
    expect(api.scripts['db:seed']).toBe('tsx prisma/seed.ts');
  });

  it('o exemplo de .env da API existe e traz a única variável obrigatória', () => {
    const exemplo = readFileSync(path.join(RAIZ_API, '.env.example'), 'utf8');
    expect(exemplo).toMatch(/^DATABASE_URL=/m);
    expect(exemplo).toMatch(/^OBSIDIAN_VAULT_PATH=/m);
    expect(exemplo).not.toMatch(/^OBSIDIAN_VAULT_HOST=/m);
  });
});

// ---------------------------------------------------------------------------
// Bloco 1-bis — o bootstrap de verdade, em modo de checagem (sem banco)
// ---------------------------------------------------------------------------

describe('P1-b: o bootstrap carrega o .env sem executá-lo e respeita a precedência', () => {
  const BOOTSTRAP = path.join(RAIZ_REPO, 'scripts', 'bootstrap.sh');
  const rodar = (envFile: string, env: Record<string, string | undefined>, ...args: string[]) => {
    const limpo: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'DATABASE_URL') limpo[k] = v;
    return spawnSync('bash', [BOOTSTRAP, ...args], {
      cwd: RAIZ_REPO,
      env: { ...limpo, BOOTSTRAP_ENV_FILE: envFile, ...env },
      encoding: 'utf8',
    });
  };
  const arquivo = (conteudo: string): string => {
    const dir = mkdtempSync(path.join(tmpdir(), 'p1b-env-'));
    const f = path.join(dir, '.env');
    writeFileSync(f, conteudo);
    return f;
  };

  it('.env sem DATABASE_URL: para com instrução, sem estourar antes da mensagem', () => {
    const f = arquivo('ADMIN_PASSWORD=x\n# comentário\n');
    const r = rodar(f, {}, '--so-checar');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('FALTA A DATABASE_URL');
    expect(r.stderr).toContain('cp apps/api/.env.example apps/api/.env');
  });

  it('.env com DATABASE_URL entre aspas e comentário no fim: lê o nome do banco', () => {
    const f = arquivo('export DATABASE_URL="postgresql://u:senha@h:1/marketing_os_local" # local\nOUTRA=1\n');
    const r = rodar(f, {}, '--so-checar');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('banco "marketing_os_local"');
    expect(r.stdout).toContain(`origem: ${f}`);
    expect(r.stdout, 'a URL inteira (com senha) não pode aparecer').not.toContain('senha@');
  });

  it('o ambiente tem precedência sobre o arquivo', () => {
    const f = arquivo('DATABASE_URL=postgresql://u:p@h/do_arquivo_local\n');
    const r = rodar(f, { DATABASE_URL: 'postgresql://u:p@h/do_ambiente_local' }, '--so-checar');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('banco "do_ambiente_local"');
    expect(r.stdout).toContain('origem: ambiente');
  });

  it('argumento desconhecido é recusado', () => {
    const f = arquivo('DATABASE_URL=postgresql://u:p@h/x_local\n');
    expect(rodar(f, {}, '--apagar-tudo').status).toBe(64);
  });
});

// ---------------------------------------------------------------------------
// Bloco 2 — com banco: rodar o seed de novo não desfaz configuração
// ---------------------------------------------------------------------------

const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'roda o seed de instalação e mexe na empresa root');

const ADMIN = 'admin@marketing-os.local';
const IA_ACAO = 'ia-acao@marketing-os.local';

describe.skipIf(!URL)('P1-b: preservação exata, medida rodando o seed', () => {
  const seed = (env: Record<string, string> = {}, ...args: string[]) =>
    spawnSync('pnpm', ['exec', 'tsx', 'prisma/seed.ts', ...args], {
      cwd: RAIZ_API,
      env: { ...process.env, ...env, DATABASE_URL: URL! },
      encoding: 'utf8',
    });

  it('duas execuções contra módulos, papéis e credenciais personalizados: nada muda', async () => {
    const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    // O ESTADO EXATO de tudo que o caso toca, capturado logo depois da
    // instalação e restaurado por `set` no `finally` — não um estado presumido.
    let orgId: string | null = null;
    let modulosOriginais: string[] = [];
    let gestorAntes: { id: string; name: string; permissoes: { id: string }[] } | null = null;
    let adminAntes: { papeis: { id: string }[]; passwordHash: string } | null = null;
    let iaAcaoOrgAntes: string | null = null;
    try {
      // 0) instalação
      const r0 = seed();
      expect(r0.status, r0.stderr).toBe(0);
      const org = await prisma.org.findUniqueOrThrow({ where: { slug: 'root' } });
      orgId = org.id;
      modulosOriginais = org.modulos;
      {
        const g = await prisma.role.findUniqueOrThrow({
          where: { orgId_key: { orgId: org.id, key: 'gestor_marketing' } },
          include: { permissions: { select: { id: true } } },
        });
        gestorAntes = { id: g.id, name: g.name, permissoes: g.permissions };
        const a = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN }, include: { roles: { select: { id: true } } } });
        adminAntes = { papeis: a.roles, passwordHash: a.passwordHash };
        iaAcaoOrgAntes = (await prisma.user.findUniqueOrThrow({ where: { email: IA_ACAO } })).orgId;
      }

      // 1) o que a empresa decidiu: um módulo só; papel renomeado, com uma
      //    permissão do catálogo TIRADA e uma manual ACRESCENTADA; admin com um
      //    papel a mais; e a senha do admin como está.
      await prisma.org.update({ where: { id: org.id }, data: { modulos: ['bio'] } });
      const gestor = await prisma.role.findUniqueOrThrow({
        where: { orgId_key: { orgId: org.id, key: 'gestor_marketing' } },
        include: { permissions: { select: { id: true, key: true } } },
      });
      const permRemovida = gestor.permissions[0].key;
      const manual = await prisma.permission.upsert({
        where: { key: 'p1b.permissao.manual' },
        update: {},
        create: { key: 'p1b.permissao.manual' },
      });
      await prisma.role.update({
        where: { id: gestor.id },
        data: {
          name: 'Gestor renomeado pela empresa',
          permissions: { disconnect: { id: gestor.permissions[0].id }, connect: { id: manual.id } },
        },
      });
      const papelExtra = await prisma.role.upsert({
        where: { orgId_key: { orgId: org.id, key: 'p1b_papel_manual' } },
        update: {},
        create: { orgId: org.id, key: 'p1b_papel_manual', name: 'Papel dado à mão' },
      });
      await prisma.user.update({
        where: { email: ADMIN },
        data: { roles: { disconnect: { orgId_key: { orgId: org.id, key: 'admin_master' } }, connect: { id: papelExtra.id } } },
      });
      const hashAntes = (await prisma.user.findUniqueOrThrow({ where: { email: ADMIN } })).passwordHash;

      // 2) o seed de novo — COM ADMIN_PASSWORD no ambiente, como quem esqueceu
      //    a variável no shell. Nada pode mudar.
      const r1 = seed({ ADMIN_PASSWORD: 'senha-esquecida-no-shell-123' });
      expect(r1.status, r1.stderr).toBe(0);
      const r2 = seed({ ADMIN_PASSWORD: 'senha-esquecida-no-shell-123' });
      expect(r2.status, r2.stderr).toBe(0);

      const depois = await prisma.org.findUniqueOrThrow({ where: { slug: 'root' } });
      expect(depois.modulos, 'religou módulos que a empresa desligou').toEqual(['bio']);

      const gestorDepois = await prisma.role.findUniqueOrThrow({
        where: { id: gestor.id },
        include: { permissions: { select: { key: true } } },
      });
      const chaves = gestorDepois.permissions.map((p) => p.key);
      expect(gestorDepois.name, 'desfez o nome que a empresa deu ao papel').toBe('Gestor renomeado pela empresa');
      expect(chaves, 'recolocou permissão que a empresa tirou').not.toContain(permRemovida);
      expect(chaves, 'revogou permissão dada à mão').toContain('p1b.permissao.manual');

      const adminDepois = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN }, include: { roles: { select: { key: true } } } });
      const papeis = adminDepois.roles.map((r) => r.key);
      expect(papeis, 'reelevou o admin que a empresa rebaixou').not.toContain('admin_master');
      expect(papeis, 'tirou o papel dado à mão').toContain('p1b_papel_manual');
      expect(adminDepois.passwordHash, 'trocou a senha por causa de uma variável no ambiente').toBe(hashAntes);

      // 3) lista de módulos VAZIA também é decisão: fica vazia
      await prisma.org.update({ where: { id: org.id }, data: { modulos: [] } });
      const r3 = seed();
      expect(r3.status, r3.stderr).toBe(0);
      expect((await prisma.org.findUniqueOrThrow({ where: { slug: 'root' } })).modulos, 'preencheu lista vazia').toEqual([]);

      // 4) rotação é EXPLÍCITA, e funciona quando pedida
      const r4 = seed({ ADMIN_PASSWORD: 'senha-nova-pedida-de-proposito-1' }, '--rotacionar-senhas');
      expect(r4.status, r4.stderr).toBe(0);
      const hashRotacionado = (await prisma.user.findUniqueOrThrow({ where: { email: ADMIN } })).passwordHash;
      expect(hashRotacionado, 'a rotação explícita não rotacionou').not.toBe(hashAntes);

      // 5) e-mail que pertence a OUTRA empresa: o seed para antes de tocar em algo
      const outra = await prisma.org.upsert({
        where: { slug: 'p1b-outra' },
        update: {},
        create: { name: 'Outra empresa', slug: 'p1b-outra', modulos: [] },
      });
      await prisma.user.update({ where: { email: IA_ACAO }, data: { orgId: outra.id } });
      const r5 = seed();
      expect(r5.status, 'o seed aceitou conta de outra empresa').not.toBe(0);
      expect(r5.stderr + r5.stdout).toMatch(/pertence a OUTRA empresa/);
    } finally {
      // Restauração EXATA, na ordem inversa, cada passo independente dos outros.
      if (iaAcaoOrgAntes) {
        await prisma.user.update({ where: { email: IA_ACAO }, data: { orgId: iaAcaoOrgAntes } }).catch(() => undefined);
      }
      await prisma.org.deleteMany({ where: { slug: 'p1b-outra' } }).catch(() => undefined);
      if (adminAntes) {
        await prisma.user
          .update({
            where: { email: ADMIN },
            data: { passwordHash: adminAntes.passwordHash, roles: { set: adminAntes.papeis } },
          })
          .catch(() => undefined);
      }
      if (orgId) await prisma.role.deleteMany({ where: { orgId, key: 'p1b_papel_manual' } }).catch(() => undefined);
      if (gestorAntes) {
        await prisma.role
          .update({
            where: { id: gestorAntes.id },
            data: { name: gestorAntes.name, permissions: { set: gestorAntes.permissoes } },
          })
          .catch(() => undefined);
      }
      await prisma.permission.deleteMany({ where: { key: 'p1b.permissao.manual' } }).catch(() => undefined);
      if (orgId) await prisma.org.update({ where: { id: orgId }, data: { modulos: modulosOriginais } }).catch(() => undefined);
      await prisma.$disconnect();
    }
  }, 180_000);
});
