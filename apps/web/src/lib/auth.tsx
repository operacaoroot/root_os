'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { apiGet, apiPost, ErroDaApi, observarSessaoRecusada } from './api';

export interface AuthUser { id: string; name: string; email: string; roles: string[]; permissions: string[] }
interface AuthContextValue {
  user: AuthUser | null; token: string | null; ready: boolean;
  sessionError: string | null; retrySession: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  loginWithToken: (token: string) => Promise<void>; logout: () => void;
  can: (permission: string) => boolean;
}
const AuthContext = createContext<AuthContextValue | null>(null);
const TOKEN_KEY = 'mktos_token', USER_KEY = 'mktos_user';
const EXPIRADA = 'Sua sessão expirou. Entre novamente.';
function usuarioValido(v: unknown): v is AuthUser {
  if (!v || typeof v !== 'object') return false;
  const u = v as AuthUser;
  return ['id', 'name', 'email'].every(k => typeof u[k as keyof AuthUser] === 'string') && !!u.id &&
    Array.isArray(u.roles) && u.roles.every(r => typeof r === 'string') &&
    Array.isArray(u.permissions) && u.permissions.every(p => typeof p === 'string');
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const atual = useRef<string | null>(null);
  const geracao = useRef(0);
  const loginIniciado = useRef(false);
  const montado = useRef(true);
  const salvarLocal = useCallback((t: string | null, u: AuthUser | null) => {
    try {
      if (t && u) { localStorage.setItem(TOKEN_KEY, t); localStorage.setItem(USER_KEY, JSON.stringify(u)); }
      else { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }
    } catch { /* A sessão em memória continua válida quando o navegador recusa armazenamento. */ }
  }, []);
  const encerrar = useCallback((mensagem: string | null = null) => {
    geracao.current++; atual.current = null; salvarLocal(null, null);
    setUser(null); setToken(null); setReady(true); setSessionError(mensagem);
  }, [salvarLocal]);
  const instalar = useCallback((t: string, u: AuthUser) => {
    if (!usuarioValido(u)) throw new Error('A resposta de login não confirmou sua conta. Tente novamente.');
    atual.current = t; salvarLocal(t, u); setToken(t); setUser(u); setSessionError(null); setReady(true);
  }, [salvarLocal]);
  const conferir = useCallback(async (t: string) => {
    const g = ++geracao.current; atual.current = t; setToken(t); setUser(null); setReady(false); setSessionError(null);
    try {
      const me = await apiGet<AuthUser>('/auth/me', t);
      if (!montado.current || geracao.current !== g || atual.current !== t) return;
      instalar(t, me);
    } catch (e) {
      if (!montado.current || geracao.current !== g || atual.current !== t) return;
      if (e instanceof ErroDaApi && e.status === 401) encerrar(EXPIRADA);
      else { setReady(true); setSessionError('Não foi possível confirmar sua sessão. Tente novamente quando a conexão voltar.'); }
    }
  }, [encerrar, instalar]);
  useEffect(() => {
    montado.current = true;
    const remover = observarSessaoRecusada(t => { if (atual.current === t) encerrar(EXPIRADA); });
    let t: string | null = null;
    try { t = localStorage.getItem(TOKEN_KEY); } catch { /* Sem sessão persistida. */ }
    if (!loginIniciado.current) { if (t) void conferir(t); else setReady(true); }
    return () => { remover(); montado.current = false; };
  }, [conferir, encerrar]);
  async function login(email: string, password: string) {
    loginIniciado.current = true;
    const g = ++geracao.current;
    const res = await apiPost<{ token: string; user: AuthUser }>('/auth/login', { email, password });
    if (!montado.current || geracao.current !== g) return;
    if (!res.token || typeof res.token !== 'string') throw new Error('O login não devolveu uma sessão válida.');
    instalar(res.token, res.user);
  }
  async function loginWithToken(t: string) {
    loginIniciado.current = true;
    const g = ++geracao.current;
    const me = await apiGet<AuthUser>('/auth/me', t);
    if (!montado.current || geracao.current !== g) return;
    instalar(t, me);
  }
  async function retrySession() { if (atual.current) await conferir(atual.current); }
  return <AuthContext.Provider value={{ user, token, ready, sessionError, retrySession, login, loginWithToken,
    logout: () => encerrar(), can: p => !!user?.permissions.includes(p) }}>{children}</AuthContext.Provider>;
}
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  return ctx;
}
