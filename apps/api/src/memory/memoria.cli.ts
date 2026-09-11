/*
 * ============================================================================
 * A MEMÓRIA, PELA LINHA DE COMANDO — migrar o acervo e conferir os vetores
 * ============================================================================
 *
 *   node dist/memory/memoria.cli.js conferir
 *   node dist/memory/memoria.cli.js migrar --simular
 *   node dist/memory/memoria.cli.js migrar
 *   node dist/memory/memoria.cli.js migrar --empresa org_abc
 *   node dist/memory/memoria.cli.js desfazer-migracao --simular
 *   node dist/memory/memoria.cli.js desfazer-migracao
 *
 * O ROTEIRO, na ordem, e a ordem importa:
 *
 *  0. PARE A REINDEXAÇÃO enquanto migra: `OBSIDIAN_REINDEX_MIN=0` no bloco
 *     `environment:` do serviço `api` E no `.env`, e RECRIE o container
 *     (`up -d --no-build api`; `docker restart` não serve, variável de ambiente
 *     é fixada na criação). Se a vault for reindexada no meio, a contagem de
 *     origem muda debaixo da migração e ela se recusa a gravar — de propósito.
 *  1. `conferir` — quantos vetores existem hoje, dos dois lados;
 *  2. `migrar --simular` — quantas notas seriam copiadas;
 *  3. `migrar` — a cópia, com a conferência de vetores DENTRO da transação;
 *  4. `conferir` de novo — origem e destino têm de bater;
 *  5. religue a reindexação.
 *
 * POR QUE COMANDO, E NÃO MIGRATION
 * --------------------------------
 * `prisma migrate deploy` roda no `command` do container: uma cópia de centenas
 * de linhas com vetor que falhe no meio DERRUBA A API. É o mesmo argumento da
 * fatia 5.3 e a mesma solução (`cofre.cli.js migrar`).
 *
 * POR QUE ELE NÃO SOBE O NEST
 * ---------------------------
 * Mesmo motivo de `scripts/expurgar-rastro.ts` e de `cofre.cli.ts`: subir o
 * `AppModule` acordaria cron, conector e fila só para copiar linha. Roda
 * COMPILADO (`dist/`) porque é assim que ele existe dentro do container, onde
 * `src/` não está — e porque nada que dependa de injeção do Nest funciona sob
 * `tsx` (o esbuild não emite `emitDecoratorMetadata`).
 *
 * A CONEXÃO É A DONA DAS TABELAS (`DATABASE_URL`), e isso não é detalhe:
 * `ContextItem` nasce com FORCE ROW LEVEL SECURITY, que vale para o dono também.
 * Sob um papel que não ignora policy, a varredura enxergaria zero linha e o
 * comando sairia dizendo "nada a migrar" com ar de sucesso.
 * `conferirQueAtravessaOIsolamento` recusa antes.
 */
import { PrismaClient } from '@prisma/client';
import {
  contarVetores,
  desfazerMigracao,
  migrarConhecimentoParaAMemoria,
} from './migrar-conhecimento';

function opcao(args: string[], nome: string): string | undefined {
  const i = args.indexOf(`--${nome}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

function linhaDeContagem(rotulo: string, n: number): string {
  return `  ${rotulo.padEnd(34, '.')} ${String(n).padStart(6)}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const comando = args[0];
  const simular = args.includes('--simular');
  const empresa = opcao(args, 'empresa');

  if (!comando || comando.startsWith('--')) {
    console.error(
      'uso: memoria.cli.js <conferir|migrar|desfazer-migracao> [--simular] [--empresa <orgId>]',
    );
    process.exitCode = 2;
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL vazia. A migração precisa da conexão DONA das tabelas — a mesma que roda ' +
        'migration. Nunca passe a URL na linha de comando: ela fica no histórico do shell.',
    );
  }

  const prisma = new PrismaClient({ datasourceUrl: url });

  try {
    if (comando === 'conferir') {
      const c = await contarVetores(prisma, empresa);
      console.log(`\nVetores${empresa ? ` da empresa ${empresa}` : ''}:\n`);
      console.log(linhaDeContagem('KnowledgeNote (origem)', c.origem));
      console.log(linhaDeContagem('ContextItem vault (destino)', c.destino));
      if (c.origem === c.destino) {
        console.log('\n  OK: a contagem bate. Nenhum vetor se perdeu no caminho.\n');
      } else if (c.destino === 0) {
        console.log('\n  A migração ainda não rodou. Comece por `migrar --simular`.\n');
      } else {
        console.log(
          `\n  ATENÇÃO: faltam ${c.origem - c.destino} vetor(es) no destino. Rode ` +
            '`migrar` de novo (é idempotente) e confira de novo.\n',
        );
        process.exitCode = 1;
      }
      return;
    }

    if (comando === 'migrar') {
      const r = await migrarConhecimentoParaAMemoria(prisma, {
        simular,
        orgId: empresa,
        actorId: process.env.USER ?? null,
      });
      console.log(`\nMigração do acervo da vault${r.simulado ? ' — SIMULAÇÃO' : ''}\n`);
      console.log(linhaDeContagem('notas na origem', r.candidatas));
      console.log(linhaDeContagem('copiadas', r.copiadas));
      console.log(linhaDeContagem('já estavam na memória', r.jaEstavam));
      console.log('');
      console.log(linhaDeContagem('vetores ANTES  (origem)', r.antes.origem));
      console.log(linhaDeContagem('vetores ANTES  (destino)', r.antes.destino));
      console.log(linhaDeContagem('vetores DEPOIS (origem)', r.depois.origem));
      console.log(linhaDeContagem('vetores DEPOIS (destino)', r.depois.destino));
      console.log(linhaDeContagem('tempo (ms)', r.duracaoMs));
      console.log(
        r.simulado
          ? '\n  Nada foi gravado. `migrar` sem --simular faz a cópia.\n'
          : '\n  NADA foi apagado da origem: desfazer é `desfazer-migracao`.\n',
      );
      return;
    }

    if (comando === 'desfazer-migracao') {
      const r = await desfazerMigracao(prisma, { simular, orgId: empresa });
      console.log(
        `\n${r.simulado ? 'SERIAM apagadas' : 'Apagadas'} ${r.apagados} nota(s) que NASCERAM ` +
          'nesta migração e que ninguém encostou desde então (as versões vão junto pela ' +
          'cascata; `KnowledgeNote` nunca foi tocada, então os vetores continuam lá).\n',
      );
      if (r.preservados > 0) {
        console.log(
          `  PRESERVADAS: ${r.preservados} nota(s) de origem "vault" ficaram. Elas têm versão ` +
            'nova, histórico com mais de uma linha ou evento no RASTRO — ou seja, a operação ' +
            'agiu sobre elas depois da cópia. Apagá-las levaria o histórico junto e deixaria ' +
            'evento apontando para linha que não existe. Para tirar da memória sem perder o ' +
            'histórico, ARQUIVE na tela.\n',
        );
      }
      return;
    }

    console.error(`comando desconhecido: "${comando}"`);
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('\nfalhou:', (e as Error).message);
  process.exit(1);
});
