import {
  PAUTA_ORIGENS,
  PAUTA_ORIGEM_ROTULOS,
  origemDaFonte,
  type PautaFonteTipo,
  type PautaOrigem,
} from '@mktos/shared';
import { normalizarUrlDaCaptura } from './url-da-captura';

/*
 * ============================================================================
 * DE ONDE VEIO CADA ITEM DA RODADA (MC4) — a parte pura
 * ============================================================================
 *
 * Até o MC3 a curadoria lia só o feed (R) e a busca (N). Desde o MC4 ela lê a
 * janela inteira: o grupo de links do WhatsApp (W), os creators vigiados (C) e
 * as newsletters do Gmail (L) também. Cada item leva a letra da origem até o
 * prompt e até o item curado gravado na rodada, que é o que a curadoria humana
 * (MC6) vai mostrar. A letra sai da FONTE da captura (`origemDaFonte`, no
 * shared), não do bruto: o bruto é trocado quando a captura vira ficha.
 *
 * A NEWSLETTER ENTRA COMO CONTEXTO, NÃO COMO LINK. A URL da captura do Gmail é
 * o permalink de uma caixa de entrada, e o item escolhido vira link publicado
 * no grupo. No modo em que a IA escolhe (`gerar`), o prompt mostra a newsletter
 * sem URL e o item L que ela escolher mesmo assim é tirado da seleção. Na
 * curadoria humana (MC6) ela é candidata como as outras, marcada sem link
 * público (`curadoria-da-rodada.ts`).
 */

/** A rodada de antes do MC4: feed e busca. É o que uma rotina com `origens: ['R', 'N']` reproduz. */
export const ORIGENS_ANTES_DO_MC4: readonly PautaOrigem[] = ['R', 'N'];

/** Origens cujo link é privado: entram no prompt e não podem ser escolhidas. */
export const ORIGENS_SEM_LINK_PUBLICO: readonly PautaOrigem[] = ['L'];

export type OrigensLidas = { origens: PautaOrigem[] } | { erro: string };

/**
 * As origens pedidas (corpo da requisição ou config da rotina). Ausente é
 * todas; o que vier é conferido letra a letra, sem repetição, na ordem de
 * `PAUTA_ORIGENS`.
 */
export function lerOrigensDaRodada(bruto: unknown): OrigensLidas {
  if (bruto === undefined || bruto === null) return { origens: [...PAUTA_ORIGENS] };
  if (!Array.isArray(bruto) || bruto.length === 0) {
    return { erro: `As origens da rodada são uma lista com pelo menos uma de ${PAUTA_ORIGENS.join(', ')}.` };
  }
  const invalidas = bruto.filter((o) => !(PAUTA_ORIGENS as readonly unknown[]).includes(o));
  if (invalidas.length) {
    return {
      erro: `Origem desconhecida: ${invalidas.map((o) => JSON.stringify(o)).join(', ')}. ` +
        `As origens são ${PAUTA_ORIGENS.map((o) => `${o} (${PAUTA_ORIGEM_ROTULOS[o]})`).join(', ')}.`,
    };
  }
  return { origens: PAUTA_ORIGENS.filter((o) => bruto.includes(o)) };
}

export interface FiltroDaFonte {
  tipo: PautaFonteTipo;
  plataforma?: string;
}

/** O `where` da fonte, por origem. W é a fonte manual do grupo de links, e só ela. */
export function filtroDasOrigens(origens: readonly PautaOrigem[]): FiltroDaFonte[] {
  const porOrigem: Record<PautaOrigem, FiltroDaFonte> = {
    W: { tipo: 'manual', plataforma: 'whatsapp' },
    N: { tipo: 'busca' },
    R: { tipo: 'rss' },
    C: { tipo: 'perfil' },
    L: { tipo: 'gmail' },
  };
  return origens.map((o) => porOrigem[o]);
}

/**
 * Os tipos de fonte que a coleta da rodada percorre para as origens pedidas. W
 * não se coleta: o grupo manda o link sozinho (MC1).
 */
export function tiposDaColetaDasOrigens(origens: readonly PautaOrigem[]): PautaFonteTipo[] {
  return filtroDasOrigens(origens.filter((o) => o !== 'W')).map((f) => f.tipo);
}

/** A conta da coleta por tipo de fonte, relida pela letra da origem. Tipo sem letra fica de fora. */
export function coletaPorOrigem<T>(porTipo: Partial<Record<PautaFonteTipo, T>>): Partial<Record<PautaOrigem, T>> {
  const saida: Partial<Record<PautaOrigem, T>> = {};
  for (const [tipo, conta] of Object.entries(porTipo) as Array<[PautaFonteTipo, T | undefined]>) {
    const o = origemDaFonte({ tipo });
    if (o && conta) saida[o] = conta;
  }
  return saida;
}

export interface CapturaDoInsumo {
  titulo: string | null;
  url: string | null;
  /** O texto que veio junto do link: no grupo de links (W) é a mensagem, e o título fica vazio. */
  nota?: string | null;
  bruto: unknown;
  fonte: { nome: string; tipo: PautaFonteTipo; plataforma: string | null; handle?: string | null } | null;
  /** Todas as origens em que a matéria apareceu, quando `umaPorMateriaDoInsumo` juntou mais de uma captura. */
  origens?: readonly PautaOrigem[];
}

/** As origens da captura: as que a junção guardou, ou a da fonte dela. */
export function origensDa(c: CapturaDoInsumo): PautaOrigem[] {
  if (c.origens?.length) return [...c.origens];
  const o = origemDaFonte(c.fonte);
  return o ? [o] : [];
}

/** Na ordem de `PAUTA_ORIGENS`, sem repetir: W primeiro, porque o grupo é o sinal humano. */
function emOrdem(origens: Iterable<PautaOrigem>): PautaOrigem[] {
  const tem = new Set(origens);
  return PAUTA_ORIGENS.filter((o) => tem.has(o));
}

function chaveDaMateria(c: CapturaDoInsumo, url: string): string {
  const origem = origemDaFonte(c.fonte);
  return origem && ORIGENS_SEM_LINK_PUBLICO.includes(origem) ? `${origem}:${url}` : normalizarUrlDaCaptura(url);
}

/**
 * Uma captura por matéria (`umaPorMateria`), menos na newsletter: o id do
 * e-mail mora no fragmento do permalink, que a chave da tela apaga, e todas as
 * newsletters virariam uma só. Lá a repetição é pela URL inteira. Fica a
 * primeira captura de cada matéria, com as origens de todas em `origens`: o
 * mesmo link no grupo e no feed é W e R, e o W não pode se perder.
 */
export function umaPorMateriaDoInsumo<T extends CapturaDoInsumo>(capturas: readonly T[]): T[] {
  const porChave = new Map<string, Set<PautaOrigem>>();
  const grupos: Array<{ c: T; origens: Set<PautaOrigem> | null }> = [];
  for (const c of capturas) {
    if (!c.url) {
      grupos.push({ c, origens: null });
      continue;
    }
    const chave = chaveDaMateria(c, c.url);
    const ja = porChave.get(chave);
    if (ja) {
      for (const o of origensDa(c)) ja.add(o);
      continue;
    }
    const origens = new Set(origensDa(c));
    porChave.set(chave, origens);
    grupos.push({ c, origens });
  }
  return grupos.map(({ c, origens }) => {
    const todas = origens ? emOrdem(origens) : [];
    return todas.length > 1 ? { ...c, origens: todas } : c;
  });
}

/**
 * Post de creator publicado antes da janela não é notícia da janela. A primeira
 * coleta de um canal traz os últimos vídeos, que podem ter meses, e a janela
 * se mede por `capturadoEm`: sem isto, eles entrariam como se fossem da semana.
 * Sem data, fica.
 */
export function postForaDaJanela(c: CapturaDoInsumo, janelaIni: Date): boolean {
  if (origemDaFonte(c.fonte) !== 'C') return false;
  const publicadoEm = (c.bruto as { publicadoEm?: unknown } | null)?.publicadoEm;
  if (typeof publicadoEm !== 'string') return false;
  const quando = new Date(publicadoEm);
  return !Number.isNaN(quando.getTime()) && quando < janelaIni;
}

/**
 * O insumo da curadoria a partir de uma lista por origem, cada uma da mais nova
 * para a mais velha. Sem post velho de creator, uma captura por matéria, e as
 * origens alternando até o teto: nenhuma origem tira as outras do corte, por
 * mais que tenha gravado por último. Sai da mais nova para a mais velha.
 */
export function insumoDaRodada<T extends CapturaDoInsumo & { capturadoEm: Date }>(
  porOrigem: ReadonlyArray<readonly T[]>,
  opcoes: { janelaIni: Date; teto: number },
): T[] {
  return insumoDaRodadaComSobra(porOrigem, opcoes).escolhidas;
}

/**
 * O mesmo corte de `insumoDaRodada`, com o que ficou de fora dele — a curadoria
 * humana (MC6) registra a sobra em vez de a perder calada.
 */
export function insumoDaRodadaComSobra<T extends CapturaDoInsumo & { capturadoEm: Date }>(
  porOrigem: ReadonlyArray<readonly T[]>,
  opcoes: { janelaIni: Date; teto: number },
): { escolhidas: T[]; deFora: T[] } {
  const todas = porOrigem
    .flat()
    .filter((c) => !postForaDaJanela(c, opcoes.janelaIni))
    .sort((a, b) => b.capturadoEm.getTime() - a.capturadoEm.getTime());
  const unicas = umaPorMateriaDoInsumo(todas);

  const filas = new Map<string, T[]>();
  for (const c of unicas) {
    const k = origemDaFonte(c.fonte) ?? '?';
    const fila = filas.get(k);
    if (fila) fila.push(c);
    else filas.set(k, [c]);
  }
  const escolhidas: T[] = [];
  const listas = [...filas.values()];
  for (let i = 0; escolhidas.length < opcoes.teto && listas.some((l) => i < l.length); i++) {
    for (const l of listas) {
      if (i < l.length && escolhidas.length < opcoes.teto) escolhidas.push(l[i]);
    }
  }
  const ficou = new Set<T>(escolhidas);
  return {
    escolhidas: escolhidas.sort((a, b) => b.capturadoEm.getTime() - a.capturadoEm.getTime()),
    deFora: unicas.filter((c) => !ficou.has(c)),
  };
}

/** A linha do prompt: a letra da origem, a fonte e — se o link for publicável — a URL. */
export function linhaDoInsumo(c: CapturaDoInsumo, posicao: number, limiteDoResumo = 500): string {
  const b = (c.bruto ?? {}) as { resumo?: unknown; publicadoEm?: unknown };
  const origens = origensDa(c);
  const creator = c.fonte?.tipo === 'perfil' && c.fonte.handle ? ` (@${c.fonte.handle}${c.fonte.plataforma ? ` · ${c.fonte.plataforma}` : ''})` : '';
  const data = typeof b.publicadoEm === 'string' ? ` · ${b.publicadoEm.slice(0, 10)}` : '';
  const semLink = origens.some((o) => ORIGENS_SEM_LINK_PUBLICO.includes(o));
  const resumo = typeof b.resumo === 'string' && b.resumo ? b.resumo : (c.nota ?? '').trim();
  return [
    `[${posicao}] ${c.titulo ?? '(sem título)'}`,
    `    origem: ${origens.length ? origens.join('+') : '?'} · fonte: ${c.fonte?.nome ?? 'n/d'}${creator}${data}`,
    semLink ? '    url: (newsletter — sem link público; use como contexto, não selecione)' : `    url: ${c.url}`,
    resumo ? `    resumo: ${resumo.slice(0, limiteDoResumo)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export interface ItemEscolhido {
  titulo?: string;
  url?: string;
  porque?: string;
  ganchoBr?: string;
}

/**
 * Os itens que a IA escolheu, com a origem da captura de mesma chave. O item
 * que casa com uma origem sem link público sai; o que não casa com captura
 * nenhuma segue sem origem, como antes do MC4. A origem é sempre a nossa:
 * a que a IA devolver no item é descartada, porque o prompt mostra a letra e
 * ela pode ecoar qualquer coisa. Matéria em mais de uma origem leva a primeira
 * de `PAUTA_ORIGENS` (W antes de todas).
 */
export function comOrigem<T extends ItemEscolhido>(
  escolhidos: readonly T[],
  capturas: readonly CapturaDoInsumo[],
): Array<Omit<T, 'origem'> & { origem?: PautaOrigem }> {
  const porChave = new Map<string, Set<PautaOrigem>>();
  for (const c of capturas) {
    if (!c.url) continue;
    const chave = normalizarUrlDaCaptura(c.url);
    const origens = porChave.get(chave) ?? new Set<PautaOrigem>();
    for (const o of origensDa(c)) origens.add(o);
    porChave.set(chave, origens);
  }
  const saida: Array<Omit<T, 'origem'> & { origem?: PautaOrigem }> = [];
  for (const item of escolhidos) {
    const { origem: _daIa, ...resto } = item as T & { origem?: unknown };
    const origens = item.url ? emOrdem(porChave.get(normalizarUrlDaCaptura(item.url)) ?? []) : [];
    if (origens.some((o) => ORIGENS_SEM_LINK_PUBLICO.includes(o))) continue;
    saida.push(origens.length ? { ...resto, origem: origens[0] } : resto);
  }
  return saida;
}
