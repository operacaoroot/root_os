import { TOTEM_CABECALHO_ETIQUETA, TOTEM_CABECALHO_TOKEN } from '@mktos/shared';
import { API_BASE, ErroDaApi, erroDaResposta } from '@/lib/api';

/*
 * O CLIENTE DAS ROTAS PÚBLICAS DO TOTEM (CONTRATO.md, seção 8).
 *
 * Quiosque, página da etiqueta e cadastro falam com a API por aqui. Nenhuma
 * dessas telas tem sessão: a credencial é o token do aparelho (cabeçalho
 * `X-Totem-Token`) ou o código da etiqueta lida pelo QR (`X-Totem-Etiqueta`).
 * As duas vão em cabeçalho, nunca na URL, para não ficarem no log de acesso.
 *
 * Duas respostas que a tela precisa reconhecer pelo contrato, e não pela frase:
 *   · sem rede (o `fetch` nem chegou à API): `ehSemRede`. O quiosque segue com
 *     o catálogo do aparelho e esconde o cadastro;
 *   · 401 com o token do aparelho: `ehTotemDesativado`. O aparelho foi revogado
 *     no painel e volta para a tela de ativação.
 */

export type TotemCredencial = { token: string } | { etiqueta: string };

export interface OpcoesDoTotem {
  credencial?: TotemCredencial;
  metodo?: 'GET' | 'POST';
  corpo?: unknown;
  /** Padrão: 15 segundos. Rede de loja cai sem avisar, e o quiosque não pode travar esperando. */
  tempoLimiteMs?: number;
  /** Outra origem da API, para quem chama do servidor (RSC). Padrão: `API_BASE`. */
  base?: string;
}

/** O código que o cliente dá à falha de rede, com status 0. */
export const CODIGO_SEM_REDE = 'sem_rede';

const TEMPO_LIMITE_PADRAO_MS = 15_000;

function cabecalhosDa(credencial: TotemCredencial | undefined, temCorpo: boolean): Record<string, string> {
  const cabecalhos: Record<string, string> = {};
  if (temCorpo) cabecalhos['Content-Type'] = 'application/json';
  if (credencial && 'token' in credencial) cabecalhos[TOTEM_CABECALHO_TOKEN] = credencial.token;
  if (credencial && 'etiqueta' in credencial) cabecalhos[TOTEM_CABECALHO_ETIQUETA] = credencial.etiqueta;
  return cabecalhos;
}

/**
 * Chama uma rota pública do Totem. `caminho` é relativo a `/api`, por exemplo
 * `/totem-publico/catalogo`. Resposta sem corpo (204) volta como `undefined`.
 */
export async function totemApi<T>(caminho: string, opcoes: OpcoesDoTotem = {}): Promise<T> {
  const temCorpo = opcoes.corpo !== undefined;
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), opcoes.tempoLimiteMs ?? TEMPO_LIMITE_PADRAO_MS);
  let res: Response;
  try {
    res = await fetch(`${opcoes.base ?? API_BASE}${caminho}`, {
      method: opcoes.metodo ?? (temCorpo ? 'POST' : 'GET'),
      headers: cabecalhosDa(opcoes.credencial, temCorpo),
      body: temCorpo ? JSON.stringify(opcoes.corpo) : undefined,
      cache: 'no-store',
      credentials: 'omit',
      signal: controle.signal,
    });
  } catch {
    throw new ErroDaApi('Sem conexão com a internet.', 0, CODIGO_SEM_REDE);
  } finally {
    clearTimeout(relogio);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw erroDaResposta(body as Record<string, unknown>, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function ehSemRede(e: unknown): e is ErroDaApi {
  return e instanceof ErroDaApi && e.codigo === CODIGO_SEM_REDE;
}

/** O aparelho perdeu a credencial (revogado no painel ou token inválido). */
export function ehTotemDesativado(e: unknown): e is ErroDaApi {
  return e instanceof ErroDaApi && e.status === 401;
}

/** 404 única das rotas públicas: código, etiqueta ou empresa que não existe. */
export function ehNaoEncontrado(e: unknown): e is ErroDaApi {
  return e instanceof ErroDaApi && e.status === 404;
}
