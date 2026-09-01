/*
 * A fila de aprovação pela linha de comando.
 *
 * Sem argumento, LISTA o que está esperando. Com um id, confirma E executa —
 * o mesmo caminho da tela, incluindo a recusa quando quem aprova é quem propôs.
 *
 *   node dist/scripts/aprovar.js
 *   node dist/scripts/aprovar.js <approvalId> --como "Pedro"
 *
 * Roda compilado: tsx não emite metadata de decorator e o Nest não injeta nada.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { AcoesService } from '../gateway/acoes.service';

async function main() {
  const args = process.argv.slice(2);
  const id = args.find((a) => !a.startsWith('--'));
  const i = args.indexOf('--como');
  const quem = i >= 0 ? args[i + 1] : (process.env.USER ?? 'terminal');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const approvals = app.get(ApprovalsService);
    const acoes = app.get(AcoesService);

    const org = await prisma.org.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
    if (!org) throw new Error('nenhuma empresa ativa');

    if (!id) {
      const fila = await approvals.listar(org.id);
      if (!fila.items.length) {
        console.log('\nA fila está vazia.\n');
        return;
      }
      console.log(`\n${fila.total} ação(ões) esperando gente:\n`);
      for (const a of fila.items) {
        const min = Math.floor(a.esperandoMs / 60000);
        console.log(`  ${a.nivel}  ${a.id}`);
        console.log(`      ${a.resumo}`);
        console.log(`      ${a.capacidade ?? '—'} · esperando há ${min} min · expira ${new Date(a.expiraEm).toLocaleTimeString('pt-BR')}`);
        console.log('');
      }
      console.log('para aprovar:  node dist/scripts/aprovar.js <id> --como "Seu Nome"\n');
      return;
    }

    console.log(`\nconfirmando ${id} como "${quem}"…`);
    const conf = await approvals.confirm(org.id, id, quem);
    console.log(`  confirmada: ${conf.summary}`);

    const exec = await acoes.executarAprovada(org.id, id, quem);
    if (exec.status === 'executado') {
      console.log(`  EXECUTADA: ${JSON.stringify(exec.resultado)}\n`);
    } else if (exec.status === 'sem_efeito') {
      console.log(`  NÃO EXECUTADA: ${exec.motivo}\n`);
    } else {
      console.log('  nada a executar (aprovação da superfície antiga)\n');
    }
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error('\nfalhou:', (e as Error).message);
  process.exit(1);
});
