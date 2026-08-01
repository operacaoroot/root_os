/**
 * Abstração segura sobre localStorage:
 * - não explode no servidor nem com storage bloqueado;
 * - versiona a estrutura pra permitir migração;
 * - trocável por backend sem tocar nos componentes (basta reimplementar aqui).
 */

const PREFIXO = "root-central";
const VERSAO = 1;

type Envelope<T> = { v: number; dados: T };

export function lerStorage<T>(chave: string, padrao: T): T {
  if (typeof window === "undefined") return padrao;
  try {
    const cru = window.localStorage.getItem(`${PREFIXO}:${chave}`);
    if (!cru) return padrao;
    const env = JSON.parse(cru) as Envelope<T>;
    if (env.v !== VERSAO) return padrao; // versão antiga: descarta (migração entra aqui)
    return env.dados;
  } catch {
    return padrao;
  }
}

export function gravarStorage<T>(chave: string, dados: T): boolean {
  if (typeof window === "undefined") return false;
  try {
    const env: Envelope<T> = { v: VERSAO, dados };
    window.localStorage.setItem(`${PREFIXO}:${chave}`, JSON.stringify(env));
    return true;
  } catch {
    return false; // storage cheio ou bloqueado — a UI segue funcionando sem persistir
  }
}

export function storageDisponivel(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const t = `${PREFIXO}:teste`;
    window.localStorage.setItem(t, "1");
    window.localStorage.removeItem(t);
    return true;
  } catch {
    return false;
  }
}
