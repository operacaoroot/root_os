/*
 * O EXPURGO DO RASTRO POR RETENÇÃO — quem chama (RF-R-06).
 *
 *   node dist/scripts/expurgar-rastro.js --simular
 *   node dist/scripts/expurgar-rastro.js
 *   node dist/scripts/expurgar-rastro.js --empresa org_abc123
 *   node dist/scripts/expurgar-rastro.js --corte 2026-09-01
 *   pnpm --filter @mktos/api expurgo:rastro -- --simular
 *
 * ----------------------------------------------------------------------------
 * POR QUE ESTE ARQUIVO EXISTE
 * ----------------------------------------------------------------------------
 * Até 11/09/2026 o expurgo não tinha CHAMADOR NENHUM: nem script, nem entrada
 * declarada no `package.json`, nem rotina, nem rota. A única coisa que chamava
 * `ExpurgoService.varrer()` era a suíte — e sempre com a lista de empresas na
 * mão, então o caminho que DESCOBRE as empresas sozinho (o de produção, o que
 * carrega a ressalva de isolamento) nunca rodava. Resultado: `retencaoAte` era
 * carimbado em toda linha do RASTRO e nada apagava. A retenção por empresa
 * existia como promessa de tela.
 *
 * ----------------------------------------------------------------------------
 * POR QUE ELE NÃO SOBE O NEST
 * ----------------------------------------------------------------------------
 * Mesmo motivo de `relatorio-observar.ts`, mais um que é só daqui:
 *
 *  - subir o `AppModule` acordaria cron, conector e fila só para apagar linha
 *    velha;
 *  - e, principalmente, `ExpurgoService` NÃO É PROVIDER DE MÓDULO NENHUM, de
 *    propósito. Ele não está no injetor da aplicação justamente para não ser
 *    alcançável por requisição (ver `audit/audit.module.ts`). `app.get()` não o
 *    encontraria; construí-lo à mão é o caminho declarado.
 *
 * A CONEXÃO É A DONA DAS TABELAS, e isso não é detalhe: `app_rastro_expurgar`
 * começa com `ALTER TABLE ... DISABLE RULE`, que exige ser dono. Por isso lemos
 * `DATABASE_URL` e não a URL do papel restrito. Se alguém apontar este script
 * para a conexão da aplicação, `conferirQueEhDono()` recusa alto em vez de
 * apagar zero linha com ar de sucesso.
 *
 * Roda COMPILADO (`dist/`) porque é assim que ele existe dentro do container da
 * api, onde `src/` não está.
 *
 * ----------------------------------------------------------------------------
 * COMO AGENDAR
 * ----------------------------------------------------------------------------
 * Uma vez por dia basta: `retencaoAte` é medido em dias e o corte é idempotente
 * (rodar duas vezes no mesmo dia não apaga nada a mais e não escreve evento
 * duplicado). Na VPS, um `cron` no host chamando
 * `docker exec mktos_api node dist/scripts/expurgar-rastro.js`.
 *
 * NÃO virou cron dentro da API de propósito: um expurgo que roda sozinho dentro
 * do processo que atende requisição é o mesmo caminho que a camada de módulo
 * acabou de fechar. Manutenção que apaga prova é comando que alguém dá — e que
 * fica no log de quem deu.
 */
import { PrismaClient } from '@prisma/client';
import { comTenantNaSessao } from '../prisma/sessao-de-banco';
import { EventLogService, TIPO_EXPURGO } from '../gateway/event-log.service';
import { AuditService } from '../audit/audit.service';
import { ExpurgoService } from '../audit/expurgo.service';

/** Valor de uma opção `--nome valor`, ou `undefined`. */
function opcao(args: string[], nome: string): string | undefined {
  const i = args.indexOf(`--${nome}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const simular = args.includes('--simular');
  const umaEmpresa = opcao(args, 'empresa');
  const corteBruto = opcao(args, 'corte');

  let corte = new Date();
  if (corteBruto) {
    const d = new Date(corteBruto);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`--corte "${corteBruto}" não é uma data. Use ISO: 2026-09-01.`);
    }
    corte = d;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL vazia. O expurgo precisa da conexão DONA das tabelas — a mesma que roda ' +
        'migration. Nunca passe a URL na linha de comando: ela fica no histórico do shell.',
    );
  }

  /*
   * O cliente EMBRULHADO, e não um `PrismaClient` cru: é ele que põe
   * `SET LOCAL app.org_id` na frente de cada consulta, e é disso que
   * `app_rastro_expurgar` precisa para conferir que a empresa pedida é a da
   * sessão. Modo `observar` porque as duas consultas de descoberta rodam
   * legitimamente sem empresa (ver o cabeçalho de `expurgo.service.ts`).
   */
  const base = new PrismaClient({ datasourceUrl: url });
  const prisma = comTenantNaSessao(base, { modo: 'observar', avisar: () => undefined });

  const eventos = new EventLogService(prisma as never);
  const auditoria = new AuditService(prisma as never);
  const expurgo = new ExpurgoService(prisma as never, eventos, auditoria);

  try {
    await expurgo.conferirQueEhDono();

    const empresas = umaEmpresa
      ? [umaEmpresa]
      : await expurgo.empresasComRastroVencido(corte);

    if (empresas.length === 0) {
      console.log(`\nNenhuma empresa com rastro vencido em ${corte.toISOString()}.\n`);
      return;
    }

    if (simular) {
      console.log(`\nSIMULAÇÃO — nada será apagado. Corte: ${corte.toISOString()}\n`);
      let total = 0;
      for (const orgId of empresas) {
        const [linha] = await prisma.$queryRaw<{ quantos: bigint; de: bigint | null; ate: bigint | null }[]>`
          SELECT count(*) AS quantos, min("seq") AS de, max("seq") AS ate
            FROM "EventLog"
           WHERE "orgId" = ${orgId} AND "retencaoAte" < ${corte} AND "tipo" <> ${TIPO_EXPURGO}`;
        const quantos = Number(linha?.quantos ?? 0n);
        total += quantos;
        const dias = await eventos.diasDeRetencao(orgId);
        console.log(
          `  ${orgId}: ${quantos} evento(s) vencido(s) (seq ${linha?.de ?? '-'}–${linha?.ate ?? '-'}), ` +
            `retenção de ${dias} dias`,
        );
      }
      console.log(`\nTotal que SERIA apagado: ${total}.\n`);
      return;
    }

    const resumo = await expurgo.varrer({ corte, orgIds: empresas });

    console.log(`\nExpurgo do rastro — corte ${resumo.corte}\n`);
    for (const e of resumo.empresas) {
      if (e.erro) {
        console.log(`  ${e.orgId}: FALHOU — ${e.erro}`);
        continue;
      }
      if (e.apagados === 0) {
        console.log(`  ${e.orgId}: nada vencido (retenção de ${e.diasDeRetencao} dias)`);
        continue;
      }
      console.log(
        `  ${e.orgId}: ${e.apagados} apagado(s), seq ${e.seqDe}–${e.seqAte}, ` +
          `retenção de ${e.diasDeRetencao} dias, registrado em ${e.eventoId}`,
      );
    }
    console.log(`\nTotal: ${resumo.apagados} evento(s) apagados, ${resumo.falhas} empresa(s) com falha.\n`);

    /*
     * Saída 1 quando alguma empresa falhou, mesmo com as outras tendo dado
     * certo: quem agenda isto precisa de um sinal, e "apagou em 40 de 41" sem
     * ninguém saber qual é o jeito de uma empresa ficar para trás para sempre.
     */
    if (resumo.falhas > 0) process.exitCode = 1;
  } finally {
    await base.$disconnect();
  }
}

main().catch((e) => {
  console.error('\nfalhou:', (e as Error).message);
  process.exit(1);
});
