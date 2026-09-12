/*
 * O que a porta FEZ em modo observar — a régua medida com dado real (RF-P-03).
 *
 * Não é um "e se": desde 10/09/2026 observar afrouxa o CARIMBO do registro,
 * nunca o efeito — bloqueio de R5 e retenção por aprovação valem igual nos dois
 * modos (ver o cabeçalho de `gateway/tool-gateway.service.ts`). O que cada linha
 * deste relatório conta já aconteceu: a ação parou de verdade.
 *
 * Antes de virar `GATEWAY_MODO` de `observar` para `impor`, alguém precisa
 * olhar o que a classificação produziu na operação de verdade. Este relatório
 * lê a tabela de decisões de política (`PolicyDecision`, escrita por
 * `PolicyService.avaliarERegistrar` a cada passagem pela porta) e responde três
 * perguntas: em que nível as ações caem, quais capacidades concentram o que foi
 * retido ou recusado, e se a régua está apertada ou frouxa demais.
 *
 *   node dist/scripts/relatorio-observar.js --dias 7
 *   node dist/scripts/relatorio-observar.js --desde 2026-09-01 --ate 2026-09-07 --csv-em /tmp/regua.csv
 *   pnpm --filter @mktos/api relatorio:observar -- --dias 30
 *
 * Roda COMPILADO (`dist/`) porque é assim que ele existe dentro do container da
 * api, onde `src/` não está. Diferente de `perguntar.ts` e `aprovar.ts`, este
 * NÃO sobe o contexto do Nest: ele só lê duas tabelas, não precisa de injeção, e
 * subir o AppModule inteiro acordaria cron, conector e fila só para imprimir uma
 * contagem. O preço é que `DATABASE_URL` precisa estar no ambiente — nunca na
 * linha de comando, que fica no histórico do shell.
 *
 * O QUE ESTA CONTAGEM PODE NÃO PEGAR (leia antes de decidir virar a chave).
 * `PolicyDecision` só nasce depois que a porta classifica. As duas recusas mais
 * comuns de um agente novo acontecem ANTES disso — capacidade fora da declaração
 * do agente e argumento que não bate com o schema — e saem por
 * `ToolGateway.recusar()`. Até 10/09/26 esse caminho gravava `ToolCall` com
 * `decisionId` nulo e nenhuma decisão de política: as duas recusas que mais
 * importam para calibrar sumiam justamente deste relatório. A fatia 0.3a
 * corrigiu isso — hoje `recusar()` registra a decisão antes de recusar, com
 * motivo próprio ("recusado na porta: ..."), e o `ToolCall` aponta para ela
 * (conferido no código em 10/09/26, depois da correção).
 * A medida do buraco continua aqui, e é ela que mantém a frase honesta: o
 * relatório conta, na mesma janela e na mesma empresa, os `ToolCall` de status
 * `recusado` sem `decisionId`, e imprime o número na ressalva do cabeçalho e na
 * linha `secao=ressalva` do CSV. Com a porta corrigida esse número é ZERO para
 * linha nova, e a ressalva diz isso; ele volta a subir se sobrar dado do mundo
 * antigo na janela, ou se algum caminho novo recusar sem registrar decisão —
 * que é exatamente quando alguém precisa saber. Nenhuma das duas frases
 * envelhece mentindo.
 *
 * O CSV sai em formato de máquina (separador vírgula, decimal ponto, uma linha
 * por seção) e carrega em TODA linha a empresa e os três limiares do critério:
 * ele sobrevive ao terminal e vai para planilha, onde um veredito sem a régua ao
 * lado não quer dizer nada. O relatório em texto é o que se lê.
 */
import { writeFileSync } from 'node:fs';
import { PrismaClient, RiskLevel, ToolCallStatus } from '@prisma/client';

/* ------------------------------------------------------------------ critério */

/*
 * A régua da régua. Estes três números são o critério de calibragem e saem
 * impressos no próprio relatório e em toda linha do CSV — quem lê precisa saber
 * contra o que o veredito foi medido, senão "apertada" é opinião.
 */
const TETO_R3_MAIS = 0.2; // acima disso a operação trava esperando gente
const PISO_R0_R1 = 0.95; // daqui para cima a porta não está segurando nada
const AMOSTRA_MINIMA = 20; // abaixo disso o percentual é ruído, não sinal

type Veredito = 'apertada' | 'frouxa' | 'calibrada' | 'amostra pequena';

function vereditoDe(total: number, r3mais: number, r0r1: number): Veredito {
  if (total < AMOSTRA_MINIMA) return 'amostra pequena';
  if (r3mais / total > TETO_R3_MAIS) return 'apertada';
  if (r0r1 / total >= PISO_R0_R1) return 'frouxa';
  return 'calibrada';
}

const NIVEIS = (Object.values(RiskLevel) as RiskLevel[]).slice().sort();
const INDICE_R3 = NIVEIS.indexOf(RiskLevel.R3);
const SEM_CAPACIDADE = '(sem capacidade)';

/* ------------------------------------------------------------------ opções */

interface Opcoes {
  dias: number;
  desde?: string;
  ate?: string;
  org?: string;
  top: number;
  fuso: string;
  csv: boolean;
  csvEm?: string;
  max: number;
}

const AJUDA = `
relatorio-observar — o que a porta reteve e recusou com o carimbo de observar
                     (reteve mesmo: observar não afrouxa freio, só o registro)

  --dias N            janela dos últimos N dias (padrão: 7)
  --desde AAAA-MM-DD  início do período, 00:00 no fuso; ignora --dias
  --ate AAAA-MM-DD    fim do período, 23:59:59 no fuso (padrão: agora)
  --org SLUG          empresa (padrão: a primeira empresa ativa)
  --top N             quantas capacidades listar (padrão: 30; 0 = todas)
  --fuso NOME         fuso do corte do dia (padrão: America/Sao_Paulo)
  --csv-em ARQUIVO    grava o CSV no arquivo em vez de imprimir
  --sem-csv           só o relatório em texto
  --max N             teto de decisões lidas (padrão: 500000)
  --ajuda             esta ajuda

--dias N é janela corrida de N x 24h, não N dias de calendário: as pontas caem no
meio do dia local e a tabela por dia marca esses dias como "parcial". Para dias
inteiros, use --desde/--ate.

A contagem de recusadas é piso quando existe recusa sem decisão de política vinculada
(era o caso da recusa por capacidade não declarada ou argumento inválido até 10/09/26).
O cabeçalho traz a ressalva com o número que falta, medido em ToolCall — hoje ZERO para
linha nova, e ele diz isso.

DATABASE_URL vem do ambiente. Não passe credencial por argumento.
`;

function lerOpcoes(argv: string[]): Opcoes {
  const o: Opcoes = { dias: 7, top: 30, fuso: 'America/Sao_Paulo', csv: true, max: 500_000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const valor = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} espera um valor`);
      return v;
    };
    switch (a) {
      case '--dias':
        o.dias = inteiro(valor(), '--dias');
        break;
      case '--desde':
        o.desde = data(valor(), '--desde');
        break;
      case '--ate':
        o.ate = data(valor(), '--ate');
        break;
      case '--org':
        o.org = valor();
        break;
      case '--top':
        o.top = inteiro(valor(), '--top', 0);
        break;
      case '--fuso':
        o.fuso = valor();
        break;
      case '--csv-em':
        o.csvEm = valor();
        break;
      case '--sem-csv':
        o.csv = false;
        break;
      case '--max':
        o.max = inteiro(valor(), '--max');
        break;
      case '--ajuda':
      case '-h':
        console.log(AJUDA);
        process.exit(0);
      default:
        throw new Error(`opção desconhecida: ${a}\n${AJUDA}`);
    }
  }
  return o;
}

function inteiro(v: string, nome: string, minimo = 1): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < minimo) throw new Error(`${nome} espera um inteiro >= ${minimo}`);
  return n;
}

function data(v: string, nome: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${nome} espera AAAA-MM-DD`);
  return v;
}

/* ------------------------------------------------------------------- fuso */

/*
 * `criadoEm` é `timestamp without time zone` gravado em UTC pelo Prisma. O
 * corte do dia, porém, é o dia de quem opera: 23h de 9/9 em São Paulo é 2h de
 * 10/9 em UTC, e usar UTC jogaria o pico da noite para o dia seguinte.
 */

// Um `Intl.DateTimeFormat` por fuso: construir formatador é caro e `paredeLocal`
// roda uma vez por decisão lida — com meio milhão de linhas isso apareceria.
const formatadoresParede = new Map<string, Intl.DateTimeFormat>();

/** Hora de parede naquele fuso, no formato "AAAA-MM-DD HH:MM:SS" (ordenável). */
function paredeLocal(instante: Date, fuso: string): string {
  let f = formatadoresParede.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat('sv-SE', {
      timeZone: fuso,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      // `hourCycle: 'h23'` explícito, e não `hour12: false`: este último, em ICU
      // antigo, imprime "24:00:00" para a meia-noite de alguns locales, e aí a
      // comparação de texto lá embaixo ordena errado.
      hourCycle: 'h23',
    });
    formatadoresParede.set(fuso, f);
  }
  // Alguns builds de ICU separam data e hora com espaço estreito (U+202F) ou
  // não-quebrável (U+00A0) em vez do espaço comum.
  return f.format(instante).replace(/[\u202f\u00a0]/g, ' ');
}

function deslocamentoMs(instante: Date, fuso: string): number {
  const s = paredeLocal(instante, fuso);
  // O texto formatado não tem milissegundo. Comparar com o instante cru
  // devolveria o deslocamento somado ao resto de milissegundos, e o fim do dia
  // (23:59:59.999) vazaria 999ms para o dia seguinte — o que transformava um
  // período invertido em janela de um segundo em vez de erro.
  return Date.parse(`${s.replace(' ', 'T')}Z`) - Math.floor(instante.getTime() / 1000) * 1000;
}

/**
 * Instante UTC correspondente a uma hora de parede naquele fuso.
 * `hora` é HH:MM:SS; `ms` são os milissegundos daquele segundo.
 */
function instanteLocal(dataISO: string, hora: string, fuso: string, ms = 0): Date {
  const pedido = `${dataISO} ${hora}`;
  const comoUtc = Date.parse(`${dataISO}T${hora}Z`);
  // Duas passadas: a primeira estima o deslocamento, a segunda o corrige caso o
  // próprio salto de horário de verão caia dentro da janela.
  const primeira = new Date(comoUtc - deslocamentoMs(new Date(comoUtc), fuso));
  const segunda = new Date(comoUtc - deslocamentoMs(primeira, fuso));
  // Conferência: formata de volta. Se bater, acabou — é o caso de 99% dos fusos
  // e de 100% dos dias de America/Sao_Paulo, que não tem horário de verão desde
  // 2019.
  if (paredeLocal(segunda, fuso) === pedido) return new Date(segunda.getTime() + ms);
  /*
   * Não bateu: a hora pedida NÃO EXISTE nesse dia. Acontece em fuso cujo salto
   * de horário de verão cai à meia-noite — America/Havana, America/Santiago,
   * Asia/Beirut — onde o relógio pula de 23:59:59 direto para 01:00:00 e
   * "00:00" simplesmente não é um instante. As duas passadas, aí, devolvem um
   * instante da véspera (em Havana, 23:00 do dia anterior), e a janela do
   * relatório engoliria uma hora de outro dia.
   * O corte passa a ser o instante da transição: o primeiro instante cuja hora
   * de parede já alcançou a pedida. Sem `ms` — a virada é a borda, não tem
   * fração a somar.
   */
  return new Date(primeiroInstanteDeParedeAPartirDe(pedido, comoUtc, fuso));
}

/**
 * Menor instante cuja hora de parede em `fuso` é >= `pedido`. Busca binária
 * dentro de +-26h do palpite — folga suficiente para qualquer deslocamento de
 * fuso (o extremo é UTC+14) mais o salto do horário de verão.
 *
 * Só é chamada quando a hora pedida não existe, isto é, quando o relógio saltou
 * por cima dela. Nesse trecho a hora de parede é estritamente crescente no
 * instante, então a busca binária é válida. (Na volta do horário de verão a
 * parede anda para trás, mas aí a hora pedida existe — em duplicata — e a
 * conferência acima já aceitou uma das duas.)
 */
function primeiroInstanteDeParedeAPartirDe(pedido: string, palpite: number, fuso: string): number {
  const JANELA = 26 * 3_600_000;
  let lo = palpite - JANELA; // parede garantidamente antes da pedida
  let hi = palpite + JANELA; // parede garantidamente a partir da pedida
  while (hi - lo > 1) {
    const meio = lo + Math.floor((hi - lo) / 2);
    if (paredeLocal(new Date(meio), fuso) < pedido) lo = meio;
    else hi = meio;
  }
  return hi;
}

const diaLocal = (instante: Date, fuso: string) => paredeLocal(instante, fuso).slice(0, 10);

/* ------------------------------------------------------------- formatação */

const inteiroBr = (n: number) => n.toLocaleString('pt-BR');

function pctBr(parte: number, total: number): string {
  if (!total) return '—';
  return `${((parte * 100) / total).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

const pctCsv = (parte: number, total: number) => (total ? ((parte * 100) / total).toFixed(2) : '');

function dataHoraBr(d: Date, fuso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

const diaBr = (iso: string) => iso.split('-').reverse().join('/');

function tabela(cabecalho: string[], linhas: string[][], direita: boolean[]): string {
  const larguras = cabecalho.map((c, i) =>
    Math.max(c.length, ...linhas.map((l) => (l[i] ?? '').length), 0),
  );
  const linha = (celulas: string[]) =>
    celulas
      .map((c, i) => (direita[i] ? (c ?? '').padStart(larguras[i]) : (c ?? '').padEnd(larguras[i])))
      .join('  ')
      .trimEnd();
  return [linha(cabecalho), linha(larguras.map((w) => '-'.repeat(w))), ...linhas.map(linha)].join('\n');
}

function csvCampo(v: string | number): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/*
 * Colunas do CSV, declaradas uma vez. As linhas são montadas por NOME de coluna
 * (`linhaCsv`), não por posição: com 17 colunas e 6 seções, array posicional é
 * convite a deslocar tudo em uma casa e ninguém perceber.
 */
const COLUNAS_CSV = [
  'secao',
  'org',
  'chave',
  'niveis',
  'decisoes',
  'pct_periodo',
  'retidas',
  'recusadas',
  'r3_mais',
  'pct_r3_mais',
  'dia_parcial',
  'veredito',
  'teto_r3_mais',
  'piso_r0_r1',
  'amostra_minima',
  'motivo_mais_frequente_retida_ou_recusada',
  'observacao',
] as const;
type ColunaCsv = (typeof COLUNAS_CSV)[number];
type LinhaCsv = Partial<Record<ColunaCsv, string | number>>;

const csvLinha = (campos: readonly (string | number)[]) => campos.map(csvCampo).join(',');

/* ------------------------------------------------------------- contadores */

interface Contagem {
  total: number;
  retidas: number;
  recusadas: number;
}

const zero = (): Contagem => ({ total: 0, retidas: 0, recusadas: 0 });

function somar(c: Contagem, retida: boolean, recusada: boolean): void {
  c.total++;
  if (retida) c.retidas++;
  if (recusada) c.recusadas++;
}

interface PorCapacidade extends Contagem {
  niveis: Map<RiskLevel, number>;
  /** Motivos SÓ das decisões retidas ou recusadas — é o que interessa calibrar. */
  motivos: Map<string, number>;
  /** Só o que a porta classificou COM `GATEWAY_MODO=observar` — o que já parou. */
  emObservar: Contagem & { motivos: Map<string, number> };
}

interface PorDia extends Contagem {
  r3mais: number;
  r0r1: number;
  /** A janela cobriu o dia local inteiro? `--dias N` corta as pontas no meio. */
  parcial: boolean;
}

function maisFrequente(m: Map<string, number>): string {
  let melhor = '';
  let n = -1;
  for (const [k, v] of m) if (v > n) [melhor, n] = [k, v];
  return melhor;
}

/* ------------------------------------------------------------------- main */

async function main(): Promise<void> {
  const o = lerOpcoes(process.argv.slice(2));

  try {
    paredeLocal(new Date(), o.fuso);
  } catch {
    throw new Error(`--fuso "${o.fuso}" não é um fuso conhecido (use o nome IANA, ex.: America/Sao_Paulo)`);
  }

  const prisma = new PrismaClient();

  try {
    // Tenant resolvido ANTES de qualquer consulta: nenhuma leitura deste
    // relatório atravessa empresa (02-CONSTRAINTS).
    const org = o.org
      ? await prisma.org.findUnique({ where: { slug: o.org }, select: { id: true, slug: true, name: true } })
      : await prisma.org.findFirst({
          where: { isActive: true },
          orderBy: { createdAt: 'asc' },
          select: { id: true, slug: true, name: true },
        });

    if (!org) {
      throw new Error(
        o.org ? `nenhuma empresa com slug "${o.org}"` : 'nenhuma empresa ativa no banco',
      );
    }

    if (!o.org) {
      const ativas = await prisma.org.count({ where: { isActive: true } });
      if (ativas > 1) {
        console.error(
          `aviso: ${ativas} empresas ativas; relatório limitado a "${org.slug}". Use --org SLUG para outra.\n`,
        );
      }
    }

    const agora = new Date();
    const inicio = o.desde
      ? instanteLocal(o.desde, '00:00:00', o.fuso)
      : new Date(agora.getTime() - o.dias * 86_400_000);
    const fim = o.ate ? instanteLocal(o.ate, '23:59:59', o.fuso, 999) : agora;

    // As duas pontas vêm de origens diferentes e o operador pode ter passado
    // só uma delas: a mensagem cita as duas, senão ela acusa uma opção que
    // ninguém digitou.
    const origemInicio = o.desde ? `--desde ${o.desde}` : `--dias ${o.dias}`;
    const origemFim = o.ate ? `--ate ${o.ate}` : 'agora (sem --ate)';
    if (inicio >= fim) {
      throw new Error(
        `período vazio: o início ${dataHoraBr(inicio, o.fuso)} (de ${origemInicio}) não é anterior ao ` +
          `fim ${dataHoraBr(fim, o.fuso)} (de ${origemFim}). Ajuste a ponta errada — as duas vêm de ` +
          'origens diferentes.',
      );
    }

    const onde = { orgId: org.id, criadoEm: { gte: inicio, lte: fim } };
    const total = await prisma.policyDecision.count({ where: onde });

    /*
     * A medida da própria lacuna: recusa que a porta faz antes de classificar
     * não vira `PolicyDecision`, só `ToolCall` com status `recusado` e
     * `decisionId` nulo. Contar isso é o que transforma a ressalva de aviso
     * genérico em número.
     */
    const recusasSemDecisao = await prisma.toolCall.count({
      where: { ...onde, status: ToolCallStatus.recusado, decisionId: null },
    });

    const linhaRessalva =
      recusasSemDecisao > 0
        ? `RESSALVA: "recusadas" abaixo é PISO, não total. Recusa por capacidade não declarada ou\n` +
          `          argumento inválido não grava decisão de política — mora só em ToolCall.\n` +
          `          nesta janela: ${inteiroBr(recusasSemDecisao)} recusa(s) fora desta contagem.\n` +
          `          o total completo sai cruzando com ToolCall de status recusado (sem decisionId).`
        : `RESSALVA: "recusadas" conta só o que a porta recusou DEPOIS de classificar. Recusa por\n` +
          `          capacidade não declarada ou argumento inválido pode não gravar decisão de\n` +
          `          política, e aí some daqui. Nesta janela o cruzamento com ToolCall de status\n` +
          `          recusado (sem decisionId) deu ZERO: não há recusa fora desta contagem.`;

    const cabecalho =
      `\nRELATÓRIO DA PORTA — o que a régua fez com dado real\n` +
      `empresa: ${org.slug} (${org.name})\n` +
      `período: ${dataHoraBr(inicio, o.fuso)} a ${dataHoraBr(fim, o.fuso)} · fuso ${o.fuso}\n` +
      `janela: ${origemInicio} → ${origemFim}\n` +
      `porta agora: GATEWAY_MODO=${process.env.GATEWAY_MODO ?? 'observar (padrão)'}\n` +
      `${linhaRessalva}\n`;

    /*
     * A saída em CSV é montada por quem chama, mas gravada aqui — inclusive
     * quando não há decisão nenhuma no período, porque a linha de ressalva pode
     * ter conteúdo mesmo assim e é o CSV que sobrevive ao terminal.
     */
    const baseCsv: LinhaCsv = {
      org: org.slug,
      teto_r3_mais: TETO_R3_MAIS.toFixed(2),
      piso_r0_r1: PISO_R0_R1.toFixed(2),
      amostra_minima: AMOSTRA_MINIMA,
    };
    const linhaCsv = (v: LinhaCsv) => {
      const l: LinhaCsv = { ...baseCsv, ...v };
      return csvLinha(COLUNAS_CSV.map((c) => l[c] ?? ''));
    };
    const chaveDoPeriodo = `${diaLocal(inicio, o.fuso)}..${diaLocal(fim, o.fuso)}`;

    const linhaCsvRessalva = (): string =>
      linhaCsv({
        secao: 'ressalva',
        chave: 'recusas_sem_decisao_de_politica',
        decisoes: recusasSemDecisao,
        recusadas: recusasSemDecisao,
        observacao:
          recusasSemDecisao > 0
            ? 'recusadas de secao=nivel/capacidade e piso: recusa por capacidade nao declarada ou ' +
              'argumento invalido nao gera PolicyDecision. Total completo = recusadas + este numero, ' +
              'apurado em ToolCall com status recusado e decisionId nulo, mesma janela e mesma org.'
            : 'nenhuma recusa fora da contagem nesta janela: ToolCall com status recusado e decisionId ' +
              'nulo deu zero. As recusas listadas nas demais secoes sao o total.',
      });

    function gravarCsv(linhas: string[]): void {
      const csv = `${csvLinha(COLUNAS_CSV)}\n${linhas.join('\n')}\n`;
      if (o.csvEm) {
        writeFileSync(o.csvEm, csv, 'utf8');
        console.log(`CSV gravado em ${o.csvEm} (${linhas.length} linhas)\n`);
      } else {
        console.log('--- CSV ---');
        process.stdout.write(csv);
      }
    }

    if (total === 0) {
      console.log(`${cabecalho}\nsem decisões no período.\n`);
      console.log(
        'Nada a calibrar ainda: ou a porta não recebeu chamada nesta janela, ou o banco\n' +
          'é outro. Amplie com --dias ou confira DATABASE_URL.\n',
      );
      if (recusasSemDecisao > 0) {
        console.log(
          `Atenção: zero decisões, mas ${inteiroBr(recusasSemDecisao)} recusa(s) em ToolCall sem decisão\n` +
            'vinculada no mesmo período. A porta rodou e recusou antes de classificar.\n',
        );
      }
      if (o.csv || o.csvEm) {
        gravarCsv([
          linhaCsvRessalva(),
          linhaCsv({ secao: 'periodo', chave: chaveDoPeriodo, niveis: '(todos)', decisoes: 0 }),
        ]);
      }
      return;
    }

    if (total > o.max) {
      throw new Error(
        `${inteiroBr(total)} decisões no período, acima do teto de ${inteiroBr(o.max)}. ` +
          'Encurte o período ou suba --max conscientemente.',
      );
    }

    const porNivel = new Map<RiskLevel, Contagem>(NIVEIS.map((n) => [n, zero()]));
    const porCapacidade = new Map<string, PorCapacidade>();
    const porDia = new Map<string, PorDia>();
    const porModo = new Map<string, Contagem>();
    let r3mais = 0;
    let r0r1 = 0;

    // Página por cursor: o relatório roda contra uma janela que pode ter
    // dezenas de milhares de linhas, e só os contadores ficam em memória.
    const PAGINA = 2000;
    let cursor: string | undefined;
    let lidas = 0;
    for (;;) {
      const lote = await prisma.policyDecision.findMany({
        where: onde,
        select: {
          id: true,
          capabilityId: true,
          nivel: true,
          permitido: true,
          exigeAprovacao: true,
          modo: true,
          motivo: true,
          criadoEm: true,
        },
        orderBy: { id: 'asc' },
        take: PAGINA,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!lote.length) break;

      for (const d of lote) {
        const retida = d.exigeAprovacao;
        const recusada = !d.permitido;
        const alto = NIVEIS.indexOf(d.nivel) >= INDICE_R3;
        const baixo = d.nivel === RiskLevel.R0 || d.nivel === RiskLevel.R1;
        if (alto) r3mais++;
        if (baixo) r0r1++;

        let nivel = porNivel.get(d.nivel);
        if (!nivel) {
          nivel = zero();
          porNivel.set(d.nivel, nivel);
        }
        somar(nivel, retida, recusada);

        const chaveCap = d.capabilityId ?? SEM_CAPACIDADE;
        let cap = porCapacidade.get(chaveCap);
        if (!cap) {
          cap = {
            ...zero(),
            niveis: new Map(),
            motivos: new Map(),
            emObservar: { ...zero(), motivos: new Map() },
          };
          porCapacidade.set(chaveCap, cap);
        }
        somar(cap, retida, recusada);
        cap.niveis.set(d.nivel, (cap.niveis.get(d.nivel) ?? 0) + 1);
        if (retida || recusada) {
          cap.motivos.set(d.motivo, (cap.motivos.get(d.motivo) ?? 0) + 1);
          if (d.modo === 'observar') {
            somar(cap.emObservar, retida, recusada);
            cap.emObservar.motivos.set(d.motivo, (cap.emObservar.motivos.get(d.motivo) ?? 0) + 1);
          }
        }

        const dia = diaLocal(d.criadoEm, o.fuso);
        let linhaDia = porDia.get(dia);
        if (!linhaDia) {
          // Parcial quando a janela não cobre o dia local do 00:00 ao 23:59:59.
          // `--dias N` conta N x 24h para trás a partir de agora: o dia da ponta
          // pode ter 5 horas de dado e mesmo assim receber veredito de dia
          // inteiro. Marcar é o que separa "apertada por régua" de "apertada
          // por recorte".
          const parcial =
            inicio > instanteLocal(dia, '00:00:00', o.fuso) ||
            fim < instanteLocal(dia, '23:59:59', o.fuso, 999);
          linhaDia = { ...zero(), r3mais: 0, r0r1: 0, parcial };
          porDia.set(dia, linhaDia);
        }
        somar(linhaDia, retida, recusada);
        if (alto) linhaDia.r3mais++;
        if (baixo) linhaDia.r0r1++;

        let modo = porModo.get(d.modo);
        if (!modo) {
          modo = zero();
          porModo.set(d.modo, modo);
        }
        somar(modo, retida, recusada);
      }

      lidas += lote.length;
      cursor = lote[lote.length - 1].id;
      if (lote.length < PAGINA) break;
    }

    const retidas = [...porNivel.values()].reduce((s, c) => s + c.retidas, 0);
    const recusadas = [...porNivel.values()].reduce((s, c) => s + c.recusadas, 0);
    const geral = vereditoDe(lidas, r3mais, r0r1);

    /* ---------------------------------------------------------- em texto */

    const partes: string[] = [cabecalho];
    partes.push(
      `decisões no período: ${inteiroBr(lidas)} · retidas (exigem aprovação): ${inteiroBr(retidas)} ` +
        `(${pctBr(retidas, lidas)}) · recusadas: ${inteiroBr(recusadas)} (${pctBr(recusadas, lidas)})` +
        (recusasSemDecisao > 0
          ? ` +${inteiroBr(recusasSemDecisao)} fora desta contagem (ver RESSALVA)`
          : ''),
    );
    partes.push(
      `gravadas por modo: ${[...porModo.entries()]
        .map(([m, c]) => `${m} ${inteiroBr(c.total)}`)
        .join(' · ')}`,
    );

    partes.push('\nPOR NÍVEL DE RISCO');
    partes.push(
      tabela(
        ['nível', 'decisões', '% do total', 'retidas', 'recusadas'],
        [
          ...NIVEIS.map((n) => {
            const c = porNivel.get(n) ?? zero();
            return [
              n,
              inteiroBr(c.total),
              pctBr(c.total, lidas),
              inteiroBr(c.retidas),
              inteiroBr(c.recusadas),
            ];
          }),
          [
            'TOTAL',
            inteiroBr(lidas),
            pctBr(lidas, lidas),
            inteiroBr(retidas),
            inteiroBr(recusadas),
          ],
        ],
        [false, true, true, true, true],
      ),
    );

    const caps = [...porCapacidade.entries()].sort((a, b) => b[1].total - a[1].total);
    const mostradas = o.top > 0 ? caps.slice(0, o.top) : caps;
    partes.push(
      `\nPOR CAPACIDADE${
        mostradas.length < caps.length ? ` (${mostradas.length} de ${caps.length})` : ''
      }`,
    );
    partes.push(
      tabela(
        ['capacidade', 'níveis', 'decisões', '% do total', 'retidas', 'recusadas'],
        mostradas.map(([id, c]) => [
          id,
          [...c.niveis.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([n]) => n)
            .join('·'),
          inteiroBr(c.total),
          pctBr(c.total, lidas),
          inteiroBr(c.retidas),
          inteiroBr(c.recusadas),
        ]),
        [false, false, true, true, true, true],
      ),
    );

    const dias = [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const diasParciais = dias.filter(([, c]) => c.parcial).length;
    partes.push('\nPOR DIA — o critério aplicado ao dia');
    partes.push(
      tabela(
        ['dia', 'janela', 'decisões', 'R3+', '% R3+', 'R0+R1', '% R0+R1', 'veredito'],
        dias.map(([dia, c]) => [
          diaBr(dia),
          c.parcial ? 'parcial' : 'inteiro',
          inteiroBr(c.total),
          inteiroBr(c.r3mais),
          pctBr(c.r3mais, c.total),
          inteiroBr(c.r0r1),
          pctBr(c.r0r1, c.total),
          vereditoDe(c.total, c.r3mais, c.r0r1),
        ]),
        [false, false, true, true, true, true, true, false],
      ),
    );
    if (diasParciais > 0) {
      partes.push(
        `  ${diasParciais} dia(s) marcado(s) "parcial": a janela pegou só um pedaço do dia local.\n` +
          '  Veredito de dia parcial pode ser efeito do recorte, não da régua — rodar às 19h deixa\n' +
          '  o dia da ponta com poucas horas. Para dias inteiros, use --desde/--ate.',
      );
    }

    const destaque = caps
      .filter(([, c]) => c.emObservar.retidas + c.emObservar.recusadas > 0)
      .sort(
        (a, b) =>
          b[1].emObservar.retidas +
          b[1].emObservar.recusadas -
          (a[1].emObservar.retidas + a[1].emObservar.recusadas),
      );
    partes.push('\nDESTAQUE — retido ou recusado com a porta em modo OBSERVAR');
    if (!destaque.length) {
      partes.push('  nenhuma decisão em modo observar precisou reter ou recusar no período.');
    } else {
      partes.push(
        tabela(
          ['capacidade', 'retidas', 'recusadas', 'motivo mais frequente (retida/recusada)'],
          destaque.map(([id, c]) => [
            id,
            inteiroBr(c.emObservar.retidas),
            inteiroBr(c.emObservar.recusadas),
            maisFrequente(c.emObservar.motivos).slice(0, 70),
          ]),
          [false, true, true, false],
        ),
      );
      partes.push(
        '  Cada linha é uma ação que JÁ parou para esperar gente ou que JÁ não aconteceu:\n' +
          '  observar não dispensa aprovação nem deixa passar R5. É esta lista que diz se a\n' +
          '  régua, do jeito que está hoje, trava a operação.',
      );
    }

    partes.push(
      '\nCRITÉRIO DE CALIBRAGEM\n' +
        `  apertada  — mais de ${(TETO_R3_MAIS * 100).toFixed(0)}% das decisões do dia em R3 ou acima:\n` +
        '              cada ação vira fila de aprovação e a operação para esperando gente.\n' +
        `  frouxa    — ${(PISO_R0_R1 * 100).toFixed(0)}% ou mais em R0 e R1: a porta classifica mas não segura\n` +
        '              nada, e o produto não saiu da leitura.\n' +
        `  amostra pequena — menos de ${AMOSTRA_MINIMA} decisões: percentual aqui é ruído.`,
    );
    const diasApertados = dias.filter(([, c]) => vereditoDe(c.total, c.r3mais, c.r0r1) === 'apertada');
    const apertadosParciais = diasApertados.filter(([, c]) => c.parcial).length;
    partes.push(
      `\nVEREDITO DO PERÍODO: ${geral.toUpperCase()}\n` +
        `  R3 ou acima: ${inteiroBr(r3mais)} de ${inteiroBr(lidas)} (${pctBr(r3mais, lidas)})\n` +
        `  R0 e R1: ${inteiroBr(r0r1)} de ${inteiroBr(lidas)} (${pctBr(r0r1, lidas)})\n` +
        `  dias analisados: ${dias.length} (${diasParciais} parcial/parciais) · dias apertados: ` +
        `${diasApertados.length}${apertadosParciais ? ` (${apertadosParciais} em dia parcial)` : ''}\n`,
    );

    console.log(partes.join('\n'));

    /* ------------------------------------------------------------ em CSV */

    if (!o.csv && !o.csvEm) return;

    const linhas: string[] = [linhaCsvRessalva()];
    linhas.push(
      linhaCsv({
        secao: 'periodo',
        chave: chaveDoPeriodo,
        niveis: '(todos)',
        decisoes: lidas,
        pct_periodo: pctCsv(lidas, lidas),
        retidas,
        recusadas,
        r3_mais: r3mais,
        pct_r3_mais: pctCsv(r3mais, lidas),
        veredito: geral,
        observacao: `janela: ${origemInicio} -> ${origemFim}`,
      }),
    );
    for (const n of NIVEIS) {
      const c = porNivel.get(n) ?? zero();
      linhas.push(
        linhaCsv({
          secao: 'nivel',
          chave: n,
          niveis: n,
          decisoes: c.total,
          pct_periodo: pctCsv(c.total, lidas),
          retidas: c.retidas,
          recusadas: c.recusadas,
        }),
      );
    }
    for (const [m, c] of porModo) {
      linhas.push(
        linhaCsv({
          secao: 'modo',
          chave: m,
          niveis: '(todos)',
          decisoes: c.total,
          pct_periodo: pctCsv(c.total, lidas),
          retidas: c.retidas,
          recusadas: c.recusadas,
        }),
      );
    }
    for (const [id, c] of caps) {
      linhas.push(
        linhaCsv({
          secao: 'capacidade',
          chave: id,
          niveis: [...c.niveis.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([n]) => n)
            .join('·'),
          decisoes: c.total,
          pct_periodo: pctCsv(c.total, lidas),
          retidas: c.retidas,
          recusadas: c.recusadas,
          motivo_mais_frequente_retida_ou_recusada: maisFrequente(c.motivos),
        }),
      );
    }
    for (const [dia, c] of dias) {
      linhas.push(
        linhaCsv({
          secao: 'dia',
          chave: dia,
          niveis: '(todos)',
          decisoes: c.total,
          pct_periodo: pctCsv(c.total, lidas),
          retidas: c.retidas,
          recusadas: c.recusadas,
          r3_mais: c.r3mais,
          pct_r3_mais: pctCsv(c.r3mais, c.total),
          dia_parcial: c.parcial ? 'sim' : 'nao',
          veredito: vereditoDe(c.total, c.r3mais, c.r0r1),
          observacao: c.parcial ? 'janela cobriu so parte do dia local; veredito pode ser recorte' : '',
        }),
      );
    }
    for (const [id, c] of destaque) {
      linhas.push(
        linhaCsv({
          secao: 'observar_retido_ou_recusado',
          chave: id,
          decisoes: c.emObservar.retidas + c.emObservar.recusadas,
          pct_periodo: pctCsv(c.emObservar.retidas + c.emObservar.recusadas, lidas),
          retidas: c.emObservar.retidas,
          recusadas: c.emObservar.recusadas,
          motivo_mais_frequente_retida_ou_recusada: maisFrequente(c.emObservar.motivos),
        }),
      );
    }

    gravarCsv(linhas);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('\nfalhou:', (e as Error).message);
  process.exit(1);
});
