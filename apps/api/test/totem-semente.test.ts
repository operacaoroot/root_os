import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/*
 * A SEMENTE DO TOTEM (prisma/seed-totem.ts) — catraca de fonte.
 *
 * A prova de que rodar duas vezes não muda nada é feita no banco de bancada
 * (docs/totem/CONTRATO.md, seção 13). Aqui fica o que não pode voltar sem
 * ninguém notar: apagar dado, sobrescrever o que o painel editou e senha no
 * stdout.
 */

function acharRaizDaApi(): string {
  const marco = path.join('prisma', 'seed-totem.ts');
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
const semComentarios = (fonte: string): string =>
  fonte.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
const SEMENTE = semComentarios(readFileSync(path.join(RAIZ_API, 'prisma', 'seed-totem.ts'), 'utf8'));

describe('semente do totem', () => {
  it('não apaga nada', () => {
    expect(SEMENTE).not.toMatch(/\.deleteMany\(/);
    expect(SEMENTE).not.toMatch(/\.delete\(/);
  });

  it('só altera o que já existe para ligar o módulo na empresa', () => {
    const updates = [...SEMENTE.matchAll(/prisma\.(\w+)\.(update|updateMany|upsert)\(/g)].map((m) => `${m[1]}.${m[2]}`);
    expect(updates).toEqual(['org.update']);
    expect(SEMENTE).toMatch(/modulos:\s*\{\s*push:\s*'totem'\s*\}/);
  });

  it('não escreve senha no stdout nem no stderr', () => {
    for (const linha of SEMENTE.split('\n').filter((l) => /console\.(log|error|warn|info)/.test(l))) {
      expect(linha, linha.trim()).not.toMatch(/\$\{[^}'"`]*\b(senha|hash)\b/i);
      expect(linha, linha.trim()).not.toMatch(/console\.\w+\(\s*[\w.]*\b(senha|hash|novos)\s*[,)]/);
    }
    expect(SEMENTE).toMatch(/writeFileSync\(saida,[^;]*mode:\s*0o600/);
    expect(SEMENTE).toMatch(/chmodSync\(saida,\s*0o600\)/);
  });

  it('recusa arquivo de senhas dentro do repositório', () => {
    expect(SEMENTE).toMatch(/dentroDoRepositorio\(saida\)/);
  });

  it('está registrada como db:seed:totem e as variáveis chegam ao container', () => {
    const api = JSON.parse(readFileSync(path.join(RAIZ_API, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(api.scripts['db:seed:totem']).toBe('tsx prisma/seed-totem.ts');
    const compose = readFileSync(path.join(RAIZ_REPO, 'docker-compose.yml'), 'utf8');
    const exemplo = readFileSync(path.join(RAIZ_REPO, '.env.example'), 'utf8');
    for (const v of ['TOTEM_CPF_PEPPER', 'TOTEM_ORG_SLUG', 'TOTEM_SEED_SAIDA']) {
      expect(compose).toContain(`${v}: \${${v}:-}`);
      expect(exemplo).toMatch(new RegExp(`^${v}=$`, 'm'));
    }
  });
});
