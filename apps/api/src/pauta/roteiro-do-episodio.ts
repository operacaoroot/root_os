import {
  PAUTA_EPISODIO_STATUS_ROTULO,
  PAUTA_ORIGEM_ROTULOS,
  PAUTA_PALAVRA_DE_CORTE_PADRAO,
  PautaPalavraDeCorteSchema,
  lembreteDaPalavraDeCorte,
  podeGerarRoteiro,
  type PautaEpisodioStatus,
  type PautaItemCurado,
  type PautaOrigemDaPalavraDeCorte,
} from '@mktos/shared';
import { parseJsonDaIa } from './parse-json';
import { linkPublicoDoItem } from './link-publico';

/*
 * ============================================================================
 * O ROTEIRO DO EPISÓDIO (MC8) — a parte pura
 * ============================================================================
 *
 * A IA devolve JSON com a ORDEM e o texto de cada matéria; o markdown é montado
 * aqui. Duas coisas não ficam com a IA, de propósito:
 *
 *  - o LINK de cada matéria sai do item pelo número, nunca do que o modelo
 *    escrever (o mesmo princípio da origem na curadoria): URL inventada não
 *    entra no roteiro que vai para a tela da gravação;
 *  - a PALAVRA DE CORTE (D-MC2) vai no topo, fixada pelo sistema — a edição do
 *    MC9 corta pela palavra, e ela não pode depender de o modelo lembrar.
 *
 * Matéria que a IA esquecer entra mesmo assim, antes do fechamento, com o que
 * a curadoria já disse dela: a curadoria manteve, o roteiro não descarta.
 */

const SYSTEM_ROTEIRO_BASE = `Você escreve o roteiro de gravação do episódio semanal da ROOT, uma comunidade brasileira
sobre IA aplicada a negócios. Quem grava fala para a câmera com o roteiro aberto num segundo monitor;
quem assiste toca uma pequena ou média empresa.

Recebe as matérias que a curadoria manteve, numeradas.

Responda SOMENTE com um objeto JSON válido, sem cercas de código:
{
  "abertura": string,       // 2 a 3 frases faladas: o gancho do episódio, puxado pela matéria de maior impacto
  "materias": [             // TODAS as matérias fornecidas, cada número uma vez, na ordem da gravação
    {
      "n": number,          // o número da matéria na lista
      "titulo": string,     // curto, até 70 caracteres, para ler de relance
      "resumo": string,     // 2 a 3 linhas: o que aconteceu, em linguagem falada
      "naTela": string,     // o que mostrar na tela enquanto fala (a página, uma demo, um print)
      "gancho": string      // o que isso muda para quem toca o negócio, em uma ou duas frases
    }
  ],
  "fechamento": string      // 2 a 3 frases que fecham em alta e chamam para a próxima semana
}

Ordem dramática:
1. Abre com a matéria de maior impacto — a que mais muda a semana de quem toca um negócio.
2. O meio leva as mais densas, as que pedem explicação e demonstração.
3. Fecha em alta: a última é uma notícia boa e prática, algo que dá para usar amanhã.

Regras:
- Use SOMENTE as matérias fornecidas. Nunca invente notícia, número, nome ou URL.
- Não escreva URL: o link de cada matéria entra sozinho no roteiro, pelo número.
- Matéria "sem link público" veio de uma newsletter: cite a fonte pelo nome e, em "naTela",
  proponha algo que não dependa do e-mail.
- O gancho é a lente da ROOT: concreto (custo, tempo, cliente, decisão da semana).
- Não escreva a palavra de corte nem instrução de gravação: o topo do roteiro já as traz.`;

/** O prompt do roteiro com o bloco de voz montado em `voz-da-pauta.ts`. */
export function systemDoRoteiro(voz: string): string {
  return `${SYSTEM_ROTEIRO_BASE}\n\n${voz.trim()}`;
}

/**
 * O link da matéria no roteiro, pela regra única de `link-publico.ts`: o
 * roteiro abre numa tela com links clicáveis e é espelhado no vault.
 */
export function linkPublico(item: Pick<PautaItemCurado, 'url' | 'semLinkPublico' | 'origem' | 'origens'>): string | null {
  return linkPublicoDoItem(item);
}

function umaLinha(v: unknown, teto: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, teto) : '';
}

/**
 * Texto que veio do modelo: sem URL. O link da matéria entra pelo número; URL
 * no meio do texto é a que ninguém conferiu, e o roteiro abre com link clicável.
 */
function textoDaIa(v: unknown, teto: number): string {
  if (typeof v !== 'string') return '';
  return umaLinha(v.replace(/<?\bhttps?:\/\/[^\s>)]+>?/gi, ' ').replace(/\(\s*\)/g, ''), teto);
}

/** Texto livre sem virar cabeçalho, citação ou lista no markdown montado. */
function semMarcacaoDeBloco(s: string): string {
  return s.replace(/^[#>\-*+\s]+/, '').trim();
}

const TETO_DO_TITULO = 90;
const TETO_DO_RESUMO = 600;
const TETO_DO_CAMPO = 400;
const TETO_DA_PONTA = 700;

/** A lista numerada que vai no pedido ao modelo. */
export function entradaDoRoteiro(e: { apelido: string; titulo: string; itens: readonly PautaItemCurado[] }): string {
  const linhas = e.itens.map((i, idx) => {
    const origem = i.origem ? ` (${i.origem} · ${PAUTA_ORIGEM_ROTULOS[i.origem]})` : '';
    const link = linkPublico(i);
    const partes = [
      `[${idx + 1}]${origem} ${umaLinha(i.titulo, 300)}`,
      `    link: ${link ?? `sem link público${i.fonte ? ` (fonte: ${umaLinha(i.fonte, 120)})` : ''}`}`,
    ];
    const resumo = umaLinha(i.resumo, TETO_DO_RESUMO);
    if (resumo) partes.push(`    resumo: ${resumo}`);
    const porque = umaLinha(i.porque, TETO_DO_CAMPO);
    if (porque) partes.push(`    por que importa: ${porque}`);
    const gancho = umaLinha(i.ganchoBr, TETO_DO_CAMPO);
    if (gancho) partes.push(`    gancho BR: ${gancho}`);
    return partes.join('\n');
  });
  return `Episódio: ${e.apelido} · ${umaLinha(e.titulo, 160)}\n\nMatérias mantidas pela curadoria (${e.itens.length}):\n\n${linhas.join('\n\n')}`;
}

export interface MateriaDoRoteiro {
  n: number;
  titulo: string;
  resumo: string;
  naTela: string;
  gancho: string;
}

export interface RoteiroDaIa {
  abertura: string;
  materias: MateriaDoRoteiro[];
  fechamento: string;
}

/** A IA não devolveu nada utilizável: o episódio fica como estava. */
export class RoteiroInvalidoError extends Error {
  constructor(motivo: string) {
    super(`A IA não devolveu um roteiro utilizável (${motivo}) — nada foi gravado. Tente de novo.`);
    this.name = 'RoteiroInvalidoError';
  }
}

/**
 * Lê a resposta do modelo. Número fora da lista, número repetido e matéria sem
 * título ficam de fora; sobrar nenhuma é roteiro inválido.
 */
export function lerRoteiroDaIa(texto: string, total: number): RoteiroDaIa {
  let bruto: unknown;
  try {
    bruto = parseJsonDaIa<unknown>(texto);
  } catch {
    throw new RoteiroInvalidoError('não veio JSON');
  }
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) {
    throw new RoteiroInvalidoError('não veio um objeto');
  }
  const o = bruto as { abertura?: unknown; materias?: unknown; fechamento?: unknown };
  if (!Array.isArray(o.materias)) throw new RoteiroInvalidoError('sem a lista de matérias');

  const vistos = new Set<number>();
  const materias: MateriaDoRoteiro[] = [];
  for (const m of o.materias) {
    if (!m || typeof m !== 'object') continue;
    const r = m as Record<string, unknown>;
    const n = typeof r.n === 'number' ? r.n : typeof r.n === 'string' ? Number(r.n) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > total || vistos.has(n)) continue;
    const titulo = semMarcacaoDeBloco(textoDaIa(r.titulo, TETO_DO_TITULO));
    if (!titulo) continue;
    vistos.add(n);
    materias.push({
      n,
      titulo,
      resumo: semMarcacaoDeBloco(textoDaIa(r.resumo, TETO_DO_RESUMO)),
      naTela: textoDaIa(r.naTela, TETO_DO_CAMPO),
      gancho: textoDaIa(r.gancho, TETO_DO_CAMPO),
    });
  }
  if (!materias.length) throw new RoteiroInvalidoError('nenhuma matéria da lista');
  return {
    abertura: semMarcacaoDeBloco(textoDaIa(o.abertura, TETO_DA_PONTA)),
    materias,
    fechamento: semMarcacaoDeBloco(textoDaIa(o.fechamento, TETO_DA_PONTA)),
  };
}

export interface BlocoDoRoteiro {
  materia: MateriaDoRoteiro;
  item: PautaItemCurado;
  /** false = a IA esqueceu e o sistema completou com o que a curadoria disse. */
  daIa: boolean;
}

/**
 * A ordem da gravação: a da IA, com as esquecidas entrando ANTES da última —
 * a última é o fechamento em alta, e uma matéria completada à mão não fecha.
 */
export function ordemDoRoteiro(daIa: RoteiroDaIa, itens: readonly PautaItemCurado[]): BlocoDoRoteiro[] {
  const blocos: BlocoDoRoteiro[] = daIa.materias
    .filter((m) => m.n >= 1 && m.n <= itens.length)
    .map((m) => ({ materia: m, item: itens[m.n - 1], daIa: true }));
  const presentes = new Set(blocos.map((b) => b.materia.n));
  const esquecidas: BlocoDoRoteiro[] = [];
  itens.forEach((item, idx) => {
    const n = idx + 1;
    if (presentes.has(n)) return;
    esquecidas.push({
      item,
      daIa: false,
      materia: {
        n,
        titulo: semMarcacaoDeBloco(umaLinha(item.titulo, TETO_DO_TITULO)) || `Matéria ${n}`,
        resumo: semMarcacaoDeBloco(umaLinha(item.resumo || item.porque, TETO_DO_RESUMO)),
        naTela: '',
        gancho: umaLinha(item.ganchoBr || (item.resumo ? item.porque : ''), TETO_DO_CAMPO),
      },
    });
  });
  if (!esquecidas.length) return blocos;
  if (blocos.length <= 1) return [...esquecidas, ...blocos];
  return [...blocos.slice(0, -1), ...esquecidas, blocos[blocos.length - 1]];
}

/** O roteiro em markdown: é o que o episódio guarda, o que exporta e o que abre para gravar. */
export function montarRoteiro(e: {
  apelido: string;
  titulo: string;
  palavraDeCorte: string;
  abertura: string;
  blocos: readonly BlocoDoRoteiro[];
  fechamento: string;
}): string {
  const out: string[] = [
    `# ${e.apelido} · ${semMarcacaoDeBloco(umaLinha(e.titulo, 160))}`,
    '',
    lembreteDaPalavraDeCorte(e.palavraDeCorte),
    '',
  ];
  if (e.abertura) out.push('## Abertura', '', e.abertura, '');
  e.blocos.forEach((b, i) => {
    const link = linkPublico(b.item);
    out.push(`## ${i + 1}. ${b.materia.titulo}`, '');
    if (b.materia.resumo) out.push(b.materia.resumo, '');
    out.push(
      `- **Link:** ${link ?? `sem link público${b.item.fonte ? ` — cite ${umaLinha(b.item.fonte, 120)}` : ' — cite a fonte pelo nome'}`}`,
      `- **Na tela:** ${b.materia.naTela || (link ? 'a página da matéria' : 'o resumo em texto')}`,
    );
    if (b.materia.gancho) out.push(`- **Para quem toca o negócio:** ${b.materia.gancho}`);
    out.push('');
  });
  if (e.fechamento) out.push('## Fechamento', '', e.fechamento, '');
  return out.join('\n');
}

/**
 * A palavra da empresa, lida da nota da memória: a primeira linha com texto,
 * sem aspas nem marcação. O que não passar no esquema é ignorado — nota mal
 * escrita cai no padrão em vez de travar a gravação.
 */
export function palavraDaNota(nota: { body: string; arquivadoEm?: Date | string | null } | null | undefined): string | null {
  if (!nota || nota.arquivadoEm) return null;
  const linha = (nota.body ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!linha) return null;
  const limpa = linha
    .replace(/^[#>\-*+\s]+/, '')
    .replace(/[*_`]/g, '')
    .replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '')
    .trim();
  const r = PautaPalavraDeCorteSchema.safeParse(limpa);
  return r.success ? r.data : null;
}

/** A do episódio vence a da empresa, que vence o padrão. */
export function palavraDeCorteEfetiva(
  doEpisodio: string | null | undefined,
  daEmpresa: string | null | undefined,
): { efetiva: string; origem: PautaOrigemDaPalavraDeCorte } {
  const ep = (doEpisodio ?? '').trim();
  if (ep) return { efetiva: ep, origem: 'episodio' };
  const org = (daEmpresa ?? '').trim();
  if (org) return { efetiva: org, origem: 'empresa' };
  return { efetiva: PAUTA_PALAVRA_DE_CORTE_PADRAO, origem: 'padrao' };
}

/** Por que não dá para gerar agora, ou nulo. */
export function motivoParaNaoGerar(status: PautaEpisodioStatus, itens: number): string | null {
  if (!podeGerarRoteiro(status)) {
    return (
      `O episódio já passou da gravação (está em ${PAUTA_EPISODIO_STATUS_ROTULO[status]}): o roteiro agora é ` +
      'o registro do que foi gravado. Volte para Gravação para gerar de novo, ou edite à mão.'
    );
  }
  if (itens === 0) return 'A rodada deste episódio não guardou nenhum item — não há o que roteirizar.';
  return null;
}

/** O nome do download: quem baixa sabe de que empresa é. */
export function nomeDoArquivoDoRoteiro(apelido: string): string {
  return `${apelido}-roteiro.md`;
}

/**
 * O nome no espelho leva o começo do id: o número do episódio é por empresa, e
 * o destino (a vault do servidor, a pasta padrão do Drive) pode ser o mesmo
 * para várias — `ep-01-roteiro.md` de uma sobrescreveria o da outra.
 */
export function nomeDoArquivoDoEspelho(apelido: string, id: string): string {
  return `${apelido}-roteiro-${id.slice(0, 8)}.md`;
}

/** A cópia que vai para o vault leva o cabeçalho que as notas de lá usam. */
export function markdownDoEspelho(e: {
  id: string;
  apelido: string;
  titulo: string;
  roteiro: string;
  atualizadoEm: Date;
}): string {
  return [
    '---',
    'type: roteiro-episodio',
    `episodio: ${e.apelido}`,
    `name: ${JSON.stringify(e.titulo)}`,
    'origem: marketing-os',
    `id: ${e.id}`,
    `tags: [roteiro, episodio, ${e.apelido}]`,
    `updated: ${e.atualizadoEm.toISOString().slice(0, 10)}`,
    '---',
    '',
    '> Gerado no ROOT OS (módulo Pauta). O registro canônico é o do sistema — editar aqui não volta pro banco.',
    '',
    e.roteiro.trim(),
    '',
  ].join('\n');
}
