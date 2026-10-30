/*
 * O ESTADO DO PAINEL DO LEAD NA URL (lane UX, 13/10/2026; abas novas na leva 5, L4, 27/10/2026).
 *
 * O painel não tem rota própria: ele mora na query da tela de fundo,
 * `?lead=<id>&aba=geral|pendencias|sala|area|whatsapp[&campo=<chave>]`. Assim um
 * link para um lead abre a tela com o painel aberto, e fechar devolve a tela
 * como estava. Funções puras: quem mexe no histórico é o provedor.
 *
 * LEVA 5 (L4): a primeira tela é a aba "Geral" e a segunda, "Pendências e
 * sugestões". Fio, Sessão, Dinheiro e Decisões SAÍRAM da fila de abas, mas o
 * código delas fica (`ABAS_FORA_DA_VISTA`): um link antigo com `aba=dinheiro`
 * ou `aba=sessao` ainda abre aquela aba, acrescentada no fim da fila só
 * enquanto estiver aberta. `aba=fio` (o padrão de antes) cai na Geral: o fio
 * inteiro agora é o "Histórico" do cabeçalho. Para desfazer a leva, basta
 * devolver os quatro nomes a `ABAS_DO_PAINEL`.
 *
 * `campo` é a chave do campo da aba Geral que deve receber o foco ao abrir
 * (o "vincular WhatsApp" do menu do lead, o "um clique leva ao campo" das
 * pendências). Só a Geral o lê; trocar de aba o apaga.
 */

/** As abas na fila do painel, na ordem. */
export const ABAS_DO_PAINEL = ['geral', 'pendencias', 'sala', 'area', 'whatsapp'] as const;
/** As abas de antes da leva 5: fora da fila, mas vivas por link direto (`aba=dinheiro`). */
export const ABAS_FORA_DA_VISTA = ['fio', 'sessao', 'dinheiro', 'decisoes'] as const;
export const TODAS_AS_ABAS = [...ABAS_DO_PAINEL, ...ABAS_FORA_DA_VISTA] as const;
export type AbaDoPainel = (typeof TODAS_AS_ABAS)[number];
export const ABA_PADRAO: AbaDoPainel = 'geral';

export const ROTULO_DA_ABA: Record<AbaDoPainel, string> = {
  // Leva 5 (L4): a ficha no modelo da Sessão Estratégica e o que falta fazer.
  geral: 'Geral',
  pendencias: 'Pendências e sugestões',
  // Rodada da implantação I3: a sala do cliente publicada por versão.
  sala: 'Sala',
  // Leva A da área do cliente (30/10/2026): os quinze itens que o cliente vê depois do fechamento.
  area: 'Área do cliente',
  // Produção 22C (W3): as conversas de WhatsApp ligadas ao lead.
  whatsapp: 'WhatsApp',
  fio: 'Fio',
  sessao: 'Sessão',
  dinheiro: 'Dinheiro',
  decisoes: 'Decisões',
};

export interface EstadoDoPainel {
  leadId: string;
  aba: AbaDoPainel;
  /** O campo da aba Geral que recebe o foco ao abrir (opcional). */
  campo?: string | null;
}

export function ehAba(x: unknown): x is AbaDoPainel {
  return typeof x === 'string' && (TODAS_AS_ABAS as readonly string[]).includes(x);
}

/** A aba está na fila do painel (as quatro da leva 5)? */
export function abaNaFila(aba: AbaDoPainel): boolean {
  return (ABAS_DO_PAINEL as readonly string[]).includes(aba);
}

/**
 * A aba que a URL pede: as da fila valem; as fora da vista valem por link
 * direto, menos `fio`, que era o padrão de todo link e agora é a Geral.
 */
export function abaDaUrl(x: unknown): AbaDoPainel {
  if (!ehAba(x)) return ABA_PADRAO;
  if (x === 'fio') return ABA_PADRAO;
  return x;
}

/** As abas a desenhar na fila: as quatro, mais a aberta quando ela é uma das antigas. */
export function abasNaTela(aberta: AbaDoPainel): AbaDoPainel[] {
  return abaNaFila(aberta) ? [...ABAS_DO_PAINEL] : [...ABAS_DO_PAINEL, aberta];
}

/** O id que vem da URL: o mesmo formato que a API aceita (uuid ou id curto sem barra). */
function idValido(x: string | null): x is string {
  return !!x && x.length <= 64 && /^[A-Za-z0-9_-]+$/.test(x);
}

/** A chave de um campo da aba Geral (letras, dígitos e ponto), ou nulo. */
function campoValido(x: string | null): string | null {
  return x && x.length <= 40 && /^[A-Za-z0-9_.-]+$/.test(x) ? x : null;
}

/** Lê o painel da query. Sem `lead` (ou com id torto), o painel fica fechado; aba desconhecida vira a Geral. */
export function lerPainel(busca: URLSearchParams | string): EstadoDoPainel | null {
  const q = typeof busca === 'string' ? new URLSearchParams(busca) : busca;
  const leadId = q.get('lead');
  if (!idValido(leadId)) return null;
  const campo = campoValido(q.get('campo'));
  return { leadId, aba: abaDaUrl(q.get('aba')), ...(campo ? { campo } : {}) };
}

/** A URL da tela de fundo com o painel aberto, sem perder o resto da query (filtros). */
export function urlComPainel(pathname: string, busca: string, leadId: string, aba: AbaDoPainel, campo?: string | null): string {
  const q = new URLSearchParams(busca);
  q.set('lead', leadId);
  q.set('aba', aba);
  if (campo) q.set('campo', campo);
  else q.delete('campo');
  return `${pathname}?${q.toString()}`;
}

/** A URL da tela de fundo sem o painel. */
export function urlSemPainel(pathname: string, busca: string): string {
  const q = new URLSearchParams(busca);
  q.delete('lead');
  q.delete('aba');
  q.delete('campo');
  const resto = q.toString();
  return resto ? `${pathname}?${resto}` : pathname;
}

/**
 * Para onde vão os links antigos das quatro subpáginas do lead. Nada de 404:
 * quem guardou o link cai na tela de fundo com o painel aberto na aba certa
 * (o fio virou a Geral; sessão e dinheiro abrem a aba antiga por link direto).
 */
export function destinoDaRotaAntiga(rota: 'fio' | 'sessao' | 'fechamento' | 'contrato', leadId: string): string {
  const id = encodeURIComponent(leadId);
  switch (rota) {
    case 'fio':
      return `/comercial/funil?lead=${id}&aba=geral`;
    case 'sessao':
      return `/comercial/funil?lead=${id}&aba=sessao`;
    case 'fechamento':
      return `/comercial/funil?lead=${id}&aba=dinheiro`;
    case 'contrato':
      return `/comercial/contratos?lead=${id}&aba=dinheiro`;
  }
}

/** O telefone em dígitos para o wa.me (Brasil sem DDI ganha o 55). Sem dígitos suficientes, nulo. */
export function linkDoWhatsApp(telefone: string | null | undefined): string | null {
  const d = (telefone ?? '').replace(/\D/g, '');
  if (d.length < 10) return null;
  const comPais = d.length <= 11 ? `55${d}` : d;
  return `https://wa.me/${comPais}`;
}
