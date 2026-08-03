import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, ROLES } from '@mktos/shared';

/**
 * Sincroniza permissões e perfis — e SÓ isso.
 *
 * Existe porque `db:seed` **não serve para produção**: ele apaga leads, eventos
 * de pixel, tarefas e campanhas do org (`deleteMany`) e recria dados de
 * exemplo. Rodar o seed num banco com tráfego real destrói o histórico.
 *
 * Este script é aditivo e idempotente: faz upsert de cada permissão e refaz os
 * vínculos perfil→permissão a partir de @mktos/shared. Nenhum delete de dado.
 *
 *   pnpm --filter @mktos/api db:sync-permissions
 */
const prisma = new PrismaClient();

async function main() {
  const orgs = await prisma.org.findMany({ select: { id: true, slug: true } });
  if (!orgs.length) {
    console.error('Nenhuma org encontrada — banco não inicializado.');
    process.exit(1);
  }

  // 1) Permissões (catálogo global)
  let novas = 0;
  for (const key of PERMISSIONS) {
    const antes = await prisma.permission.findUnique({ where: { key } });
    if (!antes) novas++;
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  }
  const permByKey = new Map((await prisma.permission.findMany()).map((p) => [p.key, p.id]));
  console.log(`Permissões: ${PERMISSIONS.length} no catálogo (${novas} nova(s)).`);

  // 2) Perfis por org — cria o que faltar e realinha os vínculos
  for (const org of orgs) {
    for (const [key, def] of Object.entries(ROLES)) {
      const ids = def.permissions
        .map((k) => permByKey.get(k))
        .filter((id): id is string => !!id)
        .map((id) => ({ id }));

      await prisma.role.upsert({
        where: { orgId_key: { orgId: org.id, key } },
        update: { name: def.name, permissions: { set: ids } },
        create: { orgId: org.id, key, name: def.name, permissions: { connect: ids } },
      });
    }
    console.log(`Org "${org.slug}": ${Object.keys(ROLES).length} perfil(is) alinhado(s).`);
  }

  // 3) Conferência do que a tela precisa
  const conferir = ['pauta.ver', 'pauta.editar', 'pauta.publicar'];
  for (const key of conferir) {
    const p = await prisma.permission.findUnique({
      where: { key },
      include: { roles: { select: { name: true } } },
    });
    console.log(`  ${key}: ${p ? p.roles.map((r) => r.name).join(', ') || '(nenhum perfil)' : 'AUSENTE'}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
