import { PrismaClient, PautaFamilia, PautaObjetivo } from '@prisma/client';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Importa o acervo de referência que já existe no vault Cerebro-Conteudo para o
// módulo Pauta. Ver docs/PAUTA.md §10 (onda 1).
//
// Uso:
//   PAUTA_IMPORT_DIR="<...>/Cerebro-Conteudo" pnpm --filter @mktos/api import:pauta
//
// Lê duas coisas, ambas opcionais (importa o que encontrar):
//   1. "9 - Engenharia Reversa das Referências/fichas/*.md" → PautaReferencia
//      (432 fichas no schema de 14 campos — a fonte é a própria ficha, que já traz
//      família e objetivo; o CSV de classificação não é necessário)
//   2. "8 - Referência de Conteúdo/dataset_instagram-scraper_*.json" → PautaCaptura
//      (posts crus: viram fila para processar, não ficha — não têm análise ainda)
//
// Idempotente: reimportar não duplica (dedup por hash de URL e por título+origem).

const prisma = new PrismaClient();

const PASTA_FICHAS = '9 - Engenharia Reversa das Referências/fichas';
const PASTA_REFS = '8 - Referência de Conteúdo';

// Os bunkers maduros (4 e 6) são a "preferência revelada" do estudo: o que o
// professor continuou ensinando depois de ver o que funcionou. Ficha desses
// bunkers, em família campeã, entra marcada — é o que alimenta a geração.
const BUNKERS_MADUROS = [4, 6];
const FAMILIAS_CAMPEAS: PautaFamilia[] = ['CUR', 'REA', 'STO', 'DEM'];

const FAMILIAS = new Set<string>(['CUR', 'REA', 'STO', 'DEM', 'CON', 'INT', 'TRE', 'ENC']);
const OBJETIVOS = new Set<string>(['ALC', 'AUT', 'VIN', 'VEN', 'ENG', 'PRO', 'LEA']);

// Rótulo da ficha → coluna. A ordem não importa; o parser casa pelo rótulo.
const CAMPOS: Array<[RegExp, string]> = [
  [/^Matéria-prima$/i, 'materiaPrima'],
  [/^Tensão central$/i, 'tensaoCentral'],
  [/^Emoção-alvo do 1º segundo$/i, 'emocaoAlvo'],
  [/^Motor psicológico$/i, 'motorPsicologico'],
  [/^Fórmula da headline\/gancho$/i, 'formulaHeadline'],
  [/^Estrutura do corpo$/i, 'estruturaCorpo'],
  [/^Prova$/i, 'prova'],
  [/^CTA$/i, 'cta'],
  [/^Pré-requisitos do criador$/i, 'preRequisitos'],
  [/^Anti-padrões$/i, 'antiPadroes'],
  [/^Link de referência$/i, 'url'],
  // Uma ficha traz o rótulo estendido ("Teoria implícita — a mais importante…"),
  // por isso o casamento é por prefixo e não exato.
  [/^Teoria implícita/i, 'teoriaImplicita'],
];

interface FichaLida {
  numero: number | null;
  titulo: string;
  familia: PautaFamilia;
  objetivo: PautaObjetivo;
  bunker: number | null;
  campos: Record<string, string>;
}

/** Extrai a URL de um campo que mistura link e comentário. */
function primeiraUrl(v: string | undefined): string | null {
  if (!v) return null;
  const m = v.match(/https?:\/\/[^\s)"']+/);
  return m ? m[0] : null;
}

function parseArquivo(caminho: string, bunker: number | null): FichaLida[] {
  const txt = readFileSync(caminho, 'utf8');
  const blocos = txt.split(/\n(?=### )/).filter((b) => b.startsWith('### '));
  const fichas: FichaLida[] = [];

  for (const bloco of blocos) {
    const linhas = bloco.split('\n');
    const cabecalho = linhas[0].replace(/^###\s*/, '').trim();
    const mNum = cabecalho.match(/Roteiro\s+(\d+)/i);
    const titulo = cabecalho.replace(/^Roteiro\s+\d+\s*[—-]\s*/i, '').trim() || cabecalho;

    const campos: Record<string, string> = {};
    let familia: string | null = null;
    let objetivo: string | null = null;

    // Um campo pode continuar nas linhas seguintes (texto quebrado).
    let atual: string | null = null;
    for (const linha of linhas.slice(1)) {
      const m = linha.match(/^-\s+\*\*(.+?):\*\*\s*(.*)$/);
      if (m) {
        const rotulo = m[1].trim();
        const valor = m[2].trim();
        if (/^Família\s*\/\s*Objetivo$/i.test(rotulo)) {
          const par = valor.match(/(\w+)\s*\/\s*(\w+)/);
          if (par) {
            familia = par[1].toUpperCase();
            objetivo = par[2].toUpperCase();
          }
          atual = null;
          continue;
        }
        const achou = CAMPOS.find(([re]) => re.test(rotulo));
        atual = achou ? achou[1] : null;
        if (atual) campos[atual] = valor;
        continue;
      }
      if (atual && linha.trim() && !linha.startsWith('---')) {
        campos[atual] = `${campos[atual]} ${linha.trim()}`.trim();
      }
    }

    if (!familia || !objetivo) continue; // bloco que não é ficha
    fichas.push({
      numero: mNum ? Number(mNum[1]) : null,
      titulo,
      familia: (FAMILIAS.has(familia) ? familia : 'outra') as PautaFamilia,
      objetivo: (OBJETIVOS.has(objetivo) ? objetivo : 'ALC') as PautaObjetivo,
      bunker,
      campos,
    });
  }
  return fichas;
}

async function importarFichas(orgId: string, raiz: string): Promise<number> {
  const dir = join(raiz, PASTA_FICHAS);
  if (!existsSync(dir)) {
    console.log(`  [fichas] pasta não encontrada: ${dir} — pulando`);
    return 0;
  }

  const arquivos = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md'));
  let novas = 0;
  let puladas = 0;

  for (const arq of arquivos) {
    const mB = arq.match(/bunker(\d+)/i);
    const bunker = mB ? Number(mB[1]) : null;
    const fichas = parseArquivo(join(dir, arq), bunker);

    for (const f of fichas) {
      const c = f.campos;
      // Sem os 7 campos obrigatórios não é ficha aproveitável.
      const obrigatorios = ['materiaPrima', 'tensaoCentral', 'emocaoAlvo', 'motorPsicologico', 'formulaHeadline', 'estruturaCorpo', 'prova'];
      if (obrigatorios.some((k) => !c[k])) {
        puladas++;
        continue;
      }

      const externo = f.numero !== null ? `roteiro-${f.numero}` : `arquivo-${arq}-${f.titulo}`;
      const ja = await prisma.pautaReferencia.findFirst({
        where: { orgId, origem: 'laboratorio', tags: { has: externo } },
        select: { id: true },
      });
      if (ja) {
        puladas++;
        continue;
      }

      const campea =
        bunker !== null && BUNKERS_MADUROS.includes(bunker) && FAMILIAS_CAMPEAS.includes(f.familia);

      const tags = [externo, 'laboratorio-de-roteiros'];
      if (bunker !== null) tags.push(`bunker-${bunker}`);

      await prisma.pautaReferencia.create({
        data: {
          orgId,
          titulo: f.titulo.slice(0, 300),
          plataforma: 'roteiro',
          autor: null,
          url: primeiraUrl(c.url),
          familia: f.familia,
          objetivo: f.objetivo,
          materiaPrima: c.materiaPrima,
          tensaoCentral: c.tensaoCentral,
          emocaoAlvo: c.emocaoAlvo,
          motorPsicologico: c.motorPsicologico,
          formulaHeadline: c.formulaHeadline,
          estruturaCorpo: c.estruturaCorpo,
          prova: c.prova,
          cta: c.cta ?? null,
          preRequisitos: c.preRequisitos ?? null,
          antiPadroes: c.antiPadroes ?? null,
          teoriaImplicita: c.teoriaImplicita ?? null,
          tags,
          campea,
          origem: 'laboratorio',
        },
      });
      novas++;
    }
  }

  console.log(`  [fichas] ${novas} importada(s), ${puladas} pulada(s) de ${arquivos.length} arquivo(s)`);
  return novas;
}

/** Posts crus do Apify → capturas na fila (ainda sem análise). */
async function importarDataset(orgId: string, raiz: string): Promise<number> {
  const dir = join(raiz, PASTA_REFS);
  if (!existsSync(dir)) {
    console.log(`  [dataset] pasta não encontrada: ${dir} — pulando`);
    return 0;
  }
  const arquivos = readdirSync(dir).filter(
    (f) => f.startsWith('dataset_') && f.endsWith('.json') && statSync(join(dir, f)).isFile(),
  );

  const { createHash } = await import('node:crypto');
  let novas = 0;

  for (const arq of arquivos) {
    let itens: Array<Record<string, unknown>>;
    try {
      itens = JSON.parse(readFileSync(join(dir, arq), 'utf8'));
    } catch {
      console.log(`  [dataset] ${arq}: JSON inválido — pulando`);
      continue;
    }
    if (!Array.isArray(itens)) continue;

    for (const item of itens) {
      const url = typeof item.url === 'string' ? item.url : null;
      if (!url) continue;
      const urlHash = createHash('sha256').update(url.replace(/\/$/, '')).digest('hex');
      const ja = await prisma.pautaCaptura.findUnique({
        where: { orgId_urlHash: { orgId, urlHash } },
        select: { id: true },
      });
      if (ja) continue;

      await prisma.pautaCaptura.create({
        data: {
          orgId,
          tipo: 'link',
          url,
          urlHash,
          titulo:
            typeof item.caption === 'string' ? item.caption.slice(0, 120) : `post de @${String(item.ownerUsername ?? '')}`,
          nota: `Importado de ${arq}`,
          bruto: item as never,
        },
      });
      novas++;
    }
  }

  console.log(`  [dataset] ${novas} captura(s) nova(s) de ${arquivos.length} arquivo(s)`);
  return novas;
}

async function main() {
  const raiz = process.env.PAUTA_IMPORT_DIR;
  if (!raiz) {
    console.error(
      'Defina PAUTA_IMPORT_DIR com o caminho da vault Cerebro-Conteudo.\n' +
        'Ex.: PAUTA_IMPORT_DIR="$HOME/Library/CloudStorage/GoogleDrive-.../Obsidian/Cerebro-Conteudo" \\\n' +
        '       pnpm --filter @mktos/api import:pauta',
    );
    process.exit(1);
  }
  if (!existsSync(raiz)) {
    console.error(`Caminho não existe: ${raiz}`);
    process.exit(1);
  }

  const org = await prisma.org.findUnique({ where: { slug: 'root' } });
  if (!org) {
    console.error('Org "root" não encontrada — rode o seed antes (pnpm db:seed).');
    process.exit(1);
  }

  console.log(`Importando acervo de: ${raiz}`);
  const fichas = await importarFichas(org.id, raiz);
  const capturas = await importarDataset(org.id, raiz);

  const total = await prisma.pautaReferencia.count({ where: { orgId: org.id } });
  const campeas = await prisma.pautaReferencia.count({ where: { orgId: org.id, campea: true } });
  console.log(
    `\nPronto: +${fichas} ficha(s), +${capturas} captura(s).\n` +
      `Acervo agora: ${total} ficha(s), ${campeas} marcada(s) como campeã.\n` +
      'Rode a busca semântica depois: POST /api/pauta/referencias/reindexar (precisa de OPENAI_API_KEY).',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
