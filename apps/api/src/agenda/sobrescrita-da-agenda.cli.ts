/*
 * A SOBRESCRITA ASSINADA DO VIGIA DA AGENDA — pela linha de comando.
 *
 *   node dist/agenda/sobrescrita-da-agenda.cli.js --org <slug|id>
 *       (simula: mostra o delta e o que a régua diz dele; não grava nada)
 *
 *   node dist/agenda/sobrescrita-da-agenda.cli.js --org <slug|id> --valer \
 *       --como <e-mail de quem assina> --motivo "<por quê, com data>"
 *       (aplica pelo PolicyService.sobrescrever: versão nova da política da
 *        empresa, com autor e motivo — RF-P-04, RF-P-06)
 *
 * Roda COMPILADO (usa o Nest), dentro do container da API. Recusa `--valer`
 * enquanto a análise disser que o documento não fecha — o serviço recusaria
 * com 400 de qualquer jeito, e aqui a mensagem diz o que falta. O que o delta
 * muda, e por que hoje ele ainda não basta, está em `sobrescrita-da-agenda.ts`
 * e em docs/AGENDA.md ("O vigia age sozinho?").
 */
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { comContexto } from '../common/contexto-execucao';
import { PolicyService } from '../policy/policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { MOTIVO_MINIMO, analisarSobrescrita, deltaDoVigiaSozinho } from './sobrescrita-da-agenda';

function opcao(args: string[], nome: string): string | undefined {
  const i = args.indexOf(`--${nome}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const alvo = opcao(args, 'org');
  const valer = args.includes('--valer');
  const como = opcao(args, 'como');
  const motivo = opcao(args, 'motivo')?.trim();
  if (!alvo) throw new Error('falta --org <slug ou id da empresa>.');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const policy = app.get(PolicyService);
    const org = await prisma.org.findFirst({ where: { OR: [{ id: alvo }, { slug: alvo }] }, select: { id: true, slug: true } });
    if (!org) throw new Error(`não achei a empresa "${alvo}".`);

    await comContexto({ orgId: org.id, correlationId: `sobrescrita-agenda-${Date.now()}`, origem: 'script' }, async () => {
      const atual = await policy.deltaDaEmpresa(org.id);
      const delta = deltaDoVigiaSozinho(policy.baseHerdada(), atual, new Date().toISOString().slice(0, 10));
      const analise = analisarSobrescrita(policy.baseHerdada(), delta);

      console.log(`\nEmpresa ${org.slug}: sobrescrita de agenda.evento.padronizar para R2 (desfazer agenda.evento.restaurar).`);
      console.log(`Delta atual da empresa: ${atual ? `${atual.capacidades.length} capacidade(s) sobrescrita(s), preservadas` : 'nenhum'}.`);
      console.log(`A régua decide: ${analise.decisao.nivel}, ${analise.decisao.exigeAprovacao ? 'COM aprovação' : 'sem aprovação'}.`);
      if (analise.ageSozinho) console.log('Com esta sobrescrita o vigia corrige o título sem passar pela fila.');
      else for (const p of analise.porQueNao) console.log(`  · ainda não: ${p}`);

      if (!valer) {
        console.log('\nSimulação: nada foi gravado. Para aplicar: --valer --como <e-mail> --motivo "<por quê>".\n');
        console.log(JSON.stringify(delta, null, 2));
        return;
      }
      if (analise.problemas.length) throw new Error('a régua recusa este documento; nada foi gravado (veja "ainda não" acima).');
      if (!como) throw new Error('falta --como <e-mail>: a sobrescrita que afrouxa exige responsável identificado (RF-P-06).');
      if (!motivo || motivo.length < MOTIVO_MINIMO) throw new Error(`falta --motivo com pelo menos ${MOTIVO_MINIMO} caracteres (RF-P-06).`);
      const autor = await prisma.user.findFirst({ where: { orgId: org.id, isActive: true, OR: [{ email: como }, { id: como }] }, select: { id: true } });
      if (!autor) throw new Error(`não achei usuário ativo "${como}" na empresa ${org.slug}.`);

      const r = await policy.sobrescrever({ orgId: org.id, delta, autorId: autor.id, motivo });
      console.log(r.criada ? `\nPolítica da empresa v${r.versao} em vigor (assinada).` : '\nNada mudou: a política da empresa já era esta.');
      console.log('Só ESTE processo recarregou: recrie o container da API para todas as réplicas lerem a versão nova.\n');
    });
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(`\nErro: ${(e as Error).message}\n`);
  process.exit(1);
});
