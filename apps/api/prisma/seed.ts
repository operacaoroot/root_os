import { PrismaClient } from '@prisma/client';
import { MODULOS, PERMISSIONS, ROLES } from '@mktos/shared';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

/*
 * ESTA SEMENTE É IDEMPOTENTE E NÃO APAGA NADA (P1-b, 17/09/2026).
 *
 * Até aqui ela fazia as duas coisas: criava a empresa, os papéis e as contas —
 * e, no mesmo comando, dava `deleteMany` em leads, eventos, tarefas, campanhas
 * e fontes da empresa para recriar dados de exemplo. O plano chamava isso de
 * "bootstrap idempotente", e não era: rodar de novo apagava trabalho real. Um
 * aviso no README não conserta comando que destrói.
 *
 * O bloco destrutivo foi para `prisma/seed-demo.ts`, que só roda com nome de
 * banco descartável E a flag explícita `--sim-apagar`. Aqui fica o que pode
 * rodar quantas vezes for preciso, em qualquer ambiente: upsert de empresa,
 * permissões, papéis, contas de serviço e categorias financeiras padrão.
 * `test/seed-sem-destruicao.test.ts` reprova se um `deleteMany` voltar.
 */
const prisma = new PrismaClient();

// Sem senhas fixas no repo (constituição): as contas de serviço leem a senha de
// env. Se a env não vier: em CRIAÇÃO gera uma senha forte e imprime UMA vez; em
// UPDATE mantém o hash atual (reseed não rotaciona sem env → não quebra o que roda).
// Rotacionar = definir a env e rodar `pnpm db:seed` de novo.
const ADMIN_EMAIL = 'admin@marketing-os.local';
const MCP_EMAIL = 'mcp@marketing-os.local';
const IA_ACAO_EMAIL = 'ia-acao@marketing-os.local';

/**
 * Rotacionar senha de conta EXISTENTE é operação explícita, não efeito do
 * bootstrap: `db:seed -- --rotacionar-senhas` aplica as variáveis de ambiente
 * às contas que já existem. Sem a flag, conta existente não muda de senha nem
 * que `ADMIN_PASSWORD` esteja no ambiente — variável esquecida no shell não
 * pode trocar a senha do admin de uma instalação.
 */
const ROTACIONAR_SENHAS = process.argv.includes('--rotacionar-senhas');

async function upsertServiceUser(args: {
  orgId: string;
  email: string;
  name: string;
  roleId: string;
  envPassword: string | undefined;
}): Promise<void> {
  const { orgId, email, name, roleId, envPassword } = args;
  if (envPassword && envPassword.length < 8) {
    throw new Error(`Senha de ${email} tem menos de 8 caracteres — use uma forte.`);
  }
  const existing = await prisma.user.findUnique({ where: { email }, select: { orgId: true } });

  if (existing) {
    /*
     * PRESERVAÇÃO EXATA (P1-b). Conta que existe fica como está: papéis, nome,
     * senha. Nem `set` (reduzia ao papel de fábrica) nem `connect` (reelevava
     * quem foi rebaixado de propósito). O e-mail é único no banco inteiro, então
     * a mesma conta em OUTRA empresa é um erro de instalação, não um caso a
     * consertar em silêncio — e o seed para aqui, antes de tocar em qualquer
     * coisa, em vez de religar a conta na empresa errada.
     */
    if (existing.orgId !== orgId) {
      throw new Error(
        `${email} já existe e pertence a OUTRA empresa (${existing.orgId}). O seed não move contas ` +
          'entre empresas; resolva a instalação antes de rodar de novo.',
      );
    }
    if (ROTACIONAR_SENHAS && envPassword) {
      await prisma.user.update({ where: { email }, data: { passwordHash: await bcrypt.hash(envPassword, 10) } });
      console.log(`  [seed] ${email}: senha rotacionada (--rotacionar-senhas).`);
    }
    return;
  }

  let passwordHash: string;
  if (envPassword) {
    passwordHash = await bcrypt.hash(envPassword, 10);
  } else {
    const gen = randomBytes(18).toString('base64url');
    passwordHash = await bcrypt.hash(gen, 10);
    console.log(`  [seed] ${email}: senha gerada → ${gen}\n         (para trocar depois: defina em env e rode com --rotacionar-senhas)`);
  }
  await prisma.user.create({
    data: { orgId, name, email, passwordHash, roles: { connect: [{ id: roleId }] } },
  });
}

async function main() {
  // 1) Org
  //
  // A empresa da ROOT nasce com TODOS os módulos ligados (RF-T-06). Sem esta
  // linha o campo grava vazio e, num banco NOVO, a migration de backfill não
  // socorre ninguém — ela roda com a tabela ainda sem linha alguma. O resultado
  // seria uma instalação em que todo prefixo de módulo devolve 404 e todo
  // item de domínio some do menu, com a suíte verde (nenhum teste exercita a
  // empresa semeada por requisição). Enquanto não houver tela de provisionamento
  // é aqui que o escopo de produto da ROOT é decidido.
  //
  // `MODULOS` vem de @mktos/shared, a mesma fonte única do menu e do gate — e
  // é escrito por extenso, não por spread de um conjunto derivado, porque o
  // Prisma quer `string[]` mutável.
  //
  // PRESERVAÇÃO EXATA (P1-b): até 17/09/2026 o `update` religava TODOS os
  // módulos a cada rodada — uma empresa que tivesse desligado o financeiro o
  // recebia de volta no próximo bootstrap. Empresa que existe fica como está,
  // inclusive com a lista VAZIA: nenhum módulo ligado também é uma decisão
  // válida (só a espinha do OS), e o bootstrap não a revisita. O "conserto" de
  // uma empresa que ficou sem módulo por acidente é operação explícita, na tela
  // ou por `provisionar-tenant`, nunca efeito colateral de rodar o seed.
  const modulos = [...MODULOS];
  const org = await prisma.org.upsert({
    where: { slug: 'root' },
    update: {},
    create: { name: 'Marketing OS (root)', slug: 'root', modulos },
  });

  // 2) Permissions (fonte única em @mktos/shared)
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  }
  const allPerms = await prisma.permission.findMany();
  const permByKey = new Map(allPerms.map((p) => [p.key, p.id]));

  // 3) Roles + vínculos de permissão
  //
  // PRESERVAÇÃO EXATA (P1-b). `update` com `permissions: { set }` era a mesma
  // semântica do `db:sync-permissions` — que É não aditivo de propósito, revoga
  // vínculo feito à mão e exige que todo mundo saia e entre. `connect` também
  // não serve: recolocaria uma permissão que alguém tirou de propósito. Papel
  // que existe fica como está — vínculos e nome. Cria só o que falta.
  // Realinhar com o catálogo é o ritual de três passos de quando
  // `permissions.ts` MUDA (`docs/DEPLOY.md` §2.3d), nunca passo de bootstrap.
  for (const [key, def] of Object.entries(ROLES)) {
    await prisma.role.upsert({
      where: { orgId_key: { orgId: org.id, key } },
      update: {},
      create: {
        orgId: org.id,
        key,
        name: def.name,
        permissions: { connect: def.permissions.map((k) => ({ id: permByKey.get(k)! })) },
      },
    });
  }
  const adminRole = await prisma.role.findUniqueOrThrow({
    where: { orgId_key: { orgId: org.id, key: 'admin_master' } },
  });

  // 4) Usuário admin (senha via ADMIN_PASSWORD)
  await upsertServiceUser({
    orgId: org.id,
    email: ADMIN_EMAIL,
    name: 'Admin Root',
    roleId: adminRole.id,
    envPassword: process.env.ADMIN_PASSWORD,
  });

  // 4b) Usuário de serviço do MCP/IA (só leitura — menor privilégio)
  const iaRole = await prisma.role.findUniqueOrThrow({
    where: { orgId_key: { orgId: org.id, key: 'ia_servico' } },
  });
  await upsertServiceUser({
    orgId: org.id,
    email: MCP_EMAIL,
    name: 'MCP Service (IA)',
    roleId: iaRole.id,
    envPassword: process.env.MCP_SERVICE_PASSWORD,
  });

  // 4c) Conta de AÇÃO da IA (escreve só o que o humano aprovou no Telegram)
  const iaAcaoRole = await prisma.role.findUniqueOrThrow({
    where: { orgId_key: { orgId: org.id, key: 'ia_acao' } },
  });
  await upsertServiceUser({
    orgId: org.id,
    email: IA_ACAO_EMAIL,
    name: 'IA Ação (aprovada)',
    roleId: iaAcaoRole.id,
    envPassword: process.env.MCP_ACTION_PASSWORD,
  });

  // 5) Financeiro: categorias padrão + conta Caixa (idempotente).
  // Os dados de EXEMPLO (leads, campanhas, tarefas, pixel, integração) saíram
  // daqui: `pnpm --filter @mktos/api db:seed:demo -- --sim-apagar`.
  const financeCats: Array<{ name: string; kind: 'receita' | 'despesa' }> = [
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
  for (const c of financeCats) {
    await prisma.financeCategory.upsert({
      where: { orgId_kind_name: { orgId: org.id, kind: c.kind, name: c.name } },
      update: {},
      create: { orgId: org.id, name: c.name, kind: c.kind },
    });
  }
  if ((await prisma.financeAccount.count({ where: { orgId: org.id } })) === 0) {
    await prisma.financeAccount.create({
      data: { orgId: org.id, name: 'Caixa', type: 'caixa', provider: 'manual' },
    });
  }

  console.log('✔ Seed concluído (idempotente: nada foi apagado).');
  console.log(`  Org: ${org.name} (${org.slug})`);
  console.log(`  Contas: ${ADMIN_EMAIL} · ${MCP_EMAIL} (read-only) · ${IA_ACAO_EMAIL} (ação)`);
  console.log('  Senhas: via env (ADMIN_PASSWORD / MCP_SERVICE_PASSWORD / MCP_ACTION_PASSWORD) ou geradas acima.');
  console.log('  Dados de exemplo (apaga e recria; só em banco descartável): db:seed:demo -- --sim-apagar');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
