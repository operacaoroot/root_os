import { normalizarUrlDaCaptura } from './url-da-captura';

/*
 * ============================================================================
 * O GRUPO DE LINKS DO WHATSAPP — a leitura, pura (MC1)
 * ============================================================================
 *
 * O grupo "Root · links" é uma caixa de correio: alguém cola um link e ele tem
 * de aparecer em `/referencias`. Esta função recebe o corpo do webhook da
 * Evolution e o JID configurado, e devolve as URLs — ou o motivo de ter
 * ignorado. Não toca banco, não chama rede, não decide nada: quem grava é
 * `entrada-de-links.service.ts`.
 *
 * O QUE ELA ACEITA E POR QUÊ, porque é o contrário do canal de aprovação:
 *
 *  · SÓ o grupo configurado, por igualdade. Outro grupo, conversa direta e
 *    transmissão morrem aqui (`outro-chat`). O registro na porta já só despacha
 *    o grupo inscrito; conferir de novo custa uma comparação e mantém a função
 *    correta sozinha.
 *  · `fromMe` ENTRA. No canal de aprovação isso é eco da própria instância; aqui
 *    o OS nunca escreve no grupo de links (a publicação vai para
 *    `EVOLUTION_GRUPO_JID`, o pedido de aprovação vai para conversa direta), e
 *    quem cola link pelo aparelho da instância é gente. Se um dia alguém apontar
 *    as duas variáveis para o mesmo grupo, o pior caso é a peça publicada virar
 *    captura — deduplicada pelo `urlHash`, sem Apify e sem IA.
 *  · Encaminhada ENTRA. Encaminhar um link para o grupo é o gesto natural; aqui
 *    o texto não decide nada, só vira rascunho na fila.
 *  · O texto é `conversation`, `extendedTextMessage.text` ou a legenda de uma
 *    imagem. A mensagem CITADA não é lida: citar não é colar.
 *  · Só `messages.upsert`. Edição chega em `messages.update` e não conta — o
 *    link original já entrou.
 */

/** O único evento lido. Mesmo literal do canal de aprovação. */
const EVENTO = 'messages.upsert';

/** Quantas URLs uma mensagem pode gerar. Texto colado de uma newsletter inteira não vira 200 capturas. */
export const TETO_DE_LINKS_POR_MENSAGEM = 20;

/** URL maior que isto não é link que alguém colou; é lixo ou ataque. */
const TETO_DA_URL = 2048;

/** Até onde o texto é varrido. Mensagem gigante não custa varredura gigante. */
const TETO_DO_TEXTO_LIDO = 20_000;

/** O texto vira `nota` da captura; corta onde a nota da tela também cortaria. */
export const TETO_DA_NOTA = 2000;

export type MotivoDeIgnorarLinks =
  | 'grupo-nao-configurado'
  | 'evento-desconhecido'
  | 'outro-chat'
  | 'sem-texto'
  | 'sem-link';

export type LeituraDoGrupoDeLinks =
  | { tipo: 'ignorar'; porque: MotivoDeIgnorarLinks }
  | {
      tipo: 'links';
      /** Normalizadas, sem repetição, na ordem em que apareceram. */
      urls: string[];
      /** O texto da mensagem como veio (cortado no teto da nota). */
      texto: string;
      /**
       * O nome que a pessoa mostra no WhatsApp (`pushName`). O número
       * (`key.participant`) fica de fora de propósito: a captura não precisa
       * dele, e telefone guardado é telefone para vazar.
       */
      remetente: string | null;
      mensagemId: string | null;
    };

function objeto(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function jidCanonico(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim().toLowerCase() : null;
}

function textoDaMensagem(message: Record<string, unknown>): string | null {
  return (
    texto(message.conversation) ??
    texto(objeto(message.extendedTextMessage)?.text) ??
    texto(objeto(message.imageMessage)?.caption)
  );
}

/** Pontuação que cola no fim do link sem ser dele: "veja https://x.com/a." */
const SOBRA_NO_FIM = /[.,;:!?'"]$/;

/**
 * Onde a URL para, além do espaço. O WhatsApp não põe no link o emoji, a
 * bandeira, as aspas tipográficas, as angulares nem as reticências que vêm
 * coladas nele ("https://x.com/a👇", "“https://x.com/a”"); se entrassem, a URL
 * sairia codificada (`%F0%9F%91%87`), a coleta daria 404 e o `urlHash` não
 * bateria com o do mesmo link limpo. Letra acentuada continua valendo
 * (`pt.wikipedia.org/wiki/São_Paulo`).
 */
const URL_NO_TEXTO =
  /https?:\/\/[^\s<>"'`“”‘’«»…\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u200D\uFE0F\u20E3]+/giu;

/** Dois links colados só com vírgula ("https://a.com/x,https://b.com/y") são dois. */
const VIRGULA_ANTES_DE_OUTRO_LINK = /,(?=https?:\/\/)/i;

/** Marcadores de formatação do WhatsApp: *negrito*, _itálico_, ~riscado~. */
const MARCADOR = /[*_~]/;

const FECHA_ABRE: Record<string, string> = { ')': '(', ']': '[', '}': '{', '>': '<' };

function conta(s: string, c: string): number {
  return s.split(c).length - 1;
}

/** Os marcadores de formatação colados logo antes do `http` ("_*https://…"). */
function marcadoresAntes(conteudo: string, inicio: number): string {
  let i = inicio;
  while (i > 0 && MARCADOR.test(conteudo[i - 1])) i--;
  return conteudo.slice(i, inicio);
}

/**
 * Tira do fim o que é pontuação da frase, e o parêntese que fecha a frase — mas
 * não o que é do link (`https://pt.wikipedia.org/wiki/Rio_(cidade)`).
 *
 * `*`, `_` e `~` só saem quando o mesmo marcador abriu antes do link: em
 * `*https://b.com*` o asterisco é negrito; em `https://x.com/fulano_` o
 * sublinhado é do perfil, e tirá-lo apontaria para outra conta.
 */
function aparar(bruta: string, abertos: string): string {
  let s = bruta;
  for (;;) {
    const ultimo = s.slice(-1);
    if (SOBRA_NO_FIM.test(ultimo) || (MARCADOR.test(ultimo) && abertos.includes(ultimo))) {
      s = s.slice(0, -1);
      continue;
    }
    const abre = FECHA_ABRE[ultimo];
    if (abre && conta(s, ultimo) > conta(s, abre)) {
      s = s.slice(0, -1);
      continue;
    }
    return s;
  }
}

/**
 * Host que o servidor não deve buscar a pedido de quem está no grupo: IP
 * literal (v4 ou v6) e nome interno. Processar a captura faz `fetch` do lado do
 * servidor, e o grupo amplia quem consegue criar captura de link.
 */
function hostInterno(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h.startsWith('[') || h.includes(':')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  if (h === 'localhost' || /\.(localhost|local|internal|lan|home\.arpa)$/.test(h)) return true;
  return !h.includes('.');
}

/** Todas as URLs http(s) do texto, normalizadas e sem repetição. */
export function extrairUrls(conteudo: string): string[] {
  const lido = conteudo.slice(0, TETO_DO_TEXTO_LIDO);
  const vistas = new Set<string>();
  for (const m of lido.matchAll(URL_NO_TEXTO)) {
    const abertos = marcadoresAntes(lido, m.index ?? 0);
    for (const pedaco of m[0].split(VIRGULA_ANTES_DE_OUTRO_LINK)) {
      if (pedaco.length > TETO_DA_URL) continue;
      const candidata = aparar(pedaco, abertos);
      let u: URL;
      try {
        u = new URL(candidata);
      } catch {
        continue;
      }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      if (hostInterno(u.hostname)) continue;
      vistas.add(normalizarUrlDaCaptura(candidata));
      if (vistas.size >= TETO_DE_LINKS_POR_MENSAGEM) return [...vistas];
    }
  }
  return [...vistas];
}

/**
 * Junta a procedência do grupo (quem mandou, qual mensagem) ao `bruto` que a
 * coleta devolve. Processar a captura troca o `bruto` pelo item do Apify ou pelo
 * HTML; sem isto, o nome de quem colou o link sumiria quando ela vira ficha.
 */
export function comProcedencia(anterior: unknown, novo: unknown): unknown {
  const antes = objeto(anterior);
  if (antes?.origem !== 'whatsapp') return novo;
  const procedencia = { origem: antes.origem, remetente: antes.remetente ?? null, mensagemId: antes.mensagemId ?? null };
  return { ...(objeto(novo) ?? {}), ...procedencia };
}

/**
 * Lê o webhook e devolve as URLs da mensagem, ou o motivo de ter ignorado.
 *
 * `jidEsperado` vazio ou que não seja de grupo desliga a leitura inteira: sem
 * grupo configurado não há o que capturar, e nunca se captura conversa direta.
 */
export function lerLinksDoGrupo(
  evento: unknown,
  jidEsperado: string | null | undefined,
): LeituraDoGrupoDeLinks {
  const esperado = jidCanonico(jidEsperado);
  if (!esperado || !esperado.endsWith('@g.us')) {
    return { tipo: 'ignorar', porque: 'grupo-nao-configurado' };
  }

  const raiz = objeto(evento);
  if (typeof raiz?.event !== 'string' || raiz.event.trim().toLowerCase() !== EVENTO) {
    return { tipo: 'ignorar', porque: 'evento-desconhecido' };
  }
  const data = objeto(raiz.data);
  const key = objeto(data?.key);
  if (!data || !key) return { tipo: 'ignorar', porque: 'evento-desconhecido' };

  if (jidCanonico(key.remoteJid) !== esperado) return { tipo: 'ignorar', porque: 'outro-chat' };

  const message = objeto(data.message);
  const conteudo = message ? textoDaMensagem(message) : null;
  if (!conteudo) return { tipo: 'ignorar', porque: 'sem-texto' };

  const urls = extrairUrls(conteudo);
  if (urls.length === 0) return { tipo: 'ignorar', porque: 'sem-link' };

  return {
    tipo: 'links',
    urls,
    texto: conteudo.trim().slice(0, TETO_DA_NOTA),
    remetente: texto(data.pushName)?.trim().slice(0, 120) ?? null,
    mensagemId: texto(key.id),
  };
}
