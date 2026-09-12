/*
 * Semeia a régua: o catálogo de capacidades como DADO e a política base.
 *
 * É idempotente e conservador de propósito. Ele NÃO afrouxa a política sozinho:
 * se o arquivo do repositório baixa uma capacidade que o banco tem mais alta,
 * ele PARA — "descer nível nunca é automático" (RF-P-06) é invariante da
 * escada, e um seed rodando num deploy é exatamente o caminho automático que a
 * regra proíbe. Para fazer isso de propósito, ver AS DUAS ASSINATURAS abaixo.
 *
 *   pnpm --filter @mktos/api db:seed:politica
 *
 * ONDE A POLÍTICA DE VERDADE MORA
 * `PolicyService.recarregar()` prefere a PolicyVersion do banco à base
 * empacotada no build. Mudar um nível em `politica-root.json` ou
 * `politica-marketing-os.json` NÃO muda nada numa instalação já semeada até
 * ESTE script rodar lá. É o único caminho de surpresa real desta área: o código
 * dizendo R3 e a produção decidindo R2. O script termina imprimindo isso.
 */
import { Prisma, PrismaClient, RiskLevel } from '@prisma/client';
import {
  canonico,
  diffDePolitica,
  lerPolitica,
  lerDelta,
  resolverPolitica,
  verificarCatalogo,
  verificarReversibilidade,
  afrouxamentosDoDiff,
  motivoEscrito,
  textosDosAfrouxamentos,
  MINIMO_DO_MOTIVO,
  type Afrouxamento,
  type DeltaPolitica,
  type DiffDePolitica,
  type Politica,
  type TipoDeAfrouxamento,
} from '@mktos/policy';
import politicaRoot from '@mktos/policy/politica-root.json';
import politicaMktos from '@mktos/policy/politica-marketing-os.json';

const prisma = new PrismaClient();
const ORDEM = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5'];

/*
 * AS DUAS ASSINATURAS — e por que são duas.
 *
 * "Só por configuração escrita, com data e com o responsável identificado" é o
 * texto do RF-P-06. Na linha de comando, "escrita" e "responsável" são estas
 * variáveis — que ficam gravadas na PolicyVersion, não só no terminal de quem
 * rodou.
 *
 * São DUAS porque são duas decisões diferentes, e uma não pode comprar a
 * outra. Enquanto havia uma só, ACRESCENTAR uma capacidade ao catálogo do
 * repositório (evolução normal do produto, revisada em código) derrubava o seed
 * inteiro sob o rótulo de REBAIXAMENTO — e a assinatura dada para acrescentar
 * liberava, no mesmo comando, qualquer rebaixamento que estivesse no arquivo.
 *
 *   # rebaixar nível, afrouxar limite, mexer em seção do documento:
 *   POLITICA_REBAIXAMENTO_AUTOR='pedro.magnago@fullbpo.com' \
 *   POLITICA_REBAIXAMENTO_MOTIVO='ata de 11/09/2026: whatsapp volta a R2 em piloto' \
 *     pnpm --filter @mktos/api db:seed:politica
 *
 *   # acrescentar capacidade que a base do banco ainda não classifica:
 *   POLITICA_CAPACIDADE_NOVA_AUTOR='pedro.magnago@fullbpo.com' \
 *   POLITICA_CAPACIDADE_NOVA_MOTIVO='PR #412: catálogo ganha social.tiktok.publicar' \
 *     pnpm --filter @mktos/api db:seed:politica
 *
 * Sem a assinatura da CATEGORIA correspondente, o seed recusa a rodada inteira.
 * Não é burocracia: sem esta trava, baixar um nível no JSON e dar deploy
 * rebaixava a produção em silêncio, porque o serviço lê o DOCUMENTO da versão —
 * e o guarda que existia aqui protegia só as linhas da tabela `Capability`, que
 * o serviço não consulta para decidir.
 */
interface Assinatura {
  autor: string;
  motivo: string;
  variaveis: [string, string];
}

function assinatura(varAutor: string, varMotivo: string): Assinatura {
  return {
    autor: process.env[varAutor]?.trim() || '',
    motivo: process.env[varMotivo]?.trim() || '',
    variaveis: [varAutor, varMotivo],
  };
}

const ASSINATURAS = {
  rebaixamento: assinatura('POLITICA_REBAIXAMENTO_AUTOR', 'POLITICA_REBAIXAMENTO_MOTIVO'),
  'capacidade-nova': assinatura('POLITICA_CAPACIDADE_NOVA_AUTOR', 'POLITICA_CAPACIDADE_NOVA_MOTIVO'),
} as const;

type Categoria = keyof typeof ASSINATURAS;

/** Acrescentar capacidade é uma decisão; todo o resto é a outra. */
const categoriaDe = (tipo: TipoDeAfrouxamento): Categoria =>
  tipo === 'capacidade-nova' ? 'capacidade-nova' : 'rebaixamento';

const assinada = (c: Categoria): boolean =>
  ASSINATURAS[c].autor !== '' && motivoEscrito(ASSINATURAS[c].motivo);

/** O que afrouxa e NÃO tem a assinatura da própria categoria. */
const semAssinatura = (itens: readonly Afrouxamento[]): Afrouxamento[] =>
  itens.filter((i) => !assinada(categoriaDe(i.tipo)));

/**
 * O autor e o motivo que vão GRAVADOS na versão — das categorias que esta
 * rodada de fato usou, e não de todas as que existem.
 */
function assinaturaGravada(itens: readonly Afrouxamento[]): {
  autorId: string | null;
  motivo: string | null;
} {
  const categorias = [...new Set(itens.map((i) => categoriaDe(i.tipo)))];
  if (!categorias.length) return { autorId: null, motivo: null };
  return {
    autorId: [...new Set(categorias.map((c) => ASSINATURAS[c].autor))].join('; '),
    motivo: categorias.map((c) => `[${c}] ${ASSINATURAS[c].motivo}`).join(' | '),
  };
}

const ROTULO: Record<Categoria, string> = {
  rebaixamento: 'AFROUXA a política em vigor (nível, limite ou seção do documento)',
  'capacidade-nova':
    'ACRESCENTA capacidade que a base do banco ainda não classifica ' +
    '(não declarada valia R5, então liberar é afrouxar)',
};

/** A base atual do banco, quando existe — é contra ela que o diff é tirado. */
async function baseAtiva() {
  return prisma.policyVersion.findFirst({
    where: { orgId: null, ativaAte: null },
    orderBy: { versao: 'desc' },
  });
}

function recusarAfrouxamento(itens: readonly Afrouxamento[], onde: string): never {
  console.error(`\n${onde} exige decisão de gente e o seed não assina por ninguém (RF-P-06):`);
  for (const categoria of [...new Set(itens.map((i) => categoriaDe(i.tipo)))]) {
    const desta = itens.filter((i) => categoriaDe(i.tipo) === categoria);
    const [varAutor, varMotivo] = ASSINATURAS[categoria].variaveis;
    console.error(`\n  ${ROTULO[categoria]} — ${desta.length} item(ns):`);
    for (const i of desta) console.error(`    ${i.texto}`);
    console.error(
      `\n  Para fazer isso de propósito, assine ESTA categoria — fica gravado na versão:\n` +
        `    ${varAutor}='quem responde' \\\n` +
        `    ${varMotivo}='a decisão escrita, com pelo menos ${MINIMO_DO_MOTIVO} caracteres' \\\n` +
        '      pnpm --filter @mktos/api db:seed:politica',
    );
  }
  console.error('\nNada foi semeado.');
  process.exit(1);
}

async function main() {
  const base = lerPolitica(politicaRoot, 'politica-root.json');
  const delta = lerDelta(politicaMktos, 'politica-marketing-os.json');
  const doc = resolverPolitica(base, delta);

  /*
   * TRAVA 1 — catálogo que não bate com a própria régua não entra no banco.
   *
   * São DUAS verificações irmãs, e a segunda existe porque a primeira não
   * fecha nada sozinha: `verificarCatalogo` confere se o nível declarado é o
   * que a régua calcula do efeito, e `verificarReversibilidade` confere se a
   * capacidade que se diz automaticamente reversível aponta um desfazer que o
   * catálogo sabe dar. Um desfazer pendurado passa limpo pela primeira — foi
   * assim que três R2 viveram meses prometendo uma volta inexistente. Rodar só
   * uma aqui deixaria o teste do pacote verde e o banco errado.
   */
  const problemas = [
    ...verificarCatalogo(doc)
      .filter((l) => !l.ok)
      .map((l) => `${l.id}: declarado=${l.declarado} calculado=${l.calculado}`),
    ...verificarReversibilidade(doc).map(
      (l) => `${l.id} (${l.nivel}): ${l.motivo}${l.desfazer ? ` → ${l.desfazer}` : ''}`,
    ),
  ];
  if (problemas.length) {
    console.error('catálogo diverge da régua — nada foi semeado:');
    for (const p of problemas) console.error(`  ${p}`);
    process.exit(1);
  }

  /*
   * TRAVA 2 — o documento novo não pode afrouxar o que está valendo sem
   * assinatura.
   *
   * O QUE ELA COBRE, de verdade (`diffDePolitica`): capacidades (nível que
   * desce, capacidade nova, e os campos que SÃO trava de execução —
   * `ferramenta` e `argsSchema`), os limites padrão, e as seções `niveis`,
   * `escalonamento`, `invariantes`, `gatilhos` e `retencao`. As três últimas
   * seções e a `regra` do escalonamento não têm ordem definida em documento
   * nenhum: qualquer mudança nelas falha fechada e exige assinatura.
   *
   * O que ela NÃO cobre: `versao`, `atualizadoEm`, `origem` e `descricao` —
   * metadados que mudam a cada deploy e não decidem nada.
   */
  const ativa = await baseAtiva();
  const anterior = ativa ? lerPolitica(ativa.documento, `PolicyVersion ${ativa.id}`) : null;
  const diffDaVersaoAnterior = anterior ? diffDePolitica(anterior, doc) : null;
  const afrouxa = diffDaVersaoAnterior ? afrouxamentosDoDiff(diffDaVersaoAnterior) : [];
  const pendentes = semAssinatura(afrouxa);
  if (pendentes.length) recusarAfrouxamento(pendentes, 'O catálogo do repositório');

  let criadas = 0;
  let atualizadas = 0;
  const rebaixamentos: string[] = [];

  for (const c of doc.capacidades) {
    const atual = await prisma.capability.findUnique({ where: { id: c.id } });
    /*
     * O guarda linha a linha continua, agora coerente com a TRAVA 2: quando o
     * rebaixamento está assinado, ele APLICA. Antes ele pulava sempre, e o
     * resultado era pior que barrar — a linha da tabela ficava em R3 e o
     * documento da versão em R2, com o serviço decidindo pelo documento.
     */
    if (atual && ORDEM.indexOf(c.nivel) < ORDEM.indexOf(atual.level) && !assinada('rebaixamento')) {
      rebaixamentos.push(`${c.id}: ${atual.level} → ${c.nivel} (NÃO aplicado)`);
      continue;
    }
    const dados = {
      descricao: c.descricao,
      level: c.nivel as RiskLevel,
      efeito: c.efeito as object,
      hashKeys: [] as string[],
      // Prisma.DbNull e não `null`: coluna Json nulável exige o sentinela.
      argsSchema: (c.argsSchema ?? Prisma.DbNull) as Prisma.InputJsonValue,
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

  if (!ativa) {
    await prisma.policyVersion.create({
      data: {
        orgId: null,
        versao: 1,
        documento: doc as unknown as Prisma.InputJsonValue,
        motivo: 'política base ROOT, semeada do anexo normativo',
      },
    });
    console.log('política base v1 criada');
  } else if (canonico(ativa.documento) !== canonico(doc)) {
    /*
     * O documento mudou. NÃO se sobrescreve uma versão: fecha-se a atual e
     * abre-se a seguinte, com motivo e com o DIFF do que mudou. É o que torna a
     * política auditável — e o que permite responder "o que estava valendo
     * naquele dia" sem recalcular contra uma base que já é outra.
     *
     * `diffDaBase` fica NULO aqui: esta É a base, e "o que difere da base" não
     * é pergunta. O diff desta linha é contra a versão ANTERIOR da base, que é
     * a coluna com esse nome.
     */
    const agora = new Date();
    const gravada = assinaturaGravada(afrouxa);
    await prisma.$transaction([
      prisma.policyVersion.update({ where: { id: ativa.id }, data: { ativaAte: agora } }),
      prisma.policyVersion.create({
        data: {
          orgId: null,
          versao: ativa.versao + 1,
          documento: doc as unknown as Prisma.InputJsonValue,
          delta: delta as unknown as Prisma.InputJsonValue,
          diffDaBase: Prisma.DbNull,
          diffDaVersaoAnterior: (diffDaVersaoAnterior ??
            Prisma.DbNull) as unknown as Prisma.InputJsonValue,
          motivo: gravada.motivo ?? 'catálogo do repositório atualizado (seed)',
          autorId: gravada.autorId,
          ativaDe: agora,
        },
      }),
    ]);
    console.log(`política base v${ativa.versao} fechada; v${ativa.versao + 1} em vigor`);
    if (diffDaVersaoAnterior) console.log(`  ${resumoDoDiff(diffDaVersaoAnterior)}`);
    if (afrouxa.length) {
      console.warn(`  AFROUXAMENTO ASSINADO (${afrouxa.length} item(ns)):`);
      for (const t of textosDosAfrouxamentos(afrouxa)) console.warn(`    ${t}`);
    }
  } else {
    console.log(`política base v${ativa.versao} sem mudança`);
  }

  console.log(`capacidades: ${criadas} criadas, ${atualizadas} atualizadas, ${doc.capacidades.length} no total`);
  if (rebaixamentos.length) {
    console.warn('\nREBAIXAMENTOS IGNORADOS (exigem motivo escrito e decisão de gente):');
    for (const r of rebaixamentos) console.warn('  ' + r);
  }

  await reaplicarSobrescritasDasEmpresas(doc);

  console.log(
    '\nLEMBRETE: a política que VALE é a gravada aqui, não a dos JSON do repositório.\n' +
      '  Todo ambiente já semeado continua decidindo pela versão antiga até este seed rodar NELE.\n' +
      '  Trocar nível no arquivo e dar deploy não muda nada — é o erro que mais custa tempo nesta área.',
  );
}

const resumoDoDiff = (d: DiffDePolitica): string =>
  `${d.capacidades.length} capacidade(s), ${d.limites.length} limite(s) e ${d.secoes.length} seção(ões)`;

/**
 * A BASE MUDOU: as empresas que sobrescreveram precisam reaplicar o delta delas.
 *
 * Sem isto, a empresa com política própria congela na base do dia em que ela
 * sobrescreveu — a correção que a ROOT fizer depois nunca chega lá, em silêncio.
 * É a mesma armadilha do parágrafo acima, um nível abaixo, e a pior das duas:
 * ninguém tem nem o arquivo para conferir.
 *
 * A reaplicação obedece à MESMA trava, e ela mede contra o que estava valendo
 * PARA AQUELA EMPRESA (`atual`), que é a referência certa — a mesma conta que o
 * `PolicyService` faz. Se reaplicar o delta sobre a base nova afrouxar a
 * política daquela empresa, a empresa NÃO é tocada e o seed avisa. Base
 * descendo um nível é decisão da ROOT; propagá-la para o cliente sem ninguém
 * assinar seria o rebaixamento automático que o RF-P-06 proíbe.
 */
async function reaplicarSobrescritasDasEmpresas(base: Politica) {
  const versoes = await prisma.policyVersion.findMany({
    where: { orgId: { not: null }, ativaAte: null },
    orderBy: { versao: 'desc' },
  });
  if (!versoes.length) return;

  console.log(`\nempresas com política própria: ${versoes.length}`);
  for (const v of versoes) {
    const orgId = v.orgId as string;
    if (!v.delta) {
      console.warn(`  ${orgId}: versão sem delta gravado — não dá para reaplicar, ficou como está`);
      continue;
    }
    let delta: DeltaPolitica;
    let nova: Politica;
    let atual: Politica;
    try {
      delta = lerDelta(v.delta, `delta da empresa ${orgId}`);
      atual = lerPolitica(v.documento, `PolicyVersion ${v.id}`);
      nova = lerPolitica(resolverPolitica(base, delta), `sobrescrita da empresa ${orgId}`);
    } catch (e) {
      console.warn(`  ${orgId}: delta ilegível (${(e as Error).message}) — ficou como está`);
      continue;
    }

    if (canonico(atual) === canonico(nova)) {
      console.log(`  ${orgId}: sem mudança`);
      continue;
    }

    const diffDaVersaoAnterior = diffDePolitica(atual, nova);
    const diffDaBase = diffDePolitica(base, nova);
    const afrouxa = afrouxamentosDoDiff(diffDaVersaoAnterior);
    const pendentes = semAssinatura(afrouxa);
    if (pendentes.length) {
      console.warn(
        `  ${orgId}: reaplicar o delta sobre a base nova AFROUXARIA ${pendentes.length} item(ns) — ` +
          'NÃO aplicado (RF-P-06). Ver as assinaturas no cabeçalho deste script.',
      );
      for (const i of pendentes) console.warn(`      ${i.texto}`);
      continue;
    }

    const agora = new Date();
    const gravada = assinaturaGravada(afrouxa);
    await prisma.$transaction([
      prisma.policyVersion.update({ where: { id: v.id }, data: { ativaAte: agora } }),
      prisma.policyVersion.create({
        data: {
          orgId,
          versao: v.versao + 1,
          documento: nova as unknown as Prisma.InputJsonValue,
          delta: delta as unknown as Prisma.InputJsonValue,
          diffDaBase: diffDaBase as unknown as Prisma.InputJsonValue,
          diffDaVersaoAnterior: diffDaVersaoAnterior as unknown as Prisma.InputJsonValue,
          motivo:
            gravada.motivo ?? 'base da ROOT atualizada (seed) — o delta da empresa foi reaplicado',
          autorId: gravada.autorId,
          ativaDe: agora,
        },
      }),
    ]);
    console.log(
      `  ${orgId}: v${v.versao} fechada; v${v.versao + 1} em vigor (${resumoDoDiff(diffDaVersaoAnterior)})`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
