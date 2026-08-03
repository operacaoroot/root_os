import { Injectable, Logger } from '@nestjs/common';

// Leitor de RSS/Atom sem dependência: as fontes de notícia de IA publicam XML
// simples e previsível, e um parser de 60 linhas evita puxar um pacote inteiro
// (mesma escolha do resto do projeto — ver o comentário no OpenAiProvider).
//
// Só lê o que precisa: título, link, data e resumo. Nada de namespaces, CDATA
// aninhado ou enclosures — se um feed exigir isso, ele volta vazio e o erro
// aparece na fonte em vez de derrubar a coleta inteira.

export interface ItemFeed {
  titulo: string;
  url: string;
  publicadoEm: Date | null;
  resumo: string;
}

function decodeEntidades(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

function semTags(s: string): string {
  // O CDATA sai PRIMEIRO: `<![CDATA[…]]>` casa inteiro com /<[^>]+>/ (o primeiro
  // ">" só aparece no fecho), então limpar tags antes apagaria o conteúdo todo.
  const semCdata = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return decodeEntidades(semCdata.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Conteúdo da primeira tag <nome> do bloco (com ou sem namespace). */
function tag(bloco: string, nome: string): string | null {
  const re = new RegExp(`<(?:\\w+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${nome}>`, 'i');
  return bloco.match(re)?.[1] ?? null;
}

/** Link do item: <link>url</link> (RSS) ou <link href="url"/> (Atom). */
function link(bloco: string): string | null {
  const texto = tag(bloco, 'link');
  if (texto && texto.trim() && !texto.includes('<')) return decodeEntidades(texto);
  const href = bloco.match(/<(?:\w+:)?link[^>]*\shref=["']([^"']+)["']/i)?.[1];
  if (href) return decodeEntidades(href);
  // alguns feeds só trazem <guid isPermaLink="true">
  const guid = tag(bloco, 'guid');
  if (guid && /^https?:\/\//i.test(guid.trim())) return decodeEntidades(guid);
  return null;
}

@Injectable()
export class RssService {
  private readonly log = new Logger('RssService');

  async ler(url: string, limite = 40): Promise<ItemFeed[]> {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MarketingOS/1.0; +https://os.operacaoroot.com)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Feed respondeu HTTP ${res.status}`);

    const xml = await res.text();
    const blocos = [
      ...xml.matchAll(/<(?:\w+:)?item(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?item>/gi),
      ...xml.matchAll(/<(?:\w+:)?entry(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?entry>/gi),
    ];

    const itens: ItemFeed[] = [];
    for (const m of blocos.slice(0, limite)) {
      const bloco = m[1];
      const url = link(bloco);
      const titulo = tag(bloco, 'title');
      if (!url || !titulo) continue;

      const dataCru =
        tag(bloco, 'pubDate') ?? tag(bloco, 'published') ?? tag(bloco, 'updated') ?? tag(bloco, 'date');
      const d = dataCru ? new Date(decodeEntidades(dataCru)) : null;

      const resumo =
        tag(bloco, 'description') ?? tag(bloco, 'summary') ?? tag(bloco, 'content') ?? '';

      itens.push({
        titulo: semTags(titulo).slice(0, 300),
        url,
        publicadoEm: d && !Number.isNaN(d.getTime()) ? d : null,
        resumo: semTags(resumo).slice(0, 1200),
      });
    }

    if (!itens.length) this.log.warn(`Feed sem itens reconhecíveis: ${url}`);
    return itens;
  }
}
