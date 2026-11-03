// A lista fechada das rotas da API (gerada) e o que `os_api`/`os_rotas` fazem com ela: casar, filtrar, pesquisar.
import { ROTAS, type RotaDaApi } from './rotas.gen.js';

export type Metodo = RotaDaApi['m'];
export const METODOS: Metodo[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** Sem query string, sem barra final, com `/api` na frente (aceita `/comercial/funil` e `/api/comercial/funil`). */
export function normalizarRota(entrada: string): string {
  let r = entrada.trim().split('?')[0].split('#')[0];
  if (!r.startsWith('/')) r = '/' + r;
  if (!r.startsWith('/api/') && r !== '/api') r = '/api' + r;
  if (r.length > 1 && r.endsWith('/')) r = r.slice(0, -1);
  return r;
}

function casa(padrao: string, rota: string): boolean {
  const a = padrao.split('/'); const b = rota.split('/');
  if (a.length !== b.length) return false;
  return a.every((seg, i) => (seg.startsWith(':') ? b[i].length > 0 : seg === b[i]));
}

/** A rota do inventário que atende este método e caminho concreto (ids no lugar dos `:param`). */
export function acharRota(metodo: string, rota: string): RotaDaApi | null {
  const m = metodo.toUpperCase(); const r = normalizarRota(rota);
  const candidatas = ROTAS.filter((x) => x.m === m && casa(x.r, r));
  if (!candidatas.length) return null;
  // a mais específica primeiro: menos parâmetros
  candidatas.sort((x, y) => (x.r.match(/:/g)?.length ?? 0) - (y.r.match(/:/g)?.length ?? 0));
  return candidatas[0];
}

export function publica(r: RotaDaApi): boolean { return r.f.includes('pub'); }
export function soGente(r: RotaDaApi): boolean { return r.f.includes('g'); }
export function recebeArquivo(r: RotaDaApi): boolean { return r.f.includes('u'); }
export function devolveArquivo(r: RotaDaApi): boolean { return r.f.includes('a'); }

/** Rotas que o MCP não deve chamar: sem sessão (sala por token, webhooks, callbacks) e as de login. */
export function alcancavel(r: RotaDaApi): boolean {
  return !publica(r) && !r.r.startsWith('/api/auth/');
}

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function buscarRotas(busca: string, filtro: { metodo?: string; modulo?: string; limite?: number } = {}): RotaDaApi[] {
  const termos = normalizar(busca).split(/\s+/).filter(Boolean);
  const limite = Math.min(Math.max(filtro.limite ?? 30, 1), 100);
  const m = filtro.metodo?.toUpperCase();
  const mod = filtro.modulo ? normalizar(filtro.modulo).replace(/^\//, '') : null;
  const pontuada = ROTAS.filter(alcancavel)
    .filter((r) => !m || r.m === m)
    .filter((r) => !mod || normalizar(r.r).startsWith('/api/' + mod))
    .map((r) => {
      const texto = normalizar(`${r.r} ${r.d} ${r.p.join(' ')}`);
      const naRota = normalizar(r.r);
      let pontos = 0;
      for (const t of termos) {
        if (!texto.includes(t)) return null;
        pontos += naRota.includes(t) ? 3 : 1;
      }
      return { r, pontos };
    })
    .filter((x): x is { r: RotaDaApi; pontos: number } => x !== null)
    .sort((x, y) => y.pontos - x.pontos || x.r.r.localeCompare(y.r.r));
  return pontuada.slice(0, limite).map((x) => x.r);
}

export function totalDeRotas(): { total: number; alcancaveis: number; publicas: number } {
  return { total: ROTAS.length, alcancaveis: ROTAS.filter(alcancavel).length, publicas: ROTAS.filter(publica).length };
}
