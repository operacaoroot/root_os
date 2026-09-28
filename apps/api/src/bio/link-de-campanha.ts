/*
 * O LINK DE CAMPANHA (MC12). Um BioLink que existe só para ser clicado numa
 * mensagem (a peça que sai no grupo do WhatsApp), não para aparecer na página:
 * nasce INATIVO, então a página pública e a contagem de botões não o veem, e
 * mesmo assim o `/r/:linkId` redireciona e grava o clique — desde que a página
 * dele esteja no ar, como qualquer outro link.
 *
 * É a CHAVE que o marca (`campanha:<de onde>:<id>`), não o `ativo`: botão
 * desativado à mão no painel continua morto lá fora. Antes do MC12 o link da
 * peça nascia inativo sem chave nenhuma, e o `/r/` dele caía na home da bio sem
 * medir nada.
 */
const PREFIXO = 'campanha:';

export function chaveDeCampanha(origem: string, id: string): string {
  return `${PREFIXO}${origem}:${id}`;
}

export function ehLinkDeCampanha(chave: string | null | undefined): boolean {
  return typeof chave === 'string' && chave.startsWith(PREFIXO);
}

/** O `/r/` segue o link? Ativo, ou de campanha — nos dois casos só com a página no ar. */
export function linkRedireciona(link: { ativo: boolean; chave: string | null; page: { publicada: boolean } }): boolean {
  return link.page.publicada && (link.ativo || ehLinkDeCampanha(link.chave));
}
