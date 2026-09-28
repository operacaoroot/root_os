/*
 * O USO DO STORAGE PELA MÍDIA DAS PEÇAS (MD4) — medir e, à mão, limpar órfãos.
 *
 *   node dist/scripts/storage-uso.js                                   # mede
 *   node dist/scripts/storage-uso.js --remover-orfaos                  # diz o que SERIA removido
 *   node dist/scripts/storage-uso.js --remover-orfaos --dias 30 --confirmar
 *   pnpm --filter @mktos/api storage:uso -- --remover-orfaos
 *
 * Na VPS: `docker exec mktos_api node dist/scripts/storage-uso.js`.
 *
 * POR QUE EXISTE: o mp4 do corte (até 300 MB) mora no MinIO, no mesmo disco do
 * Postgres e do backup diário, e nada o apaga. Re-render, troca de candidato
 * (MD13) e o envio que cai no 409 deixam objetos sem peça nenhuma apontando
 * para eles. Sem medição, o disco enche e o sintoma aparece como "banco fora
 * do ar".
 *
 * O QUE ELE FAZ: lista `pauta/pecas/` (mp4) e `pauta/peca/` (PNG e JPEG), lê a
 * `meta` de TODAS as peças, de todas as empresas, e separa o referenciado do
 * órfão, com a idade. Remover é opt-in duplo (`--remover-orfaos` e
 * `--confirmar`), só leva órfão com `--dias` ou mais (padrão 7, mínimo 1) e
 * nunca roda como rotina: manutenção que apaga é comando que alguém dá.
 *
 * A CONEXÃO É A DONA DAS TABELAS E ATRAVESSA O ISOLAMENTO (`DATABASE_URL`): sob
 * o papel restrito, a leitura das peças voltaria vazia em silêncio, tudo pareceria
 * órfão, e a remoção apagaria a mídia de todas as peças. Por isso a conferência
 * de `conferirQueAtravessaOIsolamento` vem antes, e `motivoParaNaoRemover`
 * recusa de novo se nenhuma chave referenciada aparecer.
 *
 * Não sobe o Nest: o `StorageService` só precisa das variáveis `S3_*`, e o
 * Prisma, da URL. Roda COMPILADO (`dist/`), que é como ele existe no container.
 */
import { PrismaClient } from '@prisma/client';
import { StorageService } from '../storage/storage.service';
import { conferirQueAtravessaOIsolamento } from '../memory/migrar-conhecimento';
import {
  DIAS_MINIMOS_PARA_REMOVER,
  PREFIXOS_DA_MIDIA_DAS_PECAS,
  chavesDaMeta,
  formatarBytes,
  motivoParaNaoRemover,
  usoDoStorage,
  type ObjetoDoStorage,
} from '../storage/uso-da-midia';

const LOTE_DE_PECAS = 500;

function opcao(args: string[], nome: string): string | undefined {
  const i = args.indexOf(`--${nome}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const remover = args.includes('--remover-orfaos');
  const confirmar = args.includes('--confirmar');
  const diasBruto = opcao(args, 'dias');
  const dias = diasBruto === undefined ? DIAS_MINIMOS_PARA_REMOVER : Number(diasBruto);
  if (!Number.isInteger(dias) || dias < 1) throw new Error(`--dias "${diasBruto}" precisa ser um inteiro de 1 para cima.`);

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL vazia: a leitura das peças precisa da conexão DONA das tabelas (a que roda migration).');
  const storage = new StorageService();
  if (!storage.configured) throw new Error('S3_ACCESS_KEY e S3_SECRET_KEY vazias: sem elas não há storage para medir.');

  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    await conferirQueAtravessaOIsolamento(prisma);

    const objetos: ObjetoDoStorage[] = [];
    for (const prefixo of PREFIXOS_DA_MIDIA_DAS_PECAS) objetos.push(...(await storage.listar(prefixo)));

    const referenciadas = new Set<string>();
    let pecasLidas = 0;
    let cursor: string | undefined;
    for (;;) {
      const lote = await prisma.pautaPeca.findMany({
        select: { id: true, meta: true },
        orderBy: { id: 'asc' },
        take: LOTE_DE_PECAS,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      for (const p of lote) for (const c of chavesDaMeta(p.meta)) referenciadas.add(c);
      pecasLidas += lote.length;
      if (lote.length < LOTE_DE_PECAS) break;
      cursor = lote[lote.length - 1].id;
    }

    const uso = usoDoStorage(objetos, referenciadas, new Date(), dias);
    console.log(`\nMídia das peças no storage (${PREFIXOS_DA_MIDIA_DAS_PECAS.join(' e ')})\n`);
    console.log(`  total:         ${formatarBytes(uso.bytes)} em ${uso.objetos} objeto(s)`);
    console.log(`  referenciado:  ${formatarBytes(uso.referenciados.bytes)} em ${uso.referenciados.objetos} objeto(s) (${pecasLidas} peça(s) lida(s))`);
    console.log(`  órfão:         ${formatarBytes(uso.orfaos.bytes)} em ${uso.orfaos.objetos} objeto(s)`);
    const levaria = uso.removiveis.reduce((t, o) => t + o.bytes, 0);
    console.log(`  órfão com ${dias}+ dia(s): ${formatarBytes(levaria)} em ${uso.removiveis.length} objeto(s)\n`);

    if (!remover) {
      if (uso.removiveis.length) console.log('Para ver o que sairia: --remover-orfaos. Para remover de fato: --remover-orfaos --confirmar.\n');
      return;
    }
    const recusa = motivoParaNaoRemover(uso, pecasLidas, 0);
    if (recusa) {
      console.error(`Remoção recusada: ${recusa}`);
      process.exitCode = 2;
      return;
    }
    for (const o of uso.removiveis) {
      console.log(`  ${confirmar ? 'removendo' : 'sairia'}  ${o.chave}  ${formatarBytes(o.bytes)}  ${o.idadeDias} dia(s)`);
      if (confirmar) await storage.remover(o.chave);
    }
    console.log(
      confirmar
        ? `\n${uso.removiveis.length} órfão(s) removido(s), ${formatarBytes(levaria)} liberados.\n`
        : `\nSIMULAÇÃO: nada foi removido. Repita com --confirmar para remover ${uso.removiveis.length} objeto(s).\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(`storage:uso falhou: ${(e as Error).message}`);
  process.exitCode = 1;
});
