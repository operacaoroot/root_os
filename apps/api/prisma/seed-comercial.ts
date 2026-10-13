import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/*
 * SEED DA HOMOLOGAÇÃO DO COCKPIT COMERCIAL (13/10/2026) — `pnpm --filter @mktos/api db:seed:comercial`.
 *
 * NUNCA EM PRODUÇÃO. O script recusa rodar com `NODE_ENV=production` e só
 * escreve na empresa de slug `root` de um banco cujo nome indica homologação,
 * teste ou desenvolvimento. Idempotente: rodar de novo não duplica nada.
 *
 * O que ele semeia (parte do orquestrador; a lane F acrescenta as empresas de
 * demonstração das telas no bloco marcado abaixo):
 *   1. as pessoas da mesa de homologação — o admin do `seed.ts` é titular; aqui
 *      entram uma pessoa com alçada `responsavel` (papel `gestor_marketing`) e
 *      um segundo titular (papel `diretor`), para nenhuma decisão cair na
 *      invariante "quem propôs não assina". Nomes genéricos de propósito: quem
 *      senta em cada cadeira é decisão da mesa;
 *   2. a `ComercialConfig` com os números da régua que o roteiro manda a
 *      homologação preencher, marcados `valoresDeHomologacao: true`. Os
 *      interruptores K08 ficam com o PADRÃO DA REGRA VIGENTE (falso).
 */

const prisma = new PrismaClient();

const SENHA = process.env.HOMOLOG_SENHA_USUARIOS ?? process.env.ADMIN_PASSWORD;

/** As cadeiras da mesa de homologação. E-mail em domínio reservado, sem pessoa real. */
const PESSOAS = [
  { email: 'mesa@root.homolog', name: 'Mesa · responsável (homologação)', papel: 'gestor_marketing' },
  { email: 'socio@root.homolog', name: 'Sócio titular (homologação)', papel: 'diretor' },
] as const;

/**
 * Os números da régua em homologação. A fonte de cada um:
 *  · fupLeuDias 3 e fupSilencioDias 7, prazoDiagnosticoDiasUteis 1: o roteiro (§2.5);
 *  · decisaoExpiraHoras 4, leadParadoDias 3, horaPublicacaoProposta 18 e
 *    validadePropostaDias 8: os dados de exemplo das telas 03, 04, 06 e 07 do mapa;
 *  · janelaDeVetoMinutos 10: só para a demonstração ter o que mostrar.
 * Todos são [a decidir] pela mesa; nenhum vale fora da homologação.
 */
const CONFIG_DE_HOMOLOGACAO = {
  fupLeuDias: 3,
  fupSilencioDias: 7,
  prazoDiagnosticoDiasUteis: 1,
  decisaoExpiraHoras: 4,
  leadParadoDias: 3,
  horaPublicacaoProposta: 18,
  validadePropostaDias: 8,
  janelaDeVetoMinutos: 10,
  valoresDeHomologacao: true,
};

function conferirAmbiente(): void {
  if (process.env.NODE_ENV === 'production' && process.env.COMERCIAL_SEED_DEMONSTRACAO !== 'sim') {
    throw new Error('seed-comercial: recusado com NODE_ENV=production fora da homologação (COMERCIAL_SEED_DEMONSTRACAO=sim).');
  }
  const url = process.env.DATABASE_URL ?? '';
  const banco = url.replace(/\?.*$/, '').split('/').pop() ?? '';
  if (!/comercial|homolog|test|dev|local/i.test(banco)) {
    throw new Error(`seed-comercial: o banco "${banco}" não parece de homologação; recusado.`);
  }
  if (!SENHA) throw new Error('seed-comercial: defina HOMOLOG_SENHA_USUARIOS ou ADMIN_PASSWORD.');
}

async function main() {
  conferirAmbiente();
  const org = await prisma.org.findUnique({ where: { slug: 'root' } });
  if (!org) throw new Error('seed-comercial: empresa "root" não existe; rode o db:seed antes.');

  // 1) As pessoas da mesa.
  const hash = await bcrypt.hash(SENHA!, 10);
  for (const p of PESSOAS) {
    const papel = await prisma.role.findUniqueOrThrow({ where: { orgId_key: { orgId: org.id, key: p.papel } } });
    const existe = await prisma.user.findFirst({ where: { orgId: org.id, email: p.email } });
    if (existe) {
      await prisma.user.update({ where: { id: existe.id }, data: { name: p.name, roles: { set: [{ id: papel.id }] } } });
    } else {
      await prisma.user.create({
        data: { orgId: org.id, email: p.email, name: p.name, passwordHash: hash, roles: { connect: [{ id: papel.id }] } },
      });
    }
  }

  // 2) A configuração com os valores de homologação (interruptores ficam no padrão).
  await prisma.comercialConfig.upsert({
    where: { orgId: org.id },
    update: CONFIG_DE_HOMOLOGACAO,
    create: { orgId: org.id, ...CONFIG_DE_HOMOLOGACAO },
  });

  // --- lane F: as empresas de demonstração das telas (K04), cada uma na etapa da tela 04 ---

  console.log(`seed-comercial: empresa ${org.slug}; pessoas: ${PESSOAS.map((p) => p.email).join(', ')}; config de homologação gravada.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
