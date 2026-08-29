/*
 * Pergunta à central pela linha de comando — o canal `terminal` do conceito.
 *
 * Sobe o contexto do Nest (sem servidor HTTP), roda o laço do agente de
 * verdade e imprime o traço. Serve para dois usos:
 *   - provar em produção que o motor responde, sem precisar de login;
 *   - diagnosticar uma sessão quando a tela não estiver à mão.
 *
 * A troca vira uma Session de verdade, com custo e rastro — não é simulação.
 *
 *   docker compose exec api pnpm exec tsx scripts/perguntar.ts "quanto entrou hoje?"
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AgentRuntime } from '../src/agents/agent-runtime.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SessionCanal } from '@prisma/client';

async function main() {
  const pedido = process.argv.slice(2).join(' ').trim();
  if (!pedido) {
    console.error('uso: tsx scripts/perguntar.ts "sua pergunta"');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);
    const runtime = app.get(AgentRuntime);

    const org = await prisma.org.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
    if (!org) throw new Error('nenhuma empresa ativa no banco');

    const slug = process.env.AGENTE ?? 'assistente';
    console.log(`\n[${org.slug}] ${slug} ← ${pedido}\n`);

    const r = await runtime.executar({
      orgId: org.id,
      agentSlug: slug,
      canal: SessionCanal.terminal,
      pedido,
      solicitanteRotulo: process.env.USER ?? 'terminal',
      onEvento: (e) => {
        if (e.t === 'passo') console.log(`  ▸ ${e.capacidade} · ${e.args}`);
        if (e.t === 'passo_ok') console.log(`    ${e.decisao} (${e.nivel}) · ${e.resultado}`);
        if (e.t === 'aprovacao') console.log(`    RETIDO ${e.nivel} · ${e.motivo}`);
      },
    });

    console.log(`\n${r.resposta}\n`);
    console.log(
      `— ${r.status} · ${r.passos} passo(s) · ${(r.duracaoMs / 1000).toFixed(1)}s · ` +
        (r.custoEstimado && r.custoUsd > 0 ? `US$ ${r.custoUsd.toFixed(6)}` : 'custo não medido'),
    );
    if (r.fontes.length) console.log(`— fontes: ${r.fontes.map((f) => f.titulo).join(' · ')}`);
    if (r.aprovacoes.length) {
      console.log(`— ${r.aprovacoes.length} ação(ões) na fila: ${r.aprovacoes.map((a) => a.resumo).join(', ')}`);
    }
    console.log(`— sessão ${r.sessionId}`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error('\nfalhou:', (e as Error).message);
  process.exit(1);
});
