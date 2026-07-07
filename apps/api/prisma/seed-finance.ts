// Seed FINANCEIRO — idempotente e NÃO-destrutivo (não apaga nenhum dado).
// Garante que o banco existente ganhe as permissões financeiro.*, o perfil
// "financeiro", as categorias padrão e uma conta "Caixa" inicial.
// Rodar após aplicar a migration add_finance:  pnpm --filter @mktos/api db:seed:finance
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, ROLES } from '@mktos/shared';

const prisma = new PrismaClient();

const DEFAULT_CATEGORIES: Array<{ name: string; kind: 'receita' | 'despesa' }> = [
  { name: 'Vendas', kind: 'receita' },
  { name: 'Serviços', kind: 'receita' },
  { name: 'Outras receitas', kind: 'receita' },
  { name: 'Salários e pró-labore', kind: 'despesa' },
  { name: 'Fornecedores', kind: 'despesa' },
  { name: 'Marketing', kind: 'despesa' },
  { name: 'Impostos', kind: 'despesa' },
  { name: 'Software e assinaturas', kind: 'despesa' },
  { name: 'Infraestrutura', kind: 'despesa' },
  { name: 'Outras despesas', kind: 'despesa' },
];

async function main() {
  const org = await prisma.org.findUnique({ where: { slug: 'root' } });
  if (!org) throw new Error('Org "root" não encontrada — rode o seed principal antes.');

  // 1) Permissões (garante financeiro.ver/editar/conciliar) — fonte única em @mktos/shared
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  }
  const permByKey = new Map((await prisma.permission.findMany()).map((p) => [p.key, p.id]));

  // 2) Re-vincula TODOS os perfis (inclui o novo "financeiro") — só relink, sem apagar dados
  for (const [key, def] of Object.entries(ROLES)) {
    await prisma.role.upsert({
      where: { orgId_key: { orgId: org.id, key } },
      update: { name: def.name, permissions: { set: def.permissions.map((k) => ({ id: permByKey.get(k)! })) } },
      create: {
        orgId: org.id, key, name: def.name,
        permissions: { connect: def.permissions.map((k) => ({ id: permByKey.get(k)! })) },
      },
    });
  }

  // 3) Categorias padrão (idempotente por orgId+kind+name)
  for (const c of DEFAULT_CATEGORIES) {
    await prisma.financeCategory.upsert({
      where: { orgId_kind_name: { orgId: org.id, kind: c.kind, name: c.name } },
      update: {},
      create: { orgId: org.id, name: c.name, kind: c.kind },
    });
  }

  // 4) Conta "Caixa" inicial se ainda não houver nenhuma conta
  const accounts = await prisma.financeAccount.count({ where: { orgId: org.id } });
  if (accounts === 0) {
    await prisma.financeAccount.create({
      data: { orgId: org.id, name: 'Caixa', type: 'caixa', provider: 'manual' },
    });
  }

  console.log('✔ Seed financeiro: permissões + perfis + categorias + caixa OK.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
