/*
 * ============================================================================
 * O GERADOR DE DOCUMENTAÇÃO, PELA LINHA DE COMANDO (RF-M-07)
 * ============================================================================
 *
 *   node dist/scripts/gerar-documentacao.js --empresa root --simular
 *   node dist/scripts/gerar-documentacao.js --empresa root
 *   node dist/scripts/gerar-documentacao.js --empresa root --pasta "root-os/documentacao"
 *   pnpm --filter @mktos/api docs:gerar -- --empresa root --simular
 *
 * O que ele faz: lê o estado DECLARADO da empresa (regras da casa, definições,
 * dicionário, decisões, fatos, agentes com procedimento, rotinas e conexões) e
 * escreve uma base de conhecimento .md na vault, com marcador de geração. A
 * lógica toda mora em `src/memory/documentacao.ts`; aqui é só a borda.
 *
 * ----------------------------------------------------------------------------
 * POR QUE ELE NÃO SOBE O NEST
 * ----------------------------------------------------------------------------
 * Mesmo motivo de `expurgar-rastro.ts` e de `memory/memoria.cli.ts`: subir o
 * `AppModule` acordaria cron, conector e fila só para escrever arquivo. Roda
 * COMPILADO (`dist/`) porque é assim que ele existe dentro do container da api,
 * onde `src/` não está — e porque nada que dependa de injeção do Nest funciona
 * sob `tsx` (o esbuild não emite `emitDecoratorMetadata`).
 *
 * ----------------------------------------------------------------------------
 * A CONEXÃO É A DONA DAS TABELAS (`DATABASE_URL`), E ISSO NÃO É DETALHE
 * ----------------------------------------------------------------------------
 * `ContextItem` nasce com FORCE ROW LEVEL SECURITY, que vale para o dono também.
 * Sob um papel que não ignora policy, a leitura enxergaria zero linha e o
 * comando geraria uma documentação VAZIA por cima da anterior — com ar de
 * sucesso. Três coisas impedem: `conferirQueAtravessaOIsolamento` recusa antes,
 * e `EstadoVazioError` (nada veio) e `ColapsoParcialError` (uma família inteira
 * não veio) recusam depois, já dentro de `aplicarNaVault`. A segunda existe
 * porque o caso real do isolamento é ZERO numa tabela e tudo nas outras, e não
 * um pouco menos em todas.
 *
 * ----------------------------------------------------------------------------
 * `--empresa` É OBRIGATÓRIO, E É DECISÃO
 * ----------------------------------------------------------------------------
 * A vault é UMA, e o caminho dela é global (`OBSIDIAN_VAULT_PATH`). Um comando
 * que varresse todas as empresas de uma vez escreveria a documentação de todas
 * no mesmo lugar — o caso "alguém lê achando que é outra coisa". A pasta de cada
 * empresa ainda leva o apelido dela no caminho, mas a escolha continua sendo de
 * quem chama.
 */
import { PrismaClient } from '@prisma/client';
import {
  aplicarNaVault,
  coletarEstado,
  DestinoNaoProvadoError,
  EstadoVazioError,
  montarPaginas,
  PastaDeOutraEmpresaError,
  type PaginaForasteira,
  type ResumoDaGeracao,
} from '../memory/documentacao';
import { conferirQueAtravessaOIsolamento } from '../memory/migrar-conhecimento';
import { configDoEspelho, raizDaVault } from '../pauta/espelho.service';

/** A subpasta da vault onde a documentação mora, se ninguém disser outra. */
const PASTA_PADRAO = 'root-os/documentacao';

function opcao(args: string[], nome: string): string | undefined {
  const i = args.indexOf(`--${nome}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

function lista(rotulo: string, itens: string[], nota?: string): void {
  if (itens.length === 0) return;
  console.log(`  ${rotulo} (${itens.length})${nota ? ` — ${nota}` : ''}`);
  for (const i of itens) console.log(`      ${i}`);
}

function forasteiras(rotulo: string, itens: PaginaForasteira[], nota: string): void {
  lista(
    rotulo,
    itens.map((f) => `${f.nome}  (diz ter sido gerada em/para "${f.declarado}")`),
    nota,
  );
}

function imprimir(r: ResumoDaGeracao): void {
  console.log(`\nDocumentação em "${r.pasta}"${r.simulado ? ' — SIMULAÇÃO' : ''}\n`);
  lista('criadas', r.criadas);
  lista('reescritas', r.reescritas);
  console.log(`  inalteradas (${r.inalteradas.length}) — o corpo não mudou desde a última volta`);
  lista(
    'PRESERVADAS porque foram editadas à mão',
    r.editadasAMao,
    'corpo OU cabeçalho — inclusive uma etiqueta posta no painel de propriedades do Obsidian. ' +
      'A promessa de RF-M-07 em ação: para voltar a receber atualização, apague o arquivo',
  );
  lista(
    'PRESERVADAS porque não são nossas',
    r.alheias,
    'existe um .md com esse nome e sem marcador de geração — a página NÃO foi escrita',
  );
  lista(
    'PRESERVADAS por marcador ilegível',
    r.marcadorIlegivel,
    'tem `gerado_por: root-os` mas falta selo, empresa ou caminho — trate como editada à mão',
  );
  forasteiras(
    'PRESERVADAS porque são de OUTRA EMPRESA',
    r.deOutraEmpresa,
    'duas empresas apontadas para a mesma pasta. Nada foi sobrescrito; separe as pastas',
  );
  forasteiras(
    'PRESERVADAS porque vieram de OUTRO LUGAR',
    r.deOutroLugar,
    'página nossa copiada, renomeada ou movida por cima deste caminho. Nada foi sobrescrito',
  );
  lista(
    'NÃO ESCRITAS porque mudaram durante esta volta',
    r.mudouDuranteAVolta,
    'alguém editou o arquivo entre a decisão e a gravação. Rode de novo para ver o estado novo',
  );
  lista(
    'ÓRFÃS',
    r.orfas,
    'geradas por nós e sem correspondência viva hoje. NÃO foram apagadas: apagar é decisão de gente',
  );

  if (r.reescritasSeguradas.length > 0) {
    lista(
      'TETO: reescritas SEGURADAS',
      r.reescritasSeguradas,
      'acima do teto para uma volta só. As CRIAÇÕES foram feitas (são aditivas); estas NÃO',
    );
    console.log(
      '\n  Uma volta em que quase tudo muda ao mesmo tempo tem cara de estado lido pela metade — ' +
        'confira a empresa e a conexão. A lista acima é para ser inspecionada ANTES de destravar. ' +
        'Se a mudança for real, repita com `--aceitar-reescrita-em-massa`.',
    );
  }
  console.log(
    r.simulado
      ? '\n  Nada foi gravado. Rode sem --simular para escrever.\n'
      : '\n  Escrita numa direção só: editar na vault não volta pro banco.\n',
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const simular = args.includes('--simular');
  const empresa = opcao(args, 'empresa');
  const pasta = opcao(args, 'pasta') ?? PASTA_PADRAO;
  const local = args.includes('--local');
  const aceitarPastaNaoProvada = args.includes('--aceitar-pasta-nao-provada');
  const aceitarReescritaEmMassa = args.includes('--aceitar-reescrita-em-massa');
  const aceitarColapsoParcial = args.includes('--aceitar-colapso-parcial');

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL vazia. A geração precisa da conexão DONA das tabelas — a mesma que roda ' +
        'migration. Nunca passe a URL na linha de comando: ela fica no histórico do shell.',
    );
  }

  const prisma = new PrismaClient({ datasourceUrl: url });

  try {
    await conferirQueAtravessaOIsolamento(prisma);

    if (!empresa) {
      const todas = await prisma.org.findMany({
        select: { slug: true, name: true },
        orderBy: { slug: 'asc' },
      });
      console.error(
        'uso: gerar-documentacao.js --empresa <apelido|id> [--simular] [--pasta <relativa>]\n' +
          '                          [--local] [--aceitar-pasta-nao-provada]\n' +
          '                          [--aceitar-reescrita-em-massa] [--aceitar-colapso-parcial]\n\n' +
          '--empresa é obrigatório de propósito: a vault é uma só, e gerar tudo de uma vez\n' +
          'misturaria empresas na mesma árvore. Empresas neste banco:\n' +
          todas.map((o) => `  ${o.slug} — ${o.name}`).join('\n'),
      );
      process.exitCode = 2;
      return;
    }

    const org = await prisma.org.findFirst({
      where: { OR: [{ id: empresa }, { slug: empresa }] },
      select: { id: true, slug: true, name: true },
    });
    if (!org) throw new Error(`empresa "${empresa}" não existe neste banco.`);

    /*
     * O DESTINO SAI DO ESPELHO, que é quem já guarda essa escolha por empresa.
     *
     * O destino `drive` NÃO SERVE AQUI, e a razão é o próprio requisito: para
     * não sobrescrever arquivo editado à mão é preciso LER o que está lá antes
     * de escrever, e o conector do Google só expõe escrita
     * (`gravarArquivoNoDrive`). Sem leitura de volta, o marcador seria enfeite:
     * o comando sobrescreveria tudo e chamaria isso de geração. Recusar é a
     * única resposta honesta até o conector ganhar a leitura — está no relatório
     * da fatia como pendência nomeada.
     */
    const cfg = await configDoEspelho(prisma, org.id);
    if (cfg.destino === 'drive' && !local) {
      throw new Error(
        'o espelho desta empresa está configurado para o Google Drive, e a documentação ainda ' +
          'não sabe escrever lá: honrar o marcador de geração exige LER o arquivo antes de ' +
          'gravar, e o conector do Google só expõe escrita. Sobrescrever sem ler quebraria a ' +
          'promessa de não tocar em arquivo editado à mão. Use `--local` para escrever na vault ' +
          'montada nesta máquina.',
      );
    }
    if (cfg.destino === 'off' && !local) {
      throw new Error(
        'o espelho desta empresa está DESLIGADO (destino "off"). Nada foi escrito. Se a intenção ' +
          'é gerar a documentação mesmo assim, repita com `--local` — assim a escolha fica ' +
          'explícita em vez de o comando decidir por conta própria.',
      );
    }

    const vault = raizDaVault();
    // A empresa no caminho: a vault é uma só, e duas empresas na mesma pasta é
    // exatamente o engano que a fatia manda evitar.
    const dir = `${pasta.replace(/\/+$/, '')}/${org.slug}`;

    const estado = await coletarEstado(prisma, org.id);
    const paginas = montarPaginas(estado);

    console.log(
      `\nEmpresa ${org.slug} (${org.name}) — ${estado.notas.length} nota(s), ` +
        `${estado.agentes.length} agente(s), ${estado.rotinas.length} rotina(s), ` +
        `${estado.conexoes.length} conexão(ões) → ${paginas.length} página(s).`,
    );

    const resumo = aplicarNaVault(vault, dir, estado, paginas, {
      simular,
      aceitarPastaNaoProvada,
      aceitarReescritaEmMassa,
      aceitarColapsoParcial,
    });
    imprimir(resumo);

    /*
     * Saída 1 quando sobrou coisa para uma pessoa decidir. Arquivo editado à mão
     * NÃO entra aqui: ele é a promessa funcionando, não incidente. Página de
     * outra empresa, página vinda de outro lugar e página que mudou no meio da
     * volta entram: as três dizem que a pasta está sendo usada por mais de uma
     * mão, e isso é para alguém olhar.
     */
    if (
      resumo.reescritasSeguradas.length > 0 ||
      resumo.alheias.length > 0 ||
      resumo.deOutraEmpresa.length > 0 ||
      resumo.deOutroLugar.length > 0 ||
      resumo.mudouDuranteAVolta.length > 0
    ) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  // `ColapsoParcialError` é um `EstadoVazioError` — cai no mesmo braço.
  if (
    e instanceof EstadoVazioError ||
    e instanceof DestinoNaoProvadoError ||
    e instanceof PastaDeOutraEmpresaError
  ) {
    console.error(`\nrecusado: ${e.message}\n`);
    process.exit(1);
  }
  console.error('\nfalhou:', (e as Error).message);
  process.exit(1);
});
