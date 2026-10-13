import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { comContexto, novaCorrelacao } from '../src/common/contexto-execucao';
import { comTenantPublico, resolverTenantDaCobranca, resolverTenantDoDocumento } from '../src/common/tenant-publico';
import { comTenantNaSessao } from '../src/prisma/sessao-de-banco';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * OS WEBHOOKS DO DINHEIRO SOB O ISOLAMENTO POR LINHA (lane D, 13/10/2026).
 *
 * O webhook do Asaas e o da ZapSign chegam sem empresa. A empresa é achada
 * pela linha (`ComercialCobranca`/`ComercialDocumento`, pelo id no provedor)
 * sob a sentinela pública, e o resto roda dentro da empresa achada. A
 * migration `20261013100000_comercial_webhooks_leitura_publica` abre SÓ a
 * leitura das duas tabelas à sentinela.
 *
 * A parte com banco roda com o PAPEL RESTRITO de verdade (`mktos_app`), num
 * banco só de RLS, como as outras seções de RLS da casa:
 *
 *   RLS_NO_TESTE=1 TEST_DATABASE_URL=<dono>/rootos_comercial_test_rls \
 *     TENANT_DATABASE_URL=<mktos_app>/rootos_comercial_test_rls vitest run test/comercial-dinheiro-rls.test.ts
 *
 * Sem as variáveis, só a parte estática roda (a seção entra por `if`, não por
 * `skip`: não aparece como caso pulado).
 */

describe('a migration dos webhooks é aditiva e só abre a LEITURA', () => {
  const sql = readFileSync(path.resolve(__dirname, '../prisma/migrations/20261013100000_comercial_webhooks_leitura_publica/migration.sql'), 'utf8');
  it('as duas tabelas ganham a sentinela na leitura e não na escrita', () => {
    for (const tabela of ['ComercialCobranca', 'ComercialDocumento']) {
      const bloco = new RegExp(`app_rls_aplicar_policies\\(\\s*'${tabela}',\\s*'([^']+)',\\s*'([^']+)'\\s*\\)`).exec(sql);
      expect(bloco, tabela).not.toBeNull();
      expect(bloco![1]).toContain('OR public.app_resolucao_publica()');
      expect(bloco![2]).not.toContain('app_resolucao_publica');
    }
    expect(sql).not.toMatch(/CREATE TABLE|ALTER TABLE|DROP TABLE|ADD COLUMN/i);
  });
});

const URL_BANCO = process.env.TEST_DATABASE_URL ?? '';
const URL_TENANT = process.env.TENANT_DATABASE_URL ?? '';
const COM_RLS = URL_BANCO !== '' && URL_TENANT !== '' && process.env.RLS_NO_TESTE === '1';

if (COM_RLS) {
  describe('com o papel restrito: o webhook acha a empresa pela linha e nada além dela', () => {
    exigirBancoDescartavel(URL_BANCO, 'ESCREVE nele (empresas, leads, cobrança e documento de teste)');
    const marca = `rlsd${Date.now().toString(36).slice(-6)}`;
    let admin: PrismaClient;
    let prisma: PrismaClient;
    const ids = { orgA: '', orgB: '', leadA: '', leadB: '' };
    const comoVisitante = <T>(fn: () => Promise<T>) => comContexto({ orgId: null, correlationId: novaCorrelacao('http'), origem: 'http' }, fn);

    beforeAll(async () => {
      admin = new PrismaClient({ datasourceUrl: URL_BANCO });
      const estado = await admin.$queryRawUnsafe<{ rls: boolean; force: boolean }[]>(
        `SELECT rls, force FROM app_rls_estado() WHERE tabela IN ('ComercialCobranca', 'ComercialDocumento')`,
      );
      if (estado.length !== 2 || estado.some((e) => !e.rls || !e.force)) {
        throw new Error('o isolamento por linha está desligado neste banco: rode SELECT app_rls_ligar(); antes desta seção');
      }
      const a = await admin.org.create({ data: { name: `A ${marca}`, slug: `a-${marca}` } });
      const b = await admin.org.create({ data: { name: `B ${marca}`, slug: `b-${marca}` } });
      ids.orgA = a.id;
      ids.orgB = b.id;
      ids.leadA = (await admin.lead.create({ data: { orgId: a.id, name: 'Lead A' } })).id;
      ids.leadB = (await admin.lead.create({ data: { orgId: b.id, name: 'Lead B' } })).id;
      await admin.comercialCobranca.create({
        data: { leadId: ids.leadA, provedor: 'asaas', externoId: `pay-${marca}`, parcela: 1, parcelas: 3, valorCentavos: 399_900, forma: 'pix', vence: new Date() },
      });
      await admin.comercialDocumento.create({ data: { leadId: ids.leadA, provedor: 'zapsign', externoId: `doc-${marca}`, hashConteudo: 'a'.repeat(64) } });
      prisma = comTenantNaSessao(new PrismaClient({ datasourceUrl: URL_TENANT }), { modo: 'impor' });
    });

    afterAll(async () => {
      await admin.comercialCobranca.deleteMany({ where: { leadId: { in: [ids.leadA, ids.leadB] } } });
      await admin.comercialDocumento.deleteMany({ where: { leadId: { in: [ids.leadA, ids.leadB] } } });
      await admin.lead.deleteMany({ where: { id: { in: [ids.leadA, ids.leadB] } } });
      await admin.org.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } });
      await prisma?.$disconnect();
      await admin.$disconnect();
    });

    it('a resolução pela sentinela acha a empresa da parcela e do documento', async () => {
      expect(await comoVisitante(() => resolverTenantDaCobranca(prisma, 'asaas', `pay-${marca}`))).toMatchObject({ orgId: ids.orgA, leadId: ids.leadA });
      expect(await comoVisitante(() => resolverTenantDoDocumento(prisma, 'zapsign', `doc-${marca}`))).toMatchObject({ orgId: ids.orgA, leadId: ids.leadA });
      expect(await comoVisitante(() => resolverTenantDaCobranca(prisma, 'asaas', 'nao-existe'))).toBeNull();
    });

    it('dentro da OUTRA empresa a linha não existe; dentro da dona, existe', async () => {
      const deB = await comTenantPublico(ids.orgB, () => prisma.comercialCobranca.findMany({ where: { externoId: `pay-${marca}` } }));
      expect(deB).toHaveLength(0);
      const deA = await comTenantPublico(ids.orgA, () => prisma.comercialCobranca.findMany({ where: { externoId: `pay-${marca}` } }));
      expect(deA).toHaveLength(1);
    });

    it('a empresa errada não quita a parcela de ninguém (a escrita não aceita a sentinela nem outra empresa)', async () => {
      const r = await comTenantPublico(ids.orgB, () => prisma.comercialCobranca.updateMany({ where: { externoId: `pay-${marca}` }, data: { estado: 'paga', pagaEm: new Date() } }));
      expect(r.count).toBe(0);
      const doc = await comTenantPublico(ids.orgB, () => prisma.comercialDocumento.updateMany({ where: { externoId: `doc-${marca}` }, data: { estado: 'assinado' } }));
      expect(doc.count).toBe(0);
      const linha = await admin.comercialCobranca.findFirstOrThrow({ where: { externoId: `pay-${marca}` } });
      expect(linha.estado).toBe('pendente');
      // Na dona, quita.
      const ok = await comTenantPublico(ids.orgA, () => prisma.comercialCobranca.updateMany({ where: { externoId: `pay-${marca}` }, data: { estado: 'paga' } }));
      expect(ok.count).toBe(1);
    });
  });
}
