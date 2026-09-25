import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, ROLES } from '@mktos/shared';

/**
 * Sincroniza permissões e perfis — e SÓ isso.
 *
 * Existe porque `db:seed` **não serve para produção**: ele apaga leads, eventos
 * de pixel, tarefas e campanhas do org (`deleteMany`) e recria dados de
 * exemplo. Rodar o seed num banco com tráfego real destrói o histórico.
 *
 * É IDEMPOTENTE, e NÃO É ADITIVO — a diferença importa. Ele faz upsert de cada
 * permissão do catálogo (aí sim, só soma) e depois REALINHA os vínculos
 * perfil→permissão com `set:`, que substitui a lista inteira. Concessão feita à
 * mão no banco e ausente de `@mktos/shared` é **REVOGADA** nesta passagem, em
 * silêncio: permissão fora do padrão precisa entrar em `packages/shared/src/
 * permissions.ts` antes de rodar isto. Nenhuma LINHA de dado é apagada — o que
 * some é o vínculo.
 *
 * DOIS PASSOS ANTES E UM DEPOIS:
 *
 *   pnpm --filter @mktos/shared build       # senão o passo 2 lê o catálogo VELHO
 *   pnpm --filter @mktos/api db:sync-permissions
 *   # e todo mundo sai e entra de novo: a permissão viaja no JWT do login, e
 *   # sessão aberta segue com a lista antiga até o token vencer.
 *
 * O primeiro passo é o que mais engana: este arquivo importa `@mktos/shared`,
 * que resolve para o `dist/` do pacote. Com um `dist/` velho o script sincroniza
 * o catálogo da semana passada e imprime "alinhado" do mesmo jeito.
 */
const prisma = new PrismaClient();

/*
 * A CHAVE MAIS NOVA DO CATÁLOGO, usada como sonda do `dist/` velho.
 *
 * `@mktos/shared` resolve para o build do pacote. Rodar este script sem
 * reconstruí-lo sincroniza o catálogo ANTIGO e imprime sucesso — foi assim que a
 * fila de aprovação quase subiu sem permissão nenhuma no banco. Uma sonda é
 * suficiente: se a chave mais nova não chegou, o `dist/` é anterior a ela.
 *
 * QUEM ADICIONAR CHAVE NOVA TROCA A SONDA por ela — senão a trava continua
 * pegando só `dist/` anterior a 11/09/2026.
 */
const SONDA = 'aprovacoes.decidir';

async function main() {
  if (!(PERMISSIONS as readonly string[]).includes(SONDA)) {
    console.error(
      `O catálogo carregado de @mktos/shared não tem "${SONDA}". O pacote resolve para o dist/, ` +
        'e este aqui está anterior à chave — sincronizar agora alinharia os perfis pelo catálogo ' +
        'velho, em silêncio.\n  Rode antes:  pnpm --filter @mktos/shared build',
    );
    process.exit(1);
  }

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

  /*
   * 3) Conferência do que a tela precisa.
   *
   * `aprovacoes.ver` e `aprovacoes.decidir` entraram na fatia 3.10 e são o caso
   * que mais custa caro esquecer: sem o vínculo no banco, a fila `/atendimento`
   * simplesmente SOME do menu de todo mundo (a permissão existe no TypeScript e
   * em perfil nenhum) — e some calada, porque `navPorSecao` só filtra.
   */
  const conferir = [
    'pauta.ver',
    'pauta.editar',
    'pauta.publicar',
    'pauta.enviar_ao_youtube',
    'aprovacoes.ver',
    'aprovacoes.decidir',
  ];
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
