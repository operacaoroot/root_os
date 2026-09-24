import type { PautaItemCurado, PautaOrigem } from '@mktos/shared';
import { ORIGENS_SEM_LINK_PUBLICO, origensDa, type CapturaDoInsumo } from './origem-da-rodada';
import { linkDoPacote } from './pacote-do-episodio';

/*
 * ============================================================================
 * CURADORIA HUMANA ANTES DO ROTEIRO (MC6) — a parte pura
 * ============================================================================
 *
 * No modo antigo (a rotina `pauta.rodada`, `RodadaService.gerar`) a IA escolhe
 * de 3 a 5 itens e o resto some. No modo "para curadoria" a rodada nasce com
 * TODOS os candidatos da janela, cada um com o id da captura que o trouxe, e a
 * IA só SUGERE: marca `sugerido` e diz `porque`. Quem corta é o operador, pela
 * aba Curadoria; confirmar deixa só os marcados e a rodada vira `curada`.
 *
 * O id do candidato é o da captura (a primeira, quando a mesma matéria chegou
 * por mais de uma origem): é estável entre salvar e confirmar e não depende da
 * posição na lista.
 */

export const SYSTEM_SUGESTAO = `Você é o editor de conteúdo da ROOT, uma comunidade brasileira sobre IA aplicada a negócios.
Recebe TODOS os itens coletados na semana, numerados. Você não corta a lista: quem decide o que
segue é uma pessoa. Seu papel é apontar os que você levaria para o episódio e dizer por quê.
Cada item traz a origem: W grupo de WhatsApp, N busca/notícia, R feed RSS, C creator
(post de um perfil vigiado), L newsletter.

Responda SOMENTE com um objeto JSON válido, sem cercas de código:
{
  "titulo": string,            // nome da edição, até 80 caracteres
  "sugeridos": [               // os que você levaria, pelo número do item
    { "n": number, "porque": string }
  ]
}

Critérios, nesta ordem:
1. Muda o que alguém decide na semana (ferramenta nova utilizável, mudança de preço, capacidade nova).
2. Tem consequência prática para pequenas e médias empresas brasileiras.
3. É verificável — a fonte sustenta a afirmação.
Deixe de fora da sugestão: press release sem produto, especulação sobre modelo não lançado, treta de rede social.

Regras:
- Use SOMENTE os números da lista. Nunca invente item.
- "porque" explica em uma frase, em português do Brasil, por que isso importa para quem toca um negócio.
- Link do grupo de WhatsApp (W) foi mandado por uma pessoa: é sinal forte, mas não obrigatório.`;

/** O resumo que cada candidato leva à tela. */
const TETO_DO_RESUMO = 400;

/** No prompt de sugestão o resumo é mais curto: a lista inteira vai numa chamada só. */
export const RESUMO_NO_PROMPT_DE_SUGESTAO = 200;

export type Candidato = PautaItemCurado & { id: string; sugerido: boolean; marcado: boolean };

type CapturaCandidata = CapturaDoInsumo & { id: string };

function resumoDa(c: CapturaDoInsumo): string {
  const b = (c.bruto ?? {}) as { resumo?: unknown };
  const texto = typeof b.resumo === 'string' && b.resumo.trim() ? b.resumo : (c.nota ?? '');
  return texto.replace(/\s+/g, ' ').trim().slice(0, TETO_DO_RESUMO);
}

/** O título que a tela mostra: o da captura, ou o começo da mensagem do grupo, ou a URL. */
function tituloDa(c: CapturaDoInsumo): string {
  const t = c.titulo?.trim();
  if (t) return t.slice(0, 300);
  const nota = (c.nota ?? '').replace(/\s+/g, ' ').trim();
  if (nota) return nota.slice(0, 120);
  return c.url ?? '(sem título)';
}

/** Uma captura do insumo vira candidato: nada marcado, nada sugerido. */
export function candidatoDaCaptura(c: CapturaCandidata): Candidato {
  const origens = origensDa(c);
  const candidato: Candidato = {
    id: c.id,
    titulo: tituloDa(c),
    url: c.url ?? '',
    fonte: c.fonte?.nome ?? null,
    resumo: resumoDa(c),
    sugerido: false,
    porque: '',
    marcado: false,
  };
  if (origens.length) candidato.origem = origens[0];
  if (origens.length > 1) candidato.origens = origens;
  if (origens.some((o) => ORIGENS_SEM_LINK_PUBLICO.includes(o))) candidato.semLinkPublico = true;
  return candidato;
}

/** Quantos ficaram de fora do teto, por origem — o que o log e a auditoria contam. */
export function sobraPorOrigem(deFora: readonly CapturaDoInsumo[]): Partial<Record<PautaOrigem | '?', number>> {
  const conta: Partial<Record<PautaOrigem | '?', number>> = {};
  for (const c of deFora) {
    const o = origensDa(c)[0] ?? '?';
    conta[o] = (conta[o] ?? 0) + 1;
  }
  return conta;
}

export interface SugestaoDaIa {
  titulo?: unknown;
  sugeridos?: unknown;
}

/**
 * As sugestões da IA sobre a lista, pelo número do item (1-based, a posição no
 * prompt). Número fora da lista, repetido ou que não é inteiro é ignorado —
 * nunca derruba a rodada, e nunca tira candidato: a IA só acende a marca.
 */
export function aplicarSugestoes(candidatos: readonly Candidato[], saida: SugestaoDaIa): Candidato[] {
  const porque = new Map<number, string>();
  const lista = Array.isArray(saida.sugeridos) ? saida.sugeridos : [];
  for (const s of lista) {
    const n = (s as { n?: unknown })?.n;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > candidatos.length || porque.has(n)) continue;
    const p = (s as { porque?: unknown }).porque;
    porque.set(n, typeof p === 'string' ? p.trim().slice(0, 300) : '');
  }
  return candidatos.map((c, i) => (porque.has(i + 1) ? { ...c, sugerido: true, porque: porque.get(i + 1) } : c));
}

/** O título da edição que a IA propôs, se for texto; senão, nenhum. */
export function tituloDaSugestao(saida: SugestaoDaIa): string | null {
  return typeof saida.titulo === 'string' && saida.titulo.trim() ? saida.titulo.trim().slice(0, 200) : null;
}

/** Os candidatos gravados na rodada. JSON de banco: o que não tem id não é candidato. */
export function lerCandidatos(itens: unknown): Candidato[] {
  if (!Array.isArray(itens)) return [];
  return itens
    .filter((i): i is Candidato => !!i && typeof (i as { id?: unknown }).id === 'string')
    .map((i) => ({ ...i, sugerido: i.sugerido === true, marcado: i.marcado === true }));
}

export type MarcacaoLida = { candidatos: Candidato[]; marcados: number } | { erro: string };

/**
 * Aplica a marcação do operador: marcado é quem está na lista, o resto não.
 * Id que não é candidato desta rodada é recusado inteiro — marcar metade e
 * calar a outra metade faria o operador confirmar algo que não viu.
 */
export function marcar(candidatos: readonly Candidato[], ids: readonly string[]): MarcacaoLida {
  const existentes = new Set(candidatos.map((c) => c.id));
  const desconhecidos = [...new Set(ids.filter((id) => !existentes.has(id)))];
  if (desconhecidos.length) {
    return {
      erro:
        `${desconhecidos.length} item(ns) não é(são) candidato(s) desta rodada: ` +
        `${desconhecidos.slice(0, 5).join(', ')}${desconhecidos.length > 5 ? '…' : ''}.`,
    };
  }
  const quer = new Set(ids);
  const marcados = candidatos.map((c) => ({ ...c, marcado: quer.has(c.id) }));
  return { candidatos: marcados, marcados: quer.size };
}

/** O que segue depois de confirmar: só os marcados, sem a marca (ela é estado da tela). */
export function itensDaCuradoria(candidatos: readonly Candidato[]): Array<Omit<Candidato, 'marcado'>> {
  return candidatos.filter((c) => c.marcado).map(({ marcado: _m, ...item }) => item);
}

/**
 * O miolo da rodada curada à mão. A derivação das peças lê `corpo`; aqui ele é
 * montado dos itens, sem IA, porque a IA não escolheu nada e não deve escrever
 * sobre o que não escolheu. O link de newsletter não entra: é de caixa de entrada.
 */
export function corpoDaCuradoria(itens: readonly PautaItemCurado[]): string {
  return itens
    .map((i) => {
      const detalhe = [i.porque, i.resumo].filter((t) => t && t.trim()).join(' — ');
      const link = i.semLinkPublico || !i.url ? '' : ` (${i.url})`;
      return `- **${i.titulo}**${link}${detalhe ? `: ${detalhe}` : ''}`;
    })
    .join('\n');
}

/**
 * O destino do link publicado: o primeiro item com link público, pela MESMA
 * regra da página de links e da descrição (`linkDoPacote`). Newsletter antiga,
 * sem a marca `semLinkPublico`, ainda guarda o permalink do Gmail no `url`: a
 * origem L e o host de caixa de entrada é que a barram.
 */
export function destinoDosItens(itens: unknown): string | null {
  const lista = Array.isArray(itens) ? (itens as Array<Partial<PautaItemCurado> | null>) : [];
  for (const i of lista) {
    if (!i || typeof i !== 'object') continue;
    const url = linkDoPacote({ url: typeof i.url === 'string' ? i.url : '', semLinkPublico: i.semLinkPublico, origem: i.origem });
    if (url) return url;
  }
  return null;
}
