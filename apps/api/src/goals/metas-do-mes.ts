import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  METAS_FUSO,
  METAS_TAMANHO_MAXIMO_DA_NOTA,
  METAS_TETO_DE_METAS_POR_MES,
  METAS_TETO_DA_OBSERVACAO,
  diaNoFuso,
  indicadorDeMeta,
  instanteNoFuso,
  itemIdDaEstrategia,
  lerOrigemDaEstrategia,
  origemDaEstrategia,
  segundaDaSemana,
  somarDias,
  type IndicadorDeMeta,
  type MetaDoMes,
  type MetasEstadoDaSemana,
  type MetasLinhaDaEstrategia,
  type MetasMedidaDaSemana,
  type MetasSemana,
  type PautaSnapshotDaPerformance,
} from '@mktos/shared';

/*
 * ============================================================================
 * METAS DO MÊS — a parte pura (ROOT-53a, C-12)
 * ============================================================================
 *
 * Nada aqui toca banco, relógio ou rede: as janelas de semana, a classificação
 * "sem dado × zero", a leitura tolerante da nota, a linha da estratégia e a
 * assinatura da semente são funções de entrada para saída. O `GoalsService`
 * só busca os números e entrega a estas funções decidirem o que eles significam.
 *
 * AS TRÊS REGRAS QUE ESTE ARQUIVO GUARDA
 * 1. SEMANA ISO, DE SEGUNDA A DOMINGO, NO RELÓGIO DE SÃO PAULO. Um lead que
 *    chega domingo às 23:30 em São Paulo é segunda 02:30 em UTC; contado em UTC
 *    ele cairia na semana seguinte. Os limites vêm de `instanteNoFuso` (shared),
 *    nunca de `getUTCDay()` nem de conta de offset à mão.
 * 2. A SEMANA QUE CRUZA O MÊS CONTA POR DIA. A janela de cada semana é recortada
 *    pelo mês civil, então a soma das semanas é o total do mês — sem dia contado
 *    duas vezes e sem dia perdido.
 * 3. SEM DADO NUNCA VIRA ZERO. Zero só existe depois que a fonte provou que
 *    estava de pé: `estadoDaSemana` exige um primeiro registro anterior ao fim
 *    da semana. Antes disso, ou sem registro nenhum, o valor é nulo.
 */

// ---------------------------------------------------------------------------
// As semanas do mês

export interface JanelaDaSemana extends MetasSemana {
  /** O instante de início (inclusive) do recorte da semana dentro do mês. */
  de: Date;
  /** O instante de fim (exclusivo): meia-noite de São Paulo do dia seguinte ao último dia. */
  ate: Date;
}

const diasEntre = (a: string, b: string): number => {
  const t = (d: string) => {
    const [y, m, dd] = d.split('-').map(Number);
    return Date.UTC(y, m - 1, dd);
  };
  return Math.round((t(b) - t(a)) / 86_400_000);
};

/** A semana ISO (`AAAA-Www`) de um dia civil: a do ano em que cai a quinta-feira dela. */
export function semanaIso(dia: string): string {
  const quinta = somarDias(segundaDaSemana(dia), 3);
  const ano = Number(quinta.slice(0, 4));
  const n = Math.floor(diasEntre(`${ano}-01-01`, quinta) / 7) + 1;
  return `${ano}-W${String(n).padStart(2, '0')}`;
}

export function primeiroEUltimoDia(mes: string): { primeiro: string; ultimo: string } {
  const [a, m] = mes.split('-').map(Number);
  const seguinte = new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 10);
  return { primeiro: `${mes}-01`, ultimo: somarDias(seguinte, -1) };
}

/** As semanas que tocam o mês, cada uma recortada pelos dias que são do mês. */
export function janelasDoMes(mes: string, fuso: string = METAS_FUSO): JanelaDaSemana[] {
  const { primeiro, ultimo } = primeiroEUltimoDia(mes);
  const janelas: JanelaDaSemana[] = [];
  for (let segunda = segundaDaSemana(primeiro); segunda <= ultimo; segunda = somarDias(segunda, 7)) {
    const domingo = somarDias(segunda, 6);
    const primeiroDia = segunda > primeiro ? segunda : primeiro;
    const ultimoDia = domingo < ultimo ? domingo : ultimo;
    janelas.push({
      semana: semanaIso(segunda),
      segunda,
      domingo,
      primeiroDia,
      ultimoDia,
      diasNoMes: diasEntre(primeiroDia, ultimoDia) + 1,
      de: instanteNoFuso(primeiroDia, '00:00', fuso),
      ate: instanteNoFuso(somarDias(ultimoDia, 1), '00:00', fuso),
    });
  }
  return janelas;
}

/** A janela do mês inteiro: do primeiro ao último dia, no fuso. */
export function janelaDoMesInteiro(mes: string, fuso: string = METAS_FUSO): { de: Date; ate: Date } {
  const { primeiro, ultimo } = primeiroEUltimoDia(mes);
  return { de: instanteNoFuso(primeiro, '00:00', fuso), ate: instanteNoFuso(somarDias(ultimo, 1), '00:00', fuso) };
}

/** A janela que contém o instante, ou nulo quando ele é de fora do mês. */
export function janelaDoInstante(janelas: JanelaDaSemana[], instante: Date): JanelaDaSemana | null {
  const t = instante.getTime();
  return janelas.find((j) => t >= j.de.getTime() && t < j.ate.getTime()) ?? null;
}

// ---------------------------------------------------------------------------
// Sem dado × zero

/**
 * `futura`: a semana ainda não começou. `sem_dado`: a fonte não tem registro que
 * chegue até o fim da semana (ou não tem registro nenhum). `com_dado`: a fonte
 * estava de pé — a partir daqui, zero é zero de verdade.
 */
export function estadoDaSemana(j: JanelaDaSemana, primeiroRegistro: Date | null, agora: Date): MetasEstadoDaSemana {
  if (j.de.getTime() > agora.getTime()) return 'futura';
  if (!primeiroRegistro || j.ate.getTime() <= primeiroRegistro.getTime()) return 'sem_dado';
  return 'com_dado';
}

/**
 * Junta o número de cada semana com o estado dela. É aqui que "sem dado nunca
 * vira zero" se cumpre: o valor só sobrevive quando o estado é `com_dado`,
 * mesmo que quem contou tenha devolvido um 0.
 */
export function medirSemanas(
  janelas: JanelaDaSemana[],
  valores: Array<number | null>,
  primeiroRegistro: Date | null,
  agora: Date,
): MetasMedidaDaSemana[] {
  return janelas.map((j, i) => {
    let estado = estadoDaSemana(j, primeiroRegistro, agora);
    const v = valores[i];
    if (estado === 'com_dado' && (v === null || v === undefined)) estado = 'sem_dado';
    const { de: _de, ate: _ate, ...semana } = j;
    return { ...semana, estado, valor: estado === 'com_dado' ? (v as number) : null };
  });
}

export function resumirSemanas(semanas: MetasMedidaDaSemana[]): {
  estado: 'sem_dado' | 'parcial' | 'com_dado';
  valor: number | null;
} {
  const decorridas = semanas.filter((s) => s.estado !== 'futura');
  const com = decorridas.filter((s) => s.estado === 'com_dado');
  if (!com.length) return { estado: 'sem_dado', valor: null };
  const valor = com.reduce((a, s) => a + (s.valor ?? 0), 0);
  return { estado: com.length === decorridas.length ? 'com_dado' : 'parcial', valor };
}

export function percentualDoAlvo(valor: number | null, alvo: number): number | null {
  if (valor === null || !(alvo > 0)) return null;
  return Math.round((valor / alvo) * 1000) / 10;
}

export function temPermissoesDaFonte(ind: IndicadorDeMeta, permissoes: readonly string[]): boolean {
  return ind.permissoes.every((p) => permissoes.includes(p));
}

// ---------------------------------------------------------------------------
// A semente (C-14)
// As linhas de demonstração do `seed.ts` não são operação e não entram em
// número nenhum. A assinatura é a mesma que a fatia SEED-1 usa para decidir o
// que pode apagar: o e-mail `@exemplo.com` E o telefone da semente juntos — um
// lead real com e-mail de exemplo, ou com aquele telefone, continua contando.

export const SEMENTE_DOMINIO_DE_EMAIL = '@exemplo.com';
export const SEMENTE_TELEFONE = '+55 21 99999-0000';
export const SEMENTE_NOMES_DE_CAMPANHA = ['Black Friday — Tráfego', 'Lançamento Curso', 'Remarketing Q3'] as const;

export function ehLeadDeSemente(l: { email: string | null; phone: string | null }): boolean {
  return Boolean(l.email?.endsWith(SEMENTE_DOMINIO_DE_EMAIL)) && l.phone === SEMENTE_TELEFONE;
}

/**
 * O filtro "não é semente", sem armadilha de NULL: `NOT (email LIKE ... AND
 * phone = ...)` em SQL devolve NULL (e some com a linha) quando o e-mail é nulo
 * e o telefone é o da semente. Cada ramo do OR cobre um jeito de não ser semente
 * sem depender da lógica de três valores.
 */
export function ondeLeadNaoESemente(): Prisma.LeadWhereInput {
  return {
    OR: [
      { email: null },
      { phone: null },
      { NOT: { email: { endsWith: SEMENTE_DOMINIO_DE_EMAIL } } },
      { NOT: { phone: SEMENTE_TELEFONE } },
    ],
  };
}

export function ehNomeDeCampanhaDeSemente(nome: string): boolean {
  return (SEMENTE_NOMES_DE_CAMPANHA as readonly string[]).includes(nome);
}

// ---------------------------------------------------------------------------
// A nota

/**
 * Lê o corpo da nota SEM lançar. A nota é editável por `/memoria`
 * (`obsidian.editar`) — a segunda via de escrita, que não passa pelas regras da
 * rota de metas —, então o que vem de lá pode estar torto. Corpo ilegível dá
 * lista vazia e um aviso; item torto é descartado com aviso, e o resto da nota
 * continua valendo. Nunca derruba a tela (mesma regra de `lerPilaresDoTexto`).
 */
export function lerMetasDaNota(corpo: string | null | undefined): { metas: MetaDoMes[]; avisos: string[] } {
  const texto = (corpo ?? '').trim();
  if (!texto) return { metas: [], avisos: [] };

  const avisos: string[] = [];
  if (texto.length > METAS_TAMANHO_MAXIMO_DA_NOTA) {
    return { metas: [], avisos: ['A nota das metas passa do tamanho aceito e não foi lida. Salve a revisão pela tela.'] };
  }
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return {
      metas: [],
      avisos: ['A nota das metas não é um JSON válido (foi editada fora da tela?). Nenhuma meta foi lida; salve a revisão pela tela para refazê-la.'],
    };
  }
  const lista = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? (bruto as { metas?: unknown }).metas : null;
  if (!Array.isArray(lista)) {
    return { metas: [], avisos: ['A nota das metas não tem a lista "metas". Nenhuma meta foi lida; salve a revisão pela tela.'] };
  }

  const metas: MetaDoMes[] = [];
  const vistos = new Set<string>();
  lista.forEach((item, i) => {
    const onde = `meta ${i + 1}`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      avisos.push(`A ${onde} da nota não é um objeto e foi ignorada.`);
      return;
    }
    const m = item as Record<string, unknown>;
    const ind = typeof m.indicador === 'string' ? indicadorDeMeta(m.indicador) : null;
    if (!ind) {
      avisos.push(`A ${onde} usa um indicador que não existe no catálogo e foi ignorada.`);
      return;
    }
    if (typeof m.alvo !== 'number' || !Number.isFinite(m.alvo) || m.alvo <= 0) {
      avisos.push(`A ${onde} (${ind.rotulo}) tem alvo inválido e foi ignorada.`);
      return;
    }
    const campanhaId = typeof m.campanhaId === 'string' && m.campanhaId.trim() ? m.campanhaId.trim() : null;
    if (ind.exigeCampanha && !campanhaId) {
      avisos.push(`A ${onde} (${ind.rotulo}) não aponta campanha e foi ignorada.`);
      return;
    }
    const chave = `${ind.chave}|${ind.exigeCampanha ? campanhaId : ''}`;
    if (vistos.has(chave)) {
      avisos.push(`A ${onde} repete ${ind.rotulo}${ind.exigeCampanha ? ' na mesma campanha' : ''}; só a primeira vale.`);
      return;
    }
    vistos.add(chave);
    let origem: string | null = null;
    if (typeof m.origem === 'string' && m.origem) {
      if (lerOrigemDaEstrategia(m.origem)) origem = m.origem;
      else avisos.push(`A origem da ${onde} (${ind.rotulo}) não é de uma linha da estratégia e foi descartada.`);
    }
    metas.push({
      indicador: ind.chave,
      alvo: m.alvo,
      unidade: ind.unidade,
      campanhaId: ind.exigeCampanha ? campanhaId : null,
      origem,
      observacao:
        typeof m.observacao === 'string' && m.observacao.trim()
          ? m.observacao.trim().slice(0, METAS_TETO_DA_OBSERVACAO)
          : null,
    });
  });
  if (metas.length > METAS_TETO_DE_METAS_POR_MES) {
    avisos.push(`A nota tem mais de ${METAS_TETO_DE_METAS_POR_MES} metas; as que passam do limite foram ignoradas.`);
    metas.length = METAS_TETO_DE_METAS_POR_MES;
  }
  return { metas, avisos };
}

/** O corpo gravado: JSON com a lista, na forma do contrato C-12. */
export function corpoDaNotaDeMetas(metas: MetaDoMes[]): string {
  return JSON.stringify({ metas }, null, 2);
}

// ---------------------------------------------------------------------------
// A estratégia

/** Normaliza o texto da linha antes do hash: marcador, espaços e Unicode. */
export function normalizarLinhaDaMeta(texto: string): string {
  return texto
    .normalize('NFC')
    .replace(/^\s*[-*•]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hashDaLinhaDaMeta(texto: string): string {
  return createHash('sha256').update(normalizarLinhaDaMeta(texto)).digest('hex').slice(0, 12);
}

/**
 * As linhas da seção "Metas" de um documento de estratégia. É leitura
 * tolerante: o documento é editado à mão, então o título pode vir com outra
 * caixa, e linha vazia ou "—" (seção sem item) é ignorada. Linha repetida
 * aparece uma vez — o hash é o mesmo e apontaria o mesmo lugar.
 */
export function linhasDeMetaDaEstrategia(documento: string): Array<{ hash: string; texto: string }> {
  const linhas = documento.replace(/\r\n?/g, '\n').split('\n');
  const out: Array<{ hash: string; texto: string }> = [];
  const vistos = new Set<string>();
  let dentro = false;
  for (const crua of linhas) {
    const titulo = /^##\s+(.*?)\s*$/.exec(crua);
    if (titulo) {
      dentro = titulo[1].toLowerCase() === 'metas';
      continue;
    }
    if (!dentro) continue;
    const texto = normalizarLinhaDaMeta(crua);
    if (!texto || texto === '—' || texto === '-') continue;
    const hash = hashDaLinhaDaMeta(texto);
    if (vistos.has(hash)) continue;
    vistos.add(hash);
    out.push({ hash, texto });
  }
  return out;
}

export function linhasParaATela(
  notaId: string,
  versao: number,
  documento: string,
  origensUsadas: ReadonlySet<string>,
): MetasLinhaDaEstrategia[] {
  return linhasDeMetaDaEstrategia(documento).map(({ hash, texto }) => {
    const itemId = itemIdDaEstrategia(notaId, hash);
    return {
      itemId,
      texto,
      origem: origemDaEstrategia({ notaId, hash, versao }),
      // Uma meta antiga pode apontar a mesma linha numa versão anterior da nota.
      jaViraMeta: [...origensUsadas].some((o) => o.startsWith(`estrategia:${itemId}@`)),
    };
  });
}

// ---------------------------------------------------------------------------
// A foto de performance (instagram.*)

export function lerFotoDePerformance(corpo: string | null | undefined): PautaSnapshotDaPerformance | null {
  if (!corpo || !corpo.trim()) return null;
  try {
    const s = JSON.parse(corpo) as PautaSnapshotDaPerformance;
    return s && typeof s === 'object' && Array.isArray(s.posts) ? s : null;
  } catch {
    return null;
  }
}

/**
 * As visualizações por semana, dos posts PUBLICADOS nela (dia civil de São
 * Paulo). Post sem número entre os da semana não vira zero: se a semana só tem
 * posts sem número, ela fica sem dado; se tem alguns com número, soma os que
 * têm. Semana sem nenhum post publicado vale zero — a foto cobre o mês inteiro,
 * então "nenhum post" é um fato, não uma falta de leitura.
 */
export function visualizacoesPorSemana(foto: PautaSnapshotDaPerformance, janelas: JanelaDaSemana[]): Array<number | null> {
  return janelas.map((j) => {
    const dosDaSemana = foto.posts.filter((p) => {
      if (!p.publicadaEm) return false;
      const dia = diaNoFuso(new Date(p.publicadaEm));
      return dia >= j.primeiroDia && dia <= j.ultimoDia;
    });
    if (!dosDaSemana.length) return 0;
    const medidos = dosDaSemana.filter((p) => typeof p.numeros?.visualizacoes === 'number');
    if (!medidos.length) return null;
    return medidos.reduce((a, p) => a + (p.numeros.visualizacoes as number), 0);
  });
}
