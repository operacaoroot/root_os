// C1 · o banco de destino da cópia, sem a semente fictícia.
//
// O `db:seed` do repositório faz duas coisas: a espinha (empresa, permissões,
// papéis, contas de serviço) e a DEMONSTRAÇÃO (campanhas, leads Ana Prado e cia.,
// tarefas). A cópia quer só a primeira: o ambiente é "real de mentira" e nenhum
// dado inventado pode se misturar aos cartões do Lucas. Este script repete os
// passos 1 a 4 do `apps/api/prisma/seed.ts` com as MESMAS fontes do shared
// (MODULOS, PERMISSIONS, ROLES) e para ali.
//
// Depois vêm as pessoas: as oito contas da produção entram com nome, e-mail,
// telefone, ativo e papel. A senha NUNCA vem da produção: cada conta recebe um
// hash de um segredo aleatório que ninguém guarda (login impossível, como a conta
// criada pelo Google), menos a do Rodrigo, que recebe a COPIA_LOGIN_SENHA do
// homolog/.env.copia. As três contas de serviço (admin, mcp, ia-acao) são as da
// semente e casam por e-mail.
//
// E as duas contas da importação (importador e conferente), de gente, porque a
// régua não muda para a cópia: mover etapa no funil é escrita sensível e quem
// pede não assina. Elas ficam ativas só durante a importação (`--desativar`).
//
// Uso (com a stack de pé):  node homolog/importar-copia/preparar-destino.mjs
//                           node homolog/importar-copia/preparar-destino.mjs --desativar
import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import path from 'node:path';

import { RAIZ, lerEnv, lerStaging, requireDaApi } from './comum.mjs';

const env = lerEnv();
process.env.DATABASE_URL = `postgresql://${env.DB_USER}:${env.DB_PASSWORD}@127.0.0.1:${env.DB_PORT}/${env.DB_NAME}`;
const { PrismaClient } = requireDaApi('@prisma/client');
const { MODULOS, PERMISSIONS, ROLES } = requireDaApi('@mktos/shared');
const bcrypt = requireDaApi('bcryptjs');
const prisma = new PrismaClient();

export const CONTAS_DA_IMPORTACAO = [
  { chave: 'COPIA_IMPORTADOR_SENHA', email: 'importador@copia.homolog', name: 'Importação da cópia (homologação)' },
  { chave: 'COPIA_CONFERENTE_SENHA', email: 'conferente@copia.homolog', name: 'Conferência da cópia (homologação)' },
];
const DA_SEMENTE = {
  'admin@marketing-os.local': 'admin_master',
  'mcp@marketing-os.local': 'ia_servico',
  'ia-acao@marketing-os.local': 'ia_acao',
};

const hashInutil = () => bcrypt.hash(randomBytes(32).toString('base64url'), 10);

async function desativar() {
  const r = await prisma.user.updateMany({ where: { email: { in: CONTAS_DA_IMPORTACAO.map((c) => c.email) } }, data: { isActive: false } });
  console.log(`contas da importação desativadas: ${r.count}`);
}

async function preparar() {
  // A empresa da produção (uma só): mesmo nome e apelido.
  const [orgProd] = lerStaging(`select json_agg(json_build_object('name', name, 'slug', slug)) from "Org"`);
  if (!orgProd || orgProd.slug !== 'root') throw new Error('o staging não tem a empresa root');
  const modulos = [...MODULOS];
  const org = await prisma.org.upsert({
    where: { slug: 'root' },
    update: { name: orgProd.name, modulos },
    create: { name: orgProd.name, slug: 'root', modulos },
  });

  for (const key of PERMISSIONS) await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  const permByKey = new Map((await prisma.permission.findMany()).map((p) => [p.key, p.id]));
  for (const [key, def] of Object.entries(ROLES)) {
    await prisma.role.upsert({
      where: { orgId_key: { orgId: org.id, key } },
      update: { name: def.name, permissions: { set: def.permissions.map((k) => ({ id: permByKey.get(k) })) } },
      create: { orgId: org.id, key, name: def.name, permissions: { connect: def.permissions.map((k) => ({ id: permByKey.get(k) })) } },
    });
  }
  const papeis = await prisma.role.findMany({ where: { orgId: org.id } });
  const papelPorNome = new Map(papeis.map((r) => [r.name, r]));
  const papelPorChave = new Map(papeis.map((r) => [r.key, r]));

  const gente = lerStaging(`select json_agg(json_build_object(
      'name', u.name, 'email', lower(u.email), 'phone', u.phone, 'isActive', u."isActive",
      'papeis', (select json_agg(r.name) from "_UserRoles" ur join "Role" r on r.id = ur."A" where ur."B" = u.id)))
    from "User" u`) ?? [];

  let criadas = 0;
  let atualizadas = 0;
  const escreverConta = async ({ email, name, phone, isActive, roleIds, senha }) => {
    const existe = await prisma.user.findUnique({ where: { email } });
    if (existe) {
      await prisma.user.update({
        where: { email },
        data: { name, phone, isActive, roles: { set: roleIds.map((id) => ({ id })) }, ...(senha ? { passwordHash: await bcrypt.hash(senha, 10) } : {}) },
      });
      atualizadas++;
      return;
    }
    await prisma.user.create({
      data: {
        orgId: org.id, name, email, phone, isActive,
        passwordHash: senha ? await bcrypt.hash(senha, 10) : await hashInutil(),
        roles: { connect: roleIds.map((id) => ({ id })) },
      },
    });
    criadas++;
  };

  const login = (env.COPIA_LOGIN_EMAIL || '').toLowerCase();
  if (!login || !env.COPIA_LOGIN_SENHA) throw new Error('defina COPIA_LOGIN_EMAIL e COPIA_LOGIN_SENHA em homolog/.env.copia');
  if (!gente.some((p) => p.email === login)) throw new Error('o login da cópia precisa ser uma conta da produção');

  for (const p of gente) {
    const daSemente = DA_SEMENTE[p.email];
    const roleIds = daSemente
      ? [papelPorChave.get(daSemente).id]
      : (p.papeis ?? []).map((n) => papelPorNome.get(n)?.id).filter(Boolean);
    if (!roleIds.length) throw new Error('papel da produção sem equivalente no nosso ROLES');
    const senha = p.email === 'admin@marketing-os.local' ? env.ADMIN_PASSWORD : p.email === login ? env.COPIA_LOGIN_SENHA : null;
    await escreverConta({ email: p.email, name: p.name, phone: p.phone ?? null, isActive: p.isActive, roleIds, senha });
  }

  const admin = papelPorChave.get('admin_master');
  for (const c of CONTAS_DA_IMPORTACAO) {
    let senha = env[c.chave];
    if (!senha) {
      senha = randomBytes(18).toString('base64url');
      appendFileSync(path.join(RAIZ, 'homolog', '.env.copia'), `${c.chave}=${senha}\n`);
    }
    await escreverConta({ email: c.email, name: c.name, phone: null, isActive: true, roleIds: [admin.id], senha });
  }
  console.log(`empresa ${org.slug} pronta · contas da produção: ${gente.length} · criadas ${criadas} · atualizadas ${atualizadas}`);
}

try {
  if (process.argv.includes('--desativar')) await desativar();
  else await preparar();
} finally {
  await prisma.$disconnect();
}
