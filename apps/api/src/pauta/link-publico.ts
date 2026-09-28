import type { PautaOrigem } from '@mktos/shared';

/*
 * ============================================================================
 * O LINK QUE PODE SAIR PARA FORA (MC-R) — a regra única
 * ============================================================================
 *
 * Tudo o que publica ou monta página pergunta aqui se o link de um item pode
 * sair: o destino da peça no grupo do WhatsApp, a página de links (MC12), a
 * descrição do YouTube (MC11), a newsletter (MC13), o roteiro (MC8), o miolo da
 * curadoria e o pedido que deriva as peças.
 *
 * A MARCA `semLinkPublico` NÃO BASTA. Ela nasceu no MC6 e é gravada no item; a
 * captura de newsletter coletada antes dela, a rodada antiga e o item cuja
 * fonte foi apagada chegam sem a marca e com o permalink do Gmail no `url`.
 * Até o MC-R cada caminho tinha a sua regra, e duas delas liam só a marca —
 * esse permalink ia para o grupo. Por isso a decisão sai de três fatos, e
 * qualquer um deles basta para barrar: a marca, a ORIGEM (newsletter, em
 * qualquer uma das origens da matéria) e o HOST (caixa de entrada abre tela de
 * login, seja qual for a origem registrada).
 *
 * Os hosts vão sem esquema de propósito: são rótulos de caixa de entrada que
 * se comparam com o `hostname`, não endereços que alguém chama.
 */

/** Origens cujo link é privado: entram como contexto e nunca como link. */
export const ORIGENS_SEM_LINK_PUBLICO: readonly PautaOrigem[] = ['L'];

const HOSTS_DE_CAIXA_DE_ENTRADA = [
  'mail.google.com',
  'inbox.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'outlook.office365.com',
  'mail.yahoo.com',
];

export interface ItemComLink {
  url?: string | null;
  semLinkPublico?: boolean | null;
  origem?: PautaOrigem | null;
  origens?: readonly PautaOrigem[] | null;
}

/** A URL abre uma caixa de entrada. Endereço que nem é URL não é de caixa nenhuma. */
export function ehUrlDeCaixaDeEntrada(url: string | null | undefined): boolean {
  if (typeof url !== 'string' || !url.trim()) return false;
  let host: string;
  try {
    host = new URL(url.trim()).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return false;
  }
  return HOSTS_DE_CAIXA_DE_ENTRADA.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Alguma das origens é de link privado (newsletter). */
export function temOrigemSemLinkPublico(origens: ReadonlyArray<PautaOrigem | null | undefined>): boolean {
  return origens.some((o) => !!o && ORIGENS_SEM_LINK_PUBLICO.includes(o));
}

/** O link deste item é privado: pela marca, pela origem ou pelo host. */
export function ehLinkPrivado(item: ItemComLink): boolean {
  if (item.semLinkPublico === true) return true;
  if (temOrigemSemLinkPublico([item.origem, ...(item.origens ?? [])])) return true;
  return ehUrlDeCaixaDeEntrada(item.url);
}

/**
 * O link que pode sair, ou nulo. Além de não ser privado, precisa ser http(s),
 * sem espaço e sem `<`/`>` — ele vira link clicável no roteiro, no markdown da
 * newsletter e na página.
 */
export function linkPublicoDoItem(item: ItemComLink): string | null {
  if (ehLinkPrivado(item)) return null;
  const url = (item.url ?? '').trim();
  if (!/^https?:\/\/\S+$/i.test(url) || /[<>]/.test(url)) return null;
  try {
    new URL(url);
  } catch {
    return null;
  }
  return url;
}

/** Marcas do WhatsApp que embrulham o link (`*negrito*`, `_itálico_`, `~riscado~`). */
const MARCAS = new Set(['*', '_', '~']);
/** Pontuação colada no fim do endereço que não faz parte dele. */
const PONTUACAO_FINAL = /[*_~.,;:!?'"]+$/;

const ehEspaco = (c: string | undefined) => c === ' ' || c === '\t';

/**
 * O texto sem os endereços de caixa de entrada. Serve ao que já foi gravado
 * antes da regra única (o miolo de uma rodada antiga), ao texto que o modelo
 * escreveu e ao editado à mão: nenhum deles passou por `linkPublicoDoItem`.
 *
 * O `http` é procurado em qualquer posição — colado em letra, no `_` do itálico
 * ou no `*` do negrito — e a limpeza em volta (o espaço antes, as marcas que
 * embrulham, o `()` do miolo) só olha para onde o link saiu. A varredura é à
 * mão porque um regex que começa por `[ \t]*` é quadrático numa sequência longa
 * de espaços, e o corpo da peça é editável sem limite de tamanho.
 */
export function semLinksDeCaixaDeEntrada(texto: string): string {
  let saida = '';
  let desde = 0;
  for (const m of texto.matchAll(/<?https?:\/\/[^\s<>()]+>?/gi)) {
    const semAngulo = m[0].replace(/^</, '').replace(/>$/, '');
    const cauda = PONTUACAO_FINAL.exec(semAngulo)?.[0] ?? '';
    if (!ehUrlDeCaixaDeEntrada(semAngulo.slice(0, semAngulo.length - cauda.length))) continue;

    let inicio = m.index;
    while (inicio > desde && MARCAS.has(texto[inicio - 1])) inicio--;
    while (inicio > desde && ehEspaco(texto[inicio - 1])) inicio--;
    let fim = m.index + m[0].length;
    while (fim < texto.length && MARCAS.has(texto[fim])) fim++;
    const resto = [...cauda].filter((c) => !MARCAS.has(c)).join('');

    // O `(link)` do miolo da curadoria não fica como `()` vazio.
    if (!resto && inicio > desde && texto[inicio - 1] === '(') {
      let depois = fim;
      while (ehEspaco(texto[depois])) depois++;
      if (texto[depois] === ')') {
        inicio -= inicio - 1 > desde && texto[inicio - 2] === ' ' ? 2 : 1;
        fim = depois + 1;
      }
    }
    saida += texto.slice(desde, inicio) + resto;
    desde = fim;
  }
  return saida + texto.slice(desde);
}
