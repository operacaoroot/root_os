'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { apiGet, apiPost } from './api';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  roles: string[];
  permissions: string[];
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithToken: (token: string) => Promise<void>;
  logout: () => void;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'mktos_token';
const USER_KEY = 'mktos_user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const t = localStorage.getItem(TOKEN_KEY);
      const u = localStorage.getItem(USER_KEY);
      if (t && u) {
        setToken(t);
        setUser(JSON.parse(u) as AuthUser);
      }
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  async function login(email: string, password: string) {
    const res = await apiPost<{ token: string; user: AuthUser }>('/auth/login', {
      email,
      password,
    });
    localStorage.setItem(TOKEN_KEY, res.token);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    setToken(res.token);
    setUser(res.user);
  }

  /** Sessão que já veio pronta de fora (login com Google): confirma no /auth/me. */
  async function loginWithToken(t: string) {
    const me = await apiGet<AuthUser>('/auth/me', t);
    localStorage.setItem(TOKEN_KEY, t);
    localStorage.setItem(USER_KEY, JSON.stringify(me));
    setToken(t);
    setUser(me);
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  }

  const can = (permission: string) => !!user?.permissions.includes(permission);

  return (
    <AuthContext.Provider value={{ user, token, ready, login, loginWithToken, logout, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  return ctx;
}
