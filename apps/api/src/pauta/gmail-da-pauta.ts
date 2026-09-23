import { cortarSemPartirCaractere, semSubstitutoSolto } from '../common/texto';
import { hashDaCaptura } from './url-da-captura';

/*
 * ============================================================================
 * NEWSLETTER DO GMAIL VIRA CAPTURA (MC2) — a parte pura
 * ============================================================================
 *
 * A fonte `gmail` guarda uma ETIQUETA em `handle`. A coleta pergunta ao Gmail
 * `label:<etiqueta> newer_than:<dias>d` e cada e-mail vira uma `PautaCaptura`.
 *
 * A ETIQUETA É A FRONTEIRA DO QUE O OS LÊ, e por isso é validada aqui e não
 * só na tela. Quem configura a fonte escolhe a pasta de newsletters; se a
 * etiqueta aceitasse espaço, aspas ou parêntese, "ia OR in:inbox" viraria a
 * caixa de entrada inteira dentro da pauta, que qualquer um com `pauta.ver`
 * lê. Pelo mesmo motivo as etiquetas de sistema (inbox, sent, …) são recusadas.
 *
 * A URL DA CAPTURA É O PERMALINK DO E-MAIL, que o próprio conector devolve
 * (`link`), e o `urlHash` sai dele SEM passar por `normalizarUrlDaCaptura`:
 * aquela normalização apaga o fragmento, e o id do e-mail mora no fragmento
 * (`#all/<id>`) — todas as newsletters virariam a mesma captura.
 */

export const DIAS_DA_JANELA_DO_GMAIL = 7;
/**
 * O teto do próprio conector, sem paginação. Quando a lista volta cheia, a
 * coleta avisa na fonte: os e-mails mais antigos da semana podem ter ficado
 * de fora.
 */
export const TETO_DE_EMAILS_POR_COLETA = 50;
/** O que a fila mostra. O texto inteiro (até `TETO_DO_TEXTO`) fica no bruto. */
export const TETO_DA_NOTA = 1500;
/** O mesmo teto do texto que o processamento manda para a IA. */
export const TETO_DO_TEXTO = 12000;
const TETO_DO_TITULO = 300;
const TETO_DA_ETIQUETA = 60;

const ETIQUETAS_DE_SISTEMA = new Set([
  'all', 'anywhere', 'chat', 'chats', 'draft', 'drafts', 'important', 'inbox', 'muted', 'read',
  'scheduled', 'sent', 'snoozed', 'spam', 'starred', 'trash', 'unread',
]);

export type EtiquetaLida = { etiqueta: string } | { erro: string };

/**
 * A etiqueta no formato que a busca do Gmail entende: espaço e "/" (etiqueta
 * aninhada) viram "-", em minúsculas — é a mesma forma que o próprio Gmail
 * mostra ao clicar na etiqueta.
 */
export function lerEtiqueta(bruta: string | null | undefined): EtiquetaLida {
  const etiqueta = String(bruta ?? '')
    .trim()
    .replace(/^label:/i, '')
    .replace(/[\s/]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  if (!etiqueta) return { erro: 'Fonte do Gmail exige a etiqueta (ex.: newsletters).' };
  if (etiqueta.length > TETO_DA_ETIQUETA) {
    return { erro: `A etiqueta do Gmail tem no máximo ${TETO_DA_ETIQUETA} caracteres.` };
  }
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_.&+-]*$/u.test(etiqueta)) {
    return {
      erro: 'A etiqueta do Gmail aceita letras, números, espaço, "/", "-", "_", ".", "&" e "+". ' +
        'Aspas, dois-pontos e parênteses mudariam a busca.',
    };
  }
  if (ETIQUETAS_DE_SISTEMA.has(etiqueta) || /^category[-_]/.test(etiqueta)) {
    return {
      erro: `"${etiqueta}" é uma pasta do próprio Gmail, não uma etiqueta sua. ` +
        'Crie uma etiqueta só para as newsletters e use o nome dela.',
    };
  }
  return { etiqueta };
}

export function consultaDaEtiqueta(etiqueta: string, dias = DIAS_DA_JANELA_DO_GMAIL): string {
  return `label:${etiqueta} newer_than:${dias}d`;
}

/** O `urlHash` da captura de um e-mail: o do permalink, sem normalização. */
export function hashDoEmail(link: string): string {
  return hashDaCaptura(link);
}

const ENTIDADES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", hellip: '…', mdash: '—', ndash: '–',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', laquo: '«', raquo: '»', middot: '·', bull: '•',
};

function decodificarEntidades(t: string): string {
  return t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (inteira, nome: string) => {
    if (nome[0] === '#') {
      const n = nome[1] === 'x' || nome[1] === 'X' ? parseInt(nome.slice(2), 16) : parseInt(nome.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' ';
    }
    return ENTIDADES[nome.toLowerCase()] ?? inteira;
  });
}

/**
 * O corpo do e-mail em texto corrido. O conector devolve o `text/plain` quando
 * existe e, se não, a primeira parte com dado — em newsletter, quase sempre o
 * HTML. Os links saem: em newsletter são redirecionadores de rastreio, longos e
 * sem sentido para quem lê a fila, e a captura já aponta para o e-mail.
 */
export function textoLimpoDoEmail(corpo: string | null | undefined): string {
  let t = String(corpo ?? '');
  if (/<\/?[a-z][^>]*>/i.test(t)) {
    t = t
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      // O conector corta o corpo em 20.000: num template com CSS grande o corte
      // cai dentro do <style>, e sem isto o CSS viraria a nota. O <head> vai até
      // o <body> porque o HTML permite omitir o </head>.
      .replace(/<(script|style)\b[\s\S]*$/i, ' ')
      .replace(/<head\b[\s\S]*?(?=<body\b|$)/i, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
    t = decodificarEntidades(t);
  }
  // Depois das entidades: "&#xD83D;" também vira metade de par.
  return semSubstitutoSolto(t)
    .replace(/\r\n?/g, '\n')
    .replace(/<https?:\/\/[^>\s]*>/gi, ' ')
    .replace(/\[\s*https?:\/\/[^\]\s]*\s*\]/gi, ' ')
    .replace(/\(\s*https?:\/\/[^)\s]*\s*\)/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    // O "preheader" invisível das newsletters: dezenas de caracteres de largura zero.
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD\u034F]/g, '')
    .replace(/[ \t\f\v\u00A0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cortar(texto: string, teto: number): string {
  if (texto.length <= teto) return texto;
  const corte = cortarSemPartirCaractere(texto, teto);
  const espaco = corte.lastIndexOf(' ');
  return `${(espaco > teto * 0.8 ? corte.slice(0, espaco) : corte).trimEnd()}…`;
}

/** O que o efeito `comunicacao.email.buscar` devolve por e-mail. */
export interface EmailListado {
  id: string;
  /** O permalink do e-mail, montado pelo conector. */
  link: string;
}

/** O que o efeito `comunicacao.email.ler` devolve. */
export interface EmailLido {
  id: string;
  link: string;
  from: string | null;
  subject: string | null;
  date: string | null;
  snippet: string;
  body: string;
}

const ehListado = (m: unknown): m is EmailListado =>
  !!m && typeof m === 'object' && typeof (m as EmailListado).id === 'string' && typeof (m as EmailListado).link === 'string';

export function ehListaDeEmails(v: unknown): v is EmailListado[] {
  return Array.isArray(v) && v.every(ehListado);
}

export function ehEmailLido(v: unknown): v is EmailLido {
  return ehListado(v) && 'body' in v;
}

export interface CapturaDoEmail {
  url: string;
  urlHash: string;
  titulo: string;
  nota: string | null;
  bruto: {
    origem: 'gmail';
    mensagemId: string;
    etiqueta: string;
    remetente: string | null;
    data: string | null;
    publicadoEm: string | null;
    resumo: string | null;
    texto: string;
  };
}

/** O trecho que a API do Gmail devolve vem com entidade HTML ("&#39;", "&amp;") mesmo sem tag. */
function textoDoTrecho(trecho: string | null | undefined): string {
  return textoLimpoDoEmail(decodificarEntidades(String(trecho ?? '')));
}

export function capturaDoEmail(email: EmailLido, etiqueta: string): CapturaDoEmail {
  const texto = textoLimpoDoEmail(email.body) || textoDoTrecho(email.snippet);
  const quando = email.date ? new Date(email.date) : null;
  const assunto = semSubstitutoSolto(email.subject ?? '').replace(/\s+/g, ' ').trim();
  return {
    url: email.link,
    urlHash: hashDoEmail(email.link),
    titulo: cortar(assunto || '(sem assunto)', TETO_DO_TITULO),
    nota: texto ? cortar(texto, TETO_DA_NOTA) : null,
    bruto: {
      origem: 'gmail',
      mensagemId: email.id,
      etiqueta,
      remetente: email.from == null ? null : semSubstitutoSolto(email.from),
      data: email.date ?? null,
      publicadoEm: quando && !Number.isNaN(quando.getTime()) ? quando.toISOString() : null,
      resumo: textoDoTrecho(email.snippet) || null,
      texto: cortarSemPartirCaractere(texto, TETO_DO_TEXTO),
    },
  };
}

/** A captura veio do Gmail? O processamento lê o texto guardado em vez de abrir o permalink. */
export function veioDoGmail(bruto: unknown): boolean {
  return !!bruto && typeof bruto === 'object' && (bruto as { origem?: unknown }).origem === 'gmail';
}
