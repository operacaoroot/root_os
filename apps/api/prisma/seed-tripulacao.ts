/*
 * Semeia a tripulação da casa em TODAS as empresas do banco. Idempotente: não
 * sobrescreve dono, linha de base nem estado — essas três são decisão de gente, e
 * um seed rodando no deploy não pode desfazer o que uma pessoa configurou.
 *
 *   pnpm --filter @mktos/api db:seed:tripulacao
 *
 * DESDE A RODADA DOS AGENTES (21/10/2026, A1) a lista sai do CADASTRO ÚNICO
 * (`packages/shared/src/agentes.ts`, `funcoesDaSemente('tripulacao')`): slug,
 * nome, missão, tipo e capacidades são os de lá; iniciais, pilar, autonomia,
 * cron e procedimento, de `src/agents/roster/complementos.ts`. O assistente é a
 * MESMA definição do roster de entrada, e as capacidades passam pelo filtro de
 * módulo de cada empresa (`capacidades-da-empresa.ts`): a empresa sem financeiro
 * não ganha ferramenta de financeiro.
 *
 * As cinco rotinas da casa (ClickUp, vault, conciliação, bio, metas) continuam
 * virando registro `Agent` (tipo `conector`) para terem dono na Equipe; cada
 * passagem delas vai ao histórico de rotinas (`src/routines/rotinas-da-casa.ts`).
 */
import { PrismaClient } from '@prisma/client';
import { funcoesDaSemente } from '@mktos/shared';

import { agenteDaFuncao } from '../src/agents/roster/complementos';
import { capacidadesDaEmpresa } from '../src/agents/roster/capacidades-da-empresa';

const prisma = new PrismaClient();

const TRIPULACAO = funcoesDaSemente('tripulacao').map(agenteDaFuncao);

async function main() {
  const orgs = await prisma.org.findMany({ select: { id: true, slug: true, modulos: true } });
  if (!orgs.length) {
    console.error('nenhuma empresa no banco — rode o seed principal antes');
    process.exit(1);
  }

  for (const org of orgs) {
    let criados = 0;
    let mantidos = 0;
    for (const s of TRIPULACAO) {
      const capacidades = capacidadesDaEmpresa(s.capacidades, org.modulos ?? []);
      const existe = await prisma.agent.findUnique({
        where: { orgId_slug: { orgId: org.id, slug: s.slug } },
      });
      if (existe) {
        // Missão, capacidades e cron acompanham o código. Dono, estado e
        // linha de base são de gente — o seed não toca.
        await prisma.agent.update({
          where: { id: existe.id },
          data: {
            nome: s.nome, iniciais: s.iniciais, missao: s.missao, pilar: s.pilar,
            tipo: s.tipo, capacidades, cron: s.cron,
          },
        });
        mantidos++;
        continue;
      }
      const criado = await prisma.agent.create({
        data: {
          orgId: org.id, slug: s.slug, nome: s.nome, iniciais: s.iniciais,
          missao: s.missao, pilar: s.pilar, tipo: s.tipo, estado: s.estado,
          autonomiaAte: s.autonomiaAte, capacidades, cron: s.cron,
        },
      });
      if (s.sop) {
        await prisma.sop.create({
          data: {
            orgId: org.id,
            agentId: criado.id,
            proposito: s.sop.proposito,
            gatilho: s.sop.gatilho,
            passos: [...s.sop.passos],
            definicaoDePronto: s.sop.definicaoDePronto,
            observacoes: s.sop.observacoes ?? null,
          },
        });
      }
      criados++;
    }
    console.log(`${org.slug}: ${criados} agente(s) criado(s), ${mantidos} atualizado(s)`);
  }

  const semDono = await prisma.agent.count({ where: { donoId: null } });
  if (semDono) {
    console.warn(
      `\n${semDono} agente(s) sem dono humano. Um agente sem dono não escala para ninguém — ` +
        'defina o dono na tela de Agentes.',
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
