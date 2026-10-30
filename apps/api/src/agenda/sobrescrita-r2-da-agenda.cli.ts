/*
 * A SOBRESCRITA ASSINADA DA APROVAÇÃO DE R2 DA AGENDA — pela linha de comando
 * (agenda v2, 29/10/2026, decisão 2).
 *
 *   node dist/agenda/sobrescrita-r2-da-agenda.cli.js --org <slug|id>
 *       (simula: mostra o que muda para cada escrita da agenda; não grava nada)
 *
 *   node dist/agenda/sobrescrita-r2-da-agenda.cli.js --org <slug|id> --valer \
 *       --como <e-mail de quem assina> --motivo "<por quê, com data>"
 *       (desliga a aprovação de R2 da empresa pelo PolicyService.sobrescrever:
 *        versão nova da política da empresa, com autor e motivo, RF-P-04 e
 *        RF-P-06. O delta que a empresa já tem é preservado.)
 *
 *   ... --religar --valer --como <e-mail> --motivo "<por quê>"
 *       (volta a ligar: R2 de gente na tela torna a ir para a fila)
 *
 * Roda COMPILADO (usa o Nest), dentro do container da API. O alcance é só de
 * gente na tela (a porta confere): agente, rotinas, WhatsApp e link público
 * seguem com R2 retido, e R3 (reabrir) exige aprovação sempre.
 */
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { comContexto } from '../common/contexto-execucao';
import { PolicyService } from '../policy/policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { MOTIVO_MINIMO_R2, analisarAprovacaoR2, deltaDaAprovacaoR2 } from './sobrescrita-r2-da-agenda';

function opcao(args: string[], nome: string): string | undefined {
  const i = args.indexOf(`--${nome}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

const SAI = { fila: 'vai para a fila (outra pessoa confirma)', clique: 'sai no clique' } as const;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const alvo = opcao(args, 'org');
  const valer = args.includes('--valer');
  const religar = args.includes('--religar');
  const como = opcao(args, 'como');
  const motivo = opcao(args, 'motivo')?.trim();
  if (!alvo) throw new Error('falta --org <slug ou id da empresa>.');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const policy = app.get(PolicyService);
    const org = await prisma.org.findFirst({ where: { OR: [{ id: alvo }, { slug: alvo }] }, select: { id: true, slug: true } });
    if (!org) throw new Error(`não achei a empresa "${alvo}".`);

    await comContexto({ orgId: org.id, correlationId: `sobrescrita-r2-agenda-${Date.now()}`, origem: 'script' }, async () => {
      const atual = await policy.deltaDaEmpresa(org.id);
      const estado = await policy.estadoDaAprovacaoR2(org.id);
      const ligadaDepois = religar;
      const delta = deltaDaAprovacaoR2(atual, new Date().toISOString().slice(0, 10));
      const linhas = analisarAprovacaoR2(policy.baseHerdada(), delta, estado.ligada, ligadaDepois);

      console.log(`\nEmpresa ${org.slug}: aprovação de R2 hoje ${estado.ligada ? 'LIGADA' : 'DESLIGADA'}` +
        `${estado.desde ? ` (desde ${estado.desde.slice(0, 10)}, v${estado.versao})` : ''}; depois ${ligadaDepois ? 'LIGADA' : 'DESLIGADA'}.`);
      console.log(`Delta atual da empresa: ${atual ? `${atual.capacidades.length} capacidade(s) sobrescrita(s), preservadas` : 'nenhum'}.`);
      console.log('O que a régua diz (dia comum, dentro da janela de 08h a 20h):');
      for (const l of linhas) {
        const muda = l.hojeNaTela !== l.depoisNaTela ? '  << muda' : '';
        console.log(`  · ${l.capacidade} (${l.nivel}): gente na tela ${SAI[l.depoisNaTela]}; agente, rotina e link público: ${SAI[l.foraDaTela]}${muda}`);
      }
      console.log('Fora da janela, ou com outro sinal aceso, R2 sobe para R3 e vai para a fila de qualquer jeito.');

      if (!valer) {
        console.log('\nSimulação: nada foi gravado. Para aplicar: --valer --como <e-mail> --motivo "<por quê>".\n');
        return;
      }
      if (estado.ligada === ligadaDepois) {
        console.log(`\nNada muda: a aprovação de R2 já está ${estado.ligada ? 'ligada' : 'desligada'}.\n`);
        return;
      }
      if (!como) throw new Error('falta --como <e-mail>: a sobrescrita exige responsável identificado (RF-P-06).');
      if (!motivo || motivo.length < MOTIVO_MINIMO_R2) throw new Error(`falta --motivo com pelo menos ${MOTIVO_MINIMO_R2} caracteres (RF-P-06).`);
      const autor = await prisma.user.findFirst({ where: { orgId: org.id, isActive: true, OR: [{ email: como }, { id: como }] }, select: { id: true } });
      if (!autor) throw new Error(`não achei usuário ativo "${como}" na empresa ${org.slug}.`);

      const r = await policy.sobrescrever({ orgId: org.id, delta, autorId: autor.id, motivo, aprovacaoR2Ligada: ligadaDepois });
      console.log(r.criada ? `\nPolítica da empresa v${r.versao} em vigor (assinada).` : '\nNada mudou: a política da empresa já era esta.');
      console.log('A porta lê a aprovação de R2 do banco a cada pedido: vale já, em todas as réplicas.\n');
    });
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(`\nErro: ${(e as Error).message}\n`);
  process.exit(1);
});
