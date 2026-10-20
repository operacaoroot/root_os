import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { NovaReuniaoSchema } from '@mktos/shared';
import { FichaService } from '../src/ficha/ficha.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * Ficha do cliente — revisão final da versão final (item 7, 19/10/2026).
 *  - o link da reunião só aceita http(s): `javascript:` e `data:` são recusados no schema;
 *  - o nome do autor só sai de pessoa da MESMA empresa (o filtro não depende de quem chama).
 */

describe('ficha: o link da reunião', () => {
  const base = { titulo: 'Kickoff', em: '2026-10-19', fonte: 'link' as const };
  it('aceita http e https', () => {
    expect(NovaReuniaoSchema.safeParse({ ...base, link: 'https://notes.granola.ai/p/abc' }).success).toBe(true);
    expect(NovaReuniaoSchema.safeParse({ ...base, link: 'http://exemplo.com/ata' }).success).toBe(true);
  });
  it('recusa javascript:, data: e outros esquemas', () => {
    for (const link of ['javascript:alert(1)', 'JavaScript://x%0aalert(1)', 'data:text/html,<b>x</b>', 'ftp://exemplo.com/a']) {
      expect(NovaReuniaoSchema.safeParse({ ...base, link }).success, link).toBe(false);
    }
  });
  it('texto colado continua sem link', () => {
    expect(NovaReuniaoSchema.safeParse({ titulo: 'Kickoff', em: '2026-10-19', fonte: 'texto', texto: 'a ata' }).success).toBe(true);
  });
});

const URL = process.env.TEST_DATABASE_URL;
const CASA = 'org-teste-ficha-rev-casa';
const VIZINHA = 'org-teste-ficha-rev-vizinha';
const EMPRESAS = [CASA, VIZINHA];
const DE_CASA = 'u-ficha-rev-casa';
const DA_VIZINHA = 'u-ficha-rev-vizinha';

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (duas empresas, um cartão e reuniões)');

describe.skipIf(!URL)('ficha: o nome do autor é da empresa', () => {
  let prisma: PrismaClient;
  let svc: FichaService;
  let cartao: string;

  async function limpar() {
    await prisma.reuniaoDoCartao.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    await prisma.workTask.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    await prisma.workStatus.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    await prisma.workList.deleteMany({ where: { orgId: { in: EMPRESAS } } });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    svc = new FichaService(prisma as unknown as PrismaService);
    for (const orgId of EMPRESAS) await prisma.org.upsert({ where: { id: orgId }, create: { id: orgId, name: orgId, slug: orgId }, update: {} });
    await prisma.user.upsert({ where: { id: DE_CASA }, create: { id: DE_CASA, orgId: CASA, name: 'Rodrigo', email: `${DE_CASA}@teste.local`, passwordHash: 'x' }, update: {} });
    await prisma.user.upsert({ where: { id: DA_VIZINHA }, create: { id: DA_VIZINHA, orgId: VIZINHA, name: 'Pessoa da vizinha', email: `${DA_VIZINHA}@teste.local`, passwordHash: 'x' }, update: {} });
    await limpar();
    const lista = await prisma.workList.create({ data: { orgId: CASA, name: 'CRM' } });
    const st = await prisma.workStatus.create({ data: { orgId: CASA, listId: lista.id, name: 'Lead', type: 'open', order: 0 } });
    cartao = (await prisma.workTask.create({ data: { orgId: CASA, listId: lista.id, statusId: st.id, title: 'Cliente X' } })).id;
  });

  afterAll(async () => {
    await limpar();
    await prisma.user.deleteMany({ where: { id: { in: [DE_CASA, DA_VIZINHA] } } });
    await prisma.org.deleteMany({ where: { id: { in: EMPRESAS } } });
    await prisma.$disconnect();
  });

  it('autor da casa tem nome; um id de pessoa de outra empresa sai sem nome', async () => {
    const minha = await svc.criar(CASA, DE_CASA, cartao, { titulo: 'Kickoff', em: '2026-10-19', fonte: 'texto', texto: 'a ata do kickoff' });
    expect(minha.autorNome).toBe('Rodrigo');
    // Linha com autor de outra empresa (não deveria existir; o filtro não pode depender disso).
    const torta = await prisma.reuniaoDoCartao.create({
      data: { orgId: CASA, taskId: cartao, titulo: 'Torta', em: new Date(), fonte: 'texto', transcricao: 'x', autorId: DA_VIZINHA },
    });
    expect((await svc.ler(CASA, torta.id)).autorNome).toBeNull();
    const lista = await svc.listar(CASA, cartao);
    expect(lista.find((r) => r.id === torta.id)?.autorNome).toBeNull();
    expect(lista.find((r) => r.id === minha.id)?.autorNome).toBe('Rodrigo');
  });
});
