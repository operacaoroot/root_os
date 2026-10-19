/*
 * O ESTADO DO PAINEL DO LEAD NA URL (lane UX, 13/10/2026).
 *
 * O painel não tem rota própria: ele mora na query da tela de fundo,
 * `?lead=<id>&aba=fio|sessao|dinheiro|decisoes`. Assim um link para um lead
 * abre a tela com o painel aberto, e fechar devolve a tela como estava.
 * Funções puras: quem mexe no histórico é o provedor.
 */

export const ABAS_DO_PAINEL = ['fio', 'sessao', 'dinheiro', 'decisoes', 'sala'] as const;
export type AbaDoPainel = (typeof ABAS_DO_PAINEL)[number];

export const ROTULO_DA_ABA: Record<AbaDoPainel, string> = {
  fio: 'Fio',
  sessao: 'Sessão',
  dinheiro: 'Dinheiro',
  decisoes: 'Decisões',
  // Rodada da implantação I3: a sala do cliente publicada por versão.
  sala: 'Sala',
};

export interface EstadoDoPainel {
  leadId: string;
  aba: AbaDoPainel;
}

export function ehAba(x: unknown): x is AbaDoPainel {
  return typeof x === 'string' && (ABAS_DO_PAINEL as readonly string[]).includes(x);
}

/** O id que vem da URL: o mesmo formato que a API aceita (uuid ou id curto sem barra). */
function idValido(x: string | null): x is string {
  return !!x && x.length <= 64 && /^[A-Za-z0-9_-]+$/.test(x);
}

/** Lê o painel da query. Sem `lead` (ou com id torto), o painel fica fechado; aba desconhecida vira Fio. */
export function lerPainel(busca: URLSearchParams | string): EstadoDoPainel | null {
  const q = typeof busca === 'string' ? new URLSearchParams(busca) : busca;
  const leadId = q.get('lead');
  if (!idValido(leadId)) return null;
  const aba = q.get('aba');
  return { leadId, aba: ehAba(aba) ? aba : 'fio' };
}

/** A URL da tela de fundo com o painel aberto, sem perder o resto da query (filtros). */
export function urlComPainel(pathname: string, busca: string, leadId: string, aba: AbaDoPainel): string {
  const q = new URLSearchParams(busca);
  q.set('lead', leadId);
  q.set('aba', aba);
  return `${pathname}?${q.toString()}`;
}

/** A URL da tela de fundo sem o painel. */
export function urlSemPainel(pathname: string, busca: string): string {
  const q = new URLSearchParams(busca);
  q.delete('lead');
  q.delete('aba');
  const resto = q.toString();
  return resto ? `${pathname}?${resto}` : pathname;
}

/**
 * Para onde vão os links antigos das quatro subpáginas do lead. Nada de 404:
 * quem guardou o link cai na tela de fundo com o painel aberto na aba certa.
 */
export function destinoDaRotaAntiga(rota: 'fio' | 'sessao' | 'fechamento' | 'contrato', leadId: string): string {
  const id = encodeURIComponent(leadId);
  switch (rota) {
    case 'fio':
      return `/comercial/funil?lead=${id}&aba=fio`;
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
