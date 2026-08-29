/*
 * Semeia a régua: o catálogo de capacidades como DADO e a política base.
 *
 * É idempotente e conservador de propósito. Ele NÃO rebaixa nível: se o banco
 * tem uma capacidade num nível diferente do arquivo, ele avisa e não mexe —
 * "descer nível nunca é automático" é invariante da escada, e um seed rodando
 * num deploy é exatamente o caminho automático que a regra proíbe.
 *
 *   pnpm --filter @mktos/api db:seed:politica
 */
import { PrismaClient, RiskLevel } from '@prisma/client';
import {
  lerPolitica,
  lerDelta,
  resolverPolitica,
  verificarCatalogo,
} from '@mktos/policy';
import politicaRoot from '@mktos/policy/politica-root.json';
import politicaMktos from '@mktos/policy/politica-marketing-os.json';

const prisma = new PrismaClient();
const ORDEM = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5'];

async function main() {
  const base = lerPolitica(politicaRoot, 'politica-root.json');
  const delta = lerDelta(politicaMktos, 'politica-marketing-os.json');
  const doc = resolverPolitica(base, delta);

  // Trava: catálogo que não bate com a própria régua não entra no banco.
  const divergencias = verificarCatalogo(doc).filter((l) => !l.ok);
  if (divergencias.length) {
    console.error('catálogo diverge da régua — nada foi semeado:');
    for (const d of divergencias) {
      console.error(`  ${d.id}: declarado=${d.declarado} calculado=${d.calculado}`);
    }
    process.exit(1);
  }

  let criadas = 0;
  let atualizadas = 0;
  const rebaixamentos: string[] = [];

  for (const c of doc.capacidades) {
    const atual = await prisma.capability.findUnique({ where: { id: c.id } });
    if (atual && ORDEM.indexOf(c.nivel) < ORDEM.indexOf(atual.level)) {
      rebaixamentos.push(`${c.id}: ${atual.level} → ${c.nivel} (NÃO aplicado)`);
      continue;
    }
    const dados = {
      descricao: c.descricao,
      level: c.nivel as RiskLevel,
      efeito: c.efeito as object,
      hashKeys: [] as string[],
      ferramenta: c.ferramenta ?? null,
      rota: c.rota ?? null,
      desfazer: c.desfazer ?? null,
    };
    if (atual) {
      await prisma.capability.update({ where: { id: c.id }, data: dados });
      atualizadas++;
    } else {
      await prisma.capability.create({ data: { id: c.id, ...dados } });
      criadas++;
    }
  }

  const ativa = await prisma.policyVersion.findFirst({
    where: { orgId: null, ativaAte: null },
    orderBy: { versao: 'desc' },
  });
  if (!ativa) {
    await prisma.policyVersion.create({
      data: {
        orgId: null,
        versao: 1,
        documento: doc as unknown as object,
        motivo: 'política base ROOT, semeada do anexo normativo',
      },
    });
    console.log('política base v1 criada');
  } else {
    console.log(`política base já existe (v${ativa.versao}) — não sobrescrita`);
  }

  console.log(`capacidades: ${criadas} criadas, ${atualizadas} atualizadas, ${doc.capacidades.length} no total`);
  if (rebaixamentos.length) {
    console.warn('\nREBAIXAMENTOS IGNORADOS (exigem motivo escrito e decisão de gente):');
    for (const r of rebaixamentos) console.warn('  ' + r);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
