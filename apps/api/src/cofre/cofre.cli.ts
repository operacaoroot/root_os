/*
 * ============================================================================
 * O COFRE, PELA LINHA DE COMANDO — inventário, rotação e migração (RF-C-04)
 * ============================================================================
 *
 * ESTE É O ARQUIVO QUE A MIGRATION `20260911150000_cofre_de_segredos` CHAMA DE
 * `src/cofre/rotacionar-chave.cli.ts`. Esse nome nunca existiu: é um erro de
 * texto num comentário, e a migration NÃO pode ser corrigida — migration
 * aplicada é imutável (o banco guarda o resumo; editar o arquivo depois faz o
 * banco continuar com o SQL antigo enquanto o arquivo mostra o novo, e isso já
 * custou uma investigação inteira neste projeto). O apontamento fica aqui para
 * que quem seguir a referência quebrada chegue ao lugar certo.
 *
 *   node dist/cofre/cofre.cli.js inventario
 *   node dist/cofre/cofre.cli.js rotacionar --simular
 *   node dist/cofre/cofre.cli.js rotacionar --para k2
 *   node dist/cofre/cofre.cli.js rotacionar --para k2 --empresa org_abc --lote 50
 *   node dist/cofre/cofre.cli.js migrar --simular
 *   node dist/cofre/cofre.cli.js migrar
 *   node dist/cofre/cofre.cli.js desfazer-migracao --simular
 *
 * ----------------------------------------------------------------------------
 * POR QUE COMANDO, E NÃO ROTINA
 * ----------------------------------------------------------------------------
 * O argumento inteiro está no cabeçalho de `rotacao.service.ts`. Em uma linha: a
 * metade humana da rotação (gerar a chave, pôr em `COFRE_CHAVES` nos dois
 * lugares, recriar o container) é indispensável e nenhuma rotina pode fazê-la —
 * e a alternativa, uma rotina que gerasse a chave sozinha, faria o material
 * nascer dentro do processo que ele protege. É a mesma conclusão a que a fatia
 * do expurgo chegou na onda passada: manutenção que mexe em prova é comando que
 * alguém dá, e que fica no log de quem deu.
 *
 * ----------------------------------------------------------------------------
 * POR QUE ELE NÃO SOBE O NEST
 * ----------------------------------------------------------------------------
 * Mesmo motivo de `scripts/expurgar-rastro.ts`: subir o `AppModule` acordaria
 * cron, conector e fila só para re-cifrar coluna. E `RotacaoDeChaveService` não
 * é provider de módulo nenhum de propósito (ela atravessa TODAS as empresas):
 * `app.get()` não a encontraria. Construir à mão é o caminho declarado.
 *
 * A CONEXÃO PRECISA ATRAVESSAR O ISOLAMENTO POR LINHA (`DATABASE_URL`), e isso
 * não é detalhe: sob um papel que não ignora policy — e ser DONO da tabela não
 * basta, porque ela nasce com FORCE — a varredura enxergaria as linhas de UMA
 * empresa e reportaria "nada a rotacionar" com ar de sucesso.
 * `conferirQueAtravessaOIsolamento()` recusa antes.
 *
 * Roda COMPILADO (`dist/`) porque é assim que ele existe dentro do container da
 * api, onde `src/` não está.
 *
 * ============================================================================
 * O ROTEIRO COMPLETO DE UMA ROTAÇÃO — os passos fora deste arquivo importam
 * ============================================================================
 *
 * LEIA O PASSO 0 ANTES DE QUALQUER COISA. A versão anterior deste roteiro
 * DESTRUÍA toda credencial viva da bio quem o seguisse até o fim, e o motivo
 * está escrito no cabeçalho de `rotacao.service.ts`: o inventário só enxergava o
 * cofre, e as credenciais que o produto de fato lê ainda moram nas colunas de
 * origem da bio, cifradas com `ENCRYPTION_KEY`. O inventário dizia zero; tirar a
 * chave tornava tudo ilegível, sem volta.
 *
 *  0. `migrar --simular` e depois `migrar`. Traz para o cofre o que ainda mora
 *     nas colunas de origem. Enquanto restar credencial herdada cifrada com a
 *     chave de ambiente, `rotacionar` RECUSA sair dela — de propósito, e a
 *     mensagem diz quantas e onde;
 *  1. gerar a chave:            openssl rand -base64 32
 *  2. acrescentá-la (SEM tirar a antiga) a `COFRE_CHAVES` nos DOIS lugares — o
 *     bloco `environment:` do serviço `api` no docker-compose.yml E o `.env`.
 *     Variável que não está no bloco não chega no container: foi o que segurou a
 *     ANTHROPIC_API_KEY por semanas neste projeto;
 *  3. apontar `COFRE_CHAVE_ATUAL` para a nova;
 *  4. RECRIAR o container (`up -d --no-build api`). `docker restart` NÃO serve:
 *     variável de ambiente é fixada na criação;
 *  5. `rotacionar --simular` e conferir o inventário;
 *  6. `rotacionar`;
 *  7. `inventario` até a chave antiga aparecer com ZERO no TOTAL — não basta
 *     zerar a coluna `cofre`. A coluna `herdadas` conta o que a rotação não
 *     alcança, e enquanto ela não for zero a chave continua indispensável;
 *  8. só ENTÃO aposentar a chave antiga, E NA VARIÁVEL CERTA:
 *
 *       · chave `env`  → ela mora em `ENCRYPTION_KEY`. Apagar entrada de
 *         `COFRE_CHAVES` não a aposenta (ela nunca esteve lá) — o passo não teria
 *         efeito nenhum, e o efeito viria no dia em que alguém "consertasse"
 *         apagando a variável certa sem refazer o passo 7;
 *       · qualquer outra → a entrada `<id>:<base64>` correspondente em
 *         `COFRE_CHAVES`.
 *
 *     Em ambos os casos: os DOIS lugares, e recriar o container de novo.
 *
 * O passo 8 é o último por construção: enquanto a chave estiver no chaveiro, o
 * caminho de volta é `rotacionar --para <antiga>`. Depois dele, não é.
 *
 * A LINHA HERDADA QUE NUNCA SAI: `BioCredencialApp` com `orgId` nulo é o app
 * global da Root e o cofre é por empresa — ela não é migrável. Enquanto ela
 * existir, `ENCRYPTION_KEY` não é aposentável, e isso é uma decisão de produto
 * (ver PERGUNTAS no relatório da fatia 5.3), não um detalhe a descobrir aqui.
 */
import { PrismaClient } from '@prisma/client';
import { comTenantNaSessao } from '../prisma/sessao-de-banco';
import { EventLogService } from '../gateway/event-log.service';
import { idDaChaveAtual, idsDoChaveiro } from '../common/crypto';
import { CofreService } from './cofre.service';
import { type ContagemPorChave, RotacaoDeChaveService } from './rotacao.service';
import { desfazerMigracaoDoCofre, migrarCredenciaisParaOCofre } from './migrar-credenciais';

function opcao(args: string[], nome: string): string | undefined {
  const i = args.indexOf(`--${nome}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

/**
 * A tabela do inventário, com DUAS colunas de contagem.
 *
 * A coluna `herdadas` é o conserto do defeito que reprovou esta fatia: ela conta
 * o que a rotação NÃO alcança (as colunas cifradas de antes do cofre). Sem ela,
 * a chave de ambiente aparecia com zero depois de uma rotação e o roteiro
 * mandava aposentá-la — tornando ilegível cada credencial viva da bio.
 *
 * `total` é a coluna que responde "posso aposentar esta chave?". `cofre`
 * responde outra pergunta, "a rotação terminou?", e confundir as duas foi
 * exatamente o custo.
 */
function tabela(inventario: Record<string, ContagemPorChave>): string {
  const ids = Object.keys(inventario).sort();
  if (ids.length === 0) return '    (nada cifrado neste banco)';
  const cab = `    ${'chave'.padEnd(16)} ${'cofre'.padStart(8)} ${'herdadas'.padStart(9)} ${'TOTAL'.padStart(7)}`;
  const linhas = ids.map((id) => {
    const c = inventario[id];
    const aviso = c.herdadas > 0 ? '   << a rotação NÃO alcança estas' : '';
    return (
      `    ${id.padEnd(16)} ${String(c.cofre).padStart(8)} ` +
      `${String(c.herdadas).padStart(9)} ${String(c.total).padStart(7)}${aviso}`
    );
  });
  return [cab, ...linhas].join('\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const comando = args[0];
  const simular = args.includes('--simular');
  const empresa = opcao(args, 'empresa');

  if (!comando || comando.startsWith('--')) {
    console.error(
      'uso: cofre.cli.js <inventario|rotacionar|migrar|desfazer-migracao> [--simular] ' +
        '[--para <chaveId>] [--empresa <orgId>] [--lote <n>] [--forcar] [--aceitar-herdadas]',
    );
    process.exitCode = 2;
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL vazia. O cofre precisa da conexão DONA das tabelas — a mesma que roda ' +
        'migration. Nunca passe a URL na linha de comando: ela fica no histórico do shell.',
    );
  }

  const base = new PrismaClient({ datasourceUrl: url });
  // Modo `observar`: as varreduras do inventário e da rotação rodam
  // legitimamente sem empresa na sessão (ver `rotacao.service.ts`), e `impor`
  // transformaria isso em erro.
  const prisma = comTenantNaSessao(base, { modo: 'observar', avisar: () => undefined });

  const eventos = new EventLogService(prisma as never);
  const cofre = new CofreService(prisma as never, eventos);
  const rotacao = new RotacaoDeChaveService(prisma as never, eventos);

  try {
    await rotacao.conferirQueAtravessaOIsolamento();

    if (comando === 'inventario') {
      console.log(`\nChaveiro no ambiente: ${idsDoChaveiro().join(', ')}`);
      console.log(`Chave atual: ${idDaChaveAtual()}\n`);
      console.log('Segredos vivos, por chave que os abre:');
      const inv = await rotacao.inventario();
      console.log(tabela(inv));

      const herdadas = await rotacao.herdadas();
      if (herdadas.length) {
        console.log('\n  Credenciais HERDADAS (fora do cofre — a rotação não as toca):');
        for (const h of herdadas) {
          console.log(`    ${`${h.tabela}.${h.coluna}`.padEnd(34)} chave ${h.chaveId.padEnd(10)} ${h.quantas}`);
        }
        console.log(
          '\n  Uma chave só pode ser APOSENTADA quando o TOTAL dela for zero — a coluna\n' +
            '  `cofre` sozinha não responde essa pergunta. Para trazer as herdadas para o\n' +
            '  cofre: `migrar`. A chave "env" mora em ENCRYPTION_KEY, não em COFRE_CHAVES.',
        );
      }
      console.log('');
      return;
    }

    if (comando === 'rotacionar') {
      const r = await rotacao.rotacionar({
        paraChaveId: opcao(args, 'para'),
        orgId: empresa,
        lote: opcao(args, 'lote') ? Number(opcao(args, 'lote')) : undefined,
        simular,
        aceitarHerdadas: args.includes('--aceitar-herdadas'),
        actorId: process.env.USER ?? null,
      });

      console.log(`\nRotação para "${r.paraChaveId}"${r.simulado ? ' — SIMULAÇÃO' : ''}\n`);
      console.log('  antes:');
      console.log(tabela(r.inventarioAntes));
      console.log('  depois:');
      console.log(tabela(r.inventarioDepois));
      console.log(
        `\n  candidatas ............. ${r.candidatas}` +
          `\n  re-cifradas ............ ${r.recifradas}` +
          `\n  puladas (revogadas) .... ${r.puladasPorRevogacao}` +
          `\n  puladas (regravadas) ... ${r.puladasPorConcorrencia}` +
          `\n  falhas ................. ${r.falhas.length}` +
          `\n  tempo .................. ${r.duracaoMs} ms\n`,
      );
      for (const f of r.falhas) {
        console.log(`  FALHOU ${f.orgId} ${f.conector}/${f.nome} (chave ${f.chaveId}): ${f.erro}`);
      }
      const presas = r.herdadas.filter((h) => h.quantas > 0);
      if (presas.length) {
        console.log(
          '  ATENÇÃO: ainda há credencial cifrada FORA do cofre, que esta rotação não tocou:\n' +
            presas
              .map((h) => `    ${`${h.tabela}.${h.coluna}`.padEnd(34)} chave ${h.chaveId.padEnd(10)} ${h.quantas}`)
              .join('\n') +
            '\n  NÃO aposente nenhuma dessas chaves. Rode `migrar` antes.\n',
        );
      }
      /*
       * Saída 1 com qualquer falha. Quem roda isto precisa de um sinal: "rotacionou
       * 812 de 814" sem ninguém saber quais duas ficaram para trás é o jeito de
       * uma credencial ficar numa chave que vai sair do chaveiro na semana que vem.
       */
      if (r.falhas.length > 0) process.exitCode = 1;
      return;
    }

    if (comando === 'migrar') {
      const r = await migrarCredenciaisParaOCofre(prisma as never, cofre, {
        simular,
        forcar: args.includes('--forcar'),
        orgId: empresa,
        actorId: process.env.USER ?? null,
      });
      console.log(`\nMigração para o cofre${r.simulado ? ' — SIMULAÇÃO' : ''}\n`);
      for (const m of r.migrados) console.log(`  + ${m.orgId} ${m.conector}/${m.nome} (${m.origem})`);
      for (const m of r.jaNoCofre) console.log(`  = ${m.orgId} ${m.conector}/${m.nome} já no cofre`);
      for (const f of r.falhas) console.log(`  ! ${f.orgId} ${f.conector}/${f.nome}: ${f.erro}`);
      console.log(
        `\n  copiadas ............... ${r.migrados.length}` +
          `\n  já estavam no cofre .... ${r.jaNoCofre.length}` +
          `\n  de plataforma (fora) ... ${r.deixadosPorSerDePlataforma}` +
          `\n  falhas ................. ${r.falhas.length}` +
          `\n  tempo .................. ${r.duracaoMs} ms\n` +
          '\n  NADA foi apagado da origem: desfazer é `desfazer-migracao`.\n',
      );
      if (r.falhas.length > 0) process.exitCode = 1;
      return;
    }

    if (comando === 'desfazer-migracao') {
      const r = await desfazerMigracaoDoCofre(prisma as never, { simular, orgId: empresa });
      console.log(
        `\n${r.simulado ? 'SERIAM apagadas' : 'Apagadas'} ${r.apagados} linha(s) do cofre ` +
          '(só as de origem "migracao:*"; as colunas de origem nunca foram tocadas).\n',
      );
      return;
    }

    console.error(`comando desconhecido: "${comando}"`);
    process.exitCode = 2;
  } finally {
    await base.$disconnect();
  }
}

main().catch((e) => {
  console.error('\nfalhou:', (e as Error).message);
  process.exit(1);
});
