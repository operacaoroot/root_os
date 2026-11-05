import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { describe, it, expect } from 'vitest';
import { exigirBancoDescartavel } from './banco-de-teste';

describe('migração do catálogo operacional', () => {
  it('não apaga nem modifica conteúdo de tabelas de manutenção', () => {
    const sql = readFileSync('prisma/migrations/20261105000300_restricao_diarios_operacionais/migration.sql', 'utf8');
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE)\s+(TABLE|FROM|public\.)/i);
  });
});

if (process.env.TEST_DATABASE_URL && process.env.TENANT_DATABASE_URL) {
  describe('papel restrito: tabelas auxiliares não são dados públicos', () => {
    it('retira acesso ao diário sem RLS, preservando conteúdo e acesso do dono', async () => {
      const url = process.env.TEST_DATABASE_URL!;
      exigirBancoDescartavel(url, 'criar diário sintético e testar revogação de grants');
      const owner = new Client({ connectionString: url });
      const app = new Client({ connectionString: process.env.TENANT_DATABASE_URL! });
      await owner.connect(); await app.connect();
      const table = '_diario_rls_qa_' + Date.now();
      try {
        await owner.query(`CREATE TABLE public."${table}" (dado text); INSERT INTO public."${table}" VALUES ('sintetico'); GRANT SELECT ON public."${table}" TO mktos_app`);
        expect((await app.query(`SELECT dado FROM public."${table}"`)).rows).toHaveLength(1);
        const sql = readFileSync('prisma/migrations/20261105000300_restricao_diarios_operacionais/migration.sql', 'utf8');
        await owner.query(sql);
        await expect(app.query(`SELECT dado FROM public."${table}"`)).rejects.toMatchObject({ code: '42501' });
        expect((await owner.query(`SELECT dado FROM public."${table}"`)).rows).toEqual([{ dado: 'sintetico' }]);
      } finally {
        await owner.query(`DROP TABLE IF EXISTS public."${table}"`);
        await app.end(); await owner.end();
      }
    });
  });
}
