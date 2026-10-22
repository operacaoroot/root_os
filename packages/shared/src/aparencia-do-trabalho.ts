import { z } from 'zod';

/*
 * ÍCONE E COR NA FRENTE DA LISTA E DA PASTA (produção 22B, I1, 22/10/2026).
 *
 * O Rodrigo pediu "emoji ou ícone na frente da lista, com cor, trocável". O que
 * vale mora aqui, num lugar só, porque a tela oferece e a API confere a MESMA
 * coisa:
 *  · ÍCONE é um emoji curto (um só, com os modificadores de tom e as junções
 *    que formam um emoji composto) OU o nome de um ícone do catálogo abaixo,
 *    que são ícones `lucide-react` que o app já usa no menu. Nada de texto
 *    livre: um nome fora do catálogo não desenha nada na tela;
 *  · COR é um dos tokens do tema (lista fechada). Token, e não hexadecimal,
 *    porque a cor acompanha o tema escuro, papel e claro; um hex fixo some num
 *    dos três;
 *  · `null` apaga. Sem ícone e sem cor, a árvore fica exatamente como antes.
 */

/** Ícones do catálogo do app (lucide-react), na ordem do seletor. */
export const ICONES_DO_TRABALHO = [
  'KanbanSquare', 'ListChecks', 'CheckSquare', 'Inbox', 'Target', 'Lightbulb',
  'Megaphone', 'Handshake', 'HeartHandshake', 'Users', 'UserPlus', 'Wallet',
  'DollarSign', 'CreditCard', 'FileText', 'FileSignature', 'NotebookText', 'Library',
  'CalendarDays', 'CalendarClock', 'Repeat', 'Workflow', 'Wrench', 'Settings',
  'Shield', 'Network', 'BarChart3', 'TrendingUp', 'Compass', 'MessageCircle',
] as const;
export type IconeDoTrabalho = (typeof ICONES_DO_TRABALHO)[number];

/** Emojis comuns oferecidos de cara (qualquer outro emoji curto também vale). */
export const EMOJIS_DO_TRABALHO = [
  '📁', '📂', '📋', '📌', '📎', '📝', '✅', '⭐', '🔥', '🚀', '🎯', '💡',
  '📣', '🤝', '👥', '💰', '💳', '📊', '📈', '🗓️', '⏰', '⚙️', '🛠️', '🔒',
  '🏢', '🏠', '📦', '🧾', '⚖️', '❤️',
] as const;

/** As cores: os tokens do tema que servem de destaque, com o nome que a tela mostra. */
export const CORES_DO_TRABALHO = ['brand', 'brand-2', 'good', 'warn', 'bad', 'info', 'mag', 'muted'] as const;
export type CorDoTrabalho = (typeof CORES_DO_TRABALHO)[number];
export const NOME_DA_COR_DO_TRABALHO: Record<CorDoTrabalho, string> = {
  brand: 'Acento',
  'brand-2': 'Acento 2',
  good: 'Verde',
  warn: 'Amarelo',
  bad: 'Vermelho',
  info: 'Ciano',
  mag: 'Magenta',
  muted: 'Cinza',
};

export const TRAB_ICONE_INVALIDO = 'O ícone precisa ser um emoji ou um dos ícones do catálogo.';
export const TRAB_COR_INVALIDA = 'A cor precisa ser uma das cores do tema.';

/** Tamanho máximo do texto do ícone (o banco segura 32). */
const TETO_DO_EMOJI = 16;

const PICTOGRAFICO = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
// Só o que compõe emoji: pictográficos, indicadores regionais (bandeiras), tom de pele,
// seletor de variação, junção de largura zero, a tecla (⃣) e os marcadores de tag.
const SO_EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\p{Emoji_Component}|‍|️|⃣|[\u{e0020}-\u{e007f}])+$/u;

/** Um emoji só (um grafema), curto. "📁" passa; "📁📁", "abc" e "1" não. */
export function ehEmojiCurto(v: string): boolean {
  if (!v || v.length > TETO_DO_EMOJI) return false;
  if (!SO_EMOJI.test(v) || !PICTOGRAFICO.test(v)) return false;
  const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: 'grapheme' }) => { segment: (s: string) => Iterable<unknown> } }).Segmenter;
  if (Seg) return [...new Seg('pt-BR', { granularity: 'grapheme' }).segment(v)].length === 1;
  return true;
}

export function ehIconeDoCatalogo(v: string): v is IconeDoTrabalho {
  return (ICONES_DO_TRABALHO as readonly string[]).includes(v);
}

export function iconeDoTrabalhoValido(v: string): boolean {
  return ehIconeDoCatalogo(v) || ehEmojiCurto(v);
}

export function ehCorDoTrabalho(v: unknown): v is CorDoTrabalho {
  return typeof v === 'string' && (CORES_DO_TRABALHO as readonly string[]).includes(v);
}

/** `undefined` = não mexe; `null` = apaga; texto = grava. */
export const TrabIconeSchema = z.string().trim().min(1).max(32).refine(iconeDoTrabalhoValido, TRAB_ICONE_INVALIDO).nullable().optional();
export const TrabCorSchema = z.enum(CORES_DO_TRABALHO, { errorMap: () => ({ message: TRAB_COR_INVALIDA }) }).nullable().optional();

/** Como a tela recebe a aparência: o que está gravado, e nulo quando o gravado não vale mais. */
export function aparenciaDoTrabalho(r: { icone?: string | null; cor?: string | null }): { icone: string | null; cor: CorDoTrabalho | null } {
  return {
    icone: r.icone && iconeDoTrabalhoValido(r.icone) ? r.icone : null,
    cor: ehCorDoTrabalho(r.cor) ? r.cor : null,
  };
}
